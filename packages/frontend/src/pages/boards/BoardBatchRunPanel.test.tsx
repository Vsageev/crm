/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardBatchRunPanel } from './BoardBatchRunPanel';

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BoardBatchRunPanel disabled launch state', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exposes the missing-agent blocker on hover and keyboard focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agents?limit=100') return jsonResponse({ entries: [] });
      if (url.startsWith('/api/boards/board-1/batch-run/preview')) return jsonResponse({ count: 1 });
      return jsonResponse({ message: 'Unexpected request' }, { status: 500 });
    }));

    render(
      <BoardBatchRunPanel
        boardId="board-1"
        columns={[{ id: 'todo', name: 'Todo', color: '#3B82F6', position: 0 }]}
        availableCards={[{ id: 'card-a', name: 'Alpha', columnId: 'todo', columnName: 'Todo' }]}
        onClose={vi.fn()}
      />,
    );

    const runButton = await screen.findByRole('button', { name: 'Run batch' });
    expect(runButton).toHaveAttribute('aria-disabled', 'true');
    expect(runButton).toHaveAccessibleDescription('Select an agent first');

    fireEvent.mouseEnter(runButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Select an agent first');

    fireEvent.mouseLeave(runButton);
    runButton.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Select an agent first');
  });

  it('blocks batch launch with runner repair guidance before submit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/agents?limit=100') {
        return jsonResponse({
          entries: [
            {
              id: 'agent-1',
              name: 'Runner Agent',
              status: 'active',
              avatarIcon: 'spark',
              avatarBgColor: '#1a1a2e',
              avatarLogoColor: '#e94560',
            },
          ],
        });
      }
      if (url === '/api/agents/agent-1/runner-preflight') {
        return jsonResponse({
          state: 'workspace_repair_required',
          code: 'agent_repository_root_repair_required',
          message: 'This repository root must be verified on the selected runner before queueing jobs.',
          hint: 'Use the repository root verify/repair action to validate the path with a paired runner.',
        });
      }
      if (url.startsWith('/api/boards/board-1/batch-run/preview')) return jsonResponse({ count: 1 });
      return jsonResponse({ message: 'Unexpected request' }, { status: 500 });
    }));

    render(
      <BoardBatchRunPanel
        boardId="board-1"
        columns={[{ id: 'todo', name: 'Todo', color: '#3B82F6', position: 0 }]}
        availableCards={[{ id: 'card-a', name: 'Alpha', columnId: 'todo', columnName: 'Todo' }]}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('Workspace repair required')).toBeInTheDocument();
    expect(screen.getAllByText(/verify\/repair action/i).length).toBeGreaterThan(0);

    const runButton = screen.getByRole('button', { name: 'Run batch' });
    expect(runButton).toHaveAttribute('aria-disabled', 'true');
    expect(runButton).toHaveAccessibleDescription(
      'Use the repository root verify/repair action to validate the path with a paired runner.',
    );
  });
});
