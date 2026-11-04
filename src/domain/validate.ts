import { MAX_EXPENSE_CENTS } from "./parse";
import { totalLineText } from "./format";
import { normalizeName, MAX_NAME_LENGTH } from "./members";
import type {
  DomainError,
  Expense,
  Group,
  Member,
  Payment,
  Result,
  Split,
} from "./types";
import { err, ok } from "./types";

const fail = (error: DomainError) => err<DomainError>(error);
const invalidSplit = (message: string) => fail({ code: "INVALID_SPLIT", message });

const DATE_REGEX = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isDigitDate(dateString: string): boolean {
  const match = DATE_REGEX.exec(dateString);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  if (month === 2) {
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return day <= (isLeapYear ? 29 : 28);
  }
  return day <= MONTH_DAYS[month - 1];
}

function validateSplit(split: Split, memberIds: ReadonlySet<string>): Result<Split, DomainError> {
  if (split.kind === "even") {
    const participantIds = split.participantIds;
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return invalidSplit("Choose at least one participant.");
    }
    const seenIds = new Set<string>();
    for (const participantId of participantIds) {
      if (!memberIds.has(participantId)) {
        return fail({
          code: "UNKNOWN_MEMBER",
          message: "A participant is not in the group.",
          memberId: participantId,
        });
      }
      if (seenIds.has(participantId)) {
        return invalidSplit("Each participant can appear only once.");
      }
      seenIds.add(participantId);
    }
    return ok(split);
  }
  if (split.kind === "percent") {
    const shares = split.shares;
    if (!Array.isArray(shares)) return invalidSplit("Percent split must list its shares.");
    const seenIds = new Set<string>();
    let totalBps = 0;
    for (const share of shares) {
      if (!memberIds.has(share.memberId)) {
        return fail({
          code: "UNKNOWN_MEMBER",
          message: "A participant is not in the group.",
          memberId: share.memberId,
        });
      }
      if (seenIds.has(share.memberId)) return invalidSplit("Each member can appear only once.");
      seenIds.add(share.memberId);
      if (!Number.isInteger(share.bps) || share.bps < 1 || share.bps > 10000) {
        return invalidSplit(
          "Each percent must be a whole number of hundredths from 0.01% to 100.00%.",
        );
      }
      totalBps += share.bps;
    }
    if (totalBps !== 10000) {
      return fail({
        code: "PERCENT_SUM_MISMATCH",
        expected: 10000,
        actual: totalBps,
        message: totalLineText(totalBps),
      });
    }
    return ok(split);
  }
  return invalidSplit("Unknown split type.");
}

/** Checks one expense against the member list. Returns the same expense on success. */
export function validateExpense(
  expense: Expense,
  members: readonly Member[],
  memberIds: ReadonlySet<string> = new Set(members.map((member) => member.id)),
): Result<Expense, DomainError> {
  const { amountCents } = expense;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return fail({
      code: "INVALID_AMOUNT",
      message: "Amount must be a positive whole number of cents.",
    });
  }
  if (amountCents > MAX_EXPENSE_CENTS) {
    return fail({ code: "INVALID_AMOUNT", message: "Amount is above the maximum allowed." });
  }
  if (typeof expense.description !== "string" || expense.description.trim() === "") {
    return fail({ code: "INVALID_DESCRIPTION", message: "Enter a description." });
  }
  if (typeof expense.date !== "string" || !isDigitDate(expense.date)) {
    return fail({ code: "INVALID_DATE", message: "Enter a valid date (YYYY-MM-DD)." });
  }
  if (!memberIds.has(expense.payerId)) {
    return fail({
      code: "UNKNOWN_MEMBER",
      message: "The payer is not in the group.",
      memberId: expense.payerId,
    });
  }
  const split = validateSplit(expense.split, memberIds);
  if (!split.ok) return split;
  return ok(expense);
}

/** Checks one payment against the member list. No expense cap applies. */
export function validatePayment(
  payment: Payment,
  members: readonly Member[],
  memberIds: ReadonlySet<string> = new Set(members.map((member) => member.id)),
): Result<Payment, DomainError> {
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
    return fail({
      code: "INVALID_AMOUNT",
      message: "Amount must be a positive whole number of cents.",
    });
  }
  if (!memberIds.has(payment.from)) {
    return fail({
      code: "UNKNOWN_MEMBER",
      message: "The sender is not in the group.",
      memberId: payment.from,
    });
  }
  if (!memberIds.has(payment.to)) {
    return fail({
      code: "UNKNOWN_MEMBER",
      message: "The recipient is not in the group.",
      memberId: payment.to,
    });
  }
  if (payment.from === payment.to) {
    return fail({ code: "SAME_MEMBER", message: "A payment needs two different members." });
  }
  return ok(payment);
}

const invalidStoredState = (reason: string) =>
  fail({ code: "INVALID_STATE", message: `Stored data is invalid: ${reason}.` });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readSplit(value: unknown): Split | null {
  if (!isRecord(value)) return null;
  if (value.kind === "even") {
    const participantIds = value.participantIds;
    if (
      !Array.isArray(participantIds) ||
      !participantIds.every((item) => typeof item === "string")
    ) {
      return null;
    }
    return { kind: "even", participantIds: [...participantIds] };
  }
  if (value.kind === "percent") {
    const rawShares = value.shares;
    if (!Array.isArray(rawShares)) return null;
    const shares: { memberId: string; bps: number }[] = [];
    for (const rawShare of rawShares) {
      if (
        !isRecord(rawShare) ||
        typeof rawShare.memberId !== "string" ||
        typeof rawShare.bps !== "number"
      ) {
        return null;
      }
      shares.push({ memberId: rawShare.memberId, bps: rawShare.bps });
    }
    return { kind: "percent", shares };
  }
  return null;
}

/**
 * Validates untrusted data (parsed JSON from storage) as a Group. All or
 * nothing: any problem rejects the whole state. Returns a clean copy that
 * contains only the known fields.
 */
export function validateState(input: unknown): Result<Group, DomainError> {
  if (!isRecord(input)) return invalidStoredState("state is not an object");
  const { members: rawMembers, expenses: rawExpenses, payments: rawPayments } = input;
  if (!Array.isArray(rawMembers)) return invalidStoredState("members is not a list");
  if (!Array.isArray(rawExpenses)) return invalidStoredState("expenses is not a list");
  if (!Array.isArray(rawPayments)) return invalidStoredState("payments is not a list");

  const members: Member[] = [];
  const memberIds = new Set<string>();
  const lowerNames = new Set<string>();
  for (const rawMember of rawMembers) {
    if (
      !isRecord(rawMember) ||
      typeof rawMember.id !== "string" ||
      typeof rawMember.name !== "string" ||
      rawMember.id === ""
    ) {
      return invalidStoredState("a member is malformed");
    }
    if (memberIds.has(rawMember.id)) return invalidStoredState("member ids are not unique");
    memberIds.add(rawMember.id);
    const name = normalizeName(rawMember.name);
    if (name === "" || name !== rawMember.name || Array.from(name).length > MAX_NAME_LENGTH) {
      return invalidStoredState("a member name is not valid");
    }
    const lowerName = name.toLowerCase();
    if (lowerNames.has(lowerName)) return invalidStoredState("member names are not unique");
    lowerNames.add(lowerName);
    members.push({ id: rawMember.id, name });
  }

  const expenses: Expense[] = [];
  const expenseIds = new Set<string>();
  for (const rawExpense of rawExpenses) {
    if (
      !isRecord(rawExpense) ||
      typeof rawExpense.id !== "string" ||
      typeof rawExpense.description !== "string" ||
      typeof rawExpense.amountCents !== "number" ||
      typeof rawExpense.payerId !== "string" ||
      typeof rawExpense.date !== "string"
    ) {
      return invalidStoredState("an expense is malformed");
    }
    const split = readSplit(rawExpense.split);
    if (!split) return invalidStoredState("an expense split is malformed");
    if (expenseIds.has(rawExpense.id)) return invalidStoredState("expense ids are not unique");
    expenseIds.add(rawExpense.id);
    const expense: Expense = {
      id: rawExpense.id,
      description: rawExpense.description,
      amountCents: rawExpense.amountCents,
      payerId: rawExpense.payerId,
      date: rawExpense.date,
      split,
    };
    // Pass the already-built `memberIds` Set so `validateExpense` doesn't rebuild it per expense.
    const checked = validateExpense(expense, members, memberIds);
    if (!checked.ok) {
      return invalidStoredState(`expense "${rawExpense.id}" fails validation (${checked.error.code})`);
    }
    expenses.push(expense);
  }

  const payments: Payment[] = [];
  const paymentIds = new Set<string>();
  for (const rawPayment of rawPayments) {
    if (
      !isRecord(rawPayment) ||
      typeof rawPayment.id !== "string" ||
      typeof rawPayment.from !== "string" ||
      typeof rawPayment.to !== "string" ||
      typeof rawPayment.amountCents !== "number"
    ) {
      return invalidStoredState("a payment is malformed");
    }
    if (paymentIds.has(rawPayment.id)) return invalidStoredState("payment ids are not unique");
    paymentIds.add(rawPayment.id);
    const payment: Payment = {
      id: rawPayment.id,
      from: rawPayment.from,
      to: rawPayment.to,
      amountCents: rawPayment.amountCents,
    };
    // Pass the already-built `memberIds` Set so `validatePayment` doesn't rebuild it per payment.
    const checked = validatePayment(payment, members, memberIds);
    if (!checked.ok) {
      return invalidStoredState(`payment "${rawPayment.id}" fails validation (${checked.error.code})`);
    }
    payments.push(payment);
  }

  return ok({ members, expenses, payments });
}
