/**
 * Token budgeting — response-time greedy fill (spec §2.7).
 *
 * Deterministic token estimate: est = ceil(chars / 4). Fixed, documented,
 * never model-dependent.
 */

export function estTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BudgetedPassage<T> {
  passage: T;
  text: string;
  truncated: boolean;
}

export interface BudgetResult<T> {
  selected: BudgetedPassage<T>[];
  tokenBudgetUsed: number;
}

/**
 * Greedy by rank: append passages while they fit the budget.
 * Edge (spec §2.7): if the FIRST passage alone exceeds the budget, truncate it
 * at a paragraph boundary to fit and mark truncated — never return zero
 * passages when candidates exist.
 */
export function applyBudget<T>(
  passages: Array<{ item: T; text: string }>,
  tokenBudget: number,
): BudgetResult<T> {
  const selected: BudgetedPassage<T>[] = [];
  let used = 0;

  for (const p of passages) {
    const cost = estTokens(p.text);
    if (used + cost <= tokenBudget) {
      selected.push({ passage: p.item, text: p.text, truncated: false });
      used += cost;
    } else if (selected.length === 0) {
      const t = truncateToTokens(p.text, tokenBudget);
      selected.push({ passage: p.item, text: t, truncated: true });
      used += estTokens(t);
      break; // budget is exhausted by definition
    }
    // else: skip; later, smaller passages may still fit — but rank order
    // wins over packing efficiency (deterministic, explainable), so we stop.
    else break;
  }

  return { selected, tokenBudgetUsed: used };
}

/**
 * Truncate to a token budget at a paragraph boundary (last "\n\n" within the
 * char allowance); fall back to a hard character cut when no boundary exists.
 */
export function truncateToTokens(text: string, tokenBudget: number): string {
  const maxChars = tokenBudget * 4;
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastBreak = slice.lastIndexOf("\n\n");
  return lastBreak > 0 ? slice.slice(0, lastBreak) : slice;
}
