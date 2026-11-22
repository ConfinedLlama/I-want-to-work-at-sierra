import { isWithinDomain, normalizeCompanyName } from "../core/domain.js";
import { matchesAny } from "../text/match.js";
import type { Icp } from "./schema.js";

/**
 * Whether the ICP rules this company out, going by what the caller knows about
 * it. Sources check as early as possible and discovery checks the merged
 * record again.
 *
 * Neither check sees across sources. A source that drops a candidate drops its
 * evidence too, so the same company can still come through another source
 * that has no domain or description for it. ROADMAP.md lists that gap.
 */
export function isExcluded(
  icp: Icp,
  company: { name: string; domain?: string | undefined; description?: string | undefined },
): boolean {
  const { exclusions } = icp;
  if (company.domain !== undefined) {
    const domain = company.domain;
    // Excluding acme.com also excludes jobs.acme.com.
    if (exclusions.domains.some((blocked) => isWithinDomain(domain, blocked))) return true;
  }
  if (exclusions.companies.includes(normalizeCompanyName(company.name))) return true;
  if (company.description !== undefined && matchesAny(company.description, exclusions.keywords)) {
    return true;
  }
  return false;
}
