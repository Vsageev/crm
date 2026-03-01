import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

const GENERAL_COLLECTION_NAMES = new Set(['general']);

function normalizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

export function isGeneralCollection(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;

  const candidate = record as { isGeneral?: unknown; name?: unknown };
  if (candidate.isGeneral === true) return true;

  return GENERAL_COLLECTION_NAMES.has(normalizeName(candidate.name));
}

export interface CollectionListQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateCollectionData {
  name: string;
  description?: string | null;
}

export interface UpdateCollectionData {
  name?: string;
  description?: string | null;
}

export async function listCollections(query: CollectionListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  let all = store.getAll('collections') as any[];

  if (query.search) {
    const term = query.search.toLowerCase();
    all = all.filter(
      (f: any) =>
        f.name?.toLowerCase().includes(term) ||
        f.description?.toLowerCase().includes(term),
    );
  }

  all.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = all.length;
  const entries = all.slice(offset, offset + limit);

  return { entries, total };
}

export async function getCollectionById(id: string) {
  return store.getById('collections', id) ?? null;
}

export async function createCollection(
  data: CreateCollectionData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const isGeneral = GENERAL_COLLECTION_NAMES.has(normalizeName(data.name));

  const collection = store.insert('collections', {
    name: data.name,
    description: data.description ?? null,
    isGeneral,
    createdById: audit?.userId,
  }) as any;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'collection',
      entityId: collection.id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return collection;
}

export async function updateCollection(
  id: string,
  data: UpdateCollectionData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date().toISOString();

  const updated = store.update('collections', id, setData);
  if (!updated) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'collection',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function getOrCreateGeneralCollection(
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const all = store.getAll('collections') as any[];
  const general = all.find((f: any) => f.isGeneral === true || normalizeName(f.name) === 'general');
  if (general) return general;

  return createCollection({ name: 'General' }, audit);
}

export async function deleteCollection(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('collections', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'collection',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}
