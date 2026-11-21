import { describe, expect, it } from "vitest";
import { IcpSchema } from "./schema.js";
import { minimalIcp } from "./testing.js";

describe("IcpSchema", () => {
  it("fills in defaults for everything optional", () => {
    const icp = IcpSchema.parse(minimalIcp());
    expect(icp.company.industries).toEqual([]);
    expect(icp.company.stages).toEqual([]);
    expect(icp.exclusions).toEqual({ domains: [], companies: [], keywords: [] });
    expect(icp.seeds).toEqual([]);
    expect(icp.personas[0]?.painPoints).toEqual([]);
  });

  it("rejects unknown keys so typos do not pass silently", () => {
    const result = IcpSchema.safeParse({ ...minimalIcp(), persona: [] });
    expect(result.success).toBe(false);
  });

  it("requires at least one persona and one value prop", () => {
    expect(IcpSchema.safeParse(minimalIcp({ personas: [] })).success).toBe(false);
    expect(
      IcpSchema.safeParse(minimalIcp({ offer: { product: "x", oneLiner: "y", valueProps: [] } }))
        .success,
    ).toBe(false);
  });

  it("rejects an employee range that is upside down", () => {
    const result = IcpSchema.safeParse(
      minimalIcp({ company: { keywords: ["x"], employees: { min: 500, max: 100 } } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects blank strings in lists", () => {
    const result = IcpSchema.safeParse(minimalIcp({ company: { keywords: ["  "] } }));
    expect(result.success).toBe(false);
  });

  it("rejects a stage it does not know", () => {
    const result = IcpSchema.safeParse(
      minimalIcp({ company: { keywords: ["x"], stages: ["series-z" as never] } }),
    );
    expect(result.success).toBe(false);
  });
});
