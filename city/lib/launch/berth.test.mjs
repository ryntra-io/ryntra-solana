import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LaunchClaimBuildRequestSchema,
  LaunchClaimBuildResponseSchema,
  LaunchClaimReviewResponseSchema,
  LaunchClaimSubmitRequestSchema,
  LaunchClaimSubmitResponseSchema,
  LaunchCreatorCabinetResponseSchema,
} from "../../../lib/api/v1/contract.ts";
import {
  CHECK_DAYS,
  cardsOf,
  claimReady,
  dayCount,
  earnedAcross,
  graduationOf,
  httpBerthEngine,
  pickLaunch,
  pocketsShown,
  proofUrl,
  streamRates,
  streamsOf,
  totalsOf,
  towerFiguresOf,
  withJustLanded,
} from "./berth.ts";
import { BUILD_UNEXPECTED, CLAIM_CLOSED, WALLET_REFUSED, claimBuildMatches, receivedOf, runClaim } from "./berth-flow.ts";
import { stubBerthEngine } from "./berth-stub.ts";
import { amountText, claimFailureText, moneyText, moveText, priceText, shareText } from "./berth-words.ts";
import { API_HEADERS } from "./engine.ts";
import { STUB_CREATOR, STUB_PRESETS, STUB_WALLET, stubAddress, stubEngine, stubWallet } from "./stub.ts";

/* «Мій причал» (L4 · CITY-141): the creator's three streams by $1,000 from the engine's own terms and counters, the day
   counter, the two cards, and «Забрати» through the engine's existing claim — nothing new on the server, no money path
   of the city's own. */

const NOW = Date.parse("2026-10-31T12:00:00Z");
const DAY = 86_400_000;
const [CLASSIC, PROTECTED] = STUB_PRESETS;
const MOTH = stubAddress("MOTH");
const SPARK = stubAddress("SPARK");
const USDC = { mint: stubAddress("usdc"), symbol: "USDC", decimals: 6, dollar: true };
const signer = (options) => stubWallet(options).signer({ wallet: STUB_WALLET, address: STUB_CREATOR });

function stand(now = () => NOW) {
  const engine = stubEngine({ now });
  return stubBerthEngine({ engine, now });
}

const source = (earned, unclaimed = "0") => ({ earnedRaw: earned, unclaimedRaw: unclaimed });
function row(over = {}) {
  return {
    token: MOTH,
    name: "Moth",
    symbol: "MOTH",
    image: null,
    preset: "classic",
    creator: STUB_CREATOR,
    role: "creator",
    launchedAt: new Date(NOW - 12 * DAY).toISOString(),
    pair: USDC,
    progressBps: 10_000,
    migrated: true,
    earnings: {
      role: { curve: source("412800000"), graduation: source("160000000", "160000000"), lp: source("184000000", "184000000"), surplus: source("0"), earnedRaw: "756800000", unclaimedRaw: "344000000" },
      mine: { shareBps: 10_000, earnedRaw: "756800000", unclaimedRaw: "344000000", claimedRaw: "412800000" },
    },
    feeSharing: null,
    claimable: true,
    ...over,
  };
}

test("the three streams by $1,000, from the preset the engine serves: curve $3.20, exit $8, pool $1 — 32 %, 40 %, half the position", () => {
  for (const preset of [CLASSIC, PROTECTED]) {
    const rates = streamRates(preset);
    assert.deepEqual(rates.curve, { per1k: 3.2, shareBps: 3200 }, preset.id);
    assert.deepEqual(rates.exit, { per1k: 8, shareBps: 4000 }, preset.id);
    assert.deepEqual(rates.pool, { per1k: 1, shareBps: 5000 }, preset.id);
  }
  // An older engine without the split: the exit from its graduation fee; the curve and the pool are not guessed.
  const { terms: _terms, ...bare } = CLASSIC;
  const rates = streamRates(bare);
  assert.equal(rates.curve.per1k, null);
  assert.equal(rates.exit.per1k, 8);
  assert.equal(rates.pool.per1k, null);
  assert.deepEqual(streamRates(null).exit, { per1k: null, shareBps: null });
});

test("each stream's earnings are the programs' counters: the exit is the fee taken plus the surplus; a shared role takes the wallet's part", () => {
  const [curve, exit, pool] = streamsOf(row(), CLASSIC);
  assert.deepEqual([curve.id, exit.id, pool.id], ["curve", "exit", "pool"]);
  assert.deepEqual([curve.earnedRaw, exit.earnedRaw, pool.earnedRaw], ["412800000", "160000000", "184000000"]);
  assert.deepEqual([curve.unclaimedRaw, exit.unclaimedRaw, pool.unclaimedRaw], ["0", "160000000", "184000000"]);
  assert.deepEqual([curve.state, exit.state, pool.state], ["done", "done", "live"]);

  const shared = row();
  shared.earnings.mine.shareBps = 7000;
  shared.earnings.role.surplus = source("10000001", "0");
  const [, sharedExit] = streamsOf(shared, CLASSIC);
  assert.equal(sharedExit.earnedRaw, String(Math.floor(((160000000 + 10000001) * 7000) / 10000)));

  // On the curve: the exit and the pool are ahead; the chain not read is never a zero.
  const young = streamsOf(row({ migrated: false, progressBps: 4215, earnings: null }), CLASSIC);
  assert.deepEqual(young.map((s) => s.state), ["live", "ahead", "ahead"]);
  assert.deepEqual(young.map((s) => s.earnedRaw), [null, null, null]);
  assert.equal(totalsOf(row({ earnings: null })), null);
  assert.deepEqual(totalsOf(row()), { earnedRaw: "756800000", claimedRaw: "412800000", unclaimedRaw: "344000000" });
  assert.deepEqual([...earnedAcross([row(), row({ token: SPARK })])], [[USDC.mint, "1513600000"]]);
});

test("the berth opens on the launch asked for, else the most waiting for «Забрати», else the newest", () => {
  const rows = [row({ token: SPARK, earnings: { ...row().earnings, mine: { ...row().earnings.mine, unclaimedRaw: "18640000" } } }), row()];
  assert.equal(pickLaunch(rows, SPARK), SPARK);
  assert.equal(pickLaunch(rows, null), MOTH);
  assert.equal(pickLaunch(rows, "unknown"), MOTH);
  assert.equal(pickLaunch(rows.map((r) => ({ ...r, claimable: false })), null), SPARK);
  assert.equal(pickLaunch([], null), null);
});

test("the day counter: whole days as the docks count them, the ring to day 90, checks 7/30/90 as the feed read them", () => {
  const twelve = dayCount(new Date(NOW - 12.5 * DAY).toISOString(), NOW, ["alive", "young", "young"]);
  assert.equal(twelve.days, 12);
  assert.equal(twelve.next, 30);
  assert.ok(Math.abs(twelve.fill - 12.5 / 90) < 1e-9);
  assert.deepEqual(twelve.checks.map((c) => [c.days, c.state]), [[7, "alive"], [30, "young"], [90, "young"]]);
  assert.deepEqual([...CHECK_DAYS], [7, 30, 90]);
  const old = dayCount(new Date(NOW - 120 * DAY).toISOString(), NOW, null);
  assert.equal(old.next, null);
  assert.equal(old.fill, 1);
  assert.deepEqual(old.checks.map((c) => c.state), ["unread", "unread", "unread"]);
  assert.equal(dayCount("not a date", NOW, null), null);
  const first = dayCount(new Date(NOW - 8 * 60_000 - 3 * 3600_000).toISOString(), NOW, null);
  assert.deepEqual([first.days, first.hours, first.minutes], [0, 3, 188], "the first day reads in hours, then minutes");
});

test("the two cards: «Born» at the launch on its token, «Graduated» at the chain's mark of the move on its transaction", () => {
  const mark = graduationOf({ chart: { points: [], markers: [{ t: 1_761_000_000, kind: "creator-buy", signature: "a".repeat(88) }, { t: 1_761_100_000, kind: "graduated", signature: "b".repeat(88) }] } });
  assert.deepEqual(mark, { at: 1_761_100_000_000, signature: "b".repeat(88) });
  const [born, graduated] = cardsOf(row(), mark);
  assert.deepEqual(born, { id: "born", at: NOW - 12 * DAY, reached: true, pct: null, proof: { kind: "token", id: MOTH } });
  assert.deepEqual(graduated, { id: "graduated", at: 1_761_100_000_000, reached: true, pct: null, proof: { kind: "tx", id: "b".repeat(88) } });
  const [, ahead] = cardsOf(row({ migrated: false, progressBps: 4215 }), null);
  assert.deepEqual(ahead, { id: "graduated", at: null, reached: false, pct: 42, proof: null });
  assert.equal(graduationOf(null), null);
  assert.equal(proofUrl({ kind: "tx", id: "sig" }, "solana:devnet"), "https://solscan.io/tx/sig?cluster=devnet");
  assert.equal(proofUrl({ kind: "token", id: MOTH }, "solana:mainnet"), `https://solscan.io/token/${MOTH}`);
});

test("«Забрати» is pressed only on the Review's word: never when the pool position went to another wallet, never with nothing to take", () => {
  const review = { blockedBy: null, transactions: [{ index: 1, sources: ["lp"], payout: false }], expectedRaw: "344000000", networkCostLamports: "10000", pockets: [] };
  assert.deepEqual(claimReady(row(), review), { can: true, expectedRaw: "344000000", networkLamports: "10000", transactions: 1 });
  assert.deepEqual(claimReady(row(), { ...review, blockedBy: "POSITION_MOVED" }), { can: false, why: "moved" });
  assert.deepEqual(claimReady(row(), { ...review, transactions: [], expectedRaw: "0" }), { can: false, why: "nothing" });
  // Without a Review the cabinet's own flag decides; the build says the rest.
  assert.deepEqual(claimReady(row(), null), { can: true, expectedRaw: "344000000", networkLamports: null, transactions: 1 });
  assert.deepEqual(claimReady(row({ claimable: false }), null), { can: false, why: "nothing" });
  assert.deepEqual(claimReady(row({ earnings: null }), null), { can: false, why: "unread" });
  assert.deepEqual(
    pocketsShown({ pockets: [{ pocket: "curve", state: "EMPTY" }, { pocket: "leftover", state: "NOT_YOURS" }, { pocket: "transferFee", state: "NONE" }] }).map((p) => p.pocket),
    ["curve"],
  );
});

test("the stand-in answers in the v1 contract's own shapes: the cabinet, the Review, the build and the submit", async () => {
  const berth = stand();
  const cabinet = await berth.cabinet(STUB_CREATOR);
  assert.ok(cabinet.ok);
  LaunchCreatorCabinetResponseSchema.parse(cabinet.data);
  assert.deepEqual(cabinet.data.launches.map((l) => l.symbol).sort(), ["MOTH", "SPARK"]);
  const moth = cabinet.data.launches.find((l) => l.symbol === "MOTH");
  assert.equal(moth.earnings.mine.unclaimedRaw, "344000000");
  assert.equal(cabinet.data.receipts.length, 1, "Moth's creator already took the curve's share once");

  const review = await berth.review(MOTH, STUB_CREATOR);
  assert.ok(review.ok);
  LaunchClaimReviewResponseSchema.parse(review.data);
  assert.equal(review.data.expectedRaw, "344000000");
  assert.equal(review.data.claimsV2, false);

  const body = { wallet: STUB_CREATOR };
  LaunchClaimBuildRequestSchema.parse(body);
  const built = await berth.build(MOTH, body);
  assert.ok(built.ok);
  LaunchClaimBuildResponseSchema.parse(built.data);
  const submit = { buildId: built.data.buildId, wallet: STUB_CREATOR, signedWireBase64: built.data.unsignedWireBase64 };
  LaunchClaimSubmitRequestSchema.parse(submit);
  const sent = await berth.submit(MOTH, submit);
  assert.ok(sent.ok);
  LaunchClaimSubmitResponseSchema.parse(sent.data);
  assert.equal(receivedOf(sent.data), "344000000");

  // Another wallet has no launches; a stranger's mint is not found.
  const other = await berth.cabinet(stubAddress("someone"));
  assert.ok(other.ok);
  assert.equal(other.data.launches.length, 0);
  LaunchCreatorCabinetResponseSchema.parse(other.data);
  assert.equal((await berth.review(MOTH, stubAddress("someone"))).code, "LAUNCH_NOT_FOUND");
});

test("«Забрати» end to end on the stand: one build, one signature, sent once — the counters move and a receipt is added", async () => {
  const berth = stand();
  const phases = [];
  const result = await runClaim({ engine: berth, signer: signer(), token: MOTH, pairMint: (await berth.cabinet(STUB_CREATOR)).data.launches[0].pair.mint, network: "solana:devnet", open: true, onPhase: (p) => phases.push(p.step) });
  assert.equal(result.step, "done");
  assert.equal(result.done.state, "CONFIRMED");
  assert.equal(result.done.receivedRaw, "344000000");
  assert.equal(result.done.signatures.length, 1);
  assert.deepEqual(phases, ["build", "sign", "send", "done"]);
  assert.deepEqual(berth.calls.filter((c) => c === "build" || c === "submit"), ["build", "submit"]);

  const after = await berth.cabinet(STUB_CREATOR);
  const moth = after.data.launches.find((l) => l.token === MOTH);
  assert.equal(moth.earnings.mine.unclaimedRaw, "0");
  assert.equal(moth.claimable, false);
  assert.equal(after.data.receipts.length, 2);
  assert.equal(after.data.receipts[0].receivedRaw, "344000000", "the newest receipt first");

  // Nothing left: the engine says so, and nothing reaches the wallet.
  let asked = false;
  const again = await runClaim({ engine: berth, signer: { wallet: STUB_WALLET, address: STUB_CREATOR, sign: async (w) => ((asked = true), { ok: true, signed: w }) }, token: MOTH, pairMint: moth.pair.mint, network: "solana:devnet", open: true, onPhase: () => {} });
  assert.equal(again.step, "failed");
  assert.equal(again.failure.code, "LAUNCH_NOTHING_TO_CLAIM");
  assert.equal(asked, false);
});

test("the city's own refusals: closed here, another network or currency never reaches the wallet, a wallet that says no", async () => {
  const pairMint = (await stand().cabinet(STUB_CREATOR)).data.launches[0].pair.mint;
  const closed = await runClaim({ engine: stand(), signer: signer(), token: MOTH, pairMint, network: "solana:devnet", open: false, onPhase: () => {} });
  assert.equal(closed.failure.code, CLAIM_CLOSED);

  let asked = false;
  const watching = { wallet: STUB_WALLET, address: STUB_CREATOR, sign: async (w) => ((asked = true), { ok: true, signed: w }) };
  const otherNet = await runClaim({ engine: stand(), signer: watching, token: MOTH, pairMint, network: "solana:mainnet", open: true, onPhase: () => {} });
  assert.equal(otherNet.failure.code, BUILD_UNEXPECTED);
  const otherPair = await runClaim({ engine: stand(), signer: watching, token: MOTH, pairMint: stubAddress("other"), network: "solana:devnet", open: true, onPhase: () => {} });
  assert.equal(otherPair.failure.code, BUILD_UNEXPECTED);
  assert.equal(asked, false, "bytes that are not this claim are never put before the wallet");

  const refused = await runClaim({ engine: stand(), signer: signer({ refuse: true }), token: MOTH, pairMint, network: "solana:devnet", open: true, onPhase: () => {} });
  assert.equal(refused.failure.code, WALLET_REFUSED);

  const built = { buildId: "c".repeat(32), network: "solana:devnet", unsignedWireBase64: ["AA=="], sources: ["lp"], expectedRaw: "1", networkCostLamports: null, pair: USDC, expiresAt: new Date(NOW).toISOString() };
  assert.equal(claimBuildMatches(built, { network: "solana:devnet", pairMint: USDC.mint }), true);
  assert.equal(claimBuildMatches({ ...built, expectedRaw: "0" }, { network: "solana:devnet", pairMint: USDC.mint }), false);
  assert.equal(claimBuildMatches({ ...built, unsignedWireBase64: [] }, { network: "solana:devnet", pairMint: USDC.mint }), false);
});

test("over HTTP: only the engine's existing reads and its creator claim — no route of the city's own", async () => {
  const asked = [];
  const fetcher = async (path, init) => {
    asked.push([init?.method ?? "GET", path, init?.headers?.["X-Ryntra-API-Version"]]);
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  };
  const http = httpBerthEngine(fetcher);
  await http.cabinet(STUB_CREATOR);
  await http.market(MOTH);
  await http.review(MOTH, STUB_CREATOR);
  await http.build(MOTH, { wallet: STUB_CREATOR });
  await http.submit(MOTH, { buildId: "c".repeat(32), wallet: STUB_CREATOR, signedWireBase64: ["AA=="] });
  assert.deepEqual(asked, [
    ["GET", `/api/v1/launch/creators/${STUB_CREATOR}`, API_HEADERS["X-Ryntra-API-Version"]],
    ["GET", `/api/v1/launch/${MOTH}/market`, API_HEADERS["X-Ryntra-API-Version"]],
    ["GET", `/api/v1/launch/${MOTH}/claim/review?wallet=${STUB_CREATOR}`, API_HEADERS["X-Ryntra-API-Version"]],
    ["POST", `/api/v1/launch/${MOTH}/claim/build`, API_HEADERS["X-Ryntra-API-Version"]],
    ["POST", `/api/v1/launch/${MOTH}/claim/submit`, API_HEADERS["X-Ryntra-API-Version"]],
  ]);
  assert.equal((await http.cabinet("not a wallet")).code, "VALIDATION_ERROR");
  assert.equal((await http.build("../../x", { wallet: STUB_CREATOR })).code, "VALIDATION_ERROR");
  assert.equal(asked.length, 5, "a bad address never leaves the page");

  // The berth's code names no route but these.
  const code = ["berth.ts", "berth-flow.ts", "berth-store.ts"].map((name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8")).join("\n");
  const routes = [...code.matchAll(/`(\/api\/v1\/[^`]*\$\{[^`]*)`/g)].map((m) => m[1]);
  assert.deepEqual(routes, ["/api/v1/launch/${token}/claim/${route}", "/api/v1/launch/creators/${wallet}", "/api/v1/launch/${token}/market", "/api/v1/launch/${token}/claim/review?wallet=${wallet}"]);
});

test("the words: money rounded down to the cent, a dollar pair as dollars, Ukrainian digits, the half as ½", () => {
  assert.equal(amountText(3.2, USDC, "en"), "$3.20");
  assert.equal(amountText(1284.6, USDC, "uk"), "$1 284,60");
  assert.equal(amountText(0.004, USDC, "en"), "<$0.01");
  assert.equal(amountText(0, USDC, "en"), "$0.00");
  assert.equal(moneyText("18649999", USDC, "en"), "$18.64");
  assert.equal(moneyText("18640000", { ...USDC, dollar: false }, "en"), "18.64 USDC");
  assert.equal(shareText(3200, "en"), "32%");
  assert.equal(shareText(3200, "uk"), "32 %");
  assert.equal(shareText(5000, "uk"), "½");
  assert.equal(claimFailureText({ code: CLAIM_CLOSED, stage: "before", message: "" }, null, "uk"), "Забрати тут можна буде разом із Лаунчем.");
  assert.equal(claimFailureText({ code: WALLET_REFUSED, stage: "before", message: "" }, "Phantom", "en"), "Phantom did not sign. Nothing was sent.");
  assert.equal(claimFailureText({ code: "SOMETHING", stage: "send", message: "" }, null, "en"), "No answer came back. If the claim landed, it shows in your wallet.");
});

/* «Моя вежа» (CITY-168): the coin's figures are the engine's market as it reads them; a launch not listed yet is named as it
   landed, its earnings unread; the camera is one tap on a phone. */

test("the tower's figures are the market's own, and a move to the pool ends the way there", () => {
  const market = { price: { pair: 0.000005, usd: 0.000005 }, sinceLaunchBps: 590, holders: { count: 58, atLeast: true }, progress: { bps: 4_299, migrated: false } };
  assert.deepEqual(towerFiguresOf(market), { price: market.price, sinceLaunchBps: 590, holders: 58, holdersAtLeast: true, progressPct: 42 });
  assert.equal(towerFiguresOf({ ...market, progress: { bps: 10_000, migrated: true } }).progressPct, null);
  assert.equal(towerFiguresOf(null), null);
});

test("the stand's market gives the tower's figures through the berth engine", async () => {
  const engine = stand();
  const answer = await engine.market(SPARK);
  assert.equal(answer.ok, true);
  const figures = towerFiguresOf(answer.data);
  assert.equal(figures.holders, answer.data.holders.count);
  assert.equal(figures.price.usd, answer.data.price.usd);
});

test("the price reads in dollars where the engine says them, rounded down, and the move never reads better than it is", () => {
  const dollar = { symbol: "USDC", decimals: 6, dollar: true };
  const sol = { symbol: "SOL", decimals: 9, dollar: false };
  assert.equal(priceText({ pair: 0.000005, usd: 0.000005 }, dollar, "en"), "$0.000005");
  assert.equal(priceText({ pair: 0.25, usd: null }, sol, "en"), "0.25 SOL");
  assert.equal(moveText(599, "en"), "+5%");
  assert.equal(moveText(-599, "en"), "−5%");
  assert.equal(moveText(1200, "uk"), "+12 %");
});

test("a launch that just landed stands first, its earnings unread and never zero, until the cabinet lists it", () => {
  const landed = { token: "Landed1111111111111111111111111111", symbol: "SUNNY", name: "Sunny", image: "data:image/webp;base64,AAAA", launchedAt: "2026-11-02T00:00:00.000Z", creator: STUB_CREATOR, preset: "classic" };
  const listed = row();
  const rows = withJustLanded([listed], [landed], STUB_CREATOR, STUB_PRESETS);
  assert.deepEqual(rows.map((entry) => entry.symbol), ["SUNNY", "MOTH"]);
  assert.equal(rows[0].earnings, null);
  assert.equal(rows[0].claimable, false);
  assert.equal(rows[0].image, null, "a data address is not the engine's picture");
  assert.deepEqual(claimReady(rows[0], null), { can: false, why: "unread" });
  /* Once listed, the cabinet's row is the only one; another wallet's launch, or an unknown preset, is not this window's. */
  assert.deepEqual(withJustLanded([{ ...listed, token: landed.token }], [landed], STUB_CREATOR, STUB_PRESETS).length, 1);
  assert.equal(withJustLanded([], [{ ...landed, creator: "another" }], STUB_CREATOR, STUB_PRESETS).length, 0);
  assert.equal(withJustLanded([], [{ ...landed, preset: "none" }], STUB_CREATOR, STUB_PRESETS).length, 0);
});

test("on a phone the sheet opens the camera in one tap, and the liftoff lands on «Моя вежа», not on the trade window", () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
  const sheet = read("../../components/launch/LaunchSheet.tsx");
  assert.match(sheet, /capture="environment"/);
  assert.match(sheet, /openBerth\(result\.liftoff\.token\)/);
  assert.doesNotMatch(read("./district.ts"), /city\.select\(liftoff\.token\)/);
  assert.match(read("../../components/hud/Menu.tsx"), /openBerth\(\)/);
});
