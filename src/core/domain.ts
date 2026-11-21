/**
 * Companies show up under many spellings of the same address:
 * "https://www.Acme.com/careers", "acme.com", "ACME.COM.". We key everything
 * on the bare registrable host so those all collapse to one company.
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
