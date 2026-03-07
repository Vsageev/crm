import { store } from '../db/index.js';
import { getAgent } from './agents.js';
import { executeCardTask } from './agent-chat.js';
import { killAgentRun } from './agent-runs.js';

const AGENT_BATCH_RUN_COLLECTION = 'agentBatchRuns';
const AGENT_BATCH_ITEM_COLLECTION = 'agentBatchRunItems';
const AGENT_BATCH_DEFAULT_MAX_PARALLEL = 3;
const AGENT_BATCH_MAX_PARALLEL_LIMIT = 20;
const AGENT_BATCH_RETRY_BASE_MS = 1000;
const AGENT_BATCH_RETRY_MAX_MS = 30000;
const AGENT_BATCH_DEFAULT_MAX_ATTEMPTS = 4;
const AGENT_BATCH_HISTORY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const AGENT_BATCH_PROCESSING_STALE_MS = 2 * 60 * 1000;

export type AgentBatchSourceType = 'board' | 'collection';
export type AgentBatchRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentBatchItemStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type AgentBatchRunFilterStatus = AgentBatchRunStatus | 'active';

interface QueueDrainTimer {
  timer: ReturnType<typeof setTimeout>;
  dueAt: number;
}

export interface AgentBatchCardSnapshot {
  id: string;
  name: string;
  description: string | null;
  collectionId: string;
}

export interface EnqueueAgentBatchRunOptions {
  sourceType: AgentBatchSourceType;
  sourceId: string;
  sourceName?: string | null;
  agentId: string;
  prompt: string;
  maxParallel?: number;
  cards: AgentBatchCardSnapshot[];
}

export interface AgentBatchStartResult {
  runId: string | null;
  status: AgentBatchRunStatus | null;
  total: number;
  queued: number;
  message: string;
}

export interface ListAgentBatchRunsOptions {
  sourceType?: AgentBatchSourceType;
  sourceId?: string;
  agentId?: string;
  status?: AgentBatchRunFilterStatus;
  limit?: number;
  offset?: number;
}

function enrichBatchRun(run: Record<string, unknown>) {
  const agentId = typeof run.agentId === 'string' ? run.agentId : null;
  const agent = agentId ? getAgent(agentId) : null;
  return {
    ...run,
    agentName:
      typeof run.agentName === 'string' && run.agentName
        ? run.agentName
        : agent?.name ?? null,
    avatarIcon:
      typeof run.avatarIcon === 'string' && run.avatarIcon
        ? run.avatarIcon
        : agent?.avatarIcon ?? null,
    avatarBgColor:
      typeof run.avatarBgColor === 'string' && run.avatarBgColor
        ? run.avatarBgColor
        : agent?.avatarBgColor ?? null,
    avatarLogoColor:
      typeof run.avatarLogoColor === 'string' && run.avatarLogoColor
        ? run.avatarLogoColor
        : agent?.avatarLogoColor ?? null,
  };
}

export interface ListAgentBatchRunItemsOptions {
  status?: AgentBatchItemStatus;
  limit?: number;
  offset?: number;
}

const runProcessors = new Set<string>();
const runDrainTimers = new Map<string, QueueDrainTimer>();

function parseIsoDateMs(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function normalizeMaxParallel(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return AGENT_BATCH_DEFAULT_MAX_PARALLEL;
  return Math.min(AGENT_BATCH_MAX_PARALLEL_LIMIT, Math.floor(parsed));
}

function normalizeAttemptCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
}

function normalizeMaxAttempts(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return AGENT_BATCH_DEFAULT_MAX_ATTEMPTS;
  return Math.floor(parsed);
}

function getItemRetryDelayMs(attempt: number): number {
  return Math.min(
    AGENT_BATCH_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    AGENT_BATCH_RETRY_MAX_MS,
  );
}

function listItemsForRun(runId: string): Record<string, unknown>[] {
  return store
    .find(AGENT_BATCH_ITEM_COLLECTION, (r: Record<string, unknown>) => r.runId === runId)
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const orderA = Number(a.order ?? Number.MAX_SAFE_INTEGER);
      const orderB = Number(b.order ?? Number.MAX_SAFE_INTEGER);
      if (orderA !== orderB) return orderA - orderB;
      return parseIsoDateMs(a.createdAt) - parseIsoDateMs(b.createdAt);
    });
}

function countItemsByStatus(
  runId: string,
): Record<AgentBatchItemStatus, number> & { total: number } {
  const items = listItemsForRun(runId);
  const result = {
    total: items.length,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const item of items) {
    const status = item.status;
    if (status === 'queued') result.queued += 1;
    if (status === 'processing') result.processing += 1;
    if (status === 'completed') result.completed += 1;
    if (status === 'failed') result.failed += 1;
    if (status === 'cancelled') result.cancelled += 1;
  }

  return result;
}

function computeRunStatus(
  run: Record<string, unknown>,
  counts: ReturnType<typeof countItemsByStatus>,
): AgentBatchRunStatus {
  const current = run.status as AgentBatchRunStatus | undefined;
  const finished = counts.completed + counts.failed + counts.cancelled;
  if (current === 'cancelled' && counts.processing > 0) return 'cancelled';
  if (counts.total === 0 || finished >= counts.total) {
    if (current === 'cancelled') return 'cancelled';
    if (counts.failed > 0) return 'failed';
    if (counts.cancelled === counts.total) return 'cancelled';
    return 'completed';
  }
  if (counts.processing > 0 || finished > 0) return 'running';
  return 'queued';
}

function refreshRunStats(runId: string): Record<string, unknown> | null {
  const run = store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
  if (!run) return null;

  const counts = countItemsByStatus(runId);
  const nextStatus = computeRunStatus(run, counts);
  const patch: Record<string, unknown> = {
    status: nextStatus,
    total: counts.total,
    queued: counts.queued,
    processing: counts.processing,
    completed: counts.completed,
    failed: counts.failed,
    cancelled: counts.cancelled,
  };

  if (nextStatus === 'running') {
    patch.startedAt = run.startedAt ?? new Date().toISOString();
    patch.finishedAt = null;
  }
  if (nextStatus === 'queued') {
    patch.startedAt = run.startedAt ?? null;
    patch.finishedAt = null;
  }
  if (nextStatus === 'completed' || nextStatus === 'failed' || nextStatus === 'cancelled') {
    patch.startedAt = run.startedAt ?? new Date().toISOString();
    const isFullySettled = counts.queued === 0 && counts.processing === 0;
    patch.finishedAt = isFullySettled ? (run.finishedAt ?? new Date().toISOString()) : null;
  }

  return store.update(AGENT_BATCH_RUN_COLLECTION, runId, patch);
}

function getNextReadyDelayMs(runId: string): number | null {
  const queuedItems = listItemsForRun(runId).filter((item) => item.status === 'queued');
  if (queuedItems.length === 0) return null;

  const now = Date.now();
  let earliest = Number.POSITIVE_INFINITY;
  for (const item of queuedItems) {
    const nextAttemptAtMs = parseIsoDateMs(item.nextAttemptAt);
    if (!Number.isFinite(nextAttemptAtMs)) return 0;
    if (nextAttemptAtMs <= now) return 0;
    earliest = Math.min(earliest, nextAttemptAtMs);
  }

  if (!Number.isFinite(earliest)) return 0;
  return Math.max(0, earliest - now);
}

function clearRunDrainTimer(runId: string) {
  const existing = runDrainTimers.get(runId);
  if (!existing) return;
  clearTimeout(existing.timer);
  runDrainTimers.delete(runId);
}

function scheduleRunDrain(runId: string, delayMs: number) {
  const safeDelay = Math.max(0, delayMs);
  const dueAt = Date.now() + safeDelay;
  const existing = runDrainTimers.get(runId);
  if (existing && existing.dueAt <= dueAt) return;

  if (existing) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    runDrainTimers.delete(runId);
    void drainBatchRun(runId);
  }, safeDelay);
  timer.unref();
  runDrainTimers.set(runId, { timer, dueAt });
}

function markItemCompleted(itemId: string) {
  store.update(AGENT_BATCH_ITEM_COLLECTION, itemId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    nextAttemptAt: null,
    errorMessage: null,
  });
}

function markItemCancelled(itemId: string, errorMessage = 'Cancelled by user') {
  store.update(AGENT_BATCH_ITEM_COLLECTION, itemId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
    nextAttemptAt: null,
    errorMessage,
  });
}

function retryOrFailItem(
  item: Record<string, unknown>,
  errorMessage: string,
) {
  const itemId = item.id as string;
  const attemptsUsed = normalizeAttemptCount(item.attempts);
  const maxAttempts = normalizeMaxAttempts(item.maxAttempts);

  if (attemptsUsed < maxAttempts) {
    const retryDelayMs = getItemRetryDelayMs(attemptsUsed);
    store.update(AGENT_BATCH_ITEM_COLLECTION, itemId, {
      status: 'queued',
      completedAt: null,
      errorMessage,
      nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString(),
      agentRunId: null,
    });
    return;
  }

  store.update(AGENT_BATCH_ITEM_COLLECTION, itemId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    nextAttemptAt: null,
    errorMessage,
  });
}

function reconcileProcessingItems(runId: string) {
  const run = store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
  if (!run) return;

  const now = Date.now();
  const runCancelled = run.status === 'cancelled';
  const processingItems = listItemsForRun(runId).filter((item) => item.status === 'processing');

  for (const item of processingItems) {
    const itemId = item.id as string;
    const agentRunId =
      typeof item.agentRunId === 'string' && item.agentRunId ? item.agentRunId : null;

    if (runCancelled) {
      if (agentRunId) {
        killAgentRun(agentRunId);
      }
      markItemCancelled(itemId);
      continue;
    }

    if (!agentRunId) {
      const startedAtMs = parseIsoDateMs(item.startedAt);
      if (Number.isFinite(startedAtMs) && now - startedAtMs >= AGENT_BATCH_PROCESSING_STALE_MS) {
        retryOrFailItem(item, 'Batch item lost run reference after restart');
      }
      continue;
    }

    const runRecord = store.getById('agent_runs', agentRunId);
    if (!runRecord) {
      const startedAtMs = parseIsoDateMs(item.startedAt);
      if (Number.isFinite(startedAtMs) && now - startedAtMs >= AGENT_BATCH_PROCESSING_STALE_MS) {
        retryOrFailItem(item, 'Batch item run record not found');
      }
      continue;
    }

    if (runRecord.status === 'running') continue;

    if (runRecord.killedByUser === true || runRecord.errorMessage === 'Killed by user') {
      markItemCancelled(itemId);
      continue;
    }

    if (runRecord.status === 'completed') {
      markItemCompleted(itemId);
      continue;
    }

    const errorMessage =
      typeof runRecord.errorMessage === 'string' && runRecord.errorMessage
        ? runRecord.errorMessage
        : 'Batch item failed';
    retryOrFailItem(item, errorMessage);
  }
}

function startBatchItem(runId: string, item: Record<string, unknown>) {
  const latestRun = store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
  if (!latestRun) return;
  if (latestRun.status === 'cancelled') {
    markItemCancelled(item.id as string);
    return;
  }

  const itemId = item.id as string;
  const attempts = Number(item.attempts ?? 0);
  const agentId =
    typeof latestRun.agentId === 'string' && latestRun.agentId ? latestRun.agentId : null;
  const prompt =
    typeof latestRun.prompt === 'string' && latestRun.prompt.trim()
      ? latestRun.prompt.trim()
      : null;
  const cardId = typeof item.cardId === 'string' ? item.cardId : null;
  const cardName = typeof item.cardName === 'string' ? item.cardName : null;
  const cardCollectionId =
    typeof item.cardCollectionId === 'string' ? item.cardCollectionId : null;
  const cardDescription =
    typeof item.cardDescription === 'string' ? item.cardDescription : null;

  if (!agentId || !prompt || !cardId || !cardName || !cardCollectionId) {
    store.update(AGENT_BATCH_ITEM_COLLECTION, itemId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      nextAttemptAt: null,
      errorMessage: 'Batch item is missing required fields',
    });
    return;
  }

  store.update(AGENT_BATCH_ITEM_COLLECTION, itemId, {
    status: 'processing',
    attempts: attempts + 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    nextAttemptAt: null,
    errorMessage: null,
    agentRunId: null,
  });
  store.update(AGENT_BATCH_RUN_COLLECTION, runId, {
    status: 'running',
    startedAt: latestRun.startedAt ?? new Date().toISOString(),
  });

  executeCardTask(
    agentId,
    {
      id: cardId,
      name: cardName,
      description: cardDescription,
      collectionId: cardCollectionId,
    },
    {
      onRunCreated: (agentRunId) => {
        const latest = store.getById(AGENT_BATCH_ITEM_COLLECTION, itemId);
        if (!latest || latest.status !== 'processing') return;
        store.update(AGENT_BATCH_ITEM_COLLECTION, itemId, { agentRunId });
      },
      onDone: () => {
        const latest = store.getById(AGENT_BATCH_ITEM_COLLECTION, itemId);
        if (!latest || latest.status !== 'processing') {
          scheduleRunDrain(runId, 0);
          return;
        }
        markItemCompleted(itemId);
        scheduleRunDrain(runId, 0);
      },
      onError: (err) => {
        const latest = store.getById(AGENT_BATCH_ITEM_COLLECTION, itemId);
        if (!latest || latest.status !== 'processing') {
          scheduleRunDrain(runId, 0);
          return;
        }

        const latestRunRecord = store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
        if (!latestRunRecord) return;
        if (latestRunRecord.status === 'cancelled') {
          markItemCancelled(itemId);
          scheduleRunDrain(runId, 0);
          return;
        }

        retryOrFailItem(latest, err);
        scheduleRunDrain(runId, 0);
      },
    },
    prompt,
  );
}

async function drainBatchRun(runId: string): Promise<void> {
  if (runProcessors.has(runId)) return;
  runProcessors.add(runId);

  try {
    while (true) {
      const run = store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
      if (!run) {
        clearRunDrainTimer(runId);
        return;
      }

      reconcileProcessingItems(runId);
      const refreshedRun = refreshRunStats(runId);
      if (!refreshedRun) {
        clearRunDrainTimer(runId);
        return;
      }

      if (refreshedRun.status === 'cancelled') {
        const queuedItems = listItemsForRun(runId).filter((item) => item.status === 'queued');
        for (const item of queuedItems) {
          markItemCancelled(item.id as string);
        }
        const finalRun = refreshRunStats(runId);
        const processingCount = Number(finalRun?.processing ?? 0);
        if (processingCount > 0) {
          scheduleRunDrain(runId, 1000);
        } else {
          clearRunDrainTimer(runId);
        }
        return;
      }

      const maxParallel = normalizeMaxParallel(refreshedRun.maxParallel);
      const processingCount = Number(refreshedRun.processing ?? 0);
      const availableSlots = Math.max(0, maxParallel - processingCount);

      if (availableSlots <= 0) {
        scheduleRunDrain(runId, 1000);
        return;
      }

      const readyItems = listItemsForRun(runId).filter((item) => {
        if (item.status !== 'queued') return false;
        const nextAttemptAtMs = parseIsoDateMs(item.nextAttemptAt);
        return !Number.isFinite(nextAttemptAtMs) || nextAttemptAtMs <= Date.now();
      });

      if (readyItems.length === 0) {
        const latestRun = refreshRunStats(runId);
        const stillProcessing = Number(latestRun?.processing ?? 0);
        const nextDelayMs = getNextReadyDelayMs(runId);
        if (nextDelayMs !== null) {
          scheduleRunDrain(runId, nextDelayMs);
        } else if (stillProcessing > 0) {
          scheduleRunDrain(runId, 1000);
        } else {
          clearRunDrainTimer(runId);
        }
        return;
      }

      for (const item of readyItems.slice(0, availableSlots)) {
        startBatchItem(runId, item);
      }
    }
  } finally {
    runProcessors.delete(runId);
  }
}

export function cleanupFinishedBatchRuns(): number {
  const finishedRuns = store.find(AGENT_BATCH_RUN_COLLECTION, (r: Record<string, unknown>) => {
    return r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled';
  });

  for (const run of finishedRuns) {
    const runId = run.id as string;
    store.deleteWhere(
      AGENT_BATCH_ITEM_COLLECTION,
      (item: Record<string, unknown>) => item.runId === runId,
    );
    clearRunDrainTimer(runId);
    store.delete(AGENT_BATCH_RUN_COLLECTION, runId);
  }

  return finishedRuns.length;
}

function pruneBatchHistory() {
  const now = Date.now();
  const staleRuns = store.find(AGENT_BATCH_RUN_COLLECTION, (r: Record<string, unknown>) => {
    if (r.status !== 'completed' && r.status !== 'failed' && r.status !== 'cancelled') return false;
    const finishedAtMs = parseIsoDateMs(r.finishedAt);
    if (!Number.isFinite(finishedAtMs)) return false;
    return now - finishedAtMs > AGENT_BATCH_HISTORY_RETENTION_MS;
  });

  for (const run of staleRuns) {
    const runId = run.id as string;
    store.deleteWhere(
      AGENT_BATCH_ITEM_COLLECTION,
      (item: Record<string, unknown>) => item.runId === runId,
    );
    clearRunDrainTimer(runId);
    store.delete(AGENT_BATCH_RUN_COLLECTION, runId);
  }
}

export function initializeAgentBatchQueue(options: { preserveActiveProcessing?: boolean } = {}) {
  const { preserveActiveProcessing = false } = options;
  pruneBatchHistory();

  const processingItems = store.find(
    AGENT_BATCH_ITEM_COLLECTION,
    (r: Record<string, unknown>) => r.status === 'processing',
  );

  for (const item of processingItems) {
    const runId = typeof item.runId === 'string' ? item.runId : null;
    if (!runId) continue;

    const agentRunId =
      typeof item.agentRunId === 'string' && item.agentRunId ? item.agentRunId : null;
    if (!agentRunId) {
      retryOrFailItem(item, 'Recovered from backend restart');
      continue;
    }

    const runRecord = store.getById('agent_runs', agentRunId);
    if (!runRecord) {
      retryOrFailItem(item, 'Recovered from backend restart');
      continue;
    }

    if (runRecord.status === 'running' && preserveActiveProcessing) {
      continue;
    }
    if (runRecord.status === 'completed') {
      markItemCompleted(item.id as string);
      continue;
    }
    if (runRecord.killedByUser === true || runRecord.errorMessage === 'Killed by user') {
      markItemCancelled(item.id as string);
      continue;
    }
    const errorMessage =
      typeof runRecord.errorMessage === 'string' && runRecord.errorMessage
        ? runRecord.errorMessage
        : 'Recovered from backend restart';
    retryOrFailItem(item, errorMessage);
  }

  const runIds = new Set<string>();
  const pendingItems = store.find(
    AGENT_BATCH_ITEM_COLLECTION,
    (r: Record<string, unknown>) => r.status === 'queued' || r.status === 'processing',
  );
  for (const item of pendingItems) {
    if (typeof item.runId !== 'string') continue;
    runIds.add(item.runId);
  }

  for (const runId of runIds) {
    refreshRunStats(runId);
    scheduleRunDrain(runId, 0);
  }
}

export function enqueueAgentBatchRun(options: EnqueueAgentBatchRunOptions): AgentBatchStartResult {
  const {
    sourceType,
    sourceId,
    sourceName = null,
    agentId,
    prompt,
    cards,
  } = options;
  const maxParallel = normalizeMaxParallel(options.maxParallel);
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error('Prompt is required');
  }
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error('Agent not found');
  }
  if (cards.length === 0) {
    return {
      runId: null,
      status: null,
      total: 0,
      queued: 0,
      message: 'No cards matched the batch scope',
    };
  }

  pruneBatchHistory();

  const run = store.insert(AGENT_BATCH_RUN_COLLECTION, {
    sourceType,
    sourceId,
    sourceName,
    agentId,
    prompt: trimmedPrompt,
    maxParallel,
    status: 'queued' as AgentBatchRunStatus,
    total: cards.length,
    queued: cards.length,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
  });

  const nowIso = new Date().toISOString();
  const itemsToInsert = cards.map((card, index) => ({
    runId: run.id,
    sourceType,
    sourceId,
    agentId,
    cardId: card.id,
    cardName: card.name,
    cardDescription: card.description,
    cardCollectionId: card.collectionId,
    order: index,
    status: 'queued' as AgentBatchItemStatus,
    attempts: 0,
    maxAttempts: AGENT_BATCH_DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: nowIso,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    agentRunId: null,
  }));
  store.insertMany(AGENT_BATCH_ITEM_COLLECTION, itemsToInsert);

  refreshRunStats(run.id as string);
  scheduleRunDrain(run.id as string, 0);

  return {
    runId: run.id as string,
    status: 'queued',
    total: cards.length,
    queued: cards.length,
    message: `Batch queued: ${cards.length} card(s), max parallel ${maxParallel}`,
  };
}

export function listAgentBatchRuns(options: ListAgentBatchRunsOptions = {}) {
  const { sourceType, sourceId, agentId, status, limit = 50, offset = 0 } = options;

  const all = store.find(AGENT_BATCH_RUN_COLLECTION, (r: Record<string, unknown>) => {
    if (sourceType && r.sourceType !== sourceType) return false;
    if (sourceId && r.sourceId !== sourceId) return false;
    if (agentId && r.agentId !== agentId) return false;
    return true;
  });

  const refreshed = all.map((run) => refreshRunStats(run.id as string) ?? run);
  const filtered = refreshed.filter((run) => {
    if (!status) return true;
    if (status === 'active') {
      return run.status === 'queued' || run.status === 'running';
    }
    return run.status === status;
  });
  const sorted = filtered.sort((a, b) => {
    const aTime = parseIsoDateMs(a.startedAt);
    const bTime = parseIsoDateMs(b.startedAt);
    if (Number.isFinite(aTime) || Number.isFinite(bTime)) {
      const safeA = Number.isFinite(aTime) ? aTime : 0;
      const safeB = Number.isFinite(bTime) ? bTime : 0;
      if (safeB !== safeA) return safeB - safeA;
    }
    return parseIsoDateMs(b.createdAt) - parseIsoDateMs(a.createdAt);
  });

  const entries = sorted.slice(offset, offset + limit).map(enrichBatchRun);
  return { entries, total: sorted.length };
}

export function getAgentBatchRun(runId: string): Record<string, unknown> | null {
  return refreshRunStats(runId) ?? store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
}

export function listAgentBatchRunItems(
  runId: string,
  options: ListAgentBatchRunItemsOptions = {},
) {
  const { status, limit = 100, offset = 0 } = options;
  const run = store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
  if (!run) return { entries: [], total: 0 };

  const all = listItemsForRun(runId).filter((item) => {
    if (status && item.status !== status) return false;
    return true;
  });

  const entries = all.slice(offset, offset + limit);
  return { entries, total: all.length };
}

export function cancelAgentBatchRun(
  runId: string,
  reason = 'Cancelled by user',
): Record<string, unknown> | null {
  const run = store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
  if (!run) return null;

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return refreshRunStats(runId) ?? run;
  }

  store.update(AGENT_BATCH_RUN_COLLECTION, runId, {
    status: 'cancelled',
    errorMessage: reason,
  });

  const queuedItems = listItemsForRun(runId).filter((item) => item.status === 'queued');
  for (const item of queuedItems) {
    markItemCancelled(item.id as string, reason);
  }

  const processingItems = listItemsForRun(runId).filter((item) => item.status === 'processing');
  for (const item of processingItems) {
    const agentRunId =
      typeof item.agentRunId === 'string' && item.agentRunId ? item.agentRunId : null;
    if (agentRunId) {
      killAgentRun(agentRunId);
    } else {
      markItemCancelled(item.id as string, reason);
    }
  }

  scheduleRunDrain(runId, 0);
  return refreshRunStats(runId) ?? store.getById(AGENT_BATCH_RUN_COLLECTION, runId);
}
