import { useMemo } from 'react';
import { Loader2, Plug, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ActionTooltip, ReasonedActionButton, Tooltip } from '../ui';
import {
  RUNNER_STATUS_COLOR,
  isRunnerActivatable,
  runnerActivationHint,
  runnerCompactDetail,
  summarizeAgentChatRunners,
  type RunnerConnection,
} from '../lib/runner-connections';
import styles from './ProjectRunnersPanel.module.css';

interface ProjectRunnersPanelProps {
  projectRunners: RunnerConnection[];
  accountRunners: RunnerConnection[];
  loading: boolean;
  workspaceName: string | null;
  currentUserId: string | null;
  connectDisabledReason: string | null;
  runnerDisabledReason: string | null;
  onRefresh: () => void;
}

type RunnerScope = 'project' | 'account';

const SCOPE_META: Record<
  RunnerScope,
  { label: string; emptyHint: string }
> = {
  project: {
    label: 'Project',
    emptyHint: 'Shared · anyone with run access',
  },
  account: {
    label: 'Account',
    emptyHint: 'Your machine · output visible to team',
  },
};

function activeRunners(devices: RunnerConnection[]) {
  return devices.filter((device) => !device.revoked);
}

function statusDotClass(status: RunnerConnection['status']) {
  if (status === 'online') return styles.dotOnline;
  if (status === 'busy') return styles.dotBusy;
  if (status === 'stale' || status === 'offline') return styles.dotOffline;
  return styles.dotRevoked;
}

function RunnerChip({
  device,
  currentUserId,
}: {
  device: RunnerConnection;
  currentUserId: string | null;
}) {
  const activatable = isRunnerActivatable(device);
  const activationHint = runnerActivationHint(device, currentUserId);
  const detail = runnerCompactDetail(device, currentUserId);
  const statusClass = styles[`chipStatus_${RUNNER_STATUS_COLOR[device.status]}`];

  return (
    <Tooltip label={detail}>
      <span
        className={`${styles.chip} ${activatable ? styles.chipReady : ''} ${statusClass}`}
        title={activationHint ?? undefined}
      >
        <span
          className={`${styles.statusDot} ${statusDotClass(device.status)}`}
          aria-hidden="true"
        />
        <span className={styles.chipName}>{device.displayName}</span>
      </span>
    </Tooltip>
  );
}

function ScopeRow({
  scope,
  devices,
  loading,
  currentUserId,
}: {
  scope: RunnerScope;
  devices: RunnerConnection[];
  loading: boolean;
  currentUserId: string | null;
}) {
  const meta = SCOPE_META[scope];
  const runners = activeRunners(devices);

  return (
    <div className={styles.scopeRow} aria-label={meta.label}>
      <span className={styles.scopeLabel}>{meta.label}</span>
      <div className={styles.scopeRunners}>
        {loading && runners.length === 0 ? (
          <span className={styles.scopeEmpty}>
            <Loader2 size={12} className={styles.spinIcon} aria-hidden="true" />
            Checking
          </span>
        ) : runners.length === 0 ? (
          <span className={styles.scopeEmpty}>{meta.emptyHint}</span>
        ) : (
          runners.map((device) => (
            <RunnerChip key={device.id} device={device} currentUserId={currentUserId} />
          ))
        )}
      </div>
    </div>
  );
}

export function ProjectRunnersPanel({
  projectRunners,
  accountRunners,
  loading,
  workspaceName: _workspaceName,
  currentUserId,
  connectDisabledReason,
  runnerDisabledReason,
  onRefresh,
}: ProjectRunnersPanelProps) {
  const navigate = useNavigate();
  const summary = useMemo(
    () =>
      summarizeAgentChatRunners(projectRunners, accountRunners, {
        loading,
        runnerDisabledReason,
        currentUserId,
      }),
    [accountRunners, currentUserId, loading, projectRunners, runnerDisabledReason],
  );

  const openConnect = () => {
    navigate('/settings?tab=runners&scope=project');
  };

  const openManage = () => {
    navigate('/settings?tab=runners');
  };

  const showBlockedNotice =
    Boolean(runnerDisabledReason) && summary.status === 'blocked';

  if (summary.status === 'ready') {
    return null;
  }

  return (
    <section
      className={styles.strip}
      data-status={summary.status}
      aria-label="Runner connections"
      data-testid="agent-chat-runners-panel"
    >
      <div className={styles.header}>
        <div className={styles.summary}>
          <span className={styles.summaryLabel}>Runners</span>
          <span className={styles.summaryStatus}>{summary.headline}</span>
          {summary.detail && !showBlockedNotice ? (
            <span className={styles.summaryDetail}>{summary.detail}</span>
          ) : null}
        </div>
        <div className={styles.headerActions}>
          <ActionTooltip label="Refresh runner status" triggerLabel="Refresh runner status">
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => onRefresh()}
              aria-label="Refresh runner status"
            >
              {loading ? (
                <Loader2 size={14} className={styles.spinIcon} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
            </button>
          </ActionTooltip>
          <ReasonedActionButton
            size="sm"
            variant="ghost"
            disabled={Boolean(connectDisabledReason)}
            disabledReason={connectDisabledReason}
            onClick={openConnect}
            className={styles.connectBtn}
          >
            <Plug size={13} aria-hidden="true" />
            Connect
          </ReasonedActionButton>
          <button type="button" className={styles.linkBtn} onClick={openManage}>
            Manage
          </button>
        </div>
      </div>

      {showBlockedNotice ? (
        <p className={styles.notice} role="status">
          {runnerDisabledReason}
        </p>
      ) : null}

      <div className={styles.scopes}>
        <ScopeRow
          scope="project"
          devices={projectRunners}
          loading={loading}
          currentUserId={currentUserId}
        />
        <ScopeRow
          scope="account"
          devices={accountRunners}
          loading={loading}
          currentUserId={currentUserId}
        />
      </div>
    </section>
  );
}
