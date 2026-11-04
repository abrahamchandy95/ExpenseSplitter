import { countReferences, memberInUseMessage, validateMemberName } from "./members";
import type { DomainError, Expense, Group, Payment, Result } from "./types";
import { err, ok } from "./types";
import { computeBalances } from "./ledger";
import { validateExpense, validatePayment } from "./validate";

export function emptyState(): Group {
  return { members: [], expenses: [], payments: [] };
}

/** Appends a member (so re-adding a removed name places it last). The caller supplies the id. */
export function addMember(
  group: Group,
  id: string,
  rawName: string,
): Result<Group, DomainError> {
  if (group.members.some((member) => member.id === id)) {
    return err({ code: "DUPLICATE_ID", id, message: "That member id is already in use." });
  }
  const name = validateMemberName(rawName, group.members);
  if (!name.ok) return name;
  return ok({ ...group, members: [...group.members, { id, name: name.value }] });
}

/** Refuses with MEMBER_IN_USE when any expense or payment references the member. */
export function removeMember(group: Group, memberId: string): Result<Group, DomainError> {
  const member = group.members.find((candidate) => candidate.id === memberId);
  if (!member) {
    return err({ code: "NOT_FOUND", id: memberId, message: "That member does not exist." });
  }
  const counts = countReferences(group, memberId);
  if (counts.expenseCount + counts.paymentCount > 0) {
    return err({
      code: "MEMBER_IN_USE",
      memberId,
      memberName: member.name,
      ...counts,
      message: memberInUseMessage(member.name, counts),
    });
  }
  return ok({
    ...group,
    members: group.members.filter((candidate) => candidate.id !== memberId),
  });
}

/** Needs at least 2 members, then validates the expense. The caller supplies the id. */
export function addExpense(group: Group, expense: Expense): Result<Group, DomainError> {
  if (group.members.length < 2) {
    return err({
      code: "NOT_ENOUGH_MEMBERS",
      message: "Add at least 2 members before adding an expense.",
    });
  }
  if (group.expenses.some((existing) => existing.id === expense.id)) {
    return err({
      code: "DUPLICATE_ID",
      id: expense.id,
      message: "That expense id is already in use.",
    });
  }
  const checked = validateExpense(expense, group.members);
  if (!checked.ok) return checked;
  const stored: Expense = { ...expense, description: expense.description.trim() };
  return ok({ ...group, expenses: [...group.expenses, stored] });
}

export function deleteExpense(group: Group, expenseId: string): Result<Group, DomainError> {
  // Single pass: filter out the matching expense and check if the array length changed,
  // avoiding a separate `.some()` scan before `.filter()`.
  const remaining = group.expenses.filter((expense) => expense.id !== expenseId);
  if (remaining.length === group.expenses.length) {
    return err({ code: "NOT_FOUND", id: expenseId, message: "That expense does not exist." });
  }
  return ok({ ...group, expenses: remaining });
}

export function addPayment(group: Group, payment: Payment): Result<Group, DomainError> {
  if (group.payments.some((existing) => existing.id === payment.id)) {
    return err({
      code: "DUPLICATE_ID",
      id: payment.id,
      message: "That payment id is already in use.",
    });
  }
  const checked = validatePayment(payment, group.members);
  if (!checked.ok) return checked;
  const next: Group = { ...group, payments: [...group.payments, payment] };
  // Individually valid payments can still add up past the safe integer range.
  if (!computeBalances(next).ok) {
    return err({
      code: "INVALID_AMOUNT",
      message: "Amount would make a balance too large to track exactly.",
    });
  }
  return ok(next);
}

export function deletePayment(group: Group, paymentId: string): Result<Group, DomainError> {
  // Single pass: filter out the matching payment and check if the array length changed.
  const remaining = group.payments.filter((payment) => payment.id !== paymentId);
  if (remaining.length === group.payments.length) {
    return err({ code: "NOT_FOUND", id: paymentId, message: "That payment does not exist." });
  }
  return ok({ ...group, payments: remaining });
}
