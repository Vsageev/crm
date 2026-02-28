import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';

const checkPermissionsBody = z.object({
  permissions: z
    .array(z.string())
    .min(1)
    .max(100)
    .describe('List of permission strings to check'),
});

export async function permissionRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/api/permissions/check',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['Permissions'],
        summary: 'Check which permissions the current user has',
        body: checkPermissionsBody,
      },
    },
    async (request, reply) => {
      const keyPermissions = request.apiKeyPermissions;

      const result: Record<string, boolean> = {};
      for (const perm of request.body.permissions) {
        if (!keyPermissions) {
          result[perm] = true;
          continue;
        }

        const [resource, action] = perm.split(':');
        const hasWrite = keyPermissions.includes(`${resource}:write`);
        const hasRead = keyPermissions.includes(`${resource}:read`);
        result[perm] = action === 'read' ? (hasRead || hasWrite) : hasWrite;
      }

      return reply.send({ permissions: result });
    },
  );
}
