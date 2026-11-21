import { describe, expect, it } from "vitest";
import { err, ok } from "../core/result.js";
import type { SourceRegistry } from "../sources/registry.js";
import { testContext, testIcp } from "../sources/testing.js";
import {
  SourceError,
  type CompanyCandidate,
  type DiscoverySource,
  type EnrichmentSource,
  type Signal,
  type SourceInfo,
} from "../sources/types.js";
import { discover, type DiscoveryEvent } from "./discover.js";

function info(id: string): SourceInfo {
  return { id, name: id, homepage: "https://example.com", rateLimit: "n/a", gives: ["hiring"] };
}

function signal(source: string, summary: string, matched: string[] = []): Signal {
  return { kind: "hiring", source, summary, url: `https://${source}.example/${summary}`, matched };
}

function discovery(id: string, candidates: CompanyCandidate[]): DiscoverySource {
  return { info: info(id), discover: () => Promise.resolve(ok(candidates)) };
}

function enrichment(
  id: string,
  enrich: EnrichmentSource["enrich"] = () => Promise.resolve(ok([signal(id, "found")])),
): EnrichmentSource {
  return { info: info(id), enrich };
}

const icp = testIcp({ exclusions: { domains: ["blocked.com"], keywords: ["agency"] } });
const { context } = testContext();

function registry(parts: Partial<SourceRegistry>): SourceRegistry {
  return { discovery: [], enrichment: [], ...parts };
}

describe("discover", () => {
  it("merges across sources, enriches and ranks by evidence", async () => {
    const report = await discover(
      icp,
      registry({
        discovery: [
          discovery("one", [
            { name: "Solo", domain: "solo.com", signals: [signal("one", "s", ["a", "b"])] },
            { name: "Both", domain: "both.com", signals: [signal("one", "b1", ["a"])] },
          ]),
          discovery("two", [
            { name: "Both Inc", domain: "both.com", signals: [signal("two", "b2")] },
          ]),
        ],
        enrichment: [enrichment("jobs")],
      }),
      context,
    );

    expect(report.prospects.map((prospect) => prospect.id)).toEqual(["both.com", "solo.com"]);
    expect(report.prospects[0]?.sources).toEqual(["one", "two", "jobs"]);
    expect(report.prospects[0]?.signals.map((s) => s.summary)).toEqual(["b1", "b2", "found"]);
    expect(report.failures).toEqual([]);
    expect(report.stats).toEqual({ candidates: 3, merged: 2, excluded: 0, kept: 2 });
  });

  it("puts seeds first and hands their slugs to enrichment", async () => {
    const seeded = testIcp({
      seeds: [{ name: "Named", domain: "named.com", lever: "named-hq" }],
    });
    const seen: unknown[] = [];
    const report = await discover(
      seeded,
      registry({
        discovery: [
          discovery("one", [
            { name: "Loud", domain: "loud.com", signals: [signal("one", "x", ["a", "b", "c"])] },
          ]),
        ],
        enrichment: [
          enrichment("jobs", (company) => {
            seen.push(company.slugs);
            return Promise.resolve(ok([]));
          }),
        ],
      }),
      context,
    );
    expect(report.prospects.map((prospect) => prospect.id)).toEqual(["named.com", "loud.com"]);
    expect(report.prospects[0]?.seeded).toBe(true);
    expect(seen[0]).toEqual({ lever: "named-hq" });
  });

  it("only enriches the prospects it keeps", async () => {
    let enriched = 0;
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      name: `Co ${index}`,
      domain: `co${index}.com`,
      signals: [signal("one", `s${index}`)],
    }));
    const report = await discover(
      icp,
      registry({
        discovery: [discovery("one", candidates)],
        enrichment: [
          enrichment("jobs", () => {
            enriched += 1;
            return Promise.resolve(ok([]));
          }),
        ],
      }),
      context,
      { maxProspects: 3 },
    );
    expect(report.prospects).toHaveLength(3);
    expect(enriched).toBe(3);
    expect(report.stats).toMatchObject({ merged: 10, kept: 3 });
  });

  it("applies exclusions after merging, when a second source supplies the domain", async () => {
    const report = await discover(
      icp,
      registry({
        discovery: [
          discovery("one", [{ name: "Blocked", signals: [signal("one", "x")] }]),
          discovery("two", [{ name: "Blocked", domain: "blocked.com", signals: [] }]),
          discovery("three", [
            {
              name: "Fine",
              domain: "fine.com",
              description: "Not an agency? Yes an agency.",
              signals: [],
            },
          ]),
        ],
      }),
      context,
    );
    expect(report.prospects).toEqual([]);
    expect(report.stats.excluded).toBe(2);
  });

  it("keeps going when a discovery source fails or throws", async () => {
    const events: DiscoveryEvent[] = [];
    const report = await discover(
      icp,
      registry({
        discovery: [
          {
            info: info("down"),
            discover: () =>
              Promise.resolve(err(new SourceError("down", "no luck", { cause: new Error("503") }))),
          },
          {
            info: info("buggy"),
            discover: () => Promise.reject(new TypeError("undefined is not a function")),
          },
          discovery("fine", [{ name: "Acme", domain: "acme.com", signals: [] }]),
        ],
      }),
      context,
      { onEvent: (event) => events.push(event) },
    );
    expect(report.prospects.map((prospect) => prospect.id)).toEqual(["acme.com"]);
    expect(report.failures).toEqual([
      { source: "down", message: "[down] no luck (503)" },
      { source: "buggy", message: "crashed: undefined is not a function" },
    ]);
    expect(events.filter((event) => event.type === "source-failed")).toHaveLength(2);
  });

  it("records an enrichment failure against the prospect and still returns it", async () => {
    const report = await discover(
      icp,
      registry({
        discovery: [discovery("one", [{ name: "Acme", domain: "acme.com", signals: [] }])],
        enrichment: [
          enrichment("flaky", () => Promise.resolve(err(new SourceError("flaky", "timeout")))),
          enrichment("jobs"),
        ],
      }),
      context,
    );
    expect(report.failures).toEqual([
      { source: "flaky", prospect: "acme.com", message: "[flaky] timeout" },
    ]);
    expect(report.prospects[0]?.sources).toEqual(["one", "jobs"]);
  });

  it("stops calling an enrichment source that keeps failing", async () => {
    let calls = 0;
    const events: DiscoveryEvent[] = [];
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      name: `Co ${index}`,
      domain: `co${index}.com`,
      signals: [],
    }));
    const report = await discover(
      icp,
      registry({
        discovery: [discovery("one", candidates)],
        enrichment: [
          enrichment("limited", () => {
            calls += 1;
            return Promise.resolve(err(new SourceError("limited", "403")));
          }),
        ],
      }),
      context,
      { enrichConcurrency: 1, maxConsecutiveFailures: 3, onEvent: (event) => events.push(event) },
    );
    expect(calls).toBe(3);
    expect(report.failures).toHaveLength(3);
    expect(report.prospects).toHaveLength(8);
    expect(events).toContainEqual({ type: "source-disabled", source: "limited", failures: 3 });
  });

  it("resets the failure count when a source recovers", async () => {
    let calls = 0;
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      name: `Co ${index}`,
      domain: `co${index}.com`,
      signals: [],
    }));
    await discover(
      icp,
      registry({
        discovery: [discovery("one", candidates)],
        enrichment: [
          enrichment("bumpy", () => {
            calls += 1;
            return Promise.resolve(calls % 2 === 0 ? ok([]) : err(new SourceError("bumpy", "500")));
          }),
        ],
      }),
      context,
      { enrichConcurrency: 1, maxConsecutiveFailures: 2 },
    );
    expect(calls).toBe(6);
  });

  it("returns an empty report when there is nothing to find", async () => {
    const report = await discover(icp, registry({}), context);
    expect(report).toEqual({
      prospects: [],
      failures: [],
      stats: { candidates: 0, merged: 0, excluded: 0, kept: 0 },
    });
  });
});
