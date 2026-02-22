import { memo, useState } from 'react';
import { Plus } from 'lucide-react';
import { DealCard, type Deal } from './DealCard';
import styles from './KanbanColumn.module.css';

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  isWinStage: boolean;
  isLossStage: boolean;
}

interface KanbanColumnProps {
  stage: PipelineStage;
  deals: Deal[];
  onDragStart: (e: React.DragEvent, deal: Deal) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, stageId: string) => void;
  onAddDeal: (stageId: string) => void;
}

function formatColumnValue(deals: Deal[]) {
  const total = deals.reduce((sum, d) => sum + (d.value ? parseFloat(d.value) : 0), 0);
  if (total === 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(total);
}

export const KanbanColumn = memo(function KanbanColumn({
  stage,
  deals,
  onDragStart,
  onDragEnd,
  onDrop,
  onAddDeal,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const totalValue = formatColumnValue(deals);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only set false if leaving the column, not entering a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    onDrop(e, stage.id);
  }

  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        <span className={styles.stageColor} style={{ background: stage.color }} />
        <span className={styles.stageName}>{stage.name}</span>
        <span className={styles.dealCount}>{deals.length}</span>
        {totalValue && <span className={styles.stageValue}>{totalValue}</span>}
      </div>

      <div
        className={[styles.cardList, isDragOver ? styles.dragOver : '']
          .filter(Boolean)
          .join(' ')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {deals.length === 0 ? (
          <div className={styles.emptyColumn}>No deals</div>
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>

      <button
        className={styles.addDealBtn}
        onClick={() => onAddDeal(stage.id)}
      >
        <Plus size={14} />
        Add deal
      </button>
    </div>
  );
});
