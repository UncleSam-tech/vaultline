#!/usr/bin/env node
/**
 * Vaultline entrypoint — stdio transport (local-first primary mode).
 * IMPORTANT: stdio servers must never log to stdout; use stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[vaultline] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[vaultline] fatal:", err);
  process.exit(1);
});
