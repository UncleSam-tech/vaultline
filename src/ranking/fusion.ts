/**
 * Deterministic ranking fusion — the core of Vaultline.
 *
 * Weighted Reciprocal Rank Fusion (RRF) over keyword (BM25) and semantic
 * (cosine) rank lists. No LLM, no randomness, no wall-clock dependence:
 * same corpus + same query => byte-identical result order.
 *
 * Spec: vaultline-v1-spec.md §2
 */

export interface RankedCandidate {
  chunkId: string;
  noteId: string;
  /** 1-based position in the BM25 list; undefined if not a keyword hit */
  rankKw?: number;
  /** 1-based position in the cosine list; undefined if not a semantic hit */
  rankSem?: number;
  /** ISO 8601 */
  modifiedAt: string;
  /** sha1 of normalized chunk text, for near-dup collapse */
  textHash: string;
}

export interface FusionParams {
  k: number;
  wKw: number;
  wSem: number;
}

export const DEFAULT_FUSION: FusionParams = { k: 60, wKw: 1.0, wSem: 1.0 };

export type MatchType = "keyword" | "semantic" | "both";

export interface FusedResult {
  chunkId: string;
  noteId: string;
  /** raw fused RRF score (ordering key) */
  score: number;
  /** min-max normalized within candidate set (display only) */
  normScore: number;
  matchType: MatchType;
  modifiedAt: string;
}

/** Raw weighted-RRF score for one candidate. Absent list => term contributes 0. */
export function rrfScore(c: RankedCandidate, p: FusionParams): number {
  const kw = c.rankKw !== undefined ? p.wKw / (p.k + c.rankKw) : 0;
  const sem = c.rankSem !== undefined ? p.wSem / (p.k + c.rankSem) : 0;
  return kw + sem;
}

/**
 * Deterministic total-order comparator (spec §2.3):
 *   fused score DESC, rankKw ASC (nulls last), modifiedAt DESC, chunkId ASC.
 * chunkId is a content hash, so the order is total even for identical twins.
 */
export function compareFused(
  a: { score: number; rankKw?: number; modifiedAt: string; chunkId: string },
  b: { score: number; rankKw?: number; modifiedAt: string; chunkId: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const ak = a.rankKw ?? Number.POSITIVE_INFINITY;
  const bk = b.rankKw ?? Number.POSITIVE_INFINITY;
  if (ak !== bk) return ak - bk;
  if (a.modifiedAt !== b.modifiedAt) return a.modifiedAt < b.modifiedAt ? 1 : -1;
  return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
}

/**
 * Fuse candidate lists into a deterministic ranking.
 * Near-duplicate chunks (same textHash) collapse to the newest note's copy
 * (ties broken by the same total order).
 */
export function fuse(
  candidates: RankedCandidate[],
  params: FusionParams = DEFAULT_FUSION,
): FusedResult[] {
  // 1. score
  const scored = candidates.map((c) => ({
    ...c,
    score: rrfScore(c, params),
  }));

  // 2. near-dup collapse by textHash — keep the winner under the total order
  const byHash = new Map<string, (typeof scored)[number]>();
  for (const c of scored) {
    const prev = byHash.get(c.textHash);
    if (!prev || compareFused(c, prev) < 0) byHash.set(c.textHash, c);
  }
  const deduped = [...byHash.values()];

  // 3. deterministic sort
  deduped.sort(compareFused);

  // 4. min-max normalize for display
  const max = deduped.length ? deduped[0]!.score : 0;
  const min = deduped.length ? deduped[deduped.length - 1]!.score : 0;
  const span = max - min;

  return deduped.map((c) => ({
    chunkId: c.chunkId,
    noteId: c.noteId,
    score: c.score,
    normScore: span > 0 ? (c.score - min) / span : 1,
    matchType:
      c.rankKw !== undefined && c.rankSem !== undefined
        ? "both"
        : c.rankKw !== undefined
          ? "keyword"
          : "semantic",
    modifiedAt: c.modifiedAt,
  }));
}

/**
 * Note cap (spec §2.4): at most `maxPerNote` chunks per note in a result page.
 * Overflow chunks yield their slots to the next-ranked note. Order preserved.
 */
export function applyNoteCap<T extends { noteId: string }>(
  results: T[],
  maxPerNote = 3,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const r of results) {
    const n = counts.get(r.noteId) ?? 0;
    if (n < maxPerNote) {
      counts.set(r.noteId, n + 1);
      out.push(r);
    }
  }
  return out;
}
