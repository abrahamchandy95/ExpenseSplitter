import { describe, expect, it } from "vitest";
import { describeBalance, formatBps, formatCents, formatPercent, totalLineText } from "./format";

describe("formatCents", () => {
  it("formats dollars and cents with grouping", () => {
    expect(formatCents(123450)).toBe("$1,234.50");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(100_000_000)).toBe("$1,000,000.00");
    expect(formatCents(99900)).toBe("$999.00");
  });

  it("formats negatives with a leading minus", () => {
    expect(formatCents(-500)).toBe("-$5.00");
    expect(formatCents(-5)).toBe("-$0.05");
    expect(formatCents(-123450)).toBe("-$1,234.50");
  });

  it("never shows negative zero", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-0)).toBe("$0.00");
  });

  it("throws on non-integers rather than printing NaN", () => {
    expect(() => formatCents(NaN)).toThrow(RangeError);
    expect(() => formatCents(0.5)).toThrow(RangeError);
    expect(() => formatCents(Infinity)).toThrow(RangeError);
  });

  it("is exact for float-hostile values", () => {
    expect(formatCents(29)).toBe("$0.29");
    expect(formatCents(30)).toBe("$0.30");
  });
});

describe("formatBps", () => {
  it("always has exactly 2 decimals", () => {
    expect(formatBps(0)).toBe("0.00");
    expect(formatBps(1)).toBe("0.01");
    expect(formatBps(3334)).toBe("33.34");
    expect(formatBps(5000)).toBe("50.00");
    expect(formatBps(10000)).toBe("100.00");
    expect(formatBps(10500)).toBe("105.00");
  });

  it("handles negatives and never negative zero", () => {
    expect(formatBps(-5000)).toBe("-50.00");
    expect(formatBps(-0)).toBe("0.00");
  });

  it("formatPercent appends a percent sign", () => {
    expect(formatPercent(9000)).toBe("90.00%");
  });
});

describe("totalLineText", () => {
  it("describes under, over, and exact totals", () => {
    expect(totalLineText(9000)).toBe("Total 90.00%. 10.00% still unassigned.");
    expect(totalLineText(9999)).toBe("Total 99.99%. 0.01% still unassigned.");
    expect(totalLineText(10500)).toBe("Total 105.00%. 5.00% over.");
    expect(totalLineText(10000)).toBe("Total 100.00%.");
    expect(totalLineText(0)).toBe("Total 0.00%. 100.00% still unassigned.");
  });
});

describe("describeBalance", () => {
  it("labels owed, owes, and settled", () => {
    expect(describeBalance(6000)).toEqual({ kind: "owed", text: "is owed $60.00" });
    expect(describeBalance(-3000)).toEqual({ kind: "owes", text: "owes $30.00" });
    expect(describeBalance(0)).toEqual({ kind: "settled", text: "settled" });
    expect(describeBalance(-0)).toEqual({ kind: "settled", text: "settled" });
  });
});
