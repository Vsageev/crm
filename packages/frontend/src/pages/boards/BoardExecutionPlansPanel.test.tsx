/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardExecutionPlansPanel } from './BoardExecutionPlansPanel';
import type { BoardExecutionPlan } from '../../lib/agent-batch';
import type { ExecutionPlansExperiments } from '../../devtools/execution-plans-experiments';

const baseExperiments: ExecutionPlansExperiments = {
  boardDragIn: false,
  selectionToolbar: false,
  columnToLayer: false,
  liveBadges: false,
  plannerPolish: false,
  planTemplates: false,
  dependencyShortcuts: false,
  embedBatchPlanner: false,
};

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BoardExecutionPlansPanel layer list mode', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('only exposes the layer-list planner when creating a plan', async () => {
    const savedPlan: BoardExecutionPlan = {
      id: 'plan-1',
      boardId: 'board-1',
      name: 'Layer plan',
      description: null,
      status: 'ready',
      layers: [{ cards: [{ id: 'card-a', name: 'Alpha' }] }],
      issues: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/boards/board-1/execution-plans' && !init?.method) {
        return jsonResponse({ entries: [], total: 0 });
      }
      if (url === '/api/boards/board-1/execution-plans' && init?.method === 'POST') {
        return jsonResponse(savedPlan, { status: 201 });
      }
      return jsonResponse({ message: 'Unexpected request' }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BoardExecutionPlansPanel
        boardId="board-1"
        availableCards={[
          { id: 'card-a', name: 'Alpha', columnId: 'todo', columnName: 'Todo', columnColor: '#111111' },
        ]}
        experiments={baseExperiments}
        onClose={vi.fn()}
        onRunPlan={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'New plan' }));

    expect(screen.getByText('Execution Plan')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search board cards or columns...')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Release pipeline'), {
      target: { value: 'Layer plan' },
    });
    const searchInput = screen.getByPlaceholderText('Search board cards or columns...');
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'alp' } });
    fireEvent.click(await screen.findByText('Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/boards/board-1/execution-plans',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const createCall = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === '/api/boards/board-1/execution-plans'
        && (init as RequestInit | undefined)?.method === 'POST'
    ));
    const body = JSON.parse(String((createCall?.[1] as RequestInit).body));
    expect(body).toEqual({
      name: 'Layer plan',
      description: null,
      layers: [{ cards: [{ id: 'card-a' }] }],
    });
  });

  it('surfaces the concrete blocker for invalid run buttons', async () => {
    const plan: BoardExecutionPlan = {
      id: 'plan-invalid',
      boardId: 'board-1',
      name: 'Invalid plan',
      description: null,
      status: 'invalid',
      layers: [{ cards: [{ id: 'card-a', name: 'Alpha' }] }],
      issues: ['Plan has invalid dependencies'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/boards/board-1/execution-plans' && !init?.method) {
        return jsonResponse({ entries: [plan], total: 1 });
      }
      return jsonResponse({ message: 'Unexpected request' }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BoardExecutionPlansPanel
        boardId="board-1"
        availableCards={[{ id: 'card-a', name: 'Alpha', columnId: 'todo', columnName: 'Todo', columnColor: '#111111' }]}
        experiments={baseExperiments}
        onClose={vi.fn()}
        onRunPlan={vi.fn()}
      />,
    );

    expect(await screen.findByText('Invalid plan')).toBeInTheDocument();
    const runButton = screen.getByRole('button', { name: 'Run from plan' });
    expect(runButton).toHaveAttribute('aria-disabled', 'true');
    expect(runButton).toHaveAccessibleDescription('Plan has invalid dependencies');

    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }));
    expect(screen.getAllByText('Plan has invalid dependencies').length).toBeGreaterThan(0);
    expect(screen.queryByText('1 issue')).not.toBeInTheDocument();
    expect(screen.queryByText('0 dependency rules')).not.toBeInTheDocument();
  });

  it('moves the plan rail when dragging the move handle', async () => {
    localStorage.clear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/boards/board-1/execution-plans') {
        return jsonResponse({ entries: [], total: 0 });
      }
      return jsonResponse({ message: 'Unexpected request' }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <BoardExecutionPlansPanel
        boardId="board-1"
        availableCards={[]}
        experiments={baseExperiments}
        onClose={vi.fn()}
        onRunPlan={vi.fn()}
      />,
    );

    await screen.findByText('Execution Plans');
    const panel = container.querySelector('[class*="railPanel"]') as HTMLElement;
    const initialLeft = Number.parseInt(panel.style.left, 10);
    const initialTop = Number.parseInt(panel.style.top, 10);

    const handle = screen.getByRole('button', { name: 'Move execution plans panel' });
    fireEvent.mouseDown(handle, { clientX: 600, clientY: 200, button: 0 });
    fireEvent.mouseMove(window, { clientX: 540, clientY: 200 });
    fireEvent.mouseUp(window, { clientX: 540, clientY: 200 });

    await waitFor(() => {
      expect(Number.parseInt(panel.style.left, 10)).toBe(initialLeft - 60);
    });
    expect(JSON.parse(localStorage.getItem('execution-plans-rail-position') ?? '{}')).toEqual({
      x: initialLeft - 60,
      y: initialTop,
    });
  });
});
