/** Integer cents. Never a float. */
export type Cents = number;
/** Integer hundredths of a percent: 10000 means 100.00%. */
export type Bps = number;

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

export interface Member {
  id: string;
  name: string;
}

export interface EvenSplit {
  kind: "even";
  participantIds: string[];
}

export interface PercentShare {
  memberId: string;
  bps: Bps;
}

export interface PercentSplit {
  kind: "percent";
  shares: PercentShare[];
}

export type Split = EvenSplit | PercentSplit;

export interface Expense {
  id: string;
  description: string;
  amountCents: Cents;
  payerId: string;
  /** Calendar date as YYYY-MM-DD. */
  date: string;
  split: Split;
}

export interface Payment {
  id: string;
  from: string;
  to: string;
  amountCents: Cents;
}

export interface Group {
  /** In the order members were added; this order breaks every rounding tie. */
  members: Member[];
  expenses: Expense[];
  payments: Payment[];
}

export interface Transfer {
  from: string;
  to: string;
  amountCents: Cents;
}

/** Cents owed to one member by one expense. */
export interface Allocation {
  memberId: string;
  cents: Cents;
}

/** Positive netCents means the group owes this member. */
export interface Balance {
  memberId: string;
  name: string;
  netCents: Cents;
}

interface Base<C extends string> {
  code: C;
  message: string;
}

export type DomainError =
  | Base<"INVALID_AMOUNT">
  | Base<"INVALID_DESCRIPTION">
  | Base<"INVALID_DATE">
  | (Base<"UNKNOWN_MEMBER"> & { memberId: string })
  | Base<"INVALID_SPLIT">
  | (Base<"PERCENT_SUM_MISMATCH"> & { expected: Bps; actual: Bps })
  | Base<"SAME_MEMBER">
  | Base<"NOT_ENOUGH_MEMBERS">
  | Base<"EMPTY_NAME">
  | Base<"NAME_TOO_LONG">
  | Base<"DUPLICATE_NAME">
  | (Base<"MEMBER_IN_USE"> & {
      memberId: string;
      memberName: string;
      expenseCount: number;
      paymentCount: number;
    })
  | (Base<"NOT_FOUND"> & { id: string })
  | (Base<"DUPLICATE_ID"> & { id: string })
  | (Base<"INVALID_PERCENT_FIELDS"> & { memberIds: string[] })
  | Base<"INVALID_STATE">;

export type DomainErrorCode = DomainError["code"];
