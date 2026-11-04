import { describe, expect, it } from "vitest";
import { allocateExpense } from "./allocate";
import { alice, bob, carol, evenExpense, percentExpense, trio } from "./testUtils";

const cents = (r: ReturnType<typeof allocateExpense>) =>
  r.ok ? r.value.map((a) => [a.memberId, a.cents]) : r.error.code;

describe("allocateExpense", () => {
  it("splits $100.00 evenly among 3 as 33.34, 33.33, 33.33", () => {
    expect(cents(allocateExpense(evenExpense("e", 10000, "a", ["a", "b", "c"]), trio))).toEqual([
      ["a", 3334],
      ["b", 3333],
      ["c", 3333],
    ]);
  });

  it("gives leftover cents to the first participants in member order, not list order", () => {
    // Participants listed as c, b, a still allocate in member order a, b, c.
    expect(cents(allocateExpense(evenExpense("e", 10001, "a", ["c", "b", "a"]), trio))).toEqual([
      ["a", 3334],
      ["b", 3334],
      ["c", 3333],
    ]);
  });

  it("only allocates to chosen participants", () => {
    expect(cents(allocateExpense(evenExpense("e", 101, "a", ["b", "c"]), trio))).toEqual([
      ["b", 51],
      ["c", 50],
    ]);
  });

  it("allocates a percent split by largest remainder with member-order ties", () => {
    const e = percentExpense("p", 6000, "b", [
      { memberId: "a", bps: 5000 },
      { memberId: "b", bps: 3000 },
      { memberId: "c", bps: 2000 },
    ]);
    expect(cents(allocateExpense(e, trio))).toEqual([
      ["a", 3000],
      ["b", 1800],
      ["c", 1200],
    ]);
    // 1 cent at 50/50: tie goes to the earlier member.
    const tie = percentExpense("p", 1, "a", [
      { memberId: "b", bps: 5000 },
      { memberId: "a", bps: 5000 },
    ]);
    expect(cents(allocateExpense(tie, trio))).toEqual([
      ["a", 1],
      ["b", 0],
    ]);
  });

  it("uses fractional remainders for percent shares", () => {
    // 33.33/33.33/33.34 of 100 cents: 33.33, 33.33, 33.34 -> floors 33,33,33, leftover to largest remainder
    const e = percentExpense("p", 100, "a", [
      { memberId: "a", bps: 3333 },
      { memberId: "b", bps: 3333 },
      { memberId: "c", bps: 3334 },
    ]);
    expect(cents(allocateExpense(e, trio))).toEqual([
      ["a", 33],
      ["b", 33],
      ["c", 34],
    ]);
  });

  it("validates before computing", () => {
    expect(cents(allocateExpense(evenExpense("e", 0, "a", ["a"]), trio))).toBe("INVALID_AMOUNT");
    const bad = percentExpense("p", 100, "a", [{ memberId: "a", bps: 9000 }]);
    expect(cents(allocateExpense(bad, trio))).toBe("PERCENT_SUM_MISMATCH");
  });

  it("works when the payer is the only participant", () => {
    expect(cents(allocateExpense(evenExpense("e", 500, "a", ["a"]), [alice, bob, carol]))).toEqual([
      ["a", 500],
    ]);
  });
});
