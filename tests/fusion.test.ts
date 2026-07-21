import { describe, it, expect } from "vitest";
import {
  fuse,
  rrfScore,
  applyNoteCap,
  DEFAULT_FUSION,
  type RankedCandidate,
} from "../src/ranking/fusion.js";

const cand = (over: Partial<RankedCandidate> & { chunkId: string }): RankedCandidate => ({
  noteId: "n1",
  modifiedAt: "2026-01-01T00:00:00Z",
  textHash: over.chunkId, // unique unless overridden
  ...over,
});

describe("rrfScore", () => {
  it("computes weighted RRF with k=60 defaults", () => {
    const c = cand({ chunkId: "a", rankKw: 1, rankSem: 2 });
    expect(rrfScore(c, DEFAULT_FUSION)).toBeCloseTo(1 / 61 + 1 / 62, 12);
  });

  it("absent list contributes zero", () => {
    expect(rrfScore(cand({ chunkId: "a", rankKw: 1 }), DEFAULT_FUSION)).toBeCloseTo(1 / 61, 12);
    expect(rrfScore(cand({ chunkId: "a", rankSem: 3 }), DEFAULT_FUSION)).toBeCloseTo(1 / 63, 12);
    expect(rrfScore(cand({ chunkId: "a" }), DEFAULT_FUSION)).toBe(0);
  });

  it("respects custom weights", () => {
    const c = cand({ chunkId: "a", rankKw: 1, rankSem: 1 });
    expect(rrfScore(c, { k: 60, wKw: 2, wSem: 0.5 })).toBeCloseTo(2 / 61 + 0.5 / 61, 12);
  });
});

describe("fuse — ordering", () => {
  it("ranks dual-list hits above single-list hits at equal ranks", () => {
    const out = fuse([
      cand({ chunkId: "kw-only", rankKw: 1 }),
      cand({ chunkId: "both", rankKw: 2, rankSem: 1 }),
      cand({ chunkId: "sem-only", rankSem: 2 }),
    ]);
    expect(out.map((r) => r.chunkId)).toEqual(["both", "kw-only", "sem-only"]);
    expect(out[0]!.matchType).toBe("both");
    expect(out[1]!.matchType).toBe("keyword");
    expect(out[2]!.matchType).toBe("semantic");
  });

  it("tie-break 1: equal score → lower keyword rank wins", () => {
    // Construct equal scores: kw rank 5 alone vs sem rank 5 alone
    const out = fuse([
      cand({ chunkId: "z-sem", rankSem: 5 }),
      cand({ chunkId: "a-kw", rankKw: 5 }),
    ]);
    expect(out.map((r) => r.chunkId)).toEqual(["a-kw", "z-sem"]);
  });

  it("tie-break 2: equal score & kw rank → newer modifiedAt wins", () => {
    const out = fuse([
      cand({ chunkId: "old", rankKw: 3, modifiedAt: "2025-01-01T00:00:00Z" }),
      cand({ chunkId: "new", rankKw: 3, modifiedAt: "2026-01-01T00:00:00Z" }),
    ]);
    // Note: identical rankKw can't occur from one FTS list in practice;
    // the comparator must still totally order it.
    expect(out.map((r) => r.chunkId)).toEqual(["new", "old"]);
  });

  it("tie-break 3: full tie → chunkId ascending (total order)", () => {
    const out = fuse([
      cand({ chunkId: "bbb", rankKw: 3 }),
      cand({ chunkId: "aaa", rankKw: 3 }),
    ]);
    expect(out.map((r) => r.chunkId)).toEqual(["aaa", "bbb"]);
  });

  it("is deterministic: input order never changes output order", () => {
    const a = cand({ chunkId: "a", rankKw: 1, rankSem: 4 });
    const b = cand({ chunkId: "b", rankKw: 2, rankSem: 3 });
    const c = cand({ chunkId: "c", rankSem: 1 });
    const o1 = fuse([a, b, c]).map((r) => r.chunkId);
    const o2 = fuse([c, a, b]).map((r) => r.chunkId);
    const o3 = fuse([b, c, a]).map((r) => r.chunkId);
    expect(o2).toEqual(o1);
    expect(o3).toEqual(o1);
  });
});

describe("fuse — normalization & dedup", () => {
  it("normScore spans 1 (top) to 0 (bottom), display-only", () => {
    const out = fuse([
      cand({ chunkId: "top", rankKw: 1, rankSem: 1 }),
      cand({ chunkId: "mid", rankKw: 10 }),
      cand({ chunkId: "bot", rankSem: 40 }),
    ]);
    expect(out[0]!.normScore).toBe(1);
    expect(out[out.length - 1]!.normScore).toBe(0);
  });

  it("single candidate normalizes to 1", () => {
    const out = fuse([cand({ chunkId: "only", rankKw: 1 })]);
    expect(out[0]!.normScore).toBe(1);
  });

  it("collapses near-duplicates to the winner under the total order", () => {
    const out = fuse([
      cand({ chunkId: "dupA", rankKw: 1, textHash: "same" }),
      cand({ chunkId: "dupB", rankKw: 5, textHash: "same" }),
      cand({ chunkId: "other", rankKw: 2 }),
    ]);
    expect(out.map((r) => r.chunkId)).toEqual(["dupA", "other"]);
  });
});

describe("applyNoteCap", () => {
  it("caps chunks per note at 3 by default, preserving order", () => {
    const rows = ["c1", "c2", "c3", "c4", "c5"].map((id, i) => ({
      chunkId: id,
      noteId: i < 4 ? "big-note" : "other",
    }));
    const out = applyNoteCap(rows);
    expect(out.map((r) => r.chunkId)).toEqual(["c1", "c2", "c3", "c5"]);
  });

  it("overflow slots go to next-ranked notes", () => {
    const rows = [
      { chunkId: "a1", noteId: "A" },
      { chunkId: "a2", noteId: "A" },
      { chunkId: "b1", noteId: "B" },
    ];
    expect(applyNoteCap(rows, 1).map((r) => r.chunkId)).toEqual(["a1", "b1"]);
  });
});
