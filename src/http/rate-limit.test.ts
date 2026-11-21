import { describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock.js";
import { HostRateLimiter } from "./rate-limit.js";

describe("HostRateLimiter", () => {
  it("lets the first request through immediately", async () => {
    const clock = new FakeClock(1_000);
    const limiter = new HostRateLimiter(clock, 500);
    await limiter.acquire("a.example");
    expect(clock.sleeps).toEqual([]);
  });

  it("spaces out requests to the same host", async () => {
    const clock = new FakeClock(1_000);
    const limiter = new HostRateLimiter(clock, 500);
    await Promise.all([
      limiter.acquire("a.example"),
      limiter.acquire("a.example"),
      limiter.acquire("a.example"),
    ]);
    expect(clock.sleeps).toEqual([500, 500]);
    expect(clock.now()).toBe(2_000);
  });

  it("does not make one host wait for another", async () => {
    const clock = new FakeClock(1_000);
    const limiter = new HostRateLimiter(clock, 500);
    await limiter.acquire("a.example");
    await limiter.acquire("b.example");
    expect(clock.sleeps).toEqual([]);
  });

  it("uses a host-specific interval when one is configured", async () => {
    const clock = new FakeClock(1_000);
    const limiter = new HostRateLimiter(clock, 500, { "slow.example": 5_000 });
    await limiter.acquire("slow.example");
    await limiter.acquire("slow.example");
    expect(clock.sleeps).toEqual([5_000]);
  });

  it("does not wait when enough time has already passed", async () => {
    const clock = new FakeClock(1_000);
    const limiter = new HostRateLimiter(clock, 500);
    await limiter.acquire("a.example");
    clock.advance(800);
    await limiter.acquire("a.example");
    expect(clock.sleeps).toEqual([]);
  });
});
