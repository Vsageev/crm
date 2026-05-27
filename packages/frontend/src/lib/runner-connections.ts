export type RunnerConnectionScope = 'account' | 'project';

export type RunnerDeviceStatus = 'online' | 'offline' | 'busy' | 'stale' | 'revoked';

export interface RunnerConnectionCapabilities {
  os?: string;
  arch?: string;
  version?: string;
  runnerVersion?: string;
  supportsFilesystem?: boolean;
  supportsArtifacts?: boolean;
  supportsCancellation?: boolean;
  agentInventory?: {
    revision: string;
    advertisedAt: string;
    ttlMs: number;
    workspaceRoots: Array<{ path: string; scope: string; writable: boolean }>;
    fileOperations: string[];
    agents: Array<{ agentId: string; readiness: string }>;
  };
  [key: string]: unknown;
}

export interface RunnerConnection {
  id: string;
  workspaceId: string;
  connectionScope?: RunnerConnectionScope;
  ownerAccountId?: string;
  boundWorkspaceId?: string;
  legacyConnectionScope?: boolean;
  displayName: string;
  status: RunnerDeviceStatus;
  lastSeenAt: string | null;
  version: string | null;
  capabilities: RunnerConnectionCapabilities;
  capabilitySource?: 'runner_advertisement' | 'runner_snapshot' | 'unavailable';
  inventory?: {
    revision?: string;
    advertisedAt?: string;
    ttlMs?: number;
    expiresAt?: string | null;
    stale: boolean;
    workspaceRoots?: Array<{ path: string; scope: string; writable: boolean }>;
    fileOperations?: string[];
    agentCount?: number;
    readyAgentCount?: number;
    unavailableReason?: string;
  };
  revoked: boolean;
}

export const RUNNER_STATUS_COLOR: Record<
  RunnerDeviceStatus,
  'success' | 'warning' | 'error' | 'default' | 'info'
> = {
  online: 'success',
  busy: 'info',
  stale: 'warning',
  offline: 'default',
  revoked: 'error',
};

export function runnerScopeLabel(scope: RunnerConnectionScope | undefined): string {
  return scope === 'project' ? 'Project runner' : 'Account runner';
}

export const scopeLabel = runnerScopeLabel;

export function runnerScopeBadgeColor(
  scope: RunnerConnectionScope | undefined,
): 'info' | 'default' {
  return scope === 'project' ? 'info' : 'default';
}

export const scopeBadgeColor = runnerScopeBadgeColor;

export function ownerAccountLabel(
  ownerAccountId: string | undefined,
  currentUserId: string | null | undefined,
): string {
  if (!ownerAccountId) return 'Unknown account';
  if (currentUserId && ownerAccountId === currentUserId) return 'Your account';
  return 'Another account';
}

export function formatRunnerCapabilities(device: RunnerConnection): string {
  const parts: string[] = [];
  const { capabilities, version } = device;
  if (capabilities.os || capabilities.arch) {
    parts.push([capabilities.os, capabilities.arch].filter(Boolean).join(' '));
  }
  const runnerVersion =
    typeof capabilities.runnerVersion === 'string'
      ? capabilities.runnerVersion
      : typeof capabilities.version === 'string'
        ? capabilities.version
        : version;
  if (runnerVersion) parts.push(`v${runnerVersion}`);
  const capabilityFlags: string[] = [];
  if (capabilities.supportsFilesystem) capabilityFlags.push('filesystem');
  if (capabilities.supportsArtifacts) capabilityFlags.push('artifacts');
  if (capabilities.supportsCancellation) capabilityFlags.push('cancel');
  if (capabilityFlags.length > 0) parts.push(capabilityFlags.join(', '));
  if (device.inventory?.revision) {
    parts.push(
      `inventory ${device.inventory.stale ? 'stale' : 'live'} (${device.inventory.readyAgentCount ?? 0}/${device.inventory.agentCount ?? 0} ready)`,
    );
  } else {
    parts.push('inventory unavailable');
  }
  return parts.filter(Boolean).join(' · ');
}

export function runnerOwnerLabel(
  device: RunnerConnection,
  currentUserId: string | null | undefined,
): string {
  const ownerId = device.ownerAccountId ?? device.workspaceId;
  if (currentUserId && ownerId === currentUserId) return 'Your account';
  return 'Another account';
}

export function runnerActivationHint(
  device: RunnerConnection,
  currentUserId: string | null | undefined,
): string | null {
  if (device.revoked) return 'Revoked runners cannot run jobs.';
  if (device.status === 'stale') return 'Restart this runner before starting jobs.';
  if (device.status === 'offline') return 'Start this runner on the paired machine.';
  if (device.connectionScope === 'account') {
    if (currentUserId && device.ownerAccountId && device.ownerAccountId !== currentUserId) {
      return 'Only the pairing account can start jobs. Run output and card comments stay visible to the project.';
    }
    if (!device.inventory?.revision) {
      return 'Update and restart this runner so it can advertise runner-owned agent inventory.';
    }
    return 'Only your account can start jobs on this runner. Teammates can still read run output and card comments.';
  }
  return 'Any workspace member with agent-run permission can use this shared runner.';
}

export function runnerBindingHint(device: RunnerConnection): string {
  const workspaceId = device.boundWorkspaceId ?? device.workspaceId;
  if (device.connectionScope === 'project') {
    return `Bound to this workspace (${workspaceId.slice(0, 8)}…). Project runners cannot be moved to another workspace — revoke and pair again.`;
  }
  return `Runs agents for this workspace while paired to your account.`;
}

export function isRunnerActivatable(device: RunnerConnection): boolean {
  return !device.revoked && (device.status === 'online' || device.status === 'busy');
}

export function countActivatableRunners(devices: RunnerConnection[]): number {
  return devices.filter(isRunnerActivatable).length;
}

export function buildRunnerListQuery(params: {
  workspaceId?: string | null;
  connectionScope?: RunnerConnectionScope;
}): string {
  const search = new URLSearchParams();
  if (params.workspaceId) search.set('workspaceId', params.workspaceId);
  if (params.connectionScope) search.set('connectionScope', params.connectionScope);
  const query = search.toString();
  return query ? `?${query}` : '';
}

export type AgentChatRunnerStatus = 'loading' | 'ready' | 'attention' | 'blocked';

export interface AgentChatRunnerSummary {
  status: AgentChatRunnerStatus;
  headline: string;
  detail: string | null;
  projectActivatable: number;
  accountActivatable: number;
  projectTotal: number;
  accountTotal: number;
}

function countScopedRunners(devices: RunnerConnection[]): { total: number; activatable: number } {
  const active = devices.filter((device) => !device.revoked);
  return {
    total: active.length,
    activatable: countActivatableRunners(active),
  };
}

export function summarizeAgentChatRunners(
  projectRunners: RunnerConnection[],
  accountRunners: RunnerConnection[],
  options: {
    loading?: boolean;
    runnerDisabledReason?: string | null;
    currentUserId?: string | null;
  } = {},
): AgentChatRunnerSummary {
  const project = countScopedRunners(projectRunners);
  const account = countScopedRunners(accountRunners);
  const activatableTotal = project.activatable + account.activatable;

  if (options.loading && project.total === 0 && account.total === 0) {
    return {
      status: 'loading',
      headline: 'Checking runners',
      detail: null,
      projectActivatable: 0,
      accountActivatable: 0,
      projectTotal: 0,
      accountTotal: 0,
    };
  }

  if (options.runnerDisabledReason) {
    return {
      status: 'blocked',
      headline: activatableTotal > 0 ? 'Runner unavailable' : 'Runner required',
      detail: options.runnerDisabledReason,
      projectActivatable: project.activatable,
      accountActivatable: account.activatable,
      projectTotal: project.total,
      accountTotal: account.total,
    };
  }

  if (activatableTotal === 0) {
    const hasAny = project.total > 0 || account.total > 0;
    return {
      status: 'attention',
      headline: hasAny ? 'Runners offline' : 'No runners connected',
      detail: hasAny
        ? 'Start a paired runner before sending messages.'
        : 'Connect a project or account runner for this workspace.',
      projectActivatable: project.activatable,
      accountActivatable: account.activatable,
      projectTotal: project.total,
      accountTotal: account.total,
    };
  }

  const scopeParts: string[] = [];
  if (project.activatable > 0) {
    scopeParts.push(
      `${project.activatable} project${project.activatable === 1 ? '' : 's'}`,
    );
  }
  if (account.activatable > 0) {
    scopeParts.push(
      `${account.activatable} account${account.activatable === 1 ? '' : 's'}`,
    );
  }

  return {
    status: 'ready',
    headline: `${activatableTotal} runner${activatableTotal === 1 ? '' : 's'} ready`,
    detail: scopeParts.join(' · '),
    projectActivatable: project.activatable,
    accountActivatable: account.activatable,
    projectTotal: project.total,
    accountTotal: account.total,
  };
}

export function runnerCompactDetail(
  device: RunnerConnection,
  currentUserId: string | null | undefined,
): string {
  const parts: string[] = [];
  const capabilities = formatRunnerCapabilities(device);
  if (capabilities) parts.push(capabilities);
  const activationHint = runnerActivationHint(device, currentUserId);
  if (activationHint) parts.push(activationHint);
  if (device.connectionScope === 'project') {
    parts.push('Bound to this workspace and cannot be moved to another project.');
  }
  return parts.join(' ');
}
