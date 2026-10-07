// Run from repo root: node --test lib/autoinvest/token-rules.test.mjs
/**
 * «Регулярна купівля для всього» (1.31.0): a rule on any token with
 * liquidity — a coin the venue verified, a meme, a new token — stands on the
 * floor when it is written, when it is turned on again, every time it would
 * remind and at the order; its price condition stands against the market
 * price when it was turned on; its reminder lands on the token's market in
 * Spot. A memory store, a fixed clock and the venue's list as fixtures;
 * nothing reaches a wallet.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AutoinvestRuleSchema, RuleAssetReadSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { listInbox } from "../monitoring/store.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import { readRuleAsset, readTokenMarkets } from "./asset.ts";
import { ageHoursOf, checkFloor, floorDeferralWords, floorLine, RULE_FLOOR_AGE_HOURS, RULE_FLOOR_LIQUIDITY_USD } from "./floor.ts";
import { assetHrefOfRef, reminderIdentity, ruleAssetHref, rulePurchaseHref, symbolOfIdentity } from "./links.ts";
import { judgeRuleOrder, usdToUsdcRaw } from "./model.ts";
import { checkPriceCondition, anchorFactsOf, conditionLine } from "./price-condition.ts";
import { createRule, ruleOrderFactsOf, setRuleStatus } from "./service.ts";
import { readRule } from "./store.ts";
import { tickAutoinvest } from "./tick.ts";
import { keptPriceUsd } from "./dip.ts";
import { readsEnabledReference, ruleForReader } from "./wire.ts";
import { priceWord } from "./words.ts";

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const SOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const FRESH = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const RULE_ID = "rule_0123456789abcdef0123456789abcdef";
/* Thursday 24 September 2026, 00:29 in Kyiv. */
const NOW = Date.parse("2026-09-23T21:29:00.000Z");
const HOUR = 3_600_000;
const MINUTE = 60_000;
const WEEKLY_THU_19 = { cadence: "weekly", weekday: 4, monthDay: null, time: "19:00", timeZone: "Europe/Kyiv" };
const DUE = Date.parse("2026-09-24T16:00:00.000Z");
/** The words with the narrow and the no-break spaces `Intl` and the per cent sign carry, as plain spaces. */
const plain = (text) => text.replace(/[  ]/g, " ");

/** A token of the venue's list as `normalizeSpotMarket` states one. */
function market(overrides = {}) {
  return {
    mint: SOL,
    symbol: "SOL",
    name: "Wrapped SOL",
    icon: null,
    decimals: 9,
    tokenProgram: null,
    price: 150,
    change24hPct: null,
    change1hPct: null,
    volume24hUsd: null,
    liquidityUsd: 900_000_000,
    marketCapUsd: null,
    fdvUsd: null,
    holders: null,
    organicScore: 98,
    organicScoreLabel: "high",
    verified: true,
    tags: ["verified"],
    category: "crypto",
    issuer: null,
    firstPoolAt: "2021-03-01T00:00:00.000Z",
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: 12, devBalancePct: null, suspicious: false },
    links: { website: null, twitter: null, telegram: null },
    stats: { h1: {}, h24: {} },
    updatedAt: null,
    ...overrides,
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPct: 12, devBalancePct: null, suspicious: false, ...overrides.audit },
  };
}

const MEME = market({ mint: BONK, symbol: "BONK", name: "Bonk", price: 0.00001834, liquidityUsd: 4_200_000, verified: true, tags: ["verified", "meme"], category: "meme", organicScore: 71, firstPoolAt: "2023-01-01T00:00:00.000Z" });
const NEW_TOKEN = market({ mint: FRESH, symbol: "NEWT", name: "New token", price: 0.0042, liquidityUsd: 61_000, verified: false, tags: [], category: null, organicScore: 34, firstPoolAt: new Date(NOW - 3 * 24 * HOUR).toISOString(), audit: { topHoldersPct: 41, mintAuthorityDisabled: true, freezeAuthorityDisabled: false } });

/** The venue's list as the asset module reads it: one market by mint, many by mints, read at `observedAt`. */
function venue(markets, observedAt = NOW) {
  const byMint = new Map(markets.map((entry) => [entry.mint, entry]));
  return {
    findRow: async () => ({ ok: true, row: null, universe: null }),
    readMarket: async (mint) => ({ ok: true, market: byMint.get(mint) ?? null, observedAt: new Date(observedAt).toISOString(), stale: false }),
    readMarkets: async (mints) => ({ ok: true, byMint: new Map(mints.filter((mint) => byMint.has(mint)).map((mint) => [mint, byMint.get(mint)])), observedAt: new Date(observedAt).toISOString() }),
  };
}

function deps(markets, nowMs = NOW, observedAt = nowMs) {
  return { now: () => new Date(nowMs), lifecycle: () => null, ruleId: () => RULE_ID, ...venue(markets, observedAt) };
}

test("the floor: liquidity and age read now — under either is below, a missing or old figure is unavailable, never a pass", () => {
  assert.equal(RULE_FLOOR_LIQUIDITY_USD, 25_000);
  assert.equal(RULE_FLOOR_AGE_HOURS, 24);
  const old = new Date(NOW - 48 * HOUR).toISOString();
  assert.equal(checkFloor({ liquidityUsd: 25_000, observedAtMs: NOW, firstPoolAt: old }, NOW).verdict, "met");
  assert.equal(checkFloor({ liquidityUsd: 24_999, observedAtMs: NOW, firstPoolAt: old }, NOW).verdict, "below");
  assert.equal(checkFloor({ liquidityUsd: 90_000, observedAtMs: NOW, firstPoolAt: new Date(NOW - 5 * HOUR).toISOString() }, NOW).verdict, "below");
  /* Under the floor is below even when another figure is unknown: it cannot become a pass. */
  assert.equal(checkFloor({ liquidityUsd: 10_000, observedAtMs: null, firstPoolAt: null }, NOW).verdict, "below");
  assert.equal(checkFloor({ liquidityUsd: null, observedAtMs: NOW, firstPoolAt: old }, NOW).verdict, "unavailable");
  assert.equal(checkFloor({ liquidityUsd: 90_000, observedAtMs: NOW, firstPoolAt: null }, NOW).verdict, "unavailable");
  assert.equal(checkFloor({ liquidityUsd: 90_000, observedAtMs: NOW - 31 * MINUTE, firstPoolAt: old }, NOW).verdict, "unavailable");
  assert.equal(checkFloor(null, NOW).verdict, "unavailable");
  assert.equal(ageHoursOf(new Date(NOW + HOUR).toISOString(), NOW), null, "a first pool in the future is not dated");
  const thin = checkFloor({ liquidityUsd: 18_400, observedAtMs: NOW, firstPoolAt: old }, NOW);
  assert.equal(plain(floorLine(thin, "BONK", "uk")), "BONK: ліквідність $18 400 — нижче порогу $25 000");
  assert.equal(floorLine(thin, "BONK", "en"), "BONK: liquidity $18,400 — below the floor of $25,000");
  assert.equal(plain(floorDeferralWords({ name: "BONK", check: thin }).uk.title), "Купівлю відкладено: BONK — ліквідність $18 400 — нижче порогу $25 000");
  /* On the token's own screen the name is already there: the sentence starts itself. */
  assert.equal(plain(floorLine(thin, "", "uk")), "Ліквідність $18 400 — нижче порогу $25 000");
  assert.equal(floorLine(checkFloor({ liquidityUsd: 90_000, observedAtMs: NOW, firstPoolAt: new Date(NOW - 5 * HOUR).toISOString() }, NOW), "", "en"), "On the market for 5 h — the floor is 24 hours");
});

test("the read route: a coin, a meme and a new token with their class, the floor and the facts of risk; a token under the floor is answered with its facts and the refusal", async () => {
  const sol = await readRuleAsset(SOL, deps([market(), MEME, NEW_TOKEN]));
  assert.ok(sol.ok);
  RuleAssetReadSchema.parse(sol.read);
  assert.equal(sol.read.class, "crypto");
  assert.equal(sol.read.asset.kind, "crypto");
  assert.equal(sol.read.asset.issuer.id, "jupiter-verified");
  assert.equal(sol.read.reference, "enabled");
  assert.equal(sol.read.floor.verdict, "met");
  assert.equal(sol.read.refusal, null);

  const bonk = await readRuleAsset(BONK, deps([MEME]));
  assert.ok(bonk.ok);
  assert.equal(bonk.read.class, "meme", "a verified meme is a meme");

  const fresh = await readRuleAsset(FRESH, deps([NEW_TOKEN]));
  assert.ok(fresh.ok);
  assert.equal(fresh.read.class, "meme", "a token the venue has not verified is drawn with the memes");
  assert.deepEqual(fresh.read.asset.issuer, { id: "unverified", label: "Not verified" });
  assert.deepEqual(fresh.read.risk, { verified: false, ageHours: 72, liquidityUsd: 61_000, topHoldersPct: 41, mintAuthorityDisabled: true, freezeAuthorityDisabled: false, organicScore: 34 });

  const thin = await readRuleAsset(FRESH, deps([{ ...NEW_TOKEN, liquidityUsd: 9_000 }]));
  assert.ok(thin.ok);
  assert.equal(thin.read.floor.verdict, "below");
  assert.equal(thin.read.refusal.code, "RULE_LIQUIDITY_LOW");

  const flagged = await readRuleAsset(FRESH, deps([{ ...NEW_TOKEN, audit: { suspicious: true } }]));
  assert.ok(flagged.ok);
  assert.equal(flagged.read.refusal.code, "ASSET_UNCONFIRMED");

  const unknown = await readRuleAsset("BxoQfrYTkfgFbNpgXGSoGSWvvcJCZqcxpierDrt1h7gZ", deps([]));
  assert.deepEqual(unknown.ok, false);
  assert.equal(unknown.code, "ASSET_UNCONFIRMED");
});

test("a rule is written on SOL and on a meme: the symbol as its name, the token as its asset; under the floor, flagged or unread, nothing is written", async () => {
  const store = createMemoryGuardStore();
  const sol = await createRule(store, { owner: OWNER, mint: SOL, amountUsd: 5, schedule: WEEKLY_THU_19, locale: "uk" }, deps([market()]));
  assert.ok(sol.ok, JSON.stringify(sol));
  AutoinvestRuleSchema.parse(sol.rule);
  assert.equal(sol.rule.name, "SOL");
  assert.equal(sol.rule.asset.kind, "crypto");
  assert.equal(sol.rule.asset.unitBasis, "token");

  const meme = await createRule(createMemoryGuardStore(), { owner: OWNER, mint: BONK, amountUsd: 1, kind: "dip", dip: { dropPct: 10, timeZone: "Europe/Kyiv" }, locale: "en" }, deps([MEME]));
  assert.ok(meme.ok, JSON.stringify(meme));
  assert.equal(meme.rule.dip.anchorUsd, 0.00001834, "the reference point is the market price, to eight significant digits under a dollar");

  const thin = await createRule(createMemoryGuardStore(), { owner: OWNER, mint: FRESH, amountUsd: 1, schedule: WEEKLY_THU_19, locale: "uk" }, deps([{ ...NEW_TOKEN, liquidityUsd: 9_000 }]));
  assert.equal(thin.ok, false);
  assert.equal(thin.code, "RULE_LIQUIDITY_LOW");
  const young = await createRule(createMemoryGuardStore(), { owner: OWNER, mint: FRESH, amountUsd: 1, schedule: WEEKLY_THU_19, locale: "uk" }, deps([{ ...NEW_TOKEN, firstPoolAt: new Date(NOW - 5 * HOUR).toISOString() }]));
  assert.equal(young.code, "RULE_LIQUIDITY_LOW");
  const flagged = await createRule(createMemoryGuardStore(), { owner: OWNER, mint: FRESH, amountUsd: 1, schedule: WEEKLY_THU_19, locale: "uk" }, deps([{ ...NEW_TOKEN, audit: { suspicious: true } }]));
  assert.equal(flagged.code, "ASSET_UNCONFIRMED");
  const stale = await createRule(createMemoryGuardStore(), { owner: OWNER, mint: FRESH, amountUsd: 1, schedule: WEEKLY_THU_19, locale: "uk" }, deps([NEW_TOKEN], NOW, NOW - 40 * MINUTE));
  assert.equal(stale.code, "UNAVAILABLE", "figures older than half an hour are not read figures");
});

test("a coin's price condition stands against its market price when the rule was turned on: only the price now must be fresh", async () => {
  const store = createMemoryGuardStore();
  const made = await createRule(store, { owner: OWNER, mint: SOL, amountUsd: 5, schedule: WEEKLY_THU_19, priceCondition: { limitPct: 5 }, locale: "uk" }, deps([market()]));
  assert.ok(made.ok, JSON.stringify(made));
  assert.deepEqual(made.rule.priceCondition, { limitPct: 5, referenceUsd: 150, referenceAt: new Date(NOW).toISOString() });

  /* A week on, the anchor is a week old — a fixed point, never stale — and the price 6 % above it waits. */
  const later = NOW + 7 * 24 * HOUR;
  const above = checkPriceCondition(5, anchorFactsOf({ referenceUsd: 150, referenceAt: new Date(NOW).toISOString() }, { usd: 159, atMs: later - MINUTE }), later);
  assert.equal(above.verdict, "above");
  assert.equal(above.deviationPct, 6);
  assert.equal(above.dataAt, new Date(later - MINUTE).toISOString(), "the data's time is the price's, not the anchor's");
  assert.equal(checkPriceCondition(5, anchorFactsOf({ referenceUsd: 150, referenceAt: new Date(NOW).toISOString() }, { usd: 151, atMs: later - MINUTE }), later).verdict, "met");
  assert.equal(checkPriceCondition(5, anchorFactsOf({ referenceUsd: 150, referenceAt: new Date(NOW).toISOString() }, { usd: 151, atMs: later - 40 * MINUTE }), later).verdict, "stale");
  assert.equal(plain(conditionLine(5, "enabled", "uk")), "Не купувати, якщо дорожче за ціну при ввімкненні правила більш ніж на 5 %");

  /* Paused and turned on again, the condition takes the price now. */
  await setRuleStatus(store, OWNER, RULE_ID, "paused", deps([market()], later));
  const resumed = await setRuleStatus(store, OWNER, RULE_ID, "active", deps([market({ price: 171 })], later));
  assert.ok(resumed.ok, JSON.stringify(resumed));
  assert.deepEqual(resumed.rule.priceCondition, { limitPct: 5, referenceUsd: 171, referenceAt: new Date(later).toISOString() });
});

test("the tick: a meme's reminder is deferred while its pool is under the floor — one note says why — and reminds once it is back", async () => {
  const store = createMemoryGuardStore();
  const made = await createRule(store, { owner: OWNER, mint: FRESH, amountUsd: 2, schedule: WEEKLY_THU_19, locale: "uk" }, deps([NEW_TOKEN]));
  assert.ok(made.ok, JSON.stringify(made));
  const at = DUE + 2 * MINUTE;
  const thin = { ...NEW_TOKEN, liquidityUsd: 18_400 };
  const first = await tickAutoinvest(store, at, { ledger: async () => [], ...venue([thin], at) });
  assert.equal(first.deferred, 1);
  assert.equal(first.reminded, 0);
  const deferred = (await readRule(store, OWNER, RULE_ID)).occurrences.at(-1);
  assert.equal(deferred.state, "deferred");
  assert.equal(deferred.floor.verdict, "below");
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1);
  assert.match(plain(notes[0].title), /^Купівлю відкладено: NEWT — ліквідність \$18 400/);
  assert.ok(notes[0].triggerId.endsWith(`@${FRESH}`), "a token's note carries its mint");

  const again = await tickAutoinvest(store, at + 5 * MINUTE, { ledger: async () => [], ...venue([thin], at + 5 * MINUTE) });
  assert.equal(again.deferred, 0, "one note per occurrence");
  const back = await tickAutoinvest(store, at + 10 * MINUTE, { ledger: async () => [], ...venue([NEW_TOKEN], at + 10 * MINUTE) });
  assert.equal(back.reminded, 1);
  const due = (await readRule(store, OWNER, RULE_ID)).occurrences.at(-1);
  assert.equal(due.state, "due");
  assert.equal(due.floor.verdict, "met");

  /* A read that does not carry the token defers: an unknown is never a pass. */
  const unread = createMemoryGuardStore();
  await createRule(unread, { owner: OWNER, mint: FRESH, amountUsd: 2, schedule: WEEKLY_THU_19, locale: "uk" }, deps([NEW_TOKEN]));
  const blind = await tickAutoinvest(unread, at, { ledger: async () => [], ...venue([], at) });
  assert.equal(blind.deferred, 1);
  assert.equal((await readRule(unread, OWNER, RULE_ID)).occurrences.at(-1).floor.verdict, "unavailable");
});

test("the order route: a token's purchase under its reminder only while the token stands on the floor now", async () => {
  const store = createMemoryGuardStore();
  await createRule(store, { owner: OWNER, mint: SOL, amountUsd: 5, schedule: WEEKLY_THU_19, locale: "uk" }, deps([market()]));
  const at = DUE + 2 * MINUTE;
  await tickAutoinvest(store, at, { ledger: async () => [], ...venue([market()], at) });
  const record = await readRule(store, OWNER, RULE_ID);
  const order = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: SOL, amountRaw: usdToUsdcRaw(5) };
  const binding = { ruleId: RULE_ID, dueAt: new Date(DUE).toISOString() };
  const old = new Date(at - 1000 * HOUR).toISOString();
  const on = checkFloor({ liquidityUsd: 900_000, observedAtMs: at, firstPoolAt: old }, at);
  assert.equal(judgeRuleOrder(record, binding, order, [], at, null, null, on).ok, true);
  const refused = judgeRuleOrder(record, binding, order, [], at, null, null, checkFloor({ liquidityUsd: 9_000, observedAtMs: at, firstPoolAt: old }, at));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "RULE_LIQUIDITY_LOW");
  const unread = judgeRuleOrder(record, binding, order, [], at, null, null, null);
  assert.equal(unread.code, "UNAVAILABLE", "no floor read is no pass — and not called «under the floor»");
  assert.equal(unread.status, 503);
});

test("a token's reminder lands on its market in Spot, set to the rule's purchase; a company's on its page; a note whose rule is gone finds the token by its mint", () => {
  const token = { id: RULE_ID, asset: { symbol: "BONK", mint: BONK, kind: "meme" } };
  const company = { id: RULE_ID, asset: { symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" } };
  const dueAt = new Date(DUE).toISOString();
  assert.equal(rulePurchaseHref(token, dueAt), `/app/spot?mint=${BONK}&rule=${RULE_ID}&due=${encodeURIComponent(dueAt)}`);
  assert.equal(rulePurchaseHref(company, dueAt), `/app/stocks/AAPLx?rule=${RULE_ID}&due=${encodeURIComponent(dueAt)}`);
  assert.equal(ruleAssetHref(token), `/app/spot?mint=${BONK}`);
  assert.equal(ruleAssetHref(company), "/app/stocks/AAPLx");
  const identity = reminderIdentity(RULE_ID, dueAt, BONK);
  assert.equal(symbolOfIdentity(identity), BONK);
  assert.equal(assetHrefOfRef(BONK), `/app/spot?mint=${BONK}`);
  assert.equal(assetHrefOfRef("AAPLx"), "/app/stocks/AAPLx");
});

test("a token under a cent keeps its price to eight significant digits: a $0.0000003 token's rule is written, falls and stands against its own price", async () => {
  const dust = { ...MEME, mint: FRESH, symbol: "DUST", price: 0.00000031234567, verified: false, tags: [], category: null };
  const store = createMemoryGuardStore();
  const dip = await createRule(store, { owner: OWNER, mint: FRESH, amountUsd: 1, kind: "dip", dip: { dropPct: 15, timeZone: "Europe/Kyiv" }, priceCondition: { limitPct: 5 }, locale: "uk" }, deps([dust]));
  assert.ok(dip.ok, JSON.stringify(dip));
  AutoinvestRuleSchema.parse(dip.rule);
  assert.equal(dip.rule.dip.anchorUsd, 0.00000031234567);
  assert.equal(dip.rule.dip.triggerUsd, Number((0.00000031234567 * 0.85).toPrecision(8)));
  assert.equal(dip.rule.priceCondition.referenceUsd, 0.00000031234567);
  assert.equal(keptPriceUsd(335.1234567), 335.123457, "from a dollar up, to a millionth as before");
});

test("a reader built before 1.31.0 never meets «enabled»: a native client reads «market» until it says it reads the new value; the web always reads it", () => {
  const rule = { occurrences: [{ condition: { reference: "enabled", verdict: "above" } }, { condition: null }] };
  const headers = (value) => ({ get: (name) => (name === "X-Ryntra-Reads" && value ? value : null) });
  assert.equal(readsEnabledReference("cookie", headers(null)), true);
  assert.equal(readsEnabledReference("bearer", headers(null)), false);
  assert.equal(readsEnabledReference("bearer", headers("rule-reference-enabled")), true);
  assert.equal(ruleForReader(rule, false).occurrences[0].condition.reference, "market");
  assert.equal(ruleForReader(rule, true), rule);
  const company = { occurrences: [{ condition: { reference: "issuer" } }] };
  assert.equal(ruleForReader(company, false), company, "a company's rule is untouched");
});

test("the tick reads every rule's token, a hundred at a time — never only the first hundred", async () => {
  const mints = Array.from({ length: 150 }, (_, index) => `${String(index).padStart(3, "0")}${SOL.slice(3)}`);
  const calls = [];
  const read = await readTokenMarkets(mints, NOW, {
    readMarkets: async (batch) => {
      calls.push(batch.length);
      return { ok: true, byMint: new Map(batch.map((mint) => [mint, market({ mint })])), observedAt: new Date(NOW).toISOString() };
    },
  });
  assert.deepEqual(calls, [100, 50]);
  assert.equal(read.size, 150);
});

test("a token flagged by the venue's audit since its rule was written: the tick reminds of nothing and the order route is told so", async () => {
  const store = createMemoryGuardStore();
  await createRule(store, { owner: OWNER, mint: FRESH, amountUsd: 2, schedule: WEEKLY_THU_19, locale: "uk" }, deps([NEW_TOKEN]));
  const flagged = { ...NEW_TOKEN, audit: { suspicious: true } };
  const at = DUE + 2 * MINUTE;
  const pass = await tickAutoinvest(store, at, { ledger: async () => [], ...venue([flagged], at) });
  assert.equal(pass.reminded, 0);
  assert.equal(pass.deferred, 0);
  assert.equal((await readRule(store, OWNER, RULE_ID)).occurrences.length, 0, "nothing opened");
  const facts = await ruleOrderFactsOf(await readRule(store, OWNER, RULE_ID), deps([flagged], at));
  assert.equal(facts.flagged, true);
});

test("a meme's price reads in significant digits, never «$0.0000»", () => {
  assert.equal(priceWord(0.00001834, "en"), "$0.00001834");
  assert.equal(priceWord(0.0042, "en"), "$0.0042");
  assert.equal(priceWord(0.4321, "en"), "$0.4321");
  assert.equal(priceWord(150, "uk"), "$150,00");
});
