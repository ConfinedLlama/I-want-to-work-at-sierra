import { normalizeCompanyName } from "../core/domain.js";
import type { CompanyCandidate, CompanySlugs, Signal } from "../sources/types.js";

/**
 * A company after merging everything every source said about it. This is the
 * record the rest of the pipeline (research, scoring, sequencing) works from.
 */
export interface Prospect {
  /** Stable across runs: the domain when known, otherwise a key derived from the name. */
  readonly id: string;
  readonly name: string;
  readonly domain?: string;
  readonly slugs: CompanySlugs;
  readonly description?: string;
  readonly employees?: number;
  readonly industries: readonly string[];
  readonly regions: readonly string[];
  readonly signals: readonly Signal[];
  /** Ids of the sources that contributed, in the order they first did. */
  readonly sources: readonly string[];
  /** True when the ICP named this company outright. */
  readonly seeded: boolean;
}

export interface SourcedCandidate {
  readonly source: string;
  readonly candidate: CompanyCandidate;
  readonly seeded?: boolean;
}

interface Draft {
  name: string;
  domain: string | undefined;
  nameKey: string;
  slugs: { -readonly [K in keyof CompanySlugs]: string };
  description: string | undefined;
  employees: number | undefined;
  industries: string[];
  regions: string[];
  signals: Signal[];
  sources: string[];
  seeded: boolean;
}

/**
 * Merge candidates from every source into one prospect per company.
 *
 * Two candidates are the same company when their domains are equal, or when
 * their normalized names are equal and at most one of them has a domain. Two
 * different domains under one name stay separate: there really are two
 * companies called Mercury.
 */
export function mergeCandidates(candidates: readonly SourcedCandidate[]): Prospect[] {
  const drafts: Draft[] = [];
  const byDomain = new Map<string, Draft>();
  const byName = new Map<string, Draft[]>();

  for (const { source, candidate, seeded } of candidates) {
    const nameKey = normalizeCompanyName(candidate.name);
    if (nameKey === "" && candidate.domain === undefined) continue;

    let draft = candidate.domain === undefined ? undefined : byDomain.get(candidate.domain);
    if (draft === undefined && nameKey !== "") {
      draft = (byName.get(nameKey) ?? []).find(
        (other) => other.domain === undefined || candidate.domain === undefined,
      );
    }

    if (draft === undefined) {
      draft = {
        name: candidate.name.trim(),
        domain: candidate.domain,
        nameKey,
        slugs: {},
        description: undefined,
        employees: undefined,
        industries: [],
        regions: [],
        signals: [],
        sources: [],
        seeded: false,
      };
      drafts.push(draft);
      if (nameKey !== "") byName.set(nameKey, [...(byName.get(nameKey) ?? []), draft]);
    }

    if (draft.domain === undefined && candidate.domain !== undefined) {
      draft.domain = candidate.domain;
    }
    if (draft.domain !== undefined) byDomain.set(draft.domain, draft);

    absorb(draft, source, candidate, seeded === true);
  }

  return drafts.map(finish);
}

function absorb(draft: Draft, source: string, candidate: CompanyCandidate, seeded: boolean): void {
  draft.seeded ||= seeded;
  if (!draft.sources.includes(source)) draft.sources.push(source);

  // First writer wins for slugs: earlier candidates are seeds and explicit links.
  for (const [platform, slug] of Object.entries(candidate.slugs ?? {}) as [
    keyof CompanySlugs,
    string | undefined,
  ][]) {
    if (slug !== undefined) draft.slugs[platform] ??= slug;
  }

  // The longest description is usually the one written by the company itself.
  if (
    candidate.description !== undefined &&
    candidate.description.length > (draft.description?.length ?? 0)
  ) {
    draft.description = candidate.description;
  }
  draft.employees ??= candidate.employees;
  draft.industries = union(draft.industries, candidate.industries ?? []);
  draft.regions = union(draft.regions, candidate.regions ?? []);
  draft.signals = dedupeSignals([...draft.signals, ...candidate.signals]);
}

function finish(draft: Draft): Prospect {
  return {
    id: draft.domain ?? `name:${draft.nameKey.replace(/ /g, "-")}`,
    name: draft.name,
    ...(draft.domain === undefined ? {} : { domain: draft.domain }),
    slugs: draft.slugs,
    ...(draft.description === undefined ? {} : { description: draft.description }),
    ...(draft.employees === undefined ? {} : { employees: draft.employees }),
    industries: draft.industries,
    regions: draft.regions,
    signals: draft.signals,
    sources: draft.sources,
    seeded: draft.seeded,
  };
}

export function dedupeSignals(signals: readonly Signal[]): Signal[] {
  const seen = new Set<string>();
  const unique: Signal[] = [];
  for (const signal of signals) {
    const key = `${signal.source}\u0000${signal.url}\u0000${signal.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(signal);
  }
  return unique;
}

/** Add signals found after the merge, such as from enrichment. */
export function withSignals(
  prospect: Prospect,
  source: string,
  signals: readonly Signal[],
): Prospect {
  if (signals.length === 0) return prospect;
  return {
    ...prospect,
    signals: dedupeSignals([...prospect.signals, ...signals]),
    sources: prospect.sources.includes(source) ? prospect.sources : [...prospect.sources, source],
  };
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set(a.map((value) => value.toLowerCase()));
  const merged = [...a];
  for (const value of b) {
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    merged.push(value);
  }
  return merged;
}
