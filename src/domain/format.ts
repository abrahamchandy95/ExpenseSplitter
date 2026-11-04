import type { Bps, Cents } from "./types";

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

function groupThousands(digits: string): string {
  // Fast path: 1-3 digit dollar amounts (< $1,000) need no comma grouping.
  if (digits.length <= 3) return digits;
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return grouped;
}

/** "$1,234.50", "-$5.00", "$0.00". Integer arithmetic only. */
export function formatCents(cents: Cents): string {
  assertInteger(cents, "cents");
  const isNegative = cents < 0;
  const absCents = isNegative ? -cents : cents;
  const remainder = absCents % 100;
  const dollars = (absCents - remainder) / 100;
  const body = `$${groupThousands(String(dollars))}.${String(remainder).padStart(2, "0")}`;
  return isNegative && absCents !== 0 ? `-${body}` : body;
}

/** Exactly 2 decimals, no percent sign: 3334 gives "33.34", 10000 gives "100.00". */
export function formatBps(bps: Bps): string {
  assertInteger(bps, "bps");
  const isNegative = bps < 0;
  const absBps = isNegative ? -bps : bps;
  const remainder = absBps % 100;
  const whole = (absBps - remainder) / 100;
  const body = `${whole}.${String(remainder).padStart(2, "0")}`;
  return isNegative && absBps !== 0 ? `-${body}` : body;
}

/** "33.34%". */
export function formatPercent(bps: Bps): string {
  return `${formatBps(bps)}%`;
}

/** "Total 90.00%. 10.00% still unassigned." / "Total 105.00%. 5.00% over." / "Total 100.00%." */
export function totalLineText(totalBps: Bps): string {
  const head = `Total ${formatPercent(totalBps)}.`;
  if (totalBps < 10000) return `${head} ${formatPercent(10000 - totalBps)} still unassigned.`;
  if (totalBps > 10000) return `${head} ${formatPercent(totalBps - 10000)} over.`;
  return head;
}

export type BalanceKind = "owed" | "owes" | "settled";

/** "is owed $60.00", "owes $30.00", or "settled". */
export function describeBalance(netCents: Cents): { kind: BalanceKind; text: string } {
  if (netCents > 0) return { kind: "owed", text: `is owed ${formatCents(netCents)}` };
  if (netCents < 0) return { kind: "owes", text: `owes ${formatCents(-netCents)}` };
  return { kind: "settled", text: "settled" };
}
