import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HardDrive,
  Folder,
  File,
  Upload,
  FolderPlus,
  Trash2,
  Download,
  ChevronRight,
  CornerLeftUp,
  Eye,
  FileText,
  Image,
} from 'lucide-react';
import { PageHeader } from '../layout';
import { Button, Input, Tooltip } from '../ui';
import { api, apiUpload, ApiError } from '../lib/api';
import { formatFileSize, formatFileDate, isTextPreviewable, isImagePreviewable, isPreviewable } from '../lib/file-utils';
import { FilePreviewModal } from '../components/FilePreviewModal';
import styles from './StoragePage.module.css';

interface StorageEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  mimeType: string | null;
  createdAt: string;
}

function getFileIcon(entry: StorageEntry) {
  if (isImagePreviewable(entry.name)) return <Image size={18} className={styles.iconFile} />;
  if (isTextPreviewable(entry.name)) return <FileText size={18} className={styles.iconFile} />;
  return <File size={18} className={styles.iconFile} />;
}

export function StoragePage() {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // New folder
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Delete confirmation
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Preview
  const [previewEntry, setPreviewEntry] = useState<StorageEntry | null>(null);

  // Upload / drag-and-drop
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const fetchEntries = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ entries: StorageEntry[] }>(
        `/storage?path=${encodeURIComponent(dirPath)}`,
      );
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load storage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries(currentPath);
  }, [currentPath, fetchEntries]);

  function navigateTo(dirPath: string) {
    setCurrentPath(dirPath);
    setShowNewFolder(false);
    setDeletingPath(null);
  }

  // Breadcrumb segments
  const pathSegments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  async function handleCreateFolder() {
    if (!folderName.trim()) return;
    setCreatingFolder(true);
    setError('');
    try {
      await api('/storage/folders', {
        method: 'POST',
        body: JSON.stringify({ path: currentPath, name: folderName.trim() }),
      });
      setShowNewFolder(false);
      setFolderName('');
      setSuccess('Folder created');
      await fetchEntries(currentPath);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  }

  async function uploadFile(file: globalThis.File) {
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('path', currentPath);
      formData.append('file', file);
      await apiUpload('/storage/upload', formData);
      setSuccess('File uploaded');
      await fetchEntries(currentPath);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }

  // Main area drag-and-drop (uploads to current path)
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOver(false);
    }
  }

  async function handleDelete(itemPath: string) {
    setDeleteLoading(true);
    setError('');
    try {
      await api(`/storage?path=${encodeURIComponent(itemPath)}`, { method: 'DELETE' });
      setDeletingPath(null);
      setSuccess('Item deleted');
      await fetchEntries(currentPath);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete item');
    } finally {
      setDeleteLoading(false);
    }
  }

  function handleDownload(filePath: string) {
    const token = localStorage.getItem('ws_access_token');
    const url = `/api/storage/download?path=${encodeURIComponent(filePath)}`;
    const a = document.createElement('a');
    // Use fetch to handle auth
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = filePath.split('/').pop() || 'file';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(objUrl);
        a.remove();
      })
      .catch(() => setError('Failed to download file'));
  }

  function handleEntryClick(entry: StorageEntry) {
    if (entry.type === 'folder') {
      navigateTo(entry.path);
    } else if (entry.type === 'file' && isPreviewable(entry.name)) {
      setPreviewEntry(entry);
    } else {
      handleDownload(entry.path);
    }
  }

  // Sort: folders first, then files, alphabetically
  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parentPath = currentPath === '/'
    ? null
    : '/' + currentPath.split('/').filter(Boolean).slice(0, -1).join('/');

  return (
    <>
      <PageHeader
        title="Storage"
        description="Browse, upload, and manage files"
      />
      <input
        ref={fileInputRef}
        type="file"
        className={styles.hiddenInput}
        onChange={handleUpload}
      />

      {/* Breadcrumb */}
      <nav className={styles.breadcrumb}>
        <button
          className={`${styles.breadcrumbItem} ${currentPath === '/' ? styles.breadcrumbActive : ''}`}
          onClick={() => navigateTo('/')}
        >
          <HardDrive size={14} />
          Storage
        </button>
        {pathSegments.map((segment, i) => {
          const segPath = '/' + pathSegments.slice(0, i + 1).join('/');
          const isLast = i === pathSegments.length - 1;
          return (
            <span key={segPath} className={styles.breadcrumbSep}>
              <ChevronRight size={14} />
              <button
                className={`${styles.breadcrumbItem} ${isLast ? styles.breadcrumbActive : ''}`}
                onClick={() => navigateTo(segPath)}
              >
                {segment}
              </button>
            </span>
          );
        })}
      </nav>

      {success && <div className={styles.success}>{success}</div>}
      {error && <div className={styles.alert}>{error}</div>}

      {/* File list */}
      {loading ? (
        <div className={styles.loadingState}>Loading...</div>
      ) : (
        <div className={styles.fileList}>
          <div className={styles.fileHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colSize}>Size</span>
            <span className={styles.colDate}>Modified</span>
            <span className={styles.colActions}>
              <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload size={14} />
                {uploading ? 'Uploading...' : 'Upload'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowNewFolder(!showNewFolder);
                  setFolderName('');
                }}
              >
                <FolderPlus size={14} />
                Folder
              </Button>
            </span>
          </div>
          {showNewFolder && (
            <div className={styles.newFolderRow}>
              <div className={styles.newFolderIcon}>
                <Folder size={18} className={styles.iconFolder} />
              </div>
              <Input
                label=""
                placeholder="Folder name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') setShowNewFolder(false);
                }}
              />
              <Button size="sm" onClick={handleCreateFolder} disabled={creatingFolder || !folderName.trim()}>
                {creatingFolder ? 'Creating...' : 'Create'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(false)}>
                Cancel
              </Button>
            </div>
          )}
          {parentPath !== null && (
            <div className={styles.fileRow}>
              <button className={styles.colName} onClick={() => navigateTo(parentPath === '/' ? '/' : parentPath)}>
                <CornerLeftUp size={18} className={styles.iconFile} />
                <span className={styles.fileName}>..</span>
              </button>
              <span className={styles.colSize}>—</span>
              <span className={styles.colDate}>—</span>
              <span className={styles.colActions} />
            </div>
          )}
          {sorted.length === 0 ? (
            <div
              className={`${styles.emptyState} ${dragOver ? styles.emptyStateDragOver : ''}`}
              onDrop={handleDrop}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload size={32} strokeWidth={1.5} />
              <p>Drop files here or use the upload button</p>
            </div>
          ) : (
            <div
              className={`${styles.dropTarget} ${dragOver ? styles.dropTargetActive : ''}`}
              onDrop={handleDrop}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {sorted.map((entry) => (
                <div
                  key={entry.path}
                  className={styles.fileRow}
                >
                  <button className={styles.colName} onClick={() => handleEntryClick(entry)}>
                    {entry.type === 'folder' ? (
                      <Folder size={18} className={styles.iconFolder} />
                    ) : (
                      getFileIcon(entry)
                    )}
                    <span className={styles.fileName}>{entry.name}</span>
                  </button>
                  <span className={styles.colSize}>{entry.type === 'file' ? formatFileSize(entry.size) : '—'}</span>
                  <span className={styles.colDate}>{formatFileDate(entry.createdAt)}</span>
                  <span className={styles.colActions}>
                    {entry.type === 'file' && isPreviewable(entry.name) && (
                      <Tooltip label="Preview">
                        <button
                          className={styles.iconBtn}
                          onClick={() => setPreviewEntry(entry)}
                          aria-label="Preview"
                        >
                          <Eye size={16} />
                        </button>
                      </Tooltip>
                    )}
                    {entry.type === 'file' && (
                      <Tooltip label="Download">
                        <button
                          className={styles.iconBtn}
                          onClick={() => handleDownload(entry.path)}
                          aria-label="Download"
                        >
                          <Download size={16} />
                        </button>
                      </Tooltip>
                    )}
                    {deletingPath === entry.path ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setDeletingPath(null)}
                          disabled={deleteLoading}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleDelete(entry.path)}
                          disabled={deleteLoading}
                        >
                          {deleteLoading ? 'Deleting...' : 'Confirm'}
                        </Button>
                      </>
                    ) : (
                      <Tooltip label="Delete">
                        <button
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => setDeletingPath(entry.path)}
                          aria-label="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </Tooltip>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {previewEntry && (
        <FilePreviewModal
          fileName={previewEntry.name}
          downloadUrl={`/api/storage/download?path=${encodeURIComponent(previewEntry.path)}`}
          onClose={() => setPreviewEntry(null)}
          onDownload={() => handleDownload(previewEntry.path)}
        />
      )}
    </>
  );
}
