import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

export async function registerSwagger(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
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
      servers: [{ url: '/', description: 'Current server' }],
      tags: [
        { name: 'Health', description: 'Health check' },
        { name: 'Auth', description: 'Authentication and 2FA' },
        { name: 'Contacts', description: 'Manage CRM contacts' },
        { name: 'Companies', description: 'Manage companies' },
        { name: 'Deals', description: 'Manage sales deals and pipeline' },
        { name: 'Pipelines', description: 'Manage sales pipelines and stages' },
        { name: 'Tasks', description: 'Manage tasks linked to contacts and deals' },
        { name: 'Tags', description: 'Manage tags for contacts and companies' },
        { name: 'Conversations', description: 'Manage conversations' },
        { name: 'Messages', description: 'Send and retrieve messages within conversations' },
        { name: 'Telegram', description: 'Telegram bot integration' },
        { name: 'Telegram Notifications', description: 'Telegram notification settings' },
        { name: 'Telegram Message Templates', description: 'Telegram message templates' },
        { name: 'Quick Reply Templates', description: 'Quick reply templates for chat' },
        { name: 'Activity Logs', description: 'Activity timeline for entities' },
        { name: 'Audit Logs', description: 'System audit logs' },
        { name: 'Notifications', description: 'In-app notifications' },
        { name: 'Web Forms', description: 'Lead capture web forms' },
        { name: 'Media', description: 'File uploads and media management' },
        { name: 'Chatbot Flows', description: 'Chatbot flow builder' },
        { name: 'Automation Rules', description: 'Workflow automation rules' },
        { name: 'Widget', description: 'Embeddable website widget' },
        { name: 'Reports', description: 'Analytics and reports' },
        { name: 'Public API', description: 'Public API for external integrations' },
        { name: 'API Keys', description: 'API key management' },
        { name: 'Webhooks', description: 'Webhook management' },
        { name: 'Web Push', description: 'Web push notifications' },
        { name: 'Email', description: 'Email integration' },
        { name: 'Web Chat', description: 'Web chat widget' },
        { name: 'WhatsApp', description: 'WhatsApp integration' },
        { name: 'Instagram', description: 'Instagram/Messenger integration' },
        { name: 'Backup', description: 'Data backup and restore' },
        { name: 'Novofon', description: 'Novofon telephony integration' },
        { name: 'Voximplant', description: 'Voximplant telephony integration' },
        { name: 'Telephony', description: 'Telephony management' },
        { name: 'Knowledge Base', description: 'AI knowledge base' },
        { name: 'AI', description: 'AI-powered features' },
        { name: 'Quizzes', description: 'Quiz management' },
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
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
  });
}
