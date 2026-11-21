import { describe, expect, it } from "vitest";
import { unwrap } from "../core/result.js";
import { ashbySource } from "./ashby.js";
import { greenhouseSource } from "./greenhouse.js";
import { toIso } from "./job-board.js";
import { leverSource } from "./lever.js";
import { testContext, testIcp } from "./testing.js";

const icp = testIcp({
  company: { hiringSignals: ["customer experience", "conversational ai", "voice"] },
});
const acme = { name: "Acme", domain: "acme.com" };

describe("greenhouseSource", () => {
  const api = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";

  it("reports a summary plus each matching role", async () => {
    const { stub, context } = testContext();
    stub.on(api, {
      body: {
        jobs: [
          {
            title: "Abuse Investigator",
            absolute_url: "https://acme.com/jobs/1",
            location: { name: "Remote" },
            first_published: "2026-05-01T10:00:00-04:00",
          },
          {
            title: "Director, Customer Experience",
            absolute_url: "https://acme.com/jobs/2",
            location: { name: "New York" },
            first_published: "2026-06-01T10:00:00-04:00",
          },
          {
            title: "Conversational AI Engineer, Voice",
            absolute_url: "https://acme.com/jobs/3",
            location: null,
            first_published: null,
            updated_at: "2026-04-01T00:00:00Z",
          },
        ],
        meta: { total: 3 },
      },
    });

    const signals = unwrap(await greenhouseSource.enrich(acme, icp, context));
    expect(signals).toEqual([
      {
        kind: "hiring",
        source: "greenhouse",
        summary: "3 open, 2 matching roles",
        url: "https://boards.greenhouse.io/acme",
      },
      {
        kind: "hiring",
        source: "greenhouse",
        summary: "Hiring: Conversational AI Engineer, Voice",
        url: "https://acme.com/jobs/3",
        observedAt: "2026-04-01T00:00:00.000Z",
        matched: ["conversational ai", "voice"],
      },
      {
        kind: "hiring",
        source: "greenhouse",
        summary: "Hiring: Director, Customer Experience (New York)",
        url: "https://acme.com/jobs/2",
        observedAt: "2026-06-01T14:00:00.000Z",
        matched: ["customer experience"],
      },
    ]);
  });

  it("still records a board with no matching roles", async () => {
    const { stub, context } = testContext();
    stub.on(api, {
      body: { jobs: [{ title: "Accountant", absolute_url: "https://acme.com/j/1" }] },
    });
    const signals = unwrap(await greenhouseSource.enrich(acme, icp, context));
    expect(signals.map((signal) => signal.summary)).toEqual(["1 open role, none matching the ICP"]);
  });

  it("returns nothing for an empty board", async () => {
    const { stub, context } = testContext();
    stub.on(api, { body: { jobs: [] } });
    expect(unwrap(await greenhouseSource.enrich(acme, icp, context))).toEqual([]);
  });

  it("treats a missing board as no signals and tries the next guess", async () => {
    const { stub, context } = testContext();
    stub.on("https://boards-api.greenhouse.io/v1/boards/acme/", { status: 404 });
    stub.on("https://boards-api.greenhouse.io/v1/boards/acmerobotics/", {
      body: { jobs: [{ title: "Voice Engineer", absolute_url: "https://acme.com/j/9" }] },
    });
    const signals = unwrap(
      await greenhouseSource.enrich({ name: "Acme Robotics", domain: "acme.com" }, icp, context),
    );
    expect(stub.calls).toHaveLength(2);
    expect(signals[0]?.url).toBe("https://boards.greenhouse.io/acmerobotics");
  });

  it("returns nothing when no guess has a board", async () => {
    const { stub, context } = testContext();
    stub.on("https://boards-api.greenhouse.io/", { status: 404 });
    expect(unwrap(await greenhouseSource.enrich(acme, icp, context))).toEqual([]);
  });

  it("uses an explicit slug and nothing else", async () => {
    const { stub, context } = testContext();
    stub.on("https://boards-api.greenhouse.io/", { status: 404 });
    await greenhouseSource.enrich({ ...acme, slugs: { greenhouse: "acme-inc" } }, icp, context);
    expect(stub.calls.map((call) => call.url)).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/acme-inc/jobs",
    ]);
  });

  it("surfaces real failures as a source error", async () => {
    const { stub, context } = testContext();
    stub.on(api, { status: 500 });
    const result = await greenhouseSource.enrich(acme, icp, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe('[greenhouse] could not read the board for "acme"');
  });

  it("caps how many individual roles it reports", async () => {
    const { stub, context } = testContext();
    const jobs = Array.from({ length: 20 }, (_, index) => ({
      title: `Voice Engineer ${index}`,
      absolute_url: `https://acme.com/j/${index}`,
    }));
    stub.on(api, { body: { jobs } });
    const signals = unwrap(await greenhouseSource.enrich(acme, icp, context));
    expect(signals).toHaveLength(9);
    expect(signals[0]?.summary).toBe("20 open, 20 matching roles");
  });
});

describe("leverSource", () => {
  it("matches on team as well as title, and reads epoch timestamps", async () => {
    const { stub, context } = testContext();
    stub.on("https://api.lever.co/v0/postings/acme?mode=json", {
      body: [
        {
          text: "Senior Manager",
          hostedUrl: "https://jobs.lever.co/acme/1",
          createdAt: 1_780_000_000_000,
          categories: { team: "Customer Experience", location: "London" },
        },
        { text: "Office Manager", hostedUrl: "https://jobs.lever.co/acme/2" },
      ],
    });
    const signals = unwrap(await leverSource.enrich(acme, icp, context));
    expect(signals).toEqual([
      {
        kind: "hiring",
        source: "lever",
        summary: "2 open, 1 matching role",
        url: "https://jobs.lever.co/acme",
      },
      {
        kind: "hiring",
        source: "lever",
        summary: "Hiring: Senior Manager (London)",
        url: "https://jobs.lever.co/acme/1",
        observedAt: new Date(1_780_000_000_000).toISOString(),
        matched: ["customer experience"],
      },
    ]);
  });
});

describe("ashbySource", () => {
  it("skips unlisted roles", async () => {
    const { stub, context } = testContext();
    stub.on("https://api.ashbyhq.com/posting-api/job-board/acme", {
      body: {
        apiVersion: "1",
        jobs: [
          {
            title: "Voice AI Engineer",
            jobUrl: "https://jobs.ashbyhq.com/acme/1",
            department: "Engineering",
            team: "Agents",
            location: "Remote (US)",
            publishedAt: "2026-04-07T17:12:35.753+00:00",
            isListed: true,
          },
          {
            title: "Voice Researcher",
            jobUrl: "https://jobs.ashbyhq.com/acme/2",
            isListed: false,
          },
        ],
      },
    });
    const signals = unwrap(await ashbySource.enrich(acme, icp, context));
    expect(signals.map((signal) => signal.summary)).toEqual([
      "1 open, 1 matching role",
      "Hiring: Voice AI Engineer (Remote (US))",
    ]);
  });
});

describe("toIso", () => {
  it("normalizes strings and epoch millis, and drops junk", () => {
    expect(toIso("2026-06-01T10:00:00-04:00")).toBe("2026-06-01T14:00:00.000Z");
    expect(toIso(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(toIso("yesterday-ish")).toBeUndefined();
    expect(toIso(null)).toBeUndefined();
    expect(toIso(undefined)).toBeUndefined();
  });
});
