import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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

const contactsQuerySchema = z.object({
  ownerId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  source: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const contactsExportQuerySchema = z.object({
  ownerId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  source: z.string().optional(),
  search: z.string().optional(),
});

const activitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createContactQuerySchema = z.object({
  skipDuplicateCheck: z.string().optional(),
});

export async function contactRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List contacts
  typedApp.get(
    '/api/contacts',
    { onRequest: [app.authenticate, requirePermission('contacts:read')], schema: { tags: ['Contacts'], summary: 'List contacts', querystring: contactsQuerySchema } },
    async (request, reply) => {
      // Agents can only see their own contacts
      const ownerId = isAgent(request) ? request.user.sub : request.query.ownerId;

      const { entries, total } = await listContacts({
        ownerId,
        companyId: request.query.companyId,
        source: request.query.source,
        search: request.query.search,
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

  // Check for duplicate contacts
  typedApp.post(
    '/api/contacts/check-duplicates',
    { onRequest: [app.authenticate, requirePermission('contacts:read')], schema: { tags: ['Contacts'], summary: 'Check for duplicate contacts', body: duplicateCheckBody } },
    async (request, reply) => {
      const result = await findContactDuplicates(request.body);
      return reply.send(result);
    },
  );

  // Export contacts as CSV
  typedApp.get(
    '/api/contacts/export/csv',
    { onRequest: [app.authenticate, requirePermission('contacts:read')], schema: { tags: ['Contacts'], summary: 'Export contacts as CSV', querystring: contactsExportQuerySchema } },
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
  typedApp.get(
    '/api/contacts/:id/export/gdpr',
    { onRequest: [app.authenticate, requirePermission('contacts:read')], schema: { tags: ['Contacts'], summary: 'GDPR data export per contact', params: z.object({ id: z.uuid() }) } },
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
  typedApp.post(
    '/api/contacts/import/csv',
    { onRequest: [app.authenticate, requirePermission('contacts:create')], schema: { tags: ['Contacts'], summary: 'Import contacts from CSV' } },
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
  typedApp.get(
    '/api/contacts/:id/activities',
    { onRequest: [app.authenticate, requirePermission('contacts:read')], schema: { tags: ['Contacts'], summary: 'Get contact activity timeline', params: z.object({ id: z.uuid() }), querystring: activitiesQuerySchema } },
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
        limit: request.query.limit,
        offset: request.query.offset,
      });

      return reply.send(result);
    },
  );

  // Get single contact
  typedApp.get(
    '/api/contacts/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:read')], schema: { tags: ['Contacts'], summary: 'Get single contact', params: z.object({ id: z.uuid() }) } },
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
  typedApp.post(
    '/api/contacts',
    { onRequest: [app.authenticate, requirePermission('contacts:create')], schema: { tags: ['Contacts'], summary: 'Create contact', body: createContactBody, querystring: createContactQuerySchema } },
    async (request, reply) => {
      // Check for duplicates unless explicitly skipped
      if (request.query.skipDuplicateCheck !== 'true') {
        const duplicateResult = await findContactDuplicates(request.body);
        if (duplicateResult.hasDuplicates) {
          return reply.status(409).send({
            error: 'Potential duplicates found',
            duplicates: duplicateResult.duplicates,
          });
        }
      }

      // Agents can only create contacts owned by themselves
      const data = isAgent(request)
        ? { ...request.body, ownerId: request.user.sub }
        : request.body;

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
  typedApp.patch(
    '/api/contacts/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:update')], schema: { tags: ['Contacts'], summary: 'Update contact', params: z.object({ id: z.uuid() }), body: updateContactBody } },
    async (request, reply) => {
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
        if (request.body.ownerId !== undefined && request.body.ownerId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign contact ownership');
        }
      }

      // Check if ownership is changing (for lead_assigned notification)
      const previousOwnerId = request.body.ownerId !== undefined
        ? (await getContactById(request.params.id) as any)?.ownerId
        : undefined;

      const updated = await updateContact(request.params.id, request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }) as any;

      if (!updated) {
        return reply.notFound('Contact not found');
      }

      // Emit tag_added if tags were updated
      if (request.body.tagIds && request.body.tagIds.length > 0) {
        eventBus.emit('tag_added', {
          contactId: updated.id,
          tagIds: request.body.tagIds,
          contact: updated as unknown as Record<string, unknown>,
        });
      }

      // Notify new owner about lead assignment (fire-and-forget)
      if (
        request.body.ownerId &&
        request.body.ownerId !== previousOwnerId &&
        request.body.ownerId !== request.user.sub
      ) {
        createNotification({
          userId: request.body.ownerId,
          type: 'lead_assigned',
          title: `Lead assigned: ${updated.firstName}`,
          message: `Contact "${updated.firstName} ${updated.lastName ?? ''}" was assigned to you.`.trim(),
          entityType: 'contact',
          entityId: updated.id,
        }).catch(() => {});

        sendTelegramNotification(
          request.body.ownerId,
          formatLeadAssignedNotification(updated, { firstName: '', lastName: '' }),
          'notifyLeadAssigned',
        ).catch(() => {});
      }

      return reply.send(updated);
    },
  );

  // Delete contact
  typedApp.delete(
    '/api/contacts/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:delete')], schema: { tags: ['Contacts'], summary: 'Delete contact', params: z.object({ id: z.uuid() }) } },
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
