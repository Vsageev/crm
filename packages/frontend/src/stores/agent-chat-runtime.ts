import { useSyncExternalStore } from 'react';
import { getAccessToken } from '../lib/api';

export type AgentChatStreamStatus = 'streaming' | 'done' | 'error';

export interface AgentChatStreamState {
  id: string;
  agentId: string;
  conversationId: string;
  status: AgentChatStreamStatus;
  text: string;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  messageId: string | null;
}

interface StartAgentChatStreamParams {
  agentId: string;
  conversationId: string;
  prompt: string;
}

interface StartAgentChatStreamResult {
  fullText: string;
  messageId: string | null;
}

const STREAM_RETENTION_MS = 2 * 60 * 1000;

const listeners = new Set<() => void>();
const streamsById = new Map<string, AgentChatStreamState>();
const unreadConversationIds = new Set<string>();
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
let snapshot: AgentChatStreamState[] = [];
let unreadSnapshot: string[] = [];

function streamId(agentId: string, conversationId: string): string {
  return `${agentId}:${conversationId}`;
}

function updateSnapshot() {
  snapshot = Array.from(streamsById.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function updateUnreadSnapshot() {
  unreadSnapshot = Array.from(unreadConversationIds);
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getUnreadSnapshot() {
  return unreadSnapshot;
}

function commitStream(next: AgentChatStreamState) {
  streamsById.set(next.id, next);
  updateSnapshot();
  notify();
}

function updateStream(
  id: string,
  updater: (current: AgentChatStreamState) => AgentChatStreamState,
): AgentChatStreamState | null {
  const current = streamsById.get(id);
  if (!current) return null;
  const next = updater(current);
  streamsById.set(id, next);
  updateSnapshot();
  notify();
  return next;
}

function scheduleCleanup(id: string) {
  const existing = cleanupTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    cleanupTimers.delete(id);
    streamsById.delete(id);
    updateSnapshot();
    notify();
  }, STREAM_RETENTION_MS);
  cleanupTimers.set(id, timer);
}

function cancelCleanup(id: string) {
  const existing = cleanupTimers.get(id);
  if (!existing) return;
  clearTimeout(existing);
  cleanupTimers.delete(id);
}

export function useAgentChatStreams() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAgentChatUnreadConversationIds() {
  return useSyncExternalStore(subscribe, getUnreadSnapshot, getUnreadSnapshot);
}

export function markAgentChatConversationRead(conversationId: string) {
  if (!unreadConversationIds.delete(conversationId)) return;
  updateUnreadSnapshot();
  notify();
}

export function getLatestStreamingAgentChatStream(): AgentChatStreamState | null {
  for (const stream of snapshot) {
    if (stream.status === 'streaming') return stream;
  }
  return null;
}

export function isAgentChatStreaming(agentId: string, conversationId: string): boolean {
  for (const stream of snapshot) {
    if (
      stream.agentId === agentId &&
      stream.conversationId === conversationId &&
      stream.status === 'streaming'
    ) {
      return true;
    }
  }
  return false;
}

export async function startAgentChatStream(
  params: StartAgentChatStreamParams,
): Promise<StartAgentChatStreamResult> {
  if (isAgentChatStreaming(params.agentId, params.conversationId)) {
    throw new Error('Agent is already processing a prompt');
  }

  const id = streamId(params.agentId, params.conversationId);
  cancelCleanup(id);
  markAgentChatConversationRead(params.conversationId);

  const startedAt = Date.now();
  commitStream({
    id,
    agentId: params.agentId,
    conversationId: params.conversationId,
    status: 'streaming',
    text: '',
    error: null,
    startedAt,
    updatedAt: startedAt,
    messageId: null,
  });

  let fullText = '';
  let messageId: string | null = null;

  try {
    const token = getAccessToken();
    const response = await fetch(`/api/agents/${params.agentId}/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        prompt: params.prompt,
        conversationId: params.conversationId,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error((body as { message?: string })?.message || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = 'message';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6);
        try {
          const parsed: unknown = JSON.parse(data);
          if (eventType === 'done') {
            const maybeMessageId =
              parsed && typeof parsed === 'object' && 'messageId' in parsed
                ? (parsed as { messageId?: unknown }).messageId
                : null;
            if (typeof maybeMessageId === 'string') {
              messageId = maybeMessageId;
            }
          } else if (eventType === 'error') {
            const maybeError =
              parsed && typeof parsed === 'object' && 'error' in parsed
                ? (parsed as { error?: unknown }).error
                : null;
            const errorMessage = typeof maybeError === 'string' ? maybeError : 'Agent error';

            updateStream(id, (current) => ({
              ...current,
              status: 'error',
              error: errorMessage,
              updatedAt: Date.now(),
            }));
            scheduleCleanup(id);
            throw new Error(errorMessage);
          } else if (typeof parsed === 'string') {
            fullText += parsed;
            updateStream(id, (current) => ({
              ...current,
              text: fullText,
              updatedAt: Date.now(),
            }));
          }
        } catch (err) {
          if (err instanceof Error && eventType === 'error') {
            throw err;
          }
          // Ignore malformed SSE payloads and continue parsing.
        }

        eventType = 'message';
      }
    }

    updateStream(id, (current) => ({
      ...current,
      status: 'done',
      error: null,
      messageId,
      updatedAt: Date.now(),
    }));
    unreadConversationIds.add(params.conversationId);
    updateUnreadSnapshot();
    notify();
    scheduleCleanup(id);

    return { fullText: fullText.trim(), messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send message';
    const current = streamsById.get(id);

    if (current?.status === 'streaming') {
      updateStream(id, (stream) => ({
        ...stream,
        status: 'error',
        error: message,
        updatedAt: Date.now(),
      }));
      scheduleCleanup(id);
    }

    throw err;
  }
}
