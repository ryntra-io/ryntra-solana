import assert from "node:assert/strict";
import test from "node:test";

import {
  borrowedNameOf,
  FLAG_AGE_HOURS,
  FLAG_CREATOR_LAUNCHES,
  FLAG_HOLDERS,
  FLAG_LIQUIDITY_USD,
  passesFilter,
  PULSE_FILTER_NONE,
  pulseFlagsOf,
  pulseUnstatedOf,
  shortMint,
  twinsOf,
} from "./pulse.ts";

/* SOL-C5 (аудит UX 21.10: UX-101, UX-150, UX-154): a row's risk flags count what its card says, by thresholds the same
   for every token; a borrowed name is marked; copies of one name in a feed are told apart by their address. */

const NOW = Date.parse("2026-10-21T12:00:00Z");
const win = { changePct: null, volumeUsd: null, holdersChangePct: null };

function row(overrides = {}) {
  return {
    mint: "7RpfQ1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaapump",
    symbol: "GOBLO",
    name: "Goblin Lord",
    icon: null,
    launchpad: "pump.fun",
    venue: "pump",
    graduated: false,
    price: 0.00004,
    marketCapUsd: 41_000,
    liquidityUsd: 18_000,
    holders: 210,
    holdersAtLeast: false,
    windows: { m5: win, h1: win, h6: win, h24: win },
    firstPoolAt: "2026-10-21T11:00:00Z",
    graduatedAt: null,
    top10Pct: 20,
    devPct: 2,
    creatorLaunches: 1,
    creatorGraduated: 0,
    verified: false,
    organic: null,
    auditRead: true,
    notices: [],
    curve: null,
    ryntra: null,
    ...overrides,
  };
}

test("a token with nothing past a threshold has no flag; the thresholds are one rule for every token", () => {
  assert.deepEqual(pulseFlagsOf(row(), NOW), []);
  assert.equal(FLAG_CREATOR_LAUNCHES, 10);
  assert.equal(FLAG_LIQUIDITY_USD, 1_000);
  assert.equal(FLAG_HOLDERS, 10);
  assert.equal(FLAG_AGE_HOURS * 60, 10);
});

test("«0» on a 25-second copy is gone: the card's risks count — the creator's tokens, a thin or unstated pool, a handful of holders, minutes on the market", () => {
  const trump = row({ symbol: "TRUMP", name: "OFFICIAL TRUMP", liquidityUsd: null, holders: 2, firstPoolAt: "2026-10-21T11:59:35Z", creatorLaunches: 446 });
  assert.deepEqual(pulseFlagsOf(trump, NOW), ["BORROWED_NAME", "CREATOR_MANY", "LIQUIDITY_THIN", "HOLDERS_FEW", "BRAND_NEW"]);
  assert.deepEqual(pulseFlagsOf(row({ liquidityUsd: 640 }), NOW), ["LIQUIDITY_THIN"]);
  assert.deepEqual(pulseFlagsOf(row({ holders: 9, holdersAtLeast: true }), NOW), [], "a floor of holders is not a count of them");
  assert.deepEqual(pulseFlagsOf(row({ holders: null, creatorLaunches: null }), NOW), [], "not stated is not counted against a token — only a pool nobody states is");
  assert.deepEqual(pulseUnstatedOf(row({ holders: null, creatorLaunches: null, auditRead: false }), NOW), ["RIGHTS", "HOLDERS", "CREATOR"], "…nor as passed: the row says «?», never «0»");
  assert.deepEqual(pulseUnstatedOf(row(), NOW), []);
  assert.deepEqual(pulseFlagsOf(row({ notices: ["MINT_AUTHORITY", "FLAGGED"] }), NOW), ["MINT_AUTHORITY", "FLAGGED"], "the token page's own facts stay first");
});

test("a borrowed name: a known brand's or person's name or ticker on a token Jupiter has not verified — never on the original", () => {
  assert.equal(borrowedNameOf(row({ symbol: "TRUMP", name: "OFFICIAL TRUMP" })), "Donald Trump");
  assert.equal(borrowedNameOf(row({ symbol: "Solana", name: "The Nietzschean Solana" })), "Solana");
  assert.equal(borrowedNameOf(row({ symbol: "JUP", name: "Jupiter" })), "Jupiter");
  assert.equal(borrowedNameOf(row({ symbol: "TRUMP", name: "OFFICIAL TRUMP", verified: true })), null, "the verified token is the original");
  assert.equal(borrowedNameOf(row()), null);
  assert.equal(borrowedNameOf(row({ symbol: "WALT", name: "Waltman" })), null, "a mark on a trading token needs the whole word, not a part of another");
  assert.equal(borrowedNameOf(row({ symbol: "SAM", name: "Sam Altman" })), "Sam Altman");
  assert.equal(borrowedNameOf(row({ symbol: "WLF", name: "Wolf" })), null, "a ticker on the market is read as written, not through look-alike letters");
  assert.equal(borrowedNameOf(row({ symbol: "COLN", name: "Colin" })), null);
  assert.equal(borrowedNameOf(row({ symbol: "TRUMP", name: "Trump", ryntra: { preset: "x", technicalValidation: false, launchedAt: "2026-10-21T11:00:00Z", traded24h: null, daysSinceDex: null, dollarPair: true } })), null, "a launch on Ryntra passed the same check before it was built");
});

test("«Only tokens with no risk flag» asks for the facts read and none of the flags", () => {
  const filter = { ...PULSE_FILTER_NONE, noNotices: true };
  assert.equal(passesFilter(row(), filter, "h1", NOW), true);
  assert.equal(passesFilter(row({ liquidityUsd: null }), filter, "h1", NOW), false);
  assert.equal(passesFilter(row({ symbol: "TRUMP", name: "OFFICIAL TRUMP" }), filter, "h1", NOW), false);
  assert.equal(passesFilter(row({ auditRead: false }), filter, "h1", NOW), false);
  assert.equal(passesFilter(row({ holders: null }), filter, "h1", NOW), false, "a figure nobody stated is not «no flag»");
});

test("a launch on Ryntra still on its curve: the curve is its pool, so no «liquidity not stated»", () => {
  const ryntra = { preset: "x", technicalValidation: false, launchedAt: "2026-10-21T11:00:00Z", traded24h: null, daysSinceDex: null, dollarPair: true };
  assert.deepEqual(pulseFlagsOf(row({ ryntra, liquidityUsd: null, curve: { venue: "meteora-dbc", progressPct: 12, complete: false } }), NOW), []);
  assert.deepEqual(pulseFlagsOf(row({ ryntra, liquidityUsd: null, curve: null }), NOW), ["LIQUIDITY_THIN"]);
});

test("copies of one name in a feed: each knows how many others share its ticker and name, and shows its own short address", () => {
  const a = row({ mint: "A1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaapump", symbol: "PAKT", name: "Pakt" });
  const b = row({ mint: "B2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbpump", symbol: "pakt ", name: "PAKT" });
  const c = row({ mint: "C3cccccccccccccccccccccccccccccccccccpump", symbol: "PAKT", name: "Pakt", windows: { m5: win, h1: win, h6: win, h24: win } });
  const d = row({ mint: "D4dddddddddddddddddddddddddddddddddddpump", symbol: "PAKT", name: "Another" });
  const twins = twinsOf([a, b, c, d]);
  assert.equal(twins.get(a.mint), 2);
  assert.equal(twins.get(b.mint), 2);
  assert.equal(twins.has(d.mint), false, "the same ticker under another name is another token's name");
  assert.equal(shortMint(a.mint), "A1aa…pump");
  assert.equal(shortMint("short"), "short");
});
