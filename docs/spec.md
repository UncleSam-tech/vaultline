# Vaultline v1 — Technical Specification
### Tool contracts, ranking fusion, index schema, adapter interface
*Pre-code spec. Every behavior here is testable; the test suite is the spec's mirror.*

---

## 0. Identity & stack

- **Package:** `vaultline-mcp-server` (TS/Node 18+, ESM)
- **Transport:** stdio primary (local product; no network in retrieval path). StreamableHTTP behind `--http` flag for CTP-compliant hosted/demo mode — same tool layer, two entrypoints.
- **Storage:** single SQLite file (`~/.vaultline/index.db`), FTS5 for keyword, embeddings as BLOBs. No external services.
- **Tool prefix:** `vaultline_` (anticipate coexistence with other MCPs).
- **Security invariants:** all paths canonicalized and confined to registered source roots (no traversal); stdio logs to stderr only; HTTP mode binds 127.0.0.1 with Origin validation.

---

## 1. Tool surface (4 tools, all read-only)

All tools: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. Errors are returned **in-result** (`isError` + guidance text), never thrown to protocol layer. Every response carries `structuredContent` matching `outputSchema` (root: `type: "object"`, nullable = `["T","null"]`).

### 1.1 `vaultline_search_knowledge`

The primary loop. One call should usually be enough — that's the design bar.

**Input schema (Zod → JSON Schema):**
```ts
{
  query: z.string().min(1).max(1000)
    .describe("Natural-language or keyword query, e.g. 'pricing psychology anchoring notes'"),
  sources: z.array(z.string()).optional()
    .describe("Restrict to source IDs from vaultline_list_sources; omit = all"),
  tags: z.array(z.string()).optional()
    .describe("Restrict to notes carrying ALL of these tags (frontmatter or #inline)"),
  modified_after: z.string().datetime().optional(),
  modified_before: z.string().datetime().optional(),
  mode: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid")
    .describe("hybrid = fused keyword+semantic (falls back to keyword if embeddings disabled)"),
  token_budget: z.number().int().min(200).max(8000).default(2000)
    .describe("Max estimated tokens of passage text returned"),
  limit: z.number().int().min(1).max(50).default(8),
  offset: z.number().int().min(0).default(0),
  response_format: z.enum(["json", "markdown"]).default("markdown")
}
```

**Output (structuredContent):**
```ts
{
  passages: Array<{
    chunk_id: string,          // stable: sha1(note_id + ':' + chunk_ordinal)
    note_id: string,
    note_title: string,
    source_id: string,         // e.g. "obsidian-main"
    path: string,              // relative to source root
    heading_trail: string[],   // ["Projects", "Pricing", "Anchoring"]
    text: string,              // the passage, possibly truncated
    truncated: boolean,
    score: number,             // fused score, 0..1 normalized
    match_type: "keyword" | "semantic" | "both",
    modified_at: string        // ISO 8601
  }>,
  total_candidates: number,
  has_more: boolean,
  next_offset: number | null,
  token_budget_used: number,
  degraded_sources: Array<{ source_id: string, reason: string }>,  // self-healing
  searchExhausted: boolean,    // true = corpus fully searched, absence of results is meaningful
  mode_used: "hybrid" | "keyword" | "semantic"
}
```

**Behavioral contract:**
- Empty result + `searchExhausted: true` ⇒ the agent may assert "not in your notes" (anti-retry-loop, anti-hallucination — the redline pattern).
- If semantic requested but embeddings unavailable ⇒ degrade to keyword, report via `mode_used`, never error.
- A source whose adapter fails degrades that source only (`degraded_sources`), never the call.
- Markdown format: passages rendered with `### title (source · path)` headers, `> passage` quotes, score and date on one metadata line — human-scannable, no raw JSON noise.

### 1.2 `vaultline_get_note`

```ts
// Input
{
  note_id: z.string().optional(),
  path: z.string().optional(),        // exactly one of note_id | path required
  source_id: z.string().optional(),   // required with path if ambiguous
  include_metadata: z.boolean().default(true),
  response_format: z.enum(["json","markdown"]).default("markdown")
}
// Output
{
  note_id: string, source_id: string, path: string, title: string,
  text: string,                        // full note body (markdown)
  tags: string[], links_out: string[], // [[wikilinks]] / md links found
  created_at: string | null, modified_at: string,
  word_count: number, chunk_count: number
}
```
Error guidance example: `"No note matches path 'foo.md'. Call vaultline_search_knowledge with the note title, or vaultline_list_sources to check the source is indexed."`

### 1.3 `vaultline_list_sources`

Discovery + freshness. Agents call this before claiming a corpus doesn't exist.
```ts
// Input: { response_format }
// Output
{
  sources: Array<{
    source_id: string, adapter: "markdown-vault" | "upnote-export" | "joplin-export"
             | "bear-sqlite" | "apple-notes-sqlite" | "notion-export",
    root_path: string, note_count: number, chunk_count: number,
    last_indexed_at: string, index_fresh: boolean,   // watcher caught up?
    semantic_enabled: boolean,
    status: "ok" | "degraded" | "unavailable", status_detail: string | null
  }>,
  index_version: string, embedding_model: string | null
}
```

### 1.4 `vaultline_get_related`

```ts
// Input
{ note_id: z.string(), limit: z.number().int().min(1).max(25).default(5),
  exclude_same_note: z.boolean().default(true), response_format }
// Output
{ related: Array<{ note_id, note_title, source_id, path,
                   similarity: number,           // mean cosine of top chunk pairs, 0..1
                   shared_tags: string[], link_connected: boolean }>,
  method: "embeddings" | "tags+links" }           // graceful keyword-mode fallback
```

---

## 2. Ranking fusion (the deterministic core)

**Design rule: no LLM, no randomness, no wall-clock dependence in scoring. Same corpus + same query ⇒ byte-identical result order. This is unit-testable and IS unit-tested.**

### 2.1 Candidate generation
- **Keyword:** FTS5 `bm25(chunks_fts, 10.0, 5.0, 1.0)` (weights: title ×10, heading ×5, body ×1). Take top `K_kw = 50` candidates. FTS5 returns lower-is-better; keep native order as keyword rank list `R_kw`.
- **Semantic** (if enabled): cosine similarity between query embedding and chunk embeddings (384-d, unit-normalized ⇒ dot product). Exact brute-force scan (SIMD via typed arrays) — at personal-corpus scale (≤200k chunks) exact beats ANN and stays deterministic. Top `K_sem = 50` ⇒ rank list `R_sem`.
- Query embedding computed with the same fixed model + fixed truncation (512 tokens); model version pinned in `meta` table — a model change invalidates and re-embeds the whole index (versioned migration).

### 2.2 Fusion: weighted Reciprocal Rank Fusion
For chunk c:
```
score(c) = w_kw · 1/(k + rank_kw(c)) + w_sem · 1/(k + rank_sem(c))
k = 60,  w_kw = 1.0,  w_sem = 1.0        (defaults; configurable, echoed in list_sources)
rank_*(c) = position in that list (1-based); absent ⇒ term contributes 0
```
Rank-based fusion (not score mixing) is deliberate: BM25 and cosine live on incomparable scales; RRF needs no normalization, is robust to outliers, and is trivially reproducible. `match_type` = which lists contained c. Exposed `score` = min-max normalized fused score within the candidate set (display only; ordering uses raw fused score).

### 2.3 Deterministic tie-breaking (total order, always)
`ORDER BY fused_score DESC, rank_kw ASC NULLS LAST, modified_at DESC, chunk_id ASC`.
The final key is a content hash ⇒ order is total even for identical twins.

### 2.4 De-duplication & diversity
- Near-dup chunks (normalized-text hash equal) collapse to the newest note's copy.
- **Note cap:** max 3 chunks per note in a result page (keeps one giant note from monopolizing the budget); overflow chunks yield their slots to the next-ranked note.

### 2.5 Filters
`sources/tags/modified_*` filters are applied **pre-ranking** (SQL WHERE on candidate generation), so ranks are computed within the filtered universe — filtering never reshuffles relative order of survivors.

### 2.6 Chunking (index-time, deterministic)
- Markdown-structure-aware: split at headings; paragraphs greedily packed to **target 300 est. tokens, hard max 450, overlap 40** (est. tokens = ceil(chars/4), fixed).
- A chunk records its `heading_trail`. Code blocks are never split mid-fence; tables never split mid-row.
- `chunk_ordinal` = position in note ⇒ `chunk_id = sha1(note_id + ':' + ordinal)` stable across re-indexes of unchanged content (note_id = sha1(source_id + ':' + relpath); content change detected via `content_hash`, which re-chunks only that note).

### 2.7 Token budgeting (response-time)
Greedy by final rank: append passages while `used + est(passage) ≤ token_budget`. If the **first** passage alone exceeds budget, truncate it at a paragraph boundary to fit and set `truncated: true` — never return zero passages when candidates exist. Report `token_budget_used`.

---

## 3. Index schema (SQLite)

```sql
CREATE TABLE meta    (key TEXT PRIMARY KEY, value TEXT);        -- schema_version, embedding_model, rrf params
CREATE TABLE sources (source_id TEXT PRIMARY KEY, adapter TEXT, root_path TEXT,
                      status TEXT, status_detail TEXT, last_indexed_at TEXT);
CREATE TABLE notes   (note_id TEXT PRIMARY KEY, source_id TEXT REFERENCES sources,
                      path TEXT, title TEXT, tags TEXT /*json*/, links_out TEXT /*json*/,
                      created_at TEXT, modified_at TEXT, word_count INT,
                      content_hash TEXT);                        -- sha1 of normalized body
CREATE TABLE chunks  (chunk_id TEXT PRIMARY KEY, note_id TEXT REFERENCES notes,
                      ordinal INT, heading_trail TEXT /*json*/, text TEXT,
                      est_tokens INT, text_hash TEXT);
CREATE VIRTUAL TABLE chunks_fts USING fts5(title, heading, body,
                      content='', tokenize='porter unicode61');  -- contentless; ids via rowid map
CREATE TABLE embeddings (chunk_id TEXT PRIMARY KEY REFERENCES chunks,
                      vector BLOB /* 384 × f32 LE */, model TEXT);
CREATE INDEX idx_notes_source ON notes(source_id);
CREATE INDEX idx_notes_modified ON notes(modified_at);
```
Re-index pipeline: watcher event → adapter reads note → `content_hash` unchanged? skip : re-chunk + re-embed that note only, in one transaction. Full rebuild = `vaultline reindex` (idempotent).

---

## 4. Adapter interface

```ts
export interface SourceAdapter {
  readonly kind: string;                          // "markdown-vault", ...
  detect(): Promise<DetectedRoot[]>;              // auto-discovery for zero-config init
  validate(root: string): Promise<ValidationResult>;
  listNotes(root: string): AsyncIterable<RawNoteRef>;   // { relPath, modifiedAt, sizeBytes }
  readNote(root: string, ref: RawNoteRef): Promise<RawNote>;
                                                  // { title, bodyMarkdown, tags, createdAt?, linksOut }
  watchPaths(root: string): string[];             // globs for the file watcher
}
```
Adapter failures are contained: any throw marks the source `degraded` with a human-readable `status_detail` and the run continues. v1 ships `markdown-vault` (Obsidian/Logseq/Dendron/plain folders — covers the largest cohort with zero app cooperation); `upnote-export` and `joplin-export` in weeks 3–6; SQLite adapters (Bear, Apple Notes) after — isolated so schema drift breaks one plugin, not the product.

**Zero-config `vaultline init`:** runs every adapter's `detect()` (known paths: `~/Documents/Obsidian*`, iCloud Obsidian dirs, UpNote backup default dir, Joplin export dir…), prints findings, one keypress to confirm, indexes. Target: cold start to first successful search **< 2 minutes** including semantic-off default.

---

## 5. CTP compliance mapping (reuse redline's checklist)

outputSchema on all tools (root object) ✓ · nullable via type arrays ✓ · structuredContent everywhere ✓ · `latencyClass: "fast"` (all reads are local; p95 targets: search < 150 ms keyword / < 400 ms hybrid on 50k chunks) · `_meta.rateLimit` (generous—local) · `_meta.pricing.executeUsd` (hosted mode only) · `_meta.surface: "answer"` · self-healing, no bare errors ✓ · stateless transport ✓.

## 6. Test plan (written alongside week-1 code, not after)

1. **Ranking math:** RRF fusion, tie-breaking totality, filter-before-rank, note cap, dedup — pure-function unit tests with a frozen 200-note fixture corpus; golden-file result orders.
2. **Chunker:** heading trails, fence/table integrity, overlap, stability of chunk_ids across no-op re-index.
3. **Budgeter:** exact greedy behavior incl. the truncate-first-passage edge.
4. **Adapters:** fixture vaults per adapter; corrupted-source degradation path.
5. **MCP layer:** schema round-trips via MCP Inspector; error-in-result contract.
6. **Eval set (Phase-4 style):** 10 realistic Q&A pairs over the fixture corpus (single verifiable answers), run against a live agent before every release — this is the "did we miss the primary use-case?" alarm.

## 7. Explicit non-goals for v1 (recorded so scope creep has to argue with a document)
No write tools · no UI beyond CLI status · no cloud sync · no ANN index · no OCR/PDF (notes only) · no per-note ACLs · no Windows Apple-Notes support. Each is a v2 debate, not a v1 slip.
