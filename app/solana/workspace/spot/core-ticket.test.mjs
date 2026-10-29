// Run from repo root: node --test app/solana/workspace/spot/core-ticket.test.mjs
/**
 * B16 on SOL-T1: Spot's ticket is the core's `TradeTicket`, fed by Spot's own flow. The translation of the engine's
 * quote, exact order, limit Review and settled answer into the core's shapes is checked here against the core's own
 * arithmetic (`ticketModel`), and the guard that no Spot page draws a «Купити / Продати» of its own.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { newDraft, presetLayout, ticketModel, untouched } from "@ryntra/core/ui";

import {
  engineFees,
  fromView,
  lotFor,
  marketResult,
  pricesOf,
  receiptOfFill,
  referencePrice,
  reviewedFromLimit,
  reviewedFromOrder,
  tickFor,
  ticketBalances,
  ticketMarketOf,
  ticketQuoteOf,
  toView,
} from "./core-ticket.ts";
import { SPOT_PANELS, SPOT_PANEL_IDS, denseSpotDock, denseSpotLayout, spotDockUntouched } from "./spot-layout.ts";

const SOL = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 };
const USDC = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 };
const NOW = 1_760_000_000_000;

/** An engine order buying 0.5 SOL for 100 USDC, Ryntra's 10 bps on the input, Jupiter nothing on top. */
const order = (over = {}) => ({
  inputMint: USDC.mint,
  outputMint: SOL.mint,
  inAmountRaw: "100000000",
  outAmountRaw: "500000000",
  minReceivedRaw: "497500000",
  slippageBps: 50,
  totalFeeBasisPoints: 10,
  signatureFeeLamports: "5000",
  priorityFeeLamports: "45000",
  rentFeeLamports: "0",
  requestId: "req-1",
  route: [{ label: "Meteora DLMM", basisPoints: 10_000 }],
  ...over,
});
const fee = { mechanism: "JUPITER_PLATFORM_FEE", basisPoints: 10, asset: USDC.mint, decimals: 6, amountRaw: "100000" };

test("a market's steps: six significant digits of its first price, one raw unit of its base", () => {
  assert.equal(tickFor(180.25), "0.001");
  assert.equal(tickFor(0.00001234), "0.0000000001");
  assert.equal(tickFor(null), "0.000001");
  assert.equal(lotFor(9), "0.000000001");
  assert.equal(lotFor(0), "1");
  const market = ticketMarketOf(SOL, USDC, 180.25);
  assert.equal(market.id, `${SOL.mint}/${USDC.mint}`);
  assert.equal(market.symbol, "SOL/USDC");
  assert.equal(market.min_notional, null);
});

test("a stock's scale moves the base leg between the wallet's unit and the raw one, never up", () => {
  const scale = { num: 3n, den: 2n };
  assert.equal(toView(1000n, scale), 1500n);
  assert.equal(fromView(1500n, scale), 1000n);
  assert.equal(toView(1000n, null), 1000n);
  assert.equal(fromView(1001n, scale), 667n, "truncated toward zero: the chain never owes a fraction of a raw unit");
});

test("every cost by who takes it: the network's in SOL, Ryntra's stated amount, Jupiter's own share in the mint it names", () => {
  const tokens = new Map([[USDC.mint, USDC], [SOL.mint, SOL]]);
  const plain = engineFees(order(), fee, tokens);
  assert.deepEqual(plain.gas, { units: "50000", asset: SOL.mint, decimals: 9 });
  assert.deepEqual(plain.ryntra, { units: "100000", asset: USDC.mint, decimals: 6 });
  assert.equal(plain.venue, undefined, "Jupiter's total is Ryntra's platform fee: nothing of its own on top");
  /* A referral of 20 bps from a total of 30: Jupiter's 10 on what arrives, as a share of the gross. */
  const referral = engineFees(order({ totalFeeBasisPoints: 30 }), { mechanism: "JUPITER_REFERRAL", basisPoints: 20, asset: SOL.mint, decimals: 9, amountRaw: null }, tokens);
  assert.deepEqual(referral.ryntra, { units: "1000000", asset: SOL.mint, decimals: 9 });
  assert.deepEqual(referral.venue, { units: String((500000000n * 10n) / 9990n), asset: SOL.mint, decimals: 9 });
  /* A venue's fee taken in the input is a share of what is paid. */
  const onInput = engineFees(order({ totalFeeBasisPoints: 30, platformFee: { mint: USDC.mint } }), null, tokens);
  assert.deepEqual(onInput.venue, { units: String((100000000n * 30n) / 10000n), asset: USDC.mint, decimals: 6 });
});

test("the engine's quote speaks for the ticket's own amount: the core's model takes it, ready, with its costs", () => {
  const market = ticketMarketOf(SOL, USDC, 200);
  const prices = pricesOf([{ mint: SOL.mint, usd: 200 }, { mint: USDC.mint, usd: 1 }], "Jupiter", NOW);
  const draft = newDraft({ side: "buy", amount: "100", slippageBps: 50 });
  const quote = ticketQuoteOf({ order: order(), serviceFee: fee, side: "buy", market, pay: USDC, get: SOL, scale: null, paidView: 100000000n, expiresAt: NOW + 20_000, at: NOW, slippageBps: 50 });
  assert.ok(quote);
  const input = {
    market,
    draft,
    balances: ticketBalances([{ mint: USDC.mint, spendableRaw: "500000000", decimals: 6 }, { mint: SOL.mint, spendableRaw: "1000000000", decimals: 9 }], () => null),
    prices,
    reference: { price: referencePrice(200, 1), source: "Jupiter", at: NOW },
    gas: { token: { asset: SOL.mint, symbol: "SOL", decimals: 9 }, reserve: { units: "0", asset: SOL.mint, decimals: 9 } },
    quote,
    fees: [],
    venue: "Jupiter",
    venueId: "jupiter",
    maxLegs: 1,
    swap: { status: "on" },
    limit: { status: "on" },
    now: NOW,
  };
  const model = ticketModel(input, "en");
  assert.equal(model.quoteState, "ready");
  assert.equal(model.ready, true, model.blocked ?? "");
  assert.deepEqual(model.expected, { units: "500000000", asset: SOL.mint, decimals: 9 });
  assert.deepEqual(model.atLeast, { units: "497500000", asset: SOL.mint, decimals: 9 });
  /* Another amount, or the same amount after the quote's life: never this quote. */
  assert.equal(ticketModel({ ...input, draft: { ...draft, amount: "99" } }, "en").quoteState, "loading");
  assert.equal(ticketModel({ ...input, now: NOW + 21_000 }, "en").quoteState, "stale");
});

test("a scaled stock's sale: the quote speaks for the amount typed in the wallet's unit when its raw amount is the one behind it", () => {
  const scale = { num: 3n, den: 2n };
  const market = ticketMarketOf({ ...SOL, symbol: "XYZx" }, USDC, 2);
  const paidView = 1500n;
  const sale = order({ inputMint: SOL.mint, outputMint: USDC.mint, inAmountRaw: String(fromView(paidView, scale)), outAmountRaw: "2000000", minReceivedRaw: "1990000" });
  const quote = ticketQuoteOf({ order: sale, serviceFee: null, side: "sell", market, pay: SOL, get: USDC, scale, paidView, expiresAt: NOW + 1, at: NOW, slippageBps: 50 });
  assert.equal(quote?.paid.units, "1500");
  /* A quote for the wrong pair is no quote. */
  assert.equal(ticketQuoteOf({ order: order(), serviceFee: null, side: "sell", market, pay: SOL, get: USDC, scale, paidView, expiresAt: NOW + 1, at: NOW, slippageBps: 50 }), null);
});

test("Review reads the exact order, not the estimate: its amounts, its price, its tolerance and its window", () => {
  const market = ticketMarketOf(SOL, USDC, 200);
  const reviewed = reviewedFromOrder({ order: order({ slippageBps: 37 }), serviceFee: fee, side: "buy", market, pay: USDC, get: SOL, scale: null, prices: {}, impact: 12, expiresAt: NOW + 30_000, at: NOW });
  assert.equal(reviewed.type, "market");
  assert.equal(reviewed.paid.units, "100000000");
  assert.equal(reviewed.expected.units, "500000000");
  assert.equal(reviewed.atLeast?.units, "497500000");
  assert.equal(reviewed.slippageBps, 37);
  assert.equal(reviewed.quote?.expires_at, NOW + 30_000);
  /* 100 USDC for 0.5 SOL: 200 USDC per SOL, at 1e-18. */
  assert.equal(reviewed.price, 200n * 10n ** 18n);
  assert.equal(reviewed.executor, "Jupiter");
});

test("a limit Review: what waits, what arrives at its price, each fee on what arrives, no clock of its own", () => {
  const market = ticketMarketOf(SOL, USDC, 200);
  const review = { side: "buy", venue: "trigger", makingRaw: "100000000", takingRaw: "520000000", price: "192.3", fee: { ryntraBps: 10, venueBps: 0, ryntraFeeRaw: "520000", venueFeeRaw: "0" }, networkFeeLamports: 5000, depositLamports: 2_000_000 };
  const reviewed = reviewedFromLimit({ review, market, pay: USDC, get: SOL, scale: null, prices: {}, price: 1923n * 10n ** 17n });
  assert.equal(reviewed.type, "limit");
  assert.equal(reviewed.quote, null);
  assert.equal(reviewed.size?.units, "520000000");
  assert.deepEqual(reviewed.fees.ryntra, { units: "520000", asset: SOL.mint, decimals: 9 });
  assert.equal(reviewed.fees.venue, undefined);
  assert.deepEqual(reviewed.fees.gas, { units: "5000", asset: SOL.mint, decimals: 9 });
  assert.equal(reviewed.executor, "Jupiter");
});

test("where the order is, in the core's words: never a failure for an answer not yet known", () => {
  const base = { signature: "sig", time: "12:00" };
  assert.equal(marketResult({ ...base, phase: "EXECUTING", kind: null })?.state, "sent");
  assert.equal(marketResult({ ...base, phase: "RECOVERY", kind: null })?.state, "unknown");
  assert.equal(marketResult({ ...base, phase: "SETTLED", kind: "FILLED" })?.state, "filled");
  assert.equal(marketResult({ ...base, phase: "SETTLED", kind: "NOTHING_HAPPENED" })?.state, "expired");
  assert.equal(marketResult({ ...base, phase: "SETTLED", kind: "NOT_FILLED" })?.state, "rejected");
  assert.equal(marketResult({ ...base, phase: "SETTLED", kind: "UNPLACED" })?.state, "unknown");
  assert.equal(marketResult({ ...base, phase: "REVIEW", kind: null }), null);
  for (const state of ["EXECUTING", "RECOVERY", "SETTLED"]) assert.equal(marketResult({ ...base, phase: state, kind: "FILLED" })?.signed, true);
});

test("the receipt card reads the chain's amounts and the chain's costs — never the Review's estimates as a fill's", () => {
  const market = ticketMarketOf(SOL, USDC, 200);
  const reviewed = reviewedFromOrder({ order: order(), serviceFee: fee, side: "buy", market, pay: USDC, get: SOL, scale: null, prices: {}, impact: null, expiresAt: NOW, at: NOW });
  const receipt = receiptOfFill({ settled: { state: "MATCHED", signature: "sig", observation: { actualInputRaw: "100000000", actualOutputRaw: "499900000" } }, reviewed, scale: null, signer: "owner", at: NOW, chainFee: { amountRaw: "99000", asset: USDC.mint, decimals: 6 } });
  assert.equal(receipt?.amounts.actual.out?.units, "499900000");
  assert.equal(receipt?.tx.id, "sig");
  assert.equal(receipt?.state, "filled");
  assert.deepEqual(receipt?.fees, { gas: reviewed.fees.gas, ryntra: { units: "99000", asset: USDC.mint, decimals: 6 } });
  /* Without the chain's word on Ryntra's fee, no fee of Ryntra's is printed; an unknown price is no «0». */
  const bare = receiptOfFill({ settled: { state: "MATCHED", signature: "sig", observation: { actualInputRaw: "1", actualOutputRaw: "1" } }, reviewed, scale: null, signer: "owner", at: NOW });
  assert.equal(bare?.fees.ryntra, undefined);
  assert.notEqual(bare?.fx.usd, "0");
  assert.equal(receiptOfFill({ settled: { state: "MATCHED", signature: "sig", observation: null }, reviewed, scale: null, signer: "owner", at: NOW }), undefined);
});

test("prices are left out when unknown, never a zero; the reference is the base's dollars over the quote's", () => {
  const prices = pricesOf([{ mint: "a", usd: null }, { mint: "b", usd: 0 }, { mint: "c", usd: 1.5 }], "Jupiter", NOW);
  assert.deepEqual(Object.keys(prices), ["c"]);
  assert.equal(referencePrice(150, 1.5), "100");
  assert.equal(referencePrice(null, 1), null);
});

test("the old «Щільно» the desk opened on before «Стандарт»: the chart, the market's and the account's tabs under it, the ticket the whole right column with «Про токен» beside it", () => {
  const dock = denseSpotDock(SPOT_PANEL_IDS);
  assert.equal(dock.grid.orientation, "HORIZONTAL");
  const [left, right] = dock.grid.root.data;
  assert.equal(left.data[0].data.views[0], "chart");
  assert.deepEqual(left.data[1].data.map((leaf) => leaf.data.id), ["g-market", "g-account"]);
  assert.deepEqual(right.data.map((leaf) => leaf.data.views), [["ticket", "about"]]);
  assert.equal(right.data[0].data.activeView, "ticket", "the ticket is the tab the column opens on");
  assert.deepEqual(left.data[1].data[0].data.views, ["trades", "holders", "pools", "risk", "analytics"]);
  assert.ok(left.size > right.size * 2, "the chart's column is the wide one");
  assert.deepEqual(Object.keys(dock.panels).sort(), [...SPOT_PANEL_IDS].sort());
  /* A panel put away leaves the arrangement; an emptied column goes. */
  const without = denseSpotDock(SPOT_PANEL_IDS.filter((id) => id !== "ticket" && id !== "about"));
  assert.equal(without.grid.root.data.length, 1);
  assert.equal(denseSpotDock([]), undefined);
  const layout = denseSpotLayout(5);
  assert.equal(layout.preset, "dense");
  assert.equal(layout.blocks.length, SPOT_PANELS.length);
  assert.ok(layout.blocks.every((block) => !block.hidden));
});

test("a desk opens in the core's «Стандарт» — the chart and the ticket — and an old «Щільно» never arranged by hand moves there once (SOL-C11)", () => {
  /* «Стандарт» keeps the chart and the ticket by their kind; nothing of the page asks for more. */
  const standard = presetLayout(SPOT_PANELS, "clean");
  assert.deepEqual(standard.blocks.filter((block) => !block.hidden).map((block) => block.id), ["chart", "ticket"]);
  /* The old start as the browser kept it: the same arrangement at another window size, another tab open, a split of one
     group written as the group — still untouched, so the core reads it as nothing kept. */
  const kept = denseSpotLayout(7);
  assert.equal(spotDockUntouched(kept), true);
  assert.equal(untouched(kept, SPOT_PANELS, spotDockUntouched), true);
  const scaled = structuredClone(kept);
  const grow = (node) => {
    node.size = Math.round(node.size * 1.37);
    if (node.type === "branch") node.data.forEach(grow);
    else node.data.activeView = node.data.views.at(-1);
  };
  grow(scaled.dock.grid.root);
  const [, right] = scaled.dock.grid.root.data;
  scaled.dock.grid.root.data[1] = { ...right.data[0], size: right.size };
  assert.equal(spotDockUntouched(scaled), true);
  /* A border the person moved, a panel put elsewhere, tabs in another order: theirs, and it stays. */
  const moved = structuredClone(kept);
  moved.dock.grid.root.data[0].size -= 200;
  moved.dock.grid.root.data[1].size += 200;
  assert.equal(spotDockUntouched(moved), false);
  const reordered = structuredClone(kept);
  reordered.dock.grid.root.data[1].data[0].data.views = ["about", "ticket"];
  assert.equal(spotDockUntouched(reordered), false);
  assert.equal(spotDockUntouched({ ...kept, dock: undefined }), false);
  /* Arranged under today's rule (`rev`), or not «Щільно»: never moved. */
  assert.equal(untouched({ ...kept, rev: 1 }, SPOT_PANELS, spotDockUntouched), false);
  assert.equal(untouched({ ...kept, preset: "calm" }, SPOT_PANELS, spotDockUntouched), false);
});

test("the presets keep what each is for: «Торгівля» the chart, the ticket and the position; «Скальп» needs a book Spot has not", () => {
  const kinds = Object.fromEntries(SPOT_PANELS.map((panel) => [panel.id, panel.kind ?? null]));
  assert.equal(kinds.chart, "chart");
  assert.equal(kinds.ticket, "ticket");
  assert.equal(kinds.position, "positions");
  assert.ok(!SPOT_PANELS.some((panel) => panel.kind === "book" || panel.kind === "reference"), "no book is drawn that Spot has no feed for");
});

test("no Spot page draws a «Купити / Продати» of its own: every buy and sell press is the core's", () => {
  const dir = new URL("./", import.meta.url);
  const offenders = [];
  for (const name of readdirSync(dir)) {
    if (!/\.tsx$/.test(name)) continue;
    const source = readFileSync(new URL(name, dir), "utf8");
    /* A raw <button …> whose words are Buy or Sell. */
    for (const match of source.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      if (/text\("(?:Buy|Sell)"\)|\{entry === "BUY" \? text\("Buy"\)/.test(match[1])) offenders.push(`${name}: ${match[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
  const ticket = readFileSync(new URL("./spot-ticket.tsx", dir), "utf8");
  assert.match(ticket, /<TradeTicket\b/);
  assert.match(ticket, /<Button variant="secondary" lang=\{lang\} data-position-sell/);
  const workspace = readFileSync(new URL("./spot-workspace.tsx", dir), "utf8");
  assert.match(workspace, /<Button variant="primary"[^>]*onClick=\{\(event\) => openTrade\("BUY"/);
  assert.match(workspace, /<Button variant="secondary"[^>]*onClick=\{\(event\) => openTrade\("SELL"/);
});

test("the money flow underneath is Spot's own, unchanged: the engine's quote, exact order, signature checks, one execute, recovery", () => {
  const ticket = readFileSync(new URL("./spot-ticket.tsx", import.meta.url), "utf8");
  assert.match(ticket, /useSpotTicket\(\{/);
  /* SOL-R2: Sign goes through `signReviewed`, which reads an exit level again first and then signs with the same one call. */
  assert.match(ticket, /\? signReviewed\s*: undefined/);
  assert.match(ticket, /const signReviewed = \(\) => \{[\s\S]*?\n    void ticket\.sign\(\);\n  \};/);
  assert.equal((ticket.match(/ticket\.sign\(\)/g) ?? []).length, 1, "one place signs");
  assert.match(ticket, /\(\) => void ticket\.recover\(\)/);
  assert.match(ticket, /cancelWhileSigning=\{false\}/);
  /* A Review that can no longer be signed reads as stale: no signature, a new quote. */
  assert.match(ticket, /expiresAt: ready \? Date\.parse\(prepared\.expiresAt\) : 0/);
  /* The amount the exact order is asked for is held from «Переглянути» to the form again: a dollar sum re-counted by a
     new price never drops a Review or a signature on its way. */
  assert.match(ticket, /const hookAmount = heldAmount \?\? liveAmount;/);
  assert.match(ticket, /setHeldAmount\(liveAmount\);\s*void askReview\(\);/);
  assert.match(ticket, /if \(phase === "IDLE" && attempt === null && heldAmount !== null\) setHeldAmount\(null\);/);
  /* Before the signature: the rent of a new token account, a limit's order account and bins, the price it fills at. */
  assert.match(ticket, /limitPhase\.review\.depositLamports !== null && limitPhase\.review\.depositLamports > 0/);
  assert.match(ticket, /text\("Bin price"\) : text\("Fills at, after fees"\)/);
  assert.match(ticket, /formatTicketPrice\(parsed, lang, ticketMarket\.tick\)/, "on the ticket's own price step");
  assert.match(ticket, /\{rentSol !== null \? \(/);
  assert.ok(ticket.indexOf("data-before-sign") < ticket.indexOf("<TradeTicket"), "said above the Review and its «Підписати»");
  /* A new limit starts a step away from the market on the person's side — never a price the route refuses. */
  assert.match(ticket, /legFromEntry\(referenceE18, side === "buy" \? -1 : 1, ticketMarket, lang\)/);
  assert.match(ticket, /if \(entering \|\| \(!byHand && !limitPriceSet && next\.side !== draft\.side\)\)/, "and follows the side until set by hand");
  assert.match(ticket, /if \(pre\.crosses\) \{/, "crossing is judged against the price the ticket shows");
  const hook = readFileSync(new URL("./use-spot-ticket.ts", import.meta.url), "utf8");
  for (const route of ["/api/solana/swap/quote", "/api/solana/swap/order", "/api/solana/swap/execute", "/api/solana/swap/recover", "/api/solana/swap/cancel-review"]) assert.ok(hook.includes(route), route);
});
