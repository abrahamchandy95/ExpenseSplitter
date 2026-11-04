import type { Bps, Cents, Result } from "./types";
import { err, ok } from "./types";

export const MAX_EXPENSE_CENTS = 100_000_000;
export const MAX_PERCENT_BPS = 10_000;

export type AmountErrorCode =
  | "EMPTY"
  | "NOT_NUMERIC"
  | "NEGATIVE"
  | "TOO_MANY_DECIMALS"
  | "ZERO"
  | "TOO_LARGE";

export type PercentErrorCode =
  | "EMPTY"
  | "NOT_NUMERIC"
  | "NEGATIVE"
  | "TOO_MANY_DECIMALS"
  | "ABOVE_100";

export interface AmountError {
  code: AmountErrorCode;
  message: string;
}

export interface PercentError {
  code: PercentErrorCode;
  message: string;
}

const GRAMMAR = /^(-)?([0-9]+)(?:\.([0-9]+))?$/;
const MAX_PERCENT_BPS_BIGINT = BigInt(MAX_PERCENT_BPS);

interface Scaled {
  negative: boolean;
  /** Digits of the fraction part, 0 to many. */
  fractionDigits: number;
  /** whole * 100 + fraction right-padded to 2 digits. Only valid when fractionDigits <= 2. */
  hundredths: bigint;
}

type Scan = { kind: "empty" } | { kind: "bad" } | { kind: "ok"; value: Scaled };

/** Shared grammar for amount and percent text. Never goes through Number or floats. */
function scan(text: string): Scan {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  const match = GRAMMAR.exec(trimmed);
  if (!match) return { kind: "bad" };
  const whole = match[2];
  const fraction = match[3] ?? "";
  // Only compute `hundredths` when `fractionDigits <= 2` so we skip BigInt math on invalid precision.
  const padded = fraction.length >= 2 ? fraction.slice(0, 2) : fraction.padEnd(2, "0");
  return {
    kind: "ok",
    value: {
      negative: match[1] === "-",
      fractionDigits: fraction.length,
      hundredths: fraction.length <= 2 ? BigInt(whole) * 100n + BigInt(padded) : 0n,
    },
  };
}

const amountError = (code: AmountErrorCode, message: string) => err<AmountError>({ code, message });
const percentError = (code: PercentErrorCode, message: string) =>
  err<PercentError>({ code, message });

/**
 * Parses dollar text into integer cents. Check order: empty, non-numeric,
 * negative (including "-0"), more than 2 decimals, zero, above the cap.
 */
export function parseAmountCents(
  text: string,
  maxCents: Cents = MAX_EXPENSE_CENTS,
): Result<Cents, AmountError> {
  const scanned = scan(text);
  if (scanned.kind === "empty") return amountError("EMPTY", "Enter an amount.");
  if (scanned.kind === "bad") {
    return amountError("NOT_NUMERIC", "Enter a number like 12, 12.5, or 12.50.");
  }
  const scaled = scanned.value;
  if (scaled.negative) return amountError("NEGATIVE", "Amount must be greater than zero.");
  if (scaled.fractionDigits > 2) {
    return amountError("TOO_MANY_DECIMALS", "Use at most 2 decimal places.");
  }
  if (scaled.hundredths === 0n) return amountError("ZERO", "Amount must be greater than zero.");
  if (scaled.hundredths > BigInt(maxCents)) {
    return amountError("TOO_LARGE", "Amount is above the maximum allowed.");
  }
  return ok(Number(scaled.hundredths));
}

/**
 * Parses percent text into integer bps. Check order: empty, non-numeric,
 * negative (including "-0"), more than 2 decimals, above 100. Zero is valid.
 * Callers that treat blank as 0.00 must handle blank before calling.
 */
export function parsePercentBps(text: string): Result<Bps, PercentError> {
  const scanned = scan(text);
  if (scanned.kind === "empty") return percentError("EMPTY", "Enter a percent.");
  if (scanned.kind === "bad") {
    return percentError("NOT_NUMERIC", "Enter a number like 25 or 33.33.");
  }
  const scaled = scanned.value;
  if (scaled.negative) return percentError("NEGATIVE", "Percent cannot be negative.");
  if (scaled.fractionDigits > 2) {
    return percentError("TOO_MANY_DECIMALS", "Use at most 2 decimal places.");
  }
  if (scaled.hundredths > MAX_PERCENT_BPS_BIGINT) {
    return percentError("ABOVE_100", "Percent cannot be above 100.");
  }
  return ok(Number(scaled.hundredths));
}
