import { FakeClock } from "../core/clock.js";
import { unwrap } from "../core/result.js";
import { HttpClient } from "../http/client.js";
import { StubFetch } from "../http/testing.js";
import { parseIcp } from "../icp/load.js";
import type { Icp, IcpInput } from "../icp/schema.js";
import { minimalIcp } from "../icp/testing.js";
import type { SourceContext } from "./types.js";

/** A source context wired to a stub fetch, with retries off so failures are immediate. */
export function testContext(): { stub: StubFetch; clock: FakeClock; context: SourceContext } {
  const stub = new StubFetch();
  const clock = new FakeClock(Date.parse("2026-06-15T12:00:00Z"));
  const http = new HttpClient({
    userAgent: "outbound-test",
    fetch: stub.fetch,
    clock,
    maxRetries: 0,
  });
  return { stub, clock, context: { http, clock } };
}

export function testIcp(overrides: Partial<IcpInput> = {}): Icp {
  return unwrap(parseIcp(minimalIcp(overrides)));
}
