# Vaultline

**Local-first, app-agnostic knowledge-base MCP server.** One index over all your notes — Obsidian, UpNote exports, Joplin, Bear, Apple Notes — served to any MCP agent as ranked, cited passages. Nothing leaves your machine.

> Status: v0.1 — deterministic ranking core implemented and tested; index pipeline and adapters in active development.

## Why

Every existing knowledge-base MCP is welded to one app, requires the app running, phones the cloud, or solves agent *memory* instead of knowledge *access*. Vaultline reads your notes **at rest** (vault folders, export directories, local databases) — no plugins, no API keys for local sources, works with the app closed.

## Design commitments

- **Deterministic retrieval:** BM25 + cosine fused by weighted Reciprocal Rank Fusion, total tie-break order. Same corpus + same query ⇒ identical results. No LLM in the retrieval loop.
- **Citations as a contract:** every passage carries source, path, heading trail, date, and score.
- **Token-budgeted responses** built for real agentic loops, with `searchExhausted` semantics so agents can assert absence without retry spirals.
- **Self-healing:** a broken source degrades that source, never the server.
- **Zero-config:** `vaultline init` auto-detects known vault and export locations.

## Tools

| Tool | Purpose |
|---|---|
| `vaultline_search_knowledge` | Hybrid search across all sources → cited passages under a token budget |
| `vaultline_get_note` | Full note by id/path |
| `vaultline_list_sources` | Connected sources + index freshness |
| `vaultline_get_related` | Similar notes |

## Development

```bash
npm install
npm test        # ranking core: fusion, tie-breaking, budgeting
npm run dev     # stdio MCP server (tools stubbed pending index pipeline)
```

Spec: see `docs/` (tool contracts, ranking math §2, schema §3, adapter interface §4).

## License

TBD (intentionally undeclared while commercial options are evaluated).
