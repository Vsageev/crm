import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, Trash2 } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { clearPreferredBoardId, setPreferredBoardId } from '../../lib/navigation-preferences';
import styles from './BoardPage.module.css';

interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  color: string;
  position: number;
}

interface CardTag {
  id: string;
  name: string;
  color: string;
}

interface CardAssignee {
  id: string;
  firstName: string;
  lastName: string;
}

interface CardData {
  id: string;
  name: string;
  description: string | null;
  folderId: string;
  assignee: CardAssignee | null;
  tags: CardTag[];
}

interface BoardCardEntry {
  id: string;
  boardId: string;
  cardId: string;
  columnId: string;
  position: number;
  card: CardData | null;
}

interface BoardWithCards {
  id: string;
  name: string;
  description: string | null;
  isGeneral?: boolean;
  columns: BoardColumn[];
  cards: BoardCardEntry[];
}

interface Folder {
  id: string;
  name: string;
}

interface FoldersResponse {
  entries: Folder[];
}

function isGeneralBoard(board: BoardWithCards): boolean {
  if (board.isGeneral === true) return true;
  const normalizedName = board.name.trim().toLowerCase();
  return normalizedName === 'general' || normalizedName === 'general board';
}

export function BoardPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [board, setBoard] = useState<BoardWithCards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddCard, setShowAddCard] = useState<string | null>(null);
  const [newCardName, setNewCardName] = useState('');
  const [newCardDesc, setNewCardDesc] = useState('');
  const [addingCard, setAddingCard] = useState(false);
  const [deletingBoard, setDeletingBoard] = useState(false);
  const dragCardRef = useRef<BoardCardEntry | null>(null);

  const fetchBoard = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api<BoardWithCards>(`/boards/${id}`);
      setBoard(data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load board');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  useEffect(() => {
    if (!id) return;
    setPreferredBoardId(id);
  }, [id]);

  const sortedColumns = useMemo(
    () => (board ? [...board.columns].sort((a, b) => a.position - b.position) : []),
    [board],
  );

  const shouldOpenCreateCard = searchParams.get('newCard') === '1';

  useEffect(() => {
    if (!shouldOpenCreateCard || sortedColumns.length === 0) return;
    setShowAddCard(sortedColumns[0].id);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('newCard');
    setSearchParams(nextParams, { replace: true });
  }, [shouldOpenCreateCard, sortedColumns, searchParams, setSearchParams]);

  const cardsByColumn = useMemo(() => {
    if (!board) return new Map<string, BoardCardEntry[]>();
    const map = new Map<string, BoardCardEntry[]>();
    for (const bc of board.cards) {
      const arr = map.get(bc.columnId);
      if (arr) arr.push(bc);
      else map.set(bc.columnId, [bc]);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [board]);

  function handleDragStart(e: React.DragEvent, boardCard: BoardCardEntry) {
    dragCardRef.current = boardCard;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', boardCard.cardId);
    requestAnimationFrame(() => {
      (e.currentTarget as HTMLElement).classList.add(styles.dragging);
    });
  }

  function handleDragEnd(e: React.DragEvent) {
    dragCardRef.current = null;
    (e.currentTarget as HTMLElement).classList.remove(styles.dragging);
  }

  async function handleDrop(e: React.DragEvent, targetColumnId: string) {
    e.preventDefault();
    const bc = dragCardRef.current;
    if (!bc || !board) return;
    if (bc.columnId === targetColumnId) return;

    // Optimistic update
    const prevBoard = { ...board, cards: [...board.cards] };
    setBoard({
      ...board,
      cards: board.cards.map((c) =>
        c.cardId === bc.cardId ? { ...c, columnId: targetColumnId } : c,
      ),
    });

    try {
      await api(`/boards/${board.id}/cards/${bc.cardId}`, {
        method: 'PATCH',
        body: JSON.stringify({ columnId: targetColumnId }),
      });
    } catch (err) {
      setBoard(prevBoard);
      if (err instanceof ApiError) setError(err.message);
    }
  }

  function closeAddCardModal() {
    setShowAddCard(null);
    setNewCardName('');
    setNewCardDesc('');
  }

  async function handleAddCard() {
    if (!newCardName.trim() || !showAddCard || !board) return;
    setAddingCard(true);
    try {
      // Ensure a folder exists — create a default one if needed
      const foldersRes = await api<FoldersResponse>('/folders');
      let folderId: string;
      if (foldersRes.entries.length === 0) {
        const folder = await api<Folder>('/folders', {
          method: 'POST',
          body: JSON.stringify({ name: 'General' }),
        });
        folderId = folder.id;
      } else {
        folderId = foldersRes.entries[0].id;
      }

      // Create the card
      const card = await api<CardData>('/cards', {
        method: 'POST',
        body: JSON.stringify({
          folderId,
          name: newCardName.trim(),
          description: newCardDesc.trim() || null,
        }),
      });

      // Add it to the board column
      await api(`/boards/${board.id}/cards`, {
        method: 'POST',
        body: JSON.stringify({ cardId: card.id, columnId: showAddCard }),
      });

      closeAddCardModal();
      fetchBoard();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setAddingCard(false);
    }
  }

  async function handleDeleteBoard() {
    if (!board || isGeneralBoard(board)) return;

    const confirmed = window.confirm(`Delete board "${board.name}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingBoard(true);
    try {
      await api(`/boards/${board.id}`, { method: 'DELETE' });
      clearPreferredBoardId();
      navigate('/boards?list=1', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to delete board');
    } finally {
      setDeletingBoard(false);
    }
  }

  if (loading) return <div className={styles.loadingState}>Loading board...</div>;
  if (!board) return <div className={styles.emptyState}>{error || 'Board not found'}</div>;

  return (
    <div className={styles.wrapper}>
      <Link to="/boards?list=1" className={styles.backLink}>
        <ArrowLeft size={14} />
        All Boards
      </Link>

      <PageHeader
        title={board.name}
        description={board.description || 'Kanban board'}
        actions={
          !isGeneralBoard(board) ? (
            <Button variant="secondary" onClick={() => { void handleDeleteBoard(); }} disabled={deletingBoard}>
              <Trash2 size={14} />
              {deletingBoard ? 'Deleting...' : 'Delete Board'}
            </Button>
          ) : undefined
        }
      />

      <div className={styles.toolbar}>
        <div className={styles.summary}>
          <span>{board.cards.length} card{board.cards.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {error && <div className={styles.alert}>{error}</div>}

      <div className={styles.board}>
        {sortedColumns.map((col) => {
          const colCards = cardsByColumn.get(col.id) || [];
          return (
            <Column
              key={col.id}
              column={col}
              cards={colCards}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              onAddCard={() => setShowAddCard(col.id)}
            />
          );
        })}
      </div>

      {showAddCard && (
        <div className={styles.overlay} onClick={closeAddCardModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Card</div>
            <div className={styles.field}>
              <label className={styles.labelText}>Name</label>
              <input
                className={styles.input}
                value={newCardName}
                onChange={(e) => setNewCardName(e.target.value)}
                placeholder="Card name"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddCard()}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.labelText}>Description (optional)</label>
              <textarea
                className={styles.textarea}
                value={newCardDesc}
                onChange={(e) => setNewCardDesc(e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div className={styles.modalActions}>
              <Button variant="ghost" onClick={closeAddCardModal}>Cancel</Button>
              <Button onClick={handleAddCard} disabled={addingCard || !newCardName.trim()}>
                {addingCard ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ColumnProps {
  column: BoardColumn;
  cards: BoardCardEntry[];
  onDragStart: (e: React.DragEvent, bc: BoardCardEntry) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  onAddCard: () => void;
}

function Column({ column, cards, onDragStart, onDragEnd, onDrop, onAddCard }: ColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    onDrop(e, column.id);
  }

  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <span className={styles.columnColor} style={{ background: column.color }} />
        <span className={styles.columnName}>{column.name}</span>
        <span className={styles.cardCount}>{cards.length}</span>
      </div>

      <div
        className={[styles.cardList, isDragOver ? styles.dragOver : ''].filter(Boolean).join(' ')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {cards.length === 0 ? (
          <div className={styles.emptyColumn}>No cards</div>
        ) : (
          cards.map((bc) => (
            <Link
              key={bc.id}
              to={`/cards/${bc.cardId}`}
              className={styles.card}
              draggable
              onDragStart={(e) => onDragStart(e, bc)}
              onDragEnd={onDragEnd}
            >
              {bc.card?.tags && bc.card.tags.length > 0 && (
                <div className={styles.cardTags}>
                  {bc.card.tags.slice(0, 3).map((tag: CardTag) => (
                    <span
                      key={tag.id}
                      className={styles.cardTag}
                      style={{ background: tag.color }}
                      title={tag.name}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {bc.card.tags.length > 3 && (
                    <span className={styles.cardTagMore}>+{bc.card.tags.length - 3}</span>
                  )}
                </div>
              )}
              <div className={styles.cardTitle}>{bc.card?.name ?? 'Unknown card'}</div>
              {bc.card?.description && (
                <div className={styles.cardDesc}>{bc.card.description}</div>
              )}
              {bc.card?.assignee && (
                <div className={styles.cardFooter}>
                  <div className={styles.cardAssignee}>
                    <span className={styles.cardAssigneeName}>
                      {bc.card.assignee.firstName} {bc.card.assignee.lastName}
                    </span>
                    <div className={styles.cardAvatar} title={`${bc.card.assignee.firstName} ${bc.card.assignee.lastName}`}>
                      {bc.card.assignee.firstName[0]}{bc.card.assignee.lastName[0]}
                    </div>
                  </div>
                </div>
              )}
            </Link>
          ))
        )}
      </div>

      <button className={styles.addCardBtn} onClick={onAddCard}>
        <Plus size={14} />
        Add card
      </button>
    </div>
  );
}
