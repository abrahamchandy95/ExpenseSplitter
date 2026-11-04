import { STORAGE_KEY, deserializeState, emptyState, serializeState } from "@/domain";
import type { Group } from "@/domain";

/** The subset of the Web Storage API the app needs, so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DISCARD_NOTICE =
  "Saved data could not be read, so it was discarded and the group was reset to empty.";
export const UNAVAILABLE_NOTICE =
  "This browser is not allowing saved data, so changes will not be kept after you leave.";

export interface LoadOutcome {
  state: Group;
  /** Visible message when stored data was discarded or storage is unavailable. */
  notice: string | null;
}

export interface StatePersistence {
  load(): LoadOutcome;
  /** Writes only after load() has finished; returns whether a write happened. */
  save(state: Group): boolean;
  isLoaded(): boolean;
}

export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Accessing localStorage throws when the browser blocks it.
    return null;
  }
}

/**
 * The storage is resolved lazily so nothing touches `window` during server
 * rendering. The `hasLoaded` flag is set only once the read attempt is over, so an
 * early save can never overwrite data that has not been read yet.
 */
export function createStatePersistence(
  getStorage: () => StorageLike | null = getBrowserStorage,
): StatePersistence {
  let hasLoaded = false;
  // Tracks the last state object and JSON string written/loaded so we don't
  // redundantly serialize and write the exact same data right after `load()`.
  let lastSavedState: Group | null = null;
  let lastSavedJson: string | null = null;

  function load(): LoadOutcome {
    try {
      let storage: StorageLike | null = null;
      try {
        storage = getStorage();
      } catch {
        storage = null;
      }
      if (!storage) return { state: emptyState(), notice: UNAVAILABLE_NOTICE };

      let rawJson: string | null;
      try {
        rawJson = storage.getItem(STORAGE_KEY);
      } catch {
        return { state: emptyState(), notice: UNAVAILABLE_NOTICE };
      }
      if (rawJson === null) {
        const initial = emptyState();
        lastSavedState = initial;
        return { state: initial, notice: null };
      }

      const parsed = deserializeState(rawJson);
      // Never repair: one dropped record would silently change every balance.
      if (!parsed.ok) return { state: emptyState(), notice: DISCARD_NOTICE };

      lastSavedState = parsed.value;
      lastSavedJson = rawJson;
      return { state: parsed.value, notice: null };
    } finally {
      hasLoaded = true;
    }
  }

  function save(state: Group): boolean {
    if (!hasLoaded) return false;
    try {
      const storage = getStorage();
      if (!storage) return false;

      // Fast path: if the exact same Group object reference was just loaded
      // or saved, skip JSON serialization and disk write completely.
      if (state === lastSavedState && lastSavedJson !== null) {
        return true;
      }

      const serialized = serializeState(state);
      if (serialized === lastSavedJson) {
        lastSavedState = state;
        return true;
      }

      storage.setItem(STORAGE_KEY, serialized);
      lastSavedState = state;
      lastSavedJson = serialized;
      return true;
    } catch {
      return false;
    }
  }

  return { load, save, isLoaded: () => hasLoaded };
}
