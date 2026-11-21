const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Out-of-range code points would make fromCodePoint throw.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Flatten the light HTML that comment APIs return into plain text. Paragraph
 * and line breaks become newlines, because the first line of a post is often
 * the only structured part of it.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<\s*(p|br|li|div)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every URL in a fragment, from href attributes first and then bare in the text. */
export function extractUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    if (match[1] !== undefined) urls.push(decodeEntities(match[1]));
  }
  const withoutTags = decodeEntities(html.replace(/<[^>]+>/g, " "));
  for (const match of withoutTags.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    urls.push(match[0].replace(/[.,;:!?]+$/, ""));
  }
  return [...new Set(urls)];
}
