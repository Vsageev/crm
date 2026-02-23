import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission, isAgent } from '../middleware/rbac.js';
import {
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
} from '../services/tasks.js';
import {
  sendTelegramNotification,
  formatTaskDueSoonNotification,
} from '../services/telegram-notifications.js';
import { createNotification } from '../services/notifications.js';
import { eventBus } from '../services/event-bus.js';

const taskStatuses = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
const taskPriorities = ['low', 'medium', 'high'] as const;
const taskTypes = ['call', 'meeting', 'email', 'follow_up', 'other'] as const;

const createTaskBody = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(taskTypes).optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: z.iso.datetime().optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
});

const updateTaskBody = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(taskTypes).optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: z.iso.datetime().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
});

const tasksQuerySchema = z.object({
  assigneeId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  overdue: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function taskRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List tasks
  typedApp.get(
    '/api/tasks',
    { onRequest: [app.authenticate, requirePermission('tasks:read')], schema: { tags: ['Tasks'], summary: 'List tasks', querystring: tasksQuerySchema } },
    async (request, reply) => {
      // Agents can only see tasks assigned to them
      const assigneeId = isAgent(request) ? request.user.sub : request.query.assigneeId;

      const { entries, total } = await listTasks({
        assigneeId,
        contactId: request.query.contactId,
        dealId: request.query.dealId,
        status: request.query.status,
        priority: request.query.priority,
        type: request.query.type,
        overdue: request.query.overdue === 'true',
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

  // Get single task
  typedApp.get(
    '/api/tasks/:id',
    { onRequest: [app.authenticate, requirePermission('tasks:read')], schema: { tags: ['Tasks'], summary: 'Get single task', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      const task = await getTaskById(request.params.id);
      if (!task) {
        return reply.notFound('Task not found');
      }
      if (isAgent(request) && task.assigneeId !== request.user.sub) {
        return reply.forbidden('Access denied');
      }
      return reply.send(task);
    },
  );

  // Create task
  typedApp.post(
    '/api/tasks',
    { onRequest: [app.authenticate, requirePermission('tasks:create')], schema: { tags: ['Tasks'], summary: 'Create task', body: createTaskBody } },
    async (request, reply) => {
      // Agents can only create tasks assigned to themselves
      const data = isAgent(request)
        ? { ...request.body, assigneeId: request.user.sub }
        : request.body;

      const task = await createTask(data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(task);
    },
  );

  // Update task
  typedApp.patch(
    '/api/tasks/:id',
    { onRequest: [app.authenticate, requirePermission('tasks:update')], schema: { tags: ['Tasks'], summary: 'Update task', params: z.object({ id: z.uuid() }), body: updateTaskBody } },
    async (request, reply) => {
      // Agents can only update tasks assigned to them
      if (isAgent(request)) {
        const task = await getTaskById(request.params.id);
        if (!task) {
          return reply.notFound('Task not found');
        }
        if (task.assigneeId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
        // Prevent agents from reassigning tasks
        if (request.body.assigneeId !== undefined && request.body.assigneeId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign tasks');
        }
      }

      const updated = await updateTask(request.params.id, request.body, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Task not found');
      }

      // Emit automation trigger when task is completed
      if (request.body.status === 'completed') {
        eventBus.emit('task_completed', {
          taskId: updated.id,
          task: updated as unknown as Record<string, unknown>,
        });
      }

      return reply.send(updated);
    },
  );

  // Delete task
  typedApp.delete(
    '/api/tasks/:id',
    { onRequest: [app.authenticate, requirePermission('tasks:delete')], schema: { tags: ['Tasks'], summary: 'Delete task', params: z.object({ id: z.uuid() }) } },
    async (request, reply) => {
      // Agents can only delete tasks assigned to them
      if (isAgent(request)) {
        const task = await getTaskById(request.params.id);
        if (!task) {
          return reply.notFound('Task not found');
        }
        if (task.assigneeId !== request.user.sub) {
          return reply.forbidden('Access denied');
        }
      }

      const deleted = await deleteTask(request.params.id, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!deleted) {
        return reply.notFound('Task not found');
      }

      return reply.status(204).send();
    },
  );
}
