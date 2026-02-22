import type { ChatWidgetConfig, ChatMessage, SendMessageResponse } from './types.js';

export class ChatApiClient {
  constructor(private baseUrl: string) {}

  async fetchConfig(widgetId: string): Promise<ChatWidgetConfig> {
    const res = await fetch(`${this.baseUrl}/api/public/web-chat/${widgetId}/config`);
    if (!res.ok) {
      throw new Error(res.status === 404 ? 'Chat widget not found' : `Failed to load chat (${res.status})`);
    }
    return res.json();
  }

  async sendMessage(
    widgetId: string,
    sessionId: string,
    content: string,
    visitorInfo?: { name?: string; email?: string },
  ): Promise<SendMessageResponse> {
    const res = await fetch(`${this.baseUrl}/api/public/web-chat/${widgetId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        content,
        visitorName: visitorInfo?.name,
        visitorEmail: visitorInfo?.email,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body as { message?: string })?.message ?? `Send failed (${res.status})`);
    }
    return res.json();
  }

  async getMessages(widgetId: string, sessionId: string): Promise<{ entries: ChatMessage[]; conversationId: string | null }> {
    const res = await fetch(
      `${this.baseUrl}/api/public/web-chat/${widgetId}/messages?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to load messages (${res.status})`);
    }
    return res.json();
  }
}
