import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  getSubscriptionsByUserId,
} from '../services/web-push.js';

const subscriptionBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const unsubscribeBody = z.object({
  endpoint: z.string().url(),
});

export async function webPushRoutes(app: FastifyInstance) {
  // Get VAPID public key (needed by the browser to subscribe)
  app.get(
    '/api/web-push/vapid-key',
    { onRequest: [app.authenticate] },
    async (_request, reply) => {
      const publicKey = getVapidPublicKey();
      if (!publicKey) {
        return reply.status(501).send({ message: 'Web push not configured' });
      }
      return reply.send({ publicKey });
    },
  );

  // Register a push subscription
  app.post(
    '/api/web-push/subscribe',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const parsed = subscriptionBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const userAgent = request.headers['user-agent'];
      const sub = await saveSubscription(request.user.sub, parsed.data, userAgent);
      return reply.status(201).send(sub);
    },
  );

  // Unsubscribe
  app.post(
    '/api/web-push/unsubscribe',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const parsed = unsubscribeBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const deleted = await removeSubscription(request.user.sub, parsed.data.endpoint);
      if (!deleted) {
        return reply.notFound('Subscription not found');
      }
      return reply.status(204).send();
    },
  );

  // Get subscription status for current user
  app.get(
    '/api/web-push/subscriptions',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const subs = await getSubscriptionsByUserId(request.user.sub);
      return reply.send({ subscriptions: subs.map((s) => ({ id: s.id, endpoint: s.endpoint, createdAt: s.createdAt })) });
    },
  );
}
