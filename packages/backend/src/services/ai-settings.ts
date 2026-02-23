import { env } from '../config/env.js';
import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';

export type AIProvider = 'openai' | 'openrouter';
type AIProviderKey = 'OPENAI_API_KEY' | 'OPENROUTER_API_KEY';

const AI_SETTINGS_COLLECTION = 'aiSettings';
const AI_SETTINGS_ID = 'global';

export interface AISettings {
  provider: AIProvider;
  model: string;
}

export interface AIStatus extends AISettings {
  configured: boolean;
  requiredKey: AIProviderKey;
}

function isAIProvider(value: unknown): value is AIProvider {
  return value === 'openai' || value === 'openrouter';
}

function getDefaultModel(provider: AIProvider): string {
  return provider === 'openrouter' ? env.OPENROUTER_MODEL : env.OPENAI_MODEL;
}

export function getProviderRequiredKey(provider: AIProvider): AIProviderKey {
  return provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
}

export function isProviderConfigured(provider: AIProvider): boolean {
  return provider === 'openrouter' ? !!env.OPENROUTER_API_KEY : !!env.OPENAI_API_KEY;
}

export function getAISettings(): AISettings {
  const row = store.getById(AI_SETTINGS_COLLECTION, AI_SETTINGS_ID);

  const provider = isAIProvider(row?.provider) ? (row.provider as AIProvider) : env.AI_PROVIDER;
  const rawModel = typeof row?.model === 'string' ? row.model.trim() : '';
  const model = rawModel || getDefaultModel(provider);

  return { provider, model };
}

export function getAIStatus(): AIStatus {
  const settings = getAISettings();
  const requiredKey = getProviderRequiredKey(settings.provider);

  return {
    ...settings,
    configured: isProviderConfigured(settings.provider),
    requiredKey,
  };
}

export async function updateAISettings(
  data: Partial<AISettings>,
  audit?: { userId: string; ipAddress?: string; userAgent?: string },
): Promise<AISettings> {
  const current = getAISettings();
  const provider = data.provider ?? current.provider;
  const nextModel = (data.model ?? current.model).trim();
  const model = nextModel || getDefaultModel(provider);

  const existing = store.getById(AI_SETTINGS_COLLECTION, AI_SETTINGS_ID);
  const payload = {
    id: AI_SETTINGS_ID,
    provider,
    model,
  };

  if (existing) {
    store.update(AI_SETTINGS_COLLECTION, AI_SETTINGS_ID, payload);
  } else {
    store.insert(AI_SETTINGS_COLLECTION, payload);
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'ai_settings',
      entityId: AI_SETTINGS_ID,
      changes: payload,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return { provider, model };
}
