import { computeBalances } from "./ledger";
import type { Balance, DomainError, Group, Result, Transfer } from "./types";
import { ok } from "./types";

interface WorkingBalance {
  memberId: string;
  lowerName: string;
  netCents: number;
}

/**
 * Greedy settlement: repeatedly pair the member who owes the most with the
 * member who is owed the most (ties by lowercase name), transfer the smaller
 * amount, and update both balances. Each transfer zeroes at least one balance,
 * so there are at most max(0, k - 1) transfers for k nonzero balances. Balances
 * must sum to zero. Deterministic: the same input gives the same ordered plan.
 */
export function buildSettlementPlan(balances: readonly Balance[]): Transfer[] {
  // Filter to only non-zero balances and precompute `lowerName` once so tie-breaking
  // inside the greedy loop never allocates new lowercase strings.
  const remaining: WorkingBalance[] = [];
  for (const balance of balances) {
    if (balance.netCents !== 0) {
      remaining.push({
        memberId: balance.memberId,
        lowerName: balance.name.toLowerCase(),
        netCents: balance.netCents,
      });
    }
  }

  const plan: Transfer[] = [];
  for (;;) {
    let debtor: WorkingBalance | undefined;
    let creditor: WorkingBalance | undefined;
    for (const candidate of remaining) {
      if (
        candidate.netCents < 0 &&
        (!debtor ||
          candidate.netCents < debtor.netCents ||
          (candidate.netCents === debtor.netCents && candidate.lowerName < debtor.lowerName))
      ) {
        debtor = candidate;
      }
      if (
        candidate.netCents > 0 &&
        (!creditor ||
          candidate.netCents > creditor.netCents ||
          (candidate.netCents === creditor.netCents && candidate.lowerName < creditor.lowerName))
      ) {
        creditor = candidate;
      }
    }
    if (!debtor || !creditor) break;
    const amountCents = Math.min(-debtor.netCents, creditor.netCents);
    plan.push({ from: debtor.memberId, to: creditor.memberId, amountCents });
    debtor.netCents += amountCents;
    creditor.netCents -= amountCents;
  }
  return plan;
}

export interface Summary {
  /** One per member, in member order. */
  balances: Balance[];
  /** Ordered list of transfers that settles everyone. */
  plan: Transfer[];
  /** True when every balance is zero (show "All settled up"). */
  allSettled: boolean;
}

export function summarize(group: Group): Result<Summary, DomainError> {
  const balances = computeBalances(group);
  if (!balances.ok) return balances;
  const plan = buildSettlementPlan(balances.value);
  return ok({
    balances: balances.value,
    plan,
    allSettled: plan.length === 0,
  });
}
