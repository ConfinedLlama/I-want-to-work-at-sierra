import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { normalizeCompanyName, normalizeDomain } from "../core/domain.js";
import { err, ok, type Result } from "../core/result.js";
import { isExcluded } from "./exclusions.js";
import { IcpSchema, type Icp } from "./schema.js";

export class IcpError extends Error {
  override readonly name = "IcpError";
  constructor(
    message: string,
    /** One line per problem, each already prefixed with where it is in the file. */
    readonly problems: readonly string[] = [],
  ) {
    super(message);
  }
}

/** Validate an already-parsed object. Use this when the ICP does not come from a file. */
export function parseIcp(raw: unknown): Result<Icp, IcpError> {
  const parsed = IcpSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(formatIssue);
    return err(new IcpError(`ICP is not valid:\n${indent(problems)}`, problems));
  }

  const icp = canonicalize(parsed.data);
  const problems = crossFieldProblems(icp);
  if (problems.length > 0) {
    return err(new IcpError(`ICP is not valid:\n${indent(problems)}`, problems));
  }
  return ok(icp);
}

export async function loadIcp(path: string): Promise<Result<Icp, IcpError>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return err(new IcpError(`Could not read ICP file ${path}: ${reason}`));
  }

  const extension = extname(path).toLowerCase();
  let raw: unknown;
  try {
    if (extension === ".json") raw = JSON.parse(text);
    else if (extension === ".yaml" || extension === ".yml") raw = parseYaml(text);
    else
      return err(
        new IcpError(`Unsupported ICP file type "${extension}". Use .yaml, .yml or .json.`),
      );
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return err(new IcpError(`Could not parse ${path}: ${reason}`));
  }

  return parseIcp(raw);
}

/**
 * Put the profile in one canonical shape so the rest of the pipeline never has
 * to think about casing or duplicates.
 */
function canonicalize(icp: Icp): Icp {
  return {
    ...icp,
    company: {
      ...icp.company,
      industries: uniqueLower(icp.company.industries),
      keywords: uniqueLower(icp.company.keywords),
      techSignals: uniqueLower(icp.company.techSignals),
      hiringSignals: uniqueLower(icp.company.hiringSignals),
      regions: uniqueLower(icp.company.regions),
      stages: [...new Set(icp.company.stages)],
    },
    personas: icp.personas.map((persona) => ({
      ...persona,
      titleKeywords: uniqueLower(persona.titleKeywords),
      seniority: [...new Set(persona.seniority)],
    })),
    exclusions: {
      domains: unique(icp.exclusions.domains.map((domain) => normalizeDomain(domain) ?? domain)),
      companies: unique(icp.exclusions.companies.map(normalizeCompanyName)),
      keywords: uniqueLower(icp.exclusions.keywords),
    },
    seeds: icp.seeds.map((seed) => {
      const domain = seed.domain === undefined ? undefined : normalizeDomain(seed.domain);
      // Keep the raw value when it does not normalize, so the cross-field check can name it.
      return { ...seed, ...(seed.domain === undefined ? {} : { domain: domain ?? seed.domain }) };
    }),
  };
}

/** Problems zod cannot express on a single field. */
function crossFieldProblems(icp: Icp): string[] {
  const problems: string[] = [];
  const { company } = icp;

  const hasAnyCompanyCriterion =
    company.industries.length > 0 ||
    company.keywords.length > 0 ||
    company.techSignals.length > 0 ||
    company.hiringSignals.length > 0;
  if (!hasAnyCompanyCriterion && icp.seeds.length === 0) {
    problems.push(
      "company: give at least one of industries, keywords, techSignals or hiringSignals, or list seeds. Otherwise there is nothing to search for.",
    );
  }

  const personaNames = new Set<string>();
  icp.personas.forEach((persona, index) => {
    const key = persona.name.toLowerCase();
    if (personaNames.has(key))
      problems.push(`personas[${index}].name: "${persona.name}" is used twice`);
    personaNames.add(key);
  });

  icp.exclusions.domains.forEach((domain, index) => {
    if (normalizeDomain(domain) === undefined) {
      problems.push(`exclusions.domains[${index}]: "${domain}" is not a domain`);
    }
  });

  icp.seeds.forEach((seed, index) => {
    if (seed.domain !== undefined && normalizeDomain(seed.domain) === undefined) {
      problems.push(`seeds[${index}].domain: "${seed.domain}" is not a domain`);
    } else if (isExcluded(icp, seed)) {
      problems.push(`seeds[${index}]: "${seed.name}" is also ruled out by exclusions`);
    }
  });

  return problems;
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path
    .map((part, index) =>
      typeof part === "number" ? `[${part}]` : `${index === 0 ? "" : "."}${String(part)}`,
    )
    .join("");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueLower(values: readonly string[]): string[] {
  return unique(values.map((value) => value.toLowerCase()));
}

function indent(lines: readonly string[]): string {
  return lines.map((line) => `  - ${line}`).join("\n");
}
