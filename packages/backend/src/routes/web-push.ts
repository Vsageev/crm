import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Get VAPID public key (needed by the browser to subscribe)
  typedApp.get(
    '/api/web-push/vapid-key',
    { onRequest: [app.authenticate], schema: { tags: ['Web Push'], summary: 'Get VAPID public key' } },
    async (_request, reply) => {
      const publicKey = getVapidPublicKey();
      if (!publicKey) {
        return reply.status(501).send({ message: 'Web push not configured' });
      }
      return reply.send({ publicKey });
    },
  );

  // Register a push subscription
  typedApp.post(
    '/api/web-push/subscribe',
    { onRequest: [app.authenticate], schema: { tags: ['Web Push'], summary: 'Register a push subscription', body: subscriptionBody } },
    async (request, reply) => {
      const userAgent = request.headers['user-agent'];
      const sub = await saveSubscription(request.user.sub, request.body, userAgent);
      return reply.status(201).send(sub);
    },
  );

  // Unsubscribe
  typedApp.post(
    '/api/web-push/unsubscribe',
    { onRequest: [app.authenticate], schema: { tags: ['Web Push'], summary: 'Unsubscribe from push notifications', body: unsubscribeBody } },
    async (request, reply) => {
      const deleted = await removeSubscription(request.user.sub, request.body.endpoint);
      if (!deleted) {
        return reply.notFound('Subscription not found');
      }
      return reply.status(204).send();
    },
  );

  // Get subscription status for current user
  typedApp.get(
    '/api/web-push/subscriptions',
    { onRequest: [app.authenticate], schema: { tags: ['Web Push'], summary: 'Get subscriptions for current user' } },
    async (request, reply) => {
      const subs = await getSubscriptionsByUserId(request.user.sub);
      return reply.send({ subscriptions: subs.map((s) => ({ id: s.id, endpoint: s.endpoint, createdAt: s.createdAt })) });
    },
  );
}
