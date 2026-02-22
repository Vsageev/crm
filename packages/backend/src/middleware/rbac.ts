import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Permission, UserRole } from 'shared';
import { ROLE_PERMISSIONS } from 'shared';

/**
 * Returns a preHandler that allows access only to users with one of the
 * specified roles.
 *
 * @example
 *   app.get('/admin', { preHandler: [authenticate, requireRole('admin')] }, handler)
 */
export function requireRole(...roles: UserRole[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub: string; role: UserRole } | undefined;

    if (!user) {
      return reply.unauthorized('Authentication required');
    }

    if (!roles.includes(user.role)) {
      return reply.forbidden('Insufficient role');
    }
  };
}

/**
 * Returns a preHandler that allows access only to users whose role grants
 * the specified permission.
 *
 * @example
 *   app.delete('/users/:id', { preHandler: [authenticate, requirePermission('users:delete')] }, handler)
 */
export function requirePermission(permission: Permission): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub: string; role: UserRole } | undefined;

    if (!user) {
      return reply.unauthorized('Authentication required');
    }

    const allowed = ROLE_PERMISSIONS[user.role];
    if (!allowed.includes(permission)) {
      return reply.forbidden('Insufficient permissions');
    }
  };
}

/**
 * Returns a preHandler that allows access if the user has ANY of the
 * specified permissions.
 *
 * @example
 *   app.get('/data', { preHandler: [authenticate, requireAnyPermission('reports:read', 'deals:read')] }, handler)
 */
export function requireAnyPermission(...permissions: Permission[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { sub: string; role: UserRole } | undefined;

    if (!user) {
      return reply.unauthorized('Authentication required');
    }

    const allowed = ROLE_PERMISSIONS[user.role];
    const hasAny = permissions.some((p) => allowed.includes(p));
    if (!hasAny) {
      return reply.forbidden('Insufficient permissions');
    }
  };
}

/**
 * Helper to check at runtime whether a role has a given permission.
 */
export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Returns true if the authenticated user is an agent (not admin or manager).
 * Agents should only see their own resources.
 */
export function isAgent(request: FastifyRequest): boolean {
  const user = request.user as { sub: string; role: UserRole } | undefined;
  return user?.role === 'agent';
}
