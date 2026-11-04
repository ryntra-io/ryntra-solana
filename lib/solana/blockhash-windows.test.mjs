import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCKHASH_LIFE_MS,
  BLOCKHASH_SUBMIT_MARGIN_MS,
  MAX_SIGNABLE_WINDOW_MS,
  MIN_WALLET_WINDOW_MS,
  assessBlockhashLife,
  mayOpenWallet,
  signableWindowClosed,
  signableWindowMs,
} from "./blockhash-life.ts";
import { TICKET_TTL_MS } from "../liquidity/studio/ticket.ts";
import { JUPITER_ORDER_REVIEW_WINDOW_MS, MINIMUM_HUMAN_REVIEW_WINDOW_MS } from "./quotes.ts";
import { freshOrderNoWorse } from "./swap-client-safety.ts";

/**
 * AG-1 (2026-10-17): mainnet slots are 200 ms and bytes live ~150 blocks ≈ 30 s.
 *
 * Two promises are held here, and they pull in opposite directions on purpose:
 *
 * 1. **No window a person may still sign in is longer than the bytes' life.**
 *    Every place in the web Solana that hands a wallet bytes either measures
 *    their life on the chain (`blockhash-life.ts`) or rebuilds them in the
 *    moment of signing (`sign-fresh.ts`, the cards' own fresh-bytes paths).
 * 2. **No "may still land" clock gets shorter.** "Will not land" is the
 *    chain's word — the block height or `isBlockhashValid` from an
 *    independent RPC. The 120, 150 and 300-second clocks are fallbacks; were
 *    they shortened to 30 s, live bytes could be declared dead and sent twice.
 */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the bytes' life and every signable window agree: 150 blocks × 200 ms, less a margin", () => {
  assert.equal(BLOCKHASH_LIFE_MS, 30_000);
  assert.equal(MAX_SIGNABLE_WINDOW_MS, BLOCKHASH_LIFE_MS - BLOCKHASH_SUBMIT_MARGIN_MS);
  assert.ok(MIN_WALLET_WINDOW_MS < MAX_SIGNABLE_WINDOW_MS);
  assert.ok(TICKET_TTL_MS <= BLOCKHASH_LIFE_MS, "the Pools ticket outlives its bytes");
});

test("the Review's reading floor is not lowered to fit the bytes — fresh bytes are fetched instead", () => {
  assert.ok(JUPITER_ORDER_REVIEW_WINDOW_MS >= MINIMUM_HUMAN_REVIEW_WINDOW_MS);
  assert.equal(MINIMUM_HUMAN_REVIEW_WINDOW_MS, 30_000);
});

/** Every browser file that hands a wallet Solana bytes, and how it keeps them alive. */
const SIGNING_SITES = [
  /* SOL-S1: the swap card decides through `swap-press.ts` — the press on aged bytes, the wallet that answered late. */
  ["app/solana/workspace/trade/swap-card.tsx", /pressRoute\(/, /walletAnswerRoute\(/, /refreshReviewedBytes/],
  ["lib/solana/swap-press.ts", /MIN_WALLET_WINDOW_MS/, /signableWindowClosed\(/],
  ["app/solana/workspace/spot/use-spot-ticket.ts", /mayOpenWallet\(/, /signableWindowClosed\(/, /refreshReviewedBytes/],
  ["app/app/markets/pools/add-liquidity.tsx", /mayOpenWallet\(/, /REVIEW_AGED/],
  ["app/app/markets/pools/manage-position.tsx", /mayOpenWallet\(/, /REVIEW_AGED/],
  ["app/app/markets/pools/liquidity-api.ts", /signableWindowClosed\(/],
  /* B6: Phoenix collateral, the pools' carrier for one transaction. */
  ["app/solana/workspace/futures/collateral-panel.tsx", /mayOpenWallet\(/, /REVIEW_AGED/],
  ["app/solana/workspace/futures/collateral-api.ts", /signableWindowClosed\(/],
  /* B6b: an order's Review is built again when its bytes aged on the Review or in the wallet. */
  ["app/solana/workspace/futures/order-panel.tsx", /mayOpenWallet\(/, /REVIEW_AGED/],
  ["app/solana/workspace/futures/orders-api.ts", /signableWindowClosed\(/],
  ["app/app/launch/new/launch-flow.tsx", /signFreshBytes\(/],
  ["app/app/launch/[mint]/trade-panel.tsx", /signFreshBytes\(/],
  ["app/app/launch/[mint]/pool-panel.tsx", /signFreshBytes\(/],
  ["app/app/launch/mine/creator-cabinet.tsx", /signFreshBytes\(/],
  /* SOL-L5: a deposit into an early-access vault and every action after it. */
  ["app/app/launch/[mint]/early-access.tsx", /signFreshBytes\(/],
  /* SOL-L2b: the creator's rule, depth steps and payout, built again when they aged in the wallet. */
  ["app/app/launch/mine/split-block.tsx", /signFreshBytes\(/],
  /* SOL-L10: «Зібрати» and «Вивести» of the transfer fee — built again when the wallet answers past the bytes' life. */
  ["app/app/launch/mine/transfer-fee-actions.tsx", /signFreshBytes\(/],
  /* DROP-2: a recipient's own claim of their row — built again when the wallet answers past the bytes' life. */
  ["app/app/launch/[mint]/distribution-panel.tsx", /signFreshBytes\(/],
  /* CITY-156: the payer page is a window of the city; its one payment is built and signed in `city/lib/pay/flow.ts`. */
  ["city/lib/pay/flow.ts", /signFreshBytes[<(]/, /signableMsOf: \(built\) => built\.signableMs/],
  /* SOL-4: the treasury signs the reviewed bytes while they live, built again when they aged on the Review or in the wallet. */
  ["app/app/treasury/treasury-flow.tsx", /signFreshBytes\(/, /signableMsOf: \(data\) => \(data === current\.build \? data\.signableMs - \(Date\.now\(\) - current\.receivedAt\)/],
  /* SOL-7: the spending limits sign the reviewed bytes while they live, built again when they aged on the Review or in the wallet. */
  ["app/app/allowances/allowances-flow.tsx", /signFreshBytes\(/, /signableMsOf: \(data\) => \(data === current\.build \? data\.signableMs - \(Date\.now\(\) - current\.receivedAt\)/],
  /* Earn: a deposit into a lending market and a withdrawal back, built on the provider's own blockhash. */
  ["app/solana/workspace/earn/earn-surface.tsx", /mayOpenWallet\(/, /REVIEW_AGED/],
  ["app/solana/workspace/earn/earn-api.ts", /signableWindowClosed\(/],
  ["app/solana/workspace/spot/spot-ticket.tsx", /mayOpenWallet\(/, /REVIEW_AGED/],
  ["app/solana/workspace/spot/limit-api.ts", /signableWindowClosed\(/, /signFreshBytes/],
  ["app/solana/workspace/bridge/cross-swap-engine.tsx", /mayOpenWallet\(/, /signableWindowClosed\(/],
  ["app/solana/workspace/bridge/bridge-card.tsx", /mayOpenWallet\(/, /signableWindowClosed\(/, /signFreshBytes/],
  /* «Надіслати» rebuilds the whole Review at the press — the model the others follow. */
  ["app/solana/workspace/send/send-card.tsx", /rebuilt at the moment the person starts the final action/],
];

test("every place in the web Solana that opens a wallet keeps the bytes inside their life", () => {
  for (const [path, ...rules] of SIGNING_SITES) {
    const source = read(path);
    for (const rule of rules) assert.match(source, rule, `${path} no longer guards its bytes' life (${rule})`);
  }
});

test("no other browser file opens a wallet on Solana bytes unguarded", () => {
  /* A new signing site joins the list above, or this fails. Other networks and the phone keep their own lines. */
  const root = new URL("../../", import.meta.url);
  const skip = /^(app\/arc|app\/stellar|lib\/arc|lib\/stellar|apps\/|node_modules)/;
  const found = [];
  for (const dir of ["app", "lib"]) {
    for (const entry of readdirSync(new URL(dir, root), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(tsx?|mts)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      const path = `${relative(fileURLToPath(root), join(entry.parentPath ?? entry.path, entry.name)).replaceAll("\\", "/")}`;
      if (skip.test(path) || path === "lib/solana/wallet.client.ts") continue;
      const source = readFileSync(new URL(path, root), "utf8");
      if (/from "@\/lib\/solana\/wallet\.client"/.test(source) && /\bsignTransactions?\(\{/.test(source)) found.push(path);
    }
  }
  const known = new Set(SIGNING_SITES.map(([path]) => path));
  const unguarded = found.filter((path) => !known.has(path));
  assert.deepEqual(unguarded, [], `these files open a wallet on Solana bytes without a guard of their bytes' life: ${unguarded.join(", ")}`);
  assert.ok(found.length >= 10, "the scan found too few signing sites to be trusted");
});

/** Every server that builds bytes for a wallet, and the window it puts on them. */
const BUILDERS = [
  ["app/api/solana/swap/order/route.ts", /readSignableWindowMs\(/],
  ["app/api/solana/cross-swap/plan/route.ts", /readSignableWindowMs\(/],
  ["lib/liquidity/studio/actions.ts", /readBlockhashLife\(/],
  ["lib/launch/flow.server.ts", /readBuildWindows\(/],
  ["lib/launch/creator.server.ts", /readBuildWindows\(/],
  ["lib/launch/holder.server.ts", /readBuildWindows\(/],
  ["lib/launch/trade.server.ts", /readBuildWindows\(/],
  /* SOL-L5: «Розширений»'s config, Launch Boost's budget and payout, early access's creation, deposits and actions. */
  ["lib/launch/advanced.server.ts", /readBuildWindows\(/],
  ["lib/launch/boost.server.ts", /readBuildWindows\(/],
  ["lib/launch/early-access.server.ts", /readBuildWindows\(/],
  ["lib/launch/creator-split.server.ts", /readBuildWindows\(/],
  ["lib/pay/transaction.ts", /readBuildWindows\(/],
  ["lib/solana/treasury/service.server.ts", /readBuildWindows\(/],
  ["lib/solana/allowances/service.server.ts", /readBuildWindows\(/],
  ["lib/phoenix/collateral-actions.ts", /readBlockhashLife\(/],
  ["lib/phoenix/orders-actions.ts", /readBlockhashLife\(/],
  ["lib/solana/limits/review.server.ts", /readFreshBuildWindowMs\(/],
  /* Earn's bytes come from the provider without the height they die at, so the window is one life at the
     chain's measured slot speed. */
  ["lib/earn/service.server.ts", /readFreshBuildWindowMs\(/],
  ["app/api/solana/limits/cancel/route.ts", /readFreshBuildWindowMs\(/],
];

test("every builder measures its bytes' window on the chain instead of a fixed clock", () => {
  for (const [path, rule] of BUILDERS) assert.match(read(path), rule, `${path} sets its window without the chain`);
  /* The old fixed windows are gone from the places that used them as the signing window. */
  assert.doesNotMatch(read("lib/liquidity/studio/actions.ts"), /now\(\) \+ 60_000/);
  assert.doesNotMatch(read("app/app/markets/pools/add-liquidity.tsx"), /55_000/);
  assert.doesNotMatch(read("app/app/markets/pools/manage-position.tsx"), /55_000/);
  assert.doesNotMatch(read("lib/pay/transaction.ts"), /now\.getTime\(\) \+ PAYMENT_INTENT_TTL_MS/);
  /* A server holds bytes as long as they live and refuses only dead ones; the page signs inside the shorter window. */
  for (const path of ["lib/launch/flow.server.ts", "lib/launch/creator.server.ts", "lib/launch/holder.server.ts", "lib/launch/trade.server.ts", "lib/pay/transaction.ts"]) {
    assert.match(read(path), /windows\.lifeMs/, `${path} no longer holds its bytes for their life`);
  }
  assert.doesNotMatch(read("lib/launch/flow.server.ts"), /now\.getTime\(\) \+ BUILD_TTL_MS\)/);
  assert.doesNotMatch(read("app/api/solana/bridge/plan/route.ts"), /builtAt\) \+ 60_000/);
});

test("the bridge Review is rebuilt while a wallet still has its window, never at the bytes' last second", () => {
  const source = read("app/solana/workspace/bridge/bridge-card.tsx");
  assert.match(source, /const REVIEW_REFRESH_MS = MAX_SIGNABLE_WINDOW_MS - MIN_WALLET_WINDOW_MS;/);
});

/** "May still land": the clocks that must never shrink below what they were on 2026-10-17. */
const MAY_STILL_LAND = [
  ["lib/solana/send-pending.client.ts", /export const BLOCKHASH_WINDOW_MS = (\d[\d_]*);/, 120_000],
  ["app/solana/workspace/trade/swap-card.tsx", /const RECOVERY_DEADLINE_MS = (\d[\d_]*);/, 150_000],
  ["app/solana/workspace/spot/use-spot-ticket.ts", /const RECOVERY_DEADLINE_MS = (\d[\d_]*);/, 150_000],
  ["app/solana/workspace/send/send-card.tsx", /const RESUME_DEADLINE_MS = (\d[\d_]*);/, 150_000],
  ["app/app/markets/pools/liquidity-api.ts", /const FOLLOW_MS = (\d[\d_]*);/, 120_000],
];

test("no 'may still land' clock is shortened — 'will not land' is the chain's word", () => {
  for (const [path, pattern, floor] of MAY_STILL_LAND) {
    const match = read(path).match(pattern);
    assert.ok(match, `${path}: the fallback clock is gone`);
    const value = Number(match[1].replaceAll("_", ""));
    assert.ok(value >= floor, `${path}: ${value} ms is shorter than the ${floor} ms fallback; live bytes could be declared dead and sent twice`);
  }
  /* The cancel of an issued swap Review asks the chain, not a clock. */
  assert.match(read("app/api/solana/swap/cancel-review/route.ts"), /isBlockhashValid/);
  /* SOL-S1: an order no longer declares an unsigned Review dead by a clock (the guard's 300 s fallback is gone) — it
     replaces it, and only a signature the server never claimed is replaced: the claim is the last step before any
     send, and a replaced Review's claim is refused before it. */
  const lock = read("lib/solana/swap-owner-lock.ts");
  assert.match(lock, /return record\.state === "REVIEW_ISSUED" && record\.signature === null;/);
  assert.match(lock, /if \(record\.requestId !== args\.requestId\) \{\s*return \{ ok: false, code: "OWNER_SWAP_LOCK_MISMATCH"/);
  const guard = read("lib/core/solana-swap/guard.ts");
  const signed = guard.slice(guard.indexOf("export const SOLANA_SWAP_SIGNED_GUARD"));
  assert.match(signed, /ownerLockClaim,\s*\] as const/, "the claim is the last guard before the send");
});

/* ---------------------------------------------------------------- stand: a stand clock and block heights */

const TIP = { blockHeight: 436_048_735n, absoluteSlot: 458_013_351n };

for (const seconds of [25, 30, 35, 40, 45]) {
  test(`stand: a Review signed ${seconds} s after its bytes were built is rebuilt, never sent`, () => {
    /* Bytes built with a fresh blockhash: 150 blocks left at 200 ms. */
    const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 150n, tip: TIP, msPerSlot: 200 });
    const signableMs = signableWindowMs(life);
    const receivedAtMs = 1_000_000;
    const pressAt = receivedAtMs + seconds * 1_000;
    assert.equal(mayOpenWallet({ receivedAtMs, signableMs, nowMs: pressAt }), false, "the wallet must not open on dying bytes");
    assert.equal(signableWindowClosed({ receivedAtMs, signableMs, nowMs: pressAt }), true);
    /* The chain agrees: by then the block height has passed, or nearly. */
    const later = assessBlockhashLife({
      lastValidBlockHeight: TIP.blockHeight + 150n,
      tip: { blockHeight: TIP.blockHeight + BigInt(seconds * 5), absoluteSlot: TIP.absoluteSlot + BigInt(seconds * 5) },
      msPerSlot: 200,
    });
    assert.ok(later.state === "EXPIRED" || signableWindowMs(later) < MIN_WALLET_WINDOW_MS);
  });
}

test("stand: a Review signed within its window opens the wallet on the same bytes", () => {
  const life = assessBlockhashLife({ lastValidBlockHeight: TIP.blockHeight + 150n, tip: TIP, msPerSlot: 200 });
  assert.equal(mayOpenWallet({ receivedAtMs: 0, signableMs: signableWindowMs(life), nowMs: 8_000 }), true);
});

const REVIEWED = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmountRaw: "1000000000",
  minReceivedRaw: "100000000",
  totalFeeBasisPoints: 20,
  platformFee: { basisPoints: 20 },
  signatureFeeLamports: "5000",
  priorityFeeLamports: "10000",
  rentFeeLamports: "0",
};

test("fresh swap bytes open the wallet only when the minimum and every fee are no worse than the Review", () => {
  assert.equal(freshOrderNoWorse(REVIEWED, REVIEWED), true);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, minReceivedRaw: "100000001" }), true);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, minReceivedRaw: "99999999" }), false);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, totalFeeBasisPoints: 21 }), false);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, platformFee: { basisPoints: 25 } }), false);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, priorityFeeLamports: "10001" }), false);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, signatureFeeLamports: "10000" }), false);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, rentFeeLamports: "2039280" }), false);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, inAmountRaw: "2000000000" }), false);
  assert.equal(freshOrderNoWorse(REVIEWED, { ...REVIEWED, minReceivedRaw: "not-a-number" }), false);
});
