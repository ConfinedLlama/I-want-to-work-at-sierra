/**
 * Companies show up under many spellings of the same address:
 * "https://www.Acme.com/careers", "acme.com", "ACME.COM.". We key everything
 * on the bare host so those all collapse to one company. A subdomain is kept:
 * registrableDomain is what drops it.
 */
export function normalizeDomain(input: string): string | undefined {
  let value = input.trim().toLowerCase();
  if (value === "") return undefined;

  // A scheme has to be present for URL to parse a bare host.
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;

  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return undefined;
  }

  host = host.replace(/\.$/, "").replace(/^www\./, "");
  // Needs at least one dot and a plausible TLD, otherwise it was not a domain.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) return undefined;
  return host;
}

/** "Acme, Inc." and "acme" should compare equal when we have no domain to go on. */
export function normalizeCompanyName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|pbc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whether `domain` is `parent` or sits under it: jobs.acme.com is within acme.com. */
export function isWithinDomain(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`);
}

/** Second-level labels that are part of a country suffix, as in .co.uk or .com.au. */
const SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** How many trailing labels belong to the registry: two in acme.co.uk, one in acme.com. */
function suffixLength(labels: readonly string[]): number {
  return labels.length >= 3 &&
    (labels.at(-1)?.length ?? 0) === 2 &&
    SECOND_LEVEL_SUFFIXES.has(labels.at(-2) ?? "")
    ? 2
    : 1;
}

/**
 * The one label of a domain its owner chose: "acme" for acme.com, for
 * jobs.acme.co.uk and for acme.com.au. Everything to its left is a page of the
 * same site and everything to its right belongs to the registry.
 */
export function registrableLabel(domain: string): string | undefined {
  const labels = domain.split(".");
  const label = labels.at(-(suffixLength(labels) + 1));
  return label === undefined || label === "" ? undefined : label;
}

/** The domain a company registered, with any subdomain dropped: acme.co.uk for jobs.acme.co.uk. */
export function registrableDomain(domain: string): string {
  const labels = domain.split(".");
  return labels.slice(-(suffixLength(labels) + 1)).join(".");
}
