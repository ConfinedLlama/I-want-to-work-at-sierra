import { describe, expect, it } from "vitest";
import { unwrap } from "../core/result.js";
import { createGithubSource } from "./github.js";
import { testContext, testIcp } from "./testing.js";

const ORG = "https://api.github.com/orgs/acme";
const REPOS = "https://api.github.com/orgs/acme/repos";
const icp = testIcp({ company: { keywords: ["support"], techSignals: ["twilio"] } });
const acme = { name: "Acme", domain: "acme.com" };
const org = { login: "acme", html_url: "https://github.com/acme", blog: "https://www.acme.com" };

// The test clock sits at 2026-06-15.
function repo(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    html_url: `https://github.com/acme/${name}`,
    description: `The ${name} service`,
    language: "TypeScript",
    pushed_at: "2026-06-10T00:00:00Z",
    stargazers_count: 10,
    fork: false,
    archived: false,
    topics: [],
    ...overrides,
  };
}

describe("githubSource", () => {
  it("summarizes languages and lists recent repos, ICP matches first", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { body: org });
    stub.on(REPOS, {
      body: [
        repo("web", { pushed_at: "2026-06-14T00:00:00Z" }),
        repo("dialer", {
          description: "Outbound calls on Twilio",
          language: "Go",
          pushed_at: "2026-06-01T00:00:00Z",
          topics: ["telephony"],
        }),
        repo("api", { pushed_at: "2026-06-12T00:00:00Z" }),
      ],
    });

    const signals = unwrap(await createGithubSource().enrich(acme, icp, context));
    expect(signals).toEqual([
      {
        kind: "tech",
        source: "github",
        summary: "Mostly TypeScript, Go across 3 public repos pushed in the last 90 days",
        url: "https://github.com/acme",
      },
      {
        kind: "tech",
        source: "github",
        summary: "Active repo dialer: Outbound calls on Twilio [Go]",
        url: "https://github.com/acme/dialer",
        observedAt: "2026-06-01T00:00:00Z",
        matched: ["twilio"],
      },
      {
        kind: "activity",
        source: "github",
        summary: "Active repo web: The web service [TypeScript]",
        url: "https://github.com/acme/web",
        observedAt: "2026-06-14T00:00:00Z",
      },
      {
        kind: "activity",
        source: "github",
        summary: "Active repo api: The api service [TypeScript]",
        url: "https://github.com/acme/api",
        observedAt: "2026-06-12T00:00:00Z",
      },
    ]);
  });

  it("keeps a long repo description to one readable line", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { body: org });
    stub.on(REPOS, { body: [repo("scanner", { description: `  ${"word ".repeat(80)}` })] });
    const signals = unwrap(await createGithubSource().enrich(acme, icp, context));
    const summary = signals[1]?.summary ?? "";
    expect(summary.startsWith("Active repo scanner: word word")).toBe(true);
    expect(summary.endsWith("word\u2026 [TypeScript]")).toBe(true);
    expect(summary.length).toBeLessThan(160);
  });

  it("ignores forks, archived repos and anything not pushed recently", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { body: org });
    stub.on(REPOS, {
      body: [
        repo("fork", { fork: true }),
        repo("old", { archived: true }),
        repo("stale", { pushed_at: "2025-01-01T00:00:00Z" }),
        repo("undated", { pushed_at: null }),
      ],
    });
    expect(unwrap(await createGithubSource().enrich(acme, icp, context))).toEqual([]);
  });

  it("rejects a guessed org that does not link back to the company", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { body: { ...org, blog: "https://acme-fireworks.example" } });
    expect(unwrap(await createGithubSource().enrich(acme, icp, context))).toEqual([]);
    expect(stub.calls).toHaveLength(1);
  });

  it("rejects a guessed org with no website at all", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { body: { ...org, blog: "" } });
    expect(unwrap(await createGithubSource().enrich(acme, icp, context))).toEqual([]);
  });

  it("accepts an org whose site is a subdomain of the company, or the other way round", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { body: { ...org, blog: "engineering.acme.com" } });
    stub.on(REPOS, { body: [repo("web")] });
    const source = createGithubSource();
    expect(unwrap(await source.enrich(acme, icp, context))).toHaveLength(2);
    expect(
      unwrap(
        await source.enrich({ name: "Acme", domain: "jobs.engineering.acme.com" }, icp, context),
      ),
    ).toHaveLength(2);
  });

  it("spends no request on a guess it has no domain to check against", async () => {
    const { stub, context } = testContext();
    stub.on("https://api.github.com/", { body: org });
    expect(unwrap(await createGithubSource().enrich({ name: "Acme" }, icp, context))).toEqual([]);
    expect(stub.calls).toEqual([]);
  });

  it("trusts an explicit slug without checking the website", async () => {
    const { stub, context } = testContext();
    stub.on("https://api.github.com/orgs/acme-labs", {
      body: { login: "acme-labs", html_url: "https://github.com/acme-labs", blog: null },
    });
    stub.on("https://api.github.com/orgs/acme-labs/repos", { body: [repo("web")] });
    const signals = unwrap(
      await createGithubSource().enrich({ ...acme, slugs: { github: "acme-labs" } }, icp, context),
    );
    expect(signals[0]?.url).toBe("https://github.com/acme-labs");
  });

  it("returns nothing when no org exists", async () => {
    const { stub, context } = testContext();
    stub.on("https://api.github.com/orgs/", { status: 404 });
    expect(unwrap(await createGithubSource().enrich(acme, icp, context))).toEqual([]);
  });

  it("sends the token when given one, and never an empty header", async () => {
    const withToken = testContext();
    withToken.stub.on(ORG, { status: 404 });
    await createGithubSource({ token: "t0ken" }).enrich(acme, icp, withToken.context);
    expect(withToken.stub.calls[0]?.headers.authorization).toBe("Bearer t0ken");

    const without = testContext();
    without.stub.on(ORG, { status: 404 });
    await createGithubSource({ token: "" }).enrich(acme, icp, without.context);
    expect(without.stub.calls[0]?.headers).not.toHaveProperty("authorization");
  });

  it("explains a rate limit", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { status: 403 });
    const result = await createGithubSource().enrich(acme, icp, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe(
      '[github] could not look up the org "acme". Rate limited: set GITHUB_TOKEN to raise the limit',
    );
  });

  it("reports a failure to list repos", async () => {
    const { stub, context } = testContext();
    stub.on(ORG, { body: org });
    stub.on(REPOS, { status: 500 });
    const result = await createGithubSource().enrich(acme, icp, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('[github] could not list repos for "acme"');
  });
});
