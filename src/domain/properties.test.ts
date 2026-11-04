import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addExpense,
  addMember,
  addPayment,
  allocateExpense,
  apportion,
  buildSettlementPlan,
  computeBalances,
  emptyState,
  evaluatePercentRows,
  formatBps,
  formatCents,
  parseAmountCents,
  parsePercentBps,
  splitEvenlyTexts,
  validateExpense,
} from "./index";
import type { Expense, Group, Split } from "./index";

const RUNS = { numRuns: 500 };

const names = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace"];

function groupOf(n: number): Group {
  let s = emptyState();
  for (let i = 0; i < n; i++) {
    const r = addMember(s, `m${i}`, names[i]);
    if (!r.ok) throw new Error("setup");
    s = r.value;
  }
  return s;
}

/** Random weights that sum to exactly 10000 with every share at least 1. */
function bpsSharesArb(n: number) {
  return fc
    .array(fc.integer({ min: 1, max: 1000 }), { minLength: n, maxLength: n })
    .map((ws) => apportion(10000 - n, ws).map((x) => x + 1));
}

interface Ops {
  n: number;
  expenses: { amount: number; payer: number; mode: "even" | "percent"; picks: boolean[]; bps: number[] }[];
  payments: { from: number; to: number; amount: number }[];
}

const opsArb: fc.Arbitrary<Ops> = fc.integer({ min: 2, max: 7 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    expenses: fc.array(
      fc.record({
        amount: fc.integer({ min: 1, max: 100_000_000 }),
        payer: fc.integer({ min: 0, max: n - 1 }),
        mode: fc.constantFrom("even" as const, "percent" as const),
        picks: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
        bps: bpsSharesArb(n),
      }),
      { maxLength: 12 },
    ),
    payments: fc.array(
      fc.record({
        from: fc.integer({ min: 0, max: n - 1 }),
        to: fc.integer({ min: 0, max: n - 1 }),
        amount: fc.integer({ min: 1, max: 500_000_000 }),
      }),
      { maxLength: 8 },
    ),
  }),
);

function build(ops: Ops): { state: Group; expenses: Expense[] } {
  let state = groupOf(ops.n);
  const expenses: Expense[] = [];
  ops.expenses.forEach((e, i) => {
    let split: Split;
    if (e.mode === "even") {
      const chosen = state.members.filter((_, k) => e.picks[k]).map((m) => m.id);
      split = { kind: "even", participantIds: chosen.length > 0 ? chosen : [state.members[0].id] };
    } else {
      split = { kind: "percent", shares: state.members.map((m, k) => ({ memberId: m.id, bps: e.bps[k] })) };
    }
    const expense: Expense = {
      id: `e${i}`,
      description: `Expense ${i}`,
      amountCents: e.amount,
      payerId: `m${e.payer}`,
      date: "2026-01-01",
      split,
    };
    const r = addExpense(state, expense);
    if (!r.ok) throw new Error(`generated expense rejected: ${r.error.code}`);
    state = r.value;
    expenses.push(expense);
  });
  ops.payments.forEach((p, i) => {
    if (p.from === p.to) return;
    const r = addPayment(state, { id: `p${i}`, from: `m${p.from}`, to: `m${p.to}`, amountCents: p.amount });
    if (!r.ok) throw new Error(`generated payment rejected: ${r.error.code}`);
    state = r.value;
  });
  return { state, expenses };
}

describe("properties", () => {
  it("allocations sum to each expense amount", () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const { state, expenses } = build(ops);
        for (const e of expenses) {
          const r = allocateExpense(e, state.members);
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(r.value.reduce((s, a) => s + a.cents, 0)).toBe(e.amountCents);
            expect(r.value.every((a) => Number.isSafeInteger(a.cents) && a.cents >= 0)).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it("net balances always sum to zero", () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const { state } = build(ops);
        const r = computeBalances(state);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.reduce((s, b) => s + b.netCents, 0)).toBe(0);
      }),
      RUNS,
    );
  });

  it("applying the plan zeroes every net with at most max(0, k - 1) transfers", () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const { state } = build(ops);
        const r = computeBalances(state);
        if (!r.ok) throw new Error("balances");
        const plan = buildSettlementPlan(r.value);
        const net = new Map(r.value.map((b) => [b.memberId, b.netCents]));
        for (const t of plan) {
          expect(t.amountCents).toBeGreaterThan(0);
          expect(t.from).not.toBe(t.to);
          net.set(t.from, (net.get(t.from) ?? 0) + t.amountCents);
          net.set(t.to, (net.get(t.to) ?? 0) - t.amountCents);
        }
        for (const v of net.values()) expect(v).toBe(0);
        const k = r.value.filter((b) => b.netCents !== 0).length;
        expect(plan.length).toBeLessThanOrEqual(Math.max(0, k - 1));
        expect(buildSettlementPlan(r.value)).toEqual(plan);
      }),
      RUNS,
    );
  });

  it("apportion sums exactly and stays within one cent of the exact share", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 12 }).filter((w) => w.some((x) => x > 0)),
        (total, weights) => {
          const shares = apportion(total, weights);
          expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
          const sum = weights.reduce((a, b) => a + b, 0);
          shares.forEach((s, i) => {
            const exact = (total * weights[i]) / sum;
            expect(Math.abs(s - exact)).toBeLessThan(1);
          });
        },
      ),
      RUNS,
    );
  });

  it("even apportionment gives the first participants the leftover cents", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.integer({ min: 1, max: 20 }), (total, n) => {
        const shares = apportion(total, Array.from({ length: n }, () => 1));
        const base = Math.floor(total / n);
        const extra = total - base * n;
        shares.forEach((s, i) => expect(s).toBe(i < extra ? base + 1 : base));
      }),
      RUNS,
    );
  });

  it("parse then format round trips for cents", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), (cents) => {
        const text = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
        const parsed = parseAmountCents(text);
        expect(parsed).toEqual({ ok: true, value: cents });
        const formatted = formatCents(cents);
        const reparsed = parseAmountCents(formatted.replace("$", "").replace(/,/g, ""));
        expect(reparsed).toEqual({ ok: true, value: cents });
      }),
      RUNS,
    );
  });

  it("parse then format round trips for bps", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (bps) => {
        expect(parsePercentBps(formatBps(bps))).toEqual({ ok: true, value: bps });
      }),
      RUNS,
    );
  });

  it("short amount text parses to the same cents as the padded text", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999 }), fc.integer({ min: 0, max: 9 }), (whole, tenths) => {
        const a = parseAmountCents(`${whole}.${tenths}`);
        const b = parseAmountCents(`${whole}.${tenths}0`);
        expect(a).toEqual(b);
        expect(a).toEqual({ ok: true, value: whole * 100 + tenths * 10 });
      }),
      RUNS,
    );
  });

  it("formatCents never prints NaN, exponents, or negative zero", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000_000_000, max: 100_000_000_000 }), (cents) => {
        const text = formatCents(cents);
        expect(text).toMatch(/^-?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(text).not.toBe("-$0.00");
      }),
      RUNS,
    );
  });

  it("split evenly texts always total exactly 100.00", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (n) => {
        const rows = splitEvenlyTexts(n).map((text, i) => ({ memberId: String(i), text }));
        expect(evaluatePercentRows(rows, []).status).toBe("exact");
      }),
      RUNS,
    );
  });

  it("any bps list that does not sum to 10000 is rejected by the domain", () => {
    const members = groupOf(4).members;
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 4 }).filter(
          (xs) => xs.reduce((a, b) => a + b, 0) !== 10000,
        ),
        (xs) => {
          const split: Split = { kind: "percent", shares: xs.map((bps, i) => ({ memberId: `m${i}`, bps })) };
          const r = validateExpense(
            { id: "e", description: "x", amountCents: 100, payerId: "m0", date: "2026-01-01", split },
            members,
          );
          expect(r.ok).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it("any share outside 1 to 10000 is rejected even when the total is 10000", () => {
    const members = groupOf(3).members;
    fc.assert(
      fc.property(fc.integer({ min: 10001, max: 1_000_000 }), (big) => {
        const split: Split = {
          kind: "percent",
          shares: [
            { memberId: "m0", bps: big },
            { memberId: "m1", bps: 10000 - big },
          ],
        };
        const r = validateExpense(
          { id: "e", description: "x", amountCents: 100, payerId: "m0", date: "2026-01-01", split },
          members,
        );
        expect(r.ok).toBe(false);
      }),
      RUNS,
    );
  });

  it("the exact [15000, -5000] bps case is rejected", () => {
    const members = groupOf(2).members;
    const split: Split = {
      kind: "percent",
      shares: [
        { memberId: "m0", bps: 15000 },
        { memberId: "m1", bps: -5000 },
      ],
    };
    const r = validateExpense(
      { id: "e", description: "x", amountCents: 100, payerId: "m0", date: "2026-01-01", split },
      members,
    );
    expect(r.ok).toBe(false);
  });

  it("the 99.99 case is rejected", () => {
    const members = groupOf(3).members;
    const split: Split = {
      kind: "percent",
      shares: [0, 1, 2].map((i) => ({ memberId: `m${i}`, bps: 3333 })),
    };
    const r = validateExpense(
      { id: "e", description: "x", amountCents: 100, payerId: "m0", date: "2026-01-01", split },
      members,
    );
    expect(r).toMatchObject({ ok: false, error: { code: "PERCENT_SUM_MISMATCH", actual: 9999 } });
  });
});
