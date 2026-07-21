import { describe, it, expect } from "vitest";
import { estTokens, applyBudget, truncateToTokens } from "../src/ranking/budget.js";

const mk = (id: string, chars: number) => ({ item: id, text: "x".repeat(chars) });

describe("estTokens", () => {
  it("is ceil(chars/4), fixed and deterministic", () => {
    expect(estTokens("")).toBe(0);
    expect(estTokens("abc")).toBe(1);
    expect(estTokens("abcd")).toBe(1);
    expect(estTokens("abcde")).toBe(2);
  });
});

describe("applyBudget", () => {
  it("greedily fills by rank within budget", () => {
    const { selected, tokenBudgetUsed } = applyBudget(
      [mk("a", 400), mk("b", 400), mk("c", 400)], // 100 tokens each
      250,
    );
    expect(selected.map((s) => s.passage)).toEqual(["a", "b"]);
    expect(tokenBudgetUsed).toBe(200);
    expect(selected.every((s) => !s.truncated)).toBe(true);
  });

  it("stops at first non-fitting passage (rank order beats packing)", () => {
    const { selected } = applyBudget([mk("a", 400), mk("big", 4000), mk("small", 4)], 150);
    expect(selected.map((s) => s.passage)).toEqual(["a"]);
  });

  it("NEVER returns zero passages when candidates exist: truncates the first", () => {
    const text = "para one.\n\npara two.\n\n" + "x".repeat(8000);
    const { selected, tokenBudgetUsed } = applyBudget([{ item: "only", text }], 100);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.truncated).toBe(true);
    expect(estTokens(selected[0]!.text)).toBeLessThanOrEqual(100);
    expect(tokenBudgetUsed).toBeLessThanOrEqual(100);
  });

  it("returns empty for empty candidates", () => {
    const { selected, tokenBudgetUsed } = applyBudget([], 1000);
    expect(selected).toEqual([]);
    expect(tokenBudgetUsed).toBe(0);
  });
});

describe("truncateToTokens", () => {
  it("returns text unchanged when it fits", () => {
    expect(truncateToTokens("short", 100)).toBe("short");
  });

  it("cuts at the last paragraph boundary within allowance", () => {
    const text = "first para." + "\n\n" + "second para." + "\n\n" + "y".repeat(1000);
    const out = truncateToTokens(text, 10); // 40 chars allowance
    expect(out).toBe("first para.\n\nsecond para.".slice(0, out.length));
    expect(out.endsWith("para.")).toBe(true);
  });

  it("hard-cuts when no paragraph boundary exists", () => {
    const out = truncateToTokens("z".repeat(1000), 10);
    expect(out).toBe("z".repeat(40));
  });
});
