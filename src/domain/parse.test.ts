import { describe, expect, it } from "vitest";
import { parseAmountCents, parsePercentBps } from "./parse";

const amount = (t: string) => {
  const r = parseAmountCents(t);
  return r.ok ? r.value : r.error.code;
};
const percent = (t: string) => {
  const r = parsePercentBps(t);
  return r.ok ? r.value : r.error.code;
};

describe("parseAmountCents", () => {
  it("accepts whole, one-decimal, and two-decimal amounts", () => {
    expect(amount("12")).toBe(1200);
    expect(amount("12.5")).toBe(1250);
    expect(amount("12.50")).toBe(1250);
    expect(amount("0.01")).toBe(1);
    expect(amount("0.29")).toBe(29);
    expect(amount("007.07")).toBe(707);
  });

  it("trims surrounding spaces", () => {
    expect(amount("  12.50  ")).toBe(1250);
  });

  it("trims tabs and newlines around a valid amount but rejects inner whitespace", () => {
    expect(amount("\t12.50\n")).toBe(1250);
    expect(amount("\n 7 \t")).toBe(700);
    expect(amount("1\t2")).toBe("NOT_NUMERIC");
    expect(amount("12\n.50")).toBe("NOT_NUMERIC");
    expect(amount("- 5")).toBe("NOT_NUMERIC");
  });

  it("rejects empty and whitespace-only text", () => {
    expect(amount("")).toBe("EMPTY");
    expect(amount("   ")).toBe("EMPTY");
  });

  it.each([".5", "5.", "1,000", "$5", "+5", "1e2", "0x10", "1 2", "abc", "--5", "5.5.5", "٣"])(
    "treats %j as non-numeric",
    (text) => {
      expect(amount(text)).toBe("NOT_NUMERIC");
    },
  );

  it("rejects negatives including -0", () => {
    expect(amount("-5")).toBe("NEGATIVE");
    expect(amount("-0")).toBe("NEGATIVE");
    expect(amount("-0.00")).toBe("NEGATIVE");
  });

  it("rejects more than 2 decimals even when the extra digits are zeros", () => {
    expect(amount("1.001")).toBe("TOO_MANY_DECIMALS");
    expect(amount("1.000")).toBe("TOO_MANY_DECIMALS");
    expect(amount("0.000")).toBe("TOO_MANY_DECIMALS");
  });

  it("rejects zero", () => {
    expect(amount("0")).toBe("ZERO");
    expect(amount("0.00")).toBe("ZERO");
  });

  it("allows exactly 1,000,000.00 and rejects anything above", () => {
    expect(amount("1000000")).toBe(100_000_000);
    expect(amount("1000000.00")).toBe(100_000_000);
    expect(amount("1000000.01")).toBe("TOO_LARGE");
    expect(amount("99999999999999999999999")).toBe("TOO_LARGE");
  });

  it("does not suffer float artifacts", () => {
    expect(amount("0.29")).toBe(29);
    expect(amount("1.15")).toBe(115);
    expect(amount("4.35")).toBe(435);
  });

  it("reports the earlier error when several apply", () => {
    expect(amount("-1.234")).toBe("NEGATIVE");
    expect(amount("$-1")).toBe("NOT_NUMERIC");
  });

  it("honors a custom cap", () => {
    expect(parseAmountCents("5", 400)).toMatchObject({ ok: false, error: { code: "TOO_LARGE" } });
  });
});

describe("parsePercentBps", () => {
  it("parses up to 2 decimals into bps", () => {
    expect(percent("50")).toBe(5000);
    expect(percent("33.33")).toBe(3333);
    expect(percent("0.5")).toBe(50);
    expect(percent("0.01")).toBe(1);
    expect(percent("100")).toBe(10000);
    expect(percent("100.00")).toBe(10000);
    expect(percent("0")).toBe(0);
    expect(percent("0.00")).toBe(0);
  });

  it("uses the same grammar as amounts", () => {
    for (const t of [".5", "5.", "1,000", "$5", "+5", "1e2", "0x10", "5 5", "50%"]) {
      expect(percent(t)).toBe("NOT_NUMERIC");
    }
  });

  it("checks in order: non-numeric, negative, decimals, above 100", () => {
    expect(percent("-5")).toBe("NEGATIVE");
    expect(percent("-0")).toBe("NEGATIVE");
    expect(percent("-1.234")).toBe("NEGATIVE");
    expect(percent("100.001")).toBe("TOO_MANY_DECIMALS");
    expect(percent("150.123")).toBe("TOO_MANY_DECIMALS");
    expect(percent("100.01")).toBe("ABOVE_100");
    expect(percent("101")).toBe("ABOVE_100");
    expect(percent("99999999999999999999999")).toBe("ABOVE_100");
  });

  it("trims tabs and newlines around a valid percent but rejects inner whitespace", () => {
    expect(percent("\t33.33\n")).toBe(3333);
    expect(percent("\n 50 \t")).toBe(5000);
    expect(percent("5\t0")).toBe("NOT_NUMERIC");
    expect(percent("33\n.33")).toBe("NOT_NUMERIC");
  });

  it("reports empty text as EMPTY (callers treat blank as 0.00)", () => {
    expect(percent("")).toBe("EMPTY");
    expect(percent("  ")).toBe("EMPTY");
  });
});
