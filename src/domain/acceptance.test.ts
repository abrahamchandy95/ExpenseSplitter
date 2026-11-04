import { describe, expect, it } from "vitest";
import {
  addExpense,
  addMember,
  addPayment,
  allocateExpense,
  buildSettlementPlan,
  canFillRemainder,
  computeBalances,
  deleteExpense,
  deserializeState,
  describeBalance,
  emptyState,
  evaluatePercentRows,
  fillRemainderText,
  formatCents,
  parseAmountCents,
  removeMember,
  rowsToPercentSplit,
  serializeState,
  splitEvenlyTexts,
  summarize,
  validateExpense,
} from "./index";
import type { Expense, Group, Member, Result, Split } from "./index";

function must<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const members: Member[] = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
  { id: "c", name: "Carol" },
];

function expense(id: string, amountCents: number, payerId: string, split: Split): Expense {
  return { id, description: id, amountCents, payerId, date: "2026-03-01", split };
}

const percent = (a: number, b: number, c: number): Split => ({
  kind: "percent",
  shares: [
    { memberId: "a", bps: a },
    { memberId: "b", bps: b },
    { memberId: "c", bps: c },
  ],
});

const rowsOf = (a: string, b: string, c: string) => [
  { memberId: "a", text: a },
  { memberId: "b", text: b },
  { memberId: "c", text: c },
];

describe("acceptance: splits", () => {
  it("even split of $100.00 among 3 yields 33.34, 33.33, 33.33 summing to 10000", () => {
    const e = expense("e", 10000, "a", { kind: "even", participantIds: ["a", "b", "c"] });
    const cents = must(allocateExpense(e, members)).map((x) => x.cents);
    expect(cents).toEqual([3334, 3333, 3333]);
    expect(cents.reduce((x, y) => x + y, 0)).toBe(10000);
  });

  it("percent 50/30/20 on $60.00 yields 30.00, 18.00, 12.00", () => {
    const cents = must(allocateExpense(expense("p", 6000, "b", percent(5000, 3000, 2000)), members)).map(
      (x) => x.cents,
    );
    expect(cents.map(formatCents)).toEqual(["$30.00", "$18.00", "$12.00"]);
  });
});

describe("acceptance: percent totals", () => {
  it("50/30/10 is rejected by the form and the domain, and shows 10.00% still unassigned", () => {
    const form = evaluatePercentRows(rowsOf("50", "30", "10"), members);
    expect(form.status).toBe("under");
    expect(form.totalLine).toBe("Total 90.00%. 10.00% still unassigned.");
    expect(form.saveDisabledReason).not.toBeNull();

    const split = must(rowsToPercentSplit(rowsOf("50", "30", "10")));
    let state = emptyState();
    for (const m of members) state = must(addMember(state, m.id, m.name));
    const r = addExpense(state, expense("p", 6000, "a", split));
    expect(r).toMatchObject({
      ok: false,
      error: { code: "PERCENT_SUM_MISMATCH", expected: 10000, actual: 9000 },
    });
    expect(state.expenses).toEqual([]);
  });

  it("33.33 x 3 is rejected as 99.99%", () => {
    const form = evaluatePercentRows(rowsOf("33.33", "33.33", "33.33"), members);
    expect(form.status).toBe("under");
    expect(form.totalLine).toBe("Total 99.99%. 0.01% still unassigned.");
    expect(validateExpense(expense("p", 100, "a", percent(3333, 3333, 3333)), members)).toMatchObject({
      ok: false,
      error: { code: "PERCENT_SUM_MISMATCH", expected: 10000, actual: 9999 },
    });
  });

  it("[15000, -5000] bps is rejected even though it sums to 10000", () => {
    const split: Split = {
      kind: "percent",
      shares: [
        { memberId: "a", bps: 15000 },
        { memberId: "b", bps: -5000 },
      ],
    };
    const r = validateExpense(expense("p", 100, "a", split), members);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_SPLIT");
  });

  it("Split evenly always produces a savable 100.00% split", () => {
    for (let n = 1; n <= 12; n++) {
      const ms: Member[] = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
      const rows = ms.map((m, i) => ({ memberId: m.id, text: splitEvenlyTexts(n)[i] }));
      expect(evaluatePercentRows(rows, ms).status).toBe("exact");
      const split = must(rowsToPercentSplit(rows));
      expect(validateExpense(expense("p", 12345, "m0", split), ms).ok).toBe(true);
    }
  });

  it("Fill remainder, whenever offered, produces a savable 100.00% split", () => {
    const samples = [
      ["50", "30", ""],
      ["50", "30", "10"],
      ["33.33", "33.33", "0"],
      ["0.01", "", "99.5"],
      ["100", "", ""],
      ["", "", ""],
    ];
    for (const s of samples) {
      const rows = rowsOf(s[0], s[1], s[2]);
      for (const m of members) {
        if (!canFillRemainder(rows, m.id)) continue;
        const text = fillRemainderText(rows, m.id) as string;
        const filled = rows.map((r) => (r.memberId === m.id ? { ...r, text } : r));
        expect(evaluatePercentRows(filled, members).status).toBe("exact");
        const split = must(rowsToPercentSplit(filled));
        expect(validateExpense(expense("p", 999, "a", split), members).ok).toBe(true);
      }
    }
  });
});

describe("acceptance: membership", () => {
  it("removing a referenced member is refused, an unreferenced one works", () => {
    let s = emptyState();
    for (const [id, name] of [["a", "Alice"], ["b", "Bob"], ["c", "Carol"]]) s = must(addMember(s, id, name));
    s = must(addExpense(s, expense("e", 900, "a", { kind: "even", participantIds: ["a", "b"] })));
    expect(removeMember(s, "a")).toMatchObject({
      ok: false,
      error: { code: "MEMBER_IN_USE", message: "Alice is used by 1 expense." },
    });
    expect(removeMember(s, "c").ok).toBe(true);
  });
});

describe("acceptance: persistence and display", () => {
  it("a stored state round trips and corrupt storage is rejected without throwing", () => {
    const s: Group = { members, expenses: [], payments: [] };
    expect(deserializeState(serializeState(s))).toEqual({ ok: true, value: s });
    for (const bad of ["{", "null", '{"members":1}', "", "[1,2]"]) {
      expect(deserializeState(bad).ok).toBe(false);
    }
  });

  it("formatting never shows NaN, float artifacts, or negative zero", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-0)).toBe("$0.00");
    expect(formatCents(30)).toBe("$0.30");
    expect(describeBalance(-0).text).toBe("settled");
    const sum = must(parseAmountCents("0.1")) + must(parseAmountCents("0.2"));
    expect(formatCents(sum)).toBe("$0.30");
    expect(parseAmountCents("0.29")).toEqual({ ok: true, value: 29 });
  });
});

describe("acceptance: demo script", () => {
  const nets = (s: Group) => {
    const b = must(computeBalances(s));
    return Object.fromEntries(b.map((x) => [x.name, x.netCents]));
  };
  const planText = (s: Group) => {
    const name = (id: string) => s.members.find((m) => m.id === id)?.name;
    return must(summarize(s)).plan.map((t) => `${name(t.from)} pays ${name(t.to)} ${formatCents(t.amountCents)}`);
  };

  it("produces exactly the listed numbers", () => {
    // Step 1: add Alice, Bob, Carol.
    let s = emptyState();
    s = must(addMember(s, "a", "Alice"));
    s = must(addMember(s, "b", "Bob"));
    s = must(addMember(s, "c", "Carol"));
    expect(must(summarize(s)).allSettled).toBe(true);

    // Step 2: Alice pays 90.00 for dinner, split evenly.
    s = must(
      addExpense(
        s,
        expense("dinner", must(parseAmountCents("90.00")), "a", {
          kind: "even",
          participantIds: ["a", "b", "c"],
        }),
      ),
    );
    expect(nets(s)).toEqual({ Alice: 6000, Bob: -3000, Carol: -3000 });
    expect(planText(s)).toEqual(["Bob pays Alice $30.00", "Carol pays Alice $30.00"]);

    // Step 3: Bob pays 60.00 for a taxi, percent 50/30/10, then Fill remainder on Carol.
    const rows = rowsOf("50", "30", "10");
    const before = evaluatePercentRows(rows, members);
    expect(before.totalLine).toBe("Total 90.00%. 10.00% still unassigned.");
    expect(before.saveDisabledReason).not.toBeNull();
    expect(canFillRemainder(rows, "c")).toBe(true);
    expect(fillRemainderText(rows, "c")).toBe("20.00");
    const filled = rowsOf("50", "30", "20");
    expect(evaluatePercentRows(filled, members).saveDisabledReason).toBeNull();
    const split = must(rowsToPercentSplit(filled));
    const taxi = expense("taxi", must(parseAmountCents("60.00")), "b", split);
    expect(must(allocateExpense(taxi, s.members)).map((a) => formatCents(a.cents))).toEqual([
      "$30.00",
      "$18.00",
      "$12.00",
    ]);
    s = must(addExpense(s, taxi));
    expect(nets(s)).toEqual({ Alice: 3000, Bob: 1200, Carol: -4200 });
    expect(planText(s)).toEqual(["Carol pays Alice $30.00", "Carol pays Bob $12.00"]);

    // Step 4: removing Alice is refused.
    const refused = removeMember(s, "a");
    expect(refused).toMatchObject({
      ok: false,
      error: { code: "MEMBER_IN_USE", message: "Alice is used by 2 expenses." },
    });

    // Step 5: Mark as paid on "Carol pays Bob $12.00".
    s = must(addPayment(s, { id: "pay1", from: "c", to: "b", amountCents: 1200 }));
    expect(nets(s)).toEqual({ Alice: 3000, Bob: 0, Carol: -3000 });
    const summary = must(summarize(s));
    expect(describeBalance(summary.balances[1].netCents).text).toBe("settled");
    expect(describeBalance(summary.balances[2].netCents).text).toBe("owes $30.00");
    expect(planText(s)).toEqual(["Carol pays Alice $30.00"]);

    // Reload: serialize and deserialize gives identical state.
    expect(deserializeState(serializeState(s))).toEqual({ ok: true, value: s });
  });

  it("deleting a $30.00 dinner after Bob paid Alice $30.00 makes Alice owe Bob $30.00", () => {
    let s: Group = { members: members.slice(0, 2), expenses: [], payments: [] };
    s = must(addExpense(s, expense("d", 3000, "a", { kind: "even", participantIds: ["b"] })));
    s = must(addPayment(s, { id: "p", from: "b", to: "a", amountCents: 3000 }));
    expect(planText(s)).toEqual([]);
    s = must(deleteExpense(s, "d"));
    expect(planText(s)).toEqual(["Alice pays Bob $30.00"]);
  });

  it("the settlement plan is stable across repeated calls", () => {
    const b = must(
      computeBalances({
        members,
        expenses: [expense("e", 1000, "a", { kind: "even", participantIds: ["a", "b", "c"] })],
        payments: [],
      }),
    );
    expect(buildSettlementPlan(b)).toEqual(buildSettlementPlan(b));
  });
});
