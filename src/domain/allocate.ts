import { apportion } from "./apportion";
import type { Allocation, DomainError, Expense, Member, Result } from "./types";
import { ok } from "./types";
import { validateExpense } from "./validate";

/** Allocation of an already validated expense, listed in member order. */
export function allocateValidated(
  expense: Expense,
  members: readonly Member[],
  memberIndexById: ReadonlyMap<string, number> = new Map(
    members.map((member, index) => [member.id, index]),
  ),
): Allocation[] {
  const compareMemberOrder = (firstId: string, secondId: string) =>
    (memberIndexById.get(firstId) ?? 0) - (memberIndexById.get(secondId) ?? 0);

  if (expense.split.kind === "even") {
    const participantIds = [...expense.split.participantIds].sort(compareMemberOrder);
    const cents = apportion(
      expense.amountCents,
      participantIds.map(() => 1),
    );
    return participantIds.map((memberId, index) => ({ memberId, cents: cents[index] }));
  }

  const shares = [...expense.split.shares].sort((first, second) =>
    compareMemberOrder(first.memberId, second.memberId),
  );
  const cents = apportion(
    expense.amountCents,
    shares.map((share) => share.bps),
  );
  return shares.map((share, index) => ({ memberId: share.memberId, cents: cents[index] }));
}

/**
 * Cents owed per participant (members with a stored share), in member order.
 * Validates first. The cents always sum to expense.amountCents.
 */
export function allocateExpense(
  expense: Expense,
  members: readonly Member[],
): Result<Allocation[], DomainError> {
  const checked = validateExpense(expense, members);
  if (!checked.ok) return checked;
  return ok(allocateValidated(expense, members));
}
