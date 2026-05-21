import crypto from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTemporaryPostgresDatabase, type TemporaryPostgresDatabase } from '../db/postgres-test-utils.js';
import type { Store, StoreRecord } from '../db/store.js';

const adminDatabaseUrl =
  process.env.LIFECYCLE_DATABASE_URL ?? process.env.STORE_CONTRACT_DATABASE_URL;
const postgresAvailable = adminDatabaseUrl ? await canConnectToPostgres(adminDatabaseUrl) : false;
const itIfPostgres = adminDatabaseUrl && postgresAvailable ? it : it.skip;

if (adminDatabaseUrl && !postgresAvailable) {
  console.warn('Skipping Postgres delete lifecycle regressions: configured database is unavailable.');
}

type Services = {
  deleteAgent: (id: string) => Promise<boolean>;
  cleanupOldRunRecords: (olderThanDays: number) => Promise<number>;
  deleteApiKey: (id: string) => Promise<boolean>;
  deleteAgentConversation: (conversationId: string) => Promise<StoreRecord | null>;
  deleteBoard: (id: string) => Promise<StoreRecord | null>;
  deleteCard: (id: string) => Promise<StoreRecord | null>;
  deleteCollection: (id: string) => Promise<StoreRecord | null>;
  deleteWebhook: (id: string) => Promise<StoreRecord | null>;
  deleteWorkspace: (id: string) => Promise<StoreRecord | null>;
};

describe('Postgres delete lifecycle regressions', () => {
  if (!adminDatabaseUrl) {
    it.skip('requires LIFECYCLE_DATABASE_URL or STORE_CONTRACT_DATABASE_URL for real Postgres coverage', () => {});
    return;
  }

  let tempDb: TemporaryPostgresDatabase | null = null;
  let sql: Sql | null = null;
  let store: Store;
  let services: Services;

  beforeAll(async () => {
    if (!postgresAvailable) return;

    tempDb = await createTemporaryPostgresDatabase(adminDatabaseUrl, 'openwork_lifecycle');
    process.env.DATABASE_URL = tempDb.databaseUrl;
    process.env.DB_MIGRATIONS_DIR = './drizzle';
    process.env.DB_MIGRATIONS_TABLE = '__drizzle_migrations';
    process.env.DB_MIGRATIONS_SCHEMA = 'drizzle';

    const db = await import('../db/index.js');
    store = db.store;
    await store.init();
    sql = postgres(tempDb.databaseUrl, { max: 1, prepare: false });

    services = {
      deleteAgent: (await import('./agents.js')).deleteAgent,
      cleanupOldRunRecords: (await import('./agent-runs.js')).cleanupOldRunRecords,
      deleteApiKey: (await import('./api-keys.js')).deleteApiKey,
      deleteAgentConversation: (await import('./agent-chat.js')).deleteAgentConversation,
      deleteBoard: (await import('./boards.js')).deleteBoard,
      deleteCard: (await import('./cards.js')).deleteCard,
      deleteCollection: (await import('./collections.js')).deleteCollection,
      deleteWebhook: (await import('./webhooks.js')).deleteWebhook,
      deleteWorkspace: (await import('./workspaces.js')).deleteWorkspace,
    };
  }, 60_000);

  afterAll(async () => {
    await store?.flush();
    await sql?.end({ timeout: 5 });
    await tempDb?.drop();
  });

  itIfPostgres('deletes a card after removing Postgres FK dependents and preserving run history', async () => {
    const ids = await createBoardCardFixture('card');
    const runId = await createAgentRun('card', ids.agentId, { cardId: ids.cardId });
    const batchRunId = await createAgentBatchRun('card', ids.agentId, {
      sourceType: 'collection',
      sourceId: ids.collectionId,
    });
    await createAgentBatchRunItem('card', batchRunId, ids.agentId, ids.cardId, ids.collectionId, {
      agentRunId: runId,
    });
    await store.insert('cardComments', {
      id: prefixedId('card-comment'),
      cardId: ids.cardId,
      authorId: ids.userId,
      agentRunId: runId,
      content: 'comment',
    });
    await store.insert('tags', { id: ids.tagId, name: 'Lifecycle', color: '#111827' });
    await store.insert('cardTags', { cardId: ids.cardId, tagId: ids.tagId });
    await store.insert('cardLinks', {
      id: prefixedId('card-link'),
      sourceCardId: ids.cardId,
      targetCardId: ids.otherCardId,
    });
    await store.flush();

    await expect(services.deleteCard(ids.cardId)).resolves.toMatchObject({ id: ids.cardId });
    await store.reload();

    expect(store.getById('cards', ids.cardId)).toBeNull();
    expect(store.getAll('boardCards').filter((row) => row.cardId === ids.cardId)).toHaveLength(0);
    expect(store.getAll('cardComments').filter((row) => row.cardId === ids.cardId)).toHaveLength(0);
    expect(store.getAll('cardTags').filter((row) => row.cardId === ids.cardId)).toHaveLength(0);
    expect(store.getAll('cardLinks').filter((row) => row.sourceCardId === ids.cardId)).toHaveLength(0);
    expect(store.getAll('agentBatchRunItems').filter((row) => row.cardId === ids.cardId)).toHaveLength(0);
    expect(store.getById('agent_runs', runId)).toMatchObject({ cardId: null });
  });

  itIfPostgres('deletes an agent conversation after clearing queue, turn, message, draft, and run references', async () => {
    const userId = await createUser('conversation-user');
    const contactId = await createContact('conversation-contact');
    const agentId = await createAgent('conversation-agent');
    const conversationId = await createConversation('conversation', contactId);
    const userMessageId = await createMessage('conversation-user-message', conversationId, {
      direction: 'outbound',
      senderId: userId,
    });
    const assistantMessageId = await createMessage('conversation-assistant-message', conversationId, {
      direction: 'inbound',
      parentId: userMessageId,
    });
    const turnId = await createAgentChatTurn('conversation-turn', conversationId, agentId, {
      userMessageId,
      assistantMessageId,
    });
    const runId = await createAgentRun('conversation-run', agentId, {
      conversationId,
      turnId,
      triggerType: 'chat',
    });
    await store.update('agentChatTurns', turnId, { runId });
    await store.insert('agentChatQueue', {
      id: prefixedId('conversation-queue'),
      agentId,
      conversationId,
      mode: 'append_prompt',
      prompt: 'hello',
      status: 'completed',
      attempts: 1,
      maxAttempts: 4,
      turnId,
      runId,
      lastRunId: runId,
      nextAttemptAt: null,
      completedAt: new Date().toISOString(),
    });
    await store.insert('messageDrafts', {
      id: prefixedId('conversation-draft'),
      conversationId,
      content: 'draft',
      attachments: [],
      metadata: {},
    });
    await store.flush();

    await expect(services.deleteAgentConversation(conversationId)).resolves.toMatchObject({
      id: conversationId,
    });
    await store.reload();

    expect(store.getById('conversations', conversationId)).toBeNull();
    expect(store.getAll('messages').filter((row) => row.conversationId === conversationId)).toHaveLength(0);
    expect(store.getAll('messageDrafts').filter((row) => row.conversationId === conversationId)).toHaveLength(0);
    expect(store.getAll('agentChatQueue').filter((row) => row.conversationId === conversationId)).toHaveLength(0);
    expect(store.getAll('agentChatTurns').filter((row) => row.conversationId === conversationId)).toHaveLength(0);
    expect(store.getById('agent_runs', runId)).toMatchObject({ conversationId: null, turnId: null });
  });

  itIfPostgres('deletes a board after clearing placements, columns, and board cron templates', async () => {
    const ids = await createBoardCardFixture('board');
    await store.insert('boardCronTemplates', {
      id: prefixedId('board-cron-template'),
      boardId: ids.boardId,
      agentId: ids.agentId,
      schedule: '* * * * *',
      prompt: 'Create a card',
      config: {},
    });
    await store.flush();

    await expect(services.deleteBoard(ids.boardId)).resolves.toMatchObject({ id: ids.boardId });
    await store.reload();

    expect(store.getById('boards', ids.boardId)).toBeNull();
    expect(store.getAll('boardCards').filter((row) => row.boardId === ids.boardId)).toHaveLength(0);
    expect(store.getAll('boardColumns').filter((row) => row.boardId === ids.boardId)).toHaveLength(0);
    expect(store.getAll('boardCronTemplates').filter((row) => row.boardId === ids.boardId)).toHaveLength(0);
    expect(store.getById('cards', ids.cardId)).toMatchObject({ id: ids.cardId });
  });

  itIfPostgres('returns an intentional conflict when deleting a collection still referenced by cards or boards', async () => {
    const ids = await createBoardCardFixture('collection');

    await expect(services.deleteCollection(ids.collectionId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'collection_delete_blocked',
    });
    await store.reload();

    expect(store.getById('collections', ids.collectionId)).toMatchObject({ id: ids.collectionId });
  });

  itIfPostgres('archives an agent with persisted execution history and automation references', async () => {
    const ids = await createBoardCardFixture('agent-archive');
    const contactId = await createContact('agent-archive-contact');
    const conversationId = await createConversation('agent-archive-conversation', contactId);
    const turnId = await createAgentChatTurn('agent-archive-turn', conversationId, ids.agentId);
    const runId = await createAgentRun('agent-archive-run', ids.agentId, {
      conversationId,
      turnId,
      triggerType: 'chat',
    });
    const batchRunId = await createAgentBatchRun('agent-archive-batch', ids.agentId, {
      status: 'running',
      queued: 1,
      processing: 0,
      completed: 0,
      finishedAt: null,
    });
    await createAgentBatchRunItem(
      'agent-archive-batch-item',
      batchRunId,
      ids.agentId,
      ids.cardId,
      ids.collectionId,
      { status: 'queued', completedAt: null },
    );
    await store.insert('agentChatQueue', {
      id: prefixedId('agent-archive-queue'),
      agentId: ids.agentId,
      conversationId,
      mode: 'append_prompt',
      prompt: 'hello',
      status: 'queued',
      attempts: 0,
      maxAttempts: 4,
      turnId,
      runId: null,
      lastRunId: null,
      nextAttemptAt: new Date().toISOString(),
      completedAt: null,
    });
    await store.insert('boardCronTemplates', {
      id: prefixedId('agent-archive-cron-template'),
      boardId: ids.boardId,
      agentId: ids.agentId,
      assigneeId: ids.agentId,
      schedule: '* * * * *',
      prompt: 'Create a card',
      config: {},
      enabled: true,
    });
    await store.flush();

    await expect(services.deleteAgent(ids.agentId)).resolves.toBe(true);
    await store.reload();

    const archivedAgent = store.getById('agents', ids.agentId);
    expect(archivedAgent).toMatchObject({
      id: ids.agentId,
      status: 'inactive',
      workspaceApiKeyId: null,
      workspaceApiKey: null,
    });
    expect(archivedAgent?.archivedAt).toBeTruthy();
    expect(store.getById('agent_runs', runId)).toMatchObject({ id: runId, agentId: ids.agentId });
    expect(store.getById('agentChatTurns', turnId)).toMatchObject({ agentId: ids.agentId });
    expect(store.getById('boardColumns', ids.columnId)).toMatchObject({ assignAgentId: null });
    expect(store.getById('agentBatchRuns', batchRunId)).toMatchObject({
      agentId: ids.agentId,
      status: 'cancelled',
    });
    expect(store.getAll('agentBatchRunItems').filter((row) => row.agentId === ids.agentId)).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
    ]);
    expect(store.getAll('agentChatQueue').filter((row) => row.agentId === ids.agentId)).toEqual([
      expect.objectContaining({ status: 'cancelled' }),
    ]);
    expect(store.getAll('boardCronTemplates').filter((row) => row.boardId === ids.boardId)).toEqual([
      expect.objectContaining({ agentId: null, assigneeId: null, enabled: false }),
    ]);
  });

  itIfPostgres('archives an agent with removable dependent secrets after detaching its workspace API key', async () => {
    const serviceUserId = await createUser('agent-service-user', { type: 'agent' });
    const apiKeyId = await createApiKey('agent-workspace-key', serviceUserId);
    const agentId = await createAgent('agent-delete', {
      serviceUserId,
      workspaceApiKeyId: apiKeyId,
      workspaceApiKey: 'raw-key',
    });
    await store.insert('agentEnvVars', {
      id: prefixedId('agent-env'),
      agentId,
      key: 'TOKEN',
      encryptedValue: 'encrypted',
      valuePreview: 'tok...',
      isActive: true,
      createdById: serviceUserId,
    });
    await store.insert('agentExternalApiKeys', {
      id: prefixedId('agent-external-key'),
      agentId,
      provider: 'openai',
      keyHash: 'hash',
      keyPrefix: 'sk-test',
      encryptedValue: 'encrypted',
      metadata: {},
    });
    await store.flush();

    await expect(services.deleteAgent(agentId)).resolves.toBe(true);
    await store.reload();

    const archivedAgent = store.getById('agents', agentId);
    expect(archivedAgent).toMatchObject({
      id: agentId,
      status: 'inactive',
      workspaceApiKeyId: null,
      workspaceApiKey: null,
    });
    expect(archivedAgent?.archivedAt).toBeTruthy();
    expect(store.getAll('agentEnvVars').filter((row) => row.agentId === agentId)).toHaveLength(0);
    expect(store.getAll('agentExternalApiKeys').filter((row) => row.agentId === agentId)).toHaveLength(0);
    expect(store.getById('apiKeys', apiKeyId)).toMatchObject({ isActive: false });
    expect(store.getById('users', serviceUserId)).toMatchObject({ isActive: false });
  });

  itIfPostgres('cleans agent run retention references before deleting an old run record', async () => {
    const userId = await createUser('retention-user');
    const contactId = await createContact('retention-contact');
    const agentId = await createAgent('retention-agent');
    const conversationId = await createConversation('retention', contactId);
    const messageId = await createMessage('retention-message', conversationId, {
      direction: 'outbound',
      senderId: userId,
    });
    const turnId = await createAgentChatTurn('retention-turn', conversationId, agentId, {
      userMessageId: messageId,
    });
    const oldFinishedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const runId = await createAgentRun('retention-run', agentId, {
      conversationId,
      turnId,
      status: 'completed',
      startedAt: oldFinishedAt,
      finishedAt: oldFinishedAt,
      triggerType: 'chat',
    });
    await store.update('agentChatTurns', turnId, { runId });
    await store.insert('agentChatQueue', {
      id: prefixedId('retention-queue'),
      agentId,
      conversationId,
      mode: 'append_prompt',
      prompt: 'old',
      status: 'completed',
      attempts: 1,
      maxAttempts: 4,
      turnId,
      runId,
      lastRunId: runId,
      nextAttemptAt: null,
      completedAt: oldFinishedAt,
    });
    const collectionId = await createCollection('retention-collection', userId);
    const cardId = await createCard('retention-card', collectionId);
    const batchRunId = await createAgentBatchRun('retention-batch', agentId, {
      sourceType: 'collection',
      sourceId: collectionId,
      finishedAt: oldFinishedAt,
    });
    await createAgentBatchRunItem('retention-item', batchRunId, agentId, cardId, collectionId, {
      agentRunId: runId,
    });
    await store.flush();

    await expect(services.cleanupOldRunRecords(1)).resolves.toBe(1);
    await store.reload();

    expect(store.getById('agent_runs', runId)).toBeNull();
    expect(store.getById('agentChatTurns', turnId)).toMatchObject({ runId: null });
    expect(store.getAll('agentChatQueue').find((row) => row.lastRunId === runId || row.runId === runId)).toBeUndefined();
    expect(store.getAll('agentBatchRunItems').find((row) => row.agentRunId === runId)).toBeUndefined();
  });

  itIfPostgres('deletes a webhook after removing delivery attempts', async () => {
    const userId = await createUser('webhook-user');
    const webhookId = await createWebhook('webhook', userId);
    await store.insert('webhookDeliveries', {
      id: prefixedId('webhook-delivery'),
      webhookId,
      event: 'card_created',
      payload: { id: 'card-1' },
      status: 'failed',
      attempt: 1,
      maxAttempts: 3,
    });
    await store.flush();

    await expect(services.deleteWebhook(webhookId)).resolves.toMatchObject({ id: webhookId });
    await store.reload();

    expect(store.getById('webhooks', webhookId)).toBeNull();
    expect(store.getAll('webhookDeliveries').filter((row) => row.webhookId === webhookId)).toHaveLength(0);
  });

  itIfPostgres('revokes an API key referenced by agents and settings instead of physically deleting into FK errors', async () => {
    const userId = await createUser('api-key-user');
    const apiKeyId = await createApiKey('referenced-key', userId);
    await createAgent('api-key-agent', { apiKeyId });
    await store.insert('settings', {
      id: prefixedId('settings'),
      defaultAgentKeyId: apiKeyId,
      fallbackModel: null,
      fallbackModelId: null,
      agentPromptMax: 10,
      agentPromptWindowS: 60,
    });
    await store.flush();

    await expect(services.deleteApiKey(apiKeyId)).resolves.toBe(true);
    await store.reload();

    expect(store.getById('apiKeys', apiKeyId)).toMatchObject({ isActive: false });
  });

  itIfPostgres('deletes a workspace after removing runner devices and pairing codes', async () => {
    const userId = await createUser('workspace-user');
    const workspaceId = await createWorkspace('workspace', userId);
    await store.insert('agentRunners', {
      id: prefixedId('workspace-runner'),
      userId,
      workspaceId,
      displayName: 'Local runner',
      credentialHash: `hash-${workspaceId}`,
      credentialPrefix: 'owrun_test',
      status: 'offline',
      lastSeenAt: null,
      version: null,
      capabilities: {},
      revokedAt: null,
    });
    await store.insert('agentRunnerPairingCodes', {
      id: prefixedId('workspace-pairing'),
      userId,
      workspaceId,
      codeHash: `code-${workspaceId}`,
      displayName: 'Pairing',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
    });
    await store.flush();

    await expect(services.deleteWorkspace(workspaceId)).resolves.toMatchObject({ id: workspaceId });
    await store.reload();

    expect(store.getById('workspaces', workspaceId)).toBeNull();
    expect(store.getAll('agentRunners').filter((row) => row.workspaceId === workspaceId)).toHaveLength(0);
    expect(store.getAll('agentRunnerPairingCodes').filter((row) => row.workspaceId === workspaceId)).toHaveLength(0);
  });

  function prefixedId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  async function createUser(prefix: string, overrides: StoreRecord = {}): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('users', {
      id,
      email: `${id}@example.test`,
      passwordHash: 'hash',
      firstName: 'Delete',
      lastName: 'Lifecycle',
      type: 'human',
      isActive: true,
      totpSecret: null,
      totpEnabled: false,
      recoveryCodes: null,
      ...overrides,
    });
    return id;
  }

  async function createApiKey(prefix: string, createdById: string): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('apiKeys', {
      id,
      name: prefix,
      keyHash: `hash-${id}`,
      keyPrefix: id.slice(0, 8),
      permissions: ['settings:read'],
      createdById,
      isActive: true,
      expiresAt: null,
      lastUsedAt: null,
      description: null,
    });
    return id;
  }

  async function createAgent(prefix: string, overrides: StoreRecord = {}): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('agents', {
      id,
      name: prefix,
      description: null,
      model: null,
      modelId: null,
      thinkingLevel: null,
      preset: null,
      presetParameters: null,
      status: 'active',
      apiKeyId: null,
      apiKeyName: null,
      apiKeyPrefix: null,
      workspaceApiKey: null,
      workspaceApiKeyId: null,
      capabilities: null,
      skipPermissions: null,
      groupId: null,
      serviceUserId: null,
      repositoryRoot: null,
      workspacePath: null,
      separateFolderPerChat: false,
      skillIds: null,
      cronJobs: null,
      avatarIcon: null,
      avatarBgColor: null,
      avatarLogoColor: null,
      lastActivity: null,
      ...overrides,
    });
    return id;
  }

  async function createContact(prefix: string): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('contacts', {
      id,
      firstName: prefix,
      lastName: null,
      email: null,
      phone: null,
      source: null,
      notes: null,
    });
    return id;
  }

  async function createConversation(prefix: string, contactId: string): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('conversations', {
      id,
      contactId,
      assigneeId: null,
      channelType: 'agent',
      status: 'open',
      subject: null,
      externalId: null,
      isUnread: false,
      lastMessageAt: null,
      closedAt: null,
      metadata: {},
      provider: null,
      modelId: null,
      activeChatbotFlowId: null,
      chatbotFlowStepId: null,
      chatbotFlowData: null,
    });
    return id;
  }

  async function createMessage(
    prefix: string,
    conversationId: string,
    overrides: StoreRecord = {},
  ): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('messages', {
      id,
      conversationId,
      senderId: null,
      direction: 'outbound',
      type: 'text',
      content: 'message',
      status: 'sent',
      externalId: null,
      parentId: null,
      previousUserMessageId: null,
      attachments: [],
      metadata: {},
      ...overrides,
    });
    return id;
  }

  async function createCollection(prefix: string, createdById: string): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('collections', {
      id,
      name: prefix,
      description: null,
      isGeneral: false,
      agentBatchConfig: null,
      createdById,
    });
    return id;
  }

  async function createCard(prefix: string, collectionId: string): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('cards', {
      id,
      collectionId,
      name: prefix,
      description: null,
      customFields: {},
      createdById: null,
      assigneeId: null,
      position: 0,
    });
    return id;
  }

  async function createWorkspace(prefix: string, userId: string): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('workspaces', {
      id,
      name: prefix,
      userId,
      boardIds: [],
      collectionIds: [],
      agentGroupIds: [],
    });
    return id;
  }

  async function createBoardCardFixture(prefix: string) {
    const userId = await createUser(`${prefix}-user`);
    const agentId = await createAgent(`${prefix}-agent`);
    const collectionId = await createCollection(`${prefix}-collection`, userId);
    const boardId = prefixedId(`${prefix}-board`);
    await store.insert('boards', {
      id: boardId,
      name: `${prefix} board`,
      description: null,
      collectionId,
      defaultCollectionId: collectionId,
      isGeneral: false,
      createdById: userId,
    });
    const columnId = prefixedId(`${prefix}-column`);
    await store.insert('boardColumns', {
      id: columnId,
      boardId,
      name: 'Todo',
      color: '#6B7280',
      position: 0,
      wipLimit: null,
      assignAgentId: agentId,
      assignAgentPrompt: null,
    });
    const cardId = await createCard(`${prefix}-card`, collectionId);
    const otherCardId = await createCard(`${prefix}-other-card`, collectionId);
    await store.insert('boardCards', {
      id: prefixedId(`${prefix}-board-card`),
      boardId,
      cardId,
      columnId,
      position: 0,
    });
    return {
      userId,
      agentId,
      collectionId,
      boardId,
      columnId,
      cardId,
      otherCardId,
      tagId: prefixedId(`${prefix}-tag`),
    };
  }

  async function createAgentRun(
    prefix: string,
    agentId: string,
    overrides: StoreRecord = {},
  ): Promise<string> {
    const id = prefixedId(prefix);
    const now = new Date().toISOString();
    await store.insert('agent_runs', {
      id,
      agentId,
      agentName: prefix,
      model: null,
      modelId: null,
      triggerType: 'card_assignment',
      triggerPrompt: 'prompt',
      status: 'completed',
      conversationId: null,
      cardId: null,
      cronJobId: null,
      executor: 'remote',
      pid: null,
      stdoutPath: null,
      stderrPath: null,
      stdout: null,
      stderr: null,
      errorMessage: null,
      responseText: null,
      responseParentId: null,
      turnId: null,
      killedByUser: false,
      avatarIcon: null,
      avatarBgColor: null,
      avatarLogoColor: null,
      startedAt: now,
      finishedAt: now,
      durationMs: 1,
      ...overrides,
    });
    return id;
  }

  async function createAgentChatTurn(
    prefix: string,
    conversationId: string,
    agentId: string,
    overrides: StoreRecord = {},
  ): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('agentChatTurns', {
      id,
      conversationId,
      agentId,
      parentTurnId: null,
      userMessageId: null,
      assistantMessageId: null,
      status: 'completed',
      runId: null,
      source: 'user',
      createdById: null,
      turnType: 'follow_up',
      supersedesTurnId: null,
      metadata: {},
      startedAt: null,
      completedAt: new Date().toISOString(),
      ...overrides,
    });
    return id;
  }

  async function createAgentBatchRun(
    prefix: string,
    agentId: string,
    overrides: StoreRecord = {},
  ): Promise<string> {
    const id = prefixedId(prefix);
    const now = new Date().toISOString();
    await store.insert('agentBatchRuns', {
      id,
      sourceType: 'card',
      sourceId: id,
      sourceName: prefix,
      agentId,
      prompt: 'prompt',
      maxParallel: 1,
      status: 'completed',
      total: 1,
      queued: 0,
      processing: 0,
      completed: 1,
      failed: 0,
      cancelled: 0,
      skipped: 0,
      stageCount: 0,
      dependencyItemCount: 0,
      startedAt: now,
      finishedAt: now,
      errorMessage: null,
      ...overrides,
    });
    return id;
  }

  async function createAgentBatchRunItem(
    prefix: string,
    runId: string,
    agentId: string,
    cardId: string,
    collectionId: string,
    overrides: StoreRecord = {},
  ): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('agentBatchRunItems', {
      id,
      runId,
      sourceType: 'card',
      sourceId: cardId,
      agentId,
      cardId,
      cardName: prefix,
      cardDescription: null,
      cardCollectionId: collectionId,
      order: 0,
      status: 'completed',
      attempts: 1,
      maxAttempts: 1,
      nextAttemptAt: null,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      agentRunId: null,
      stageId: null,
      dependsOnItemIds: [],
      blockingMode: null,
      ...overrides,
    });
    return id;
  }

  async function createWebhook(prefix: string, createdById: string): Promise<string> {
    const id = prefixedId(prefix);
    await store.insert('webhooks', {
      id,
      url: 'https://example.test/webhook',
      description: null,
      events: ['card_created'],
      secret: 'test-secret-test-secret',
      isActive: true,
      createdById,
    });
    return id;
  }
});

async function canConnectToPostgres(baseDatabaseUrl: string): Promise<boolean> {
  const admin = postgres(databaseUrlForDatabase(baseDatabaseUrl, 'postgres'), { max: 1, prepare: false });
  try {
    await admin.unsafe('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

function databaseUrlForDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}
