// Live MCP smoke test against the DEPLOYED services. Spawns the built server
// pointed at the production workers.dev URLs and checks behavior.
//
// FREE — no payment, no scoring call: the paid endpoints (certify/score) now
// require x402 on the live services, and the wrapper forwards without a wallet,
// so they return 402 (the requirements) BEFORE any work happens. This test
// asserts the free tools work and the paid tools correctly surface that 402.
//
//   node scripts/test-live.mjs
// Requires: `npm run build` first.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PROVENANCE_URL = "https://provenance-receipts.gpmiddleton71.workers.dev";
const QUALITY_GATE_URL = "https://quality-gate.gpmiddleton71.workers.dev";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env, PROVENANCE_URL, QUALITY_GATE_URL },
});

const client = new Client({ name: "live-smoke-test", version: "0.0.0" });
await client.connect(transport);

const textOf = (r) => r.content?.find((c) => c.type === "text")?.text ?? "";
let failures = 0;
const expect = (label, cond) => {
  console.log(`  ${cond ? "OK " : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

console.log(`live targets:\n  provenance=${PROVENANCE_URL}\n  quality=${QUALITY_GATE_URL}\n`);

const { tools } = await client.listTools();
expect("5 tools listed", tools.length === 5);

// --- FREE tools ---
console.log("\n[get_quality_rubric] (free)");
const rubric = await client.callTool({ name: "get_quality_rubric", arguments: {} });
expect("not an error", rubric.isError !== true);
expect("returns rubric markdown", textOf(rubric).includes("Quality Gate Rubric"));

console.log("\n[verify_provenance] forged receipt (free)");
const vp = JSON.parse(
  textOf(
    await client.callTool({
      name: "verify_provenance",
      arguments: {
        content: "x",
        receipt: { content_hash: "00", generator_metadata: {}, receipt_id: "f", timestamp: "2026-01-01T00:00:00Z", signature: "00" },
      },
    }),
  ),
);
expect("valid:false for forged provenance receipt", vp.valid === false);

console.log("\n[verify_quality] forged receipt (free)");
const vq = JSON.parse(
  textOf(
    await client.callTool({
      name: "verify_quality",
      arguments: {
        content: "x",
        receipt: { content_hash: "00", score: 99, rubric_version: "v1", receipt_id: "f", timestamp: "2026-01-01T00:00:00Z", signature: "00" },
      },
    }),
  ),
);
expect("valid:false for forged score receipt", vq.valid === false);

// --- PAID tools: wrapper forwards; live services require x402 -> expect 402, NO work done ---
console.log("\n[certify_provenance] no payment -> expect forwarded 402 (free)");
const cert = await client.callTool({ name: "certify_provenance", arguments: { content: "x" } });
const certBody = JSON.parse(textOf(cert));
expect("isError true (402 surfaced)", cert.isError === true);
expect("body carries x402 payment requirements", certBody.x402Version === 1 && certBody.accepts?.[0]?.network === "base-sepolia");

console.log("\n[score_quality] no payment -> expect forwarded 402, NO scoring call (free)");
const score = await client.callTool({ name: "score_quality", arguments: { content: "x" } });
const scoreBody = JSON.parse(textOf(score));
expect("isError true (402 surfaced)", score.isError === true);
expect("body carries x402 payment requirements", scoreBody.x402Version === 1 && scoreBody.accepts?.[0]?.maxAmountRequired === "20000");

await client.close();

console.log("\nNote: paid tools returned 402 (forwarded) — no payment made, no scoring call, $0.");
console.log(`\n${failures === 0 ? "ALL LIVE CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
