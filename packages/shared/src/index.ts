// Shared types and utilities for the CRM system

export type UserRole = 'admin' | 'manager' | 'agent';

export type ContactSource =
  | 'manual'
  | 'csv_import'
  | 'web_form'
  | 'quiz'
  | 'telegram'
  | 'email'
  | 'api'
  | 'other';

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'email'
  | 'phone';

export type CustomFieldEntity = 'contact' | 'company';

export type DealStage = 'new' | 'qualification' | 'proposal' | 'negotiation' | 'won' | 'lost';

export type Permission =
  | 'users:read'
  | 'users:create'
  | 'users:update'
  | 'users:delete'
  | 'contacts:read'
  | 'contacts:create'
  | 'contacts:update'
  | 'contacts:delete'
  | 'deals:read'
  | 'deals:create'
  | 'deals:update'
  | 'deals:delete'
  | 'pipelines:read'
  | 'pipelines:create'
  | 'pipelines:update'
  | 'pipelines:delete'
  | 'tasks:read'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:delete'
  | 'messages:read'
  | 'messages:send'
  | 'backups:read'
  | 'backups:create'
  | 'backups:delete'
  | 'reports:read'
  | 'settings:read'
  | 'settings:update'
  | 'automation:read'
  | 'automation:create'
  | 'automation:update'
  | 'automation:delete'
  | 'audit-logs:read'
  | 'templates:read'
  | 'templates:create'
  | 'templates:update'
  | 'templates:delete'
  | 'activities:read'
  | 'activities:create'
  | 'activities:update'
  | 'activities:delete'
  | 'notifications:read'
  | 'forms:read'
  | 'forms:create'
  | 'forms:update'
  | 'forms:delete'
  | 'webhooks:read'
  | 'webhooks:create'
  | 'webhooks:update'
  | 'webhooks:delete'
  | 'knowledge-base:read'
  | 'knowledge-base:create'
  | 'knowledge-base:update'
  | 'knowledge-base:delete';

/**
 * Permissions granted to each role.
 * admin  — full access to everything
 * manager — can manage contacts, deals, tasks, messages, reports; read-only on users/settings/audit
 * agent  — can work with own contacts, deals, tasks, messages
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: [
    'users:read',
    'users:create',
    'users:update',
    'users:delete',
    'contacts:read',
    'contacts:create',
    'contacts:update',
    'contacts:delete',
    'deals:read',
    'deals:create',
    'deals:update',
    'deals:delete',
    'pipelines:read',
    'pipelines:create',
    'pipelines:update',
    'pipelines:delete',
    'tasks:read',
    'tasks:create',
    'tasks:update',
    'tasks:delete',
    'messages:read',
    'messages:send',
    'backups:read',
    'backups:create',
    'backups:delete',
    'reports:read',
    'settings:read',
    'settings:update',
    'automation:read',
    'automation:create',
    'automation:update',
    'automation:delete',
    'audit-logs:read',
    'templates:read',
    'templates:create',
    'templates:update',
    'templates:delete',
    'activities:read',
    'activities:create',
    'activities:update',
    'activities:delete',
    'notifications:read',
    'forms:read',
    'forms:create',
    'forms:update',
    'forms:delete',
    'webhooks:read',
    'webhooks:create',
    'webhooks:update',
    'webhooks:delete',
    'knowledge-base:read',
    'knowledge-base:create',
    'knowledge-base:update',
    'knowledge-base:delete',
  ],
  manager: [
    'users:read',
    'contacts:read',
    'contacts:create',
    'contacts:update',
    'contacts:delete',
    'deals:read',
    'deals:create',
    'deals:update',
    'deals:delete',
    'pipelines:read',
    'tasks:read',
    'tasks:create',
    'tasks:update',
    'tasks:delete',
    'messages:read',
    'messages:send',
    'reports:read',
    'settings:read',
    'automation:read',
    'automation:create',
    'automation:update',
    'automation:delete',
    'audit-logs:read',
    'templates:read',
    'templates:create',
    'templates:update',
    'templates:delete',
    'activities:read',
    'activities:create',
    'activities:update',
    'activities:delete',
    'notifications:read',
    'forms:read',
    'forms:create',
    'forms:update',
    'forms:delete',
    'webhooks:read',
    'webhooks:create',
    'webhooks:update',
    'webhooks:delete',
    'knowledge-base:read',
    'knowledge-base:create',
    'knowledge-base:update',
    'knowledge-base:delete',
  ],
  agent: [
    'contacts:read',
    'contacts:create',
    'contacts:update',
    'deals:read',
    'deals:create',
    'deals:update',
    'pipelines:read',
    'tasks:read',
    'tasks:create',
    'tasks:update',
    'messages:read',
    'messages:send',
    'templates:read',
    'templates:create',
    'templates:update',
    'templates:delete',
    'activities:read',
    'activities:create',
    'activities:update',
    'notifications:read',
    'forms:read',
    'knowledge-base:read',
  ],
} as const;

// Auth types
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: AuthUser;
}
