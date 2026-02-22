import { store } from '../db/index.js';
import { createTask } from './tasks.js';
import { sendMessage } from './messages.js';
import { createDeal, moveDeal, updateDeal } from './deals.js';
import { updateContact } from './contacts.js';
import { updateConversation } from './conversations.js';
import { createNotification } from './notifications.js';
import { eventBus } from './event-bus.js';
import { getNextRoundRobinAgent } from './round-robin.js';
import type { MatchedRule } from './automation-engine.js';

// ---------------------------------------------------------------------------
// Result type for action execution
// ---------------------------------------------------------------------------

export interface ActionResult {
  success: boolean;
  action: string;
  ruleId: string;
  ruleName: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Audit context used when automation performs mutations
// ---------------------------------------------------------------------------

const AUTOMATION_AUDIT = {
  userId: '00000000-0000-0000-0000-000000000000', // system user
  ipAddress: 'automation',
  userAgent: 'automation-engine',
};

// ---------------------------------------------------------------------------
// Individual action executors
// ---------------------------------------------------------------------------

/**
 * Assign an agent to a contact and/or deal.
 *
 * Expected actionParams:
 *   - mode?: 'specific' | 'round_robin' (default: 'specific')
 *   - agentId?: string        — required when mode is 'specific'
 *   - agentIds?: string[]     — pool of agents for round-robin (all active users if empty)
 *   - target?: 'contact' | 'deal' | 'both' (default: 'both')
 *
 * The ruleId is passed via __ruleId in the params (injected by executeAction).
 */
async function executeAssignAgent(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  const mode = (params.mode as string) ?? 'specific';
  let agentId: string | undefined;

  if (mode === 'round_robin') {
    const ruleId = params.__ruleId as string | undefined;
    if (!ruleId) throw new Error('ruleId is required for round-robin assignment');

    const agentIds = params.agentIds as string[] | undefined;
    const selectedAgent = await getNextRoundRobinAgent(ruleId, agentIds);
    if (!selectedAgent) throw new Error('No active agents available for round-robin assignment');
    agentId = selectedAgent;
    console.log(`[automation] Round-robin assigned agent ${agentId} for rule ${ruleId}`);
  } else {
    agentId = params.agentId as string | undefined;
    if (!agentId) throw new Error('actionParams.agentId is required for assign_agent');
  }

  const target = (params.target as string) ?? 'both';
  const contactId = (payload.contactId ?? (payload.contact as Record<string, unknown>)?.id) as string | undefined;
  const dealId = (payload.dealId ?? (payload.deal as Record<string, unknown>)?.id) as string | undefined;
  const conversationId =
    (payload.conversationId ?? (payload.conversation as Record<string, unknown>)?.id) as string | undefined;

  if ((target === 'contact' || target === 'both') && contactId) {
    await updateContact(contactId, { ownerId: agentId }, AUTOMATION_AUDIT);
  }

  if ((target === 'deal' || target === 'both') && dealId) {
    await updateDeal(dealId, { ownerId: agentId }, AUTOMATION_AUDIT);
  }

  // Route (assign) the conversation to the agent when conversationId is available
  if (conversationId) {
    await updateConversation(conversationId, { assigneeId: agentId }, AUTOMATION_AUDIT);
  }
}

/**
 * Create a task linked to the triggering contact/deal.
 *
 * Expected actionParams:
 *   - title: string
 *   - description?: string
 *   - type?: 'call' | 'meeting' | 'email' | 'follow_up' | 'other'
 *   - priority?: 'low' | 'medium' | 'high'
 *   - dueInHours?: number     — hours from now to set the due date
 *   - assigneeId?: string     — explicit assignee; falls back to deal/contact owner
 */
async function executeCreateTask(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  const title = params.title as string | undefined;
  if (!title) throw new Error('actionParams.title is required for create_task');

  const contactId = (payload.contactId ?? (payload.contact as Record<string, unknown>)?.id) as string | undefined;
  const dealId = (payload.dealId ?? (payload.deal as Record<string, unknown>)?.id) as string | undefined;

  // Resolve assignee: explicit param > deal owner > contact owner
  let assigneeId = params.assigneeId as string | undefined;
  if (!assigneeId) {
    assigneeId =
      (payload.deal as Record<string, unknown>)?.ownerId as string | undefined
      ?? (payload.contact as Record<string, unknown>)?.ownerId as string | undefined;
  }

  let dueDate: string | undefined;
  if (params.dueInHours) {
    const ms = Number(params.dueInHours) * 60 * 60 * 1000;
    dueDate = new Date(Date.now() + ms).toISOString();
  } else if (params.dueDate) {
    dueDate = params.dueDate as string;
  }

  await createTask(
    {
      title,
      description: params.description as string | undefined,
      type: (params.type as 'call' | 'meeting' | 'email' | 'follow_up' | 'other') ?? 'follow_up',
      priority: (params.priority as 'low' | 'medium' | 'high') ?? 'medium',
      dueDate,
      contactId,
      dealId,
      assigneeId,
    },
    AUTOMATION_AUDIT,
  );
}

/**
 * Send a message to a conversation.
 *
 * Expected actionParams:
 *   - content: string              — message text
 *   - conversationId?: string      — explicit target; falls back to payload
 *   - type?: message type          — defaults to 'text'
 */
async function executeSendMessage(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  const content = params.content as string | undefined;
  if (!content) throw new Error('actionParams.content is required for send_message');

  const conversationId =
    (params.conversationId as string | undefined)
    ?? (payload.conversationId as string | undefined)
    ?? (payload.conversation as Record<string, unknown>)?.id as string | undefined;

  if (!conversationId) throw new Error('Cannot determine conversationId for send_message');

  await sendMessage(
    {
      conversationId,
      direction: 'outbound',
      type: (params.type as 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker' | 'location' | 'system') ?? 'text',
      content,
    },
    AUTOMATION_AUDIT,
  );
}

/**
 * Move a deal to a different pipeline stage.
 *
 * Expected actionParams:
 *   - pipelineStageId: string   — target stage ID
 *   - lostReason?: string       — reason if moving to a loss stage
 */
async function executeMoveDeal(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  const pipelineStageId = params.pipelineStageId as string | undefined;
  if (!pipelineStageId) throw new Error('actionParams.pipelineStageId is required for move_deal');

  const dealId = (payload.dealId ?? (payload.deal as Record<string, unknown>)?.id) as string | undefined;
  if (!dealId) throw new Error('Cannot determine dealId for move_deal');

  await moveDeal(
    dealId,
    {
      pipelineStageId,
      lostReason: params.lostReason as string | undefined,
    },
    AUTOMATION_AUDIT,
  );
}

/**
 * Add one or more tags to a contact.
 *
 * Expected actionParams:
 *   - tagIds: string[]
 */
async function executeAddTag(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  const tagIds = params.tagIds as string[] | undefined;
  if (!tagIds || !Array.isArray(tagIds) || tagIds.length === 0) {
    throw new Error('actionParams.tagIds (non-empty array) is required for add_tag');
  }

  const contactId = (payload.contactId ?? (payload.contact as Record<string, unknown>)?.id) as string | undefined;
  if (!contactId) throw new Error('Cannot determine contactId for add_tag');

  // We pass tagIds to updateContact — it replaces all tags.
  // To *add* without removing existing, we'd need to read current tags first.
  // For now, the automation rule should provide the full desired tag set.
  await updateContact(contactId, { tagIds }, AUTOMATION_AUDIT);
}

/**
 * Send an in-app notification to a specific user.
 *
 * Expected actionParams:
 *   - userId: string            — recipient user ID
 *   - title: string
 *   - message?: string
 *   - type?: notification type  — defaults to 'system'
 */
async function executeSendNotification(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  const userId = params.userId as string | undefined;
  if (!userId) throw new Error('actionParams.userId is required for send_notification');

  const title = params.title as string | undefined;
  if (!title) throw new Error('actionParams.title is required for send_notification');

  // Derive entity info from payload for linking the notification
  const entityType =
    payload.dealId ? 'deal'
    : payload.contactId ? 'contact'
    : payload.taskId ? 'task'
    : undefined;

  const entityId =
    (payload.dealId ?? payload.contactId ?? payload.taskId) as string | undefined;

  await createNotification({
    userId,
    type: (params.type as 'task_due_soon' | 'task_overdue' | 'deal_update' | 'lead_assigned' | 'mention' | 'system') ?? 'system',
    title,
    message: params.message as string | undefined,
    entityType,
    entityId,
  });
}

/**
 * Create a deal linked to the triggering contact.
 *
 * Expected actionParams:
 *   - title: string                — deal title (e.g. "Telegram Lead")
 *   - pipelineId?: string          — target pipeline; uses default if omitted
 *   - pipelineStageId?: string     — target stage; uses first stage if omitted
 *   - value?: string               — deal value
 *   - currency?: string            — currency code (default: USD)
 *   - ownerId?: string             — agent to assign; falls back to contact owner
 *   - notes?: string               — deal notes
 *   - tagIds?: string[]            — tags to add to deal
 */
async function executeCreateDeal(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<void> {
  const title = params.title as string | undefined;
  if (!title) throw new Error('actionParams.title is required for create_deal');

  const contactId = (payload.contactId ?? (payload.contact as Record<string, unknown>)?.id) as string | undefined;
  if (!contactId) throw new Error('Cannot determine contactId for create_deal');

  // Resolve pipeline: explicit param > default pipeline
  let pipelineId = params.pipelineId as string | undefined;
  let pipelineStageId = params.pipelineStageId as string | undefined;

  if (!pipelineId) {
    const defaultPipeline = store.findOne('pipelines', (r) => r.isDefault === true);
    if (defaultPipeline) {
      pipelineId = defaultPipeline.id as string;
    }
  }

  // Resolve stage: explicit param > first stage of pipeline
  if (!pipelineStageId && pipelineId) {
    const stages = store
      .find('pipelineStages', (r) => r.pipelineId === pipelineId)
      .sort((a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0));

    if (stages.length > 0) {
      pipelineStageId = stages[0].id as string;
    }
  }

  // Resolve owner: explicit param > contact owner
  let ownerId = params.ownerId as string | undefined;
  if (!ownerId) {
    ownerId = (payload.contact as Record<string, unknown>)?.ownerId as string | undefined;
  }

  const deal = await createDeal(
    {
      title,
      contactId,
      pipelineId,
      pipelineStageId,
      value: params.value as string | undefined,
      currency: (params.currency as string) ?? 'USD',
      ownerId,
      notes: params.notes as string | undefined,
      tagIds: params.tagIds as string[] | undefined,
      leadSource: 'telegram',
    },
    AUTOMATION_AUDIT,
  );

  // Emit deal_created so downstream automations can react
  eventBus.emit('deal_created', {
    dealId: deal.id,
    deal: deal as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Dispatcher — maps action name to executor
// ---------------------------------------------------------------------------

const EXECUTORS: Record<string, (params: Record<string, unknown>, payload: Record<string, unknown>) => Promise<void>> = {
  assign_agent: executeAssignAgent,
  create_task: executeCreateTask,
  send_message: executeSendMessage,
  move_deal: executeMoveDeal,
  add_tag: executeAddTag,
  send_notification: executeSendNotification,
  create_deal: executeCreateDeal,
};

/**
 * Execute a single matched automation rule action.
 * Returns an ActionResult indicating success or failure.
 */
export async function executeAction(
  rule: MatchedRule,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const executor = EXECUTORS[rule.action];

  if (!executor) {
    return {
      success: false,
      action: rule.action,
      ruleId: rule.id,
      ruleName: rule.name,
      error: `Unknown action type: ${rule.action}`,
    };
  }

  try {
    // Inject ruleId so executors (e.g. round-robin) can track state per rule
    const paramsWithMeta = { ...rule.actionParams, __ruleId: rule.id };
    await executor(paramsWithMeta, payload);
    console.log(
      `[automation] Executed action "${rule.action}" for rule "${rule.name}" (${rule.id})`,
    );
    return {
      success: true,
      action: rule.action,
      ruleId: rule.id,
      ruleName: rule.name,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[automation] Failed action "${rule.action}" for rule "${rule.name}" (${rule.id}): ${message}`,
    );
    return {
      success: false,
      action: rule.action,
      ruleId: rule.id,
      ruleName: rule.name,
      error: message,
    };
  }
}
