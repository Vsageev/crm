import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface DealListQuery {
  ownerId?: string;
  contactId?: string;
  companyId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  stage?: string;
  search?: string;
  limit?: number;
  offset?: number;
  countOnly?: boolean;
}

export interface CreateDealData {
  title: string;
  value?: string;
  currency?: string;
  stage?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  stageOrder?: number;
  contactId?: string;
  companyId?: string;
  ownerId?: string;
  expectedCloseDate?: string;
  lostReason?: string;
  notes?: string;
  tagIds?: string[];
  // Lead source tracking
  leadSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrerUrl?: string;
}

export interface UpdateDealData {
  title?: string;
  value?: string | null;
  currency?: string;
  stage?: string;
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  stageOrder?: number;
  contactId?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  lostReason?: string | null;
  notes?: string | null;
  tagIds?: string[];
}

export async function listDeals(query: DealListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: any) => {
    if (query.ownerId && r.ownerId !== query.ownerId) return false;
    if (query.contactId && r.contactId !== query.contactId) return false;
    if (query.companyId && r.companyId !== query.companyId) return false;
    if (query.pipelineId && r.pipelineId !== query.pipelineId) return false;
    if (query.pipelineStageId && r.pipelineStageId !== query.pipelineStageId) return false;
    if (query.stage && r.stage !== query.stage) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      if (!r.title?.toLowerCase().includes(term)) return false;
    }
    return true;
  };

  const all = store.find('deals', predicate);

  if (query.countOnly) {
    return { entries: [], total: all.length };
  }

  all.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const entries = all.slice(offset, offset + limit);
  const total = all.length;

  return { entries, total };
}

export async function getDealById(id: string) {
  const deal = store.getById('deals', id);
  if (!deal) return null;

  const tagRows = store.find('dealTags', (r: any) => r.dealId === id);

  return { ...deal, tagIds: tagRows.map((t: any) => t.tagId) };
}

export async function createDeal(
  data: CreateDealData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { tagIds, ...dealData } = data;

  const deal = store.insert('deals', dealData) as any;

  if (tagIds && tagIds.length > 0) {
    for (const tagId of tagIds) {
      store.insert('dealTags', { dealId: deal.id, tagId });
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'deal',
      entityId: deal.id,
      changes: dealData,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deal;
}

export async function updateDeal(
  id: string,
  data: UpdateDealData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { tagIds, ...dealData } = data;

  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dealData)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date();

  const updated = store.update('deals', id, setData) as any;

  if (!updated) return null;

  if (tagIds !== undefined) {
    store.deleteWhere('dealTags', (r: any) => r.dealId === id);
    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        store.insert('dealTags', { dealId: id, tagId });
      }
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'deal',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteDeal(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('deals', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'deal',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}

export interface MoveDealData {
  pipelineStageId: string;
  stageOrder?: number;
  lostReason?: string;
  autoClose?: boolean;
  closeIfValue?: number;
}

export async function moveDeal(
  id: string,
  data: MoveDealData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // Fetch the deal
  const deal = store.getById('deals', id) as any;
  if (!deal) return null;

  // Fetch target stage and validate it exists
  const targetStage = store.getById('pipelineStages', data.pipelineStageId) as any;

  if (!targetStage) {
    throw new Error('Target stage not found');
  }

  // Validate target stage belongs to the deal's pipeline
  if (deal.pipelineId && targetStage.pipelineId !== deal.pipelineId) {
    throw new Error('Target stage does not belong to the deal pipeline');
  }

  const fromStageId = deal.pipelineStageId;

  // Build update payload
  const setData: Record<string, unknown> = {
    pipelineId: targetStage.pipelineId,
    pipelineStageId: targetStage.id,
    updatedAt: new Date(),
  };

  // If stageOrder provided, use it; otherwise place at end
  if (data.stageOrder !== undefined) {
    setData.stageOrder = data.stageOrder;
  } else {
    // Get the max stageOrder in the target stage and place after it
    const dealsInStage = store.find('deals', (r: any) => r.pipelineStageId === targetStage.id);
    const maxOrder = dealsInStage.length > 0
      ? Math.max(...dealsInStage.map((r: any) => r.stageOrder ?? -1))
      : -1;
    setData.stageOrder = maxOrder + 1;
  }

  // Conditional auto-close: if autoClose=true and deal value >= closeIfValue, move to won
  if (data.autoClose && !targetStage.isWinStage && !targetStage.isLossStage) {
    const dealValue = parseFloat(deal.value ?? '0');
    const threshold = data.closeIfValue ?? 0;
    if (dealValue >= threshold) {
      // Find the win stage in this pipeline
      const winStage = store.findOne('pipelineStages', (r: any) =>
        r.pipelineId === targetStage.pipelineId && r.isWinStage === true,
      ) as any;
      if (winStage) {
        setData.pipelineStageId = winStage.id;
        setData.stage = 'won';
        setData.closedAt = new Date();
      }
    }
  }

  // Map win/loss stage to deal stage enum
  if (targetStage.isWinStage) {
    setData.stage = 'won';
    setData.closedAt = new Date();
  } else if (targetStage.isLossStage) {
    setData.stage = 'lost';
    setData.closedAt = new Date();
    if (data.lostReason) {
      setData.lostReason = data.lostReason;
    }
  } else {
    // If moving away from a closed stage, clear closedAt
    if (deal.stage === 'won' || deal.stage === 'lost') {
      setData.closedAt = null;
      setData.lostReason = null;
    }
  }

  const updated = store.update('deals', id, setData) as any;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'deal',
      entityId: id,
      changes: {
        action: 'stage_move',
        fromStageId,
        toStageId: targetStage.id,
        toStageName: targetStage.name,
        isWinStage: targetStage.isWinStage,
        isLossStage: targetStage.isLossStage,
      },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export interface ReorderDealsData {
  dealOrders: { dealId: string; stageOrder: number }[];
}

export async function reorderDeals(
  pipelineStageId: string,
  data: ReorderDealsData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  // Validate the stage exists
  const stage = store.getById('pipelineStages', pipelineStageId);

  if (!stage) {
    throw new Error('Stage not found');
  }

  // Update each deal's stageOrder
  const updates = data.dealOrders.map(({ dealId, stageOrder }) => {
    // Only update if the deal belongs to this stage
    const deal = store.findOne('deals', (r: any) =>
      r.id === dealId && r.pipelineStageId === pipelineStageId,
    );
    if (!deal) return null;
    return store.update('deals', dealId, { stageOrder, updatedAt: new Date() });
  });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'deal',
      entityId: pipelineStageId,
      changes: {
        action: 'reorder',
        pipelineStageId,
        dealOrders: data.dealOrders,
      },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updates.filter(Boolean);
}
