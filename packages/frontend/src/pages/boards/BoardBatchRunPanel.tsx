import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Bot, Play, Check, CheckCircle2, Minus, Plus, Zap, Layers, ChevronDown, Search, ListOrdered, AlertCircle, Wrench } from 'lucide-react';
import { ReasonedActionButton } from '../../ui';
import { api } from '../../lib/api';
import { toast } from '../../stores/toast';
import { AgentAvatar } from '../../components/AgentAvatar';
import { BatchLayerPlanner, type BatchLayerPlannerExperiments, type BatchPlanCard } from '../../components/BatchLayerPlanner';
import {
  buildCardDependenciesFromLayers,
  buildStagesFromLayers,
  type BatchLayer,
} from '../../lib/agent-batch';
import {
  filterColumnIds,
  getBoardBatchRunPreferences,
  saveBoardBatchRunPreferences,
} from '../../lib/board-batch-run-preferences';
import styles from './BoardBatchRunPanel.module.css';

interface BoardColumn {
  id: string;
  name: string;
  color: string;
  position: number;
}

interface AgentEntry {
  id: string;
  name: string;
  status: string;
  avatarIcon?: string;
  avatarBgColor?: string;
  avatarLogoColor?: string;
}

interface BatchResult {
  runId: string | null;
  total: number;
  queued: number;
  message: string;
}

interface RunnerPreflightStatus {
  state:
    | 'ready'
    | 'runner_unavailable'
    | 'runner_repair_required'
    | 'runner_capability_missing'
    | 'workspace_repair_required'
    | 'error';
  code: string;
  message: string;
  hint?: string;
}

interface BoardBatchRunPanelProps {
  boardId: string;
  columns: BoardColumn[];
  availableCards: Array<{
    id: string;
    name: string;
    columnId?: string | null;
    columnName?: string | null;
  }>;
  initialManualLayers?: BatchLayer[];
  initialPlanName?: string | null;
  embedPlanner?: boolean;
  plannerExperiments?: BatchLayerPlannerExperiments;
  onClose: () => void;
}

export function BoardBatchRunPanel({
  boardId,
  columns,
  availableCards,
  initialManualLayers,
  initialPlanName,
  embedPlanner = false,
  plannerExperiments,
  onClose,
}: BoardBatchRunPanelProps) {
  const savedPrefs = useMemo(() => getBoardBatchRunPreferences(boardId), [boardId]);
  const validColumnIds = useMemo(() => new Set(columns.map((c) => c.id)), [columns]);
  const openedFromPlan = Boolean(initialManualLayers);
  const showEmbeddedPlanner = embedPlanner && openedFromPlan;
  const persistManualLayersRef = useRef(!openedFromPlan);

  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [agentId, setAgentId] = useState(savedPrefs?.agentId ?? '');
  const [prompt, setPrompt] = useState(savedPrefs?.prompt ?? '');
  const [scopeMode, setScopeMode] = useState<'filters' | 'manual'>(
    () => (openedFromPlan || embedPlanner ? 'manual' : savedPrefs?.scopeMode) ?? 'filters',
  );
  const [selectedColumnIds, setSelectedColumnIds] = useState<Set<string>>(() => {
    const savedIds = filterColumnIds(savedPrefs?.selectedColumnIds, validColumnIds);
    if (savedIds?.length) return new Set(savedIds);
    return new Set(columns.map((c) => c.id));
  });
  const [textFilter, setTextFilter] = useState(savedPrefs?.textFilter ?? '');
  const [manualLayers, setManualLayers] = useState<BatchLayer[]>(
    () => initialManualLayers ?? savedPrefs?.manualLayers ?? [{ cards: [] }],
  );
  const [maxParallel, setMaxParallel] = useState(
    () => Math.min(10, Math.max(1, savedPrefs?.maxParallel ?? 3)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [runnerPreflight, setRunnerPreflight] = useState<RunnerPreflightStatus | null>(null);
  const [runnerPreflightLoading, setRunnerPreflightLoading] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);

  // Preview count
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (showEmbeddedPlanner) setScopeMode('manual');
  }, [showEmbeddedPlanner]);

  useEffect(() => {
    api<{ entries: AgentEntry[] }>('/agents?limit=100').then((res) => {
      const active = res.entries.filter((a) => a.status === 'active');
      setAgents(active);
      setAgentId((current) => {
        if (current && active.some((a) => a.id === current)) return current;
        if (savedPrefs?.agentId && active.some((a) => a.id === savedPrefs.agentId)) {
          return savedPrefs.agentId;
        }
        return active[0]?.id ?? '';
      });
    }).catch(() => {});
  }, [savedPrefs?.agentId]);

  useEffect(() => {
    if (!agentId) {
      setRunnerPreflight(null);
      setRunnerPreflightLoading(false);
      return;
    }

    let cancelled = false;
    setRunnerPreflightLoading(true);
    api<RunnerPreflightStatus>(`/agents/${agentId}/runner-preflight`)
      .then((status) => {
        if (!cancelled) setRunnerPreflight(status);
      })
      .catch((error) => {
        if (cancelled) return;
        setRunnerPreflight({
          state: 'error',
          code: 'runner_preflight_unavailable',
          message: error instanceof Error ? error.message : 'Runner readiness could not be checked.',
        });
      })
      .finally(() => {
        if (!cancelled) setRunnerPreflightLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      saveBoardBatchRunPreferences(boardId, {
        agentId: agentId || undefined,
        prompt,
        scopeMode,
        selectedColumnIds: Array.from(selectedColumnIds),
        textFilter,
        maxParallel,
        manualLayers:
          scopeMode === 'manual' && persistManualLayersRef.current
            ? manualLayers
            : undefined,
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [
    boardId,
    agentId,
    prompt,
    scopeMode,
    selectedColumnIds,
    textFilter,
    maxParallel,
    manualLayers,
  ]);

  const handleManualLayersChange = useCallback((layers: BatchLayer[]) => {
    persistManualLayersRef.current = true;
    setManualLayers(layers);
  }, []);

  useEffect(() => {
    setSelectedColumnIds((prev) => {
      const next = new Set([...prev].filter((id) => validColumnIds.has(id)));
      if (next.size === prev.size) return prev;
      if (next.size === 0) return new Set(columns.map((c) => c.id));
      return next;
    });
  }, [validColumnIds, columns]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const manualCardCount = useMemo(
    () => manualLayers.reduce((s, l) => s + l.cards.length, 0),
    [manualLayers],
  );

  // Fetch preview count when filters change (debounced for text filter)
  useEffect(() => {
    if (scopeMode !== 'filters') {
      setPreviewLoading(false);
      setPreviewCount(manualCardCount);
      return;
    }

    // No columns selected → 0 cards, no need to call API
    if (selectedColumnIds.size === 0) {
      setPreviewCount(0);
      setPreviewLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      previewAbortRef.current?.abort();
      const abort = new AbortController();
      previewAbortRef.current = abort;

      const params = new URLSearchParams();
      if (selectedColumnIds.size < columns.length) {
        params.set('columnIds', Array.from(selectedColumnIds).join(','));
      }
      if (textFilter.trim()) {
        params.set('textFilter', textFilter.trim());
      }

      setPreviewLoading(true);
      api<{ count: number }>(`/boards/${boardId}/batch-run/preview?${params}`, { signal: abort.signal })
        .then((res) => {
          if (!abort.signal.aborted) setPreviewCount(res.count);
        })
        .catch(() => {})
        .finally(() => {
          if (!abort.signal.aborted) setPreviewLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timeout);
      previewAbortRef.current?.abort();
    };
  }, [boardId, scopeMode, manualCardCount, selectedColumnIds, textFilter, columns.length]);

  const configuredStages = useMemo(
    () => scopeMode === 'manual' ? buildStagesFromLayers(manualLayers) : [],
    [scopeMode, manualLayers],
  );
  const configuredCardDependencies = useMemo(
    () => scopeMode === 'manual' ? buildCardDependenciesFromLayers(manualLayers) : [],
    [scopeMode, manualLayers],
  );

  const loadManualOptions = useCallback(async (query: string): Promise<BatchPlanCard[]> => {
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

  function toggleColumn(id: string) {
    setSelectedColumnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedColumnIds(new Set(columns.map((c) => c.id)));
  }

  function deselectAll() {
    setSelectedColumnIds(new Set());
  }

  async function handleSubmit() {
    if (!agentId || submitting) return;

    if (scopeMode === 'manual') {
      if (manualCardCount === 0) {
        toast.error('Add at least one card');
        return;
      }
    } else {
      const columnIds =
        selectedColumnIds.size === columns.length
          ? undefined
          : Array.from(selectedColumnIds);

      if (columnIds !== undefined && columnIds.length === 0) {
        toast.error('Select at least one column');
        return;
      }
    }

    setSubmitting(true);
    setResult(null);

    try {
      const res = await api<BatchResult>(`/boards/${boardId}/batch-run`, {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          prompt: prompt.trim(),
          cardIds: scopeMode === 'manual' ? manualLayers.flatMap((l) => l.cards.map((c) => c.id)) : undefined,
          columnIds:
            scopeMode === 'filters' && selectedColumnIds.size < columns.length
              ? Array.from(selectedColumnIds)
              : undefined,
          textFilter: scopeMode === 'filters' ? textFilter.trim() || undefined : undefined,
          maxParallel,
          stages: configuredStages.length > 0 ? configuredStages : undefined,
          cardDependencies: configuredCardDependencies.length > 0 ? configuredCardDependencies : undefined,
        }),
      });
      setResult(res);
      if (res.total === 0) {
        toast.info('No cards found on the board');
      } else {
        toast.success(`Batch run started — ${res.total} card${res.total !== 1 ? 's' : ''} queued`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start batch run');
    } finally {
      setSubmitting(false);
    }
  }

  const allSelected = selectedColumnIds.size === columns.length;
  const selectedAgent = agents.find((a) => a.id === agentId);
  const runnerPreflightBlockingReason =
    runnerPreflightLoading
      ? 'Checking runner readiness…'
      : runnerPreflight && runnerPreflight.state !== 'ready'
        ? runnerPreflight.hint || runnerPreflight.message
        : undefined;

  const disabledReason = submitting
    ? 'Batch run is starting…'
    : !agentId
      ? 'Select an agent first'
      : runnerPreflightBlockingReason
        ? runnerPreflightBlockingReason
      : scopeMode === 'manual' && manualCardCount === 0
        ? 'Add at least one card'
        : scopeMode === 'filters' && selectedColumnIds.size === 0
          ? 'Select at least one column'
          : undefined;

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Zap size={14} />
            </div>
            <span className={styles.title}>Batch Run</span>
            {initialPlanName && <span className={styles.planChip}>From {initialPlanName}</span>}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Agent Selection */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <Bot size={14} className={styles.sectionIcon} />
              <span className={styles.sectionLabel}>Agent</span>
            </div>
            <div ref={agentPickerRef} className={styles.agentPicker}>
              <button
                type="button"
                className={styles.agentTrigger}
                onClick={() => setShowAgentPicker((v) => !v)}
              >
                {selectedAgent ? (
                  <>
                    <AgentAvatar
                      icon={selectedAgent.avatarIcon || 'spark'}
                      bgColor={selectedAgent.avatarBgColor || '#1a1a2e'}
                      logoColor={selectedAgent.avatarLogoColor || '#e94560'}
                      size={20}
                    />
                    <span className={styles.agentTriggerName}>{selectedAgent.name}</span>
                  </>
                ) : (
                  <span className={styles.agentPlaceholder}>
                    {agents.length === 0 ? 'No active agents' : 'Select an agent…'}
                  </span>
                )}
                <ChevronDown size={13} className={styles.agentChevron} />
              </button>
              {showAgentPicker && (
                <div className={styles.agentDropdown}>
                  {agents.length === 0 ? (
                    <div className={styles.agentDropdownEmpty}>No active agents available</div>
                  ) : (
                    agents.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        className={`${styles.agentOption} ${agentId === a.id ? styles.agentOptionActive : ''}`}
                        onClick={() => { setAgentId(a.id); setShowAgentPicker(false); }}
                      >
                        <AgentAvatar
                          icon={a.avatarIcon || 'spark'}
                          bgColor={a.avatarBgColor || '#1a1a2e'}
                          logoColor={a.avatarLogoColor || '#e94560'}
                          size={20}
                        />
                        <span className={styles.agentOptionName}>{a.name}</span>
                        {agentId === a.id && <Check size={12} className={styles.agentOptionCheck} />}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {(runnerPreflightLoading || runnerPreflight) && (
              <div
                className={[
                  styles.runnerPreflight,
                  runnerPreflight?.state === 'ready' ? styles.runnerPreflightReady : '',
                  runnerPreflight && runnerPreflight.state !== 'ready' ? styles.runnerPreflightIssue : '',
                ].filter(Boolean).join(' ')}
              >
                {runnerPreflight?.state === 'ready' ? (
                  <CheckCircle2 size={15} />
                ) : runnerPreflight?.state === 'workspace_repair_required' || runnerPreflight?.state === 'runner_repair_required' ? (
                  <Wrench size={15} />
                ) : (
                  <AlertCircle size={15} />
                )}
                <div className={styles.runnerPreflightText}>
                  <span className={styles.runnerPreflightTitle}>
                    {runnerPreflightLoading
                      ? 'Checking runner readiness'
                      : runnerPreflight?.state === 'ready'
                        ? 'Runner online'
                        : runnerPreflight?.state === 'workspace_repair_required'
                          ? 'Workspace repair required'
                          : runnerPreflight?.state === 'runner_capability_missing'
                            ? 'Capability missing'
                            : runnerPreflight?.state === 'runner_repair_required'
                              ? 'Runner repair required'
                              : runnerPreflight?.state === 'runner_unavailable'
                                ? 'Runner offline'
                                : 'Runner preflight failed'}
                  </span>
                  <span className={styles.runnerPreflightMessage}>
                    {runnerPreflightLoading
                      ? 'Batch runs start only after metadata and runner workspace checks pass.'
                      : runnerPreflight?.hint || runnerPreflight?.message}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <ListOrdered size={14} className={styles.sectionIcon} />
              <span className={styles.sectionLabel}>Batch scope</span>
            </div>
            <div className={styles.columnChips}>
              <button
                type="button"
                className={`${styles.columnChip} ${scopeMode === 'filters' ? styles.columnChipSelected : ''}`}
                onClick={() => setScopeMode('filters')}
              >
                Filtered set
              </button>
              <button
                type="button"
                className={`${styles.columnChip} ${scopeMode === 'manual' ? styles.columnChipSelected : ''}`}
                onClick={() => setScopeMode('manual')}
              >
                Manual order
              </button>
            </div>
          </div>

          {showEmbeddedPlanner && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <Layers size={14} className={styles.sectionIcon} />
                <span className={styles.sectionLabel}>Edit plan layers</span>
              </div>
              <BatchLayerPlanner
                layers={manualLayers}
                onChange={handleManualLayersChange}
                loadOptions={loadManualOptions}
                searchPlaceholder="Search board cards or columns..."
                emptySearchLabel="No board cards available"
                experiments={plannerExperiments}
              />
            </div>
          )}

          {/* Prompt */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>Prompt (optional)</span>
              <span className={styles.charCount}>{prompt.length.toLocaleString()} / 10,000</span>
            </div>
            <textarea
              className={styles.promptTextarea}
              placeholder="Add extra instructions, or leave empty to use the card details."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={10000}
              rows={5}
            />
          </div>

          {scopeMode === 'filters' ? (
            <>
              {/* Columns */}
              {columns.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <Layers size={14} className={styles.sectionIcon} />
                    <span className={styles.sectionLabel}>
                      Columns
                      <span className={styles.sectionCount}>
                        {selectedColumnIds.size}/{columns.length}
                      </span>
                    </span>
                    <button
                      className={styles.toggleAllBtn}
                      onClick={allSelected ? deselectAll : selectAll}
                      type="button"
                    >
                      {allSelected ? 'Clear' : 'All'}
                    </button>
                  </div>
                  <div className={styles.columnChips}>
                    {columns.map((col) => {
                      const selected = selectedColumnIds.has(col.id);
                      return (
                        <button
                          key={col.id}
                          className={`${styles.columnChip} ${selected ? styles.columnChipSelected : ''}`}
                          onClick={() => toggleColumn(col.id)}
                          type="button"
                        >
                          <span
                            className={styles.columnDot}
                            style={{ background: col.color }}
                          />
                          {col.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Text Filter */}
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <Search size={14} className={styles.sectionIcon} />
                  <span className={styles.sectionLabel}>Filter cards</span>
                </div>
                <input
                  className={styles.textFilterInput}
                  type="text"
                  placeholder="Filter by card name…"
                  value={textFilter}
                  onChange={(e) => setTextFilter(e.target.value)}
                  maxLength={200}
                />
              </div>
            </>
          ) : !showEmbeddedPlanner ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <Layers size={14} className={styles.sectionIcon} />
                <span className={styles.sectionLabel}>Cards &amp; layers</span>
              </div>
              <BatchLayerPlanner
                layers={manualLayers}
                onChange={handleManualLayersChange}
                loadOptions={loadManualOptions}
                searchPlaceholder="Search board cards or columns..."
                emptySearchLabel="No board cards available"
                experiments={plannerExperiments}
              />
            </div>
          ) : null}

          {/* Concurrency */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>Concurrency</span>
            </div>
            <div className={styles.stepperRow}>
              <div className={styles.stepper}>
                <button
                  className={styles.stepperBtn}
                  onClick={() => setMaxParallel((v) => Math.max(1, v - 1))}
                  disabled={maxParallel <= 1}
                  type="button"
                  aria-label="Decrease"
                >
                  <Minus size={14} />
                </button>
                <span className={styles.stepperValue}>{maxParallel}</span>
                <button
                  className={styles.stepperBtn}
                  onClick={() => setMaxParallel((v) => Math.min(10, v + 1))}
                  disabled={maxParallel >= 10}
                  type="button"
                  aria-label="Increase"
                >
                  <Plus size={14} />
                </button>
              </div>
              <span className={styles.stepperHint}>parallel agents</span>
            </div>
          </div>

          {/* Result */}
          {result && (
            <div className={`${styles.result} ${result.total === 0 ? styles.resultEmpty : styles.resultSuccess}`}>
              {result.total > 0 && <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
              {result.message}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.footerMeta}>
            {previewCount !== null && (
              <span className={styles.footerCount}>
                {previewLoading ? '…' : previewCount} card{previewCount !== 1 ? 's' : ''}
              </span>
            )}
            {scopeMode === 'filters' && selectedColumnIds.size > 0 && selectedColumnIds.size < columns.length && (
              <span className={styles.footerColumns}>
                {selectedColumnIds.size} column{selectedColumnIds.size !== 1 ? 's' : ''}
              </span>
            )}
            {scopeMode === 'manual' && manualCardCount > 0 && (
              <span className={styles.footerColumns}>
                {configuredStages.length > 1
                  ? `${configuredStages.length} layers, ${configuredCardDependencies.length} rule${configuredCardDependencies.length === 1 ? '' : 's'}`
                  : `${manualCardCount} card${manualCardCount !== 1 ? 's' : ''}`}
              </span>
            )}
          </div>
          <ReasonedActionButton
            variant="primary"
            onClick={handleSubmit}
            disabled={Boolean(disabledReason)}
            disabledReason={disabledReason}
          >
            <Play size={14} />
            {submitting ? 'Starting…' : 'Run batch'}
          </ReasonedActionButton>
        </div>
      </div>
    </div>
  );
}
