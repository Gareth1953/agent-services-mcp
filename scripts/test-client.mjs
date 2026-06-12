// Local MCP smoke test: spawns the built server over stdio, lists tools, and
// exercises the FREE tools against running provenance-receipts (:8787) and
// quality-gate (:8788) dev servers.
//
// Does NOT call score_quality (that would trigger a paid Anthropic scoring call).
//
//   node scripts/test-client.mjs
// Requires: `npm run build` first, and both dev servers running with payments off.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: ["dist/index.js"],
  env: {
    ...process.env,
    PROVENANCE_URL: "http://127.0.0.1:8787",
    QUALITY_GATE_URL: "http://127.0.0.1:8788",
  },
});

const client = new Client({ name: "smoke-test", version: "0.0.0" });
await client.connect(transport);

const textOf = (r) => r.content?.find((c) => c.type === "text")?.text ?? "";
let failures = 0;
const expect = (label, cond) => {
  console.log(`  ${cond ? "OK " : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

// --- list tools ---
const { tools } = await client.listTools();
console.log("tools discovered:", tools.map((t) => t.name).join(", "));
expect("5 tools listed", tools.length === 5);

// --- get_quality_rubric (free) ---
console.log("\n[get_quality_rubric]");
const rubric = await client.callTool({ name: "get_quality_rubric", arguments: {} });
const rubricText = textOf(rubric);
expect("not an error", rubric.isError !== true);
expect("returns the rubric markdown", rubricText.includes("Quality Gate Rubric"));

// --- certify_provenance (free; payments off) ---
console.log("\n[certify_provenance]");
const certRes = await client.callTool({
  name: "certify_provenance",
  arguments: { content: "hello from MCP", generator_metadata: { model: "claude-opus-4-8" } },
});
expect("not an error", certRes.isError !== true);
const cert = JSON.parse(textOf(certRes));
expect("receipt has a signature", Boolean(cert.receipt?.signature));
console.log("    receipt_id:", cert.receipt?.receipt_id);

// --- verify_provenance (free): valid for matching content, invalid for tampered ---
console.log("\n[verify_provenance]");
const okVer = JSON.parse(
  textOf(
    await client.callTool({
      name: "verify_provenance",
      arguments: { content: "hello from MCP", receipt: cert.receipt },
    }),
  ),
);
expect("valid:true for unmodified content", okVer.valid === true);
const badVer = JSON.parse(
  textOf(
    await client.callTool({
      name: "verify_provenance",
      arguments: { content: "tampered content", receipt: cert.receipt },
    }),
  ),
);
expect("valid:false for tampered content", badVer.valid === false);

// --- verify_quality (free): a forged score receipt must NOT verify (no scoring call) ---
console.log("\n[verify_quality] (forged receipt — no paid scoring call)");
const forged = {
  content_hash: "00",
  score: 99,
  rubric_version: "v1",
  receipt_id: "forged",
  timestamp: new Date().toISOString(),
  signature: "00",
};
const vq = JSON.parse(
  textOf(
    await client.callTool({
      name: "verify_quality",
      arguments: { content: "anything", receipt: forged },
    }),
  ),
);
expect("valid:false for forged score receipt", vq.valid === false);

console.log("\nNOTE: score_quality (paid Anthropic call) was intentionally NOT called.");
await client.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
