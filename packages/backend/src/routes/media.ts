import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { store } from '../db/index.js';
import { sendMessage } from '../services/messages.js';
import { env } from '../config/env.js';
import { validateUploadedFile } from '../utils/file-validation.js';
import { isAgentConversationRecord } from '../services/conversation-scope.js';

// Ensure upload directory exists
function ensureUploadDir(): string {
  const uploadDir = path.resolve(env.UPLOAD_DIR);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
}

// Map MIME types to message types
function mimeToMessageType(mime: string): 'image' | 'video' | 'document' | 'voice' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/ogg') || mime === 'audio/opus') return 'voice';
  return 'document';
}

export async function mediaRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/media/:messageId/:attachmentIndex
   *
   * Serve a locally stored file attachment for display in the frontend.
   */
  typedApp.get(
    '/api/media/:messageId/:attachmentIndex',
    {
      onRequest: [app.authenticate, requirePermission('messages:read')],
      schema: {
        tags: ['Media'],
        summary: 'Get media attachment by message ID and index',
        params: z.object({ messageId: z.uuid(), attachmentIndex: z.string() }),
      },
    },
    async (request, reply) => {
      const { messageId, attachmentIndex } = request.params;
      const index = parseInt(attachmentIndex, 10);

      const msg = store.getById('messages', messageId);

      if (!msg) {
        return reply.notFound('Message not found');
      }

      const messageConversation = store.getById('conversations', msg.conversationId as string);
      if (!messageConversation || isAgentConversationRecord(messageConversation)) {
        return reply.notFound('Message not found');
      }

      const attachments = msg.attachments as Record<string, unknown>[] | null;
      if (!attachments || !Array.isArray(attachments) || !attachments[index]) {
        return reply.notFound('Attachment not found');
      }

      const attachment = attachments[index] as Record<string, unknown>;
      const localPath = attachment.localPath as string | undefined;

      if (!localPath) {
        return reply.notFound('Attachment is not available locally');
      }

      const fullPath = path.resolve(localPath);
      const uploadDir = path.resolve(env.UPLOAD_DIR);
      if (!fullPath.startsWith(uploadDir)) {
        return reply.forbidden('Access denied: path traversal detected');
      }

      if (!fs.existsSync(fullPath)) {
        return reply.notFound('File not found on disk');
      }

      const mimeType = (attachment.mimeType as string) || 'application/octet-stream';
      const fileName = sanitizeFilename((attachment.fileName as string) || 'file');

      return reply
        .header('Content-Type', mimeType)
        .header('Content-Disposition', `inline; filename="${fileName}"`)
        .header('Cache-Control', 'private, max-age=3600')
        .send(fs.createReadStream(fullPath));
    },
  );

  /**
   * POST /api/media/upload
   *
   * Upload a file and send it as a media message.
   */
  typedApp.post(
    '/api/media/upload',
    {
      onRequest: [app.authenticate, requirePermission('messages:send')],
      schema: {
        tags: ['Media'],
        summary: 'Upload a file and send as media message',
      },
    },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.badRequest('No file uploaded');
      }

      const uploadMimeType = data.mimetype || 'application/octet-stream';
      const uploadFilename = data.filename || 'unknown';
      const fileCheck = validateUploadedFile(uploadMimeType, uploadFilename);
      if (!fileCheck.valid) {
        return reply.badRequest(fileCheck.error!);
      }

      const conversationId = (data.fields.conversationId as { value: string } | undefined)?.value;
      const caption = (data.fields.caption as { value: string } | undefined)?.value || undefined;

      if (!conversationId) {
        return reply.badRequest('conversationId is required');
      }

      const conversation = store.getById('conversations', conversationId);

      if (!conversation || isAgentConversationRecord(conversation)) {
        return reply.notFound('Conversation not found');
      }

      const uploadDir = ensureUploadDir();
      const fileExt = path.extname(data.filename || '') || '';
      const uniqueName = `${crypto.randomUUID()}${fileExt}`;
      const filePath = path.join(uploadDir, uniqueName);

      await pipeline(data.file, fs.createWriteStream(filePath));

      const mimeType = data.mimetype || 'application/octet-stream';
      const msgType = mimeToMessageType(mimeType);

      const attachment = {
        type: msgType === 'image' ? 'photo' : msgType,
        fileName: data.filename || uniqueName,
        mimeType,
        fileSize: fs.statSync(filePath).size,
        localPath: filePath,
      };

      const message = await sendMessage(
        {
          conversationId,
          senderId: request.user.sub,
          direction: 'outbound',
          type: msgType,
          content: caption,
          attachments: [attachment],
        },
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      if (!message) {
        return reply.internalServerError('Failed to store message');
      }

      return reply.status(201).send(message);
    },
  );
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w\s.\-()]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 255);
}
