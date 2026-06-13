# agent-services-mcp

A single **thin MCP (Model Context Protocol) server** that exposes two existing
services as discoverable tools, so AI agents and MCP-compatible clients can find
and use them through one connection:

- **[provenance-receipts](../provenance-receipts)** — certifies content **origin**;
  returns an Ed25519-signed receipt.
- **[quality-gate](../quality-gate)** — scores content **quality** against a
  published rubric; returns an Ed25519-signed score receipt.

> **It is a thin wrapper.** Every tool forwards an HTTP call to the underlying
> Worker and returns its response verbatim. It does **not** reimplement signing,
> scoring, or payment logic — those live in the two services. The honesty about
> what each service proves carries through to the tool descriptions.

## What the wrapped services prove (and do not)

- **Provenance:** proves the content is unmodified (SHA-256 hash) and the receipt
  was issued by the service's key. The `generator_metadata` is **caller-attested**
  — it proves you *claimed* it, not that a specific model ran. Not AI-detection,
  not a truth guarantee.
- **Quality:** a reproducible score **against the published rubric** (clarity,
  completeness, internal consistency, obvious-error freedom). **Not** absolute
  truth, **not** an external standard, **not** a fact-check. Read the rubric via
  the `get_quality_rubric` tool.

## Tools

| Tool                 | Forwards to                              | Paid?      | Input |
| -------------------- | ---------------------------------------- | ---------- | ----- |
| `certify_provenance` | provenance-receipts `POST /v1/certify`   | yes (x402) | `content` (string), `generator_metadata` (object, optional) |
| `verify_provenance`  | provenance-receipts `POST /v1/verify`    | no         | `content` (string), `receipt` (object) |
| `score_quality`      | quality-gate `POST /v1/score`            | yes (x402) | `content` (string), `rubric_version` (string, optional), `target_score` (number 0–100, optional) |
| `verify_quality`     | quality-gate `POST /v1/verify`           | no         | `content` (string), `receipt` (object) |
| `get_quality_rubric` | quality-gate `GET /v1/rubric`            | no         | none |

Full descriptions and Zod input schemas: [`src/tools.ts`](src/tools.ts). Each
tool returns the service's raw JSON (or markdown, for the rubric) as text. A
non-2xx response from a service (including a `402 Payment Required`) is surfaced
with `isError: true` and the response body preserved, so the caller can react.

## Configuration

The two service URLs are environment-configurable (no secrets — just base URLs):

| Env var            | Live (deployed)                                          | Local dev fallback        |
| ------------------ | -------------------------------------------------------- | ------------------------- |
| `PROVENANCE_URL`   | `https://provenance-receipts.gpmiddleton71.workers.dev`  | `http://localhost:8787`   |
| `QUALITY_GATE_URL` | `https://quality-gate.gpmiddleton71.workers.dev`         | `http://localhost:8788`   |

`.env.example` and the client config below point at the **live** deployments. If
the vars are unset, the server falls back to localhost for local `wrangler dev`
(both Workers default to `:8787`, so run quality-gate on `:8788` to avoid a clash).

> Against the live services, the **paid** tools (`certify_provenance`,
> `score_quality`) require x402 — this wrapper forwards the request and holds no
> wallet, so without an `X-PAYMENT` they return a `402` (the payment requirements)
> surfaced as `isError`. The free tools work as normal.

## Quickstart (local)

```bash
# 1. Build the MCP server
npm install
npm run build            # -> dist/index.js

# 2. In separate terminals, run the two services (free; payments off)
#    (provenance-receipts) npm run dev                 # http://localhost:8787
#    (quality-gate)        npx wrangler dev --port 8788 # http://localhost:8788

# 3a. Smoke-test the free tool paths through an MCP stdio client
node scripts/test-client.mjs

# 3b. (optional, costs ~$0.012) prove the paid score_quality path end-to-end
node scripts/test-score.mjs

# 3c. Smoke-test the wrapper against the LIVE deployed services (free — the
#     paid tools return a forwarded 402; no payment, no scoring call)
node scripts/test-live.mjs
```

`scripts/test-client.mjs` exercises the free tools locally; `scripts/test-score.mjs`
makes one real Anthropic scoring call through `score_quality`;
`scripts/test-live.mjs` points the wrapper at the deployed workers.dev URLs and
asserts the free tools work and the paid tools forward the x402 `402`.

## Connecting an MCP client (stdio)

This server speaks MCP over **stdio** (stdin/stdout). Any MCP client launches it
as a subprocess. Example for a Claude Desktop / Claude Code style
`mcpServers` config:

```json
{
  "mcpServers": {
    "agent-services": {
      "command": "node",
      "args": ["C:\\Users\\Gareth\\agent-services-mcp\\dist\\index.js"],
      "env": {
        "PROVENANCE_URL": "https://provenance-receipts.gpmiddleton71.workers.dev",
        "QUALITY_GATE_URL": "https://quality-gate.gpmiddleton71.workers.dev"
      }
    }
  }
}
```

- Run `npm run build` first so `dist/index.js` exists.
- The client connects, calls `tools/list` (it will see the 5 tools above), and
  invokes them via `tools/call`.
- The underlying services must be reachable at the configured URLs when a tool is
  called.
- Logs go to **stderr**; stdout is reserved for the MCP protocol.

Programmatically, connect with the SDK's `Client` + `StdioClientTransport`
(`command: "node"`, `args: ["dist/index.js"]`) — see `scripts/test-client.mjs`.

## x402 payments (forwarded, not handled here)

The paid endpoints (`/v1/certify`, `/v1/score`) are gated by
[x402](https://github.com/coinbase/x402) on the underlying services. This wrapper
**forwards** requests and does not hold a wallet. If a service has payments
enabled and no valid `X-PAYMENT` is supplied, it returns `402` with the payment
requirements — the wrapper surfaces that as `isError` with the requirements body
intact. Settling a payment (signing an x402 authorization) is the client's
responsibility against the underlying service. See each service's `README.md` /
`docs/API.md` for the x402 details. **Base Sepolia testnet only — no mainnet.**

## Verifying receipts independently

The receipts returned by `certify_provenance` and `score_quality` are
Ed25519-signed and verifiable **without trusting any of these services** — re-hash
the content and check the signature against the service's public key. Each service
ships a runnable independent verifier and recipe: see
[provenance-receipts/docs/VERIFYING.md](../provenance-receipts/docs/VERIFYING.md)
and [quality-gate/docs/VERIFYING.md](../quality-gate/docs/VERIFYING.md).

## Build status

- [x] **Step 1 — skeleton + tool definitions** (`src/tools.ts`)
- [x] **Step 2 — tool handlers (HTTP forwarding) + local smoke test**
- [x] **Step 3 — README: what it is, the tools, and how an MCP client connects**
- [x] **Live — pointed at the deployed services** (`*.gpmiddleton71.workers.dev`)
      and verified end-to-end via `scripts/test-live.mjs`: free tools work; paid
      tools forward the x402 `402`.

All five tool paths verified locally (including one paid `score_quality` call
end-to-end through the wrapper) and against the live deployments.

## Stack

- Official MCP SDK: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
  v1.29.0 (TypeScript), stdio transport, [`zod`](https://www.npmjs.com/package/zod)
  input schemas.
- Node ESM + TypeScript (`tsc` → `dist/`).

## Project layout

```
agent-services-mcp/
├── src/
│   ├── index.ts     # MCP server: registers tools, forwards HTTP, stdio transport
│   └── tools.ts     # the 5 tool definitions (names, descriptions, Zod schemas)
├── scripts/
│   ├── test-client.mjs  # MCP stdio client — free tool smoke test (local)
│   ├── test-score.mjs   # MCP stdio client — one paid score_quality e2e check
│   └── test-live.mjs    # MCP stdio client — against the live deployed services
├── package.json
├── tsconfig.json
├── .gitignore
└── .env.example     # PROVENANCE_URL, QUALITY_GATE_URL
```
