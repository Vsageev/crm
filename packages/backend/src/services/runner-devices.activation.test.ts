import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({
  store: {
    getAll: vi.fn((collection: string) => {
      if (collection === 'workspaces') {
        return [{ id: 'workspace-1', userId: 'owner-1', memberIds: ['teammate-2'] }];
      }
      return [];
    }),
    getById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import {
  evaluateRunnerActivation,
  RunnerActivationError,
  assertRunnerActivationAllowed,
} from './runner-devices.js';

describe('runner activation ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the owner account to activate an account-connected runner', () => {
    const result = evaluateRunnerActivation({
      record: {
        id: 'runner-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        connectionScope: 'account',
        ownerAccountId: 'owner-1',
        boundWorkspaceId: 'workspace-1',
        legacyConnectionScope: false,
      },
      activationActorId: 'owner-1',
      routingWorkspaceId: 'workspace-1',
    });
    expect(result).toMatchObject({ allowed: true });
  });

  it('denies another account activating an account-connected runner', () => {
    const result = evaluateRunnerActivation({
      record: {
        id: 'runner-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        connectionScope: 'account',
        ownerAccountId: 'owner-1',
        boundWorkspaceId: 'workspace-1',
        legacyConnectionScope: true,
      },
      activationActorId: 'teammate-1',
      routingWorkspaceId: 'workspace-1',
    });
    expect(result).toEqual(
      expect.objectContaining({
        allowed: false,
        code: 'runner_activation_forbidden',
        category: 'ownership',
        statusCode: 409,
      }),
    );
  });

  it('allows project workspace members to activate a project-connected runner', () => {
    const result = evaluateRunnerActivation({
      record: {
        id: 'runner-2',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        connectionScope: 'project',
        ownerAccountId: 'owner-1',
        boundWorkspaceId: 'workspace-1',
        legacyConnectionScope: false,
      },
      activationActorId: 'teammate-2',
      routingWorkspaceId: 'workspace-1',
    });
    expect(result).toMatchObject({ allowed: true });
  });

  it('throws RunnerActivationError with category metadata from assertRunnerActivationAllowed', () => {
    expect(() =>
      assertRunnerActivationAllowed({
        record: {
          id: 'runner-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
          connectionScope: 'account',
          ownerAccountId: 'owner-1',
          boundWorkspaceId: 'workspace-1',
        },
        activationActorId: 'other-user',
        routingWorkspaceId: 'workspace-1',
      }),
    ).toThrow(RunnerActivationError);

    try {
      assertRunnerActivationAllowed({
        record: {
          id: 'runner-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
          connectionScope: 'account',
          ownerAccountId: 'owner-1',
          boundWorkspaceId: 'workspace-1',
        },
        activationActorId: 'other-user',
        routingWorkspaceId: 'workspace-1',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerActivationError);
      expect((error as RunnerActivationError).code).toBe('runner_activation_forbidden');
      expect((error as RunnerActivationError).category).toBe('ownership');
      expect((error as RunnerActivationError).statusCode).toBe(409);
    }
  });
});
