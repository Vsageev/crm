import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  listQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  getPublicQuiz,
  startSession,
  updateSessionAnswers,
  completeSession,
  listQuizSessions,
  getQuizStats,
} from '../services/quizzes.js';

// ── Zod schemas ─────────────────────────────────────────────────────────

const leadCaptureFieldSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(255),
  isRequired: z.boolean(),
  contactFieldMapping: z.string().max(100).nullable().optional(),
});

const answerOptionSchema = z.object({
  text: z.string().min(1).max(1000),
  imageUrl: z.string().max(2048).nullable().optional(),
  points: z.number().int().optional(),
  jumpToQuestionId: z.string().nullable().optional(),
  jumpToEnd: z.boolean().optional(),
  position: z.number().int().min(0),
});

const questionSchema = z.object({
  text: z.string().min(1).max(2000),
  description: z.string().max(2000).nullable().optional(),
  questionType: z.enum([
    'single_choice',
    'multiple_choice',
    'image_choice',
    'text_input',
    'number_input',
    'rating',
  ]),
  position: z.number().int().min(0),
  isRequired: z.boolean().optional(),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  ratingScale: z.number().int().min(2).max(10).nullable().optional(),
  options: z.array(answerOptionSchema).optional(),
});

const resultSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  imageUrl: z.string().max(2048).nullable().optional(),
  ctaText: z.string().max(200).nullable().optional(),
  ctaUrl: z.string().max(2048).nullable().optional(),
  minScore: z.number().nullable().optional(),
  maxScore: z.number().nullable().optional(),
  isDefault: z.boolean().optional(),
  position: z.number().int().min(0),
});

const createQuizBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'active', 'inactive', 'archived']).optional(),
  startHeadline: z.string().max(500).optional(),
  startDescription: z.string().max(2000).nullable().optional(),
  startButtonText: z.string().max(100).optional(),
  startImageUrl: z.string().max(2048).nullable().optional(),
  leadCapturePosition: z.enum(['before_results', 'after_results']).optional(),
  leadCaptureHeading: z.string().max(500).optional(),
  leadCaptureFields: z.array(leadCaptureFieldSchema).optional(),
  pipelineId: z.string().nullable().optional(),
  pipelineStageId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  accentColor: z.string().max(50).nullable().optional(),
  questions: z.array(questionSchema).optional(),
  results: z.array(resultSchema).optional(),
});

const updateQuizBody = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['draft', 'active', 'inactive', 'archived']).optional(),
  startHeadline: z.string().max(500).optional(),
  startDescription: z.string().max(2000).nullable().optional(),
  startButtonText: z.string().max(100).optional(),
  startImageUrl: z.string().max(2048).nullable().optional(),
  leadCapturePosition: z.enum(['before_results', 'after_results']).optional(),
  leadCaptureHeading: z.string().max(500).optional(),
  leadCaptureFields: z.array(leadCaptureFieldSchema).optional(),
  pipelineId: z.string().nullable().optional(),
  pipelineStageId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  accentColor: z.string().max(50).nullable().optional(),
  questions: z.array(questionSchema).optional(),
  results: z.array(resultSchema).optional(),
});

const startSessionBody = z.object({
  referrerUrl: z.string().max(2048).optional(),
  utmSource: z.string().max(255).optional(),
  utmMedium: z.string().max(255).optional(),
  utmCampaign: z.string().max(255).optional(),
  utmTerm: z.string().max(255).optional(),
  utmContent: z.string().max(255).optional(),
});

const updateSessionBody = z.object({
  answers: z.record(z.string(), z.unknown()),
});

const completeSessionBody = z.object({
  leadData: z.record(z.string(), z.string()).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
});

const listQuizzesQuery = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const listSessionsQuery = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const publicQuizQuery = z.object({
  preview: z.string().optional(),
});

// ── Routes ──────────────────────────────────────────────────────────────

export async function quizRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // ── Authenticated admin routes ──────────────────────────────────────

  // LIST quizzes
  typedApp.get(
    '/api/quizzes',
    { onRequest: [app.authenticate, requirePermission('forms:read')], schema: { tags: ['Quizzes'], summary: 'List quizzes', querystring: listQuizzesQuery } },
    async (request, reply) => {
      const { entries, total } = await listQuizzes({
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

  // GET single quiz
  typedApp.get(
    '/api/quizzes/:id',
    { onRequest: [app.authenticate, requirePermission('forms:read')], schema: { tags: ['Quizzes'], summary: 'Get single quiz', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const quiz = await getQuizById(request.params.id);
      if (!quiz) return reply.notFound('Quiz not found');
      return reply.send(quiz);
    },
  );

  // CREATE quiz
  typedApp.post(
    '/api/quizzes',
    { onRequest: [app.authenticate, requirePermission('forms:create')], schema: { tags: ['Quizzes'], summary: 'Create quiz', body: createQuizBody } },
    async (request, reply) => {
      const quiz = await createQuiz(
        { ...request.body, createdBy: request.user.sub } as any,
        {
          userId: request.user.sub,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );
      return reply.status(201).send(quiz);
    },
  );

  // UPDATE quiz
  typedApp.patch(
    '/api/quizzes/:id',
    { onRequest: [app.authenticate, requirePermission('forms:update')], schema: { tags: ['Quizzes'], summary: 'Update quiz', params: z.object({ id: z.uuid() }), body: updateQuizBody } },
    async (request, reply) => {
      const updated = await updateQuiz(request.params.id, request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      if (!updated) return reply.notFound('Quiz not found');
      return reply.send(updated);
    },
  );

  // DELETE quiz
  typedApp.delete(
    '/api/quizzes/:id',
    { onRequest: [app.authenticate, requirePermission('forms:delete')], schema: { tags: ['Quizzes'], summary: 'Delete quiz', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const deleted = await deleteQuiz(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      if (!deleted) return reply.notFound('Quiz not found');
      return reply.status(204).send();
    },
  );

  // LIST sessions for a quiz
  typedApp.get(
    '/api/quizzes/:id/sessions',
    { onRequest: [app.authenticate, requirePermission('forms:read')], schema: { tags: ['Quizzes'], summary: 'List sessions for a quiz', params: z.object({ id: z.uuid() }), querystring: listSessionsQuery } },
    async (request, reply) => {
      const { entries, total } = await listQuizSessions({
        quizId: request.params.id,
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

  // GET quiz stats
  typedApp.get(
    '/api/quizzes/:id/stats',
    { onRequest: [app.authenticate, requirePermission('forms:read')], schema: { tags: ['Quizzes'], summary: 'Get quiz stats', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const stats = await getQuizStats(request.params.id);
      return reply.send(stats);
    },
  );

  // ── Public routes (no auth) ─────────────────────────────────────────

  // GET public quiz config
  typedApp.get(
    '/api/public/quiz/:id',
    { schema: { tags: ['Quizzes'], summary: 'Get public quiz config', params: z.object({ id: z.uuid() }), querystring: publicQuizQuery } },
    async (request, reply) => {
      const preview = request.query.preview === '1' || request.query.preview === 'true';
      const quiz = await getPublicQuiz(request.params.id, preview);
      if (!quiz) return reply.notFound('Quiz not found');
      return reply.send(quiz);
    },
  );

  // START a quiz session
  typedApp.post(
    '/api/public/quiz/:id/sessions',
    { schema: { tags: ['Quizzes'], summary: 'Start a quiz session', params: z.object({ id: z.uuid() }), body: startSessionBody } },
    async (request, reply) => {
      const quiz = await getPublicQuiz(request.params.id);
      if (!quiz) return reply.notFound('Quiz not found');

      const session = await startSession({
        quizId: request.params.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        ...request.body,
      });
      return reply.status(201).send(session);
    },
  );

  // UPDATE session answers
  typedApp.patch(
    '/api/public/quiz/:id/sessions/:sessionId',
    { schema: { tags: ['Quizzes'], summary: 'Update session answers', params: z.object({ id: z.uuid(), sessionId: z.uuid() }), body: updateSessionBody } },
    async (request, reply) => {
      const updated = await updateSessionAnswers(request.params.sessionId, request.body);
      if (!updated) return reply.notFound('Session not found');
      return reply.send(updated);
    },
  );

  // COMPLETE session
  typedApp.post(
    '/api/public/quiz/:id/sessions/:sessionId/complete',
    { schema: { tags: ['Quizzes'], summary: 'Complete a quiz session', params: z.object({ id: z.uuid(), sessionId: z.uuid() }), body: completeSessionBody } },
    async (request, reply) => {
      const completed = await completeSession(
        request.params.id,
        request.params.sessionId,
        request.body,
      );
      if (!completed) return reply.notFound('Session not found');
      return reply.send(completed);
    },
  );
}
