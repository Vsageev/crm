import { useMemo } from 'react';
import styles from './BatchProgressGrid.module.css';

type CellStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped';

interface BatchProgressGridProps {
  /** Individual items with status — used when per-item data is available */
  items?: { id: string; label?: string; status: CellStatus }[];
  /** Summary counts — used when only aggregate data is available */
  counts?: { queued: number; processing: number; completed: number; failed: number; cancelled: number; skipped?: number };
  /** Total (required when using counts) */
  total?: number;
  /** Cell size in px (default 10) */
  cellSize?: number;
  /** Show legend below the grid (default true) */
  showLegend?: boolean;
}

const STATUS_ORDER: CellStatus[] = ['completed', 'processing', 'failed', 'skipped', 'queued', 'cancelled'];

const STATUS_META: Record<CellStatus, { label: string; color: string }> = {
  completed: { label: 'Done', color: '#10b981' },
  processing: { label: 'Running', color: '#7c3aed' },
  failed: { label: 'Failed', color: '#ef4444' },
  skipped: { label: 'Skipped', color: '#f59e0b' },
  queued: { label: 'Queued', color: 'var(--color-border)' },
  cancelled: { label: 'Cancelled', color: 'var(--color-text-tertiary)' },
};

export function BatchProgressGrid({
  items,
  counts,
  total: totalProp,
  cellSize: cellSizeProp,
  showLegend = true,
}: BatchProgressGridProps) {
  const cells = useMemo(() => {
    if (items && items.length > 0) {
      return items.map((it) => ({ key: it.id, status: it.status, label: it.label }));
    }
    if (counts) {
      const result: { key: string; status: CellStatus; label?: string }[] = [];
      for (const status of STATUS_ORDER) {
        const n = counts[status] || 0;
        for (let i = 0; i < n; i++) {
          result.push({ key: `${status}-${i}`, status });
        }
      }
      return result;
    }
    return [];
  }, [items, counts]);

  const legendCounts = useMemo(() => {
    const c = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 };
    for (const cell of cells) c[cell.status]++;
    return c;
  }, [cells]);

  if (cells.length === 0) return null;

  const total = totalProp ?? cells.length;

  // Auto-scale cell size so the grid stays compact for large batches
  const cellSize = cellSizeProp ?? (cells.length > 200 ? 6 : cells.length > 80 ? 8 : 10);
  const cellGap = cells.length > 200 ? 2 : 3;

  const finished = legendCounts.completed + legendCounts.failed + legendCounts.cancelled + legendCounts.skipped;

  return (
    <div className={styles.wrap}>
      <div className={styles.grid} style={{ '--cell-size': `${cellSize}px`, '--cell-gap': `${cellGap}px` } as React.CSSProperties}>
        {cells.map((cell) => (
          <div
            key={cell.key}
            className={`${styles.cell} ${styles[`cell_${cell.status}`]}`}
            title={cell.label ? `${cell.label} — ${cell.status}` : cell.status}
          />
        ))}
      </div>

      {showLegend && (
        <div className={styles.legend}>
          <div className={styles.legendItems}>
            {STATUS_ORDER.filter((s) => legendCounts[s] > 0).map((status) => (
              <span key={status} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: STATUS_META[status].color }} />
                <span className={styles.legendCount}>{legendCounts[status]}</span>
                {STATUS_META[status].label}
              </span>
            ))}
          </div>
          {total > 0 && (
            <span className={styles.legendTotal}>
              {finished}/{total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
