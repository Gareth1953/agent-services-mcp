// Tool definitions for the agent-services-mcp server.
//
// This file is the single source of truth for the tools this MCP server exposes.
// Each entry maps a tool name -> an HTTP endpoint on one of the two underlying
// services (provenance-receipts or quality-gate). Handlers that actually forward
// the HTTP call are implemented in step 2; this file is definitions only.
//
// Descriptions are written to be HONEST and precise — they state what each
// service proves AND what it does not, consistent with the services' own docs.

import { z, type ZodRawShape } from "zod";

export type ServiceName = "provenance" | "quality";

export interface ToolDefinition {
  name: string;
  title: string;
  service: ServiceName; // which underlying service this forwards to
  method: "GET" | "POST";
  path: string; // path on that service, e.g. "/v1/certify"
  paid: boolean; // whether the underlying endpoint can charge via x402
  description: string;
  inputSchema: ZodRawShape;
}

// A receipt is an arbitrary signed object returned by a service. We keep the
// schema permissive (pass-through) — the wrapper does not re-validate receipt
// internals; the underlying /v1/verify endpoint is the authority.
const receiptShape = z
  .record(z.unknown())
  .describe("A signed receipt object exactly as returned by the service.");

export const TOOLS: ToolDefinition[] = [
  {
    name: "certify_provenance",
    title: "Certify content provenance",
    service: "provenance",
    method: "POST",
    path: "/v1/certify",
    paid: true,
    description:
      "Certify the ORIGIN of a piece of content via the provenance-receipts service. " +
      "Returns an Ed25519-signed receipt committing to a SHA-256 hash of the content, " +
      "your caller-attested generator_metadata, and a service-set timestamp.\n\n" +
      "PROVES: the content is unmodified (hash) and the receipt was issued by the holder " +
      "of the service's signing key.\n" +
      "DOES NOT PROVE: it does not independently verify generator_metadata — the receipt " +
      "proves you CLAIMED that metadata at certification time, not that a specific model " +
      "actually produced the content. This is proof-of-origin/tamper-evidence, not " +
      "AI-detection and not a truth guarantee.\n\n" +
      "Note: /v1/certify is the paid action; when the underlying service has x402 payments " +
      "enabled it may require a micropayment. This wrapper forwards the request as-is.",
    inputSchema: {
      content: z
        .string()
        .min(1)
        .describe("The exact content to certify. Non-empty."),
      generator_metadata: z
        .record(z.unknown())
        .optional()
        .describe(
          "Optional caller-attested metadata about what generated the content " +
            "(e.g. { model, provider }). Recorded verbatim; the receipt proves you " +
            "claimed it, not that a specific model ran.",
        ),
    },
  },
  {
    name: "verify_provenance",
    title: "Verify a provenance receipt",
    service: "provenance",
    method: "POST",
    path: "/v1/verify",
    paid: false,
    description:
      "Verify a provenance receipt against its content via provenance-receipts. " +
      "Re-hashes the content and checks the Ed25519 signature; returns { valid, details }. " +
      "`valid` is true only if BOTH the content hash matches the receipt AND the signature " +
      "is valid under the service's public key. Free. A 200 response means verification ran " +
      "— always read `valid` (false means the content was modified or the receipt was " +
      "altered/forged).",
    inputSchema: {
      content: z
        .string()
        .describe("The content to check against the receipt."),
      receipt: receiptShape.describe(
        "A provenance receipt as returned by certify_provenance.",
      ),
    },
  },
  {
    name: "score_quality",
    title: "Score content against the published quality rubric",
    service: "quality",
    method: "POST",
    path: "/v1/score",
    paid: true,
    description:
      "Score content against the quality-gate service's PUBLISHED rubric and get an " +
      "Ed25519-signed score receipt. The rubric scores four dimensions — clarity, " +
      "completeness, internal consistency, and obvious-error freedom (0–25 each, summing " +
      "to 0–100) — plus flags from a closed vocabulary. Read the exact rubric with " +
      "get_quality_rubric.\n\n" +
      "WHAT THIS IS: a reproducible score AGAINST OUR PUBLISHED RUBRIC (vX).\n" +
      "WHAT IT IS NOT: a measure of absolute truth, an external/third-party standard, or a " +
      "fact-check — 'obvious-error freedom' catches errors evident from the text or common " +
      "knowledge, not external verification.\n\n" +
      "Optional target_score (0–100) enables 'no pass, no pay': if the score is below your " +
      "target, no receipt is issued and (when payments are on) no charge is made — the " +
      "response returns the failing breakdown with receipt: null.\n\n" +
      "Note: /v1/score is the paid action (one Claude API scoring pass per call) and may " +
      "require an x402 micropayment when the underlying service has payments enabled.",
    inputSchema: {
      content: z
        .string()
        .min(1)
        .describe("The content to score. Non-empty."),
      rubric_version: z
        .string()
        .optional()
        .describe(
          "Optional rubric version to score against; must match the service's current " +
            "version (e.g. \"v1\") if provided.",
        ),
      target_score: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe(
          "Optional 0–100 threshold. Enables 'no pass, no pay': below this, no receipt " +
            "is issued and no charge is made.",
        ),
    },
  },
  {
    name: "verify_quality",
    title: "Verify a quality score receipt",
    service: "quality",
    method: "POST",
    path: "/v1/verify",
    paid: false,
    description:
      "Verify a quality score receipt against its content via quality-gate. Re-hashes the " +
      "content and checks the Ed25519 signature, which covers the score itself — so a " +
      "forged or altered score fails. Returns { valid, details }. Free. A 200 response " +
      "means verification ran — always read `valid`.",
    inputSchema: {
      content: z
        .string()
        .describe("The content the score receipt was issued for."),
      receipt: receiptShape.describe(
        "A quality score receipt as returned by score_quality.",
      ),
    },
  },
  {
    name: "get_quality_rubric",
    title: "Get the published quality rubric",
    service: "quality",
    method: "GET",
    path: "/v1/rubric",
    paid: false,
    description:
      "Fetch the published Quality Gate rubric (markdown) that score_quality grades " +
      "against, along with its version. Read this to understand exactly what a quality " +
      "score means and does not mean. Free; takes no input.",
    inputSchema: {},
  },
];
