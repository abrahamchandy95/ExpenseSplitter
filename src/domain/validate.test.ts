import { describe, expect, it } from "vitest";
import { evenExpense, payment, percentExpense, stateOf, trio } from "./testUtils";
import { validateExpense, validatePayment, validateState } from "./validate";

const codeOf = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);

describe("validateExpense", () => {
  it("accepts a valid even and percent expense", () => {
    expect(validateExpense(evenExpense("e", 9000, "a", ["a", "b", "c"]), trio).ok).toBe(true);
    const p = percentExpense("p", 6000, "b", [
      { memberId: "a", bps: 5000 },
      { memberId: "b", bps: 3000 },
      { memberId: "c", bps: 2000 },
    ]);
    expect(validateExpense(p, trio).ok).toBe(true);
  });

  it("accepts exactly the cap and rejects above it", () => {
    expect(validateExpense(evenExpense("e", 100_000_000, "a", ["a"]), trio).ok).toBe(true);
    expect(codeOf(validateExpense(evenExpense("e", 100_000_001, "a", ["a"]), trio))).toBe("INVALID_AMOUNT");
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects amount %s", (amount) => {
    expect(codeOf(validateExpense(evenExpense("e", amount, "a", ["a"]), trio))).toBe("INVALID_AMOUNT");
  });

  it("rejects an unknown payer or participant", () => {
    expect(codeOf(validateExpense(evenExpense("e", 100, "zz", ["a"]), trio))).toBe("UNKNOWN_MEMBER");
    expect(codeOf(validateExpense(evenExpense("e", 100, "a", ["a", "zz"]), trio))).toBe("UNKNOWN_MEMBER");
  });

  it("lets the payer be outside the participants", () => {
    expect(validateExpense(evenExpense("e", 100, "a", ["b"]), trio).ok).toBe(true);
  });

  it("rejects empty and duplicate participants", () => {
    expect(codeOf(validateExpense(evenExpense("e", 100, "a", []), trio))).toBe("INVALID_SPLIT");
    expect(codeOf(validateExpense(evenExpense("e", 100, "a", ["a", "a"]), trio))).toBe("INVALID_SPLIT");
  });

  it("rejects a bad description and a bad date", () => {
    const e = evenExpense("e", 100, "a", ["a"]);
    expect(codeOf(validateExpense({ ...e, description: "   " }, trio))).toBe("INVALID_DESCRIPTION");
    expect(codeOf(validateExpense({ ...e, date: "2026-02-30" }, trio))).toBe("INVALID_DATE");
    expect(codeOf(validateExpense({ ...e, date: "2026-13-01" }, trio))).toBe("INVALID_DATE");
    expect(codeOf(validateExpense({ ...e, date: "1/2/2026" }, trio))).toBe("INVALID_DATE");
    expect(validateExpense({ ...e, date: "2024-02-29" }, trio).ok).toBe(true);
    expect(codeOf(validateExpense({ ...e, date: "2100-02-29" }, trio))).toBe("INVALID_DATE");
    expect(validateExpense({ ...e, date: "2000-02-29" }, trio).ok).toBe(true);
  });

  it("returns PERCENT_SUM_MISMATCH with integer bps expected and actual", () => {
    const r = validateExpense(
      percentExpense("p", 6000, "a", [
        { memberId: "a", bps: 5000 },
        { memberId: "b", bps: 3000 },
        { memberId: "c", bps: 1000 },
      ]),
      trio,
    );
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "PERCENT_SUM_MISMATCH",
        expected: 10000,
        actual: 9000,
        message: "Total 90.00%. 10.00% still unassigned.",
      },
    });
  });

  it("rejects 33.33 x 3 as 99.99%", () => {
    const r = validateExpense(
      percentExpense("p", 6000, "a", [
        { memberId: "a", bps: 3333 },
        { memberId: "b", bps: 3333 },
        { memberId: "c", bps: 3333 },
      ]),
      trio,
    );
    expect(r).toMatchObject({ ok: false, error: { code: "PERCENT_SUM_MISMATCH", actual: 9999 } });
  });

  it("rejects [15000, -5000] bps even though the sum is 10000", () => {
    const r = validateExpense(
      percentExpense("p", 6000, "a", [
        { memberId: "a", bps: 15000 },
        { memberId: "b", bps: -5000 },
      ]),
      trio,
    );
    expect(codeOf(r)).toBe("INVALID_SPLIT");
  });

  it("rejects out-of-range and non-integer bps and duplicate members", () => {
    const one = (bps: number) => percentExpense("p", 100, "a", [{ memberId: "a", bps }]);
    expect(codeOf(validateExpense(one(0), trio))).toBe("INVALID_SPLIT");
    expect(codeOf(validateExpense(one(10001), trio))).toBe("INVALID_SPLIT");
    expect(codeOf(validateExpense(one(5000.5), trio))).toBe("INVALID_SPLIT");
    expect(codeOf(validateExpense(one(NaN), trio))).toBe("INVALID_SPLIT");
    expect(validateExpense(one(10000), trio).ok).toBe(true);
    const dup = percentExpense("p", 100, "a", [
      { memberId: "a", bps: 5000 },
      { memberId: "a", bps: 5000 },
    ]);
    expect(codeOf(validateExpense(dup, trio))).toBe("INVALID_SPLIT");
  });

  it("treats an empty percent split as a sum mismatch of 0", () => {
    expect(validateExpense(percentExpense("p", 100, "a", []), trio)).toMatchObject({
      ok: false,
      error: { code: "PERCENT_SUM_MISMATCH", actual: 0 },
    });
  });

  it("rejects a percent share for an unknown member", () => {
    const e = percentExpense("p", 100, "a", [{ memberId: "zz", bps: 10000 }]);
    expect(codeOf(validateExpense(e, trio))).toBe("UNKNOWN_MEMBER");
  });
});

describe("validatePayment", () => {
  it("accepts a valid payment with no cap", () => {
    expect(validatePayment(payment("p", "a", "b", 1), trio).ok).toBe(true);
    expect(validatePayment(payment("p", "a", "b", 500_000_000), trio).ok).toBe(true);
  });

  it("rejects non-positive and non-integer amounts", () => {
    for (const amount of [0, -5, 0.5, NaN]) {
      expect(codeOf(validatePayment(payment("p", "a", "b", amount), trio))).toBe("INVALID_AMOUNT");
    }
  });

  it("rejects from equal to to, and unknown members", () => {
    expect(codeOf(validatePayment(payment("p", "a", "a", 100), trio))).toBe("SAME_MEMBER");
    expect(codeOf(validatePayment(payment("p", "zz", "a", 100), trio))).toBe("UNKNOWN_MEMBER");
    expect(codeOf(validatePayment(payment("p", "a", "zz", 100), trio))).toBe("UNKNOWN_MEMBER");
  });
});

describe("validateState", () => {
  const good = () => JSON.parse(JSON.stringify(stateOf(trio, [evenExpense("e", 9000, "a", ["a", "b", "c"])], [payment("p", "b", "a", 3000)])));

  it("accepts a valid state and returns a clean copy", () => {
    const input = good();
    input.extra = 1;
    input.members[0].extra = 2;
    const r = validateState(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(good());
      expect(r.value).not.toBe(input);
    }
  });

  it("accepts an empty state", () => {
    expect(validateState({ members: [], expenses: [], payments: [] }).ok).toBe(true);
  });

  it.each([null, undefined, 5, "x", [], true])("rejects non-object %j", (v) => {
    expect(codeOf(validateState(v))).toBe("INVALID_STATE");
  });

  it("rejects missing or mistyped collections", () => {
    expect(codeOf(validateState({ members: [], expenses: [] }))).toBe("INVALID_STATE");
    expect(codeOf(validateState({ members: {}, expenses: [], payments: [] }))).toBe("INVALID_STATE");
  });

  it("rejects duplicate member ids and duplicate names ignoring case", () => {
    const s = good();
    s.members[1].id = "a";
    expect(codeOf(validateState(s))).toBe("INVALID_STATE");
    const t = good();
    t.members[1].name = "ALICE";
    expect(codeOf(validateState(t))).toBe("INVALID_STATE");
  });

  it("rejects bad member names", () => {
    for (const name of ["", "  Bob", "Bo  b", "x".repeat(41), 5]) {
      const s = good();
      s.members[1].name = name;
      expect(codeOf(validateState(s))).toBe("INVALID_STATE");
    }
    const ok40 = good();
    ok40.members[1].name = "x".repeat(40);
    expect(validateState(ok40).ok).toBe(true);
  });

  it("rejects dangling references", () => {
    const s = good();
    s.expenses[0].payerId = "zz";
    expect(codeOf(validateState(s))).toBe("INVALID_STATE");
    const t = good();
    t.expenses[0].split.participantIds.push("zz");
    expect(codeOf(validateState(t))).toBe("INVALID_STATE");
    const u = good();
    u.payments[0].to = "zz";
    expect(codeOf(validateState(u))).toBe("INVALID_STATE");
  });

  it("rejects invalid records using the same rules as creation", () => {
    const a = good();
    a.expenses[0].amountCents = 100_000_001;
    expect(codeOf(validateState(a))).toBe("INVALID_STATE");
    const b = good();
    b.payments[0].to = b.payments[0].from;
    expect(codeOf(validateState(b))).toBe("INVALID_STATE");
    const c = good();
    c.expenses[0].split = { kind: "percent", shares: [{ memberId: "a", bps: 9999 }] };
    expect(codeOf(validateState(c))).toBe("INVALID_STATE");
    const d = good();
    d.expenses[0].split = { kind: "percent", shares: [{ memberId: "a", bps: 15000 }, { memberId: "b", bps: -5000 }] };
    expect(codeOf(validateState(d))).toBe("INVALID_STATE");
    const e = good();
    e.expenses[0].split = { kind: "even", participantIds: [] };
    expect(codeOf(validateState(e))).toBe("INVALID_STATE");
  });

  it("rejects malformed records and duplicate record ids", () => {
    const a = good();
    a.expenses[0].amountCents = "90";
    expect(codeOf(validateState(a))).toBe("INVALID_STATE");
    const b = good();
    b.expenses[0].split = { kind: "weird" };
    expect(codeOf(validateState(b))).toBe("INVALID_STATE");
    const c = good();
    c.expenses.push(JSON.parse(JSON.stringify(c.expenses[0])));
    expect(codeOf(validateState(c))).toBe("INVALID_STATE");
    const d = good();
    d.payments.push(JSON.parse(JSON.stringify(d.payments[0])));
    expect(codeOf(validateState(d))).toBe("INVALID_STATE");
    const e = good();
    e.payments[0] = null;
    expect(codeOf(validateState(e))).toBe("INVALID_STATE");
    const f = good();
    f.members[0] = "Alice";
    expect(codeOf(validateState(f))).toBe("INVALID_STATE");
  });
});
