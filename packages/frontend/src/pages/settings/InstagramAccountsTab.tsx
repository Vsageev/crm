import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

interface InstagramPage {
  id: string;
  pageId: string;
  pageName: string;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  tokenSet: boolean;
  autoGreetingEnabled: boolean;
  autoGreetingText: string | null;
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

export function InstagramAccountsTab() {
  const [pages, setPages] = useState<InstagramPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [formOpen, setFormOpen] = useState(false);
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Refresh webhook
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: InstagramPage[] }>('/instagram/pages');
      setPages(data.entries);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load Instagram pages');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  function resetForm() {
    setPageAccessToken('');
    setConnectError('');
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!pageAccessToken.trim()) return;

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/instagram/pages', {
        method: 'POST',
        body: JSON.stringify({ pageAccessToken: pageAccessToken.trim() }),
      });
      resetForm();
      setFormOpen(false);
      setSuccess('Facebook Page connected successfully');
      await fetchPages();
    } catch (err) {
      if (err instanceof ApiError) {
        setConnectError(err.message);
      } else {
        setConnectError('Failed to connect page');
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/instagram/pages/${id}`, { method: 'DELETE' });
      setDeletingId(null);
      setSuccess('Page disconnected');
      setPages((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to disconnect page');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleRefreshWebhook(id: string) {
    setRefreshingId(id);
    setError('');
    try {
      await api(`/instagram/pages/${id}/refresh-webhook`, { method: 'POST' });
      setSuccess('Webhook subscription refreshed');
      await fetchPages();
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
            <h2 className={styles.sectionTitle}>Connect a Facebook Page</h2>
            <p className={styles.sectionDescription}>
              Connect a Facebook Page to receive Instagram DMs and Messenger messages in the unified
              inbox. You'll need a Page Access Token with <code>pages_messaging</code> and{' '}
              <code>instagram_manage_messages</code> permissions.
            </p>
          </div>
          {!formOpen && (
            <Button size="md" onClick={() => setFormOpen(true)}>
              Add Page
            </Button>
          )}
        </div>

        {formOpen && (
          <form onSubmit={handleConnect} style={{ maxWidth: 600 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                label="Page Access Token"
                placeholder="Paste your long-lived Page Access Token"
                value={pageAccessToken}
                onChange={(e) => setPageAccessToken(e.target.value)}
                required
              />
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-tertiary)',
                  lineHeight: 1.5,
                }}
              >
                Generate a Page Access Token from the{' '}
                <a
                  href="https://developers.facebook.com/tools/explorer/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--color-link)' }}
                >
                  Graph API Explorer
                </a>{' '}
                or your Facebook App settings. Ensure the token has the{' '}
                <code>pages_messaging</code>, <code>pages_manage_metadata</code>, and{' '}
                <code>instagram_manage_messages</code> permissions.
              </p>

              {connectError && <div className={styles.alert}>{connectError}</div>}

              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <Button type="submit" size="md" disabled={connecting || !pageAccessToken.trim()}>
                  {connecting ? 'Connecting...' : 'Connect Page'}
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
            <h2 className={styles.sectionTitle}>Connected Pages</h2>
            <p className={styles.sectionDescription}>
              Manage your connected Facebook Pages for Instagram and Messenger messaging.
            </p>
          </div>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.loadingState}>Loading pages...</div>
        ) : pages.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>No Facebook Pages connected yet.</p>
              <p>Connect a page using the form above to start receiving Instagram DMs and Messenger messages.</p>
            </div>
          </Card>
        ) : (
          <div className={styles.botList}>
            {pages.map((page) => (
              <div key={page.id} className={styles.botCard}>
                <div className={styles.botInfo}>
                  <div className={styles.botName}>
                    {page.status === 'active' ? (
                      <Wifi size={14} color="var(--color-success)" />
                    ) : (
                      <WifiOff size={14} color="var(--color-text-tertiary)" />
                    )}
                    {page.pageName}
                    <Badge color={STATUS_COLOR[page.status]}>{page.status}</Badge>
                  </div>
                  <div className={styles.botUsername}>
                    {page.instagramUsername
                      ? `@${page.instagramUsername}`
                      : `Page ID: ${page.pageId}`}
                  </div>
                  <div className={styles.botMeta}>
                    {page.instagramAccountId && `Instagram ID: ${page.instagramAccountId} · `}
                    Connected {new Date(page.createdAt).toLocaleDateString()}
                    {page.statusMessage && ` · ${page.statusMessage}`}
                  </div>
                </div>
                <div className={styles.botActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => handleRefreshWebhook(page.id)}
                    disabled={refreshingId === page.id}
                    title="Refresh webhook"
                  >
                    <RefreshCw
                      size={16}
                      className={refreshingId === page.id ? 'spinning' : ''}
                    />
                  </button>
                  {deletingId === page.id ? (
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
                        onClick={() => handleDisconnect(page.id)}
                        disabled={deleteLoading}
                      >
                        {deleteLoading ? 'Removing...' : 'Confirm'}
                      </Button>
                    </>
                  ) : (
                    <button
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => setDeletingId(page.id)}
                      title="Disconnect page"
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
