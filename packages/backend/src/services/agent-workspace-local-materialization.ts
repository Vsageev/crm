import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import {
  assertSafeConversationWorkspaceId,
  renderConversationInstructionMarkdown,
} from './agent-workspaces.js';

const CONVERSATION_CONTEXT_DIRECTORIES: ReadonlyArray<string> = ['skills', 'docs', 'memory'];

type ConversationContextEntry = {
  linkName: string;
  sourceName: string;
  kind: 'symlink' | 'materialized-file';
};

function listConversationContextEntries(agentWorkspaceRoot: string): ConversationContextEntry[] {
  const root = path.resolve(agentWorkspaceRoot);
  const entries: ConversationContextEntry[] = [];

  for (const dirName of CONVERSATION_CONTEXT_DIRECTORIES) {
    if (fs.existsSync(path.join(root, dirName))) {
      entries.push({ linkName: dirName, sourceName: dirName, kind: 'symlink' });
    }
  }

  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return entries;
  }

  for (const name of names) {
    if (!/\.md$/i.test(name)) continue;
    const sourcePath = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(sourcePath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    entries.push({ linkName: name, sourceName: name, kind: 'materialized-file' });
  }

  return entries;
}

function symlinkTargetsMatch(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  return path.normalize(actual) === path.normalize(expected);
}

function pathExistsAsEntry(linkPath: string): boolean {
  try {
    fs.lstatSync(linkPath);
    return true;
  } catch {
    return false;
  }
}

function ensureConversationMaterializedFile(
  sourcePath: string,
  destinationPath: string,
  conversationDir: string,
): void {
  const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
  const renderedContent = renderConversationInstructionMarkdown(sourceContent, conversationDir);

  if (pathExistsAsEntry(destinationPath)) {
    const stat = fs.lstatSync(destinationPath);
    if (stat.isDirectory()) return;
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(destinationPath);
    } else if (stat.isFile()) {
      const existingContent = fs.readFileSync(destinationPath, 'utf-8');
      if (existingContent === renderedContent) return;
    } else {
      return;
    }
  }

  fs.writeFileSync(destinationPath, renderedContent, 'utf-8');
}

/**
 * Development-only same-host compatibility for revealing old backend-local conversation
 * folders. Hosted chat enqueue/repair/reveal must prepare runner-local folders instead.
 */
export function ensureBackendLocalConversationSubfolderWorkspace(
  agentWorkspaceRoot: string,
  executionRoot: string,
  conversationId: string,
): void {
  if (env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM !== true) {
    throw new Error(
      'Backend-local conversation workspace materialization is disabled in hosted mode. Use runner prepare-conversation-workspace instead.',
    );
  }

  assertSafeConversationWorkspaceId(conversationId);
  const contextRoot = path.resolve(agentWorkspaceRoot);
  const root = path.resolve(executionRoot);
  const convDir = path.join(root, 'conversations', conversationId);
  fs.mkdirSync(convDir, { recursive: true });

  for (const { linkName, sourceName, kind } of listConversationContextEntries(contextRoot)) {
    const sourcePath = path.join(contextRoot, sourceName);
    const linkPath = path.join(convDir, linkName);
    if (kind === 'materialized-file') {
      ensureConversationMaterializedFile(sourcePath, linkPath, convDir);
      continue;
    }
    const relativeTarget = path.relative(convDir, sourcePath) || '.';
    if (pathExistsAsEntry(linkPath)) {
      let st: fs.Stats;
      try {
        st = fs.lstatSync(linkPath);
      } catch {
        continue;
      }
      if (!st.isSymbolicLink()) continue;

      try {
        const current = fs.readlinkSync(linkPath);
        if (symlinkTargetsMatch(current, relativeTarget)) continue;
      } catch {
        /* broken symlink; replace below */
      }
      fs.unlinkSync(linkPath);
    }

    fs.symlinkSync(relativeTarget, linkPath);
  }
}
