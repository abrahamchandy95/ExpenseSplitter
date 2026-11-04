import { describe, expect, it } from "vitest";
import { buildSettlementPlan, summarize } from "./settle";
import { evenExpense, payment, percentExpense, stateOf } from "./testUtils";
import type { Balance } from "./types";

const bal = (memberId: string, name: string, netCents: number): Balance => ({ memberId, name, netCents });

describe("buildSettlementPlan", () => {
  it("returns no transfers when everyone is settled", () => {
    expect(buildSettlementPlan([bal("a", "A", 0), bal("b", "B", 0)])).toEqual([]);
    expect(buildSettlementPlan([])).toEqual([]);
  });

  it("nets mutual debts and collapses chains", () => {
    // A owes B 10 and B owes C 10 means net A -10, B 0, C +10: A pays C.
    expect(buildSettlementPlan([bal("a", "A", -1000), bal("b", "B", 0), bal("c", "C", 1000)])).toEqual([
      { from: "a", to: "c", amountCents: 1000 },
    ]);
  });

  it("picks the largest debtor and the largest creditor each round", () => {
    const plan = buildSettlementPlan([
      bal("a", "Ann", 500),
      bal("b", "Ben", -300),
      bal("c", "Cat", 100),
      bal("d", "Dan", -300),
    ]);
    expect(plan).toEqual([
      { from: "b", to: "a", amountCents: 300 },
      { from: "d", to: "a", amountCents: 200 },
      { from: "d", to: "c", amountCents: 100 },
    ]);
  });

  it("breaks ties by lowercase name, not member order", () => {
    const plan = buildSettlementPlan([
      bal("z", "zed", 100),
      bal("y", "Yan", -100),
      bal("b", "Bea", 100),
      bal("x", "Xia", -100),
    ]);
    // Debtors tie at 100: "xia" < "yan". Creditors tie at 100: "bea" < "zed".
    expect(plan).toEqual([
      { from: "x", to: "b", amountCents: 100 },
      { from: "y", to: "z", amountCents: 100 },
    ]);
  });

  it("compares names case-insensitively", () => {
    const plan = buildSettlementPlan([
      bal("1", "bob", -100),
      bal("2", "Alice", -100),
      bal("3", "Zed", 200),
    ]);
    expect(plan[0].from).toBe("2");
  });

  it("does not mutate its input and is deterministic", () => {
    const input = [bal("a", "A", -500), bal("b", "B", 300), bal("c", "C", 200)];
    const copy = JSON.parse(JSON.stringify(input));
    const first = buildSettlementPlan(input);
    expect(input).toEqual(copy);
    expect(buildSettlementPlan(input)).toEqual(first);
  });

  it("uses at most k - 1 transfers", () => {
    const input = [bal("a", "A", -700), bal("b", "B", -200), bal("c", "C", 600), bal("d", "D", 300)];
    expect(buildSettlementPlan(input).length).toBeLessThanOrEqual(3);
  });
});

describe("summarize", () => {
  it("reports allSettled with an empty plan", () => {
    const r = summarize(stateOf());
    expect(r).toMatchObject({ ok: true, value: { allSettled: true, plan: [] } });
  });

  it("builds the plan from the ledger", () => {
    const s = stateOf(
      undefined,
      [evenExpense("e", 9000, "a", ["a", "b", "c"])],
    );
    const r = summarize(s);
    expect(r.ok && r.value.plan).toEqual([
      { from: "b", to: "a", amountCents: 3000 },
      { from: "c", to: "a", amountCents: 3000 },
    ]);
    expect(r.ok && r.value.allSettled).toBe(false);
  });

  it("says Alice owes Bob after deleting the dinner but keeping the payment", () => {
    const r = summarize(stateOf(undefined, [], [payment("p", "b", "a", 3000)]));
    expect(r.ok && r.value.plan).toEqual([{ from: "a", to: "b", amountCents: 3000 }]);
  });

  it("propagates validation errors", () => {
    const r = summarize(
      stateOf(undefined, [percentExpense("p", 100, "a", [{ memberId: "a", bps: 9000 }])]),
    );
    expect(r.ok).toBe(false);
  });
});
