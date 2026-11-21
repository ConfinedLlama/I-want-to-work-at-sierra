import { z } from "zod";
import { normalizeDomain } from "../core/domain.js";
import { err, ok, type Result } from "../core/result.js";
import type { HttpError } from "../http/client.js";
import type { Icp } from "../icp/schema.js";
import { matchTerms } from "../text/match.js";
import { slugCandidates } from "./slug.js";
import {
  SourceError,
  type CompanyRef,
  type EnrichmentSource,
  type Signal,
  type SourceContext,
  type SourceInfo,
} from "./types.js";

const API = "https://api.github.com";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const RECENT_DAYS = 90;
const MAX_REPO_SIGNALS = 5;

const Org = z.object({
  login: z.string(),
  html_url: z.string(),
  blog: z.string().nullish(),
});

const Repos = z.array(
  z.object({
    name: z.string(),
    html_url: z.string(),
    description: z.string().nullish(),
    language: z.string().nullish(),
    pushed_at: z.string().nullish(),
    stargazers_count: z.number().nullish(),
    fork: z.boolean().nullish(),
    archived: z.boolean().nullish(),
    topics: z.array(z.string()).nullish(),
  }),
);
type Repo = z.infer<typeof Repos>[number];

const info: SourceInfo = {
  id: "github",
  name: "GitHub organizations",
  homepage: "https://docs.github.com/en/rest",
  rateLimit: "60 requests per hour without a token, 5,000 with one. Two requests per company.",
  gives: ["activity", "tech"],
  optionalEnv: "GITHUB_TOKEN",
};

export interface GithubSourceOptions {
  /** A token only raises the rate limit. Everything read here is public. */
  readonly token?: string | undefined;
}

/**
 * What a company's public GitHub org has been pushing to lately. For a
 * technical buyer this is the closest thing to a live answer to "what are they
 * building right now".
 */
export function createGithubSource(options: GithubSourceOptions = {}): EnrichmentSource {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(options.token === undefined || options.token === ""
      ? {}
      : { authorization: `Bearer ${options.token}` }),
  };

  return {
    info,

    async enrich(
      company: CompanyRef,
      icp: Icp,
      context: SourceContext,
    ): Promise<Result<Signal[], SourceError>> {
      const explicit = company.slugs?.github !== undefined;

      for (const slug of slugCandidates(company, "github")) {
        const org = await context.http.getJson(`${API}/orgs/${encodeURIComponent(slug)}`, Org, {
          headers,
          cacheTtlMs: SIX_HOURS_MS,
        });
        if (!org.ok) {
          if (org.error.status === 404) continue;
          return err(failure(`could not look up the org "${slug}"`, org.error));
        }
        // A guessed slug can easily be someone else's org. Only accept it when
        // the org links back to the company's own domain.
        if (!explicit && !belongsTo(org.value.blog, company.domain)) continue;

        const repos = await context.http.getJson(
          `${API}/orgs/${encodeURIComponent(org.value.login)}/repos?type=sources&sort=pushed&per_page=30`,
          Repos,
          { headers, cacheTtlMs: SIX_HOURS_MS },
        );
        if (!repos.ok) {
          return err(failure(`could not list repos for "${org.value.login}"`, repos.error));
        }
        return ok(toSignals(repos.value, org.value.html_url, icp, context.clock.now()));
      }
      return ok([]);
    },
  };
}

function failure(message: string, cause: HttpError): SourceError {
  const limited = cause.status === 403 || cause.status === 429;
  const hint = limited ? ". Rate limited: set GITHUB_TOKEN to raise the limit" : "";
  return new SourceError(info.id, `${message}${hint}`, { cause });
}

function belongsTo(blog: string | null | undefined, domain: string | undefined): boolean {
  if (domain === undefined || blog == null) return false;
  const orgDomain = normalizeDomain(blog);
  if (orgDomain === undefined) return false;
  return (
    orgDomain === domain || orgDomain.endsWith(`.${domain}`) || domain.endsWith(`.${orgDomain}`)
  );
}

function toSignals(repos: readonly Repo[], orgUrl: string, icp: Icp, nowMs: number): Signal[] {
  const cutoff = nowMs - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const recent = repos
    .filter((repo) => repo.fork !== true && repo.archived !== true)
    .filter((repo) => {
      const pushed = repo.pushed_at == null ? Number.NaN : Date.parse(repo.pushed_at);
      return !Number.isNaN(pushed) && pushed >= cutoff;
    })
    .sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
  if (recent.length === 0) return [];

  const signals: Signal[] = [];

  const languages = topLanguages(recent);
  if (languages.length > 0) {
    const repoWord = recent.length === 1 ? "repo" : "repos";
    signals.push({
      kind: "tech",
      source: info.id,
      summary: `Mostly ${languages.join(", ")} across ${recent.length} public ${repoWord} pushed in the last ${RECENT_DAYS} days`,
      url: orgUrl,
    });
  }

  const terms = [...new Set([...icp.company.techSignals, ...icp.company.keywords])];
  const described = recent.map((repo) => ({
    repo,
    matched: matchTerms(
      [repo.name, repo.description ?? "", ...(repo.topics ?? [])].join(" "),
      terms,
    ),
  }));
  // Repos that touch the ICP's terms come first, then the most recently pushed.
  described.sort((a, b) => b.matched.length - a.matched.length);

  for (const { repo, matched } of described.slice(0, MAX_REPO_SIGNALS)) {
    const about =
      repo.description == null || repo.description.trim() === ""
        ? ""
        : `: ${repo.description.trim()}`;
    const language = repo.language == null ? "" : ` [${repo.language}]`;
    signals.push({
      kind: matched.length > 0 ? "tech" : "activity",
      source: info.id,
      summary: `Active repo ${repo.name}${about}${language}`,
      url: repo.html_url,
      ...(repo.pushed_at == null ? {} : { observedAt: repo.pushed_at }),
      ...(matched.length > 0 ? { matched } : {}),
    });
  }
  return signals;
}

function topLanguages(repos: readonly Repo[]): string[] {
  const counts = new Map<string, number>();
  for (const repo of repos) {
    if (repo.language != null) counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([language]) => language);
}
