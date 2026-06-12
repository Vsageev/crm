import { store } from '../db/index.js';
import {
  AGENT_BATCH_RUN_ITEMS_COLLECTION,
  AGENT_BATCH_RUNS_COLLECTION,
  AGENT_RUNS_COLLECTION,
  deleteBatchRunItemsForRun,
  EXECUTION_ATTEMPTS_COLLECTION,
  EXECUTION_EVENTS_COLLECTION,
  EXECUTION_JOBS_COLLECTION,
  findBatchRunItemsQueuedOrProcessingNative,
  findBatchRunItemsWithStatusNative,
  findBatchRunsEligibleForHistoryPrune,
  findTerminalBatchRuns,
  getAgentRunByIdNative,
  listAgentBatchRunsMatching,
  listOrderedBatchRunItemsForRun,
} from '../db/repositories/agent-execution-repository.js';
import { ApiError } from '../utils/api-errors.js';
import { getAgent, isAgentArchived } from './agents.js';
import { AgentChatError, executeCardTask, preflightAgentRunner } from './agent-chat.js';
import { killAgentRun } from './agent-runs.js';

const AGENT_BATCH_DEFAULT_MAX_PARALLEL = 3;
const AGENT_BATCH_MAX_PARALLEL_LIMIT = 20;
const AGENT_BATCH_RETRY_BASE_MS = 1000;
const AGENT_BATCH_RETRY_MAX_MS = 30000;
const AGENT_BATCH_DEFAULT_MAX_ATTEMPTS = 4;
const AGENT_BATCH_HISTORY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const AGENT_BATCH_PROCESSING_STALE_MS = 2 * 60 * 1000;
const AGENT_BATCH_CARD_CONTENTION_RETRY_MS = AGENT_BATCH_PROCESSING_STALE_MS;

export type AgentBatchSourceType = 'board' | 'collection';
export type AgentBatchRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentBatchItemStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';
export type AgentBatchRunFilterStatus = AgentBatchRunStatus | 'active';
export type AgentBatchBlockingMode = 'all_success' | 'all_settled';
type ExecutionJobStatus = 'queued' | 'dispatching' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type ExecutionAttemptStatus = 'dispatching' | 'running' | 'succeeded' | 'failed' | 'cancelled';

function isInFlightExecutionJobStatus(status: ExecutionJobStatus | undefined): boolean {
  return status === 'running' || status === 'dispatching' || status === 'queued';
}

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

export interface AgentBatchStageInput {
  id?: string;
  cardIds: string[];
  dependsOnStageIds?: string[];
  dependsOnStageIndexes?: number[];
  blockingMode?: AgentBatchBlockingMode;
}

export interface AgentBatchCardDependencyInput {
  cardId: string;
  dependsOnCardIds: string[];
  blockingMode?: AgentBatchBlockingMode;
}

export interface EnqueueAgentBatchRunOptions {
  sourceType: AgentBatchSourceType;
  sourceId: string;
  sourceName?: string | null;
  agentId: string;
  prompt?: string;
  maxParallel?: number;
  cards: AgentBatchCardSnapshot[];
  stages?: AgentBatchStageInput[];
  cardDependencies?: AgentBatchCardDependencyInput[];
  activationActorId?: string | null;
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

const TERMINAL_BATCH_ITEM_STATUSES = new Set<AgentBatchItemStatus>([
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);

function normalizeBlockingMode(value: unknown): AgentBatchBlockingMode {
  return value === 'all_settled' ? 'all_settled' : 'all_success';
}

function getItemDependencyIds(item: Record<string, unknown>): string[] {
  if (!Array.isArray(item.dependsOnItemIds)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of item.dependsOnItemIds) {
    if (typeof value !== 'string' || !value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function getItemBlockingMode(item: Record<string, unknown>): AgentBatchBlockingMode {
  return normalizeBlockingMode(item.blockingMode);
}

function getItemLabel(item: Record<string, unknown> | null | undefined, fallbackId: string): string {
  if (item && typeof item.cardName === 'string' && item.cardName.trim()) {
    return item.cardName.trim();
  }
  return fallbackId;
}

function describeDependencyState(
  item: Record<string, unknown>,
  itemsById: Map<string, Record<string, unknown>>,
): { kind: 'ready' | 'waiting' | 'blocked'; blockedReason: string | null } {
  const dependencyIds = getItemDependencyIds(item);
  if (dependencyIds.length === 0) {
    return { kind: 'ready', blockedReason: null };
  }

  const waiting: string[] = [];
  const blocked: string[] = [];
  const blockingMode = getItemBlockingMode(item);

  for (const dependencyId of dependencyIds) {
    const dependency = itemsById.get(dependencyId);
    if (!dependency) {
      blocked.push(`missing dependency ${dependencyId}`);
      continue;
    }

    const status = dependency.status as AgentBatchItemStatus | undefined;
    if (blockingMode === 'all_settled') {
      if (status && TERMINAL_BATCH_ITEM_STATUSES.has(status)) continue;
      waiting.push(getItemLabel(dependency, dependencyId));
      continue;
    }

    if (status === 'completed') continue;
    if (status && TERMINAL_BATCH_ITEM_STATUSES.has(status)) {
      blocked.push(getItemLabel(dependency, dependencyId));
      continue;
    }
    waiting.push(getItemLabel(dependency, dependencyId));
  }

  if (blocked.length > 0) {
    return {
      kind: 'blocked',
      blockedReason: `Blocked by dependency failure: ${blocked.join(', ')}`,
    };
  }
  if (waiting.length > 0) {
    return {
      kind: 'waiting',
      blockedReason: `Waiting on: ${waiting.join(', ')}`,
    };
  }
  return { kind: 'ready', blockedReason: null };
}

interface ResolvedBatchDependencies {
  dependsOnCardIdsByCardId: Map<string, string[]>;
  blockingModeByCardId: Map<string, AgentBatchBlockingMode>;
  stageIdByCardId: Map<string, string>;
  stageCount: number;
}

function buildResolvedBatchDependencies(
  cards: AgentBatchCardSnapshot[],
  stages: AgentBatchStageInput[] = [],
  cardDependencies: AgentBatchCardDependencyInput[] = [],
): ResolvedBatchDependencies {
  const cardIds = new Set(cards.map((card) => card.id));
  const dependsOnCardIdsByCardId = new Map<string, Set<string>>();
  const blockingModeByCardId = new Map<string, AgentBatchBlockingMode>();
  const stageIdByCardId = new Map<string, string>();

  const ensureCardKnown = (cardId: string, context: string) => {
    if (!cardIds.has(cardId)) {
      throw new Error(`${context}: unknown card ${cardId}`);
    }
  };

  const setBlockingMode = (cardId: string, nextMode: AgentBatchBlockingMode) => {
    const existing = blockingModeByCardId.get(cardId);
    if (existing && existing !== nextMode) {
      throw new Error(`Conflicting blocking modes for card ${cardId}`);
    }
    blockingModeByCardId.set(cardId, nextMode);
  };

  const addDependencies = (
    cardId: string,
    dependencyIds: string[],
    blockingMode: AgentBatchBlockingMode,
  ) => {
    ensureCardKnown(cardId, 'Batch dependency');
    const nextDependencies = dependsOnCardIdsByCardId.get(cardId) ?? new Set<string>();
    for (const dependencyId of dependencyIds) {
      ensureCardKnown(dependencyId, `Dependencies for ${cardId}`);
      if (dependencyId === cardId) {
        throw new Error(`Card ${cardId} cannot depend on itself`);
      }
      nextDependencies.add(dependencyId);
    }
    dependsOnCardIdsByCardId.set(cardId, nextDependencies);
    if (nextDependencies.size > 0) {
      setBlockingMode(cardId, blockingMode);
    }
  };

  if (stages.length > 0) {
    const stageIds = new Set<string>();
    const normalizedStages = stages.map((stage, index) => {
      const stageId = stage.id?.trim() || `stage-${index + 1}`;
      if (stageIds.has(stageId)) {
        throw new Error(`Duplicate batch stage id: ${stageId}`);
      }
      stageIds.add(stageId);

      const stageCardIds: string[] = [];
      const seenStageCardIds = new Set<string>();
      for (const cardId of stage.cardIds) {
        if (typeof cardId !== 'string' || !cardId) continue;
        ensureCardKnown(cardId, `Stage ${stageId}`);
        if (seenStageCardIds.has(cardId)) continue;
        if (stageIdByCardId.has(cardId)) {
          throw new Error(`Card ${cardId} is assigned to multiple stages`);
        }
        seenStageCardIds.add(cardId);
        stageCardIds.push(cardId);
        stageIdByCardId.set(cardId, stageId);
      }

      if (stageCardIds.length === 0) {
        throw new Error(`Stage ${stageId} must include at least one card`);
      }

      return {
        id: stageId,
        cardIds: stageCardIds,
        dependsOnStageIds: stage.dependsOnStageIds,
        dependsOnStageIndexes: stage.dependsOnStageIndexes,
        blockingMode: normalizeBlockingMode(stage.blockingMode),
      };
    });

    const stageById = new Map(normalizedStages.map((stage) => [stage.id, stage]));

    for (let index = 0; index < normalizedStages.length; index += 1) {
      const stage = normalizedStages[index];
      const explicitStageIds =
        stage.dependsOnStageIds !== undefined
          ? stage.dependsOnStageIds
          : stage.dependsOnStageIndexes !== undefined
            ? stage.dependsOnStageIndexes.map((stageIndex) => {
                if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= normalizedStages.length) {
                  throw new Error(`Stage ${stage.id} references invalid stage index ${stageIndex}`);
                }
                return normalizedStages[stageIndex].id;
              })
            : index > 0
              ? [normalizedStages[index - 1].id]
              : [];

      const dependencyCardIds = new Set<string>();
      for (const dependencyStageId of explicitStageIds) {
        const dependencyStage = stageById.get(dependencyStageId);
        if (!dependencyStage) {
          throw new Error(`Stage ${stage.id} references unknown stage ${dependencyStageId}`);
        }
        if (dependencyStage.id === stage.id) {
          throw new Error(`Stage ${stage.id} cannot depend on itself`);
        }
        for (const dependencyCardId of dependencyStage.cardIds) {
          dependencyCardIds.add(dependencyCardId);
        }
      }

      for (const cardId of stage.cardIds) {
        addDependencies(cardId, [...dependencyCardIds], stage.blockingMode);
      }
    }
  }

  for (const dependency of cardDependencies) {
    const cardId = dependency.cardId;
    const blockingMode = normalizeBlockingMode(dependency.blockingMode);
    addDependencies(cardId, dependency.dependsOnCardIds, blockingMode);
  }

  const cardGraph = new Map<string, string[]>();
  for (const card of cards) {
    cardGraph.set(card.id, [...(dependsOnCardIdsByCardId.get(card.id) ?? new Set<string>())]);
  }

  const state = new Map<string, 'visiting' | 'visited'>();
  const visit = (cardId: string) => {
    const current = state.get(cardId);
    if (current === 'visiting') {
      throw new Error(`Batch dependencies contain a cycle involving card ${cardId}`);
    }
    if (current === 'visited') return;
    state.set(cardId, 'visiting');
    for (const dependencyId of cardGraph.get(cardId) ?? []) {
      visit(dependencyId);
    }
    state.set(cardId, 'visited');
  };
  for (const card of cards) {
    visit(card.id);
  }

  return {
    dependsOnCardIdsByCardId: new Map(
      [...dependsOnCardIdsByCardId.entries()].map(([cardId, dependencyIds]) => [
        cardId,
        [...dependencyIds],
      ]),
    ),
    blockingModeByCardId,
    stageIdByCardId,
    stageCount: stages.length,
  };
}

const runProcessors = new Set<string>();
const runDrainTimers = new Map<string, QueueDrainTimer>();
/** Batch item IDs with a live executeCardTask dispatch in this process. */
const activeBatchItemDispatches = new Set<string>();

function hasActiveBatchItemDispatch(itemId: string): boolean {
  return activeBatchItemDispatches.has(itemId);
}

function releaseBatchItemDispatch(itemId: string) {
  activeBatchItemDispatches.delete(itemId);
}

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

function toApiError(error: AgentChatError): ApiError {
  if (error.statusCode === 404) {
    return ApiError.notFound(error.code, error.message, error.hint);
  }
  if (error.statusCode === 409) {
    return ApiError.conflict(error.code, error.message, error.hint);
  }
  if (error.statusCode === 403) {
    return ApiError.forbidden(error.code, error.message, error.hint);
  }
  return ApiError.badRequest(error.code, error.message, error.hint);
}

function assertAgentRunnerAvailableForBatch(
  agentId: string,
  activationActorId?: string | null,
): void {
  try {
    preflightAgentRunner(agentId, { activationActorId });
  } catch (error) {
    if (error instanceof AgentChatError) throw toApiError(error);
    throw error;
  }
}

function getItemRetryDelayMs(attempt: number): number {
  return Math.min(
    AGENT_BATCH_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
    AGENT_BATCH_RETRY_MAX_MS,
  );
}

function isCardAlreadyProcessingError(errorMessage: string): boolean {
  return errorMessage.trim().toLowerCase() === 'agent is already processing this card';
}

function listItemsForRun(runId: string): Record<string, unknown>[] {
  return listOrderedBatchRunItemsForRun(runId) as Record<string, unknown>[];
}

function listAttemptsForJob(jobId: string): Record<string, unknown>[] {
  return store
    .getAll(EXECUTION_ATTEMPTS_COLLECTION)
    .filter((attempt) => attempt.jobId === jobId)
    .sort((a, b) => Number(a.attemptIndex ?? 0) - Number(b.attemptIndex ?? 0));
}

function appendExecutionEvent(
  jobId: string,
  type: string,
  payload: Record<string, unknown>,
  attemptId: string | null = null,
) {
  store.insert(EXECUTION_EVENTS_COLLECTION, {
    jobId,
    attemptId,
    type,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function getOrCreateBatchExecutionJob(params: {
  runId: string;
  item: Record<string, unknown>;
  agentId: string;
  cardId: string;
  attemptNumber: number;
}): Record<string, unknown> {
  const ownerId = String(params.item.id);
  const idempotencyKey = `agent-batch-item:${params.runId}:${ownerId}:attempt:${params.attemptNumber}`;
  const existing = store
    .getAll(EXECUTION_JOBS_COLLECTION)
    .find((job) => job.idempotencyKey === idempotencyKey);
  if (existing) return existing;

  const nowIso = new Date().toISOString();
  const job = store.insert(EXECUTION_JOBS_COLLECTION, {
    ownerType: 'batch_item',
    ownerId,
    agentId: params.agentId,
    targetType: 'card',
    targetId: params.cardId,
    status: 'dispatching' satisfies ExecutionJobStatus,
    policySnapshot: {
      engine: 'agent_batch_card_execution',
      batchRunId: params.runId,
      batchItemId: ownerId,
      retryAttempt: params.attemptNumber,
      fallback: 'owned_by_executeCardTask_compatibility_wrapper',
    },
    activeAttemptId: null,
    idempotencyKey,
    startedAt: nowIso,
    finishedAt: null,
    errorMessage: null,
  });
  appendExecutionEvent(job.id as string, 'job.created', {
    ownerType: 'batch_item',
    ownerId,
    targetType: 'card',
    targetId: params.cardId,
  });
  return job;
}

function updateExecutionJobStatus(
  jobId: string,
  status: ExecutionJobStatus,
  patch: Record<string, unknown> = {},
) {
  const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled';
  const nowIso = new Date().toISOString();
  store.update(EXECUTION_JOBS_COLLECTION, jobId, {
    status,
    finishedAt: terminal ? nowIso : null,
    ...patch,
  });
  appendExecutionEvent(jobId, `job.${status}`, patch);
}

function createExecutionAttemptForRun(jobId: string, agentRunId: string): Record<string, unknown> {
  const existing = store
    .getAll(EXECUTION_ATTEMPTS_COLLECTION)
    .find((attempt) => attempt.jobId === jobId && attempt.agentRunId === agentRunId);
  if (existing) return existing;

  const attempts = listAttemptsForJob(jobId);
  const runRecord = store.getById(AGENT_RUNS_COLLECTION, agentRunId);
  const attemptIndex = attempts.length + 1;
  const nowIso = new Date().toISOString();
  const attempt = store.insert(EXECUTION_ATTEMPTS_COLLECTION, {
    jobId,
    attemptIndex,
    role: attemptIndex === 1 ? 'primary' : 'fallback',
    provider: typeof runRecord?.provider === 'string' ? runRecord.provider : null,
    model: typeof runRecord?.model === 'string' ? runRecord.model : null,
    modelId: typeof runRecord?.modelId === 'string' ? runRecord.modelId : null,
    agentRunId,
    status: 'running' satisfies ExecutionAttemptStatus,
    errorClass: null,
    errorMessage: null,
    startedAt: nowIso,
    finishedAt: null,
  });
  store.update(EXECUTION_JOBS_COLLECTION, jobId, {
    status: 'running' satisfies ExecutionJobStatus,
    activeAttemptId: attempt.id,
    finishedAt: null,
    errorMessage: null,
  });
  appendExecutionEvent(jobId, 'attempt.started', { agentRunId, attemptIndex }, attempt.id as string);
  return attempt;
}

function updateAttemptFromRunRecord(
  attempt: Record<string, unknown>,
  runRecord: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!runRecord) return attempt;
  const attemptId = String(attempt.id);
  const currentStatus = String(attempt.status ?? '');
  if (currentStatus === 'succeeded' || currentStatus === 'failed' || currentStatus === 'cancelled') {
    return attempt;
  }

  if (runRecord.status === 'running' || runRecord.status === 'queued') return attempt;

  if (runRecord.killedByUser === true || runRecord.errorMessage === 'Killed by user') {
    return (
      store.update(EXECUTION_ATTEMPTS_COLLECTION, attemptId, {
        status: 'cancelled' satisfies ExecutionAttemptStatus,
        finishedAt: new Date().toISOString(),
        errorMessage: 'Killed by user',
      }) ?? attempt
    );
  }

  if (runRecord.status === 'completed') {
    return (
      store.update(EXECUTION_ATTEMPTS_COLLECTION, attemptId, {
        status: 'succeeded' satisfies ExecutionAttemptStatus,
        finishedAt: runRecord.finishedAt ?? new Date().toISOString(),
        errorMessage: null,
      }) ?? attempt
    );
  }

  const errorMessage =
    typeof runRecord.errorMessage === 'string' && runRecord.errorMessage
      ? runRecord.errorMessage
      : 'Agent run failed';
  return (
    store.update(EXECUTION_ATTEMPTS_COLLECTION, attemptId, {
      status: 'failed' satisfies ExecutionAttemptStatus,
      finishedAt: runRecord.finishedAt ?? new Date().toISOString(),
      errorMessage,
      errorClass: 'agent_run_error',
    }) ?? attempt
  );
}

async function syncExecutionJobFromAttempts(jobId: string): Promise<Record<string, unknown> | null> {
  const job = store.getById(EXECUTION_JOBS_COLLECTION, jobId);
  if (!job) return null;

  const attempts: Record<string, unknown>[] = [];
  for (const attempt of listAttemptsForJob(jobId)) {
    const runId = typeof attempt.agentRunId === 'string' ? attempt.agentRunId : null;
    attempts.push(
      updateAttemptFromRunRecord(attempt, runId ? await getAgentRunByIdNative(runId) : null),
    );
  }

  if (attempts.some((attempt) => attempt.status === 'succeeded')) {
    return (
      store.update(EXECUTION_JOBS_COLLECTION, jobId, {
        status: 'succeeded' satisfies ExecutionJobStatus,
        finishedAt: new Date().toISOString(),
        errorMessage: null,
      }) ?? job
    );
  }

  const activeAttempt = [...attempts]
    .reverse()
    .find((attempt) => attempt.status === 'running' || attempt.status === 'dispatching');
  if (activeAttempt) {
    return (
      store.update(EXECUTION_JOBS_COLLECTION, jobId, {
        status: 'running' satisfies ExecutionJobStatus,
        activeAttemptId: activeAttempt.id,
        finishedAt: null,
      }) ?? job
    );
  }

  if (attempts.length === 0) return job;

  if (attempts.every((attempt) => attempt.status === 'cancelled')) {
    return (
      store.update(EXECUTION_JOBS_COLLECTION, jobId, {
        status: 'cancelled' satisfies ExecutionJobStatus,
        finishedAt: new Date().toISOString(),
        errorMessage: 'Killed by user',
      }) ?? job
    );
  }

  if (attempts.every((attempt) => attempt.status === 'failed' || attempt.status === 'cancelled')) {
    const lastError = [...attempts]
      .reverse()
      .map((attempt) => attempt.errorMessage)
      .find((value) => typeof value === 'string' && value);
    return (
      store.update(EXECUTION_JOBS_COLLECTION, jobId, {
        status: 'failed' satisfies ExecutionJobStatus,
        finishedAt: new Date().toISOString(),
        errorMessage: typeof lastError === 'string' ? lastError : 'Batch item failed',
      }) ?? job
    );
  }

  return job;
}

function deleteExecutionJobTree(jobId: string) {
  for (const event of store.getAll(EXECUTION_EVENTS_COLLECTION)) {
    if (event.jobId === jobId) store.delete(EXECUTION_EVENTS_COLLECTION, String(event.id));
  }
  for (const attempt of store.getAll(EXECUTION_ATTEMPTS_COLLECTION)) {
    if (attempt.jobId === jobId) store.delete(EXECUTION_ATTEMPTS_COLLECTION, String(attempt.id));
  }
  store.delete(EXECUTION_JOBS_COLLECTION, jobId);
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
    skipped: 0,
  };

  for (const item of items) {
    const status = item.status;
    if (status === 'queued') result.queued += 1;
    if (status === 'processing') result.processing += 1;
    if (status === 'completed') result.completed += 1;
    if (status === 'failed') result.failed += 1;
    if (status === 'cancelled') result.cancelled += 1;
    if (status === 'skipped') result.skipped += 1;
  }

  return result;
}

function computeRunStatus(
  run: Record<string, unknown>,
  counts: ReturnType<typeof countItemsByStatus>,
): AgentBatchRunStatus {
  const current = run.status as AgentBatchRunStatus | undefined;
  const finished = counts.completed + counts.failed + counts.cancelled + counts.skipped;
  if (current === 'cancelled' && counts.processing > 0) return 'cancelled';
  if (counts.total === 0 || finished >= counts.total) {
    if (current === 'cancelled') return 'cancelled';
    if (counts.failed > 0 || counts.skipped > 0) return 'failed';
    if (counts.cancelled === counts.total) return 'cancelled';
    return 'completed';
  }
  if (counts.processing > 0 || finished > 0) return 'running';
  return 'queued';
}

function refreshRunStats(runId: string): Record<string, unknown> | null {
  const run = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
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
    skipped: counts.skipped,
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

  return store.update(AGENT_BATCH_RUNS_COLLECTION, runId, patch);
}

function getNextReadyDelayMs(runId: string): number | null {
  const queuedItems = listItemsForRun(runId).filter((item) => item.status === 'queued');
  if (queuedItems.length === 0) return null;

  const itemsById = new Map(queuedItems.map((item) => [item.id as string, item]));
  for (const item of listItemsForRun(runId)) {
    itemsById.set(item.id as string, item);
  }

  const now = Date.now();
  let earliest = Number.POSITIVE_INFINITY;
  for (const item of queuedItems) {
    if (describeDependencyState(item, itemsById).kind !== 'ready') continue;
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
  store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    nextAttemptAt: null,
    errorMessage: null,
  });
}

function markItemCancelled(itemId: string, errorMessage = 'Cancelled by user') {
  store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
    nextAttemptAt: null,
    errorMessage,
  });
}

function markItemSkipped(itemId: string, errorMessage: string) {
  store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
    status: 'skipped',
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
    store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
      status: 'queued',
      completedAt: null,
      errorMessage,
      nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString(),
      agentRunId: null,
      executionJobId: null,
    });
    return;
  }

  store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    nextAttemptAt: null,
    errorMessage,
  });
}

function deferContendedItem(item: Record<string, unknown>, errorMessage: string) {
  store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, item.id as string, {
    status: 'queued',
    completedAt: null,
    errorMessage,
    nextAttemptAt: new Date(Date.now() + AGENT_BATCH_CARD_CONTENTION_RETRY_MS).toISOString(),
    agentRunId: null,
    executionJobId: null,
  });
}

async function reconcileProcessingItems(runId: string) {
  const run = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
  if (!run) return;

  const now = Date.now();
  const runCancelled = run.status === 'cancelled';
  const processingItems = listItemsForRun(runId).filter((item) => item.status === 'processing');

  for (const item of processingItems) {
    const itemId = item.id as string;
    const executionJobId =
      typeof item.executionJobId === 'string' && item.executionJobId ? item.executionJobId : null;
    const agentRunId =
      typeof item.agentRunId === 'string' && item.agentRunId ? item.agentRunId : null;

    if (runCancelled) {
      const attemptRunIds = executionJobId
        ? listAttemptsForJob(executionJobId)
            .map((attempt) => attempt.agentRunId)
            .filter((value): value is string => typeof value === 'string' && Boolean(value))
        : [];
      for (const runToKill of new Set([...attemptRunIds, ...(agentRunId ? [agentRunId] : [])])) {
        await killAgentRun(runToKill);
      }
      if (executionJobId) {
        updateExecutionJobStatus(executionJobId, 'cancelled', { errorMessage: 'Cancelled by user' });
      }
      releaseBatchItemDispatch(itemId);
      markItemCancelled(itemId);
      continue;
    }

    if (executionJobId) {
      const job = await syncExecutionJobFromAttempts(executionJobId);
      if (
        job?.status === 'dispatching' ||
        job?.status === 'queued' ||
        (job?.status === 'running' && listAttemptsForJob(executionJobId).length === 0)
      ) {
        // executeCardTask may still be waiting on concurrency or the runner.
        continue;
      }
      if (job?.status === 'running') {
        const startedAtMs = parseIsoDateMs(job.startedAt ?? item.startedAt);
        if (!Number.isFinite(startedAtMs) || now - startedAtMs < AGENT_BATCH_PROCESSING_STALE_MS) {
          continue;
        }
        const attempts = listAttemptsForJob(executionJobId);
        if (attempts.length > 0) {
          continue;
        }
        updateExecutionJobStatus(executionJobId, 'failed', {
          errorMessage: 'Batch item dispatch did not create an agent run',
        });
      }
      const syncedJob = store.getById(EXECUTION_JOBS_COLLECTION, executionJobId);
      if (syncedJob?.status === 'succeeded') {
        markItemCompleted(itemId);
        continue;
      }
      if (syncedJob?.status === 'cancelled') {
        markItemCancelled(itemId);
        continue;
      }
      if (syncedJob?.status === 'failed') {
        const errorMessage =
          typeof syncedJob.errorMessage === 'string' && syncedJob.errorMessage
            ? syncedJob.errorMessage
            : 'Batch item failed';
        retryOrFailItem(item, errorMessage);
        continue;
      }
    }

    if (!agentRunId) {
      if (hasActiveBatchItemDispatch(itemId)) {
        continue;
      }
      const startedAtMs = parseIsoDateMs(item.startedAt);
      if (Number.isFinite(startedAtMs) && now - startedAtMs >= AGENT_BATCH_PROCESSING_STALE_MS) {
        retryOrFailItem(item, 'Batch item lost run reference after restart');
      }
      continue;
    }

    const runRecord = await getAgentRunByIdNative(agentRunId);
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

function skipBlockedQueuedItems(runId: string) {
  while (true) {
    const items = listItemsForRun(runId);
    const itemsById = new Map(items.map((item) => [item.id as string, item]));
    let skippedAny = false;

    for (const item of items) {
      if (item.status !== 'queued') continue;
      const dependencyState = describeDependencyState(item, itemsById);
      if (dependencyState.kind !== 'blocked' || !dependencyState.blockedReason) continue;
      markItemSkipped(item.id as string, dependencyState.blockedReason);
      skippedAny = true;
    }

    if (!skippedAny) return;
  }
}

/** Returns true when the item is marked processing and a card task should be dispatched. */
function markBatchItemProcessing(runId: string, item: Record<string, unknown>): boolean {
  const latestRun = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
  if (!latestRun) return false;
  if (latestRun.status === 'cancelled') {
    markItemCancelled(item.id as string);
    return false;
  }

  const itemId = item.id as string;
  const attempts = Number(item.attempts ?? 0);
  const agentId =
    typeof latestRun.agentId === 'string' && latestRun.agentId ? latestRun.agentId : null;
  const cardId = typeof item.cardId === 'string' ? item.cardId : null;
  const cardName = typeof item.cardName === 'string' ? item.cardName : null;
  const cardCollectionId =
    typeof item.cardCollectionId === 'string' ? item.cardCollectionId : null;

  if (!agentId || !cardId || !cardName || !cardCollectionId) {
    store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      nextAttemptAt: null,
      errorMessage: 'Batch item is missing required fields',
    });
    return false;
  }

  store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
    status: 'processing',
    attempts: attempts + 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    nextAttemptAt: null,
    errorMessage: null,
    agentRunId: null,
  });
  const job = getOrCreateBatchExecutionJob({
    runId,
    item,
    agentId,
    cardId,
    attemptNumber: attempts + 1,
  });
  store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
    executionJobId: job.id,
  });
  store.update(AGENT_BATCH_RUNS_COLLECTION, runId, {
    status: 'running',
    startedAt: latestRun.startedAt ?? new Date().toISOString(),
  });

  return true;
}

function dispatchBatchCardTaskFromItem(runId: string, itemId: string) {
  const latestRun = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
  const item = store.getById(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId);
  if (!latestRun || !item || item.status !== 'processing') return;

  const agentId =
    typeof latestRun.agentId === 'string' && latestRun.agentId ? latestRun.agentId : null;
  const prompt =
    typeof latestRun.prompt === 'string' && latestRun.prompt.trim()
      ? latestRun.prompt.trim()
      : undefined;
  const cardId = typeof item.cardId === 'string' ? item.cardId : null;
  const cardName = typeof item.cardName === 'string' ? item.cardName : null;
  const cardCollectionId =
    typeof item.cardCollectionId === 'string' ? item.cardCollectionId : null;
  const cardDescription =
    typeof item.cardDescription === 'string' ? item.cardDescription : null;
  const activationActorId =
    typeof latestRun.activationActorId === 'string' && latestRun.activationActorId.trim()
      ? latestRun.activationActorId.trim()
      : undefined;

  if (!agentId || !cardId || !cardName || !cardCollectionId) return;
  const executionJobId =
    typeof item.executionJobId === 'string' && item.executionJobId ? item.executionJobId : null;

  activeBatchItemDispatches.add(itemId);

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
        const latest = store.getById(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId);
        if (!latest || latest.status !== 'processing') return;
        const latestExecutionJobId =
          typeof latest.executionJobId === 'string' && latest.executionJobId
            ? latest.executionJobId
            : executionJobId;
        if (latestExecutionJobId) {
          createExecutionAttemptForRun(latestExecutionJobId, agentRunId);
        }
        store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId, {
          agentRunId,
          executionJobId: latestExecutionJobId,
        });
      },
      onDone: () => {
        releaseBatchItemDispatch(itemId);
        const latest = store.getById(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId);
        if (!latest || latest.status !== 'processing') {
          scheduleRunDrain(runId, 0);
          return;
        }
        const latestExecutionJobId =
          typeof latest.executionJobId === 'string' && latest.executionJobId ? latest.executionJobId : null;
        if (latestExecutionJobId) {
          updateExecutionJobStatus(latestExecutionJobId, 'succeeded', { errorMessage: null });
        }
        markItemCompleted(itemId);
        scheduleRunDrain(runId, 0);
      },
      onError: (err) => {
        releaseBatchItemDispatch(itemId);
        const latest = store.getById(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemId);
        if (!latest || latest.status !== 'processing') {
          scheduleRunDrain(runId, 0);
          return;
        }

        const latestRunRecord = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
        if (!latestRunRecord) return;
        if (latestRunRecord.status === 'cancelled') {
          const latestExecutionJobId =
            typeof latest.executionJobId === 'string' && latest.executionJobId ? latest.executionJobId : null;
          if (latestExecutionJobId) {
            updateExecutionJobStatus(latestExecutionJobId, 'cancelled', { errorMessage: err });
          }
          markItemCancelled(itemId);
          scheduleRunDrain(runId, 0);
          return;
        }

        const latestExecutionJobId =
          typeof latest.executionJobId === 'string' && latest.executionJobId ? latest.executionJobId : null;
        if (latestExecutionJobId) {
          updateExecutionJobStatus(latestExecutionJobId, 'failed', { errorMessage: err });
        }
        if (isCardAlreadyProcessingError(err)) {
          deferContendedItem(latest, err);
          refreshRunStats(runId);
          scheduleRunDrain(runId, AGENT_BATCH_CARD_CONTENTION_RETRY_MS);
          return;
        }
        retryOrFailItem(latest, err);
        scheduleRunDrain(runId, 0);
      },
    },
    prompt,
    activationActorId,
  );
}

async function drainBatchRun(runId: string): Promise<void> {
  if (runProcessors.has(runId)) return;
  runProcessors.add(runId);

  try {
    while (true) {
      const run = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
      if (!run) {
        clearRunDrainTimer(runId);
        return;
      }

      await reconcileProcessingItems(runId);
      skipBlockedQueuedItems(runId);

      const phase = await store.transaction(async () => {
        await store.lockAgentBatchRunScope(runId);
        const lockedRun = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
        if (!lockedRun) return { kind: 'missing' as const };

        let refreshedRun = refreshRunStats(runId);
        if (!refreshedRun) return { kind: 'missing' as const };

        if (refreshedRun.status === 'cancelled') {
          for (const item of listItemsForRun(runId)) {
            if (item.status === 'queued') {
              markItemCancelled(item.id as string);
            }
          }
          refreshedRun = refreshRunStats(runId) ?? refreshedRun;
          const processingCount = Number(refreshedRun.processing ?? 0);
          return { kind: 'cancelled' as const, processingCount };
        }

        const maxParallel = normalizeMaxParallel(refreshedRun.maxParallel);
        const processingCount = Number(refreshedRun.processing ?? 0);
        const availableSlots = Math.max(0, maxParallel - processingCount);
        if (availableSlots <= 0) {
          return { kind: 'throttle' as const, delayMs: 1000 };
        }

        const allItems = listItemsForRun(runId);
        const itemsById = new Map(allItems.map((item) => [item.id as string, item]));
        const readyItems = allItems.filter((item) => {
          if (item.status !== 'queued') return false;
          if (describeDependencyState(item, itemsById).kind !== 'ready') return false;
          const nextAttemptAtMs = parseIsoDateMs(item.nextAttemptAt);
          return !Number.isFinite(nextAttemptAtMs) || nextAttemptAtMs <= Date.now();
        });

        if (readyItems.length === 0) {
          const latestRun = refreshRunStats(runId);
          const stillProcessing = Number(latestRun?.processing ?? 0);
          const nextDelayMs = getNextReadyDelayMs(runId);
          return { kind: 'idle' as const, nextDelayMs, stillProcessing };
        }

        const itemIds: string[] = [];
        for (const item of readyItems.slice(0, availableSlots)) {
          if (markBatchItemProcessing(runId, item)) {
            itemIds.push(item.id as string);
          }
        }
        refreshRunStats(runId);
        return { kind: 'work' as const, itemIds };
      });

      if (phase.kind === 'missing') {
        clearRunDrainTimer(runId);
        return;
      }
      if (phase.kind === 'cancelled') {
        if (phase.processingCount > 0) scheduleRunDrain(runId, 1000);
        else clearRunDrainTimer(runId);
        return;
      }
      if (phase.kind === 'throttle') {
        scheduleRunDrain(runId, phase.delayMs);
        return;
      }
      if (phase.kind === 'idle') {
        if (phase.nextDelayMs !== null) {
          scheduleRunDrain(runId, phase.nextDelayMs);
        } else if (phase.stillProcessing > 0) {
          scheduleRunDrain(runId, 1000);
        } else {
          clearRunDrainTimer(runId);
        }
        return;
      }
      for (const itemId of phase.itemIds) {
        dispatchBatchCardTaskFromItem(runId, itemId);
      }
      continue;
    }
  } finally {
    runProcessors.delete(runId);
  }
}

export function cleanupFinishedBatchRuns(): number {
  const finishedRuns = findTerminalBatchRuns();

  for (const run of finishedRuns) {
    const runId = run.id as string;
    for (const item of listItemsForRun(runId)) {
      if (typeof item.executionJobId === 'string' && item.executionJobId) {
        deleteExecutionJobTree(item.executionJobId);
      }
    }
    deleteBatchRunItemsForRun(runId);
    clearRunDrainTimer(runId);
    store.delete(AGENT_BATCH_RUNS_COLLECTION, runId);
  }

  return finishedRuns.length;
}

function pruneBatchHistory() {
  const staleRuns = findBatchRunsEligibleForHistoryPrune({
    retentionMs: AGENT_BATCH_HISTORY_RETENTION_MS,
    nowMs: Date.now(),
  });

  for (const run of staleRuns) {
    const runId = run.id as string;
    for (const item of listItemsForRun(runId)) {
      if (typeof item.executionJobId === 'string' && item.executionJobId) {
        deleteExecutionJobTree(item.executionJobId);
      }
    }
    deleteBatchRunItemsForRun(runId);
    clearRunDrainTimer(runId);
    store.delete(AGENT_BATCH_RUNS_COLLECTION, runId);
  }
}

export async function initializeAgentBatchQueue(
  _options: { preserveActiveProcessing?: boolean } = {},
) {
  pruneBatchHistory();

  const processingItems = await findBatchRunItemsWithStatusNative('processing');

  for (const item of processingItems) {
    const itemId = item.id as string;
    const runId = typeof item.runId === 'string' ? item.runId : null;
    if (!runId) continue;

    const executionJobId =
      typeof item.executionJobId === 'string' && item.executionJobId ? item.executionJobId : null;
    if (executionJobId) {
      const job = await syncExecutionJobFromAttempts(executionJobId);
      if (isInFlightExecutionJobStatus(job?.status as ExecutionJobStatus | undefined)) {
        continue;
      }
      if (job?.status === 'succeeded') {
        releaseBatchItemDispatch(itemId);
        markItemCompleted(item.id as string);
        continue;
      }
      if (job?.status === 'cancelled') {
        releaseBatchItemDispatch(itemId);
        markItemCancelled(item.id as string);
        continue;
      }
      if (job?.status === 'failed') {
        const errorMessage =
          typeof job.errorMessage === 'string' && job.errorMessage
            ? job.errorMessage
            : 'Recovered from backend restart';
        retryOrFailItem(item, errorMessage);
        continue;
      }
    }

    const agentRunId =
      typeof item.agentRunId === 'string' && item.agentRunId ? item.agentRunId : null;
    if (!agentRunId) {
      if (
        hasActiveBatchItemDispatch(itemId) ||
        (executionJobId &&
          isInFlightExecutionJobStatus(
            store.getById(EXECUTION_JOBS_COLLECTION, executionJobId)?.status as
              | ExecutionJobStatus
              | undefined,
          ))
      ) {
        continue;
      }
      retryOrFailItem(item, 'Recovered from backend restart');
      continue;
    }

    const runRecord = await getAgentRunByIdNative(agentRunId);
    if (!runRecord) {
      retryOrFailItem(item, 'Recovered from backend restart');
      continue;
    }

    if (runRecord.status === 'running') {
      continue;
    }
    if (runRecord.status === 'completed') {
      releaseBatchItemDispatch(itemId);
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
  const pendingItems = await findBatchRunItemsQueuedOrProcessingNative();
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
  const { sourceType, sourceId, sourceName = null, agentId, prompt = '', cards } = options;
  const maxParallel = normalizeMaxParallel(options.maxParallel);
  const trimmedPrompt = prompt.trim();

  const agent = getAgent(agentId);
  if (!agent || isAgentArchived(agent)) {
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

  assertAgentRunnerAvailableForBatch(agentId, options.activationActorId);
  pruneBatchHistory();

  let resolvedDependencies: ResolvedBatchDependencies;
  try {
    resolvedDependencies = buildResolvedBatchDependencies(
      cards,
      options.stages,
      options.cardDependencies,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid batch dependencies';
    throw ApiError.badRequest('invalid_batch_dependencies', message);
  }

  const run = store.insert(AGENT_BATCH_RUNS_COLLECTION, {
    sourceType,
    sourceId,
    sourceName,
    agentId,
    prompt: trimmedPrompt,
    activationActorId: options.activationActorId ?? null,
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
    stageCount: resolvedDependencies.stageCount,
    dependencyItemCount: resolvedDependencies.dependsOnCardIdsByCardId.size,
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
    dependsOnItemIds: [] as string[],
    blockingMode: resolvedDependencies.blockingModeByCardId.get(card.id) ?? null,
    stageId: resolvedDependencies.stageIdByCardId.get(card.id) ?? null,
    attempts: 0,
    maxAttempts: AGENT_BATCH_DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: nowIso,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    agentRunId: null,
    executionJobId: null,
  }));
  const insertedItems = store.insertMany(AGENT_BATCH_RUN_ITEMS_COLLECTION, itemsToInsert);
  const itemIdByCardId = new Map(
    insertedItems.map((item) => [item.cardId as string, item.id as string]),
  );
  for (const item of insertedItems) {
    const cardId = item.cardId as string;
    const dependencyIds =
      resolvedDependencies.dependsOnCardIdsByCardId.get(cardId)?.map(
        (dependencyCardId) => itemIdByCardId.get(dependencyCardId) as string,
      ) ?? [];
    if (dependencyIds.length === 0) continue;
    store.update(AGENT_BATCH_RUN_ITEMS_COLLECTION, item.id as string, {
      dependsOnItemIds: dependencyIds,
      blockingMode: resolvedDependencies.blockingModeByCardId.get(cardId) ?? 'all_success',
    });
  }

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

  const all = listAgentBatchRunsMatching({
    sourceType,
    sourceId,
    agentId,
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
  return refreshRunStats(runId) ?? store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
}

export function listAgentBatchRunItems(
  runId: string,
  options: ListAgentBatchRunItemsOptions = {},
) {
  const { status, limit = 100, offset = 0 } = options;
  const run = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
  if (!run) return { entries: [], total: 0 };

  const all = listItemsForRun(runId).filter((item) => {
    if (status && item.status !== status) return false;
    return true;
  });

  const itemsById = new Map(listItemsForRun(runId).map((item) => [item.id as string, item]));
  const entries: Array<Record<string, unknown> & { blockedReason: string | null }> = all
    .slice(offset, offset + limit)
    .map((item) => {
      const dependencyState = describeDependencyState(item, itemsById);
      return {
        ...item,
        blockedReason:
          item.status === 'queued' && dependencyState.kind !== 'ready'
            ? dependencyState.blockedReason
            : null,
      };
    });
  return { entries, total: all.length };
}

export async function cancelAgentBatchRun(
  runId: string,
  reason = 'Cancelled by user',
): Promise<Record<string, unknown> | null> {
  const run = store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
  if (!run) return null;

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return refreshRunStats(runId) ?? run;
  }

  store.update(AGENT_BATCH_RUNS_COLLECTION, runId, {
    status: 'cancelled',
    errorMessage: reason,
  });

  const queuedItems = listItemsForRun(runId).filter((item) => item.status === 'queued');
  for (const item of queuedItems) {
    markItemCancelled(item.id as string, reason);
  }

  const processingItems = listItemsForRun(runId).filter((item) => item.status === 'processing');
  for (const item of processingItems) {
    const executionJobId =
      typeof item.executionJobId === 'string' && item.executionJobId ? item.executionJobId : null;
    const agentRunId =
      typeof item.agentRunId === 'string' && item.agentRunId ? item.agentRunId : null;
    const attemptRunIds = executionJobId
      ? listAttemptsForJob(executionJobId)
          .map((attempt) => attempt.agentRunId)
          .filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [];
    const runIdsToKill = new Set([...attemptRunIds, ...(agentRunId ? [agentRunId] : [])]);
    for (const runToKill of runIdsToKill) {
      await killAgentRun(runToKill);
    }
    if (executionJobId) {
      updateExecutionJobStatus(executionJobId, 'cancelled', { errorMessage: reason });
    }
    releaseBatchItemDispatch(item.id as string);
    markItemCancelled(item.id as string, reason);
  }

  scheduleRunDrain(runId, 0);
  return refreshRunStats(runId) ?? store.getById(AGENT_BATCH_RUNS_COLLECTION, runId);
}

/** @internal Test-only reset for module-level dispatch tracking. */
export function resetAgentBatchQueueInternalsForTests() {
  activeBatchItemDispatches.clear();
  runProcessors.clear();
  for (const { timer } of runDrainTimers.values()) {
    clearTimeout(timer);
  }
  runDrainTimers.clear();
}
