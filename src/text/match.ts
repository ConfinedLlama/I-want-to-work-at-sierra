/**
 * Find which of `terms` appear in `text` as whole words or phrases.
 *
 * Substring matching is not good enough here: "voice" must not match
 * "invoice", and "ai" must not match "maintain". A term matches only when it
 * is not glued to a letter or digit on either side.
 */
export function matchTerms(text: string, terms: readonly string[]): string[] {
  if (text === "" || terms.length === 0) return [];
  const haystack = text.toLowerCase();
  return terms.filter((term) => termPattern(term).test(haystack));
}

export function matchesAny(text: string, terms: readonly string[]): boolean {
  return matchTerms(text, terms).length > 0;
}

const patterns = new Map<string, RegExp>();

function termPattern(term: string): RegExp {
  const key = term.toLowerCase().trim();
  let pattern = patterns.get(key);
  if (pattern === undefined) {
    // Any run of whitespace or hyphens in the term matches any such run in the
    // text, so "contact center" also finds "contact-center".
    const body = key
      .split(/[\s-]+/)
      .filter((part) => part !== "")
      .map(escapeRegExp)
      .join("[\\s-]+");
    pattern = body === "" ? /(?!)/ : new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
    patterns.set(key, pattern);
  }
  return pattern;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
