import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

interface NovofonAccount {
  id: string;
  apiKey: string;
  apiSecret: string;
  sipLogin: string;
  accountName: string | null;
  webhookConfigured: boolean;
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

export function NovofonTab() {
  const [accounts, setAccounts] = useState<NovofonAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [sipLogin, setSipLogin] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: NovofonAccount[] }>('/novofon/accounts');
      setAccounts(data.entries);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load accounts');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || !apiSecret.trim() || !sipLogin.trim()) return;

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/novofon/accounts', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          sipLogin: sipLogin.trim(),
        }),
      });
      setApiKey('');
      setApiSecret('');
      setSipLogin('');
      setSuccess('Novofon account connected successfully');
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) {
        setConnectError(err.message);
      } else {
        setConnectError('Failed to connect account');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/novofon/accounts/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Account disconnected successfully');
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to disconnect account');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connect Novofon Account</h2>
            <p className={styles.sectionDescription}>
              Enter your Novofon API credentials to enable VoIP calls and call recording.
              Find your API Key and Secret in{' '}
              <a href="https://my.novofon.com/" target="_blank" rel="noopener noreferrer">
                your Novofon dashboard
              </a>{' '}
              under Telephony → PBX Users → Administrator → API tab. The SIP Login is on the same user's settings page.
            </p>
          </div>
        </div>

        <form onSubmit={handleConnect} className={styles.connectForm}>
          <Input
            label="API Key"
            placeholder="Your Novofon API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            error={connectError && !apiSecret && !sipLogin ? connectError : undefined}
          />
          <Input
            label="API Secret"
            placeholder="Your Novofon API Secret"
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
          />
          <Input
            label="SIP Login"
            placeholder="e.g. 100"
            value={sipLogin}
            onChange={(e) => setSipLogin(e.target.value)}
            error={connectError}
          />
          <Button
            type="submit"
            size="md"
            disabled={connecting || !apiKey.trim() || !apiSecret.trim() || !sipLogin.trim()}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
        </form>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connected Accounts</h2>
            <p className={styles.sectionDescription}>
              Manage your connected Novofon VoIP accounts.
            </p>
          </div>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.loadingState}>Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>No accounts connected yet.</p>
              <p>Connect a Novofon account using the form above to enable VoIP.</p>
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
                    {account.accountName || account.sipLogin}
                    <Badge color={STATUS_COLOR[account.status]}>{account.status}</Badge>
                  </div>
                  <div className={styles.botUsername}>SIP: {account.sipLogin}</div>
                  <div className={styles.botMeta}>
                    API Key: {account.apiKey} &middot; Connected{' '}
                    {new Date(account.createdAt).toLocaleDateString()}
                    {account.statusMessage && ` · ${account.statusMessage}`}
                  </div>
                </div>
                <div className={styles.botActions}>
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
