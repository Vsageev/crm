import { describe, expect, it } from 'vitest';
import {
  buildRunnerListQuery,
  countActivatableRunners,
  formatRunnerCapabilities,
  isRunnerActivatable,
  ownerAccountLabel,
  runnerActivationHint,
  runnerBindingHint,
  runnerScopeLabel,
  summarizeAgentChatRunners,
} from './runner-connections';

describe('runner-connections', () => {
  it('builds scoped list queries', () => {
    expect(
      buildRunnerListQuery({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        connectionScope: 'project',
      }),
    ).toBe('?workspaceId=00000000-0000-4000-8000-000000000001&connectionScope=project');
  });

  it('labels connection scopes', () => {
    expect(runnerScopeLabel('account')).toBe('Account runner');
    expect(runnerScopeLabel('project')).toBe('Project runner');
  });

  it('counts activatable runners', () => {
    const base = {
      workspaceId: 'w1',
      displayName: 'Runner',
      lastSeenAt: null,
      version: null,
      capabilities: {},
    };
    const devices = [
      { ...base, id: '1', status: 'online' as const, revoked: false },
      { ...base, id: '2', status: 'offline' as const, revoked: false },
      { ...base, id: '3', status: 'busy' as const, revoked: true },
    ];
    expect(countActivatableRunners(devices)).toBe(1);
    expect(isRunnerActivatable(devices[0])).toBe(true);
  });

  it('formats capability summaries', () => {
    expect(
      formatRunnerCapabilities({
        id: 'r1',
        workspaceId: 'w1',
        displayName: 'Dev',
        status: 'online',
        lastSeenAt: null,
        version: '1.0.0',
        capabilities: { os: 'darwin', arch: 'arm64', supportsFilesystem: true },
        revoked: false,
      }),
    ).toContain('filesystem');
  });

  it('explains account activation restrictions', () => {
    const hint = runnerActivationHint(
      {
        id: 'r1',
        workspaceId: 'w1',
        connectionScope: 'account',
        ownerAccountId: 'owner-1',
        displayName: 'Mine',
        status: 'online',
        lastSeenAt: null,
        version: null,
        capabilities: {},
        revoked: false,
      },
      'other-user',
    );
    expect(hint).toContain('Only the pairing account');
  });

  it('labels owner accounts for settings and agent space lists', () => {
    expect(ownerAccountLabel('owner-1', 'owner-1')).toBe('Your account');
    expect(ownerAccountLabel('owner-1', 'member-2')).toBe('Another account');
  });

  it('explains immutable project workspace binding', () => {
    const hint = runnerBindingHint({
      id: 'r1',
      workspaceId: '00000000-0000-4000-8000-000000000099',
      connectionScope: 'project',
      boundWorkspaceId: '00000000-0000-4000-8000-000000000099',
      displayName: 'Shared',
      status: 'online',
      lastSeenAt: null,
      version: null,
      capabilities: {},
      revoked: false,
    });
    expect(hint).toContain('cannot be moved');
  });

  it('allows shared project runner activation hints for members', () => {
    const hint = runnerActivationHint(
      {
        id: 'r1',
        workspaceId: 'w1',
        connectionScope: 'project',
        ownerAccountId: 'owner-1',
        displayName: 'Shared',
        status: 'online',
        lastSeenAt: null,
        version: null,
        capabilities: {},
        revoked: false,
      },
      'member-2',
    );
    expect(hint).toContain('workspace member');
  });

  it('summarizes agent chat runner readiness across scopes', () => {
    const base = {
      workspaceId: 'w1',
      displayName: 'Runner',
      lastSeenAt: null,
      version: null,
      capabilities: {},
      revoked: false,
    };
    const summary = summarizeAgentChatRunners(
      [{ ...base, id: 'p1', status: 'online', connectionScope: 'project' }],
      [{ ...base, id: 'a1', status: 'offline', connectionScope: 'account' }],
      {},
    );

    expect(summary.status).toBe('ready');
    expect(summary.headline).toBe('1 runner ready');
    expect(summary.detail).toBe('1 project');
  });

  it('marks chat as blocked when runnerDisabledReason is present', () => {
    const summary = summarizeAgentChatRunners([], [], {
      runnerDisabledReason: 'Connect a runner before sending messages.',
    });

    expect(summary.status).toBe('blocked');
    expect(summary.headline).toBe('Runner required');
    expect(summary.detail).toBe('Connect a runner before sending messages.');
  });
});
