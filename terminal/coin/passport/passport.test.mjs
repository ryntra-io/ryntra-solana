import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { ageText, factRows, headFigures, headFiguresKnown, passportOf, passportSentence, peopleText, riskLine, riskSentence, shareText, LINE_MAX, SAY_MAX } from "./passport-data.ts";
import { standCoins } from "./stand-coins.ts";

/* The coin's passport: three reads as one model, the head's row, the line by the buy button, the list behind
   «i» and the agent's sentence; and the passport's parts keep to the terminal's rules. */

const NOW = Date.parse("2026-11-19T18:00:00.000Z");
const coins = standCoins(NOW);
const of = (key) => passportOf(coins[key]);
const NBSP = "\u00a0";

test("nothing read is no passport; any one read is one", () => {
  assert.equal(passportOf({ mint: "x", market: null, facts: null, risk: null, now: NOW }), null);
  assert.ok(passportOf({ mint: "x", market: null, facts: null, risk: [], now: NOW }));
  assert.ok(passportOf({ ...coins.old, facts: null, risk: null }));
  assert.ok(passportOf({ ...coins.old, market: null, risk: null }));
});

test("the model takes each figure from the read that has it, and leaves null what none gave", () => {
  const old = of("old");
  assert.equal(old.fdvUsd, 2_430_000_000);
  assert.equal(old.traders24h, 18_420);
  assert.deepEqual(old.changes, { m5: 0.12, h1: 0.61, h6: -1.08, h24: 3.42 });
  assert.equal(old.ageMs, (2 * 365 + 40) * 86_400_000);
  assert.deepEqual(old.creator, { known: true, holdsPct: 3.8, launches: 2, listed: 2 });
  assert.equal(old.minting, "off");
  assert.equal(old.freezing, "off");
  assert.equal(old.sell, "ok");
  assert.equal(old.stage, null, "no launchpad, no curve: no stage");

  /* Without the overview, the market's own hour and day still stand; five minutes and six hours are unknown. */
  const marketOnly = passportOf({ ...coins.old, facts: null, risk: null });
  assert.deepEqual(marketOnly.changes, { m5: null, h1: 0.61, h6: null, h24: 3.42 });
  assert.equal(marketOnly.creator.launches, null);
  assert.equal(marketOnly.creator.known, true, "the market's creator share names the creator");

  /* Without the market, the risk facts carry the rights, the shares and the creator's coins. */
  const riskOnly = passportOf({ ...coins.risky, market: null, facts: null });
  assert.equal(riskOnly.minting, "on");
  assert.equal(riskOnly.freezing, "on");
  assert.equal(riskOnly.top10Pct, 68.4);
  assert.equal(riskOnly.creator.holdsPct, 22.5);
  assert.equal(riskOnly.creator.launches, 37);
  assert.equal(riskOnly.fdvUsd, null);
  assert.equal(riskOnly.ageMs, null);
});

test("the stage: on the curve with its share where it was read, listed once it left, none where nothing says", () => {
  const fresh = of("fresh");
  assert.equal(fresh.venue, "pump.fun");
  assert.equal(fresh.stage, "curve");
  assert.equal(fresh.curvePct, 63.2);
  assert.equal(passportOf({ ...coins.fresh, curve: null }).curvePct, null, "on the curve, its share unread");
  assert.equal(passportOf({ ...coins.fresh, curve: { progressPct: 100, complete: true } }).stage, "listed");
  const bare = of("noCreator");
  assert.equal(bare.venue, "Meteora", "the launchpad by the name people know");
  assert.equal(bare.stage, "listed");
  assert.ok(bare.listedAt > 0);
  assert.equal(bare.creator.known, false);
});

test("a stock has no creator, no top-10 line and no curve: its issuer's rights are its design", () => {
  const stock = passportOf({ ...coins.old, market: { ...coins.old.market, category: "stock" } });
  assert.equal(stock.stock, true);
  assert.deepEqual(stock.creator, { known: false, holdsPct: null, launches: null, listed: null });
  assert.equal(stock.top10Pct, null);
  assert.deepEqual(riskLine(stock, "en"), { items: [], attention: false });
  assert.equal(passportSentence(stock, "en"), null);
  assert.ok(!factRows(stock, "en").some((row) => ["creator", "launches", "top10", "mint", "freeze"].includes(row.key)));
});

test("figures for the eye: shares, people and ages, short, in each language's own way", () => {
  assert.equal(shareText(41.24, "en"), "41%");
  assert.equal(shareText(4.06, "en"), "4.1%");
  assert.equal(shareText(4, "en"), "4%");
  assert.equal(shareText(4.06, "uk"), "4,1%");
  assert.equal(shareText(0.04, "en"), "<0.1%");
  assert.equal(shareText(0, "en"), "0%");
  assert.equal(peopleText(812, "en"), "812");
  assert.equal(peopleText(4_120, "en"), "4,120");
  assert.equal(peopleText(4_120, "uk"), `4${NBSP}120`);
  assert.equal(peopleText(18_420, "en"), "18.4K");
  assert.equal(peopleText(1_400_000, "uk"), "1,4M");
  assert.equal(ageText(20_000, "en"), "1m");
  assert.equal(ageText(38 * 60_000, "uk"), "38 хв");
  assert.equal(ageText(5 * 3_600_000, "en"), "5h");
  assert.equal(ageText(12 * 86_400_000, "uk"), "12 д");
  assert.equal(ageText(214 * 86_400_000, "en"), "7mo");
  assert.equal(ageText(770 * 86_400_000, "uk"), "2 р");
});

test("the head's row: the figures it lacks, in the best terminals' order, «—» only for what no read gave", () => {
  const row = headFigures(of("old"), "en");
  assert.deepEqual(row.map((f) => f.key), ["fdv", "m5", "h1", "h6", "traders", "age"]);
  assert.deepEqual(row.map((f) => f.value), ["$2.43B", "+0.12%", "+0.61%", "−1.08%", "18.4K", "2y"]);
  assert.deepEqual(row.map((f) => f.tone), [undefined, "up", "up", "down", undefined, undefined]);
  const uk = headFigures(of("fresh"), "uk");
  assert.deepEqual(uk.map((f) => f.label), ["Повна оцінка", "5 хв", "1 год", "6 год", "Трейдери 24 год", "Вік"]);
  assert.deepEqual(uk.map((f) => f.value), ["$41K", "+12,40%", "+42,70%", "+186,40%", "386", "38 хв"]);
  const reading = headFigures(null, "en");
  assert.equal(reading.length, 6, "the row keeps its place while it reads");
  assert.ok(reading.every((f) => f.value === "—"));
  const marketOnly = headFigures(passportOf({ ...coins.old, facts: null, risk: null }), "en");
  assert.deepEqual(marketOnly.map((f) => f.value), ["$2.43B", "—", "+0.61%", "—", "18.4K", "2y"]);
});

test("a passport that knows none of the head's figures gives the head no second row, never a row of dashes", () => {
  assert.equal(headFiguresKnown(null), false);
  assert.equal(headFiguresKnown(of("old")), true);
  const blank = { ...of("old"), fdvUsd: null, traders24h: null, ageMs: null, changes: { m5: null, h1: null, h6: null, h24: null } };
  assert.equal(headFiguresKnown(blank), false);
  const screen = readFileSync(new URL("../CoinScreen.tsx", import.meta.url), "utf8");
  assert.ok(screen.includes("headFiguresKnown(passport)"), "the coin's page mounts the row only when a figure is known");
  const row = readFileSync(new URL("./Passport.tsx", import.meta.url), "utf8");
  assert.ok(row.includes("figure.value !== w.unknown"), "an unknown figure is left out of the row, not dashed");
});

test("the risk line: three or four short facts, what is worth a look first, one quiet sign only when there is", () => {
  const old = riskLine(of("old"), "en");
  assert.deepEqual(old.items.map((i) => i.text), ["Creator holds 3.8%", "Creator launched 2 coins, 2 listed", "Top 10 hold 41%", "No minting, no freezing"]);
  assert.equal(old.attention, false);

  const fresh = riskLine(of("fresh"), "uk");
  assert.deepEqual(fresh.items.map((i) => i.text), ["Творець тримає 4,1%", "Творець запустив 14 монет, 1 на біржі", "10 найбільших — 27%", "Крива pump.fun — 63%"]);
  assert.equal(fresh.attention, false);

  const bare = riskLine(of("noCreator"), "en");
  assert.deepEqual(bare.items.map((i) => i.text), ["Top 10 hold 19%", "No minting, no freezing", "Listed from Meteora"]);
  assert.ok(!bare.items.some((i) => /creator/i.test(i.text)), "no creator fact when none is known — never «Creator —»");

  const risky = riskLine(of("risky"), "en");
  assert.equal(risky.attention, true);
  assert.deepEqual(risky.items.map((i) => [i.text, i.tone]), [
    ["Creator holds 23%", "warn"],
    ["Creator launched 37 coins, 0 listed", "plain"],
    ["Top 10 hold 68%", "warn"],
    ["New coins can still be minted", "warn"],
  ]);

  for (const key of Object.keys(coins)) for (const lang of ["en", "uk"]) assert.ok(riskLine(of(key), lang).items.length <= LINE_MAX);
  assert.deepEqual(riskLine(null, "en"), { items: [], attention: false });
});

test("the line keeps what is worth a look even when more than four facts stand", () => {
  const p = { ...of("risky"), flagged: true, sell: "blocked" };
  const line = riskLine(p, "uk");
  assert.equal(line.items.length, LINE_MAX);
  assert.ok(line.items.every((i) => i.tone === "warn"));
  assert.deepEqual(line.items.map((i) => i.key), ["flagged", "sell", "creatorHolds", "top10"]);
});

test("behind «i»: every fact, «—» only where nothing was said, the creator never «—» once known", () => {
  const old = factRows(of("old"), "en");
  assert.deepEqual(old.map((r) => r.key), ["creator", "launches", "top10", "mint", "freeze", "holders", "liquidity", "liquidityDay", "age", "sell"]);
  assert.deepEqual(Object.fromEntries(old.map((r) => [r.key, r.value])), {
    creator: "3.8%",
    launches: "2 · 2 listed",
    top10: "41%",
    mint: "Off",
    freeze: "Off",
    holders: "812.4K",
    liquidity: "$12.4M",
    liquidityDay: "+1.20%",
    age: "2y",
    sell: "Works",
  });
  const bare = factRows(of("noCreator"), "uk");
  assert.equal(bare.find((r) => r.key === "creator").value, "Творця не названо");
  assert.equal(bare.find((r) => r.key === "venue").value, "Meteora");
  /* A creator named by their wallet alone is «known», not «—». */
  const walletOnly = passportOf({ ...coins.old, market: { ...coins.old.market, audit: { ...coins.old.market.audit, devBalancePct: null } }, facts: { ...coins.old.facts, devMints: null }, risk: [] });
  assert.equal(factRows(walletOnly, "en").find((r) => r.key === "creator").value, "Creator known");
  for (const key of Object.keys(coins)) {
    for (const row of factRows(of(key), "en")) if (row.key === "creator") assert.notEqual(row.value, "—", key);
  }
  const risky = factRows(of("risky"), "en");
  assert.deepEqual(risky.filter((r) => r.tone === "warn").map((r) => r.key), ["creator", "top10", "mint", "freeze", "liquidityDay"]);
});

test("the agent's sentence: facts in a sentence, in both languages, no advice", () => {
  assert.equal(passportSentence(of("fresh"), "en"), "Creator launched 14 coins, 1 listed; creator holds 4.1%; top 10 hold 27%");
  assert.equal(passportSentence(of("fresh"), "uk"), "Творець запустив 14 монет, 1 вийшла на біржу; творець тримає 4,1%; 10 найбільших тримають 27%");
  assert.equal(passportSentence(of("noCreator"), "uk"), "10 найбільших тримають 19%; монеті 7 міс");
  assert.equal(passportSentence(of("risky"), "en"), "Creator holds 23%; top 10 hold 68%; new coins can still be minted");
  assert.equal(passportSentence(of("risky"), "uk"), "Творець тримає 23%; 10 найбільших тримають 68%; нові монети ще можна випустити");
  const uk = passportSentence({ ...of("risky"), minting: "off", freezing: "off", creator: { known: true, holdsPct: 2, launches: 37, listed: 0 }, top10Pct: 20 }, "uk");
  assert.equal(uk, "Творець запустив 37 монет, жодна не вийшла на біржу; творець тримає 2%; 10 найбільших тримають 20%");
  assert.equal(passportSentence(null, "en"), null);
  for (const key of Object.keys(coins)) {
    for (const lang of ["en", "uk"]) {
      const said = passportSentence(of(key), lang);
      assert.ok(said.split("; ").length <= SAY_MAX);
      assert.doesNotMatch(said, /\bbuy\b|\bsell\b|купу|купи|прода|guarantee|гарант|x\d|\d+x\b/i, `${key} ${lang}: «${said}»`);
    }
  }
});

/* ------------------------------------------------------------------------------------- the parts keep the rules */

const DIR = new URL("./", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), "utf8");
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the passport's parts read only, touch no shared file, and write no colour or size of their own", () => {
  const files = readdirSync(DIR).filter((name) => /\.(tsx?|css)$/.test(name));
  for (const name of files) {
    const text = code(read(name));
    assert.doesNotMatch(text, /signTransaction|sendTransaction|signMessage|secretKey|privateKey/i, `${name} reads only`);
    assert.doesNotMatch(text, /from ['"](?:\.\.\/|@\/terminal\/coin\/)(?:desk-words|words|CoinHead|CoinFacts|Ticket|CoinScreen)['"]/, `${name} takes no shared word or screen of the coin`);
    if (name.endsWith(".css")) assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${name}: colours are tokens`);
  }
  const hook = code(read("usePassport.ts"));
  for (const url of ["/api/spot/market", "part=overview", "part=risk", "feed=watchlist"]) assert.ok(hook.includes(url), `the reading asks ${url}`);
  assert.doesNotMatch(hook, /method:\s*['"](POST|PUT|DELETE)/, "reads only");
});

test("one sentence of risk over the buy button: the fact worth a look first; none — no sentence; a stock or no passport — none", () => {
  const risky = of("risky");
  const line = riskLine(risky, "en");
  const warn = line.items.find((item) => item.tone === "warn");
  assert.ok(warn, "the risky coin has a fact worth a look");
  assert.equal(riskSentence(risky, "en"), warn.text);
  assert.equal(riskSentence(risky, "uk"), riskLine(risky, "uk").items.find((item) => item.tone === "warn").text);
  for (const key of ["old", "fresh", "noCreator"]) {
    const passport = of(key);
    const expected = riskLine(passport, "en").items.find((item) => item.tone === "warn")?.text ?? null;
    assert.equal(riskSentence(passport, "en"), expected, key);
  }
  assert.equal(riskSentence(null, "en"), null);
  assert.equal(riskSentence({ ...risky, stock: { issuer: "Backpack Securities" } }, "en"), null);
});

test("the coin's screen mounts that sentence alone: over the buy button on a desk, under the price on a phone", () => {
  const screen = readFileSync(new URL("../CoinScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /const risk = riskSentence\(passport, passportLang\) \? <PassportRiskSentence passport=\{passport\} \/> : null;/);
  assert.match(screen, /\{risk \? <div className=\{u\.phoneRisk\}>\{risk\}<\/div> : null\}/);
  assert.match(screen, /foot=\{facts\(true\)\} risk=\{risk \?\? undefined\} supply=\{cap\}/);
  assert.doesNotMatch(screen, /<PassportRisk\b/);
});
