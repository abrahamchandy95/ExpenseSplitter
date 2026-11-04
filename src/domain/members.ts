import type { DomainError, Group, Member, Result } from "./types";
import { err, ok } from "./types";

export const MAX_NAME_LENGTH = 40;

/** Trims and collapses internal runs of whitespace to a single space. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Returns the normalized name, or a typed error. Uniqueness ignores case. */
export function validateMemberName(
  raw: string,
  existing: readonly Member[],
): Result<string, DomainError> {
  const name = normalizeName(raw);
  if (name === "") return err({ code: "EMPTY_NAME", message: "Enter a name." });
  if (Array.from(name).length > MAX_NAME_LENGTH) {
    return err({
      code: "NAME_TOO_LONG",
      message: `Names can be at most ${MAX_NAME_LENGTH} characters.`,
    });
  }
  const lower = name.toLowerCase();
  if (existing.some((member) => member.name.toLowerCase() === lower)) {
    return err({ code: "DUPLICATE_NAME", message: `${name} is already in the group.` });
  }
  return ok(name);
}

export interface ReferenceCounts {
  expenseCount: number;
  paymentCount: number;
}

/** Counts each referencing record once, even if the member is both payer and participant. */
export function countReferences(group: Group, memberId: string): ReferenceCounts {
  let expenseCount = 0;
  for (const expense of group.expenses) {
    // Check `payerId === memberId` first so we skip scanning `split` when the member is the payer.
    if (
      expense.payerId === memberId ||
      (expense.split.kind === "even"
        ? expense.split.participantIds.includes(memberId)
        : expense.split.shares.some((share) => share.memberId === memberId))
    ) {
      expenseCount += 1;
    }
  }
  let paymentCount = 0;
  for (const payment of group.payments) {
    if (payment.from === memberId || payment.to === memberId) paymentCount += 1;
  }
  return { expenseCount, paymentCount };
}

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** "Alice is used by 2 expenses and 1 payment." Only call with at least one reference. */
export function memberInUseMessage(name: string, counts: ReferenceCounts): string {
  const parts: string[] = [];
  if (counts.expenseCount > 0) parts.push(pluralize(counts.expenseCount, "expense"));
  if (counts.paymentCount > 0) parts.push(pluralize(counts.paymentCount, "payment"));
  return `${name} is used by ${parts.join(" and ")}.`;
}
