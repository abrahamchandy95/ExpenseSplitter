import type { Expense, Group, Member, Payment } from "./types";

export const alice: Member = { id: "a", name: "Alice" };
export const bob: Member = { id: "b", name: "Bob" };
export const carol: Member = { id: "c", name: "Carol" };

export const trio: Member[] = [alice, bob, carol];

export function stateOf(
  members: Member[] = trio,
  expenses: Expense[] = [],
  payments: Payment[] = [],
): Group {
  return { members, expenses, payments };
}

export function evenExpense(
  id: string,
  amountCents: number,
  payerId: string,
  participantIds: string[],
): Expense {
  return {
    id,
    description: `Expense ${id}`,
    amountCents,
    payerId,
    date: "2026-01-15",
    split: { kind: "even", participantIds },
  };
}

export function percentExpense(
  id: string,
  amountCents: number,
  payerId: string,
  shares: { memberId: string; bps: number }[],
): Expense {
  return {
    id,
    description: `Expense ${id}`,
    amountCents,
    payerId,
    date: "2026-01-15",
    split: { kind: "percent", shares },
  };
}

export function payment(id: string, from: string, to: string, amountCents: number): Payment {
  return { id, from, to, amountCents };
}
