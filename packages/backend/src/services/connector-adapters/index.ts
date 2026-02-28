import type { ConnectorAdapter } from './types.js';
import { telegramAdapter } from './telegram.js';

const adapters: Record<string, ConnectorAdapter> = {
  telegram: telegramAdapter,
};

export function getAdapter(type: string): ConnectorAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unsupported connector type: ${type}`);
  return adapter;
}

export type { ConnectorAdapter, ConnectorSeed, IntegrationStatus, AuditCtx } from './types.js';
