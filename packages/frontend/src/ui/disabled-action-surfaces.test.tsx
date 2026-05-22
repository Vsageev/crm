/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { RateLimitsTab } from '../pages/settings/RateLimitsTab';
import { api } from '../lib/api';
import { WorkspaceModal } from './WorkspaceModal';

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
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../stores/WorkspaceContext', () => ({
  useWorkspace: () => ({ activeWorkspaceId: 'workspace-1' }),
}));

describe('disabled action explanations', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('explains why an unchanged file preview cannot be saved', async () => {
    render(
      <FilePreviewModal
        fileName="notes.md"
        downloadUrl="/api/files/notes.md"
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onLoadTextContent={async () => '# Notes'}
        onSaveTextContent={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).toHaveAccessibleDescription('Make a change before saving.');

    fireEvent.mouseEnter(save);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Make a change before saving.');
  });

  it('explains no-change settings saves with a tooltip', async () => {
    vi.mocked(api).mockResolvedValue({
      agentPromptMax: 10,
      agentPromptWindowS: 60,
    });

    render(<RateLimitsTab />);

    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toHaveAccessibleDescription('Change a rate limit before saving.');

    fireEvent.focus(save);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Change a rate limit before saving.');
  });

  it('uses inline form help for a missing workspace name', async () => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (url === '/boards?limit=200') return { entries: [] };
      if (url === '/collections?limit=200') return { entries: [] };
      if (url === '/agent-groups') return { entries: [] };
      return {};
    });

    render(<WorkspaceModal workspace={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    const name = screen.getByPlaceholderText('Workspace name');
    expect(name).toHaveAccessibleDescription('Enter a workspace name before saving.');
    expect(screen.getByText('Enter a workspace name before saving.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/boards?limit=200');
    });
  });
});
