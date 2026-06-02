import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetById = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../db/index.js', () => ({
  store: {
    getById: (col: string, id: string) => mockGetById(col, id),
    update: (col: string, id: string, patch: Record<string, unknown>) =>
      mockUpdate(col, id, patch),
  },
}));

import {
  __agentChatTestUtils,
  buildRunnerJobIntent,
  resolveAgentChatProcessWorkingDirectory,
} from './agent-chat.js';

const AGENT_ID = '11111111-2222-3333-4444-555555555555';
const CONV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('resolveAgentChatProcessWorkingDirectory', () => {
  let tmp: string;
  let repositoryRoot: string;
  let agentRoot: string;
  let conversationMetadata: Record<string, unknown> | undefined;
  let separateFolderPerChat: boolean;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ow-chat-cwd-'));
    repositoryRoot = path.join(tmp, 'repo');
    agentRoot = path.join(repositoryRoot, '.openwork', 'agents', 'test');
    fs.mkdirSync(agentRoot, { recursive: true });
    conversationMetadata = undefined;
    separateFolderPerChat = false;

    mockGetById.mockImplementation((col: string, id: string) => {
      if (col === 'agents' && id === AGENT_ID) {
        return {
          id: AGENT_ID,
          name: 'Test',
          repositoryRoot,
          workspacePath: agentRoot,
          separateFolderPerChat,
        };
      }
      if (col === 'conversations' && id === CONV_ID) {
        return {
          id: CONV_ID,
          metadata:
            conversationMetadata === undefined ? undefined : JSON.stringify(conversationMetadata),
        };
      }
      return null;
    });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    mockGetById.mockReset();
    mockUpdate.mockReset();
  });

  it('uses repository-local agent folder when conversationId is omitted for repo-backed agents', () => {
    const cwd = resolveAgentChatProcessWorkingDirectory(AGENT_ID, undefined);
    expect(cwd).toBe(path.resolve(agentRoot));
  });

  it('uses repository-local agent folder for shared-mode conversation metadata when the toggle is disabled', () => {
    conversationMetadata = { workspaceMode: 'shared' };
    const cwd = resolveAgentChatProcessWorkingDirectory(AGENT_ID, CONV_ID);
    expect(cwd).toBe(path.resolve(agentRoot));
  });

  it('materializes an explicitly shared conversation into subfolder mode when the agent toggle is enabled', () => {
    separateFolderPerChat = true;
    conversationMetadata = { agentId: AGENT_ID, workspaceMode: 'shared' };

    const cwd = resolveAgentChatProcessWorkingDirectory(AGENT_ID, CONV_ID);

    expect(cwd).toBe(path.resolve(agentRoot, 'conversations', CONV_ID));
    const updatePatch = mockUpdate.mock.calls[0]?.[2] as { metadata?: string };
    expect(JSON.parse(updatePatch.metadata ?? '{}')).toMatchObject({
      agentId: AGENT_ID,
      workspaceMode: 'subfolder',
      workspaceRelativePath: `conversations/${CONV_ID}`,
      workspaceSeedMode: 'symlink',
    });
  });

  it('uses conversation subfolder cwd without creating backend files in hosted mode', () => {
    fs.writeFileSync(
      path.join(agentRoot, 'CLAUDE.MD'),
      'Default workspace behavior: - Work in `/tmp/original/` by default for commands and file operations.\n',
      'utf-8',
    );
    fs.mkdirSync(path.join(agentRoot, 'skills'));
    fs.writeFileSync(path.join(agentRoot, 'skills', 'x.md'), 'skill', 'utf-8');

    conversationMetadata = {
      workspaceMode: 'subfolder',
      workspaceRelativePath: `conversations/${CONV_ID}`,
    };

    const cwd = resolveAgentChatProcessWorkingDirectory(AGENT_ID, CONV_ID);
    const expected = path.resolve(agentRoot, 'conversations', CONV_ID);
    expect(cwd).toBe(expected);
    expect(cwd.startsWith(path.resolve(repositoryRoot))).toBe(true);
    expect(cwd.startsWith(path.resolve(agentRoot))).toBe(true);
    expect(cwd).not.toBe(path.resolve(agentRoot));

    expect(fs.existsSync(cwd)).toBe(false);
  });

  it('defaults subfolder relative path to conversations/<id> when metadata omits workspaceRelativePath', () => {
    conversationMetadata = { workspaceMode: 'subfolder' };

    const cwd = resolveAgentChatProcessWorkingDirectory(AGENT_ID, CONV_ID);
    expect(cwd).toBe(path.resolve(agentRoot, 'conversations', CONV_ID));
  });

  it('materializes a legacy conversation into subfolder mode when the agent toggle is enabled', () => {
    separateFolderPerChat = true;
    conversationMetadata = { agentId: AGENT_ID, activeBranches: { root: 'message-id' } };

    const cwd = resolveAgentChatProcessWorkingDirectory(AGENT_ID, CONV_ID);

    expect(cwd).toBe(path.resolve(agentRoot, 'conversations', CONV_ID));
    expect(mockUpdate).toHaveBeenCalledWith(
      'conversations',
      CONV_ID,
      expect.objectContaining({
        metadata: expect.stringContaining('"workspaceMode":"subfolder"'),
      }),
    );
    const updatePatch = mockUpdate.mock.calls[0]?.[2] as { metadata?: string };
    expect(JSON.parse(updatePatch.metadata ?? '{}')).toMatchObject({
      agentId: AGENT_ID,
      activeBranches: { root: 'message-id' },
      workspaceMode: 'subfolder',
      workspaceRelativePath: `conversations/${CONV_ID}`,
      workspaceSeedMode: 'symlink',
    });
  });

  it('builds runner-local conversation cwd without creating backend subfolders or file materialization', () => {
    const hostedBackendRepo = path.join(tmp, 'hosted-backend-repo');
    const runnerRepo = path.join(tmp, 'runner-root', 'repo');
    const backendConversationDir = path.join(hostedBackendRepo, 'conversations', CONV_ID);
    separateFolderPerChat = true;
    conversationMetadata = { agentId: AGENT_ID, activeBranches: { root: 'message-id' } };
    mockGetById.mockImplementation((col: string, id: string) => {
      if (col === 'agents' && id === AGENT_ID) {
        return {
          id: AGENT_ID,
          name: 'Test',
          repositoryRoot: runnerRepo,
          workspacePath: path.join(hostedBackendRepo, '.openwork', 'agents', 'test'),
          separateFolderPerChat,
        };
      }
      if (col === 'conversations' && id === CONV_ID) {
        return {
          id: CONV_ID,
          metadata:
            conversationMetadata === undefined ? undefined : JSON.stringify(conversationMetadata),
        };
      }
      return null;
    });

    const result = __agentChatTestUtils.buildConversationWorkspace({
      agentId: AGENT_ID,
      agent: {
        id: AGENT_ID,
        name: 'Test',
        repositoryRoot: runnerRepo,
        workspacePath: path.join(runnerRepo, '.openwork', 'agents', 'test'),
        separateFolderPerChat,
      },
      conversationId: CONV_ID,
    });

    expect(result.workDir).toBe(
      path.join(runnerRepo, '.openwork', 'agents', 'test', 'conversations', CONV_ID),
    );
    expect(result).not.toHaveProperty('materialization');
    expect(fs.existsSync(backendConversationDir)).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(
      'conversations',
      CONV_ID,
      expect.objectContaining({
        metadata: expect.stringContaining('"workspaceMode":"subfolder"'),
      }),
    );
  });

  it('does not treat legacy workspacePath as a backend executable no-repository cwd', () => {
    mockGetById.mockImplementation((col: string, id: string) => {
      if (col === 'agents' && id === AGENT_ID) {
        return {
          id: AGENT_ID,
          name: 'Test',
          repositoryRoot: null,
          workspacePath: agentRoot,
          separateFolderPerChat,
        };
      }
      if (col === 'conversations' && id === CONV_ID) {
        return {
          id: CONV_ID,
          metadata:
            conversationMetadata === undefined ? undefined : JSON.stringify(conversationMetadata),
        };
      }
      return null;
    });

    expect(() => resolveAgentChatProcessWorkingDirectory(AGENT_ID, undefined)).toThrow(
      'runner workspace readiness is required',
    );
  });

  it('uses runner inventory workspaceRootPath as repository-backed remote job cwd', () => {
    const runnerRepo = path.join(tmp, 'runner-root', 'repo');
    const runnerAgentRoot = path.join(runnerRepo, '.openwork', 'agents', 'test');

    const result = __agentChatTestUtils.resolveRunnerOwnedAgentWorkspace({
      agentId: AGENT_ID,
      agent: {
        id: AGENT_ID,
        name: 'Test',
        repositoryRoot: runnerRepo,
      },
      capabilities: {
        agentInventory: {
          advertisedAt: new Date().toISOString(),
          ttlMs: 60_000,
          agents: [
            {
              agentId: AGENT_ID,
              readiness: 'ready',
              workspaceRootPath: runnerAgentRoot,
              repositoryRootPath: runnerRepo,
            },
          ],
        },
      },
    });

    expect(result.executionRoot).toBe(runnerAgentRoot);
    expect(result.workDir).toBe(runnerAgentRoot);
  });

  it('uses runner inventory workspaceRootPath as repository-backed conversation cwd', () => {
    const runnerRepo = path.join(tmp, 'runner-root', 'repo');
    const runnerAgentRoot = path.join(runnerRepo, '.openwork', 'agents', 'test');

    const result = __agentChatTestUtils.resolveRunnerOwnedAgentWorkspace({
      agentId: AGENT_ID,
      agent: {
        id: AGENT_ID,
        name: 'Test',
        repositoryRoot: runnerRepo,
      },
      capabilities: {
        agentInventory: {
          advertisedAt: new Date().toISOString(),
          ttlMs: 60_000,
          agents: [
            {
              agentId: AGENT_ID,
              readiness: 'ready',
              workspaceRootPath: runnerAgentRoot,
              repositoryRootPath: runnerRepo,
            },
          ],
        },
      },
      conversationId: CONV_ID,
      conversationWorkspaceMode: 'subfolder',
      conversationWorkspaceRelativePath: `conversations/${CONV_ID}`,
    });

    expect(result.executionRoot).toBe(runnerAgentRoot);
    expect(result.workDir).toBe(path.join(runnerAgentRoot, 'conversations', CONV_ID));
  });
});

describe('buildRunnerJobIntent', () => {
  it('wraps backend run data in the protocol intent expected by remote dispatch', () => {
    const intent = buildRunnerJobIntent({
      runId: 'run-1',
      agentId: AGENT_ID,
      workspaceId: 'workspace-1',
      agent: {
        name: 'Test',
        model: 'codex',
        modelId: 'gpt-5.5',
        thinkingLevel: 'low',
        apiKeyId: 'key-1',
        workspaceApiKey: 'workspace-key',
      },
      prompt: 'hello',
      workDir: '/tmp/openwork-test',
      childEnv: {
        PROJECT_PORT: '4321',
        EMPTY: undefined,
      },
      imagePaths: ['/tmp/image.png'],
      filePaths: ['/tmp/context.txt'],
    });

    expect(intent).toMatchObject({
      runId: 'run-1',
      agentId: AGENT_ID,
      provider: 'codex',
      modelPreference: {
        displayName: 'codex',
        modelId: 'gpt-5.5',
        thinkingLevel: 'low',
      },
      prompt: 'hello',
      workspace: {
        type: 'local_path',
        path: '/tmp/openwork-test',
        workspaceId: 'workspace-1',
      },
      allowedOperations: {
        tools: ['codex'],
        approvalMode: 'dangerous',
      },
    });
    expect(intent.attachments).toEqual([
      {
        type: 'image',
        path: '/tmp/image.png',
        filename: 'image.png',
        mimeType: 'image/png',
        sizeBytes: 0,
        textExtraction: { status: 'not_applicable' },
      },
      {
        type: 'file',
        path: '/tmp/context.txt',
        filename: 'context.txt',
        mimeType: 'text/plain',
        sizeBytes: 0,
        textExtraction: { status: 'available', textPath: '/tmp/context.txt' },
      },
    ]);
    expect(intent.environment?.variables).toEqual([
      {
        name: 'PROJECT_PORT',
        value: '4321',
        source: 'runtime',
        secret: true,
      },
    ]);
  });

  it('normalizes staged attachment paths to a run-scoped runner workspace manifest', () => {
    const intent = buildRunnerJobIntent({
      runId: 'run-attachment-1',
      agentId: AGENT_ID,
      workspaceId: 'workspace-1',
      agent: {
        name: 'Test',
        model: 'codex',
        modelId: null,
        thinkingLevel: null,
        apiKeyId: 'key-1',
        workspaceApiKey: null,
      },
      prompt: 'use attachment',
      workDir: '/runner/workspace',
      childEnv: {},
      attachments: [
        {
          type: 'file',
          path: '.openwork/staging/pending/attachment-1/attachments/spec.txt',
          filename: 'spec.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          textExtraction: {
            status: 'available',
            textPath: '.openwork/staging/pending/attachment-1/attachments/spec.txt',
          },
          manifest: {
            transfer: 'runner_staged_manifest',
            storageId: '/chat-uploads/spec.txt',
            storagePath: '/chat-uploads/spec.txt',
            staging: {
              id: 'attachment-1',
              kind: 'attachment',
              attachmentIndex: 0,
              filename: 'spec.txt',
              mimeType: 'text/plain',
              sizeBytes: 12,
              storageId: '/chat-uploads/spec.txt',
              storagePath: '/chat-uploads/spec.txt',
              download: {
                method: 'GET',
                path: '/api/runner-attachments/download?itemId=attachment-1&path=x&token=x',
              },
              destination: 'attachments/spec.txt',
            },
          },
        },
      ],
    });

    expect(intent.stagingManifest).toMatchObject({
      version: 1,
      root: '.openwork/staging/jobs/run-attachment-1',
      policy: {
        scope: 'runner_job_workspace',
        materialization: 'download_before_launch',
        cleanup: 'runner_managed',
      },
      attachments: [expect.objectContaining({ storageId: '/chat-uploads/spec.txt' })],
    });
    expect(intent.attachments?.[0]?.path).toBe(
      '.openwork/staging/jobs/run-attachment-1/attachments/spec.txt',
    );
    expect(JSON.stringify(intent)).not.toContain('/data/storage/');
  });

  it('omits backend-local project env values when they are not explicitly runner-scoped', () => {
    const intent = buildRunnerJobIntent({
      runId: 'run-remote-env',
      agentId: AGENT_ID,
      workspaceId: 'workspace-1',
      agent: {
        name: 'Test',
        model: 'codex',
        modelId: null,
        thinkingLevel: null,
        apiKeyId: '',
        workspaceApiKey: null,
      },
      prompt: 'hello',
      workDir: '/runner/workspace',
      childEnv: {
        PWD: '/runner/workspace',
      },
    });

    const names = intent.environment?.variables.map((variable) => variable.name) ?? [];
    expect(names).toEqual(['PWD']);
    expect(names).not.toContain('PROJECT_PORT');
    expect(names).not.toContain('PROJECTS_DIR');
  });
});
