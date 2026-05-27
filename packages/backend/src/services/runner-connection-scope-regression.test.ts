import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateRunnerActivation,
  rejectImmutableRunnerBindingPatch,
  RunnerActivationError,
  validateRunnerConnectionBinding,
} from './runner-devices.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readServiceSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('runner connection scope regression', () => {
  it('backfills nullable legacy rows to account scope without changing owner/workspace', () => {
    const legacy = {
      id: 'runner-legacy',
      userId: 'owner-1',
      workspaceId: 'workspace-1',
      connectionScope: null,
      ownerAccountId: null,
      boundWorkspaceId: null,
      legacyConnectionScope: null,
    };

    expect(validateRunnerConnectionBinding(legacy)).toEqual({
      connectionScope: 'account',
      ownerAccountId: 'owner-1',
      boundWorkspaceId: 'workspace-1',
      originalBoundWorkspaceId: 'workspace-1',
      legacyConnectionScope: true,
    });
  });

  it('rejects project workspace moves through immutable binding patches', () => {
    expect(() =>
      rejectImmutableRunnerBindingPatch({
        boundWorkspaceId: 'other-workspace',
      }),
    ).toThrow(RunnerActivationError);

    try {
      rejectImmutableRunnerBindingPatch({ connectionScope: 'project', workspaceId: 'moved' });
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerActivationError);
      expect((error as RunnerActivationError).code).toBe('runner_binding_immutable');
    }
  });

  it('fails when another account tries to activate an account-connected runner', () => {
    const denial = evaluateRunnerActivation({
      record: {
        id: 'account-runner',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        connectionScope: 'account',
        ownerAccountId: 'owner-1',
        boundWorkspaceId: 'workspace-1',
        legacyConnectionScope: true,
      },
      activationActorId: 'teammate-2',
      routingWorkspaceId: 'workspace-1',
    });

    expect(denial).toMatchObject({
      allowed: false,
      code: 'runner_activation_forbidden',
      category: 'ownership',
      statusCode: 409,
    });
  });

  it('fails when a non-member tries to activate a project-connected runner', () => {
    const denial = evaluateRunnerActivation({
      record: {
        id: 'project-runner',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        connectionScope: 'project',
        ownerAccountId: 'owner-1',
        boundWorkspaceId: 'workspace-1',
        legacyConnectionScope: false,
      },
      activationActorId: 'outsider-9',
      routingWorkspaceId: 'workspace-1',
    });

    expect(denial).toMatchObject({
      allowed: false,
      code: 'runner_activation_forbidden',
      category: 'membership',
      statusCode: 403,
    });
  });

  it('keeps agent run reads independent of runner connection scope', () => {
    const agentRunsSource = readServiceSource('src/services/agent-runs.ts');
    expect(agentRunsSource).not.toMatch(/evaluateRunnerActivation|assertRunnerActivation/);
    expect(agentRunsSource).not.toMatch(/connectionScope/);
    expect(agentRunsSource).not.toMatch(/runner_activation_forbidden/);
  });

  it('keeps card comment routes free of runner activation gates', () => {
    const cardsRouteSource = readServiceSource('src/routes/cards.ts');
    expect(cardsRouteSource).not.toMatch(/evaluateRunnerActivation|assertRunnerActivation/);
    expect(cardsRouteSource).not.toMatch(/runner_activation_forbidden/);
  });
});
