import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface CompanyListQuery {
  ownerId?: string;
  industry?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateCompanyData {
  name: string;
  website?: string;
  phone?: string;
  address?: string;
  industry?: string;
  size?: string;
  notes?: string;
  ownerId?: string;
  tagIds?: string[];
  customFields?: { definitionId: string; value: string }[];
}

export interface UpdateCompanyData {
  name?: string;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  industry?: string | null;
  size?: string | null;
  notes?: string | null;
  ownerId?: string | null;
  tagIds?: string[];
  customFields?: { definitionId: string; value: string }[];
}

export async function listCompanies(query: CompanyListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: any) => {
    if (query.ownerId && r.ownerId !== query.ownerId) return false;
    if (query.industry && r.industry !== query.industry) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      const match =
        r.name?.toLowerCase().includes(term) ||
        r.website?.toLowerCase().includes(term) ||
        r.phone?.toLowerCase().includes(term);
      if (!match) return false;
    }
    return true;
  };

  const all = store.find('companies', predicate)
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const entries = all.slice(offset, offset + limit);
  const total = all.length;

  return { entries, total };
}

export async function getCompanyById(id: string) {
  const company = store.getById('companies', id);
  if (!company) return null;

  const tagRows = store.find('companyTags', (r: any) => r.companyId === id);
  const fields = store.find('customFieldValues', (r: any) =>
    r.entityType === 'company' && r.entityId === id,
  );

  return { ...company, tagIds: tagRows.map((t: any) => t.tagId), customFields: fields };
}

export async function createCompany(
  data: CreateCompanyData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { tagIds, customFields, ...companyData } = data;

  const company = store.insert('companies', companyData) as any;

  if (tagIds && tagIds.length > 0) {
    for (const tagId of tagIds) {
      store.insert('companyTags', { companyId: company.id, tagId });
    }
  }

  if (customFields && customFields.length > 0) {
    for (const cf of customFields) {
      store.insert('customFieldValues', {
        definitionId: cf.definitionId,
        entityType: 'company' as const,
        entityId: company.id,
        value: cf.value,
      });
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'company',
      entityId: company.id,
      changes: companyData,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return company;
}

export async function updateCompany(
  id: string,
  data: UpdateCompanyData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { tagIds, customFields, ...companyData } = data;

  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(companyData)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date();

  const updated = store.update('companies', id, setData) as any;

  if (!updated) return null;

  if (tagIds !== undefined) {
    store.deleteWhere('companyTags', (r: any) => r.companyId === id);
    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        store.insert('companyTags', { companyId: id, tagId });
      }
    }
  }

  if (customFields !== undefined) {
    store.deleteWhere('customFieldValues', (r: any) =>
      r.entityType === 'company' && r.entityId === id,
    );
    if (customFields.length > 0) {
      for (const cf of customFields) {
        store.insert('customFieldValues', {
          definitionId: cf.definitionId,
          entityType: 'company' as const,
          entityId: id,
          value: cf.value,
        });
      }
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'company',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteCompany(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('companies', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'company',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}
