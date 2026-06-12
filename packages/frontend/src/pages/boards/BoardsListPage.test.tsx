/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { BoardsListPage } from './BoardsListPage';

const workspaceMock = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-1' as string | null,
  workspaces: [
    {
      id: 'workspace-1',
      name: 'Default Workspace',
      userId: 'user-1',
      boardIds: ['board-1'],
      collectionIds: [],
      agentGroupIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  refetchWorkspaces: vi.fn(async () => undefined),
}));

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public details?: unknown,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
  api: vi.fn(),
}));

vi.mock('../../stores/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspaceId: workspaceMock.activeWorkspaceId,
    activeWorkspace: workspaceMock.activeWorkspaceId
      ? workspaceMock.workspaces.find((workspace) => workspace.id === workspaceMock.activeWorkspaceId) ?? null
      : null,
    workspaces: workspaceMock.workspaces,
    setActiveWorkspace: vi.fn(),
    refetchWorkspaces: workspaceMock.refetchWorkspaces,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderBoardsList(initialPath = '/boards') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path="/boards" element={<BoardsListPage />} />
        <Route path="/boards/:id" element={<div>Board detail route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BoardsListPage workspace behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    workspaceMock.activeWorkspaceId = 'workspace-1';
    workspaceMock.workspaces = [
      {
        id: 'workspace-1',
        name: 'Default Workspace',
        userId: 'user-1',
        boardIds: ['board-1'],
        collectionIds: [],
        agentGroupIds: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    workspaceMock.refetchWorkspaces.mockClear();
    vi.mocked(api).mockImplementation(async (url) => {
      if (url === '/boards?workspaceId=workspace-1') {
        return {
          total: 1,
          entries: [
            {
              id: 'board-1',
              name: 'Alpha board',
              description: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }
      if (url === '/boards') {
        return {
          total: 1,
          entries: [
            {
              id: 'board-1',
              name: 'Alpha board',
              description: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }
      if (url === '/boards/board-1') {
        return { columns: [], cards: [] };
      }
      if (url === '/boards/batch-runs?status=active&limit=200') {
        return { entries: [] };
      }
      throw new Error(`Unexpected API call: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.mocked(api).mockReset();
  });

  it('keeps the board list open when a concrete workspace is selected', async () => {
    renderBoardsList();

    await waitFor(() => expect(api).toHaveBeenCalledWith('/boards?workspaceId=workspace-1'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/boards/board-1'));
    expect(screen.getByTestId('location')).toHaveTextContent('/boards');
    expect(screen.queryByText('Board detail route')).not.toBeInTheDocument();
  });

  it('refreshes workspace membership after loading boards', async () => {
    workspaceMock.activeWorkspaceId = null;
    workspaceMock.workspaces = [
      {
        ...workspaceMock.workspaces[0],
        boardIds: [],
      },
    ];

    renderBoardsList();

    await waitFor(() => expect(api).toHaveBeenCalledWith('/boards'));
    await waitFor(() => expect(workspaceMock.refetchWorkspaces).toHaveBeenCalled());
  });
});
