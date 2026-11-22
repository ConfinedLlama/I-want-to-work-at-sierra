import { registrableLabel } from "../core/domain.js";
import type { CompanyRef, CompanySlugs } from "./types.js";

/**
 * Job boards and GitHub are keyed by a slug the company picked, not by domain.
 * When we were not told the slug, the best guess is the label the company
 * registered ("acme" for acme.com and for jobs.acme.co.uk), then the name
 * squashed together.
 */
export function slugCandidates(company: CompanyRef, platform: keyof CompanySlugs): string[] {
  const explicit = company.slugs?.[platform];
  // An explicit slug is trusted completely. Guessing on top of it would only
  // risk attaching some other company's data.
  if (explicit !== undefined) return [explicit];

  const candidates: string[] = [];
  const label = company.domain === undefined ? undefined : registrableLabel(company.domain);
  if (label !== undefined) candidates.push(label);

  const squashed = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (squashed !== "") candidates.push(squashed);

  return [...new Set(candidates)];
}
