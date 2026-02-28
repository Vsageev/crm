import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      twoFactor?: boolean;
    };
    user: {
      sub: string;
      twoFactor?: boolean;
    };
  }
}
