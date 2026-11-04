import { test } from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync } from "node:fs";

import { FEE_POLICY_V2 } from "../../../lib/core/fee-policy.ts";
import { presetTerms } from "../../../lib/core/launch/preset-terms.ts";
import { PARTNER_TERMS, termsRows } from "./terms.ts";
import { PARTNERS } from "../../components/partners/words.ts";
import { calculate, countShort, DEFAULT_INPUT, GROWTH, logPosition, logValue, MONTHS, usdShort } from "./calc.ts";
import { CREATOR, CREATOR_CURVE_PERCENT, CREATOR_POOL_PERCENT, creatorEarns, feePer1000, GUILD_ROLES, MIXES, OFFER, offerOf, PAYOUTS, percent, PRODUCTS, receivedPer1000 } from "./facts.ts";
import { agoIn, bare, channelLink, DEMO_ANSWER, districtOf, funnelEmpty, receiptsCsv, withEarnings } from "./district.ts";
import { devAskOf, invitationOf } from "./landing.ts";
import { streetPoints, streetsTo } from "./streets.ts";
import { setPartnersEnv, usePartners } from "./store.ts";

// «Ryntra Partners» (CITY-126, CITY-127): the operator's terms (decision 93, `lib/decks/partner-terms.ts`), the fees from
// the fee policy and the launch preset, the referrer's calculator, «Мій район» from `/api/rewards`, the friend's landing.
// No network: the engine is a stub with its shape.

test("the offer is decision 93, read from the partner terms — never typed in the city", () => {
  assert.equal(PARTNER_TERMS.decided, "93");
  assert.deepEqual(OFFER, { firstPercent: 40, firstDays: 90, afterPercent: 30, lifetime: true, discountPercent: 10, minimumUsd: 5, asset: "USDC", levels: 1 });
  assert.equal(OFFER.firstPercent, PARTNER_TERMS.share.firstBps / 100);
  assert.equal(OFFER.afterPercent, PARTNER_TERMS.share.afterBps / 100);
  assert.equal(OFFER.discountPercent, PARTNER_TERMS.refereeDiscountBps / 100);
  assert.equal(offerOf({ ...PARTNER_TERMS, share: null }), null, "no share decided: no offer drawn");
  assert.equal(PAYOUTS, "counting", "nothing is paid until the revenue ledger runs");
  assert.equal(percent(40, "en"), "40%");
  assert.equal(percent(40, "uk"), "40\u00a0%");
  assert.equal(percent(0.32, "uk"), "0,32\u00a0%");
});

test("the city holds none of the old programme's numbers, and no number of its own", () => {
  // The rows of rules 2.2.0 the operator replaced with decision 93: 50 % back, 10–30 % by rank, «First $10», a second level.
  const dir = new URL("./", import.meta.url);
  const components = new URL("../../components/partners/", import.meta.url);
  const sources = [
    ...readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => [f, readFileSync(new URL(f, dir), "utf8")]),
    ...readdirSync(components).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [f, readFileSync(new URL(f, components), "utf8")]),
  ];
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /lib\/rewards\/(rules|programme-facts|network-rules)/, `${name} reads no reward ladder`);
    assert.doesNotMatch(source, /First \$10|Перші \$10|firstTen|RANK_THRESHOLDS|referralL1BpsByRank|cashbackBps/, `${name} prints no old term`);
    assert.doesNotMatch(source, /canary|канар/i, `${name}: no such word`);
    assert.doesNotMatch(source, /\btoken\b|токен/i, `${name}: the programme names no token`);
  }
  const all = JSON.stringify([PARTNERS.en, PARTNERS.uk], (_, v) => (typeof v === "function" ? v("§", "§", "§") : v));
  assert.doesNotMatch(all.replace(/\$1[, ]000/g, ""), /\d+\s?%|\$\d/, "the words carry no share and no sum: they arrive from the terms");
  assert.doesNotMatch(all, /\bAPI\b|engine|двигун|endpoint|route|PRT-|CITY-/i, "no technical words on screen");
});

test("the terms behind «i» are the partner deck's own rows: one source with /partners", () => {
  for (const lang of ["en", "uk"]) {
    const rows = termsRows(lang, PARTNER_TERMS).rows.map((r) => r.value);
    assert.ok(rows.some((v) => v.includes(percent(40, lang).replace("\u00a0", " ")) || v.includes(percent(40, lang))), `${lang}: the first share`);
    assert.ok(rows.some((v) => v.includes("USDC")));
  }
  const window = readFileSync(new URL("../../components/partners/PartnersWindow.tsx", import.meta.url), "utf8");
  assert.match(window, /termsRows\(lang, PARTNER_TERMS\)/, "the window prints the deck's rows, not a copy");
  assert.match(window, /'\/partners'/, "and opens the deck itself");
});

test("Ryntra's fee per $1 000 comes from the fee policy, and the partner's base is what Ryntra received after the discount", () => {
  assert.equal(feePer1000("majors"), 1.05);
  assert.equal(feePer1000("mixed"), 3.6);
  assert.equal(feePer1000("memes"), 6.7);
  assert.equal(receivedPer1000("mixed"), 3.24, "$3.60 less the friend's 10 %");
  assert.equal(receivedPer1000("mixed", null), 3.6, "no terms, no discount");
  for (const weights of Object.values(MIXES)) assert.equal(Object.values(weights).reduce((a, b) => a + b, 0), 100, "a mix is all of the volume");
  assert.equal(FEE_POLICY_V2.MEME.bps, 100, "if the policy moves, the mixes move with it — this test then says so");
});

test("the creator's coin reads the launch preset's terms: 1 % × 32 % = 0.32 % of curve volume, the pool an example", () => {
  const terms = presetTerms("classic");
  assert.equal(CREATOR.curveFeePercent, terms.curve.baseFeeBps / 100);
  assert.equal(CREATOR.curveSharePercent, terms.curve.split.creatorBps / 100);
  assert.equal(CREATOR_CURVE_PERCENT, 0.32);
  assert.equal(CREATOR_POOL_PERCENT, (terms.pool.endFeeBps / 100) * (terms.pool.creatorPositionBps / 10_000));
  assert.deepEqual(creatorEarns(100_000, 0), { curve: 320, pool: 0 });
  assert.deepEqual(creatorEarns(-5, Number.NaN), { curve: 0, pool: 0 });
});

test("products: swaps counted, launches coming; the guild's roles stand without a season, seats or pay (D-P8)", () => {
  assert.deepEqual(Object.fromEntries(PRODUCTS.map((p) => [p.id, p.state])), { swap: "counting", launch: "coming" });
  assert.deepEqual([...GUILD_ROLES], ["scout", "builder", "host", "guide"]);
});

test("the partner earns 40 % of what Ryntra received for each person's first 90 days, then 30 % — one level, no ranks", () => {
  // One person, $1 000 a month of mixed trading, kept for a year, no newcomers: $3.24 received a month.
  const one = calculate({ audience: 1, sharePct: 100, volumeUsd: 1_000, mix: "mixed", retentionPct: 100 });
  assert.ok(Math.abs(one.perPerson - 3.24) < 1e-9);
  assert.ok(Math.abs(one.months[0].partner - 3.24 * 0.4) < 1e-9, "month 1: 40 %");
  assert.equal(one.months[0].first, true);
  assert.equal(one.months[2].first, true, "months 1–3 are the first 90 days");
  assert.equal(one.months[3].first, false);
  // Month 4: the first person at 30 %; the newcomers of months 2–4 (15 % each) still at 40 %.
  const m4 = 3.24 * 0.3 + 3 * 0.15 * 3.24 * 0.4;
  assert.ok(Math.abs(one.months[3].partner - m4) < 1e-9, `${one.months[3].partner} ≈ ${m4}`);
  // The friend kept 10 % of the full fee: $0.36 a month on $3.60.
  assert.ok(Math.abs(one.months[0].saved - 0.36) < 1e-9);
  assert.equal(one.months.length, MONTHS);
  assert.ok(Math.abs(one.year - one.months.reduce((s, m) => s + m.partner, 0)) < 1e-9);
  assert.equal(one.month12, one.months[11].partner);
});

test("without terms the calculator pays nothing; retention thins cohorts; nothing goes negative on wild inputs", () => {
  const none = calculate(DEFAULT_INPUT, null);
  assert.equal(none.year, 0);
  assert.equal(none.saved, 0);
  const keep = calculate({ ...DEFAULT_INPUT, retentionPct: 100 });
  const lose = calculate({ ...DEFAULT_INPUT, retentionPct: 30 });
  assert.ok(keep.months[11].active > lose.months[11].active);
  assert.ok(keep.year > lose.year);
  assert.equal(GROWTH, 0.15);
  const wild = calculate({ audience: -10, sharePct: 500, volumeUsd: Number.NaN, mix: "majors", retentionPct: -3 });
  for (const m of wild.months) for (const v of [m.active, m.partner, m.saved, m.received]) assert.ok(v >= 0 && Number.isFinite(v));
});

test("log sliders round to two figures and come back to where they were", () => {
  assert.equal(logValue(0, 100, 1_000_000), 100);
  assert.equal(logValue(1, 100, 1_000_000), 1_000_000);
  assert.equal(logValue(0.5, 100, 1_000_000), 10_000);
  assert.ok(Math.abs(logPosition(10_000, 100, 1_000_000) - 0.5) < 1e-9);
  assert.equal(usdShort(0), "$0");
  assert.equal(usdShort(1240.4), "$1,240");
  assert.equal(usdShort(12_400), "$12.4K");
  assert.equal(usdShort(1_250_000), "$1.3M");
  assert.equal(countShort(10_000), "10K");
});

const ANSWER = {
  ok: true,
  available: "3.20",
  pending: "1.10",
  lifetime: "12.40",
  cashback: "4.05",
  referralL1: "7.80",
  referralL2: "0.55",
  claimable: false,
  referrals: { level1: 6, level2: 2 },
  referral: { code: "K7Q2M9XW4HPT", link: "https://ryntra.io/r/K7Q2M9XW4HPT" },
  rank: { rank: "SILVER", friendShare: 15, next: { rank: "GOLD", toGo: "41" } },
  rows: [
    { kind: "REFERRAL_L1", display: "+$0.42", amount: "0.42", detail: "BONK", at: "2026-10-29T10:00:00.000Z" },
    { kind: "CLAIM", display: "−$2.00", amount: "2.00", detail: null, at: "2026-10-20T09:00:00.000Z" },
    { kind: "CASHBACK", display: "+$1.00", amount: "1.00", detail: "WIF · after the check", at: "2026-10-29T11:00:00.000Z" },
    { kind: "REFERRAL_L2", display: "—", amount: "—", detail: "JUP", at: "2026-10-28T09:00:00.000Z" },
    { kind: "ADJUSTMENT", display: "+$9.00", amount: "9.00", detail: null, at: "2026-10-20T09:00:00.000Z" },
    { kind: "CLAIM", display: "−$0.50", amount: "0.50", detail: null, at: "not a date" },
  ],
};

test("«Мій район» reads the engine on one level: the partner's share only, $0.00 claimable while nothing may be claimed", () => {
  const v = districtOf(ANSWER);
  assert.equal(v.state, "COUNTED");
  assert.equal(v.accrued, "7.80", "the share from the people they brought — not the person's own cashback, not a second level");
  assert.equal(v.swap, "7.80");
  assert.equal(v.claimable, "0.00", "COUNTED: nothing claimable, whatever is available");
  assert.equal(v.paid, "2.00");
  assert.equal(v.brought, 6);
  assert.equal("rank" in v, false, "no rank: decision 93 has none");
  assert.deepEqual(v.funnel, { clicks: null, wallets: 6, firstTrade: null, active: null }, "only what the engine counts");
  assert.deepEqual(v.receipts.map((r) => r.kind), ["REFERRAL_L1", "CLAIM"], "newest first; the partner's lines only; no unreadable date");
  assert.equal(v.receipts[0].coin, "BONK");
  assert.equal(districtOf({ ...ANSWER, claimable: true }).claimable, "3.20");
  assert.equal(districtOf({ ...ANSWER, claimable: true }).state, "OPEN");
  assert.equal(districtOf({ ok: false }), null);
  assert.equal(districtOf({ ...ANSWER, referrals: {} }).brought, null);
  assert.equal(funnelEmpty(v.funnel), false);
  assert.equal(funnelEmpty({ clicks: null, wallets: 0, firstTrade: null, active: null }), true);
  const demo = districtOf(DEMO_ANSWER);
  assert.equal(demo.state, "COUNTED", "the demo shows the state of today");
  assert.ok(demo.receipts.every((r) => r.kind === "REFERRAL_L1"), "the demo's cashback line is not the partner's");
});

test("receipt times read short in both languages", () => {
  const now = Date.parse("2026-10-29T12:00:00.000Z");
  assert.equal(agoIn("2026-10-29T11:59:30.000Z", now, "uk"), "щойно");
  assert.equal(agoIn("2026-10-29T09:00:00.000Z", now, "uk"), "3 год");
  assert.equal(agoIn("2026-10-29T09:00:00.000Z", now, "en"), "3h");
  assert.equal(agoIn("2026-10-27T12:00:00.000Z", now, "uk"), "2 д");
  assert.equal(agoIn("bad", now, "en"), "");
});

test("receipts go out as CSV, signed, quoted where they must be", () => {
  const csv = receiptsCsv(districtOf(ANSWER).receipts);
  assert.equal(csv.split("\n")[0], "date,kind,usd,coin");
  assert.match(csv, /2026-10-20T09:00:00.000Z,CLAIM,-2.00,\n/);
  assert.match(receiptsCsv(districtOf(DEMO_ANSWER).receipts), /REFERRAL_L1,,TRUMP/, "a share with no value yet is an empty cell, not a zero");
  assert.equal(receiptsCsv([{ kind: "REFERRAL_L1", amount: "1.00", out: false, coin: 'A,"B"', at: "x" }]).split("\n")[1], 'x,REFERRAL_L1,1.00,"A,""B"""');
});

test("the link kit marks each channel, and the address layer carries the code", () => {
  assert.equal(channelLink("https://ryntra.io/r/K7Q2M9XW4HPT", "K7Q2M9XW4HPT", "telegram"), "https://ryntra.io/app?ref=K7Q2M9XW4HPT&sub=telegram");
  assert.equal(channelLink("nonsense", "K7Q2M9XW4HPT", "x"), "nonsense");
  assert.equal(bare("https://ryntra.io/r/K7Q2/"), "ryntra.io/r/K7Q2");
});

test("the landing greets only an invitation the browser carries and has not bound", () => {
  assert.deepEqual(invitationOf({ ok: true, pending: { code: "K7Q2M9XW4HPT", inviterMasked: "4EeX…KPGW", codeMasked: "K7Q2…4HPT" }, confirmed: null }), { code: "K7Q2M9XW4HPT", inviter: "4EeX…KPGW" });
  assert.equal(invitationOf({ ok: true, pending: { code: "K7Q2M9XW4HPT", inviterMasked: "4EeX…KPGW" }, confirmed: { inviterMasked: "4EeX…KPGW" } }), null, "bound already");
  assert.equal(invitationOf({ ok: true, pending: null, confirmed: null }), null);
  assert.equal(invitationOf({ ok: true, pending: { code: "K7Q2M9XW4HPT", inviterMasked: "<script>" } }), null, "never a handle that is not a masked address");
  assert.deepEqual(devAskOf("?partners=district,demo"), { open: "district", demo: true });
  assert.deepEqual(devAskOf("?partners=landing"), { open: "landing", demo: true });
  assert.deepEqual(devAskOf("?x=1"), { open: null, demo: false });
});

test("the network's streets run on the city's roads: out along an avenue, round a ring, in to the tower", () => {
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  // A tower due north at r = 40: straight out along the north avenue to the inner ring, then in — no arc.
  const north = streetPoints({ x: 0, z: -40 });
  assert.ok(north.every((p) => near(p.x, 0)), "the north avenue");
  assert.ok(near(north[0].z, -11) && near(north.at(-1).z, -40), "from the plaza to the tower");
  // A tower 20° east of north at r = 55: north avenue to the outer ring (50), round it 20°, then out to the tower.
  const a = Math.PI / 9;
  const east = streetPoints({ x: Math.sin(a) * 55, z: -Math.cos(a) * 55 });
  const radii = east.map((p) => Math.hypot(p.x, p.z));
  assert.ok(near(radii[0], 11) && near(radii[1], 50));
  assert.ok(radii.slice(1, -1).every((r) => near(r, 50)), "the arc stays on the ring road");
  assert.ok(near(radii.at(-1), 55));
  // Two towers on the same arc share its chords: drawn once.
  const one = streetsTo([{ x: Math.sin(a) * 55, z: -Math.cos(a) * 55 }]).length;
  const two = streetsTo([{ x: Math.sin(a) * 55, z: -Math.cos(a) * 55 }, { x: Math.sin(a / 2) * 55, z: -Math.cos(a / 2) * 55 }]).length;
  assert.ok(two < one * 2, `${two} < ${one * 2}`);
  assert.equal(streetsTo([]).length, 0);
});

test("the words exist in both languages, key for key, and every term in them is decision 93's", () => {
  assert.deepEqual(Object.keys(PARTNERS.uk).sort(), Object.keys(PARTNERS.en).sort());
  assert.equal(PARTNERS.en.youLine(90, percent(30, "en")), "of Ryntra's fee for each person's first 90 days · then 30%, for good");
  assert.equal(PARTNERS.uk.youLine(90, percent(30, "uk")), "комісії Ryntra перші 90 днів кожної людини · далі 30\u00a0%, назавжди");
  assert.match(PARTNERS.uk.counting, /^Нараховується · виплата щотижня в USDC$/);
  assert.match(PARTNERS.en.counting, /^Counting · paid weekly in USDC$/);
});

test("the window reads the proven wallet's district, asks for one signature on a 401, and binds after the proof", async () => {
  const calls = [];
  let proven = false;
  setPartnersEnv({
    now: () => 1_000,
    prove: async () => {
      proven = true;
      return { ok: true };
    },
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith("/api/rewards/referral")) return { ok: true, status: 200, json: async () => ({ ok: true, pending: null, confirmed: { inviterMasked: "4EeX…KPGW" } }) };
      if (!proven) return { ok: false, status: 401, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ANSWER };
    },
  });
  const st = usePartners.getState();
  usePartners.setState({ invitation: { code: "K7Q2M9XW4HPT", inviter: "4EeX…KPGW" } });
  await st.read("W1");
  assert.equal(usePartners.getState().status, "proof");
  await st.prove({ wallet: "Phantom", address: "W1" });
  assert.equal(usePartners.getState().status, "ready");
  assert.equal(usePartners.getState().view.accrued, "7.80");
  assert.equal(usePartners.getState().invitation, null, "bound: the landing's invitation is done");
  assert.ok(calls.some((u) => u.startsWith("/api/rewards/referral?address=W1")), "the proven wallet's own read binds");
  usePartners.getState().reset();
  assert.equal(usePartners.getState().view, null);
  usePartners.getState().show({ tab: "guild" });
  assert.equal(usePartners.getState().tab, "guild");
  assert.equal(usePartners.getState().open, true);
});

test("the weekly payout's figures (CITY-128) stand over the Rewards answer once it runs: counted, owed, paid", async () => {
  const v = districtOf(ANSWER);
  assert.equal(withEarnings(v, { ok: true, on: false }), v, "off: the Rewards view as it was");
  assert.equal(withEarnings(v, { ok: true, on: true, accrued: "x", pending: "1.00", paid: "0.00", swap: "0.00", launch: "0.00" }), v, "a figure that is not one: nothing changes");
  assert.equal(v.launch, null, "launches not counted by Rewards: coming");
  const weekly = withEarnings(v, { ok: true, on: true, accrued: "12.40", swap: "10.40", launch: "2.00", pending: "4.40", paid: "8.00", lastPaidWeek: "2026-11-02" });
  assert.equal(weekly.state, "WEEKLY");
  assert.deepEqual([weekly.accrued, weekly.claimable, weekly.paid, weekly.swap, weekly.launch], ["12.40", "4.40", "8.00", "10.40", "2.00"]);
  assert.equal(weekly.brought, v.brought);
  assert.equal(PARTNERS.uk.weekly("USDC"), "Виплата щотижня · USDC");
  assert.equal(PARTNERS.en.pending, "Next payout");

  setPartnersEnv({
    now: () => 5_000,
    prove: async () => ({ ok: true }),
    fetch: async (url) => {
      if (url.startsWith("/api/partners/earnings?address=W2")) return { ok: true, status: 200, json: async () => ({ ok: true, on: true, accrued: "12.40", swap: "12.40", launch: "0.00", pending: "4.40", paid: "8.00" }) };
      return { ok: true, status: 200, json: async () => ANSWER };
    },
  });
  usePartners.getState().reset();
  await usePartners.getState().read("W2", true);
  assert.equal(usePartners.getState().view.state, "WEEKLY");
  assert.equal(usePartners.getState().view.paid, "8.00");
  setPartnersEnv({
    fetch: async (url) => {
      if (url.startsWith("/api/partners/earnings")) throw new Error("down");
      return { ok: true, status: 200, json: async () => ANSWER };
    },
  });
  await usePartners.getState().read("W2", true);
  assert.equal(usePartners.getState().view.state, "COUNTED", "the payout's read down: the Rewards figures stand");
  usePartners.getState().reset();
});
