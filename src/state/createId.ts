let fallbackCounter = 0;

/**
 * Generates a unique ID for a new member, expense, or payment.
 * Uses the browser/Node `crypto.randomUUID()` API when available, and falls back
 * to a timestamp + counter + random suffix in non-secure HTTP contexts.
 */
export function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `id-${Date.now().toString(36)}-${fallbackCounter}-${Math.random().toString(36).slice(2, 10)}`;
}
