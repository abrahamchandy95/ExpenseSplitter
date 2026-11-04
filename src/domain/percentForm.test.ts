import { describe, expect, it } from "vitest";
import {
  canFillRemainder,
  evaluatePercentRows,
  fillRemainderText,
  rowsToPercentSplit,
  splitEvenlyTexts,
} from "./percentForm";
import type { PercentRowInput } from "./percentForm";
import { trio } from "./testUtils";

const rows = (a: string, b: string, c: string): PercentRowInput[] => [
  { memberId: "a", text: a },
  { memberId: "b", text: b },
  { memberId: "c", text: c },
];

describe("evaluatePercentRows", () => {
  it("is exact at 100.00 and shows only the total", () => {
    const e = evaluatePercentRows(rows("50", "30", "20"), trio);
    expect(e).toMatchObject({
      status: "exact",
      totalBps: 10000,
      gapBps: 0,
      totalLine: "Total 100.00%.",
      saveDisabledReason: null,
      invalidMemberIds: [],
    });
    expect(e.rows.map((r) => r.bps)).toEqual([5000, 3000, 2000]);
  });

  it("reports under with the gap sentence (demo 50/30/10)", () => {
    const e = evaluatePercentRows(rows("50", "30", "10"), trio);
    expect(e.status).toBe("under");
    expect(e.gapBps).toBe(1000);
    expect(e.totalLine).toBe("Total 90.00%. 10.00% still unassigned.");
    expect(e.saveDisabledReason).toBe("Percentages must total 100.00%. 10.00% still unassigned.");
  });

  it("reports 33.33 x 3 as 99.99%", () => {
    const e = evaluatePercentRows(rows("33.33", "33.33", "33.33"), trio);
    expect(e.status).toBe("under");
    expect(e.totalLine).toBe("Total 99.99%. 0.01% still unassigned.");
  });

  it("reports over", () => {
    const e = evaluatePercentRows(rows("60", "30", "15"), trio);
    expect(e.status).toBe("over");
    expect(e.gapBps).toBe(500);
    expect(e.totalLine).toBe("Total 105.00%. 5.00% over.");
    expect(e.saveDisabledReason).toBe("Percentages must total 100.00%. 5.00% over.");
  });

  it("treats blank and whitespace-only fields as 0.00", () => {
    const e = evaluatePercentRows(rows("100", "", "   "), trio);
    expect(e.status).toBe("exact");
    expect(e.rows.map((r) => r.bps)).toEqual([10000, 0, 0]);
  });

  it("treats all-blank rows as 0.00 total", () => {
    const e = evaluatePercentRows(rows("", "", ""), trio);
    expect(e.status).toBe("under");
    expect(e.totalLine).toBe("Total 0.00%. 100.00% still unassigned.");
  });

  it("is invalid when any field has an error, naming the fields", () => {
    const e = evaluatePercentRows(rows("50", "abc", "-1"), trio);
    expect(e).toMatchObject({
      status: "invalid",
      totalBps: null,
      gapBps: 0,
      totalLine: "Total unavailable until every field is valid.",
      saveDisabledReason: "Fix the invalid percent for Bob and Carol.",
      invalidMemberIds: ["b", "c"],
    });
    expect(e.rows[0].error).toBeNull();
    expect(e.rows[1].error?.code).toBe("NOT_NUMERIC");
    expect(e.rows[2].error?.code).toBe("NEGATIVE");
  });

  it("shows one error per field in spec order", () => {
    const code = (t: string) => evaluatePercentRows([{ memberId: "a", text: t }], trio).rows[0].error?.code;
    expect(code("x")).toBe("NOT_NUMERIC");
    expect(code("-5")).toBe("NEGATIVE");
    expect(code("-5.123")).toBe("NEGATIVE");
    expect(code("100.123")).toBe("TOO_MANY_DECIMALS");
    expect(code("100.01")).toBe("ABOVE_100");
    expect(code("100")).toBeUndefined();
  });

  it("joins one, two, and three invalid names", () => {
    expect(evaluatePercentRows(rows("x", "0", "0"), trio).saveDisabledReason).toBe("Fix the invalid percent for Alice.");
    expect(evaluatePercentRows(rows("x", "x", "x"), trio).saveDisabledReason).toBe(
      "Fix the invalid percent for Alice, Bob, and Carol.",
    );
  });

  it("falls back to the id when a member is unknown", () => {
    const e = evaluatePercentRows([{ memberId: "q", text: "x" }], trio);
    expect(e.saveDisabledReason).toBe("Fix the invalid percent for q.");
  });
});

describe("canFillRemainder and fillRemainderText", () => {
  it("is offered when the others are valid and the result is not negative", () => {
    const r = rows("50", "30", "10");
    expect(canFillRemainder(r, "c")).toBe(true);
    expect(fillRemainderText(r, "c")).toBe("20.00");
    expect(fillRemainderText(r, "a")).toBe("60.00");
  });

  it("ignores the row's own current text, even when invalid", () => {
    const r = rows("50", "30", "garbage");
    expect(fillRemainderText(r, "c")).toBe("20.00");
  });

  it("gives 100.00 for a single row", () => {
    expect(fillRemainderText([{ memberId: "a", text: "7" }], "a")).toBe("100.00");
    expect(canFillRemainder([{ memberId: "a", text: "" }], "a")).toBe(true);
  });

  it("is not offered when another row is invalid", () => {
    const r = rows("50", "abc", "");
    expect(canFillRemainder(r, "c")).toBe(false);
    expect(fillRemainderText(r, "c")).toBeNull();
    expect(canFillRemainder(r, "b")).toBe(true);
  });

  it("is not offered when the others exceed 100.00", () => {
    const r = rows("60", "50", "");
    expect(canFillRemainder(r, "c")).toBe(false);
    expect(fillRemainderText(r, "c")).toBeNull();
  });

  it("offers 0.00 when the others total exactly 100.00", () => {
    const r = rows("60", "40", "5");
    expect(fillRemainderText(r, "c")).toBe("0.00");
    expect(canFillRemainder(r, "c")).toBe(true);
  });

  it("treats blank other rows as 0.00", () => {
    expect(fillRemainderText(rows("25.5", "", ""), "c")).toBe("74.50");
  });

  it("is not offered for an unknown row", () => {
    expect(canFillRemainder(rows("", "", ""), "zz")).toBe(false);
  });

  it("always produces an exact total when offered", () => {
    const r = rows("33.33", "33.33", "");
    const text = fillRemainderText(r, "c");
    expect(text).toBe("33.34");
    const filled = rows("33.33", "33.33", text as string);
    expect(evaluatePercentRows(filled, trio).status).toBe("exact");
  });
});

describe("splitEvenlyTexts", () => {
  it("uses largest remainder in row order", () => {
    expect(splitEvenlyTexts(3)).toEqual(["33.34", "33.33", "33.33"]);
    expect(splitEvenlyTexts(2)).toEqual(["50.00", "50.00"]);
    expect(splitEvenlyTexts(1)).toEqual(["100.00"]);
    expect(splitEvenlyTexts(7).slice(0, 3)).toEqual(["14.29", "14.29", "14.29"]);
    expect(splitEvenlyTexts(0)).toEqual([]);
  });

  it("always sums to exactly 100.00", () => {
    for (let n = 1; n <= 40; n++) {
      const texts = splitEvenlyTexts(n);
      const r = texts.map((text, i) => ({ memberId: String(i), text }));
      expect(evaluatePercentRows(r, []).status).toBe("exact");
    }
  });
});

describe("rowsToPercentSplit", () => {
  it("drops 0.00 and blank rows and keeps row order", () => {
    const r = rowsToPercentSplit(rows("70", "0.00", "30"));
    expect(r).toEqual({
      ok: true,
      value: {
        kind: "percent",
        shares: [
          { memberId: "a", bps: 7000 },
          { memberId: "c", bps: 3000 },
        ],
      },
    });
    const blank = rowsToPercentSplit(rows("100", "", " "));
    expect(blank.ok && blank.value.shares).toEqual([{ memberId: "a", bps: 10000 }]);
  });

  it("fails and lists the invalid fields", () => {
    expect(rowsToPercentSplit(rows("50", "x", "101"))).toEqual({
      ok: false,
      error: { memberIds: ["b", "c"] },
    });
  });

  it("does not check the sum (the domain does)", () => {
    const r = rowsToPercentSplit(rows("50", "30", "10"));
    expect(r.ok && r.value.shares).toHaveLength(3);
  });

  it("returns an empty share list when every row is zero", () => {
    const r = rowsToPercentSplit(rows("", "0", "0.00"));
    expect(r.ok && r.value.shares).toEqual([]);
  });
});
