// Plain TypeScript interfaces matching the Drizzle schema definitions.
// Used as the data-layer types throughout services now that Drizzle is removed.

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'agent';
  isActive: boolean;
  totpSecret: string | null;
  totpEnabled: boolean;
  recoveryCodes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'login'
    | 'logout'
    | 'login_failed'
    | 'export'
    | 'import'
    | 'two_factor_enabled'
    | 'two_factor_disabled'
    | 'two_factor_failed';
  entityType: string;
  entityId: string | null;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  industry: string | null;
  size: string | null;
  notes: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  companyId: string | null;
  ownerId: string | null;
  source: 'manual' | 'csv_import' | 'web_form' | 'telegram' | 'email' | 'api' | 'other';
  telegramId: string | null;
  whatsappPhoneId: string | null;
  instagramScopedId: string | null;
  notes: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrerUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface ContactTag {
  contactId: string;
  tagId: string;
}

export interface CompanyTag {
  companyId: string;
  tagId: string;
}

export interface CustomFieldDefinition {
  id: string;
  name: string;
  fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multi_select' | 'url' | 'email' | 'phone';
  entityType: 'contact' | 'company';
  options: string[] | null;
  required: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldValue {
  id: string;
  definitionId: string;
  entityType: 'contact' | 'company';
  entityId: string;
  value: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  contactId: string;
  assigneeId: string | null;
  channelType: 'telegram' | 'email' | 'web_chat' | 'whatsapp' | 'instagram' | 'other';
  status: 'open' | 'closed' | 'archived';
  subject: string | null;
  externalId: string | null;
  isUnread: boolean;
  lastMessageAt: string | null;
  closedAt: string | null;
  metadata: string | null;
  activeChatbotFlowId: string | null;
  chatbotFlowStepId: string | null;
  chatbotFlowData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker' | 'location' | 'system';
  content: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  externalId: string | null;
  attachments: unknown;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  title: string;
  value: string | null;
  currency: string;
  stage: 'new' | 'qualification' | 'proposal' | 'negotiation' | 'won' | 'lost';
  pipelineId: string | null;
  pipelineStageId: string | null;
  stageOrder: number;
  contactId: string | null;
  companyId: string | null;
  ownerId: string | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  notes: string | null;
  leadSource: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrerUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealTag {
  dealId: string;
  tagId: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  position: number;
  isWinStage: boolean;
  isLossStage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramBot {
  id: string;
  token: string;
  botId: string;
  botUsername: string;
  botFirstName: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  autoGreetingEnabled: boolean;
  autoGreetingText: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  type: 'call' | 'meeting' | 'email' | 'follow_up' | 'other';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completedAt: string | null;
  contactId: string | null;
  dealId: string | null;
  assigneeId: string | null;
  createdById: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuickReplyTemplate {
  id: string;
  name: string;
  content: string;
  category: string | null;
  shortcut: string | null;
  isGlobal: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  type: 'call' | 'meeting' | 'note';
  title: string;
  description: string | null;
  contactId: string | null;
  dealId: string | null;
  duration: number | null;
  occurredAt: string;
  createdById: string | null;
  meta: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'task_due_soon' | 'task_overdue' | 'deal_update' | 'lead_assigned' | 'mention' | 'system';
  title: string;
  message: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface TelegramNotificationSettings {
  id: string;
  userId: string;
  telegramChatId: string;
  telegramUsername: string | null;
  enabled: boolean;
  notifyNewLead: boolean;
  notifyTaskDueSoon: boolean;
  notifyTaskOverdue: boolean;
  notifyDealStageChange: boolean;
  notifyLeadAssigned: boolean;
  linkToken: string | null;
  linkTokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebForm {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive' | 'archived';
  pipelineId: string | null;
  pipelineStageId: string | null;
  assigneeId: string | null;
  submitButtonText: string;
  successMessage: string;
  redirectUrl: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebFormField {
  id: string;
  formId: string;
  label: string;
  fieldType: 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'url' | 'hidden';
  placeholder: string | null;
  isRequired: boolean;
  position: number;
  options: string[] | null;
  defaultValue: string | null;
  contactFieldMapping: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebFormSubmission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  status: 'new' | 'processed' | 'failed';
  contactId: string | null;
  dealId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  referrerUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  createdAt: string;
}

export interface TelegramMessageTemplate {
  id: string;
  name: string;
  content: string;
  parseMode: string | null;
  inlineKeyboard: unknown;
  category: string | null;
  isGlobal: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatbotFlow {
  id: string;
  botId: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive' | 'draft';
  triggerOnNewConversation: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatbotFlowStep {
  id: string;
  flowId: string;
  stepOrder: number;
  type: 'send_message' | 'ask_question' | 'buttons' | 'condition' | 'assign_agent' | 'add_tag' | 'close_conversation';
  message: string | null;
  options: unknown;
  nextStepId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger: 'contact_created' | 'deal_created' | 'deal_stage_changed' | 'message_received' | 'tag_added' | 'task_completed' | 'conversation_created';
  conditions: unknown[];
  action: 'assign_agent' | 'create_task' | 'send_message' | 'move_deal' | 'add_tag' | 'send_notification' | 'create_deal';
  actionParams: Record<string, unknown>;
  isActive: boolean;
  priority: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoundRobinState {
  id: string;
  ruleId: string;
  lastIndex: number;
  lastAssignedAgentId: string | null;
  updatedAt: string;
}

export interface Webhook {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secret: string;
  isActive: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: unknown;
  status: 'pending' | 'success' | 'failed';
  responseStatus: number | null;
  responseBody: string | null;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  permissions: string[];
  createdById: string;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
}

export interface EmailAccount {
  id: string;
  email: string;
  name: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  lastSyncedUid: number | null;
  lastSyncedAt: string | null;
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebChatWidget {
  id: string;
  name: string;
  welcomeMessage: string;
  placeholderText: string | null;
  brandColor: string;
  position: string;
  autoGreetingEnabled: boolean;
  autoGreetingDelaySec: string;
  requireEmail: boolean;
  requireName: boolean;
  allowedOrigins: string | null;
  status: 'active' | 'inactive';
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppAccount {
  id: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  accessToken: string;
  webhookVerifyToken: string | null;
  accountName: string;
  autoGreetingEnabled: boolean;
  autoGreetingText: string | null;
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstagramPage {
  id: string;
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  webhookVerifyToken: string | null;
  autoGreetingEnabled: boolean;
  autoGreetingText: string | null;
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}
