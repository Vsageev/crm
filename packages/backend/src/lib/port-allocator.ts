import net from 'node:net';

/**
 * Allocates random, non-conflicting ports for agent projects.
 * Ports are drawn from [MIN_PORT, MAX_PORT] and verified to be free before returning.
 */

const MIN_PORT = 10_000;
const MAX_PORT = 59_999;
const MAX_ATTEMPTS = 50;

/** Ports currently handed out (released when agent process exits). */
const allocated = new Set<number>();

/** Well-known ports to never allocate (backend, frontend dev, postgres, redis). */
const RESERVED = new Set([3847, 5173, 5432, 6379]);

function randomPort(): number {
  return MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1));
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Allocate a random free port and mark it as in-use.
 * Returns the port number.
 */
export async function allocatePort(): Promise<number> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = randomPort();
    if (RESERVED.has(port) || allocated.has(port)) continue;
    if (await isPortFree(port)) {
      allocated.add(port);
      return port;
    }
  }
  throw new Error('port-allocator: failed to find a free port after max attempts');
}

/**
 * Release a previously-allocated port so it can be reused.
 */
export function releasePort(port: number): void {
  allocated.delete(port);
}

/** Expose for testing. */
export function allocatedPorts(): ReadonlySet<number> {
  return allocated;
}
