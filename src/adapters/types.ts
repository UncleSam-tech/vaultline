/**
 * Source adapter contract (spec §4).
 * Adapter failures are contained: a throw marks the source "degraded",
 * never fails the server or a search call.
 */

export interface DetectedRoot {
  rootPath: string;
  confidence: "high" | "medium";
  label: string; // e.g. "Obsidian vault 'Personal' (~/Documents/Obsidian/Personal)"
}

export interface ValidationResult {
  ok: boolean;
  detail?: string;
}

export interface RawNoteRef {
  relPath: string;
  modifiedAt: string; // ISO 8601
  sizeBytes: number;
}

export interface RawNote {
  title: string;
  bodyMarkdown: string;
  tags: string[];
  linksOut: string[];
  createdAt?: string;
}

export interface SourceAdapter {
  readonly kind:
    | "markdown-vault"
    | "upnote-export"
    | "joplin-export"
    | "bear-sqlite"
    | "apple-notes-sqlite"
    | "notion-export";

  /** Auto-discovery of likely roots for zero-config `vaultline init`. */
  detect(): Promise<DetectedRoot[]>;

  /** Cheap sanity check that a root is usable by this adapter. */
  validate(root: string): Promise<ValidationResult>;

  /** Enumerate notes without reading bodies (cheap, streaming). */
  listNotes(root: string): AsyncIterable<RawNoteRef>;

  /** Read and normalize one note to markdown. */
  readNote(root: string, ref: RawNoteRef): Promise<RawNote>;

  /** Glob patterns the file watcher should observe under the root. */
  watchPaths(root: string): string[];
}
