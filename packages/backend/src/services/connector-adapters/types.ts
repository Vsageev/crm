/** Uniform interface every connector adapter must implement. */
export interface ConnectorAdapter {
  /** Connect to the external service; returns data to populate the connector record. */
  connect(
    payload: Record<string, unknown>,
    audit?: AuditCtx,
  ): Promise<ConnectorSeed>;

  /** Disconnect / tear down the external service. */
  disconnect(integrationId: string, audit?: AuditCtx): Promise<void>;

  /** Re-establish or refresh the connection (e.g. webhook re-register). */
  refresh(integrationId: string, audit?: AuditCtx): Promise<IntegrationStatus>;

  /** Read live status + settings from the underlying integration. */
  getStatus(integrationId: string): IntegrationStatus;

  /** Persist settings on the underlying integration. Returns updated status. */
  updateSettings(
    integrationId: string,
    settings: Record<string, unknown>,
    audit?: AuditCtx,
  ): Promise<IntegrationStatus>;
}

export interface AuditCtx {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Everything the connector service needs to create a connector record. */
export interface ConnectorSeed {
  name: string;
  integrationId: string;
  capabilities: string[];
  config: Record<string, unknown>;
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  settings: Record<string, unknown>;
}

/** Live status + settings snapshot from the underlying integration. */
export interface IntegrationStatus {
  status: 'active' | 'inactive' | 'error';
  statusMessage: string | null;
  settings: Record<string, unknown>;
}
