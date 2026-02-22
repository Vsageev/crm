import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await buildApp();
  const protocol = env.TLS_CERT_PATH ? 'https' : 'http';

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Server listening on ${protocol}://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
