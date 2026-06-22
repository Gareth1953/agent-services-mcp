// examples/free-call.mjs — call a FREE tool through the MCP wrapper in ~2 minutes.
//
//   npm install && npm run build      # produces dist/index.js
//   node examples/free-call.mjs
//
// Uses the official MCP SDK (already a dependency). Points at the LIVE services by
// default. No wallet, no payment — free tools only.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    ...process.env,
    PROVENANCE_URL: "https://provenance-receipts.gpmiddleton71.workers.dev",
    QUALITY_GATE_URL: "https://quality-gate.gpmiddleton71.workers.dev",
    AUDIT_URL: "https://agent-action-audit.gpmiddleton71.workers.dev",
  },
});

const client = new Client({ name: "free-call-example", version: "1.0.0" });
await client.connect(transport);

const textOf = (r) => r.content?.find((c) => c.type === "text")?.text ?? "";

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

// 1) get_quality_rubric — free, no input
const rubric = await client.callTool({ name: "get_quality_rubric", arguments: {} });
console.log("\nget_quality_rubric (free):\n", textOf(rubric).slice(0, 300), "...");

// 2) verify_audit — free; a forged receipt must come back valid:false.
//    Tools with an outputSchema return parsed `structuredContent` you can read directly.
const verify = await client.callTool({
  name: "verify_audit",
  arguments: {
    action: "x",
    actor_metadata: { agent: "x" },
    receipt: {
      action_hash: "00", actor_metadata: { agent: "x" }, context_hash: "00",
      receipt_id: "f", timestamp: "2026-01-01T00:00:00Z", signature: "00",
    },
  },
});
console.log("\nverify_audit (free) structuredContent:", verify.structuredContent);

await client.close();
