import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
    await mkdir(this.dir, { recursive: true });
    const path = this.pathFor(key);
    // Write then rename so a crash mid-write cannot leave a half file behind.
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(response));
    await rename(temp, path);
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
