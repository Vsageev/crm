import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listWebForms,
  getWebFormById,
  createWebForm,
  updateWebForm,
  deleteWebForm,
  listSubmissions,
  getSubmissionById,
  createSubmission,
  processFormSubmission,
} from '../services/web-forms.js';

const fieldSchema = z.object({
  label: z.string().min(1).max(255),
  fieldType: z
    .enum(['text', 'email', 'phone', 'number', 'textarea', 'select', 'checkbox', 'date', 'url', 'hidden'])
    .optional(),
  placeholder: z.string().max(255).optional(),
  isRequired: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  options: z.array(z.string().max(255)).optional(),
  defaultValue: z.string().max(500).optional(),
  contactFieldMapping: z.string().max(100).optional(),
});

const createWebFormBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  pipelineId: z.uuid().optional(),
  pipelineStageId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  submitButtonText: z.string().max(100).optional(),
  successMessage: z.string().optional(),
  redirectUrl: z.string().max(2048).optional(),
  fields: z.array(fieldSchema).optional(),
});

const updateWebFormBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  pipelineId: z.uuid().nullable().optional(),
  pipelineStageId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  submitButtonText: z.string().max(100).optional(),
  successMessage: z.string().optional(),
  redirectUrl: z.string().max(2048).nullable().optional(),
  fields: z.array(fieldSchema).optional(),
});

const submitFormBody = z.object({
  data: z.record(z.string(), z.unknown()),
  referrerUrl: z.string().max(2048).optional(),
  utmSource: z.string().max(255).optional(),
  utmMedium: z.string().max(255).optional(),
  utmCampaign: z.string().max(255).optional(),
  utmTerm: z.string().max(255).optional(),
  utmContent: z.string().max(255).optional(),
});

export async function webFormRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // ── Authenticated form management routes ────────────────────────────

  // LIST forms
  typedApp.get(
    '/api/web-forms',
    {
      onRequest: [app.authenticate, requirePermission('forms:read')],
      schema: {
        tags: ['Web Forms'],
        summary: 'List web forms',
        querystring: z.object({
          status: z.string().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listWebForms({
        status: request.query.status,
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

  // GET single form (authenticated)
  typedApp.get(
    '/api/web-forms/:id',
    {
      onRequest: [app.authenticate, requirePermission('forms:read')],
      schema: {
        tags: ['Web Forms'],
        summary: 'Get single web form',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const form = await getWebFormById(request.params.id) as any;
      if (!form) {
        return reply.notFound('Web form not found');
      }
      return reply.send(form);
    },
  );

  // CREATE form
  typedApp.post(
    '/api/web-forms',
    {
      onRequest: [app.authenticate, requirePermission('forms:create')],
      schema: {
        tags: ['Web Forms'],
        summary: 'Create web form',
        body: createWebFormBody,
      },
    },
    async (request, reply) => {
      const form = await createWebForm(
        { ...request.body, createdBy: request.user.sub } as Parameters<typeof createWebForm>[0] & {
          createdBy: string;
        },
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      return reply.status(201).send(form);
    },
  );

  // UPDATE form
  typedApp.patch(
    '/api/web-forms/:id',
    {
      onRequest: [app.authenticate, requirePermission('forms:update')],
      schema: {
        tags: ['Web Forms'],
        summary: 'Update web form',
        params: z.object({ id: z.uuid() }),
        body: updateWebFormBody,
      },
    },
    async (request, reply) => {
      const updated = await updateWebForm(request.params.id, request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Web form not found');
      }

      return reply.send(updated);
    },
  );

  // DELETE form
  typedApp.delete(
    '/api/web-forms/:id',
    {
      onRequest: [app.authenticate, requirePermission('forms:delete')],
      schema: {
        tags: ['Web Forms'],
        summary: 'Delete web form',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const deleted = await deleteWebForm(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Web form not found');
      }

      return reply.status(204).send();
    },
  );

  // ── Submissions (authenticated management) ──────────────────────────

  // LIST submissions for a form
  typedApp.get(
    '/api/web-forms/:formId/submissions',
    {
      onRequest: [app.authenticate, requirePermission('forms:read')],
      schema: {
        tags: ['Web Forms'],
        summary: 'List submissions for a form',
        params: z.object({ formId: z.uuid() }),
        querystring: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listSubmissions({
        formId: request.params.formId,
        status: request.query.status,
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

  // GET single submission
  typedApp.get(
    '/api/web-forms/:formId/submissions/:submissionId',
    {
      onRequest: [app.authenticate, requirePermission('forms:read')],
      schema: {
        tags: ['Web Forms'],
        summary: 'Get single form submission',
        params: z.object({ formId: z.uuid(), submissionId: z.uuid() }),
      },
    },
    async (request, reply) => {
      const submission = await getSubmissionById(request.params.submissionId) as any;
      if (!submission || submission.formId !== request.params.formId) {
        return reply.notFound('Submission not found');
      }
      return reply.send(submission);
    },
  );

  // ── Public submission endpoint (no auth) ────────────────────────────

  // GET public form config (for rendering the embeddable form)
  typedApp.get(
    '/api/public/web-forms/:id',
    {
      schema: {
        tags: ['Web Forms'],
        summary: 'Get public form config',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const form = await getWebFormById(request.params.id) as any;
      if (!form || form.status !== 'active') {
        return reply.notFound('Form not found');
      }

      // Return only public-safe fields
      return reply.send({
        id: form.id,
        name: form.name,
        description: form.description,
        submitButtonText: form.submitButtonText,
        successMessage: form.successMessage,
        redirectUrl: form.redirectUrl,
        fields: form.fields.map((f: any) => ({
          id: f.id,
          label: f.label,
          fieldType: f.fieldType,
          placeholder: f.placeholder,
          isRequired: f.isRequired,
          position: f.position,
          options: f.options,
          defaultValue: f.defaultValue,
        })),
      });
    },
  );

  // PUBLIC submit form (no auth — used by embeddable widget)
  typedApp.post(
    '/api/public/web-forms/:id/submit',
    {
      schema: {
        tags: ['Web Forms'],
        summary: 'Submit a public web form',
        params: z.object({ id: z.uuid() }),
        body: submitFormBody,
      },
    },
    async (request, reply) => {
      // Verify form exists and is active
      const form = await getWebFormById(request.params.id) as any;
      if (!form || form.status !== 'active') {
        return reply.notFound('Form not found');
      }

      // Validate required fields
      for (const field of form.fields) {
        if ((field as any).isRequired) {
          const value = request.body.data[(field as any).id];
          if (value === undefined || value === null || value === '') {
            return reply.badRequest(`Field "${(field as any).label}" is required`);
          }
        }
      }

      const submission = await createSubmission({
        formId: form.id,
        data: request.body.data,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        referrerUrl: request.body.referrerUrl,
        utmSource: request.body.utmSource,
        utmMedium: request.body.utmMedium,
        utmCampaign: request.body.utmCampaign,
        utmTerm: request.body.utmTerm,
        utmContent: request.body.utmContent,
      }) as any;

      // Process submission: create contact + deal (Task 7.3)
      let contactId: string | null = null;
      let dealId: string | null = null;
      try {
        const result = await processFormSubmission(form, submission);
        contactId = result.contactId ?? null;
        dealId = result.dealId ?? null;
      } catch (err) {
        // Log but don't fail the submission response — the data is already saved
        request.log.error({ err, submissionId: submission.id }, 'Failed to process form submission');
      }

      return reply.status(201).send({
        id: submission.id,
        contactId,
        dealId,
        successMessage: form.successMessage,
        redirectUrl: form.redirectUrl,
      });
    },
  );
}
