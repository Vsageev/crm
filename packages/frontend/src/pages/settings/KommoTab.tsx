import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Trash2, Wifi, WifiOff, Search, ChevronLeft, MessageCircle, StickyNote } from 'lucide-react';
import { Button, Card, Input, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './SettingsPage.module.css';
import kommoStyles from './KommoTab.module.css';

interface KommoAccount {
  id: string;
  subdomain: string;
  accessToken: string;
  accountName: string | null;
  accountId: number | null;
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  createdAt: string;
}

interface KommoContact {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  custom_fields_values?: { field_name: string; values: { value: string }[] }[];
}

interface KommoNote {
  id: number;
  note_type: string;
  created_at: number;
  params?: { text?: string; service?: string };
  created_by: number;
}

interface KommoTalk {
  id: number;
  created_at: number;
  contact?: { id: number; name?: string };
  _embedded?: { contact?: { id: number; name?: string } };
}

interface KommoTalkMessage {
  id: number;
  created_at: number;
  text?: string;
  author?: { id: number; name?: string };
  message_type?: string;
}

const STATUS_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  active: 'success',
  inactive: 'default',
  error: 'error',
};

type BrowseView = 'none' | 'contacts' | 'contact-notes' | 'talks' | 'talk-messages';

export function KommoTab() {
  // Account state
  const [account, setAccount] = useState<KommoAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Connect form
  const [subdomain, setSubdomain] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Browse state
  const [browseView, setBrowseView] = useState<BrowseView>('none');
  const [contactSearch, setContactSearch] = useState('');
  const [contacts, setContacts] = useState<KommoContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState<KommoContact | null>(null);
  const [notes, setNotes] = useState<KommoNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [talks, setTalks] = useState<KommoTalk[]>([]);
  const [talksLoading, setTalksLoading] = useState(false);
  const [selectedTalk, setSelectedTalk] = useState<KommoTalk | null>(null);
  const [talkMessages, setTalkMessages] = useState<KommoTalkMessage[]>([]);
  const [talkMessagesLoading, setTalkMessagesLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');

  const fetchAccount = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<KommoAccount>('/kommo/account');
      setAccount(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setAccount(null);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load account');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    if (!subdomain.trim() || !accessToken.trim()) return;

    setConnecting(true);
    setConnectError('');
    setSuccess('');
    try {
      await api('/kommo/connect', {
        method: 'POST',
        body: JSON.stringify({
          subdomain: subdomain.trim(),
          accessToken: accessToken.trim(),
        }),
      });
      setSubdomain('');
      setAccessToken('');
      setSuccess('amoCRM account connected successfully');
      await fetchAccount();
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

  async function handleDisconnect() {
    setDeleteLoading(true);
    setError('');
    try {
      await api('/kommo/disconnect', { method: 'DELETE' });
      setShowDeleteConfirm(false);
      setSuccess('amoCRM account disconnected');
      setAccount(null);
      setBrowseView('none');
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

  // Browse: contacts
  async function fetchContacts(query?: string) {
    setContactsLoading(true);
    setBrowseError('');
    try {
      const params = query ? `?query=${encodeURIComponent(query)}` : '';
      const data = await api<{ entries: KommoContact[] }>(`/kommo/contacts${params}`);
      setContacts(data.entries);
    } catch (err) {
      setBrowseError(err instanceof ApiError ? err.message : 'Failed to load contacts');
    } finally {
      setContactsLoading(false);
    }
  }

  function openContacts() {
    setBrowseView('contacts');
    setSelectedContact(null);
    fetchContacts();
  }

  function handleContactSearch(e: FormEvent) {
    e.preventDefault();
    fetchContacts(contactSearch);
  }

  // Browse: contact notes
  async function openContactNotes(contact: KommoContact) {
    setSelectedContact(contact);
    setBrowseView('contact-notes');
    setNotesLoading(true);
    setBrowseError('');
    try {
      const data = await api<{ entries: KommoNote[] }>(`/kommo/contacts/${contact.id}/notes`);
      setNotes(data.entries);
    } catch (err) {
      setBrowseError(err instanceof ApiError ? err.message : 'Failed to load notes');
    } finally {
      setNotesLoading(false);
    }
  }

  // Browse: talks
  async function openTalks() {
    setBrowseView('talks');
    setSelectedTalk(null);
    setTalksLoading(true);
    setBrowseError('');
    try {
      const data = await api<{ entries: KommoTalk[] }>('/kommo/talks');
      setTalks(data.entries);
    } catch (err) {
      setBrowseError(err instanceof ApiError ? err.message : 'Failed to load talks');
    } finally {
      setTalksLoading(false);
    }
  }

  // Browse: talk messages
  async function openTalkMessages(talk: KommoTalk) {
    setSelectedTalk(talk);
    setBrowseView('talk-messages');
    setTalkMessagesLoading(true);
    setBrowseError('');
    try {
      const data = await api<{ entries: KommoTalkMessage[] }>(`/kommo/talks/${talk.id}/messages`);
      setTalkMessages(data.entries);
    } catch (err) {
      setBrowseError(err instanceof ApiError ? err.message : 'Failed to load messages');
    } finally {
      setTalkMessagesLoading(false);
    }
  }

  function handleBack() {
    if (browseView === 'contact-notes') {
      setBrowseView('contacts');
      setSelectedContact(null);
    } else if (browseView === 'talk-messages') {
      setBrowseView('talks');
      setSelectedTalk(null);
    } else {
      setBrowseView('none');
    }
    setBrowseError('');
  }

  function formatTs(ts: number) {
    return new Date(ts * 1000).toLocaleString();
  }

  function getContactPhone(contact: KommoContact): string | null {
    const phoneField = contact.custom_fields_values?.find(
      (f) => f.field_name === 'Phone' || f.field_name === 'Телефон',
    );
    return phoneField?.values?.[0]?.value ?? null;
  }

  function getContactEmail(contact: KommoContact): string | null {
    const emailField = contact.custom_fields_values?.find(
      (f) => f.field_name === 'Email' || f.field_name === 'Почта',
    );
    return emailField?.values?.[0]?.value ?? null;
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Connect form */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connect amoCRM Account</h2>
            <p className={styles.sectionDescription}>
              Enter your amoCRM subdomain (the part before <code>.amocrm.ru</code>) and a long-lived
              API token. To get the token:
            </p>
            <ol className={kommoStyles.steps}>
              <li>In amoCRM, go to <b>Settings &rarr; Integrations</b></li>
              <li>Create a new <b>private integration</b> (or open an existing one)</li>
              <li>Under <b>Authorization</b>, copy the access token</li>
            </ol>
          </div>
        </div>

        <form onSubmit={handleConnect} className={styles.connectForm}>
          <Input
            label="Subdomain"
            placeholder="mycompany"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
          />
          <Input
            label="Access Token"
            placeholder="Paste token from amoCRM integrations"
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            error={connectError}
          />
          <Button
            type="submit"
            size="md"
            disabled={connecting || !subdomain.trim() || !accessToken.trim()}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
        </form>
      </div>

      {/* Connected account */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Connected Account</h2>
            <p className={styles.sectionDescription}>Your connected amoCRM account.</p>
          </div>
        </div>

        {success && <div className={styles.success}>{success}</div>}
        {error && <div className={styles.alert}>{error}</div>}

        {loading ? (
          <div className={styles.loadingState}>Loading account...</div>
        ) : !account ? (
          <Card>
            <div className={styles.emptyState}>
              <p>No amoCRM account connected yet.</p>
              <p>Connect an account using the form above.</p>
            </div>
          </Card>
        ) : (
          <div className={styles.botList}>
            <div className={styles.botCard}>
              <div className={styles.botInfo}>
                <div className={styles.botName}>
                  {account.status === 'active' ? (
                    <Wifi size={14} color="var(--color-success)" />
                  ) : (
                    <WifiOff size={14} color="var(--color-text-tertiary)" />
                  )}
                  {account.accountName || account.subdomain}
                  <Badge color={STATUS_COLOR[account.status]}>{account.status}</Badge>
                </div>
                <div className={styles.botUsername}>{account.subdomain}.amocrm.ru</div>
                <div className={styles.botMeta}>
                  Token: {account.accessToken} &middot; Connected{' '}
                  {new Date(account.createdAt).toLocaleDateString()}
                  {account.statusMessage && ` · ${account.statusMessage}`}
                </div>
              </div>
              <div className={styles.botActions}>
                {showDeleteConfirm ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleteLoading}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleDisconnect}
                      disabled={deleteLoading}
                    >
                      {deleteLoading ? 'Removing...' : 'Confirm'}
                    </Button>
                  </>
                ) : (
                  <button
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => setShowDeleteConfirm(true)}
                    title="Disconnect account"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Browse section — only when connected */}
      {account && account.status === 'active' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Browse amoCRM Data</h2>
              <p className={styles.sectionDescription}>
                View contacts, notes, and conversations from your amoCRM account.
              </p>
            </div>
          </div>

          {browseView === 'none' && (
            <div className={kommoStyles.browseActions}>
              <Button size="md" variant="secondary" onClick={openContacts}>
                <Search size={14} style={{ marginRight: 6 }} />
                Contacts
              </Button>
              <Button size="md" variant="secondary" onClick={openTalks}>
                <MessageCircle size={14} style={{ marginRight: 6 }} />
                Talks
              </Button>
            </div>
          )}

          {browseError && <div className={styles.alert}>{browseError}</div>}

          {/* Contacts list */}
          {browseView === 'contacts' && (
            <div>
              <div className={kommoStyles.browseHeader}>
                <button className={kommoStyles.backBtn} onClick={handleBack}>
                  <ChevronLeft size={16} /> Back
                </button>
                <form onSubmit={handleContactSearch} className={kommoStyles.searchRow}>
                  <input
                    className={styles.searchInput}
                    placeholder="Search contacts..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    <Search size={14} />
                  </Button>
                </form>
              </div>

              {contactsLoading ? (
                <div className={styles.loadingState}>Loading contacts...</div>
              ) : contacts.length === 0 ? (
                <div className={styles.loadingState}>No contacts found.</div>
              ) : (
                <div className={kommoStyles.itemList}>
                  {contacts.map((c) => (
                    <div
                      key={c.id}
                      className={kommoStyles.itemRow}
                      onClick={() => openContactNotes(c)}
                    >
                      <div className={kommoStyles.itemMain}>
                        <span className={kommoStyles.itemName}>{c.name || '(no name)'}</span>
                        <span className={kommoStyles.itemSub}>
                          {[getContactPhone(c), getContactEmail(c)].filter(Boolean).join(' · ') ||
                            `ID: ${c.id}`}
                        </span>
                      </div>
                      <StickyNote size={14} color="var(--color-text-tertiary)" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Contact notes */}
          {browseView === 'contact-notes' && selectedContact && (
            <div>
              <div className={kommoStyles.browseHeader}>
                <button className={kommoStyles.backBtn} onClick={handleBack}>
                  <ChevronLeft size={16} /> {selectedContact.name || 'Contact'}
                </button>
              </div>

              {notesLoading ? (
                <div className={styles.loadingState}>Loading notes...</div>
              ) : notes.length === 0 ? (
                <div className={styles.loadingState}>No notes for this contact.</div>
              ) : (
                <div className={kommoStyles.itemList}>
                  {notes.map((n) => (
                    <div key={n.id} className={kommoStyles.noteCard}>
                      <div className={kommoStyles.noteMeta}>
                        <Badge color="default">{n.note_type}</Badge>
                        <span>{formatTs(n.created_at)}</span>
                      </div>
                      {n.params?.text && (
                        <div className={kommoStyles.noteText}>{n.params.text}</div>
                      )}
                      {n.params?.service && (
                        <div className={kommoStyles.noteSub}>via {n.params.service}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Talks list */}
          {browseView === 'talks' && (
            <div>
              <div className={kommoStyles.browseHeader}>
                <button className={kommoStyles.backBtn} onClick={handleBack}>
                  <ChevronLeft size={16} /> Back
                </button>
              </div>

              {talksLoading ? (
                <div className={styles.loadingState}>Loading talks...</div>
              ) : talks.length === 0 ? (
                <div className={styles.loadingState}>No talks found.</div>
              ) : (
                <div className={kommoStyles.itemList}>
                  {talks.map((t) => {
                    const contact = t._embedded?.contact || t.contact;
                    return (
                      <div
                        key={t.id}
                        className={kommoStyles.itemRow}
                        onClick={() => openTalkMessages(t)}
                      >
                        <div className={kommoStyles.itemMain}>
                          <span className={kommoStyles.itemName}>
                            Talk #{t.id}
                            {contact?.name ? ` — ${contact.name}` : ''}
                          </span>
                          <span className={kommoStyles.itemSub}>{formatTs(t.created_at)}</span>
                        </div>
                        <MessageCircle size={14} color="var(--color-text-tertiary)" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Talk messages */}
          {browseView === 'talk-messages' && selectedTalk && (
            <div>
              <div className={kommoStyles.browseHeader}>
                <button className={kommoStyles.backBtn} onClick={handleBack}>
                  <ChevronLeft size={16} /> Talk #{selectedTalk.id}
                </button>
              </div>

              {talkMessagesLoading ? (
                <div className={styles.loadingState}>Loading messages...</div>
              ) : talkMessages.length === 0 ? (
                <div className={styles.loadingState}>No messages in this talk.</div>
              ) : (
                <div className={kommoStyles.itemList}>
                  {talkMessages.map((m) => (
                    <div key={m.id} className={kommoStyles.noteCard}>
                      <div className={kommoStyles.noteMeta}>
                        {m.author?.name && (
                          <span className={kommoStyles.msgAuthor}>{m.author.name}</span>
                        )}
                        <span>{formatTs(m.created_at)}</span>
                      </div>
                      {m.text && <div className={kommoStyles.noteText}>{m.text}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
