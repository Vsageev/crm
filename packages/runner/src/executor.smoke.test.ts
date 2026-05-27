import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RUNNER_PROTOCOL_VERSION,
  type RunnerCapabilities,
  type RunnerJobIntent,
  type RunnerWorkspaceSetupIntent,
} from 'shared';
import {
  PROVIDER_BINARIES,
  createExecutionPlan,
  inferProvider,
  isPolicyFailure,
  materializeRunnerWorkspace,
  spawnDetachedExecutionPlan,
  spawnExecutionPlan,
} from './executor.js';
import { materializeStagedAttachments } from './attachment-staging.js';
import {
  handleAgentWorkspaceFileRequest,
  importAttachmentToWorkspace,
  prepareWorkspacePath,
  RunnerFilesystemError,
  validateRepositoryRoot,
} from './workspace-prepare.js';

const providers = ['claude', 'qwen', 'cursor', 'opencode'] as const;
const allProviders = ['claude', 'codex', 'qwen', 'cursor', 'opencode'] as const;
let tmpDir = '';
let originalPath = '';

function makeExecutable(name: string) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(filePath, 0o755);
}

function baseCapabilities(provider: RunnerJobIntent['provider']): RunnerCapabilities {
  return {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    os: process.platform,
    arch: process.arch,
    runnerVersion: '0.0.0-smoke',
    workspaceRoot: tmpDir,
    supportedProviders: [provider],
    supportsCancellation: true,
    supportsArtifacts: false,
    policy: {
      workspaceRootRequired: true,
      allowedTools: [provider],
      approvalModes: ['never', 'dangerous'],
      envAccess: true,
      secretAccess: false,
      network: false,
      shell: false,
    },
  };
}

function baseJob(provider: RunnerJobIntent['provider']): RunnerJobIntent {
  return {
    runId: `qa-smoke-${provider}-run`,
    agentId: 'qa-smoke-agent',
    provider,
    modelPreference: {
      displayName: provider,
      modelId: `${provider}-model`,
      thinkingLevel: provider === 'claude' ? 'medium' : null,
    },
    prompt: `qa non-codex startup smoke for ${provider}`,
    workspace: {
      type: 'local_path',
      path: tmpDir,
      workspaceId: 'qa-smoke-workspace',
    },
    allowedOperations: {
      tools: [provider],
      approvalMode: 'never',
      env: true,
      secrets: false,
      network: false,
      shell: false,
    },
    environment: {
      variables: [{ name: 'QA_SMOKE', value: provider, source: 'runtime', secret: false }],
    },
  };
}

function workspaceSetup(
  agentId: string,
  workspacePath: string,
  materialization: RunnerWorkspaceSetupIntent['materialization'],
): RunnerWorkspaceSetupIntent {
  return {
    setupId: `setup-${agentId}`,
    agentId,
    workspaceId: 'qa-smoke-workspace',
    workspace: {
      type: 'local_path',
      path: workspacePath,
      workspaceId: 'qa-smoke-workspace',
    },
    materialization,
  };
}

describe('non-Codex runner startup smoke', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-runner-smoke-'));
    originalPath = process.env.PATH ?? '';
    for (const provider of allProviders) makeExecutable(PROVIDER_BINARIES[provider]);
    process.env.PATH = `${tmpDir}${path.delimiter}${originalPath}`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.PATH = originalPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(providers)('builds an executable startup plan for %s', (provider) => {
    expect(inferProvider(`${provider}-latest`)).toBe(provider);
    const plan = createExecutionPlan(baseJob(provider), baseCapabilities(provider));

    expect(isPolicyFailure(plan)).toBe(false);
    if (isPolicyFailure(plan)) return;
    expect(plan.cwd).toBe(tmpDir);
    expect(plan.env.QA_SMOKE).toBe(provider);
    expect(plan.command.bin).toBe(path.join(tmpDir, PROVIDER_BINARIES[provider]));
    expect(plan.command.args.join(' ')).toContain('qa non-codex startup smoke');
  });

  it('writes Codex final responses to a runner-owned last-message file', () => {
    const plan = createExecutionPlan(baseJob('codex'), baseCapabilities('codex'));

    expect(isPolicyFailure(plan)).toBe(false);
    if (isPolicyFailure(plan)) return;
    expect(plan.outputLastMessagePath).toContain('openwork-runner');
    expect(plan.outputLastMessagePath).toContain('qa-smoke-codex-run');
    expect(plan.command.args).toContain('--json');
    expect(plan.command.args).toContain('--output-last-message');
    expect(plan.command.args).toContain(plan.outputLastMessagePath);
  });

  it('passes native runner baseline env and validates runner-local cwd', () => {
    const projectDir = path.join(tmpDir, 'projects');
    const plan = createExecutionPlan(
      {
        ...baseJob('codex'),
        allowedOperations: {
          tools: ['codex'],
          approvalMode: 'never',
          env: true,
          secrets: true,
          network: false,
          shell: false,
        },
        environment: {
          variables: [
            {
              name: 'WORKSPACE_API_URL',
              value: 'http://127.0.0.1:3000',
              source: 'workspace_api',
              secret: false,
            },
            {
              name: 'WORKSPACE_API_KEY',
              value: 'workspace-key-redacted',
              source: 'workspace_api',
              secret: true,
            },
            { name: 'PROJECTS_DIR', value: projectDir, source: 'runtime', secret: false },
            { name: 'PROJECT_PORT', value: '5173', source: 'runtime', secret: false },
            {
              name: 'OPENAI_API_KEY',
              value: 'provider-key-redacted',
              source: 'agent_env',
              secret: true,
            },
          ],
        },
      },
      {
        ...baseCapabilities('codex'),
        policy: {
          ...baseCapabilities('codex').policy,
          secretAccess: true,
        },
      },
    );

    expect(isPolicyFailure(plan)).toBe(false);
    if (isPolicyFailure(plan)) return;
    expect(plan.cwd).toBe(tmpDir);
    expect(plan.env.PWD).toBe(tmpDir);
    expect(plan.env.WORKSPACE_API_URL).toBe('http://127.0.0.1:3000');
    expect(plan.env.WORKSPACE_API_KEY).toBe('workspace-key-redacted');
    expect(plan.env.PROJECTS_DIR).toBe(projectDir);
    expect(plan.env.PROJECT_PORT).toBe('5173');
    expect(plan.env.OPENAI_API_KEY).toBe('provider-key-redacted');
  });

  it('downloads staged attachments locally before CLI launch', async () => {
    const body = Buffer.from('hello staged attachment');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://openwork.example/api/runner-attachments/download?itemId=attachment-1&path=%2Fchat-uploads%2Fspec.txt&token=fake-token',
      );
      expect(init?.headers).toEqual({ Authorization: 'Bearer runner-secret' });
      return new Response(body);
    });
    vi.stubGlobal('fetch', fetchMock);

    const job: RunnerJobIntent = {
      ...baseJob('opencode'),
      attachments: [
        {
          type: 'file',
          path: '.openwork/staging/attachment-1/attachments/spec.txt',
          filename: 'spec.txt',
          mimeType: 'text/plain',
          sizeBytes: body.byteLength,
          textExtraction: {
            status: 'available',
            textPath: '.openwork/staging/attachment-1/attachments/spec.txt',
          },
          manifest: { storagePath: '/chat-uploads/spec.txt' },
        },
      ],
      stagingManifest: {
        version: 1,
        root: '.openwork/staging/jobs/run-1',
        policy: { scope: 'runner_job_workspace', materialization: 'download_before_launch', cleanup: 'runner_managed' },
        totalSizeBytes: body.byteLength,
        attachments: [
          {
            id: 'attachment-1',
            kind: 'attachment',
            attachmentIndex: 0,
            filename: 'spec.txt',
            mimeType: 'text/plain',
            sizeBytes: body.byteLength,
            storageId: '/chat-uploads/spec.txt',
            storagePath: '/chat-uploads/spec.txt',
            download: {
              method: 'GET',
              path: '/api/runner-attachments/download?itemId=attachment-1&path=%2Fchat-uploads%2Fspec.txt&token=fake-token',
            },
            destination: 'attachments/spec.txt',
          },
        ],
      },
    };

    const staged = await materializeStagedAttachments(job, {
      serverUrl: 'https://openwork.example',
      credential: 'runner-secret',
    });

    const stagedPath = staged.attachments?.[0]?.path ?? '';
    expect(stagedPath).toBe(path.join(tmpDir, '.openwork', 'staging', 'jobs', 'run-1', 'attachments', 'spec.txt'));
    expect(staged.attachments?.[0]?.textExtraction.textPath).toBe(stagedPath);
    expect(fs.readFileSync(stagedPath, 'utf-8')).toBe('hello staged attachment');
  });

  it('rejects staged attachment destinations that escape the runner workspace staging root', async () => {
    const job: RunnerJobIntent = {
      ...baseJob('opencode'),
      attachments: [
        {
          type: 'file',
          path: '.openwork/staging/attachment-1/spec.txt',
          filename: 'spec.txt',
          mimeType: 'text/plain',
          sizeBytes: 1,
          textExtraction: { status: 'available', textPath: '.openwork/staging/attachment-1/spec.txt' },
        },
      ],
      stagingManifest: {
        version: 1,
        root: '.openwork/staging',
        policy: { scope: 'runner_job_workspace', materialization: 'download_before_launch', cleanup: 'runner_managed' },
        totalSizeBytes: 1,
        attachments: [
          {
            id: 'attachment-1',
            kind: 'attachment',
            attachmentIndex: 0,
            filename: 'spec.txt',
            mimeType: 'text/plain',
            sizeBytes: 1,
            storageId: '/chat-uploads/spec.txt',
            storagePath: '/chat-uploads/spec.txt',
            download: { method: 'GET', path: '/api/runner-attachments/download?itemId=attachment-1&path=x&token=x' },
            destination: '../outside.txt',
          },
        ],
      },
    };

    await expect(
      materializeStagedAttachments(job, {
        stagingRoot: path.join(tmpDir, '.openwork', 'staging', 'run-1'),
        serverUrl: 'https://openwork.example',
        credential: 'runner-secret',
      }),
    ).rejects.toThrow(/destination escapes the runner staging root/);
  });

  it('includes full attachment metadata in prompts and passes OpenCode files natively', () => {
    const imagePath = path.join(tmpDir, 'diagram.png');
    const filePath = path.join(tmpDir, 'context.txt');
    fs.writeFileSync(imagePath, 'fake image');
    fs.writeFileSync(filePath, 'hello runner');

    const plan = createExecutionPlan(
      {
        ...baseJob('opencode'),
        attachments: [
          {
            type: 'image',
            path: imagePath,
            filename: 'diagram.png',
            mimeType: 'image/png',
            sizeBytes: 10,
            textExtraction: { status: 'not_applicable' },
            manifest: { storagePath: '/chat-uploads/diagram.png' },
          },
          {
            type: 'file',
            path: filePath,
            filename: 'context.txt',
            mimeType: 'text/plain',
            sizeBytes: 12,
            textExtraction: {
              status: 'available',
              textPath: filePath,
              charCount: 12,
              truncated: false,
            },
            manifest: { storagePath: '/chat-uploads/context.txt' },
          },
        ],
      },
      baseCapabilities('opencode'),
    );

    expect(isPolicyFailure(plan)).toBe(false);
    if (isPolicyFailure(plan)) return;
    expect(plan.command.args).toContain('--file');
    expect(plan.command.args).toContain(imagePath);
    expect(plan.command.args).toContain(filePath);
    const prompt = plan.command.args.at(-1) ?? '';
    expect(prompt).toContain('Attachments:');
    expect(prompt).toContain('filename');
    expect(prompt).toContain('context.txt');
    expect(prompt).toContain('mimeType: text/plain');
    expect(prompt).toContain('sizeBytes: 12');
    expect(prompt).toContain('textExtraction: status=available');
    expect(prompt).toContain('manifest: {"storagePath":"/chat-uploads/context.txt"}');
  });

  it('keeps attachment metadata in prompts across Codex, OpenCode, and metadata-only providers', () => {
    const imagePath = path.join(tmpDir, 'diagram.png');
    const filePath = path.join(tmpDir, 'context.txt');
    fs.writeFileSync(imagePath, 'fake image');
    fs.writeFileSync(filePath, 'hello runner');
    const attachments: RunnerJobIntent['attachments'] = [
      {
        type: 'image',
        path: imagePath,
        filename: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        textExtraction: { status: 'not_applicable' },
        manifest: { storagePath: '/chat-uploads/diagram.png' },
      },
      {
        type: 'file',
        path: filePath,
        filename: 'context.txt',
        mimeType: 'text/plain',
        sizeBytes: 12,
        textExtraction: { status: 'available', textPath: filePath },
        manifest: { storagePath: '/chat-uploads/context.txt' },
      },
    ];

    const codexPlan = createExecutionPlan(
      { ...baseJob('codex'), attachments },
      baseCapabilities('codex'),
    );
    const opencodePlan = createExecutionPlan(
      { ...baseJob('opencode'), attachments },
      baseCapabilities('opencode'),
    );
    const claudePlan = createExecutionPlan(
      { ...baseJob('claude'), attachments },
      baseCapabilities('claude'),
    );

    expect(isPolicyFailure(codexPlan)).toBe(false);
    expect(isPolicyFailure(opencodePlan)).toBe(false);
    expect(isPolicyFailure(claudePlan)).toBe(false);
    if (isPolicyFailure(codexPlan) || isPolicyFailure(opencodePlan) || isPolicyFailure(claudePlan)) {
      return;
    }

    expect(codexPlan.command.args).toContain('--image');
    expect(codexPlan.command.args).toContain(imagePath);
    expect(codexPlan.command.args).not.toContain(filePath);
    expect(codexPlan.command.args.at(-1)).toContain('filename: context.txt');
    expect(opencodePlan.command.args.filter((arg) => arg === '--file')).toHaveLength(2);
    expect(opencodePlan.command.args).toContain(imagePath);
    expect(opencodePlan.command.args).toContain(filePath);
    expect(opencodePlan.command.args.at(-1)).toContain('filename: context.txt');
    expect(claudePlan.command.args).not.toContain('--file');
    expect(claudePlan.command.args).not.toContain('--image');
    expect(claudePlan.command.args[1]).toContain('filename: diagram.png');
    expect(claudePlan.command.args[1]).toContain('filename: context.txt');
  });

  it('does not open stdin for Codex prompt-only jobs', async () => {
    const plan = createExecutionPlan(baseJob('codex'), baseCapabilities('codex'));

    expect(isPolicyFailure(plan)).toBe(false);
    if (isPolicyFailure(plan)) return;

    const child = spawnExecutionPlan(plan);
    expect(child.stdin).toBeNull();
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => resolve());
    });
  });

  it('can run a detached plan with file-backed stdout and stderr', async () => {
    fs.writeFileSync(
      path.join(tmpDir, PROVIDER_BINARIES.codex),
      '#!/bin/sh\nprintf "detached stdout\\n"\nprintf "detached stderr\\n" >&2\nexit 0\n',
    );
    fs.chmodSync(path.join(tmpDir, PROVIDER_BINARIES.codex), 0o755);
    const stdoutPath = path.join(tmpDir, 'detached-stdout.log');
    const stderrPath = path.join(tmpDir, 'detached-stderr.log');
    const stdoutFd = fs.openSync(stdoutPath, 'w');
    const stderrFd = fs.openSync(stderrPath, 'w');
    const plan = createExecutionPlan(baseJob('codex'), baseCapabilities('codex'));

    expect(isPolicyFailure(plan)).toBe(false);
    if (isPolicyFailure(plan)) return;

    const child = spawnDetachedExecutionPlan(plan, { stdoutFd, stderrFd });
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);

    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => resolve());
    });

    expect(fs.readFileSync(stdoutPath, 'utf-8')).toBe('detached stdout\n');
    expect(fs.readFileSync(stderrPath, 'utf-8')).toBe('detached stderr\n');
  });

  it('rejects an unsupported runner capability with explicit evidence', () => {
    const job = baseJob('qwen');
    const capabilities = baseCapabilities('codex');
    const plan = createExecutionPlan(job, capabilities);

    expect(isPolicyFailure(plan)).toBe(true);
    if (!isPolicyFailure(plan)) return;
    expect(plan).toMatchObject({
      code: 'unsupported_provider',
      message: 'Unsupported provider: qwen',
    });
    console.info(
      `qa-smoke report: ${JSON.stringify({ check: 'unsupported runner capability negative control', status: 'PASS', reason: plan.message, ids: { runId: job.runId, provider: job.provider } })}`,
    );
  });

  it('accepts an existing absolute workspace path outside the advertised runner root', () => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-runner-outside-'));
    try {
      const plan = createExecutionPlan(
        {
          ...baseJob('codex'),
          workspace: {
            type: 'local_path',
            path: outsideRoot,
            workspaceId: 'qa-smoke-workspace',
          },
        },
        baseCapabilities('codex'),
      );

      expect(isPolicyFailure(plan)).toBe(false);
      if (isPolicyFailure(plan)) return;
      expect(plan.cwd).toBe(outsideRoot);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('accepts repository-backed jobs when the runner did not advertise a workspace root', () => {
    const capabilities = baseCapabilities('codex');
    delete capabilities.workspaceRoot;

    const plan = createExecutionPlan(baseJob('codex'), capabilities);

    expect(isPolicyFailure(plan)).toBe(false);
    if (isPolicyFailure(plan)) return;
    expect(plan.cwd).toBe(tmpDir);
  });

  it('rejects a missing workspace path with the documented message', () => {
    const missingPath = path.join(tmpDir, 'missing-workspace');
    const plan = createExecutionPlan(
      {
        ...baseJob('codex'),
        workspace: {
          type: 'local_path',
          path: missingPath,
          workspaceId: 'qa-smoke-workspace',
        },
      },
      baseCapabilities('codex'),
    );

    expect(isPolicyFailure(plan)).toBe(true);
    if (!isPolicyFailure(plan)) return;
    expect(plan).toMatchObject({
      code: 'invalid_job',
      message: `Workspace path does not exist: ${missingPath}`,
    });
  });

  it('creates, reuses, and cleans managed no-repository agent workspaces', () => {
    const workspacePath = path.join(tmpDir, '.openwork', 'no-repository-agents', 'agent-1', 'workspace');
    materializeRunnerWorkspace(
      workspaceSetup('agent-1', workspacePath, {
        strategy: 'runner_local_agent_workspace',
        cleanup: 'managed_files',
        agentContext: {
          revision: 'rev-1',
          files: [
            { path: 'AGENTS.md', content: 'instructions v1\n' },
            { path: 'skills/session-start/index.md', content: 'start\n' },
          ],
        },
      }),
    );
    const job: RunnerJobIntent = {
      ...baseJob('codex'),
      workspace: {
        type: 'local_path',
        path: workspacePath,
        workspaceId: 'qa-smoke-workspace',
      },
    };

    const firstPlan = createExecutionPlan(job, baseCapabilities('codex'));
    expect(isPolicyFailure(firstPlan)).toBe(false);
    expect(fs.readFileSync(path.join(workspacePath, 'AGENTS.md'), 'utf-8')).toBe(
      'instructions v1\n',
    );
    expect(fs.readFileSync(path.join(workspacePath, 'skills/session-start/index.md'), 'utf-8')).toBe(
      'start\n',
    );

    materializeRunnerWorkspace(
      workspaceSetup('agent-1', workspacePath, {
        strategy: 'runner_local_agent_workspace',
        cleanup: 'managed_files',
        agentContext: {
          revision: 'rev-2',
          files: [{ path: 'AGENTS.md', content: 'instructions v2\n' }],
        },
      }),
    );
    expect(fs.readFileSync(path.join(workspacePath, 'AGENTS.md'), 'utf-8')).toBe(
      'instructions v2\n',
    );
    expect(fs.existsSync(path.join(workspacePath, 'skills/session-start/index.md'))).toBe(false);
  });

  it('materializes a conversation subfolder from runner-local repository context', () => {
    const repoRoot = path.join(tmpDir, 'repo-conversation');
    const agentRoot = path.join(repoRoot, '.openwork', 'agents', 'test-agent');
    const conversationId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const workspacePath = path.join(repoRoot, 'conversations', conversationId);
    fs.mkdirSync(path.join(agentRoot, 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(agentRoot, 'AGENTS.md'),
      '- The project repository root is `/hosted/backend/repo/`.\n- Use other paths only if the task requires it; ask first when avoidable.\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(agentRoot, 'skills', 'start.md'), 'runner skill\n', 'utf-8');

    materializeRunnerWorkspace(
      workspaceSetup('test-agent', workspacePath, {
        strategy: 'runner_local_agent_workspace',
        cleanup: 'managed_files',
        agentContext: { revision: 'conversation-rev', files: [] },
        conversationWorkspace: {
          conversationId,
          agentContextRoot: '.openwork/agents/test-agent',
          markdownEntries: ['AGENTS.md'],
          linkEntries: ['skills'],
        },
      }),
    );

    const plan = createExecutionPlan(
      {
        ...baseJob('codex'),
        workspace: {
          type: 'local_path',
          path: workspacePath,
          workspaceId: 'qa-smoke-workspace',
        },
      },
      baseCapabilities('codex'),
    );

    expect(isPolicyFailure(plan)).toBe(false);
    expect(fs.existsSync(workspacePath)).toBe(true);
    expect(fs.readFileSync(path.join(workspacePath, 'AGENTS.md'), 'utf-8')).toContain(
      `- The working directory for this conversation is \`${path.resolve(workspacePath)}/\`. Work in this folder by default for commands and file operations.`,
    );
    expect(fs.realpathSync(path.join(workspacePath, 'skills', 'start.md'))).toBe(
      fs.realpathSync(path.join(agentRoot, 'skills', 'start.md')),
    );
  });

  it('rejects context hash mismatches before provider spawn', () => {
    const workspacePath = path.join(tmpDir, '.openwork', 'no-repository-agents', 'agent-hash', 'workspace');
    expect(() =>
      materializeRunnerWorkspace(
        workspaceSetup('agent-hash', workspacePath, {
          strategy: 'runner_local_agent_workspace',
          cleanup: 'managed_files',
          agentContext: {
            revision: 'rev-hash',
            files: [{ path: 'AGENTS.md', content: 'instructions\n', sha256: 'not-a-real-hash' }],
          },
        }),
      ),
    ).toThrow('Agent context hash mismatch for AGENTS.md');
  });

  it('rejects unmanaged workspace file collisions before provider spawn', () => {
    const workspacePath = path.join(tmpDir, '.openwork', 'no-repository-agents', 'agent-collision', 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'AGENTS.md'), 'user-owned\n');

    expect(() =>
      materializeRunnerWorkspace(
        workspaceSetup('agent-collision', workspacePath, {
          strategy: 'runner_local_agent_workspace',
          cleanup: 'managed_files',
          agentContext: {
            revision: 'rev-collision',
            files: [{ path: 'AGENTS.md', content: 'server-owned\n' }],
          },
        }),
      ),
    ).toThrow('Refusing to overwrite unmanaged workspace file: AGENTS.md');
    expect(fs.readFileSync(path.join(workspacePath, 'AGENTS.md'), 'utf-8')).toBe('user-owned\n');
  });

  it('creates and validates explicit no-repository workspaces under the runner root', () => {
    const workspacePath = path.join(
      tmpDir,
      '.openwork',
      'no-repository-agents',
      'agent-prepare',
      'workspace',
    );

    const result = prepareWorkspacePath(
      {
        action: 'prepare_workspace',
        path: workspacePath,
        purpose: 'no_repository_agent',
        agentId: 'agent-prepare',
        workspaceId: 'qa-smoke-workspace',
      },
      tmpDir,
    );

    expect(result).toMatchObject({
      action: 'prepare_workspace',
      path: workspacePath,
      workspaceRoot: tmpDir,
      status: 'ready',
    });
    expect(fs.statSync(workspacePath).isDirectory()).toBe(true);
  });

  it('creates explicit conversation subfolder workspaces under the runner root', () => {
    const workspacePath = path.join(tmpDir, 'repo', 'conversations', 'conversation-prepare');

    const result = prepareWorkspacePath(
      {
        action: 'prepare_workspace',
        path: workspacePath,
        purpose: 'conversation_subfolder',
        agentId: 'agent-prepare',
        conversationId: 'conversation-prepare',
        workspaceId: 'qa-smoke-workspace',
      },
      tmpDir,
    );

    expect(result).toMatchObject({
      action: 'prepare_workspace',
      path: workspacePath,
      workspaceRoot: tmpDir,
      status: 'ready',
    });
    expect(fs.statSync(workspacePath).isDirectory()).toBe(true);
  });

  it('reads, writes, lists, imports, and deletes runner-owned no-repository agent files', () => {
    const workspacePath = path.join(
      tmpDir,
      '.openwork',
      'no-repository-agents',
      'agent-files',
      'workspace',
    );

    const writeResult = handleAgentWorkspaceFileRequest(
      {
        action: 'write_agent_file',
        workspacePath,
        path: '/AGENTS.md',
        content: 'runner instructions\n',
        encoding: 'utf8',
      },
      tmpDir,
    );
    const importResult = handleAgentWorkspaceFileRequest(
      {
        action: 'import_agent_files',
        workspacePath,
        files: [
          {
            path: '/skills/start/index.md',
            contentBase64: Buffer.from('skill body\n').toString('base64'),
            sizeBytes: 11,
          },
        ],
      },
      tmpDir,
    );
    const listResult = handleAgentWorkspaceFileRequest(
      { action: 'list_agent_files', workspacePath, path: '/' },
      tmpDir,
    );
    const readResult = handleAgentWorkspaceFileRequest(
      { action: 'read_agent_file', workspacePath, path: '/AGENTS.md', encoding: 'utf8' },
      tmpDir,
    );
    const deleteResult = handleAgentWorkspaceFileRequest(
      { action: 'delete_agent_path', workspacePath, path: '/skills' },
      tmpDir,
    );

    expect(writeResult).toMatchObject({ action: 'write_agent_file', path: '/AGENTS.md' });
    expect(importResult).toMatchObject({ action: 'import_agent_files', importedCount: 1 });
    expect(listResult).toMatchObject({
      action: 'list_agent_files',
      entries: expect.arrayContaining([
        expect.objectContaining({ name: 'AGENTS.md', type: 'file' }),
      ]),
    });
    expect(readResult).toMatchObject({
      action: 'read_agent_file',
      content: 'runner instructions\n',
    });
    expect(deleteResult).toEqual({ action: 'delete_agent_path', deleted: true });
    expect(fs.existsSync(path.join(workspacePath, 'skills'))).toBe(false);
  });

  it('creates an empty runner-owned agent workspace when listing the root', () => {
    const workspacePath = path.join(
      tmpDir,
      '.openwork',
      'no-repository-agents',
      'agent-empty-files',
      'workspace',
    );

    const listResult = handleAgentWorkspaceFileRequest(
      { action: 'list_agent_files', workspacePath, path: '/' },
      tmpDir,
    );

    expect(listResult).toMatchObject({
      action: 'list_agent_files',
      path: '/',
      entries: [],
    });
    expect(fs.statSync(workspacePath).isDirectory()).toBe(true);
  });

  it('creates an empty repository agent workspace when listing the root', () => {
    const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-runner-empty-repo-'));
    try {
      const workspacePath = path.join(outsideRepo, '.openwork', 'agents', 'repo-agent');

      const listResult = handleAgentWorkspaceFileRequest(
        {
          action: 'list_agent_files',
          workspacePath,
          workspaceRootPath: outsideRepo,
          path: '/',
        },
        tmpDir,
      );

      expect(listResult).toMatchObject({
        action: 'list_agent_files',
        path: '/',
        entries: [],
      });
      expect(fs.statSync(workspacePath).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(outsideRepo, { recursive: true, force: true });
    }
  });

  it('keeps missing nested agent file folders as not found', () => {
    const workspacePath = path.join(
      tmpDir,
      '.openwork',
      'no-repository-agents',
      'agent-missing-nested',
      'workspace',
    );

    expect(() =>
      handleAgentWorkspaceFileRequest(
        { action: 'list_agent_files', workspacePath, path: '/missing' },
        tmpDir,
      ),
    ).toThrow(RunnerFilesystemError);
    expect(fs.existsSync(workspacePath)).toBe(false);
  });

  it('accepts repository roots outside the advertised runner workspace root', () => {
    const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-runner-outside-repo-'));
    try {
      expect(validateRepositoryRoot(outsideRepo, tmpDir)).toMatchObject({
        path: outsideRepo,
        repositoryRootOrigin: 'runner_local',
      });
      const workspacePath = path.join(outsideRepo, '.openwork', 'agents', 'repo-agent');
      const writeResult = handleAgentWorkspaceFileRequest(
        {
          action: 'write_agent_file',
          workspacePath,
          workspaceRootPath: outsideRepo,
          path: '/AGENTS.md',
          content: 'repo runner instructions\n',
          encoding: 'utf8',
        },
        tmpDir,
      );
      const readResult = handleAgentWorkspaceFileRequest(
        {
          action: 'read_agent_file',
          workspacePath,
          workspaceRootPath: outsideRepo,
          path: '/AGENTS.md',
          encoding: 'utf8',
        },
        tmpDir,
      );
      expect(writeResult).toMatchObject({ action: 'write_agent_file', path: '/AGENTS.md' });
      expect(readResult).toMatchObject({
        action: 'read_agent_file',
        content: 'repo runner instructions\n',
      });
    } finally {
      fs.rmSync(outsideRepo, { recursive: true, force: true });
    }
  });

  it('accepts repository roots inside the advertised runner workspace root', () => {
    const repo = path.join(tmpDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    expect(validateRepositoryRoot(repo, tmpDir)).toMatchObject({
      path: repo,
      repositoryRootOrigin: 'runner_local',
    });
  });

  it('refuses missing runner roots and outside-root workspace prepare paths', () => {
    expect(() =>
      prepareWorkspacePath(
        {
          action: 'prepare_workspace',
          path: path.join(tmpDir, 'workspace'),
          purpose: 'no_repository_agent',
          agentId: 'agent-prepare',
        },
        null,
      ),
    ).toThrow(RunnerFilesystemError);

    try {
      prepareWorkspacePath(
        {
          action: 'prepare_workspace',
          path: path.join(path.dirname(tmpDir), 'outside-workspace'),
          purpose: 'no_repository_agent',
          agentId: 'agent-prepare',
        },
        tmpDir,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerFilesystemError);
      expect((error as RunnerFilesystemError).code).toBe('path_outside_workspace_root');
      return;
    }
    throw new Error('Expected outside-root workspace prepare to fail');
  });

  it('imports explicit attachments into the runner workspace without touching run staging', async () => {
    const body = Buffer.from('persist me in the workspace');
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const fetchMock = vi.fn(async () => new Response(body));
    vi.stubGlobal('fetch', fetchMock);

    const destinationPath = path.join(tmpDir, 'imports', 'brief.txt');
    const result = await importAttachmentToWorkspace(
      {
        action: 'import_attachment',
        destinationPath,
        overwrite: true,
        source: {
          filename: 'brief.txt',
          mimeType: 'text/plain',
          sizeBytes: body.length,
          storageId: '/chat-uploads/brief.txt',
          storagePath: '/chat-uploads/brief.txt',
          download: {
            method: 'GET',
            path: '/api/runner-attachments/download?itemId=attachment-1&path=x&token=x',
          },
        },
      },
      tmpDir,
      { serverUrl: 'https://openwork.example', credential: 'runner-secret' },
    );

    expect(result).toMatchObject({
      action: 'import_attachment',
      path: destinationPath,
      sizeBytes: body.length,
      sha256: hash,
    });
    expect(fs.readFileSync(destinationPath, 'utf-8')).toBe('persist me in the workspace');
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/api/runner-attachments/download?itemId=attachment-1&path=x&token=x', 'https://openwork.example'),
      { headers: { Authorization: 'Bearer runner-secret' } },
    );
  });

  it('refuses explicit attachment imports outside the runner workspace root', async () => {
    await expect(
      importAttachmentToWorkspace(
        {
          action: 'import_attachment',
          destinationPath: path.join(path.dirname(tmpDir), 'outside.txt'),
          source: {
            filename: 'outside.txt',
            mimeType: 'text/plain',
            sizeBytes: 1,
            storageId: '/chat-uploads/outside.txt',
            storagePath: '/chat-uploads/outside.txt',
            download: { method: 'GET', path: '/api/runner-attachments/download?x=1' },
          },
        },
        tmpDir,
        { serverUrl: 'https://openwork.example', credential: 'runner-secret' },
      ),
    ).rejects.toMatchObject({ code: 'path_outside_workspace_root' });
  });
});
