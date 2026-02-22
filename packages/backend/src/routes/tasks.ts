import type { FastifyInstance } from 'fastify';
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

export async function taskRoutes(app: FastifyInstance) {
  // List tasks
  app.get<{
    Querystring: {
      assigneeId?: string;
      contactId?: string;
      dealId?: string;
      status?: string;
      priority?: string;
      type?: string;
      overdue?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/api/tasks',
    { onRequest: [app.authenticate, requirePermission('tasks:read')] },
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

  // Get single task
  app.get<{ Params: { id: string } }>(
    '/api/tasks/:id',
    { onRequest: [app.authenticate, requirePermission('tasks:read')] },
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
  app.post(
    '/api/tasks',
    { onRequest: [app.authenticate, requirePermission('tasks:create')] },
    async (request, reply) => {
      const parsed = createTaskBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

      // Agents can only create tasks assigned to themselves
      const data = isAgent(request)
        ? { ...parsed.data, assigneeId: request.user.sub }
        : parsed.data;

      const task = await createTask(data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send(task);
    },
  );

  // Update task
  app.patch<{ Params: { id: string } }>(
    '/api/tasks/:id',
    { onRequest: [app.authenticate, requirePermission('tasks:update')] },
    async (request, reply) => {
      const parsed = updateTaskBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(z.prettifyError(parsed.error));
      }

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
        if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== request.user.sub) {
          return reply.forbidden('Agents cannot reassign tasks');
        }
      }

      const updated = await updateTask(request.params.id, parsed.data, {
        userId: request.user.sub,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!updated) {
        return reply.notFound('Task not found');
      }

      // Emit automation trigger when task is completed
      if (parsed.data.status === 'completed') {
        eventBus.emit('task_completed', {
          taskId: updated.id,
          task: updated as unknown as Record<string, unknown>,
        });
      }

      return reply.send(updated);
    },
  );

  // Delete task
  app.delete<{ Params: { id: string } }>(
    '/api/tasks/:id',
    { onRequest: [app.authenticate, requirePermission('tasks:delete')] },
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
