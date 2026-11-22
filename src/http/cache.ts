import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../core/clock.js";

export interface CachedResponse {
  readonly status: number;
  readonly body: string;
  /** Epoch milliseconds when the response was fetched from the network. */
  readonly fetchedAt: number;
}

export interface ResponseCache {
  get(key: string, maxAgeMs: number): Promise<CachedResponse | undefined>;
  /** Best effort. A cache that cannot store a response drops it and never rejects. */
  set(key: string, response: CachedResponse): Promise<void>;
}

export class MemoryCache implements ResponseCache {
  private readonly entries = new Map<string, CachedResponse>();

  constructor(private readonly clock: Clock) {}

  get(key: string, maxAgeMs: number): Promise<CachedResponse | undefined> {
    const entry = this.entries.get(key);
    if (entry === undefined || this.clock.now() - entry.fetchedAt > maxAgeMs) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry);
  }

  set(key: string, response: CachedResponse): Promise<void> {
    this.entries.set(key, response);
    return Promise.resolve();
  }
}

/**
 * One JSON file per response under a directory. Rerunning discovery while
 * iterating on an ICP should not hit the same public endpoints again, both
 * because it is slow and because it is rude.
 */
export class DiskCache implements ResponseCache {
  constructor(
    private readonly dir: string,
    private readonly clock: Clock,
  ) {}

  async get(key: string, maxAgeMs: number): Promise<CachedResponse | undefined> {
    let text: string;
    try {
      text = await readFile(this.pathFor(key), "utf8");
    } catch {
      return undefined;
    }

    let entry: unknown;
    try {
      entry = JSON.parse(text);
    } catch {
      // A torn or hand-edited file is a miss, never an error.
      return undefined;
    }
    if (!isCachedResponse(entry)) return undefined;
    if (this.clock.now() - entry.fetchedAt > maxAgeMs) return undefined;
    return entry;
  }

  async set(key: string, response: CachedResponse): Promise<void> {
    const path = this.pathFor(key);
    // Write then rename so a crash mid-write cannot leave a half file behind.
    // Two requests for one URL can overlap, so every write gets a temp file of its own.
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(temp, JSON.stringify(response));
      await rename(temp, path);
    } catch {
      // A read-only directory or a full disk costs the cache, never the response.
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  private pathFor(key: string): string {
    return join(this.dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  }
}

function isCachedResponse(value: unknown): value is CachedResponse {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.status === "number" &&
    typeof entry.body === "string" &&
    typeof entry.fetchedAt === "number"
  );
}
