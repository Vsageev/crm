import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { store } from '../db/index.js';
import type { NovofonAccount, VoximplantAccount } from '../db/types.js';

interface TelephonyProvider {
  id: string;
  provider: 'novofon' | 'voximplant';
  name: string;
}

export async function telephonyRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // List all active telephony providers
  typedApp.get(
    '/api/telephony/providers',
    { onRequest: [app.authenticate], schema: { tags: ['Telephony'], summary: 'List all active telephony providers' } },
    async (_request, reply) => {
      const providers: TelephonyProvider[] = [];

      const novofonAccounts = store.getAll('novofonAccounts') as unknown as NovofonAccount[];
      for (const acc of novofonAccounts) {
        if (acc.status === 'active') {
          providers.push({
            id: acc.id,
            provider: 'novofon',
            name: acc.accountName || `Novofon (${acc.apiKey.slice(0, 6)}...)`,
          });
        }
      }

      const voximplantAccounts = store.getAll('voximplantAccounts') as unknown as VoximplantAccount[];
      for (const acc of voximplantAccounts) {
        if (acc.status === 'active') {
          const providerId = acc.id || acc.accountId;
          if (!providerId) continue;
          providers.push({
            id: providerId,
            provider: 'voximplant',
            name: acc.accountName || `Voximplant (${acc.accountId})`,
          });
        }
      }

      return reply.send({ providers });
    },
  );
}
