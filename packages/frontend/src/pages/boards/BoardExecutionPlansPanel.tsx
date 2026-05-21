import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, GitBranch, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { formatDate } from 'shared';
import { Button, Tooltip } from '../../ui';
import { Input } from '../../ui/Input';
import { Textarea } from '../../ui/Textarea';
import { api, ApiError } from '../../lib/api';
import {
  countCardsInLayers,
  countDependencyRulesInLayers,
  type BatchLayer,
  type BoardExecutionPlan,
} from '../../lib/agent-batch';
import { toast } from '../../stores/toast';
import { BatchLayerPlanner, type BatchPlanCard } from '../../components/BatchLayerPlanner';
import styles from './BoardExecutionPlansPanel.module.css';

interface BoardExecutionPlansPanelProps {
  boardId: string;
  availableCards: Array<{
    id: string;
    name: string;
    columnId?: string | null;
    columnName?: string | null;
  }>;
  onClose: () => void;
  onRunPlan: (plan: BoardExecutionPlan) => void;
}

type EditorMode = 'list' | 'editor';

function emptyLayers(): BatchLayer[] {
  return [{ cards: [] }];
}

function serializeLayers(layers: BatchLayer[]) {
  return layers
    .map((layer) => ({
      cards: layer.cards.map((card) => ({
        id: card.id,
        dependencyRule: card.dependencyRule,
      })),
    }))
    .filter((layer) => layer.cards.length > 0);
}

function planStatusLabel(plan: Pick<BoardExecutionPlan, 'status'>): string {
  if (plan.status === 'ready') return 'Ready';
  if (plan.status === 'invalid') return 'Invalid';
  return 'Draft';
}

function describePlan(plan: BoardExecutionPlan): string {
  const cardCount = countCardsInLayers(plan.layers);
  const layerCount = plan.layers.filter((layer) => layer.cards.length > 0).length;
  const dependencyCount = countDependencyRulesInLayers(plan.layers);
  return `${cardCount} card${cardCount === 1 ? '' : 's'} · ${layerCount} layer${layerCount === 1 ? '' : 's'} · ${dependencyCount} dependency rule${dependencyCount === 1 ? '' : 's'}`;
}

export function BoardExecutionPlansPanel({
  boardId,
  availableCards,
  onClose,
  onRunPlan,
}: BoardExecutionPlansPanelProps) {
  const [plans, setPlans] = useState<BoardExecutionPlan[]>([]);
  const [mode, setMode] = useState<EditorMode>('list');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [layers, setLayers] = useState<BatchLayer[]>(emptyLayers);

  const cardCount = useMemo(() => countCardsInLayers(layers), [layers]);
  const layerCount = useMemo(
    () => layers.filter((layer) => layer.cards.length > 0).length,
    [layers],
  );
  const dependencyCount = useMemo(() => countDependencyRulesInLayers(layers), [layers]);
  const editingPlan = plans.find((plan) => plan.id === editingId) ?? null;
  const currentIssues = editingPlan?.issues ?? [];

  const fetchPlans = useCallback(async () => {
    try {
      const res = await api<{ entries: BoardExecutionPlan[] }>(`/boards/${boardId}/execution-plans`);
      setPlans(res.entries);
    } catch {
      toast.error('Failed to load execution plans');
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const loadOptions = useCallback(async (query: string): Promise<BatchPlanCard[]> => {
    const needle = query.toLowerCase();
    return availableCards
      .filter((card) => {
        if (!needle) return true;
        return card.name.toLowerCase().includes(needle)
          || (card.columnName ?? '').toLowerCase().includes(needle);
      })
      .slice(0, 30)
      .map((card) => ({
        id: card.id,
        name: card.name,
        subtitle: card.columnName ?? null,
      }));
  }, [availableCards]);

  function startNewPlan() {
    setEditingId(null);
    setName('');
    setDescription('');
    setLayers(emptyLayers());
    setMode('editor');
  }

  function startEdit(plan: BoardExecutionPlan) {
    setEditingId(plan.id);
    setName(plan.name);
    setDescription(plan.description ?? '');
    setLayers(plan.layers.length > 0 ? plan.layers : emptyLayers());
    setMode('editor');
  }

  function backToList() {
    setMode('list');
    setEditingId(null);
    setName('');
    setDescription('');
    setLayers(emptyLayers());
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;

    setSaving(true);
    try {
      const body = {
        name: trimmedName,
        description: description.trim() || null,
        layers: serializeLayers(layers),
      };

      const saved = editingId
        ? await api<BoardExecutionPlan>(`/boards/${boardId}/execution-plans/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await api<BoardExecutionPlan>(`/boards/${boardId}/execution-plans`, {
            method: 'POST',
            body: JSON.stringify(body),
          });

      setEditingId(saved.id);
      setPlans((prev) => {
        const exists = prev.some((plan) => plan.id === saved.id);
        return exists
          ? prev.map((plan) => (plan.id === saved.id ? saved : plan))
          : [saved, ...prev];
      });
      toast.success(editingId ? 'Execution plan updated' : 'Execution plan created');
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('Failed to save execution plan');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(plan: BoardExecutionPlan) {
    try {
      await api(`/boards/${boardId}/execution-plans/${plan.id}`, { method: 'DELETE' });
      setPlans((prev) => prev.filter((entry) => entry.id !== plan.id));
      if (editingId === plan.id) backToList();
      toast.success('Execution plan deleted');
    } catch {
      toast.error('Failed to delete execution plan');
    }
  }

  function handleRun(plan: BoardExecutionPlan) {
    if (plan.status !== 'ready') return;
    onRunPlan(plan);
  }

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {mode === 'editor' && (
              <button className={styles.backBtn} onClick={backToList} aria-label="Back to plans">
                <ArrowLeft size={15} />
              </button>
            )}
            <div className={styles.headerIcon}>
              <GitBranch size={14} />
            </div>
            <span className={styles.title}>{mode === 'editor' ? 'Execution Plan' : 'Execution Plans'}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {mode === 'list' ? (
          <div className={styles.body}>
            <Button onClick={startNewPlan}>
              <Plus size={14} />
              New plan
            </Button>

            {loading ? (
              <div className={styles.empty}>Loading...</div>
            ) : plans.length === 0 ? (
              <div className={styles.empty}>
                <GitBranch size={24} />
                No execution plans yet.
                <br />
                Create one to save card order and dependencies for later batch runs.
              </div>
            ) : (
              plans.map((plan) => {
                const canRun = plan.status === 'ready';
                const runLabel = canRun
                  ? 'Run from plan'
                  : plan.issues[0] ?? 'Plan is not ready to run';
                return (
                  <div key={plan.id} className={styles.planItem}>
                    <div className={styles.planInfo}>
                      <div className={styles.planTitleRow}>
                        <span className={styles.planName}>{plan.name}</span>
                        <span className={`${styles.statusBadge} ${styles[`status_${plan.status}`]}`}>
                          {planStatusLabel(plan)}
                        </span>
                      </div>
                      <div className={styles.planMeta}>{describePlan(plan)}</div>
                      <div className={styles.planHealth}>
                        {plan.status === 'ready' ? (
                          <>
                            <CheckCircle2 size={12} />
                            Valid · edited {formatDate(plan.updatedAt)}
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={12} />
                            {plan.issues[0] ?? 'Draft plan'}
                          </>
                        )}
                      </div>
                    </div>
                    <div className={styles.planActions}>
                      <Tooltip label="Edit plan">
                        <button className={styles.iconBtn} onClick={() => startEdit(plan)} aria-label="Edit plan">
                          <Pencil size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip label={runLabel}>
                        <span>
                          <button
                            className={styles.iconBtn}
                            onClick={() => handleRun(plan)}
                            disabled={!canRun}
                            aria-label="Run from plan"
                          >
                            <Play size={14} />
                          </button>
                        </span>
                      </Tooltip>
                      <Tooltip label="Delete plan">
                        <button
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => void handleDelete(plan)}
                          aria-label="Delete plan"
                        >
                          <Trash2 size={14} />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <>
            <div className={styles.body}>
              <div className={styles.formGrid}>
                <div className={styles.formField}>
                  <span className={styles.formLabel}>Name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Release pipeline"
                    maxLength={255}
                  />
                </div>
                <div className={styles.formField}>
                  <span className={styles.formLabel}>Description</span>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional notes for this plan"
                    rows={2}
                    maxLength={2000}
                  />
                </div>
              </div>

              <div className={styles.statusStrip}>
                <span>{cardCount} card{cardCount === 1 ? '' : 's'}</span>
                <span>{layerCount} layer{layerCount === 1 ? '' : 's'}</span>
                <span>{dependencyCount} dependency rule{dependencyCount === 1 ? '' : 's'}</span>
                <span className={currentIssues.length > 0 ? styles.statusIssue : styles.statusOk}>
                  {currentIssues.length > 0 ? `${currentIssues.length} issue${currentIssues.length === 1 ? '' : 's'}` : 'No saved issues'}
                </span>
              </div>

              {currentIssues.length > 0 && (
                <div className={styles.issueList}>
                  {currentIssues.map((issue) => (
                    <div key={issue} className={styles.issueItem}>
                      <AlertTriangle size={13} />
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}

              <BatchLayerPlanner
                layers={layers}
                onChange={setLayers}
                loadOptions={loadOptions}
                searchPlaceholder="Search board cards or columns..."
                emptySearchLabel="No board cards available"
              />
            </div>

            <div className={styles.footer}>
              <Button variant="ghost" onClick={backToList}>Cancel</Button>
              <Button
                onClick={() => void handleSave()}
                disabled={saving || !name.trim()}
              >
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Save plan'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
