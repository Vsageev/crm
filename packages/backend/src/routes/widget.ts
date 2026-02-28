import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_PATH = path.resolve(__dirname, '../../../widget/dist/ws-form.js');
const CHAT_WIDGET_PATH = path.resolve(__dirname, '../../../widget/dist/ws-chat.js');

let widgetCache: string | null = null;
let chatWidgetCache: string | null = null;

export async function widgetRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Serve the embeddable form widget JS file
  typedApp.get(
    '/widget.js',
    {
      schema: {
        tags: ['Widget'],
        summary: 'Serve the embeddable form widget JS file',
      },
    },
    async (_request, reply) => {
      if (!widgetCache) {
        try {
          widgetCache = fs.readFileSync(WIDGET_PATH, 'utf-8');
        } catch {
          return reply.status(404).send('Widget not built. Run: pnpm --filter widget build');
        }
      }

      return reply
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .header('Access-Control-Allow-Origin', '*')
        .send(widgetCache);
    },
  );

  // Serve the embeddable chat widget JS file
  typedApp.get(
    '/chat-widget.js',
    {
      schema: {
        tags: ['Widget'],
        summary: 'Serve the embeddable chat widget JS file',
      },
    },
    async (_request, reply) => {
      if (!chatWidgetCache) {
        try {
          chatWidgetCache = fs.readFileSync(CHAT_WIDGET_PATH, 'utf-8');
        } catch {
          return reply.status(404).send('Chat widget not built. Run: pnpm --filter widget build');
        }
      }

      return reply
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=3600')
        .header('Access-Control-Allow-Origin', '*')
        .send(chatWidgetCache);
    },
  );
}
