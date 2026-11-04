import { describe, expect, it } from "vitest";
import { computeBalances } from "./ledger";
import { evenExpense, payment, percentExpense, stateOf } from "./testUtils";

const nets = (state: ReturnType<typeof stateOf>) => {
  const r = computeBalances(state);
  if (!r.ok) throw new Error(r.error.code);
  return r.value.map((b) => b.netCents);
};

describe("computeBalances", () => {
  it("is all zero for an empty ledger", () => {
    expect(nets(stateOf())).toEqual([0, 0, 0]);
  });

  it("credits the payer and debits participants", () => {
    expect(nets(stateOf(undefined, [evenExpense("e", 9000, "a", ["a", "b", "c"])]))).toEqual([
      6000, -3000, -3000,
    ]);
  });

  it("applies payments: sender up, recipient down", () => {
    const s = stateOf(
      undefined,
      [evenExpense("e", 9000, "a", ["a", "b", "c"])],
      [payment("p", "b", "a", 3000)],
    );
    expect(nets(s)).toEqual([3000, 0, -3000]);
  });

  it("creates no debt when the payer is the only participant", () => {
    expect(nets(stateOf(undefined, [evenExpense("e", 500, "a", ["a"])]))).toEqual([0, 0, 0]);
  });

  it("lets the payer be outside the participants", () => {
    expect(nets(stateOf(undefined, [evenExpense("e", 500, "a", ["b", "c"])]))).toEqual([500, -250, -250]);
  });

  it("returns balances in member order with names", () => {
    const r = computeBalances(stateOf());
    expect(r.ok && r.value.map((b) => b.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("balances flip when an expense is removed but its payment stays", () => {
    const s = stateOf(undefined, [], [payment("p", "b", "a", 3000)]);
    expect(nets(s)).toEqual([-3000, 3000, 0]);
  });

  it("returns an error instead of computing on invalid state", () => {
    const bad = stateOf(undefined, [evenExpense("e", 100, "zz", ["a"])]);
    expect(computeBalances(bad)).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
  });

  it("sums to zero with a mixed ledger", () => {
    const s = stateOf(
      undefined,
      [
        evenExpense("e1", 10000, "a", ["a", "b", "c"]),
        percentExpense("e2", 777, "c", [
          { memberId: "a", bps: 3333 },
          { memberId: "b", bps: 6667 },
        ]),
      ],
      [payment("p", "c", "b", 1234)],
    );
    expect(nets(s).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
