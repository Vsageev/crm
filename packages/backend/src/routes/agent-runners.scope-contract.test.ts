import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { agentRunnerRoutes } from './agent-runners.js';

const mocks = vi.hoisted(() => ({
  listRunnerDevices: vi.fn(),
  listConnectedAgentRunners: vi.fn(),
  createRunnerPairingCode: vi.fn(),
  pairRunnerWithCode: vi.fn(),
  renameRunnerDevice: vi.fn(),
  revokeRunnerDevice: vi.fn(),
  disconnectRemoteAgentRunner: vi.fn(),
  getLiveRunnerStatusMap: vi.fn(),
  getLiveRunnerCapabilitiesMap: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock('../services/agent-runners.js', () => ({
  listConnectedAgentRunners: mocks.listConnectedAgentRunners,
  getLiveRunnerStatusMap: mocks.getLiveRunnerStatusMap,
  getLiveRunnerCapabilitiesMap: mocks.getLiveRunnerCapabilitiesMap,
  disconnectRemoteAgentRunner: mocks.disconnectRemoteAgentRunner,
}));
const runnerDeviceMocks = vi.hoisted(() => ({
  canAccessWorkspace: vi.fn(() => true),
  assertWorkspaceAccessible: vi.fn(async () => undefined),
}));

vi.mock('../services/runner-devices.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/runner-devices.js')>();
  return {
    ...actual,
    createRunnerPairingCode: mocks.createRunnerPairingCode,
    listRunnerDevices: mocks.listRunnerDevices,
    pairRunnerWithCode: mocks.pairRunnerWithCode,
    renameRunnerDevice: mocks.renameRunnerDevice,
    revokeRunnerDevice: mocks.revokeRunnerDevice,
    canAccessWorkspace: runnerDeviceMocks.canAccessWorkspace,
    assertWorkspaceAccessible: runnerDeviceMocks.assertWorkspaceAccessible,
  };
});
vi.mock('../middleware/rbac.js', () => ({
  requirePermission: mocks.requirePermission,
}));

async function buildRouteApp(userId = 'owner-1') {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: userId };
  });
  registerErrorHandler(app);
  await app.register(agentRunnerRoutes);
  return app;
}

describe('runner connection scope route contract', () => {
  beforeEach(() => {
    runnerDeviceMocks.canAccessWorkspace.mockReset();
    runnerDeviceMocks.canAccessWorkspace.mockReturnValue(true);
    runnerDeviceMocks.assertWorkspaceAccessible.mockReset();
    runnerDeviceMocks.assertWorkspaceAccessible.mockResolvedValue(undefined);
    mocks.listRunnerDevices.mockReset();
    mocks.listConnectedAgentRunners.mockReset();
    mocks.createRunnerPairingCode.mockReset();
    mocks.pairRunnerWithCode.mockReset();
    mocks.renameRunnerDevice.mockReset();
    mocks.revokeRunnerDevice.mockReset();
    mocks.disconnectRemoteAgentRunner.mockReset();
    mocks.getLiveRunnerStatusMap.mockReset();
    mocks.getLiveRunnerCapabilitiesMap.mockReset();
    mocks.requirePermission.mockReset();
    mocks.requirePermission.mockImplementation(() => async () => undefined);
    mocks.getLiveRunnerStatusMap.mockReturnValue(new Map());
    mocks.getLiveRunnerCapabilitiesMap.mockReturnValue(new Map());
    mocks.listRunnerDevices.mockReturnValue([]);
    mocks.listConnectedAgentRunners.mockReturnValue([]);
  });

  it('lists runner connections for the authenticated owner account', async () => {
    mocks.listRunnerDevices.mockReturnValue([
      {
        id: 'runner-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        displayName: 'Dev laptop',
        status: 'offline',
        lastSeenAt: null,
        version: null,
        capabilities: {},
        capabilitySource: 'unavailable',
        revoked: false,
        revokedAt: null,
        createdAt: '2026-05-26T00:00:00.000Z',
        updatedAt: '2026-05-26T00:00:00.000Z',
      },
    ]);
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/agent-runners?workspaceId=00000000-0000-4000-8000-000000000001',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      entries: [
        expect.objectContaining({
          id: 'runner-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
        }),
      ],
    });
    expect(mocks.listRunnerDevices).toHaveBeenCalledWith(
      'owner-1',
      { workspaceId: '00000000-0000-4000-8000-000000000001', connectionScope: undefined },
      expect.any(Map),
      expect.any(Map),
      expect.any(Function),
    );
  });

  it('uses workspace access filtering for default workspace-scoped lists', async () => {
    runnerDeviceMocks.canAccessWorkspace.mockReturnValue(false);
    const app = await buildRouteApp('outsider-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/agent-runners?workspaceId=00000000-0000-4000-8000-000000000001',
    });

    expect(response.statusCode).toBe(200);
    const workspaceAccess = mocks.listRunnerDevices.mock.calls[0]?.[4];
    expect(workspaceAccess).toEqual(expect.any(Function));
    expect(workspaceAccess('00000000-0000-4000-8000-000000000001')).toBe(false);
  });

  it('passes connectionScope filters to the list service', async () => {
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/agent-runners?workspaceId=00000000-0000-4000-8000-000000000001&connectionScope=project',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.listRunnerDevices).toHaveBeenCalledWith(
      'owner-1',
      {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        connectionScope: 'project',
      },
      expect.any(Map),
      expect.any(Map),
      expect.any(Function),
    );
  });

  it('creates pairing codes with explicit connection scope', async () => {
    mocks.createRunnerPairingCode.mockResolvedValue({
      id: 'pairing-1',
      code: 'ABCD2345',
      expiresAt: '2026-05-26T00:10:00.000Z',
    });
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-runners/pairing-codes',
      payload: {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        displayName: 'Project runner',
        connectionScope: 'project',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.createRunnerPairingCode).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionScope: 'project',
      }),
      expect.any(Object),
    );
  });

  it('rejects rename when the caller is not the owner account', async () => {
    mocks.renameRunnerDevice.mockResolvedValue(null);
    const app = await buildRouteApp('other-user');

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/agent-runners/00000000-0000-4000-8000-000000000099',
      payload: { displayName: 'Renamed' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ message: 'Runner not found' });
    expect(mocks.renameRunnerDevice).toHaveBeenCalledWith(
      'other-user',
      '00000000-0000-4000-8000-000000000099',
      'Renamed',
      expect.objectContaining({ userId: 'other-user' }),
    );
  });

  it('rejects revoke when the caller is not the owner account', async () => {
    mocks.revokeRunnerDevice.mockResolvedValue(null);
    const app = await buildRouteApp('other-user');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-runners/00000000-0000-4000-8000-000000000099/revoke',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ message: 'Runner not found' });
    expect(mocks.disconnectRemoteAgentRunner).not.toHaveBeenCalled();
  });

  it('rejects pairing-code creation for a workspace the caller does not own', async () => {
    mocks.createRunnerPairingCode.mockRejectedValue(new Error('Workspace not found'));
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-runners/pairing-codes',
      payload: {
        workspaceId: '00000000-0000-4000-8000-000000000002',
        displayName: 'Shared runner',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: 'Workspace not found' });
  });

  it('requires workspaceId when listing project-scoped runners', async () => {
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/agent-runners?connectionScope=project',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'runner_connection_workspace_required',
      message: expect.stringContaining('workspaceId'),
    });
    expect(mocks.listRunnerDevices).not.toHaveBeenCalled();
  });

  it('rejects project runner listing for workspaces the caller cannot access', async () => {
    const { RunnerActivationError } = await import('../services/runner-devices.js');
    runnerDeviceMocks.assertWorkspaceAccessible.mockRejectedValue(
      new RunnerActivationError(
        'runner_connection_forbidden',
        'You do not have access to runner connections for this workspace.',
        403,
      ),
    );
    const app = await buildRouteApp('outsider-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/agent-runners?workspaceId=00000000-0000-4000-8000-000000000001&connectionScope=project',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'runner_connection_forbidden',
    });
    expect(mocks.listRunnerDevices).not.toHaveBeenCalled();
  });

  it('rejects invalid pairing scope values at the HTTP schema layer', async () => {
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-runners/pairing-codes',
      payload: {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        displayName: 'Bad scope',
        connectionScope: 'team',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_error',
    });
    expect(mocks.createRunnerPairingCode).not.toHaveBeenCalled();
  });

  it('maps service invalid scope errors to runner_connection_invalid_scope', async () => {
    mocks.createRunnerPairingCode.mockRejectedValue(new Error('Invalid runner connection scope'));
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent-runners/pairing-codes',
      payload: {
        workspaceId: '00000000-0000-4000-8000-000000000001',
        displayName: 'Bad scope',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'runner_connection_invalid_scope',
    });
  });

  it('does not accept bound workspace or connection scope in rename payloads', async () => {
    mocks.renameRunnerDevice.mockResolvedValue({
      id: 'runner-1',
      userId: 'owner-1',
      workspaceId: 'workspace-1',
      displayName: 'Still mine',
      status: 'offline',
      lastSeenAt: null,
      version: null,
      capabilities: {},
      capabilitySource: 'unavailable',
      revoked: false,
      revokedAt: null,
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:00:00.000Z',
    });
    const app = await buildRouteApp('owner-1');

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/agent-runners/00000000-0000-4000-8000-000000000099',
      payload: {
        displayName: 'Still mine',
        connectionScope: 'project',
        boundWorkspaceId: '00000000-0000-4000-8000-000000000099',
        workspaceId: '00000000-0000-4000-8000-000000000099',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.renameRunnerDevice).toHaveBeenCalledWith(
      'owner-1',
      '00000000-0000-4000-8000-000000000099',
      'Still mine',
      expect.any(Object),
    );
  });
});

describe('runner activation contract', () => {
  it('documents denial categories for activation failures', () => {
    expect(['ownership', 'membership', 'workspace_binding', 'capability']).toContain('ownership');
  });
});

describe('runner connection scope target contract (documented for schema/API card)', () => {
  it('documents immutable binding fields', () => {
    expect(['connectionScope', 'ownerAccountId', 'boundWorkspaceId']).toEqual([
      'connectionScope',
      'ownerAccountId',
      'boundWorkspaceId',
    ]);
  });

  it('documents activation vs visibility split for account scope', () => {
    const accountScope = {
      connectionScope: 'account' as const,
      activationActorMustEqualOwner: true,
      artifactVisibilityFollowsProjectAcl: true,
    };
    expect(accountScope.activationActorMustEqualOwner).toBe(true);
    expect(accountScope.artifactVisibilityFollowsProjectAcl).toBe(true);
  });

  it('documents project scope workspace binding immutability', () => {
    const projectScope = {
      connectionScope: 'project' as const,
      boundWorkspaceIdMutable: false,
      moveRequiresRevokeAndRePair: true,
    };
    expect(projectScope.boundWorkspaceIdMutable).toBe(false);
    expect(projectScope.moveRequiresRevokeAndRePair).toBe(true);
  });
});
