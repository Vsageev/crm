import type { UserRole } from 'shared';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: UserRole;
    };
    user: {
      sub: string;
      role: UserRole;
    };
  }
}
