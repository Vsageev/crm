import { useState, type FormEvent } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { Button, Input, Textarea, Tooltip } from '../../ui';
import { api, ApiError } from '../../lib/api';
import type { Deal } from './DealCard';
import type { PipelineStage } from './KanbanColumn';
import styles from './CreateDealModal.module.css';

interface EditDealModalProps {
  deal: Deal;
  pipelineId: string;
  stages: PipelineStage[];
  onClose: () => void;
  onUpdated: (deal: Deal) => void;
}

export function EditDealModal({
  deal,
  pipelineId,
  stages,
  onClose,
  onUpdated,
}: EditDealModalProps) {
  const [title, setTitle] = useState(deal.title);
  const [value, setValue] = useState(deal.value || '');
  const [stageId, setStageId] = useState(deal.pipelineStageId || stages[0]?.id || '');
  const [notes, setNotes] = useState(deal.notes || '');
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : '',
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function clearFieldError(field: string) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const errors: Record<string, string> = {};
    if (!title.trim()) {
      errors.title = 'Deal title is required';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        pipelineStageId: stageId,
      };

      body.value = value.trim() || null;
      body.notes = notes.trim() || null;
      body.expectedCloseDate = expectedCloseDate
        ? new Date(expectedCloseDate).toISOString()
        : null;

      const updated = await api<Deal>(`/deals/${deal.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      onUpdated(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update deal');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Edit Deal</h2>
          <Tooltip label="Close">
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </Tooltip>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {error && (
              <div className={styles.alert}>
                <AlertCircle size={16} className={styles.alertIcon} />
                {error}
              </div>
            )}

            <Input
              label="Deal Title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                clearFieldError('title');
              }}
              error={fieldErrors.title}
              placeholder="e.g. Enterprise license deal"
              autoFocus
              required
            />

            <div className={styles.row}>
              <Input
                label="Value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
              />
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--color-text)',
                  }}
                >
                  Stage
                </label>
                <select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '14px',
                    color: 'var(--color-text)',
                    background: 'var(--color-card)',
                  }}
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Input
              label="Expected Close Date"
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
            />

            <Textarea
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this deal..."
              rows={4}
            />
          </div>

          <div className={styles.modalFooter}>
            <Button type="button" variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="md" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
