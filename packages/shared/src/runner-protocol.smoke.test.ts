import { describe, expect, it } from 'vitest';
import {
  RUNNER_PROTOCOL_VERSION,
  parseRunnerJobIntent,
  parseRunnerServerMessage,
  parseServerRunnerMessage,
  type RunnerJobIntent,
  type RunnerWorkspaceSetupIntent,
} from './runner-protocol.js';

function baseJob(provider: RunnerJobIntent['provider']): RunnerJobIntent {
  return {
    runId: 'qa-smoke-run-1',
    agentId: 'qa-smoke-agent-1',
    provider,
    modelPreference: {
      displayName: provider,
      modelId: `${provider}-model`,
      thinkingLevel: null,
    },
    prompt: 'qa runner protocol smoke',
    workspace: {
      type: 'local_path',
      path: process.cwd(),
      workspaceId: 'qa-smoke-workspace-1',
    },
    allowedOperations: {
      tools: [provider],
      approvalMode: 'never',
      env: false,
      secrets: false,
      network: false,
      shell: false,
    },
  };
}

function hasBackendStoragePath(value: unknown): boolean {
  if (typeof value === 'string') {
    return /(?:^|\/)(?:data|DATA_DIR)\/(?:storage|agents|agent-runs)(?:\/|$)/.test(value);
  }
  if (Array.isArray(value)) return value.some(hasBackendStoragePath);
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasBackendStoragePath);
  }
  return false;
}

describe('runner protocol smoke', () => {
  it('accepts the current server-to-runner job offer shape', () => {
    const job = {
      ...baseJob('codex'),
      attachments: [
        {
          type: 'file' as const,
          path: '/tmp/context.txt',
          filename: 'context.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          textExtraction: {
            status: 'available' as const,
            textPath: '/tmp/context.txt',
            charCount: 12,
            truncated: false,
          },
          manifest: { storagePath: '/chat-uploads/context.txt' },
        },
      ],
    };
    expect(parseRunnerJobIntent(job)).toMatchObject({
      runId: 'qa-smoke-run-1',
      provider: 'codex',
      attachments: [
        {
          filename: 'context.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          textExtraction: { status: 'available' },
          manifest: { storagePath: '/chat-uploads/context.txt' },
        },
      ],
    });
    expect(
      parseServerRunnerMessage({
        type: 'job_offer',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        jobId: 'qa-smoke-job-1',
        job,
      }),
    ).toMatchObject({ type: 'job_offer', jobId: 'qa-smoke-job-1' });
  });

  it('locks the native runner job intent env/path fixture', () => {
    const job: RunnerJobIntent = {
      ...baseJob('codex'),
      runId: 'qa-native-contract-run',
      workspace: {
        type: 'local_path',
        path: '/runner/workspaces/openwork-agent',
        workspaceId: 'qa-native-workspace',
      },
      allowedOperations: {
        tools: ['codex'],
        approvalMode: 'dangerous',
        env: true,
        secrets: true,
        network: true,
        shell: true,
      },
      environment: {
        variables: [
          {
            name: 'WORKSPACE_API_URL',
            value: 'https://openwork.example.test',
            source: 'workspace_api',
            secret: false,
          },
          {
            name: 'WORKSPACE_API_KEY',
            value: 'workspace-key-redacted',
            source: 'workspace_api',
            secret: true,
          },
          {
            name: 'PROJECTS_DIR',
            value: '/runner/workspaces/openwork-agent/projects',
            source: 'runtime',
            secret: false,
          },
          {
            name: 'PROJECT_PORT',
            value: '4173',
            source: 'runtime',
            secret: false,
          },
          {
            name: 'OPENAI_API_KEY',
            value: 'provider-key-redacted',
            source: 'agent_env',
            secret: true,
          },
        ],
      },
      attachments: [
        {
          type: 'file',
          path: '/runner/workspaces/openwork-agent/.openwork/attachments/context.txt',
          filename: 'context.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          textExtraction: {
            status: 'available',
            textPath: '/runner/workspaces/openwork-agent/.openwork/attachments/context.txt',
            charCount: 12,
            truncated: false,
          },
          manifest: {
            storagePath: 'chat-uploads/qa-native/context.txt',
            materialization: 'runner_local_required',
          },
        },
      ],
    };

    expect(parseRunnerJobIntent(job)).toStrictEqual(job);
    expect(parseServerRunnerMessage({
      type: 'job_offer',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'qa-native-contract-job',
      job,
    })).toStrictEqual({
      type: 'job_offer',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'qa-native-contract-job',
      job,
    });
  });

  it('locks the staged attachment/context fixture without backend storage paths', () => {
    const runnerWorkspaceRoot = '/runner/workspaces/openwork-agent';
    const job: RunnerJobIntent = {
      ...baseJob('codex'),
      runId: 'qa-native-staging-run',
      workspace: {
        type: 'local_path',
        path: runnerWorkspaceRoot,
        workspaceId: 'qa-native-workspace',
      },
      attachments: [
        {
          type: 'file',
          path: `${runnerWorkspaceRoot}/.openwork/staging/jobs/qa-native-staging-run/attachments/context.txt`,
          filename: 'context.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          textExtraction: {
            status: 'available',
            textPath: `${runnerWorkspaceRoot}/.openwork/staging/jobs/qa-native-staging-run/attachments/context.txt`,
            charCount: 12,
            truncated: false,
          },
          manifest: {
            transfer: 'runner_staged_manifest',
            storageId: 'chat-uploads/qa-native/context.txt',
            storagePath: 'chat-uploads/qa-native/context.txt',
            download: {
              type: 'api',
              path: '/api/storage/download',
              query: { path: '/chat-uploads/qa-native/context.txt' },
              auth: 'runner_job_scoped',
            },
            sha256: '0'.repeat(64),
            stagedRelativePath: 'attachments/context.txt',
            agentContext: {
              revision: 'ctx-rev-1',
              root: '.openwork/agent-context/qa-smoke-agent-1/ctx-rev-1',
              files: ['AGENTS.md', 'skills/session-start/index.md', 'memory.md'],
            },
          },
        },
      ],
    };

    expect(parseRunnerJobIntent(job)).toStrictEqual(job);
    expect(hasBackendStoragePath(job)).toBe(false);

    const backendPathJob: RunnerJobIntent = {
      ...job,
      attachments: [
        {
          ...job.attachments![0],
          path: '/srv/openwork/data/storage/chat-uploads/qa-native/context.txt',
          textExtraction: {
            ...job.attachments![0].textExtraction,
            textPath: '/srv/openwork/data/storage/chat-uploads/qa-native/context.txt',
          },
        },
      ],
    };
    expect(hasBackendStoragePath(backendPathJob)).toBe(true);
  });

  it('rejects workspace materialization on ordinary job offers', () => {
    const job = {
      ...baseJob('codex'),
      runId: 'qa-no-repository-run',
      workspace: {
        type: 'local_path',
        path: '/runner/workspaces/openwork/.openwork/no-repository-agents/qa-smoke-agent-1/workspace',
        workspaceId: 'qa-native-workspace',
        materialization: {
          strategy: 'runner_local_agent_workspace',
          cleanup: 'managed_files',
          agentContext: {
            revision: 'ctx-rev-1',
            files: [
              { path: 'AGENTS.md', content: '# Instructions\n' },
              { path: 'skills/session-start/index.md', content: '# Session Start\n' },
              { path: 'memory/notes.md', content: '# Notes\n' },
            ],
          },
        },
      },
    } as unknown as RunnerJobIntent;

    expect(parseRunnerJobIntent(job)).toBeNull();
    expect(
      parseServerRunnerMessage({
        type: 'job_offer',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        jobId: 'job-with-materialization',
        job,
      }),
    ).toBeNull();
    expect(hasBackendStoragePath(job.workspace.path)).toBe(false);
  });

  it('accepts named workspace setup materialization without backend paths', () => {
    const setup: RunnerWorkspaceSetupIntent = {
      setupId: 'setup-no-repository-agent',
      agentId: 'qa-smoke-agent-1',
      workspaceId: 'qa-native-workspace',
      workspace: {
        type: 'local_path',
        path: '/runner/workspaces/openwork/.openwork/no-repository-agents/qa-smoke-agent-1/workspace',
        workspaceId: 'qa-native-workspace',
      },
      materialization: {
        strategy: 'runner_local_agent_workspace',
        cleanup: 'managed_files',
        agentContext: {
          revision: 'ctx-rev-1',
          files: [
            { path: 'AGENTS.md', content: '# Instructions\n' },
            { path: 'skills/session-start/index.md', content: '# Session Start\n' },
            { path: 'memory/notes.md', content: '# Notes\n' },
          ],
        },
      },
    };

    expect(
      parseServerRunnerMessage({
        type: 'workspace_setup',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        setupId: setup.setupId,
        setup,
      }),
    ).toStrictEqual({
      type: 'workspace_setup',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      setupId: setup.setupId,
      setup,
    });
    expect(hasBackendStoragePath(setup.workspace.path)).toBe(false);
  });

  it('accepts explicit no-repository workspace prepare filesystem messages', () => {
    const request = {
      type: 'filesystem_request',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: 'prepare-workspace-request',
      request: {
        action: 'prepare_workspace',
        path: '/runner/workspaces/openwork/.openwork/no-repository-agents/qa-smoke-agent-1/workspace',
        purpose: 'no_repository_agent',
        agentId: 'qa-smoke-agent-1',
        workspaceId: 'qa-native-workspace',
      },
    };

    expect(parseServerRunnerMessage(request)).toStrictEqual(request);
    expect(
      parseRunnerServerMessage({
        type: 'filesystem_response',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        requestId: 'prepare-workspace-request',
        ok: true,
        result: {
          action: 'prepare_workspace',
          path: request.request.path,
          workspaceRoot: '/runner/workspaces/openwork',
          status: 'ready',
          preparedAt: '2026-05-23T10:00:00.000Z',
        },
      }),
    ).toStrictEqual({
      type: 'filesystem_response',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: 'prepare-workspace-request',
      ok: true,
      result: {
        action: 'prepare_workspace',
        path: request.request.path,
        workspaceRoot: '/runner/workspaces/openwork',
        status: 'ready',
        preparedAt: '2026-05-23T10:00:00.000Z',
      },
    });
  });

  it('accepts explicit conversation subfolder prepare filesystem messages', () => {
    const request = {
      type: 'filesystem_request',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: 'prepare-conversation-workspace-request',
      request: {
        action: 'prepare_workspace',
        path: '/runner/workspaces/openwork/repo/conversations/qa-conversation-1',
        purpose: 'conversation_subfolder',
        agentId: 'qa-smoke-agent-1',
        conversationId: 'qa-conversation-1',
        workspaceId: 'qa-native-workspace',
      },
    };

    expect(parseServerRunnerMessage(request)).toStrictEqual(request);
  });

  it('accepts explicit attachment import filesystem messages', () => {
    const request = {
      type: 'filesystem_request',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: 'import-attachment-request',
      request: {
        action: 'import_attachment',
        destinationPath: '/runner/workspaces/openwork/imports/spec.txt',
        overwrite: true,
        source: {
          filename: 'spec.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          sha256: 'abc123',
          storageId: '/chat-uploads/spec.txt',
          storagePath: '/chat-uploads/spec.txt',
          download: {
            method: 'GET',
            path: '/api/runner-attachments/download?itemId=attachment-1&path=x&token=x',
          },
        },
      },
    };

    expect(parseServerRunnerMessage(request)).toStrictEqual(request);
    expect(
      parseRunnerServerMessage({
        type: 'filesystem_response',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        requestId: 'import-attachment-request',
        ok: true,
        result: {
          action: 'import_attachment',
          path: '/runner/workspaces/openwork/imports/spec.txt',
          sizeBytes: 12,
          sha256: 'abc123',
          importedAt: '2026-05-23T10:00:00.000Z',
        },
      }),
    ).toMatchObject({
      type: 'filesystem_response',
      requestId: 'import-attachment-request',
      ok: true,
      result: {
        action: 'import_attachment',
        path: '/runner/workspaces/openwork/imports/spec.txt',
      },
    });
  });

  it('accepts explicit runner-owned no-repository agent file messages', () => {
    const workspacePath =
      '/runner/workspaces/openwork/.openwork/no-repository-agents/qa-smoke-agent-1/workspace';
    const writeRequest = {
      type: 'filesystem_request',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: 'write-agent-file-request',
      request: {
        action: 'write_agent_file',
        workspacePath,
        path: '/AGENTS.md',
        content: 'runner-owned instructions\n',
        encoding: 'utf8',
      },
    };
    const importRequest = {
      type: 'filesystem_request',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: 'import-agent-files-request',
      request: {
        action: 'import_agent_files',
        workspacePath,
        files: [
          {
            path: '/skills/session-start/index.md',
            contentBase64: Buffer.from('skill body\n').toString('base64'),
            sizeBytes: 11,
          },
        ],
      },
    };

    expect(parseServerRunnerMessage(writeRequest)).toStrictEqual(writeRequest);
    expect(parseServerRunnerMessage(importRequest)).toStrictEqual(importRequest);
    expect(
      parseRunnerServerMessage({
        type: 'filesystem_response',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        requestId: 'list-agent-files-request',
        ok: true,
        result: {
          action: 'list_agent_files',
          workspacePath,
          path: '/',
          entries: [
            {
              name: 'AGENTS.md',
              path: '/AGENTS.md',
              type: 'file',
              size: 26,
              createdAt: '2026-05-23T10:00:00.000Z',
            },
          ],
        },
      }),
    ).toMatchObject({
      type: 'filesystem_response',
      ok: true,
      result: { action: 'list_agent_files', path: '/' },
    });
  });

  it('accepts runner lifecycle messages and rejects malformed payloads', () => {
    expect(
      parseRunnerServerMessage({
        type: 'runner_hello',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        runnerId: 'qa-smoke-runner-1',
        name: 'qa smoke runner',
        capabilities: {
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          os: 'darwin',
          arch: 'arm64',
          runnerVersion: '0.0.0-smoke',
          supportedProviders: ['codex'],
          supportsCancellation: true,
          supportsArtifacts: false,
          policy: {
            workspaceRootRequired: true,
            allowedTools: ['codex'],
            approvalModes: ['never'],
            envAccess: false,
            secretAccess: false,
            network: false,
            shell: false,
          },
        },
      }),
    ).toMatchObject({ type: 'runner_hello', runnerId: 'qa-smoke-runner-1' });
    expect(
      parseRunnerServerMessage({
        type: 'runner_heartbeat',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        runnerId: 'qa-smoke-runner-1',
        name: 'qa smoke runner',
        capabilities: {
          protocolVersion: RUNNER_PROTOCOL_VERSION,
          os: 'darwin',
          arch: 'arm64',
          runnerVersion: '0.0.0-smoke',
          installedProviders: ['codex'],
          supportedProviders: ['codex'],
          supportedTools: ['codex'],
          approvalModes: ['never'],
          workspaceModes: ['shared', 'subfolder'],
          concurrency: { activeJobs: 0, maxJobs: null },
          supportsCancellation: true,
          supportsArtifacts: false,
          supportsFilesystem: true,
          filesystemOperations: ['browse', 'validate_repository_root'],
          policy: {
            workspaceRootRequired: true,
            allowedTools: ['codex'],
            approvalModes: ['never'],
            envAccess: false,
            secretAccess: false,
            network: false,
            shell: false,
          },
        },
      }),
    ).toMatchObject({
      type: 'runner_heartbeat',
      capabilities: {
        installedProviders: ['codex'],
        workspaceModes: ['shared', 'subfolder'],
        concurrency: { activeJobs: 0 },
        filesystemOperations: ['browse', 'validate_repository_root'],
      },
    });

    expect(
      parseServerRunnerMessage({ type: 'job_offer', protocolVersion: RUNNER_PROTOCOL_VERSION }),
    ).toBeNull();
    expect(parseRunnerJobIntent({ ...baseJob('codex'), provider: 42 })).toBeNull();
    expect(
      parseRunnerJobIntent({
        ...baseJob('codex'),
        attachments: [{ type: 'file', path: '/tmp/shallow.txt' }],
      }),
    ).toBeNull();
  });

  it('accepts every runner→server protocol message shape for the current protocol version', () => {
    const base = {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'job-1',
      runId: 'run-1',
    };
    expect(parseRunnerServerMessage({ type: 'job_accepted', ...base })).toMatchObject({ type: 'job_accepted' });
    expect(
      parseRunnerServerMessage({
        type: 'job_rejected',
        ...base,
        code: 'unsupported_provider',
        message: 'no codex',
      }),
    ).toMatchObject({ type: 'job_rejected', code: 'unsupported_provider' });
    expect(
      parseRunnerServerMessage({
        type: 'output_event',
        ...base,
        stream: 'stdout',
        text: 'chunk',
      }),
    ).toMatchObject({ type: 'output_event', stream: 'stdout' });
    expect(
      parseRunnerServerMessage({
        type: 'output_event',
        ...base,
        stream: 'stderr',
        text: 'err',
      }),
    ).toMatchObject({ type: 'output_event', stream: 'stderr' });
    expect(
      parseRunnerServerMessage({
        type: 'final_message',
        ...base,
        text: 'done',
      }),
    ).toMatchObject({ type: 'final_message', text: 'done' });
    expect(
      parseRunnerServerMessage({
        type: 'artifact',
        ...base,
        artifact: { name: 'log', path: '/tmp/a', mimeType: 'text/plain' },
      }),
    ).toMatchObject({ type: 'artifact', artifact: { name: 'log' } });
    expect(
      parseRunnerServerMessage({
        type: 'completed',
        ...base,
        code: 0,
        stdout: '',
        stderr: '',
      }),
    ).toMatchObject({ type: 'completed', code: 0 });
    expect(
      parseRunnerServerMessage({
        type: 'failed',
        ...base,
        code: 1,
        message: 'boom',
        stdout: '',
        stderr: 'e',
      }),
    ).toMatchObject({ type: 'failed', message: 'boom' });
    expect(
      parseRunnerServerMessage({
        type: 'cancelled',
        ...base,
        message: 'user',
        stdout: '',
        stderr: '',
      }),
    ).toMatchObject({ type: 'cancelled' });
    expect(
      parseRunnerServerMessage({
        type: 'cancelled',
        ...base,
        stdout: '',
        stderr: '',
      }),
    ).toMatchObject({ type: 'cancelled' });
    expect(
      parseRunnerServerMessage({
        type: 'protocol_error',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        code: 'invalid_job',
        message: 'bad',
      }),
    ).toMatchObject({ type: 'protocol_error' });
  });

  it('rejects malformed runner→server payloads (negative control for schema validation)', () => {
    const base = {
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'job-1',
      runId: 'run-1',
    };
    expect(parseRunnerServerMessage({ ...base, type: 'job_accepted', protocolVersion: '0.0' })).toBeNull();
    expect(parseRunnerServerMessage({ type: 'job_rejected', ...base, code: 1, message: 'x' })).toBeNull();
    expect(parseRunnerServerMessage({ type: 'output_event', ...base, stream: 'stdin', text: 'x' })).toBeNull();
    expect(parseRunnerServerMessage({ type: 'final_message', ...base, text: 1 })).toBeNull();
    expect(parseRunnerServerMessage({ type: 'artifact', ...base, artifact: { name: 'n' } })).toBeNull();
    expect(parseRunnerServerMessage({ type: 'completed', ...base, code: '0', stdout: '', stderr: '' })).toBeNull();
    expect(parseRunnerServerMessage({ type: 'failed', ...base, code: 1, message: 2, stdout: '', stderr: '' })).toBeNull();
    expect(parseRunnerServerMessage({ type: 'cancelled', ...base, stdout: 1, stderr: '' })).toBeNull();
  });
});
