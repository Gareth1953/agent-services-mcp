# agent-services-mcp

A single **thin MCP (Model Context Protocol) server** that exposes two existing
services as discoverable tools, so AI agents and MCP-compatible clients can find
and use them:

- **[provenance-receipts](../provenance-receipts)** — certifies content origin
  (Ed25519-signed receipt).
- **[quality-gate](../quality-gate)** — scores content against a published rubric
  (Ed25519-signed score receipt).

> **It is a thin wrapper.** It makes HTTP calls to the existing deployed Workers
> and does **not** reimplement their logic. Honesty about what each service
> proves carries through to the tool descriptions verbatim.

## Stack

- Official MCP SDK: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
  v1.29.0 (TypeScript), with [`zod`](https://www.npmjs.com/package/zod) input schemas.
- Service URLs are env-configurable: `PROVENANCE_URL`, `QUALITY_GATE_URL`
  (default to local `wrangler dev`; nothing is deployed publicly yet).

## Build status

- [x] **Step 1 — skeleton + tool definitions** (this commit) — see `src/tools.ts`
- [ ] Step 2 — implement tool handlers (HTTP forwarding); test locally
- [ ] Step 3 — README: what it is, the tools, and how an MCP client connects

## Tools (see `src/tools.ts` for full descriptions + schemas)

| Tool                 | Forwards to                        | Paid? |
| -------------------- | ---------------------------------- | ----- |
| `certify_provenance` | provenance-receipts `POST /v1/certify` | yes (x402) |
| `verify_provenance`  | provenance-receipts `POST /v1/verify`  | no    |
| `score_quality`      | quality-gate `POST /v1/score`          | yes (x402) |
| `verify_quality`     | quality-gate `POST /v1/verify`         | no    |
| `get_quality_rubric` | quality-gate `GET /v1/rubric`          | no    |

## x402 payments (forwarded, not handled here)

The paid endpoints (`/v1/certify`, `/v1/score`) are gated by x402 on the
underlying services. This wrapper **forwards** requests; payment handling is
between the client and the underlying service. Full payment docs live in each
service's repo. (Detailed in step 3.)
