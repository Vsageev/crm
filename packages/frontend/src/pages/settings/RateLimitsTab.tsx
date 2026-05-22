import { useEffect, useState } from 'react';
import { Gauge, Save } from 'lucide-react';
import { api } from '../../lib/api';
import { ActionTooltip } from '../../ui';
import styles from './RateLimitsTab.module.css';

interface RateLimitSettings {
  agentPromptMax: number;
  agentPromptWindowS: number;
}

export function RateLimitsTab() {
  const [settings, setSettings] = useState<RateLimitSettings | null>(null);
  const [draft, setDraft] = useState<RateLimitSettings>({ agentPromptMax: 10, agentPromptWindowS: 60 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/settings/rate-limits')
      .then((data) => {
        const d = data as RateLimitSettings;
        setSettings(d);
        setDraft(d);
      })
      .catch(() => setError('Failed to load rate limit settings'));
  }, []);

  const hasChanges = settings && (
    draft.agentPromptMax !== settings.agentPromptMax ||
    draft.agentPromptWindowS !== settings.agentPromptWindowS
  );
  const saveDisabledReason = saving
    ? 'Rate limit settings are already being saved.'
    : !hasChanges
      ? 'Change a rate limit before saving.'
      : null;

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated = await api('/settings/rate-limits', {
        method: 'PATCH',
        body: JSON.stringify(draft),
      }) as RateLimitSettings;
      setSettings(updated);
      setDraft(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (!settings && !error) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div>
          <h3 className={styles.sectionTitle}>Agent Prompt Rate Limit</h3>
          <p className={styles.sectionDesc}>
            Controls how many messages a user can send to the same agent within a time window.
            Applies per user per agent across all conversations.
          </p>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="rl-max">
              <Gauge size={15} className={styles.fieldIcon} />
              Max requests
            </label>
            <p className={styles.fieldHint}>Number of requests allowed in the window</p>
            <input
              id="rl-max"
              type="number"
              className={styles.numberInput}
              min={1}
              max={1000}
              value={draft.agentPromptMax}
              onChange={(e) => setDraft((d) => ({ ...d, agentPromptMax: Math.max(1, parseInt(e.target.value) || 1) }))}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="rl-window">
              <Gauge size={15} className={styles.fieldIcon} />
              Window (seconds)
            </label>
            <p className={styles.fieldHint}>Rolling time window for the limit</p>
            <input
              id="rl-window"
              type="number"
              className={styles.numberInput}
              min={5}
              max={3600}
              value={draft.agentPromptWindowS}
              onChange={(e) => setDraft((d) => ({ ...d, agentPromptWindowS: Math.max(5, parseInt(e.target.value) || 5) }))}
            />
          </div>
        </div>

        <div className={styles.summary}>
          {draft.agentPromptMax} request{draft.agentPromptMax !== 1 ? 's' : ''} per {draft.agentPromptWindowS} second{draft.agentPromptWindowS !== 1 ? 's' : ''}
        </div>

        <div className={styles.actions}>
          <ActionTooltip
            label={saveDisabledReason ?? 'Save changes'}
            disabled={Boolean(saveDisabledReason)}
            triggerLabel="Save changes"
          >
            <button
              className={styles.saveBtn}
              disabled={Boolean(saveDisabledReason)}
              onClick={handleSave}
            >
              <Save size={14} />
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
            </button>
          </ActionTooltip>
        </div>
      </div>
    </div>
  );
}
