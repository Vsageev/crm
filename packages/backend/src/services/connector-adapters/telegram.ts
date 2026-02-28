import { store } from '../../db/index.js';
import {
  connectBot,
  disconnectBot,
  refreshWebhook,
  updateAutoGreeting,
} from '../telegram.js';
import type { ConnectorAdapter, ConnectorSeed, IntegrationStatus, AuditCtx } from './types.js';

function readStatus(integrationId: string): IntegrationStatus {
  const bot = store.getById('telegramBots', integrationId);
  if (!bot) {
    return { status: 'error', statusMessage: 'Bot record not found', settings: {} };
  }
  return {
    status: bot.status as 'active' | 'inactive' | 'error',
    statusMessage: (bot.statusMessage as string) ?? null,
    settings: {
      autoGreetingEnabled: bot.autoGreetingEnabled ?? false,
      autoGreetingText: bot.autoGreetingText ?? null,
    },
  };
}

export const telegramAdapter: ConnectorAdapter = {
  async connect(payload, audit) {
    const bot = await connectBot(payload.token as string, audit) as Record<string, unknown>;

    const seed: ConnectorSeed = {
      name: bot.botFirstName as string,
      integrationId: bot.id as string,
      capabilities: ['messaging'],
      config: {
        botUsername: bot.botUsername,
        tokenMasked: bot.tokenMasked,
      },
      status: bot.status as 'active' | 'inactive' | 'error',
      statusMessage: (bot.statusMessage as string) ?? null,
      settings: {
        autoGreetingEnabled: false,
        autoGreetingText: null,
      },
    };

    return seed;
  },

  async disconnect(integrationId, audit) {
    await disconnectBot(integrationId, audit);
  },

  async refresh(integrationId, audit) {
    await refreshWebhook(integrationId, audit);
    return readStatus(integrationId);
  },

  getStatus(integrationId) {
    return readStatus(integrationId);
  },

  async updateSettings(integrationId, settings, audit) {
    await updateAutoGreeting(
      integrationId,
      {
        enabled: settings.autoGreetingEnabled as boolean,
        text: (settings.autoGreetingText as string | null | undefined) ?? null,
      },
      audit,
    );
    return readStatus(integrationId);
  },
};
