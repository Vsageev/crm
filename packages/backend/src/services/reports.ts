import { store } from '../db/index.js';

export interface PipelineSummaryQuery {
  pipelineId: string;
  ownerId?: string;
}

export interface StageSummary {
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

export interface PipelineSummary {
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

export async function getPipelineSummary(
  query: PipelineSummaryQuery,
): Promise<PipelineSummary | null> {
  // Fetch the pipeline
  const pipeline = store.findOne('pipelines', (r) => r.id === query.pipelineId);
  if (!pipeline) return null;

  // Fetch all stages for this pipeline, sorted by position
  const stages = store
    .find('pipelineStages', (r) => r.pipelineId === query.pipelineId)
    .sort((a, b) => (a.position as number) - (b.position as number));

  // Get deals for this pipeline (optionally filtered by owner)
  const pipelineDeals = store.find('deals', (r) => {
    if (r.pipelineId !== query.pipelineId) return false;
    if (query.ownerId && r.ownerId !== query.ownerId) return false;
    return true;
  });

  // Aggregate deals by pipeline stage using a Map
  const statsMap = new Map<string, { dealCount: number; totalValue: number }>();
  for (const deal of pipelineDeals) {
    const stageId = deal.pipelineStageId as string;
    if (!statsMap.has(stageId)) {
      statsMap.set(stageId, { dealCount: 0, totalValue: 0 });
    }
    const entry = statsMap.get(stageId)!;
    entry.dealCount++;
    entry.totalValue += parseFloat((deal.value as string) || '0');
  }

  // Combine stages with stats
  const stageSummaries: StageSummary[] = stages.map((stage) => {
    const stats = statsMap.get(stage.id as string);
    const dealCount = stats?.dealCount ?? 0;
    const totalValue = stats?.totalValue ?? 0;
    return {
      stageId: stage.id as string,
      stageName: stage.name as string,
      stageColor: stage.color as string,
      position: stage.position as number,
      isWinStage: stage.isWinStage as boolean,
      isLossStage: stage.isLossStage as boolean,
      dealCount,
      totalValue,
      avgValue: dealCount > 0 ? totalValue / dealCount : 0,
    };
  });

  // Compute totals
  const totalDeals = stageSummaries.reduce((s, st) => s + st.dealCount, 0);
  const totalValue = stageSummaries.reduce((s, st) => s + st.totalValue, 0);

  const wonStages = stageSummaries.filter((s) => s.isWinStage);
  const lostStages = stageSummaries.filter((s) => s.isLossStage);
  const openStages = stageSummaries.filter((s) => !s.isWinStage && !s.isLossStage);

  const wonDeals = wonStages.reduce((s, st) => s + st.dealCount, 0);
  const wonValue = wonStages.reduce((s, st) => s + st.totalValue, 0);
  const lostDeals = lostStages.reduce((s, st) => s + st.dealCount, 0);
  const lostValue = lostStages.reduce((s, st) => s + st.totalValue, 0);
  const openDeals = openStages.reduce((s, st) => s + st.dealCount, 0);
  const openValue = openStages.reduce((s, st) => s + st.totalValue, 0);

  return {
    pipeline: {
      id: pipeline.id as string,
      name: pipeline.name as string,
      description: (pipeline.description as string | null) ?? null,
    },
    stages: stageSummaries,
    totals: {
      totalDeals,
      totalValue,
      openDeals,
      openValue,
      wonDeals,
      wonValue,
      lostDeals,
      lostValue,
    },
  };
}

export interface AllPipelinesSummary {
  pipelineId: string;
  pipelineName: string;
  totalDeals: number;
  totalValue: number;
  wonDeals: number;
  wonValue: number;
}

export async function getAllPipelinesSummary(
  ownerId?: string,
): Promise<AllPipelinesSummary[]> {
  // Get all pipelines sorted by name
  const allPipelines = store
    .getAll('pipelines')
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const allDeals = store.getAll('deals');

  const results: AllPipelinesSummary[] = [];

  for (const p of allPipelines) {
    const pipelineDeals = allDeals.filter((d) => {
      if (d.pipelineId !== p.id) return false;
      if (ownerId && d.ownerId !== ownerId) return false;
      return true;
    });

    const totalDeals = pipelineDeals.length;
    const totalValue = pipelineDeals.reduce(
      (s, d) => s + parseFloat((d.value as string) || '0'),
      0,
    );

    const wonDealsList = pipelineDeals.filter((d) => d.stage === 'won');
    const wonDeals = wonDealsList.length;
    const wonValue = wonDealsList.reduce(
      (s, d) => s + parseFloat((d.value as string) || '0'),
      0,
    );

    results.push({
      pipelineId: p.id as string,
      pipelineName: p.name as string,
      totalDeals,
      totalValue,
      wonDeals,
      wonValue,
    });
  }

  return results;
}

// ─── Agent Performance Report ────────────────────────────────────────────────

export interface AgentPerformanceQuery {
  startDate?: string;
  endDate?: string;
  agentId?: string;
}

export interface AgentPerformance {
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

export interface AgentPerformanceSummary {
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

function isInDateRange(
  dateStr: unknown,
  startDate?: string,
  endDate?: string,
): boolean {
  if (!startDate && !endDate) return true;
  if (!dateStr) return false;
  const d = new Date(dateStr as string).getTime();
  if (startDate && d < new Date(startDate).getTime()) return false;
  if (endDate && d > new Date(endDate).getTime()) return false;
  return true;
}

export async function getAgentPerformance(
  query: AgentPerformanceQuery,
): Promise<AgentPerformanceSummary> {
  // Get all active agents (and managers/admins who may own deals)
  const allAgents = store
    .find('users', (r) =>
      query.agentId ? r.id === query.agentId : r.isActive === true,
    )
    .sort((a, b) => {
      const cmp = String(a.firstName).localeCompare(String(b.firstName));
      if (cmp !== 0) return cmp;
      return String(a.lastName).localeCompare(String(b.lastName));
    });

  // Get all deals (optionally filtered by date range)
  const allDeals = store.find('deals', (r) =>
    isInDateRange(r.createdAt, query.startDate, query.endDate),
  );

  // Aggregate deals per agent (by ownerId)
  const dealStatsMap = new Map<
    string,
    {
      totalDeals: number;
      totalValue: number;
      wonDeals: number;
      wonValue: number;
      lostDeals: number;
      openDeals: number;
    }
  >();

  for (const deal of allDeals) {
    const ownerId = deal.ownerId as string;
    if (!ownerId) continue;
    if (!dealStatsMap.has(ownerId)) {
      dealStatsMap.set(ownerId, {
        totalDeals: 0,
        totalValue: 0,
        wonDeals: 0,
        wonValue: 0,
        lostDeals: 0,
        openDeals: 0,
      });
    }
    const entry = dealStatsMap.get(ownerId)!;
    entry.totalDeals++;
    const val = parseFloat((deal.value as string) || '0');
    entry.totalValue += val;
    if (deal.stage === 'won') {
      entry.wonDeals++;
      entry.wonValue += val;
    } else if (deal.stage === 'lost') {
      entry.lostDeals++;
    } else {
      entry.openDeals++;
    }
  }

  // Average response time per agent:
  // For each inbound message, find the next outbound reply from the conversation's assignee.
  const allMessages = store.find('messages', (r) =>
    isInDateRange(r.createdAt, query.startDate, query.endDate),
  );
  const allConversations = store.getAll('conversations');
  const convAssigneeMap = new Map<string, string>();
  for (const conv of allConversations) {
    if (conv.assigneeId) {
      convAssigneeMap.set(conv.id as string, conv.assigneeId as string);
    }
  }

  // Group messages by conversation
  const msgsByConv = new Map<string, Record<string, unknown>[]>();
  for (const msg of allMessages) {
    const convId = msg.conversationId as string;
    if (!msgsByConv.has(convId)) {
      msgsByConv.set(convId, []);
    }
    msgsByConv.get(convId)!.push(msg);
  }

  // Sort each conversation's messages by createdAt
  for (const msgs of msgsByConv.values()) {
    msgs.sort(
      (a, b) =>
        new Date(a.createdAt as string).getTime() -
        new Date(b.createdAt as string).getTime(),
    );
  }

  // Calculate response times per assignee
  const responseTimesPerAgent = new Map<string, number[]>();

  for (const [convId, msgs] of msgsByConv) {
    const assigneeId = convAssigneeMap.get(convId);
    if (!assigneeId) continue;

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      if (msg.direction !== 'inbound') continue;
      const inboundAt = new Date(msg.createdAt as string).getTime();

      // Find the next outbound reply from the assignee
      for (let j = i + 1; j < msgs.length; j++) {
        const reply = msgs[j];
        if (
          reply.direction === 'outbound' &&
          reply.senderId === assigneeId
        ) {
          const replyAt = new Date(reply.createdAt as string).getTime();
          const diffMinutes = (replyAt - inboundAt) / 60000;
          if (!responseTimesPerAgent.has(assigneeId)) {
            responseTimesPerAgent.set(assigneeId, []);
          }
          responseTimesPerAgent.get(assigneeId)!.push(diffMinutes);
          break;
        }
      }
    }
  }

  const responseTimeMap = new Map<string, number>();
  for (const [agentId, times] of responseTimesPerAgent) {
    const avg = times.reduce((s, t) => s + t, 0) / times.length;
    responseTimeMap.set(agentId, Math.round(avg * 10) / 10);
  }

  // Messages sent per agent (outbound messages)
  const sentMsgMap = new Map<string, number>();
  for (const msg of allMessages) {
    if (msg.direction === 'outbound' && msg.senderId) {
      const senderId = msg.senderId as string;
      sentMsgMap.set(senderId, (sentMsgMap.get(senderId) ?? 0) + 1);
    }
  }

  // Conversation count per agent (as assignee)
  const convStats = store.find('conversations', (r) =>
    isInDateRange(r.createdAt, query.startDate, query.endDate),
  );
  const convMap = new Map<string, number>();
  for (const conv of convStats) {
    if (conv.assigneeId) {
      const assigneeId = conv.assigneeId as string;
      convMap.set(assigneeId, (convMap.get(assigneeId) ?? 0) + 1);
    }
  }

  // Build agent performance entries
  const agents: AgentPerformance[] = allAgents.map((agent) => {
    const agentId = agent.id as string;
    const ds = dealStatsMap.get(agentId);
    const totalDeals = ds?.totalDeals ?? 0;
    const wonDeals = ds?.wonDeals ?? 0;
    const lostDeals = ds?.lostDeals ?? 0;
    const openDeals = ds?.openDeals ?? 0;
    const totalValue = ds?.totalValue ?? 0;
    const wonValue = ds?.wonValue ?? 0;
    const winRate = totalDeals > 0 ? Math.round((wonDeals / totalDeals) * 100) : 0;
    const avgDealValue = wonDeals > 0 ? Math.round((wonValue / wonDeals) * 100) / 100 : 0;
    const avgResponseTimeMinutes = responseTimeMap.get(agentId) ?? null;
    const conversationCount = convMap.get(agentId) ?? 0;
    const messagesSent = sentMsgMap.get(agentId) ?? 0;

    return {
      agentId,
      agentName: `${agent.firstName} ${agent.lastName}`,
      agentEmail: agent.email as string,
      totalDeals,
      wonDeals,
      lostDeals,
      openDeals,
      totalValue,
      wonValue,
      winRate,
      avgDealValue,
      avgResponseTimeMinutes,
      conversationCount,
      messagesSent,
    };
  });

  // Filter out agents with no activity at all (unless specific agent requested)
  const filtered = query.agentId
    ? agents
    : agents.filter(
        (a) =>
          a.totalDeals > 0 ||
          a.conversationCount > 0 ||
          a.messagesSent > 0,
      );

  // Compute totals
  const totalDeals = filtered.reduce((s, a) => s + a.totalDeals, 0);
  const wonDeals = filtered.reduce((s, a) => s + a.wonDeals, 0);
  const lostDeals = filtered.reduce((s, a) => s + a.lostDeals, 0);
  const totalValue = filtered.reduce((s, a) => s + a.totalValue, 0);
  const wonValue = filtered.reduce((s, a) => s + a.wonValue, 0);
  const avgWinRate = totalDeals > 0 ? Math.round((wonDeals / totalDeals) * 100) : 0;

  const agentsWithResponse = filtered.filter((a) => a.avgResponseTimeMinutes !== null);
  const avgResponseTimeMinutes =
    agentsWithResponse.length > 0
      ? Math.round(
          (agentsWithResponse.reduce((s, a) => s + (a.avgResponseTimeMinutes ?? 0), 0) /
            agentsWithResponse.length) *
            10,
        ) / 10
      : null;

  return {
    agents: filtered,
    totals: {
      totalDeals,
      wonDeals,
      lostDeals,
      totalValue,
      wonValue,
      avgWinRate,
      avgResponseTimeMinutes,
    },
  };
}

// ─── Lead Source Breakdown Report ──────────────────────────────────────────────

export interface LeadSourceQuery {
  startDate?: string;
  endDate?: string;
}

export interface LeadSourceEntry {
  source: string;
  contactCount: number;
  dealCount: number;
  totalDealValue: number;
  wonDeals: number;
  wonValue: number;
  conversionRate: number;
}

export interface LeadSourceBreakdown {
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

export async function getLeadSourceBreakdown(
  query: LeadSourceQuery,
): Promise<LeadSourceBreakdown> {
  // Get contacts and deals filtered by date range
  const filteredContacts = store.find('contacts', (r) =>
    isInDateRange(r.createdAt, query.startDate, query.endDate),
  );
  const filteredDeals = store.find('deals', (r) =>
    isInDateRange(r.createdAt, query.startDate, query.endDate),
  );

  // Contacts grouped by source
  const contactsBySourceMap = new Map<string, number>();
  for (const c of filteredContacts) {
    const src = (c.source as string) || 'direct';
    contactsBySourceMap.set(src, (contactsBySourceMap.get(src) ?? 0) + 1);
  }

  // Deals grouped by leadSource with aggregations
  const dealsBySourceMap = new Map<
    string,
    { dealCount: number; totalValue: number; wonDeals: number; wonValue: number }
  >();
  for (const d of filteredDeals) {
    const src = (d.leadSource as string) || 'direct';
    if (!dealsBySourceMap.has(src)) {
      dealsBySourceMap.set(src, { dealCount: 0, totalValue: 0, wonDeals: 0, wonValue: 0 });
    }
    const entry = dealsBySourceMap.get(src)!;
    entry.dealCount++;
    const val = parseFloat((d.value as string) || '0');
    entry.totalValue += val;
    if (d.stage === 'won') {
      entry.wonDeals++;
      entry.wonValue += val;
    }
  }

  // Build bySource: combine contact source with deal lead_source data
  const sourceSet = new Set<string>();
  for (const src of contactsBySourceMap.keys()) sourceSet.add(src);
  for (const src of dealsBySourceMap.keys()) sourceSet.add(src);

  const bySource: LeadSourceEntry[] = [...sourceSet]
    .map((source) => {
      const contactCount = contactsBySourceMap.get(source) ?? 0;
      const dealRow = dealsBySourceMap.get(source);
      const dealCount = dealRow?.dealCount ?? 0;
      return {
        source,
        contactCount,
        dealCount,
        totalDealValue: dealRow?.totalValue ?? 0,
        wonDeals: dealRow?.wonDeals ?? 0,
        wonValue: dealRow?.wonValue ?? 0,
        conversionRate: contactCount > 0 ? Math.round((dealCount / contactCount) * 100) : 0,
      };
    })
    .sort((a, b) => b.contactCount - a.contactCount);

  // UTM breakdowns
  const byUtmSource = getUtmBreakdown(filteredContacts, filteredDeals, 'utmSource');
  const byUtmMedium = getUtmBreakdown(filteredContacts, filteredDeals, 'utmMedium');
  const byUtmCampaign = getUtmBreakdown(filteredContacts, filteredDeals, 'utmCampaign');

  // Totals
  const totalContacts = filteredContacts.length;
  let totalDeals = 0;
  let totalDealValue = 0;
  let wonDealsTotal = 0;
  let wonValueTotal = 0;
  for (const entry of dealsBySourceMap.values()) {
    totalDeals += entry.dealCount;
    totalDealValue += entry.totalValue;
    wonDealsTotal += entry.wonDeals;
    wonValueTotal += entry.wonValue;
  }

  return {
    bySource,
    byUtmSource,
    byUtmMedium,
    byUtmCampaign,
    totals: {
      totalContacts,
      totalDeals,
      totalDealValue,
      wonDeals: wonDealsTotal,
      wonValue: wonValueTotal,
    },
  };
}

// ─── CSV Export Helpers ──────────────────────────────────────────────────────

function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvString(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines: string[] = [headers.join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\n');
}

// ─── Pipeline Summary CSV Export ─────────────────────────────────────────────

export async function exportPipelineSummaryCsv(
  query: PipelineSummaryQuery,
): Promise<string | null> {
  const summary = await getPipelineSummary(query);
  if (!summary) return null;

  const headers = ['Stage', 'Deals', 'Total Value', 'Avg Value', 'Type'];
  const rows = summary.stages.map((stage) => [
    stage.stageName,
    stage.dealCount,
    stage.totalValue,
    stage.avgValue,
    stage.isWinStage ? 'Won' : stage.isLossStage ? 'Lost' : 'Open',
  ]);

  // Totals row
  rows.push([
    'TOTAL',
    summary.totals.totalDeals,
    summary.totals.totalValue,
    summary.totals.totalDeals > 0
      ? Math.round((summary.totals.totalValue / summary.totals.totalDeals) * 100) / 100
      : 0,
    '',
  ]);

  return toCsvString(headers, rows);
}

// ─── Agent Performance CSV Export ────────────────────────────────────────────

export async function exportAgentPerformanceCsv(
  query: AgentPerformanceQuery,
): Promise<string> {
  const data = await getAgentPerformance(query);

  const headers = [
    'Agent Name',
    'Email',
    'Total Deals',
    'Won Deals',
    'Lost Deals',
    'Open Deals',
    'Total Value',
    'Won Value',
    'Win Rate %',
    'Avg Deal Value',
    'Avg Response Time (min)',
    'Conversations',
    'Messages Sent',
  ];

  const rows = data.agents.map((a) => [
    a.agentName,
    a.agentEmail,
    a.totalDeals,
    a.wonDeals,
    a.lostDeals,
    a.openDeals,
    a.totalValue,
    a.wonValue,
    a.winRate,
    a.avgDealValue,
    a.avgResponseTimeMinutes,
    a.conversationCount,
    a.messagesSent,
  ]);

  return toCsvString(headers, rows);
}

// ─── Lead Source Breakdown CSV Export ─────────────────────────────────────────

export async function exportLeadSourceCsv(
  query: LeadSourceQuery,
): Promise<string> {
  const data = await getLeadSourceBreakdown(query);

  const headers = [
    'Source',
    'Contacts',
    'Deals',
    'Total Deal Value',
    'Won Deals',
    'Won Value',
    'Conversion Rate %',
  ];

  const rows = data.bySource.map((e) => [
    e.source,
    e.contactCount,
    e.dealCount,
    e.totalDealValue,
    e.wonDeals,
    e.wonValue,
    e.conversionRate,
  ]);

  // Totals row
  rows.push([
    'TOTAL',
    data.totals.totalContacts,
    data.totals.totalDeals,
    data.totals.totalDealValue,
    data.totals.wonDeals,
    data.totals.wonValue,
    data.totals.totalContacts > 0
      ? Math.round((data.totals.totalDeals / data.totals.totalContacts) * 100)
      : 0,
  ]);

  return toCsvString(headers, rows);
}

function getUtmBreakdown(
  filteredContacts: Record<string, unknown>[],
  filteredDeals: Record<string, unknown>[],
  utmField: 'utmSource' | 'utmMedium' | 'utmCampaign',
): LeadSourceEntry[] {
  // Contact count by UTM field
  const contactCountMap = new Map<string, number>();
  for (const c of filteredContacts) {
    const val = c[utmField] as string | null | undefined;
    if (val) {
      contactCountMap.set(val, (contactCountMap.get(val) ?? 0) + 1);
    }
  }

  // Deal stats by UTM field
  const dealStatsMap = new Map<
    string,
    { dealCount: number; totalValue: number; wonDeals: number; wonValue: number }
  >();
  for (const d of filteredDeals) {
    const val = d[utmField] as string | null | undefined;
    if (!val) continue;
    if (!dealStatsMap.has(val)) {
      dealStatsMap.set(val, { dealCount: 0, totalValue: 0, wonDeals: 0, wonValue: 0 });
    }
    const entry = dealStatsMap.get(val)!;
    entry.dealCount++;
    const numVal = parseFloat((d.value as string) || '0');
    entry.totalValue += numVal;
    if (d.stage === 'won') {
      entry.wonDeals++;
      entry.wonValue += numVal;
    }
  }

  // Combine all UTM values
  const allValues = new Set<string>();
  for (const key of contactCountMap.keys()) allValues.add(key);
  for (const key of dealStatsMap.keys()) allValues.add(key);

  return [...allValues]
    .map((value) => {
      const contactCount = contactCountMap.get(value) ?? 0;
      const dRow = dealStatsMap.get(value);
      const dealCount = dRow?.dealCount ?? 0;
      return {
        source: value,
        contactCount,
        dealCount,
        totalDealValue: dRow?.totalValue ?? 0,
        wonDeals: dRow?.wonDeals ?? 0,
        wonValue: dRow?.wonValue ?? 0,
        conversionRate: contactCount > 0 ? Math.round((dealCount / contactCount) * 100) : 0,
      };
    })
    .sort((a, b) => b.contactCount - a.contactCount);
}
