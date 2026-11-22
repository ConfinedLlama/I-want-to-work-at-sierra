import { isWithinDomain, normalizeCompanyName } from "../core/domain.js";
import { matchesAny } from "../text/match.js";
import type { Icp } from "./schema.js";

/**
 * Whether the ICP rules this company out. Checked by sources as early as
 * possible, and again by discovery after merging, because a company can gain
 * a domain or description from a second source that the first one lacked.
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
