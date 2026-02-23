import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Wifi, WifiOff, Upload } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';

interface VoximplantAccount {
  id: string;
  accountId: string;
  keyId: string;
  callbackRuleId?: number | null;
  agentPhoneNumber?: string | null;
  callerId?: string | null;
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
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function renderErrorWithLinks(message: string) {
  return message.split(URL_PATTERN).map((part, index) => {
    if (!/^https?:\/\/\S+$/i.test(part)) return part;

    // Avoid including trailing punctuation in clickable URL.
    const match = part.match(/^(https?:\/\/[^\s]+?)([),.;:]?)$/i);
    const href = match ? match[1] : part;
    const suffix = match ? match[2] : '';

    return (
      <span key={`${href}-${index}`}>
        <a className={styles.alertLink} href={href} target="_blank" rel="noopener noreferrer">
          {href}
        </a>
        {suffix}
      </span>
    );
  });
}

export function VoximplantTab() {
  const [accounts, setAccounts] = useState<VoximplantAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [accountId, setAccountId] = useState('');
  const [keyId, setKeyId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [callbackRuleId, setCallbackRuleId] = useState('');
  const [agentPhoneNumber, setAgentPhoneNumber] = useState('');
  const [callerId, setCallerId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: VoximplantAccount[] }>('/voximplant/accounts');
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

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        if (json.account_id) setAccountId(String(json.account_id));
        if (json.key_id) setKeyId(json.key_id);
        if (json.private_key) setPrivateKey(json.private_key);
        if (json.callback_rule_id) setCallbackRuleId(String(json.callback_rule_id));
        if (json.agent_phone_number) setAgentPhoneNumber(String(json.agent_phone_number));
        if (json.caller_id) setCallerId(String(json.caller_id));
        setConnectError('');
      } catch {
        setConnectError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  }

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!accountId.trim() || !keyId.trim() || !privateKey.trim()) return;

    const callbackRuleIdTrimmed = callbackRuleId.trim();
    const agentPhoneNumberTrimmed = agentPhoneNumber.trim();
    const callerIdTrimmed = callerId.trim();
    const callbackRuleIdNumber = callbackRuleIdTrimmed ? Number(callbackRuleIdTrimmed) : undefined;
    if (
      callbackRuleIdTrimmed &&
      (!Number.isInteger(callbackRuleIdNumber) || (callbackRuleIdNumber as number) <= 0)
    ) {
      setConnectError('Callback Rule ID must be a positive integer');
      return;
    }

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/voximplant/accounts', {
        method: 'POST',
        body: JSON.stringify({
          accountId: accountId.trim(),
          keyId: keyId.trim(),
          privateKey: privateKey.trim(),
          callbackRuleId: callbackRuleIdNumber,
          agentPhoneNumber: agentPhoneNumberTrimmed || undefined,
          callerId: callerIdTrimmed || undefined,
        }),
      });
      setAccountId('');
      setKeyId('');
      setPrivateKey('');
      setCallbackRuleId('');
      setAgentPhoneNumber('');
      setCallerId('');
      setSuccess('Voximplant account connected successfully');
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
      await api(`/voximplant/accounts/${id}`, { method: 'DELETE' });
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

  const formFilled = accountId.trim() && keyId.trim() && privateKey.trim();

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connect Voximplant Account</h2>
            <p className={styles.sectionDescription}>
              Upload your service account JSON key file or paste the credentials manually.
              Generate a key in the{' '}
              <a href="https://manage.voximplant.com/settings/service_accounts" target="_blank" rel="noopener noreferrer">
                Service Accounts
              </a>{' '}
              section of the Voximplant control panel (Add &rarr; Generate key &rarr; save the JSON file).
              For callback mode, you can optionally set a Rule ID override. If left empty, the platform auto-creates
              and maintains a dedicated Voximplant application, scenario, and rule. Set Agent Phone Number so the
              system calls your phone first, then connects to the contact.
              For browser calling, the platform also auto-creates a Web SDK user and auto-authenticates calls.
              Caller ID is required for PSTN calls by Vox; if you leave it empty, the backend auto-picks one from your
              Vox account and blocks connection with setup links if none are available.
            </p>
          </div>
        </div>

        <form onSubmit={handleConnect} className={styles.voximplantConnectForm}>
          <div className={styles.voximplantUploadRow}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <Button
              type="button"
              size="md"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} style={{ marginRight: 6 }} />
              Upload JSON key file
            </Button>
            {formFilled && !connecting && (
              <span className={styles.voximplantLoadedBadge}>
                Credentials loaded
              </span>
            )}
          </div>
          <Input
            label="Account ID"
            placeholder="e.g. 10342449"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
          <Input
            label="Key ID"
            placeholder="e.g. 4913883d-fb90-..."
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
          />
          <Input
            label="Private Key"
            placeholder="-----BEGIN PRIVATE KEY-----"
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
          />
          {connectError && (
            <div className={styles.alert}>
              <span className={styles.alertText}>{renderErrorWithLinks(connectError)}</span>
            </div>
          )}
          <Input
            label="Callback Rule ID (optional override)"
            placeholder="e.g. 123456"
            value={callbackRuleId}
            onChange={(e) => setCallbackRuleId(e.target.value)}
          />
          <Input
            label="Agent Phone Number (optional)"
            placeholder="e.g. +15551234567"
            value={agentPhoneNumber}
            onChange={(e) => setAgentPhoneNumber(e.target.value)}
          />
          <Input
            label="Caller ID (optional, auto-pick if empty)"
            placeholder="e.g. +15551230000"
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
          />
          <Button
            type="submit"
            size="md"
            disabled={connecting || !formFilled}
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
              Manage your connected Voximplant VoIP accounts.
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
              <p>Connect a Voximplant account using the form above to enable VoIP.</p>
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
                    {account.accountName || `Account ${account.accountId}`}
                    <Badge color={STATUS_COLOR[account.status]}>{account.status}</Badge>
                  </div>
                  <div className={styles.botUsername}>Account ID: {account.accountId}</div>
                  <div className={styles.botMeta}>
                    Key: {account.keyId} &middot; Connected{' '}
                    {new Date(account.createdAt).toLocaleDateString()}
                    {account.callbackRuleId ? ` · Callback rule: ${account.callbackRuleId}` : ''}
                    {account.agentPhoneNumber ? ` · Agent phone: ${account.agentPhoneNumber}` : ''}
                    {account.callerId ? ` · Caller ID: ${account.callerId}` : ''}
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
