import { describe, expect, it } from "vitest";
import { emptyState } from "@/domain";
import type { Expense, Group } from "@/domain";
import { applyGroupAction, initialState, reducer } from "./reducer";
import type { Action, State } from "./reducer";

function dispatchActions(state: State, ...actions: Action[]): State {
  return actions.reduce(reducer, state);
}

function ready(group: Group = emptyState()): State {
  return dispatchActions(initialState(), { type: "loaded", group, notice: null });
}

const withMembers = dispatchActions(
  ready(),
  { type: "apply", action: { type: "addMember", id: "a", name: "Alice" } },
  { type: "apply", action: { type: "addMember", id: "b", name: "Bob" } },
  { type: "apply", action: { type: "addMember", id: "c", name: "Carol" } },
);

const taxi = (bps: [number, number, number]): Expense => ({
  id: "e1",
  description: "Taxi",
  amountCents: 6000,
  payerId: "b",
  date: "2026-01-15",
  split: {
    kind: "percent",
    shares: [
      { memberId: "a", bps: bps[0] },
      { memberId: "b", bps: bps[1] },
      { memberId: "c", bps: bps[2] },
    ],
  },
});

describe("reducer", () => {
  it("starts in loading status and ignores changes until loaded", () => {
    const loading = initialState();
    expect(loading.status).toBe("loading");
    const after = reducer(loading, {
      type: "apply",
      action: { type: "addMember", id: "a", name: "Alice" },
    });
    expect(after).toBe(loading);
  });

  it("keeps the first load when a second one arrives", () => {
    const first = ready(withMembers.group);
    const second = reducer(first, {
      type: "loaded",
      group: emptyState(),
      notice: "later",
    });
    expect(second).toBe(first);
  });

  it("carries a discard notice from load and lets the user dismiss it", () => {
    const s = dispatchActions(initialState(), {
      type: "loaded",
      group: emptyState(),
      notice: "discarded",
    });
    expect(s.notice).toBe("discarded");
    expect(reducer(s, { type: "dismissNotice" }).notice).toBeNull();
  });

  it("applies valid changes through the domain", () => {
    expect(withMembers.group.members.map((m) => m.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("leaves state unchanged when the domain refuses a change", () => {
    const bad = reducer(withMembers, {
      type: "apply",
      action: { type: "addExpense", expense: taxi([5000, 3000, 1000]) },
    });
    expect(bad).toBe(withMembers);
  });

  it("returns the domain's sentence for a percent mismatch", () => {
    const result = applyGroupAction(withMembers.group, {
      type: "addExpense",
      expense: taxi([5000, 3000, 1000]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Total 90.00%. 10.00% still unassigned.");
  });

  it("refuses to remove a referenced member with the counted message", () => {
    const withExpense = reducer(withMembers, {
      type: "apply",
      action: { type: "addExpense", expense: taxi([5000, 3000, 2000]) },
    });
    expect(withExpense.group.expenses).toHaveLength(1);
    const result = applyGroupAction(withExpense.group, { type: "removeMember", memberId: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Bob is used by 1 expense.");
  });
});
