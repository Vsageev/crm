import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listMessages,
  getMessageById,
  sendMessage,
  updateMessageStatus,
} from '../services/messages.js';
import { sendTelegramMessage } from '../services/telegram-outbound.js';
import { sendEmailMessage } from '../services/email-outbound.js';
import { sendInstagramMessage } from '../services/instagram-outbound.js';
import { eventBus } from '../services/event-bus.js';
import { getConversationById } from '../services/conversations.js';

const inlineKeyboardButtonSchema = z.object({
  text: z.string().min(1),
  url: z.string().url().optional(),
  callback_data: z.string().max(64).optional(),
});

const sendMessageBody = z.object({
  conversationId: z.uuid(),
  direction: z.enum(['inbound', 'outbound']),
  type: z
    .enum(['text', 'image', 'video', 'document', 'voice', 'sticker', 'location', 'system'])
    .optional(),
  content: z.string().optional(),
  externalId: z.string().optional(),
  attachments: z.any().optional(),
  metadata: z.string().optional(),
  parseMode: z.enum(['HTML', 'MarkdownV2']).optional(),
  inlineKeyboard: z.array(z.array(inlineKeyboardButtonSchema)).optional(),
});

const updateStatusBody = z.object({
  status: z.enum(['pending', 'sent', 'delivered', 'read', 'failed']),
});

export async function messageRoutes(app: FastifyInstance) {
  // List messages for a conversation
  app.get<{
    Querystring: {
      conversationId: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/messages',
    { onRequest: [app.authenticate, requirePermission('messages:read')] },
    async (request, reply) => {
      if (!request.query.conversationId) {
        return reply.badRequest('conversationId query parameter is required');
      }

      const { entries, total } = await listMessages({
        conversationId: request.query.conversationId,
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

  // Get single message
  app.get<{ Params: { id: string } }>(
    '/api/messages/:id',
    { onRequest: [app.authenticate, requirePermission('messages:read')] },
    async (request, reply) => {
      const message = await getMessageById(request.params.id);
      if (!message) {
        return reply.notFound('Message not found');
      }
      return reply.send(message);
    },
  );

  // Send a message
  app.post(
    '/api/messages',
    { onRequest: [app.authenticate, requirePermission('messages:send')] },
    async (request, reply) => {
      const parsed = sendMessageBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const { parseMode, inlineKeyboard, ...messageData } = parsed.data;

      // Store inline keyboard and parse mode in metadata if provided
      let metadata = messageData.metadata;
      if (parseMode || inlineKeyboard) {
        const existing = metadata ? JSON.parse(metadata) : {};
        if (parseMode) existing.parseMode = parseMode;
        if (inlineKeyboard) existing.inlineKeyboard = inlineKeyboard;
        metadata = JSON.stringify(existing);
      }

      const message = await sendMessage(
        {
          ...messageData,
          metadata,
          senderId: request.user.sub,
        },
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      ) as any;

      if (!message) {
        return reply.notFound('Conversation not found');
      }

      // Emit automation trigger for inbound messages
      if (parsed.data.direction === 'inbound') {
        const conversation = await getConversationById(parsed.data.conversationId) as any;
        if (conversation) {
          eventBus.emit('message_received', {
            messageId: message.id,
            conversationId: conversation.id,
            contactId: conversation.contactId,
            message: message as unknown as Record<string, unknown>,
          });
        }
      }

      // For outbound messages, attempt to deliver via the appropriate channel
      if (parsed.data.direction === 'outbound' && message.content) {
        const conversation = await getConversationById(parsed.data.conversationId) as any;

        if (conversation?.channelType === 'telegram') {
          // Fire-and-forget: send to Telegram in the background
          sendTelegramMessage({
            conversationId: parsed.data.conversationId,
            messageId: message.id,
            text: message.content,
            parseMode,
            inlineKeyboard,
          }).catch((err: unknown) => {
            app.log.error(err, 'Failed to send Telegram message');
          });
        } else if (conversation?.channelType === 'email') {
          // Fire-and-forget: send via SMTP in the background
          sendEmailMessage({
            conversationId: parsed.data.conversationId,
            messageId: message.id,
            text: message.content,
          }).catch((err: unknown) => {
            app.log.error(err, 'Failed to send email message');
          });
        } else if (conversation?.channelType === 'instagram') {
          // Fire-and-forget: send via Instagram/Messenger in the background
          sendInstagramMessage({
            conversationId: parsed.data.conversationId,
            messageId: message.id,
            text: message.content,
          }).catch((err: unknown) => {
            app.log.error(err, 'Failed to send Instagram message');
          });
        }
      }

      return reply.status(201).send(message);
    },
  );

  // Update message status
  app.patch<{ Params: { id: string } }>(
    '/api/messages/:id/status',
    { onRequest: [app.authenticate, requirePermission('messages:send')] },
    async (request, reply) => {
      const parsed = updateStatusBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const updated = await updateMessageStatus(request.params.id, parsed.data.status);
      if (!updated) {
        return reply.notFound('Message not found');
      }

      return reply.send(updated);
    },
  );
}
