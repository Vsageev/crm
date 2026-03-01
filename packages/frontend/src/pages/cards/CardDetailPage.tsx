import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Trash2, Plus, X, Link2, Columns3,
  FileText, User, Send, Check, Pencil, Loader2,
} from 'lucide-react';
import { Button, MarkdownContent, PageLoader, Tooltip } from '../../ui';
import { AgentAvatar } from '../../components/AgentAvatar';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../stores/toast';
import { useConfirm } from '../../hooks/useConfirm';
import styles from './CardDetailPage.module.css';

/* ── Types ────────────────────────────────────────────── */

interface Tag { id: string; name: string; color: string }
interface Assignee {
  id: string; firstName: string; lastName: string; type?: 'user' | 'agent';
  avatarIcon?: string | null; avatarBgColor?: string | null; avatarLogoColor?: string | null;
}
interface LinkedCard { linkId: string; id: string; name: string; collectionId: string }
interface BoardPlacement { boardId: string; boardName: string; columnId: string; columnName: string | null; columnColor: string | null }

interface CardDetail {
  id: string;
  collectionId: string;
  name: string;
  description: string | null;
  customFields: Record<string, unknown>;
  assigneeId: string | null;
  assignee: Assignee | null;
  position: number;
  tags: Tag[];
  linkedCards: LinkedCard[];
  boards: BoardPlacement[];
  createdAt: string;
  updatedAt: string;
}

interface CardComment {
  id: string;
  cardId: string;
  authorId: string;
  content: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    type?: 'user' | 'agent';
    avatarIcon?: string | null;
    avatarBgColor?: string | null;
    avatarLogoColor?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface UserEntry { id: string; firstName: string; lastName: string }
interface AgentEntry {
  id: string; name: string; status: string;
  avatarIcon?: string; avatarBgColor?: string; avatarLogoColor?: string;
}

function ini(f: string, l: string) {
  return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase();
}

/* ── Assignee picker (portal) ─────────────────────────── */

import { forwardRef } from 'react';

interface AssigneePickerProps {
  triggerRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  users: UserEntry[];
  agents: AgentEntry[];
  assigneeId: string | null;
  hasAssignee: boolean;
  onAssign: (id: string | null) => void;
}

const AssigneePicker = forwardRef<HTMLDivElement, AssigneePickerProps>(
  function AssigneePicker({ triggerRef, loading, users, agents, assigneeId, hasAssignee, onAssign }, ref) {
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useEffect(() => {
      function update() {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setPos({ top: rect.bottom + 4, left: rect.right });
      }
      update();
      window.addEventListener('scroll', update, true);
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('scroll', update, true);
        window.removeEventListener('resize', update);
      };
    }, [triggerRef]);

    if (!pos) return null;

    return (
      <div
        ref={ref}
        className={styles.assigneeOverlay}
        style={{ top: pos.top, left: pos.left }}
      >
        {loading ? (
          <div className={styles.pickerLoading}>
            <Loader2 size={14} className={styles.spinner} /> Loading…
          </div>
        ) : users.length === 0 && agents.length === 0 ? (
          <div className={styles.pickerEmpty}>No users or agents available</div>
        ) : (
          <>
            {hasAssignee && (
              <button className={styles.resultItem} onClick={() => onAssign(null)}>
                <X size={12} /> Unassign
              </button>
            )}
            {agents.length > 0 && (
              <>
                <div className={styles.pickerDivider}>Agents</div>
                {agents.map((a) => (
                  <button
                    key={a.id}
                    className={`${styles.resultItem}${assigneeId === a.id ? ` ${styles.resultItemActive}` : ''}`}
                    onClick={() => onAssign(a.id)}
                  >
                    <AgentAvatar icon={a.avatarIcon || 'spark'} bgColor={a.avatarBgColor || '#1a1a2e'} logoColor={a.avatarLogoColor || '#e94560'} size={16} /> {a.name}
                    {assigneeId === a.id && <Check size={12} className={styles.checkIcon} />}
                  </button>
                ))}
              </>
            )}
            {users.length > 0 && (
              <>
                <div className={styles.pickerDivider}>Users</div>
                {users.map((u) => (
                  <button
                    key={u.id}
                    className={`${styles.resultItem}${assigneeId === u.id ? ` ${styles.resultItemActive}` : ''}`}
                    onClick={() => onAssign(u.id)}
                  >
                    <User size={12} /> {u.firstName} {u.lastName}
                    {assigneeId === u.id && <Check size={12} className={styles.checkIcon} />}
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>
    );
  },
);

/* ── Component ────────────────────────────────────────── */

export function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<CardComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Inline editing
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftDesc, setDraftDesc] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Tag management
  const [showTagMgr, setShowTagMgr] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3B82F6');
  const [creatingTag, setCreatingTag] = useState(false);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);

  // Linked cards
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkTerm, setLinkTerm] = useState('');
  const [linkResults, setLinkResults] = useState<{ id: string; name: string }[]>([]);

  // Assignee
  const [showAssignee, setShowAssignee] = useState(false);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const assigneeTriggerRef = useRef<HTMLDivElement>(null);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  /* ── Fetch ──────────────────────────────────────────── */

  const fetchCard = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try { setCard(await api<CardDetail>(`/cards/${id}`)); }
    catch { /* best-effort */ }
    finally { setLoading(false); }
  }, [id]);

  const fetchComments = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api<{ entries: CardComment[] }>(`/cards/${id}/comments`);
      setComments(d.entries);
    } catch { /* best-effort */ }
  }, [id]);

  const fetchTags = useCallback(async () => {
    try {
      const d = await api<{ entries: Tag[] }>('/tags');
      setAllTags(d.entries);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchCard(); fetchComments(); }, [fetchCard, fetchComments]);

  // Close assignee picker on outside click
  useEffect(() => {
    if (!showAssignee) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        assigneeTriggerRef.current?.contains(target) ||
        assigneeDropdownRef.current?.contains(target)
      ) return;
      setShowAssignee(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAssignee]);

  /* ── Inline editing ─────────────────────────────────── */

  function startEditName() {
    if (!card) return;
    setDraftName(card.name);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  async function saveName() {
    if (!card) return;
    const name = draftName.trim();
    if (!name || name === card.name) { setEditingName(false); return; }
    try {
      await api(`/cards/${card.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setEditingName(false);
      fetchCard();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  function startEditDesc() {
    if (!card) return;
    setDraftDesc(card.description || '');
    setEditingDesc(true);
    setTimeout(() => descTextareaRef.current?.focus(), 0);
  }

  async function saveDesc() {
    if (!card) return;
    const description = draftDesc.trim() || null;
    if (description === (card.description || null)) { setEditingDesc(false); return; }
    try {
      await api(`/cards/${card.id}`, { method: 'PATCH', body: JSON.stringify({ description }) });
      setEditingDesc(false);
      fetchCard();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  /* ── Card actions ───────────────────────────────────── */

  async function handleDelete() {
    if (!card) return;
    const confirmed = await confirm({
      title: 'Delete card',
      message: 'Delete this card? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/cards/${card.id}`, { method: 'DELETE' });
      navigate(`/collections/${card.collectionId}`);
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  /* ── Tag actions ────────────────────────────────────── */

  function openTagMgr() { setShowTagMgr(true); fetchTags(); }

  async function addTag(tagId: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/tags`, { method: 'POST', body: JSON.stringify({ tagId }) });
      fetchCard(); fetchTags();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  async function removeTag(tagId: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/tags/${tagId}`, { method: 'DELETE' });
      fetchCard();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) return;
    setCreatingTag(true);
    try {
      const t = await api<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name, color: newTagColor }) });
      setNewTagName('');
      await addTag(t.id);
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
    finally { setCreatingTag(false); }
  }

  async function deleteTag(tagId: string) {
    const confirmed = await confirm({
      title: 'Delete tag',
      message: 'Delete this tag from the workspace?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    setDeletingTagId(tagId);
    try {
      await api(`/tags/${tagId}`, { method: 'DELETE' });
      fetchCard(); fetchTags();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
    finally { setDeletingTagId(null); }
  }

  /* ── Link actions ───────────────────────────────────── */

  async function searchCards(term: string) {
    setLinkTerm(term);
    if (term.length < 2) { setLinkResults([]); return; }
    try {
      const d = await api<{ entries: { id: string; name: string }[] }>(
        `/cards?search=${encodeURIComponent(term)}&limit=10`,
      );
      const linked = new Set(card?.linkedCards.map((lc) => lc.id) ?? []);
      setLinkResults(d.entries.filter((c) => c.id !== id && !linked.has(c.id)));
    } catch { setLinkResults([]); }
  }

  async function linkCard(targetCardId: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/links`, { method: 'POST', body: JSON.stringify({ targetCardId }) });
      setShowLinkSearch(false); setLinkTerm(''); setLinkResults([]); fetchCard();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  async function unlinkCard(linkId: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/links/${linkId}`, { method: 'DELETE' });
      fetchCard();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  /* ── Comment actions ────────────────────────────────── */

  async function addComment() {
    if (!card || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      await api(`/cards/${card.id}/comments`, { method: 'POST', body: JSON.stringify({ content: newComment.trim() }) });
      setNewComment(''); fetchComments();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
    finally { setSubmittingComment(false); }
  }

  async function deleteComment(cid: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/comments/${cid}`, { method: 'DELETE' });
      fetchComments();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  /* ── Assignee actions ───────────────────────────────── */

  async function openAssignee() {
    if (showAssignee) { setShowAssignee(false); return; }
    setShowAssignee(true);
    setLoadingAssignees(true);
    try {
      const [usersRes, agentsRes] = await Promise.allSettled([
        api<{ entries: UserEntry[] }>('/users'),
        api<{ entries: AgentEntry[] }>('/agents'),
      ]);
      setUsers(usersRes.status === 'fulfilled' ? usersRes.value.entries : []);
      setAgents(
        agentsRes.status === 'fulfilled'
          ? agentsRes.value.entries.filter(a => a.status === 'active')
          : [],
      );
    } catch { /* ignore */ }
    finally { setLoadingAssignees(false); }
  }

  async function assign(uid: string | null) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}`, { method: 'PATCH', body: JSON.stringify({ assigneeId: uid }) });
      setShowAssignee(false); fetchCard();
    } catch (e) { if (e instanceof ApiError) toast.error(e.message); }
  }

  /* ── Render ─────────────────────────────────────────── */

  if (loading) return <PageLoader />;
  if (!card) return <div className={styles.emptyState}>Card not found</div>;

  const cfEntries = Object.entries(card.customFields || {});
  const tagIds = new Set(card.tags.map((t) => t.id));

  return (
    <div className={styles.page}>
      {confirmDialog}
      {/* Top bar */}
      <div className={styles.topBar}>
        <button
          type="button"
          className={styles.backLink}
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate(`/collections/${card.collectionId}`);
          }}
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <Button variant="ghost" size="sm" onClick={handleDelete}>
          <Trash2 size={14} />
          Delete
        </Button>
      </div>

      <div className={styles.grid}>
        {/* ── Left: name, description, activity ───────── */}
        <div className={styles.main}>
          {/* Name + Description card */}
          <div className={styles.card}>
            {/* Editable title */}
            {editingName ? (
              <input
                ref={nameInputRef}
                className={styles.titleInput}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
            ) : (
              <h1 className={styles.titleDisplay} onClick={startEditName}>
                {card.name}
                <Pencil size={14} className={styles.editHint} />
              </h1>
            )}

            {/* Editable description (markdown) */}
            <div className={styles.descriptionSection}>
              <span className={styles.descriptionLabel}>Description</span>
              {editingDesc ? (
                <>
                  <textarea
                    ref={descTextareaRef}
                    className={styles.descriptionTextarea}
                    value={draftDesc}
                    onChange={(e) => setDraftDesc(e.target.value)}
                    placeholder="Write a description... (Markdown supported)"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditingDesc(false);
                    }}
                  />
                  <div className={styles.descriptionActions}>
                    <Button variant="ghost" size="sm" onClick={() => setEditingDesc(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveDesc}>
                      <Check size={14} />
                      Save
                    </Button>
                  </div>
                </>
              ) : card.description ? (
                <div className={styles.descriptionDisplay} onClick={startEditDesc}>
                  <MarkdownContent>{card.description}</MarkdownContent>
                  <Pencil size={12} className={styles.editHint} />
                </div>
              ) : (
                <div className={styles.descriptionPlaceholder} onClick={startEditDesc}>
                  <Pencil size={12} />
                  Click to add a description...
                </div>
              )}
            </div>
          </div>

          {/* Activity card */}
          <div className={styles.card}>
            <div className={styles.activitySection}>
              <div className={styles.activityHeader}>
                <span className={styles.activityTitle}>Activity</span>
                <span className={styles.activityCount}>
                  {comments.length} comment{comments.length !== 1 ? 's' : ''}
                </span>
              </div>

              {comments.length > 0 && (
                <div className={styles.commentsList}>
                  {comments.map((c) => (
                    <div key={c.id} className={styles.comment}>
                      <div className={`${styles.avatar} ${styles.avatarLg}${c.author?.type === 'agent' ? ` ${styles.avatarAgent}` : ''}`}>
                        {c.author?.type === 'agent' ? (
                          <AgentAvatar
                            icon={c.author.avatarIcon || 'spark'}
                            bgColor={c.author.avatarBgColor || '#1a1a2e'}
                            logoColor={c.author.avatarLogoColor || '#e94560'}
                            size={30}
                          />
                        ) : (
                          c.author ? ini(c.author.firstName, c.author.lastName) : '??'
                        )}
                      </div>
                      <div className={styles.commentBody}>
                        <div className={styles.commentMeta}>
                          <span className={styles.commentAuthor}>
                            {c.author
                              ? c.author.type === 'agent'
                                ? c.author.firstName
                                : `${c.author.firstName} ${c.author.lastName}`.trim()
                              : 'Unknown'}
                          </span>
                          <span className={styles.commentTime}>
                            {new Date(c.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className={styles.commentText}>
                          <MarkdownContent compact>{c.content}</MarkdownContent>
                        </div>
                      </div>
                      <Tooltip label="Delete">
                        <button className={styles.commentX} onClick={() => deleteComment(c.id)} aria-label="Delete">
                          <X size={11} />
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.commentForm}>
                <textarea
                  className={styles.commentTextarea}
                  placeholder="Write a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment();
                  }}
                />
                <Tooltip label="Send">
                  <button
                    className={styles.commentSend}
                    onClick={addComment}
                    disabled={!newComment.trim() || submittingComment}
                    aria-label="Send"
                  >
                    <Send size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right sidebar: metadata ─────────────────── */}
        <div className={styles.sidebar}>
          {/* Details */}
          <div className={styles.sidePanel}>
            <div className={styles.sidePanelHeader}>
              <span className={styles.sidePanelTitle}>Details</span>
            </div>
            <div className={styles.sidePanelBody}>
              {/* Assignee */}
              <div className={styles.detailRow} ref={assigneeTriggerRef}>
                <span className={styles.detailLabel}>Assignee</span>
                {card.assignee ? (
                  <div className={styles.assigneeRow} onClick={openAssignee} style={{ cursor: 'pointer' }}>
                    <div className={`${styles.avatar}${card.assignee.type === 'agent' ? ` ${styles.avatarAgent}` : ''}`}>
                      {card.assignee.type === 'agent'
                        ? <AgentAvatar icon={card.assignee.avatarIcon || 'spark'} bgColor={card.assignee.avatarBgColor || '#1a1a2e'} logoColor={card.assignee.avatarLogoColor || '#e94560'} size={24} />
                        : ini(card.assignee.firstName, card.assignee.lastName)}
                    </div>
                    <span className={styles.detailValue}>
                      {card.assignee.firstName} {card.assignee.type !== 'agent' ? card.assignee.lastName : ''}
                    </span>
                  </div>
                ) : (
                  <button className={styles.assignBtn} onClick={openAssignee}>
                    <User size={11} /> Assign
                  </button>
                )}
              </div>
              {showAssignee && createPortal(
                <AssigneePicker
                  ref={assigneeDropdownRef}
                  triggerRef={assigneeTriggerRef}
                  loading={loadingAssignees}
                  users={users}
                  agents={agents}
                  assigneeId={card.assigneeId}
                  hasAssignee={!!card.assignee}
                  onAssign={assign}
                />,
                document.body,
              )}

              {/* Created */}
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Created</span>
                <span className={styles.detailValue}>
                  {new Date(card.createdAt).toLocaleDateString()}
                </span>
              </div>

              {/* Updated */}
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Updated</span>
                <span className={styles.detailValue}>
                  {new Date(card.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Boards */}
          {card.boards && card.boards.length > 0 && (
            <div className={styles.sidePanel}>
              <div className={styles.sidePanelHeader}>
                <span className={styles.sidePanelTitle}>Boards</span>
              </div>
              <div className={styles.sidePanelBody}>
                {card.boards.map((bp) => (
                  <div key={bp.boardId} className={styles.linkRow}>
                    <Columns3 size={13} className={styles.linkIcon} />
                    <Link to={`/boards/${bp.boardId}`} className={styles.linkName}>
                      {bp.boardName}
                    </Link>
                    {bp.columnName && (
                      <span className={styles.boardColumn} style={bp.columnColor ? { background: bp.columnColor } : undefined}>
                        {bp.columnName}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          <div className={styles.sidePanel}>
            <div className={styles.sidePanelHeader}>
              <span className={styles.sidePanelTitle}>Tags</span>
              <button className={styles.sidePanelAction} onClick={openTagMgr}>
                <Plus size={11} /> Manage
              </button>
            </div>
            <div className={styles.sidePanelBody}>
              {card.tags.length > 0 ? (
                <div className={styles.tags}>
                  {card.tags.map((tag) => (
                    <span key={tag.id} className={styles.tag} style={{ background: tag.color }}>
                      {tag.name}
                      <Tooltip label="Remove">
                        <button className={styles.tagX} onClick={() => removeTag(tag.id)} aria-label="Remove">
                          <X size={7} />
                        </button>
                      </Tooltip>
                    </span>
                  ))}
                </div>
              ) : (
                <span className={styles.noTags}>No tags</span>
              )}

              {showTagMgr && (
                <div className={styles.tagMgr}>
                  <div className={styles.tagMgrCreateRow}>
                    <input
                      className={styles.inlineInput}
                      placeholder="New tag name"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createTag(); } }}
                      style={{ flex: 1 }}
                    />
                    <input
                      type="color"
                      className={styles.tagMgrColorInput}
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      aria-label="Tag color"
                    />
                    <button className={styles.sidePanelAction} onClick={createTag} disabled={!newTagName.trim() || creatingTag}>
                      {creatingTag ? '...' : 'Create'}
                    </button>
                  </div>
                  {allTags.length > 0 ? (
                    <div className={styles.tagMgrList}>
                      {allTags.map((tag) => (
                        <div key={tag.id} className={styles.tagMgrItem}>
                          <div className={styles.tagMgrInfo}>
                            <span className={styles.tagMgrDot} style={{ background: tag.color }} />
                            <span>{tag.name}</span>
                          </div>
                          <div className={styles.tagMgrActions}>
                            <button
                              className={styles.sidePanelAction}
                              onClick={() => addTag(tag.id)}
                              disabled={tagIds.has(tag.id)}
                            >
                              {tagIds.has(tag.id) ? 'Added' : 'Add'}
                            </button>
                            <Tooltip label="Delete tag">
                              <button
                                className={styles.tagMgrDelete}
                                onClick={() => deleteTag(tag.id)}
                                disabled={deletingTagId === tag.id}
                                aria-label="Delete tag"
                              >
                                <Trash2 size={11} />
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.tagMgrEmpty}>No tags yet. Create one above.</div>
                  )}
                  <button
                    className={styles.sidePanelAction}
                    onClick={() => setShowTagMgr(false)}
                    style={{ alignSelf: 'flex-end' }}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Linked Cards */}
          <div className={styles.sidePanel}>
            <div className={styles.sidePanelHeader}>
              <span className={styles.sidePanelTitle}>Linked Cards</span>
              <button className={styles.sidePanelAction} onClick={() => setShowLinkSearch(!showLinkSearch)}>
                <Link2 size={11} /> Link
              </button>
            </div>
            <div className={styles.sidePanelBody}>
              {card.linkedCards.length > 0 ? (
                card.linkedCards.map((lc) => (
                  <div key={lc.linkId} className={styles.linkRow}>
                    <FileText size={13} className={styles.linkIcon} />
                    <Link to={`/cards/${lc.id}`} className={styles.linkName}>{lc.name}</Link>
                    <Tooltip label="Remove">
                      <button className={styles.linkRemove} onClick={() => unlinkCard(lc.linkId)} aria-label="Remove">
                        <X size={11} />
                      </button>
                    </Tooltip>
                  </div>
                ))
              ) : (
                <span className={styles.panelEmpty}>No linked cards</span>
              )}
              {showLinkSearch && (
                <div className={styles.inlineDropdown}>
                  <input
                    className={styles.inlineInput}
                    placeholder="Search cards..."
                    value={linkTerm}
                    onChange={(e) => searchCards(e.target.value)}
                    autoFocus
                  />
                  {linkResults.length > 0 && (
                    <div className={styles.resultsList}>
                      {linkResults.map((c) => (
                        <button key={c.id} className={styles.resultItem} onClick={() => linkCard(c.id)}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {linkTerm.length >= 2 && linkResults.length === 0 && (
                    <div className={styles.resultsEmpty}>No cards found</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Custom Fields */}
          {cfEntries.length > 0 && (
            <div className={styles.sidePanel}>
              <div className={styles.sidePanelHeader}>
                <span className={styles.sidePanelTitle}>Custom Fields</span>
              </div>
              <div className={styles.sidePanelBody}>
                {cfEntries.map(([key, value]) => (
                  <div key={key} className={styles.fieldRow}>
                    <span className={styles.fieldKey}>{key}</span>
                    <span className={styles.fieldVal}>{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
