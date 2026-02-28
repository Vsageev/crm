import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, FileText, Trash2, User } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { clearPreferredFolderId, setPreferredFolderId } from '../../lib/navigation-preferences';
import styles from './FolderDetailPage.module.css';

interface CardTag {
  id: string;
  name: string;
  color: string;
}

interface Card {
  id: string;
  name: string;
  description: string | null;
  assigneeId: string | null;
  assignee: { id: string; firstName: string; lastName: string } | null;
  tags: CardTag[];
  createdAt: string;
  updatedAt: string;
}

interface Folder {
  id: string;
  name: string;
  description: string | null;
  isGeneral?: boolean;
}

interface CardsResponse {
  total: number;
  entries: Card[];
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isGeneralCollection(folder: Folder): boolean {
  if (folder.isGeneral === true) return true;
  return folder.name.trim().toLowerCase() === 'general';
}

export function FolderDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingCollection, setDeletingCollection] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [folderData, cardsData] = await Promise.all([
        api<Folder>(`/folders/${id}`),
        api<CardsResponse>(
          `/folders/${id}/cards${search ? `?search=${encodeURIComponent(search)}` : ''}`,
        ),
      ]);
      setFolder(folderData);
      setCards(cardsData.entries);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, [id, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!id) return;
    setPreferredFolderId(id);
  }, [id]);

  const shouldOpenCreateCard = searchParams.get('newCard') === '1';

  useEffect(() => {
    if (!shouldOpenCreateCard) return;
    setShowCreate(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('newCard');
    setSearchParams(nextParams, { replace: true });
  }, [shouldOpenCreateCard, searchParams, setSearchParams]);

  async function handleCreateCard() {
    if (!createName.trim() || !id) return;
    setCreating(true);
    try {
      await api('/cards', {
        method: 'POST',
        body: JSON.stringify({
          folderId: id,
          name: createName.trim(),
          description: createDesc.trim() || null,
        }),
      });
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
      fetchData();
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteCollection() {
    if (!folder || isGeneralCollection(folder)) return;

    const confirmed = window.confirm(`Delete collection "${folder.name}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingCollection(true);
    try {
      await api(`/folders/${folder.id}`, { method: 'DELETE' });
      clearPreferredFolderId();
      navigate('/folders?list=1', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
      } else {
        alert('Failed to delete collection');
      }
    } finally {
      setDeletingCollection(false);
    }
  }

  if (loading) {
    return <div className={styles.loadingState}>Loading...</div>;
  }

  if (!folder) {
    return <div className={styles.emptyState}>Collection not found</div>;
  }

  return (
    <div className={styles.page}>
      <Link to="/folders?list=1" className={styles.backLink}>
        <ArrowLeft size={14} />
        All Collections
      </Link>

      <PageHeader
        title={folder.name}
        description={folder.description || 'Cards in this collection'}
        actions={
          <div className={styles.headerActions}>
            {!isGeneralCollection(folder) && (
              <Button
                variant="secondary"
                onClick={() => { void handleDeleteCollection(); }}
                disabled={deletingCollection}
              >
                <Trash2 size={14} />
                {deletingCollection ? 'Deleting...' : 'Delete Collection'}
              </Button>
            )}
            <Button size="md" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              New Card
            </Button>
          </div>
        }
      />

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="Search cards..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className={styles.cardCount}>
          {cards.length} card{cards.length !== 1 ? 's' : ''}
        </span>
      </div>

      {cards.length === 0 && search ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <FileText size={48} strokeWidth={1.2} />
          </div>
          <h3 className={styles.emptyTitle}>No cards found</h3>
          <p className={styles.emptyDescription}>
            No cards match &ldquo;{search}&rdquo;. Try a different search term.
          </p>
        </div>
      ) : cards.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <FileText size={48} strokeWidth={1.2} />
          </div>
          <h3 className={styles.emptyTitle}>This collection is empty</h3>
          <p className={styles.emptyDescription}>
            Cards you create here will appear in this collection.
            Add your first card to start building out this collection.
          </p>
          <Button size="md" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            Add Card
          </Button>
        </div>
      ) : (
        <div className={styles.cardsList}>
          {cards.map((card) => {
            const timeAgo = formatTimeAgo(card.updatedAt ?? card.createdAt);
            return (
              <Link key={card.id} to={`/cards/${card.id}`} className={styles.cardItem}>
                <div className={styles.cardBody}>
                  <div className={styles.cardName}>{card.name}</div>
                  {card.description && (
                    <div className={styles.cardDescription}>{card.description}</div>
                  )}
                </div>
                <div className={styles.cardFooter}>
                  <div className={styles.cardFooterLeft}>
                    {card.tags?.length > 0 && (
                      <div className={styles.cardTags}>
                        {card.tags.slice(0, 3).map((tag) => (
                          <span key={tag.id} className={styles.cardTag} style={{ background: tag.color }}>
                            {tag.name}
                          </span>
                        ))}
                        {card.tags.length > 3 && (
                          <span className={styles.cardTagMore}>+{card.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={styles.cardFooterRight}>
                    <span className={styles.cardMeta}>{timeAgo}</span>
                    {card.assignee ? (
                      <div className={styles.cardAssignee} title={`${card.assignee.firstName} ${card.assignee.lastName}`}>
                        {card.assignee.firstName[0]}{card.assignee.lastName[0]}
                      </div>
                    ) : (
                      <div className={styles.cardAssigneeEmpty} title="Unassigned">
                        <User size={12} />
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <div className={styles.overlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Card</div>
            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input
                className={styles.input}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Card name"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCard()}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Description (optional)</label>
              <textarea
                className={styles.textarea}
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Card description"
              />
            </div>
            <div className={styles.modalActions}>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreateCard} disabled={creating || !createName.trim()}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
