import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import styles from './EntitySwitcher.module.css';

interface EntitySwitcherProps {
  currentId: string;
  currentName: string;
  fetchEntries: () => Promise<{ id: string; name: string }[]>;
  basePath: string;
  allLabel: string;
  size?: 'default' | 'large';
}

export function EntitySwitcher({ currentId, currentName, fetchEntries, basePath, allLabel, size = 'default' }: EntitySwitcherProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<{ id: string; name: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    try {
      const data = await fetchEntries();
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [fetchEntries]);

  function handleToggle() {
    if (open) {
      setOpen(false);
    } else {
      void handleOpen();
    }
  }

  // Click-outside
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Escape
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Reset cached entries when closed so next open re-fetches
  useEffect(() => {
    if (!open) setEntries(null);
  }, [open]);

  return (
    <div className={`${styles.wrapper} ${size === 'large' ? styles.wrapperLarge : ''}`} ref={wrapperRef}>
      <button className={`${styles.trigger} ${size === 'large' ? styles.triggerLarge : ''}`} onClick={handleToggle} type="button">
        {currentName}
        <ChevronDown
          size={size === 'large' ? 18 : 14}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
        />
      </button>

      {open && (
        <div className={styles.dropdown}>
          {loading ? (
            <div className={styles.loading}>Loading…</div>
          ) : (
            <>
              <div className={styles.list}>
                {entries?.map((entry) => (
                  <Link
                    key={entry.id}
                    to={`${basePath}/${entry.id}`}
                    className={`${styles.item} ${entry.id === currentId ? styles.itemActive : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    {entry.name}
                  </Link>
                ))}
              </div>
              <div className={styles.divider} />
              <Link
                to={`${basePath}?list=1`}
                className={styles.viewAll}
                onClick={() => setOpen(false)}
              >
                {allLabel}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
