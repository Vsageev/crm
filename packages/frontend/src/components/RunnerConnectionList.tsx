import { Pencil, ShieldOff, Check, X } from 'lucide-react';
import { Badge, Input, ActionTooltip } from '../ui';
import {
  formatRunnerCapabilities,
  ownerAccountLabel,
  runnerActivationHint,
  RUNNER_STATUS_COLOR,
  scopeBadgeColor,
  scopeLabel,
  type RunnerConnection,
} from '../lib/runner-connections';
import styles from './RunnerConnectionList.module.css';

interface RunnerConnectionListProps {
  devices: RunnerConnection[];
  loading?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  currentUserId?: string | null;
  workspaceName?: string | null;
  allowManage?: boolean;
  editingId?: string | null;
  editingName?: string;
  onStartRename?: (device: RunnerConnection) => void;
  onEditingNameChange?: (value: string) => void;
  onCancelRename?: () => void;
  onSaveRename?: (device: RunnerConnection) => void;
  onRevoke?: (device: RunnerConnection) => void;
}

export function RunnerConnectionList({
  devices,
  loading = false,
  emptyTitle = 'No paired runners',
  emptyHint,
  currentUserId,
  workspaceName,
  allowManage = false,
  editingId,
  editingName = '',
  onStartRename,
  onEditingNameChange,
  onCancelRename,
  onSaveRename,
  onRevoke,
}: RunnerConnectionListProps) {
  const renameDisabledReason = !editingName.trim() ? 'Enter a runner name before saving.' : null;

  if (loading) {
    return <div className={styles.loading}>Loading runners...</div>;
  }

  if (devices.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>{emptyTitle}</div>
        {emptyHint ? <div className={styles.emptyHint}>{emptyHint}</div> : null}
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {devices.map((device) => {
        const activationHint = runnerActivationHint(device, currentUserId);
        const capabilitySummary = formatRunnerCapabilities(device);
        const boundWorkspaceId = device.boundWorkspaceId ?? device.workspaceId;
        const isProjectScope = device.connectionScope === 'project';

        return (
          <div key={device.id} className={styles.card}>
            <div className={styles.main}>
              <div className={styles.titleRow}>
                {editingId === device.id ? (
                  <Input
                    value={editingName}
                    onChange={(event) => onEditingNameChange?.(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') onSaveRename?.(device);
                      if (event.key === 'Escape') onCancelRename?.();
                    }}
                  />
                ) : (
                  <span className={styles.name}>{device.displayName}</span>
                )}
                <Badge color={RUNNER_STATUS_COLOR[device.status]}>{device.status}</Badge>
                <Badge color={scopeBadgeColor(device.connectionScope)}>
                  {scopeLabel(device.connectionScope)}
                </Badge>
                {device.legacyConnectionScope ? (
                  <Badge color="warning">Legacy</Badge>
                ) : null}
              </div>
              <div className={styles.meta}>
                {device.lastSeenAt
                  ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`
                  : 'Never seen'}
              </div>
              <div className={styles.meta}>
                Owner: {ownerAccountLabel(device.ownerAccountId, currentUserId)}
                {workspaceName || boundWorkspaceId ? (
                  <>
                    {' '}
                    · Bound to {workspaceName ?? 'this workspace'}
                  </>
                ) : null}
              </div>
              {capabilitySummary ? <div className={styles.meta}>{capabilitySummary}</div> : null}
              {activationHint ? <div className={styles.hint}>{activationHint}</div> : null}
              {isProjectScope ? (
                <div className={styles.hint}>
                  Project runners stay on this workspace. Revoke and pair again to bind a different
                  project.
                </div>
              ) : null}
            </div>
            {allowManage ? (
              <div className={styles.actions}>
                {editingId === device.id ? (
                  <>
                    <ActionTooltip
                      label={renameDisabledReason ?? 'Save runner name'}
                      disabled={Boolean(renameDisabledReason)}
                      triggerLabel="Save runner name"
                    >
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => onSaveRename?.(device)}
                        disabled={Boolean(renameDisabledReason)}
                        aria-label="Save runner name"
                      >
                        <Check size={16} />
                      </button>
                    </ActionTooltip>
                    <button type="button" className={styles.iconBtn} onClick={onCancelRename}>
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <ActionTooltip
                    label={device.revoked ? 'Revoked runners cannot be renamed.' : 'Rename runner'}
                    disabled={device.revoked}
                    triggerLabel="Rename runner"
                  >
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => onStartRename?.(device)}
                      disabled={device.revoked}
                      aria-label="Rename runner"
                    >
                      <Pencil size={16} />
                    </button>
                  </ActionTooltip>
                )}
                <ActionTooltip
                  label={device.revoked ? 'This runner is already revoked.' : 'Revoke runner'}
                  disabled={device.revoked}
                  triggerLabel="Revoke runner"
                >
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => onRevoke?.(device)}
                    disabled={device.revoked}
                    aria-label="Revoke runner"
                  >
                    <ShieldOff size={16} />
                  </button>
                </ActionTooltip>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const SCOPE_OPTIONS = [
  {
    value: 'account' as const,
    title: 'Account',
    description: 'Only you can activate this runner after pairing.',
  },
  {
    value: 'project' as const,
    title: 'Project',
    description: 'Workspace members with agent-run access can activate it.',
  },
];

export function RunnerScopePicker({
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  value: 'account' | 'project';
  onChange: (value: 'account' | 'project') => void;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  return (
    <div className={styles.scopePicker}>
      <span className={styles.scopeLabel} id="runner-scope-label">
        Who can use this runner
      </span>
      <div className={styles.scopeTiles} role="radiogroup" aria-labelledby="runner-scope-label">
        {SCOPE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`${styles.scopeTile} ${value === option.value ? styles.scopeTileSelected : ''}`}
          >
            <input
              type="radio"
              name="runner-connection-scope"
              className={styles.scopeRadio}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
              aria-label={`${option.title} — ${option.description}`}
            />
            <span className={styles.scopeTileTitle}>{option.title}</span>
            <span className={styles.scopeTileDescription}>{option.description}</span>
          </label>
        ))}
      </div>
      {disabled && disabledReason ? <div className={styles.hint}>{disabledReason}</div> : null}
    </div>
  );
}
