export interface ChatWidgetConfig {
  id: string;
  name: string;
  welcomeMessage: string;
  placeholderText: string;
  brandColor: string;
  position: 'bottom-right' | 'bottom-left';
  autoGreetingEnabled: boolean;
  autoGreetingDelaySec: number;
  requireEmail: boolean;
  requireName: boolean;
}

export interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string | null;
  createdAt: string;
  sender?: {
    id: string;
    firstName: string;
    lastName: string | null;
  } | null;
}

export interface SendMessageResponse {
  ok: boolean;
  messageId?: string;
  conversationId?: string;
  greeting?: {
    id: string;
    content: string | null;
    createdAt: string;
  };
  error?: string;
}

export interface CrmChatOptions {
  widgetId: string;
  container?: string | HTMLElement;
  apiUrl: string;
}
