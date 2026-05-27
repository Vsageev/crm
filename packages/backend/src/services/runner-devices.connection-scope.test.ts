import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  runners: [] as Record<string, unknown>[],
  pairingCodes: [] as Record<string, unknown>[],
}));

vi.mock('../db/index.js', () => ({
  store: {
    getAll: vi.fn((collection: string) => {
      if (collection === 'agentRunners') return [...storeState.runners];
      if (collection === 'agentRunnerPairingCodes') return [...storeState.pairingCodes];
      if (collection === 'workspaces') {
        return [{ id: 'workspace-1', userId: 'owner-1', memberIds: ['member-2'] }];
      }
      return [];
    }),
    getById: vi.fn((collection: string, id: string) => {
      const records = collection === 'agentRunners' ? storeState.runners : storeState.pairingCodes;
      return records.find((record) => record.id === id) ?? null;
    }),
    insert: vi.fn(async (collection: string, record: Record<string, unknown>) => {
      const created = {
        id: `${collection}-${storeState.runners.length + storeState.pairingCodes.length + 1}`,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z',
        ...record,
      };
      if (collection === 'agentRunners') storeState.runners.push(created);
      if (collection === 'agentRunnerPairingCodes') storeState.pairingCodes.push(created);
      return created;
    }),
    update: vi.fn(async (collection: string, id: string, patch: Record<string, unknown>) => {
      const records = collection === 'agentRunners' ? storeState.runners : storeState.pairingCodes;
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return null;
      records[index] = { ...records[index], ...patch, updatedAt: '2026-05-26T00:01:00.000Z' };
      return records[index];
    }),
  },
}));

vi.mock('./audit-log.js', () => ({
  createAuditLog: vi.fn(async () => undefined),
}));

vi.mock('./workspaces.js', () => ({
  getWorkspaceById: vi.fn(async (workspaceId: string) => ({
    id: workspaceId,
    userId: 'owner-1',
  })),
}));

import {
  assertRunnerActivationAllowed,
  assertRunnerConnectionActivatable,
  createRunnerPairingCode,
  evaluateRunnerActivation,
  listRunnerDevices,
  pairRunnerWithCode,
  rejectImmutableRunnerBindingPatch,
  RunnerActivationError,
  RunnerConnectionValidationError,
  validateRunnerConnectionBinding,
} from './runner-devices.js';

function seedRunner(record: Record<string, unknown>) {
  storeState.runners.push({
    id: `runner-${storeState.runners.length + 1}`,
    userId: 'owner-1',
    workspaceId: 'workspace-1',
    displayName: 'Runner',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    ...record,
  });
}

describe('runner connection scope', () => {
  beforeEach(() => {
    storeState.runners.length = 0;
    storeState.pairingCodes.length = 0;
  });

  it('backfills legacy rows as account-scoped bindings', () => {
    seedRunner({
      connectionScope: null,
      ownerAccountId: null,
      boundWorkspaceId: null,
      legacyConnectionScope: null,
    });

    expect(validateRunnerConnectionBinding(storeState.runners[0]!)).toMatchObject({
      connectionScope: 'account',
      ownerAccountId: 'owner-1',
      boundWorkspaceId: 'workspace-1',
      legacyConnectionScope: true,
    });
  });

  it('rejects malformed bindings before activation', () => {
    seedRunner({
      connectionScope: 'project',
      ownerAccountId: 'owner-1',
      boundWorkspaceId: '',
      workspaceId: '',
    });

    expect(() => assertRunnerConnectionActivatable(storeState.runners[0]!)).toThrow(
      RunnerConnectionValidationError,
    );
  });

  it('filters account vs project runners for list queries', () => {
    seedRunner({
      id: 'account-runner',
      connectionScope: 'account',
      ownerAccountId: 'owner-1',
      boundWorkspaceId: 'workspace-1',
      originalBoundWorkspaceId: 'workspace-1',
      legacyConnectionScope: true,
    });
    seedRunner({
      id: 'project-runner',
      userId: 'owner-2',
      connectionScope: 'project',
      ownerAccountId: 'owner-2',
      boundWorkspaceId: 'workspace-1',
      originalBoundWorkspaceId: 'workspace-1',
      legacyConnectionScope: false,
    });

    const accountEntries = listRunnerDevices('owner-1', { connectionScope: 'account' }, new Map());
    const projectEntries = listRunnerDevices('member-1', { connectionScope: 'project', workspaceId: 'workspace-1' }, new Map());

    expect(accountEntries.map((entry) => entry.id)).toEqual(['account-runner']);
    expect(projectEntries.map((entry) => entry.id)).toEqual(['project-runner']);
  });

  it('creates explicit account and project pairing scopes', async () => {
    const accountCode = await createRunnerPairingCode({
      userId: 'owner-1',
      workspaceId: 'workspace-1',
      displayName: 'Account runner',
      connectionScope: 'account',
    });
    expect(accountCode.code).toBeTruthy();

    const projectCode = await createRunnerPairingCode({
      userId: 'owner-1',
      workspaceId: 'workspace-1',
      displayName: 'Project runner',
      connectionScope: 'project',
    });
    expect(projectCode.code).toBeTruthy();

    const accountPair = await pairRunnerWithCode({ code: accountCode.code });
    const projectPair = await pairRunnerWithCode({ code: projectCode.code });

    expect(accountPair.runner).toMatchObject({
      connectionScope: 'account',
      legacyConnectionScope: false,
      boundWorkspaceId: 'workspace-1',
      originalBoundWorkspaceId: 'workspace-1',
    });
    expect(projectPair.runner).toMatchObject({
      connectionScope: 'project',
      legacyConnectionScope: false,
      boundWorkspaceId: 'workspace-1',
    });
    expect(accountPair.runner).not.toHaveProperty('credentialHash');
    expect(projectPair.runner).not.toHaveProperty('credential');
  });

  it('rejects immutable binding patches', () => {
    expect(() => rejectImmutableRunnerBindingPatch({ boundWorkspaceId: 'other-workspace' })).toThrow(
      RunnerActivationError,
    );
  });

  it('allows project workspace members to activate but blocks outsiders', () => {
    seedRunner({
      id: 'shared-project-runner',
      connectionScope: 'project',
      ownerAccountId: 'owner-1',
      boundWorkspaceId: 'workspace-1',
      originalBoundWorkspaceId: 'workspace-1',
      legacyConnectionScope: false,
    });
    const record = storeState.runners[0]!;

    expect(
      evaluateRunnerActivation({
        record,
        activationActorId: 'member-2',
        routingWorkspaceId: 'workspace-1',
      }).allowed,
    ).toBe(true);

    const outsider = evaluateRunnerActivation({
      record,
      activationActorId: 'outsider-9',
      routingWorkspaceId: 'workspace-1',
    });
    expect(outsider.allowed).toBe(false);
    if (!outsider.allowed) {
      expect(outsider.category).toBe('membership');
    }
  });

  it('blocks non-owners from activating account-scoped runners', () => {
    seedRunner({
      id: 'private-account-runner',
      connectionScope: 'account',
      ownerAccountId: 'owner-1',
      boundWorkspaceId: 'workspace-1',
      originalBoundWorkspaceId: 'workspace-1',
      legacyConnectionScope: false,
    });

    expect(() =>
      assertRunnerActivationAllowed({
        record: storeState.runners[0]!,
        activationActorId: 'member-2',
        routingWorkspaceId: 'workspace-1',
      }),
    ).toThrow(RunnerActivationError);
  });
});
