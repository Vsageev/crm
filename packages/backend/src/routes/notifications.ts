import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteNotification,
} from '../services/notifications.js';

export async function notificationRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List notifications for current user
  typedApp.get(
    '/api/notifications',
    {
      onRequest: [app.authenticate, requirePermission('notifications:read')],
      schema: {
        tags: ['Notifications'],
        summary: 'List notifications for current user',
        querystring: z.object({
          type: z.string().optional(),
          isRead: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listNotifications({
        userId: request.user.sub,
        type: request.query.type as Parameters<typeof listNotifications>[0]['type'],
        isRead: request.query.isRead === undefined ? undefined : request.query.isRead === 'true',
        limit: request.query.limit,
        offset: request.query.offset,
      });

      return reply.send({
        total,
        limit: request.query.limit ?? 50,
        offset: request.query.offset ?? 0,
        entries,
      });
    },
  );

  // Get unread count
  typedApp.get(
    '/api/notifications/unread-count',
    {
      onRequest: [app.authenticate, requirePermission('notifications:read')],
      schema: {
        tags: ['Notifications'],
        summary: 'Get unread notification count',
      },
    },
    async (request, reply) => {
      const count = await getUnreadCount(request.user.sub);
      return reply.send({ count });
    },
  );

  // Get single notification
  typedApp.get(
    '/api/notifications/:id',
    {
      onRequest: [app.authenticate, requirePermission('notifications:read')],
      schema: {
        tags: ['Notifications'],
        summary: 'Get single notification',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const notification = await getNotificationById(request.params.id);
      if (!notification || notification.userId !== request.user.sub) {
        return reply.notFound('Notification not found');
      }
      return reply.send(notification);
    },
  );

  // Mark single notification as read
  typedApp.patch(
    '/api/notifications/:id/read',
    {
      onRequest: [app.authenticate, requirePermission('notifications:read')],
      schema: {
        tags: ['Notifications'],
        summary: 'Mark notification as read',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const updated = await markAsRead(request.params.id, request.user.sub);
      if (!updated) {
        return reply.notFound('Notification not found');
      }
      return reply.send(updated);
    },
  );

  // Mark all notifications as read
  typedApp.post(
    '/api/notifications/read-all',
    {
      onRequest: [app.authenticate, requirePermission('notifications:read')],
      schema: {
        tags: ['Notifications'],
        summary: 'Mark all notifications as read',
      },
    },
    async (request, reply) => {
      const updated = await markAllAsRead(request.user.sub);
      return reply.send({ updated: updated.length });
    },
  );

  // Delete notification
  typedApp.delete(
    '/api/notifications/:id',
    {
      onRequest: [app.authenticate, requirePermission('notifications:read')],
      schema: {
        tags: ['Notifications'],
        summary: 'Delete notification',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const deleted = await deleteNotification(request.params.id, request.user.sub);
      if (!deleted) {
        return reply.notFound('Notification not found');
      }
      return reply.status(204).send();
    },
  );
}
