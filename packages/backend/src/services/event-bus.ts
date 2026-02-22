import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Event payload types — one per automation trigger
// ---------------------------------------------------------------------------

export interface ContactCreatedEvent {
  contactId: string;
  contact: Record<string, unknown>;
}

export interface DealCreatedEvent {
  dealId: string;
  deal: Record<string, unknown>;
}

export interface DealStageChangedEvent {
  dealId: string;
  deal: Record<string, unknown>;
  previousStageId: string | null;
  newStageId: string;
  stageName: string;
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

export interface CrmEventMap {
  contact_created: ContactCreatedEvent;
  deal_created: DealCreatedEvent;
  deal_stage_changed: DealStageChangedEvent;
  message_received: MessageReceivedEvent;
  tag_added: TagAddedEvent;
  task_completed: TaskCompletedEvent;
  conversation_created: ConversationCreatedEvent;
}

export type CrmEventName = keyof CrmEventMap;

// ---------------------------------------------------------------------------
// Singleton event bus
// ---------------------------------------------------------------------------

class CrmEventBus extends EventEmitter {
  emit<K extends CrmEventName>(event: K, payload: CrmEventMap[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends CrmEventName>(event: K, listener: (payload: CrmEventMap[K]) => void): this {
    return super.on(event, listener);
  }

  off<K extends CrmEventName>(event: K, listener: (payload: CrmEventMap[K]) => void): this {
    return super.off(event, listener);
  }
}

export const eventBus = new CrmEventBus();

// Prevent unhandled-event warnings for automation listeners
eventBus.setMaxListeners(50);
