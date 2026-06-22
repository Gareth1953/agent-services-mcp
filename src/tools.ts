// Tool definitions for the agent-services-mcp server.
//
// This file is the single source of truth for the tools this MCP server exposes.
// Each entry maps a tool name -> an HTTP endpoint on one of the three underlying
// services (provenance-receipts, quality-gate, or agent-action-audit). The
// handler forwards the HTTP call; it does not reimplement service logic.
//
// Descriptions are HONEST and front-load what an agent needs to decide whether to
// call: COST (paid/free), what it does, when to use it, and what it returns.

import { z, type ZodRawShape } from "zod";

export type ServiceName = "provenance" | "quality" | "audit";

export interface ToolDefinition {
  name: string;
  title: string;
  service: ServiceName; // which underlying service this forwards to
  method: "GET" | "POST";
  path: string; // path on that service, e.g. "/v1/certify"
  paid: boolean; // whether the underlying endpoint can charge via x402
  description: string;
  inputSchema: ZodRawShape;
  outputSchema?: ZodRawShape; // optional structured-output schema
}

// A receipt is an arbitrary signed object returned by a service. We keep the
// schema permissive (pass-through) — the wrapper does not re-validate receipt
// internals; the underlying /v1/verify endpoint is the authority.
const receiptShape = z
  .record(z.unknown())
  .describe("A signed receipt object exactly as returned by the service.");

// Optional payment token accepted by PAID tools. The x402 flow is two-step:
// call once without it to get the 402 requirements, then resend with it to pay.
const xPayment = {
  x_payment: z
    .string()
    .optional()
    .describe(
      "Optional x402 payment token (the base64 X-PAYMENT value). Leave unset on the " +
        "first call to receive the 402 payment requirements; then build the token with " +
        "an x402 client + wallet and resend it here to pay and get the result. " +
        "Forwarded as the X-PAYMENT header — this wrapper holds no wallet of its own.",
    ),
};

// Structured output for the verify_* tools.
const verifyOutput = {
  valid: z
    .boolean()
    .describe(
      "True only if the content/record matches the receipt AND the Ed25519 signature is valid.",
    ),
  details: z
    .record(z.unknown())
    .optional()
    .describe("Per-check breakdown (e.g. hash match, signature valid)."),
};

// Structured output for score_quality (all optional so it never mis-validates a
// 'no pass, no pay' response, which returns receipt: null).
const scoreOutput = {
  receipt: z
    .record(z.unknown())
    .nullable()
    .optional()
    .describe("Signed score receipt, or null if below target_score (no pass, no pay)."),
  score: z.number().optional().describe("Total score 0–100, when present."),
  breakdown: z.record(z.unknown()).optional().describe("Per-dimension scores and flags."),
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "certify_provenance",
    title: "Certify content provenance",
    service: "provenance",
    method: "POST",
    path: "/v1/certify",
    paid: true,
    description:
      "PAID (x402 micropayment in USDC on Base; exact amount is returned in the 402 challenge — pay via x_payment).\n" +
      "Certifies the ORIGIN of content: returns an Ed25519-signed receipt over a SHA-256 hash of the content, your caller-attested generator_metadata, and a service timestamp.\n" +
      "USE WHEN you need tamper-evident proof of exactly what content existed at a point in time. Verify it later for FREE with verify_provenance.\n" +
      "PROVES: the content is unmodified (hash) and the receipt was issued by the holder of the service's signing key.\n" +
      "DOES NOT PROVE: generator_metadata — the receipt proves you CLAIMED that metadata, not that a specific model produced the content. Proof-of-origin/tamper-evidence, NOT AI-detection and NOT a truth guarantee.\n" +
      "Two-step: call once with no x_payment to get the 402 requirements, then resend with x_payment to pay.",
    inputSchema: {
      content: z.string().min(1).describe("The exact content to certify. Non-empty."),
      generator_metadata: z
        .record(z.unknown())
        .optional()
        .describe(
          "Optional caller-attested metadata about what generated the content " +
            "(e.g. { model, provider }). Recorded verbatim; the receipt proves you " +
            "claimed it, not that a specific model ran.",
        ),
      ...xPayment,
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
      "FREE. Verifies a provenance receipt against its content (re-hashes the content, checks the Ed25519 signature).\n" +
      "USE WHEN you have a receipt + the original content and need to confirm it's genuine and unmodified.\n" +
      "RETURNS: { valid, details }. valid is true only if the content hash matches the receipt AND the signature is valid under the service's public key. A 200 means verification ran — always read valid (false = content modified or receipt altered/forged).",
    inputSchema: {
      content: z.string().describe("The content to check against the receipt."),
      receipt: receiptShape.describe("A provenance receipt as returned by certify_provenance."),
    },
    outputSchema: verifyOutput,
  },
  {
    name: "score_quality",
    title: "Score content against the published quality rubric",
    service: "quality",
    method: "POST",
    path: "/v1/score",
    paid: true,
    description:
      "PAID (x402 micropayment in USDC on Base; exact amount is returned in the 402 challenge — pay via x_payment).\n" +
      "Scores content against quality-gate's PUBLISHED rubric (clarity, completeness, internal consistency, obvious-error freedom — 0–25 each, summing 0–100) and returns an Ed25519-signed score receipt. Read the exact rubric for FREE with get_quality_rubric.\n" +
      "USE WHEN you need a reproducible, signed quality score for a piece of content.\n" +
      "RETURNS: a signed score receipt; or, with target_score set, receipt:null + the failing breakdown ('no pass, no pay' — no receipt and no charge below target).\n" +
      "WHAT IT IS NOT: a measure of absolute truth, an external/third-party standard, or a fact-check.\n" +
      "Two-step: call once with no x_payment to get the 402 requirements, then resend with x_payment to pay.",
    inputSchema: {
      content: z.string().min(1).describe("The content to score. Non-empty."),
      rubric_version: z
        .string()
        .optional()
        .describe(
          "Optional rubric version to score against; must match the service's current version (e.g. \"v1\") if provided.",
        ),
      target_score: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe(
          "Optional 0–100 threshold. Enables 'no pass, no pay': below this, no receipt is issued and no charge is made.",
        ),
      ...xPayment,
    },
    outputSchema: scoreOutput,
  },
  {
    name: "verify_quality",
    title: "Verify a quality score receipt",
    service: "quality",
    method: "POST",
    path: "/v1/verify",
    paid: false,
    description:
      "FREE. Verifies a quality score receipt against its content (re-hashes the content, checks the Ed25519 signature, which covers the score itself — so a forged or altered score fails).\n" +
      "USE WHEN you have a score receipt + the content and need to confirm the score is genuine.\n" +
      "RETURNS: { valid, details }. A 200 means verification ran — always read valid.",
    inputSchema: {
      content: z.string().describe("The content the score receipt was issued for."),
      receipt: receiptShape.describe("A quality score receipt as returned by score_quality."),
    },
    outputSchema: verifyOutput,
  },
  {
    name: "get_quality_rubric",
    title: "Get the published quality rubric",
    service: "quality",
    method: "GET",
    path: "/v1/rubric",
    paid: false,
    description:
      "FREE; takes no input. Fetch the published Quality Gate rubric (markdown) + its version that score_quality grades against.\n" +
      "USE WHEN you want to understand exactly what a quality score means and does not mean before calling score_quality.",
    inputSchema: {},
  },
  {
    name: "audit_action",
    title: "Audit an agent action",
    service: "audit",
    method: "POST",
    path: "/v1/audit",
    paid: true,
    description:
      "PAID (x402 micropayment in USDC on Base; exact amount is returned in the 402 challenge — pay via x_payment).\n" +
      "Creates a tamper-evident AUDIT RECEIPT for an action an agent took: an Ed25519-signed receipt over a SHA-256 hash of the action, your caller-attested actor_metadata, a hash of optional context, and a timestamp.\n" +
      "USE WHEN you need an accountability record proving exactly what an agent claimed it did, and when. Verify later for FREE with verify_audit.\n" +
      "PROVES: the action RECORD is genuine (issued by the service's signing key) and unaltered since issue.\n" +
      "DOES NOT PROVE: that the agent's claim is true. action/actor_metadata/context are CALLER-ATTESTED — proof you CLAIMED this exact record, not that the agent did it, nor that it was authorized or correct. An accountability/audit tool, NOT a lie-detector.\n" +
      "Two-step: call once with no x_payment to get the 402 requirements, then resend with x_payment to pay.",
    inputSchema: {
      action: z.string().min(1).describe("What the agent did (the action being audited). Non-empty."),
      actor_metadata: z
        .record(z.unknown())
        .describe(
          "Caller-attested: who/what performed the action and the stated authority it acted under " +
            "(e.g. { agent, operator, authority }). Recorded verbatim and covered by the signature; " +
            "proves you claimed it, not that it is true.",
        ),
      context: z
        .record(z.unknown())
        .optional()
        .describe(
          "Optional caller-attested supporting detail. Hashed into the receipt; an absent context hashes the canonical empty object.",
        ),
      ...xPayment,
    },
  },
  {
    name: "verify_audit",
    title: "Verify an audit receipt",
    service: "audit",
    method: "POST",
    path: "/v1/verify",
    paid: false,
    description:
      "FREE. Verifies an audit receipt against its record (re-hashes the submitted action + context, checks they and actor_metadata match the receipt, plus the Ed25519 signature).\n" +
      "USE WHEN you have an audit receipt + the original action/metadata and need to confirm the record is genuine and unaltered.\n" +
      "RETURNS: { valid, details }. valid is true only if action, context, AND actor_metadata all match the receipt AND the signature is valid. A 200 means verification ran — always read valid (false = record altered or receipt forged).",
    inputSchema: {
      action: z.string().describe("The action the receipt was issued for."),
      actor_metadata: z.record(z.unknown()).describe("The actor_metadata the receipt was issued for."),
      context: z
        .record(z.unknown())
        .optional()
        .describe("The optional context the receipt was issued for (omit if none)."),
      receipt: receiptShape.describe("An audit receipt as returned by audit_action."),
    },
    outputSchema: verifyOutput,
  },
];
