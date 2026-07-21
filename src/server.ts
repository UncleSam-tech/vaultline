/**
 * MCP server assembly: registers the four read-only tools (spec §1).
 * Handlers are stubs wired to throw NotImplemented via the in-result error
 * contract — replace service-by-service during the build sprint.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const responseFormat = z.enum(["json", "markdown"]).default("markdown");

export const searchKnowledgeInput = {
  query: z.string().min(1).max(1000)
    .describe("Natural-language or keyword query, e.g. 'pricing psychology anchoring notes'"),
  sources: z.array(z.string()).optional()
    .describe("Restrict to source IDs from vaultline_list_sources; omit = all"),
  tags: z.array(z.string()).optional()
    .describe("Restrict to notes carrying ALL of these tags"),
  modified_after: z.string().datetime().optional(),
  modified_before: z.string().datetime().optional(),
  mode: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid")
    .describe("hybrid = fused keyword+semantic; degrades to keyword if embeddings disabled"),
  token_budget: z.number().int().min(200).max(8000).default(2000)
    .describe("Max estimated tokens of passage text returned"),
  limit: z.number().int().min(1).max(50).default(8),
  offset: z.number().int().min(0).default(0),
  response_format: responseFormat,
};

export const getNoteInput = {
  note_id: z.string().optional(),
  path: z.string().optional().describe("Path relative to a source root; exactly one of note_id | path"),
  source_id: z.string().optional().describe("Required with path when the path exists in multiple sources"),
  include_metadata: z.boolean().default(true),
  response_format: responseFormat,
};

export const listSourcesInput = { response_format: responseFormat };

export const getRelatedInput = {
  note_id: z.string(),
  limit: z.number().int().min(1).max(25).default(5),
  exclude_same_note: z.boolean().default(true),
  response_format: responseFormat,
};

function notImplemented(tool: string) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: `${tool} is not implemented yet. Vaultline is under construction; see vaultline_list_sources for index status once available.`,
      },
    ],
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "vaultline", version: "0.1.0" });

  server.registerTool(
    "vaultline_search_knowledge",
    {
      title: "Search knowledge base",
      description:
        "Hybrid (keyword+semantic) search across ALL connected note sources. Returns ranked, cited passages under a token budget. If result is empty AND searchExhausted=true, the information is not in the user's notes — do not retry with rephrasings.",
      inputSchema: searchKnowledgeInput,
      annotations: READ_ONLY,
    },
    async () => notImplemented("vaultline_search_knowledge"),
  );

  server.registerTool(
    "vaultline_get_note",
    {
      title: "Get full note",
      description:
        "Retrieve one complete note by note_id (preferred, from search results) or by path. Use after a search hit when full context is needed.",
      inputSchema: getNoteInput,
      annotations: READ_ONLY,
    },
    async () => notImplemented("vaultline_get_note"),
  );

  server.registerTool(
    "vaultline_list_sources",
    {
      title: "List connected sources",
      description:
        "Enumerate connected note sources with note counts and index freshness. Call this before asserting that a knowledge base or note app is not available.",
      inputSchema: listSourcesInput,
      annotations: READ_ONLY,
    },
    async () => notImplemented("vaultline_list_sources"),
  );

  server.registerTool(
    "vaultline_get_related",
    {
      title: "Find related notes",
      description:
        "Notes similar to a given note (embedding similarity; falls back to shared tags/links in keyword-only mode).",
      inputSchema: getRelatedInput,
      annotations: READ_ONLY,
    },
    async () => notImplemented("vaultline_get_related"),
  );

  return server;
}
