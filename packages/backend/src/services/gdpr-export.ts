import { store } from '../db/index.js';

export interface GdprExportData {
  exportedAt: string;
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    position: string | null;
    source: string;
    telegramId: string | null;
    notes: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
    referrerUrl: string | null;
    createdAt: string;
    updatedAt: string;
  };
  tags: { name: string; color: string }[];
  customFields: { fieldName: string; fieldType: string; value: string | null }[];
  deals: {
    id: string;
    title: string;
    value: string | null;
    currency: string;
    stage: string;
    expectedCloseDate: string | null;
    closedAt: string | null;
    lostReason: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  tasks: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    status: string;
    priority: string;
    dueDate: string | null;
    completedAt: string | null;
    createdAt: string;
  }[];
  activityLogs: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    duration: number | null;
    occurredAt: string;
    createdAt: string;
  }[];
  conversations: {
    id: string;
    channelType: string;
    status: string;
    subject: string | null;
    createdAt: string;
    messages: {
      id: string;
      direction: string;
      type: string;
      content: string | null;
      status: string;
      createdAt: string;
    }[];
  }[];
  auditTrail: {
    action: string;
    entityType: string;
    changes: unknown;
    createdAt: string;
  }[];
}

function toISOString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date(val as number).toISOString();
}

function toISOStringOrNull(val: unknown): string | null {
  if (val == null) return null;
  return toISOString(val);
}

export async function exportContactGdprData(contactId: string): Promise<GdprExportData | null> {
  // Fetch contact
  const contact = store.getById('contacts', contactId);
  if (!contact) return null;

  // Fetch all related data
  // Tags: two-step join via contactTags -> tags
  const contactTagRows = store.find('contactTags', (r) => r.contactId === contactId);
  const tagData = contactTagRows
    .map((ct) => {
      const tag = store.getById('tags', ct.tagId as string);
      return tag ? { name: tag.name as string, color: tag.color as string } : null;
    })
    .filter((t): t is { name: string; color: string } => t !== null);

  // Custom fields with definitions
  const customFieldValueRows = store.find(
    'customFieldValues',
    (r) => r.entityType === 'contact' && r.entityId === contactId,
  );
  const customFieldData = customFieldValueRows
    .map((cfv) => {
      const def = store.getById('customFieldDefinitions', cfv.definitionId as string);
      return def
        ? {
            fieldName: def.name as string,
            fieldType: def.fieldType as string,
            value: cfv.value as string | null,
          }
        : null;
    })
    .filter((cf): cf is { fieldName: string; fieldType: string; value: string | null } => cf !== null);

  // Deals
  const dealRows = store
    .find('deals', (r) => r.contactId === contactId)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  // Tasks
  const taskRows = store
    .find('tasks', (r) => r.contactId === contactId)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  // Activity logs
  const activityLogRows = store
    .find('activityLogs', (r) => r.contactId === contactId)
    .sort((a, b) => new Date(b.occurredAt as string).getTime() - new Date(a.occurredAt as string).getTime());

  // Conversations
  const conversationRows = store
    .find('conversations', (r) => r.contactId === contactId)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  // Audit logs referencing this contact
  const auditLogRows = store
    .find('auditLogs', (r) => r.entityType === 'contact' && r.entityId === contactId)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  // Fetch messages for each conversation
  const conversationsWithMessages = conversationRows.map((conv) => {
    const msgs = store
      .find('messages', (r) => r.conversationId === conv.id)
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

    return {
      id: conv.id as string,
      channelType: conv.channelType as string,
      status: conv.status as string,
      subject: conv.subject as string | null,
      createdAt: toISOString(conv.createdAt),
      messages: msgs.map((m) => ({
        id: m.id as string,
        direction: m.direction as string,
        type: m.type as string,
        content: m.content as string | null,
        status: m.status as string,
        createdAt: toISOString(m.createdAt),
      })),
    };
  });

  return {
    exportedAt: new Date().toISOString(),
    contact: {
      id: contact.id as string,
      firstName: contact.firstName as string,
      lastName: contact.lastName as string | null,
      email: contact.email as string | null,
      phone: contact.phone as string | null,
      position: contact.position as string | null,
      source: contact.source as string,
      telegramId: contact.telegramId as string | null,
      notes: contact.notes as string | null,
      utmSource: contact.utmSource as string | null,
      utmMedium: contact.utmMedium as string | null,
      utmCampaign: contact.utmCampaign as string | null,
      utmTerm: contact.utmTerm as string | null,
      utmContent: contact.utmContent as string | null,
      referrerUrl: contact.referrerUrl as string | null,
      createdAt: toISOString(contact.createdAt),
      updatedAt: toISOString(contact.updatedAt),
    },
    tags: tagData,
    customFields: customFieldData,
    deals: dealRows.map((d) => ({
      id: d.id as string,
      title: d.title as string,
      value: d.value as string | null,
      currency: d.currency as string,
      stage: d.stage as string,
      expectedCloseDate: toISOStringOrNull(d.expectedCloseDate),
      closedAt: toISOStringOrNull(d.closedAt),
      lostReason: d.lostReason as string | null,
      notes: d.notes as string | null,
      createdAt: toISOString(d.createdAt),
      updatedAt: toISOString(d.updatedAt),
    })),
    tasks: taskRows.map((t) => ({
      id: t.id as string,
      title: t.title as string,
      description: t.description as string | null,
      type: t.type as string,
      status: t.status as string,
      priority: t.priority as string,
      dueDate: toISOStringOrNull(t.dueDate),
      completedAt: toISOStringOrNull(t.completedAt),
      createdAt: toISOString(t.createdAt),
    })),
    activityLogs: activityLogRows.map((a) => ({
      id: a.id as string,
      type: a.type as string,
      title: a.title as string,
      description: a.description as string | null,
      duration: a.duration as number | null,
      occurredAt: toISOString(a.occurredAt),
      createdAt: toISOString(a.createdAt),
    })),
    conversations: conversationsWithMessages,
    auditTrail: auditLogRows.map((l) => ({
      action: l.action as string,
      entityType: l.entityType as string,
      changes: l.changes,
      createdAt: toISOString(l.createdAt),
    })),
  };
}
