import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
} from '../services/companies.js';
import { findCompanyDuplicates } from '../services/duplicates.js';

const createCompanyBody = z.object({
  name: z.string().min(1).max(255),
  website: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().optional(),
  industry: z.string().max(100).optional(),
  size: z.string().max(50).optional(),
  notes: z.string().optional(),
  ownerId: z.uuid().optional(),
  tagIds: z.array(z.uuid()).optional(),
  customFields: z
    .array(z.object({ definitionId: z.uuid(), value: z.string() }))
    .optional(),
});

const updateCompanyBody = z.object({
  name: z.string().min(1).max(255).optional(),
  website: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.string().nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  size: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  tagIds: z.array(z.uuid()).optional(),
  customFields: z
    .array(z.object({ definitionId: z.uuid(), value: z.string() }))
    .optional(),
});

const duplicateCheckBody = z.object({
  name: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
});

export async function companyRoutes(app: FastifyInstance) {
  // List companies
  app.get<{
    Querystring: {
      ownerId?: string;
      industry?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/companies',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      const { entries, total } = await listCompanies({
        ownerId: request.query.ownerId,
        industry: request.query.industry,
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

  // Check for duplicate companies
  app.post(
    '/api/companies/check-duplicates',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      const parsed = duplicateCheckBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const result = await findCompanyDuplicates(parsed.data);
      return reply.send(result);
    },
  );

  // Get single company
  app.get<{ Params: { id: string } }>(
    '/api/companies/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:read')] },
    async (request, reply) => {
      const company = await getCompanyById(request.params.id);
      if (!company) {
        return reply.notFound('Company not found');
      }
      return reply.send(company);
    },
  );

  // Create company
  app.post<{ Querystring: { skipDuplicateCheck?: string } }>(
    '/api/companies',
    { onRequest: [app.authenticate, requirePermission('contacts:create')] },
    async (request, reply) => {
      const parsed = createCompanyBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      if (request.query.skipDuplicateCheck !== 'true') {
        const duplicateResult = await findCompanyDuplicates(parsed.data);
        if (duplicateResult.hasDuplicates) {
          return reply.status(409).send({
            error: 'Potential duplicates found',
            duplicates: duplicateResult.duplicates,
          });
        }
      }

      const company = await createCompany(parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(company);
    },
  );

  // Update company
  app.patch<{ Params: { id: string } }>(
    '/api/companies/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:update')] },
    async (request, reply) => {
      const parsed = updateCompanyBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      const updated = await updateCompany(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Company not found');
      }

      return reply.send(updated);
    },
  );

  // Delete company
  app.delete<{ Params: { id: string } }>(
    '/api/companies/:id',
    { onRequest: [app.authenticate, requirePermission('contacts:delete')] },
    async (request, reply) => {
      const deleted = await deleteCompany(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Company not found');
      }

      return reply.status(204).send();
    },
  );
}
