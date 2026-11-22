import { describe, expect, it } from "vitest";
import { unwrap } from "../core/result.js";
import {
  createRegistry,
  listSources,
  NoSourceSelectedError,
  UnknownSourceError,
} from "./registry.js";

describe("createRegistry", () => {
  it("lists every source with a unique id", () => {
    const ids = listSources(unwrap(createRegistry())).map((source) => source.id);
    expect(ids).toEqual(["yc", "hackernews", "greenhouse", "lever", "ashby", "github"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("narrows to the requested sources, ignoring case and spacing", () => {
    const registry = unwrap(createRegistry({ only: [" YC ", "github", ""] }));
    expect(registry.discovery.map((source) => source.info.id)).toEqual(["yc"]);
    expect(registry.enrichment.map((source) => source.info.id)).toEqual(["github"]);
  });

  it("refuses ids it does not know rather than silently running nothing", () => {
    const result = createRegistry({ only: ["yc", "linkedin", "crunchbase"] });
    const error = result.ok ? undefined : result.error;
    if (!(error instanceof UnknownSourceError)) throw new Error("expected an unknown source error");
    expect(error.unknown).toEqual(["linkedin", "crunchbase"]);
    expect(error.message).toContain('Unknown source "linkedin", "crunchbase"');
  });

  it.each([[[]], [[""]], [[" ", ""]]])("refuses a selection with no ids in it: %j", (only) => {
    const result = createRegistry({ only });
    const error = result.ok ? undefined : result.error;
    expect(error).toBeInstanceOf(NoSourceSelectedError);
    expect(error?.message).toBe(
      "No source selected. Known: yc, hackernews, greenhouse, lever, ashby, github.",
    );
  });

  it("describes every source well enough to show a user", () => {
    for (const source of listSources(unwrap(createRegistry()))) {
      expect(source.name).not.toBe("");
      expect(source.homepage).toMatch(/^https:\/\//);
      expect(source.rateLimit).not.toBe("");
      expect(source.gives.length).toBeGreaterThan(0);
    }
  });
});
