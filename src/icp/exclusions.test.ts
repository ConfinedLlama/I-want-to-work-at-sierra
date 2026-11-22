import { describe, expect, it } from "vitest";
import { unwrap } from "../core/result.js";
import { isExcluded } from "./exclusions.js";
import { parseIcp } from "./load.js";
import { minimalIcp } from "./testing.js";

const icp = unwrap(
  parseIcp(
    minimalIcp({
      exclusions: { domains: ["rival.com"], companies: ["Bad Co, Inc."], keywords: ["agency"] },
    }),
  ),
);

describe("isExcluded", () => {
  it("excludes by domain, including subdomains", () => {
    expect(isExcluded(icp, { name: "Rival", domain: "rival.com" })).toBe(true);
    expect(isExcluded(icp, { name: "Rival Jobs", domain: "jobs.rival.com" })).toBe(true);
  });

  it("does not exclude a domain that merely ends with the same letters", () => {
    expect(isExcluded(icp, { name: "Arrival", domain: "arrival.com" })).toBe(false);
  });

  it("excludes by company name however it is punctuated", () => {
    expect(isExcluded(icp, { name: "BAD CO" })).toBe(true);
  });

  it("excludes by keyword in the description", () => {
    expect(isExcluded(icp, { name: "X", description: "A boutique support agency." })).toBe(true);
  });

  it("lets everything else through", () => {
    expect(
      isExcluded(icp, { name: "Good", domain: "good.com", description: "We sell shoes." }),
    ).toBe(false);
  });
});
