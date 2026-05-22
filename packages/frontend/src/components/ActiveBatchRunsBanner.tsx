import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle2, XCircle, Square, Clock, AlertTriangle, ChevronDown, ChevronUp, Minimize2, Maximize2 } from 'lucide-react';
import { AgentAvatar } from './AgentAvatar';
import { BatchProgressGrid } from './BatchProgressGrid';
import { api } from '../lib/api';
import { fetchActiveBatchRuns } from '../lib/agent-batch';
import { toast } from '../stores/toast';
import styles from './ActiveBatchRunsBanner.module.css';

interface BatchRunEntry {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  agentId: string;
  prompt: string;
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  skipped?: number;
  maxParallel?: number;
  stageCount?: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt?: string;
  sourceType?: 'board' | 'collection';
  sourceName?: string | null;
}

interface BatchRunItem {
  id: string;
  cardId: string;
  cardName: string;
  status: string;
  errorMessage: string | null;
  blockedReason?: string | null;
}

interface AgentInfo {
  id: string;
  name: string;
  avatarIcon?: string | null;
  avatarBgColor?: string | null;
  avatarLogoColor?: string | null;
}

interface ActiveBatchRunsBannerProps {
  listEndpoint: string;
  cancelEndpointPrefix: string;
  itemsEndpoint?: (runId: string) => string;
  pollInterval?: number;
  showEmpty?: boolean;
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAtMs = new Date(startedAt).getTime();
    const iv = setInterval(() => {
      setElapsedMs(Date.now() - startedAtMs);
    }, 1000);
    return () => clearInterval(iv);
  }, [startedAt]);

  const secs = Math.floor(elapsedMs / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return <>{hrs}h {mins % 60}m</>;
  if (mins > 0) return <>{mins}m {secs % 60}s</>;
  return <>{secs}s</>;
}

export function ActiveBatchRunsBanner({
  listEndpoint,
  cancelEndpointPrefix,
  itemsEndpoint,
  pollInterval = 4000,
  showEmpty = false,
}: ActiveBatchRunsBannerProps) {
  const [runs, setRuns] = useState<BatchRunEntry[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [errorItems, setErrorItems] = useState<Record<string, BatchRunItem[]>>({});
  const [runItemsMap, setRunItemsMap] = useState<Record<string, BatchRunItem[]>>({});
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const toggleMinimized = useCallback((runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const active = await fetchActiveBatchRuns<BatchRunEntry>(listEndpoint, 200);
      if (!mountedRef.current) return;
      const sorted = [...active].sort((a, b) => {
        const aTime = new Date(a.startedAt ?? a.createdAt ?? 0).getTime();
        const bTime = new Date(b.startedAt ?? b.createdAt ?? 0).getTime();
        return bTime - aTime;
      });
      setRuns(sorted);

      // Fetch per-item data for active runs to show individual card squares
      if (itemsEndpoint) {
        for (const run of sorted) {
          if (run.status === 'running' || run.status === 'queued') {
            api<{ entries: BatchRunItem[] }>(`${itemsEndpoint(run.id)}?limit=200`)
              .then((res) => {
                if (!mountedRef.current) return;
                setRunItemsMap((prev) => ({ ...prev, [run.id]: res.entries }));
              })
              .catch(() => {});
          }
        }
      }

      const agentIds = new Set(sorted.map((r) => r.agentId));
      setAgents((prev) => {
        const missing = [...agentIds].filter((id) => !prev[id]);
        if (missing.length === 0) return prev;
        for (const agentId of missing) {
          api<AgentInfo>(`/agents/${agentId}`)
            .then((agent) => {
              if (!mountedRef.current) return;
              setAgents((p) => ({ ...p, [agentId]: agent }));
            })
            .catch(() => {});
        }
        return prev;
      });
    } catch {
      // ignore polling errors
    }
  }, [listEndpoint, itemsEndpoint]);

  useEffect(() => {
    mountedRef.current = true;
    const initialPoll = setTimeout(() => {
      void fetchRuns();
    }, 0);
    pollRef.current = setInterval(fetchRuns, pollInterval);
    return () => {
      mountedRef.current = false;
      clearTimeout(initialPoll);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchRuns, pollInterval]);

  const handleCancel = useCallback(
    async (runId: string) => {
      try {
        await api(`${cancelEndpointPrefix}/${runId}/cancel`, {
          method: 'POST',
        });
        toast.info('Batch run cancelled');
        void fetchRuns();
      } catch {
        /* ignore */
      }
    },
    [cancelEndpointPrefix, fetchRuns],
  );

  const toggleErrors = useCallback(
    async (runId: string) => {
      if (expandedErrorId === runId) {
        setExpandedErrorId(null);
        return;
      }
      setExpandedErrorId(runId);
      if (!errorItems[runId] && itemsEndpoint) {
        try {
          const res = await api<{ entries: BatchRunItem[] }>(
            `${itemsEndpoint(runId)}?limit=200`,
          );
          if (mountedRef.current) {
            setErrorItems((prev) => ({
              ...prev,
              [runId]: res.entries.filter((item) => item.status === 'failed' || item.status === 'skipped'),
            }));
          }
        } catch {
          /* ignore */
        }
      }
    },
    [expandedErrorId, errorItems, itemsEndpoint],
  );

  if (runs.length === 0) {
    if (!showEmpty) return null;
    return (
      <div className={styles.emptyBanner}>
        <CheckCircle2 size={14} className={styles.emptyIcon} />
        <span>No batch runs active</span>
      </div>
    );
  }

  return (
    <div className={styles.banner}>
      {runs.map((run) => {
        const agent = agents[run.agentId];
        const isActive = run.status === 'running' || run.status === 'queued';
        const remaining = run.queued + run.processing;
        const statusCls = isActive ? styles.cardActive : run.status === 'completed' ? styles.cardCompleted : run.status === 'failed' ? styles.cardFailed : styles.cardCancelled;
        const failedItemsList = errorItems[run.id];
        const isMinimized = !expandedRuns.has(run.id);
        const skipped = run.skipped ?? 0;
        const finished = run.completed + run.failed + run.cancelled + skipped;
        const issueCount = run.failed + skipped;

        // Build per-item grid data if available
        const perItemData = runItemsMap[run.id];
        const gridItems = perItemData?.map((it) => ({
          id: it.id,
          label: it.cardName,
          status: it.status as 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped',
        }));

        if (isMinimized) {
          return (
            <div key={run.id} className={`${styles.cardMini} ${statusCls}`}>
              <div className={styles.miniLeft}>
                {agent && (
                  <AgentAvatar
                    icon={agent.avatarIcon || 'spark'}
                    bgColor={agent.avatarBgColor || '#1a1a2e'}
                    logoColor={agent.avatarLogoColor || '#e94560'}
                    size={18}
                  />
                )}
                <span className={styles.miniName}>
                  {agent?.name || run.agentId.slice(0, 8)}
                </span>
                <span className={`${styles.statusBadge} ${statusCls}`}>
                  {isActive ? (
                    <span className={styles.liveDot} />
                  ) : run.status === 'completed' ? (
                    <CheckCircle2 size={10} />
                  ) : (
                    <XCircle size={10} />
                  )}
                  {isActive ? (run.status === 'queued' ? 'Queued' : 'Running') : run.status === 'completed' ? 'Done' : run.status === 'failed' ? 'Failed' : 'Cancelled'}
                </span>
              </div>
              <div className={styles.miniRight}>
                <div className={styles.miniBar}>
                  <div className={styles.miniBarTrack}>
                    {run.completed > 0 && (
                      <div className={styles.miniBarCompleted} style={{ width: `${(run.completed / run.total) * 100}%` }} />
                    )}
                    {run.failed > 0 && (
                      <div className={styles.miniBarFailed} style={{ width: `${(run.failed / run.total) * 100}%` }} />
                    )}
                    {run.processing > 0 && (
                      <div className={styles.miniBarProcessing} style={{ width: `${(run.processing / run.total) * 100}%` }} />
                    )}
                  </div>
                </div>
                <span className={styles.miniCount}>{finished}/{run.total}</span>
                {isActive && (
                  <button
                    className={styles.cancelBtn}
                    onClick={() => void handleCancel(run.id)}
                    title="Cancel batch run"
                  >
                    <Square size={9} />
                  </button>
                )}
                <button
                  className={styles.miniToggle}
                  onClick={() => toggleMinimized(run.id)}
                  title="Expand"
                >
                  <Maximize2 size={12} />
                </button>
              </div>
            </div>
          );
        }

        return (
          <div key={run.id} className={`${styles.card} ${statusCls}`}>
            <div className={styles.cardHeader}>
              <div className={styles.agentInfo}>
                {agent && (
                  <AgentAvatar
                    icon={agent.avatarIcon || 'spark'}
                    bgColor={agent.avatarBgColor || '#1a1a2e'}
                    logoColor={agent.avatarLogoColor || '#e94560'}
                    size={22}
                  />
                )}
                <span className={styles.agentName}>
                  {agent?.name || run.agentId.slice(0, 8)}
                </span>
              </div>

              <div className={styles.headerMeta}>
                <span className={`${styles.statusBadge} ${statusCls}`}>
                  {isActive ? (
                    <span className={styles.liveDot} />
                  ) : run.status === 'completed' ? (
                    <CheckCircle2 size={12} />
                  ) : (
                    <XCircle size={12} />
                  )}
                  {isActive ? (run.status === 'queued' ? 'Queued' : 'Running') : run.status === 'completed' ? 'Done' : run.status === 'failed' ? 'Failed' : 'Cancelled'}
                </span>

                <button
                  className={styles.miniToggle}
                  onClick={() => toggleMinimized(run.id)}
                  title="Minimize"
                >
                  <Minimize2 size={13} />
                </button>

                {isActive && (
                  <button
                    className={styles.cancelBtn}
                    onClick={() => void handleCancel(run.id)}
                    title="Cancel batch run"
                  >
                    <Square size={10} />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.prompt} title={run.prompt}>
              {run.prompt}
            </div>

            {(run.stageCount ?? 0) > 0 && (
              <div className={styles.metaRow}>
                <span className={styles.metaChip}>
                  {run.stageCount} layer{run.stageCount === 1 ? '' : 's'}
                </span>
              </div>
            )}

            <div className={styles.progressSection}>
              <BatchProgressGrid
                items={gridItems}
                counts={!gridItems ? {
                  queued: run.queued,
                  processing: run.processing,
                  completed: run.completed,
                  failed: run.failed,
                  cancelled: run.cancelled,
                  skipped,
                } : undefined}
                total={run.total}
                cellSize={8}
                showLegend={false}
              />

              <div className={styles.statsRow}>
                {isActive ? (
                  <span className={styles.statRemaining}>{remaining} left</span>
                ) : (
                  <span className={styles.statRemaining}>
                    {run.status === 'completed' ? 'All done' : run.status === 'cancelled' ? 'Cancelled' : 'Failed'}
                  </span>
                )}
                <span className={styles.statDetails}>
                  {run.completed > 0 && (
                    <span className={styles.statDone}>{run.completed} done</span>
                  )}
                  {run.processing > 0 && (
                    <span className={styles.statProcessing}>{run.processing} running</span>
                  )}
                  {run.failed > 0 && (
                    <span className={styles.statFailed}>{run.failed} failed</span>
                  )}
                  {skipped > 0 && (
                    <span className={styles.statSkipped}>{skipped} skipped</span>
                  )}
                </span>
                <span className={styles.statTotal}>
                  {finished}/{run.total}
                </span>
              </div>
            </div>

            {run.startedAt && (
              <div className={styles.elapsedRow}>
                <Clock size={11} />
                <ElapsedTimer startedAt={run.startedAt} />
                {run.maxParallel && (
                  <span className={styles.parallelHint}>{run.maxParallel}x parallel</span>
                )}
              </div>
            )}

            {issueCount > 0 && itemsEndpoint && (
              <>
                <button
                  className={styles.errorToggle}
                  onClick={() => void toggleErrors(run.id)}
                >
                  <AlertTriangle size={12} />
                  {expandedErrorId === run.id ? 'Hide issues' : `Show ${issueCount} issue${issueCount === 1 ? '' : 's'}`}
                  {expandedErrorId === run.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {expandedErrorId === run.id && failedItemsList && (
                  <div className={styles.errorList}>
                    {failedItemsList.map((item) => (
                      <div
                        key={item.id}
                        className={`${styles.errorItem} ${item.status === 'skipped' ? styles.errorItemSkipped : ''}`}
                      >
                        <span className={styles.errorItemName}>{item.cardName}</span>
                        {(item.errorMessage || item.blockedReason) && (
                          <pre className={styles.errorItemMsg}>{item.errorMessage || item.blockedReason}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
