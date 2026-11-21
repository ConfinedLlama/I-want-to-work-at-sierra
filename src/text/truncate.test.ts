import { describe, expect, it } from "vitest";
import { truncate } from "./truncate.js";

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("exactly10!", 10)).toBe("exactly10!");
  });

  it("cuts long text to the limit, ellipsis included", () => {
    const cut = truncate("one two three four", 10);
    expect(cut).toBe("one two t\u2026");
    expect(cut.length).toBe(10);
  });

  it("does not leave a space before the ellipsis", () => {
    expect(truncate("one two three", 8)).toBe("one two\u2026");
  });
});
