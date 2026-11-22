import { describe, expect, it } from "vitest";
import {
  isWithinDomain,
  normalizeCompanyName,
  normalizeDomain,
  registrableLabel,
} from "./domain.js";

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

describe("isWithinDomain", () => {
  it("holds for the domain itself and for anything under it", () => {
    expect(isWithinDomain("acme.com", "acme.com")).toBe(true);
    expect(isWithinDomain("jobs.eu.acme.com", "acme.com")).toBe(true);
  });

  it("does not hold for a parent or for a name that only ends the same way", () => {
    expect(isWithinDomain("acme.com", "jobs.acme.com")).toBe(false);
    expect(isWithinDomain("notacme.com", "acme.com")).toBe(false);
  });
});

describe("registrableLabel", () => {
  it.each([
    ["acme.com", "acme"],
    ["careers.acme.com", "acme"],
    ["jobs.acme.co.uk", "acme"],
    ["acme.com.au", "acme"],
    ["app.box.io", "box"],
    ["acme.teamtailor.com", "teamtailor"],
  ])("reads %s as %s", (domain, expected) => {
    expect(registrableLabel(domain)).toBe(expected);
  });

  it("has nothing to read in a bare label", () => {
    expect(registrableLabel("localhost")).toBeUndefined();
  });
});
