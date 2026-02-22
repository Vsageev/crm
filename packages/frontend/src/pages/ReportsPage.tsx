import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Download,
  TrendingUp,
  Users,
  Target,
  DollarSign,
  Clock,
  ArrowRight,
  Trophy,
  MessageSquare,
  Send,
} from 'lucide-react';
import { PageHeader } from '../layout';
import { api, ApiError, getAccessToken } from '../lib/api';
import styles from './ReportsPage.module.css';

// ─── Pipeline Summary types ──────────────────────────────────────────────────

interface StageSummary {
  stageId: string;
  stageName: string;
  stageColor: string;
  position: number;
  isWinStage: boolean;
  isLossStage: boolean;
  dealCount: number;
  totalValue: number;
  avgValue: number;
}

interface PipelineSummary {
  pipeline: {
    id: string;
    name: string;
    description: string | null;
  };
  stages: StageSummary[];
  totals: {
    totalDeals: number;
    totalValue: number;
    openDeals: number;
    openValue: number;
    wonDeals: number;
    wonValue: number;
    lostDeals: number;
    lostValue: number;
  };
}

interface PipelineOption {
  pipelineId: string;
  pipelineName: string;
  totalDeals: number;
  totalValue: number;
  wonDeals: number;
  wonValue: number;
}

interface PipelinesOverviewResponse {
  entries: PipelineOption[];
}

// ─── Agent Performance types ─────────────────────────────────────────────────

interface AgentPerformance {
  agentId: string;
  agentName: string;
  agentEmail: string;
  totalDeals: number;
  wonDeals: number;
  lostDeals: number;
  openDeals: number;
  totalValue: number;
  wonValue: number;
  winRate: number;
  avgDealValue: number;
  avgResponseTimeMinutes: number | null;
  conversationCount: number;
  messagesSent: number;
}

interface AgentPerformanceSummary {
  agents: AgentPerformance[];
  totals: {
    totalDeals: number;
    wonDeals: number;
    lostDeals: number;
    totalValue: number;
    wonValue: number;
    avgWinRate: number;
    avgResponseTimeMinutes: number | null;
  };
}

// ─── Lead Source Breakdown types ─────────────────────────────────────────────

interface LeadSourceEntry {
  source: string;
  contactCount: number;
  dealCount: number;
  totalDealValue: number;
  wonDeals: number;
  wonValue: number;
  conversionRate: number;
}

interface LeadSourceBreakdown {
  bySource: LeadSourceEntry[];
  byUtmSource: LeadSourceEntry[];
  byUtmMedium: LeadSourceEntry[];
  byUtmCampaign: LeadSourceEntry[];
  totals: {
    totalContacts: number;
    totalDeals: number;
    totalDealValue: number;
    wonDeals: number;
    wonValue: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatResponseTime(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  csv_import: 'CSV Import',
  web_form: 'Web Form',
  telegram: 'Telegram',
  email: 'Email',
  api: 'API',
  other: 'Other',
  direct: 'Direct',
};

function formatSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

async function downloadCsv(path: string, filename: string) {
  const token = getAccessToken();
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Tab = 'dashboard' | 'pipeline' | 'agents' | 'lead-sources';

// ─── Component ───────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  return (
    <div className={styles.wrapper}>
      <PageHeader
        title="Reports"
        description="Pipeline summary, performance analytics, and lead source insights"
      />

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'dashboard' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'pipeline' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('pipeline')}
        >
          Pipeline Summary
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'agents' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('agents')}
        >
          Agent Performance
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'lead-sources' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('lead-sources')}
        >
          Lead Sources
        </button>
      </div>

      {activeTab === 'dashboard' && <DashboardOverview onNavigate={setActiveTab} />}
      {activeTab === 'pipeline' && <PipelineReport />}
      {activeTab === 'agents' && <AgentPerformanceReport />}
      {activeTab === 'lead-sources' && <LeadSourceReport />}
    </div>
  );
}

// ─── Dashboard Overview ─────────────────────────────────────────────────────

function DashboardOverview({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [pipelineData, setPipelineData] = useState<PipelinesOverviewResponse | null>(null);
  const [firstPipeline, setFirstPipeline] = useState<PipelineSummary | null>(null);
  const [agentData, setAgentData] = useState<AgentPerformanceSummary | null>(null);
  const [leadData, setLeadData] = useState<LeadSourceBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pipelines, agents, leads] = await Promise.all([
        api<PipelinesOverviewResponse>('/reports/pipelines'),
        api<AgentPerformanceSummary>('/reports/agent-performance'),
        api<LeadSourceBreakdown>('/reports/lead-sources'),
      ]);
      setPipelineData(pipelines);
      setAgentData(agents);
      setLeadData(leads);

      if (pipelines.entries.length > 0) {
        const detail = await api<PipelineSummary>(
          `/reports/pipelines/${pipelines.entries[0].pipelineId}`,
        );
        setFirstPipeline(detail);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load dashboard data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const totalDeals = useMemo(() => pipelineData?.entries.reduce((s, p) => s + p.totalDeals, 0) ?? 0, [pipelineData]);
  const totalRevenue = useMemo(() => pipelineData?.entries.reduce((s, p) => s + p.wonValue, 0) ?? 0, [pipelineData]);
  const totalPipelineValue = useMemo(() => pipelineData?.entries.reduce((s, p) => s + p.totalValue, 0) ?? 0, [pipelineData]);
  const totalWonDeals = useMemo(() => pipelineData?.entries.reduce((s, p) => s + p.wonDeals, 0) ?? 0, [pipelineData]);
  const overallWinRate = agentData?.totals.avgWinRate ?? 0;
  const totalContacts = leadData?.totals.totalContacts ?? 0;
  const avgResponseTime = agentData?.totals.avgResponseTimeMinutes ?? null;

  const topAgents = useMemo(
    () => agentData ? [...agentData.agents].sort((a, b) => b.wonValue - a.wonValue).slice(0, 5) : [],
    [agentData],
  );

  const topSources = useMemo(
    () => leadData ? [...leadData.bySource].sort((a, b) => b.contactCount - a.contactCount).slice(0, 6) : [],
    [leadData],
  );
  const maxSourceContacts = useMemo(() => topSources.reduce((max, s) => Math.max(max, s.contactCount), 0), [topSources]);

  const stages = firstPipeline?.stages ?? [];
  const maxStageDealCount = useMemo(() => stages.reduce((max, s) => Math.max(max, s.dealCount), 0), [stages]);

  if (loading) {
    return <div className={styles.loadingState}>Loading dashboard...</div>;
  }

  if (error) {
    return <div className={styles.alert}>{error}</div>;
  }

  return (
    <>
      {/* KPI Cards */}
      <div className={styles.dashKpiGrid}>
        <div className={styles.dashKpiCard}>
          <div className={styles.dashKpiIcon} style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-link)' }}>
            <Target size={20} />
          </div>
          <div className={styles.dashKpiContent}>
            <div className={styles.dashKpiValue}>{totalDeals}</div>
            <div className={styles.dashKpiLabel}>Total Deals</div>
          </div>
        </div>
        <div className={styles.dashKpiCard}>
          <div className={styles.dashKpiIcon} style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)' }}>
            <DollarSign size={20} />
          </div>
          <div className={styles.dashKpiContent}>
            <div className={styles.dashKpiValue}>{formatCurrency(totalRevenue)}</div>
            <div className={styles.dashKpiLabel}>Won Revenue</div>
          </div>
        </div>
        <div className={styles.dashKpiCard}>
          <div className={styles.dashKpiIcon} style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8B5CF6' }}>
            <TrendingUp size={20} />
          </div>
          <div className={styles.dashKpiContent}>
            <div className={styles.dashKpiValue}>{formatCurrency(totalPipelineValue)}</div>
            <div className={styles.dashKpiLabel}>Pipeline Value</div>
          </div>
        </div>
        <div className={styles.dashKpiCard}>
          <div className={styles.dashKpiIcon} style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)' }}>
            <Trophy size={20} />
          </div>
          <div className={styles.dashKpiContent}>
            <div className={styles.dashKpiValue}>{overallWinRate}%</div>
            <div className={styles.dashKpiLabel}>Win Rate ({totalWonDeals} won)</div>
          </div>
        </div>
        <div className={styles.dashKpiCard}>
          <div className={styles.dashKpiIcon} style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-link)' }}>
            <Users size={20} />
          </div>
          <div className={styles.dashKpiContent}>
            <div className={styles.dashKpiValue}>{totalContacts}</div>
            <div className={styles.dashKpiLabel}>Total Contacts</div>
          </div>
        </div>
        <div className={styles.dashKpiCard}>
          <div className={styles.dashKpiIcon} style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--color-warning)' }}>
            <Clock size={20} />
          </div>
          <div className={styles.dashKpiContent}>
            <div className={styles.dashKpiValue}>{formatResponseTime(avgResponseTime)}</div>
            <div className={styles.dashKpiLabel}>Avg Response Time</div>
          </div>
        </div>
      </div>

      {/* Two-column: Pipeline Funnel + Top Agents */}
      <div className={styles.dashGrid}>
        <div className={styles.dashCard}>
          <div className={styles.dashCardHeader}>
            <h2 className={styles.dashCardTitle}>
              Pipeline Stages
              {firstPipeline && (
                <span className={styles.dashCardSubtitle}>{firstPipeline.pipeline.name}</span>
              )}
            </h2>
            <button className={styles.dashViewAll} onClick={() => onNavigate('pipeline')}>
              View details <ArrowRight size={14} />
            </button>
          </div>
          {stages.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No pipeline data available.</p>
            </div>
          ) : (
            <div className={styles.funnelList}>
              {stages.map((stage) => {
                const pct = maxStageDealCount > 0 ? (stage.dealCount / maxStageDealCount) * 100 : 0;
                return (
                  <div key={stage.stageId} className={styles.funnelRow}>
                    <div className={styles.funnelLabel}>
                      <span
                        className={styles.stageColor}
                        style={{ backgroundColor: stage.stageColor }}
                      />
                      <span className={styles.funnelStageName}>{stage.stageName}</span>
                      {stage.isWinStage && (
                        <span className={`${styles.stageBadge} ${styles.wonBadge}`}>Won</span>
                      )}
                      {stage.isLossStage && (
                        <span className={`${styles.stageBadge} ${styles.lostBadge}`}>Lost</span>
                      )}
                    </div>
                    <div className={styles.funnelBarArea}>
                      <div className={styles.funnelBarTrack}>
                        <div
                          className={styles.funnelBarFill}
                          style={{
                            width: `${pct}%`,
                            backgroundColor: stage.stageColor,
                          }}
                        />
                      </div>
                      <span className={styles.funnelCount}>{stage.dealCount}</span>
                      <span className={styles.funnelValue}>{formatCurrency(stage.totalValue)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.dashCard}>
          <div className={styles.dashCardHeader}>
            <h2 className={styles.dashCardTitle}>Top Agents</h2>
            <button className={styles.dashViewAll} onClick={() => onNavigate('agents')}>
              View all <ArrowRight size={14} />
            </button>
          </div>
          {topAgents.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No agent data available.</p>
            </div>
          ) : (
            <div className={styles.agentLeaderboard}>
              {topAgents.map((agent, index) => (
                <div key={agent.agentId} className={styles.leaderRow}>
                  <span className={styles.leaderRank}>#{index + 1}</span>
                  <span className={styles.avatar}>{getInitials(agent.agentName)}</span>
                  <div className={styles.leaderInfo}>
                    <span className={styles.leaderName}>{agent.agentName}</span>
                    <span className={styles.leaderMeta}>
                      {agent.wonDeals} won &middot; {agent.winRate}% rate
                    </span>
                  </div>
                  <div className={styles.leaderValue}>{formatCurrency(agent.wonValue)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Second row: Lead Sources + Activity Summary */}
      <div className={styles.dashGrid}>
        <div className={styles.dashCard}>
          <div className={styles.dashCardHeader}>
            <h2 className={styles.dashCardTitle}>Lead Sources</h2>
            <button className={styles.dashViewAll} onClick={() => onNavigate('lead-sources')}>
              View details <ArrowRight size={14} />
            </button>
          </div>
          {topSources.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No lead source data available.</p>
            </div>
          ) : (
            <div className={styles.sourceChart}>
              {topSources.map((source) => {
                const pct = maxSourceContacts > 0
                  ? (source.contactCount / maxSourceContacts) * 100
                  : 0;
                return (
                  <div key={source.source} className={styles.sourceRow}>
                    <div className={styles.sourceRowLabel}>
                      <span className={styles.sourceLabel}>{formatSourceLabel(source.source)}</span>
                      <span className={styles.sourceCount}>{source.contactCount} contacts</span>
                    </div>
                    <div className={styles.sourceBarTrack}>
                      <div
                        className={styles.sourceBarFill}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className={styles.sourceConversion}>
                      {source.conversionRate}% conv.
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.dashCard}>
          <div className={styles.dashCardHeader}>
            <h2 className={styles.dashCardTitle}>Activity Summary</h2>
          </div>
          <div className={styles.activityGrid}>
            <div className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-link)' }}>
                <MessageSquare size={16} />
              </div>
              <div className={styles.activityContent}>
                <div className={styles.activityValue}>
                  {agentData?.agents.reduce((s, a) => s + a.conversationCount, 0) ?? 0}
                </div>
                <div className={styles.activityLabel}>Conversations</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8B5CF6' }}>
                <Send size={16} />
              </div>
              <div className={styles.activityContent}>
                <div className={styles.activityValue}>
                  {agentData?.agents.reduce((s, a) => s + a.messagesSent, 0) ?? 0}
                </div>
                <div className={styles.activityLabel}>Messages Sent</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--color-success)' }}>
                <Target size={16} />
              </div>
              <div className={styles.activityContent}>
                <div className={styles.activityValue}>{totalWonDeals}</div>
                <div className={styles.activityLabel}>Deals Won</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)' }}>
                <Target size={16} />
              </div>
              <div className={styles.activityContent}>
                <div className={styles.activityValue}>{agentData?.totals.lostDeals ?? 0}</div>
                <div className={styles.activityLabel}>Deals Lost</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--color-warning)' }}>
                <Users size={16} />
              </div>
              <div className={styles.activityContent}>
                <div className={styles.activityValue}>{agentData?.agents.length ?? 0}</div>
                <div className={styles.activityLabel}>Active Agents</div>
              </div>
            </div>
            <div className={styles.activityItem}>
              <div className={styles.activityIcon} style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-link)' }}>
                <DollarSign size={16} />
              </div>
              <div className={styles.activityContent}>
                <div className={styles.activityValue}>
                  {totalDeals > 0 ? formatCurrency(totalPipelineValue / totalDeals) : '$0'}
                </div>
                <div className={styles.activityLabel}>Avg Deal Size</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Pipeline Report (existing) ──────────────────────────────────────────────

function PipelineReport() {
  const [pipelineOptions, setPipelineOptions] = useState<PipelineOption[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchPipelinesOverview = useCallback(async () => {
    try {
      const data = await api<PipelinesOverviewResponse>('/reports/pipelines');
      setPipelineOptions(data.entries);
      if (data.entries.length > 0) {
        setSelectedPipelineId(data.entries[0].pipelineId);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load pipelines');
      }
    }
  }, []);

  const fetchPipelineSummary = useCallback(async () => {
    if (!selectedPipelineId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api<PipelineSummary>(
        `/reports/pipelines/${selectedPipelineId}`,
      );
      setSummary(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load pipeline report');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedPipelineId]);

  useEffect(() => {
    fetchPipelinesOverview();
  }, [fetchPipelinesOverview]);

  useEffect(() => {
    if (selectedPipelineId) {
      fetchPipelineSummary();
    }
  }, [selectedPipelineId, fetchPipelineSummary]);

  const maxDealCount =
    summary?.stages.reduce((max, s) => Math.max(max, s.dealCount), 0) ?? 0;

  const winRate =
    summary && summary.totals.totalDeals > 0
      ? ((summary.totals.wonDeals / summary.totals.totalDeals) * 100).toFixed(1)
      : '0';

  return (
    <>
      {pipelineOptions.length > 0 && (
        <div className={styles.toolbar}>
          <select
            className={styles.pipelineSelect}
            value={selectedPipelineId}
            onChange={(e) => setSelectedPipelineId(e.target.value)}
          >
            {pipelineOptions.map((p) => (
              <option key={p.pipelineId} value={p.pipelineId}>
                {p.pipelineName}
              </option>
            ))}
          </select>
          {summary && (
            <button
              className={styles.exportBtn}
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadCsv(
                    `/reports/pipelines/${selectedPipelineId}/export/csv`,
                    'pipeline-summary.csv',
                  );
                } catch {
                  setError('Failed to export CSV');
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download size={14} />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          )}
        </div>
      )}

      {error && <div className={styles.alert}>{error}</div>}

      {loading ? (
        <div className={styles.loadingState}>Loading report...</div>
      ) : !summary ? (
        <div className={styles.emptyState}>
          <p>No pipeline data available.</p>
          <p>Create a pipeline and add deals to see reports.</p>
        </div>
      ) : (
        <>
          <div className={styles.summaryCards}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Total Deals</div>
              <div className={styles.summaryValue}>
                {summary.totals.totalDeals}
              </div>
              <div className={styles.summarySubtext}>
                {formatCurrency(summary.totals.totalValue)} total value
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Open Deals</div>
              <div className={styles.summaryValue}>
                {summary.totals.openDeals}
              </div>
              <div className={styles.summarySubtext}>
                {formatCurrency(summary.totals.openValue)} in pipeline
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Won Deals</div>
              <div className={styles.summaryValue} style={{ color: 'var(--color-success)' }}>
                {summary.totals.wonDeals}
              </div>
              <div className={styles.summarySubtext}>
                {formatCurrency(summary.totals.wonValue)} revenue
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Win Rate</div>
              <div className={styles.summaryValue}>{winRate}%</div>
              <div className={styles.summarySubtext}>
                {summary.totals.lostDeals} lost ({formatCurrency(summary.totals.lostValue)})
              </div>
            </div>
          </div>

          <div>
            <h2 className={styles.sectionTitle}>Deals by Stage</h2>
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Deals</th>
                    <th className={styles.barCell}>Distribution</th>
                    <th>Total Value</th>
                    <th>Avg Value</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.stages.map((stage) => {
                    const pct =
                      maxDealCount > 0
                        ? (stage.dealCount / maxDealCount) * 100
                        : 0;
                    const pctOfTotal =
                      summary.totals.totalDeals > 0
                        ? (
                            (stage.dealCount / summary.totals.totalDeals) *
                            100
                          ).toFixed(1)
                        : '0';

                    return (
                      <tr key={stage.stageId}>
                        <td>
                          <div className={styles.stageNameCell}>
                            <span
                              className={styles.stageColor}
                              style={{ backgroundColor: stage.stageColor }}
                            />
                            {stage.stageName}
                            {stage.isWinStage && (
                              <span
                                className={`${styles.stageBadge} ${styles.wonBadge}`}
                              >
                                Won
                              </span>
                            )}
                            {stage.isLossStage && (
                              <span
                                className={`${styles.stageBadge} ${styles.lostBadge}`}
                              >
                                Lost
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{stage.dealCount}</td>
                        <td className={styles.barCell}>
                          <div className={styles.barContainer}>
                            <div
                              className={styles.bar}
                              style={{
                                width: `${pct}%`,
                                backgroundColor: stage.stageColor,
                              }}
                            />
                            <span className={styles.barPercent}>
                              {pctOfTotal}%
                            </span>
                          </div>
                        </td>
                        <td>{formatCurrency(stage.totalValue)}</td>
                        <td>{formatCurrency(stage.avgValue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td>{summary.totals.totalDeals}</td>
                    <td />
                    <td>{formatCurrency(summary.totals.totalValue)}</td>
                    <td>
                      {summary.totals.totalDeals > 0
                        ? formatCurrency(
                            summary.totals.totalValue /
                              summary.totals.totalDeals,
                          )
                        : formatCurrency(0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Agent Performance Report ────────────────────────────────────────────────

function AgentPerformanceReport() {
  const [data, setData] = useState<AgentPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const qs = params.toString();
      const result = await api<AgentPerformanceSummary>(
        `/reports/agent-performance${qs ? `?${qs}` : ''}`,
      );
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load agent performance report');
      }
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>From</label>
          <input
            type="date"
            className={styles.filterInput}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>To</label>
          <input
            type="date"
            className={styles.filterInput}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        {(startDate || endDate) && (
          <button
            className={styles.clearBtn}
            onClick={() => {
              setStartDate('');
              setEndDate('');
            }}
          >
            Clear
          </button>
        )}
        {data && data.agents.length > 0 && (
          <button
            className={styles.exportBtn}
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                const params = new URLSearchParams();
                if (startDate) params.set('startDate', startDate);
                if (endDate) params.set('endDate', endDate);
                const qs = params.toString();
                await downloadCsv(
                  `/reports/agent-performance/export/csv${qs ? `?${qs}` : ''}`,
                  'agent-performance.csv',
                );
              } catch {
                setError('Failed to export CSV');
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={14} />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        )}
      </div>

      {error && <div className={styles.alert}>{error}</div>}

      {loading ? (
        <div className={styles.loadingState}>Loading agent performance...</div>
      ) : !data || data.agents.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No agent activity found for the selected period.</p>
          <p>Agents will appear here once they have deals or conversations.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className={styles.summaryCards}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Total Deals</div>
              <div className={styles.summaryValue}>{data.totals.totalDeals}</div>
              <div className={styles.summarySubtext}>
                {formatCurrency(data.totals.totalValue)} total value
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Won Deals</div>
              <div className={styles.summaryValue} style={{ color: 'var(--color-success)' }}>
                {data.totals.wonDeals}
              </div>
              <div className={styles.summarySubtext}>
                {formatCurrency(data.totals.wonValue)} revenue
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Avg Win Rate</div>
              <div className={styles.summaryValue}>{data.totals.avgWinRate}%</div>
              <div className={styles.summarySubtext}>
                {data.totals.lostDeals} deals lost
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Avg Response Time</div>
              <div className={styles.summaryValue}>
                {formatResponseTime(data.totals.avgResponseTimeMinutes)}
              </div>
              <div className={styles.summarySubtext}>
                across all agents
              </div>
            </div>
          </div>

          {/* Agent table */}
          <div>
            <h2 className={styles.sectionTitle}>Performance by Agent</h2>
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Deals</th>
                    <th>Won</th>
                    <th>Lost</th>
                    <th>Win Rate</th>
                    <th>Won Value</th>
                    <th>Avg Deal</th>
                    <th>Response Time</th>
                    <th>Conversations</th>
                    <th>Msgs Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((agent) => (
                    <tr key={agent.agentId}>
                      <td>
                        <div className={styles.agentCell}>
                          <span className={styles.avatar}>
                            {getInitials(agent.agentName)}
                          </span>
                          <div className={styles.agentInfo}>
                            <span className={styles.agentName}>{agent.agentName}</span>
                            <span className={styles.agentEmail}>{agent.agentEmail}</span>
                          </div>
                        </div>
                      </td>
                      <td className={styles.numCell}>{agent.totalDeals}</td>
                      <td className={styles.numCell} style={{ color: 'var(--color-success)' }}>
                        {agent.wonDeals}
                      </td>
                      <td className={styles.numCell} style={{ color: 'var(--color-error)' }}>
                        {agent.lostDeals}
                      </td>
                      <td>
                        <div className={styles.winRateCell}>
                          <div className={styles.winRateTrack}>
                            <div
                              className={styles.winRateFill}
                              style={{ width: `${agent.winRate}%` }}
                            />
                          </div>
                          <span className={styles.winRateLabel}>{agent.winRate}%</span>
                        </div>
                      </td>
                      <td className={styles.numCell}>{formatCurrency(agent.wonValue)}</td>
                      <td className={styles.numCell}>{formatCurrency(agent.avgDealValue)}</td>
                      <td className={styles.numCell}>
                        {formatResponseTime(agent.avgResponseTimeMinutes)}
                      </td>
                      <td className={styles.numCell}>{agent.conversationCount}</td>
                      <td className={styles.numCell}>{agent.messagesSent}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total ({data.agents.length} agents)</td>
                    <td className={styles.numCell}>{data.totals.totalDeals}</td>
                    <td className={styles.numCell}>{data.totals.wonDeals}</td>
                    <td className={styles.numCell}>{data.totals.lostDeals}</td>
                    <td>
                      <div className={styles.winRateCell}>
                        <div className={styles.winRateTrack}>
                          <div
                            className={styles.winRateFill}
                            style={{ width: `${data.totals.avgWinRate}%` }}
                          />
                        </div>
                        <span className={styles.winRateLabel}>{data.totals.avgWinRate}%</span>
                      </div>
                    </td>
                    <td className={styles.numCell}>{formatCurrency(data.totals.wonValue)}</td>
                    <td />
                    <td className={styles.numCell}>
                      {formatResponseTime(data.totals.avgResponseTimeMinutes)}
                    </td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Lead Source Report ─────────────────────────────────────────────────────

type UtmTab = 'source' | 'utm_source' | 'utm_medium' | 'utm_campaign';

function LeadSourceReport() {
  const [data, setData] = useState<LeadSourceBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [utmTab, setUtmTab] = useState<UtmTab>('source');
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const qs = params.toString();
      const result = await api<LeadSourceBreakdown>(
        `/reports/lead-sources${qs ? `?${qs}` : ''}`,
      );
      setData(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load lead source report');
      }
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const entries =
    data === null
      ? []
      : utmTab === 'source'
        ? data.bySource
        : utmTab === 'utm_source'
          ? data.byUtmSource
          : utmTab === 'utm_medium'
            ? data.byUtmMedium
            : data.byUtmCampaign;

  const maxContacts = entries.reduce((max, e) => Math.max(max, e.contactCount), 0);

  const overallConversion =
    data && data.totals.totalContacts > 0
      ? Math.round((data.totals.totalDeals / data.totals.totalContacts) * 100)
      : 0;

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>From</label>
          <input
            type="date"
            className={styles.filterInput}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>To</label>
          <input
            type="date"
            className={styles.filterInput}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        {(startDate || endDate) && (
          <button
            className={styles.clearBtn}
            onClick={() => {
              setStartDate('');
              setEndDate('');
            }}
          >
            Clear
          </button>
        )}
        {data && data.bySource.length > 0 && (
          <button
            className={styles.exportBtn}
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                const params = new URLSearchParams();
                if (startDate) params.set('startDate', startDate);
                if (endDate) params.set('endDate', endDate);
                const qs = params.toString();
                await downloadCsv(
                  `/reports/lead-sources/export/csv${qs ? `?${qs}` : ''}`,
                  'lead-sources.csv',
                );
              } catch {
                setError('Failed to export CSV');
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={14} />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        )}
      </div>

      {error && <div className={styles.alert}>{error}</div>}

      {loading ? (
        <div className={styles.loadingState}>Loading lead source data...</div>
      ) : !data || (data.bySource.length === 0 && data.totals.totalContacts === 0) ? (
        <div className={styles.emptyState}>
          <p>No lead source data found for the selected period.</p>
          <p>Leads will appear here once contacts are created from various sources.</p>
        </div>
      ) : (
        <>
          <div className={styles.summaryCards}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Total Contacts</div>
              <div className={styles.summaryValue}>{data.totals.totalContacts}</div>
              <div className={styles.summarySubtext}>from all sources</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Total Deals</div>
              <div className={styles.summaryValue}>{data.totals.totalDeals}</div>
              <div className={styles.summarySubtext}>
                {formatCurrency(data.totals.totalDealValue)} total value
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Won Deals</div>
              <div className={styles.summaryValue} style={{ color: 'var(--color-success)' }}>
                {data.totals.wonDeals}
              </div>
              <div className={styles.summarySubtext}>
                {formatCurrency(data.totals.wonValue)} revenue
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>Conversion Rate</div>
              <div className={styles.summaryValue}>{overallConversion}%</div>
              <div className={styles.summarySubtext}>contacts to deals</div>
            </div>
          </div>

          <div>
            <h2 className={styles.sectionTitle}>Breakdown</h2>
            <div className={styles.subtabs}>
              <button
                className={`${styles.subtab} ${utmTab === 'source' ? styles.subtabActive : ''}`}
                onClick={() => setUtmTab('source')}
              >
                By Source
              </button>
              <button
                className={`${styles.subtab} ${utmTab === 'utm_source' ? styles.subtabActive : ''}`}
                onClick={() => setUtmTab('utm_source')}
              >
                UTM Source
              </button>
              <button
                className={`${styles.subtab} ${utmTab === 'utm_medium' ? styles.subtabActive : ''}`}
                onClick={() => setUtmTab('utm_medium')}
              >
                UTM Medium
              </button>
              <button
                className={`${styles.subtab} ${utmTab === 'utm_campaign' ? styles.subtabActive : ''}`}
                onClick={() => setUtmTab('utm_campaign')}
              >
                UTM Campaign
              </button>
            </div>

            {entries.length === 0 ? (
              <div className={styles.emptyState}>
                <p>No data available for this breakdown.</p>
              </div>
            ) : (
              <div className={styles.tableCard}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Contacts</th>
                      <th className={styles.barCell}>Distribution</th>
                      <th>Deals</th>
                      <th>Conversion</th>
                      <th>Deal Value</th>
                      <th>Won</th>
                      <th>Won Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const pct =
                        maxContacts > 0
                          ? (entry.contactCount / maxContacts) * 100
                          : 0;
                      const pctOfTotal =
                        data.totals.totalContacts > 0
                          ? ((entry.contactCount / data.totals.totalContacts) * 100).toFixed(1)
                          : '0';

                      return (
                        <tr key={entry.source}>
                          <td>
                            <span className={styles.sourceLabel}>
                              {utmTab === 'source'
                                ? formatSourceLabel(entry.source)
                                : entry.source}
                            </span>
                          </td>
                          <td className={styles.numCell}>{entry.contactCount}</td>
                          <td className={styles.barCell}>
                            <div className={styles.barContainer}>
                              <div
                                className={styles.bar}
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: 'var(--color-link)',
                                }}
                              />
                              <span className={styles.barPercent}>{pctOfTotal}%</span>
                            </div>
                          </td>
                          <td className={styles.numCell}>{entry.dealCount}</td>
                          <td>
                            <div className={styles.winRateCell}>
                              <div className={styles.winRateTrack}>
                                <div
                                  className={styles.winRateFill}
                                  style={{
                                    width: `${entry.conversionRate}%`,
                                    backgroundColor: 'var(--color-link)',
                                  }}
                                />
                              </div>
                              <span className={styles.winRateLabel}>{entry.conversionRate}%</span>
                            </div>
                          </td>
                          <td className={styles.numCell}>
                            {formatCurrency(entry.totalDealValue)}
                          </td>
                          <td className={styles.numCell} style={{ color: 'var(--color-success)' }}>
                            {entry.wonDeals}
                          </td>
                          <td className={styles.numCell}>
                            {formatCurrency(entry.wonValue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total ({entries.length} sources)</td>
                      <td className={styles.numCell}>{data.totals.totalContacts}</td>
                      <td />
                      <td className={styles.numCell}>{data.totals.totalDeals}</td>
                      <td>
                        <div className={styles.winRateCell}>
                          <div className={styles.winRateTrack}>
                            <div
                              className={styles.winRateFill}
                              style={{
                                width: `${overallConversion}%`,
                                backgroundColor: 'var(--color-link)',
                              }}
                            />
                          </div>
                          <span className={styles.winRateLabel}>{overallConversion}%</span>
                        </div>
                      </td>
                      <td className={styles.numCell}>
                        {formatCurrency(data.totals.totalDealValue)}
                      </td>
                      <td className={styles.numCell}>{data.totals.wonDeals}</td>
                      <td className={styles.numCell}>
                        {formatCurrency(data.totals.wonValue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
