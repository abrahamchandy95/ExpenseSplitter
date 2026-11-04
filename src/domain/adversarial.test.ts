import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addExpense,
  addMember,
  addPayment,
  allocateExpense,
  apportion,
  buildSettlementPlan,
  canFillRemainder,
  computeBalances,
  deleteExpense,
  deletePayment,
  deserializeState,
  describeBalance,
  emptyState,
  evaluatePercentRows,
  fillRemainderText,
  formatBps,
  formatCents,
  formatPercent,
  normalizeName,
  parseAmountCents,
  parsePercentBps,
  removeMember,
  rowsToPercentSplit,
  serializeState,
  splitEvenlyTexts,
  summarize,
  totalLineText,
  validateExpense,
  validateMemberName,
  validatePayment,
  validateState,
} from "./index";
import type { Balance, Expense, Group, Member, Payment, Transfer } from "./index";

const RUNS = { numRuns: 400 };

const names = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy", "Karl", "Liam"];

function members(n: number): Member[] {
  return Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: names[i] ?? `P${i}` }));
}

function stateWith(n: number, expenses: Expense[] = [], payments: Payment[] = []): Group {
  return { members: members(n), expenses, payments };
}

function even(id: string, cents: number, payer: string, ids: string[]): Expense {
  return {
    id,
    description: `e${id}`,
    amountCents: cents,
    payerId: payer,
    date: "2026-02-28",
    split: { kind: "even", participantIds: ids },
  };
}

function pct(id: string, cents: number, payer: string, shares: [string, number][]): Expense {
  return {
    id,
    description: `e${id}`,
    amountCents: cents,
    payerId: payer,
    date: "2026-02-28",
    split: { kind: "percent", shares: shares.map(([memberId, bps]) => ({ memberId, bps })) },
  };
}

function pay(id: string, from: string, to: string, cents: number): Payment {
  return { id, from, to, amountCents: cents };
}

function must<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function code(r: { ok: boolean; error?: { code: string } }): string | undefined {
  return r.ok ? undefined : r.error?.code;
}

function applyPlan(balances: Balance[], plan: Transfer[]): Map<string, number> {
  const net = new Map(balances.map((b) => [b.memberId, b.netCents]));
  for (const t of plan) {
    net.set(t.from, (net.get(t.from) ?? 0) + t.amountCents);
    net.set(t.to, (net.get(t.to) ?? 0) - t.amountCents);
  }
  return net;
}

describe("amount grammar", () => {
  const rejectedAsNonNumeric = [
    ".5", "5.", "1e2", "1E2", "0x10", "+5", "1,000", "$5", "12.50 0", "1 2", "--5", "-", ".", "-.5", "5.-1",
    "١٢", "１２", "12 ", "NaN", "Infinity", "0b1", "1_000", "12.5.0", "12,50",
  ];
  for (const text of rejectedAsNonNumeric) {
    it(`amount rejects ${JSON.stringify(text)} as non-numeric or otherwise invalid`, () => {
      const r = parseAmountCents(text);
      // "12 " is whitespace for String.trim, so it is allowed to parse; everything else must fail.
      if (text === "12 ") return;
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("NOT_NUMERIC");
    });
    it(`percent rejects ${JSON.stringify(text)} as non-numeric`, () => {
      if (text === "12 ") return;
      const r = parsePercentBps(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("NOT_NUMERIC");
    });
  }

  it("accepts the three documented forms and trims spaces", () => {
    expect(must(parseAmountCents("12"))).toBe(1200);
    expect(must(parseAmountCents("12.5"))).toBe(1250);
    expect(must(parseAmountCents("12.50"))).toBe(1250);
    expect(must(parseAmountCents(" 12.50 "))).toBe(1250);
    expect(must(parseAmountCents("  0.01"))).toBe(1);
    expect(must(parseAmountCents("007.05"))).toBe(705);
  });

  it("empty and whitespace-only amount is EMPTY", () => {
    for (const t of ["", " ", "   "]) {
      const r = parseAmountCents(t);
      expect(r.ok ? "ok" : r.error.code).toBe("EMPTY");
    }
  });

  it("zero in every spelling is ZERO", () => {
    for (const t of ["0", "0.0", "0.00", "000", "0.", "00.00"]) {
      const r = parseAmountCents(t);
      if (t === "0.") {
        expect(r.ok ? "ok" : r.error.code).toBe("NOT_NUMERIC");
      } else {
        expect(r.ok ? "ok" : r.error.code).toBe("ZERO");
      }
    }
  });

  it("negative zero and negative numbers are NEGATIVE, never ZERO", () => {
    for (const t of ["-0", "-0.00", "-0.0", "-5", "-0.01", " -12.50 "]) {
      const r = parseAmountCents(t);
      expect(r.ok ? "ok" : r.error.code).toBe("NEGATIVE");
    }
  });

  it("more than 2 decimals is rejected even when the extra digits are zeros", () => {
    for (const t of ["12.500", "12.000", "0.001", "0.000", "1.2300", "12.5000000000000000000000"]) {
      const r = parseAmountCents(t);
      expect(r.ok ? "ok" : r.error.code).toBe("TOO_MANY_DECIMALS");
    }
  });

  it("cap boundary: 1000000.00 allowed, 1000000.01 rejected", () => {
    expect(must(parseAmountCents("1000000.00"))).toBe(100_000_000);
    expect(must(parseAmountCents("1000000"))).toBe(100_000_000);
    const r = parseAmountCents("1000000.01");
    expect(r.ok ? "ok" : r.error.code).toBe("TOO_LARGE");
    expect(must(parseAmountCents("999999.99"))).toBe(99_999_999);
  });

  it("very long whole parts are TOO_LARGE rather than a wrong number or an exception", () => {
    const huge = "9".repeat(400);
    const r = parseAmountCents(huge);
    expect(r.ok ? "ok" : r.error.code).toBe("TOO_LARGE");
    const r2 = parseAmountCents("1" + "0".repeat(30) + ".00");
    expect(r2.ok ? "ok" : r2.error.code).toBe("TOO_LARGE");
    const r3 = parseAmountCents("0".repeat(500) + "12.5");
    expect(must(r3)).toBe(1250);
  });

  it("amount parse matches an exact digit-string oracle on random inputs", () => {
    fc.assert(
      fc.property(fc.nat(999_999), fc.nat(99), (whole, frac) => {
        const text = `${whole}.${String(frac).padStart(2, "0")}`;
        const expected = whole * 100 + frac;
        const r = parseAmountCents(text);
        if (expected === 0) return !r.ok && r.error.code === "ZERO";
        return r.ok && r.value === expected;
      }),
      RUNS,
    );
  });

  it("never loses precision on 0.29 style inputs", () => {
    for (let c = 1; c <= 999; c++) {
      const text = `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
      expect(must(parseAmountCents(text))).toBe(c);
    }
    expect(must(parseAmountCents("0.29"))).toBe(29);
    expect(must(parseAmountCents("1.15"))).toBe(115);
    expect(must(parseAmountCents("4.35"))).toBe(435);
  });

  it("custom maxCents is honoured", () => {
    expect(must(parseAmountCents("5.00", 500))).toBe(500);
    const r = parseAmountCents("5.01", 500);
    expect(r.ok ? "ok" : r.error.code).toBe("TOO_LARGE");
  });

  it("error precedence: non-numeric before everything, negative before decimals, decimals before zero and cap", () => {
    expect((parseAmountCents("-1.234") as { error: { code: string } }).error.code).toBe("NEGATIVE");
    expect((parseAmountCents("0.000") as { error: { code: string } }).error.code).toBe("TOO_MANY_DECIMALS");
    expect((parseAmountCents("2000000.001") as { error: { code: string } }).error.code).toBe("TOO_MANY_DECIMALS");
  });
});

describe("percent grammar", () => {
  it("accepts 0 to 100 with up to 2 decimals", () => {
    expect(must(parsePercentBps("0"))).toBe(0);
    expect(must(parsePercentBps("0.00"))).toBe(0);
    expect(must(parsePercentBps("0.01"))).toBe(1);
    expect(must(parsePercentBps("33.33"))).toBe(3333);
    expect(must(parsePercentBps("33.3"))).toBe(3330);
    expect(must(parsePercentBps(" 100 "))).toBe(10000);
    expect(must(parsePercentBps("100.00"))).toBe(10000);
    expect(must(parsePercentBps("00100.0"))).toBe(10000);
  });

  it("precedence: non-numeric, negative, decimals, above 100", () => {
    const c = (t: string) => {
      const r = parsePercentBps(t);
      return r.ok ? "ok" : r.error.code;
    };
    expect(c("abc")).toBe("NOT_NUMERIC");
    expect(c("-0")).toBe("NEGATIVE");
    expect(c("-0.00")).toBe("NEGATIVE");
    expect(c("-150.001")).toBe("NEGATIVE");
    expect(c("150.001")).toBe("TOO_MANY_DECIMALS");
    expect(c("100.001")).toBe("TOO_MANY_DECIMALS");
    expect(c("100.01")).toBe("ABOVE_100");
    expect(c("101")).toBe("ABOVE_100");
    expect(c("9".repeat(300))).toBe("ABOVE_100");
    expect(c("0.000")).toBe("TOO_MANY_DECIMALS");
    expect(c("")).toBe("EMPTY");
    expect(c("   ")).toBe("EMPTY");
  });

  it("matches a digit-string oracle on random inputs", () => {
    fc.assert(
      fc.property(fc.nat(120), fc.nat(99), (whole, frac) => {
        const text = `${whole}.${String(frac).padStart(2, "0")}`;
        const bps = whole * 100 + frac;
        const r = parsePercentBps(text);
        if (bps > 10000) return !r.ok && r.error.code === "ABOVE_100";
        return r.ok && r.value === bps;
      }),
      RUNS,
    );
  });
});

describe("formatting", () => {
  it("formatCents grouping boundaries", () => {
    const cases: [number, string][] = [
      [0, "$0.00"],
      [1, "$0.01"],
      [5, "$0.05"],
      [99, "$0.99"],
      [100, "$1.00"],
      [99999, "$999.99"],
      [100000, "$1,000.00"],
      [100001, "$1,000.01"],
      [99999999, "$999,999.99"],
      [100000000, "$1,000,000.00"],
      [100000001, "$1,000,000.01"],
      [123456789012, "$1,234,567,890.12"],
      [-1, "-$0.01"],
      [-100000, "-$1,000.00"],
      [-100000000, "-$1,000,000.00"],
    ];
    for (const [c, s] of cases) expect(formatCents(c)).toBe(s);
  });

  it("formatCents(-0) is never negative zero text", () => {
    expect(formatCents(-0)).toBe("$0.00");
    expect(formatCents(0)).toBe("$0.00");
    expect(describeBalance(-0).text).toBe("settled");
  });

  it("formatCents throws on non-integers and NaN rather than printing them", () => {
    for (const bad of [NaN, Infinity, -Infinity, 0.5, 0.1 + 0.2, 1e300, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => formatCents(bad)).toThrow();
      expect(() => formatBps(bad)).toThrow();
    }
  });

  it("formatCents round-trips through parseAmountCents for any cap-sized value", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), (c) => {
        const text = formatCents(c).replace("$", "").replace(/,/g, "");
        return must(parseAmountCents(text)) === c;
      }),
      RUNS,
    );
  });

  it("formatCents output never contains NaN, e-notation, or float artifacts", () => {
    fc.assert(
      fc.property(fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }), (c) => {
        const s = formatCents(c);
        return /^-?\$\d{1,3}(,\d{3})*\.\d{2}$/.test(s) && s !== "-$0.00";
      }),
      RUNS,
    );
  });

  it("formatBps boundaries", () => {
    expect(formatBps(0)).toBe("0.00");
    expect(formatBps(1)).toBe("0.01");
    expect(formatBps(10)).toBe("0.10");
    expect(formatBps(100)).toBe("1.00");
    expect(formatBps(9999)).toBe("99.99");
    expect(formatBps(10000)).toBe("100.00");
    expect(formatBps(3334)).toBe("33.34");
    expect(formatPercent(1)).toBe("0.01%");
  });

  it("formatBps and parsePercentBps round-trip", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (b) => must(parsePercentBps(formatBps(b))) === b),
      RUNS,
    );
  });

  it("totalLineText exact wording", () => {
    expect(totalLineText(9000)).toBe("Total 90.00%. 10.00% still unassigned.");
    expect(totalLineText(10500)).toBe("Total 105.00%. 5.00% over.");
    expect(totalLineText(10000)).toBe("Total 100.00%.");
    expect(totalLineText(0)).toBe("Total 0.00%. 100.00% still unassigned.");
    expect(totalLineText(9999)).toBe("Total 99.99%. 0.01% still unassigned.");
    expect(totalLineText(10001)).toBe("Total 100.01%. 0.01% over.");
  });

  it("describeBalance wording", () => {
    expect(describeBalance(6000)).toEqual({ kind: "owed", text: "is owed $60.00" });
    expect(describeBalance(-3000)).toEqual({ kind: "owes", text: "owes $30.00" });
    expect(describeBalance(0)).toEqual({ kind: "settled", text: "settled" });
  });
});

describe("apportion", () => {
  it("sums exactly, never negative, deterministic, for random weights including zeros", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 15 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const a = apportion(total, weights);
          const b = apportion(total, weights);
          expect(a).toEqual(b);
          expect(a.reduce((x, y) => x + y, 0)).toBe(total);
          expect(a.every((s) => Number.isInteger(s) && s >= 0)).toBe(true);
          // zero weights never receive cents
          weights.forEach((w, i) => {
            if (w === 0) expect(a[i]).toBe(0);
          });
          // each share is within 1 of the exact proportional value
          const sum = weights.reduce((x, y) => x + y, 0);
          weights.forEach((w, i) => {
            const exact = (total * w) / sum;
            expect(Math.abs(a[i] - exact)).toBeLessThan(1 + 1e-9);
          });
        },
      ),
      { numRuns: 600 },
    );
  });

  it("single weight gets everything", () => {
    expect(apportion(12345, [7])).toEqual([12345]);
    expect(apportion(0, [7])).toEqual([0]);
    expect(apportion(1, [1])).toEqual([1]);
  });

  it("total 0 and 1", () => {
    expect(apportion(0, [1, 1, 1])).toEqual([0, 0, 0]);
    expect(apportion(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(apportion(1, [0, 1, 1])).toEqual([0, 1, 0]);
    expect(apportion(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("ties go to the lowest index", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(5, [1, 1, 1, 1])).toEqual([2, 1, 1, 1]);
    expect(apportion(10, [1, 1, 1, 1, 1, 1, 1])).toEqual([2, 2, 2, 1, 1, 1, 1]);
  });

  it("largest remainder, not largest weight, wins leftover cents", () => {
    // 10 * [3334, 3333, 3333] / 10000: remainders 3340*... check explicit hand values
    // weights 5,3,2 total 7: exact 3.5, 2.1, 1.4 -> floors 3,2,1 leftover 1 -> goes to remainder .5
    expect(apportion(7, [5, 3, 2])).toEqual([4, 2, 1]);
    // exact 1.2, 1.2, 1.6 -> floors 1,1,1 leftover 1 -> index 2
    expect(apportion(4, [3, 3, 4])).toEqual([1, 1, 2]);
  });

  it("matches a brute-force BigInt oracle", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 9999 }), { minLength: 1, maxLength: 8 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const sum = weights.reduce((x, y) => x + y, 0);
          const rem = weights.map((w) => (total * w) % sum);
          const floors = weights.map((w) => Math.floor((total * w) / sum));
          let left = total - floors.reduce((x, y) => x + y, 0);
          const idx = weights.map((_, i) => i).sort((p, q) => rem[q] - rem[p] || p - q);
          const out = [...floors];
          for (const i of idx) {
            if (left-- > 0) out[i]++;
          }
          expect(apportion(total, weights)).toEqual(out);
        },
      ),
      { numRuns: 600 },
    );
  });

  it("is exact at the cap with 10000 bps", () => {
    const s = apportion(100_000_000, [3333, 3333, 3334]);
    expect(s.reduce((a, b) => a + b, 0)).toBe(100_000_000);
  });

  it("throws on programmer errors", () => {
    expect(() => apportion(-1, [1])).toThrow();
    expect(() => apportion(1.5, [1])).toThrow();
    expect(() => apportion(1, [-1, 2])).toThrow();
    expect(() => apportion(1, [0, 0])).toThrow();
    expect(() => apportion(1, [])).toThrow();
    expect(() => apportion(1, [NaN])).toThrow();
  });
});

describe("even split", () => {
  it("$0.01 among 3 goes to the first participant in member order", () => {
    const s = stateWith(3);
    const e = even("1", 1, "m2", ["m0", "m1", "m2"]);
    const alloc = must(allocateExpense(e, s.members));
    expect(alloc).toEqual([
      { memberId: "m0", cents: 1 },
      { memberId: "m1", cents: 0 },
      { memberId: "m2", cents: 0 },
    ]);
  });

  it("$100.00 among 3 with participants listed out of member order still gives 33.34 to the first member", () => {
    const s = stateWith(3);
    const e = even("1", 10000, "m0", ["m2", "m1", "m0"]);
    const alloc = must(allocateExpense(e, s.members));
    expect(alloc.map((a) => a.memberId)).toEqual(["m0", "m1", "m2"]);
    expect(alloc.map((a) => a.cents)).toEqual([3334, 3333, 3333]);
  });

  it("subset of participants not first in member order: leftover goes to the earliest of the subset", () => {
    const s = stateWith(5);
    const e = even("1", 10000, "m0", ["m4", "m2", "m3"]);
    const alloc = must(allocateExpense(e, s.members));
    expect(alloc).toEqual([
      { memberId: "m2", cents: 3334 },
      { memberId: "m3", cents: 3333 },
      { memberId: "m4", cents: 3333 },
    ]);
  });

  it("payer who is not a participant is credited the full amount and owes nothing", () => {
    const st = stateWith(3, [even("1", 1000, "m0", ["m1", "m2"])]);
    const nets = must(computeBalances(st)).map((b) => b.netCents);
    expect(nets).toEqual([1000, -500, -500]);
  });

  it("payer as sole participant creates no debt", () => {
    const st = stateWith(3, [even("1", 1234, "m1", ["m1"])]);
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([0, 0, 0]);
    const sum = must(summarize(st));
    expect(sum.plan).toEqual([]);
    expect(sum.allSettled).toBe(true);
  });

  it("floor plus leftover property for random amounts and participant subsets", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 2, max: 8 }),
        fc.shuffledSubarray(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"], { minLength: 1 }),
        (amount, n, parts) => {
          const ms = members(n);
          const ids = parts.filter((p) => ms.some((m) => m.id === p));
          fc.pre(ids.length > 0);
          const e = even("1", amount, "m0", ids);
          const alloc = must(allocateExpense(e, ms));
          const k = ids.length;
          const base = Math.floor(amount / k);
          const extra = amount - base * k;
          const orderedIds = ms.filter((m) => ids.includes(m.id)).map((m) => m.id);
          expect(alloc.map((a) => a.memberId)).toEqual(orderedIds);
          alloc.forEach((a, i) => expect(a.cents).toBe(base + (i < extra ? 1 : 0)));
        },
      ),
      RUNS,
    );
  });
});

describe("percent split", () => {
  it("33.33 / 33.33 / 33.34 on $100 sums to the amount", () => {
    const ms = members(3);
    const e = pct("1", 10000, "m0", [["m0", 3333], ["m1", 3333], ["m2", 3334]]);
    const alloc = must(allocateExpense(e, ms));
    expect(alloc.reduce((a, b) => a + b.cents, 0)).toBe(10000);
    expect(alloc.map((a) => a.cents)).toEqual([3333, 3333, 3334]);
  });

  it("33.33 x 3 is rejected as 99.99% with expected 10000 and actual 9999", () => {
    const ms = members(3);
    const e = pct("1", 10000, "m0", [["m0", 3333], ["m1", 3333], ["m2", 3333]]);
    const r = validateExpense(e, ms);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PERCENT_SUM_MISMATCH");
      if (r.error.code === "PERCENT_SUM_MISMATCH") {
        expect(r.error.expected).toBe(10000);
        expect(r.error.actual).toBe(9999);
      }
    }
  });

  it("over-sum reports actual above 10000", () => {
    const ms = members(2);
    const r = validateExpense(pct("1", 100, "m0", [["m0", 6000], ["m1", 4001]]), ms);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "PERCENT_SUM_MISMATCH") {
      expect(r.error.actual).toBe(10001);
    } else {
      throw new Error("expected PERCENT_SUM_MISMATCH");
    }
  });

  it("bps [15000, -5000] is rejected even though it sums to 10000", () => {
    const ms = members(2);
    const r = validateExpense(pct("1", 100, "m0", [["m0", 15000], ["m1", -5000]]), ms);
    expect(r.ok).toBe(false);
    const r2 = validateExpense(pct("1", 100, "m0", [["m1", -5000], ["m0", 15000]]), ms);
    expect(r2.ok).toBe(false);
    const r3 = validateExpense(pct("1", 100, "m0", [["m0", 10001], ["m1", -1]]), ms);
    expect(r3.ok).toBe(false);
  });

  it("zero, fractional, NaN, Infinity and oversized stored bps are rejected", () => {
    const ms = members(3);
    for (const bad of [0, 0.5, NaN, Infinity, -Infinity, 10001, 1e20]) {
      const r = validateExpense(pct("1", 100, "m0", [["m0", 10000 - 1], ["m1", bad]]), ms);
      expect(r.ok).toBe(false);
    }
    expect(validateExpense(pct("1", 100, "m0", [["m0", 5000], ["m1", 5000], ["m2", 0]]), ms).ok).toBe(false);
  });

  it("100/0 stored as a single 10000 share is valid and gives the payer-excluded member everything", () => {
    const ms = members(2);
    const e = pct("1", 777, "m0", [["m1", 10000]]);
    expect(must(allocateExpense(e, ms))).toEqual([{ memberId: "m1", cents: 777 }]);
  });

  it("duplicate member in shares is rejected even if bps sum to 10000", () => {
    const ms = members(2);
    expect(validateExpense(pct("1", 100, "m0", [["m0", 5000], ["m0", 5000]]), ms).ok).toBe(false);
  });

  it("empty shares are rejected", () => {
    expect(validateExpense(pct("1", 100, "m0", []), members(2)).ok).toBe(false);
  });

  it("0.01 percent shares: 1 bps among 9999 bps", () => {
    const ms = members(2);
    const e = pct("1", 1_000_000, "m0", [["m0", 1], ["m1", 9999]]);
    const alloc = must(allocateExpense(e, ms));
    expect(alloc.map((a) => a.cents)).toEqual([100, 999_900]);
  });

  it("0.01 percent share of $0.01 rounds by largest remainder", () => {
    const ms = members(2);
    const e = pct("1", 1, "m0", [["m0", 1], ["m1", 9999]]);
    expect(must(allocateExpense(e, ms)).map((a) => a.cents)).toEqual([0, 1]);
  });

  it("remainder ties go to member order even when shares are listed out of order", () => {
    const ms = members(3);
    // $0.02, 50/25/25 -> exact 1.00, .50, .50 -> leftover 0 ... use $0.03: 1.5,.75,.75
    const e = pct("1", 3, "m0", [["m2", 2500], ["m1", 2500], ["m0", 5000]]);
    const alloc = must(allocateExpense(e, ms));
    expect(alloc.map((a) => a.memberId)).toEqual(["m0", "m1", "m2"]);
    expect(alloc.reduce((a, b) => a + b.cents, 0)).toBe(3);
    // floors 1,0,0; leftover 2 go to remainders .5(m0),.75(m1),.75(m2) -> m1 and m2 tie, m1 first
    expect(alloc.map((a) => a.cents)).toEqual([1, 1, 1]);
  });

  it("random valid percent splits always sum to the amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 }),
        (amount, raw) => {
          const total = raw.reduce((a, b) => a + b, 0);
          const bps = raw.map((r) => Math.max(1, Math.floor((r * 10000) / total)));
          let diff = 10000 - bps.reduce((a, b) => a + b, 0);
          // fix up to exactly 10000
          let i = 0;
          while (diff !== 0) {
            const j = i++ % bps.length;
            if (diff > 0) {
              bps[j]++;
              diff--;
            } else if (bps[j] > 1) {
              bps[j]--;
              diff++;
            }
          }
          const ms = members(bps.length);
          const e = pct("1", amount, "m0", bps.map((b, k) => [`m${k}`, b] as [string, number]));
          const alloc = must(allocateExpense(e, ms));
          expect(alloc.reduce((a, b) => a + b.cents, 0)).toBe(amount);
          expect(alloc.every((a) => a.cents >= 0)).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("50/30/20 of $60.00 is 30.00, 18.00, 12.00", () => {
    const ms = members(3);
    const e = pct("1", 6000, "m0", [["m0", 5000], ["m1", 3000], ["m2", 2000]]);
    expect(must(allocateExpense(e, ms)).map((a) => a.cents)).toEqual([3000, 1800, 1200]);
  });
});

describe("expense and payment validation", () => {
  const ms = members(3);

  it("amount bounds", () => {
    const base = (amt: number) => even("1", amt, "m0", ["m0", "m1"]);
    expect(validateExpense(base(1), ms).ok).toBe(true);
    expect(validateExpense(base(100_000_000), ms).ok).toBe(true);
    for (const bad of [0, -1, 100_000_001, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2 ** 60]) {
      expect(code(validateExpense(base(bad), ms))).toBe("INVALID_AMOUNT");
    }
  });

  it("unknown payer and unknown participant", () => {
    expect(code(validateExpense(even("1", 100, "zzz", ["m0"]), ms))).toBe("UNKNOWN_MEMBER");
    expect(code(validateExpense(even("1", 100, "m0", ["m0", "zzz"]), ms))).toBe("UNKNOWN_MEMBER");
    expect(code(validateExpense(pct("1", 100, "m0", [["zzz", 10000]]), ms))).toBe("UNKNOWN_MEMBER");
  });

  it("empty and duplicate participants", () => {
    expect(code(validateExpense(even("1", 100, "m0", []), ms))).toBe("INVALID_SPLIT");
    expect(code(validateExpense(even("1", 100, "m0", ["m0", "m0"]), ms))).toBe("INVALID_SPLIT");
    expect(code(validateExpense(even("1", 100, "m0", ["m1", "m0", "m1"]), ms))).toBe("INVALID_SPLIT");
  });

  it("proto-named ids do not slip through as members", () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(code(validateExpense(even("1", 100, id, ["m0"]), ms))).toBe("UNKNOWN_MEMBER");
      expect(code(validateExpense(even("1", 100, "m0", [id]), ms))).toBe("UNKNOWN_MEMBER");
      expect(code(validatePayment(pay("p", id, "m0", 100), ms))).toBe("UNKNOWN_MEMBER");
    }
  });

  it("payment: from equals to, non-positive, non-integer, unknown", () => {
    expect(code(validatePayment(pay("p", "m0", "m0", 100), ms))).toBe("SAME_MEMBER");
    for (const bad of [0, -1, -100, 0.5, 1.0000001, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(code(validatePayment(pay("p", "m0", "m1", bad), ms))).toBe("INVALID_AMOUNT");
    }
    expect(code(validatePayment(pay("p", "m0", "zzz", 100), ms))).toBe("UNKNOWN_MEMBER");
    expect(code(validatePayment(pay("p", "zzz", "m0", 100), ms))).toBe("UNKNOWN_MEMBER");
  });

  it("payments above the expense cap are allowed", () => {
    expect(validatePayment(pay("p", "m0", "m1", 100_000_001), ms).ok).toBe(true);
    expect(validatePayment(pay("p", "m0", "m1", Number.MAX_SAFE_INTEGER), ms).ok).toBe(true);
    const st = stateWith(3);
    const added = must(addPayment(st, pay("p", "m0", "m1", 5_000_000_000)));
    expect(must(computeBalances(added)).map((b) => b.netCents)).toEqual([5_000_000_000, -5_000_000_000, 0]);
  });

  it("addExpense with fewer than 2 members is NOT_ENOUGH_MEMBERS", () => {
    const one: Group = { members: members(1), expenses: [], payments: [] };
    expect(code(addExpense(one, even("1", 100, "m0", ["m0"])))).toBe("NOT_ENOUGH_MEMBERS");
    expect(code(addExpense(emptyState(), even("1", 100, "m0", ["m0"])))).toBe("NOT_ENOUGH_MEMBERS");
  });

  it("addExpense with exactly 2 members works", () => {
    const two = stateWith(2);
    expect(addExpense(two, even("1", 100, "m0", ["m0", "m1"])).ok).toBe(true);
  });

  it("failed adds leave the state untouched", () => {
    const st = stateWith(3);
    const before = JSON.stringify(st);
    addExpense(st, even("1", 0, "m0", ["m0"]));
    addPayment(st, pay("p", "m0", "m0", 5));
    expect(JSON.stringify(st)).toBe(before);
  });

  it("duplicate expense and payment ids are refused", () => {
    const st = must(addExpense(stateWith(3), even("1", 100, "m0", ["m0", "m1"])));
    expect(code(addExpense(st, even("1", 100, "m0", ["m0", "m1"])))).toBe("DUPLICATE_ID");
    const sp = must(addPayment(st, pay("p", "m0", "m1", 5)));
    expect(code(addPayment(sp, pay("p", "m1", "m0", 5)))).toBe("DUPLICATE_ID");
  });
});

describe("settlement", () => {
  function bal(entries: [string, number][]): Balance[] {
    return entries.map(([name, netCents]) => ({ memberId: name.toLowerCase(), name, netCents }));
  }

  it("the 5-person spec example gives exactly the greedy 4 transfers", () => {
    const b = bal([["A", 1000], ["B", 900], ["C", -900], ["D", -600], ["E", -400]]);
    expect(buildSettlementPlan(b)).toEqual([
      { from: "c", to: "a", amountCents: 900 },
      { from: "d", to: "b", amountCents: 600 },
      { from: "e", to: "b", amountCents: 300 },
      { from: "e", to: "a", amountCents: 100 },
    ]);
  });

  it("random zero-sum nets: settles everything, bounded, no zero or self transfers, deterministic", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -100000, max: 100000 }), { minLength: 1, maxLength: 12 }), (raw) => {
        const nets = [...raw];
        // force zero sum by adjusting the last element
        const head = nets.slice(0, -1);
        const last = 0 - head.reduce((a, b) => a + b, 0);
        const final = nets.length === 1 ? [0] : [...head, last];
        const balances: Balance[] = final.map((n, i) => ({ memberId: `m${i}`, name: names[i], netCents: n }));
        const plan = buildSettlementPlan(balances);
        const again = buildSettlementPlan(balances);
        expect(plan).toEqual(again);
        const k = final.filter((n) => n !== 0).length;
        expect(plan.length).toBeLessThanOrEqual(Math.max(0, k - 1));
        for (const t of plan) {
          expect(t.amountCents).toBeGreaterThan(0);
          expect(Number.isInteger(t.amountCents)).toBe(true);
          expect(t.from).not.toBe(t.to);
        }
        for (const v of applyPlan(balances, plan).values()) expect(v).toBe(0);
      }),
      { numRuns: 600 },
    );
  });

  it("does not mutate its input", () => {
    const b = bal([["A", 500], ["B", -500]]);
    const copy = JSON.stringify(b);
    buildSettlementPlan(b);
    expect(JSON.stringify(b)).toBe(copy);
  });

  it("ties among equal creditors and debtors are broken by lowercase name, not input order or case", () => {
    const b: Balance[] = [
      { memberId: "z", name: "Zed", netCents: 100 },
      { memberId: "b", name: "bob", netCents: 100 },
      { memberId: "a", name: "Alice", netCents: 100 },
      { memberId: "y", name: "yan", netCents: -100 },
      { memberId: "c", name: "Cat", netCents: -100 },
      { memberId: "d", name: "Dan", netCents: -100 },
    ];
    // debtors by lowercase name: cat, dan, yan ; creditors: alice, bob, zed
    expect(buildSettlementPlan(b)).toEqual([
      { from: "c", to: "a", amountCents: 100 },
      { from: "d", to: "b", amountCents: 100 },
      { from: "y", to: "z", amountCents: 100 },
    ]);
  });

  it("uppercase letters do not sort before lowercase when breaking ties", () => {
    const b: Balance[] = [
      { memberId: "1", name: "alice", netCents: 50 },
      { memberId: "2", name: "Bob", netCents: 50 },
      { memberId: "3", name: "Carol", netCents: -100 },
    ];
    expect(buildSettlementPlan(b)).toEqual([
      { from: "3", to: "1", amountCents: 50 },
      { from: "3", to: "2", amountCents: 50 },
    ]);
  });

  it("plan order does not depend on input order for distinct amounts", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5 }), (perm) => {
        const base: Balance[] = [
          { memberId: "a", name: "A", netCents: 1000 },
          { memberId: "b", name: "B", netCents: 900 },
          { memberId: "c", name: "C", netCents: -900 },
          { memberId: "d", name: "D", netCents: -600 },
          { memberId: "e", name: "E", netCents: -400 },
        ];
        const shuffled = perm.map((i) => base[i]);
        expect(buildSettlementPlan(shuffled)).toEqual(buildSettlementPlan(base));
      }),
      RUNS,
    );
  });

  it("mutual debts net out and chains collapse via summarize", () => {
    // m0 owes m1 and m1 owes m2 equally: chain collapses to m0 owes m2
    const st = stateWith(3, [
      even("1", 1000, "m1", ["m0"]),
      even("2", 1000, "m2", ["m1"]),
    ]);
    const s = must(summarize(st));
    expect(s.plan).toEqual([{ from: "m0", to: "m2", amountCents: 1000 }]);
    expect(s.balances.map((b) => b.netCents)).toEqual([-1000, 0, 1000]);
  });

  it("all settled yields no plan and allSettled true", () => {
    const s = must(summarize(stateWith(3)));
    expect(s.plan).toEqual([]);
    expect(s.allSettled).toBe(true);
  });

  it("does not generate a transfer when only zero balances remain after rounding to nothing", () => {
    const st = stateWith(3, [even("1", 3, "m0", ["m0", "m1", "m2"])]);
    const s = must(summarize(st));
    for (const t of s.plan) expect(t.amountCents).toBeGreaterThan(0);
  });
});

describe("ledger and sign conventions", () => {
  it("demo script numbers", () => {
    let st = stateWith(3);
    st = must(addExpense(st, even("1", 9000, "m0", ["m0", "m1", "m2"])));
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([6000, -3000, -3000]);
    st = must(addExpense(st, pct("2", 6000, "m1", [["m0", 5000], ["m1", 3000], ["m2", 2000]])));
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([3000 + 0, 1200, -4200].map((x, i) => x));
    const plan = must(summarize(st)).plan;
    expect(plan).toEqual([
      { from: "m2", to: "m0", amountCents: 3000 },
      { from: "m2", to: "m1", amountCents: 1200 },
    ]);
    st = must(addPayment(st, pay("p1", "m2", "m1", 1200)));
    const after = must(summarize(st));
    expect(after.balances.map((b) => b.netCents)).toEqual([3000, 0, -3000]);
    expect(after.plan).toEqual([{ from: "m2", to: "m0", amountCents: 3000 }]);
  });

  it("a payment from the debtor to the creditor reduces the debt", () => {
    let st = stateWith(2, [even("1", 3000, "m0", ["m1"])]);
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([3000, -3000]);
    st = must(addPayment(st, pay("p", "m1", "m0", 1000)));
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([2000, -2000]);
    st = must(addPayment(st, pay("q", "m1", "m0", 2000)));
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([0, 0]);
  });

  it("a payment in the wrong direction increases the debt", () => {
    let st = stateWith(2, [even("1", 3000, "m0", ["m1"])]);
    st = must(addPayment(st, pay("p", "m0", "m1", 1000)));
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([4000, -4000]);
  });

  it("deleting the dinner after the full payment flips the balance", () => {
    let st = stateWith(2, [even("1", 3000, "m0", ["m1"])]);
    st = must(addPayment(st, pay("p", "m1", "m0", 3000)));
    expect(must(summarize(st)).allSettled).toBe(true);
    st = must(deleteExpense(st, "1"));
    const s = must(summarize(st));
    expect(s.balances.map((b) => b.netCents)).toEqual([-3000, 3000]);
    expect(s.plan).toEqual([{ from: "m0", to: "m1", amountCents: 3000 }]);
    expect(st.payments).toHaveLength(1);
  });

  it("deleting a payment restores the debt", () => {
    let st = stateWith(2, [even("1", 3000, "m0", ["m1"])]);
    st = must(addPayment(st, pay("p", "m1", "m0", 3000)));
    st = must(deletePayment(st, "p"));
    expect(must(computeBalances(st)).map((b) => b.netCents)).toEqual([3000, -3000]);
    expect(code(deletePayment(st, "p"))).toBe("NOT_FOUND");
    expect(code(deleteExpense(st, "nope"))).toBe("NOT_FOUND");
  });

  it("random sequences: nets sum to zero and the plan zeroes every net within the bound", () => {
    const op = fc.oneof(
      fc.record({
        t: fc.constant("e" as const),
        amt: fc.integer({ min: 1, max: 100_000_000 }),
        payer: fc.nat(5),
        parts: fc.shuffledSubarray([0, 1, 2, 3, 4, 5], { minLength: 1 }),
      }),
      fc.record({
        t: fc.constant("pe" as const),
        amt: fc.integer({ min: 1, max: 100_000_000 }),
        payer: fc.nat(5),
        raw: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 6, maxLength: 6 }),
      }),
      fc.record({
        t: fc.constant("p" as const),
        amt: fc.integer({ min: 1, max: 1_000_000_000 }),
        from: fc.nat(5),
        to: fc.nat(5),
      }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
        let st = stateWith(6);
        ops.forEach((o, i) => {
          if (o.t === "e") {
            const r = addExpense(st, even(`e${i}`, o.amt, `m${o.payer}`, o.parts.map((p) => `m${p}`)));
            if (r.ok) st = r.value;
          } else if (o.t === "pe") {
            const total = o.raw.reduce((a, b) => a + b, 0);
            const bps = o.raw.map((x) => Math.max(1, Math.floor((x * 10000) / total)));
            bps[0] += 10000 - bps.reduce((a, b) => a + b, 0);
            const r = addExpense(
              st,
              pct(`e${i}`, o.amt, `m${o.payer}`, bps.map((b, k) => [`m${k}`, b] as [string, number])),
            );
            if (r.ok) st = r.value;
          } else {
            const r = addPayment(st, pay(`p${i}`, `m${o.from}`, `m${o.to}`, o.amt));
            if (r.ok) st = r.value;
          }
        });
        const balances = must(computeBalances(st));
        expect(balances.reduce((a, b) => a + b.netCents, 0)).toBe(0);
        const s = must(summarize(st));
        const k = balances.filter((b) => b.netCents !== 0).length;
        expect(s.plan.length).toBeLessThanOrEqual(Math.max(0, k - 1));
        for (const v of applyPlan(balances, s.plan).values()) expect(v).toBe(0);
        expect(s.allSettled).toBe(k === 0);
        expect(summarize(st)).toEqual(summarize(JSON.parse(JSON.stringify(st))));
      }),
      { numRuns: 500 },
    );
  });

  // BUG: payments are only checked one at a time, so their running total can leave the safe
  // integer range, which breaks "nets sum to zero" for a valid sequence of payments.
  it("payments summing past the safe integer range still keep nets exact and zero-sum", () => {
    const M = Number.MAX_SAFE_INTEGER;
    let st = stateWith(4);
    st = must(addPayment(st, pay("p1", "m0", "m1", M)));
    // m0's net would already be 2 * MAX_SAFE_INTEGER, so refusing p2 (or p3) keeps nets exact.
    const r2 = addPayment(st, pay("p2", "m0", "m2", M));
    if (!r2.ok) return;
    st = r2.value;
    const r3 = addPayment(st, pay("p3", "m0", "m3", 1));
    if (!r3.ok) return; // refusing the payment is an acceptable way to preserve the invariant
    st = r3.value;
    const bal = computeBalances(st);
    if (!bal.ok) return;
    const sum = bal.value.reduce((a, b) => a + BigInt(b.netCents), 0n);
    expect(sum).toBe(0n);
    for (const b of bal.value) expect(Number.isSafeInteger(b.netCents)).toBe(true);
  });

  it("stored state whose totals leave the safe integer range is rejected whole", () => {
    const M = Number.MAX_SAFE_INTEGER;
    const st = {
      members: [0, 1, 2, 3].map((i) => ({ id: `m${i}`, name: `Member${i}` })),
      expenses: [],
      payments: [
        { id: "p1", from: "m0", to: "m1", amountCents: M },
        { id: "p2", from: "m0", to: "m2", amountCents: M },
        { id: "p3", from: "m0", to: "m3", amountCents: 1 },
      ],
    };
    expect(deserializeState(JSON.stringify(st)).ok).toBe(false);
    expect(computeBalances(st).ok).toBe(false);
  });
});

describe("group transitions", () => {
  it("normalizeName trims and collapses whitespace", () => {
    expect(normalizeName("  Mary   Jane \t Watson\n")).toBe("Mary Jane Watson");
    expect(normalizeName("   ")).toBe("");
  });

  it("duplicate names differing by case or whitespace are rejected", () => {
    let st = must(addMember(emptyState(), "1", "Alice"));
    for (const dup of ["alice", "ALICE", "  alice ", "aLiCe\t"]) {
      expect(code(addMember(st, "2", dup))).toBe("DUPLICATE_NAME");
    }
    st = must(addMember(st, "2", "Mary Jane"));
    expect(code(addMember(st, "3", "mary    jane"))).toBe("DUPLICATE_NAME");
    expect(code(addMember(st, "3", " MARY\tJANE "))).toBe("DUPLICATE_NAME");
    expect(code(addMember(st, "3", "MaryJane"))).toBeUndefined();
  });

  it("stored name is the normalized form", () => {
    const st = must(addMember(emptyState(), "1", "  Mary    Jane  "));
    expect(st.members[0].name).toBe("Mary Jane");
  });

  it("empty and whitespace-only names", () => {
    for (const t of ["", " ", "\t\n  "]) expect(code(addMember(emptyState(), "1", t))).toBe("EMPTY_NAME");
  });

  it("40 characters pass, 41 fail, measured after normalization", () => {
    expect(addMember(emptyState(), "1", "a".repeat(40)).ok).toBe(true);
    expect(code(addMember(emptyState(), "1", "a".repeat(41)))).toBe("NAME_TOO_LONG");
    // 40 chars after collapsing runs of spaces, even though raw text is longer
    const raw = `  ${"a".repeat(19)}      ${"b".repeat(20)}   `;
    expect(normalizeName(raw).length).toBe(40);
    expect(addMember(emptyState(), "1", raw).ok).toBe(true);
    const raw41 = `${"a".repeat(20)}   ${"b".repeat(20)}`;
    expect(code(addMember(emptyState(), "1", raw41))).toBe("NAME_TOO_LONG");
  });

  it("duplicate member id is refused", () => {
    const st = must(addMember(emptyState(), "1", "Alice"));
    expect(code(addMember(st, "1", "Bob"))).toBe("DUPLICATE_ID");
  });

  it("validateMemberName works on its own", () => {
    expect(must(validateMemberName("  Zoe ", []))).toBe("Zoe");
  });

  it("removing a referenced member is blocked with exact messages and pluralization", () => {
    let st = stateWith(3);
    st = must(addExpense(st, even("1", 100, "m0", ["m0", "m1"])));
    st = must(addExpense(st, even("2", 100, "m1", ["m0"])));
    st = must(addPayment(st, pay("p", "m2", "m0", 100)));
    const r = removeMember(st, "m0");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MEMBER_IN_USE");
      expect(r.error.message).toBe("Alice is used by 2 expenses and 1 payment.");
      if (r.error.code === "MEMBER_IN_USE") {
        expect(r.error.expenseCount).toBe(2);
        expect(r.error.paymentCount).toBe(1);
      }
    }
  });

  it("counts each referencing record once even when payer and participant", () => {
    const st = stateWith(2, [even("1", 100, "m0", ["m0", "m1"])]);
    const r = removeMember(st, "m0");
    expect(!r.ok && r.error.message).toBe("Alice is used by 1 expense.");
  });

  it("payment-only references use singular and plural correctly", () => {
    let st = stateWith(2);
    st = must(addPayment(st, pay("p1", "m0", "m1", 5)));
    expect((removeMember(st, "m0") as { error: { message: string } }).error.message).toBe(
      "Alice is used by 1 payment.",
    );
    st = must(addPayment(st, pay("p2", "m1", "m0", 5)));
    expect((removeMember(st, "m0") as { error: { message: string } }).error.message).toBe(
      "Alice is used by 2 payments.",
    );
    expect((removeMember(st, "m1") as { error: { message: string } }).error.message).toBe(
      "Bob is used by 2 payments.",
    );
  });

  it("a percent member at 0.00 is not stored, so they are removable", () => {
    const split = must(rowsToPercentSplit([
      { memberId: "m0", text: "60" },
      { memberId: "m1", text: "40" },
      { memberId: "m2", text: "0.00" },
    ]));
    const st = stateWith(3, [{ ...pct("1", 1000, "m0", []), split }]);
    expect(removeMember(st, "m2").ok).toBe(true);
    expect(removeMember(st, "m1").ok).toBe(false);
  });

  it("removing an unreferenced member works and an unknown member is NOT_FOUND", () => {
    const st = stateWith(3, [even("1", 100, "m0", ["m0", "m1"])]);
    const r = must(removeMember(st, "m2"));
    expect(r.members.map((m) => m.id)).toEqual(["m0", "m1"]);
    expect(code(removeMember(st, "zzz"))).toBe("NOT_FOUND");
  });

  it("deleting the only referencing expense frees the member", () => {
    let st = stateWith(3, [even("1", 100, "m0", ["m0", "m2"])]);
    expect(removeMember(st, "m2").ok).toBe(false);
    st = must(deleteExpense(st, "1"));
    expect(removeMember(st, "m2").ok).toBe(true);
  });

  it("a re-added name is a new member placed last and breaks ties accordingly", () => {
    let st = must(addMember(emptyState(), "1", "Alice"));
    st = must(addMember(st, "2", "Bob"));
    st = must(addMember(st, "3", "Carol"));
    st = must(removeMember(st, "1"));
    st = must(addMember(st, "4", "Alice"));
    expect(st.members.map((m) => `${m.id}:${m.name}`)).toEqual(["2:Bob", "3:Carol", "4:Alice"]);
    const e = even("e", 100, "2", ["2", "3", "4"]);
    const alloc = must(allocateExpense(e, st.members));
    expect(alloc.map((a) => a.memberId)).toEqual(["2", "3", "4"]);
    expect(alloc.map((a) => a.cents)).toEqual([34, 33, 33]);
  });

  it("an old expense never silently re-attaches to a re-added name", () => {
    let st = stateWith(3, [even("1", 100, "m0", ["m0", "m1"])]);
    expect(removeMember(st, "m2").ok).toBe(true);
    st = must(removeMember(st, "m2"));
    st = must(addMember(st, "new", "Carol"));
    expect(countRefs(st, "new")).toBe(0);
  });
});

function countRefs(st: Group, id: string): number {
  const r = removeMember(st, id);
  return r.ok ? 0 : 1;
}

describe("validateState on hostile input", () => {
  const good = (): Record<string, unknown> => ({
    members: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }],
    expenses: [
      {
        id: "e1",
        description: "Dinner",
        amountCents: 1000,
        payerId: "a",
        date: "2026-01-02",
        split: { kind: "even", participantIds: ["a", "b"] },
      },
    ],
    payments: [{ id: "p1", from: "b", to: "a", amountCents: 100 }],
  });

  it("accepts the good fixture", () => {
    expect(validateState(good()).ok).toBe(true);
  });

  it("rejects non-objects and arrays at the top level", () => {
    for (const v of [null, undefined, 0, 1, "x", true, [], [good()], () => 1]) {
      expect(validateState(v).ok).toBe(false);
    }
  });

  it("rejects missing or wrongly typed top-level fields", () => {
    for (const key of ["members", "expenses", "payments"]) {
      const miss = good();
      delete miss[key];
      expect(validateState(miss).ok).toBe(false);
      for (const bad of [null, {}, "x", 5, { length: 0 }]) {
        const s = good();
        s[key] = bad;
        expect(validateState(s).ok).toBe(false);
      }
    }
  });

  it("rejects malformed members", () => {
    const variants: unknown[] = [
      null, "x", [], {}, { id: "a" }, { name: "A" }, { id: 1, name: "A" }, { id: "a", name: 1 },
      { id: "", name: "A" }, { id: "a", name: "" }, { id: "a", name: "  A" }, { id: "a", name: "A  B" },
      { id: "a", name: "x".repeat(41) }, { id: "a", name: null },
    ];
    for (const v of variants) {
      const s = good();
      s.members = [v, { id: "b", name: "Bob" }];
      expect(validateState(s).ok).toBe(false);
    }
  });

  it("rejects duplicate member ids and names that differ only by case", () => {
    const s = good();
    s.members = [{ id: "a", name: "Alice" }, { id: "a", name: "Bob" }];
    expect(validateState(s).ok).toBe(false);
    const t = good();
    t.members = [{ id: "a", name: "Alice" }, { id: "b", name: "alice" }];
    expect(validateState(t).ok).toBe(false);
  });

  it("rejects dangling references", () => {
    const a = good();
    (a.expenses as Record<string, unknown>[])[0].payerId = "zzz";
    expect(validateState(a).ok).toBe(false);
    const b = good();
    ((b.expenses as Record<string, unknown>[])[0].split as Record<string, unknown>).participantIds = ["a", "zzz"];
    expect(validateState(b).ok).toBe(false);
    const c = good();
    (c.payments as Record<string, unknown>[])[0].to = "zzz";
    expect(validateState(c).ok).toBe(false);
    const d = good();
    (d.payments as Record<string, unknown>[])[0].from = "zzz";
    expect(validateState(d).ok).toBe(false);
  });

  it("rejects bad amounts in expenses and payments", () => {
    for (const bad of [0, -5, 1.5, 100_000_001, "100", null, undefined, {}, [], 1e300, true]) {
      const s = good();
      (s.expenses as Record<string, unknown>[])[0].amountCents = bad;
      expect(validateState(s).ok).toBe(false);
    }
    for (const bad of [0, -5, 1.5, "5", null, undefined, 2 ** 60]) {
      const s = good();
      (s.payments as Record<string, unknown>[])[0].amountCents = bad;
      expect(validateState(s).ok).toBe(false);
    }
    const big = good();
    (big.payments as Record<string, unknown>[])[0].amountCents = 5_000_000_000;
    expect(validateState(big).ok).toBe(true);
  });

  it("rejects payment from equal to to", () => {
    const s = good();
    (s.payments as Record<string, unknown>[])[0].to = "b";
    expect(validateState(s).ok).toBe(false);
  });

  it("rejects bps summing to 10000 with a negative entry, NaN, Infinity and huge numbers", () => {
    const withShares = (shares: unknown) => {
      const s = good();
      (s.expenses as Record<string, unknown>[])[0].split = { kind: "percent", shares };
      return s;
    };
    expect(validateState(withShares([{ memberId: "a", bps: 5000 }, { memberId: "b", bps: 5000 }])).ok).toBe(true);
    expect(validateState(withShares([{ memberId: "a", bps: 15000 }, { memberId: "b", bps: -5000 }])).ok).toBe(false);
    expect(validateState(withShares([{ memberId: "a", bps: NaN }, { memberId: "b", bps: 5000 }])).ok).toBe(false);
    expect(validateState(withShares([{ memberId: "a", bps: Infinity }, { memberId: "b", bps: -Infinity }])).ok).toBe(false);
    expect(validateState(withShares([{ memberId: "a", bps: 1e300 }, { memberId: "b", bps: 5000 }])).ok).toBe(false);
    expect(validateState(withShares([{ memberId: "a", bps: "5000" }, { memberId: "b", bps: 5000 }])).ok).toBe(false);
    expect(validateState(withShares([{ memberId: "a", bps: 2500.5 }, { memberId: "b", bps: 7499.5 }])).ok).toBe(false);
    expect(validateState(withShares([{ memberId: "a", bps: 9999 }])).ok).toBe(false);
    expect(validateState(withShares([])).ok).toBe(false);
    expect(validateState(withShares({})).ok).toBe(false);
    expect(validateState(withShares([null])).ok).toBe(false);
    expect(validateState(withShares([[]])).ok).toBe(false);
  });

  it("rejects bad splits", () => {
    for (const split of [
      null, undefined, [], "even", { kind: "exact" }, { kind: "even" }, { kind: "even", participantIds: "a" },
      { kind: "even", participantIds: [] }, { kind: "even", participantIds: [1] }, { kind: "even", participantIds: ["a", "a"] },
      { kind: "percent" }, { kind: "EVEN", participantIds: ["a"] },
    ]) {
      const s = good();
      (s.expenses as Record<string, unknown>[])[0].split = split;
      expect(validateState(s).ok).toBe(false);
    }
  });

  it("rejects duplicate expense and payment ids", () => {
    const s = good();
    s.expenses = [...(s.expenses as unknown[]), ...(s.expenses as unknown[])];
    expect(validateState(s).ok).toBe(false);
    const t = good();
    t.payments = [...(t.payments as unknown[]), ...(t.payments as unknown[])];
    expect(validateState(t).ok).toBe(false);
  });

  it("rejects arrays where objects are expected and objects where arrays are expected", () => {
    const s = good();
    s.expenses = [[]];
    expect(validateState(s).ok).toBe(false);
    const t = good();
    t.payments = [[1, 2, 3]];
    expect(validateState(t).ok).toBe(false);
    const u = good();
    u.members = { 0: { id: "a", name: "A" }, length: 1 };
    expect(validateState(u).ok).toBe(false);
  });

  it("rejects bad dates and empty descriptions", () => {
    for (const date of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-1-1", "", "tomorrow", "2026-01-32", "2025-02-29"]) {
      const s = good();
      (s.expenses as Record<string, unknown>[])[0].date = date;
      expect(validateState(s).ok).toBe(false);
    }
    for (const date of ["2024-02-29", "2000-02-29", "2026-12-31"]) {
      const s = good();
      (s.expenses as Record<string, unknown>[])[0].date = date;
      expect(validateState(s).ok).toBe(true);
    }
    expect(validateState(Object.assign(good(), { expenses: [{ ...(good().expenses as Record<string, unknown>[])[0], description: "   " }] })).ok).toBe(false);
  });

  it("ignores prototype keys and unknown extra fields, returning a clean copy", () => {
    const text =
      '{"__proto__":{"polluted":true},"constructor":{"x":1},"members":[{"id":"a","name":"Alice","__proto__":{"evil":1},"extra":1},{"id":"b","name":"Bob"}],' +
      '"expenses":[],"payments":[],"unknownField":123}';
    const r = deserializeState(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual(["expenses", "members", "payments"]);
      expect(Object.keys(r.value.members[0]).sort()).toEqual(["id", "name"]);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });

  it("members whose ids look like prototype keys behave as ordinary members", () => {
    const text = JSON.stringify({
      members: [{ id: "__proto__", name: "Alice" }, { id: "constructor", name: "Bob" }],
      expenses: [
        {
          id: "toString",
          description: "x",
          amountCents: 101,
          payerId: "__proto__",
          date: "2026-01-01",
          split: { kind: "even", participantIds: ["__proto__", "constructor"] },
        },
      ],
      payments: [{ id: "hasOwnProperty", from: "constructor", to: "__proto__", amountCents: 10 }],
    });
    const r = deserializeState(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bal = must(computeBalances(r.value));
      expect(bal.map((b) => b.netCents)).toEqual([101 - 51 + -10, -50 + 10]);
      expect(bal.reduce((a, b) => a + b.netCents, 0)).toBe(0);
    }
  });

  it("deserializeState rejects invalid JSON and JSON scalars", () => {
    for (const t of ["", "{", "null", "[]", "1", '"x"', "undefined", "NaN"]) {
      const r = deserializeState(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("INVALID_STATE");
    }
  });

  it("all-or-nothing: one bad record rejects the entire state", () => {
    const s = good();
    (s.expenses as unknown[]).push({ id: "bad" });
    expect(validateState(s).ok).toBe(false);
  });

  it("serialize then deserialize round-trips a valid state", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 1, max: 100_000_000 }), (n, amt) => {
        const st = must(addExpense(stateWith(n), even("1", amt, "m0", members(n).map((m) => m.id))));
        const back = must(deserializeState(serializeState(st)));
        expect(back).toEqual(st);
      }),
      { numRuns: 100 },
    );
  });

  it("validateState does not mutate its input", () => {
    const s = good();
    const before = JSON.stringify(s);
    validateState(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("random garbage never throws", () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = validateState(v);
        return typeof r.ok === "boolean";
      }),
      { numRuns: 800 },
    );
    fc.assert(
      fc.property(fc.object({ maxDepth: 3, key: fc.constantFrom("members", "expenses", "payments", "id", "name", "split", "kind", "shares", "__proto__") }), (v) => {
        return typeof validateState(v).ok === "boolean";
      }),
      { numRuns: 800 },
    );
  });
});

describe("percent form helpers", () => {
  const ms = members(3);
  const rows = (...texts: string[]) => texts.map((text, i) => ({ memberId: `m${i}`, text }));

  it("empty and whitespace-only count as 0.00", () => {
    const ev = evaluatePercentRows(rows("", "  ", "100"), ms);
    expect(ev.rows.map((r) => r.bps)).toEqual([0, 0, 10000]);
    expect(ev.status).toBe("exact");
    expect(ev.saveDisabledReason).toBeNull();
    expect(ev.totalLine).toBe("Total 100.00%.");
    expect(ev.invalidMemberIds).toEqual([]);
  });

  it("all blank: total 0.00 with the full gap unassigned", () => {
    const ev = evaluatePercentRows(rows("", "", ""), ms);
    expect(ev.totalLine).toBe("Total 0.00%. 100.00% still unassigned.");
    expect(ev.status).toBe("under");
    expect(ev.saveDisabledReason).not.toBeNull();
  });

  it("demo: 50/30/10 shows 90.00% total and 10.00% unassigned and cannot be saved", () => {
    const ev = evaluatePercentRows(rows("50", "30", "10"), ms);
    expect(ev.totalLine).toBe("Total 90.00%. 10.00% still unassigned.");
    expect(ev.status).toBe("under");
    expect(ev.gapBps).toBe(1000);
    expect(ev.saveDisabledReason).not.toBeNull();
  });

  it("over total", () => {
    const ev = evaluatePercentRows(rows("60", "30", "15"), ms);
    expect(ev.totalLine).toBe("Total 105.00%. 5.00% over.");
    expect(ev.status).toBe("over");
    expect(ev.gapBps).toBe(500);
  });

  it("33.33 x 3 is 99.99% and not savable", () => {
    const ev = evaluatePercentRows(rows("33.33", "33.33", "33.33"), ms);
    expect(ev.totalLine).toBe("Total 99.99%. 0.01% still unassigned.");
    expect(ev.saveDisabledReason).not.toBeNull();
  });

  it("each field has one error with the right precedence", () => {
    const ev = evaluatePercentRows(rows("150.001", "-0", "abc"), ms);
    expect(ev.rows.map((r) => r.error?.code)).toEqual(["TOO_MANY_DECIMALS", "NEGATIVE", "NOT_NUMERIC"]);
    const ev2 = evaluatePercentRows(rows("100.01", "0.001", "-5"), ms);
    expect(ev2.rows.map((r) => r.error?.code)).toEqual(["ABOVE_100", "TOO_MANY_DECIMALS", "NEGATIVE"]);
    expect(ev2.rows.every((r) => r.bps === null)).toBe(true);
  });

  it("any invalid field makes the total unavailable and names the invalid fields in the save reason", () => {
    const ev = evaluatePercentRows(rows("50", "x", "y"), ms);
    expect(ev.totalLine).toBe("Total unavailable until every field is valid.");
    expect(ev.totalBps).toBeNull();
    expect(ev.status).toBe("invalid");
    expect(ev.invalidMemberIds).toEqual(["m1", "m2"]);
    expect(ev.saveDisabledReason).toContain("Bob");
    expect(ev.saveDisabledReason).toContain("Carol");
    expect(ev.saveDisabledReason).not.toContain("Alice");
    expect(ev.saveDisabledReason).not.toMatch(/unassigned|over/);
  });

  it("a single invalid field is named, even when the others sum to over 100", () => {
    const ev = evaluatePercentRows(rows("90", "90", "zz"), ms);
    expect(ev.totalLine).toBe("Total unavailable until every field is valid.");
    expect(ev.saveDisabledReason).toContain("Carol");
  });

  it("fill remainder ignores the row's own text", () => {
    expect(fillRemainderText(rows("50", "30", "10"), "m2")).toBe("20.00");
    expect(fillRemainderText(rows("50", "30", "garbage"), "m2")).toBe("20.00");
    expect(fillRemainderText(rows("50", "30", "999"), "m2")).toBe("20.00");
    expect(fillRemainderText(rows("50", "30", ""), "m2")).toBe("20.00");
    expect(fillRemainderText(rows("", "", ""), "m1")).toBe("100.00");
    expect(fillRemainderText(rows("33.33", "33.33", "0"), "m2")).toBe("33.34");
  });

  it("fill remainder is not offered when others exceed 100, are invalid, or the row is unknown", () => {
    expect(canFillRemainder(rows("60", "50", "0"), "m2")).toBe(false);
    expect(fillRemainderText(rows("60", "50", "0"), "m2")).toBeNull();
    expect(canFillRemainder(rows("60", "x", "0"), "m2")).toBe(false);
    expect(canFillRemainder(rows("60", "-0", "0"), "m2")).toBe(false);
    expect(canFillRemainder(rows("60", "0.001", "0"), "m2")).toBe(false);
    expect(canFillRemainder(rows("60", "100.01", "0"), "m2")).toBe(false);
    expect(canFillRemainder(rows("50", "30", "10"), "nope")).toBe(false);
  });

  it("fill remainder is offered when others are exactly 100 and gives 0.00", () => {
    expect(canFillRemainder(rows("60", "40", "5"), "m2")).toBe(true);
    expect(fillRemainderText(rows("60", "40", "5"), "m2")).toBe("0.00");
  });

  it("fill remainder with a single row gives 100.00", () => {
    const one = [{ memberId: "m0", text: "abc" }];
    expect(canFillRemainder(one, "m0")).toBe(true);
    expect(fillRemainderText(one, "m0")).toBe("100.00");
  });

  it("fill remainder whenever offered yields a savable 100.00% split", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.integer({ min: 0, max: 10000 }).map((b) => formatBps(b)), fc.constantFrom("", " ", "x", "-1", "1.234")), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.nat(7),
        (texts, k) => {
          const rs = texts.map((text, i) => ({ memberId: `m${i}`, text }));
          const target = `m${k % rs.length}`;
          const filled = fillRemainderText(rs, target);
          if (filled === null) return;
          const next = rs.map((r) => (r.memberId === target ? { ...r, text: filled } : r));
          const ev = evaluatePercentRows(next, members(rs.length));
          expect(ev.status).toBe("exact");
          const split = must(rowsToPercentSplit(next));
          expect(split.shares.reduce((a, s) => a + s.bps, 0)).toBe(10000);
        },
      ),
      { numRuns: 600 },
    );
  });

  it("split evenly sums to 10000 for 1 to 12 members and puts the leftover first", () => {
    for (let n = 1; n <= 12; n++) {
      const texts = splitEvenlyTexts(n);
      expect(texts).toHaveLength(n);
      const bps = texts.map((t) => must(parsePercentBps(t)));
      expect(bps.reduce((a, b) => a + b, 0)).toBe(10000);
      const base = Math.floor(10000 / n);
      const extra = 10000 - base * n;
      bps.forEach((b, i) => expect(b).toBe(base + (i < extra ? 1 : 0)));
      const rs = texts.map((text, i) => ({ memberId: `m${i}`, text }));
      expect(evaluatePercentRows(rs, members(n)).status).toBe("exact");
    }
    expect(splitEvenlyTexts(3)).toEqual(["33.34", "33.33", "33.33"]);
    expect(splitEvenlyTexts(1)).toEqual(["100.00"]);
    expect(splitEvenlyTexts(2)).toEqual(["50.00", "50.00"]);
    expect(splitEvenlyTexts(0)).toEqual([]);
  });

  it("split evenly for 7 members: four 14.29 then three 14.28", () => {
    expect(splitEvenlyTexts(7)).toEqual(["14.29", "14.29", "14.29", "14.29", "14.28", "14.28", "14.28"]);
  });

  it("rows at 0.00 are dropped from the stored split, order kept", () => {
    const split = must(rowsToPercentSplit(rows("0.00", "40", "60")));
    expect(split.shares).toEqual([
      { memberId: "m1", bps: 4000 },
      { memberId: "m2", bps: 6000 },
    ]);
    expect(must(rowsToPercentSplit(rows("", "0", "0.0"))).shares).toEqual([]);
  });

  it("rowsToPercentSplit reports invalid rows and does not check the sum", () => {
    const bad = rowsToPercentSplit(rows("50", "x", "-0"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.memberIds).toEqual(["m1", "m2"]);
    expect(rowsToPercentSplit(rows("50", "30", "10")).ok).toBe(true);
  });

  it("a split from the form that is not 100 is refused by the domain with matching integers", () => {
    const split = must(rowsToPercentSplit(rows("50", "30", "10")));
    const e: Expense = { id: "1", description: "x", amountCents: 6000, payerId: "m1", date: "2026-01-01", split };
    const r = validateExpense(e, ms);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "PERCENT_SUM_MISMATCH") {
      expect(r.error.expected).toBe(10000);
      expect(r.error.actual).toBe(9000);
      expect(r.error.message).toBe("Total 90.00%. 10.00% still unassigned.");
    } else {
      throw new Error("expected PERCENT_SUM_MISMATCH");
    }
    expect(code(addExpense(stateWith(3), e))).toBe("PERCENT_SUM_MISMATCH");
  });

  it("form total always equals the sum of parsed rows, with no float drift", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 12 }), (vals) => {
        const rs = vals.map((v, i) => ({ memberId: `m${i}`, text: formatBps(v) }));
        const ev = evaluatePercentRows(rs, members(vals.length));
        const sum = vals.reduce((a, b) => a + b, 0);
        expect(ev.totalBps).toBe(sum);
        expect(ev.totalLine).toBe(totalLineText(sum));
        expect(ev.totalLine).not.toMatch(/NaN|e\+|\d{3,}\.\d{3,}/);
        expect(ev.status).toBe(sum === 10000 ? "exact" : sum < 10000 ? "under" : "over");
        expect(ev.saveDisabledReason === null).toBe(sum === 10000);
      }),
      RUNS,
    );
  });
});
