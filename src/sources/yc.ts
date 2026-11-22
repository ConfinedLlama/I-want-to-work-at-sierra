import { z } from "zod";
import { normalizeDomain } from "../core/domain.js";
import { err, ok, type Result } from "../core/result.js";
import { isExcluded } from "../icp/exclusions.js";
import type { Icp } from "../icp/schema.js";
import { matchTerms } from "../text/match.js";
import {
  SourceError,
  type CompanyCandidate,
  type DiscoverySource,
  type SourceContext,
  type SourceInfo,
} from "./types.js";

const DIRECTORY_URL = "https://yc-oss.github.io/api/companies/all.json";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Only the fields we read. The directory has many more and adds to them over
// time, so everything that is not essential is optional and nullable.
const YcCompany = z.object({
  name: z.string(),
  website: z.string().nullish(),
  one_liner: z.string().nullish(),
  long_description: z.string().nullish(),
  team_size: z.number().nullish(),
  status: z.string().nullish(),
  batch: z.string().nullish(),
  all_locations: z.string().nullish(),
  industries: z.array(z.string()).nullish(),
  regions: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  isHiring: z.boolean().nullish(),
  url: z.string().nullish(),
});
type YcCompany = z.infer<typeof YcCompany>;

const info: SourceInfo = {
  id: "yc",
  name: "Y Combinator company directory",
  homepage: "https://github.com/yc-oss/api",
  rateLimit: "Static file refreshed daily. Fetched once and cached for a day.",
  gives: ["description", "hiring"],
};

/**
 * The YC directory, via the community-maintained static mirror. It is a single
 * file of every company, so discovery here is a local filter, not a search.
 */
export const ycSource: DiscoverySource = {
  info,

  async discover(
    icp: Icp,
    context: SourceContext,
  ): Promise<Result<CompanyCandidate[], SourceError>> {
    const response = await context.http.getJson(DIRECTORY_URL, z.array(YcCompany), {
      cacheTtlMs: ONE_DAY_MS,
    });
    if (!response.ok) {
      return err(
        new SourceError(info.id, "could not fetch the directory", { cause: response.error }),
      );
    }

    const candidates: CompanyCandidate[] = [];
    for (const company of response.value) {
      const candidate = toCandidate(company, icp);
      if (candidate !== undefined) candidates.push(candidate);
    }
    return ok(candidates);
  },
};

/** What the directory calls a company still in business. The rest are Inactive or Acquired. */
const OPERATING = new Set(["Active", "Public"]);

function toCandidate(company: YcCompany, icp: Icp): CompanyCandidate | undefined {
  if (company.status == null || !OPERATING.has(company.status)) return undefined;

  const domain = company.website == null ? undefined : normalizeDomain(company.website);
  const description = [company.one_liner, company.long_description]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ");
  const industries = company.industries ?? [];
  const tags = company.tags ?? [];

  if (isExcluded(icp, { name: company.name, domain, description })) return undefined;
  if (!sizeFits(company.team_size, icp)) return undefined;
  if (!regionFits(company, icp)) return undefined;

  const searchable = [description, ...tags].join(" ");
  const matchedKeywords = matchTerms(searchable, icp.company.keywords);
  const matchedIndustries = matchTerms(
    [...industries, ...tags].join(" ; "),
    icp.company.industries,
  );
  const matchedTech = matchTerms(searchable, icp.company.techSignals);

  // Keywords are the precise criterion. Industry tags are broad ("B2B",
  // "Consumer"), so on their own they only count when the ICP gave no keywords.
  const qualifies =
    matchedKeywords.length > 0 ||
    matchedTech.length > 0 ||
    (icp.company.keywords.length === 0 && matchedIndustries.length > 0);
  if (!qualifies) return undefined;

  const url = company.url ?? "https://www.ycombinator.com/companies";
  const matched = [...new Set([...matchedKeywords, ...matchedTech, ...matchedIndustries])];
  const batch = company.batch == null ? "" : ` (YC ${company.batch})`;
  const signals = [
    {
      kind: "description" as const,
      source: info.id,
      summary: `${company.one_liner?.trim() || description.slice(0, 140)}${batch}`,
      url,
      matched,
    },
    ...(company.isHiring === true
      ? [{ kind: "hiring" as const, source: info.id, summary: "Marked as hiring on YC", url }]
      : []),
  ];

  return {
    name: company.name,
    ...(domain === undefined ? {} : { domain }),
    ...(description === "" ? {} : { description }),
    ...(typeof company.team_size === "number" && company.team_size > 0
      ? { employees: company.team_size }
      : {}),
    industries,
    regions: company.regions ?? [],
    signals,
  };
}

/** Unknown size passes. We would rather research a company than drop it on missing data. */
function sizeFits(teamSize: number | null | undefined, icp: Icp): boolean {
  const range = icp.company.employees;
  if (range === undefined || teamSize == null || teamSize <= 0) return true;
  if (teamSize < range.min) return false;
  return range.max === undefined || teamSize <= range.max;
}

function regionFits(company: YcCompany, icp: Icp): boolean {
  if (icp.company.regions.length === 0) return true;
  // A tag such as "America / Canada" groups several places and is on most US
  // companies. It names a country the company may not be in, so it is left out.
  const places = (company.regions ?? []).filter((region) => !region.includes("/"));
  const where = [company.all_locations ?? "", ...places].join(" ; ").trim();
  if (where === "" || where === ";") return true;
  return matchTerms(where, icp.company.regions).length > 0;
}
