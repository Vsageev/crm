import { env } from '../config/env.js';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export const RUNNER_PUBLIC_API_URL_ERROR =
  'WORKSPACE_API_URL must be runner-reachable; set OPENWORK_PUBLIC_API_URL or use a reachable HOST/PORT for local development.';

interface RunnerPublicApiUrlOptions {
  publicApiUrl?: string | null;
  workspaceApiUrl?: string | null;
  host: string;
  port: number;
  tlsEnabled: boolean;
  nodeEnv: 'development' | 'production' | 'test';
}

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

function normalizeOrigin(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(RUNNER_PUBLIC_API_URL_ERROR);
  }
  return parsed.origin;
}

export function resolveRunnerWorkspaceApiUrl(
  options: RunnerPublicApiUrlOptions = {
    publicApiUrl: env.OPENWORK_PUBLIC_API_URL,
    workspaceApiUrl: env.WORKSPACE_API_URL,
    host: env.HOST,
    port: env.PORT,
    tlsEnabled: Boolean(env.TLS_CERT_PATH),
    nodeEnv: env.NODE_ENV,
  },
): string {
  const configuredUrl = options.publicApiUrl ?? options.workspaceApiUrl;
  if (configuredUrl) {
    const origin = normalizeOrigin(configuredUrl);
    if (options.nodeEnv === 'production' && isLocalHostname(new URL(origin).hostname)) {
      throw new Error(RUNNER_PUBLIC_API_URL_ERROR);
    }
    return origin;
  }

  const protocol = options.tlsEnabled ? 'https' : 'http';
  const host = options.host === '0.0.0.0' ? 'localhost' : options.host;
  const origin = `${protocol}://${host}:${options.port}`;

  if (options.nodeEnv === 'production' && isLocalHostname(host)) {
    throw new Error(RUNNER_PUBLIC_API_URL_ERROR);
  }

  return origin;
}

export function assertRunnerWorkspaceApiUrlReachable(): string {
  return resolveRunnerWorkspaceApiUrl();
}
