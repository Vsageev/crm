import { store } from '../db/index.js';

type TriggerType = 'chat' | 'cron' | 'card';
type RunStatus = 'running' | 'completed' | 'error';

interface CreateAgentRunParams {
  agentId: string;
  agentName: string;
  triggerType: TriggerType;
  conversationId?: string | null;
  cardId?: string | null;
  cronJobId?: string | null;
}

export function createAgentRun(params: CreateAgentRunParams): Record<string, unknown> {
  return store.insert('agent_runs', {
    agentId: params.agentId,
    agentName: params.agentName,
    triggerType: params.triggerType,
    status: 'running' as RunStatus,
    conversationId: params.conversationId ?? null,
    cardId: params.cardId ?? null,
    cronJobId: params.cronJobId ?? null,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
  });
}

export function completeAgentRun(
  runId: string,
  errorMessage: string | null = null,
  logs?: { stdout?: string; stderr?: string },
) {
  const run = store.getById('agent_runs', runId);
  if (!run) return null;

  const startedAt = new Date(run.startedAt as string).getTime();
  const now = Date.now();
  const durationMs = now - startedAt;

  return store.update('agent_runs', runId, {
    status: errorMessage ? 'error' : 'completed',
    errorMessage,
    finishedAt: new Date().toISOString(),
    durationMs,
    stdout: logs?.stdout ?? (run.stdout as string | null) ?? null,
    stderr: logs?.stderr ?? (run.stderr as string | null) ?? null,
  });
}

export function getAgentRun(runId: string) {
  return store.getById('agent_runs', runId) ?? null;
}

interface ListAgentRunsParams {
  status?: RunStatus;
  agentId?: string;
  limit?: number;
  offset?: number;
}

export function listAgentRuns(params: ListAgentRunsParams = {}) {
  const { status, agentId, limit = 50, offset = 0 } = params;

  const all = store.find('agent_runs', (r: Record<string, unknown>) => {
    if (status && r.status !== status) return false;
    if (agentId && r.agentId !== agentId) return false;
    return true;
  });

  const sorted = all.sort(
    (a: Record<string, unknown>, b: Record<string, unknown>) =>
      new Date(b.startedAt as string).getTime() - new Date(a.startedAt as string).getTime(),
  );

  const entries = sorted.slice(offset, offset + limit);
  return { entries, total: all.length };
}

export function getActiveRuns() {
  return store
    .find('agent_runs', (r: Record<string, unknown>) => r.status === 'running')
    .sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) =>
        new Date(b.startedAt as string).getTime() - new Date(a.startedAt as string).getTime(),
    );
}

export function reconcileStaleRuns() {
  const stale = store.find('agent_runs', (r: Record<string, unknown>) => r.status === 'running');
  for (const run of stale) {
    completeAgentRun(run.id as string, 'Server restarted — run interrupted');
  }
  if (stale.length > 0) {
    console.log(`[agent-runs] Reconciled ${stale.length} stale running record(s)`);
  }
}
