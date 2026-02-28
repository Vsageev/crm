import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, FolderOpen, Trash2 } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button } from '../../ui';
import { api, ApiError } from '../../lib/api';
import {
  clearPreferredFolderId,
  getPreferredFolderId,
  setPreferredFolderId,
} from '../../lib/navigation-preferences';
import styles from './FoldersListPage.module.css';

interface Folder {
  id: string;
  name: string;
  description: string | null;
  isGeneral?: boolean;
  createdAt: string;
}

interface FoldersResponse {
  total: number;
  entries: Folder[];
}

function isGeneralCollection(folder: Folder): boolean {
  if (folder.isGeneral === true) return true;
  return folder.name.trim().toLowerCase() === 'general';
}

export function FoldersListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [provisioningStarter, setProvisioningStarter] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await api<FoldersResponse>(`/folders${params}`);
      setFolders(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setFolders([]);
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to load collections');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const createDefaultFolder = useCallback(async () => {
    setProvisioningStarter(true);
    try {
      await api('/folders', {
        method: 'POST',
        body: JSON.stringify({
          name: 'General',
          description: 'Default collection',
        }),
      });
      await fetchFolders();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Failed to prepare starter collection');
    } finally {
      setProvisioningStarter(false);
    }
  }, [fetchFolders]);

  useEffect(() => {
    if (search || loading || provisioningStarter || error || folders.length > 0) return;
    void createDefaultFolder();
  }, [search, loading, provisioningStarter, error, folders.length, createDefaultFolder]);

  useEffect(() => {
    const forceList = searchParams.get('list') === '1';
    if (forceList || search || loading || provisioningStarter || error || folders.length === 0) return;

    const preferredFolderId = getPreferredFolderId();
    const targetFolderId =
      preferredFolderId && folders.some((folder) => folder.id === preferredFolderId)
        ? preferredFolderId
        : folders[0].id;

    navigate(`/folders/${targetFolderId}`, { replace: true });
  }, [searchParams, search, loading, provisioningStarter, error, folders, navigate]);

  async function handleCreate() {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await api('/folders', {
        method: 'POST',
        body: JSON.stringify({
          name: createName.trim(),
          description: createDesc.trim() || null,
        }),
      });
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
      fetchFolders();
    } catch (err) {
      if (err instanceof ApiError) alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteCollection(folder: Folder) {
    if (isGeneralCollection(folder)) return;

    const confirmed = window.confirm(`Delete collection "${folder.name}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingFolderId(folder.id);
    try {
      await api(`/folders/${folder.id}`, { method: 'DELETE' });
      setFolders((prev) => {
        const remainingFolders = prev.filter((item) => item.id !== folder.id);
        if (getPreferredFolderId() === folder.id) {
          if (remainingFolders.length > 0) setPreferredFolderId(remainingFolders[0].id);
          else clearPreferredFolderId();
        }
        return remainingFolders;
      });
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
      } else {
        alert('Failed to delete collection');
      }
    } finally {
      setDeletingFolderId(null);
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Collections"
        description="Organize your cards into collections"
        actions={
          <Button size="md" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            New Collection
          </Button>
        }
      />

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="Search collections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading || provisioningStarter ? (
        <div className={styles.loadingState}>
          {provisioningStarter ? 'Preparing your collection...' : 'Loading collections...'}
        </div>
      ) : error ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <FolderOpen size={48} strokeWidth={1.2} />
          </div>
          <h3 className={styles.emptyTitle}>Unable to load collections</h3>
          <p className={styles.emptyDescription}>{error}</p>
          <Button variant="ghost" onClick={fetchFolders}>Try again</Button>
        </div>
      ) : folders.length === 0 && search ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <FolderOpen size={48} strokeWidth={1.2} />
          </div>
          <h3 className={styles.emptyTitle}>No collections found</h3>
          <p className={styles.emptyDescription}>
            No collections match &ldquo;{search}&rdquo;. Try a different search term.
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {folders.map((folder) => (
            <article key={folder.id} className={styles.folderCard}>
              <Link to={`/folders/${folder.id}`} className={styles.folderLink}>
                <div className={styles.folderName}>{folder.name}</div>
                {folder.description && (
                  <div className={styles.folderDescription}>{folder.description}</div>
                )}
                <div className={styles.folderMeta}>
                  Created {new Date(folder.createdAt).toLocaleDateString()}
                </div>
              </Link>
              <div className={styles.cardActions}>
                {isGeneralCollection(folder) ? (
                  <span className={styles.generalBadge}>General</span>
                ) : (
                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => { void handleDeleteCollection(folder); }}
                    disabled={deletingFolderId === folder.id}
                    aria-label={`Delete ${folder.name}`}
                  >
                    <Trash2 size={14} />
                    {deletingFolderId === folder.id ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreate && (
        <div className={styles.overlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>New Collection</div>
            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input
                className={styles.input}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Collection name"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Description (optional)</label>
              <input
                className={styles.input}
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div className={styles.modalActions}>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
