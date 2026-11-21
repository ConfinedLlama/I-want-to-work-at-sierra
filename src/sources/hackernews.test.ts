import { describe, expect, it } from "vitest";
import { unwrap } from "../core/result.js";
import { classifyLinks, companyName, hackerNewsSource } from "./hackernews.js";
import { testContext, testIcp } from "./testing.js";

const STORIES = "https://hn.algolia.com/api/v1/search_by_date";
const SEARCH = "https://hn.algolia.com/api/v1/search?";
const THREAD = 5000;

const icp = testIcp({
  company: { keywords: ["customer support"], hiringSignals: ["voice"] },
  exclusions: { keywords: ["agency"] },
});

const stories = {
  hits: [
    { objectID: "5001", title: "Ask HN: Who wants to be hired? (June 2026)" },
    { objectID: String(THREAD), title: "Ask HN: Who is hiring? (June 2026)" },
    { objectID: "4000", title: "Ask HN: Who is hiring? (May 2026)" },
  ],
};

function comment(objectID: string, comment_text: string, overrides: Record<string, unknown> = {}) {
  return {
    objectID,
    comment_text,
    created_at: "2026-06-02T10:00:00Z",
    parent_id: THREAD,
    story_id: THREAD,
    ...overrides,
  };
}

const helpline = comment(
  "1",
  'Helpline (YC W22) | Voice Engineer | Remote (US) | <a href="https:&#x2F;&#x2F;www.helpline.example&#x2F;careers">https://www.helpline.example/car...</a><p>We build voice agents for customer support teams.<p>Apply: <a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;Helpline&#x2F;abc">https://jobs.ashbyhq.com/Helpline/abc</a>',
);

async function discover(hits: unknown[], forIcp = icp) {
  const { stub, context } = testContext();
  stub.on(STORIES, { body: stories });
  stub.on(SEARCH, { body: { hits } });
  return { found: unwrap(await hackerNewsSource.discover(forIcp, context)), stub };
}

describe("hackerNewsSource", () => {
  it("parses a conventional post into a candidate", async () => {
    const { found } = await discover([helpline]);
    expect(found).toEqual([
      {
        name: "Helpline",
        domain: "helpline.example",
        slugs: { ashby: "helpline" },
        description:
          "We build voice agents for customer support teams. Apply: https://jobs.ashbyhq.com/Helpline/abc",
        signals: [
          {
            kind: "hiring",
            source: "hackernews",
            summary:
              "Who is hiring: Helpline (YC W22) | Voice Engineer | Remote (US) | https://www.helpline.example/car...",
            url: "https://news.ycombinator.com/item?id=1",
            observedAt: "2026-06-02T10:00:00Z",
            matched: ["voice", "customer support"],
          },
        ],
      },
    ]);
  });

  it("searches the latest hiring thread once per term, as a phrase", async () => {
    const { stub } = await discover([]);
    const searches = stub.calls.map((call) => call.url).filter((url) => url.startsWith(SEARCH));
    expect(searches).toEqual([
      `${SEARCH}tags=comment,story_${THREAD}&query=%22voice%22&hitsPerPage=100`,
      `${SEARCH}tags=comment,story_${THREAD}&query=%22customer%20support%22&hitsPerPage=100`,
    ]);
  });

  it("returns each comment once even when several terms find it", async () => {
    const { found } = await discover([helpline, helpline]);
    expect(found).toHaveLength(1);
  });

  it("ignores replies", async () => {
    const { found } = await discover([comment("2", "Acme | Voice | Remote", { parent_id: 1 })]);
    expect(found).toEqual([]);
  });

  it("ignores posts without the pipe convention", async () => {
    const { found } = await discover([comment("3", "Hi, I do voice work. Could I send my CV?")]);
    expect(found).toEqual([]);
  });

  it("drops fuzzy search hits that do not really contain a term", async () => {
    const { found } = await discover([comment("4", "Billco | Engineer | NYC<p>Invoice tooling.")]);
    expect(found).toEqual([]);
  });

  it("drops excluded companies", async () => {
    const { found } = await discover([
      comment("5", "Agents R Us | Voice | Remote<p>A staffing agency for voice talent."),
    ]);
    expect(found).toEqual([]);
  });

  it("keeps a post with no links, without a domain", async () => {
    const { found } = await discover([comment("6", "Quiet Co | Voice Engineer | Onsite")]);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toHaveProperty("domain");
    expect(found[0]).not.toHaveProperty("slugs");
    expect(found[0]).not.toHaveProperty("description");
  });

  it("returns nothing when there is no hiring thread", async () => {
    const { stub, context } = testContext();
    stub.on(STORIES, { body: { hits: [{ objectID: "1", title: "Ask HN: Freelancer?" }] } });
    expect(unwrap(await hackerNewsSource.discover(icp, context))).toEqual([]);
  });

  it("makes no requests when the ICP has no terms to search", async () => {
    const { stub, context } = testContext();
    const seedsOnly = testIcp({ company: {}, seeds: [{ name: "Acme" }] });
    expect(unwrap(await hackerNewsSource.discover(seedsOnly, context))).toEqual([]);
    expect(stub.calls).toEqual([]);
  });

  it("survives one failed search", async () => {
    const { stub, context } = testContext();
    stub.on(STORIES, { body: stories });
    stub.on(SEARCH, [{ status: 500 }, { body: { hits: [helpline] } }]);
    expect(unwrap(await hackerNewsSource.discover(icp, context))).toHaveLength(1);
  });

  it("fails when every search fails", async () => {
    const { stub, context } = testContext();
    stub.on(STORIES, { body: stories });
    stub.on(SEARCH, { status: 500 });
    const result = await hackerNewsSource.discover(icp, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("[hackernews] every comment search failed");
  });

  it("fails when the thread list cannot be fetched", async () => {
    const { stub, context } = testContext();
    stub.on(STORIES, { status: 503 });
    const result = await hackerNewsSource.discover(icp, context);
    expect(result.ok).toBe(false);
  });
});

describe("companyName", () => {
  it.each([
    ["Acme | Engineer | Remote", "Acme"],
    ["Acme (YC S21) | Engineer", "Acme"],
    ["Acme Robotics, Inc. | SF", "Acme Robotics, Inc."],
    ["Acme https://acme.com | Engineer", "Acme"],
    ["Acme - | Engineer", "Acme"],
  ])("reads %j", (header, expected) => {
    expect(companyName(header)).toBe(expected);
  });

  it.each([
    "No pipes here",
    " | Engineer | Remote",
    "A | too short",
    `${"x".repeat(61)} | too long`,
    "--- | Engineer",
  ])("rejects %j", (header) => {
    expect(companyName(header)).toBeUndefined();
  });
});

describe("classifyLinks", () => {
  it("takes the first link that is the company's own site", () => {
    const { domain } = classifyLinks([
      "https://www.linkedin.com/company/acme",
      "https://careers.acme.com/open",
      "https://other.example",
    ]);
    expect(domain).toBe("careers.acme.com");
  });

  it("reads slugs out of job board links", () => {
    const { domain, slugs } = classifyLinks([
      "https://boards.greenhouse.io/acme/jobs/123",
      "https://job-boards.greenhouse.io/ignored-second",
      "https://jobs.lever.co/Acme-HQ",
      "https://jobs.ashbyhq.com/acme%20labs/1",
    ]);
    expect(domain).toBeUndefined();
    expect(slugs).toEqual({ greenhouse: "acme", lever: "acme-hq", ashby: "acme labs" });
  });

  it("does not choke on a malformed percent escape", () => {
    expect(classifyLinks(["https://jobs.lever.co/acme%zz"]).slugs).toEqual({ lever: "acme%zz" });
  });

  it("never treats a job board or social host as the company domain", () => {
    expect(
      classifyLinks([
        "https://grnh.se.greenhouse.io/x",
        "https://api.lever.co/x",
        "https://github.com/acme",
        "https://acme.notion.site/Jobs",
        "not a url",
      ]).domain,
    ).toBeUndefined();
  });
});
