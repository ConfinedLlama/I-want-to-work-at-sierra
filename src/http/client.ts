import type { z } from "zod";
import { systemClock, type Clock } from "../core/clock.js";
import { err, ok, type Result } from "../core/result.js";
import type { ResponseCache } from "./cache.js";
import type { HostRateLimiter } from "./rate-limit.js";

export type HttpErrorKind = "network" | "timeout" | "status" | "parse" | "shape";

export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    readonly kind: HttpErrorKind,
    readonly url: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  /** Sent on every request. Several public APIs reject requests without one. */
  readonly userAgent: string;
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
  readonly limiter?: HostRateLimiter;
  readonly cache?: ResponseCache;
  readonly timeoutMs?: number;
  /** Retries after the first attempt. 2 means up to three requests in total. */
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  /** Upper bound on any single wait, including one requested by Retry-After. */
  readonly maxDelayMs?: number;
  /** Returns a number in [0, 1). Injected so backoff jitter is testable. */
  readonly random?: () => number;
}

export interface RequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  /** Serve from cache when a copy newer than this exists. Omit to skip the cache. */
  readonly cacheTtlMs?: number;
}

interface TextResponse {
  readonly status: number;
  readonly body: string;
  readonly fromCache: boolean;
}

/**
 * The one way out to the network for every source.
 *
 * It owns the things each source would otherwise get subtly wrong on its own:
 * identifying ourselves, timing out, backing off on 429 and 5xx, respecting
 * Retry-After, staying inside per-host rate limits and caching.
 */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.clock = options.clock ?? systemClock;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.random = options.random ?? Math.random;
  }

  /** GET a URL and validate the JSON body against a schema. */
  async getJson<S extends z.ZodType>(
    url: string,
    schema: S,
    options: RequestOptions = {},
  ): Promise<Result<z.output<S>, HttpError>> {
    const response = await this.getText(url, {
      ...options,
      headers: { accept: "application/json", ...options.headers },
    });
    if (!response.ok) return response;

    let json: unknown;
    try {
      json = JSON.parse(response.value);
    } catch {
      return err(new HttpError("parse", url, `Response from ${url} was not valid JSON`));
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first === undefined ? "" : ` at ${first.path.join(".")}: ${first.message}`;
      return err(new HttpError("shape", url, `Unexpected response shape from ${url}${where}`));
    }
    return ok(parsed.data);
  }

  async getText(url: string, options: RequestOptions = {}): Promise<Result<string, HttpError>> {
    const response = await this.request(url, options);
    if (!response.ok) return response;
    return ok(response.value.body);
  }

  private async request(
    url: string,
    options: RequestOptions,
  ): Promise<Result<TextResponse, HttpError>> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return err(new HttpError("network", url, `Not a valid URL: ${url}`));
    }

    const { cache } = this.options;
    if (cache !== undefined && options.cacheTtlMs !== undefined) {
      const hit = await cache.get(url, options.cacheTtlMs);
      if (hit !== undefined) return ok({ status: hit.status, body: hit.body, fromCache: true });
    }

    let lastError = new HttpError("network", url, `Request to ${url} was never attempted`);
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.options.limiter?.acquire(host);

      const outcome = await this.attempt(url, options.headers ?? {});
      if (outcome.ok) {
        const response = outcome.value;
        if (cache !== undefined && options.cacheTtlMs !== undefined) {
          await cache.set(url, {
            status: response.status,
            body: response.body,
            fetchedAt: this.clock.now(),
          });
        }
        return ok({ ...response, fromCache: false });
      }

      lastError = outcome.error.error;
      if (!outcome.error.retryable || attempt === this.maxRetries) break;
      await this.clock.sleep(this.delayFor(attempt, outcome.error.retryAfterMs));
    }
    return err(lastError);
  }

  private async attempt(
    url: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<Result<{ status: number; body: string }, AttemptFailure>> {
    let response: Response;
    let body: string;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { "user-agent": this.options.userAgent, ...headers },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "follow",
      });
      // Reading the body is part of the request: a stalled stream should count
      // against the same timeout, which the abort signal takes care of.
      body = await response.text();
    } catch (cause) {
      const timedOut =
        cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
      const reason = cause instanceof Error ? cause.message : String(cause);
      return err({
        retryable: true,
        error: timedOut
          ? new HttpError("timeout", url, `Request to ${url} timed out after ${this.timeoutMs}ms`)
          : new HttpError("network", url, `Request to ${url} failed: ${reason}`),
      });
    }

    if (response.ok) return ok({ status: response.status, body });

    const retryable = response.status === 429 || response.status >= 500;
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.clock.now());
    return err({
      retryable,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      error: new HttpError(
        "status",
        url,
        `${url} responded with ${response.status}`,
        response.status,
      ),
    });
  }

  /** Exponential backoff with full jitter, unless the server told us how long to wait. */
  private delayFor(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, this.maxDelayMs);
    const ceiling = Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
    return Math.floor(ceiling / 2 + this.random() * (ceiling / 2));
  }
}

interface AttemptFailure {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly error: HttpError;
}

/** Retry-After is either a number of seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}
