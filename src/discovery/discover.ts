import { mapConcurrent } from "../core/pool.js";
import { isExcluded } from "../icp/exclusions.js";
import type { Icp } from "../icp/schema.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { CompanyCandidate, CompanySlugs, SourceContext } from "../sources/types.js";
import { mergeCandidates, withSignals, type Prospect, type SourcedCandidate } from "./prospect.js";

export interface DiscoverOptions {
  /** Keep at most this many prospects, best first. Enrichment only runs on these. */
  readonly maxProspects?: number;
  readonly enrichConcurrency?: number;
  /**
   * After this many failures in a row an enrichment source is skipped for the
   * rest of the run. A rate-limited API should not be asked fifty more times.
   */
  readonly maxConsecutiveFailures?: number;
  readonly onEvent?: (event: DiscoveryEvent) => void;
}

export type DiscoveryEvent =
  | { readonly type: "source-finished"; readonly source: string; readonly candidates: number }
  | { readonly type: "source-failed"; readonly source: string; readonly message: string }
  | { readonly type: "source-disabled"; readonly source: string; readonly failures: number }
  | { readonly type: "merged"; readonly prospects: number; readonly kept: number }
  | { readonly type: "enriched"; readonly prospect: string; readonly signals: number };

export interface SourceFailure {
  readonly source: string;
  /** Set for enrichment failures, which are about one company. */
  readonly prospect?: string;
  readonly message: string;
}

export interface DiscoveryReport {
  readonly prospects: readonly Prospect[];
  readonly failures: readonly SourceFailure[];
  readonly stats: {
    readonly candidates: number;
    readonly merged: number;
    readonly excluded: number;
    readonly kept: number;
  };
}

/**
 * Stage one of the pipeline: from an ICP to a ranked list of companies, each
 * carrying the signals that put it there.
 *
 * A source failing never fails the run. It is recorded and the run continues
 * with whatever the other sources returned.
 */
export async function discover(
  icp: Icp,
  registry: SourceRegistry,
  context: SourceContext,
  options: DiscoverOptions = {},
): Promise<DiscoveryReport> {
  const maxProspects = options.maxProspects ?? 25;
  const emit = options.onEvent ?? (() => undefined);
  const failures: SourceFailure[] = [];

  // Seeds go in first so their explicit slugs win over anything a source guesses.
  const sourced: SourcedCandidate[] = icp.seeds.map((seed) => ({
    source: "seed",
    seeded: true,
    candidate: seedCandidate(seed),
  }));

  const found = await Promise.all(
    registry.discovery.map(async (source) => {
      const id = source.info.id;
      try {
        const result = await source.discover(icp, context);
        if (result.ok) {
          emit({ type: "source-finished", source: id, candidates: result.value.length });
          return result.value.map((candidate): SourcedCandidate => ({ source: id, candidate }));
        }
        failures.push({ source: id, message: describe(result.error) });
        emit({ type: "source-failed", source: id, message: describe(result.error) });
      } catch (cause) {
        // Sources are meant to return errors, not throw them. If one throws
        // anyway it still must not take the other sources down with it.
        failures.push({ source: id, message: `crashed: ${describe(cause)}` });
        emit({ type: "source-failed", source: id, message: `crashed: ${describe(cause)}` });
      }
      return [];
    }),
  );
  sourced.push(...found.flat());

  const merged = mergeCandidates(sourced);
  // Checked again on the merged record, which can hold more than any one
  // candidate did. It only sees what the sources let through: a candidate a
  // source dropped is gone, along with the domain or description that showed
  // why, so this does not stop the same company arriving from another source.
  const allowed = merged.filter((prospect) => prospect.seeded || !isExcluded(icp, prospect));
  const kept = [...allowed].sort(byPromise).slice(0, maxProspects);
  emit({ type: "merged", prospects: merged.length, kept: kept.length });

  const consecutiveFailures = new Map<string, number>();
  const maxFailures = options.maxConsecutiveFailures ?? 3;

  const enriched = await mapConcurrent(kept, options.enrichConcurrency ?? 4, async (initial) => {
    let prospect = initial;
    for (const source of registry.enrichment) {
      const id = source.info.id;
      if ((consecutiveFailures.get(id) ?? 0) >= maxFailures) continue;

      let message: string | undefined;
      try {
        const result = await source.enrich(prospect, icp, context);
        if (result.ok) {
          consecutiveFailures.set(id, 0);
          prospect = withSignals(prospect, id, result.value);
          continue;
        }
        message = describe(result.error);
      } catch (cause) {
        message = `crashed: ${describe(cause)}`;
      }

      failures.push({ source: id, prospect: prospect.id, message });
      const count = (consecutiveFailures.get(id) ?? 0) + 1;
      consecutiveFailures.set(id, count);
      if (count === maxFailures) emit({ type: "source-disabled", source: id, failures: count });
    }
    emit({ type: "enriched", prospect: prospect.id, signals: prospect.signals.length });
    return prospect;
  });

  return {
    prospects: [...enriched].sort(byPromise),
    failures,
    stats: {
      candidates: sourced.length,
      merged: merged.length,
      excluded: merged.length - allowed.length,
      kept: kept.length,
    },
  };
}

function seedCandidate(seed: Icp["seeds"][number]): CompanyCandidate {
  const slugs: { -readonly [K in keyof CompanySlugs]: string } = {};
  for (const platform of ["github", "greenhouse", "lever", "ashby"] as const) {
    const slug = seed[platform];
    if (slug !== undefined) slugs[platform] = slug;
  }
  return {
    name: seed.name,
    ...(seed.domain === undefined ? {} : { domain: seed.domain }),
    ...(Object.keys(slugs).length === 0 ? {} : { slugs }),
    signals: [],
  };
}

/**
 * A first-pass ordering, used to decide who is worth enriching and how to list
 * the result. It is not the fit score.
 *
 * Distinct ICP terms matched comes before the number of sources. Counting
 * sources first let a company with a busy GitHub org and a job board outrank a
 * better fit that simply has less of a public footprint.
 */
function byPromise(a: Prospect, b: Prospect): number {
  return (
    Number(b.seeded) - Number(a.seeded) ||
    matchedTerms(b) - matchedTerms(a) ||
    b.sources.length - a.sources.length ||
    b.signals.length - a.signals.length ||
    a.id.localeCompare(b.id)
  );
}

function matchedTerms(prospect: Prospect): number {
  return new Set(prospect.signals.flatMap((signal) => signal.matched ?? [])).size;
}

function describe(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = cause.cause instanceof Error ? ` (${cause.cause.message})` : "";
  return `${cause.message}${inner}`;
}
