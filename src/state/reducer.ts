import {
  addExpense,
  addMember,
  addPayment,
  deleteExpense,
  deletePayment,
  emptyState,
  removeMember,
} from "@/domain";
import type { DomainError, Expense, Group, Payment, Result } from "@/domain";

/** Every change the UI can ask for. Each maps to one pure domain transition. */
export type GroupAction =
  | { type: "addMember"; id: string; name: string }
  | { type: "removeMember"; memberId: string }
  | { type: "addExpense"; expense: Expense }
  | { type: "deleteExpense"; expenseId: string }
  | { type: "addPayment"; payment: Payment }
  | { type: "deletePayment"; paymentId: string };

export function applyGroupAction(
  group: Group,
  action: GroupAction,
): Result<Group, DomainError> {
  switch (action.type) {
    case "addMember":
      return addMember(group, action.id, action.name);
    case "removeMember":
      return removeMember(group, action.memberId);
    case "addExpense":
      return addExpense(group, action.expense);
    case "deleteExpense":
      return deleteExpense(group, action.expenseId);
    case "addPayment":
      return addPayment(group, action.payment);
    case "deletePayment":
      return deletePayment(group, action.paymentId);
  }
}

export interface State {
  /** "loading" until the post-mount storage read has finished. */
  status: "loading" | "ready";
  group: Group;
  notice: string | null;
}

export type Action =
  | { type: "loaded"; group: Group; notice: string | null }
  | { type: "apply"; action: GroupAction }
  | { type: "groupUpdated"; group: Group }
  | { type: "dismissNotice" };

export function initialState(): State {
  return { status: "loading", group: emptyState(), notice: null };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loaded":
      // A second load (React Strict Mode runs effects twice) must not replace
      // state the user may already have changed.
      if (state.status === "ready") return state;
      return { status: "ready", group: action.group, notice: action.notice };
    case "apply": {
      if (state.status !== "ready") return state;
      const result = applyGroupAction(state.group, action.action);
      // A refused change leaves the state untouched; the caller shows the error.
      return result.ok ? { ...state, group: result.value } : state;
    }
    case "groupUpdated":
      // Used by useExpenseSplitter after it has already run applyGroupAction(state.group, action)
      // to return the synchronous Result to the caller—avoiding running domain validation twice.
      if (state.status !== "ready") return state;
      return { ...state, group: action.group };
    case "dismissNotice":
      return { ...state, notice: null };
  }
}
