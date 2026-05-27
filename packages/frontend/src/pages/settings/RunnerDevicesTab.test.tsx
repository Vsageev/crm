/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { RunnerDevicesTab } from './RunnerDevicesTab';

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

vi.mock('../../stores/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../../stores/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspaceId: 'workspace-1',
    activeWorkspace: { id: 'workspace-1', name: 'Demo workspace' },
  }),
}));

describe('RunnerDevicesTab add runner flow', () => {
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clipboardWriteText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });

    vi.mocked(api).mockImplementation(async (url, options) => {
      if (typeof url === 'string' && url.startsWith('/agent-runners?')) {
        return { entries: [] };
      }
      if (url === '/agent-runners/pairing-codes' && options?.method === 'POST') {
        return {
          id: 'pairing-1',
          code: 'PAIR-123',
          expiresAt: '2026-05-26T12:15:00.000Z',
        };
      }
      throw new Error(`Unexpected API call: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.mocked(api).mockReset();
  });

  it('loads all workspace runners instead of filtering to account runners only', async () => {
    render(<RunnerDevicesTab />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/agent-runners?workspaceId=workspace-1');
    });
  });

  it('creates a project pairing code and shows the runner command preview', async () => {
    render(<RunnerDevicesTab initialPairingScope="project" />);

    fireEvent.click(await screen.findByRole('button', { name: /Add runner/i }));

    expect(screen.getByRole('dialog', { name: 'Add runner' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', {
        name: /Project — Workspace members with agent-run access can activate it/i,
      }),
    ).toBeChecked();

    fireEvent.change(screen.getByLabelText('Runner name'), {
      target: { value: 'Shared build machine' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate command' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/agent-runners/pairing-codes', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: 'workspace-1',
          displayName: 'Shared build machine',
          connectionScope: 'project',
        }),
      });
    });

    expect(screen.getByText('PAIR-123')).toBeInTheDocument();
    expect(screen.getByText(/OPENWORK_RUNNER_PAIRING_CODE=PAIR-123/)).toBeInTheDocument();
    expect(screen.getByText(/Workspace members with agent-run permission/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith(
        expect.stringContaining('OPENWORK_RUNNER_PAIRING_CODE=PAIR-123'),
      );
    });
  });

  it('reopens add runner on the form instead of showing a stale pairing code', async () => {
    render(<RunnerDevicesTab />);

    fireEvent.click(await screen.findByRole('button', { name: /Add runner/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate command' }));

    expect(await screen.findByText('PAIR-123')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: /Add runner/i }));

    expect(screen.getByLabelText('Runner name')).toBeInTheDocument();
    expect(screen.queryByText('PAIR-123')).not.toBeInTheDocument();
  });
});
