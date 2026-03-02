import { useCallback, useEffect, useState } from 'react';
import { Folder, File, ChevronRight, CornerLeftUp, HardDrive, X, Check } from 'lucide-react';
import { Button, Tooltip } from '../ui';
import { api, ApiError } from '../lib/api';
import styles from './FileSystemBrowserModal.module.css';

interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
}

interface FileSystemBrowserModalProps {
  onSelect: (targetPath: string) => void;
  onClose: () => void;
}

export function FileSystemBrowserModal({ onSelect, onClose }: FileSystemBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const fetchEntries = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const data = await api<{ path: string; entries: FsEntry[] }>(
        `/storage/browse-fs?path=${encodeURIComponent(dirPath)}`,
      );
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to browse filesystem');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries(currentPath);
  }, [currentPath, fetchEntries]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const pathSegments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  const parentPath =
    currentPath === '/'
      ? null
      : '/' + currentPath.split('/').filter(Boolean).slice(0, -1).join('/') || '/';

  function handleEntryClick(entry: FsEntry) {
    if (entry.type === 'folder') {
      setCurrentPath(entry.path);
    } else {
      setSelected(entry.path === selected ? null : entry.path);
    }
  }

  function handleSelectCurrent() {
    onSelect(selected ?? currentPath);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Select file or folder</span>
          <Tooltip label="Close">
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </Tooltip>
        </div>

        {/* Breadcrumb */}
        <nav className={styles.breadcrumb}>
          <button
            className={`${styles.breadcrumbItem} ${currentPath === '/' ? styles.breadcrumbActive : ''}`}
            onClick={() => setCurrentPath('/')}
          >
            <HardDrive size={14} />
            /
          </button>
          {pathSegments.map((segment, i) => {
            const segPath = '/' + pathSegments.slice(0, i + 1).join('/');
            const isLast = i === pathSegments.length - 1;
            return (
              <span key={segPath} className={styles.breadcrumbSep}>
                <ChevronRight size={14} />
                <button
                  className={`${styles.breadcrumbItem} ${isLast ? styles.breadcrumbActive : ''}`}
                  onClick={() => setCurrentPath(segPath)}
                >
                  {segment}
                </button>
              </span>
            );
          })}
        </nav>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <>
              {parentPath !== null && (
                <button
                  className={styles.row}
                  onClick={() => setCurrentPath(parentPath)}
                >
                  <CornerLeftUp size={16} className={styles.iconFile} />
                  <span className={styles.entryName}>..</span>
                </button>
              )}
              {entries.length === 0 && !parentPath && (
                <div className={styles.empty}>No accessible entries</div>
              )}
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  className={`${styles.row} ${selected === entry.path ? styles.rowSelected : ''}`}
                  onClick={() => handleEntryClick(entry)}
                >
                  {entry.type === 'folder' ? (
                    <Folder size={16} className={styles.iconFolder} />
                  ) : (
                    <File size={16} className={styles.iconFile} />
                  )}
                  <span className={styles.entryName}>{entry.name}</span>
                  {selected === entry.path && (
                    <Check size={14} className={styles.checkIcon} />
                  )}
                </button>
              ))}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.selectedPath}>
            {selected ?? currentPath}
          </span>
          <div className={styles.footerActions}>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSelectCurrent}>
              Select
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
