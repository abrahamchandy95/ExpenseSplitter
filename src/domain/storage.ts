import type { DomainError, Group, Result } from "./types";
import { err } from "./types";
import { computeBalancesValidated } from "./ledger";
import { validateState } from "./validate";

export const STORAGE_KEY = "expense-splitter:v1";

export function serializeState(group: Group): string {
  return JSON.stringify(group);
}

/** Parses and fully validates stored text. Any failure rejects the whole group. */
export function deserializeState(text: string): Result<Group, DomainError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err({ code: "INVALID_STATE", message: "Stored data is not valid JSON." });
  }
  const validated = validateState(parsed);
  if (!validated.ok) return validated;
  // `validated.value` just passed `validateState`, so call `computeBalancesValidated`
  // directly instead of running `validateState` a second time inside `computeBalances`.
  const balances = computeBalancesValidated(validated.value);
  return balances.ok ? validated : balances;
}
