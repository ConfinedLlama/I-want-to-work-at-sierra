import { describe, expect, it } from "vitest";
import type { CompanyCandidate, Signal } from "../sources/types.js";
import { dedupeSignals, mergeCandidates, withSignals } from "./prospect.js";

function signal(
  source: string,
  summary: string,
  url = `https://${source}.example/${summary}`,
): Signal {
  return { kind: "hiring", source, summary, url };
}

function from(source: string, candidate: Partial<CompanyCandidate> & { name: string }) {
  return { source, candidate: { signals: [], ...candidate } };
}

describe("mergeCandidates", () => {
  it("merges candidates that share a domain, whatever they are called", () => {
    const [prospect, ...rest] = mergeCandidates([
      from("yc", {
        name: "Acme",
        domain: "acme.com",
        description: "Short.",
        employees: 120,
        industries: ["B2B"],
        signals: [signal("yc", "a")],
      }),
      from("hackernews", {
        name: "Acme Inc.",
        domain: "acme.com",
        description: "A much longer description in their own words.",
        employees: 999,
        industries: ["b2b", "Fintech"],
        slugs: { ashby: "acme" },
        signals: [signal("hackernews", "b")],
      }),
    ]);
    expect(rest).toEqual([]);
    expect(prospect).toEqual({
      id: "acme.com",
      name: "Acme",
      domain: "acme.com",
      slugs: { ashby: "acme" },
      description: "A much longer description in their own words.",
      employees: 120,
      industries: ["B2B", "Fintech"],
      regions: [],
      signals: [signal("yc", "a"), signal("hackernews", "b")],
      sources: ["yc", "hackernews"],
      seeded: false,
    });
  });

  it("merges by name when only one side has a domain, and adopts the domain", () => {
    const prospects = mergeCandidates([
      from("hackernews", { name: "Acme, Inc." }),
      from("yc", { name: "ACME", domain: "acme.com" }),
    ]);
    expect(prospects).toHaveLength(1);
    expect(prospects[0]?.id).toBe("acme.com");
    expect(prospects[0]?.sources).toEqual(["hackernews", "yc"]);
  });

  it("finds the adopted domain on later candidates", () => {
    const prospects = mergeCandidates([
      from("hackernews", { name: "Acme" }),
      from("yc", { name: "Acme", domain: "acme.com" }),
      from("other", { name: "Totally Different Name", domain: "acme.com" }),
    ]);
    expect(prospects).toHaveLength(1);
    expect(prospects[0]?.sources).toEqual(["hackernews", "yc", "other"]);
  });

  it.each([
    { order: "the parent comes first", first: "acme.com", second: "careers.acme.com" },
    { order: "the subdomain comes first", first: "careers.acme.com", second: "acme.com" },
  ])("merges a subdomain into its parent under one name when $order", ({ first, second }) => {
    const prospects = mergeCandidates([
      from("yc", { name: "Acme", domain: first }),
      from("hackernews", { name: "Acme, Inc.", domain: second }),
    ]);
    expect(prospects.map((prospect) => prospect.id)).toEqual(["acme.com"]);
    expect(prospects[0]?.sources).toEqual(["yc", "hackernews"]);
  });

  it("finds a merged subdomain again under any name", () => {
    const prospects = mergeCandidates([
      from("yc", { name: "Acme", domain: "acme.com" }),
      from("hackernews", { name: "Acme", domain: "careers.acme.com" }),
      from("other", { name: "Acme Talent Team", domain: "careers.acme.com" }),
    ]);
    expect(prospects.map((prospect) => prospect.id)).toEqual(["acme.com"]);
  });

  it.each([
    { order: ["jobs.acme.com", "careers.acme.com", "acme.com"] },
    { order: ["jobs.acme.com", "acme.com", "careers.acme.com"] },
    { order: ["careers.acme.com", "jobs.acme.com", "acme.com"] },
    { order: ["careers.acme.com", "acme.com", "jobs.acme.com"] },
    { order: ["acme.com", "jobs.acme.com", "careers.acme.com"] },
    { order: ["acme.com", "careers.acme.com", "jobs.acme.com"] },
  ])("merges one name across sibling subdomains, arriving as $order", ({ order }) => {
    const prospects = mergeCandidates(
      order.map((domain) => from("hackernews", { name: "Acme", domain })),
    );
    expect(prospects.map((prospect) => prospect.id)).toEqual(["acme.com"]);
  });

  it("gives sibling subdomains with no parent in sight one id, whichever comes first", () => {
    const ids = (domains: string[]) =>
      mergeCandidates(domains.map((domain) => from("hackernews", { name: "Acme", domain }))).map(
        (prospect) => prospect.id,
      );
    const forward = ids(["jobs.acme.com", "careers.acme.com"]);
    expect(forward).toHaveLength(1);
    expect(ids(["careers.acme.com", "jobs.acme.com"])).toEqual(forward);
  });

  it("does not take a shared country suffix for a shared domain", () => {
    const prospects = mergeCandidates([
      from("yc", { name: "Mercury", domain: "mercury.co.uk" }),
      from("hackernews", { name: "Mercury", domain: "mercurybank.co.uk" }),
    ]);
    expect(prospects.map((prospect) => prospect.id)).toEqual([
      "mercury.co.uk",
      "mercurybank.co.uk",
    ]);
  });

  it("keeps a subdomain apart when the names differ", () => {
    const prospects = mergeCandidates([
      from("yc", { name: "Storefront", domain: "storefront.com" }),
      from("hackernews", { name: "Tiny Shop", domain: "tinyshop.storefront.com" }),
    ]);
    expect(prospects.map((prospect) => prospect.id)).toEqual([
      "storefront.com",
      "tinyshop.storefront.com",
    ]);
  });

  it("keeps two companies with the same name and different domains apart", () => {
    const prospects = mergeCandidates([
      from("yc", { name: "Mercury", domain: "mercury.com" }),
      from("hackernews", { name: "Mercury", domain: "mercury.io" }),
    ]);
    expect(prospects.map((prospect) => prospect.id)).toEqual(["mercury.com", "mercury.io"]);
  });

  it("gives a name-only prospect a stable id", () => {
    expect(mergeCandidates([from("hackernews", { name: "Quiet Co, Inc." })])[0]?.id).toBe(
      "name:quiet",
    );
  });

  it("keeps the first slug seen for a platform", () => {
    const [prospect] = mergeCandidates([
      {
        ...from("seed", { name: "Acme", domain: "acme.com", slugs: { lever: "acme-hq" } }),
        seeded: true,
      },
      from("hackernews", {
        name: "Acme",
        domain: "acme.com",
        slugs: { lever: "acme", github: "acme" },
      }),
    ]);
    expect(prospect?.slugs).toEqual({ lever: "acme-hq", github: "acme" });
    expect(prospect?.seeded).toBe(true);
  });

  it("does not repeat a signal reported twice", () => {
    const [prospect] = mergeCandidates([
      from("yc", { name: "Acme", domain: "acme.com", signals: [signal("yc", "a")] }),
      from("yc", { name: "Acme", domain: "acme.com", signals: [signal("yc", "a")] }),
    ]);
    expect(prospect?.signals).toHaveLength(1);
    expect(prospect?.sources).toEqual(["yc"]);
  });

  it("skips a candidate with nothing to key on", () => {
    expect(mergeCandidates([from("x", { name: "  ,. " })])).toEqual([]);
  });
});

describe("withSignals", () => {
  const [base] = mergeCandidates([
    from("yc", { name: "Acme", domain: "acme.com", signals: [signal("yc", "a")] }),
  ]);
  if (base === undefined) throw new Error("fixture did not merge");

  it("appends new signals and records the source", () => {
    const next = withSignals(base, "github", [signal("github", "repo")]);
    expect(next.signals).toHaveLength(2);
    expect(next.sources).toEqual(["yc", "github"]);
    expect(base.signals).toHaveLength(1);
  });

  it("returns the same object when there is nothing to add", () => {
    expect(withSignals(base, "github", [])).toBe(base);
  });
});

describe("dedupeSignals", () => {
  it("treats the same summary at a different url as a different signal", () => {
    expect(
      dedupeSignals([signal("a", "x", "https://1"), signal("a", "x", "https://2")]),
    ).toHaveLength(2);
  });
});
