import type { Clock } from "../core/clock.js";
import type { Result } from "../core/result.js";
import type { HttpClient } from "../http/client.js";
import type { Icp } from "../icp/schema.js";

/**
 * What kind of thing a signal tells us about a company.
 *
 * - description: how the company describes itself
 * - hiring: an open role, which says where money is going
 * - tech: evidence of a technology in use
 * - activity: something they shipped or worked on recently
 */
export type SignalKind = "description" | "hiring" | "tech" | "activity";

/** One observed fact about a company. Every signal can be traced back to a URL. */
export interface Signal {
  readonly kind: SignalKind;
  /** Id of the source that produced it. */
  readonly source: string;
  /** One line a person could read in a list. */
  readonly summary: string;
  readonly url: string;
  /** ISO timestamp of when the underlying thing happened, when the source says. */
  readonly observedAt?: string;
  /** ICP terms this signal matched, if that is why it was kept. */
  readonly matched?: readonly string[];
}

/** Where to find a company on the platforms we query by slug rather than by domain. */
export interface CompanySlugs {
  readonly github?: string;
  readonly greenhouse?: string;
  readonly lever?: string;
  readonly ashby?: string;
}

/** The minimum needed to go and look a company up. */
export interface CompanyRef {
  readonly name: string;
  readonly domain?: string;
  readonly slugs?: CompanySlugs;
}

/** A company as one source sees it. Discovery merges these across sources. */
export interface CompanyCandidate extends CompanyRef {
  readonly description?: string;
  readonly employees?: number;
  readonly industries?: readonly string[];
  readonly regions?: readonly string[];
  readonly signals: readonly Signal[];
}

export class SourceError extends Error {
  override readonly name = "SourceError";
  constructor(
    readonly source: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`[${source}] ${message}`, options);
  }
}

export interface SourceContext {
  readonly http: HttpClient;
  readonly clock: Clock;
}

/** Shown by `outbound sources` and used to explain what a run will touch. */
export interface SourceInfo {
  readonly id: string;
  readonly name: string;
  readonly homepage: string;
  /** How the source is allowed to be used, in the provider's own terms. */
  readonly rateLimit: string;
  readonly gives: readonly SignalKind[];
  /** Environment variable that raises limits, when there is one. Never required. */
  readonly optionalEnv?: string;
}

/** Finds companies that might fit an ICP, starting from nothing. */
export interface DiscoverySource {
  readonly info: SourceInfo;
  discover(icp: Icp, context: SourceContext): Promise<Result<CompanyCandidate[], SourceError>>;
}

/** Looks up more about a company we already know by name. */
export interface EnrichmentSource {
  readonly info: SourceInfo;
  enrich(
    company: CompanyRef,
    icp: Icp,
    context: SourceContext,
  ): Promise<Result<Signal[], SourceError>>;
}
