import type { FastifyInstance } from 'fastify';
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
  // List notifications for current user
  app.get<{
    Querystring: {
      type?: string;
      isRead?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/notifications',
    { onRequest: [app.authenticate, requirePermission('notifications:read')] },
    async (request, reply) => {
      const { entries, total } = await listNotifications({
        userId: request.user.sub,
        type: request.query.type as Parameters<typeof listNotifications>[0]['type'],
        isRead: request.query.isRead === undefined ? undefined : request.query.isRead === 'true',
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
      });

      return reply.send({
        total,
        limit: request.query.limit ? parseInt(request.query.limit, 10) : 50,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : 0,
        entries,
      });
    },
  );

  // Get unread count
  app.get(
    '/api/notifications/unread-count',
    { onRequest: [app.authenticate, requirePermission('notifications:read')] },
    async (request, reply) => {
      const count = await getUnreadCount(request.user.sub);
      return reply.send({ count });
    },
  );

  // Get single notification
  app.get<{ Params: { id: string } }>(
    '/api/notifications/:id',
    { onRequest: [app.authenticate, requirePermission('notifications:read')] },
    async (request, reply) => {
      const notification = await getNotificationById(request.params.id);
      if (!notification || notification.userId !== request.user.sub) {
        return reply.notFound('Notification not found');
      }
      return reply.send(notification);
    },
  );

  // Mark single notification as read
  app.patch<{ Params: { id: string } }>(
    '/api/notifications/:id/read',
    { onRequest: [app.authenticate, requirePermission('notifications:read')] },
    async (request, reply) => {
      const updated = await markAsRead(request.params.id, request.user.sub);
      if (!updated) {
        return reply.notFound('Notification not found');
      }
      return reply.send(updated);
    },
  );

  // Mark all notifications as read
  app.post(
    '/api/notifications/read-all',
    { onRequest: [app.authenticate, requirePermission('notifications:read')] },
    async (request, reply) => {
      const updated = await markAllAsRead(request.user.sub);
      return reply.send({ updated: updated.length });
    },
  );

  // Delete notification
  app.delete<{ Params: { id: string } }>(
    '/api/notifications/:id',
    { onRequest: [app.authenticate, requirePermission('notifications:read')] },
    async (request, reply) => {
      const deleted = await deleteNotification(request.params.id, request.user.sub);
      if (!deleted) {
        return reply.notFound('Notification not found');
      }
      return reply.status(204).send();
    },
  );
}
