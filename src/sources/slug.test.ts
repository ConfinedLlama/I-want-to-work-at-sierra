import { describe, expect, it } from "vitest";
import { slugCandidates } from "./slug.js";

describe("slugCandidates", () => {
  it("uses only the explicit slug when there is one", () => {
    expect(
      slugCandidates({ name: "Acme", domain: "acme.com", slugs: { lever: "acme-hq" } }, "lever"),
    ).toEqual(["acme-hq"]);
  });

  it("guesses from the domain first, then the name", () => {
    expect(slugCandidates({ name: "Acme Robotics", domain: "acme.io" }, "greenhouse")).toEqual([
      "acme",
      "acmerobotics",
    ]);
  });

  it("does not repeat a guess", () => {
    expect(slugCandidates({ name: "Acme", domain: "acme.com" }, "ashby")).toEqual(["acme"]);
  });

  it("looks past subdomains and country suffixes", () => {
    expect(slugCandidates({ name: "Acme", domain: "jobs.acme.co.uk" }, "github")).toEqual(["acme"]);
    expect(slugCandidates({ name: "Acme", domain: "careers.acme.com" }, "github")).toEqual([
      "acme",
    ]);
    expect(slugCandidates({ name: "Acme", domain: "acme.com.au" }, "github")).toEqual(["acme"]);
  });

  it("does not mistake a short company label for part of the suffix", () => {
    expect(slugCandidates({ name: "Box", domain: "app.box.io" }, "github")).toEqual(["box"]);
    expect(slugCandidates({ name: "Arc", domain: "arc.dev" }, "github")).toEqual(["arc"]);
  });

  it("falls back to the name when there is no domain", () => {
    expect(slugCandidates({ name: "Acme & Sons, Inc." }, "lever")).toEqual(["acmesonsinc"]);
  });

  it("ignores a slug given for a different platform", () => {
    expect(slugCandidates({ name: "Acme", slugs: { github: "acme-gh" } }, "lever")).toEqual([
      "acme",
    ]);
  });
});
