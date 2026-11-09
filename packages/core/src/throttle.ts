import { UnaryCall, type RpcInterceptor } from '@protobuf-ts/runtime-rpc';

/**
 * Tatum's free plan allows 3 requests a second and answers bursts with HTTP 429. This interceptor spaces unary calls
 * at least `gapMs` apart across the whole process and retries a 429 (UNAVAILABLE) up to three times with backoff.
 */
export function rateLimit(gapMs = 400): RpcInterceptor {
  let next = 0;
  const slot = async () => {
    const at = Math.max(Date.now(), next);
    next = at + gapMs;
    if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
  };
  return {
    interceptUnary(call, method, input, options) {
      const run = (async () => {
        for (let attempt = 0; ; attempt++) {
          await slot();
          const c = call(method, input, options);
          try {
            await c.response;
            return c;
          } catch (e) {
            if (attempt < 3 && /429/.test(String((e as Error)?.message ?? e))) {
              await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
              continue;
            }
            throw e;
          }
        }
      })();
      return new UnaryCall(method, options.meta ?? {}, input, run.then((c) => c.headers), run.then((c) => c.response), run.then((c) => c.status), run.then((c) => c.trailers));
    },
  };
}
