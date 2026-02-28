import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

const GENERAL_BOARD_NAMES = new Set(['general', 'general board']);

function normalizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

export function isGeneralBoard(board: unknown): boolean {
  if (!board || typeof board !== 'object') return false;

  const candidate = board as { isGeneral?: unknown; name?: unknown };
  if (candidate.isGeneral === true) return true;

  return GENERAL_BOARD_NAMES.has(normalizeName(candidate.name));
}

export interface BoardListQuery {
  folderId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateBoardData {
  name: string;
  description?: string | null;
  folderId?: string | null;
  columns?: { name: string; color?: string; position: number }[];
}

export interface UpdateBoardData {
  name?: string;
  description?: string | null;
  folderId?: string | null;
}

export interface CreateColumnData {
  name: string;
  color?: string;
  position: number;
}

export interface UpdateColumnData {
  name?: string;
  color?: string;
  position?: number;
}

export async function listBoards(query: BoardListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  let all = store.getAll('boards') as any[];

  if (query.folderId) {
    all = all.filter((b: any) => b.folderId === query.folderId);
  }

  if (query.search) {
    const term = query.search.toLowerCase();
    all = all.filter(
      (b: any) =>
        b.name?.toLowerCase().includes(term) ||
        b.description?.toLowerCase().includes(term),
    );
  }

  all.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = all.length;
  const entries = all.slice(offset, offset + limit);

  return { entries, total };
}

export async function getBoardById(id: string) {
  const board = store.getById('boards', id);
  if (!board) return null;

  const columns = store.find('boardColumns', (r: any) => r.boardId === id) as any[];
  columns.sort((a, b) => a.position - b.position);

  return { ...(board as any), columns };
}

export async function getBoardWithCards(id: string) {
  const board = await getBoardById(id);
  if (!board) return null;

  const boardCards = store.find('boardCards', (r: any) => r.boardId === id) as any[];

  // Load card data for each board card, including assignee and tags
  const cardsWithPositions = boardCards.map((bc: any) => {
    const card = store.getById('cards', bc.cardId) as any;
    if (!card) return { ...bc, card: null };

    // Hydrate assignee
    let assignee = null;
    if (card.assigneeId) {
      const user = store.getById('users', card.assigneeId) as any;
      if (user) {
        assignee = { id: user.id, firstName: user.firstName, lastName: user.lastName };
      }
    }

    // Hydrate tags
    const cardTags = store.find('cardTags', (r: any) => r.cardId === card.id) as any[];
    const tags = cardTags
      .map((ct: any) => store.getById('tags', ct.tagId))
      .filter(Boolean);

    return {
      ...bc,
      card: { ...card, assignee, tags },
    };
  });

  // Sort by position within column
  cardsWithPositions.sort((a, b) => a.position - b.position);

  return { ...board, cards: cardsWithPositions };
}

export async function createBoard(
  data: CreateBoardData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { columns, ...boardData } = data;
  const isGeneral = GENERAL_BOARD_NAMES.has(normalizeName(boardData.name));

  const board = store.insert('boards', {
    name: boardData.name,
    description: boardData.description ?? null,
    folderId: boardData.folderId ?? null,
    isGeneral,
    createdById: audit?.userId,
  }) as any;

  // Create initial columns
  if (columns && columns.length > 0) {
    for (const col of columns) {
      store.insert('boardColumns', {
        boardId: board.id,
        name: col.name,
        color: col.color ?? '#6B7280',
        position: col.position,
      });
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'board',
      entityId: board.id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getBoardById(board.id);
}

export async function updateBoard(
  id: string,
  data: UpdateBoardData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date().toISOString();

  const updated = store.update('boards', id, setData);
  if (!updated) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'board',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getBoardById(id);
}

export async function deleteBoard(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // Remove board columns and board cards
  store.deleteWhere('boardColumns', (r: any) => r.boardId === id);
  store.deleteWhere('boardCards', (r: any) => r.boardId === id);

  const deleted = store.delete('boards', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'board',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}

// ── Column operations ────────────────────────────────────────────────

export async function createColumn(boardId: string, data: CreateColumnData) {
  return store.insert('boardColumns', {
    boardId,
    name: data.name,
    color: data.color ?? '#6B7280',
    position: data.position,
  });
}

export async function updateColumn(columnId: string, data: UpdateColumnData) {
  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date().toISOString();

  return store.update('boardColumns', columnId, setData) ?? null;
}

export async function deleteColumn(columnId: string) {
  // Remove cards from this column
  store.deleteWhere('boardCards', (r: any) => r.columnId === columnId);
  return store.delete('boardColumns', columnId) ?? null;
}

// ── Board-Card placement ─────────────────────────────────────────────

export async function addCardToBoard(boardId: string, cardId: string, columnId: string, position?: number) {
  // Check if card is already on this board
  const existing = store.findOne('boardCards', (r: any) => r.boardId === boardId && r.cardId === cardId);
  if (existing) return existing;

  // Auto-calculate position if not provided
  let pos = position;
  if (pos === undefined) {
    const columnCards = store.find('boardCards', (r: any) => r.boardId === boardId && r.columnId === columnId) as any[];
    pos = columnCards.length;
  }

  return store.insert('boardCards', {
    boardId,
    cardId,
    columnId,
    position: pos,
  });
}

export async function moveCardOnBoard(boardId: string, cardId: string, columnId: string, position?: number) {
  const boardCard = store.findOne('boardCards', (r: any) => r.boardId === boardId && r.cardId === cardId) as any;
  if (!boardCard) return null;

  let pos = position;
  if (pos === undefined) {
    const columnCards = store.find('boardCards', (r: any) => r.boardId === boardId && r.columnId === columnId) as any[];
    pos = columnCards.length;
  }

  return store.update('boardCards', boardCard.id, {
    columnId,
    position: pos,
    updatedAt: new Date().toISOString(),
  }) ?? null;
}

export async function removeCardFromBoard(boardId: string, cardId: string) {
  store.deleteWhere('boardCards', (r: any) => r.boardId === boardId && r.cardId === cardId);
  return true;
}
