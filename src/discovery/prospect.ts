import { normalizeCompanyName, registrableDomain } from "../core/domain.js";
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
 * their normalized names are equal and both domains sit under one registered
 * domain, as jobs.acme.com and careers.acme.com do. Two unrelated domains
 * under one name stay separate: there really are two companies called Mercury.
 * A candidate with no domain joins the company of its name when there is
 * exactly one, and stays on its own when nothing says which of several it is.
 *
 * Who is who is settled from all candidates at once, so it does not depend on
 * the order sources report in. The fields are then filled in arrival order,
 * which does carry meaning: seeds come first and what they say wins.
 */
export function mergeCandidates(candidates: readonly SourcedCandidate[]): Prospect[] {
  const companyOf = groupByCompany(candidates.map(({ candidate }) => candidate));
  const drafts = new Map<string, Draft>();

  for (const { source, candidate, seeded } of candidates) {
    const company = companyOf(candidate);
    if (company === undefined) continue;

    let draft = drafts.get(company);
    if (draft === undefined) {
      draft = {
        name: candidate.name.trim(),
        domain: undefined,
        nameKey: normalizeCompanyName(candidate.name),
        slugs: {},
        description: undefined,
        employees: undefined,
        industries: [],
        regions: [],
        signals: [],
        sources: [],
        seeded: false,
      };
      drafts.set(company, draft);
    }

    if (candidate.domain !== undefined) {
      draft.domain =
        draft.domain === undefined ? candidate.domain : frontDoor(draft.domain, candidate.domain);
    }

    absorb(draft, source, candidate, seeded === true);
  }

  return [...drafts.values()].map(finish);
}

/**
 * Work out which candidates are the same company. Returns a lookup from a
 * candidate to a key shared by everything in its group, or to nothing when
 * the candidate has neither a name nor a domain to go by.
 */
function groupByCompany(
  candidates: readonly CompanyCandidate[],
): (candidate: CompanyCandidate) => string | undefined {
  // A link between two keys means "same company". Following the links up from
  // any key ends at the one key that stands for its whole group.
  const linkedTo = new Map<string, string>();
  const groupOf = (key: string): string => {
    let top = key;
    for (let next = linkedTo.get(top); next !== undefined; next = linkedTo.get(top)) top = next;
    return top;
  };

  const atDomain = (domain: string): string => `domain ${domain}`;
  const namedUnder = (nameKey: string, home: string): string => `name ${nameKey} under ${home}`;

  /** The registered domains each name was seen under. */
  const homes = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const nameKey = normalizeCompanyName(candidate.name);
    if (candidate.domain === undefined || nameKey === "") continue;

    const home = registrableDomain(candidate.domain);
    const site = groupOf(atDomain(candidate.domain));
    const name = groupOf(namedUnder(nameKey, home));
    if (site !== name) linkedTo.set(site, name);
    homes.set(nameKey, (homes.get(nameKey) ?? new Set<string>()).add(home));
  }

  return (candidate) => {
    if (candidate.domain !== undefined) return groupOf(atDomain(candidate.domain));

    const nameKey = normalizeCompanyName(candidate.name);
    if (nameKey === "") return undefined;
    const seenUnder = [...(homes.get(nameKey) ?? [])];
    const home = seenUnder.length === 1 ? seenUnder[0] : undefined;
    return home === undefined ? `name ${nameKey}` : groupOf(namedUnder(nameKey, home));
  };
}

/**
 * Which of two addresses of one company the prospect keeps. The shorter one,
 * so a parent always wins over its subdomains, with the alphabet settling a
 * tie. Picking by a fixed rule and not by who spoke first keeps the prospect's
 * id the same whatever order candidates arrive in.
 */
function frontDoor(a: string, b: string): string {
  return a.length < b.length || (a.length === b.length && a < b) ? a : b;
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
