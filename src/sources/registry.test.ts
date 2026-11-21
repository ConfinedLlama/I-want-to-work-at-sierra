import { describe, expect, it } from "vitest";
import { createRegistry, listSources, UnknownSourceError } from "./registry.js";

describe("createRegistry", () => {
  it("lists every source with a unique id", () => {
    const ids = listSources(createRegistry()).map((source) => source.id);
    expect(ids).toEqual(["yc", "hackernews", "greenhouse", "lever", "ashby", "github"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("narrows to the requested sources, ignoring case and spacing", () => {
    const registry = createRegistry({ only: [" YC ", "github", ""] });
    expect(registry.discovery.map((source) => source.info.id)).toEqual(["yc"]);
    expect(registry.enrichment.map((source) => source.info.id)).toEqual(["github"]);
  });

  it("refuses ids it does not know rather than silently running nothing", () => {
    expect(() => createRegistry({ only: ["yc", "linkedin"] })).toThrow(UnknownSourceError);
    expect(() => createRegistry({ only: ["linkedin"] })).toThrow(/Unknown source "linkedin"/);
  });

  it("describes every source well enough to show a user", () => {
    for (const source of listSources(createRegistry())) {
      expect(source.name).not.toBe("");
      expect(source.homepage).toMatch(/^https:\/\//);
      expect(source.rateLimit).not.toBe("");
      expect(source.gives.length).toBeGreaterThan(0);
    }
  });
});
