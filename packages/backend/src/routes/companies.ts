import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List companies
  typedApp.get(
    '/api/companies',
    {
      onRequest: [app.authenticate, requirePermission('contacts:read')],
      schema: {
        tags: ['Companies'],
        summary: 'List companies',
        querystring: z.object({
          ownerId: z.string().optional(),
          industry: z.string().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { entries, total } = await listCompanies({
        ownerId: request.query.ownerId,
        industry: request.query.industry,
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

  // Check for duplicate companies
  typedApp.post(
    '/api/companies/check-duplicates',
    {
      onRequest: [app.authenticate, requirePermission('contacts:read')],
      schema: {
        tags: ['Companies'],
        summary: 'Check for duplicate companies',
        body: duplicateCheckBody,
      },
    },
    async (request, reply) => {
      const result = await findCompanyDuplicates(request.body);
      return reply.send(result);
    },
  );

  // Get single company
  typedApp.get(
    '/api/companies/:id',
    {
      onRequest: [app.authenticate, requirePermission('contacts:read')],
      schema: {
        tags: ['Companies'],
        summary: 'Get a single company by ID',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (request, reply) => {
      const company = await getCompanyById(request.params.id);
      if (!company) {
        return reply.notFound('Company not found');
      }
      return reply.send(company);
    },
  );

  // Create company
  typedApp.post(
    '/api/companies',
    {
      onRequest: [app.authenticate, requirePermission('contacts:create')],
      schema: {
        tags: ['Companies'],
        summary: 'Create a new company',
        querystring: z.object({
          skipDuplicateCheck: z.string().optional(),
        }),
        body: createCompanyBody,
      },
    },
    async (request, reply) => {
      if (request.query.skipDuplicateCheck !== 'true') {
        const duplicateResult = await findCompanyDuplicates(request.body);
        if (duplicateResult.hasDuplicates) {
          return reply.status(409).send({
            error: 'Potential duplicates found',
            duplicates: duplicateResult.duplicates,
          });
        }
      }

      const company = await createCompany(request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(company);
    },
  );

  // Update company
  typedApp.patch(
    '/api/companies/:id',
    {
      onRequest: [app.authenticate, requirePermission('contacts:update')],
      schema: {
        tags: ['Companies'],
        summary: 'Update an existing company',
        params: z.object({ id: z.uuid() }),
        body: updateCompanyBody,
      },
    },
    async (request, reply) => {
      const updated = await updateCompany(request.params.id, request.body, {
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
  typedApp.delete(
    '/api/companies/:id',
    {
      onRequest: [app.authenticate, requirePermission('contacts:delete')],
      schema: {
        tags: ['Companies'],
        summary: 'Delete a company',
        params: z.object({ id: z.uuid() }),
      },
    },
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
