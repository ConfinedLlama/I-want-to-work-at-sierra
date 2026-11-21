import { describe, expect, it } from "vitest";
import { normalizeCompanyName, normalizeDomain } from "./domain.js";

describe("normalizeDomain", () => {
  it.each([
    ["acme.com", "acme.com"],
    ["https://www.Acme.com/careers?x=1", "acme.com"],
    ["  ACME.COM.  ", "acme.com"],
    ["http://jobs.acme.co.uk", "jobs.acme.co.uk"],
    ["www.acme.io:8443/path", "acme.io"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "   ", "not a domain", "localhost", "acme", "http://"])("rejects %j", (input) => {
    expect(normalizeDomain(input)).toBeUndefined();
  });
});

describe("normalizeCompanyName", () => {
  it("drops legal suffixes and punctuation", () => {
    expect(normalizeCompanyName("Acme, Inc.")).toBe("acme");
    expect(normalizeCompanyName("ACME Corp")).toBe("acme");
    expect(normalizeCompanyName("Acme Robotics GmbH")).toBe("acme robotics");
  });

  it("does not eat words that merely contain a suffix", () => {
    expect(normalizeCompanyName("Incident.io")).toBe("incident io");
    expect(normalizeCompanyName("Cohere")).toBe("cohere");
  });
});
