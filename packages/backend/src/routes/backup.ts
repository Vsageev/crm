import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBackup, listBackups, pruneOldBackups } from '../services/backup.js';

export async function backupRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/api/backups',
    { schema: { tags: ['Backup'], summary: 'Create a backup' } },
    async (_req, reply) => {
      try {
        const result = await createBackup();
        return reply.status(201).send({
          message: 'Backup created successfully',
          backup: {
            filename: result.filename,
            sizeBytes: result.sizeBytes,
            createdAt: result.createdAt.toISOString(),
          },
        });
      } catch (err) {
        app.log.error(err, 'Manual backup failed');
        return reply.status(500).send({ message: 'Backup failed' });
      }
    },
  );

  typedApp.get(
    '/api/backups',
    { schema: { tags: ['Backup'], summary: 'List all backups' } },
    async (_req, reply) => {
      try {
        const backups = await listBackups();
        return reply.send({
          count: backups.length,
          backups: backups.map((b) => ({
            filename: b.filename,
            sizeBytes: b.sizeBytes,
            createdAt: b.createdAt.toISOString(),
          })),
        });
      } catch (err) {
        app.log.error(err, 'Failed to list backups');
        return reply.status(500).send({ message: 'Failed to list backups' });
      }
    },
  );

  typedApp.delete(
    '/api/backups/prune',
    { schema: { tags: ['Backup'], summary: 'Prune old backups' } },
    async (_req, reply) => {
      try {
        const removed = await pruneOldBackups();
        return reply.send({
          message: `Pruned ${removed.length} old backup(s)`,
          removed,
        });
      } catch (err) {
        app.log.error(err, 'Failed to prune backups');
        return reply.status(500).send({ message: 'Failed to prune backups' });
      }
    },
  );
}
