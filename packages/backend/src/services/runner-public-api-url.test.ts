import { describe, expect, it } from 'vitest';
import {
  RUNNER_PUBLIC_API_URL_ERROR,
  resolveRunnerWorkspaceApiUrl,
} from './runner-public-api-url.js';
import { buildRunnerJobIntent } from './agent-chat.js';

describe('runner public API URL preflight', () => {
  it('preserves local HOST=0.0.0.0 defaults for single-machine development', () => {
    expect(
      resolveRunnerWorkspaceApiUrl({
        publicApiUrl: null,
        workspaceApiUrl: null,
        host: '0.0.0.0',
        port: 3847,
        tlsEnabled: false,
        nodeEnv: 'development',
      }),
    ).toBe('http://localhost:3847');
  });

  it('uses the hosted public URL when configured', () => {
    expect(
      resolveRunnerWorkspaceApiUrl({
        publicApiUrl: 'https://openwork.example.com/api/ignored',
        workspaceApiUrl: null,
        host: '0.0.0.0',
        port: 3847,
        tlsEnabled: false,
        nodeEnv: 'production',
      }),
    ).toBe('https://openwork.example.com');
  });

  it('keeps WORKSPACE_API_URL as a backend configuration alias', () => {
    expect(
      resolveRunnerWorkspaceApiUrl({
        publicApiUrl: null,
        workspaceApiUrl: 'https://workspace-api.example.com/api',
        host: '0.0.0.0',
        port: 3847,
        tlsEnabled: false,
        nodeEnv: 'production',
      }),
    ).toBe('https://workspace-api.example.com');
  });

  it('prefers OPENWORK_PUBLIC_API_URL over the compatibility alias', () => {
    expect(
      resolveRunnerWorkspaceApiUrl({
        publicApiUrl: 'https://public.example.com',
        workspaceApiUrl: 'https://workspace-api.example.com',
        host: '0.0.0.0',
        port: 3847,
        tlsEnabled: false,
        nodeEnv: 'production',
      }),
    ).toBe('https://public.example.com');
  });

  it('fails hosted runner dispatch before enqueue when the public URL is missing', () => {
    expect(() =>
      resolveRunnerWorkspaceApiUrl({
        publicApiUrl: null,
        workspaceApiUrl: null,
        host: '0.0.0.0',
        port: 3847,
        tlsEnabled: false,
        nodeEnv: 'production',
      }),
    ).toThrow(RUNNER_PUBLIC_API_URL_ERROR);
  });

  it('rejects localhost callback origins in hosted remote-runner mode', () => {
    expect(() =>
      resolveRunnerWorkspaceApiUrl({
        publicApiUrl: 'http://localhost:3847',
        workspaceApiUrl: null,
        host: 'public.example.com',
        port: 3847,
        tlsEnabled: false,
        nodeEnv: 'production',
      }),
    ).toThrow(RUNNER_PUBLIC_API_URL_ERROR);
  });

  it('passes the reachable API URL into the native runner job environment', () => {
    const workspaceApiUrl = resolveRunnerWorkspaceApiUrl({
      publicApiUrl: 'https://openwork.example.com',
      workspaceApiUrl: null,
      host: '0.0.0.0',
      port: 3847,
      tlsEnabled: false,
      nodeEnv: 'production',
    });

    const intent = buildRunnerJobIntent({
      runId: 'run-public-url-smoke',
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      agent: {
        name: 'Agent',
        model: 'codex',
        modelId: null,
        thinkingLevel: null,
        apiKeyId: 'api-key-1',
        workspaceApiKey: 'workspace-secret',
      },
      prompt: 'hello',
      workDir: '/runner/workspace',
      childEnv: {
        WORKSPACE_API_URL: workspaceApiUrl,
        WORKSPACE_API_KEY: 'workspace-secret',
      },
    });

    expect(intent.environment?.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'WORKSPACE_API_URL',
          value: 'https://openwork.example.com',
          source: 'workspace_api',
          secret: false,
        }),
      ]),
    );
  });
});
