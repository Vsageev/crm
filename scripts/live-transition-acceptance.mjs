#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const backendUrl = stripTrailingSlash(
  process.env.OPENWORK_LIVE_ACCEPTANCE_BACKEND_URL || 'http://localhost:3847',
);
const frontendUrl = stripTrailingSlash(
  process.env.OPENWORK_LIVE_ACCEPTANCE_FRONTEND_URL || 'http://localhost:5173',
);
const adminEmail = process.env.OPENWORK_LIVE_ACCEPTANCE_EMAIL || 'admin@workspace.local';
const adminPassword = process.env.OPENWORK_LIVE_ACCEPTANCE_PASSWORD || 'admin123';
const assignedCardId =
  process.env.OPENWORK_LIVE_ACCEPTANCE_CARD_ID ||
  process.env.OPENWORK_CARD_ID ||
  'bdea0109-a1c8-4a28-9d1f-13b671c42893';
const requestedBoardId = process.env.OPENWORK_LIVE_ACCEPTANCE_BOARD_ID || process.env.OPENWORK_BOARD_ID;
const requestedAgentId = process.env.OPENWORK_LIVE_ACCEPTANCE_AGENT_ID;
const requestedWorkspaceId = process.env.OPENWORK_LIVE_ACCEPTANCE_WORKSPACE_ID;
const runnerBrowsePath = process.env.OPENWORK_LIVE_ACCEPTANCE_BROWSE_PATH || process.cwd();
const requireRunner = parseBool(process.env.OPENWORK_LIVE_ACCEPTANCE_REQUIRE_RUNNER);
const skipMigrate = parseBool(process.env.OPENWORK_LIVE_ACCEPTANCE_SKIP_MIGRATE);
const runSecondMigration = process.env.OPENWORK_LIVE_ACCEPTANCE_SECOND_MIGRATE !== 'false';

const results = [];
let accessToken = '';
let runnerWorkspaceRoot = '';
let legacyAgentFileBaseline = null;
let resolvedWorkspaceId = null;

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function parseBool(value) {
  return value === '1' || value === 'true' || value === 'yes';
}

function activeWorkspaceId() {
  return requestedWorkspaceId || resolvedWorkspaceId || null;
}

function actionable(message, fix) {
  return fix ? `${message}\nFix: ${fix}` : message;
}

function logResult(status, name, detail) {
  const prefix = status === 'PASS' ? '[PASS]' : status === 'SKIP' ? '[SKIP]' : '[FAIL]';
  console.log(`${prefix} ${name}${detail ? ` - ${detail}` : ''}`);
  results.push({ status, name, detail });
}

async function step(name, fn) {
  try {
    const detail = await fn();
    logResult('PASS', name, detail);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logResult('FAIL', name, detail);
    throw error;
  }
}

function runCommand(command, args, fix) {
  return trimOutput(runCommandRaw(command, args, fix), 600);
}

function runCommandRaw(command, args, fix) {
  const display = `${command} ${args.join(' ')}`;
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(actionable(`Could not run ${display}: ${result.error.message}`, fix));
  }
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(
      actionable(
        `${display} exited ${result.status}.\n${trimOutput(output)}`,
        fix,
      ),
    );
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function extractLastJsonObject(output, context) {
  const text = output.trim();
  for (let index = text.indexOf('{'); index >= 0; index = text.indexOf('{', index + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = index; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(index, cursor + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error(`${context} did not print a JSON object. Output: ${trimOutput(output)}`);
}

function stableLegacyAgentFileSnapshot(report) {
  const object = requireObject(report, 'no-repository-agent-files:report');
  const agents = Array.isArray(object.agents) ? object.agents : [];
  return {
    source: object.source,
    executableSourceOfTruth: object.executableSourceOfTruth,
    totals: object.totals,
    agents: agents.map((entry) => ({
      agentId: entry.agentId,
      status: entry.status,
      legacyRootPath: entry.legacyRootPath,
      fileCount: entry.fileCount,
      directoryCount: entry.directoryCount,
      symlinkCount: entry.symlinkCount,
      importableFileCount: entry.importableFileCount,
      skippedCount: entry.skippedCount,
      totalBytes: entry.totalBytes,
    })),
  };
}

function trimOutput(value, max = 1400) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${backendUrl}${path}`;
  const headers = new Headers(options.headers || {});
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (accessToken && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  const data = parseResponseBody(text, response.headers.get('content-type'));
  return { response, data, text };
}

function parseResponseBody(text, contentType) {
  if (!text) return null;
  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return text;
}

function expectStatus(result, expected, context, fix) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(result.response.status)) {
    throw new Error(
      actionable(
        `${context} returned HTTP ${result.response.status}; expected ${allowed.join(' or ')}. Body: ${formatBody(result.data ?? result.text)}`,
        fix,
      ),
    );
  }
}

function formatBody(value) {
  if (typeof value === 'string') return trimOutput(value, 800);
  return trimOutput(JSON.stringify(value), 800);
}

function requireObject(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} did not return a JSON object. Body: ${formatBody(value)}`);
  }
  return value;
}

function requireEntries(value, context) {
  const object = requireObject(value, context);
  if (!Array.isArray(object.entries)) {
    throw new Error(`${context} did not return an entries array. Body: ${formatBody(value)}`);
  }
  return object.entries;
}

function knownRunnerUnavailable(data) {
  const code = data && typeof data === 'object' ? data.code : undefined;
  const message = data && typeof data === 'object' ? String(data.message || '') : '';
  return (
    code === 'runner_unavailable' ||
    code === 'runner_filesystem_unsupported' ||
    code === 'agent_runner_workspace_missing' ||
    code === 'agent_runner_workspace_ambiguous' ||
    code === 'agent_runner_workspace_root_missing' ||
    message.startsWith('runner_unavailable:') ||
    message.startsWith('runner_filesystem_unsupported:') ||
    message.startsWith('agent_runner_workspace_missing:')
  );
}

async function login() {
  const result = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  expectStatus(
    result,
    200,
    'POST /api/auth/login',
    'Run `pnpm --filter backend db:bootstrap`, confirm the seeded admin credentials, and restart the backend if auth config changed.',
  );
  const body = requireObject(result.data, 'POST /api/auth/login');
  if (typeof body.accessToken !== 'string' || !body.accessToken) {
    throw new Error('POST /api/auth/login did not return accessToken.');
  }
  accessToken = body.accessToken;
  return body;
}

async function resolveBoard() {
  if (requestedBoardId) {
    const result = await request(`/api/boards/${requestedBoardId}`);
    expectStatus(result, 200, `GET /api/boards/${requestedBoardId}`, 'Check OPENWORK_LIVE_ACCEPTANCE_BOARD_ID and the seeded database.');
    return requireObject(result.data, 'GET configured board');
  }

  if (assignedCardId) {
    const cardResult = await request(`/api/cards/${assignedCardId}`);
    if (cardResult.response.status === 200) {
      const card = requireObject(cardResult.data, 'GET assigned card');
      const placements = Array.isArray(card.boards) ? card.boards : [];
      const placement = placements.find((entry) => entry && typeof entry.boardId === 'string');
      if (placement) {
        const boardResult = await request(`/api/boards/${placement.boardId}`);
        expectStatus(boardResult, 200, `GET /api/boards/${placement.boardId}`, 'The card placement points at a missing board; repair board_cards or pass OPENWORK_LIVE_ACCEPTANCE_BOARD_ID.');
        return requireObject(boardResult.data, 'GET assigned card board');
      }
    } else if (cardResult.response.status !== 404) {
      throw new Error(
        actionable(
          `GET /api/cards/${assignedCardId} returned HTTP ${cardResult.response.status}. Body: ${formatBody(cardResult.data ?? cardResult.text)}`,
          'Fix the card read route before batch work continues.',
        ),
      );
    }
  }

  const listResult = await request('/api/boards?limit=1&offset=0');
  expectStatus(listResult, 200, 'GET /api/boards', 'Fix board listing before batch work continues.');
  const entries = requireEntries(listResult.data, 'GET /api/boards');
  if (entries.length > 0 && typeof entries[0]?.id === 'string') {
    const boardResult = await request(`/api/boards/${entries[0].id}`);
    expectStatus(boardResult, 200, `GET /api/boards/${entries[0].id}`, 'Fix board detail fetch before batch work continues.');
    return requireObject(boardResult.data, 'GET first board');
  }

  const createResult = await request('/api/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'QA Live Acceptance Board',
      description: 'Created by pnpm acceptance:live-transition when no board existed.',
      columns: [
        { name: 'To Do', color: '#64748B', position: 0 },
        { name: 'Done', color: '#16A34A', position: 1 },
      ],
    }),
  });
  expectStatus(createResult, 201, 'POST /api/boards', 'Fix board creation/default workspace assignment before batch work continues.');
  return requireObject(createResult.data, 'POST /api/boards');
}

async function checkRunnerEndpoint(path, context, expectedCodes) {
  const result = await request(path);
  if (result.response.ok) {
    return `HTTP ${result.response.status}`;
  }
  if (expectedCodes && expectedCodes.includes(result.response.status) && knownRunnerUnavailable(result.data)) {
    if (requireRunner) {
      throw new Error(
        actionable(
          `${context} reported ${result.data.code || 'runner unavailable'} while OPENWORK_LIVE_ACCEPTANCE_REQUIRE_RUNNER=true.`,
          'Pair and start a current openwork-runner for this workspace, then rerun the live acceptance suite.',
        ),
      );
    }
    return `expected unavailable response: ${result.data.code || result.data.message}`;
  }
  throw new Error(
    actionable(
      `${context} returned HTTP ${result.response.status}. Body: ${formatBody(result.data ?? result.text)}`,
      'Fix the runner filesystem route/error handler before batch work continues.',
    ),
  );
}

async function chooseAgent() {
  if (requestedAgentId) return requestedAgentId;
  const workspaceId = activeWorkspaceId();
  const query = workspaceId
    ? `/api/agents?workspaceId=${encodeURIComponent(workspaceId)}&limit=1`
    : '/api/agents?limit=1';
  const result = await request(query);
  expectStatus(result, 200, 'GET /api/agents', 'Fix agent list/read permissions before batch work continues.');
  const entries = requireEntries(result.data, 'GET /api/agents');
  return typeof entries[0]?.id === 'string' ? entries[0].id : null;
}

async function loadFrontendShell(pathname, context) {
  const result = await fetch(`${frontendUrl}${pathname}`, { headers: { accept: 'text/html' } });
  const body = await result.text();
  if (!result.ok) {
    throw new Error(
      actionable(
        `GET ${frontendUrl}${pathname} returned HTTP ${result.status}. Body: ${trimOutput(body, 600)}`,
        'Start the frontend on http://localhost:5173 or set OPENWORK_LIVE_ACCEPTANCE_FRONTEND_URL.',
      ),
    );
  }
  if (!body.includes('<div id="root"') && !body.includes('/src/')) {
    throw new Error(`${context} did not look like the Vite app shell. Body: ${trimOutput(body, 600)}`);
  }
  return `HTTP ${result.status}`;
}

async function uploadAcceptanceAttachment() {
  const body = new FormData();
  body.set('path', '/qa-live-acceptance');
  body.set(
    'file',
    new Blob([`live acceptance ${new Date().toISOString()}\n`], { type: 'text/plain' }),
    `transition-${Date.now()}.txt`,
  );
  const result = await request('/api/storage/upload', {
    method: 'POST',
    body,
    headers: {},
  });
  expectStatus(result, 201, 'POST /api/storage/upload', 'Fix backend storage upload before checking runner attachment staging.');
  const object = requireObject(result.data, 'POST /api/storage/upload');
  if (typeof object.path !== 'string') {
    throw new Error(`POST /api/storage/upload did not return a storage path. Body: ${formatBody(object)}`);
  }
  return object.path;
}

async function main() {
  console.log('OpenWork live transition acceptance');
  console.log(`backend=${backendUrl}`);
  console.log(`frontend=${frontendUrl}`);

  await step('backend migrations', async () => {
    if (skipMigrate) return 'skipped by OPENWORK_LIVE_ACCEPTANCE_SKIP_MIGRATE=true';
    const first = runCommand(
      'pnpm',
      ['--filter', 'backend', 'db:migrate'],
      'Ensure DATABASE_URL points at a reachable local Postgres and rerun from the repo root.',
    );
    let detail = 'first migration run ok';
    if (first) detail += ` (${first.split('\n')[0]})`;
    if (runSecondMigration) {
      runCommand(
        'pnpm',
        ['--filter', 'backend', 'db:migrate'],
        'Migrations must be idempotent; fix the migration before starting another batch card.',
      );
      detail += '; second migration run ok';
    }
    return detail;
  });

  await step('/health', async () => {
    const result = await request('/health');
    expectStatus(result, 200, 'GET /health', 'Start the backend on http://localhost:3847 or set OPENWORK_LIVE_ACCEPTANCE_BACKEND_URL.');
    const body = requireObject(result.data, 'GET /health');
    if (body.status !== 'ok') {
      throw new Error(`GET /health returned status=${body.status}. Body: ${formatBody(body)}`);
    }
    return 'status ok';
  });

  await step('backend legacy agent DATA_DIR baseline', async () => {
    const output = runCommandRaw(
      'pnpm',
      ['--filter', 'backend', 'no-repository-agent-files:report'],
      'Fix backend startup/database access before proving DATA_DIR agent files are not mutated by the live gate.',
    );
    const report = extractLastJsonObject(output, 'no-repository-agent-files:report');
    const snapshot = stableLegacyAgentFileSnapshot(report);
    if (snapshot.executableSourceOfTruth !== 'runner_owned_no_repository_workspace') {
      throw new Error(
        `Expected executableSourceOfTruth=runner_owned_no_repository_workspace; got ${snapshot.executableSourceOfTruth}`,
      );
    }
    legacyAgentFileBaseline = snapshot;
    return `agents=${snapshot.totals?.agents ?? 0} importable=${snapshot.totals?.legacyImportableAgents ?? 0}`;
  });

  await step('runner-owned agent migration gate', async () => {
    const repositoryOutput = runCommandRaw(
      'pnpm',
      ['--filter', 'backend', 'repository-roots:report'],
      'Repair repository-root rows with /api/runner-filesystem/validate-repository-root or add explicit blocked/manual-repair card evidence before handoff.',
    );
    const repositoryReport = extractLastJsonObject(
      repositoryOutput,
      'repository-roots:report',
    );
    const inventoryOutput = runCommandRaw(
      'pnpm',
      ['--filter', 'backend', 'agent-inventory:report'],
      'Backfill runner inventory and repair/import unresolved active agents before handoff.',
    );
    const inventoryReport = extractLastJsonObject(inventoryOutput, 'agent-inventory:report');
    const gateOutput = runCommandRaw(
      'pnpm',
      ['--filter', 'backend', 'agent-ownership:gate'],
      'Every active repository-root or runner-validation gap must be repaired, repair-required, or linked to explicit manual repair evidence.',
    );
    const gateReport = extractLastJsonObject(gateOutput, 'agent-ownership:gate');
    if (gateReport.status !== 'PASS') {
      throw new Error(`agent-ownership:gate returned ${formatBody(gateReport)}`);
    }
    return `repositoryUnaccounted=${repositoryReport.unaccountedActiveAgentsNeedingRepositoryRootRepair ?? 'unknown'}; runnerValidationUnaccounted=${inventoryReport.unaccountedActiveAgentsNeedingRunnerValidation ?? 'unknown'}`;
  });

  await step('auth login and session read', async () => {
    const loginBody = await login();
    const meResult = await request('/api/auth/me');
    expectStatus(meResult, 200, 'GET /api/auth/me', 'Fix auth middleware/session verification before batch work continues.');
    const me = requireObject(meResult.data, 'GET /api/auth/me');
    return `user=${me.user?.email || loginBody.user?.email || adminEmail}`;
  });

  /** @type {Record<string, any> | null} */
  let board = null;
  await step('board fetch', async () => {
    board = await resolveBoard();
    if (typeof board.id !== 'string' || !Array.isArray(board.columns)) {
      throw new Error(`Board response is missing id or columns. Body: ${formatBody(board)}`);
    }
    resolvedWorkspaceId = await resolveWorkspaceIdForBoard(board);
    return `${board.name || 'board'} (${board.id}) columns=${board.columns.length}`;
  });

  await step('execution-plan fetch', async () => {
    const result = await request(`/api/boards/${board.id}/execution-plans`);
    expectStatus(result, 200, `GET /api/boards/${board.id}/execution-plans`, 'Fix board execution-plan read before running another board batch.');
    const entries = requireEntries(result.data, 'GET execution plans');
    return `plans=${entries.length}`;
  });

  await step('board batch surfaces usable', async () => {
    const preview = await request(`/api/boards/${board.id}/batch-run/preview`);
    expectStatus(preview, 200, `GET /api/boards/${board.id}/batch-run/preview`, 'Fix board batch preview before running another board batch.');
    const previewBody = requireObject(preview.data, 'GET board batch preview');
    if (typeof previewBody.count !== 'number') {
      throw new Error(`Board batch preview did not return count. Body: ${formatBody(previewBody)}`);
    }
    const runs = await request(`/api/boards/${board.id}/batch-runs?limit=1&offset=0`);
    expectStatus(runs, 200, `GET /api/boards/${board.id}/batch-runs`, 'Fix board batch run list before handing off to the next card.');
    const runEntries = requireEntries(runs.data, 'GET board batch runs');
    return `previewCount=${previewBody.count}; runs=${runEntries.length}`;
  });

  await step('frontend board page loads', async () => {
    return loadFrontendShell(`/boards/${board.id}`, 'Frontend board response');
  });

  await step('frontend agents page loads', async () => {
    return loadFrontendShell('/agents', 'Frontend agents response');
  });

  await step('agent history read', async () => {
    const result = await request('/api/agent-runs?limit=1&offset=0');
    expectStatus(result, 200, 'GET /api/agent-runs', 'Fix agent run history listing before batch work continues.');
    const entries = requireEntries(result.data, 'GET /api/agent-runs');
    if (entries[0]?.id) {
      const detail = await request(`/api/agent-runs/${entries[0].id}`);
      expectStatus(detail, 200, `GET /api/agent-runs/${entries[0].id}`, 'Fix agent run detail/read history before batch work continues.');
      return `detail=${entries[0].id}`;
    }
    return 'history list ok; no runs present';
  });

  await step('chat history surface read', async () => {
    const recent = await request('/api/agent-chat/recent?limit=1');
    expectStatus(recent, 200, 'GET /api/agent-chat/recent', 'Fix agent chat recent-history reads before batch work continues.');
    const recentEntries = requireEntries(recent.data, 'GET /api/agent-chat/recent');
    const agentId = await chooseAgent();
    if (!agentId) return `recent=${recentEntries.length}; no agents present`;
    const conversations = await request(`/api/agents/${agentId}/chat/conversations?limit=1&offset=0`);
    expectStatus(
      conversations,
      200,
      `GET /api/agents/${agentId}/chat/conversations`,
      'Fix per-agent chat conversation history before batch work continues.',
    );
    const conversationEntries = requireEntries(conversations.data, 'GET agent chat conversations');
    if (conversationEntries[0]?.id) {
      const view = await request(`/api/agents/${agentId}/chat/conversations/${conversationEntries[0].id}/view`);
      expectStatus(
        view,
        200,
        `GET /api/agents/${agentId}/chat/conversations/${conversationEntries[0].id}/view`,
        'Fix offline chat view history before batch work continues.',
      );
    }
    return `recent=${recentEntries.length}; agentConversations=${conversationEntries.length}`;
  });

  await step('runner capability read', async () => {
    const result = await request('/api/agent-runners');
    expectStatus(result, 200, 'GET /api/agent-runners', 'Fix runner device/capability listing before batch work continues.');
    const entries = requireEntries(result.data, 'GET /api/agent-runners');
    const connectedWithRoot = entries.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        entry.status !== 'offline' &&
        entry.status !== 'revoked' &&
        typeof entry.capabilities?.workspaceRoot === 'string' &&
        entry.capabilities.workspaceRoot,
    );
    if (connectedWithRoot) runnerWorkspaceRoot = connectedWithRoot.capabilities.workspaceRoot;
    for (const entry of entries) {
      if (
        entry &&
        typeof entry === 'object' &&
        entry.status !== 'offline' &&
        entry.status !== 'revoked' &&
        entry.capabilities?.protocolVersion &&
        !entry.capabilities.agentInventory
      ) {
        throw new Error(
          `Connected runner ${entry.id || 'unknown'} does not advertise runner-owned agentInventory; executable agent files/runs would not have runner inventory authority.`,
        );
      }
    }
    return `runnerDevices=${entries.length}`;
  });

  await step('agent list executable ownership surface', async () => {
    const workspaceId = activeWorkspaceId();
    const query = workspaceId
      ? `/api/agents?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`
      : '/api/agents?limit=100';
    const result = await request(query);
    expectStatus(result, 200, 'GET /api/agents', 'Fix agent list ownership serialization before batch work continues.');
    const entries = requireEntries(result.data, 'GET /api/agents');
    const allowed = new Set(['runner', 'legacy_import_required', 'unavailable']);
    for (const entry of entries) {
      const ownership = entry?.executableOwnership;
      if (!ownership || typeof ownership !== 'object' || !allowed.has(ownership.state)) {
        throw new Error(`Agent ${entry?.id || 'unknown'} exposed invalid executableOwnership. Body: ${formatBody(entry)}`);
      }
    }
    return `agents=${entries.length}; states=${[...new Set(entries.map((entry) => entry.executableOwnership.state))].join(',') || 'none'}`;
  });

  async function resolveWorkspaceIdForBoard(currentBoard) {
    if (requestedWorkspaceId) return requestedWorkspaceId;
    if (typeof currentBoard.workspaceId === 'string') return currentBoard.workspaceId;
    if (typeof currentBoard.productWorkspaceId === 'string') return currentBoard.productWorkspaceId;

    const workspacesResult = await request('/api/workspaces?limit=100&offset=0');
    if (workspacesResult.response.status !== 200) return null;
    const workspaceEntries = requireEntries(workspacesResult.data, 'GET /api/workspaces');
    const match = workspaceEntries.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        Array.isArray(entry.boardIds) &&
        entry.boardIds.includes(currentBoard.id),
    );
    return match && typeof match.id === 'string' ? match.id : null;
  }

  await step('runner connection scope lists', async () => {
    const workspaceId = await resolveWorkspaceIdForBoard(board);

    const accountResult = await request(
      workspaceId
        ? `/api/agent-runners?workspaceId=${encodeURIComponent(workspaceId)}&connectionScope=account`
        : '/api/agent-runners?connectionScope=account',
    );
    expectStatus(
      accountResult,
      200,
      'GET /api/agent-runners?connectionScope=account',
      'Fix account-scoped runner listing after migration 0019.',
    );
    const accountEntries = requireEntries(accountResult.data, 'GET account runners');
    for (const entry of accountEntries) {
      if (entry && typeof entry === 'object' && entry.connectionScope && entry.connectionScope !== 'account') {
        throw new Error(`Account-scoped list returned non-account runner: ${formatBody(entry)}`);
      }
    }

    if (!workspaceId) {
      return `accountRunners=${accountEntries.length}; project list skipped (no workspaceId on board)`;
    }

    const projectResult = await request(
      `/api/agent-runners?workspaceId=${encodeURIComponent(workspaceId)}&connectionScope=project`,
    );
    expectStatus(
      projectResult,
      200,
      'GET /api/agent-runners?connectionScope=project',
      'Fix project-scoped runner listing after migration 0019.',
    );
    const projectEntries = requireEntries(projectResult.data, 'GET project runners');
    return `accountRunners=${accountEntries.length}; projectRunners=${projectEntries.length}`;
  });

  await step('runner scope negative list guard', async () => {
    const result = await request('/api/agent-runners?connectionScope=project');
    expectStatus(
      result,
      400,
      'GET /api/agent-runners?connectionScope=project without workspaceId',
      'Project runner listing must require workspaceId.',
    );
    const body = requireObject(result.data, 'GET project runners without workspace');
    if (body.code !== 'runner_connection_workspace_required') {
      throw new Error(`Expected runner_connection_workspace_required; got ${formatBody(body)}`);
    }
    return body.code;
  });

  await step('card comments remain readable after migration', async () => {
    if (!assignedCardId) return 'skipped (no OPENWORK_LIVE_ACCEPTANCE_CARD_ID)';
    const result = await request(`/api/cards/${assignedCardId}/comments`);
    expectStatus(
      result,
      200,
      `GET /api/cards/${assignedCardId}/comments`,
      'Historical card comments must stay readable regardless of runner connection scope.',
    );
    const entries = requireEntries(result.data, 'GET card comments');
    return `comments=${entries.length}`;
  });

  await step('agent detail and file authority surface', async () => {
    const agentId = await chooseAgent();
    if (!agentId) return 'skipped (no agent exists in this dev database)';
    const detail = await request(`/api/agents/${agentId}`);
    expectStatus(detail, 200, `GET /api/agents/${agentId}`, 'Fix agent detail reads before batch work continues.');
    const workspaceId = activeWorkspaceId();
    const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    const status = await request(`/api/agents/${agentId}/files/status${suffix}`);
    expectStatus(status, 200, `GET /api/agents/${agentId}/files/status`, 'Fix agent file authority status before batch work continues.');
    const statusBody = requireObject(status.data, 'GET agent file status');
    const ownership = statusBody.executableOwnership;
    if (!ownership || typeof ownership !== 'object' || ownership.state === 'backend') {
      throw new Error(`Agent file status did not expose runner/non-backend executable ownership. Body: ${formatBody(statusBody)}`);
    }
    if (statusBody.executableOrigin === 'backend' || statusBody.origin === 'backend') {
      throw new Error(`Agent file status exposed backend executable origin. Body: ${formatBody(statusBody)}`);
    }
    return `agent=${agentId}; mode=${statusBody.mode}; ownership=${ownership.state}`;
  });

  await step('runner filesystem proxy status', async () => {
    const workspaceId = activeWorkspaceId();
    const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    const result = await request(`/api/runner-filesystem/status${suffix}`);
    expectStatus(result, 200, 'GET /api/runner-filesystem/status', 'Fix runner filesystem status before batch work continues.');
    const body = requireObject(result.data, 'GET /api/runner-filesystem/status');
    if (body.state !== 'available' && requireRunner) {
      throw new Error(
        actionable(
          `Runner filesystem state is ${body.state}: ${body.message || 'no detail'}`,
          'Pair and start a current openwork-runner with filesystem support, then rerun the suite.',
        ),
      );
    }
    return `state=${body.state}${body.runnerId ? ` runner=${body.runnerId}` : ''}`;
  });

  await step('runner filesystem browse proxy', async () => {
    const workspaceId = activeWorkspaceId();
    const suffix = workspaceId
      ? `&workspaceId=${encodeURIComponent(workspaceId)}`
      : '';
    const browsePath = runnerWorkspaceRoot || runnerBrowsePath;
    return checkRunnerEndpoint(`/api/runner-filesystem/browse?path=${encodeURIComponent(browsePath)}&mode=folder${suffix}`, 'GET /api/runner-filesystem/browse', [409]);
  });

  await step('repository-root validation/prepare path', async () => {
    const workspaceId = activeWorkspaceId();
    const body = {
      path: process.env.OPENWORK_LIVE_ACCEPTANCE_REPOSITORY_ROOT || process.cwd(),
      ...(workspaceId ? { workspaceId } : {}),
      ...(requestedAgentId ? { agentId: requestedAgentId } : {}),
    };
    const result = await request('/api/runner-filesystem/validate-repository-root', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (result.response.ok) {
      const responseBody = requireObject(result.data, 'POST /api/runner-filesystem/validate-repository-root');
      return `validated runner=${responseBody.runnerId || 'unknown'}`;
    }
    if (result.response.status === 409 && knownRunnerUnavailable(result.data) && !requireRunner) {
      return `expected unavailable response: ${result.data.code || result.data.message}`;
    }
    throw new Error(
      actionable(
        `POST /api/runner-filesystem/validate-repository-root returned HTTP ${result.response.status}. Body: ${formatBody(result.data ?? result.text)}`,
        'Fix repository-root validation or pair a runner that can see OPENWORK_LIVE_ACCEPTANCE_REPOSITORY_ROOT.',
      ),
    );
  });

  await step('no-repository workspace prepare path', async () => {
    const agentId = await chooseAgent();
    const workspaceId = activeWorkspaceId();
    const body = {
      agentId: agentId || '00000000-0000-4000-8000-000000000000',
      ...(workspaceId ? { workspaceId } : {}),
    };
    const result = await request('/api/runner-filesystem/prepare-agent-workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (result.response.ok) {
      const responseBody = requireObject(result.data, 'POST /api/runner-filesystem/prepare-agent-workspace');
      return `prepared ${responseBody.path || responseBody.workspacePath || body.agentId}`;
    }
    if (result.response.status === 404 && !agentId) {
      return 'endpoint reachable; no agent exists to prepare in this dev database';
    }
    if (result.response.status === 409 && knownRunnerUnavailable(result.data) && !requireRunner) {
      return `expected unavailable response: ${result.data.code || result.data.message}`;
    }
    const expectedRepositoryAgent = result.data?.code === 'agent_repository_root_not_required';
    if (result.response.status === 409 && expectedRepositoryAgent) {
      return 'selected agent is repository-backed; no-repository prepare correctly rejected';
    }
    throw new Error(
      actionable(
        `POST /api/runner-filesystem/prepare-agent-workspace returned HTTP ${result.response.status}. Body: ${formatBody(result.data ?? result.text)}`,
        'Fix no-repository workspace preparation before batch work continues.',
      ),
    );
  });

  await step('attachment staging/import path', async () => {
    const storagePath = await uploadAcceptanceAttachment();
    const workspaceId = activeWorkspaceId();
    const result = await request('/api/runner-filesystem/import-attachment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        storagePath,
        destinationPath: path.join(
          process.env.OPENWORK_LIVE_ACCEPTANCE_IMPORT_ROOT || runnerWorkspaceRoot || runnerBrowsePath,
          '.openwork',
          'live-acceptance',
          `${Date.now()}-attachment.txt`,
        ),
        overwrite: true,
        ...(workspaceId ? { workspaceId } : {}),
      }),
    });
    if (result.response.status === 201) {
      const body = requireObject(result.data, 'POST /api/runner-filesystem/import-attachment');
      return `imported runner=${body.runnerId || 'unknown'}`;
    }
    if (result.response.status === 409 && knownRunnerUnavailable(result.data) && !requireRunner) {
      return `storage=${storagePath}; expected unavailable response: ${result.data.code || result.data.message}`;
    }
    throw new Error(
      actionable(
        `POST /api/runner-filesystem/import-attachment returned HTTP ${result.response.status}. Body: ${formatBody(result.data ?? result.text)}`,
        'Fix attachment staging/import before batch work continues.',
      ),
    );
  });

  await step('negative hosted-mode backend path leak control', async () => {
    const result = await request('/api/storage/browse-fs?path=/');
    if (result.response.status === 409) {
      const body = requireObject(result.data, 'GET /api/storage/browse-fs?path=/');
      if (body.code !== 'backend_local_filesystem_unavailable') {
        throw new Error(`Expected backend_local_filesystem_unavailable; got ${formatBody(body)}`);
      }
      return body.code;
    }
    if (result.response.status === 200) {
      return 'same-host local-dev filesystem gate is enabled; hosted rejection must be covered by route tests or by rerunning with OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=false';
    }
    throw new Error(
      actionable(
        `GET /api/storage/browse-fs?path=/ returned HTTP ${result.response.status}; expected hosted rejection 409 or explicit same-host 200. Body: ${formatBody(result.data ?? result.text)}`,
        'Fix backend-local filesystem gating before batch work continues.',
      ),
    );
  });

  await step('negative executable agent host path route control', async () => {
    const agentId = await chooseAgent();
    if (!agentId) return 'skipped (no agent exists in this dev database)';
    const reference = await request(`/api/agents/${agentId}/files/references`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/', name: 'backend-host-ref', target: process.cwd() }),
    });
    expectStatus(
      reference,
      409,
      `POST /api/agents/${agentId}/files/references`,
      'Legacy backend host-path references must stay rejected for executable agent files.',
    );
    const body = requireObject(reference.data, 'POST agent file references');
    if (body.code !== 'agent_runner_filesystem_required') {
      throw new Error(`Expected agent_runner_filesystem_required; got ${formatBody(body)}`);
    }
    return body.code;
  });

  await step('negative runner path validation', async () => {
    const workspaceId = activeWorkspaceId();
    const result = await request('/api/runner-filesystem/validate-repository-root', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: '',
        ...(workspaceId ? { workspaceId } : {}),
      }),
    });
    if (result.response.status < 400) {
      throw new Error('Expected invalid empty runner path to be rejected, but request succeeded.');
    }
    return `HTTP ${result.response.status}`;
  });

  await step('backend legacy agent DATA_DIR unchanged', async () => {
    if (!legacyAgentFileBaseline) throw new Error('Missing legacy agent DATA_DIR baseline.');
    const output = runCommandRaw(
      'pnpm',
      ['--filter', 'backend', 'no-repository-agent-files:report'],
      'Fix backend startup/database access before proving DATA_DIR agent files are unchanged.',
    );
    const report = extractLastJsonObject(output, 'no-repository-agent-files:report');
    const snapshot = stableLegacyAgentFileSnapshot(report);
    if (JSON.stringify(snapshot) !== JSON.stringify(legacyAgentFileBaseline)) {
      throw new Error(
        `Backend DATA_DIR agent file inventory changed during live acceptance.\nBefore: ${formatBody(legacyAgentFileBaseline)}\nAfter: ${formatBody(snapshot)}`,
      );
    }
    return `unchanged agents=${snapshot.totals?.agents ?? 0} files=${snapshot.totals?.files ?? 0}`;
  });

  console.log('\nLive transition acceptance passed.');
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        backendUrl,
        frontendUrl,
        boardId: board?.id,
        cardId: assignedCardId || null,
        runnerRequired: requireRunner,
        checks: results.map((entry) => ({ name: entry.name, status: entry.status })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('\nLive transition acceptance failed.');
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    JSON.stringify(
      {
        status: 'FAIL',
        backendUrl,
        frontendUrl,
        checks: results,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
