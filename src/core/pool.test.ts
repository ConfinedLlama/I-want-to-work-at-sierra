import { describe, expect, it } from "vitest";
import { mapConcurrent } from "./pool.js";

describe("mapConcurrent", () => {
  it("keeps results in input order", async () => {
    const delays = [30, 5, 15];
    const results = await mapConcurrent(delays, 3, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return index;
    });
    expect(results).toEqual([0, 1, 2]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapConcurrent(Array.from({ length: 10 }), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
    });
    expect(peak).toBe(3);
  });

  it("handles an empty list", async () => {
    expect(await mapConcurrent([], 4, () => Promise.resolve(1))).toEqual([]);
  });

  it("rejects a nonsensical limit", async () => {
    await expect(mapConcurrent([1], 0, () => Promise.resolve(1))).rejects.toThrow(RangeError);
  });

  it("propagates a worker failure", async () => {
    await expect(
      mapConcurrent([1, 2], 2, (value) =>
        value === 2 ? Promise.reject(new Error("bad")) : Promise.resolve(value),
      ),
    ).rejects.toThrow("bad");
  });
});
