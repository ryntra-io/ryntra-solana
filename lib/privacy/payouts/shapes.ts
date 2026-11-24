/**
 * How many parts of a private balance one private transfer can spend — the Privacy Rings SDK's own rule, copied here so
 * a payout's signatures are counted before the first one, without loading the SDK.
 *
 * A private balance lies in parts (notes): every «Hide» and every payment received is one more. A transfer proves with
 * one of the SDK's fixed shapes «inputs × outputs»; the more outputs it pays, the fewer parts it may take. A payout of
 * 8–15 people (16 outputs with the change) takes at most 8 parts; past that the balance is merged first — one more
 * signature for each merge of up to 24 smallest parts (`docs/research/ryntra-private-2026-11-18/PROBE.md`, p. 6).
 *
 * Source: `@heliuslabs/spr@0.9.0-alpha` — `interface/shape.js` (`SPP_SUPPORTED_SHAPES`), `flows/select.js`
 * (`maxSpendInputs`, `MAX_SPEND_INPUTS`), `interface/constants.js` (`MERGE_INPUT_COUNT`), `transaction/wallet/intent.js`
 * (`MAX_TRANSFER_PAYMENTS`). `scripts/privacy/payouts-offline.mjs` compares every number here with the SDK it loads, so
 * an SDK update that moves them is caught before a person sees a wrong count.
 */

/** «inputs × outputs» of every proof the SDK proves, in the SDK's order. */
export const SPP_SHAPES: readonly (readonly [inputs: number, outputs: number])[] = [
  [1, 2], [1, 4], [1, 8], [2, 2], [2, 4], [1, 16], [2, 8], [3, 2], [3, 4], [2, 16], [3, 8], [4, 2], [4, 4], [4, 8],
  [5, 2], [5, 4], [4, 16], [5, 8], [6, 2], [6, 4], [5, 16], [6, 8], [8, 2], [8, 4], [8, 8], [8, 16], [12, 2], [12, 4],
  [12, 8], [16, 2], [16, 4], [16, 8], [24, 2], [24, 4], [32, 2], [40, 2], [48, 2], [49, 2],
];

/** The most parts any spend selects. */
export const MAX_SPEND_INPUTS = 40;

/** Payments one private transfer carries: the widest shape's outputs less the change. */
export const MAX_PAYMENTS = Math.max(...SPP_SHAPES.map(([, outputs]) => outputs)) - 1;

/** Parts one default merge takes: the smallest ones. */
export const MERGE_INPUT_COUNT = 24;

/** Parts a spend with `outputs` outputs may take: the widest shape holding that many outputs, capped. */
export function maxSpendInputs(outputs: number): number {
  const widest = SPP_SHAPES.filter(([, o]) => o >= outputs).reduce((max, [inputs]) => Math.max(max, inputs), 0);
  return Math.min(MAX_SPEND_INPUTS, widest);
}
