import { store } from '../db/index.js';
import type { BoardCard, BoardColumn, Card } from '../db/types.js';
import {
  getBoardExecutionPlanRecordById,
  listBoardExecutionPlansForBoard,
} from '../db/repositories/board-execution-plans-repository.js';
import {
  listBoardCardsByBoardIdNative,
  listBoardColumnsByBoardIdNative,
} from '../db/repositories/boards-cards-repository.js';

export type BoardExecutionPlanStatus = 'draft' | 'ready' | 'invalid';
export type BoardExecutionPlanDependencyMode =
  | 'none'
  | 'previous_layer'
  | 'all_previous_layers'
  | 'specific_cards';
export type BoardExecutionPlanBlockingMode = 'all_success' | 'all_settled';

export interface BoardExecutionPlanDependencyRule {
  mode: BoardExecutionPlanDependencyMode;
  cardIds?: string[];
  blockingMode?: BoardExecutionPlanBlockingMode;
}

export interface BoardExecutionPlanLayerCardInput {
  id: string;
  dependencyRule?: BoardExecutionPlanDependencyRule;
}

export interface BoardExecutionPlanLayerInput {
  cards: BoardExecutionPlanLayerCardInput[];
}

export interface BoardExecutionPlanLayerCard {
  id: string;
  name: string;
  subtitle: string | null;
  dependencyRule?: BoardExecutionPlanDependencyRule;
}

export interface BoardExecutionPlanLayer {
  cards: BoardExecutionPlanLayerCard[];
}

interface StoredPlanLayerCard {
  cardId: string;
  dependencyRule?: BoardExecutionPlanDependencyRule;
}

interface StoredPlanLayer {
  cards: StoredPlanLayerCard[];
}

export interface BoardExecutionPlan {
  id: string;
  boardId: string;
  name: string;
  description: string | null;
  status: BoardExecutionPlanStatus;
  layers: BoardExecutionPlanLayer[];
  issues: string[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION = 'boardExecutionPlans';

function normalizeBlockingMode(value: unknown): BoardExecutionPlanBlockingMode | undefined {
  return value === 'all_success' || value === 'all_settled' ? value : undefined;
}

function normalizeDependencyRule(value: unknown): BoardExecutionPlanDependencyRule | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<BoardExecutionPlanDependencyRule>;
  const mode = candidate.mode;
  if (
    mode !== 'none' &&
    mode !== 'previous_layer' &&
    mode !== 'all_previous_layers' &&
    mode !== 'specific_cards'
  ) {
    return undefined;
  }

  return {
    mode,
    cardIds: mode === 'specific_cards'
      ? Array.from(new Set((candidate.cardIds ?? []).filter((id): id is string => typeof id === 'string')))
      : undefined,
    blockingMode: normalizeBlockingMode(candidate.blockingMode),
  };
}

function normalizeLayers(layers: BoardExecutionPlanLayerInput[]): StoredPlanLayer[] {
  const seenCards = new Set<string>();
  return layers
    .map((layer) => ({
      cards: layer.cards
        .filter((card) => {
          if (!card.id || seenCards.has(card.id)) return false;
          seenCards.add(card.id);
          return true;
        })
        .map((card) => ({
          cardId: card.id,
          dependencyRule: normalizeDependencyRule(card.dependencyRule),
        })),
    }))
    .filter((layer) => layer.cards.length > 0);
}

function parseStoredLayers(value: unknown): StoredPlanLayer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((layer) => {
      if (!layer || typeof layer !== 'object') return { cards: [] };
      const cards = Array.isArray((layer as { cards?: unknown }).cards)
        ? (layer as { cards: unknown[] }).cards
        : [];
      const parsedCards: StoredPlanLayerCard[] = [];
      for (const card of cards) {
        if (!card || typeof card !== 'object') continue;
        const cardId = (card as { cardId?: unknown; id?: unknown }).cardId
          ?? (card as { id?: unknown }).id;
        if (typeof cardId !== 'string' || !cardId) continue;
        parsedCards.push({
          cardId,
          dependencyRule: normalizeDependencyRule((card as { dependencyRule?: unknown }).dependencyRule),
        });
      }
      return {
        cards: parsedCards,
      };
    })
    .filter((layer) => layer.cards.length > 0);
}

async function getBoardLookups(boardId: string) {
  const boardCards = (await listBoardCardsByBoardIdNative(boardId)) as unknown as BoardCard[];
  const columns = (await listBoardColumnsByBoardIdNative(boardId)) as unknown as BoardColumn[];
  const boardCardByCardId = new Map(boardCards.map((boardCard) => [boardCard.cardId, boardCard]));
  const columnById = new Map(columns.map((column) => [column.id, column]));
  return { boardCardByCardId, columnById };
}

function validateStoredLayers(
  layers: StoredPlanLayer[],
  boardCardByCardId: Map<string, BoardCard>,
): { status: BoardExecutionPlanStatus; issues: string[] } {
  const issues: string[] = [];
  const planCardIds = new Set(layers.flatMap((layer) => layer.cards.map((card) => card.cardId)));
  if (planCardIds.size === 0) {
    return { status: 'draft', issues: ['Add at least one card before running this plan.'] };
  }

  layers.forEach((layer, layerIdx) => {
    const earlierIds = new Set(
      layers.slice(0, layerIdx).flatMap((earlierLayer) => earlierLayer.cards.map((card) => card.cardId)),
    );

    for (const card of layer.cards) {
      const cardRecord = store.getById('cards', card.cardId) as Card | null;
      const cardName = cardRecord?.name ?? card.cardId;
      if (!cardRecord) {
        issues.push(`${cardName} no longer exists.`);
      } else if (!boardCardByCardId.has(card.cardId)) {
        issues.push(`${cardName} is no longer on this board.`);
      }

      const rule = card.dependencyRule;
      if (!rule || rule.mode !== 'specific_cards') continue;

      for (const dependencyId of rule.cardIds ?? []) {
        if (dependencyId === card.cardId) {
          issues.push(`${cardName} cannot depend on itself.`);
          continue;
        }
        if (!planCardIds.has(dependencyId)) {
          issues.push(`${cardName} depends on a card outside this plan.`);
          continue;
        }
        if (!earlierIds.has(dependencyId)) {
          issues.push(`${cardName} depends on a card that is not in an earlier layer.`);
        }
      }
    }
  });

  return {
    status: issues.length > 0 ? 'invalid' : 'ready',
    issues,
  };
}

async function hydratePlan(record: Record<string, unknown>): Promise<BoardExecutionPlan> {
  const layers = parseStoredLayers(record.layers);
  const { boardCardByCardId, columnById } = await getBoardLookups(String(record.boardId));
  const validation = validateStoredLayers(layers, boardCardByCardId);

  return {
    id: String(record.id),
    boardId: String(record.boardId),
    name: String(record.name ?? 'Untitled plan'),
    description: typeof record.description === 'string' ? record.description : null,
    status: validation.status,
    layers: layers.map((layer) => ({
      cards: layer.cards.map((planCard) => {
        const card = store.getById('cards', planCard.cardId) as Card | null;
        const boardCard = boardCardByCardId.get(planCard.cardId);
        const column = boardCard ? columnById.get(boardCard.columnId) : null;
        return {
          id: planCard.cardId,
          name: card?.name ?? 'Missing card',
          subtitle: column?.name ?? (card ? 'Not on board' : 'Deleted card'),
          dependencyRule: planCard.dependencyRule,
        };
      }),
    })),
    issues: validation.issues,
    createdById: String(record.createdById ?? ''),
    createdAt: String(record.createdAt),
    updatedAt: String(record.updatedAt),
  };
}

export async function listBoardExecutionPlans(boardId: string): Promise<BoardExecutionPlan[]> {
  const records = await listBoardExecutionPlansForBoard(boardId);
  const hydrated = await Promise.all(records.map((record) => hydratePlan(record)));
  return hydrated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBoardExecutionPlan(id: string): Promise<BoardExecutionPlan | null> {
  const record = await getBoardExecutionPlanRecordById(id);
  if (!record) return null;
  return hydratePlan(record);
}

export async function createBoardExecutionPlan(
  data: {
    boardId: string;
    name: string;
    description?: string | null;
    layers?: BoardExecutionPlanLayerInput[];
  },
  createdById: string,
): Promise<BoardExecutionPlan> {
  const layers = normalizeLayers(data.layers ?? []);
  const { boardCardByCardId } = await getBoardLookups(data.boardId);
  const validation = validateStoredLayers(layers, boardCardByCardId);
  const created = await store.insert(COLLECTION, {
    boardId: data.boardId,
    name: data.name,
    description: data.description ?? null,
    status: validation.status,
    layers,
    createdById,
  });
  return hydratePlan(created);
}

export async function updateBoardExecutionPlan(
  id: string,
  data: {
    name?: string;
    description?: string | null;
    layers?: BoardExecutionPlanLayerInput[];
  },
): Promise<BoardExecutionPlan | null> {
  const existing = await getBoardExecutionPlanRecordById(id);
  if (!existing) return null;

  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.description !== undefined) update.description = data.description;
  if (data.layers !== undefined) update.layers = normalizeLayers(data.layers);

  if (update.layers !== undefined) {
    const { boardCardByCardId } = await getBoardLookups(String(existing.boardId));
    update.status = validateStoredLayers(update.layers as StoredPlanLayer[], boardCardByCardId).status;
  }

  const updated = await store.update(COLLECTION, id, update);
  return updated ? hydratePlan(updated) : null;
}

export async function deleteBoardExecutionPlan(id: string): Promise<boolean> {
  const deleted = await store.delete(COLLECTION, id);
  return Boolean(deleted);
}
