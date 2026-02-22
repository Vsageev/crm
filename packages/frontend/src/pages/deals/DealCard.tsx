import { memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Calendar } from 'lucide-react';
import styles from './DealCard.module.css';

export interface Deal {
  id: string;
  title: string;
  value?: string | null;
  currency: string;
  stage: string;
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  stageOrder: number;
  contactId?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  lostReason?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DealCardProps {
  deal: Deal;
  onDragStart: (e: React.DragEvent, deal: Deal) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

function formatCurrency(value: string, currency: string) {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function getCloseDateStatus(dateStr: string): 'overdue' | 'soon' | '' {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 7) return 'soon';
  return '';
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export const DealCard = memo(function DealCard({ deal, onDragStart, onDragEnd }: DealCardProps) {
  const navigate = useNavigate();
  const didDragRef = useRef(false);

  const closeDateStatus = deal.expectedCloseDate
    ? getCloseDateStatus(deal.expectedCloseDate)
    : '';

  function handleDragStart(e: React.DragEvent) {
    didDragRef.current = true;
    onDragStart(e, deal);
  }

  function handleClick() {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    navigate(`/deals/${deal.id}`);
  }

  return (
    <div
      className={styles.card}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={(e) => {
        onDragEnd(e);
      }}
      onClick={handleClick}
    >
      <div className={styles.title}>{deal.title}</div>

      <div className={styles.meta}>
        {deal.value ? (
          <span className={styles.value}>
            {formatCurrency(deal.value, deal.currency)}
          </span>
        ) : (
          <span className={styles.noValue}>No value</span>
        )}
      </div>

      {(deal.ownerId || deal.expectedCloseDate) && (
        <div className={styles.footer}>
          {deal.ownerId ? (
            <span className={styles.owner}>
              <User size={12} />
              Assigned
            </span>
          ) : (
            <span />
          )}
          {deal.expectedCloseDate && (
            <span
              className={[styles.closeDate, closeDateStatus ? styles[closeDateStatus] : '']
                .filter(Boolean)
                .join(' ')}
            >
              <Calendar size={12} />
              {formatDate(deal.expectedCloseDate)}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
