import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RUNNER_PROTOCOL_VERSION,
  type RunnerCapabilities,
  type RunnerJobIntent,
} from '../packages/shared/src/runner-protocol.js';
import { materializeStagedAttachments } from '../packages/runner/src/attachment-staging.js';
import {
  createExecutionPlan,
  isPolicyFailure,
  PROVIDER_BINARIES,
} from '../packages/runner/src/executor.js';
import {
  handleAgentWorkspaceFileRequest,
  importAttachmentToWorkspace,
  prepareWorkspacePath,
} from '../packages/runner/src/workspace-prepare.js';

type CheckResult = {
  id: string;
  status: 'PASS' | 'FAIL';
  description: string;
  observed: string;
  expected: string;
  evidence?: Record<string, unknown>;
};

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-runner-workspace-contract-'));
const backendDataRoot = path.join(tempRoot, 'hosted-backend-data');
const runnerRoot = path.join(tempRoot, 'runner-workspace-root');
const repositoryRoot = path.join(runnerRoot, 'repo-agent');
const noRepositoryWorkspace = path.join(
  runnerRoot,
  '.openwork',
  'no-repository-agents',
  'agent-no-repo',
  'workspace',
);
const outsideRoot = path.join(tempRoot, 'outside-workspace');
const backendAgentRoot = path.join(backendDataRoot, 'agents', 'agent-no-repo');
const originalPath = process.env.PATH ?? '';

function makeCodexExecutable() {
  const binDir = path.join(tempRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, PROVIDER_BINARIES.codex);
  fs.writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(binPath, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
}

function capabilities(workspaceRoot?: string | null): RunnerCapabilities {
  return {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    os: process.platform,
    arch: process.arch,
    runnerVersion: 'workspace-contract-acceptance',
    ...(workspaceRoot ? { workspaceRoot } : {}),
    supportedProviders: ['codex'],
    supportsCancellation: true,
    supportsArtifacts: false,
    supportsFilesystem: true,
    policy: {
      workspaceRootRequired: true,
      allowedTools: ['codex'],
      approvalModes: ['dangerous'],
      envAccess: true,
      secretAccess: true,
      network: true,
      shell: true,
    },
  };
}

function job(workspacePath: string, patch: Partial<RunnerJobIntent> = {}): RunnerJobIntent {
  return {
    runId: `workspace-contract-${workspacePath.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
    agentId: 'agent-1',
    provider: 'codex',
    modelPreference: { displayName: 'codex', modelId: 'gpt-5', thinkingLevel: null },
    prompt: 'workspace contract diagnostic',
    workspace: { type: 'local_path', path: workspacePath, workspaceId: 'workspace-1' },
    allowedOperations: {
      tools: ['codex'],
      approvalMode: 'dangerous',
      env: true,
      secrets: true,
      network: true,
      shell: true,
    },
    environment: { variables: [] },
    ...patch,
  };
}

function assertNoBackendPathLeak(label: string, value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized.includes(backendDataRoot)) {
    throw new Error(`${label} leaked backend DATA_DIR path ${backendDataRoot}`);
  }
}

function pathInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function pass(
  id: string,
  description: string,
  observed: string,
  expected: string,
  evidence?: Record<string, unknown>,
): CheckResult {
  return { id, status: 'PASS', description, observed, expected, evidence };
}

function fail(
  id: string,
  description: string,
  error: unknown,
  expected: string,
): CheckResult {
  return {
    id,
    status: 'FAIL',
    description,
    observed: error instanceof Error ? error.message : String(error),
    expected,
  };
}

function runPolicyRejectionCase(input: {
  id: string;
  description: string;
  workspacePath: string;
  workspaceRoot?: string | null;
  expected: RegExp;
}): CheckResult {
  try {
    const plan = createExecutionPlan(
      job(input.workspacePath),
      capabilities(input.workspaceRoot === undefined ? runnerRoot : input.workspaceRoot),
    );
    const accepted = !isPolicyFailure(plan);
    const message = isPolicyFailure(plan) ? plan.message : `accepted cwd=${plan.cwd}`;
    if (accepted || !input.expected.test(message)) {
      throw new Error(message);
    }
    return pass(input.id, input.description, message, input.expected.source, {
      workspaceRoot: input.workspaceRoot ?? null,
      workspacePath: input.workspacePath,
    });
  } catch (error) {
    return fail(input.id, input.description, error, input.expected.source);
  }
}

function runPolicyAcceptanceCase(input: {
  id: string;
  description: string;
  workspacePath: string;
  workspaceRoot?: string | null;
  expected: string;
}): CheckResult {
  try {
    const plan = createExecutionPlan(
      job(input.workspacePath),
      capabilities(input.workspaceRoot === undefined ? runnerRoot : input.workspaceRoot),
    );
    if (isPolicyFailure(plan)) throw new Error(plan.message);
    return pass(input.id, input.description, `accepted cwd=${plan.cwd}`, input.expected, {
      workspaceRoot: input.workspaceRoot ?? null,
      workspacePath: input.workspacePath,
    });
  } catch (error) {
    return fail(input.id, input.description, error, input.expected);
  }
}

async function runAcceptanceChecks(): Promise<CheckResult[]> {
  fs.mkdirSync(repositoryRoot, { recursive: true });
  fs.mkdirSync(noRepositoryWorkspace, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.mkdirSync(backendAgentRoot, { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, 'package.json'), '{"private":true}\n');
  fs.writeFileSync(path.join(backendAgentRoot, 'AGENTS.md'), 'backend legacy context\n');
  makeCodexExecutable();

  const results: CheckResult[] = [
    runPolicyAcceptanceCase({
      id: 'missing-runner-root',
      description:
        'Repository-backed jobs do not require the runner to advertise capabilities.workspaceRoot.',
      workspacePath: repositoryRoot,
      workspaceRoot: null,
      expected: `accepted cwd=${repositoryRoot}`,
    }),
    runPolicyRejectionCase({
      id: 'relative-agents-cwd',
      description:
        'Backend-ish relative cwd such as agents/<id> must not become executable runner cwd.',
      workspacePath: 'agents/agent-1',
      expected: /workspace path/i,
    }),
    runPolicyRejectionCase({
      id: 'missing-absolute-cwd',
      description: 'Missing absolute runner-local workspace paths are rejected before provider spawn.',
      workspacePath: path.join(backendDataRoot, 'agents', 'missing-agent'),
      expected: /does not exist/i,
    }),
    runPolicyAcceptanceCase({
      id: 'outside-root-cwd',
      description:
        'Accessible absolute repository cwd outside the advertised runner root is accepted before spawn.',
      workspacePath: outsideRoot,
      expected: `accepted cwd=${outsideRoot}`,
    }),
  ];

  try {
    const plan = createExecutionPlan(job(repositoryRoot), capabilities(runnerRoot));
    if (isPolicyFailure(plan)) throw new Error(plan.message);
    assertNoBackendPathLeak('repository-root plan', plan);
    if (plan.cwd !== repositoryRoot) throw new Error(`cwd=${plan.cwd}`);
    results.push(
      pass(
        'repository-root-runner-cwd',
        'Repository-root agents execute from the verified runner-local repository root.',
        `cwd=${plan.cwd}`,
        `cwd=${repositoryRoot} and no backend DATA_DIR leak`,
      ),
    );
  } catch (error) {
    results.push(
      fail(
        'repository-root-runner-cwd',
        'Repository-root agents execute from the verified runner-local repository root.',
        error,
        `cwd=${repositoryRoot} and no backend DATA_DIR leak`,
      ),
    );
  }

  try {
    const prepared = prepareWorkspacePath(
      {
        action: 'prepare_workspace',
        path: noRepositoryWorkspace,
        purpose: 'no_repository_agent',
        agentId: 'agent-no-repo',
        workspaceId: 'workspace-1',
      },
      runnerRoot,
    );
    const write = handleAgentWorkspaceFileRequest(
      {
        action: 'write_agent_file',
        workspacePath: noRepositoryWorkspace,
        path: '/AGENTS.md',
        content: 'runner-owned no-repository instructions\n',
        encoding: 'utf8',
      },
      runnerRoot,
    );
    const revealTargets: string[] = [];
    const reveal = handleAgentWorkspaceFileRequest(
      {
        action: 'reveal_agent_path',
        workspacePath: noRepositoryWorkspace,
        path: '/AGENTS.md',
      },
      runnerRoot,
      { revealPath: (targetPath) => revealTargets.push(targetPath) },
    );
    const list = handleAgentWorkspaceFileRequest(
      { action: 'list_agent_files', workspacePath: noRepositoryWorkspace, path: '/' },
      runnerRoot,
    );
    const plan = createExecutionPlan(job(noRepositoryWorkspace), capabilities(runnerRoot));
    if (isPolicyFailure(plan)) throw new Error(plan.message);
    assertNoBackendPathLeak('no-repository workspace operations', {
      prepared,
      write,
      reveal,
      revealTargets,
      list,
      plan,
    });
    if (!revealTargets[0]?.startsWith(noRepositoryWorkspace)) {
      throw new Error(`reveal target was ${revealTargets[0] ?? '<missing>'}`);
    }
    results.push(
      pass(
        'no-repository-prepared-workspace',
        'No-repository agents are explicitly prepared, browsed, revealed, and executed under the runner root.',
        `cwd=${plan.cwd}; files=${list.entries.map((entry) => entry.name).join(',')}`,
        'prepared workspace and file operations stay runner-local',
        { preparedPath: prepared.path, revealTarget: revealTargets[0] },
      ),
    );
  } catch (error) {
    results.push(
      fail(
        'no-repository-prepared-workspace',
        'No-repository agents are explicitly prepared, browsed, revealed, and executed under the runner root.',
        error,
        'prepared workspace and file operations stay runner-local',
      ),
    );
  }

  try {
    const body = Buffer.from('runner staged attachment\n');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const stagingRoot = path.join(repositoryRoot, '.openwork', 'staging', 'run-attachment');
    const fetchMock = async () => new Response(body);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const staged = await materializeStagedAttachments(
        job(repositoryRoot, {
          attachments: [
            {
              type: 'file',
              path: '.openwork/staging/run-attachment/attachments/spec.txt',
              filename: 'spec.txt',
              mimeType: 'text/plain',
              sizeBytes: body.length,
              textExtraction: {
                status: 'available',
                textPath: '.openwork/staging/run-attachment/attachments/spec.txt',
              },
              manifest: { storagePath: '/chat-uploads/spec.txt' },
            },
          ],
          stagingManifest: {
            version: 1,
            root: '.openwork/staging',
            totalSizeBytes: body.length,
            attachments: [
              {
                id: 'attachment-1',
                kind: 'attachment',
                attachmentIndex: 0,
                filename: 'spec.txt',
                mimeType: 'text/plain',
                sizeBytes: body.length,
                sha256,
                storagePath: '/chat-uploads/spec.txt',
                download: {
                  method: 'GET',
                  path: '/api/runner-attachments/download?itemId=attachment-1&path=%2Fchat-uploads%2Fspec.txt&token=x',
                },
                destination: 'attachments/spec.txt',
              },
            ],
          },
        }),
        {
          stagingRoot,
          serverUrl: 'https://openwork.example',
          credential: 'runner-secret',
        },
      );
      const stagedPath = staged.attachments?.[0]?.path ?? '';
      assertNoBackendPathLeak('staged attachment job', staged);
      if (!pathInsideRoot(stagedPath, stagingRoot)) throw new Error(`staged path=${stagedPath}`);

      const imported = await importAttachmentToWorkspace(
        {
          action: 'import_attachment',
          destinationPath: path.join(runnerRoot, 'imports', 'spec.txt'),
          overwrite: true,
          source: {
            filename: 'spec.txt',
            mimeType: 'text/plain',
            sizeBytes: body.length,
            sha256,
            storagePath: '/chat-uploads/spec.txt',
            download: {
              method: 'GET',
              path: '/api/runner-attachments/download?itemId=attachment-1&path=%2Fchat-uploads%2Fspec.txt&token=x',
            },
          },
        },
        runnerRoot,
        { serverUrl: 'https://openwork.example', credential: 'runner-secret' },
      );
      assertNoBackendPathLeak('explicit attachment import', imported);
      if (!pathInsideRoot(imported.path, runnerRoot)) throw new Error(`imported path=${imported.path}`);
      results.push(
        pass(
          'attachment-staging-and-import',
          'Attachments stage into runner-owned per-run storage and explicit imports write under the runner root.',
          `staged=${stagedPath}; imported=${imported.path}`,
          'no backend DATA_DIR path appears in attachment filesystem operations',
        ),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } catch (error) {
    results.push(
      fail(
        'attachment-staging-and-import',
        'Attachments stage into runner-owned per-run storage and explicit imports write under the runner root.',
        error,
        'no backend DATA_DIR path appears in attachment filesystem operations',
      ),
    );
  }

  try {
    assertNoBackendPathLeak('negative leak control', {
      workspace: { path: backendAgentRoot },
      attachments: [{ path: path.join(backendDataRoot, 'storage', 'upload.txt') }],
    });
    results.push(
      fail(
        'backend-path-leak-negative-control',
        'The harness fails when backend absolute paths appear in runner-bound job data.',
        'negative control unexpectedly passed',
        'backend DATA_DIR leak detector must throw',
      ),
    );
  } catch (error) {
    results.push(
      pass(
        'backend-path-leak-negative-control',
        'The harness fails when backend absolute paths appear in runner-bound job data.',
        error instanceof Error ? error.message : String(error),
        'backend DATA_DIR leak detector throws',
      ),
    );
  }

  return results;
}

try {
  const results = await runAcceptanceChecks();
  console.log('OpenWork native runner workspace contract acceptance');
  console.log(
    JSON.stringify({
      backendDataRoot,
      runnerRoot,
      repositoryRoot,
      noRepositoryWorkspace,
      rootsAreDistinct: path.resolve(backendDataRoot) !== path.resolve(runnerRoot),
    }),
  );
  for (const result of results) console.log(JSON.stringify(result));
  const failed = results.filter((result) => result.status === 'FAIL');
  console.log(
    JSON.stringify({
      status: failed.length === 0 ? 'PASS' : 'FAIL',
      failed: failed.map((result) => result.id),
      note:
        failed.length > 0
          ? 'Cross-machine workspace acceptance failed; backend DATA_DIR and runner root must remain separated.'
          : 'Cross-machine workspace acceptance passed with distinct backend DATA_DIR and runner root.',
    }),
  );
  if (failed.length > 0) process.exitCode = 1;
} finally {
  process.env.PATH = originalPath;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
