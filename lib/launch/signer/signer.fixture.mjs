/**
 * Tests only (CITY-162): a launch signer over a throwaway keypair, for the tests of the flow around it — the creation's
 * submit, the executor's pass — whose transactions are made-up shapes rather than the real ones the bounds hold to.
 * Its bounds ask only that the key is the message's fee payer; its journal keeps the rows in memory. The real bounds
 * and the real journal have their own tests (`./signer.test.mjs`).
 */

import { envKey } from "./env.server.ts";
import { boundedSigner } from "./signer.server.ts";

/** Bounds for made-up shapes: the key must pay the fee, nothing more. */
export const FEE_PAYER_ONLY = Object.freeze({
  refusal: () => null,
  describe: () => ({ action: "test", subject: null }),
});

/** A signer over `keypair`; `rows` collects its journal. */
export function testSigner(keypair, { role = "pool-payer", cluster = "devnet", bounds = FEE_PAYER_ONLY, rows = [] } = {}) {
  const key = envKey(JSON.stringify([...keypair.secretKey]));
  const signer = boundedSigner(key.signer, {
    role,
    address: key.address,
    cluster,
    bounds: { refusal: (view, request) => (view.feePayer === key.address ? bounds.refusal(view, request) : "not the fee payer"), describe: bounds.describe },
    journal: async (row) => {
      rows.push(row);
    },
  });
  return { ...signer, rows };
}
