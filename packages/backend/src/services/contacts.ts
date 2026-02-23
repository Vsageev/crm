import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface ContactListQuery {
  ownerId?: string;
  companyId?: string;
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
  countOnly?: boolean;
}

export interface CreateContactData {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  position?: string;
  companyId?: string;
  ownerId?: string;
  source?: string;
  telegramId?: string;
  whatsappPhoneId?: string;
  instagramScopedId?: string;
  notes?: string;
  tagIds?: string[];
  customFields?: { definitionId: string; value: string }[];
  // UTM / lead source tracking
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrerUrl?: string;
}

export interface UpdateContactData {
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  source?: string;
  telegramId?: string | null;
  notes?: string | null;
  tagIds?: string[];
  customFields?: { definitionId: string; value: string }[];
}

export async function listContacts(query: ContactListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: any) => {
    if (query.ownerId && r.ownerId !== query.ownerId) return false;
    if (query.companyId && r.companyId !== query.companyId) return false;
    if (query.source && r.source !== query.source) return false;
    if (query.search) {
      const term = query.search.toLowerCase();
      const match =
        r.firstName?.toLowerCase().includes(term) ||
        r.lastName?.toLowerCase().includes(term) ||
        r.email?.toLowerCase().includes(term) ||
        r.phone?.toLowerCase().includes(term);
      if (!match) return false;
    }
    return true;
  };

  const all = store.find('contacts', predicate);

  if (query.countOnly) {
    return { entries: [], total: all.length };
  }

  all.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const entries = all.slice(offset, offset + limit);
  const total = all.length;

  return { entries, total };
}

export async function getContactByTelegramId(telegramId: string) {
  return store.findOne('contacts', (r: any) => r.telegramId === telegramId) ?? null;
}

export async function getContactByWhatsAppPhoneId(whatsappPhoneId: string) {
  return store.findOne('contacts', (r: any) => r.whatsappPhoneId === whatsappPhoneId) ?? null;
}

export async function getContactById(id: string) {
  const contact = store.getById('contacts', id);
  if (!contact) return null;

  const tagRows = store.find('contactTags', (r: any) => r.contactId === id);
  const fields = store.find('customFieldValues', (r: any) =>
    r.entityType === 'contact' && r.entityId === id,
  );

  return { ...contact, tagIds: tagRows.map((t: any) => t.tagId), customFields: fields };
}

export async function createContact(
  data: CreateContactData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { tagIds, customFields, ...contactData } = data;

  const contact = store.insert('contacts', contactData) as any;

  if (tagIds && tagIds.length > 0) {
    for (const tagId of tagIds) {
      store.insert('contactTags', { contactId: contact.id, tagId });
    }
  }

  if (customFields && customFields.length > 0) {
    for (const cf of customFields) {
      store.insert('customFieldValues', {
        definitionId: cf.definitionId,
        entityType: 'contact' as const,
        entityId: contact.id,
        value: cf.value,
      });
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'contact',
      entityId: contact.id,
      changes: contactData,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return contact;
}

export async function updateContact(
  id: string,
  data: UpdateContactData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const { tagIds, customFields, ...contactData } = data;

  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contactData)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }
  setData.updatedAt = new Date();

  const updated = store.update('contacts', id, setData) as any;

  if (!updated) return null;

  if (tagIds !== undefined) {
    store.deleteWhere('contactTags', (r: any) => r.contactId === id);
    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        store.insert('contactTags', { contactId: id, tagId });
      }
    }
  }

  if (customFields !== undefined) {
    store.deleteWhere('customFieldValues', (r: any) =>
      r.entityType === 'contact' && r.entityId === id,
    );
    if (customFields.length > 0) {
      for (const cf of customFields) {
        store.insert('customFieldValues', {
          definitionId: cf.definitionId,
          entityType: 'contact' as const,
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
      entityType: 'contact',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteContact(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('contacts', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'contact',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}

/**
 * Get tag names for a contact. Used by the automation engine to enrich
 * event payloads so that routing rules can match on tag names.
 */
export async function getContactTagNames(contactId: string): Promise<string[]> {
  const tagRows = store.find('contactTags', (r: any) => r.contactId === contactId);

  return tagRows.map((ct: any) => {
    const tag = store.getById('tags', ct.tagId) as any;
    return tag?.name ?? '';
  }).filter((name: string) => name !== '');
}
