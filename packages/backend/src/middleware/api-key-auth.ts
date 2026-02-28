import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Permission } from 'shared';
import { validateApiKey } from '../services/api-keys.js';
import { store } from '../db/index.js';
import { env } from '../config/env.js';

/**
 * Middleware that accepts either a JWT token or an API key in the
 * Authorization header.
 *
 * - `Authorization: Bearer <jwt>` — delegates to app.authenticate (JWT)
 * - `Authorization: Bearer ws_<key>` — validates as API key
 *
 * On success, populates `request.user` with `{ sub }` matching the
 * owner of the API key, plus `request.apiKeyPermissions` with the
 * key-specific permission list.
 */
export async function authenticateApiKeyOrJwt(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (env.DEV_SKIP_AUTH) {
    const activeUser = store.findOne('users', (r) => r.isActive === true);
    request.user = activeUser ? { sub: activeUser.id as string } : { sub: 'dev-user' };
    request.apiKeyPermissions = undefined;
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return reply.unauthorized('Missing Authorization header');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return reply.unauthorized('Invalid Authorization header format');
  }

  const token = parts[1];

  // API keys start with "ws_"
  if (token.startsWith('ws_')) {
    const apiKey = await validateApiKey(token);
    if (!apiKey) {
      return reply.unauthorized('Invalid or expired API key');
    }

    const owner = store.getById('users', apiKey.createdById as string);

    if (!owner || !owner.isActive) {
      return reply.unauthorized('API key owner account is inactive');
    }

    request.user = { sub: owner.id as string };
    request.apiKeyPermissions = apiKey.permissions as string[];
    return;
  }

  // Otherwise, delegate to JWT verification
  try {
    await request.jwtVerify();
    if (request.user.twoFactor) {
      return reply.unauthorized('Two-factor verification required');
    }
    request.apiKeyPermissions = undefined;
  } catch {
    return reply.unauthorized('Invalid or expired token');
  }
}

/**
 * Permission check that respects API key scoped permissions.
 * User JWT requests are allowed; API-key requests must match key scope.
 */
export function requireApiPermission(permission: Permission): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub: string } | undefined;
    if (!user) {
      return reply.unauthorized('Authentication required');
    }

    // If authenticated via API key, check key-scoped permissions.
    // Permission model: `resource:read` allows read, `resource:write` allows all actions.
    if (request.apiKeyPermissions) {
      const [resource, action] = permission.split(':');
      const hasWrite = request.apiKeyPermissions.includes(`${resource}:write`);
      const hasRead = request.apiKeyPermissions.includes(`${resource}:read`);

      const hasPermission = action === 'read' ? (hasRead || hasWrite) : hasWrite;
      if (!hasPermission) {
        return reply.forbidden('API key does not have this permission');
      }
    }
  };
}

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    apiKeyPermissions?: string[];
  }
}
