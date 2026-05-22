import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, GitBranch, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { formatDate } from 'shared';
import { ActionTooltip, Button, ReasonedActionButton, Tooltip } from '../../ui';
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
import type { ExecutionPlansExperiments } from '../../devtools/execution-plans-experiments';
import type { PlanEditorBridge, PlanEditorAddMode } from './execution-plan-editor-bridge';
import styles from './BoardExecutionPlansPanel.module.css';

interface BoardExecutionPlansPanelProps {
  boardId: string;
  availableCards: Array<{
    id: string;
    name: string;
    columnId?: string | null;
    columnName?: string | null;
    columnColor?: string | null;
    assigneeId?: string | null;
    assigneeName?: string | null;
  }>;
  columnColors?: Record<string, string>;
  experiments?: ExecutionPlansExperiments;
  onClose: () => void;
  onRunPlan: (plan: BoardExecutionPlan) => void;
  onEditorBridgeChange?: (bridge: PlanEditorBridge | null) => void;
  onEditorLayersChange?: (layers: BatchLayer[]) => void;
  onExternalPlannerDrag?: (active: boolean) => void;
}

type EditorMode = 'list' | 'editor';
const MAX_PLAN_DESCRIPTION_LENGTH = 2000;

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

type PlanTemplate = {
  id: string;
  label: string;
  description: string;
  buildLayers: () => BatchLayer[];
};

function layerFingerprint(layers: BatchLayer[]) {
  return JSON.stringify(serializeLayers(layers));
}

export function BoardExecutionPlansPanel({
  boardId,
  availableCards,
  columnColors = {},
  experiments,
  onClose,
  onRunPlan,
  onEditorBridgeChange,
  onEditorLayersChange,
  onExternalPlannerDrag,
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
  const editingPlan = plans.find((plan) => plan.id === editingId) ?? null;
  const currentIssues = editingPlan?.issues ?? [];
  const nextDescriptionValue = description.trim() || null;
  const descriptionTooLong = description.length > MAX_PLAN_DESCRIPTION_LENGTH;
  const dirty = mode === 'editor' && (
    !editingPlan
    || editingPlan.name !== name.trim()
      || (editingPlan.description ?? null) !== nextDescriptionValue
      || layerFingerprint(editingPlan.layers) !== layerFingerprint(layers)
  );
  const readinessIssues = [
    ...(!name.trim() ? ['Name required before saving.'] : []),
    ...(cardCount === 0 ? ['Assign at least one board card to a layer.'] : []),
    ...(descriptionTooLong ? ['Description must stay under 2000 characters.'] : []),
    ...currentIssues,
  ];
  const canRunEditingPlan = !!editingPlan && editingPlan.status === 'ready' && !dirty;
  const runEditingLabel = canRunEditingPlan
    ? 'Run plan'
    : dirty
      ? 'Save before running'
      : readinessIssues[0] ?? 'Plan is not ready to run';
  const canSave = Boolean(name.trim()) && !saving && !descriptionTooLong;
  const saveDisabledReason = saving
    ? 'Plan is saving.'
    : !name.trim()
      ? 'Enter a plan name before saving.'
      : descriptionTooLong
        ? 'Description must stay under 2000 characters before saving.'
        : null;

  const fetchPlans = useCallback(async () => {
    try {
      const res = await api<{ entries: BoardExecutionPlan[] }>(`/boards/${boardId}/execution-plans`);
      setPlans(res.entries);
      return res.entries;
    } catch {
      toast.error('Failed to load execution plans');
      return null;
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

  const toPlanCard = useCallback((card: BoardExecutionPlansPanelProps['availableCards'][number]): BatchPlanCard => ({
    id: card.id,
    name: card.name,
    subtitle: card.columnName ?? null,
    columnColor: card.columnColor ?? (card.columnId ? columnColors[card.columnId] ?? null : null),
  }), [columnColors]);

  const loadOptions = useCallback(async (query: string): Promise<BatchPlanCard[]> => {
    const needle = query.toLowerCase();
    return availableCards
      .filter((card) => {
        if (!needle) return true;
        return card.name.toLowerCase().includes(needle)
          || (card.columnName ?? '').toLowerCase().includes(needle);
      })
      .slice(0, 30)
      .map(toPlanCard);
  }, [availableCards, toPlanCard]);

  const addCardsToLayers = useCallback((cards: BatchPlanCard[], mode: PlanEditorAddMode) => {
    setLayers((prev) => {
      const existing = new Set(prev.flatMap((layer) => layer.cards.map((card) => card.id)));
      const fresh = cards.filter((card) => !existing.has(card.id));
      if (fresh.length === 0) return prev;

      if (mode === 'newLayer') {
        const nonEmpty = prev.filter((layer) => layer.cards.length > 0);
        return [...nonEmpty, { cards: fresh }];
      }

      if (prev.length === 0) return [{ cards: fresh }];
      const lastIdx = prev.length - 1;
      return prev.map((layer, idx) => (
        idx === lastIdx ? { cards: [...layer.cards, ...fresh] } : layer
      ));
    });
  }, []);

  useEffect(() => {
    onEditorLayersChange?.(layers);
  }, [layers, onEditorLayersChange]);

  useEffect(() => {
    if (mode !== 'editor') {
      onEditorBridgeChange?.(null);
      return;
    }
    onEditorBridgeChange?.({
      isEditing: true,
      boardSelectionMode: Boolean(experiments?.selectionToolbar),
      addCards: addCardsToLayers,
    });
  }, [addCardsToLayers, experiments?.selectionToolbar, mode, onEditorBridgeChange]);

  const planTemplates = useMemo<PlanTemplate[]>(() => {
    if (!experiments?.planTemplates) return [];

    const byColumn = new Map<string, BatchPlanCard[]>();
    for (const card of availableCards) {
      const key = card.columnId ?? '__none__';
      const list = byColumn.get(key) ?? [];
      list.push(toPlanCard(card));
      byColumn.set(key, list);
    }

    const templates: PlanTemplate[] = [
      {
        id: 'blank',
        label: 'Blank plan',
        description: 'Start with an empty layer.',
        buildLayers: () => [{ cards: [] }],
      },
    ];

    for (const [columnId, cards] of byColumn) {
      if (cards.length === 0) continue;
      const columnName = availableCards.find((c) => c.columnId === columnId)?.columnName ?? 'Column';
      templates.push({
        id: `column-${columnId}`,
        label: columnName,
        description: `${cards.length} card${cards.length === 1 ? '' : 's'} as one layer`,
        buildLayers: () => [{ cards }],
      });
    }

    if (availableCards.length > 0) {
      templates.push({
        id: 'all-columns',
        label: 'All columns',
        description: 'One layer per column, left to right',
        buildLayers: () => [...byColumn.values()]
          .filter((cards) => cards.length > 0)
          .map((cards) => ({ cards })),
      });
    }

    return templates;
  }, [availableCards, experiments?.planTemplates, toPlanCard]);

  function startNewPlan(template?: PlanTemplate) {
    setEditingId(null);
    setName(template && template.id !== 'blank' ? `${template.label} plan` : '');
    setDescription('');
    setLayers(template ? template.buildLayers() : emptyLayers());
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

  async function handleSave(options: { requireCards?: boolean; runAfterSave?: boolean } = {}) {
    const trimmedName = name.trim();
    if (!trimmedName || !canSave || (options.requireCards && cardCount === 0)) return null;

    setSaving(true);
    try {
      const body = {
        name: trimmedName,
        description: nextDescriptionValue,
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
      setDescription(saved.description ?? '');
      setLayers(saved.layers.length > 0 ? saved.layers : emptyLayers());
      setPlans((prev) => {
        const exists = prev.some((plan) => plan.id === saved.id);
        return exists
          ? prev.map((plan) => (plan.id === saved.id ? saved : plan))
          : [saved, ...prev];
      });
      if (!editingId) await fetchPlans();
      toast.success(editingId ? 'Execution plan updated' : 'Execution plan created');
      if (options.runAfterSave && saved.status === 'ready') onRunPlan(saved);
      return saved;
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('Failed to save execution plan');
      return null;
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

  const panelClass = [
    styles.railPanel,
    mode === 'editor' ? styles.editorPanel : styles.listPanel,
  ].join(' ');
  const bodyClass = [
    styles.body,
    mode === 'editor' ? styles.editorBody : styles.listBody,
  ].join(' ');

  return (
    <div className={styles.railShell}>
      <div className={panelClass}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {mode !== 'list' && (
              <button className={styles.backBtn} onClick={backToList} aria-label="Back to plans">
                <ArrowLeft size={15} />
              </button>
            )}
            <div className={styles.headerIcon}>
              <GitBranch size={14} />
            </div>
            <span className={styles.title}>
              {mode === 'editor' ? 'Execution Plan' : 'Execution Plans'}
            </span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {mode === 'list' ? (
          <div className={bodyClass}>
            {planTemplates.length > 0 ? (
              <div className={styles.templateSection}>
                <span className={styles.templateLabel}>New from template</span>
                <div className={styles.templateGrid}>
                  {planTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={styles.templateCard}
                      onClick={() => startNewPlan(template)}
                    >
                      <span className={styles.templateCardTitle}>{template.label}</span>
                      <span className={styles.templateCardDesc}>{template.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Button onClick={() => startNewPlan()}>
                <Plus size={14} />
                New plan
              </Button>
            )}

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
                      <ActionTooltip
                        label={runLabel}
                        disabled={!canRun}
                        focusable={!canRun}
                        triggerLabel="Run from plan"
                      >
                        <button
                          className={styles.iconBtn}
                          onClick={() => handleRun(plan)}
                          disabled={!canRun}
                          aria-label="Run from plan"
                        >
                          <Play size={14} />
                        </button>
                      </ActionTooltip>
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
            <div className={bodyClass}>
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
                    maxLength={MAX_PLAN_DESCRIPTION_LENGTH}
                  />
                </div>
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
                experiments={{
                  acceptBoardDrag: experiments?.boardDragIn,
                  polish: experiments?.plannerPolish,
                  dependencyShortcuts: experiments?.dependencyShortcuts,
                }}
                onExternalDragActive={onExternalPlannerDrag}
              />
            </div>

            <div className={styles.footer}>
              <Button variant="ghost" onClick={backToList}>Cancel</Button>
              <ReasonedActionButton
                variant="secondary"
                onClick={() => editingPlan && handleRun(editingPlan)}
                disabled={!canRunEditingPlan}
                disabledReason={runEditingLabel}
                aria-label="Run plan"
              >
                <Play size={14} />
                Run
              </ReasonedActionButton>
              <ReasonedActionButton
                onClick={() => void handleSave()}
                disabled={!canSave}
                disabledReason={saveDisabledReason ?? undefined}
              >
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Save plan'}
              </ReasonedActionButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
