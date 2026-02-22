import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';
import { sendMessage } from './messages.js';
import { sendTelegramMessage } from './telegram-outbound.js';
import type { InlineKeyboardButton } from './telegram-outbound.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowStepInput {
  id?: string;
  stepOrder: number;
  type: 'send_message' | 'ask_question' | 'buttons' | 'condition' | 'assign_agent' | 'add_tag' | 'close_conversation';
  message?: string | null;
  options?: Record<string, unknown> | null;
  nextStepId?: string | null;
}

export interface CreateFlowInput {
  botId: string;
  name: string;
  description?: string | null;
  status?: 'active' | 'inactive' | 'draft';
  triggerOnNewConversation?: boolean;
  steps?: FlowStepInput[];
}

export interface UpdateFlowInput {
  name?: string;
  description?: string | null;
  status?: 'active' | 'inactive' | 'draft';
  triggerOnNewConversation?: boolean;
  steps?: FlowStepInput[];
}

type AuditInfo = { userId: string; ipAddress?: string; userAgent?: string };

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listFlows(botId?: string) {
  const flows = botId
    ? store.find('chatbotFlows', (r) => r.botId === botId)
    : store.getAll('chatbotFlows');
  return flows.sort((a, b) => new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime());
}

export async function getFlowById(id: string) {
  const flow = store.getById('chatbotFlows', id);
  if (!flow) return null;

  const steps = store
    .find('chatbotFlowSteps', (r) => r.flowId === id)
    .sort((a, b) => ((a.stepOrder as number) ?? 0) - ((b.stepOrder as number) ?? 0));

  return { ...flow, steps };
}

export async function createFlow(data: CreateFlowInput, audit?: AuditInfo) {
  const flow = store.insert('chatbotFlows', {
    botId: data.botId,
    name: data.name,
    description: data.description,
    status: data.status ?? 'draft',
    triggerOnNewConversation: data.triggerOnNewConversation ?? false,
    createdById: audit?.userId,
  });

  if (data.steps && data.steps.length > 0) {
    store.insertMany(
      'chatbotFlowSteps',
      data.steps.map((s) => ({
        flowId: flow.id,
        stepOrder: s.stepOrder,
        type: s.type,
        message: s.message,
        options: s.options,
        nextStepId: s.nextStepId,
      })),
    );
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'chatbot_flow',
      entityId: flow.id as string,
      changes: { name: data.name, botId: data.botId },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getFlowById(flow.id as string);
}

export async function updateFlow(id: string, data: UpdateFlowInput, audit?: AuditInfo) {
  const existing = store.getById('chatbotFlows', id);
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.status !== undefined) updates.status = data.status;
  if (data.triggerOnNewConversation !== undefined) updates.triggerOnNewConversation = data.triggerOnNewConversation;

  store.update('chatbotFlows', id, updates);

  // Replace steps if provided
  if (data.steps !== undefined) {
    store.deleteWhere('chatbotFlowSteps', (r) => r.flowId === id);
    if (data.steps.length > 0) {
      store.insertMany(
        'chatbotFlowSteps',
        data.steps.map((s) => ({
          flowId: id,
          stepOrder: s.stepOrder,
          type: s.type,
          message: s.message,
          options: s.options,
          nextStepId: s.nextStepId,
        })),
      );
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'chatbot_flow',
      entityId: id,
      changes: updates,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getFlowById(id);
}

export async function deleteFlow(id: string, audit?: AuditInfo) {
  const existing = store.getById('chatbotFlows', id);
  if (!existing) return false;

  // Clear any conversations that reference this flow
  const affectedConversations = store.find('conversations', (r) => r.activeChatbotFlowId === id);
  for (const conv of affectedConversations) {
    store.update('conversations', conv.id as string, {
      activeChatbotFlowId: null,
      chatbotFlowStepId: null,
      chatbotFlowData: {},
    });
  }

  store.deleteWhere('chatbotFlowSteps', (r) => r.flowId === id);
  store.delete('chatbotFlows', id);

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'chatbot_flow',
      entityId: id,
      changes: { name: existing.name },
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return true;
}

// ---------------------------------------------------------------------------
// Flow Execution Engine
// ---------------------------------------------------------------------------

/**
 * Find an active flow that should trigger for new conversations on a bot.
 */
export async function findTriggerFlow(botId: string) {
  const flow = store.findOne('chatbotFlows', (r) =>
    r.botId === botId && r.status === 'active' && r.triggerOnNewConversation === true,
  );
  return flow ?? null;
}

/**
 * Start a chatbot flow on a conversation. Sends the first step.
 */
export async function startFlow(flowId: string, conversationId: string) {
  const flow = await getFlowById(flowId);
  if (!flow || flow.steps.length === 0) return false;

  const firstStep = flow.steps[0];

  // Set conversation flow state
  store.update('conversations', conversationId, {
    activeChatbotFlowId: flowId,
    chatbotFlowStepId: firstStep.id,
    chatbotFlowData: {},
  });

  // Execute the first step
  await executeStep(firstStep as Record<string, unknown>, conversationId, flow.steps as Record<string, unknown>[]);
  return true;
}

/**
 * Handle an inbound message/callback in the context of an active flow.
 * Returns true if the message was handled by the flow, false if no active flow.
 */
export async function handleFlowMessage(
  conversationId: string,
  messageContent: string | null,
  callbackData?: string,
): Promise<boolean> {
  // Load conversation flow state
  const conversation = store.getById('conversations', conversationId);

  if (!conversation?.activeChatbotFlowId || !conversation?.chatbotFlowStepId) {
    return false;
  }

  // Load current step
  const currentStep = store.getById('chatbotFlowSteps', conversation.chatbotFlowStepId as string);

  if (!currentStep) {
    await clearFlowState(conversationId);
    return false;
  }

  // Load all steps for the flow
  const allSteps = store
    .find('chatbotFlowSteps', (r) => r.flowId === conversation.activeChatbotFlowId)
    .sort((a, b) => ((a.stepOrder as number) ?? 0) - ((b.stepOrder as number) ?? 0));

  // Determine next step based on current step type and user response
  const flowData = (conversation.chatbotFlowData as Record<string, unknown>) ?? {};
  let nextStepId: string | null | undefined = currentStep.nextStepId as string | null | undefined;

  if (currentStep.type === 'ask_question') {
    // Store the answer in flow data
    const opts = currentStep.options as { field?: string } | null;
    const field = opts?.field ?? `step_${currentStep.stepOrder}`;
    flowData[field] = messageContent;

    store.update('conversations', conversationId, { chatbotFlowData: flowData });
  }

  if (currentStep.type === 'buttons') {
    // Find which button was clicked to determine the next step
    const opts = currentStep.options as { buttons?: { text: string; value: string; nextStepId?: string }[] } | null;
    const buttons = opts?.buttons ?? [];
    const clicked = buttons.find(
      (b) => b.value === callbackData || b.value === messageContent || b.text === messageContent,
    );
    if (clicked?.nextStepId) {
      nextStepId = clicked.nextStepId;
    }
    // Store button response
    flowData[`step_${currentStep.stepOrder}`] = callbackData ?? messageContent;
    store.update('conversations', conversationId, { chatbotFlowData: flowData });
  }

  // Advance to next step
  if (!nextStepId) {
    // Find next step by order
    const currentIndex = allSteps.findIndex((s) => s.id === currentStep.id);
    const nextByOrder = allSteps[currentIndex + 1];
    if (nextByOrder) {
      nextStepId = nextByOrder.id as string;
    } else {
      // End of flow
      await clearFlowState(conversationId);
      return true;
    }
  }

  const nextStep = allSteps.find((s) => s.id === nextStepId);
  if (!nextStep) {
    await clearFlowState(conversationId);
    return true;
  }

  // Update conversation to next step
  store.update('conversations', conversationId, { chatbotFlowStepId: nextStep.id });

  // Execute the next step
  await executeStep(nextStep, conversationId, allSteps);
  return true;
}

/**
 * Execute a single flow step: send message, ask question, show buttons, etc.
 */
async function executeStep(
  step: Record<string, unknown>,
  conversationId: string,
  allSteps: Record<string, unknown>[],
) {
  switch (step.type) {
    case 'send_message': {
      if (step.message) {
        await sendFlowMessage(conversationId, step.message as string);
      }
      // Auto-advance to next step (no user input needed)
      await autoAdvance(step, conversationId, allSteps);
      break;
    }
    case 'ask_question': {
      if (step.message) {
        await sendFlowMessage(conversationId, step.message as string);
      }
      // Wait for user response — don't auto-advance
      break;
    }
    case 'buttons': {
      const opts = step.options as { buttons?: { text: string; value: string; nextStepId?: string }[] } | null;
      const buttons = opts?.buttons ?? [];
      const keyboard: InlineKeyboardButton[][] = buttons.map((b) => [
        { text: b.text, callback_data: b.value },
      ]);
      await sendFlowMessage(conversationId, (step.message as string) ?? 'Please choose an option:', keyboard);
      // Wait for button click — don't auto-advance
      break;
    }
    case 'condition': {
      const opts = step.options as {
        field?: string;
        operator?: string;
        value?: string;
        nextStepOnTrue?: string;
        nextStepOnFalse?: string;
      } | null;

      if (opts) {
        const matched = await evaluateCondition(conversationId, opts);
        const targetStepId = matched ? opts.nextStepOnTrue : opts.nextStepOnFalse;
        if (targetStepId) {
          const targetStep = allSteps.find((s) => s.id === targetStepId);
          if (targetStep) {
            store.update('conversations', conversationId, { chatbotFlowStepId: targetStep.id });
            await executeStep(targetStep, conversationId, allSteps);
            return;
          }
        }
      }
      // If condition couldn't resolve, advance normally
      await autoAdvance(step, conversationId, allSteps);
      break;
    }
    case 'assign_agent': {
      const opts = step.options as { agentId?: string } | null;
      if (opts?.agentId) {
        store.update('conversations', conversationId, { assigneeId: opts.agentId });
      }
      await autoAdvance(step, conversationId, allSteps);
      break;
    }
    case 'add_tag': {
      // Store the tag in flow data for now (actual tag assignment requires contact lookup)
      const opts = step.options as { tag?: string } | null;
      if (opts?.tag) {
        const conv = store.getById('conversations', conversationId);
        if (conv) {
          const flowData = (conv.chatbotFlowData as Record<string, unknown>) ?? {};
          const tags = (flowData._tags as string[]) ?? [];
          tags.push(opts.tag);
          flowData._tags = tags;
          store.update('conversations', conversationId, { chatbotFlowData: flowData });
        }
      }
      await autoAdvance(step, conversationId, allSteps);
      break;
    }
    case 'close_conversation': {
      if (step.message) {
        await sendFlowMessage(conversationId, step.message as string);
      }
      store.update('conversations', conversationId, {
        status: 'closed',
        closedAt: new Date(),
      });
      await clearFlowState(conversationId);
      break;
    }
  }
}

/**
 * Auto-advance to the next step (for steps that don't require user input).
 */
async function autoAdvance(
  currentStep: Record<string, unknown>,
  conversationId: string,
  allSteps: Record<string, unknown>[],
) {
  let nextStepId = currentStep.nextStepId as string | null | undefined;

  if (!nextStepId) {
    const currentIndex = allSteps.findIndex((s) => s.id === currentStep.id);
    const nextByOrder = allSteps[currentIndex + 1];
    if (nextByOrder) {
      nextStepId = nextByOrder.id as string;
    } else {
      await clearFlowState(conversationId);
      return;
    }
  }

  const nextStep = allSteps.find((s) => s.id === nextStepId);
  if (!nextStep) {
    await clearFlowState(conversationId);
    return;
  }

  store.update('conversations', conversationId, { chatbotFlowStepId: nextStep.id });

  await executeStep(nextStep, conversationId, allSteps);
}

/**
 * Evaluate a condition step against the collected flow data.
 */
async function evaluateCondition(
  conversationId: string,
  opts: { field?: string; operator?: string; value?: string },
): Promise<boolean> {
  const conv = store.getById('conversations', conversationId);
  if (!conv) return false;

  const flowData = (conv.chatbotFlowData as Record<string, unknown>) ?? {};
  const fieldValue = String(flowData[opts.field ?? ''] ?? '');
  const compareValue = opts.value ?? '';

  switch (opts.operator) {
    case 'equals':
      return fieldValue.toLowerCase() === compareValue.toLowerCase();
    case 'contains':
      return fieldValue.toLowerCase().includes(compareValue.toLowerCase());
    case 'not_empty':
      return fieldValue.trim().length > 0;
    case 'empty':
      return fieldValue.trim().length === 0;
    default:
      return false;
  }
}

/**
 * Send a message as part of a chatbot flow.
 */
async function sendFlowMessage(
  conversationId: string,
  text: string,
  inlineKeyboard?: InlineKeyboardButton[][],
) {
  const message = await sendMessage({
    conversationId,
    direction: 'outbound',
    type: 'text',
    content: text,
    metadata: JSON.stringify({ chatbotFlow: true }),
  });

  if (message) {
    sendTelegramMessage({
      conversationId,
      messageId: message.id as string,
      text,
      inlineKeyboard,
    }).catch(() => {
      // Fire-and-forget — status tracked via message record
    });
  }
}

/**
 * Clear the chatbot flow state from a conversation.
 */
async function clearFlowState(conversationId: string) {
  store.update('conversations', conversationId, {
    activeChatbotFlowId: null,
    chatbotFlowStepId: null,
  });
}
