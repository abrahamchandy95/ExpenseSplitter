import { describe, expect, it } from "vitest";
import { apportion } from "./apportion";

describe("apportion", () => {
  it("splits evenly with leftovers to the first indexes", () => {
    expect(apportion(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(apportion(10001, [1, 1, 1])).toEqual([3334, 3334, 3333]);
    expect(apportion(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("applies exact weights", () => {
    expect(apportion(6000, [5000, 3000, 2000])).toEqual([3000, 1800, 1200]);
  });

  it("gives leftovers to the largest remainders, ties by index", () => {
    // 10 over [1,1,2] is 2.5, 2.5, 5: the tied remainder goes to index 0
    expect(apportion(10, [1, 1, 2])).toEqual([3, 2, 5]);
    // 7 over [1,2] is 2.33 and 4.67: the larger remainder wins the leftover cent
    expect(apportion(7, [1, 2])).toEqual([2, 5]);
    expect(apportion(5, [1, 1, 1, 1])).toEqual([2, 1, 1, 1]);
  });

  it("never gives extra cents to zero weights", () => {
    expect(apportion(1, [0, 1, 1])).toEqual([0, 1, 0]);
  });

  it("handles a single weight and zero total", () => {
    expect(apportion(123, [7])).toEqual([123]);
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
  });

  it("is exact for large values", () => {
    const shares = apportion(100_000_000, [3333, 3333, 3334]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100_000_000);
  });

  it("throws on invalid input", () => {
    expect(() => apportion(10, [0, 0])).toThrow(RangeError);
    expect(() => apportion(10, [])).toThrow(RangeError);
    expect(() => apportion(10, [1, -1])).toThrow(RangeError);
    expect(() => apportion(10, [1.5])).toThrow(RangeError);
    expect(() => apportion(-1, [1])).toThrow(RangeError);
    expect(() => apportion(0.5, [1])).toThrow(RangeError);
  });
});
