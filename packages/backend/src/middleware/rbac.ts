import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Permission } from 'shared';

/**
 * Returns a preHandler that enforces permissions only for API-key requests.
 * User JWT sessions are allowed without permission checks.
 */
export function requirePermission(permission: Permission): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub: string } | undefined;

    if (!user) {
      return reply.unauthorized('Authentication required');
    }

    const keyPermissions = request.apiKeyPermissions;
    if (keyPermissions) {
      const [resource, action] = permission.split(':');
      const hasWrite = keyPermissions.includes(`${resource}:write`);
      const hasRead = keyPermissions.includes(`${resource}:read`);
      const hasPermission = action === 'read' ? (hasRead || hasWrite) : hasWrite;

      if (!hasPermission) {
        return reply.forbidden('API key does not have this permission');
      }
    }
  };
}

/**
 * Returns a preHandler that enforces API-key permissions when present.
 * User JWT sessions are allowed without permission checks.
 */
export function requireAnyPermission(...permissions: Permission[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub: string } | undefined;

    if (!user) {
      return reply.unauthorized('Authentication required');
    }

    const keyPermissions = request.apiKeyPermissions;
    if (keyPermissions) {
      const hasAny = permissions.some((permission) => {
        const [resource, action] = permission.split(':');
        const hasWrite = keyPermissions.includes(`${resource}:write`);
        const hasRead = keyPermissions.includes(`${resource}:read`);
        return action === 'read' ? (hasRead || hasWrite) : hasWrite;
      });

      if (!hasAny) {
        return reply.forbidden('API key does not have required permissions');
      }
    }
  };
}
