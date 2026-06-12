// One paid end-to-end check of the score_quality + verify_quality path THROUGH
// the MCP wrapper. Triggers exactly one real Anthropic scoring call (~$0.012).
//
//   node scripts/test-score.mjs
// Requires: `npm run build`, and quality-gate dev server on :8788 (payments off,
// ANTHROPIC_API_KEY set).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    ...process.env,
    PROVENANCE_URL: "http://127.0.0.1:8787",
    QUALITY_GATE_URL: "http://127.0.0.1:8788",
  },
});

const client = new Client({ name: "score-test", version: "0.0.0" });
await client.connect(transport);

const textOf = (r) => r.content?.find((c) => c.type === "text")?.text ?? "";

const content =
  "A well-structured argument states its premises clearly, supports each claim " +
  "with evidence, and reaches a conclusion that follows from those premises. " +
  "This paragraph is internally consistent and contains no obvious factual errors.";

console.log("[score_quality] calling (one real Anthropic scoring pass)...");
const scoreRes = await client.callTool({ name: "score_quality", arguments: { content } });
if (scoreRes.isError) {
  console.error("score_quality returned an error:\n" + textOf(scoreRes));
  await client.close();
  process.exit(2);
}
const score = JSON.parse(textOf(scoreRes));
console.log(JSON.stringify(score, null, 2));

const sum =
  score.breakdown.clarity +
  score.breakdown.completeness +
  score.breakdown.internal_consistency +
  score.breakdown.obvious_errors;
console.log(`\nsanity: breakdown sum = ${sum} ; reported score = ${score.score}`);

console.log("\n[verify_quality] verifying the returned receipt through the wrapper...");
const verRes = await client.callTool({
  name: "verify_quality",
  arguments: { content, receipt: score.receipt },
});
const ver = JSON.parse(textOf(verRes));
console.log("valid:", ver.valid, "| details:", JSON.stringify(ver.details));

await client.close();

const ok =
  sum === score.score &&
  Boolean(score.receipt?.signature) &&
  ver.valid === true;
console.log(`\n${ok ? "SCORE PATH PROVEN END-TO-END" : "CHECK FAILED"}`);
process.exit(ok ? 0 : 1);
