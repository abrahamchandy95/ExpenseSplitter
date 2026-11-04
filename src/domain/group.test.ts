import { describe, expect, it } from "vitest";
import {
  addExpense,
  addMember,
  addPayment,
  deleteExpense,
  deletePayment,
  emptyState,
  removeMember,
} from "./group";
import { evenExpense, payment, percentExpense, stateOf } from "./testUtils";
import type { DomainError, Group, Result } from "./types";

function must(r: Result<Group, DomainError>): Group {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const code = (r: Result<Group, DomainError>) => (r.ok ? "ok" : r.error.code);

describe("members", () => {
  it("adds members in order and normalizes names", () => {
    let s = emptyState();
    s = must(addMember(s, "1", "  Alice  "));
    s = must(addMember(s, "2", "Bob"));
    expect(s.members).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]);
  });

  it("is pure: the input state is not mutated", () => {
    const s = emptyState();
    must(addMember(s, "1", "Alice"));
    expect(s.members).toEqual([]);
  });

  it("rejects bad names and duplicate ids", () => {
    const s = must(addMember(emptyState(), "1", "Alice"));
    expect(code(addMember(s, "2", "alice"))).toBe("DUPLICATE_NAME");
    expect(code(addMember(s, "2", " "))).toBe("EMPTY_NAME");
    expect(code(addMember(s, "1", "Bob"))).toBe("DUPLICATE_ID");
  });

  it("places a re-added name last as a new member", () => {
    let s = emptyState();
    s = must(addMember(s, "1", "Alice"));
    s = must(addMember(s, "2", "Bob"));
    s = must(removeMember(s, "1"));
    s = must(addMember(s, "3", "Alice"));
    expect(s.members.map((m) => m.id)).toEqual(["2", "3"]);
  });

  it("removes an unreferenced member", () => {
    const s = stateOf();
    expect(must(removeMember(s, "c")).members.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("refuses to remove a referenced member with a counted explanation", () => {
    const s = stateOf(
      undefined,
      [evenExpense("e1", 100, "a", ["a", "b"]), evenExpense("e2", 100, "b", ["a"])],
      [payment("p", "b", "a", 10)],
    );
    expect(removeMember(s, "a")).toMatchObject({
      ok: false,
      error: {
        code: "MEMBER_IN_USE",
        memberId: "a",
        memberName: "Alice",
        expenseCount: 2,
        paymentCount: 1,
        message: "Alice is used by 2 expenses and 1 payment.",
      },
    });
  });

  it("handles payment-only and expense-only references", () => {
    const paymentOnly = stateOf(undefined, [], [payment("p", "b", "c", 10)]);
    expect(removeMember(paymentOnly, "c")).toMatchObject({
      ok: false,
      error: { message: "Carol is used by 1 payment." },
    });
    const expenseOnly = stateOf(undefined, [evenExpense("e", 100, "a", ["a"])]);
    expect(removeMember(expenseOnly, "a")).toMatchObject({
      ok: false,
      error: { message: "Alice is used by 1 expense." },
    });
  });

  it("does not count a 0.00 percent row as a reference", () => {
    const s = stateOf(undefined, [
      percentExpense("e", 100, "a", [{ memberId: "a", bps: 10000 }]),
    ]);
    expect(code(removeMember(s, "c"))).toBe("ok");
  });

  it("allows removal after the referencing records are deleted", () => {
    let s = stateOf(undefined, [evenExpense("e", 100, "a", ["a", "b"])], [payment("p", "b", "a", 10)]);
    s = must(deleteExpense(s, "e"));
    expect(code(removeMember(s, "a"))).toBe("MEMBER_IN_USE");
    s = must(deletePayment(s, "p"));
    expect(code(removeMember(s, "a"))).toBe("ok");
  });

  it("reports NOT_FOUND for an unknown member", () => {
    expect(code(removeMember(stateOf(), "zz"))).toBe("NOT_FOUND");
  });
});

describe("expenses", () => {
  it("requires at least 2 members", () => {
    expect(code(addExpense(emptyState(), evenExpense("e", 100, "a", ["a"])))).toBe("NOT_ENOUGH_MEMBERS");
    const one = must(addMember(emptyState(), "a", "Alice"));
    expect(code(addExpense(one, evenExpense("e", 100, "a", ["a"])))).toBe("NOT_ENOUGH_MEMBERS");
  });

  it("adds a valid expense and trims its description", () => {
    const s = must(addExpense(stateOf(), { ...evenExpense("e", 9000, "a", ["a", "b", "c"]), description: "  Dinner " }));
    expect(s.expenses).toHaveLength(1);
    expect(s.expenses[0].description).toBe("Dinner");
  });

  it("returns the typed domain error and adds nothing for an invalid expense", () => {
    const s = stateOf();
    const bad = percentExpense("e", 6000, "a", [
      { memberId: "a", bps: 5000 },
      { memberId: "b", bps: 3000 },
      { memberId: "c", bps: 1000 },
    ]);
    const r = addExpense(s, bad);
    expect(r).toMatchObject({ ok: false, error: { code: "PERCENT_SUM_MISMATCH", expected: 10000, actual: 9000 } });
    expect(s.expenses).toEqual([]);
  });

  it("rejects a duplicate expense id", () => {
    const s = must(addExpense(stateOf(), evenExpense("e", 100, "a", ["a"])));
    expect(code(addExpense(s, evenExpense("e", 100, "a", ["a"])))).toBe("DUPLICATE_ID");
  });

  it("deletes an expense and leaves payments alone", () => {
    let s = stateOf(undefined, [evenExpense("e", 100, "a", ["a", "b"])], [payment("p", "b", "a", 10)]);
    s = must(deleteExpense(s, "e"));
    expect(s.expenses).toEqual([]);
    expect(s.payments).toHaveLength(1);
    expect(code(deleteExpense(s, "e"))).toBe("NOT_FOUND");
  });
});

describe("payments", () => {
  it("adds and deletes payments", () => {
    let s = must(addPayment(stateOf(), payment("p", "b", "a", 3000)));
    expect(s.payments).toHaveLength(1);
    s = must(deletePayment(s, "p"));
    expect(s.payments).toEqual([]);
    expect(code(deletePayment(s, "p"))).toBe("NOT_FOUND");
  });

  it("validates payments and ids", () => {
    const s = stateOf();
    expect(code(addPayment(s, payment("p", "a", "a", 100)))).toBe("SAME_MEMBER");
    expect(code(addPayment(s, payment("p", "a", "b", 0)))).toBe("INVALID_AMOUNT");
    expect(code(addPayment(s, payment("p", "a", "zz", 5)))).toBe("UNKNOWN_MEMBER");
    const withOne = must(addPayment(s, payment("p", "a", "b", 5)));
    expect(code(addPayment(withOne, payment("p", "b", "a", 5)))).toBe("DUPLICATE_ID");
  });

  it("does not apply the expense cap to payments", () => {
    expect(code(addPayment(stateOf(), payment("p", "a", "b", 200_000_000)))).toBe("ok");
  });
});
