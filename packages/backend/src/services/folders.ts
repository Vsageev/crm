import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

const GENERAL_FOLDER_NAMES = new Set(['general']);

function normalizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

export function isGeneralFolder(folder: unknown): boolean {
  if (!folder || typeof folder !== 'object') return false;

  const candidate = folder as { isGeneral?: unknown; name?: unknown };
  if (candidate.isGeneral === true) return true;

  return GENERAL_FOLDER_NAMES.has(normalizeName(candidate.name));
}

export interface FolderListQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateFolderData {
  name: string;
  description?: string | null;
}

export interface UpdateFolderData {
  name?: string;
  description?: string | null;
}

export async function listFolders(query: FolderListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  let all = store.getAll('folders') as any[];

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

export async function getFolderById(id: string) {
  return store.getById('folders', id) ?? null;
}

export async function createFolder(
  data: CreateFolderData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const isGeneral = GENERAL_FOLDER_NAMES.has(normalizeName(data.name));

  const folder = store.insert('folders', {
    name: data.name,
    description: data.description ?? null,
    isGeneral,
    createdById: audit?.userId,
  }) as any;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'folder',
      entityId: folder.id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return folder;
}

export async function updateFolder(
  id: string,
  data: UpdateFolderData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date().toISOString();

  const updated = store.update('folders', id, setData);
  if (!updated) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'folder',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteFolder(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('folders', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'folder',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}
