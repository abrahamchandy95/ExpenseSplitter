import { describe, expect, it } from "vitest";
import { countReferences, memberInUseMessage, normalizeName, validateMemberName } from "./members";
import { alice, bob, evenExpense, payment, percentExpense, stateOf } from "./testUtils";

describe("normalizeName", () => {
  it("trims and collapses whitespace runs", () => {
    expect(normalizeName("  Mary   Jane \t Watson ")).toBe("Mary Jane Watson");
    expect(normalizeName("   ")).toBe("");
  });
});

describe("validateMemberName", () => {
  it("returns the normalized name", () => {
    expect(validateMemberName("  Dee   Dee ", [alice])).toEqual({ ok: true, value: "Dee Dee" });
  });

  it("rejects empty names", () => {
    expect(validateMemberName("   ", [])).toMatchObject({ ok: false, error: { code: "EMPTY_NAME" } });
  });

  it("rejects duplicates ignoring case and after normalization", () => {
    expect(validateMemberName("ALICE", [alice])).toMatchObject({ ok: false, error: { code: "DUPLICATE_NAME" } });
    expect(validateMemberName(" a l", [{ id: "x", name: "A L" }])).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_NAME" },
    });
  });

  it("allows 40 characters and rejects 41", () => {
    expect(validateMemberName("x".repeat(40), []).ok).toBe(true);
    expect(validateMemberName("x".repeat(41), [])).toMatchObject({ ok: false, error: { code: "NAME_TOO_LONG" } });
  });

  it("measures length after collapsing whitespace", () => {
    expect(validateMemberName(`${"x".repeat(39)}      `, []).ok).toBe(true);
  });
});

describe("countReferences", () => {
  const state = stateOf(
    [alice, bob, { id: "c", name: "Carol" }],
    [
      evenExpense("e1", 100, "a", ["a", "b"]),
      percentExpense("e2", 100, "b", [{ memberId: "a", bps: 10000 }]),
      evenExpense("e3", 100, "b", ["b"]),
    ],
    [payment("p1", "b", "a", 50)],
  );

  it("counts each referencing record once", () => {
    expect(countReferences(state, "a")).toEqual({ expenseCount: 2, paymentCount: 1 });
    expect(countReferences(state, "b")).toEqual({ expenseCount: 3, paymentCount: 1 });
    expect(countReferences(state, "c")).toEqual({ expenseCount: 0, paymentCount: 0 });
  });

  it("counts a payer-only reference", () => {
    const s = stateOf(undefined, [evenExpense("e", 100, "a", ["b"])]);
    expect(countReferences(s, "a").expenseCount).toBe(1);
  });
});

describe("memberInUseMessage", () => {
  it("pluralizes correctly for every case", () => {
    expect(memberInUseMessage("Alice", { expenseCount: 2, paymentCount: 1 })).toBe("Alice is used by 2 expenses and 1 payment.");
    expect(memberInUseMessage("Alice", { expenseCount: 1, paymentCount: 2 })).toBe("Alice is used by 1 expense and 2 payments.");
    expect(memberInUseMessage("Alice", { expenseCount: 2, paymentCount: 0 })).toBe("Alice is used by 2 expenses.");
    expect(memberInUseMessage("Alice", { expenseCount: 1, paymentCount: 0 })).toBe("Alice is used by 1 expense.");
    expect(memberInUseMessage("Alice", { expenseCount: 0, paymentCount: 1 })).toBe("Alice is used by 1 payment.");
    expect(memberInUseMessage("Alice", { expenseCount: 0, paymentCount: 3 })).toBe("Alice is used by 3 payments.");
  });
});
