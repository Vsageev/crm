import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const records: Record<string, Array<Record<string, unknown>>> = {};

  function collection(name: string) {
    records[name] ??= [];
    return records[name];
  }

  const store = {
    getAll: vi.fn((name: string) => [...collection(name)]),
    getById: vi.fn((name: string, id: string) =>
      collection(name).find((record) => record.id === id) ?? null,
    ),
    insert: vi.fn((name: string, data: Record<string, unknown>) => {
      const now = '2026-05-21T00:00:00.000Z';
      const record = {
        id: `${name}-${collection(name).length + 1}`,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      collection(name).push(record);
      return record;
    }),
    update: vi.fn((name: string, id: string, data: Record<string, unknown>) => {
      const rows = collection(name);
      const index = rows.findIndex((record) => record.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...data, updatedAt: '2026-05-21T01:00:00.000Z' };
      return rows[index];
    }),
    delete: vi.fn((name: string, id: string) => {
      const rows = collection(name);
      const index = rows.findIndex((record) => record.id === id);
      if (index < 0) return null;
      const [deleted] = rows.splice(index, 1);
      return deleted;
    }),
  };

  return { records, store };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/repositories/board-execution-plans-repository.js', () => ({
  getBoardExecutionPlanRecordById: vi.fn(async (id: string) =>
    mocks.records.boardExecutionPlans?.find((record) => record.id === id) ?? null,
  ),
  listBoardExecutionPlansForBoard: vi.fn(async (boardId: string) =>
    (mocks.records.boardExecutionPlans ?? []).filter((record) => record.boardId === boardId),
  ),
}));
vi.mock('../db/repositories/boards-cards-repository.js', () => ({
  listBoardCardsByBoardIdNative: vi.fn(async (boardId: string) =>
    (mocks.records.boardCards ?? []).filter((record) => record.boardId === boardId),
  ),
  listBoardColumnsByBoardIdNative: vi.fn(async (boardId: string) =>
    (mocks.records.boardColumns ?? []).filter((record) => record.boardId === boardId),
  ),
}));

import {
  createBoardExecutionPlan,
  deleteBoardExecutionPlan,
  listBoardExecutionPlans,
  updateBoardExecutionPlan,
} from './board-execution-plans.js';

function seedBoard() {
  mocks.records.cards = [
    { id: 'card-a', name: 'Build API' },
    { id: 'card-b', name: 'Test API' },
  ];
  mocks.records.boardColumns = [
    { id: 'todo', boardId: 'board-1', name: 'To Do', position: 0 },
  ];
  mocks.records.boardCards = [
    { id: 'bc-a', boardId: 'board-1', cardId: 'card-a', columnId: 'todo', position: 0 },
    { id: 'bc-b', boardId: 'board-1', cardId: 'card-b', columnId: 'todo', position: 1 },
  ];
}

describe('board execution plans', () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.records)) delete mocks.records[key];
    vi.clearAllMocks();
    seedBoard();
  });

  it('persists and hydrates saved layers with dependency rules', async () => {
    const plan = await createBoardExecutionPlan(
      {
        boardId: 'board-1',
        name: 'Release plan',
        layers: [
          { cards: [{ id: 'card-a' }] },
          {
            cards: [{
              id: 'card-b',
              dependencyRule: { mode: 'specific_cards', cardIds: ['card-a'] },
            }],
          },
        ],
      },
      'user-1',
    );

    expect(plan.status).toBe('ready');
    expect(plan.layers[1]?.cards[0]).toMatchObject({
      id: 'card-b',
      name: 'Test API',
      subtitle: 'To Do',
      dependencyRule: { mode: 'specific_cards', cardIds: ['card-a'] },
    });

    const entries = await listBoardExecutionPlans('board-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Release plan');
  });

  it('marks plans invalid when a saved card is no longer on the board', async () => {
    const plan = await createBoardExecutionPlan(
      {
        boardId: 'board-1',
        name: 'Release plan',
        layers: [{ cards: [{ id: 'card-a' }, { id: 'card-b' }] }],
      },
      'user-1',
    );

    mocks.records.boardCards = mocks.records.boardCards?.filter((record) => record.cardId !== 'card-b');

    const updated = await updateBoardExecutionPlan(plan.id, {
      layers: plan.layers.map((layer) => ({
        cards: layer.cards.map((card) => ({ id: card.id, dependencyRule: card.dependencyRule })),
      })),
    });

    expect(updated?.status).toBe('invalid');
    expect(updated?.issues).toContain('Test API is no longer on this board.');
  });

  it('deletes saved execution plans', async () => {
    const plan = await createBoardExecutionPlan(
      { boardId: 'board-1', name: 'Delete me', layers: [{ cards: [{ id: 'card-a' }] }] },
      'user-1',
    );

    await expect(deleteBoardExecutionPlan(plan.id)).resolves.toBe(true);
    await expect(listBoardExecutionPlans('board-1')).resolves.toHaveLength(0);
  });
});
