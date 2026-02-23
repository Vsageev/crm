import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2, Wifi, WifiOff, TestTube, ChevronDown, ChevronUp } from 'lucide-react';
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

// Well-known email provider settings
interface ProviderConfig {
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  hint?: string;
}

const KNOWN_PROVIDERS: Record<string, ProviderConfig> = {
  'gmail.com': {
    name: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'Use an App Password — go to Google Account > Security > 2-Step Verification > App Passwords.',
  },
  'googlemail.com': {
    name: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'Use an App Password — go to Google Account > Security > 2-Step Verification > App Passwords.',
  },
  'outlook.com': {
    name: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  'hotmail.com': {
    name: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  'live.com': {
    name: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  'yahoo.com': {
    name: 'Yahoo',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'Use an App Password — go to Yahoo Account > Security > Generate app password.',
  },
  'icloud.com': {
    name: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'Use an App-Specific Password — go to appleid.apple.com > Sign-In and Security > App-Specific Passwords.',
  },
  'me.com': {
    name: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'Use an App-Specific Password — go to appleid.apple.com > Sign-In and Security > App-Specific Passwords.',
  },
  'yandex.ru': {
    name: 'Yandex',
    imapHost: 'imap.yandex.ru',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.yandex.ru',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'Use an App Password — go to Yandex ID > Security > App Passwords.',
  },
  'yandex.com': {
    name: 'Yandex',
    imapHost: 'imap.yandex.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.yandex.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: 'Use an App Password — go to Yandex ID > Security > App Passwords.',
  },
  'mail.ru': {
    name: 'Mail.ru',
    imapHost: 'imap.mail.ru',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.ru',
    smtpPort: 465,
    smtpSecure: true,
    hint: 'Use an App Password — go to Mail.ru > Security > App Passwords.',
  },
};

function getProviderFromEmail(email: string): ProviderConfig | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return KNOWN_PROVIDERS[domain] ?? null;
}

export function EmailAccountsTab() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [detectedProvider, setDetectedProvider] = useState<ProviderConfig | null>(null);
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
    setPassword('');
    setShowAdvanced(false);
    setDetectedProvider(null);
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

  // Auto-detect provider and fill settings when email changes
  function handleEmailChange(value: string) {
    setEmail(value);
    const provider = getProviderFromEmail(value);
    setDetectedProvider(provider);

    if (provider) {
      setImapHost(provider.imapHost);
      setImapPort(String(provider.imapPort));
      setImapSecure(provider.imapSecure);
      setSmtpHost(provider.smtpHost);
      setSmtpPort(String(provider.smtpPort));
      setSmtpSecure(provider.smtpSecure);
    }
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    // Resolve final values — use shared password if advanced fields are empty
    const finalImapUsername = imapUsername.trim() || email.trim();
    const finalSmtpUsername = smtpUsername.trim() || email.trim();
    const finalImapPassword = imapPassword || password;
    const finalSmtpPassword = smtpPassword || password;
    const finalImapHost = imapHost.trim();
    const finalSmtpHost = smtpHost.trim();

    if (!finalImapHost || !finalSmtpHost) {
      setConnectError('Could not detect server settings for this email provider. Please expand "Advanced settings" and fill in the IMAP/SMTP details manually.');
      setShowAdvanced(true);
      return;
    }

    if (!finalImapPassword || !finalSmtpPassword) {
      setConnectError('Password is required.');
      return;
    }

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/email/accounts', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          imapHost: finalImapHost,
          imapPort: parseInt(imapPort, 10) || 993,
          imapSecure,
          imapUsername: finalImapUsername,
          imapPassword: finalImapPassword,
          smtpHost: finalSmtpHost,
          smtpPort: parseInt(smtpPort, 10) || 587,
          smtpSecure,
          smtpUsername: finalSmtpUsername,
          smtpPassword: finalSmtpPassword,
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

              {detectedProvider && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    backgroundColor: 'var(--color-bg-success, #f0fdf4)',
                    border: '1px solid var(--color-border-success, #bbf7d0)',
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {detectedProvider.name} detected — server settings filled automatically.
                </div>
              )}

              <Input
                label={detectedProvider?.hint ? 'App Password' : 'Password'}
                type="password"
                placeholder={detectedProvider?.hint ? 'Paste your app password' : 'Email password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              {detectedProvider?.hint && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: 'var(--color-text-tertiary)',
                    lineHeight: 1.5,
                  }}
                >
                  {detectedProvider.hint}
                </p>
              )}

              <Input
                label="Display Name (optional)"
                placeholder="Sales Team"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              {/* Advanced settings toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--color-text-tertiary)',
                  marginTop: 4,
                }}
              >
                {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                Advanced settings (IMAP/SMTP)
              </button>

              {showAdvanced && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-secondary, #fafafa)',
                  }}
                >
                  <h3
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      margin: 0,
                      color: 'var(--color-text)',
                    }}
                  >
                    Incoming mail (IMAP)
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
                    <Input
                      label="IMAP Host"
                      placeholder="imap.gmail.com"
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                    />
                    <Input
                      label="Port"
                      type="number"
                      value={imapPort}
                      onChange={(e) => setImapPort(e.target.value)}
                    />
                  </div>
                  <Input
                    label="Username (if different from email)"
                    placeholder={email || 'user@example.com'}
                    value={imapUsername}
                    onChange={(e) => setImapUsername(e.target.value)}
                  />
                  <Input
                    label="Password (if different)"
                    type="password"
                    placeholder="Leave blank to use main password"
                    value={imapPassword}
                    onChange={(e) => setImapPassword(e.target.value)}
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
                      fontSize: 13,
                      fontWeight: 600,
                      margin: '8px 0 0',
                      color: 'var(--color-text)',
                    }}
                  >
                    Outgoing mail (SMTP)
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
                    <Input
                      label="SMTP Host"
                      placeholder="smtp.gmail.com"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                    />
                    <Input
                      label="Port"
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                    />
                  </div>
                  <Input
                    label="Username (if different from email)"
                    placeholder={email || 'user@example.com'}
                    value={smtpUsername}
                    onChange={(e) => setSmtpUsername(e.target.value)}
                  />
                  <Input
                    label="Password (if different)"
                    type="password"
                    placeholder="Leave blank to use main password"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
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
                    Use SSL/TLS
                  </label>
                </div>
              )}

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
