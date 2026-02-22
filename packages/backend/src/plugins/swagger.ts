import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

// ---------------------------------------------------------------------------
// Reusable schema components
// ---------------------------------------------------------------------------

const paginationParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, description: 'Maximum number of items to return' },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Number of items to skip' },
];

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Resource UUID' };

const paginatedResponse = (itemRef: string) => ({
  type: 'object',
  properties: {
    total: { type: 'integer' },
    limit: { type: 'integer' },
    offset: { type: 'integer' },
    entries: { type: 'array', items: { $ref: `#/components/schemas/${itemRef}` } },
  },
});

const errorResponse = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer' },
    error: { type: 'string' },
    message: { type: 'string' },
  },
};

// ---------------------------------------------------------------------------
// Component schemas
// ---------------------------------------------------------------------------

const schemas = {
  Contact: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      firstName: { type: 'string' },
      lastName: { type: 'string', nullable: true },
      email: { type: 'string', format: 'email', nullable: true },
      phone: { type: 'string', nullable: true },
      position: { type: 'string', nullable: true },
      companyId: { type: 'string', format: 'uuid', nullable: true },
      ownerId: { type: 'string', format: 'uuid', nullable: true },
      source: { type: 'string', enum: ['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'] },
      telegramId: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateContact: {
    type: 'object',
    required: ['firstName'],
    properties: {
      firstName: { type: 'string', minLength: 1, maxLength: 100 },
      lastName: { type: 'string', maxLength: 100 },
      email: { type: 'string', format: 'email', maxLength: 255 },
      phone: { type: 'string', maxLength: 50 },
      position: { type: 'string', maxLength: 150 },
      companyId: { type: 'string', format: 'uuid' },
      ownerId: { type: 'string', format: 'uuid' },
      source: { type: 'string', enum: ['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'] },
      telegramId: { type: 'string', maxLength: 50 },
      notes: { type: 'string' },
      tagIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      customFields: { type: 'array', items: { type: 'object', properties: { definitionId: { type: 'string', format: 'uuid' }, value: { type: 'string' } }, required: ['definitionId', 'value'] } },
    },
  },
  UpdateContact: {
    type: 'object',
    properties: {
      firstName: { type: 'string', minLength: 1, maxLength: 100 },
      lastName: { type: 'string', maxLength: 100, nullable: true },
      email: { type: 'string', format: 'email', maxLength: 255, nullable: true },
      phone: { type: 'string', maxLength: 50, nullable: true },
      position: { type: 'string', maxLength: 150, nullable: true },
      companyId: { type: 'string', format: 'uuid', nullable: true },
      ownerId: { type: 'string', format: 'uuid', nullable: true },
      source: { type: 'string', enum: ['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'] },
      telegramId: { type: 'string', maxLength: 50, nullable: true },
      notes: { type: 'string', nullable: true },
      tagIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
      customFields: { type: 'array', items: { type: 'object', properties: { definitionId: { type: 'string', format: 'uuid' }, value: { type: 'string' } }, required: ['definitionId', 'value'] } },
    },
  },
  Deal: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      value: { type: 'string', nullable: true },
      currency: { type: 'string', nullable: true },
      stage: { type: 'string', enum: ['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'] },
      pipelineId: { type: 'string', format: 'uuid', nullable: true },
      pipelineStageId: { type: 'string', format: 'uuid', nullable: true },
      stageOrder: { type: 'integer', nullable: true },
      contactId: { type: 'string', format: 'uuid', nullable: true },
      companyId: { type: 'string', format: 'uuid', nullable: true },
      ownerId: { type: 'string', format: 'uuid', nullable: true },
      expectedCloseDate: { type: 'string', format: 'date-time', nullable: true },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
      lostReason: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateDeal: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      value: { type: 'string' },
      currency: { type: 'string', maxLength: 3 },
      stage: { type: 'string', enum: ['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'] },
      pipelineId: { type: 'string', format: 'uuid' },
      pipelineStageId: { type: 'string', format: 'uuid' },
      stageOrder: { type: 'integer', minimum: 0 },
      contactId: { type: 'string', format: 'uuid' },
      companyId: { type: 'string', format: 'uuid' },
      ownerId: { type: 'string', format: 'uuid' },
      expectedCloseDate: { type: 'string', format: 'date-time' },
      lostReason: { type: 'string', maxLength: 500 },
      notes: { type: 'string' },
      tagIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    },
  },
  UpdateDeal: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      value: { type: 'string', nullable: true },
      currency: { type: 'string', maxLength: 3 },
      stage: { type: 'string', enum: ['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'] },
      pipelineId: { type: 'string', format: 'uuid', nullable: true },
      pipelineStageId: { type: 'string', format: 'uuid', nullable: true },
      stageOrder: { type: 'integer', minimum: 0 },
      contactId: { type: 'string', format: 'uuid', nullable: true },
      companyId: { type: 'string', format: 'uuid', nullable: true },
      ownerId: { type: 'string', format: 'uuid', nullable: true },
      expectedCloseDate: { type: 'string', format: 'date-time', nullable: true },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
      lostReason: { type: 'string', maxLength: 500, nullable: true },
      notes: { type: 'string', nullable: true },
      tagIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    },
  },
  Task: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      type: { type: 'string', enum: ['call', 'meeting', 'email', 'follow_up', 'other'] },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      dueDate: { type: 'string', format: 'date-time', nullable: true },
      contactId: { type: 'string', format: 'uuid', nullable: true },
      dealId: { type: 'string', format: 'uuid', nullable: true },
      assigneeId: { type: 'string', format: 'uuid', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateTask: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string' },
      type: { type: 'string', enum: ['call', 'meeting', 'email', 'follow_up', 'other'] },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      dueDate: { type: 'string', format: 'date-time' },
      contactId: { type: 'string', format: 'uuid' },
      dealId: { type: 'string', format: 'uuid' },
      assigneeId: { type: 'string', format: 'uuid' },
    },
  },
  UpdateTask: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', nullable: true },
      type: { type: 'string', enum: ['call', 'meeting', 'email', 'follow_up', 'other'] },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      dueDate: { type: 'string', format: 'date-time', nullable: true },
      contactId: { type: 'string', format: 'uuid', nullable: true },
      dealId: { type: 'string', format: 'uuid', nullable: true },
      assigneeId: { type: 'string', format: 'uuid', nullable: true },
    },
  },
  Message: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      conversationId: { type: 'string', format: 'uuid' },
      senderId: { type: 'string', format: 'uuid', nullable: true },
      direction: { type: 'string', enum: ['inbound', 'outbound'] },
      type: { type: 'string', enum: ['text', 'image', 'video', 'document', 'voice', 'sticker', 'location', 'system'] },
      content: { type: 'string', nullable: true },
      externalId: { type: 'string', nullable: true },
      attachments: { nullable: true },
      metadata: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  SendMessage: {
    type: 'object',
    required: ['conversationId', 'direction'],
    properties: {
      conversationId: { type: 'string', format: 'uuid' },
      direction: { type: 'string', enum: ['inbound', 'outbound'] },
      type: { type: 'string', enum: ['text', 'image', 'video', 'document', 'voice', 'sticker', 'location', 'system'] },
      content: { type: 'string' },
      externalId: { type: 'string' },
      attachments: {},
      metadata: { type: 'string' },
    },
  },
  Error: errorResponse,
} as const;

// ---------------------------------------------------------------------------
// Path definitions
// ---------------------------------------------------------------------------

function crudPaths(
  basePath: string,
  tag: string,
  singular: string,
  listRef: string,
  createRef: string,
  updateRef: string,
  extraListParams: Record<string, unknown>[] = [],
) {
  return {
    [basePath]: {
      get: {
        tags: [tag],
        summary: `List ${tag.toLowerCase()}`,
        operationId: `list${tag}`,
        parameters: [...extraListParams, ...paginationParams],
        responses: {
          200: { description: 'Paginated list', content: { 'application/json': { schema: paginatedResponse(listRef) } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: [tag],
        summary: `Create a ${singular}`,
        operationId: `create${singular}`,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${createRef}` } } } },
        responses: {
          201: { description: `${singular} created`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${listRef}` } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    [`${basePath}/{id}`]: {
      get: {
        tags: [tag],
        summary: `Get a ${singular} by ID`,
        operationId: `get${singular}ById`,
        parameters: [idParam],
        responses: {
          200: { description: `${singular} details`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${listRef}` } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: [tag],
        summary: `Update a ${singular}`,
        operationId: `update${singular}`,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${updateRef}` } } } },
        responses: {
          200: { description: `${singular} updated`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${listRef}` } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: [tag],
        summary: `Delete a ${singular}`,
        operationId: `delete${singular}`,
        parameters: [idParam],
        responses: {
          204: { description: `${singular} deleted` },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  };
}

function buildPaths() {
  const contactParams = [
    { name: 'ownerId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by owner' },
    { name: 'companyId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by company' },
    { name: 'source', in: 'query', schema: { type: 'string' }, description: 'Filter by lead source' },
    { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search contacts by name, email, or phone' },
  ];

  const dealParams = [
    { name: 'ownerId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by owner' },
    { name: 'contactId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by contact' },
    { name: 'companyId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by company' },
    { name: 'pipelineId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by pipeline' },
    { name: 'pipelineStageId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by pipeline stage' },
    { name: 'stage', in: 'query', schema: { type: 'string', enum: ['new', 'qualification', 'proposal', 'negotiation', 'won', 'lost'] }, description: 'Filter by deal stage' },
    { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search deals by title' },
  ];

  const taskParams = [
    { name: 'assigneeId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by assignee' },
    { name: 'contactId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by contact' },
    { name: 'dealId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by deal' },
    { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] }, description: 'Filter by status' },
    { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high'] }, description: 'Filter by priority' },
    { name: 'type', in: 'query', schema: { type: 'string', enum: ['call', 'meeting', 'email', 'follow_up', 'other'] }, description: 'Filter by type' },
    { name: 'overdue', in: 'query', schema: { type: 'string', enum: ['true', 'false'] }, description: 'Filter overdue tasks' },
    { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Search tasks by title' },
  ];

  const contacts = crudPaths('/api/v1/contacts', 'Contacts', 'Contact', 'Contact', 'CreateContact', 'UpdateContact', contactParams);
  const deals = crudPaths('/api/v1/deals', 'Deals', 'Deal', 'Deal', 'CreateDeal', 'UpdateDeal', dealParams);
  const tasks = crudPaths('/api/v1/tasks', 'Tasks', 'Task', 'Task', 'CreateTask', 'UpdateTask', taskParams);

  // Messages have a slightly different shape (no full CRUD)
  const messages: Record<string, unknown> = {
    '/api/v1/messages': {
      get: {
        tags: ['Messages'],
        summary: 'List messages in a conversation',
        operationId: 'listMessages',
        parameters: [
          { name: 'conversationId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Conversation to list messages for' },
          ...paginationParams,
        ],
        responses: {
          200: { description: 'Paginated list', content: { 'application/json': { schema: paginatedResponse('Message') } } },
          400: { description: 'Missing conversationId', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['Messages'],
        summary: 'Send a message',
        operationId: 'sendMessage',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessage' } } } },
        responses: {
          201: { description: 'Message sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Conversation not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/v1/messages/{id}': {
      get: {
        tags: ['Messages'],
        summary: 'Get a message by ID',
        operationId: 'getMessageById',
        parameters: [idParam],
        responses: {
          200: { description: 'Message details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Message' } } } },
          401: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  };

  return { ...contacts, ...deals, ...tasks, ...messages };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function registerSwagger(app: FastifyInstance) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swagger as any, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'CRM API',
        description:
          'Public REST API for the CRM system. Provides access to contacts, deals, tasks, and messages.\n\n' +
          '## Authentication\n\n' +
          'All endpoints require a `Bearer` token in the `Authorization` header. Two authentication methods are supported:\n\n' +
          '- **JWT Token** — Obtained via `/api/auth/login`. Use `Authorization: Bearer <jwt>`.\n' +
          '- **API Key** — Generated in the CRM settings. API keys are prefixed with `crm_`. Use `Authorization: Bearer crm_<key>`.\n\n' +
          'API keys have scoped permissions — only the permissions granted to the key will be available.\n\n' +
          '## Pagination\n\n' +
          'List endpoints support `limit` (1–100, default 50) and `offset` (default 0) query parameters.\n\n' +
          '## Ownership Scoping\n\n' +
          'Users with the **agent** role can only access resources they own. Managers and admins can access all resources.\n\n' +
          '## Errors\n\n' +
          'Errors follow a consistent format with `statusCode`, `error`, and `message` fields.',
        version: '1.0.0',
        contact: { name: 'CRM Support' },
      },
      servers: [
        { url: '/', description: 'Current server' },
      ],
      tags: [
        { name: 'Contacts', description: 'Manage CRM contacts' },
        { name: 'Deals', description: 'Manage sales deals and pipeline' },
        { name: 'Tasks', description: 'Manage tasks linked to contacts and deals' },
        { name: 'Messages', description: 'Send and retrieve messages within conversations' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT or API Key (crm_...)',
            description: 'JWT token or API key prefixed with crm_',
          },
        },
        schemas: schemas as Record<string, unknown>,
      },
      security: [{ bearerAuth: [] }],
      paths: buildPaths() as Record<string, unknown>,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(swaggerUi as any, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
  });
}
