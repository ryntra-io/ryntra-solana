import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ISSUER_TERMS } from "./issuer-terms.ts";
import { exchangeHour, issuerPowersLine, issuerPowersOf, notAStock, OFF_HOURS_RISK, offHoursRiskLine, poolFactsOf, poolGuardOf, poolSessionOf } from "./pool-facts.ts";

/* The facts a pool page shows for a stock, read from the stocks engine as it is. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
/** The code alone, without its comments. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const NY = { mic: "XNYS", name: "New York Stock Exchange", timezone: "America/New_York" };
/* Tuesday 18 Nov 2026, 15:00 UTC = 10:00 in New York. */
const NOW = Date.parse("2026-11-18T15:00:00.000Z");
const HOUR = 60 * 60_000;

const session = (period, extra = {}) => ({ period, exchangeOpen: period === "market", nextChangeAt: new Date(NOW + 6 * HOUR).toISOString(), exchange: NY, source: "issuer", ...extra });
const row = (over = {}) => ({
  representation: { mint: MINT, issuer: { id: "xstocks", label: "xStocks · Backed Finance" }, exchange: NY },
  session: session("market"),
  ...over,
});

test("a mint the stocks engine does not hold is no stock, and says nothing more", () => {
  assert.deepEqual(poolFactsOf({ mint: MINT, row: null, step: null, nowMs: NOW }), notAStock(MINT));
  assert.deepEqual(notAStock(MINT), { mint: MINT, isStock: false, issuer: null, session: "unknown", nextChangeAt: null, dividendGuard: null, termsUrl: null, kind: null, powers: null, listed: null });
  assert.equal(poolFactsOf({ mint: "So11111111111111111111111111111111111111112", row: row(), step: null, nowMs: NOW }).isStock, false, "a row of another mint is not this mint's");
});

test("a stock: its issuer, the exchange's session, when it next changes, and the issuer's own terms", () => {
  const facts = poolFactsOf({ mint: MINT, row: row(), step: null, nowMs: NOW });
  assert.deepEqual(facts, {
    mint: MINT,
    isStock: true,
    issuer: { id: "xstocks", label: "xStocks · Backed Finance" },
    session: "open",
    nextChangeAt: new Date(NOW + 6 * HOUR).toISOString(),
    dividendGuard: null,
    termsUrl: ISSUER_TERMS.xstocks.document.url,
    kind: "listed-equity",
    powers: null,
    listed: null,
  });
  for (const id of ["xstocks", "ondo", "backpack", "prestocks"]) {
    const other = poolFactsOf({ mint: MINT, row: row({ representation: { ...row().representation, issuer: { id, label: id } } }), step: null, nowMs: NOW });
    assert.equal(other.termsUrl, ISSUER_TERMS[id].document.url, id);
  }
  const past = poolFactsOf({ mint: MINT, row: row({ session: session("closed", { nextChangeAt: new Date(NOW - HOUR).toISOString() }) }), step: null, nowMs: NOW });
  assert.equal(past.nextChangeAt, null, "a change already behind is no next change");
  const silent = poolFactsOf({ mint: MINT, row: row({ session: { period: "unknown", exchangeOpen: null, nextChangeAt: new Date(NOW + HOUR).toISOString(), exchange: null, source: "none" } }), step: null, nowMs: NOW });
  assert.deepEqual([silent.session, silent.nextChangeAt], ["unknown", null], "no source said the state: no time either");
});

test("the session comes from the issuer's own period, and extended hours split at the exchange's noon", () => {
  assert.equal(poolSessionOf(session("market"), NOW), "open");
  assert.equal(poolSessionOf(session("closed"), NOW), "closed");
  assert.equal(poolSessionOf(session("overnight"), NOW), "closed", "the issuer's overnight period is no regular session");
  /* 08:00 and 17:00 in New York, in November (UTC−5). */
  assert.equal(poolSessionOf(session("extended"), Date.parse("2026-11-18T13:00:00Z")), "pre");
  assert.equal(poolSessionOf(session("extended"), Date.parse("2026-11-18T22:00:00Z")), "post");
  /* In July New York is UTC−4: 11:30 there is still the morning. */
  assert.equal(poolSessionOf(session("extended"), Date.parse("2026-07-15T15:30:00Z")), "pre");
  assert.equal(poolSessionOf(session("extended", { exchange: null }), NOW), "closed", "no zone to tell them apart: the regular session is not on");
  assert.equal(poolSessionOf(session("extended", { exchange: null }), Date.parse("2026-11-18T22:00:00Z"), "America/New_York"), "post", "the representation's zone stands in");
  /* The feed catalogue's record, when the issuer says none: open or shut, nothing else. */
  assert.equal(poolSessionOf({ period: "market", exchangeOpen: true, nextChangeAt: null, exchange: null, source: "feed-catalogue" }, NOW), "open");
  assert.equal(poolSessionOf({ period: "unknown", exchangeOpen: false, nextChangeAt: null, exchange: null, source: "none" }, NOW), "closed");
  assert.equal(poolSessionOf({ period: "unknown", exchangeOpen: null, nextChangeAt: null, exchange: null, source: "none" }, NOW), "unknown");
  assert.equal(exchangeHour(NOW, "America/New_York"), 10);
  assert.equal(exchangeHour(NOW, "Not/AZone"), null);
  assert.equal(exchangeHour(NOW, null), null);
});

test("the calendar is the source's, never a weekday rule written here", () => {
  const source = code("./pool-facts.ts");
  assert.doesNotMatch(source, /getDay\(|getUTCDay\(|Saturday|Sunday|Monday|weekday/i);
  assert.doesNotMatch(source, /fetch\(/, "the pure read goes nowhere");
  /* Saturday: the issuer says closed, and closed it is — whatever the hour. */
  assert.equal(poolSessionOf(session("closed"), Date.parse("2026-11-21T15:00:00Z")), "closed");
  /* A holiday the issuer marks closed on a Thursday stays closed (Thanksgiving, 26 Nov 2026). */
  assert.equal(poolSessionOf(session("closed"), Date.parse("2026-11-26T16:00:00Z")), "closed");
});

test("the dividend guard is the Stock Pier's own window, as dates", () => {
  const at = NOW + 3 * 24 * HOUR;
  const dividend = { at: new Date(at).toISOString(), from: 1, to: 1.0042 };
  const ahead = poolGuardOf(dividend, NOW);
  assert.deepEqual(ahead, { from: new Date(at - 24 * HOUR).toISOString(), to: new Date(at + 15 * 60_000).toISOString(), step: "dividend", now: false });
  assert.equal(poolGuardOf(dividend, at - HOUR).now, true, "inside the day before: new deposits wait now");
  assert.equal(poolGuardOf(dividend, at + 10 * 60_000).now, true, "the issuer's quarter of an hour after");
  assert.equal(poolGuardOf(dividend, at + 16 * 60_000), null, "past");
  assert.equal(poolGuardOf({ ...dividend, at: new Date(NOW + 9 * 24 * HOUR).toISOString() }, NOW), null, "not in sight yet");
  const split = poolGuardOf({ at: new Date(at).toISOString(), from: 1, to: 2 }, at - 10 * 60_000);
  assert.deepEqual(split, { from: new Date(at - 15 * 60_000).toISOString(), to: new Date(at + 15 * 60_000).toISOString(), step: "split", now: true }, "a split holds only the quarter of an hour either side");
  assert.equal(poolGuardOf(null, NOW), null);
  const facts = poolFactsOf({ mint: MINT, row: row(), step: dividend, nowMs: NOW });
  assert.deepEqual(facts.dividendGuard, ahead);
});

test("the risk line: only on a stock whose exchange is not open, in English and Ukrainian", () => {
  const open = poolFactsOf({ mint: MINT, row: row(), step: null, nowMs: NOW });
  const closed = poolFactsOf({ mint: MINT, row: row({ session: session("closed") }), step: null, nowMs: NOW });
  const pre = poolFactsOf({ mint: MINT, row: row({ session: session("extended") }), step: null, nowMs: Date.parse("2026-11-18T13:00:00Z") });
  assert.equal(offHoursRiskLine(open, "en"), null, "the exchange is open");
  assert.equal(offHoursRiskLine(notAStock(MINT), "uk"), null, "no stock");
  assert.equal(offHoursRiskLine(null, "en"), null, "nothing read");
  assert.equal(offHoursRiskLine(closed, "en"), "Outside exchange hours the price stands still; at the open it may jump.");
  assert.equal(offHoursRiskLine(closed, "uk"), "Поза годинами біржі ціна стоїть, на відкритті може стрибнути.");
  assert.equal(pre.session, "pre");
  assert.equal(offHoursRiskLine(pre, "uk"), OFF_HOURS_RISK.uk, "before the open the price stands too");
  assert.equal(offHoursRiskLine({ ...closed, session: "unknown" }, "en"), OFF_HOURS_RISK.en, "an unstated session is never read as open");
});

test("the server's reader reads the engine's warm copies only, and the door is a public read", () => {
  const server = read("./pool-facts.server.ts");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /readStockUniverse\(\)/);
  assert.match(server, /readOnchainMintCached\(mint\)/);
  assert.match(server, /if \(!universe\?\.ok\) return null;/, "a universe that did not answer is no «not a stock»");
  const door = read("../../app/api/v1/stocks/pool-facts/route.ts");
  assert.match(door, /export async function GET/);
  assert.doesNotMatch(door, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(door, /consumeSolanaReadRequest/);
  assert.match(door, /BASE58\.test\(mint\)/);
});

test("the facts say nothing of a country: the issuer's terms are a link, never a refusal", () => {
  for (const path of ["./pool-facts.ts", "./pool-facts.server.ts"]) {
    const source = code(path);
    assert.doesNotMatch(source, /excluded|limited|country|block/i, path);
    assert.doesNotMatch(source, /private|приватн/i, path);
  }
});

/* What the mint lets the issuer do, read from its own extensions, in one line a person reads. */
test("the issuer's powers over the token: a permanent delegate takes, a pause stops — said without the chain's words", () => {
  const ANT = "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe";
  /* ANT as the chain stated it on 19.11: a permanent delegate and a pause config, not paused. */
  const ant = { permanentDelegate: "2cVYpagTDelegate1111111111111111111111af4a", pausable: { paused: false } };
  assert.deepEqual(issuerPowersOf(ant), { take: true, pause: true, paused: false });
  assert.equal(issuerPowersLine(issuerPowersOf(ant), "uk"), "Емітент може зупинити й забрати токен");
  assert.equal(issuerPowersLine(issuerPowersOf(ant), "en"), "The issuer can pause and take the token");
  assert.equal(issuerPowersLine(issuerPowersOf({ permanentDelegate: "x".repeat(32), pausable: null }), "uk"), "Емітент може забрати токен");
  assert.equal(issuerPowersLine(issuerPowersOf({ permanentDelegate: null, pausable: { paused: false } }), "uk"), "Емітент може зупинити перекази");
  assert.equal(issuerPowersLine(issuerPowersOf({ permanentDelegate: null, pausable: { paused: true } }), "uk"), "Перекази зупинено емітентом");
  assert.equal(issuerPowersOf({ permanentDelegate: null, pausable: null }), null, "a mint that gives neither says nothing");
  assert.equal(issuerPowersOf(null), null, "a mint not read says nothing — never «none»");
  assert.equal(issuerPowersLine(null, "uk"), null);
  /* No word of the chain's reaches a person. */
  for (const lang of ["en", "uk"]) for (const line of [issuerPowersLine({ take: true, pause: true, paused: false }, lang), issuerPowersLine({ take: true, pause: true, paused: true }, lang)]) assert.doesNotMatch(line, /delegate|token-2022|extension|делегат/i);
  /* On a stock's facts, from the same read. */
  const facts = poolFactsOf({ mint: ANT, row: row({ representation: { mint: ANT, issuer: { id: "backpack", label: "Backpack Securities" }, exchange: null } }), step: null, nowMs: NOW, rights: ant });
  assert.deepEqual(facts.powers, { take: true, pause: true, paused: false });
  assert.equal(facts.kind, "listed-equity");
  assert.equal(facts.listed, null);
});

test("a private token whose company went public says so: Anthropic, its ticker and its share on Solana", () => {
  const PRE = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
  const pre = row({ representation: { mint: PRE, issuer: { id: "prestocks", label: "PreStocks" }, exchange: null, instrument: { class: "pre-ipo" } } });
  const facts = poolFactsOf({ mint: PRE, row: pre, step: null, nowMs: NOW });
  assert.equal(facts.kind, "pre-ipo");
  assert.deepEqual(facts.listed, { company: "Anthropic", ticker: "ANT", solana: { mint: "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe", symbol: "ANT" } });
  /* A private company that has announced nothing stays private. */
  const KALSHI = "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua";
  assert.equal(poolFactsOf({ mint: KALSHI, row: row({ representation: { ...pre.representation, mint: KALSHI } }), step: null, nowMs: NOW }).listed, null);
});
