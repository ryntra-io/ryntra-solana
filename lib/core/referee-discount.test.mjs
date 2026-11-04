// Run from repo root: node --test lib/core/referee-discount.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { PARTNER_TERMS, termsRows } from "../../city/lib/partners/terms.ts";
import { DISCOUNT_ENV, discountOn } from "../../city/lib/partners/discount.ts";
import { proveBuildFee } from "../solana/build-fee-proof.ts";
import { buildServiceFee } from "../solana/jupiter-build.ts";
import { triggerFeePlan, triggerFeeRaw } from "../solana/limits/model.ts";
import { FEE_POLICY_V2, inputSideFeeRaw } from "./fee-policy.ts";
import { discountedFeeBps, readRefereeDiscountBps, refereeDiscountBps, refereeDiscountInForce } from "./referee-discount.ts";
import { chooseExecutableOrder } from "./solana-swap/fee-route.server.ts";

/*
 * CITY-182: a person a partner brought pays Ryntra's fee less the programme's discount, on the order the wallet signs.
 * The figure is `PARTNER_TERMS.refereeDiscountBps`; the switch is one variable, off unless it says `on`.
 */

const WALLET = "Friend1111111111111111111111111111111111111";
const PARTNER = "Partner111111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111111";
const DISCOUNT = PARTNER_TERMS.refereeDiscountBps;
const ON = { [DISCOUNT_ENV]: "on" };

const account = (fields = {}) => ({ referrer: PARTNER, referredAt: "2026-11-01T10:00:00.000Z", previousReferrer: null, previousReferredAt: null, ...fields });

test("the figure is the terms' own: 10 % of Ryntra's fee", () => {
  assert.equal(DISCOUNT, 1000);
});

test("the switch is off unless it says on", () => {
  assert.equal(refereeDiscountInForce({}), false);
  assert.equal(refereeDiscountInForce({ [DISCOUNT_ENV]: "off" }), false);
  assert.equal(refereeDiscountInForce({ [DISCOUNT_ENV]: "1" }), false);
  assert.equal(refereeDiscountInForce({ [DISCOUNT_ENV]: " on " }), true);
  assert.equal(discountOn(undefined), false);
});

test("the rate is rounded down, in the person's favour, never above the table's, never under the venue's smallest fee", () => {
  assert.equal(discountedFeeBps(100, DISCOUNT), 90);
  assert.equal(discountedFeeBps(50, DISCOUNT), 45);
  assert.equal(discountedFeeBps(25, DISCOUNT), 22, "22.5 is rounded to 22");
  assert.equal(discountedFeeBps(10, DISCOUNT), 9);
  assert.equal(discountedFeeBps(1, DISCOUNT), 1, "0.9 bp is under a whole basis point: no discount, never a free trade");
  assert.equal(discountedFeeBps(0, DISCOUNT), 0);
  /* Jupiter's /order takes no referral under 50 bps; the Trigger program none under 10. */
  assert.equal(discountedFeeBps(100, DISCOUNT, 50), 90);
  assert.equal(discountedFeeBps(50, DISCOUNT, 50), 50, "45 is under /order's minimum: the full rate there");
  assert.equal(discountedFeeBps(10, DISCOUNT, 10), 10);
  assert.equal(discountedFeeBps(25, DISCOUNT, 10), 22);
  assert.equal(discountedFeeBps(100, 0), 100, "no discount, the table's rate");
  for (const flow of Object.keys(FEE_POLICY_V2)) {
    const bps = FEE_POLICY_V2[flow].bps;
    assert.ok(discountedFeeBps(bps, DISCOUNT) <= bps, flow);
    assert.ok(discountedFeeBps(bps, DISCOUNT) >= Math.floor((bps * 9) / 10), flow);
  }
});

test("who gets it: an inviter bound at the moment of the trade, who is not the wallet itself", () => {
  const at = "2026-11-02T12:00:00.000Z";
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: null, at }), 0, "no record");
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account({ referrer: null, referredAt: null }), at }), 0, "nobody brought them");
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account(), at }), DISCOUNT, "brought by a partner");
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account({ referrer: WALLET }), at }), 0, "their own link");
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account({ referredAt: "2026-11-03T00:00:00.000Z" }), at }), 0, "bound after the trade");
  assert.equal(
    refereeDiscountBps({ wallet: WALLET, account: account({ referredAt: "2026-11-03T00:00:00.000Z", previousReferrer: OTHER, previousReferredAt: "2026-10-01T00:00:00.000Z" }), at }),
    DISCOUNT,
    "the inviter before a change still holds at the moment",
  );
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account(), at: "not a time" }), 0);
});

test("a binding past the terms' days, should they ever count days, earns nothing; for good, it never lapses", () => {
  const thirty = { ...PARTNER_TERMS, attribution: 30 };
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account(), at: "2026-11-30T09:59:59.000Z", terms: thirty }), DISCOUNT);
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account(), at: "2026-12-01T10:00:00.000Z", terms: thirty }), 0, "expired");
  assert.equal(PARTNER_TERMS.attribution, "lifetime");
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account(), at: "2036-11-01T10:00:00.000Z" }), DISCOUNT);
  assert.equal(refereeDiscountBps({ wallet: WALLET, account: account(), at: "2026-11-02T00:00:00.000Z", terms: { ...PARTNER_TERMS, refereeDiscountBps: null } }), 0, "no figure, no discount");
});

test("the record is read only while the switch is on, and a failed read gives no discount", async () => {
  let reads = 0;
  const read = async () => ((reads += 1), account());
  assert.equal(await readRefereeDiscountBps({}, WALLET, { env: {}, read }), 0);
  assert.equal(reads, 0, "off: the store is never asked");
  assert.equal(await readRefereeDiscountBps({}, WALLET, { env: ON, read, now: () => new Date("2026-11-02T12:00:00.000Z") }), DISCOUNT);
  assert.equal(await readRefereeDiscountBps({}, WALLET, { env: ON, read: async () => { throw new Error("store down"); } }), 0);
  assert.equal(await readRefereeDiscountBps({}, WALLET, { env: ON, read: async () => null }), 0);
});

/* ------------------------------------------------------------ the order */

const TAKER = WALLET;
const WSOL = "So11111111111111111111111111111111111111112";
const MEME = "Meme111111111111111111111111111111111111111";
const CONFIG = { jupiterReferralAccount: null, relayAppFeeRecipient: null, mayanReferrerSolana: null };
const REFERRAL = { account: "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv", feeBps: 50 };
const ARGS = { inputMint: WSOL, outputMint: MEME, amountRaw: "1000000000", taker: TAKER, endpoint: {}, handle: {}, config: CONFIG };
const FEE = { side: "INPUT", mint: WSOL, owner: "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne", account: "4kbERimV3PwxwiL72n1NBRpX5HG2Mwja1QNhb4yEp578", decimals: 9, symbol: "SOL" };

/** One lane world: the build is what `/build` would answer for the fee it was asked, so its stated fee is the asked one. */
function world({ flow = "MEME", policy = "v2", asNow = REFERRAL, orderOut = null, buildFails = false } = {}) {
  const asked = { build: [], referral: [], order: [] };
  return {
    asked,
    deps: {
      policy,
      flow: async () => flow,
      fee: async (_flow, _in, _out, _handle, bps) => ({ ok: true, fee: bps > 0 ? { ...FEE, bps } : null }),
      referral: async (forFlow, _config, bps) => (asked.referral.push(bps ?? null), forFlow === null ? asNow : { account: REFERRAL.account, feeBps: bps }),
      fetchBuild: async (request) => {
        asked.build.push(request.fee?.bps ?? 0);
        if (buildFails) return { ok: false, code: "NO_ROUTE", reason: "none" };
        const ryntraFee = buildServiceFee(request);
        return { ok: true, answer: { quote: { path: "BUILD_SUBMIT", inputMint: WSOL, inAmountRaw: request.amountRaw, outAmountRaw: "5000000", inUsdValue: null, ryntraFee } } };
      },
      fetchOrder: async (request) => {
        const asks = request.referral?.feeBps ?? 0;
        asked.order.push(asks);
        if (orderOut === null) return { ok: false, code: "NO_ROUTE", reason: "none" };
        /* Jupiter keeps a referral under its minimum off the wire: that order carries no Ryntra fee. */
        const charged = asks >= 50 ? asks : 0;
        const ryntraFee = { mechanism: "JUPITER_REFERRAL", state: charged > 0 ? "QUOTED" : "NOT_APPLIED", basisPoints: charged };
        return { ok: true, order: { path: "ORDER_EXECUTE", inputMint: WSOL, inAmountRaw: request.amountRaw, outAmountRaw: orderOut, inUsdValue: null, gasless: false, signatureFeePayer: TAKER, priorityFeePayer: TAKER, taker: TAKER, ryntraFee } };
      },
      assemble: async (answer) => ({ ok: true, order: { ...answer.quote, taker: TAKER } }),
    },
  };
}

test("the same swap, with and without the discount: every lane is asked at the discounted rate, and the order states it", async () => {
  const full = world();
  const plain = await chooseExecutableOrder(ARGS, full.deps);
  const friend = world();
  const discounted = await chooseExecutableOrder({ ...ARGS, feeDiscountBps: DISCOUNT }, friend.deps);
  assert.deepEqual([plain.lane, discounted.lane], ["BUILD", "BUILD"]);
  assert.deepEqual(full.asked.build, [100]);
  assert.deepEqual(friend.asked.build, [90], "/build carries the discounted fee");
  assert.deepEqual(friend.asked.referral, [90], "/order asks the discounted referral");
  assert.equal(plain.order.ryntraFee.basisPoints, 100);
  assert.equal(discounted.order.ryntraFee.basisPoints, 90);
  /* 1 SOL at 1 % is 10 000 000 lamports; at 0.9 %, 9 000 000 — exactly 10 % less. */
  assert.equal(plain.order.ryntraFee.amountRaw, "10000000");
  assert.equal(discounted.order.ryntraFee.amountRaw, "9000000");
  assert.equal(discounted.order.ryntraFee.amountRaw, inputSideFeeRaw(ARGS.amountRaw, 90), "the Review's fee is the program's own arithmetic, which the simulation proves");
  assert.equal(BigInt(plain.order.ryntraFee.amountRaw) - BigInt(discounted.order.ryntraFee.amountRaw), BigInt(plain.order.ryntraFee.amountRaw) / 10n);
});

test("no discount and a zero discount build the table's order, unchanged", async () => {
  for (const feeDiscountBps of [undefined, 0]) {
    const { deps, asked } = world();
    const choice = await chooseExecutableOrder({ ...ARGS, ...(feeDiscountBps === undefined ? {} : { feeDiscountBps }) }, deps);
    assert.deepEqual([asked.build, choice.order.ryntraFee.basisPoints], [[100], 100]);
  }
});

test("a dollar-to-dollar swap stays free, with the discount or without", async () => {
  const { deps, asked } = world({ flow: "STABLE" });
  const choice = await chooseExecutableOrder({ ...ARGS, feeDiscountBps: DISCOUNT }, deps);
  assert.deepEqual([asked.build, choice.order.ryntraFee.basisPoints], [[0], 0]);
});

test("the operator's «as now» lane: 50 bps less 10 % is under /order's minimum, so the full 50 — never a free trade", async () => {
  const { deps, asked } = world({ policy: "as-now" });
  await chooseExecutableOrder({ ...ARGS, feeDiscountBps: DISCOUNT }, deps);
  assert.deepEqual(asked.order, [50]);
});

test("a 50 bps flow: the friend gets 45 on /build, and /order — which can only charge the full 50 — never wins over it on price", async () => {
  /* /order's price is far better, enough to win without a discount. */
  const plain = world({ flow: "TRENDING", orderOut: "6000000" });
  assert.equal((await chooseExecutableOrder(ARGS, plain.deps)).lane, "ORDER", "without the discount /order may win, as before");
  const friend = world({ flow: "TRENDING", orderOut: "6000000" });
  const choice = await chooseExecutableOrder({ ...ARGS, feeDiscountBps: DISCOUNT }, friend.deps);
  assert.deepEqual(friend.asked.build, [45]);
  assert.deepEqual(friend.asked.order, [50], "/order is asked the full rate, never 45 it would drop");
  assert.deepEqual([choice.lane, choice.order.ryntraFee.basisPoints], ["BUILD", 45]);
});

test("a 50 bps flow where /build cannot be: /order at the full 50, and the card marks no discount", async () => {
  const { friendDiscountOf } = await import("../../city/lib/trade/figures.ts");
  const noRoute = world({ flow: "TRENDING", orderOut: "5000000", buildFails: true });
  const fallback = await chooseExecutableOrder({ ...ARGS, feeDiscountBps: DISCOUNT }, noRoute.deps);
  assert.deepEqual([fallback.lane, fallback.order.ryntraFee.basisPoints], ["ORDER", 50]);
  assert.equal(friendDiscountOf({ ryntraFee: { basisPoints: 50 } }, fallback.order, true), null);
  for (const flow of ["ONDO", "PRESTOCK", "AS_NOW"]) {
    const only = world({ flow, orderOut: "5000000" });
    const choice = await chooseExecutableOrder({ ...ARGS, feeDiscountBps: DISCOUNT }, only.deps);
    assert.deepEqual([choice.lane, choice.order.ryntraFee.basisPoints, only.asked.build.length], ["ORDER", 50, 0], flow);
    assert.equal(friendDiscountOf({ ryntraFee: { basisPoints: 50 } }, choice.order, true), null, flow);
  }
});

test("a 1 % flow on /order carries the discount there too: 90, and it may still win on price", async () => {
  const { deps, asked } = world({ flow: "MEME", orderOut: "6000000" });
  const choice = await chooseExecutableOrder({ ...ARGS, feeDiscountBps: DISCOUNT }, deps);
  assert.deepEqual(asked.order, [90]);
  assert.deepEqual([choice.lane, choice.order.ryntraFee.basisPoints], ["ORDER", 90]);
});

test("no flow is made free by the discount: every lane charges the table's flows something where it charged before", async () => {
  for (const flow of Object.keys(FEE_POLICY_V2)) {
    const bps = FEE_POLICY_V2[flow].bps;
    for (const minimum of [1, 10, 50]) {
      const discounted = discountedFeeBps(bps, DISCOUNT, minimum);
      if (bps >= minimum) assert.ok(discounted >= minimum, `${flow} at minimum ${minimum}`);
      else assert.equal(discounted, bps, `${flow} under minimum ${minimum}: as without a discount`);
    }
  }
});

test("the simulation's proof holds the bytes to the discounted fee: the full fee is a mismatch, and more than the rate is refused", () => {
  const FEE_ACCOUNT = FEE.account;
  const inner = (amount) => [{ index: 4, instructions: [{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transfer", info: { destination: FEE_ACCOUNT, amount } } }] }];
  const prove = (amount, extra) => proveBuildFee({ staticAccounts: [TAKER, FEE_ACCOUNT], feeAccount: FEE_ACCOUNT, innerInstructions: inner(amount), ...extra });
  assert.equal(prove("9000000", { expectedRaw: "9000000", bps: 90 }).ok, true, "input side: 0.9 % of 1 SOL, as the Review states");
  assert.equal(prove("10000000", { expectedRaw: "9000000", bps: 90 }).code, "FEE_MISMATCH", "bytes that pay the full fee are not the Review's");
  /* Output side: 0.9 % of 1 000 000 is 9 000; 10 000 is the full rate and is refused before the wallet. */
  assert.equal(prove("9000", { expectedRaw: null, bps: 90, takerOutputRaw: "991000" }).ok, true);
  assert.equal(prove("10100", { expectedRaw: null, bps: 90, takerOutputRaw: "989900" }).code, "FEE_ABOVE_RATE");
});

/* ------------------------------------------------------------ limits */

test("a limit order: the discounted rate, never under the program's floor", () => {
  const plan = (flow, discountBps) => triggerFeePlan({ flow, stablePair: false, referralTokenAccount: "Ref1111111111111111111111111111111111111111", discountBps });
  assert.equal(plan("MEME", DISCOUNT).ryntraBps, 90);
  assert.equal(plan("MEME", DISCOUNT).feeBpsParam, 90, "the bytes carry the discounted rate, which the signed order is checked against");
  assert.equal(plan("TRENDING", DISCOUNT).ryntraBps, 45);
  assert.equal(plan("XSTOCK", DISCOUNT).ryntraBps, 22);
  assert.equal(plan("MAJOR", DISCOUNT).ryntraBps, 10, "a major coin's 9 bps is under the floor: the full rate");
  assert.equal(plan("MEME", 0).ryntraBps, 100);
  assert.equal(plan("MEME").ryntraBps, 100);
  assert.equal(plan("STABLE", DISCOUNT).reason, "FLOW_FREE");
  assert.equal(triggerFeeRaw("1000000000", 90), "9000000");
});

/* ------------------------------------------------------------ what the person sees */

test("the trade card marks the discount only where the order states the discounted fee of the card's own quote", async () => {
  const { friendDiscountOf } = await import("../../city/lib/trade/figures.ts");
  const fee = (basisPoints) => ({ ryntraFee: { basisPoints } });
  assert.equal(friendDiscountOf(fee(100), fee(90), true), "−10%");
  assert.equal(friendDiscountOf(fee(50), fee(45), true), "−10%");
  assert.equal(friendDiscountOf(fee(100), fee(90), false), null, "switch off: nothing");
  assert.equal(friendDiscountOf(fee(100), fee(100), true), null, "the full fee: nothing");
  assert.equal(friendDiscountOf(fee(50), fee(0), true), null, "no fee at all is not this discount");
  assert.equal(friendDiscountOf(fee(10), fee(50), true), null, "a higher fee is never a discount");
  assert.equal(friendDiscountOf(null, fee(90), true), null, "no quote to compare with");
});

test("the terms say «coming» while the switch is off, and where the discount works once it is on", () => {
  for (const lang of ["en", "uk"]) {
    const off = termsRows(lang, PARTNER_TERMS, false).rows;
    const on = termsRows(lang, PARTNER_TERMS, true).rows;
    const discountRow = (rows) => rows[2].value;
    assert.match(discountRow(off), lang === "en" ? /coming soon/ : /скоро/, lang);
    assert.doesNotMatch(discountRow(on), /coming|скоро/, lang);
    assert.equal(on.length, off.length + 1, `${lang}: one row more, where it works`);
    assert.match(on[3].value, lang === "en" ? /launch curve/ : /кривій запуску/, lang);
    assert.ok(discountRow(on).includes(lang === "en" ? "10%" : "10 %"), `${lang}: the one figure, from the terms`);
  }
});

test("through the Rewards line's own record: a wallet bound by a partner's link gets the discount, the partner and a stranger do not", async () => {
  const { createMemoryGuardStore } = await import("../guard/store.ts");
  const { bindReferrer, ensureRewardAccount } = await import("../rewards/ledger.ts");
  const store = createMemoryGuardStore();
  const now = "2026-11-02T09:00:00.000Z";
  const partner = await ensureRewardAccount(store, PARTNER, now);
  const bound = await bindReferrer(store, { wallet: WALLET, code: partner.code, now });
  assert.equal(bound.ok, true);
  const self = await bindReferrer(store, { wallet: PARTNER, code: partner.code, now });
  assert.equal(self.ok, false, "a partner's own link binds nobody");
  const at = { env: ON, now: () => new Date("2026-11-02T09:00:01.000Z") };
  assert.equal(await readRefereeDiscountBps(store, WALLET, at), DISCOUNT);
  assert.equal(await readRefereeDiscountBps(store, PARTNER, at), 0);
  assert.equal(await readRefereeDiscountBps(store, OTHER, at), 0, "no record at all");
  assert.equal(await readRefereeDiscountBps(store, WALLET, { now: at.now }), 0, "the switch off");
});

test("the documentation says the discount works only with the switch on, and never «not yet» then", () => {
  // The switch is read once when the module loads, as in a build, so each state is a fresh process.
  const book = new URL("../../city/lib/docs/book.ts", import.meta.url).href;
  const facts = new URL("../../city/lib/docs/facts.ts", import.meta.url).href;
  const model = new URL("../../city/lib/docs/model.ts", import.meta.url).href;
  const status = new URL("../../city/lib/docs/status.ts", import.meta.url).href;
  const script = `
    const { buildSection } = await import(${JSON.stringify(book)});
    const { docsFacts } = await import(${JSON.stringify(facts)});
    const { sectionText } = await import(${JSON.stringify(model)});
    const { docsStatus } = await import(${JSON.stringify(status)});
    const open = Object.fromEntries(["trade", "spot", "stops", "earn", "earnWindow", "guard", "money", "bots", "launch"].map((d) => [d, true]));
    const status = docsStatus(open, { oneSentence: true, budget: true, poolLimits: true });
    console.log(JSON.stringify(["en", "uk"].map((lang) => sectionText(buildSection("partners", lang, docsFacts(), status)))));`;
  const text = (value) => {
    const env = { ...process.env };
    delete env[DISCOUNT_ENV];
    if (value !== undefined) env[DISCOUNT_ENV] = value;
    return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" }).trim().split(String.fromCharCode(10)).at(-1));
  };
  const [enOn, ukOn] = text("on");
  assert.match(enOn, /The discount works: a person you bring pays 10% less of Ryntra’s fee/);
  assert.match(ukOn, /Знижка діє: людина, яку ти привів, платить комісію Ryntra на 10\s?% менше/);
  assert.doesNotMatch(enOn, /not taken off trades yet|coming soon/);
  assert.doesNotMatch(ukOn, /поки не знімається|— скоро/);
  const [enOff, ukOff] = text(undefined);
  assert.match(enOff, /not taken off trades yet/);
  assert.match(ukOff, /поки не знімається/);
  assert.doesNotMatch(enOff, /The discount works/);
  assert.doesNotMatch(ukOff, /Знижка діє/);
});
