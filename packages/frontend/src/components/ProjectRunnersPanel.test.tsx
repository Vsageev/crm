/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRunnersPanel } from './ProjectRunnersPanel';
import type { RunnerConnection } from '../lib/runner-connections';

const projectRunner: RunnerConnection = {
  id: 'runner-project',
  workspaceId: 'workspace-1',
  connectionScope: 'project',
  ownerAccountId: 'owner-1',
  boundWorkspaceId: 'workspace-1',
  displayName: 'Shared runner',
  status: 'online',
  lastSeenAt: null,
  version: null,
  capabilities: {},
  revoked: false,
};

const accountRunner: RunnerConnection = {
  id: 'runner-account',
  workspaceId: 'workspace-1',
  connectionScope: 'account',
  ownerAccountId: 'owner-1',
  boundWorkspaceId: 'workspace-1',
  displayName: 'Personal laptop',
  status: 'offline',
  lastSeenAt: null,
  version: null,
  capabilities: {},
  revoked: false,
};

function renderPanel(overrides: Partial<Parameters<typeof ProjectRunnersPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ProjectRunnersPanel
        projectRunners={[projectRunner]}
        accountRunners={[accountRunner]}
        loading={false}
        workspaceName="Demo workspace"
        currentUserId="owner-1"
        connectDisabledReason={null}
        runnerDisabledReason={null}
        onRefresh={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('ProjectRunnersPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not show runner inventory when a runner is ready', () => {
    renderPanel();

    expect(screen.queryByTestId('agent-chat-runners-panel')).not.toBeInTheDocument();
  });

  it('explains scope rules in short empty hints', () => {
    renderPanel({ projectRunners: [], accountRunners: [] });

    expect(screen.getByText(/Shared · anyone with run access/)).toBeInTheDocument();
    expect(screen.getByText(/Your machine · output visible to team/)).toBeInTheDocument();
  });

  it('surfaces blocking runner state with connect and manage actions', () => {
    renderPanel({
      runnerDisabledReason:
        'Connect a project runner (shared) or an account runner (personal) for this workspace before sending agent messages.',
      projectRunners: [],
      accountRunners: [],
    });

    expect(screen.getByText('Runner required')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      /Connect a project runner \(shared\) or an account runner \(personal\) for this workspace/,
    );
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('blocks connect when workspace context is missing', () => {
    renderPanel({
      connectDisabledReason: 'Open a workspace before connecting a runner.',
      runnerDisabledReason: 'Connect an OpenWork runner before sending agent messages.',
      projectRunners: [],
      accountRunners: [],
    });

    const panel = screen.getByTestId('agent-chat-runners-panel');
    const connectButton = within(panel).getByRole('button', { name: 'Connect' });
    expect(connectButton).toHaveAttribute('aria-disabled', 'true');
  });
});
