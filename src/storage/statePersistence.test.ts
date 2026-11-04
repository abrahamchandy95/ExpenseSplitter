import { describe, expect, it } from "vitest";
import { STORAGE_KEY, addMember, emptyState, serializeState } from "@/domain";
import type { Group } from "@/domain";
import {
  DISCARD_NOTICE,
  UNAVAILABLE_NOTICE,
  createStatePersistence,
} from "./statePersistence";
import type { StorageLike } from "./statePersistence";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      data.set(key, value);
    },
  };
  return { storage, data, writes };
}

function twoMembers(): Group {
  let s = emptyState();
  for (const [id, name] of [["a", "Alice"], ["b", "Bob"]]) {
    const r = addMember(s, id, name);
    if (!r.ok) throw new Error(r.error.message);
    s = r.value;
  }
  return s;
}

describe("state persistence", () => {
  it("round trips a saved group", () => {
    const { storage } = memoryStorage();
    const first = createStatePersistence(() => storage);
    first.load();
    expect(first.save(twoMembers())).toBe(true);

    const second = createStatePersistence(() => storage).load();
    expect(second.notice).toBeNull();
    expect(second.state).toEqual(twoMembers());
  });

  it("starts empty without a notice when nothing is stored", () => {
    const { storage } = memoryStorage();
    const outcome = createStatePersistence(() => storage).load();
    expect(outcome).toEqual({ state: emptyState(), notice: null });
  });

  it("discards corrupt JSON with a notice", () => {
    const { storage } = memoryStorage({ [STORAGE_KEY]: "{not json" });
    const outcome = createStatePersistence(() => storage).load();
    expect(outcome.state).toEqual(emptyState());
    expect(outcome.notice).toBe(DISCARD_NOTICE);
  });

  it("discards the whole state when one record is invalid, never repairing it", () => {
    const bad = {
      members: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }],
      expenses: [
        {
          id: "e1",
          description: "Dinner",
          amountCents: 9000,
          payerId: "a",
          date: "2026-01-15",
          split: { kind: "even", participantIds: ["a", "ghost"] },
        },
      ],
      payments: [],
    };
    const { storage } = memoryStorage({ [STORAGE_KEY]: JSON.stringify(bad) });
    const outcome = createStatePersistence(() => storage).load();
    expect(outcome.state).toEqual(emptyState());
    expect(outcome.notice).toBe(DISCARD_NOTICE);
  });

  it("writes nothing until the load attempt has finished", () => {
    const stored = serializeState(twoMembers());
    const { storage, data, writes } = memoryStorage({ [STORAGE_KEY]: stored });
    const persistence = createStatePersistence(() => storage);

    expect(persistence.isLoaded()).toBe(false);
    expect(persistence.save(emptyState())).toBe(false);
    expect(writes).toEqual([]);
    expect(data.get(STORAGE_KEY)).toBe(stored);

    persistence.load();
    expect(persistence.isLoaded()).toBe(true);
    expect(persistence.save(emptyState())).toBe(true);
    expect(writes).toEqual([STORAGE_KEY]);
  });

  it("marks the load finished even when the read throws", () => {
    const persistence = createStatePersistence(() => ({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    }));
    const outcome = persistence.load();
    expect(outcome.notice).toBe(UNAVAILABLE_NOTICE);
    expect(persistence.isLoaded()).toBe(true);
  });

  it("reports unavailable storage and does not throw on save", () => {
    const persistence = createStatePersistence(() => null);
    expect(persistence.load().notice).toBe(UNAVAILABLE_NOTICE);
    expect(persistence.save(emptyState())).toBe(false);
  });
});
