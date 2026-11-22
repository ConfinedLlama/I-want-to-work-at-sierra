import { z } from "zod";
import { normalizeCompanyName, normalizeDomain, registrableLabel } from "../core/domain.js";
import { err, ok, type Result } from "../core/result.js";
import { isExcluded } from "../icp/exclusions.js";
import type { Icp } from "../icp/schema.js";
import { extractUrls, htmlToText } from "../text/html.js";
import { matchTerms } from "../text/match.js";
import { truncate } from "../text/truncate.js";
import {
  SourceError,
  type CompanyCandidate,
  type CompanySlugs,
  type DiscoverySource,
  type SourceContext,
  type SourceInfo,
} from "./types.js";

const API = "https://hn.algolia.com/api/v1";
const ONE_HOUR_MS = 60 * 60 * 1000;

/** Each term is one search request, so a long ICP does not turn into a burst. */
const MAX_TERMS = 8;

const Stories = z.object({
  hits: z.array(z.object({ objectID: z.string(), title: z.string().nullish() })),
});

const Comments = z.object({
  hits: z.array(
    z.object({
      objectID: z.string(),
      comment_text: z.string().nullish(),
      created_at: z.string().nullish(),
      parent_id: z.number().nullish(),
    }),
  ),
});
type Comment = z.infer<typeof Comments>["hits"][number];

const info: SourceInfo = {
  id: "hackernews",
  name: "Hacker News: Who is hiring?",
  homepage: "https://hn.algolia.com/api",
  rateLimit: `10,000 requests per hour per IP. Uses at most ${MAX_TERMS + 1} per run.`,
  gives: ["hiring", "description"],
};

/**
 * The monthly "Who is hiring?" thread. Companies post there in their own
 * words, usually as "Company | Role | Location | ..." followed by what they
 * are building, which makes it one of the few places where hiring intent and a
 * self-description arrive together.
 */
export const hackerNewsSource: DiscoverySource = {
  info,

  async discover(
    icp: Icp,
    context: SourceContext,
  ): Promise<Result<CompanyCandidate[], SourceError>> {
    const terms = [...new Set([...icp.company.hiringSignals, ...icp.company.keywords])];
    if (terms.length === 0) return ok([]);

    const stories = await context.http.getJson(
      `${API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=10`,
      Stories,
      { cacheTtlMs: ONE_HOUR_MS },
    );
    if (!stories.ok) {
      return err(
        new SourceError(info.id, "could not list hiring threads", { cause: stories.error }),
      );
    }
    // The same account also posts "Who wants to be hired?" and "Freelancer?" threads.
    const thread = stories.value.hits.find((hit) => /who is hiring\?/i.test(hit.title ?? ""));
    if (thread === undefined) return ok([]);

    const comments = new Map<string, Comment>();
    let failures = 0;
    let lastError: Error | undefined;
    const searched = terms.slice(0, MAX_TERMS);
    for (const term of searched) {
      const query = encodeURIComponent(`"${term}"`);
      const page = await context.http.getJson(
        `${API}/search?tags=comment,story_${thread.objectID}&query=${query}&hitsPerPage=100`,
        Comments,
        { cacheTtlMs: ONE_HOUR_MS },
      );
      if (!page.ok) {
        failures += 1;
        lastError = page.error;
        continue;
      }
      for (const hit of page.value.hits) comments.set(hit.objectID, hit);
    }
    // One failed search loses some results. All of them failing is an outage.
    if (failures === searched.length) {
      return err(new SourceError(info.id, "every comment search failed", { cause: lastError }));
    }

    const candidates: CompanyCandidate[] = [];
    for (const comment of comments.values()) {
      const candidate = toCandidate(comment, Number(thread.objectID), icp, terms);
      if (candidate !== undefined) candidates.push(candidate);
    }
    return ok(candidates);
  },
};

function toCandidate(
  comment: Comment,
  threadId: number,
  icp: Icp,
  terms: readonly string[],
): CompanyCandidate | undefined {
  // Replies are people asking questions or pitching themselves, not job posts.
  if (comment.parent_id !== threadId) return undefined;
  const html = comment.comment_text ?? "";
  const text = htmlToText(html);
  const [header = "", ...rest] = text.split("\n");

  const name = companyName(header);
  if (name === undefined) return undefined;

  // The search API stems and tolerates typos. Re-check with our own matcher so
  // a hit for "voices" or "invoice" does not count as "voice".
  const matched = matchTerms(text, terms);
  if (matched.length === 0) return undefined;

  const { domain, slugs, sites } = classifyLinks(extractUrls(html), name);
  const description = rest.join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
  if (isExcluded(icp, { name, description: text })) return undefined;
  // An excluded domain rules the post out wherever it is linked. The company's
  // own site is not always the link that ends up as its domain.
  if (sites.some((site) => isExcluded(icp, { name, domain: site }))) return undefined;

  return {
    name,
    ...(domain === undefined ? {} : { domain }),
    ...(Object.keys(slugs).length === 0 ? {} : { slugs }),
    ...(description === "" ? {} : { description }),
    signals: [
      {
        kind: "hiring",
        source: info.id,
        summary: `Who is hiring: ${truncate(header, 140)}`,
        url: `https://news.ycombinator.com/item?id=${comment.objectID}`,
        ...(comment.created_at == null ? {} : { observedAt: comment.created_at }),
        matched,
      },
    ],
  };
}

/**
 * Pull the company name out of a "Company | Role | Location" header. Posts
 * that do not follow the convention are skipped: guessing a name from free
 * text produces companies called "We" and "Hi".
 */
export function companyName(header: string): string | undefined {
  if (!header.includes("|")) return undefined;
  const name = (header.split("|")[0] ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s:,-]+$/, "")
    .trim();
  if (name.length < 2 || name.length > 60) return undefined;
  if (!/[a-z0-9]/i.test(name)) return undefined;
  if (ANONYMOUS.test(name)) return undefined;
  return name;
}

/**
 * Some posts hide who is hiring: "Stealth Startup | Engineer | Remote". There
 * is no company to research there, and merging by name would fold every
 * stealth post into one imaginary prospect.
 */
const ANONYMOUS =
  /^(an?\s+)?((early|seed|late|growth)[\s-]stage|stealth([\s-]mode)?|well[\s-]funded|yc[\s-]backed|venture[\s-]backed|confidential|undisclosed|ai|new)?\s*(startup|company|stealth|confidential|undisclosed)$/i;

/** Hosts that appear in job posts but are never the company's own site. */
const NOT_A_COMPANY_SITE = [
  "linkedin.com",
  "github.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "google.com",
  "notion.site",
  "notion.so",
  "ycombinator.com",
  "workable.com",
  "bamboohr.com",
  "workday.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "rippling.com",
  "gusto.com",
  "wellfound.com",
  "angel.co",
  "calendly.com",
  "medium.com",
  "substack.com",
  "apple.com",
  "wikipedia.org",
  "arxiv.org",
  "techcrunch.com",
  "bit.ly",
  "goo.gl",
  "tinyurl.com",
  "t.co",
  "lnkd.in",
  "forms.gle",
  "typeform.com",
  "airtable.com",
  "cal.com",
  "gem.com",
];

const BOARD_HOSTS: Readonly<Record<string, keyof CompanySlugs>> = {
  "boards.greenhouse.io": "greenhouse",
  "job-boards.greenhouse.io": "greenhouse",
  "jobs.lever.co": "lever",
  "jobs.ashbyhq.com": "ashby",
};

/** A shared stretch shorter than this proves nothing: "ai" and "go" open and close many names. */
const MIN_NAME_OVERLAP = 3;

const NOT_NAMED = 0;
const RESEMBLES_NAME = 1;
const IS_NAME = 2;

/**
 * How strongly a domain reads as the company's own, going by the label its
 * owner registered. The label has to line up with whole words of the name: be
 * the name ("acme" for Acme), be its leading words ("scale" for Scale AI), or
 * wrap all of it ("usepylon" for Pylon). An overlap anywhere else is chance,
 * as "bit" is in Bitwarden.
 *
 * Posts also link to forms, press and career pages hosted by someone else, and
 * a domain is what companies are merged on, so one of those taken as the
 * domain would fold every company that links to it into a single prospect.
 */
function nameMatch(domain: string, company: string): number {
  const label = registrableLabel(domain);
  const words = normalizeCompanyName(company).split(" ");
  const name = words.join("");
  if (label === undefined || name === "") return NOT_NAMED;
  if (label === name) return IS_NAME;

  const leadingWords = words.map((_, index) => words.slice(0, index + 1).join(""));
  const wrapsName = label.startsWith(name) || label.endsWith(name);
  const shared = leadingWords.includes(label) ? label : wrapsName ? name : "";
  return shared.length >= MIN_NAME_OVERLAP ? RESEMBLES_NAME : NOT_NAMED;
}

/**
 * Sort the links in a post into "this is their site" and "this is their job
 * board". A board link is as useful as a domain: it gives us the exact slug to
 * query later, with no guessing.
 *
 * `sites` is every linked site that could be the company's, whether or not it
 * is named for it.
 */
export function classifyLinks(
  urls: readonly string[],
  company: string,
): {
  domain: string | undefined;
  slugs: CompanySlugs;
  sites: readonly string[];
} {
  let domain: string | undefined;
  let best = NOT_NAMED;
  const slugs: { -readonly [K in keyof CompanySlugs]: string } = {};
  const sites: string[] = [];

  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    const platform = BOARD_HOSTS[host];
    if (platform !== undefined) {
      const slug = parsed.pathname.split("/").find((part) => part !== "");
      if (slug !== undefined) slugs[platform] ??= safeDecode(slug).toLowerCase();
      continue;
    }
    if (
      host.endsWith("greenhouse.io") ||
      host.endsWith("lever.co") ||
      host.endsWith("ashbyhq.com")
    ) {
      continue;
    }
    if (NOT_A_COMPANY_SITE.some((other) => host === other || host.endsWith(`.${other}`))) continue;

    const site = normalizeDomain(host);
    if (site === undefined) continue;
    sites.push(site);

    // The first link wins among equals, but a site named exactly for the
    // company beats an earlier one that only resembles the name.
    const match = nameMatch(site, company);
    if (match > best) {
      domain = site;
      best = match;
    }
  }
  return { domain, slugs, sites };
}

/** decodeURIComponent throws on a stray "%". A slug with one is used as written. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
