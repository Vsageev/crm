import path from 'node:path';
import { env } from '../config/env.js';
import { store } from '../db/index.js';

const AGENTS_DIR = path.resolve(env.DATA_DIR, 'agents');
const AGENT_WORKSPACE_SEGMENTS = ['.openwork', 'agents'] as const;

export function getLegacyAgentsDir(): string {
  return AGENTS_DIR;
}

export function getLegacyAgentWorkspacePath(agentId: string): string {
  return path.join(AGENTS_DIR, agentId);
}

export function slugifyAgentWorkspaceName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'agent'
  );
}

export function normalizeRepositoryRoot(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function deriveAgentWorkspacePath(repositoryRoot: string, agentName: string): string {
  return path.join(
    normalizeRepositoryRoot(repositoryRoot) ?? path.resolve(repositoryRoot),
    ...AGENT_WORKSPACE_SEGMENTS,
    slugifyAgentWorkspaceName(agentName),
  );
}

export type RepositoryRootOrigin = 'runner_local' | 'backend_local_legacy' | 'unknown';

export function normalizeRepositoryRootOrigin(input: unknown): RepositoryRootOrigin | null {
  return input === 'runner_local' || input === 'backend_local_legacy' || input === 'unknown'
    ? input
    : null;
}

export function isRepositoryRootRunnerVerified(agent: Record<string, unknown> | null | undefined): boolean {
  if (!agent?.repositoryRoot) return false;
  return (
    normalizeRepositoryRootOrigin(agent.repositoryRootOrigin) === 'runner_local' &&
    typeof agent.repositoryRootRunnerId === 'string' &&
    agent.repositoryRootRunnerId.trim().length > 0 &&
    (typeof agent.repositoryRootVerifiedAt === 'string' ||
      agent.repositoryRootVerifiedAt instanceof Date) &&
    agent.repositoryRootRepairRequired !== true
  );
}

export function resolveAgentWorkspacePathFromRecord(
  agent: Record<string, unknown> | null | undefined,
  fallbackAgentId?: string,
): string {
  const pathMetadata = getAgentWorkspacePathMetadataFromRecord(agent);
  if (pathMetadata) return pathMetadata;

  const agentId =
    fallbackAgentId ??
    (typeof agent?.id === 'string' && agent.id.trim() ? agent.id.trim() : null);
  throw new Error(
    agentId
      ? `Agent ${agentId} does not have a backend executable workspace path; runner workspace readiness is required`
      : 'Agent does not have a backend executable workspace path; runner workspace readiness is required',
  );
}

export function getAgentWorkspacePathMetadataFromRecord(
  agent: Record<string, unknown> | null | undefined,
): string | null {
  const repositoryRoot =
    typeof agent?.repositoryRoot === 'string' && agent.repositoryRoot.trim()
      ? normalizeRepositoryRoot(agent.repositoryRoot)
      : null;
  if (repositoryRoot && typeof agent?.name === 'string' && agent.name.trim()) {
    return deriveAgentWorkspacePath(repositoryRoot, agent.name);
  }

  return null;
}

export function resolveAgentExecutionRootFromRecord(
  agent: Record<string, unknown> | null | undefined,
  fallbackAgentId?: string,
): string {
  const repositoryRoot =
    typeof agent?.repositoryRoot === 'string' && agent.repositoryRoot.trim()
      ? normalizeRepositoryRoot(agent.repositoryRoot)
      : null;
  if (repositoryRoot) return repositoryRoot;
  return resolveAgentWorkspacePathFromRecord(agent, fallbackAgentId);
}

export function resolveAgentWorkspacePath(agentId: string): string {
  const agent = store.getById('agents', agentId);
  if (!agent) {
    throw new Error('Agent not found');
  }

  return resolveAgentWorkspacePathFromRecord(agent, agentId);
}

export function resolveAgentExecutionRoot(agentId: string): string {
  const agent = store.getById('agents', agentId);
  if (!agent) {
    throw new Error('Agent not found');
  }

  return resolveAgentExecutionRootFromRecord(agent, agentId);
}

const CONVERSATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertSafeConversationWorkspaceId(conversationId: string): void {
  if (!CONVERSATION_ID_RE.test(conversationId)) {
    throw new Error('Invalid conversation id for workspace path');
  }
}

function formatInstructionDirectory(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}

export function renderConversationInstructionMarkdown(
  sourceContent: string,
  conversationDir: string,
): string {
  const cwd = formatInstructionDirectory(conversationDir);
  let rendered = sourceContent;

  rendered = rendered.replace(
    /^- The project repository root is `[^`]+`\.\n- Use other paths only if the task requires it; ask first when avoidable\.\s*$/m,
    [
      `- The working directory for this conversation is \`${cwd}\`. Work in this folder by default for commands and file operations.`,
      '- Use other paths only if the task requires it; ask first when avoidable.',
    ].join('\n'),
  );

  rendered = rendered.replace(
    /^- The project repository root is `[^`]+`\.\s*$/m,
    `- The working directory for this conversation is \`${cwd}\`. Work in this folder by default for commands and file operations.`,
  );

  rendered = rendered.replace(
    /^Default workspace behavior:\s*- Work in `[^`]+` by default for commands and file operations\.\s*$/m,
    `Default workspace behavior: - Work in \`${cwd}\` by default for commands and file operations.`,
  );

  return rendered;
}

export type AgentConversationWorkspaceMode = 'shared' | 'subfolder';

/**
 * Resolves the CLI working directory for an agent chat run. Shared mode uses the chosen
 * execution root; subfolder mode uses `workspaceRelativePath` or `conversations/<id>/`.
 */
export function resolveSubfolderProcessCwd(
  executionRoot: string,
  conversationId: string,
  workspaceMode: AgentConversationWorkspaceMode,
  workspaceRelativePath?: string,
): string {
  const root = path.resolve(executionRoot);
  if (workspaceMode !== 'subfolder') return root;
  assertSafeConversationWorkspaceId(conversationId);
  const rel =
    typeof workspaceRelativePath === 'string' && workspaceRelativePath.trim()
      ? workspaceRelativePath.trim()
      : `conversations/${conversationId}`;
  const resolved = path.resolve(root, rel);
  const expected = path.resolve(root, 'conversations', conversationId);
  if (resolved !== expected) return expected;
  return resolved;
}
