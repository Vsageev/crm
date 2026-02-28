import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Trash2, Plus, X, Link2,
  FileText, User, Send, Check, Pencil,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { Button, PageLoader } from '../../ui';
import { api, ApiError } from '../../lib/api';
import styles from './CardDetailPage.module.css';

/* ── Types ────────────────────────────────────────────── */

interface Tag { id: string; name: string; color: string }
interface Assignee { id: string; firstName: string; lastName: string }
interface LinkedCard { linkId: string; id: string; name: string; folderId: string }

interface CardDetail {
  id: string;
  folderId: string;
  name: string;
  description: string | null;
  customFields: Record<string, unknown>;
  assigneeId: string | null;
  assignee: Assignee | null;
  position: number;
  tags: Tag[];
  linkedCards: LinkedCard[];
  createdAt: string;
  updatedAt: string;
}

interface CardComment {
  id: string;
  cardId: string;
  authorId: string;
  content: string;
  author: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface UserEntry { id: string; firstName: string; lastName: string }

function ini(f: string, l: string) {
  return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase();
}

/* ── Component ────────────────────────────────────────── */

export function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
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
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  /* ── Card actions ───────────────────────────────────── */

  async function handleDelete() {
    if (!card || !confirm('Delete this card?')) return;
    try {
      await api(`/cards/${card.id}`, { method: 'DELETE' });
      navigate(`/folders/${card.folderId}`);
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  /* ── Tag actions ────────────────────────────────────── */

  function openTagMgr() { setShowTagMgr(true); fetchTags(); }

  async function addTag(tagId: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/tags`, { method: 'POST', body: JSON.stringify({ tagId }) });
      fetchCard(); fetchTags();
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  async function removeTag(tagId: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/tags/${tagId}`, { method: 'DELETE' });
      fetchCard();
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) return;
    setCreatingTag(true);
    try {
      const t = await api<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name, color: newTagColor }) });
      setNewTagName('');
      await addTag(t.id);
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
    finally { setCreatingTag(false); }
  }

  async function deleteTag(tagId: string) {
    if (!confirm('Delete this tag from the workspace?')) return;
    setDeletingTagId(tagId);
    try {
      await api(`/tags/${tagId}`, { method: 'DELETE' });
      fetchCard(); fetchTags();
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
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
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  async function unlinkCard(linkId: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/links/${linkId}`, { method: 'DELETE' });
      fetchCard();
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  /* ── Comment actions ────────────────────────────────── */

  async function addComment() {
    if (!card || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      await api(`/cards/${card.id}/comments`, { method: 'POST', body: JSON.stringify({ content: newComment.trim() }) });
      setNewComment(''); fetchComments();
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
    finally { setSubmittingComment(false); }
  }

  async function deleteComment(cid: string) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}/comments/${cid}`, { method: 'DELETE' });
      fetchComments();
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  /* ── Assignee actions ───────────────────────────────── */

  async function openAssignee() {
    setShowAssignee(true);
    try {
      const d = await api<{ entries: UserEntry[] }>('/users');
      setUsers(d.entries);
    } catch { /* ignore */ }
  }

  async function assign(uid: string | null) {
    if (!card) return;
    try {
      await api(`/cards/${card.id}`, { method: 'PATCH', body: JSON.stringify({ assigneeId: uid }) });
      setShowAssignee(false); fetchCard();
    } catch (e) { if (e instanceof ApiError) alert(e.message); }
  }

  /* ── Render ─────────────────────────────────────────── */

  if (loading) return <PageLoader />;
  if (!card) return <div className={styles.emptyState}>Card not found</div>;

  const cfEntries = Object.entries(card.customFields || {});
  const tagIds = new Set(card.tags.map((t) => t.id));

  return (
    <div className={styles.page}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <Link to={`/folders/${card.folderId}`} className={styles.backLink}>
          <ArrowLeft size={14} />
          Back to Collection
        </Link>
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
                <div className={`${styles.descriptionDisplay} ${styles.markdown}`} onClick={startEditDesc}>
                  <Markdown>{card.description}</Markdown>
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
                      <div className={`${styles.avatar} ${styles.avatarLg}`}>
                        {c.author ? ini(c.author.firstName, c.author.lastName) : '??'}
                      </div>
                      <div className={styles.commentBody}>
                        <div className={styles.commentMeta}>
                          <span className={styles.commentAuthor}>
                            {c.author ? `${c.author.firstName} ${c.author.lastName}` : 'Unknown'}
                          </span>
                          <span className={styles.commentTime}>
                            {new Date(c.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className={styles.commentText}>{c.content}</div>
                      </div>
                      <button className={styles.commentX} onClick={() => deleteComment(c.id)} title="Delete">
                        <X size={11} />
                      </button>
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
                <button
                  className={styles.commentSend}
                  onClick={addComment}
                  disabled={!newComment.trim() || submittingComment}
                  title="Send"
                >
                  <Send size={14} />
                </button>
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
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Assignee</span>
                {card.assignee ? (
                  <div className={styles.assigneeRow} onClick={openAssignee} style={{ cursor: 'pointer' }}>
                    <div className={styles.avatar}>
                      {ini(card.assignee.firstName, card.assignee.lastName)}
                    </div>
                    <span className={styles.detailValue}>
                      {card.assignee.firstName} {card.assignee.lastName}
                    </span>
                  </div>
                ) : (
                  <button className={styles.assignBtn} onClick={openAssignee}>
                    <User size={11} /> Assign
                  </button>
                )}
                {showAssignee && (
                  <div className={styles.assigneePicker}>
                    {card.assignee && (
                      <button className={styles.resultItem} onClick={() => assign(null)}>
                        Unassign
                      </button>
                    )}
                    {users.map((u) => (
                      <button key={u.id} className={styles.resultItem} onClick={() => assign(u.id)}>
                        {u.firstName} {u.lastName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

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
                      <button className={styles.tagX} onClick={() => removeTag(tag.id)} title="Remove">
                        <X size={7} />
                      </button>
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
                            <button
                              className={styles.tagMgrDelete}
                              onClick={() => deleteTag(tag.id)}
                              disabled={deletingTagId === tag.id}
                              title="Delete tag"
                            >
                              <Trash2 size={11} />
                            </button>
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
                    <button className={styles.linkRemove} onClick={() => unlinkCard(lc.linkId)} title="Remove">
                      <X size={11} />
                    </button>
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
