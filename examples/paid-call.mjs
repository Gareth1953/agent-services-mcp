// examples/paid-call.mjs — actually PAY for and call a paid tool on Base mainnet.
//
// The MCP wrapper forwards the 402 and holds NO wallet of its own, so the realistic
// way to pay is to let an x402 client settle the payment for you. This example pays
// the underlying audit service directly with x402-fetch:
//
//   npm install x402-fetch                         # extra dep, just for this example
//   BUYER_PRIVATE_KEY=0x...  node examples/paid-call.mjs
//
// BUYER_PRIVATE_KEY must be a THROWAWAY Base-mainnet wallet holding a little real
// USDC. ~$0.01 USDC moves buyer -> the service's payTo wallet, gasless (the
// facilitator pays gas). Real money — use a disposable key with a few cents only.
//
// Routing paid calls THROUGH the MCP wrapper instead: build an x402 X-PAYMENT token
// from the 402 requirements and pass it as the tool's `x_payment` input (the wrapper
// forwards it as the X-PAYMENT header). See the README "Calling paid tools" section.

import { wrapFetchWithPayment, createSigner, decodeXPaymentResponse } from "x402-fetch";

const AUDIT_URL = process.env.AUDIT_URL ?? "https://agent-action-audit.gpmiddleton71.workers.dev";
const key = process.env.BUYER_PRIVATE_KEY;
if (!key) {
  console.error("Set BUYER_PRIVATE_KEY — a throwaway Base-mainnet wallet with a little USDC.");
  process.exit(1);
}

const signer = await createSigner("base", key);
const fetchWithPay = wrapFetchWithPayment(fetch, signer);

const res = await fetchWithPay(`${AUDIT_URL}/v1/audit`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "Issued a £20 refund to customer 88412.",
    actor_metadata: { agent: "support-agent-1", operator: "acme" },
  }),
});

console.log("HTTP", res.status);
const xpr = res.headers.get("x-payment-response");
if (xpr) console.log("settlement:", decodeXPaymentResponse(xpr));
console.log("signed receipt:", JSON.stringify(await res.json(), null, 2));
