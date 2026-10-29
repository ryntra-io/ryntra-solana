// Run from repo root: node --test "app/app/stocks/[ticker]/stock-ticket.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";

import { newDraft } from "@ryntra/core/ui";

import { SOL_COIN, assetOf, rawAmount, solGas, ticketMarket, ticketPrices } from "../../../../lib/ticket/solana-ticket.ts";
import { stockTicketView } from "./stock-ticket.ts";

/* The company's sheets on the core's ticket: the stage, the quote, what was agreed to and the result are what
   `useSpotTicket` knows — the server's figures said once, a Review held as it arrived, an answer still looked for
   never shown as a failure. */

const NOW = Date.parse("2026-10-20T10:00:00.000Z");
const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, digits: 2 };
const NVDAX = { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", symbol: "NVDAx", decimals: 8, digits: 4, multiplier: 1.0234 };

const order = (over = {}) => ({
  inputMint: USDC.mint,
  outputMint: NVDAX.mint,
  inAmountRaw: "10000000",
  outAmountRaw: "5450000",
  minReceivedRaw: "5422750",
  slippageBps: 50,
  priceImpactPct: "0.001",
  router: "metis",
  platformFee: { basisPoints: 50, mint: USDC.mint },
  totalFeeBasisPoints: 50,
  signatureFeeLamports: "5000",
  priorityFeeLamports: "1000",
  rentFeeLamports: "0",
  requestId: "r",
  reviewExpiresAt: new Date(NOW + 30_000).toISOString(),
  swapUsdValue: "10",
  inUsdValue: "10",
  outUsdValue: "9.94",
  route: [{ label: "Whirlpool", basisPoints: 0 }],
  taker: "Taker1111111111111111111111111111111111111",
  ryntraFee: { mechanism: "JUPITER_REFERRAL", state: "QUOTED", basisPoints: 50, requestedBasisPoints: 50, asset: USDC.mint, symbol: null, decimals: null, amountRaw: null, usd: null, accrual: "JUPITER_REFERRAL_TOKEN_ACCOUNT" },
  ...over,
});

const idle = { phase: "IDLE", quoted: null, quoting: false, prepared: null, preparedReadiness: null, bytesChanged: false, reviewSecondsLeft: null, settled: null, attempt: null };

function base(over = {}) {
  const side = over.side ?? "buy";
  return {
    side,
    market: ticketMarket({ id: NVDAX.mint, base: NVDAX, quote: USDC, price: 182.4, minQuoteRaw: 1_000_000n }),
    base: NVDAX,
    quote: USDC,
    draft: newDraft({ side, unit: "token", amount: side === "buy" ? "10" : "0.1" }),
    balances: { [assetOf(USDC.mint)]: rawAmount("152340000", USDC), [assetOf(SOL_COIN.mint)]: rawAmount("1250000000", SOL_COIN), [assetOf(NVDAX.mint)]: rawAmount("250000000", NVDAX) },
    prices: ticketPrices([{ coin: USDC, usd: 1 }, { coin: NVDAX, usd: 182.4 }], NOW, "Jupiter"),
    reference: null,
    gas: solGas(500_000n),
    quoteFailed: null,
    unavailable: null,
    holding: false,
    time: "10:00",
    lang: "uk",
    now: NOW,
    spot: idle,
    ...over,
  };
}

test("the live quote is the ticket's quote for exactly the sum typed; a quote for another sum waits", () => {
  const view = stockTicketView(base({ spot: { ...idle, quoted: { order: order(), verdict: { verdict: "ALLOW" }, decimals: {}, expiresAt: new Date(NOW + 30_000).toISOString() } } }));
  assert.equal(view.stage, "form");
  assert.equal(view.model.quoteState, "ready");
  assert.equal(view.model.expected.units, String((5_450_000n * 1_023_400_000n) / 1_000_000_000n), "what arrives, in the shares the wallet shows");
  assert.equal(view.model.slippageBps, 50, "the venue's own tolerance");
  const other = stockTicketView(base({ draft: newDraft({ unit: "token", amount: "11" }), spot: { ...idle, quoted: { order: order(), verdict: {}, decimals: {}, expiresAt: new Date(NOW + 30_000).toISOString() } } }));
  assert.equal(other.model.quoteState, "loading");
  // While the sheet proves the wallet or writes the plan first, nothing is quoted on screen.
  assert.equal(stockTicketView(base({ holding: true, spot: { ...idle, quoted: { order: order(), verdict: {}, decimals: {}, expiresAt: new Date(NOW + 30_000).toISOString() } } })).model.quoteState, "loading");
});

test("Review is the exact order's figures, held as they arrived; a price that no longer holds keeps them and cannot be signed", () => {
  const prepared = { order: { ...order(), transactionBase64: "AA==", lastValidBlockHeight: "1" }, simulation: { status: "OK", ownerEffects: null }, policy: { verdict: {} }, decimals: {}, bundle: null, proof: { status: "SIGNED" }, preSign: { ready: true, code: "", reason: "" }, expiresAt: new Date(NOW + 30_000).toISOString() };
  const fresh = stockTicketView(base({ spot: { ...idle, phase: "REVIEW", prepared, preparedReadiness: { ready: true }, reviewSecondsLeft: 18 } }));
  assert.equal(fresh.stage, "review");
  assert.equal(fresh.reviewed.paid.units, "10000000", "what leaves the wallet, every unit");
  assert.equal(fresh.reviewed.atLeast.units, String((5_422_750n * 1_023_400_000n) / 1_000_000_000n));
  assert.equal(fresh.reviewed.quote.expires_at, NOW + 18_000, "the bytes' own window");
  assert.equal(fresh.stale, false);
  const stale = stockTicketView(base({ spot: { ...idle, phase: "REVIEW", prepared, preparedReadiness: { ready: false }, reviewSecondsLeft: 0 } }));
  assert.equal(stale.reviewed.quote.expires_at, 0, "its figures stay, its action is grey");
  assert.equal(stale.reviewed.paid.units, "10000000");
  assert.equal(stale.stale, true);
  const signing = stockTicketView(base({ spot: { ...idle, phase: "SIGNING", prepared, preparedReadiness: { ready: true }, reviewSecondsLeft: 10 } }));
  assert.equal(signing.signing, true);
});

test("the settlement is the ticket's result: a fill with the chain's figures, an answer still looked for never a failure", () => {
  const settled = { state: "MATCHED", signature: "5".repeat(88), observation: { actualInputRaw: "10000000", actualOutputRaw: "5449000" }, facts: { reconciliation: { state: "MATCHED", minimumMet: true } }, receipt: {} };
  /* The sheet kept Review's snapshot; the hook let the order go before the answer settled. */
  const prepared = { order: { ...order(), transactionBase64: "AA==", lastValidBlockHeight: "1" }, simulation: { status: "OK", ownerEffects: null }, policy: { verdict: {} }, decimals: {}, bundle: null, proof: { status: "SIGNED" }, preSign: { ready: true, code: "", reason: "" }, expiresAt: new Date(NOW + 30_000).toISOString() };
  const agreed = stockTicketView(base({ spot: { ...idle, phase: "REVIEW", prepared, preparedReadiness: { ready: true }, reviewSecondsLeft: 20 } })).reviewed;
  const filled = stockTicketView(base({ agreed, spot: { ...idle, phase: "SETTLED", settled } }));
  assert.equal(filled.stage, "result");
  assert.equal(filled.result.state, "filled");
  assert.equal(filled.result.receipt.amounts.actual.out.units, String((5_449_000n * 1_023_400_000n) / 1_000_000_000n));
  assert.equal(filled.result.tx, settled.signature);
  const refused = stockTicketView(base({ spot: { ...idle, phase: "SETTLED", settled: { ...settled, state: "FAILED", observation: null, facts: { reconciliation: { state: "FAILED" } } } } }));
  assert.equal(refused.result.state, "rejected");
  const looking = stockTicketView(base({ spot: { ...idle, phase: "RECOVERY", attempt: { state: "SUBMITTED_UNKNOWN" } } }));
  assert.equal(looking.stage, "result");
  assert.equal(looking.result.state, "unknown");
});

test("a sale counts in the shares the wallet shows, and the venue's refusal or pause is said on the ticket", () => {
  const sale = base({ side: "sell" });
  const view = stockTicketView({ ...sale, spot: { ...idle, quoted: { order: order({ inputMint: NVDAX.mint, outputMint: USDC.mint, inAmountRaw: "9771350", outAmountRaw: "18200000", minReceivedRaw: "18109000" }), verdict: {}, decimals: {}, expiresAt: new Date(NOW + 30_000).toISOString() } } });
  assert.equal(view.model.paid.units, "10000000", "0,1 share typed, as the wallet shows it");
  assert.equal(view.model.quoteState, "ready", "the quote for its chain units speaks for the shares typed");
  assert.equal(view.input.sides.join(), "sell");
  const failed = stockTicketView(base({ quoteFailed: "На $10 маршруту зараз немає." }));
  assert.equal(failed.input.quoteFailed, "На $10 маршруту зараз немає.");
  const paused = stockTicketView(base({ unavailable: "Зараз недоступно" }));
  assert.equal(paused.model.ready, false);
  /* The sheet's sentence stands as the clause after the core's dash: «Ринок — зараз недоступно.», one full stop. */
  assert.match(paused.model.blocked, /— зараз недоступно\.$/);
  assert.doesNotMatch(paused.model.blocked, /\.\.$/);
});

test("the action never waits for the live quote; a sale's receipt is a sale's; SOL sold whole keeps no fee twice", () => {
  /* The sheets' «Купити за $10» asked for the exact order without a quote: a 429 on /quote never held it. */
  assert.equal(stockTicketView(base()).model.ready, true, "no quote yet: Review is still pressable");
  assert.equal(stockTicketView(base({ quoteFailed: "Забагато запитів." })).model.ready, true, "a failed quote: still pressable, with its retry");
  const saleOrder = { ...order({ inputMint: NVDAX.mint, outputMint: USDC.mint, inAmountRaw: "9771350", outAmountRaw: "18200000", minReceivedRaw: "18109000" }), transactionBase64: "AA==", lastValidBlockHeight: "1" };
  const prepared = { order: saleOrder, simulation: { status: "OK", ownerEffects: null }, policy: { verdict: {} }, decimals: {}, bundle: null, proof: { status: "SIGNED" }, preSign: { ready: true, code: "", reason: "" }, expiresAt: new Date(NOW + 30_000).toISOString() };
  const settled = { state: "MATCHED", signature: "5".repeat(88), observation: { actualInputRaw: "9771350", actualOutputRaw: "18190000" }, facts: { reconciliation: { state: "MATCHED", minimumMet: true } }, receipt: {} };
  /* The sheet keeps what Review agreed to; the hook has let the order go by the time the answer settles. */
  const inReview = stockTicketView(base({ side: "sell", spot: { ...idle, phase: "REVIEW", prepared, preparedReadiness: { ready: true }, reviewSecondsLeft: 20 } }));
  assert.equal(inReview.reviewed?.side, "sell");
  assert.equal(inReview.reviewed?.paid.units, String((9_771_350n * 1_023_400_000n) / 1_000_000_000n), "Review says the order's own units, as the wallet shows them");
  const kept = inReview.reviewed;
  const sold = stockTicketView(base({ side: "sell", draft: newDraft({ side: "sell", unit: "token", amount: "" }), agreed: kept, spot: { ...idle, phase: "SETTLED", prepared: null, quoted: null, settled } }));
  assert.equal(sold.reviewed?.side, "sell", "the result knows what was agreed: a sale");
  assert.equal(sold.result.receipt.amounts.expected.out_expected.units, kept.expected.units, "the receipt's expected is Review's");
  const refused = stockTicketView(base({ side: "sell", agreed: kept, spot: { ...idle, phase: "SETTLED", prepared: null, quoted: null, settled: { ...settled, state: "FAILED", observation: null, facts: { reconciliation: { state: "FAILED" } } } } }));
  assert.equal(refused.reviewed?.side, "sell");
  const looking = stockTicketView(base({ side: "sell", agreed: kept, spot: { ...idle, phase: "RECOVERY", prepared: null, attempt: { state: "SUBMITTED_UNKNOWN" } } }));
  assert.equal(looking.reviewed?.side, "sell", "an answer still looked for is a sale's too");
  /* All the SOL the sheet lets go — the balance less its own reserve — is all of it: the quote's fee is not taken again. */
  const sol = { ...SOL_COIN, digits: 4 };
  const solSale = base({
    side: "sell",
    base: sol,
    market: ticketMarket({ id: SOL_COIN.mint, base: sol, quote: USDC, price: 150, minQuoteRaw: 1_000_000n }),
    draft: newDraft({ side: "sell", unit: "token", amount: "1.24" }),
    balances: { [assetOf(USDC.mint)]: rawAmount("0", USDC), [assetOf(SOL_COIN.mint)]: rawAmount("1240000000", SOL_COIN) },
    gas: solGas(0n),
    spot: { ...idle, quoted: { order: order({ inputMint: SOL_COIN.mint, outputMint: USDC.mint, inAmountRaw: "1240000000", outAmountRaw: "186000000", minReceivedRaw: "185000000" }), verdict: {}, decimals: {}, expiresAt: new Date(NOW + 30_000).toISOString() } },
  });
  const whole = stockTicketView(solSale);
  assert.equal(whole.model.max.units, "1240000000", "Max is the whole of what the sheet lets go");
  assert.equal(whole.model.ready, true, "and selling exactly that is not refused");
});
