import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Search, FileText } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { Textarea } from './Textarea';
import { AgentAvatar } from '../components/AgentAvatar';
import { api } from '../lib/api';
import styles from './CreateCardModal.module.css';

interface UserEntry { id: string; firstName: string; lastName: string }
interface AgentEntry {
  id: string; name: string; status: string;
  avatarIcon?: string; avatarBgColor?: string; avatarLogoColor?: string;
}
interface Tag { id: string; name: string; color: string }
interface CardResult { id: string; name: string }

export interface CreateCardData {
  name: string;
  description: string | null;
  assigneeId: string | null;
  tagIds: string[];
  linkedCardIds: string[];
}

interface CreateCardModalProps {
  onClose: () => void;
  onSubmit: (data: CreateCardData) => Promise<void>;
}

export function CreateCardModal({ onClose, onSubmit }: CreateCardModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Assignee
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);

  // Tags
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  // Related cards
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState<CardResult[]>([]);
  const [linkedCards, setLinkedCards] = useState<CardResult[]>([]);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Fetch users, agents, and tags on mount
  useEffect(() => {
    Promise.allSettled([
      api<{ entries: UserEntry[] }>('/users'),
      api<{ entries: AgentEntry[] }>('/agents?limit=100'),
      api<{ entries: Tag[] }>('/tags'),
    ]).then(([usersRes, agentsRes, tagsRes]) => {
      if (usersRes.status === 'fulfilled') setUsers(usersRes.value.entries);
      if (agentsRes.status === 'fulfilled')
        setAgents(agentsRes.value.entries.filter((a) => a.status === 'active'));
      if (tagsRes.status === 'fulfilled') setAllTags(tagsRes.value.entries);
    });
  }, []);

  // Close assignee dropdown on outside click
  useEffect(() => {
    if (!showAssigneeDropdown) return;
    function handleClick(e: MouseEvent) {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) {
        setShowAssigneeDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAssigneeDropdown]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Search cards for linking
  useEffect(() => {
    if (linkSearch.length < 2) {
      setLinkResults([]);
      return;
    }
    const controller = new AbortController();
    api<{ entries: CardResult[] }>(
      `/cards?search=${encodeURIComponent(linkSearch)}&limit=10`,
      { signal: controller.signal },
    )
      .then((d) => {
        const linkedIds = new Set(linkedCards.map((c) => c.id));
        setLinkResults(d.entries.filter((c) => !linkedIds.has(c.id)));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [linkSearch, linkedCards]);

  const handleSubmit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmed,
        description: description.trim() || null,
        assigneeId,
        tagIds: Array.from(selectedTagIds),
        linkedCardIds: linkedCards.map((c) => c.id),
      });
    } finally {
      setSubmitting(false);
    }
  }, [name, description, submitting, onSubmit, assigneeId, selectedTagIds, linkedCards]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  function addLinkedCard(card: CardResult) {
    setLinkedCards((prev) => [...prev, card]);
    setLinkSearch('');
    setLinkResults([]);
  }

  function removeLinkedCard(cardId: string) {
    setLinkedCards((prev) => prev.filter((c) => c.id !== cardId));
  }

  // Resolve assignee display
  const selectedUser = users.find((u) => u.id === assigneeId);
  const selectedAgent = agents.find((a) => a.id === assigneeId);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <span className={styles.title}>New Card</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.fields}>
          <Input
            ref={nameRef}
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Card name"
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a brief description (optional)"
            rows={3}
          />

          {/* Assignee */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Assignee</span>
            <div className={styles.assigneeSelect} ref={assigneeRef}>
              <button
                type="button"
                className={styles.assigneeTrigger}
                onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
              >
                {selectedUser ? (
                  <>
                    <span className={styles.assigneeAvatar}>
                      {selectedUser.firstName[0]}{selectedUser.lastName[0]}
                    </span>
                    {selectedUser.firstName} {selectedUser.lastName}
                  </>
                ) : selectedAgent ? (
                  <>
                    <AgentAvatar
                      icon={selectedAgent.avatarIcon || 'spark'}
                      bgColor={selectedAgent.avatarBgColor || '#1a1a2e'}
                      logoColor={selectedAgent.avatarLogoColor || '#e94560'}
                      size={20}
                    />
                    {selectedAgent.name}
                  </>
                ) : (
                  <span className={styles.assigneePlaceholder}>Select assignee...</span>
                )}
              </button>
              {showAssigneeDropdown && (
                <div className={styles.assigneeDropdown}>
                  {assigneeId && (
                    <button
                      className={styles.assigneeOption}
                      onClick={() => { setAssigneeId(null); setShowAssigneeDropdown(false); }}
                    >
                      <X size={12} /> Unassign
                    </button>
                  )}
                  {agents.length > 0 && (
                    <>
                      <div className={styles.assigneeDivider}>Agents</div>
                      {agents.map((a) => (
                        <button
                          key={a.id}
                          className={`${styles.assigneeOption}${assigneeId === a.id ? ` ${styles.assigneeOptionActive}` : ''}`}
                          onClick={() => { setAssigneeId(a.id); setShowAssigneeDropdown(false); }}
                        >
                          <AgentAvatar
                            icon={a.avatarIcon || 'spark'}
                            bgColor={a.avatarBgColor || '#1a1a2e'}
                            logoColor={a.avatarLogoColor || '#e94560'}
                            size={20}
                          />
                          {a.name}
                          {assigneeId === a.id && <Check size={12} className={styles.assigneeCheck} />}
                        </button>
                      ))}
                    </>
                  )}
                  {users.length > 0 && (
                    <>
                      <div className={styles.assigneeDivider}>Users</div>
                      {users.map((u) => (
                        <button
                          key={u.id}
                          className={`${styles.assigneeOption}${assigneeId === u.id ? ` ${styles.assigneeOptionActive}` : ''}`}
                          onClick={() => { setAssigneeId(u.id); setShowAssigneeDropdown(false); }}
                        >
                          <span className={styles.assigneeAvatar}>
                            {u.firstName[0]}{u.lastName[0]}
                          </span>
                          {u.firstName} {u.lastName}
                          {assigneeId === u.id && <Check size={12} className={styles.assigneeCheck} />}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>Tags</span>
              <div className={styles.tagsList}>
                {allTags.map((tag) => {
                  const selected = selectedTagIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`${styles.tagPill}${selected ? ` ${styles.tagPillSelected}` : ''}`}
                      style={{ '--tag-color': tag.color } as React.CSSProperties}
                      onClick={() => toggleTag(tag.id)}
                    >
                      {selected && <Check size={11} className={styles.tagPillCheck} />}
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Related Cards */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Related Cards</span>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input
                className={styles.searchInput}
                style={{ paddingLeft: 30 }}
                placeholder="Search cards..."
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
              />
            </div>
            {linkResults.length > 0 && (
              <div className={styles.searchResults}>
                {linkResults.map((c) => (
                  <button
                    key={c.id}
                    className={styles.searchResultItem}
                    onClick={() => addLinkedCard(c)}
                  >
                    <FileText size={13} />
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {linkSearch.length >= 2 && linkResults.length === 0 && (
              <div className={styles.searchEmpty}>No cards found</div>
            )}
            {linkedCards.length > 0 && (
              <div className={styles.selectedCards}>
                {linkedCards.map((c) => (
                  <div key={c.id} className={styles.selectedCard}>
                    <FileText size={13} style={{ flexShrink: 0, color: 'var(--color-text-tertiary)' }} />
                    <span className={styles.selectedCardName}>{c.name}</span>
                    <button
                      type="button"
                      className={styles.selectedCardRemove}
                      onClick={() => removeLinkedCard(c.id)}
                      aria-label="Remove"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !name.trim()}>
            {submitting ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
