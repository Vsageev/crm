import { useCallback, useEffect, useState } from 'react';
import { Link2, Unlink, Bell, BellOff } from 'lucide-react';
import { Button, Card } from '../../ui';
import { api, ApiError } from '../../lib/api';
import {
  isWebPushSupported,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/push-notifications';
import styles from './SettingsPage.module.css';

interface NotificationSettings {
  id: string;
  telegramChatId: string | null;
  telegramUsername: string | null;
  enabled: boolean;
  notifyNewLead: boolean;
  notifyTaskDueSoon: boolean;
  notifyTaskOverdue: boolean;
  notifyDealStageChange: boolean;
  notifyLeadAssigned: boolean;
}

interface LinkTokenResponse {
  linkToken: string;
  expiresAt: string;
  botUsername: string;
}

const NOTIFICATION_TOGGLES = [
  {
    key: 'notifyNewLead' as const,
    label: 'New leads',
    description: 'Get notified when a new lead is created',
  },
  {
    key: 'notifyLeadAssigned' as const,
    label: 'Lead assigned to you',
    description: 'Get notified when a lead is assigned to you',
  },
  {
    key: 'notifyTaskDueSoon' as const,
    label: 'Task due soon',
    description: 'Reminder when a task is due within 1 hour',
  },
  {
    key: 'notifyTaskOverdue' as const,
    label: 'Task overdue',
    description: 'Get notified when a task becomes overdue',
  },
  {
    key: 'notifyDealStageChange' as const,
    label: 'Deal stage changes',
    description: 'Get notified when a deal moves to a new stage',
  },
];

// ---------------------------------------------------------------------------
// Web Push Section
// ---------------------------------------------------------------------------

function WebPushSection() {
  const [supported] = useState(() => isWebPushSupported());
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supported) {
      setLoading(false);
      return;
    }
    getExistingSubscription()
      .then((sub) => setSubscribed(sub !== null))
      .catch(() => setSubscribed(false))
      .finally(() => setLoading(false));
  }, [supported]);

  async function handleToggle() {
    setToggling(true);
    setError('');
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        const ok = await subscribeToPush();
        if (!ok) {
          setError('Permission denied or web push not configured on the server.');
          return;
        }
        setSubscribed(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update push subscription');
    } finally {
      setToggling(false);
    }
  }

  if (!supported) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Browser Push Notifications</h2>
            <p className={styles.sectionDescription}>
              Your browser does not support push notifications.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Browser Push Notifications</h2>
          <p className={styles.sectionDescription}>
            Receive browser notifications for new leads, deal updates, messages, and task reminders
            — even when the CRM tab is in the background.
          </p>
        </div>
      </div>

      {error && <div className={styles.alert}>{error}</div>}

      <div className={styles.linkStatus}>
        {subscribed ? (
          <Bell size={20} color="var(--color-success)" />
        ) : (
          <BellOff size={20} color="var(--color-text-tertiary)" />
        )}
        <div className={styles.linkStatusInfo}>
          <div className={styles.linkStatusLabel}>
            {loading
              ? 'Checking...'
              : subscribed
                ? 'Push notifications enabled'
                : 'Push notifications disabled'}
          </div>
          <div className={styles.linkStatusValue}>
            {subscribed
              ? 'You will receive browser notifications for critical CRM events'
              : 'Enable to get real-time alerts in your browser'}
          </div>
        </div>
        <Button
          size="sm"
          variant={subscribed ? 'secondary' : 'primary'}
          onClick={handleToggle}
          disabled={loading || toggling}
        >
          {toggling ? (subscribed ? 'Disabling...' : 'Enabling...') : subscribed ? 'Disable' : 'Enable'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Link flow
  const [linkToken, setLinkToken] = useState<LinkTokenResponse | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  // Updating
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const isLinked = settings?.telegramChatId != null;

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<NotificationSettings>('/telegram-notifications/settings');
      setSettings(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // No settings yet - that's fine
        setSettings(null);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load notification settings');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  async function handleGenerateLink() {
    setGeneratingLink(true);
    setError('');
    setSuccess('');
    try {
      const data = await api<LinkTokenResponse>('/telegram-notifications/link-token', {
        method: 'POST',
      });
      setLinkToken(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to generate link token');
      }
    } finally {
      setGeneratingLink(false);
    }
  }

  async function handleUnlink() {
    setUnlinking(true);
    setError('');
    try {
      await api('/telegram-notifications/settings', { method: 'DELETE' });
      setSettings(null);
      setUnlinkConfirm(false);
      setSuccess('Telegram unlinked successfully');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to unlink Telegram');
      }
    } finally {
      setUnlinking(false);
    }
  }

  async function handleToggle(key: keyof NotificationSettings) {
    if (!settings) return;
    const newValue = !settings[key];
    setUpdatingKey(key);
    setError('');
    try {
      await api('/telegram-notifications/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: newValue }),
      });
      setSettings((prev) => (prev ? { ...prev, [key]: newValue } : prev));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update setting');
      }
    } finally {
      setUpdatingKey(null);
    }
  }

  if (loading) {
    return <div className={styles.loadingState}>Loading notification settings...</div>;
  }

  return (
    <div className={styles.notifSection}>
      {/* Web Push Notifications */}
      <WebPushSection />

      {/* Telegram Notifications */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Telegram Notifications</h2>
            <p className={styles.sectionDescription}>
              Link your Telegram account to receive notifications about leads, tasks, and deals.
            </p>
          </div>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {/* Link status */}
        {isLinked ? (
          <div className={styles.linkStatus}>
            <Link2 size={20} color="var(--color-success)" />
            <div className={styles.linkStatusInfo}>
              <div className={styles.linkStatusLabel}>Telegram linked</div>
              <div className={styles.linkStatusValue}>
                {settings!.telegramUsername
                  ? `@${settings!.telegramUsername}`
                  : `Chat ID: ${settings!.telegramChatId}`}
              </div>
            </div>
            {unlinkConfirm ? (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setUnlinkConfirm(false)}
                  disabled={unlinking}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleUnlink} disabled={unlinking}>
                  {unlinking ? 'Unlinking...' : 'Confirm'}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setUnlinkConfirm(true)}
              >
                <Unlink size={14} />
                Unlink
              </Button>
            )}
          </div>
        ) : (
          <>
            {linkToken ? (
              <div className={styles.linkInstructions}>
                <p>
                  Open Telegram and send the following command to{' '}
                  <strong>@{linkToken.botUsername}</strong>:
                </p>
                <p>
                  <code>/start {linkToken.linkToken}</code>
                </p>
                <p>
                  This token expires at{' '}
                  {new Date(linkToken.expiresAt).toLocaleTimeString()}.
                  After sending the command, refresh this page.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  <Button size="sm" variant="secondary" onClick={fetchSettings}>
                    Refresh
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLinkToken(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.linkStatus}>
                <Link2 size={20} color="var(--color-text-tertiary)" />
                <div className={styles.linkStatusInfo}>
                  <div className={styles.linkStatusLabel}>Telegram not linked</div>
                  <div className={styles.linkStatusValue}>
                    Link your Telegram account to receive notifications
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleGenerateLink}
                  disabled={generatingLink}
                >
                  {generatingLink ? 'Generating...' : 'Link Telegram'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Notification toggles */}
      {isLinked && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Notification Preferences</h2>
          <p className={styles.sectionDescription} style={{ marginBottom: 'var(--space-4)' }}>
            Choose which events you want to be notified about.
          </p>

          <Card>
            <div style={{ padding: '0 var(--space-4)' }}>
              {/* Master toggle */}
              <label className={styles.toggleRow} style={{ cursor: 'pointer' }}>
                <div>
                  <div className={styles.toggleLabel} style={{ fontWeight: 600 }}>
                    Enable notifications
                  </div>
                  <div className={styles.toggleDescription}>
                    Master switch for all Telegram notifications
                  </div>
                </div>
                <div className={styles.toggle}>
                  <input
                    type="checkbox"
                    className={styles.toggleInput}
                    checked={settings!.enabled}
                    onChange={() => handleToggle('enabled')}
                    disabled={updatingKey === 'enabled'}
                  />
                  <span className={styles.toggleSlider} />
                </div>
              </label>

              {NOTIFICATION_TOGGLES.map((toggle) => (
                <label
                  key={toggle.key}
                  className={styles.toggleRow}
                  style={{ cursor: settings!.enabled ? 'pointer' : 'default' }}
                >
                  <div>
                    <div className={styles.toggleLabel}>{toggle.label}</div>
                    <div className={styles.toggleDescription}>{toggle.description}</div>
                  </div>
                  <div className={styles.toggle}>
                    <input
                      type="checkbox"
                      className={styles.toggleInput}
                      checked={settings![toggle.key]}
                      onChange={() => handleToggle(toggle.key)}
                      disabled={!settings!.enabled || updatingKey === toggle.key}
                    />
                    <span className={styles.toggleSlider} />
                  </div>
                </label>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
