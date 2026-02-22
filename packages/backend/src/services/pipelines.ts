import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface PipelineListQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateStageData {
  name: string;
  color?: string;
  position: number;
  isWinStage?: boolean;
  isLossStage?: boolean;
}

export interface CreatePipelineData {
  name: string;
  description?: string;
  isDefault?: boolean;
  stages: CreateStageData[];
}

export interface UpdateStageData {
  id?: string;
  name: string;
  color?: string;
  position: number;
  isWinStage?: boolean;
  isLossStage?: boolean;
}

export interface UpdatePipelineData {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  stages?: UpdateStageData[];
}

export async function listPipelines(query: PipelineListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const all = store.getAll('pipelines') as any[];

  // Sort: default pipelines first, then by createdAt desc
  all.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const entries = all.slice(offset, offset + limit);
  const total = all.length;

  // Load stages for each pipeline
  const entriesWithStages = entries.map((pipeline: any) => {
    const stages = store.find('pipelineStages', (r: any) => r.pipelineId === pipeline.id) as any[];
    stages.sort((a, b) => a.position - b.position);
    return { ...pipeline, stages };
  });

  return { entries: entriesWithStages, total };
}

export async function getPipelineById(id: string) {
  const pipeline = store.getById('pipelines', id);
  if (!pipeline) return null;

  const stages = store.find('pipelineStages', (r: any) => r.pipelineId === id) as any[];
  stages.sort((a, b) => a.position - b.position);

  return { ...pipeline, stages };
}

export async function createPipeline(
  data: CreatePipelineData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { stages, ...pipelineData } = data;

  // If this pipeline is set as default, unset any existing default
  if (pipelineData.isDefault) {
    const defaults = store.find('pipelines', (r: any) => r.isDefault === true);
    for (const d of defaults) {
      store.update('pipelines', (d as any).id, { isDefault: false, updatedAt: new Date() });
    }
  }

  const pipeline = store.insert('pipelines', {
    ...pipelineData,
    createdBy: audit?.userId,
  }) as any;

  // Create stages
  if (stages && stages.length > 0) {
    for (const stage of stages) {
      store.insert('pipelineStages', {
        pipelineId: pipeline.id,
        name: stage.name,
        color: stage.color ?? '#6B7280',
        position: stage.position,
        isWinStage: stage.isWinStage ?? false,
        isLossStage: stage.isLossStage ?? false,
      });
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'pipeline',
      entityId: pipeline.id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getPipelineById(pipeline.id);
}

export async function updatePipeline(
  id: string,
  data: UpdatePipelineData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { stages, ...pipelineData } = data;

  // If setting as default, unset any existing default
  if (pipelineData.isDefault) {
    const defaults = store.find('pipelines', (r: any) => r.isDefault === true);
    for (const d of defaults) {
      store.update('pipelines', (d as any).id, { isDefault: false, updatedAt: new Date() });
    }
  }

  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pipelineData)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date();

  const updated = store.update('pipelines', id, setData);

  if (!updated) return null;

  // Replace stages if provided
  if (stages !== undefined) {
    store.deleteWhere('pipelineStages', (r: any) => r.pipelineId === id);
    if (stages.length > 0) {
      for (const stage of stages) {
        store.insert('pipelineStages', {
          pipelineId: id,
          name: stage.name,
          color: stage.color ?? '#6B7280',
          position: stage.position,
          isWinStage: stage.isWinStage ?? false,
          isLossStage: stage.isLossStage ?? false,
        });
      }
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'pipeline',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getPipelineById(id);
}

export async function deletePipeline(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('pipelines', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'pipeline',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}
