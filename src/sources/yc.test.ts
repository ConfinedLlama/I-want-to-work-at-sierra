import { describe, expect, it } from "vitest";
import { unwrap } from "../core/result.js";
import { testContext, testIcp } from "./testing.js";
import { ycSource } from "./yc.js";

const URL = "https://yc-oss.github.io/api/companies/all.json";

function company(overrides: Record<string, unknown> = {}) {
  return {
    name: "Helpline",
    website: "https://www.helpline.example",
    one_liner: "Customer support for online stores",
    long_description: "We run the contact center so you do not have to.",
    team_size: 250,
    status: "Active",
    batch: "Winter 2022",
    all_locations: "San Francisco, CA, USA",
    industries: ["B2B", "Retail"],
    regions: ["United States of America"],
    tags: ["E-commerce", "SaaS"],
    isHiring: true,
    url: "https://www.ycombinator.com/companies/helpline",
    ...overrides,
  };
}

const icp = testIcp({
  company: {
    keywords: ["customer support"],
    industries: ["e-commerce"],
    techSignals: ["twilio"],
    employees: { min: 100, max: 1000 },
    regions: ["united states"],
  },
  exclusions: { keywords: ["agency"] },
});

async function discover(companies: unknown[], forIcp = icp) {
  const { stub, context } = testContext();
  stub.on(URL, { body: companies });
  return unwrap(await ycSource.discover(forIcp, context));
}

describe("ycSource", () => {
  it("turns a matching company into a candidate with cited signals", async () => {
    const [candidate, ...rest] = await discover([company()]);
    expect(rest).toEqual([]);
    expect(candidate).toMatchObject({
      name: "Helpline",
      domain: "helpline.example",
      employees: 250,
      industries: ["B2B", "Retail"],
    });
    expect(candidate?.signals).toEqual([
      {
        kind: "description",
        source: "yc",
        summary: "Customer support for online stores (YC Winter 2022)",
        url: "https://www.ycombinator.com/companies/helpline",
        matched: ["customer support", "e-commerce"],
      },
      {
        kind: "hiring",
        source: "yc",
        summary: "Marked as hiring on YC",
        url: "https://www.ycombinator.com/companies/helpline",
      },
    ]);
  });

  it("skips companies that are not active", async () => {
    expect(
      await discover([company({ status: "Inactive" }), company({ status: "Acquired" })]),
    ).toEqual([]);
  });

  it("skips companies that match nothing", async () => {
    expect(
      await discover([
        company({ one_liner: "Rockets", long_description: "To the moon.", tags: [] }),
      ]),
    ).toEqual([]);
  });

  it("does not let a broad industry tag qualify a company when keywords were given", async () => {
    const found = await discover([
      company({ one_liner: "Shoes", long_description: "We sell shoes.", tags: ["E-commerce"] }),
    ]);
    expect(found).toEqual([]);
  });

  it("falls back to industries when the ICP has no keywords", async () => {
    const industryOnly = testIcp({ company: { industries: ["e-commerce"] } });
    const found = await discover(
      [company({ one_liner: "Shoes", long_description: "We sell shoes.", tags: ["E-commerce"] })],
      industryOnly,
    );
    expect(found.map((candidate) => candidate.name)).toEqual(["Helpline"]);
  });

  it("qualifies on a tech signal alone", async () => {
    const found = await discover([
      company({ one_liner: "Scheduling", long_description: "Built on Twilio.", tags: [] }),
    ]);
    expect(found[0]?.signals[0]?.matched).toEqual(["twilio"]);
  });

  it("filters by team size but keeps companies whose size is unknown", async () => {
    const found = await discover([
      company({ name: "Tiny", team_size: 5 }),
      company({ name: "Huge", team_size: 50_000 }),
      company({ name: "Unknown", team_size: null }),
      company({ name: "Zero", team_size: 0 }),
    ]);
    expect(found.map((candidate) => candidate.name)).toEqual(["Unknown", "Zero"]);
    expect(found[0]).not.toHaveProperty("employees");
  });

  it("filters by region but keeps companies with no location", async () => {
    const found = await discover([
      company({ name: "Berlin", all_locations: "Berlin, Germany", regions: ["Germany", "Europe"] }),
      company({ name: "Nowhere", all_locations: "", regions: [] }),
    ]);
    expect(found.map((candidate) => candidate.name)).toEqual(["Nowhere"]);
  });

  it("drops excluded companies", async () => {
    const found = await discover([
      company({ long_description: "A customer support agency for hire." }),
    ]);
    expect(found).toEqual([]);
  });

  it("copes with missing optional fields and a bad website", async () => {
    const found = await discover([
      { name: "Bare", status: "Active", one_liner: "customer support", website: "n/a" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toHaveProperty("domain");
    expect(found[0]?.signals).toHaveLength(1);
  });

  it("returns a source error when the directory cannot be fetched", async () => {
    const { stub, context } = testContext();
    stub.on(URL, { status: 500 });
    const result = await ycSource.discover(icp, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("[yc] could not fetch the directory");
    expect(result.error.source).toBe("yc");
  });

  it("asks again after a 404 from the directory instead of remembering it", async () => {
    const { stub, context } = testContext({ cache: true });
    stub.on(URL, [{ status: 404 }, { body: [company()] }]);
    expect((await ycSource.discover(icp, context)).ok).toBe(false);
    expect(unwrap(await ycSource.discover(icp, context))).toHaveLength(1);
  });
});
