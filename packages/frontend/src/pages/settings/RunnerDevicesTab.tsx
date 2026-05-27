import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Plug,
  RefreshCw,
  X,
} from 'lucide-react';
import { RunnerConnectionList, RunnerScopePicker } from '../../components/RunnerConnectionList';
import { Button, Input, Modal, ReasonedActionButton } from '../../ui';
import { api, ApiError } from '../../lib/api';
import {
  buildRunnerListQuery,
  type RunnerConnection,
  type RunnerConnectionScope,
} from '../../lib/runner-connections';
import { useAuth } from '../../stores/useAuth';
import { useWorkspace } from '../../stores/WorkspaceContext';
import styles from './SettingsPage.module.css';

interface PairingCode {
  id: string;
  code: string;
  expiresAt: string;
}

function getRunnerServerUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/$/, '');
  }

  const url = new URL(window.location.origin);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.port = '3847';
  }
  return url.toString().replace(/\/$/, '');
}

interface RunnerDevicesTabProps {
  initialPairingScope?: RunnerConnectionScope;
}

export function RunnerDevicesTab({ initialPairingScope = 'account' }: RunnerDevicesTabProps) {
  const { user } = useAuth();
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const [devices, setDevices] = useState<RunnerConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pairingName, setPairingName] = useState('My runner');
  const [pairingScope, setPairingScope] = useState<RunnerConnectionScope>(initialPairingScope);
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [isAddRunnerOpen, setIsAddRunnerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    setPairingScope(initialPairingScope);
  }, [initialPairingScope]);

  const connectCommand = useMemo(() => {
    if (!pairingCode) return '';
    return `OPENWORK_SERVER_URL=${getRunnerServerUrl()} OPENWORK_RUNNER_PAIRING_CODE=${pairingCode.code} OPENWORK_RUNNER_WORKSPACE_ROOT=$PWD pnpm --filter openwork-runner dev`;
  }, [pairingCode]);
  const pairingScopeHint =
    pairingScope === 'project'
      ? 'Workspace members with agent-run permission can activate it after pairing.'
      : 'Only your account can activate it after pairing.';
  const connectDisabledReason = !activeWorkspaceId
    ? 'Open a workspace before connecting a runner.'
    : null;

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = buildRunnerListQuery({
        workspaceId: activeWorkspaceId,
      });
      const data = await api<{ entries: RunnerConnection[] }>(`/agent-runners${query}`);
      setDevices(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load runners');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void fetchDevices();
  }, [fetchDevices]);

  async function createPairingCode() {
    if (!activeWorkspaceId) {
      setError(
        'Runners connect to one workspace. Open the workspace you want this machine to run agents for, then connect the runner.',
      );
      return;
    }
    setError('');
    setSuccess('');
    try {
      const result = await api<PairingCode>('/agent-runners/pairing-codes', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          displayName: pairingName.trim() || 'Runner',
          connectionScope: pairingScope,
        }),
      });
      setPairingCode(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create pairing code');
    }
  }

  async function copyCommand() {
    if (!connectCommand) return;
    await navigator.clipboard.writeText(connectCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function openAddRunner() {
    setError('');
    setSuccess('');
    setCopied(false);
    setPairingCode(null);
    setPairingScope(initialPairingScope);
    setIsAddRunnerOpen(true);
  }

  const addRunnerDialog = (
    <div aria-live="polite">
      {!pairingCode ? (
        <>
          <p className={styles.runnerAddLead}>
            Name this machine, choose who can activate it, then run the generated command in a
            terminal on that machine.
          </p>
          <Input
            label="Runner name"
            value={pairingName}
            onChange={(event) => setPairingName(event.target.value)}
            placeholder="Design workstation"
          />
          <RunnerScopePicker
            value={pairingScope}
            onChange={setPairingScope}
            disabled={Boolean(connectDisabledReason)}
            disabledReason={connectDisabledReason}
          />
        </>
      ) : (
        <div className={styles.runnerAddResult}>
          <div className={styles.runnerAddField}>
            <span className={styles.runnerFieldLabel}>Pairing code</span>
            <div className={styles.runnerCodeBox}>
              <code className={styles.runnerPairingCode}>{pairingCode.code}</code>
            </div>
            <p className={styles.runnerCommandMeta}>
              <Clock size={14} aria-hidden />
              Expires {new Date(pairingCode.expiresAt).toLocaleTimeString()}
            </p>
          </div>

          <div className={styles.runnerAddField}>
            <span className={styles.runnerFieldLabel}>Run in terminal</span>
            <pre className={styles.runnerCommandBlock}>
              <code>{connectCommand}</code>
            </pre>
            <Button size="sm" variant="secondary" onClick={() => void copyCommand()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy command'}
            </Button>
          </div>

          <p className={styles.runnerResultHint}>{pairingScopeHint}</p>
        </div>
      )}
    </div>
  );

  async function saveRename(device: RunnerConnection) {
    const displayName = editingName.trim();
    if (!displayName) return;
    try {
      const updated = await api<RunnerConnection>(`/agent-runners/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName }),
      });
      setDevices((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingId(null);
      setSuccess('Runner renamed');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to rename runner');
    }
  }

  async function revoke(device: RunnerConnection) {
    try {
      const updated = await api<RunnerConnection>(`/agent-runners/${device.id}/revoke`, {
        method: 'POST',
      });
      setDevices((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setSuccess('Runner revoked');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke runner');
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Runners</h2>
          <p className={styles.sectionDescription}>
            Pair a local machine for agent work, then manage account and project runner access from
            the same workspace.
          </p>
        </div>
        <div className={styles.botActions}>
          <ReasonedActionButton
            size="sm"
            onClick={openAddRunner}
            disabled={Boolean(connectDisabledReason)}
            disabledReason={connectDisabledReason}
          >
            <Plug size={14} />
            Add runner
          </ReasonedActionButton>
          <Button size="sm" variant="secondary" onClick={() => void fetchDevices()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>

      {error && !isAddRunnerOpen ? <div className={styles.alert}>{error}</div> : null}
      {success && !isAddRunnerOpen ? <div className={styles.success}>{success}</div> : null}

      {isAddRunnerOpen ? (
        <Modal onClose={() => setIsAddRunnerOpen(false)} size="md" ariaLabel="Add runner">
          <div className={styles.modalHeader}>
            <h3 className={styles.modalTitle}>Add runner</h3>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setIsAddRunnerOpen(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className={styles.modalBody}>
            {error ? <div className={styles.alert}>{error}</div> : null}
            {addRunnerDialog}
          </div>
          <div className={styles.runnerAddFooter}>
            <Button type="button" variant="secondary" size="md" onClick={() => setIsAddRunnerOpen(false)}>
              Cancel
            </Button>
            {!pairingCode ? (
              <ReasonedActionButton
                size="md"
                onClick={() => void createPairingCode()}
                disabled={Boolean(connectDisabledReason)}
                disabledReason={connectDisabledReason}
              >
                Generate command
              </ReasonedActionButton>
            ) : (
              <Button size="md" variant="secondary" onClick={() => void fetchDevices()}>
                <RefreshCw size={14} />
                Check connection
              </Button>
            )}
          </div>
        </Modal>
      ) : null}

      <div className={styles.runnerDevicesList}>
        <RunnerConnectionList
          devices={devices}
          loading={loading}
          emptyTitle="No paired runners"
          emptyHint="Pair an account runner for personal activation or a project runner for shared workspace activation."
          currentUserId={user?.id}
          workspaceName={activeWorkspace?.name ?? null}
          allowManage
          editingId={editingId}
          editingName={editingName}
          onStartRename={(entry) => {
            setEditingId(entry.id);
            setEditingName(entry.displayName);
          }}
          onEditingNameChange={setEditingName}
          onCancelRename={() => setEditingId(null)}
          onSaveRename={(entry) => void saveRename(entry)}
          onRevoke={(entry) => void revoke(entry)}
        />
      </div>
    </div>
  );
}
