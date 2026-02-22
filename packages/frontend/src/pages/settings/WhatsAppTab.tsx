import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

interface WhatsAppAccount {
  id: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  accountName: string;
  accessTokenMasked: string;
  status: 'active' | 'inactive' | 'error';
  statusMessage?: string | null;
  autoGreetingEnabled: boolean;
  autoGreetingText?: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  active: 'success',
  inactive: 'default',
  error: 'error',
};

export function WhatsAppTab() {
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [accountName, setAccountName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Test connection
  const [testingId, setTestingId] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: WhatsAppAccount[] }>('/whatsapp/accounts');
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
    if (!phoneNumberId.trim() || !businessAccountId.trim() || !accessToken.trim() || !accountName.trim()) return;

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/whatsapp/accounts', {
        method: 'POST',
        body: JSON.stringify({
          phoneNumberId: phoneNumberId.trim(),
          businessAccountId: businessAccountId.trim(),
          accessToken: accessToken.trim(),
          accountName: accountName.trim(),
        }),
      });
      setPhoneNumberId('');
      setBusinessAccountId('');
      setAccessToken('');
      setAccountName('');
      setSuccess('WhatsApp account connected successfully');
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
      await api(`/whatsapp/accounts/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('WhatsApp account disconnected successfully');
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

  async function handleTestConnection(id: string) {
    setTestingId(id);
    setError('');
    try {
      await api(`/whatsapp/accounts/${id}/test`, { method: 'POST' });
      setSuccess('Connection test successful');
      await fetchAccounts();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to test connection');
      }
    } finally {
      setTestingId(null);
    }
  }

  const formValid = phoneNumberId.trim() && businessAccountId.trim() && accessToken.trim() && accountName.trim();

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connect WhatsApp Business</h2>
            <p className={styles.sectionDescription}>
              Enter your WhatsApp Business API credentials from the Meta Developer Portal.
            </p>
          </div>
        </div>

        <form onSubmit={handleConnect} style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            label="Account Name"
            placeholder="My Business WhatsApp"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
          <Input
            label="Phone Number ID"
            placeholder="1234567890"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
          />
          <Input
            label="Business Account ID"
            placeholder="9876543210"
            value={businessAccountId}
            onChange={(e) => setBusinessAccountId(e.target.value)}
          />
          <Input
            label="Permanent Access Token"
            placeholder="EAABsb..."
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            error={connectError}
          />
          <div>
            <Button type="submit" size="md" disabled={connecting || !formValid}>
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          </div>
        </form>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connected Accounts</h2>
            <p className={styles.sectionDescription}>
              Manage your connected WhatsApp Business accounts.
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
              <p>No WhatsApp accounts connected yet.</p>
              <p>Connect a WhatsApp Business account using the form above to get started.</p>
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
                    {account.accountName}
                    <Badge color={STATUS_COLOR[account.status]}>{account.status}</Badge>
                  </div>
                  <div className={styles.botUsername}>{account.displayPhoneNumber}</div>
                  <div className={styles.botMeta}>
                    Token: {account.accessTokenMasked} &middot; Connected{' '}
                    {new Date(account.createdAt).toLocaleDateString()}
                    {account.statusMessage && ` · ${account.statusMessage}`}
                  </div>
                </div>
                <div className={styles.botActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => handleTestConnection(account.id)}
                    disabled={testingId === account.id}
                    title="Test connection"
                  >
                    <RefreshCw
                      size={16}
                      className={testingId === account.id ? 'spinning' : ''}
                    />
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
