import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

interface TelegramBot {
  id: string;
  botId: string;
  botUsername: string;
  botFirstName: string;
  tokenMasked: string;
  webhookUrl: string;
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

export function TelegramBotsTab() {
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Refresh
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const fetchBots = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: TelegramBot[] }>('/telegram/bots');
      setBots(data.entries);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load bots');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/telegram/bots', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      });
      setToken('');
      setSuccess('Bot connected successfully');
      await fetchBots();
    } catch (err) {
      if (err instanceof ApiError) {
        setConnectError(err.message);
      } else {
        setConnectError('Failed to connect bot');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/telegram/bots/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Bot disconnected successfully');
      setBots((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to disconnect bot');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleRefreshWebhook(id: string) {
    setRefreshingId(id);
    setError('');
    try {
      await api(`/telegram/bots/${id}/refresh-webhook`, { method: 'POST' });
      setSuccess('Webhook refreshed successfully');
      await fetchBots();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to refresh webhook');
      }
    } finally {
      setRefreshingId(null);
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connect a Telegram Bot</h2>
            <p className={styles.sectionDescription}>
              Enter the bot token from @BotFather to connect your Telegram bot.
            </p>
          </div>
        </div>

        <form onSubmit={handleConnect} className={styles.connectForm}>
          <Input
            label="Bot Token"
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            error={connectError}
          />
          <Button type="submit" size="md" disabled={connecting || !token.trim()}>
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
        </form>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connected Bots</h2>
            <p className={styles.sectionDescription}>
              Manage your connected Telegram bots.
            </p>
          </div>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.loadingState}>Loading bots...</div>
        ) : bots.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>No bots connected yet.</p>
              <p>Connect a Telegram bot using the form above to get started.</p>
            </div>
          </Card>
        ) : (
          <div className={styles.botList}>
            {bots.map((bot) => (
              <div key={bot.id} className={styles.botCard}>
                <div className={styles.botInfo}>
                  <div className={styles.botName}>
                    {bot.status === 'active' ? (
                      <Wifi size={14} color="var(--color-success)" />
                    ) : (
                      <WifiOff size={14} color="var(--color-text-tertiary)" />
                    )}
                    {bot.botFirstName}
                    <Badge color={STATUS_COLOR[bot.status]}>{bot.status}</Badge>
                  </div>
                  <div className={styles.botUsername}>@{bot.botUsername}</div>
                  <div className={styles.botMeta}>
                    Token: {bot.tokenMasked} &middot; Connected{' '}
                    {new Date(bot.createdAt).toLocaleDateString()}
                    {bot.statusMessage && ` · ${bot.statusMessage}`}
                  </div>
                </div>
                <div className={styles.botActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => handleRefreshWebhook(bot.id)}
                    disabled={refreshingId === bot.id}
                    title="Refresh webhook"
                  >
                    <RefreshCw
                      size={16}
                      className={refreshingId === bot.id ? 'spinning' : ''}
                    />
                  </button>
                  {deletingId === bot.id ? (
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
                        onClick={() => handleDisconnect(bot.id)}
                        disabled={deleteLoading}
                      >
                        {deleteLoading ? 'Removing...' : 'Confirm'}
                      </Button>
                    </>
                  ) : (
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => setDeletingId(bot.id)}
                      title="Disconnect bot"
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
