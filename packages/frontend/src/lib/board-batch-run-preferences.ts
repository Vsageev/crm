import type { BatchLayer } from './agent-batch';

const STORAGE_PREFIX = 'board-batch-run-';

export type BoardBatchRunScopeMode = 'filters' | 'manual';

export interface BoardBatchRunPreferences {
  agentId?: string;
  prompt?: string;
  scopeMode?: BoardBatchRunScopeMode;
  selectedColumnIds?: string[];
  textFilter?: string;
  maxParallel?: number;
  manualLayers?: BatchLayer[];
}

function storageKey(boardId: string): string {
  return `${STORAGE_PREFIX}${boardId}`;
}

function clampParallel(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(10, Math.max(1, Math.round(value)));
}

function sanitizeLayers(raw: unknown): BatchLayer[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const layers: BatchLayer[] = [];
  for (const layer of raw) {
    if (!layer || typeof layer !== 'object' || !Array.isArray((layer as BatchLayer).cards)) continue;
    const cards = (layer as BatchLayer).cards
      .filter(
        (card) =>
          card
          && typeof card.id === 'string'
          && card.id.length > 0
          && typeof card.name === 'string'
          && card.name.length > 0,
      )
      .map((card) => ({
        id: card.id,
        name: card.name,
        ...(card.dependencyRule ? { dependencyRule: card.dependencyRule } : {}),
      }));
    layers.push({ cards });
  }
  return layers.length > 0 ? layers : undefined;
}

function parsePreferences(raw: string): BoardBatchRunPreferences | null {
  try {
    const parsed = JSON.parse(raw) as BoardBatchRunPreferences;
    if (!parsed || typeof parsed !== 'object') return null;

    const scopeMode =
      parsed.scopeMode === 'filters' || parsed.scopeMode === 'manual'
        ? parsed.scopeMode
        : undefined;

    const selectedColumnIds = Array.isArray(parsed.selectedColumnIds)
      ? parsed.selectedColumnIds.filter((id): id is string => typeof id === 'string')
      : undefined;

    return {
      ...(typeof parsed.agentId === 'string' ? { agentId: parsed.agentId } : {}),
      ...(typeof parsed.prompt === 'string' ? { prompt: parsed.prompt } : {}),
      ...(scopeMode ? { scopeMode } : {}),
      ...(selectedColumnIds?.length ? { selectedColumnIds } : {}),
      ...(typeof parsed.textFilter === 'string' ? { textFilter: parsed.textFilter } : {}),
      ...(clampParallel(parsed.maxParallel) !== undefined
        ? { maxParallel: clampParallel(parsed.maxParallel) }
        : {}),
      ...(sanitizeLayers(parsed.manualLayers)
        ? { manualLayers: sanitizeLayers(parsed.manualLayers) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function getBoardBatchRunPreferences(boardId: string): BoardBatchRunPreferences | null {
  if (!boardId) return null;
  try {
    const raw = localStorage.getItem(storageKey(boardId));
    if (!raw) return null;
    return parsePreferences(raw);
  } catch {
    return null;
  }
}

export function saveBoardBatchRunPreferences(
  boardId: string,
  prefs: BoardBatchRunPreferences,
): void {
  if (!boardId) return;

  const payload: BoardBatchRunPreferences = {};
  if (prefs.agentId) payload.agentId = prefs.agentId;
  if (prefs.prompt?.trim()) payload.prompt = prefs.prompt;
  if (prefs.scopeMode) payload.scopeMode = prefs.scopeMode;
  if (prefs.selectedColumnIds?.length) payload.selectedColumnIds = prefs.selectedColumnIds;
  if (prefs.textFilter?.trim()) payload.textFilter = prefs.textFilter.trim();
  if (prefs.maxParallel !== undefined) payload.maxParallel = clampParallel(prefs.maxParallel) ?? 3;
  const manualLayers = sanitizeLayers(prefs.manualLayers);
  if (manualLayers?.length) payload.manualLayers = manualLayers;

  try {
    if (Object.keys(payload).length === 0) {
      localStorage.removeItem(storageKey(boardId));
    } else {
      localStorage.setItem(storageKey(boardId), JSON.stringify(payload));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function filterColumnIds(
  columnIds: string[] | undefined,
  validColumnIds: Set<string>,
): string[] | undefined {
  if (!columnIds?.length) return undefined;
  const filtered = columnIds.filter((id) => validColumnIds.has(id));
  return filtered.length > 0 ? filtered : undefined;
}
