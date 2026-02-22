import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { KanbanColumn, type PipelineStage } from './KanbanColumn';
import { CreateDealModal } from './CreateDealModal';
import type { Deal } from './DealCard';
import styles from './KanbanBoard.module.css';

interface Pipeline {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  stages: PipelineStage[];
}

interface PipelinesResponse {
  total: number;
  entries: Pipeline[];
}

interface DealsResponse {
  total: number;
  entries: Deal[];
}

export function KanbanBoard() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createModalStageId, setCreateModalStageId] = useState<string | null>(null);
  const dragDealRef = useRef<Deal | null>(null);

  // Fetch pipelines on mount
  const fetchPipelines = useCallback(async () => {
    try {
      const data = await api<PipelinesResponse>('/pipelines');
      setPipelines(data.entries);

      if (data.entries.length > 0) {
        const defaultPipeline = data.entries.find((p) => p.isDefault) || data.entries[0];
        setSelectedPipelineId(defaultPipeline.id);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load pipelines');
      }
    }
  }, []);

  // Fetch deals for selected pipeline
  const fetchDeals = useCallback(async () => {
    if (!selectedPipelineId) return;

    setLoading(true);
    setError('');
    try {
      const data = await api<DealsResponse>(
        `/deals?pipelineId=${selectedPipelineId}&limit=500`,
      );
      setDeals(data.entries);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load deals');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedPipelineId]);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (selectedPipelineId) {
      fetchDeals();
    }
  }, [selectedPipelineId, fetchDeals]);

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const sortedStages = useMemo(
    () =>
      selectedPipeline
        ? [...selectedPipeline.stages].sort((a, b) => a.position - b.position)
        : [],
    [selectedPipeline],
  );

  // Group deals by stage (memoized map)
  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const deal of deals) {
      const stageId = deal.pipelineStageId || '';
      const arr = map.get(stageId);
      if (arr) {
        arr.push(deal);
      } else {
        map.set(stageId, [deal]);
      }
    }
    // Sort each group by stageOrder
    for (const arr of map.values()) {
      arr.sort((a, b) => a.stageOrder - b.stageOrder);
    }
    return map;
  }, [deals]);

  function getDealsByStage(stageId: string): Deal[] {
    return dealsByStage.get(stageId) || [];
  }

  // Total pipeline value
  const totalValue = useMemo(
    () => deals.reduce((sum, d) => sum + (d.value ? parseFloat(d.value) : 0), 0),
    [deals],
  );

  // Drag and drop handlers
  function handleDragStart(e: React.DragEvent, deal: Deal) {
    dragDealRef.current = deal;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', deal.id);
    // Add dragging class to the card
    const target = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => {
      target.classList.add(styles.dragging || '');
    });
  }

  function handleDragEnd(e: React.DragEvent) {
    dragDealRef.current = null;
    const target = e.currentTarget as HTMLElement;
    target.classList.remove(styles.dragging || '');
  }

  async function handleDrop(_e: React.DragEvent, targetStageId: string) {
    const deal = dragDealRef.current;
    if (!deal) return;
    if (deal.pipelineStageId === targetStageId) return;

    // Optimistic update
    const previousDeals = [...deals];
    setDeals((prev) =>
      prev.map((d) =>
        d.id === deal.id ? { ...d, pipelineStageId: targetStageId } : d,
      ),
    );

    try {
      await api(`/deals/${deal.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ pipelineStageId: targetStageId }),
      });
    } catch (err) {
      // Rollback on failure
      setDeals(previousDeals);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to move deal');
      }
    }
  }

  function handleAddDeal(stageId: string) {
    setCreateModalStageId(stageId);
  }

  function handleDealCreated(deal: Deal) {
    setDeals((prev) => [...prev, deal]);
    setCreateModalStageId(null);
  }

  return (
    <div className={styles.wrapper}>
      <PageHeader
        title="Deals"
        description="Pipeline and deal management"
        actions={
          <Button
            size="md"
            onClick={() => setCreateModalStageId(sortedStages[0]?.id || '')}
            disabled={!selectedPipeline}
          >
            <Plus size={16} />
            Add Deal
          </Button>
        }
      />

      {pipelines.length > 0 && (
        <div className={styles.toolbar}>
          <select
            className={styles.pipelineSelect}
            value={selectedPipelineId}
            onChange={(e) => setSelectedPipelineId(e.target.value)}
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className={styles.summary}>
            <span>
              {deals.length} deal{deals.length !== 1 ? 's' : ''}
            </span>
            {totalValue > 0 && (
              <span>
                Total:{' '}
                <span className={styles.summaryValue}>
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  }).format(totalValue)}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {error && <div className={styles.alert}>{error}</div>}

      {loading ? (
        <div className={styles.loadingState}>Loading pipeline...</div>
      ) : pipelines.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No pipelines configured yet.</p>
          <p>Create a pipeline to start managing deals.</p>
        </div>
      ) : (
        <div className={styles.board}>
          {sortedStages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              deals={getDealsByStage(stage.id)}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              onAddDeal={handleAddDeal}
            />
          ))}
        </div>
      )}

      {createModalStageId !== null && selectedPipeline && (
        <CreateDealModal
          pipelineId={selectedPipeline.id}
          stages={sortedStages}
          initialStageId={createModalStageId}
          onClose={() => setCreateModalStageId(null)}
          onCreated={handleDealCreated}
        />
      )}
    </div>
  );
}
