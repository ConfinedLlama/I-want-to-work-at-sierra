import { describe, expect, it } from "vitest";
import { err, ok, partition, unwrap } from "./result.js";

describe("result", () => {
  it("unwraps a success", () => {
    expect(unwrap(ok(42))).toBe(42);
  });

  it("throws the original error when unwrapping a failure", () => {
    const boom = new Error("boom");
    expect(() => unwrap(err(boom))).toThrow(boom);
  });

  it("wraps non-Error failures so the message survives", () => {
    expect(() => unwrap(err("plain string"))).toThrow("plain string");
  });

  it("partitions mixed results while keeping order", () => {
    const { values, errors } = partition([ok(1), err("a"), ok(2), err("b")]);
    expect(values).toEqual([1, 2]);
    expect(errors).toEqual(["a", "b"]);
  });
});
