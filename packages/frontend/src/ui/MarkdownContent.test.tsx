/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownContent } from './MarkdownContent';
import { api } from '../lib/api';
import { showToast } from '../stores/toast';

vi.mock('../lib/api', () => ({
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

vi.mock('../stores/toast', () => ({
  showToast: vi.fn(),
}));

describe('MarkdownContent local file links', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(api).mockReset();
    vi.mocked(showToast).mockReset();
  });

  it('opens a local file action menu and can reveal the file in the OS file manager', async () => {
    vi.mocked(api).mockResolvedValue(undefined);

    render(<MarkdownContent>{'[file](/Users/vladislav/project/src/app.ts:12)'}</MarkdownContent>);

    fireEvent.click(screen.getByRole('link', { name: 'file' }));

    expect(screen.getByRole('menuitem', { name: 'Open in Cursor' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open in VS Code' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /Reveal in/ }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/runner-filesystem/reveal', {
        method: 'POST',
        body: JSON.stringify({
          path: '/Users/vladislav/project/src/app.ts',
          agentId: undefined,
          workspaceId: undefined,
        }),
      });
    });
  });

  it('includes agent and workspace scope when revealing a chat file link', async () => {
    vi.mocked(api).mockResolvedValue(undefined);

    render(
      <MarkdownContent
        fileRevealAgentId="agent-1"
        fileRevealWorkspaceId="workspace-1"
      >
        {'[file](/Users/vladislav/project/src/app.ts:12)'}
      </MarkdownContent>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'file' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Reveal in/ }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/runner-filesystem/reveal', {
        method: 'POST',
        body: JSON.stringify({
          path: '/Users/vladislav/project/src/app.ts',
          agentId: 'agent-1',
          workspaceId: 'workspace-1',
        }),
      });
    });
  });
});
