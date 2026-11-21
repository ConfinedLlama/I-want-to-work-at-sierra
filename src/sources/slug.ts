import type { CompanyRef, CompanySlugs } from "./types.js";

/** Second-level labels that are part of a country suffix, as in .co.uk or .com.au. */
const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/**
 * Job boards and GitHub are keyed by a slug the company picked, not by domain.
 * When we were not told the slug, the best guess is the first label of the
 * domain ("acme" for acme.com), then the name squashed together.
 */
export function slugCandidates(company: CompanyRef, platform: keyof CompanySlugs): string[] {
  const explicit = company.slugs?.[platform];
  // An explicit slug is trusted completely. Guessing on top of it would only
  // risk attaching some other company's data.
  if (explicit !== undefined) return [explicit];

  const candidates: string[] = [];
  if (company.domain !== undefined) {
    const labels = company.domain.split(".");
    // For jobs.acme.co.uk the useful label is "acme", not "jobs" or "co". Take
    // the label just before the public suffix.
    const suffixLength =
      labels.length >= 3 &&
      (labels.at(-1)?.length ?? 0) === 2 &&
      SECOND_LEVEL_SUFFIXES.has(labels.at(-2) ?? "")
        ? 2
        : 1;
    const label = labels.at(-(suffixLength + 1));
    if (label !== undefined && label !== "") candidates.push(label);
  }

  const squashed = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (squashed !== "") candidates.push(squashed);

  return [...new Set(candidates)];
}
