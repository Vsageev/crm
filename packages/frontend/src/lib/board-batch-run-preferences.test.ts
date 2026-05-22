/** @vitest-environment jsdom */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  filterColumnIds,
  getBoardBatchRunPreferences,
  saveBoardBatchRunPreferences,
} from './board-batch-run-preferences';

describe('board-batch-run-preferences', () => {
  const boardId = 'board-1';

  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips saved preferences', () => {
    saveBoardBatchRunPreferences(boardId, {
      agentId: 'agent-a',
      prompt: 'Do the thing',
      scopeMode: 'filters',
      selectedColumnIds: ['col-1', 'col-2'],
      textFilter: 'bug',
      maxParallel: 5,
    });

    expect(getBoardBatchRunPreferences(boardId)).toEqual({
      agentId: 'agent-a',
      prompt: 'Do the thing',
      scopeMode: 'filters',
      selectedColumnIds: ['col-1', 'col-2'],
      textFilter: 'bug',
      maxParallel: 5,
    });
  });

  it('clamps maxParallel and drops invalid manual layers', () => {
    saveBoardBatchRunPreferences(boardId, {
      maxParallel: 99,
      manualLayers: [{ cards: [{ id: 'c1', name: 'Card' }, { id: '', name: '' } as never] }],
    });

    expect(getBoardBatchRunPreferences(boardId)).toEqual({
      maxParallel: 10,
      manualLayers: [{ cards: [{ id: 'c1', name: 'Card' }] }],
    });
  });

  it('filters column ids to those still on the board', () => {
    const valid = new Set(['col-1', 'col-3']);
    expect(filterColumnIds(['col-1', 'col-2', 'col-3'], valid)).toEqual(['col-1', 'col-3']);
    expect(filterColumnIds(['col-2'], valid)).toBeUndefined();
  });
});
