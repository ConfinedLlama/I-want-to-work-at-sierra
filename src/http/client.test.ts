import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeClock } from "../core/clock.js";
import { MemoryCache } from "./cache.js";
import { HttpClient, parseRetryAfter, type HttpClientOptions } from "./client.js";
import { HostRateLimiter } from "./rate-limit.js";
import { StubFetch } from "./testing.js";

const URL_A = "https://api.example/things";
const Thing = z.object({ id: z.number() });

function setup(overrides: Partial<HttpClientOptions> = {}) {
  const stub = new StubFetch();
  const clock = new FakeClock(1_000_000);
  const client = new HttpClient({
    userAgent: "outbound-test",
    fetch: stub.fetch,
    clock,
    random: () => 0,
    ...overrides,
  });
  return { stub, clock, client };
}

describe("HttpClient", () => {
  it("returns parsed, validated json", async () => {
    const { stub, client } = setup();
    stub.on(URL_A, { body: { id: 7, extra: "ignored" } });
    const result = await client.getJson(URL_A, Thing);
    expect(result).toEqual({ ok: true, value: { id: 7 } });
  });

  it("identifies itself and asks for json", async () => {
    const { stub, client } = setup();
    stub.on(URL_A, { body: { id: 1 } });
    await client.getJson(URL_A, Thing, { headers: { "x-extra": "1" } });
    expect(stub.calls[0]?.headers).toMatchObject({
      "user-agent": "outbound-test",
      accept: "application/json",
      "x-extra": "1",
    });
  });

  it("reports a body that is not json", async () => {
    const { stub, client } = setup();
    stub.on(URL_A, { body: "<html>maintenance</html>" });
    const result = await client.getJson(URL_A, Thing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("parse");
  });

  it("reports json of the wrong shape, with the path", async () => {
    const { stub, client } = setup();
    stub.on(URL_A, { body: { id: "seven" } });
    const result = await client.getJson(URL_A, Thing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("shape");
    expect(result.error.message).toContain("at id:");
  });

  it("does not retry a 404", async () => {
    const { stub, clock, client } = setup();
    stub.on(URL_A, { status: 404 });
    const result = await client.getText(URL_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(404);
    expect(stub.calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("retries 5xx with exponential backoff and then succeeds", async () => {
    const { stub, clock, client } = setup({ baseDelayMs: 100 });
    stub.on(URL_A, [{ status: 503 }, { status: 500 }, { body: "ok" }]);
    const result = await client.getText(URL_A);
    expect(result).toEqual({ ok: true, value: "ok" });
    expect(stub.calls).toHaveLength(3);
    // random() is pinned to 0, so each wait is the lower bound: half the ceiling.
    expect(clock.sleeps).toEqual([50, 100]);
  });

  it("gives up after the configured number of retries", async () => {
    const { stub, client } = setup({ maxRetries: 1 });
    stub.on(URL_A, { status: 502 });
    const result = await client.getText(URL_A);
    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(2);
  });

  it("retries network failures", async () => {
    const { stub, client } = setup();
    stub.on(URL_A, [new Error("socket hang up"), { body: "ok" }]);
    expect(await client.getText(URL_A)).toEqual({ ok: true, value: "ok" });
  });

  it("reports a timeout as a timeout", async () => {
    const timeout = new DOMException("The operation timed out", "TimeoutError");
    const { stub, client } = setup({ maxRetries: 0, timeoutMs: 50 });
    stub.on(URL_A, timeout);
    const result = await client.getText(URL_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("timeout");
    expect(result.error.message).toContain("50ms");
  });

  it("waits as long as a 429 asks it to", async () => {
    const { stub, clock, client } = setup();
    stub.on(URL_A, [{ status: 429, headers: { "retry-after": "7" } }, { body: "ok" }]);
    await client.getText(URL_A);
    expect(clock.sleeps).toEqual([7_000]);
  });

  it("caps an unreasonable Retry-After", async () => {
    const { stub, clock, client } = setup({ maxDelayMs: 2_000 });
    stub.on(URL_A, [{ status: 429, headers: { "retry-after": "3600" } }, { body: "ok" }]);
    await client.getText(URL_A);
    expect(clock.sleeps).toEqual([2_000]);
  });

  it("rejects something that is not a url without calling fetch", async () => {
    const { stub, client } = setup();
    const result = await client.getText("not a url");
    expect(result.ok).toBe(false);
    expect(stub.calls).toHaveLength(0);
  });

  it("serves a repeat request from cache when asked to", async () => {
    const clock = new FakeClock(1_000_000);
    const { stub, client } = setup({ clock, cache: new MemoryCache(clock) });
    stub.on(URL_A, [{ body: "first" }, { body: "second" }]);

    expect(await client.getText(URL_A, { cacheTtlMs: 60_000 })).toEqual({
      ok: true,
      value: "first",
    });
    expect(await client.getText(URL_A, { cacheTtlMs: 60_000 })).toEqual({
      ok: true,
      value: "first",
    });
    expect(stub.calls).toHaveLength(1);

    clock.advance(60_001);
    expect(await client.getText(URL_A, { cacheTtlMs: 60_000 })).toEqual({
      ok: true,
      value: "second",
    });
  });

  it("does not touch the cache unless a ttl is given", async () => {
    const clock = new FakeClock(1_000_000);
    const { stub, client } = setup({ clock, cache: new MemoryCache(clock) });
    stub.on(URL_A, [{ body: "first" }, { body: "second" }]);
    await client.getText(URL_A);
    expect(await client.getText(URL_A)).toEqual({ ok: true, value: "second" });
  });

  it("never caches a failure", async () => {
    const clock = new FakeClock(1_000_000);
    const { stub, client } = setup({ clock, cache: new MemoryCache(clock), maxRetries: 0 });
    stub.on(URL_A, [{ status: 500 }, { body: "recovered" }]);
    await client.getText(URL_A, { cacheTtlMs: 60_000 });
    expect(await client.getText(URL_A, { cacheTtlMs: 60_000 })).toEqual({
      ok: true,
      value: "recovered",
    });
  });

  it("goes through the rate limiter on every attempt, retries included", async () => {
    const clock = new FakeClock(1_000_000);
    const { stub, client } = setup({
      clock,
      limiter: new HostRateLimiter(clock, 1_000),
      baseDelayMs: 100,
    });
    stub.on(URL_A, [{ status: 503 }, { body: "ok" }]);
    await client.getText(URL_A);
    // 50ms of backoff, then the limiter holds the retry for the rest of its 1s gap.
    expect(clock.sleeps).toEqual([50, 950]);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
  });

  it("reads an http date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  it("never returns a negative wait for a date in the past", () => {
    const now = Date.parse("2026-01-01T00:01:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(0);
  });

  it("ignores garbage and absence", () => {
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});
