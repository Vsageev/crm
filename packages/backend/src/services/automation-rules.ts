import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export interface AutomationRuleListQuery {
  trigger?: string;
  action?: string;
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateAutomationRuleData {
  name: string;
  description?: string;
  trigger: string;
  conditions?: unknown[];
  action: string;
  actionParams?: Record<string, unknown>;
  isActive?: boolean;
  priority?: number;
  createdById?: string;
}

export interface UpdateAutomationRuleData {
  name?: string;
  description?: string | null;
  trigger?: string;
  conditions?: unknown[];
  action?: string;
  actionParams?: Record<string, unknown>;
  isActive?: boolean;
  priority?: number;
}

export async function listAutomationRules(query: AutomationRuleListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (query.trigger && r.trigger !== query.trigger) return false;
    if (query.action && r.action !== query.action) return false;
    if (query.isActive !== undefined && r.isActive !== query.isActive) return false;
    if (query.search && !(r.name as string)?.toLowerCase().includes(query.search.toLowerCase())) return false;
    return true;
  };

  const all = store.find('automationRules', predicate)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  const total = all.length;
  const entries = all.slice(offset, offset + limit);

  return { entries, total };
}

export async function getAutomationRuleById(id: string) {
  return store.getById('automationRules', id) ?? null;
}

export async function getActiveRulesByTrigger(trigger: string) {
  return store
    .find('automationRules', (r) => r.trigger === trigger && r.isActive === true)
    .sort((a, b) => ((a.priority as number) ?? 0) - ((b.priority as number) ?? 0));
}

export async function createAutomationRule(
  data: CreateAutomationRuleData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const rule = store.insert('automationRules', { ...data });

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'automation_rule',
      entityId: rule.id as string,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return rule;
}

export async function updateAutomationRule(
  id: string,
  data: UpdateAutomationRuleData,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      setData[key] = value;
    }
  }

  const updated = store.update('automationRules', id, setData);
  if (!updated) return null;

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'automation_rule',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return updated;
}

export async function deleteAutomationRule(
  id: string,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
) {
  const deleted = store.delete('automationRules', id);

  if (deleted && audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'automation_rule',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return deleted ?? null;
}
