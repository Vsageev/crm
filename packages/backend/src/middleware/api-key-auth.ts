import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Permission, UserRole } from 'shared';
import { validateApiKey } from '../services/api-keys.js';
import { store } from '../db/index.js';

/**
 * Middleware that accepts either a JWT token or an API key in the
 * Authorization header.
 *
 * - `Authorization: Bearer <jwt>` — delegates to app.authenticate (JWT)
 * - `Authorization: Bearer crm_<key>` — validates as API key
 *
 * On success, populates `request.user` with `{ sub, role }` matching the
 * owner of the API key, plus `request.apiKeyPermissions` with the
 * key-specific permission list.
 */
export async function authenticateApiKeyOrJwt(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return reply.unauthorized('Missing Authorization header');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return reply.unauthorized('Invalid Authorization header format');
  }

  const token = parts[1];

  // API keys start with "crm_"
  if (token.startsWith('crm_')) {
    const apiKey = await validateApiKey(token);
    if (!apiKey) {
      return reply.unauthorized('Invalid or expired API key');
    }

    // Fetch the key owner's role
    const owner = store.getById('users', apiKey.createdById as string);

    if (!owner || !owner.isActive) {
      return reply.unauthorized('API key owner account is inactive');
    }

    request.user = { sub: owner.id as string, role: owner.role as string };
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
 * When the request is authenticated via an API key, the permission must
 * exist both in the user's role AND in the key's permission list.
 */
export function requireApiPermission(permission: Permission): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub: string; role: UserRole } | undefined;
    if (!user) {
      return reply.unauthorized('Authentication required');
    }

    // Import lazily to avoid circular deps
    const { ROLE_PERMISSIONS } = await import('shared');
    const rolePerms = ROLE_PERMISSIONS[user.role];

    if (!rolePerms.includes(permission)) {
      return reply.forbidden('Insufficient permissions');
    }

    // If authenticated via API key, also check key-scoped permissions
    if (request.apiKeyPermissions) {
      if (!request.apiKeyPermissions.includes(permission)) {
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
