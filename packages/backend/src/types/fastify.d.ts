import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      /** Legacy temporary 2FA marker; active auth rejects these tokens. */
      twoFactor?: boolean;
    };
    user: {
      sub: string;
      /** Legacy temporary 2FA marker; active auth rejects these tokens. */
      twoFactor?: boolean;
    };
  }
}
