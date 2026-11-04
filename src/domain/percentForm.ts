import { apportion } from "./apportion";
import { formatBps, formatPercent, totalLineText } from "./format";
import { parsePercentBps } from "./parse";
import type { PercentErrorCode } from "./parse";
import type { Bps, Member, PercentSplit, Result } from "./types";
import { err, ok } from "./types";

export interface PercentRowInput {
  memberId: string;
  text: string;
}

export interface PercentFieldError {
  code: Exclude<PercentErrorCode, "EMPTY">;
  message: string;
}

export interface PercentRowEvaluation {
  memberId: string;
  /** Parsed value; a blank field is 0. Null when the field has an error. */
  bps: Bps | null;
  /** At most one error per field. */
  error: PercentFieldError | null;
}

export type PercentStatus = "exact" | "under" | "over" | "invalid";

export interface PercentFormEvaluation {
  rows: PercentRowEvaluation[];
  /** Null when any field is invalid. */
  totalBps: Bps | null;
  status: PercentStatus;
  /** Absolute distance from 100.00% in bps; 0 when exact or invalid. */
  gapBps: Bps;
  /** The live line shown next to the inputs. */
  totalLine: string;
  /** Why Save is disabled, or null when the split is exactly 100.00%. */
  saveDisabledReason: string | null;
  /** Member ids whose fields have an error, in row order. */
  invalidMemberIds: string[];
}

function evaluateRow(row: PercentRowInput): PercentRowEvaluation {
  if (row.text.trim() === "") return { memberId: row.memberId, bps: 0, error: null };
  const parsed = parsePercentBps(row.text);
  if (parsed.ok) return { memberId: row.memberId, bps: parsed.value, error: null };
  // EMPTY was handled above, so the code is one of the field errors.
  const { code, message } = parsed.error;
  return { memberId: row.memberId, bps: null, error: { code: code as PercentFieldError["code"], message } };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Evaluates every percent field. Blank counts as 0.00. `members` supplies the
 * names used in the Save disabled reason for invalid fields.
 */
export function evaluatePercentRows(
  rows: readonly PercentRowInput[],
  members: readonly Member[],
): PercentFormEvaluation {
  // Single pass to evaluate each row, collect invalid member IDs, and sum valid bps
  const evaluated: PercentRowEvaluation[] = [];
  const invalidMemberIds: string[] = [];
  let total = 0;

  for (const row of rows) {
    const evaluatedRow = evaluateRow(row);
    evaluated.push(evaluatedRow);
    if (evaluatedRow.error !== null) {
      invalidMemberIds.push(row.memberId);
    } else if (evaluatedRow.bps !== null) {
      total += evaluatedRow.bps;
    }
  }

  if (invalidMemberIds.length > 0) {
    const names = invalidMemberIds.map(
      (id) => members.find((member) => member.id === id)?.name ?? id,
    );
    return {
      rows: evaluated,
      totalBps: null,
      status: "invalid",
      gapBps: 0,
      totalLine: "Total unavailable until every field is valid.",
      saveDisabledReason: `Fix the invalid percent for ${joinNames(names)}.`,
      invalidMemberIds,
    };
  }

  const gapBps = Math.abs(10000 - total);
  const status: PercentStatus = total === 10000 ? "exact" : total < 10000 ? "under" : "over";
  const gapText =
    status === "under"
      ? `${formatPercent(gapBps)} still unassigned.`
      : `${formatPercent(gapBps)} over.`;
  return {
    rows: evaluated,
    totalBps: total,
    status,
    gapBps,
    totalLine: totalLineText(total),
    saveDisabledReason: status === "exact" ? null : `Percentages must total 100.00%. ${gapText}`,
    invalidMemberIds,
  };
}

/** 100.00 minus the other rows, as bps; null when any other row is invalid or the result is negative. */
function remainderBps(rows: readonly PercentRowInput[], memberId: string): Bps | null {
  let foundTarget = false;
  let others = 0;
  for (const row of rows) {
    if (row.memberId === memberId) {
      foundTarget = true;
      continue;
    }
    const evaluatedRow = evaluateRow(row);
    if (evaluatedRow.error || evaluatedRow.bps === null) return null;
    others += evaluatedRow.bps;
  }
  if (!foundTarget) return null;
  const rest = 10000 - others;
  return rest >= 0 ? rest : null;
}

/** Fill remainder is offered when every other row is valid and the result is 0.00 or more. */
export function canFillRemainder(rows: readonly PercentRowInput[], memberId: string): boolean {
  return remainderBps(rows, memberId) !== null;
}

/** Text for the row after Fill remainder ("20.00"), ignoring that row's current text. Null when not offered. */
export function fillRemainderText(rows: readonly PercentRowInput[], memberId: string): string | null {
  const rest = remainderBps(rows, memberId);
  return rest === null ? null : formatBps(rest);
}

/** Equal percentages by largest remainder in row order: 3 rows give 33.34, 33.33, 33.33. */
export function splitEvenlyTexts(rowCount: number): string[] {
  if (rowCount <= 0) return [];
  return apportion(10000, new Array<number>(rowCount).fill(1)).map(formatBps);
}

export interface InvalidPercentFields {
  memberIds: string[];
}

/**
 * Builds the stored split: valid rows only, 0.00 rows dropped, row order kept.
 * Fails if any field is invalid. Does not check the sum; the domain does that
 * when the expense is added.
 */
export function rowsToPercentSplit(
  rows: readonly PercentRowInput[],
): Result<PercentSplit, InvalidPercentFields> {
  // Single pass to collect invalid rows and non-zero valid shares without intermediate arrays
  const invalidMemberIds: string[] = [];
  const shares: { memberId: string; bps: Bps }[] = [];

  for (const row of rows) {
    const evaluatedRow = evaluateRow(row);
    if (evaluatedRow.error !== null) {
      invalidMemberIds.push(row.memberId);
    } else if (evaluatedRow.bps !== null && evaluatedRow.bps > 0) {
      shares.push({ memberId: row.memberId, bps: evaluatedRow.bps });
    }
  }

  if (invalidMemberIds.length > 0) return err({ memberIds: invalidMemberIds });
  return ok({ kind: "percent", shares });
}
