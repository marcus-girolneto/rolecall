import net from 'node:net';

export class NetworkBlockedError extends Error {
  override name = 'NetworkBlockedError';
}

/**
 * Blocks outbound TCP and fetch while active, except to `allowHosts`. Unix-socket and IPC connections pass.
 * Returns a function that restores the original behaviour.
 */
export function blockNetwork(allowHosts: string[] = []): () => void {
  const allowed = new Set(allowHosts.map((h) => h.toLowerCase()));
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;

  const check = (host: string | undefined) => {
    const h = (host ?? 'localhost').toLowerCase();
    if (!allowed.has(h)) {
      throw new NetworkBlockedError(
        `Network access to "${h}" blocked by Rolecall (replay mode). Add it to target.allowHosts or run with --mode record.`,
      );
    }
  };

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    check(url.hostname);
    return originalFetch(input, init);
  }) as typeof fetch;

  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    // net.connect and http.request call socket.connect with one normalised array: [options, callback].
    const normalised = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
    const [first, second] = normalised;
    if (typeof first === 'object' && first !== null) {
      const opts = first as { path?: string; host?: string };
      if (!opts.path) check(opts.host); // `path` = Unix socket or Windows pipe: local, allowed
    } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
      check(typeof second === 'string' ? second : undefined);
    } else if (typeof first === 'string') {
      // socket.connect(path) for a Unix socket: local, allowed
    }
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  return () => {
    globalThis.fetch = originalFetch;
    net.Socket.prototype.connect = originalConnect;
  };
}
