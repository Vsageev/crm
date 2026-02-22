import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission, isAgent } from '../middleware/rbac.js';
import {
  listContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
} from '../services/contacts.js';
import { findContactDuplicates } from '../services/duplicates.js';
import { exportContactsCsv, importContactsCsv } from '../services/csv.js';
import { exportContactGdprData } from '../services/gdpr-export.js';
import { listContactActivities } from '../services/activities.js';
import {
  sendTelegramNotification,
  sendTelegramNotificationBatch,
  formatNewLeadNotification,
  formatLeadAssignedNotification,
  getUsersWithNotificationType,
} from '../services/telegram-notifications.js';
import { createNotification } from '../services/notifications.js';
import { eventBus } from '../services/event-bus.js';

const createContactBody = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(50).optional(),
  position: z.string().max(150).optional(),
  companyId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  source: z
    .enum(['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'])
    .optional(),
  telegramId: z.string().max(50).optional(),
  notes: z.string().optional(),
  tagIds: z.array(z.uuid()).optional(),
  customFields: z
    .array(z.object({ definitionId: z.uuid(), value: z.string() }))
    .optional(),
});

const updateContactBody = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).nullable().optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  position: z.string().max(150).nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  source: z
    .enum(['manual', 'csv_import', 'web_form', 'telegram', 'email', 'api', 'other'])
    .optional(),
  telegramId: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
  tagIds: z.array(z.uuid()).optional(),
  customFields: z
    .array(z.object({ definitionId: z.uuid(), value: z.string() }))
    .optional(),
});

const duplicateCheckBody = z.object({
  email: z.string().email().max(255).optional(),
  phone: z.string().max(50).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

export async function contactRoutes(app: FastifyInstance) {
  // List contacts
  app.get<{
    Querystring: {
      ownerId?: string;
      companyId?: string;
      source?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/contacts',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      // Agents can only see their own contacts
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;

      const { entries, total } = await listContacts({
        ownerId,
        companyId: request.query.companyId,
        source: request.query.source,
        search: request.query.search,
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

  // Check for duplicate contacts
  app.post(
    '/api/contacts/check-duplicates',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      const parsed = duplicateCheckBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const result = await findContactDuplicates(parsed.data);
      return reply.send(result);
    },
  );

  // Export contacts as CSV
  app.get<{
    Querystring: {
      ownerId?: string;
      companyId?: string;
      source?: string;
      search?: string;
    };
  }>(
    '/api/contacts/export/csv',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      // Agents can only export their own contacts
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;

      const csv = await exportContactsCsv({
        ownerId,
        companyId: request.query.companyId,
        source: request.query.source,
        search: request.query.search,
      });

      if (request.user) {
        const { createAuditLog } = await import('../services/audit-log.js');
        await createAuditLog({
          userId: request.user.sub,
          action: 'export',
          entityType: 'contact',
          changes: {
            format: 'csv',
            filters: {
              ownerId: request.query.ownerId,
              companyId: request.query.companyId,
              source: request.query.source,
              search: request.query.search,
            },
          },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
      }

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="contacts.csv"')
        .send(csv);
    },
  );

  // GDPR data export per contact
  app.get<{ Params: { id: string } }>(
    '/api/contacts/:id/export/gdpr',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      const contact = await getContactById(request.params.id) as any;
      if (!contact) {
        return reply.notFound('Contact not found');
      }
      if (isAgent(request) && contact.ownerId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }

      const data = await exportContactGdprData(request.params.id);
      if (!data) {
        return reply.notFound('Contact not found');
      }

      const { createAuditLog } = await import('../services/audit-log.js');
      await createAuditLog({
        userId: request.user.sub,
        action: 'export',
        entityType: 'contact',
        entityId: request.params.id,
        changes: { format: 'gdpr_json' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      const contactName = [contact.firstName as string, contact.lastName as string].filter(Boolean).join('_') || 'contact';
      const filename = `gdpr_export_${contactName}_${new Date().toISOString().slice(0, 10)}.json`;

      return reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(JSON.stringify(data, null, 2));
    },
  );

  // Import contacts from CSV
  app.post(
    '/api/contacts/import/csv',
    { onRequest: [app.authenticate, requirePermission('contacts:create')] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.badRequest('No file uploaded. Send a CSV file as multipart form data.');
      }

      const buffer = await file.toBuffer();
      const csvContent = buffer.toString('utf-8');

      if (csvContent.trim().length === 0) {
        return reply.badRequest('Uploaded file is empty');
      }

      const result = await importContactsCsv(csvContent, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send(result);
    },
  );

  // Get contact activity timeline
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    '/api/contacts/:id/activities',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      const contact = await getContactById(request.params.id) as any;
      if (!contact) {
        return reply.notFound('Contact not found');
      }
      if (isAgent(request) && contact.ownerId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }

      const result = await listContactActivities({
        contactId: request.params.id,
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
      });

      return reply.send(result);
    },
  );

  // Get single contact
  app.get<{ Params: { id: string } }>(
    '/api/contacts/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      const contact = await getContactById(request.params.id) as any;
      if (!contact) {
        return reply.notFound('Contact not found');
      }
      if (isAgent(request) && contact.ownerId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }
      return reply.send(contact);
    },
  );

  // Create contact
  app.post<{ Querystring: { skipDuplicateCheck?: string } }>(
    '/api/contacts',
    { onRequest: [app.authenticate, requirePermission('contacts:create')] },
    async (request, reply) => {
      const parsed = createContactBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Check for duplicates unless explicitly skipped
      if (request.query.skipDuplicateCheck !== 'true') {
        const duplicateResult = await findContactDuplicates(parsed.data);
        if (duplicateResult.hasDuplicates) {
          return reply.status(409).send({
            error: 'Potential duplicates found',
            duplicates: duplicateResult.duplicates,
          });
        }
      }

      // Agents can only create contacts owned by themselves
      const data = isAgent(request)
        ? { ...parsed.data, ownerId: request.user.sub }
        : parsed.data;

      const contact = await createContact(data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }) as any;

      // Emit automation trigger
      eventBus.emit('contact_created', {
        contactId: contact.id,
        contact: contact as unknown as Record<string, unknown>,
      });

      // Emit tag_added if tags were provided at creation
      if (data.tagIds && data.tagIds.length > 0) {
        eventBus.emit('tag_added', {
          contactId: contact.id,
          tagIds: data.tagIds,
          contact: contact as unknown as Record<string, unknown>,
        });
      }

      // Notify about new lead via Telegram (fire-and-forget)
      const tgText = formatNewLeadNotification(contact);
      getUsersWithNotificationType('notifyNewLead')
        .then((subscribers) => {
          const items = subscribers.map((s) => ({
            userId: s.userId,
            text: tgText,
            notificationType: 'notifyNewLead' as const,
          }));
          if (items.length > 0) sendTelegramNotificationBatch(items).catch(() => {});
        })
        .catch(() => {});

      // If assigned to an owner, send lead_assigned notification
      if (contact.ownerId && contact.ownerId !== request.user.sub) {
        createNotification({
          userId: contact.ownerId,
          type: 'lead_assigned',
          title: `New lead assigned: ${contact.firstName}`,
          message: `Contact "${contact.firstName} ${contact.lastName ?? ''}" was assigned to you.`.trim(),
          entityType: 'contact',
          entityId: contact.id,
        }).catch(() => {});

        sendTelegramNotification(
          contact.ownerId,
          formatLeadAssignedNotification(contact, { firstName: '', lastName: '' }),
          'notifyLeadAssigned',
        ).catch(() => {});
      }

      return reply.status(201).send(contact);
    },
  );

  // Update contact
  app.patch<{ Params: { id: string } }>(
    '/api/contacts/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:update')] },
    async (request, reply) => {
      const parsed = updateContactBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Agents can only update their own contacts
      if (isAgent(request)) {
        const contact = await getContactById(request.params.id) as any;
        if (!contact) {
          return reply.notFound('Contact not found');
        }
        if (contact.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        // Prevent agents from reassigning ownership
        if (parsed.data.ownerId !== undefined && parsed.data.ownerId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign contact ownership');
        }
      }

      // Check if ownership is changing (for lead_assigned notification)
      const previousOwnerId = parsed.data.ownerId !== undefined
        ? (await getContactById(request.params.id) as any)?.ownerId
        : undefined;

      const updated = await updateContact(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }) as any;

      if (!updated) {
        return reply.notFound('Contact not found');
      }

      // Emit tag_added if tags were updated
      if (parsed.data.tagIds && parsed.data.tagIds.length > 0) {
        eventBus.emit('tag_added', {
          contactId: updated.id,
          tagIds: parsed.data.tagIds,
          contact: updated as unknown as Record<string, unknown>,
        });
      }

      // Notify new owner about lead assignment (fire-and-forget)
      if (
        parsed.data.ownerId &&
        parsed.data.ownerId !== previousOwnerId &&
        parsed.data.ownerId !== request.user.sub
      ) {
        createNotification({
          userId: parsed.data.ownerId,
          type: 'lead_assigned',
          title: `Lead assigned: ${updated.firstName}`,
          message: `Contact "${updated.firstName} ${updated.lastName ?? ''}" was assigned to you.`.trim(),
          entityType: 'contact',
          entityId: updated.id,
        }).catch(() => {});

        sendTelegramNotification(
          parsed.data.ownerId,
          formatLeadAssignedNotification(updated, { firstName: '', lastName: '' }),
          'notifyLeadAssigned',
        ).catch(() => {});
      }

      return reply.send(updated);
    },
  );

  // Delete contact
  app.delete<{ Params: { id: string } }>(
    '/api/contacts/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:delete')] },
    async (request, reply) => {
      // Agents can only delete their own contacts
      if (isAgent(request)) {
        const contact = await getContactById(request.params.id) as any;
        if (!contact) {
          return reply.notFound('Contact not found');
        }
        if (contact.ownerId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
      }

      const deleted = await deleteContact(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Contact not found');
      }

      return reply.status(204).send();
    },
  );
}
