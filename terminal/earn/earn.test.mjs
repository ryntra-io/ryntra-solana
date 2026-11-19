import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { positionView, scriptedEngine, ok } from "../../city/lib/districts/harbor/test-fixtures.mjs";
import { JITOSOL, SOL, SOL_USDC, USDC, lstPool } from "../../city/lib/earn/pier-fixtures.mjs";
import { lstHolding } from "../../city/lib/earn/mine.ts";
import { useEarn } from "../../city/lib/earn/open.ts";
import { pierFailure, setPierEnv, usePier } from "../../city/lib/earn/pier-store.ts";
import { proFailure, useProPier } from "../../city/lib/earn/pro-store.ts";
import { useSaver } from "../../city/lib/earn/saver-store.ts";
import { useEarnData } from "../../city/lib/earn/store.ts";
import { earnWords } from "../../city/lib/earn/words.ts";
import { noticeCode, noticeKey } from "./failures.ts";
import {
  feeText,
  lamportsUsd,
  lendPositionRow,
  poolPositionRow,
  poolRows,
  positionRows,
  proPoolRows,
  proPositionRow,
  proRewardsText,
  resultTone,
  shortUsd,
  stakePositionRow,
  stakeRows,
  sumText,
  totals,
  venueSolUsd,
  widthRisk,
} from "./rows.ts";
import { closeSheet, firstOffer, heldForm, heldNow, mayAdd, onTab, pick, place, sameTicket, ticketHeld, ticketStands, underWay, useTicket } from "./ticket.ts";
import { EARN, LEND_REFUSALS } from "./words.ts";

/* The Earn screen's own logic: its rows from what the city's Earn reads, its sums and figures in both languages, the
   ticket in front, and the refusals said in plain names. The flows under it are the city's and are tested there. */

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const POOLS = [lstPool(), SOL_USDC];
const PRO = {
  address: "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT",
  x: { mint: SOL, symbol: "SOL", decimals: 9 },
  y: { mint: USDC, symbol: "USDC", decimals: 6 },
  solIsX: true,
  price: 150.42,
  feeBps: 25,
  tickSpacing: 10,
  tickId: -18_934,
  depthLamports: "869400000000",
  rewards: [],
  takesDeposits: true,
};
const PRO_STAKED = { ...PRO, address: "5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq", x: { mint: JITOSOL, symbol: "JitoSOL", decimals: 9 }, y: { mint: SOL, symbol: "SOL", decimals: 9 }, solIsX: false, feeBps: 4, takesDeposits: false };
const BOAT = { nftMint: "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss", pool: PRO.address, inRange: true, ranges: 7, lowerPrice: 147.36, upperPrice: 152.3, worth: { xRaw: "794444550", yRaw: "114850125", lamports: "1560713428" }, fees: { xRaw: "1210000", yRaw: "184000", lamports: "2433000" }, rewards: [], empty: false, cared: false, care: null };
const FEED_ROWS = [
  { id: "jupsol", rate: { lamports: "1104300000", supply: "1000000000" }, apyPct: 5.05, rewardsFeePct: 5, unstakeFeePct: 0.1, source: "chain", epoch: 1088 },
  { id: "inf", rate: { lamports: "1407837461", supply: "1000000000" }, apyPct: null, rewardsFeePct: null, unstakeFeePct: null, source: "sanctum", epoch: null },
  { id: "jitosol", rate: { lamports: "1260300000", supply: "1000000000" }, apyPct: 4.91, rewardsFeePct: 4, unstakeFeePct: 0.1, source: "chain", epoch: 1088 },
];

test("risk dots follow the width on the city's own scale, one step calmer for a staked SOL against SOL", () => {
  assert.equal(widthRisk("calm", false), 1);
  assert.equal(widthRisk("balanced", false), 2);
  assert.equal(widthRisk("dense", false), 3);
  assert.equal(widthRisk("calm", true), 1, "never under one dot");
  assert.equal(widthRisk("balanced", true), 1);
  assert.equal(widthRisk("dense", true), 2);
});

test("the pools: the city's SOL pools, the most paid in a day first, each with the venue's own figures", () => {
  const rows = poolRows(POOLS);
  assert.equal(rows.length, 2);
  assert.ok((rows[0].fees24hUsd ?? -1) >= (rows[1].fees24hUsd ?? -1), "the most paid in a day first");
  const usdc = rows.find((row) => row.name === "SOL · USDC");
  assert.equal(usdc.fees24hUsd, SOL_USDC.lpFees24hUsd, "the liquidity's share of the fees, not the pool's whole take");
  assert.equal(usdc.volume24hUsd, SOL_USDC.volume24hUsd);
  assert.equal(usdc.depthUsd, SOL_USDC.tvlUsd);
  assert.equal(usdc.feePct, SOL_USDC.feePct);
  assert.deepEqual(usdc.coins.map((coin) => coin.symbol), ["SOL", "USDC"]);
  assert.equal(usdc.staked, false);
  const jito = rows.find((row) => row.name === "JitoSOL · SOL");
  assert.deepEqual(jito.coins.map((coin) => coin.symbol), ["JitoSOL", "SOL"], "a staked SOL pair names the staked coin first");
  assert.equal(jito.staked, true);
  assert.ok(rows.every((row) => row.kind === "pool" && row.takes && row.key === `pool:${row.address}`));
  // A pool that is not a SOL pool of the city's never stands in the table.
  assert.deepEqual(poolRows([{ ...SOL_USDC, x: { ...SOL_USDC.x, mint: "Other111111111111111111111111111111111111111" } }]), []);
});

test("the Pro pools stand in the same table: depth in dollars at the venue's SOL price, no day's fees the chain does not give", () => {
  const solUsd = venueSolUsd(POOLS);
  assert.ok(solUsd > 0, "SOL's price is the venue's own");
  const [usdc, staked] = proPoolRows([PRO, PRO_STAKED], solUsd);
  assert.equal(usdc.kind, "pro");
  assert.equal(usdc.key, `pro:${PRO.address}`);
  assert.equal(usdc.name, "SOL · USDC");
  assert.equal(usdc.feePct, 0.25);
  assert.equal(usdc.fees24hUsd, null);
  assert.equal(usdc.volume24hUsd, null);
  assert.ok(Math.abs(usdc.depthUsd - 869.4 * solUsd) < 1e-6);
  assert.equal(staked.name, "JitoSOL · SOL");
  assert.deepEqual(staked.coins.map((coin) => coin.symbol), ["JitoSOL", "SOL"]);
  assert.equal(staked.takes, false, "a pool that takes no deposit offers none");
  assert.equal(proPoolRows([{ ...PRO, depthLamports: null }], solUsd)[0].depthUsd, null);
  assert.equal(proPoolRows([PRO], null)[0].depthUsd, null, "no SOL price, no dollars");
  assert.equal(lamportsUsd(2_000_000_000n, 150), 300);
});

test("staking: only a staked coin whose rate and worth were read is offered", () => {
  assert.deepEqual(stakeRows(FEED_ROWS).map((row) => [row.lst.symbol, row.apyPct]), [["JupSOL", 5.05], ["JitoSOL", 4.91]]);
  assert.deepEqual(stakeRows(FEED_ROWS.map((row) => ({ ...row, rate: null }))), []);
  assert.deepEqual(stakeRows([]), []);
});

test("a pool position: worth and fees are the venue's dollars, «put in» only from the entry kept when it opened here", () => {
  const view = positionView();
  const bare = poolPositionRow(view, null);
  assert.equal(bare.name, "SOL · USDC");
  assert.equal(bare.investedUsd, null, "no entry, no «put in» — never a guess");
  assert.equal(bare.nowUsd, view.valueUsd);
  assert.equal(bare.earnedUsd, view.unclaimedUsd);
  assert.equal(bare.inRange, true);
  assert.equal(bare.mark, "101.7 – 104.6");
  const entry = { x: 0.24, y: 25, usd: 49.2, claimedUsd: 1.1, at: 1, source: "ryntra" };
  const tracked = poolPositionRow(view, entry);
  assert.equal(tracked.investedUsd, 49.2);
  assert.ok(Math.abs(tracked.earnedUsd - (view.unclaimedUsd + 1.1)) < 1e-9, "fees unclaimed and claimed through Ryntra");
  assert.equal(poolPositionRow(positionView({ rangeState: "out_of_range" }), null).inRange, false);
});

test("staked SOL: worth at the coin's own rate in SOL; cost and earnings only for what the device's purchases cover", () => {
  const feed = { lsts: FEED_ROWS, epochsPerYear: 182, at: "2026-11-16T00:00:00.000Z" };
  const lot = { mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", lstRaw: "1000000000", lamports: "1090000000", at: 1, signature: "sig" };
  const whole = stakePositionRow(lstHolding("jupsol", 1_000_000_000n, feed, [lot]), 100);
  assert.equal(whole.kind, "stake");
  assert.ok(Math.abs(whole.nowUsd - 110.43) < 1e-9, "1 JupSOL × 1.1043 SOL × $100");
  assert.ok(Math.abs(whole.investedUsd - 109) < 1e-9);
  assert.ok(Math.abs(whole.earnedUsd - 1.43) < 1e-9);
  const bought = stakePositionRow(lstHolding("jupsol", 2_000_000_000n, feed, [lot]), 100);
  assert.equal(bought.investedUsd, null, "a balance bigger than its purchases: its cost is not said");
  assert.ok(Math.abs(bought.earnedUsd - 1.43) < 1e-9, "what the purchase earned still is");
  const elsewhere = stakePositionRow(lstHolding("jupsol", 1_000_000_000n, feed, []), 100);
  assert.deepEqual([elsewhere.investedUsd, elsewhere.earnedUsd], [null, null]);
  assert.equal(stakePositionRow(lstHolding("jupsol", 1_000_000_000n, feed, []), null).nowUsd, null);
});

test("lending: the market's own worth and earnings, in dollars at its price; «put in» is the worth less what it earned", () => {
  const market = { asset: "USDC", mint: USDC, decimals: 6, rate: 3.86, minimumRaw: 1_000_335n, liquidRaw: 1n, priceUsd: 1 };
  const row = lendPositionRow({ asset: "USDC", worthRaw: 101_100_000n, earnedRaw: 1_100_000n, availableRaw: 101_100_000n }, market);
  assert.deepEqual([row.name, row.nowUsd, row.earnedUsd, row.investedUsd], ["USDC", 101.1, 1.1, 100]);
  const unread = lendPositionRow({ asset: "USDC", worthRaw: 101_100_000n, earnedRaw: null, availableRaw: null }, market);
  assert.equal(unread.investedUsd, null);
  assert.equal(lendPositionRow({ asset: "USDC", worthRaw: 1n, earnedRaw: 0n, availableRaw: null }, null).nowUsd, null);
});

test("a Pro position: the chain's worth and fees in SOL, in dollars at today's price; an empty one has no range", () => {
  const row = proPositionRow(BOAT, PRO, 150);
  assert.equal(row.kind, "pro");
  assert.equal(row.ref, BOAT.nftMint);
  assert.ok(Math.abs(row.nowUsd - 1.560713428 * 150) < 1e-9);
  assert.ok(Math.abs(row.earnedUsd - 0.002433 * 150) < 1e-9);
  assert.equal(row.investedUsd, null);
  assert.equal(row.inRange, true);
  assert.equal(proPositionRow({ ...BOAT, empty: true }, PRO, 150).inRange, null);
});

test("everything at work in one table — pools, Pro, staking, lending — and the two sums of what was read", () => {
  const rows = positionRows({
    views: [positionView()],
    entries: new Map(),
    staked: [],
    lent: [{ asset: "USDC", worthRaw: 100_000_000n, earnedRaw: 2_000_000n, availableRaw: null }],
    markets: { USDC: { asset: "USDC", mint: USDC, decimals: 6, rate: 3.8, minimumRaw: null, liquidRaw: null, priceUsd: 1 } },
    proBoats: [BOAT, { ...BOAT, nftMint: "x", pool: "gone" }],
    proPiers: [PRO],
    solPriceUsd: 150,
  });
  assert.deepEqual(rows.map((row) => row.kind), ["pool", "pro", "lend"], "a Pro position of a pool not read is left out");
  const sums = totals(rows);
  assert.ok(Math.abs(sums.workingUsd - (49.77 + 1.560713428 * 150 + 100)) < 1e-9);
  assert.ok(Math.abs(sums.earnedUsd - (0.53 + 0.002433 * 150 + 2)) < 1e-9);
  assert.deepEqual(totals([]), { workingUsd: null, earnedUsd: null }, "nothing read, nothing said");
});

test("figures in the language's own way: cents, short dollars, fees and the tone of a result", () => {
  assert.equal(sumText(1240, "en"), "$1,240.00");
  assert.equal(sumText(1240, "uk"), "$1\u00A0240,00", "a no-break space between the thousands");
  assert.equal(sumText(18.4, "en", true), "+$18.40");
  assert.equal(sumText(-2.5, "uk", true), "−$2,50");
  assert.equal(sumText(0.001, "en", true), "$0.00", "no sign on what rounds to nothing");
  assert.equal(sumText(null, "en"), "—");
  assert.equal(shortUsd(8_840.46, "en"), "$8.8K");
  assert.equal(shortUsd(8_840.46, "uk"), "$8,8 тис.");
  assert.equal(shortUsd(21_246_438, "uk"), "$21,2 млн");
  assert.equal(shortUsd(21_246_438, "en"), "$21.2M");
  assert.equal(shortUsd(999_960, "en"), "$1.0M", "never $1000.0K");
  assert.equal(shortUsd(90.57, "en"), "$90.57");
  assert.equal(shortUsd(null, "en"), "—");
  assert.equal(feeText(0.0400003, "uk"), "0,04%");
  assert.equal(feeText(0.1004516, "en"), "0.10%");
  assert.equal(feeText(0.005, "en"), "0.005%");
  assert.equal(feeText(null, "en"), "—");
  assert.equal(resultTone(1.2), "up");
  assert.equal(resultTone(-0.4), "down");
  assert.equal(resultTone(0.001), undefined);
  assert.equal(resultTone(null), undefined);
});

test("the city stores' refusals come back as their codes and are said in plain names, never the city's", () => {
  for (const lang of ["en", "uk"]) {
    const words = earnWords(lang);
    assert.equal(noticeCode(words.pier.failures.PIER_CEILING, "pool"), "PIER_CEILING");
    assert.equal(noticeKey(words.pier.failures.PIER_CLOSED, "pool"), "fClosed");
    assert.equal(noticeKey(words.pier.fresh, "pool"), "fresh");
    assert.equal(noticeKey(words.pro.failures.SIMULATION_FAILED, "pro"), "fBand");
    assert.equal(noticeKey(words.pro.failures.CAPABILITY_UNAVAILABLE, "pro"), "fPool");
    assert.equal(noticeKey(words.pro.fresh, "pro"), "fresh");
  }
  assert.equal(noticeKey(pierFailure("PIER_STOPPED"), "pool"), "fPaused");
  assert.equal(noticeKey(proFailure("RATE_LIMITED"), "pro"), "fBusy");
  assert.equal(noticeKey("Solana did not answer. Nothing was built or sent.", "pool"), null, "a plain sentence of the pools is shown as it is");
  assert.equal(noticeKey("anything else", "pro"), "notSent", "a Pro refusal is never said in the city's words");
  // Every sentence the stores can leave has a plain counterpart: no key points at a missing word.
  for (const venue of ["pool", "pro"]) {
    for (const lang of ["en", "uk"]) {
      const book = venue === "pool" ? earnWords(lang).pier : earnWords(lang).pro;
      for (const said of [...Object.values(book.failures), book.fresh]) {
        const key = noticeKey(said, venue);
        if (key !== null) assert.equal(typeof EARN[lang][key], "string", `${venue} ${key}`);
      }
    }
  }
});

test("the first offer: a pool that takes a deposit, else staking, else lending — whatever is open here", () => {
  const pools = [...proPoolRows([PRO_STAKED], 150), ...poolRows(POOLS)];
  const stakes = stakeRows(FEED_ROWS);
  assert.deepEqual(firstOffer({ pools, addOpen: true, stakes, lendOpen: true }), { kind: "pool", address: pools[1].address }, "a Pro pool that takes nothing is passed over");
  assert.deepEqual(firstOffer({ pools: poolRows(POOLS), addOpen: false, stakes, lendOpen: true }), { kind: "stake", lst: "jupsol" });
  assert.deepEqual(firstOffer({ pools: proPoolRows([PRO], 150), addOpen: false, stakes, lendOpen: true }), { kind: "pro", address: PRO.address }, "a Pro pool has its own gate, the server's");
  assert.deepEqual(firstOffer({ pools: [], addOpen: true, stakes: [], lendOpen: true }), { kind: "lend", asset: "USDC" });
  assert.equal(firstOffer({ pools: [], addOpen: true, stakes: [], lendOpen: false }), null);
  assert.equal(mayAdd("open", false), true);
  assert.equal(mayAdd("canary", false), false, "the one wallet is never announced");
  assert.equal(mayAdd("canary", true), true);
  assert.equal(mayAdd("closed", true), false);
});

test("each tab has its own ticket — a pool's never stands on staking, lending or the positions", () => {
  assert.equal(onTab({ kind: "pool", address: "a" }, "pools"), true);
  for (const tab of ["pro", "staking", "lending", "mine"]) assert.equal(onTab({ kind: "pool", address: "a" }, tab), false, `a pool's ticket on «${tab}»`);
  assert.equal(onTab({ kind: "pro", address: "a" }, "pro"), true, "a DLMM Pro pool's add stands on DLMM Pro too");
  assert.equal(onTab({ kind: "stake", lst: "jupsol" }, "staking"), true);
  assert.equal(onTab({ kind: "stake", lst: "jupsol" }, "lending"), false);
  assert.equal(onTab({ kind: "lend", asset: "USDC" }, "mine"), true, "a position's coin opens on «My positions»");
  assert.equal(onTab({ kind: "position", address: "a", act: "claim" }, "pools"), false);
  assert.equal(onTab(null, "pools"), false);
});

test("a position's two actions are one ticket; different things are not", () => {
  assert.equal(sameTicket({ kind: "position", address: "a", act: "claim" }, { kind: "position", address: "a", act: "exit" }), true);
  assert.equal(sameTicket({ kind: "pool", address: "a" }, { kind: "pro", address: "a" }), false);
  assert.equal(sameTicket({ kind: "stake", lst: "jupsol" }, { kind: "stake", lst: "jitosol" }), false);
  assert.equal(sameTicket(null, null), true);
  assert.equal(sameTicket(null, { kind: "lend", asset: "USDC" }), false);
});

const resetPier = () => usePier.setState({ pool: null, copy: null, boat: null, style: "balanced", goal: null, typed: "1", states: null, reviewed: null, costs: null, target: null, phase: "idle", outcome: null, sent: null, notice: null, rest: null, candles: {} });

beforeEach(() => {
  resetPier();
  useEarn.setState({ busy: false });
  useTicket.setState({ picked: null, sheet: false });
  const harness = scriptedEngine({});
  harness.engine.candles = () => Promise.resolve(ok({ timeframe: "4h", candles: [] }));
  setPierEnv({ engine: harness.engine });
  useEarnData.setState({ piers: { status: "ready", value: { pools: POOLS, at: null }, at: Date.now() } });
});

test("a pool picked goes in front on the pool's own flow, and on a phone its sheet opens", () => {
  assert.equal(pick({ kind: "pool", address: SOL_USDC.address }, "pools"), true);
  assert.equal(usePier.getState().pool.address, SOL_USDC.address);
  assert.deepEqual(useTicket.getState(), { picked: { kind: "pool", address: SOL_USDC.address }, on: "pools", sheet: true });
  assert.equal(closeSheet(), true);
  assert.equal(useTicket.getState().sheet, false);
  assert.deepEqual(useTicket.getState().picked, { kind: "pool", address: SOL_USDC.address }, "the sheet goes, the ticket stays");
  assert.equal(pick({ kind: "pool", address: "Gone111111111111111111111111111111111111111" }), false, "a pool no longer in the list is not opened");
});

test("while a signature is out nothing moves the ticket: no other pick, no sheet closed", () => {
  assert.equal(pick({ kind: "pool", address: SOL_USDC.address }), true);
  useEarn.setState({ busy: true });
  assert.equal(pick({ kind: "pool", address: lstPool().address }), false);
  assert.equal(usePier.getState().pool.address, SOL_USDC.address);
  assert.equal(closeSheet(), false);
  assert.equal(useTicket.getState().sheet, true);
});

test("a Review being built for the last thing in front is let go when another is picked; nothing signed is ever touched", () => {
  assert.equal(place({ kind: "pool", address: SOL_USDC.address }), true);
  usePier.setState({ phase: "reviewing" });
  assert.equal(place({ kind: "pool", address: lstPool().address }), true);
  assert.equal(usePier.getState().pool.address, lstPool().address);
  usePier.setState({ phase: "wallet" });
  useEarn.setState({ busy: true });
  assert.equal(place({ kind: "pool", address: SOL_USDC.address }), false, "the wallet is open: the ticket holds");
});

test("staking picked opens the staked coin; a position picked opens on its own action, afresh", () => {
  const before = useSaver.getState().lst;
  assert.equal(place({ kind: "stake", lst: before === "jitosol" ? "jupsol" : "jitosol" }), true);
  useEarnData.setState({ positions: { owner: OWNER, value: { status: "ready", value: [positionView()], at: Date.now() } } });
  assert.equal(place({ kind: "position", address: positionView().address, act: "claim" }), true);
  assert.equal(usePier.getState().boat.address, positionView().address);
  assert.equal(place({ kind: "position", address: "Gone111111111111111111111111111111111111111", act: "exit" }), false);
  useProPier.setState({ boats: null });
  assert.equal(place({ kind: "proPosition", nftMint: BOAT.nftMint, act: "collect" }), false, "no Pro position read, none opened");
});

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCREEN = readdirSync(fileURLToPath(new URL(".", import.meta.url))).filter((name) => /\.(ts|tsx)$/.test(name));

test("the screen speaks in plain names: no word of the city's windows in either language", () => {
  const CITY = /\b(shelf|pier|piers|boat|boats|saver|harbor|harbour|captain)\b|полиц|причал|човн|скарбничк|гавань|капітан/i;
  for (const dict of [EARN, LEND_REFUSALS]) {
    for (const lang of ["en", "uk"]) {
      for (const [key, value] of Object.entries(dict[lang])) {
        const said = typeof value === "string" ? value : value("1", "1");
        assert.doesNotMatch(said, CITY, `${lang}.${key}: «${said}»`);
      }
    }
  }
});

test("the screen takes nothing from the old interface, and changes no engine: only the city's logic and the kit", () => {
  for (const name of SCREEN) {
    const source = readFileSync(join(REPO, "terminal", "earn", name), "utf8");
    for (const [, from] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      assert.doesNotMatch(from, /^@\/(app|components)\/|\/components\/|^@ryntra\/core/, `${name} imports ${from}`);
      assert.doesNotMatch(from, /city\/components\//, `${name} imports a window of the city: ${from}`);
    }
  }
  const page = readFileSync(join(REPO, "app", "(terminal)", "earn", "page.tsx"), "utf8");
  assert.match(page, /import \{ EarnScreen \} from "@\/terminal\/earn\/EarnScreen";/);
});

test("a Pro action's rewards: each in its own coin, only a coin of the pool's own — never raw units of an unknown one", () => {
  const rewards = [
    { mint: USDC, symbol: "USDC", leastRaw: "420000" },
    { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", leastRaw: "1500000" },
    { mint: SOL, symbol: "SOL", leastRaw: "0" },
    { mint: SOL, symbol: null, leastRaw: "5" },
  ];
  assert.equal(proRewardsText(PRO, rewards), "0.42 USDC");
  assert.equal(proRewardsText(PRO, []), "");
});

test("the ticket holds while a signature is out, and while a part landed and is not read — never for good", () => {
  assert.equal(heldNow({ busy: true, pool: null, pro: null }), true);
  assert.equal(heldNow({ busy: false, pool: null, pro: "partial" }), true, "landed in part: what is left stays on its card");
  assert.equal(heldNow({ busy: false, pool: "unknown", pro: null }), false, "no answer may last for ever: «Check» stays in front, the screen stays free");
  assert.equal(heldNow({ busy: false, pool: "done", pro: "failed" }), false, "a finished outcome holds nothing");
  assert.equal(heldNow({ busy: false, pool: null, pro: null }), false);
});

test("an outcome is wiped only by the person: a part landed holds everything, the same pool keeps «Check», done gives a fresh form", () => {
  assert.equal(pick({ kind: "pool", address: SOL_USDC.address }), true);
  usePier.setState({ outcome: { kind: "partial", signatures: ["s1"] }, phase: "partial" });
  assert.equal(ticketHeld(), true);
  assert.equal(pick({ kind: "pool", address: lstPool().address }), false);
  assert.equal(closeSheet(), false);
  usePier.setState({ outcome: { kind: "unknown", signatures: ["s1"] }, phase: "unknown" });
  assert.equal(ticketHeld(), false);
  assert.equal(place({ kind: "pool", address: SOL_USDC.address }), true);
  assert.deepEqual(usePier.getState().outcome, { kind: "unknown", signatures: ["s1"] }, "the same pool again: «Check» is still there");
  usePier.setState({ outcome: { kind: "done", signatures: ["s1"] }, phase: "done" });
  assert.equal(place({ kind: "pool", address: SOL_USDC.address }), true);
  assert.equal(usePier.getState().outcome, null, "read to its end, the same pool opens on a fresh form");
});

const idle = { pier: { pool: null, boat: null, locked: false, outcome: null, act: null }, pro: { pier: null, boat: null, locked: false, outcome: null, act: null }, saver: { busy: false, lst: "jupsol" }, dollar: { busy: false, asset: "USDC" } };

test("what is under way stands in front whatever was picked: the wallet open, the bytes travelling, a part landed", () => {
  assert.equal(underWay(idle), null);
  assert.deepEqual(underWay({ ...idle, pier: { ...idle.pier, pool: "A", locked: true } }), { kind: "pool", address: "A" });
  assert.deepEqual(underWay({ ...idle, pier: { ...idle.pier, pool: "A", outcome: "partial" } }), { kind: "pool", address: "A" });
  assert.equal(underWay({ ...idle, pier: { ...idle.pier, pool: "A", outcome: "done" } }), null, "a finished one is the picked thing's, not forced in front");
  assert.deepEqual(underWay({ ...idle, pier: { ...idle.pier, boat: "P", locked: true, act: "exit" } }), { kind: "position", address: "P", act: "exit" });
  assert.deepEqual(underWay({ ...idle, pro: { ...idle.pro, boat: "N", locked: true, act: "compound" } }), { kind: "proPosition", nftMint: "N", act: "compound" });
  assert.deepEqual(underWay({ ...idle, pro: { ...idle.pro, pier: "Q", locked: true, act: "open" } }), { kind: "pro", address: "Q" });
  assert.deepEqual(underWay({ ...idle, saver: { busy: true, lst: "jitosol" } }), { kind: "stake", lst: "jitosol" });
  assert.deepEqual(underWay({ ...idle, dollar: { busy: true, asset: "USDC" } }), { kind: "lend", asset: "USDC" });
});

test("with nothing picked, the form the store holds stays in front while listed or carrying an outcome — no drift on a reorder", () => {
  const listed = (kind, address) => kind === "pool" && address === "A";
  assert.deepEqual(heldForm({ pier: { ...idle.pier, pool: "A" }, pro: idle.pro }, listed), { kind: "pool", address: "A" });
  assert.equal(heldForm({ pier: { ...idle.pier, pool: "B" }, pro: idle.pro }, listed), null, "a pool gone from the list gives way to the first offer");
  assert.deepEqual(heldForm({ pier: { ...idle.pier, pool: "B", outcome: "unknown" }, pro: idle.pro }, listed), { kind: "pool", address: "B" }, "its outcome keeps it");
  assert.equal(heldForm({ pier: { ...idle.pier, pool: "A", boat: "P" }, pro: idle.pro }, listed), null, "a position's card is its own ticket");
  assert.equal(heldForm({ pier: idle.pier, pro: idle.pro }, listed), null);
});

test("a pool that a refresh dropped from the list stands while its action is under way or its outcome is read", () => {
  const figures = { pools: poolRows([SOL_USDC]), lendRate: null, lent: [], views: [], proBoats: [] };
  const gone = { kind: "pool", address: lstPool().address };
  assert.equal(ticketStands(gone, figures, { boat: null, proBoat: null, pool: null, proPool: null }), false);
  assert.equal(ticketStands(gone, figures, { boat: null, proBoat: null, pool: lstPool().address, proPool: null }), true);
  assert.equal(ticketStands({ kind: "pool", address: SOL_USDC.address }, figures, { boat: null, proBoat: null }), true);
});

test("another staked coin picked while an order is being built follows once the build is over — the build is never cut", async () => {
  useSaver.setState({ lst: "jupsol", phase: "preparing" });
  assert.equal(place({ kind: "stake", lst: "jitosol" }), true);
  assert.equal(useSaver.getState().lst, "jupsol", "the build in flight is left alone");
  useSaver.setState({ phase: "idle" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(useSaver.getState().lst, "jitosol");
  // A build that went on to the wallet keeps its coin, and the ticket follows the purchase.
  useTicket.setState({ picked: { kind: "stake", lst: "jupsol" } });
  useSaver.setState({ phase: "preparing" });
  assert.equal(place({ kind: "stake", lst: "jupsol" }), true);
  useSaver.setState({ phase: "wallet" });
  assert.equal(useSaver.getState().lst, "jitosol");
  assert.deepEqual(useTicket.getState().picked, { kind: "stake", lst: "jitosol" });
  // Its result stays on screen for the same coin; another coin asked for starts afresh.
  useSaver.setState({ phase: "done" });
  assert.equal(place({ kind: "stake", lst: "jitosol" }), true);
  assert.equal(useSaver.getState().phase, "done");
  useSaver.setState({ phase: "idle" });
});

test("the ticket's form held as one has no box of its own, and its parts still stand above the panel's glass", () => {
  const css = readFileSync(join(REPO, "terminal", "earn", "earn.module.css"), "utf8");
  assert.match(css, /\.form \{\s*display: contents;/, "the fieldset adds no box: its parts stand in the ticket's column");
  // The kit paints the glass under the panel's own children only; a part one level down hides under it without this.
  assert.match(css, /\.form > \* \{\s*position: relative;\s*\}/);
});
