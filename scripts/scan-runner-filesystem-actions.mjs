#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const directAgentDataDirHelpers = [
  'listAgentFiles',
  'readAgentFileContent',
  'writeAgentFileContent',
  'uploadAgentFile',
  'deleteAgentFile',
  'createAgentFolder',
  'createAgentReference',
  'getAgentFilePath',
  'getAgentEntryPath',
];

const patterns = [
  'browse-fs',
  'pick-folder',
  'reveal-local',
  'repositoryRoot',
  'workspacePath',
  'reveal-folder',
  'files/reveal',
  'browseFileSystem',
  'revealPathInFileManager',
];

const args = [
  '-n',
  '--no-heading',
  patterns.map((pattern) => `(${pattern})`).join('|'),
  'packages/frontend/src',
  'packages/backend/src',
  'packages/shared/src',
  'docs',
  '-g',
  '!**/dist/**',
  '-g',
  '!**/node_modules/**',
];

const result = spawnSync('rg', args, { encoding: 'utf8' });

if (result.error) {
  console.error(`Failed to run rg: ${result.error.message}`);
  process.exit(2);
}

const stdout = result.stdout.trim();
const stderr = result.stderr.trim();

if (stderr) console.error(stderr);

const lines = stdout ? stdout.split('\n') : [];
const directHelperPattern = new RegExp(`\\b(${directAgentDataDirHelpers.join('|')})\\b`);
const directHelperSearch = spawnSync(
  'rg',
  [
    '-n',
    '--no-heading',
    directAgentDataDirHelpers.map((helper) => `(${helper})`).join('|'),
    'packages/backend/src/routes',
    'packages/backend/src/services',
    '-g',
    '!**/*.test.ts',
    '-g',
    '!**/*.contract.test.ts',
  ],
  { encoding: 'utf8' },
);

if (directHelperSearch.error) {
  console.error(`Failed to run direct agent helper guard: ${directHelperSearch.error.message}`);
  process.exit(2);
}

const directHelperLines = directHelperSearch.stdout.trim()
  ? directHelperSearch.stdout.trim().split('\n')
  : [];
const agentServiceSource = fs.readFileSync('packages/backend/src/services/agents.ts', 'utf8');
const exportedDirectHelpers = directAgentDataDirHelpers.filter((helper) =>
  new RegExp(`export\\s+(?:async\\s+)?function\\s+${helper}\\b`).test(agentServiceSource),
);

const prohibitedHostedEndpointLines = lines.filter((line) =>
  /packages\/frontend\/src/.test(line) &&
  /\/storage\/(browse-fs|pick-folder|reveal-local)|\/agents\/.*files\/reveal|\/agents\/.*reveal-folder/.test(line),
);

console.log('# Runner filesystem action scan');
console.log(`Total matches: ${lines.length}`);
console.log(`Hosted runner-local endpoint calls requiring gating/replacement: ${prohibitedHostedEndpointLines.length}`);
console.log(`Backend direct agent DATA_DIR helper references: ${directHelperLines.length}`);
console.log(`Direct agent DATA_DIR helper exports from services/agents.ts: ${exportedDirectHelpers.length}`);

if (prohibitedHostedEndpointLines.length > 0) {
  console.log('\n## Calls that must not remain ungated in hosted runner-local surfaces');
  for (const line of prohibitedHostedEndpointLines) {
    console.log(line);
  }
}

if (lines.length > 0) {
  console.log('\n## Full match list');
  for (const line of lines) {
    console.log(line);
  }
}

if (directHelperLines.length > 0) {
  console.log('\n## Direct agent DATA_DIR helpers are prohibited in hosted route/service code');
  for (const line of directHelperLines) {
    if (directHelperPattern.test(line)) console.log(line);
  }
}

if (exportedDirectHelpers.length > 0) {
  console.log('\n## Direct agent DATA_DIR helpers must not be exported from services/agents.ts');
  for (const helper of exportedDirectHelpers) {
    console.log(helper);
  }
}

if (directHelperLines.length > 0 || exportedDirectHelpers.length > 0) {
  process.exit(1);
}

process.exit(result.status === 1 ? 0 : result.status ?? 0);
