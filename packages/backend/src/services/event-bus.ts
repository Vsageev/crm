import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Event payload types — one per automation trigger
// ---------------------------------------------------------------------------

export interface ContactCreatedEvent {
  contactId: string;
  contact: Record<string, unknown>;
}

export interface CardCreatedEvent {
  cardId: string;
  card: Record<string, unknown>;
}

export interface CardMovedEvent {
  cardId: string;
  card: Record<string, unknown>;
  previousColumnId: string | null;
  newColumnId: string;
  columnName: string;
}

export interface MessageReceivedEvent {
  messageId: string;
  conversationId: string;
  contactId: string;
  message: Record<string, unknown>;
  /** Enriched contact data with tagNames for routing rules */
  contact?: Record<string, unknown>;
  /** Conversation data for channel-based routing */
  conversation?: Record<string, unknown>;
}

export interface TagAddedEvent {
  contactId: string;
  tagIds: string[];
  contact: Record<string, unknown>;
}

export interface TaskCompletedEvent {
  taskId: string;
  task: Record<string, unknown>;
}

export interface ConversationCreatedEvent {
  conversationId: string;
  contactId: string;
  conversation: Record<string, unknown>;
  /** Enriched contact data with tagNames for routing rules */
  contact?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Event map — maps trigger names to their payload types
// ---------------------------------------------------------------------------

export interface AppEventMap {
  contact_created: ContactCreatedEvent;
  card_created: CardCreatedEvent;
  card_moved: CardMovedEvent;
  message_received: MessageReceivedEvent;
  tag_added: TagAddedEvent;
  task_completed: TaskCompletedEvent;
  conversation_created: ConversationCreatedEvent;
}

export type AppEventName = keyof AppEventMap;

// ---------------------------------------------------------------------------
// Singleton event bus
// ---------------------------------------------------------------------------

class AppEventBus extends EventEmitter {
  emit<K extends AppEventName>(event: K, payload: AppEventMap[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends AppEventName>(event: K, listener: (payload: AppEventMap[K]) => void): this {
    return super.on(event, listener);
  }

  off<K extends AppEventName>(event: K, listener: (payload: AppEventMap[K]) => void): this {
    return super.off(event, listener);
  }
}

export const eventBus = new AppEventBus();

// Prevent unhandled-event warnings for automation listeners
eventBus.setMaxListeners(50);
