import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../core/clock.js";
import { DiskCache, MemoryCache, type ResponseCache } from "./cache.js";

describe("response caches", () => {
  let dir: string;
  let clock: FakeClock;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "http-cache-"));
    clock = new FakeClock(10_000);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const suites: [string, () => ResponseCache][] = [
    ["memory", () => new MemoryCache(clock)],
    ["disk", () => new DiskCache(join(dir, "nested", "cache"), clock)],
  ];

  describe.each(suites)("%s", (_name, make) => {
    it("misses on a key it has never seen", async () => {
      expect(await make().get("https://a.example/x", 1_000)).toBeUndefined();
    });

    it("returns what was stored while it is fresh", async () => {
      const cache = make();
      await cache.set("k", { status: 200, body: "hello", fetchedAt: clock.now() });
      clock.advance(1_000);
      expect(await cache.get("k", 1_000)).toEqual({
        status: 200,
        body: "hello",
        fetchedAt: 10_000,
      });
    });

    it("misses once the entry is older than the caller allows", async () => {
      const cache = make();
      await cache.set("k", { status: 200, body: "hello", fetchedAt: clock.now() });
      clock.advance(1_001);
      expect(await cache.get("k", 1_000)).toBeUndefined();
    });

    it("overwrites an existing entry", async () => {
      const cache = make();
      await cache.set("k", { status: 200, body: "old", fetchedAt: clock.now() });
      await cache.set("k", { status: 200, body: "new", fetchedAt: clock.now() });
      expect((await cache.get("k", 1_000))?.body).toBe("new");
    });
  });

  it("treats a corrupt file as a miss", async () => {
    const cache = new DiskCache(dir, clock);
    await cache.set("k", { status: 200, body: "hello", fetchedAt: clock.now() });
    const [file] = await readdir(dir);
    await writeFile(join(dir, file ?? ""), "{ not json");
    expect(await cache.get("k", 1_000)).toBeUndefined();
  });

  it("treats a file of the wrong shape as a miss", async () => {
    const cache = new DiskCache(dir, clock);
    await cache.set("k", { status: 200, body: "hello", fetchedAt: clock.now() });
    const [file] = await readdir(dir);
    await writeFile(join(dir, file ?? ""), JSON.stringify({ status: "200" }));
    expect(await cache.get("k", 1_000)).toBeUndefined();
  });

  it("drops a write it cannot make instead of failing", async () => {
    await writeFile(join(dir, "taken"), "a file where the cache directory should go");
    const cache = new DiskCache(join(dir, "taken", "cache"), clock);
    await expect(
      cache.set("k", { status: 200, body: "hello", fetchedAt: clock.now() }),
    ).resolves.toBeUndefined();
    expect(await cache.get("k", 1_000)).toBeUndefined();
  });

  it("keeps overlapping writes of one key whole", async () => {
    const cache = new DiskCache(dir, clock);
    const bodies = Array.from({ length: 20 }, (_, index) => "x".repeat(1 + index * 500));
    await Promise.all(
      bodies.map((body) => cache.set("k", { status: 200, body, fetchedAt: clock.now() })),
    );
    expect(bodies).toContain((await cache.get("k", 1_000))?.body);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("leaves no temp files behind", async () => {
    const cache = new DiskCache(dir, clock);
    await cache.set("k", { status: 200, body: "hello", fetchedAt: clock.now() });
    expect((await readdir(dir)).every((name) => name.endsWith(".json"))).toBe(true);
  });
});
