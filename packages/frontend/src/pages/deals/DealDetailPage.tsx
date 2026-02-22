import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  DollarSign,
  Calendar,
  User,
  Building2,
  Contact,
  Layers,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Badge } from '../../ui';
import { api, ApiError } from '../../lib/api';
import { ActivityTimeline } from './DealActivityTimeline';
import { EditDealModal } from './EditDealModal';
import type { Deal } from './DealCard';
import type { PipelineStage } from './KanbanColumn';
import styles from './DealDetailPage.module.css';

interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

interface ContactInfo {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface CompanyInfo {
  id: string;
  name: string;
}

interface UserInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface TaskInfo {
  id: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  dueDate?: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  new: 'New',
  qualification: 'Qualification',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

const STAGE_BADGE_COLORS: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  new: 'info',
  qualification: 'default',
  proposal: 'warning',
  negotiation: 'warning',
  won: 'success',
  lost: 'error',
};

function formatCurrency(value: string, currency: string) {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getCloseDateStatus(dateStr: string): 'overdue' | 'soon' | 'normal' {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 7) return 'soon';
  return 'normal';
}

const PRIORITY_COLORS: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  low: 'default',
  medium: 'warning',
  high: 'error',
};

const STATUS_COLORS: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  pending: 'default',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
};

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [owner, setOwner] = useState<UserInfo | null>(null);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const fetchDeal = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<Deal>(`/deals/${id}`);
      setDeal(data);

      // Fetch related data in parallel
      const promises: Promise<void>[] = [];

      if (data.pipelineId) {
        promises.push(
          api<{ entries: Pipeline[] }>('/pipelines').then((res) => {
            const p = res.entries.find((pl) => pl.id === data.pipelineId);
            if (p) setPipeline(p);
          }).catch(() => {}),
        );
      }

      if (data.contactId) {
        promises.push(
          api<ContactInfo>(`/contacts/${data.contactId}`).then(setContact).catch(() => {}),
        );
      }

      if (data.companyId) {
        promises.push(
          api<CompanyInfo>(`/companies/${data.companyId}`).then(setCompany).catch(() => {}),
        );
      }

      if (data.ownerId) {
        promises.push(
          api<UserInfo>(`/users/${data.ownerId}`).then(setOwner).catch(() => {}),
        );
      }

      promises.push(
        api<{ entries: TaskInfo[] }>(`/tasks?dealId=${id}&limit=50`).then((res) => {
          setTasks(res.entries);
        }).catch(() => {}),
      );

      await Promise.all(promises);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 404 ? 'Deal not found' : err.message);
      } else {
        setError('Failed to load deal');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDeal();
  }, [fetchDeal]);

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this deal? This action cannot be undone.')) {
      return;
    }
    setDeleting(true);
    try {
      await api(`/deals/${id}`, { method: 'DELETE' });
      navigate('/deals', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to delete deal');
      }
      setDeleting(false);
    }
  }

  function handleDealUpdated(updated: Deal) {
    setDeal(updated);
    setShowEditModal(false);
    // Re-fetch related data in case contact/company/owner changed
    fetchDeal();
  }

  function getCurrentStage(): PipelineStage | undefined {
    if (!pipeline || !deal?.pipelineStageId) return undefined;
    return pipeline.stages.find((s) => s.id === deal.pipelineStageId);
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Deal" />
        <div className={styles.loadingState}>Loading deal...</div>
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div>
        <PageHeader title="Deal" />
        <Card>
          <div className={styles.errorState}>
            <p>{error || 'Deal not found'}</p>
            <Link to="/deals">
              <Button variant="secondary" size="sm">
                <ArrowLeft size={14} />
                Back to Deals
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const currentStage = getCurrentStage();
  const sortedStages = pipeline
    ? [...pipeline.stages].sort((a, b) => a.position - b.position)
    : [];

  return (
    <div>
      <PageHeader
        title={deal.title}
        description={pipeline ? `${pipeline.name} Pipeline` : undefined}
        actions={
          <div className={styles.actions}>
            <Button variant="secondary" size="md" onClick={() => setShowEditModal(true)}>
              <Edit2 size={16} />
              Edit
            </Button>
            <Button variant="secondary" size="md" onClick={handleDelete} disabled={deleting}>
              <Trash2 size={16} />
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        }
      />

      <div className={styles.backLink}>
        <Link to="/deals" className={styles.back}>
          <ArrowLeft size={14} />
          All Deals
        </Link>
      </div>

      {/* Pipeline progress */}
      {sortedStages.length > 0 && (
        <div className={styles.pipelineProgress}>
          {sortedStages.map((stage) => {
            const isCurrent = stage.id === deal.pipelineStageId;
            const currentIdx = sortedStages.findIndex((s) => s.id === deal.pipelineStageId);
            const stageIdx = sortedStages.indexOf(stage);
            const isPassed = stageIdx < currentIdx;

            return (
              <div
                key={stage.id}
                className={[
                  styles.stageStep,
                  isCurrent ? styles.stageStepActive : '',
                  isPassed ? styles.stageStepDone : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span
                  className={styles.stageStepDot}
                  style={{
                    background: isCurrent || isPassed ? stage.color : undefined,
                  }}
                />
                <span className={styles.stageStepLabel}>{stage.name}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.grid}>
        {/* Main info card */}
        <Card>
          <div className={styles.profileSection}>
            <div className={styles.dealIcon}>
              <DollarSign size={28} />
            </div>
            <div className={styles.profileInfo}>
              <h2 className={styles.dealTitle}>{deal.title}</h2>
              {deal.value ? (
                <p className={styles.dealValue}>
                  {formatCurrency(deal.value, deal.currency)}
                </p>
              ) : (
                <p className={styles.noValue}>No value set</p>
              )}
              <div className={styles.badges}>
                {currentStage ? (
                  <Badge
                    color={
                      currentStage.isWinStage
                        ? 'success'
                        : currentStage.isLossStage
                          ? 'error'
                          : 'info'
                    }
                  >
                    {currentStage.name}
                  </Badge>
                ) : (
                  <Badge color={STAGE_BADGE_COLORS[deal.stage] || 'default'}>
                    {STAGE_LABELS[deal.stage] || deal.stage}
                  </Badge>
                )}
                {deal.stage === 'won' && (
                  <Badge color="success">
                    <CheckCircle2 size={12} />
                    Won
                  </Badge>
                )}
                {deal.stage === 'lost' && (
                  <Badge color="error">
                    <XCircle size={12} />
                    Lost
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className={styles.details}>
            {contact && (
              <div className={styles.detailRow}>
                <Contact size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Contact</span>
                  <Link to={`/contacts/${contact.id}`} className={styles.detailLink}>
                    {[contact.firstName, contact.lastName].filter(Boolean).join(' ')}
                  </Link>
                  {contact.email && (
                    <span className={styles.detailMeta}>{contact.email}</span>
                  )}
                </div>
              </div>
            )}

            {company && (
              <div className={styles.detailRow}>
                <Building2 size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Company</span>
                  <span className={styles.detailValue}>{company.name}</span>
                </div>
              </div>
            )}

            {owner && (
              <div className={styles.detailRow}>
                <User size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Owner</span>
                  <span className={styles.detailValue}>
                    {owner.firstName} {owner.lastName}
                  </span>
                  <span className={styles.detailMeta}>{owner.email}</span>
                </div>
              </div>
            )}

            {deal.expectedCloseDate && (
              <div className={styles.detailRow}>
                <Calendar size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Expected Close</span>
                  <span
                    className={[
                      styles.detailValue,
                      !deal.closedAt && getCloseDateStatus(deal.expectedCloseDate) === 'overdue'
                        ? styles.overdue
                        : '',
                      !deal.closedAt && getCloseDateStatus(deal.expectedCloseDate) === 'soon'
                        ? styles.soon
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {formatDate(deal.expectedCloseDate)}
                    {!deal.closedAt && getCloseDateStatus(deal.expectedCloseDate) === 'overdue' && (
                      <AlertTriangle size={14} className={styles.warningIcon} />
                    )}
                  </span>
                </div>
              </div>
            )}

            {deal.closedAt && (
              <div className={styles.detailRow}>
                <CheckCircle2 size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Closed On</span>
                  <span className={styles.detailValue}>{formatDate(deal.closedAt)}</span>
                </div>
              </div>
            )}

            {pipeline && (
              <div className={styles.detailRow}>
                <Layers size={16} className={styles.detailIcon} />
                <div>
                  <span className={styles.detailLabel}>Pipeline</span>
                  <span className={styles.detailValue}>{pipeline.name}</span>
                </div>
              </div>
            )}

            <div className={styles.detailRow}>
              <Clock size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Created</span>
                <span className={styles.detailValue}>{formatDate(deal.createdAt)}</span>
              </div>
            </div>

            <div className={styles.detailRow}>
              <Clock size={16} className={styles.detailIcon} />
              <div>
                <span className={styles.detailLabel}>Last Updated</span>
                <span className={styles.detailValue}>{formatDate(deal.updatedAt)}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Lost reason */}
        {deal.lostReason && (
          <Card>
            <h3 className={styles.sectionTitle}>Lost Reason</h3>
            <p className={styles.lostReason}>{deal.lostReason}</p>
          </Card>
        )}

        {/* Notes */}
        {deal.notes && (
          <Card>
            <h3 className={styles.sectionTitle}>Notes</h3>
            <p className={styles.notes}>{deal.notes}</p>
          </Card>
        )}

        {/* Tasks */}
        {tasks.length > 0 && (
          <Card>
            <h3 className={styles.sectionTitle}>Tasks ({tasks.length})</h3>
            <div className={styles.taskList}>
              {tasks.map((task) => (
                <div key={task.id} className={styles.taskItem}>
                  <div className={styles.taskHeader}>
                    <span className={styles.taskTitle}>{task.title}</span>
                    <div className={styles.taskBadges}>
                      <Badge color={STATUS_COLORS[task.status] || 'default'}>
                        {task.status.replace('_', ' ')}
                      </Badge>
                      <Badge color={PRIORITY_COLORS[task.priority] || 'default'}>
                        {task.priority}
                      </Badge>
                    </div>
                  </div>
                  {task.dueDate && (
                    <span className={styles.taskDueDate}>
                      <Calendar size={12} />
                      Due {formatDate(task.dueDate)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Activity timeline */}
        <Card>
          <ActivityTimeline dealId={id!} />
        </Card>
      </div>

      {showEditModal && pipeline && (
        <EditDealModal
          deal={deal}
          pipelineId={pipeline.id}
          stages={sortedStages}
          onClose={() => setShowEditModal(false)}
          onUpdated={handleDealUpdated}
        />
      )}
    </div>
  );
}
