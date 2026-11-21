import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const stringList = z.array(nonEmpty).default([]);

export const COMPANY_STAGES = [
  "pre-seed",
  "seed",
  "series-a",
  "series-b",
  "growth",
  "public",
] as const;
export const SENIORITIES = [
  "ic",
  "lead",
  "manager",
  "director",
  "vp",
  "c-level",
  "founder",
] as const;

const employeeRange = z
  .strictObject({
    min: z.number().int().nonnegative().default(0),
    max: z.number().int().positive().optional(),
  })
  .refine((range) => range.max === undefined || range.max >= range.min, {
    message: "max must be greater than or equal to min",
    path: ["max"],
  });

const company = z.strictObject({
  /** Free-text industries, matched loosely against source tags and descriptions. */
  industries: stringList,
  /** Words that should appear in how the company describes itself. */
  keywords: stringList,
  /** Technologies whose presence suggests the company has the problem we solve. */
  techSignals: stringList,
  /** Job title fragments. A company hiring for these is likely investing in the area. */
  hiringSignals: stringList,
  employees: employeeRange.optional(),
  stages: z.array(z.enum(COMPANY_STAGES)).default([]),
  regions: stringList,
});

const persona = z.strictObject({
  name: nonEmpty,
  seniority: z.array(z.enum(SENIORITIES)).min(1),
  /** Fragments matched against a person's title, case-insensitively. */
  titleKeywords: z.array(nonEmpty).min(1),
  /** What this person is likely struggling with. Feeds research and messaging later. */
  painPoints: stringList,
});

const offer = z.strictObject({
  product: nonEmpty,
  oneLiner: nonEmpty,
  valueProps: z.array(nonEmpty).min(1),
  proofPoints: stringList,
});

const seedCompany = z.strictObject({
  name: nonEmpty,
  domain: nonEmpty.optional(),
  /** Board or org slugs, for when they do not match the domain. */
  github: nonEmpty.optional(),
  greenhouse: nonEmpty.optional(),
  lever: nonEmpty.optional(),
  ashby: nonEmpty.optional(),
});

const exclusions = z.strictObject({
  domains: stringList,
  companies: stringList,
  keywords: stringList,
});

export const IcpSchema = z.strictObject({
  name: nonEmpty,
  description: nonEmpty.optional(),
  offer,
  company,
  personas: z.array(persona).min(1),
  exclusions: exclusions.default({ domains: [], companies: [], keywords: [] }),
  /** Companies we already know we want. They skip discovery and go straight to enrichment. */
  seeds: z.array(seedCompany).default([]),
});

export type Icp = z.infer<typeof IcpSchema>;
export type IcpInput = z.input<typeof IcpSchema>;
export type Persona = Icp["personas"][number];
export type SeedCompany = Icp["seeds"][number];
