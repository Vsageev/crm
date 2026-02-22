import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2, Wifi, WifiOff, TestTube } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

interface EmailAccount {
  id: string;
  email: string;
  name: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPasswordSet: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPasswordSet: boolean;
  lastSyncedUid: number | null;
  lastSyncedAt: string | null;
  status: 'active' | 'inactive' | 'error';
  statusMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  active: 'success',
  inactive: 'default',
  error: 'error',
};

export function EmailAccountsTab() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUsername, setImapUsername] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Sync / test
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: EmailAccount[] }>('/email/accounts');
      setAccounts(data.entries);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load email accounts');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  function resetForm() {
    setEmail('');
    setName('');
    setImapHost('');
    setImapPort('993');
    setImapSecure(true);
    setImapUsername('');
    setImapPassword('');
    setSmtpHost('');
    setSmtpPort('587');
    setSmtpSecure(false);
    setSmtpUsername('');
    setSmtpPassword('');
    setConnectError('');
  }

  // Auto-fill IMAP/SMTP username from email
  function handleEmailChange(value: string) {
    setEmail(value);
    if (!imapUsername) setImapUsername(value);
    if (!smtpUsername) setSmtpUsername(value);
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/email/accounts', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10) || 993,
          imapSecure,
          imapUsername: imapUsername.trim(),
          imapPassword,
          smtpHost: smtpHost.trim(),
          smtpPort: parseInt(smtpPort, 10) || 587,
          smtpSecure,
          smtpUsername: smtpUsername.trim(),
          smtpPassword,
        }),
      });
      resetForm();
      setFormOpen(false);
      setSuccess('Email account connected successfully');
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) {
        setConnectError(err.message);
      } else {
        setConnectError('Failed to connect email account');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/email/accounts/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Email account disconnected');
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to disconnect email account');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id);
    setError('');
    try {
      const result = await api<{ synced: number }>(`/email/accounts/${id}/sync`, {
        method: 'POST',
      });
      setSuccess(`Sync complete: ${result.synced} new message(s)`);
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Sync failed');
      }
    } finally {
      setSyncingId(null);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    setError('');
    try {
      await api(`/email/accounts/${id}/test`, { method: 'POST' });
      setSuccess('Connection test passed');
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Connection test failed');
      }
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connect an Email Account</h2>
            <p className={styles.sectionDescription}>
              Connect an email account via IMAP/SMTP to send and receive emails in the unified
              inbox.
            </p>
          </div>
          {!formOpen && (
            <Button size="md" onClick={() => setFormOpen(true)}>
              Add Account
            </Button>
          )}
        </div>

        {formOpen && (
          <form onSubmit={handleConnect} style={{ maxWidth: 600 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                label="Email Address"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                required
              />
              <Input
                label="Display Name (optional)"
                placeholder="Sales Team"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginTop: 8,
                  color: 'var(--color-text)',
                }}
              >
                IMAP Settings (Incoming)
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
                <Input
                  label="IMAP Host"
                  placeholder="imap.gmail.com"
                  value={imapHost}
                  onChange={(e) => setImapHost(e.target.value)}
                  required
                />
                <Input
                  label="Port"
                  type="number"
                  value={imapPort}
                  onChange={(e) => setImapPort(e.target.value)}
                />
              </div>
              <Input
                label="IMAP Username"
                placeholder="user@example.com"
                value={imapUsername}
                onChange={(e) => setImapUsername(e.target.value)}
                required
              />
              <Input
                label="IMAP Password"
                type="password"
                placeholder="App password or account password"
                value={imapPassword}
                onChange={(e) => setImapPassword(e.target.value)}
                required
              />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={imapSecure}
                  onChange={(e) => setImapSecure(e.target.checked)}
                />
                Use SSL/TLS
              </label>

              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginTop: 8,
                  color: 'var(--color-text)',
                }}
              >
                SMTP Settings (Outgoing)
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
                <Input
                  label="SMTP Host"
                  placeholder="smtp.gmail.com"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  required
                />
                <Input
                  label="Port"
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                />
              </div>
              <Input
                label="SMTP Username"
                placeholder="user@example.com"
                value={smtpUsername}
                onChange={(e) => setSmtpUsername(e.target.value)}
                required
              />
              <Input
                label="SMTP Password"
                type="password"
                placeholder="App password or account password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                required
              />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                />
                Use SSL/TLS (enable for port 465, disable for STARTTLS on 587)
              </label>

              {connectError && <div className={styles.alert}>{connectError}</div>}

              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <Button type="submit" size="md" disabled={connecting || !email.trim()}>
                  {connecting ? 'Connecting...' : 'Connect Account'}
                </Button>
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                  type="button"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connected Email Accounts</h2>
            <p className={styles.sectionDescription}>
              Manage your connected email accounts for the unified inbox.
            </p>
          </div>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.loadingState}>Loading email accounts...</div>
        ) : accounts.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>No email accounts connected yet.</p>
              <p>Connect an email account using the form above to get started.</p>
            </div>
          </Card>
        ) : (
          <div className={styles.botList}>
            {accounts.map((account) => (
              <div key={account.id} className={styles.botCard}>
                <div className={styles.botInfo}>
                  <div className={styles.botName}>
                    {account.status === 'active' ? (
                      <Wifi size={14} color="var(--color-success)" />
                    ) : (
                      <WifiOff size={14} color="var(--color-text-tertiary)" />
                    )}
                    {account.name || account.email}
                    <Badge color={STATUS_COLOR[account.status]}>{account.status}</Badge>
                  </div>
                  <div className={styles.botUsername}>{account.email}</div>
                  <div className={styles.botMeta}>
                    IMAP: {account.imapHost}:{account.imapPort} &middot; SMTP:{' '}
                    {account.smtpHost}:{account.smtpPort}
                    {account.lastSyncedAt && (
                      <>
                        {' '}
                        &middot; Last synced:{' '}
                        {new Date(account.lastSyncedAt).toLocaleString()}
                      </>
                    )}
                    {account.statusMessage && ` · ${account.statusMessage}`}
                  </div>
                </div>
                <div className={styles.botActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => handleSync(account.id)}
                    disabled={syncingId === account.id}
                    title="Sync now"
                  >
                    <RefreshCw
                      size={16}
                      className={syncingId === account.id ? 'spinning' : ''}
                    />
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => handleTest(account.id)}
                    disabled={testingId === account.id}
                    title="Test connection"
                  >
                    <TestTube size={16} />
                  </button>
                  {deletingId === account.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDeletingId(null)}
                        disabled={deleteLoading}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleDisconnect(account.id)}
                        disabled={deleteLoading}
                      >
                        {deleteLoading ? 'Removing...' : 'Confirm'}
                      </Button>
                    </>
                  ) : (
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => setDeletingId(account.id)}
                      title="Disconnect account"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
