/** SQLite schema (spec §3). Applied idempotently on startup. */

export const SCHEMA_VERSION = "1";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  source_id       TEXT PRIMARY KEY,
  adapter         TEXT NOT NULL,
  root_path       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ok',    -- ok | degraded | unavailable
  status_detail   TEXT,
  last_indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  note_id      TEXT PRIMARY KEY,                 -- sha1(source_id + ':' + relpath)
  source_id    TEXT NOT NULL REFERENCES sources(source_id),
  path         TEXT NOT NULL,
  title        TEXT NOT NULL,
  tags         TEXT NOT NULL DEFAULT '[]',       -- JSON array
  links_out    TEXT NOT NULL DEFAULT '[]',       -- JSON array
  created_at   TEXT,
  modified_at  TEXT NOT NULL,
  word_count   INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL                     -- sha1 of normalized body
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id      TEXT PRIMARY KEY,                -- sha1(note_id + ':' + ordinal)
  note_id       TEXT NOT NULL REFERENCES notes(note_id),
  ordinal       INTEGER NOT NULL,
  heading_trail TEXT NOT NULL DEFAULT '[]',      -- JSON array
  text          TEXT NOT NULL,
  est_tokens    INTEGER NOT NULL,
  text_hash     TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  title, heading, body,
  content='',
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS fts_map (
  fts_rowid INTEGER PRIMARY KEY,
  chunk_id  TEXT NOT NULL UNIQUE REFERENCES chunks(chunk_id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id),
  vector   BLOB NOT NULL,                        -- 384 x f32 little-endian
  model    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_source   ON notes(source_id);
CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified_at);
CREATE INDEX IF NOT EXISTS idx_chunks_note    ON chunks(note_id);
`;
