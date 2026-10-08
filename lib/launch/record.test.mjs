import assert from "node:assert/strict";
import test from "node:test";

import { OutcomeReceiptArtifactSchema } from "../agent-control/artifacts.ts";
import { METEORA_LAUNCH_ADAPTER_REF, METEORA_LAUNCH_TRADE_ACTION_REF } from "../agent-control/adapters/meteora-launch.ts";
import { projectOperations, summarizeOperations } from "../analytics/operations.ts";
import { parseLaunchTradeFactsFromEffects, ryntraShareBps } from "../core/venues/meteora-dbc/trade-receipt.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { launchNetwork } from "./config.server.ts";
import { writeLaunch } from "./flow.server.ts";
import { listSolanaWalletActions } from "../solana/action-ledger.ts";
import { SolanaActionOriginSchema, isLaunchOrigin } from "../solana/action-origin.ts";
import { filterHistory, historyPage, historyToCsv } from "../solana/history-view.ts";
import { launchReceiptRequest, receiptFetchable } from "../solana/receipt-fetch.client.ts";
import { receiptBinding } from "../solana/receipt-view.ts";
import { isServiceFeeIncome } from "../swap/service-fee.ts";
import {
  beginLaunchTrade,
  failLaunchTrade,
  launchServiceFee,
  launchTradeFacts,
  mintLaunchTradeReceipt,
  readLaunchTradeRecord,
  reconcileLaunchTrades,
  reviewDigestOf,
  settleLaunchTrade,
  tradeOfRecord,
} from "./record.server.ts";

/* Synthetic wallets, mints and signatures only. */
const WALLET = "Wa11et1111111111111111111111111111111111111";
const OTHER = "Qther".padEnd(44, "1");
const TOKEN = "Token".padEnd(44, "2");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CURVE = "Curve".padEnd(44, "3");
const CONFIG = "Config".padEnd(44, "4");
const SIGNATURE = "Sig".padEnd(88, "5");

const start = (over = {}) => ({
  cluster: "mainnet",
  signature: SIGNATURE,
  wallet: WALLET,
  side: "buy",
  venue: "curve",
  token: { mint: TOKEN, symbol: "WICK", decimals: 6 },
  pair: { mint: USDC, symbol: "USDC", decimals: 6, dollar: true },
  curve: CURVE,
  config: CONFIG,
  pool: null,
  buildId: "b".repeat(32),
  reviewDigest: reviewDigestOf(Buffer.from("the unsigned bytes").toString("base64")),
  validUntil: "100",
  quote: { amountInRaw: "5000000", amountOutRaw: "990000000000", minimumOutRaw: "980100000000", slippageBps: 100, feeRaw: "50000", ryntraRaw: "26000" },
  ...over,
});

/* A buy of 5 USDC on the curve: a 1 % fee of 0.05, of it Ryntra's 0.024 as the partner and 0.002 of referral. */
const trade = { signature: SIGNATURE, slot: 400, at: 1_791_000_000, side: "buy", venue: "curve", trader: WALLET, payer: WALLET, account: null, tokensRaw: "989076589761", pairRaw: "5000000", feeRaw: "50066", ryntraRaw: "26035", priceAfter: 0.000005 };

test("the person's trade among the transaction's: the side sent, their wallet as the trader or the payer", () => {
  const theirs = { ...trade, trader: OTHER, payer: OTHER };
  assert.equal(tradeOfRecord([theirs, trade], { side: "buy", wallet: WALLET }), trade);
  assert.equal(tradeOfRecord([{ ...trade, trader: OTHER }], { side: "buy", wallet: WALLET })?.payer, WALLET, "a purchase the wallet paid for and delivered elsewhere is still its trade");
  assert.equal(tradeOfRecord([trade], { side: "sell", wallet: WALLET }), null, "another side is not the trade sent");
  assert.equal(tradeOfRecord([theirs], { side: "buy", wallet: WALLET }), null);
});

test("a launch trade's facts: the chain's figures beside the quote, and whether the least was met", () => {
  const record = { ...start(), state: "SENT", reason: null, receipt: null, rewards: null, sentAt: "2026-10-08T10:00:00.000Z", settledAt: null };
  const facts = launchTradeFacts(record, trade, 400);
  assert.equal(facts.observed.tokensRaw, "989076589761");
  assert.equal(facts.observed.ryntraRaw, "26035");
  assert.equal(facts.minimumMet, true, "989,076 tokens against a least of 980,100");
  assert.equal(facts.pool, null, "a curve trade names no pool");
  assert.equal(facts.at, new Date(1_791_000_000_000).toISOString(), "dated by the program's own clock");
  assert.equal(launchTradeFacts(record, { ...trade, tokensRaw: "1" }, 400).minimumMet, false);
  /* A sale: the least is in the pair currency the seller kept. */
  const sale = launchTradeFacts({ ...record, side: "sell", quote: { ...record.quote, minimumOutRaw: "4900000" } }, { ...trade, side: "sell", pairRaw: "4950000" }, 400);
  assert.equal(sale.minimumMet, true);
});

test("the fee as the rewards core reads it: the whole fee the person paid, Ryntra's part as the base, by Meteora's mechanism — and nothing where Ryntra's part is nothing", () => {
  const record = { ...start(), state: "SENT", reason: null, receipt: null, rewards: null, sentAt: "2026-10-08T10:00:00.000Z", settledAt: null };
  const fee = launchServiceFee(launchTradeFacts(record, trade, 400));
  assert.equal(fee.mechanism, "METEORA_LAUNCH");
  assert.equal(fee.accrual, "METEORA_PARTNER_VAULT");
  assert.equal(fee.state, "COLLECTED");
  assert.equal(isServiceFeeIncome(fee), true);
  assert.equal(fee.amountRaw, "50066", "what the person paid: the curve's whole fee");
  assert.deepEqual(fee.settlement, { userPaidRaw: "50066", providerRaw: "24031", ryntraRaw: "26035", asset: USDC, symbol: "USDC", decimals: 6, basis: "OBSERVED", operationRef: SIGNATURE }, "Ryntra's part is the base; the creator's, Meteora's and the pool's are the rest");
  assert.equal(fee.basisPoints, 100, "the curve's 1 % of 5 USDC — never Ryntra's part as if it were the fee");
  const none = launchServiceFee(launchTradeFacts(record, { ...trade, ryntraRaw: "0" }, 400));
  assert.equal(none.state, "NONE");
  assert.equal(none.settlement, null);
  assert.equal(isServiceFeeIncome(none), false);
  assert.equal(ryntraShareBps({ ryntraRaw: 1n, pairRaw: 1_000_000_000n, feeRaw: 0n, side: "buy" }), 1, "a part too small for a basis point is never read as none");
  assert.equal(ryntraShareBps({ ryntraRaw: 26_000n, pairRaw: 4_950_000n, feeRaw: 50_000n, side: "sell" }), 52, "a sale's gross is what the seller kept and the fees");
});

test("the receipt: an Outcome Receipt pinned to Meteora's launch adapter, its facts rebuilt from it alone, bound to the History row — and the same receipt twice", () => {
  const record = { ...start(), state: "SENT", reason: null, receipt: null, rewards: null, sentAt: "2026-10-08T10:00:00.000Z", settledAt: null };
  const facts = launchTradeFacts(record, trade, 400);
  const at = new Date(facts.at);
  const receipt = mintLaunchTradeReceipt(record, facts, at, {});
  assert.equal(OutcomeReceiptArtifactSchema.safeParse(receipt).success, true);
  assert.equal(receipt.outcome.transactionHash, SIGNATURE);
  assert.equal(receipt.outcome.status, "MATCHED");
  assert.equal(receipt.actionPassportHash, record.reviewDigest, "bound to the bytes the wallet reviewed");
  assert.deepEqual(receipt.registry.refs.map((entry) => entry.ref).sort(), [METEORA_LAUNCH_ADAPTER_REF, METEORA_LAUNCH_TRADE_ACTION_REF].sort());
  assert.deepEqual(parseLaunchTradeFactsFromEffects(receipt.outcome.observedEffects), facts);
  assert.deepEqual(receiptBinding(receipt), { lane: "SWAP", actionId: SIGNATURE, signature: SIGNATURE, wallet: WALLET, network: "mainnet", destination: null });
  assert.equal(mintLaunchTradeReceipt(record, facts, at, {}).contentHash, receipt.contentHash, "two settlements of one trade mint the same receipt");
  /* A receipt that names another network than its chain binds to nothing. */
  const devnet = mintLaunchTradeReceipt({ ...record, cluster: "devnet" }, facts, at, {});
  assert.equal(receiptBinding(devnet), null);
});

/* A settlement's chain, given: the launch's market and the transaction's trades, and the signature's status. */
const devnet = () => launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" });
async function settling(store, answers) {
  await writeLaunch(store, { cluster: "devnet", state: "LAUNCHED", token: TOKEN, pool: CURVE, config: CONFIG, pairMint: USDC, preset: "protected", creator: OTHER, name: "Wick", symbol: "WICK", metadataUri: "https://example.invalid/m", signature: "c".padEnd(88, "6"), validUntil: "1", firstBuyInRaw: "0", firstBuyOutRaw: "0", lock: null, feeSharing: null, buildId: "l".repeat(32), referralCode: null, launchedAt: "2026-10-08T09:00:00.000Z" });
  let reads = 0;
  return {
    deps: {
      network: devnet(),
      connection: {},
      store,
      now: () => new Date("2026-10-08T10:05:00.000Z"),
      reader: { state: async () => ({ curve: { pool: CURVE } }), transaction: async () => answers.trades(reads++) },
      signatureRead: async () => ({ outcome: answers.status(), slot: null }),
    },
    reads: () => reads,
  };
}
const begin = (store) => beginLaunchTrade({ store, now: () => new Date("2026-10-08T10:00:00.000Z") }, start({ cluster: "devnet" }));

test("settling: the chain's trade makes the row DONE with its receipt, minted once — a second settlement reads the same receipt", async () => {
  const store = createMemoryGuardStore();
  await begin(store);
  const { deps } = await settling(store, { trades: () => [trade], status: () => "CONFIRMED" });
  const first = await settleLaunchTrade(deps, SIGNATURE);
  assert.equal(first.record.state, "DONE");
  assert.equal(first.row.outcome, "DONE");
  assert.equal(first.row.receiptHash, first.record.receipt.contentHash);
  assert.deepEqual(first.row.in, { mint: TOKEN, amountRaw: "989076589761", decimals: 6, symbol: "WICK" });
  assert.equal(first.row.fee.amountRaw, "50066");
  assert.equal(first.row.fee.ryntraRaw, "26035");
  assert.equal(first.record.rewards, null, "the stand's books keep no rewards");
  /* A second settlement of the same trade — History and the reconciliation at once — finds it settled. */
  const again = await settleLaunchTrade(deps, SIGNATURE);
  assert.equal(again.record.receipt.contentHash, first.record.receipt.contentHash);
  assert.equal(again.row, null);
});

test("settling: a transaction the chain refused is FAILED, an expired signature is FAILED, an unanswered one waits — and History gets the failed row", async () => {
  for (const [status, after] of [["FAILED", "FAILED"], ["EXPIRED", "FAILED"], ["UNKNOWN", "SENT"]]) {
    const store = createMemoryGuardStore();
    await begin(store);
    const { deps } = await settling(store, { trades: () => null, status: () => status });
    const settled = await settleLaunchTrade(deps, SIGNATURE);
    assert.equal(settled.record.state, after, status);
    if (after === "FAILED") assert.equal(settled.row.outcome, "FAILED", `${status}: the row History answers`);
    else {
      assert.equal(settled.record.tries, 0, "History's read never pushes the reconciliation's wait out");
      assert.equal((await settleLaunchTrade(deps, SIGNATURE, { countTry: true })).record.tries, 1, "the reconciliation's own try is counted");
    }
    const [row] = (await listSolanaWalletActions(store, { network: "devnet", wallet: WALLET })).actions;
    assert.equal(row.outcome, after === "FAILED" ? "FAILED" : "IN_FLIGHT");
  }
  /* A transaction that shows no trade of this wallet is not settled as someone else's. */
  const store = createMemoryGuardStore();
  await begin(store);
  const { deps } = await settling(store, { trades: () => [{ ...trade, trader: OTHER, payer: OTHER }], status: () => "CONFIRMED" });
  assert.equal((await settleLaunchTrade(deps, SIGNATURE)).record.state, "SENT");
});

test("settling: a creation that never landed — its launch removed — fails the creator's first purchase by its signature", async () => {
  const store = createMemoryGuardStore();
  await begin(store);
  /* No launch in the store: the creation's record went with the creation that never landed. */
  const deps = {
    network: devnet(),
    connection: {},
    store,
    now: () => new Date("2026-10-08T10:05:00.000Z"),
    reader: { state: async () => assert.fail("no market is read for a launch that is not there"), transaction: async () => null },
    signatureRead: async () => ({ outcome: "EXPIRED", slot: 1 }),
  };
  const settled = await settleLaunchTrade(deps, SIGNATURE);
  assert.equal(settled.record.state, "FAILED");
  assert.equal(settled.row.outcome, "FAILED");
  /* And while the signature may still land, the purchase waits. */
  const store2 = createMemoryGuardStore();
  await begin(store2);
  assert.equal((await settleLaunchTrade({ ...deps, store: store2, signatureRead: async () => ({ outcome: "UNKNOWN", slot: null }) }, SIGNATURE)).record.state, "SENT");
});

test("settling: a trade decoded without Ryntra's part is read again, never counted as nothing", async () => {
  const store = createMemoryGuardStore();
  await begin(store);
  const { ryntraRaw, ...old } = trade;
  void ryntraRaw;
  const { deps } = await settling(store, { trades: () => [old], status: () => "CONFIRMED" });
  assert.equal((await settleLaunchTrade(deps, SIGNATURE)).record.state, "SENT");
});

test("the reconciliation settles what is due, waits longer after each unanswered try, and stops at its budget", async () => {
  const store = createMemoryGuardStore();
  await begin(store);
  const { deps, reads } = await settling(store, { trades: () => null, status: () => "UNKNOWN" });
  assert.deepEqual((await reconcileLaunchTrades(deps)).map((entry) => entry.after), ["SENT"]);
  assert.equal(reads(), 1);
  /* Tried a moment ago: not due again for two minutes. */
  assert.deepEqual(await reconcileLaunchTrades(deps), []);
  assert.equal(reads(), 1);
  const later = { ...deps, now: () => new Date("2026-10-08T10:08:00.000Z") };
  await reconcileLaunchTrades(later);
  assert.equal(reads(), 2);
  /* No budget left: nothing is started. */
  const store2 = createMemoryGuardStore();
  await begin(store2);
  const { deps: tight, reads: reads2 } = await settling(store2, { trades: () => null, status: () => "UNKNOWN" });
  assert.deepEqual(await reconcileLaunchTrades(tight, { budgetMs: 0 }), []);
  assert.equal(reads2(), 0);
});

test("the History row: in flight from the send with what the wallet spends, failed when nothing moved — a launch's origin with its token and venue", async () => {
  const store = createMemoryGuardStore();
  const now = () => new Date("2026-10-08T10:00:00.000Z");
  await beginLaunchTrade({ store, now }, start());
  await beginLaunchTrade({ store, now }, start());
  let rows = (await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET })).actions;
  assert.equal(rows.length, 1, "a second begin of the same signature writes nothing new");
  assert.equal(rows[0].lane, "SWAP");
  assert.equal(rows[0].outcome, "IN_FLIGHT");
  assert.deepEqual(rows[0].out, { mint: USDC, amountRaw: "5000000", decimals: 6, symbol: "USDC" });
  assert.deepEqual(rows[0].origin, { surface: "LAUNCH", side: "BUY", token: TOKEN, venue: "curve" });
  assert.equal((await readLaunchTradeRecord(store, "mainnet", SIGNATURE)).state, "SENT");
  await failLaunchTrade({ store, now }, "mainnet", SIGNATURE, "The network refused the trade.");
  rows = (await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET })).actions;
  assert.equal(rows[0].outcome, "FAILED");
  assert.equal((await readLaunchTradeRecord(store, "mainnet", SIGNATURE)).state, "FAILED");
  assert.equal((await failLaunchTrade({ store, now }, "mainnet", SIGNATURE, "again")).record.reason, "The network refused the trade.", "a settled trade is not settled again");
  /* A second begin of a settled trade never puts its row back in flight. */
  await beginLaunchTrade({ store, now }, start());
  assert.equal((await listSolanaWalletActions(store, { network: "mainnet", wallet: WALLET })).actions[0].outcome, "FAILED");
});

test("an origin says a launch whole or not at all: its token and venue, never a plan; a Spot origin names neither", () => {
  assert.equal(SolanaActionOriginSchema.safeParse({ surface: "LAUNCH", side: "BUY", token: TOKEN, venue: "pool" }).success, true);
  assert.equal(SolanaActionOriginSchema.safeParse({ surface: "LAUNCH", side: "BUY", token: TOKEN }).success, false);
  assert.equal(SolanaActionOriginSchema.safeParse({ surface: "LAUNCH", side: "BUY", token: TOKEN, venue: "curve", rule: { ruleId: "r".repeat(12), occurrenceId: "o".repeat(12) } }).success, false);
  assert.equal(SolanaActionOriginSchema.safeParse({ surface: "SPOT", side: "SELL", token: TOKEN, venue: "curve" }).success, false);
  assert.equal(SolanaActionOriginSchema.safeParse({ surface: "SPOT", side: "SELL" }).success, true);
  assert.equal(isLaunchOrigin({ surface: "LAUNCH", side: "BUY", token: TOKEN, venue: "curve" }), true);
  assert.equal(isLaunchOrigin({ surface: "SPOT", side: "BUY" }), false);
});

const doneRow = (over = {}) => ({
  schema: "ryntra.solana.wallet-action",
  schemaVersion: "1.0.0",
  version: 2,
  network: "mainnet",
  wallet: WALLET,
  actionId: SIGNATURE,
  lane: "SWAP",
  outcome: "DONE",
  out: { mint: USDC, amountRaw: "5000000", decimals: 6, symbol: "USDC" },
  in: { mint: TOKEN, amountRaw: "989076589761", decimals: 6, symbol: "WICK" },
  destination: null,
  signature: SIGNATURE,
  receiptHash: `0x${"a".repeat(64)}`,
  sourceTx: null,
  destinationTx: null,
  fee: { collected: true, basisPoints: 100, amountRaw: "50066", decimals: 6, symbol: "USDC", usd: null, asset: USDC, providerRaw: "24031", ryntraRaw: "26035", state: "COLLECTED", note: null },
  origin: { surface: "LAUNCH", side: "BUY", token: TOKEN, venue: "curve" },
  providerRef: null,
  statedUsd: null,
  startedAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:05.000Z",
  ...over,
});

test("History reads a launch's trade under Launch; it asks the launch's route for the receipt and the check", () => {
  const row = doneRow();
  assert.equal(historyPage(row), "LAUNCH");
  assert.deepEqual(filterHistory([row, doneRow({ actionId: "x".repeat(64), origin: null })], "LAUNCH").map((entry) => entry.actionId), [SIGNATURE]);
  assert.equal(receiptFetchable(row), true);
  assert.deepEqual(launchReceiptRequest(row, WALLET), { path: `/api/v1/launch/${TOKEN}/trade/receipt`, body: { wallet: WALLET, signature: SIGNATURE }, headers: { "X-Ryntra-API": "1" } });
  assert.equal(launchReceiptRequest(doneRow({ origin: null }), WALLET), null, "a swap asks its own recovery");
});

test("/stats: a launch's trade is the product Launch through Meteora — the fee the person paid, Ryntra's part of it, attributed by its receipt and Ryntra's mark", () => {
  const source = { actions: [doneRow()], orders: new Map(), stockMints: new Set(), internalWallets: new Set(), names: {}, chain: { signatures: new Set(), readAt: "2026-10-08T11:00:00.000Z", complete: true } };
  const [record] = projectOperations(source);
  assert.equal(record.product, "LAUNCH");
  assert.equal(record.provider, "METEORA");
  assert.equal(record.side, "BUY");
  assert.equal(record.verification, "VERIFIED", "the receipt was read from the swap event, and Ryntra's part was in the transaction");
  /* The statistics count Ryntra's fees: of the curve's whole fee, Ryntra's part — never the creator's or Meteora's. */
  assert.equal(record.fee.gross, "0.026035");
  assert.equal(record.fee.ryntra, "0.026035");
  assert.equal(record.fee.valueUsd, 0.026035, "a USDC fee at par");
  assert.equal(record.fee.ryntraUsd, 0.026035);
  assert.equal(record.fee.basisPoints, 52, "Ryntra's part of the curve's 1 %");
  assert.equal(record.usd, 5, "the USDC leg at par");
  assert.equal(projectOperations({ ...source, actions: [doneRow({ receiptHash: null })] })[0].verification, "PENDING");
  assert.equal(projectOperations({ ...source, actions: [doneRow({ fee: { ...doneRow().fee, ryntraRaw: "0" } })] })[0].verification, "NOT_ATTRIBUTABLE", "a trade with no Ryntra mark is not Ryntra's on chain");
  const summary = summarizeOperations(projectOperations(source), { product: "LAUNCH", range: "all", now: new Date("2026-10-09T00:00:00.000Z") });
  assert.equal(summary.byProduct.LAUNCH.operations, 1);
});

test("History's export writes Ryntra's fee: on a launch's trade Ryntra's part, never the curve's whole fee", () => {
  const csv = historyToCsv([doneRow(), doneRow({ actionId: "x".repeat(64), origin: null, fee: { ...doneRow().fee, amountRaw: "10000", ryntraRaw: "8000" } })]).trim().split("\n");
  assert.match(csv[1], /"0\.026035","USDC"$/, "the launch's row: Ryntra's part");
  assert.match(csv[2], /"0\.01","USDC"$/, "a swap's row: Ryntra's fee as charged");
});
