import { api } from './api';

export type AgentBatchRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentBatchBlockingMode = 'all_success' | 'all_settled';
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

export type BatchDependencyMode =
  | 'none'
  | 'previous_layer'
  | 'all_previous_layers'
  | 'specific_cards';

export interface BatchDependencyRule {
  mode: BatchDependencyMode;
  cardIds?: string[];
  blockingMode?: AgentBatchBlockingMode;
}

export interface BatchPlanCardLike {
  id: string;
  name: string;
  dependencyRule?: BatchDependencyRule;
}

export interface BatchLayer {
  cards: BatchPlanCardLike[];
}

export interface AgentBatchRunLike {
  id: string;
  status: AgentBatchRunStatus;
}

export interface AgentBatchRunWithAgent extends AgentBatchRunLike {
  agentId: string;
}

interface AgentBatchItemsResponse {
  entries: { cardId: string; status: string }[];
}

function appendQuery(path: string, query: string): string {
  const prefix = path.includes('?') ? '&' : '?';
  return `${path}${prefix}${query}`;
}

export async function fetchActiveBatchRuns<T extends AgentBatchRunLike>(
  listEndpoint: string,
  limit = 200,
): Promise<T[]> {
  const res = await api<{ entries: T[] }>(
    appendQuery(listEndpoint, `status=active&limit=${limit}`),
  );
  return Array.isArray(res.entries) ? res.entries : [];
}

export async function fetchProcessingCardIdsFromActiveRuns(
  listEndpoint: string,
  getItemsEndpoint: (runId: string) => string,
  limit = 200,
): Promise<Set<string>> {
  const activeRuns = await fetchActiveBatchRuns<AgentBatchRunLike>(listEndpoint, limit);
  if (activeRuns.length === 0) return new Set<string>();

  const processing = new Set<string>();
  await Promise.all(
    activeRuns.map(async (run) => {
      try {
        const items = await api<AgentBatchItemsResponse>(
          appendQuery(getItemsEndpoint(run.id), `limit=${limit}`),
        );
        for (const item of items.entries) {
          if (item.status === 'processing') {
            processing.add(item.cardId);
          }
        }
      } catch {
        // Keep polling resilient when one run fetch fails.
      }
    }),
  );
  return processing;
}

/** Returns a map of cardId → agentId for cards currently being processed. */
export async function fetchProcessingCardAgents(
  listEndpoint: string,
  getItemsEndpoint: (runId: string) => string,
  limit = 200,
): Promise<Map<string, string>> {
  const activeRuns = await fetchActiveBatchRuns<AgentBatchRunWithAgent>(listEndpoint, limit);
  if (activeRuns.length === 0) return new Map();

  const cardToAgent = new Map<string, string>();
  await Promise.all(
    activeRuns.map(async (run) => {
      try {
        const items = await api<AgentBatchItemsResponse>(
          appendQuery(getItemsEndpoint(run.id), `limit=${limit}`),
        );
        for (const item of items.entries) {
          if (item.status === 'processing') {
            cardToAgent.set(item.cardId, run.agentId);
          }
        }
      } catch {
        // Keep polling resilient when one run fetch fails.
      }
    }),
  );
  return cardToAgent;
}

export function buildStagesFromLayers(layers: BatchLayer[]): AgentBatchStageInput[] {
  const nonEmpty = layers.filter((l) => l.cards.length > 0);
  if (nonEmpty.length <= 1) return [];

  return nonEmpty.map((layer, idx) => ({
    id: `layer-${idx + 1}`,
    cardIds: layer.cards.map((c) => c.id),
    dependsOnStageIndexes: [],
  }));
}

function uniqueIds(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function getEarlierLayerCardIds(layers: BatchLayer[], layerIdx: number): string[] {
  return layers.slice(0, layerIdx).flatMap((layer) => layer.cards.map((card) => card.id));
}

function getPreviousLayerCardIds(layers: BatchLayer[], layerIdx: number): string[] {
  if (layerIdx <= 0) return [];
  return layers[layerIdx - 1]?.cards.map((card) => card.id) ?? [];
}

export function resolveBatchDependencyIds(
  layers: BatchLayer[],
  layerIdx: number,
  card: BatchPlanCardLike,
): string[] {
  const rule = card.dependencyRule;
  const mode = rule?.mode ?? (layerIdx > 0 ? 'previous_layer' : 'none');

  if (mode === 'none') return [];
  if (mode === 'previous_layer') {
    return getPreviousLayerCardIds(layers, layerIdx).filter((cardId) => cardId !== card.id);
  }
  if (mode === 'all_previous_layers') {
    return getEarlierLayerCardIds(layers, layerIdx).filter((cardId) => cardId !== card.id);
  }

  const earlierCardIds = new Set(getEarlierLayerCardIds(layers, layerIdx));
  return uniqueIds(rule?.cardIds ?? []).filter((cardId) => (
    cardId !== card.id && earlierCardIds.has(cardId)
  ));
}

export function buildCardDependenciesFromLayers(layers: BatchLayer[]): AgentBatchCardDependencyInput[] {
  const nonEmpty = layers.filter((l) => l.cards.length > 0);
  const dependencies: AgentBatchCardDependencyInput[] = [];

  nonEmpty.forEach((layer, layerIdx) => {
    for (const card of layer.cards) {
      const dependsOnCardIds = resolveBatchDependencyIds(nonEmpty, layerIdx, card);
      if (dependsOnCardIds.length === 0) continue;
      dependencies.push({
        cardId: card.id,
        dependsOnCardIds,
        blockingMode: card.dependencyRule?.blockingMode,
      });
    }
  });

  return dependencies;
}
