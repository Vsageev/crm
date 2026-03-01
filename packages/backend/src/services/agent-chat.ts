import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { getAgent } from './agents.js';
import { createAgentRun, completeAgentRun } from './agent-runs.js';

const AGENTS_DIR = path.resolve(env.DATA_DIR, 'agents');

// ---------------------------------------------------------------------------
// CLI command builders
// ---------------------------------------------------------------------------

interface CliCommand {
  bin: string;
  args: string[];
}

const CHAT_MODE_SYSTEM_PROMPT =
  'You are a general-purpose assistant in a direct user chat. ' +
  'Non-coding requests are valid and should be handled directly when possible. ' +
  'Do not claim you are only a software engineering assistant. ' +
  'If a request cannot be fully completed due to tool or permission limits, explain the limitation briefly and provide the best actionable alternative.';

const TASK_MODE_SYSTEM_PROMPT =
  'You are a task execution agent. Complete the assigned task and report results. ' +
  'Refer to CHANNELS.MD for response instructions.';

function buildCliCommand(model: string, prompt: string, systemPrompt?: string): CliCommand {
  const modelLower = model.trim().toLowerCase();
  const sysPrompt = systemPrompt ?? CHAT_MODE_SYSTEM_PROMPT;

  if (modelLower.includes('claude')) {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'text',
      '--append-system-prompt',
      sysPrompt,
    ];
    // Always run without interactive permission prompts.
    args.push('--dangerously-skip-permissions');
    return { bin: 'claude', args };
  }
  if (modelLower.includes('codex')) {
    // Run codex in regular exec mode for conversational responses.
    const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--'];
    args.push(prompt);
    return { bin: 'codex', args };
  }
  if (modelLower.includes('qwen')) {
    const args = ['--output-format', 'text'];
    // Always run without interactive approvals.
    args.push('--approval-mode', 'yolo');
    args.push('--');
    args.push(prompt);
    return { bin: 'qwen', args };
  }

  // Fallback: treat model name as CLI binary with claude-like flags
  return { bin: modelLower, args: ['-p', prompt, '--output-format', 'text'] };
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
}

function isBackgroundTriggerConversationRecord(r: Record<string, unknown>): boolean {
  const meta = parseMetadata(r.metadata);
  if (!meta) return false;

  if (typeof meta.cronJobId === 'string' && meta.cronJobId.length > 0) return true;
  if (typeof meta.cardId === 'string' && meta.cardId.length > 0) return true;

  const trigger = typeof meta.trigger === 'string'
    ? meta.trigger
    : typeof meta.triggerType === 'string'
      ? meta.triggerType
      : null;

  return trigger === 'cron_job' || trigger === 'card_assignment' || trigger === 'cron' || trigger === 'card';
}

function isAgentConversation(r: Record<string, unknown>, agentId: string): boolean {
  if (r.channelType !== 'agent' && r.channelType !== 'other') return false;
  const meta = parseMetadata(r.metadata);
  return meta?.agentId === agentId;
}

/**
 * List all conversations belonging to an agent, sorted by lastMessageAt desc.
 * Lazy-backfills subject from first outbound message for legacy conversations.
 */
export function listAgentConversations(agentId: string, limit = 50, offset = 0) {
  const all = store.find(
    'conversations',
    (r: Record<string, unknown>) =>
      isAgentConversation(r, agentId) && !isBackgroundTriggerConversationRecord(r),
  );

  // Migrate legacy 'other' → 'agent' and backfill subject
  for (const conv of all) {
    let dirty = false;
    if (conv.channelType === 'other') {
      conv.channelType = 'agent';
      dirty = true;
    }
    if (conv.subject === null || conv.subject === undefined) {
      // Backfill from first outbound message
      const firstOut = store
        .find(
          'messages',
          (r: Record<string, unknown>) =>
            r.conversationId === conv.id && r.direction === 'outbound',
        )
        .sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            new Date(a.createdAt as string).getTime() -
            new Date(b.createdAt as string).getTime(),
        )[0];
      if (firstOut) {
        const text = (firstOut.content as string).slice(0, 60);
        conv.subject = text.length < (firstOut.content as string).length ? text + '...' : text;
        dirty = true;
      }
    }
    if (dirty) {
      store.update('conversations', conv.id as string, {
        channelType: conv.channelType,
        subject: conv.subject,
      });
    }
  }

  const sorted = all.sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt as string).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt as string).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return (
      new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
    );
  });

  const entries = sorted.slice(offset, offset + limit);
  return { entries, total: all.length };
}

/**
 * Create a new conversation for an agent.
 */
export function createAgentConversation(agentId: string, subject?: string) {
  return store.insert('conversations', {
    contactId: 'system',
    channelType: 'agent',
    status: 'open',
    subject: subject ?? null,
    externalId: null,
    isUnread: false,
    lastMessageAt: null,
    metadata: JSON.stringify({ agentId }),
  });
}

/**
 * Validate that a conversation belongs to the given agent.
 * Returns the conversation or null.
 */
export function validateConversationOwnership(
  conversationId: string,
  agentId: string,
): Record<string, unknown> | null {
  const conv = store.getById('conversations', conversationId);
  if (!conv) return null;
  if (isBackgroundTriggerConversationRecord(conv)) return null;
  const meta = parseMetadata(conv.metadata);
  if (meta?.agentId !== agentId) return null;
  return conv;
}

/**
 * Delete a conversation and all its messages.
 */
export function deleteAgentConversation(conversationId: string) {
  store.deleteWhere('messages', (r: Record<string, unknown>) => r.conversationId === conversationId);
  store.deleteWhere('message_drafts', (r: Record<string, unknown>) => r.conversationId === conversationId);
  return store.delete('conversations', conversationId);
}

/**
 * Rename a conversation.
 */
export function renameAgentConversation(conversationId: string, subject: string) {
  return store.update('conversations', conversationId, { subject });
}

// ---------------------------------------------------------------------------
// Save messages
// ---------------------------------------------------------------------------

type AgentConversationMessageType = 'text' | 'system';

interface SaveAgentMessageParams {
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  type?: AgentConversationMessageType;
  metadata?: Record<string, unknown> | null;
}

export function saveAgentConversationMessage(params: SaveAgentMessageParams) {
  const metadata = params.metadata ? JSON.stringify(params.metadata) : null;
  const msg = store.insert('messages', {
    conversationId: params.conversationId,
    direction: params.direction,
    type: params.type ?? 'text',
    content: params.content,
    status: params.direction === 'outbound' ? 'sent' : 'delivered',
    attachments: null,
    metadata,
  });

  store.update('conversations', params.conversationId, {
    lastMessageAt: new Date().toISOString(),
  });

  return msg;
}

function saveMessage(
  conversationId: string,
  direction: 'inbound' | 'outbound',
  content: string,
) {
  return saveAgentConversationMessage({
    conversationId,
    direction,
    content,
    type: 'text',
    metadata: null,
  });
}

// ---------------------------------------------------------------------------
// Auto-title helper
// ---------------------------------------------------------------------------

function autoTitleIfNeeded(conversationId: string, prompt: string) {
  const conv = store.getById('conversations', conversationId);
  if (!conv || conv.subject) return;

  const text = prompt.slice(0, 60);
  const subject = text.length < prompt.length ? text + '...' : text;
  store.update('conversations', conversationId, { subject });
}

// ---------------------------------------------------------------------------
// Conversation history builder
// ---------------------------------------------------------------------------

function buildPromptWithHistory(
  agentId: string,
  conversationId: string,
  currentPrompt: string,
): string {
  const history = store
    .find('messages', (r: Record<string, unknown>) => r.conversationId === conversationId)
    .sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) =>
        new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime(),
    );

  const triggerContext = buildTriggerContext('chat', { agentId, conversationId });

  const promptPreamble =
    'You are in a direct chat with a user. Respond to the latest User message clearly and directly. ' +
    'Non-coding requests are valid and should be handled directly when possible. ' +
    'Do not ask project-setup questions unless the user explicitly asks for coding/project help. ' +
    `You have workspace API access via $WORKSPACE_API_URL and $WORKSPACE_API_KEY env vars. ` +
    `Do not use /api/messages for this chat thread. ` +
    'See CHANNELS.MD for how to send progress updates and final answers. ' +
    'See CLAUDE.MD for endpoint examples.';

  if (history.length === 0) {
    return `${triggerContext}${promptPreamble}\n\nUser: ${currentPrompt}`;
  }

  const lines: string[] = [];
  for (const msg of history) {
    const metadata = parseMetadata(msg.metadata);
    const isProgressUpdate = metadata?.agentChatUpdate === true && metadata?.isFinal === false;
    if (isProgressUpdate) continue;

    const role = msg.direction === 'outbound' ? 'User' : 'Assistant';
    lines.push(`${role}: ${msg.content}`);
  }
  lines.push(`User: ${currentPrompt}`);

  return `${triggerContext}${promptPreamble}\n\nContinue the conversation below. Only respond to the latest User message.\n\n${lines.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Shared subprocess environment builder
// ---------------------------------------------------------------------------

type TriggerType = 'chat' | 'cron_job' | 'card_assignment';

interface AgentProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  runStartedAt: number;
}

interface AgentProcessOptions {
  agentId: string;
  agent: { name: string; model: string; apiKeyId: string; workspaceApiKey: string | null };
  runKey: string;
  prompt: string;
  systemPrompt: string;
  triggerType: 'chat' | 'cron' | 'card';
  triggerRef?: { conversationId?: string; cardId?: string; cronJobId?: string };
  onStdoutChunk?: (text: string) => void;
  onExit: (result: AgentProcessResult) => void;
  onSpawnError: (error: Error) => void;
}

function buildTriggerContext(
  trigger: TriggerType,
  fields: Record<string, string | undefined>,
): string {
  const lines = ['Trigger Context', `trigger: ${trigger}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value) lines.push(`${key}: ${value}`);
  }
  lines.push('End Trigger Context', '');
  return `${lines.join('\n')}\n`;
}

function buildChildEnv(agent: { apiKeyId: string; workspaceApiKey: string | null }): Record<string, string | undefined> {
  const childEnv: Record<string, string | undefined> = { ...process.env };

  if (agent.apiKeyId) {
    const apiKey = store.getById('apiKeys', agent.apiKeyId);
    if (apiKey) {
      childEnv.ANTHROPIC_API_KEY = childEnv.ANTHROPIC_API_KEY || '';
      childEnv.OPENAI_API_KEY = childEnv.OPENAI_API_KEY || '';
    }
  }

  if (agent.workspaceApiKey) {
    const protocol = env.TLS_CERT_PATH ? 'https' : 'http';
    const host = env.HOST === '0.0.0.0' ? 'localhost' : env.HOST;
    childEnv.WORKSPACE_API_URL = `${protocol}://${host}:${env.PORT}`;
    childEnv.WORKSPACE_API_KEY = agent.workspaceApiKey;
  }

  return childEnv;
}

function markAgentLastActivity(agentId: string) {
  store.update('agents', agentId, {
    lastActivity: new Date().toISOString(),
  });
}

function listAgentApiUpdates(conversationId: string, runStartedAt: number) {
  return store
    .find(
      'messages',
      (r: Record<string, unknown>) =>
        r.conversationId === conversationId &&
        r.direction === 'inbound' &&
        new Date(r.createdAt as string).getTime() >= runStartedAt &&
        parseMetadata(r.metadata)?.agentChatUpdate === true,
    )
    .sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) =>
        new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime(),
    );
}

function findFinalAgentApiMessage(messages: Record<string, unknown>[]) {
  return [...messages].reverse().find((msg) => parseMetadata(msg.metadata)?.isFinal === true) ?? null;
}

function runAgentProcess(options: AgentProcessOptions) {
  const workDir = path.join(AGENTS_DIR, options.agentId);
  const { bin, args } = buildCliCommand(options.agent.model, options.prompt, options.systemPrompt);
  const childEnv = buildChildEnv(options.agent);

  const child = spawn(bin, args, {
    cwd: workDir,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runningProcesses.set(options.runKey, child);

  // Record the agent run
  const agentRun = createAgentRun({
    agentId: options.agentId,
    agentName: options.agent.name,
    triggerType: options.triggerType,
    conversationId: options.triggerRef?.conversationId,
    cardId: options.triggerRef?.cardId,
    cronJobId: options.triggerRef?.cronJobId,
  });
  const runId = agentRun.id as string;

  let stdout = '';
  let stderr = '';
  const runStartedAt = Date.now();
  let settled = false;

  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    runningProcesses.delete(options.runKey);
    callback();
  };

  child.stdout!.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    options.onStdoutChunk?.(text);
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    settle(() => {
      markAgentLastActivity(options.agentId);
      const hasError = (code ?? 1) !== 0 && !stdout.trim();
      const errorMsg = hasError ? (stderr.trim() || `Process exited with code ${code}`) : null;
      completeAgentRun(runId, errorMsg, { stdout, stderr });
      options.onExit({ code, stdout, stderr, runStartedAt });
    });
  });

  child.on('error', (err) => {
    settle(() => {
      completeAgentRun(runId, err.message, { stderr: err.message });
      options.onSpawnError(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Execute prompt (chat)
// ---------------------------------------------------------------------------

// Track running processes per run key so parallel chats/tasks can run.
const runningProcesses = new Map<string, ChildProcess>();

function processKey(agentId: string, conversationId: string): string {
  return `${agentId}:${conversationId}`;
}

export interface ExecutePromptCallbacks {
  onChunk: (text: string) => void;
  onDone: (message: Record<string, unknown>) => void;
  onError: (error: string) => void;
}

export function executePrompt(
  agentId: string,
  prompt: string,
  conversationId: string,
  callbacks: ExecutePromptCallbacks,
) {
  const agent = getAgent(agentId);
  if (!agent) {
    callbacks.onError('Agent not found');
    return;
  }

  const key = processKey(agentId, conversationId);
  if (runningProcesses.has(key)) {
    callbacks.onError('Agent is already processing a prompt');
    return;
  }

  // Build prompt with conversation history BEFORE saving, so current message isn't duplicated
  const fullPrompt = buildPromptWithHistory(agentId, conversationId, prompt);

  // Save user message
  saveMessage(conversationId, 'outbound', prompt);

  // Auto-title conversation on first message
  autoTitleIfNeeded(conversationId, prompt);

  runAgentProcess({
    agentId,
    agent,

    runKey: key,
    prompt: fullPrompt,
    systemPrompt: CHAT_MODE_SYSTEM_PROMPT,
    triggerType: 'chat',
    triggerRef: { conversationId },
    onStdoutChunk: (text) => {
      callbacks.onChunk(text);
    },
    onExit: ({ code, stdout, stderr, runStartedAt }) => {
      if ((code ?? 1) !== 0 && !stdout.trim()) {
        const errMsg = stderr.trim() || `Process exited with code ${code}`;
        callbacks.onError(errMsg);
        return;
      }

      const updatesFromApi = listAgentApiUpdates(conversationId, runStartedAt);
      const finalApiMessage = findFinalAgentApiMessage(updatesFromApi);
      const stdoutText = stdout.trim();

      let msg: Record<string, unknown>;
      if (finalApiMessage) {
        // Agent already posted a final API message; avoid duplicating stdout.
        msg = finalApiMessage;
      } else if (stdoutText) {
        // Fallback for agents that still return output only through stdout.
        msg = saveMessage(conversationId, 'inbound', stdoutText);
      } else if (updatesFromApi.length > 0) {
        // No stdout and no explicit final marker; use latest API update.
        msg = updatesFromApi[updatesFromApi.length - 1];
      } else {
        msg = saveMessage(conversationId, 'inbound', '(empty response)');
      }

      callbacks.onDone(msg);
    },
    onSpawnError: (err) => {
      callbacks.onError(`Failed to start CLI: ${err.message}`);
    },
  });
}

export function isAgentBusy(agentId: string, conversationId: string): boolean {
  return runningProcesses.has(processKey(agentId, conversationId));
}

// ---------------------------------------------------------------------------
// Execute cron task (cron job trigger)
// ---------------------------------------------------------------------------

export function executeCronTask(
  agentId: string,
  job: { id: string; prompt: string },
) {
  const agent = getAgent(agentId);
  if (!agent) return;

  const key = `${agentId}:cron:${job.id}`;
  if (runningProcesses.has(key)) {
    // Previous run still in progress — skip this invocation
    return;
  }

  const triggerContext = buildTriggerContext('cron_job', {
    agentId,
    cronJobId: job.id,
  });

  const prompt =
    `${triggerContext}` +
    `You have been triggered by a scheduled cron job. See CHANNELS.MD for how to respond.\n` +
    `This is a background automation run, not a chat conversation. Do not call /api/agents/:id/chat/messages.\n\n` +
    `**Task:** ${job.prompt}\n\n` +
    `Complete this task.`;

  runAgentProcess({
    agentId,
    agent,

    runKey: key,
    prompt,
    systemPrompt: TASK_MODE_SYSTEM_PROMPT,
    triggerType: 'cron',
    triggerRef: { cronJobId: job.id },
    onExit: ({ code, stderr }) => {
      if ((code ?? 1) !== 0) {
        const errMsg = stderr.trim() || `Process exited with code ${code}`;
        console.error(`Agent cron task error for job ${job.id}:`, errMsg);
      }
    },
    onSpawnError: (err) => {
      console.error(`Agent cron task failed to start for job ${job.id}:`, err.message);
    },
  });
}

// ---------------------------------------------------------------------------
// Execute card task (card assignment trigger)
// ---------------------------------------------------------------------------

export function executeCardTask(
  agentId: string,
  card: { id: string; name: string; description: string | null; collectionId: string },
  callbacks: { onDone: () => void; onError: (err: string) => void },
) {
  const agent = getAgent(agentId);
  if (!agent) {
    callbacks.onError('Agent not found');
    return;
  }

  const key = `${agentId}:card:${card.id}`;
  if (runningProcesses.has(key)) {
    callbacks.onError('Agent is already processing this card');
    return;
  }

  const triggerContext = buildTriggerContext('card_assignment', {
    agentId,
    cardId: card.id,
  });

  const descriptionLine = card.description
    ? `**Description:** ${card.description}`
    : '**Description:** (none)';

  const prompt =
    `${triggerContext}` +
    `You have been assigned the following card. See CHANNELS.MD for how to respond.\n` +
    `This is a task assignment run, not a chat conversation. Do not call /api/agents/:id/chat/messages.\n\n` +
    `**Card:** ${card.name}\n` +
    `${descriptionLine}\n\n` +
    `Complete this task.`;

  runAgentProcess({
    agentId,
    agent,

    runKey: key,
    prompt,
    systemPrompt: TASK_MODE_SYSTEM_PROMPT,
    triggerType: 'card',
    triggerRef: { cardId: card.id },
    onExit: ({ code, stderr }) => {
      if ((code ?? 1) !== 0) {
        const errMsg = stderr.trim() || `Process exited with code ${code}`;
        callbacks.onError(errMsg);
        return;
      }

      callbacks.onDone();
    },
    onSpawnError: (err) => {
      callbacks.onError(`Failed to start CLI: ${err.message}`);
    },
  });
}
