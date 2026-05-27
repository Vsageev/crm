/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnerConnectionList, RunnerScopePicker } from './RunnerConnectionList';
import type { RunnerConnection } from '../lib/runner-connections';

const accountRunner: RunnerConnection = {
  id: 'runner-account',
  workspaceId: 'workspace-1',
  connectionScope: 'account',
  ownerAccountId: 'owner-1',
  boundWorkspaceId: 'workspace-1',
  legacyConnectionScope: true,
  displayName: 'Personal laptop',
  status: 'online',
  lastSeenAt: '2026-05-26T12:00:00.000Z',
  version: '1.0.0',
  capabilities: { os: 'darwin', supportsFilesystem: true },
  revoked: false,
};

const projectRunner: RunnerConnection = {
  ...accountRunner,
  id: 'runner-project',
  connectionScope: 'project',
  legacyConnectionScope: false,
  displayName: 'Shared CI runner',
};

describe('RunnerConnectionList', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows account scope labels and owner-only activation hint for non-owners', () => {
    render(
      <RunnerConnectionList
        devices={[accountRunner]}
        currentUserId="teammate-2"
        workspaceName="Demo workspace"
      />,
    );

    expect(screen.getByText('Account runner')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    expect(screen.getByText(/Only the pairing account can start jobs/)).toBeInTheDocument();
    expect(screen.getByText(/Another account/)).toBeInTheDocument();
  });

  it('shows project scope immutability guidance in agent space', () => {
    render(
      <RunnerConnectionList
        devices={[projectRunner]}
        currentUserId="owner-1"
        workspaceName="Demo workspace"
      />,
    );

    expect(screen.getByText('Project runner')).toBeInTheDocument();
    expect(
      screen.getByText(/Project runners stay on this workspace/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Any workspace member with agent-run permission/),
    ).toBeInTheDocument();
  });

  it('renders empty state for project agent space', () => {
    render(
      <RunnerConnectionList
        devices={[]}
        emptyTitle="No project runners paired"
        emptyHint="Connect a project runner to share activation."
      />,
    );

    expect(screen.getByText('No project runners paired')).toBeInTheDocument();
    expect(screen.getByText('Connect a project runner to share activation.')).toBeInTheDocument();
  });
});

describe('RunnerScopePicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('documents account vs project pairing choices in settings', () => {
    const onChange = vi.fn();
    render(<RunnerScopePicker value="account" onChange={onChange} />);

    expect(
      screen.getByRole('radio', {
        name: /Account — Only you can activate this runner after pairing/i,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', {
        name: /Project — Workspace members with agent-run access can activate it/i,
      }),
    ).toBeInTheDocument();
  });
});
