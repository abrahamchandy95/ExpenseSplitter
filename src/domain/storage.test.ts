import { describe, expect, it } from "vitest";
import { evenExpense, payment, stateOf } from "./testUtils";
import { deserializeState, serializeState, STORAGE_KEY } from "./storage";

describe("storage helpers", () => {
  it("uses the spec's key", () => {
    expect(STORAGE_KEY).toBe("expense-splitter:v1");
  });

  it("round trips a valid state", () => {
    const s = stateOf(undefined, [evenExpense("e", 9000, "a", ["a", "b", "c"])], [payment("p", "b", "a", 3000)]);
    expect(deserializeState(serializeState(s))).toEqual({ ok: true, value: s });
  });

  it("rejects text that is not JSON", () => {
    expect(deserializeState("{oops")).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
    expect(deserializeState("")).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
  });

  it("rejects valid JSON of the wrong shape and invalid states", () => {
    expect(deserializeState("null").ok).toBe(false);
    expect(deserializeState("[]").ok).toBe(false);
    const dangling = stateOf([], [evenExpense("e", 100, "a", ["a"])]);
    expect(deserializeState(JSON.stringify(dangling)).ok).toBe(false);
  });
});
