#!/usr/bin/env node
// agent-services-mcp — MCP server entry point.
//
// A thin MCP server (official @modelcontextprotocol/sdk, stdio transport) that
// exposes provenance-receipts and quality-gate as tools. Each handler forwards
// an HTTP call to the relevant service; it does NOT reimplement service logic.
//
// IMPORTANT: stdout is the MCP protocol channel — all logging goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, type ToolDefinition } from "./tools.js";

// Configurable base URLs of the two underlying services (default to local
// `wrangler dev`; nothing is deployed to a public URL yet). No secrets here.
export const PROVENANCE_URL =
  process.env.PROVENANCE_URL ?? "http://localhost:8787";
export const QUALITY_GATE_URL =
  process.env.QUALITY_GATE_URL ?? "http://localhost:8788";

function baseUrlFor(service: ToolDefinition["service"]): string {
  return (service === "provenance" ? PROVENANCE_URL : QUALITY_GATE_URL).replace(
    /\/$/,
    "",
  );
}

// Forward a tool call to its underlying HTTP endpoint and wrap the response as
// an MCP tool result. The raw response body is returned verbatim (JSON for the
// API endpoints, markdown for /v1/rubric); a non-2xx status (incl. 402) sets
// isError so the caller can react, with the body preserved.
async function forward(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const url = baseUrlFor(tool.service) + tool.path;
  try {
    const init: RequestInit = {
      method: tool.method,
      signal: AbortSignal.timeout(30_000),
    };
    if (tool.method === "POST") {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(args ?? {});
    }
    const res = await fetch(url, init);
    const body = await res.text();
    return {
      content: [{ type: "text", text: body }],
      isError: !res.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `Failed to reach ${tool.service} service at ${url}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "agent-services-mcp",
    version: "0.1.0",
  });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      (args) => forward(tool, (args ?? {}) as Record<string, unknown>),
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `agent-services-mcp ready — ${TOOLS.length} tools | provenance=${PROVENANCE_URL} quality=${QUALITY_GATE_URL}`,
  );
}

main().catch((err) => {
  console.error("agent-services-mcp failed to start:", err);
  process.exit(1);
});
