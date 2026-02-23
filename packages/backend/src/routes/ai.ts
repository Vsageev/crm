import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { suggestReply } from '../services/ai-suggest.js';
import { getAISettings, getAIStatus, updateAISettings } from '../services/ai-settings.js';

const suggestReplyBody = z.object({
  conversationId: z.string().min(1),
});

const updateSettingsBody = z
  .object({
    provider: z.enum(['openai', 'openrouter']).optional(),
    model: z.string().trim().min(1).max(120).optional(),
  })
  .refine((data) => data.provider !== undefined || data.model !== undefined, {
    message: 'At least one field is required',
  });

export async function aiRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // AI status — any authenticated user
  typedApp.get(
    '/api/ai/status',
    { onRequest: [app.authenticate], schema: { tags: ['AI'], summary: 'Get AI status' } },
    async (_request, reply) => {
      return reply.send(getAIStatus());
    },
  );

  // AI settings (provider/model)
  typedApp.get(
    '/api/ai/settings',
    { onRequest: [app.authenticate], schema: { tags: ['AI'], summary: 'Get AI settings' } },
    async (_request, reply) => {
      return reply.send(getAISettings());
    },
  );

  typedApp.patch(
    '/api/ai/settings',
    { onRequest: [app.authenticate, requirePermission('settings:update')], schema: { tags: ['AI'], summary: 'Update AI settings', body: updateSettingsBody } },
    async (request, reply) => {
      const settings = await updateAISettings(request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send(settings);
    },
  );

  // Suggest reply
  typedApp.post(
    '/api/ai/suggest-reply',
    { onRequest: [app.authenticate, requirePermission('ai:suggest-reply')], schema: { tags: ['AI'], summary: 'Suggest a reply using AI', body: suggestReplyBody } },
    async (request, reply) => {
      const status = getAIStatus();
      if (!status.configured) {
        return reply.serviceUnavailable(
          `AI provider "${status.provider}" is not configured. Please set ${status.requiredKey} in environment variables.`,
        );
      }

      try {
        const suggestion = await suggestReply(request.body.conversationId);
        return reply.send({ suggestion });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate suggestion';

        if (message === 'Conversation not found') {
          return reply.notFound(message);
        }

        app.log.error({ err }, 'AI suggestion failed');
        return reply.internalServerError('Failed to generate AI suggestion. Please try again.');
      }
    },
  );
}
