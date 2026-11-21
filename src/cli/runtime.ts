import { join } from "node:path";
import { systemClock } from "../core/clock.js";
import { DiskCache } from "../http/cache.js";
import { HttpClient } from "../http/client.js";
import { HostRateLimiter } from "../http/rate-limit.js";
import type { SourceContext } from "../sources/types.js";

export interface RuntimeOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Off means every request goes to the network and nothing is written to disk. */
  readonly cache: boolean;
}

/** Minimum gap between requests to a host, for hosts that need more than the default. */
const HOST_INTERVALS_MS: Readonly<Record<string, number>> = {
  // 60 requests an hour unauthenticated. Spacing does not make that budget
  // bigger, but it keeps us from spending it in one burst.
  "api.github.com": 1_000,
  "hn.algolia.com": 300,
};

/** The real thing: live network, wall clock, cache under .outbound/ in the working directory. */
export function createRuntime(options: RuntimeOptions): SourceContext {
  const clock = systemClock;
  const http = new HttpClient({
    // Generic on purpose. Set OUTBOUND_USER_AGENT to identify yourself to the
    // APIs you call, which is the polite thing to do for anything beyond a trial run.
    userAgent: options.env.OUTBOUND_USER_AGENT?.trim() || "outbound-pipeline/0.1",
    clock,
    limiter: new HostRateLimiter(clock, 200, HOST_INTERVALS_MS),
    ...(options.cache
      ? { cache: new DiskCache(join(options.cwd, ".outbound", "cache"), clock) }
      : {}),
  });
  return { http, clock };
}
