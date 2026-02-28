import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { getAgent } from './agents.js';

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

function buildCliCommand(model: string, prompt: string, skipPermissions: boolean): CliCommand {
  const modelLower = model.toLowerCase();

  if (modelLower === 'claude') {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'text',
      '--append-system-prompt',
      CHAT_MODE_SYSTEM_PROMPT,
    ];
    if (skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }
    return { bin: 'claude', args };
  }
  if (modelLower === 'codex') {
    // Run codex in regular exec mode for conversational responses.
    const args = ['exec'];
    if (skipPermissions) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    args.push(prompt);
    return { bin: 'codex', args };
  }
  if (modelLower === 'qwen') {
    const args = ['--output-format', 'text'];
    if (skipPermissions) {
      args.push('--approval-mode', 'yolo');
    }
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
  const all = store.find('conversations', (r: Record<string, unknown>) =>
    isAgentConversation(r, agentId),
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

  const promptPreamble =
    'You are in a direct chat with a user. Respond to the latest User message clearly and directly. ' +
    'Non-coding requests are valid and should be handled directly when possible. ' +
    'Do not ask project-setup questions unless the user explicitly asks for coding/project help. ' +
    `You have workspace API access via $WORKSPACE_API_URL and $WORKSPACE_API_KEY env vars. ` +
    `Use API message updates instead of relying on stream output for progress. ` +
    `Do not use /api/messages for this chat thread. ` +
    `For this run, send progress updates to POST $WORKSPACE_API_URL/api/agents/${agentId}/chat/messages ` +
    `with body {"conversationId":"${conversationId}","content":"<short update>","isFinal":false}. ` +
    `When done, send the final user-facing answer to the same endpoint with isFinal:true so the app receives it as the last message. ` +
    'See CLAUDE.MD for endpoint examples.';

  if (history.length === 0) {
    return `${promptPreamble}\n\nUser: ${currentPrompt}`;
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

  return `${promptPreamble}\n\nContinue the conversation below. Only respond to the latest User message.\n\n${lines.join('\n\n')}`;
}

// ---------------------------------------------------------------------------
// Execute prompt
// ---------------------------------------------------------------------------

// Track running processes per (agent, conversation) so parallel chats can run.
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
  const runStartedAt = Date.now();

  const workDir = path.join(AGENTS_DIR, agentId);
  const { bin, args } = buildCliCommand(agent.model, fullPrompt, Boolean(agent.skipPermissions));

  // Build env with API key if available
  const childEnv = { ...process.env };
  if (agent.apiKeyId) {
    const apiKey = store.getById('apiKeys', agent.apiKeyId);
    if (apiKey) {
      // Pass common env vars that CLI tools use
      childEnv.ANTHROPIC_API_KEY = childEnv.ANTHROPIC_API_KEY || '';
      childEnv.OPENAI_API_KEY = childEnv.OPENAI_API_KEY || '';
    }
  }

  // Pass workspace API credentials so the agent can call workspace endpoints
  if (agent.workspaceApiKey) {
    const protocol = env.TLS_CERT_PATH ? 'https' : 'http';
    const host = env.HOST === '0.0.0.0' ? 'localhost' : env.HOST;
    childEnv.WORKSPACE_API_URL = `${protocol}://${host}:${env.PORT}`;
    childEnv.WORKSPACE_API_KEY = agent.workspaceApiKey;
  }

  const child = spawn(bin, args, {
    cwd: workDir,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runningProcesses.set(key, child);

  let fullResponse = '';
  let stderrOutput = '';

  child.stdout!.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    fullResponse += text;
    callbacks.onChunk(text);
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  child.on('close', (code) => {
    runningProcesses.delete(key);

    if (code !== 0 && !fullResponse.trim()) {
      const errMsg = stderrOutput.trim() || `Process exited with code ${code}`;
      callbacks.onError(errMsg);
      return;
    }

    const updatesFromApi = store
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

    const finalApiMessage =
      [...updatesFromApi].reverse().find((msg) => parseMetadata(msg.metadata)?.isFinal === true) ?? null;

    const stdoutText = fullResponse.trim();
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

    // Update agent lastActivity
    store.update('agents', agentId, {
      lastActivity: new Date().toISOString(),
    });

    callbacks.onDone(msg);
  });

  child.on('error', (err) => {
    runningProcesses.delete(key);
    callbacks.onError(`Failed to start CLI: ${err.message}`);
  });
}

export function isAgentBusy(agentId: string, conversationId: string): boolean {
  return runningProcesses.has(processKey(agentId, conversationId));
}
