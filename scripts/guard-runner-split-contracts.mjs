#!/usr/bin/env node
/* global console, process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listFiles(dir, predicate) {
  const root = path.join(repoRoot, dir);
  const entries = [];
  for (const name of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, name.name);
    const rel = path.relative(repoRoot, full);
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === 'dist') continue;
      entries.push(...listFiles(rel, predicate));
    } else if (predicate(rel)) {
      entries.push(rel);
    }
  }
  return entries;
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function findMatches(relativePath, pattern) {
  const source = read(relativePath);
  const matches = [];
  for (const match of source.matchAll(pattern)) {
    matches.push(`${relativePath}:${lineNumber(source, match.index ?? 0)}: ${match[0]}`);
  }
  return matches;
}

const failures = [];
const evidence = [];

function assertNoMatches(name, files, pattern) {
  const matches = files.flatMap((file) => findMatches(file, pattern));
  if (matches.length > 0) {
    failures.push({ name, matches });
  } else {
    evidence.push(`${name}: no matches`);
  }
}

function assertContains(relativePath, required, name) {
  const source = read(relativePath);
  if (!source.includes(required)) {
    failures.push({ name, matches: [`${relativePath}: missing ${required}`] });
  } else {
    evidence.push(`${name}: present`);
  }
}

const frontendSourceFiles = listFiles('packages/frontend/src', (rel) =>
  /\.(tsx?|jsx?)$/.test(rel) && !/\.test\./.test(rel),
);
const backendSourceFiles = listFiles('packages/backend/src', (rel) =>
  /\.(tsx?|jsx?)$/.test(rel) && !/\.test\./.test(rel) && !/\/qa\//.test(rel),
);
const runnerJobSourceFiles = [
  'packages/backend/src/services/agent-chat.ts',
  'packages/backend/src/services/runner-public-api-url.ts',
  'packages/backend/src/services/agent-runners.ts',
];

assertNoMatches(
  'hosted runner-local UI does not call server-local filesystem endpoints',
  frontendSourceFiles,
  /api\(['"`]\/(?:storage\/(?:browse-fs|pick-folder|reveal-local)|agents\/[^'"`]+\/files\/reveal|agents\/[^'"`]+\/chat\/conversations\/[^'"`]+\/reveal-folder)/g,
);
assertNoMatches(
  'native runner UI copy does not say provider CLIs run on the server',
  frontendSourceFiles,
  /\b(on this server|on the server|server-relevant model IDs|not found on this server|server PATH)\b/g,
);
assertNoMatches(
  'production runner job URL contract does not default WORKSPACE_API_URL to localhost literals',
  runnerJobSourceFiles,
  /WORKSPACE_API_URL[\s\S]{0,160}(?:localhost|127\.0\.0\.1)/g,
);
assertNoMatches(
  'runner job construction does not use backend DATA_DIR as executable cwd',
  backendSourceFiles,
  /(?:workDir|cwd|PWD)\s*[:=]\s*(?:path\.resolve\(\s*)?(?:env\.)?DATA_DIR/g,
);
assertNoMatches(
  'runner attachment dispatch does not send backend storage disk paths as final attachment paths',
  ['packages/backend/src/services/agent-chat.ts'],
  /attachment\.path\s*=\s*diskPath|path:\s*diskPath/g,
);

assertContains(
  'packages/backend/src/services/agent-chat.ts',
  'attachment.path = `.openwork/staging/${item.id}/${destination}`;',
  'attachment paths are rewritten to runner-local staging destinations',
);
assertContains(
  'packages/backend/src/services/runner-public-api-url.ts',
  "options.nodeEnv === 'production' && isLocalHostname",
  'hosted localhost callback guard is present',
);
assertContains(
  'packages/frontend/src/pages/AgentsPage.tsx',
  "/runner-filesystem/pick-folder",
  'repository picker uses runner-local endpoint',
);
assertContains(
  'packages/frontend/src/pages/AgentsPage.tsx',
  "/runner-filesystem/reveal",
  'repository reveal uses runner-local endpoint',
);

console.log('# Runner split source contract guard');
for (const item of evidence) console.log(`PASS ${item}`);

if (failures.length > 0) {
  console.log('');
  for (const failure of failures) {
    console.log(`FAIL ${failure.name}`);
    for (const match of failure.matches) console.log(`- ${match}`);
  }
  process.exitCode = 1;
} else {
  console.log('Result: PASS');
}
