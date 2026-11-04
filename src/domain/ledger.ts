import { allocateValidated } from "./allocate";
import type { Balance, DomainError, Group, Result } from "./types";
import { err, ok } from "./types";
import { validateState } from "./validate";

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function computeBalancesValidated(group: Group): Result<Balance[], DomainError> {
  const netByMemberId = new Map<string, bigint>();
  const memberIndexById = new Map<string, number>();
  group.members.forEach((member, index) => {
    netByMemberId.set(member.id, 0n);
    memberIndexById.set(member.id, index);
  });

  const addCents = (memberId: string, deltaCents: number) =>
    netByMemberId.set(memberId, (netByMemberId.get(memberId) ?? 0n) + BigInt(deltaCents));

  for (const expense of group.expenses) {
    addCents(expense.payerId, expense.amountCents);
    for (const allocation of allocateValidated(expense, group.members, memberIndexById)) {
      addCents(allocation.memberId, -allocation.cents);
    }
  }
  for (const payment of group.payments) {
    addCents(payment.from, payment.amountCents);
    addCents(payment.to, -payment.amountCents);
  }

  const balances: Balance[] = [];
  for (const member of group.members) {
    const exactNet = netByMemberId.get(member.id) ?? 0n;
    if (exactNet > MAX_SAFE_BIGINT || exactNet < -MAX_SAFE_BIGINT) {
      return err({
        code: "INVALID_STATE",
        message: "Balances are too large to be represented exactly.",
      });
    }
    balances.push({ memberId: member.id, name: member.name, netCents: Number(exactNet) });
  }
  return ok(balances);
}

/**
 * Net balance per member, in member order: paid, minus allocated, plus payments
 * sent, minus payments received. Positive means the group owes the member.
 * Validates the whole group first. The nets always sum to zero.
 * Sums are exact (BigInt); a net outside the safe integer range is INVALID_STATE,
 * since each payment is only bounded individually and totals can still overflow.
 */
export function computeBalances(group: Group): Result<Balance[], DomainError> {
  const checked = validateState(group);
  if (!checked.ok) return checked;
  return computeBalancesValidated(group);
}
