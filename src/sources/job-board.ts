import type { z } from "zod";
import { err, ok, type Result } from "../core/result.js";
import type { Icp } from "../icp/schema.js";
import { matchTerms } from "../text/match.js";
import { slugCandidates } from "./slug.js";
import {
  SourceError,
  type CompanyRef,
  type CompanySlugs,
  type EnrichmentSource,
  type Signal,
  type SourceContext,
  type SourceInfo,
} from "./types.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/** How many individual roles to report per company. The rest are only counted. */
const MAX_ROLE_SIGNALS = 8;

/** A posting reduced to what every board has in common. */
export interface Posting {
  readonly title: string;
  readonly url: string;
  readonly team?: string | undefined;
  readonly location?: string | undefined;
  readonly postedAt?: string | undefined;
}

export interface JobBoardDefinition<S extends z.ZodType> {
  readonly info: SourceInfo;
  readonly platform: keyof CompanySlugs;
  /** Public page for a board, used as the citation for the summary signal. */
  boardUrl(slug: string): string;
  apiUrl(slug: string): string;
  readonly schema: S;
  postings(response: z.output<S>): Posting[];
}

/**
 * Greenhouse, Lever and Ashby all expose the same thing in slightly different
 * JSON: every open role for a board slug. This turns one definition of the
 * differences into an enrichment source.
 *
 * Open roles are the most honest signal a company publishes about where it is
 * spending. We report the roles that match the ICP's hiring terms, plus one
 * summary line so a quiet board is still a recorded fact.
 */
export function jobBoardSource<S extends z.ZodType>(
  definition: JobBoardDefinition<S>,
): EnrichmentSource {
  const { info } = definition;

  return {
    info,

    async enrich(
      company: CompanyRef,
      icp: Icp,
      context: SourceContext,
    ): Promise<Result<Signal[], SourceError>> {
      for (const slug of slugCandidates(company, definition.platform)) {
        const response = await context.http.getJson(definition.apiUrl(slug), definition.schema, {
          cacheTtlMs: SIX_HOURS_MS,
        });

        if (!response.ok) {
          // No board under this slug is the normal case, not a failure.
          if (response.error.status === 404) continue;
          return err(
            new SourceError(info.id, `could not read the board for "${slug}"`, {
              cause: response.error,
            }),
          );
        }

        const postings = definition.postings(response.value);
        return ok(toSignals(postings, icp, info.id, definition.boardUrl(slug)));
      }
      return ok([]);
    },
  };
}

function toSignals(
  postings: readonly Posting[],
  icp: Icp,
  source: string,
  boardUrl: string,
): Signal[] {
  if (postings.length === 0) return [];

  const matching = postings
    .map((posting) => ({
      posting,
      matched: matchTerms(`${posting.title} ${posting.team ?? ""}`, icp.company.hiringSignals),
    }))
    .filter(({ matched }) => matched.length > 0)
    // Most specific first, then newest. Undated postings sort last.
    .sort(
      (a, b) =>
        b.matched.length - a.matched.length ||
        (b.posting.postedAt ?? "").localeCompare(a.posting.postedAt ?? ""),
    );

  const roles = matching.length === 1 ? "role" : "roles";
  const summary: Signal = {
    kind: "hiring",
    source,
    summary:
      matching.length === 0
        ? `${postings.length} open ${postings.length === 1 ? "role" : "roles"}, none matching the ICP`
        : `${postings.length} open, ${matching.length} matching ${roles}`,
    url: boardUrl,
  };

  const details = matching.slice(0, MAX_ROLE_SIGNALS).map(({ posting, matched }): Signal => {
    const where = posting.location === undefined ? "" : ` (${posting.location})`;
    return {
      kind: "hiring",
      source,
      summary: `Hiring: ${posting.title.trim()}${where}`,
      url: posting.url,
      ...(posting.postedAt === undefined ? {} : { observedAt: posting.postedAt }),
      matched,
    };
  });

  return [summary, ...details];
}

/** Boards report dates in several formats. Normalize to ISO or drop it. */
export function toIso(value: string | number | null | undefined): string | undefined {
  if (value == null) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
