import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "../core/result.js";
import { loadIcp, parseIcp } from "./load.js";
import { minimalIcp } from "./testing.js";

describe("parseIcp", () => {
  it("lowercases and dedupes matching lists", () => {
    const icp = unwrap(
      parseIcp(
        minimalIcp({
          company: { keywords: ["Support", "support", "CX"], techSignals: ["Twilio", "twilio"] },
        }),
      ),
    );
    expect(icp.company.keywords).toEqual(["support", "cx"]);
    expect(icp.company.techSignals).toEqual(["twilio"]);
  });

  it("normalizes excluded and seed domains", () => {
    const icp = unwrap(
      parseIcp(
        minimalIcp({
          exclusions: { domains: ["https://www.Competitor.com/"], companies: ["Rival, Inc."] },
          seeds: [{ name: "Acme", domain: "WWW.ACME.COM" }],
        }),
      ),
    );
    expect(icp.exclusions.domains).toEqual(["competitor.com"]);
    expect(icp.exclusions.companies).toEqual(["rival"]);
    expect(icp.seeds[0]?.domain).toBe("acme.com");
  });

  it("reports the path of each schema problem", () => {
    const result = parseIcp({ ...minimalIcp(), personas: [{ name: "", seniority: [] }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.problems.some((line) => line.startsWith("personas[0].name:"))).toBe(true);
    expect(result.error.problems.some((line) => line.startsWith("personas[0].seniority:"))).toBe(
      true,
    );
  });

  it("refuses a profile with nothing to search for", () => {
    const result = parseIcp(minimalIcp({ company: {} }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("nothing to search for");
  });

  it("accepts a profile with only seeds", () => {
    const result = parseIcp(minimalIcp({ company: {}, seeds: [{ name: "Acme" }] }));
    expect(result.ok).toBe(true);
  });

  it("flags duplicate persona names regardless of case", () => {
    const persona = { name: "Buyer", seniority: ["vp" as const], titleKeywords: ["support"] };
    const result = parseIcp(minimalIcp({ personas: [persona, { ...persona, name: "buyer" }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.problems).toEqual(['personas[1].name: "buyer" is used twice']);
  });

  it("flags a seed that is also excluded", () => {
    const result = parseIcp(
      minimalIcp({
        exclusions: { domains: ["acme.com"] },
        seeds: [{ name: "Acme", domain: "https://acme.com" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.problems[0]).toContain("also in exclusions.domains");
  });

  it("flags domains that are not domains", () => {
    const result = parseIcp(
      minimalIcp({
        exclusions: { domains: ["not a domain"] },
        seeds: [{ name: "Acme", domain: "acme" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.problems).toEqual([
      'exclusions.domains[0]: "not a domain" is not a domain',
      'seeds[0].domain: "acme" is not a domain',
    ]);
  });
});

describe("loadIcp", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "icp-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads the example profile that ships with the repo", async () => {
    const icp = unwrap(await loadIcp("examples/icp.voice-support.yaml"));
    expect(icp.personas.map((persona) => persona.name)).toEqual([
      "Support leader",
      "Engineering owner",
    ]);
    expect(icp.company.employees).toEqual({ min: 100, max: 5000 });
  });

  it("loads json", async () => {
    const path = join(dir, "icp.json");
    await writeFile(path, JSON.stringify(minimalIcp()));
    expect(unwrap(await loadIcp(path)).name).toBe("Test ICP");
  });

  it("explains a missing file", async () => {
    const result = await loadIcp(join(dir, "nope.yaml"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Could not read ICP file");
  });

  it("explains broken yaml", async () => {
    const path = join(dir, "icp.yaml");
    await writeFile(path, "name: [unterminated");
    const result = await loadIcp(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Could not parse");
  });

  it("refuses file types it does not know", async () => {
    const path = join(dir, "icp.toml");
    await writeFile(path, "name = 'x'");
    const result = await loadIcp(path);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Unsupported ICP file type");
  });
});
