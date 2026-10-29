// DSC-1 «Події ринку — одна стрічка подій»: events from the chain, the market and MarketOS — each
// with its source, its time and its link on the chain; one fact, one record (`signature:index`); Pulse's risk flags; a
// suspicious token's event visible with its reason, never at the top; «подія», never «сигнал»; no trade button; no wallet.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MarketEventsResponseSchema } from "../api/v1/contract.ts";
import { EVENTS_WORDS } from "../../app/app/markets/events/events-words.ts";
import { pulseRowOf } from "../spot/pulse.ts";
import {
  authorityEventsOf,
  coverageOf,
  createdEventsOf,
  createSightings,
  EVENT_COVERAGE,
  EVENT_GROUPS,
  EVENT_INDEX,
  EVENT_KINDS,
  eventKindsOf,
  eventViewOf,
  journalEventsOf,
  liquidityEventsOf,
  listedEventsOf,
  mergeEvents,
  NEW_TOKENS_MAX,
  orderEvents,
  SUSPICIOUS_FLOOR,
  unlockEventsOf,
  vaultEventOf,
} from "./market-events.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const NOW = Date.parse("2026-10-24T12:00:00Z");
const OBSERVED = "2026-10-24T12:00:00.000Z";
const READ = { observedAt: OBSERVED, stale: false, now: NOW };
const win = { changePct: null, volumeUsd: null, holdersChangePct: null, liquidityChangePct: null };
const SIG = (n) => `5VERv8NMvzbJMEkV8xnNeM5Gd6ZX7kFDPeQhu3aLgqLjc2SBXSqfxN5cWWoGmPUbP4T2ibsQYh9pGFyQdoBfbT${"abcdefghijk"[n]}W`;
const MINT = "7RpfQ1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaapump";
const POOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ESCROW = "BxoQfrYTkfgFbNpgXGSoGSWvvcJCZqcxpierDrt1h7gZ";

function row(overrides = {}) {
  return {
    mint: MINT,
    symbol: "GOBLO",
    name: "Goblin Lord",
    icon: "https://example.org/goblo.png",
    launchpad: "pump.fun",
    venue: "pump",
    graduated: false,
    price: 0.00004,
    marketCapUsd: 41_000,
    liquidityUsd: 18_000,
    holders: 210,
    holdersAtLeast: false,
    windows: { m5: win, h1: win, h6: win, h24: win },
    firstPoolAt: "2026-10-24T11:40:00Z",
    graduatedAt: null,
    graduatedPool: null,
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

const ryntraRow = (overrides = {}) =>
  row({ mint: "RyntraLaunch11111111111111111111111111111111", symbol: "FEN", name: "Fen Market", launchpad: "Ryntra", venue: "meteora-dbc", ryntra: { preset: "micro", technicalValidation: false, launchedAt: "2026-10-23T10:00:00Z", traded24h: true, daysSinceDex: 0, dollarPair: true }, ...overrides });

const launch = (overrides = {}) => ({ row: ryntraRow(), network: "mainnet", pair: { symbol: "USDC", decimals: 6 }, tokenDecimals: 6, observedAt: OBSERVED, now: NOW, ...overrides });

const entry = (kind, n, overrides = {}) => ({ kind, at: `2026-10-24T11:${String(10 + n).padStart(2, "0")}:00.000Z`, signature: SIG(n), actor: "creator", pairRaw: null, tokensRaw: null, soldBps: null, soldOf: null, ...overrides });

test("a new token from Jupiter: its type, when its first pool was made and when Ryntra saw it, Jupiter as the source, the mint on the explorer — reported, not confirmed", () => {
  const [event] = createdEventsOf([row()], READ);
  assert.equal(event.kind, "TOKEN_CREATED");
  assert.equal(event.id, `jupiter:${MINT}:TOKEN_CREATED`);
  assert.equal(event.happenedAt, "2026-10-24T11:40:00Z");
  assert.equal(event.observedAt, OBSERVED);
  assert.deepEqual(event.sources, ["jupiter"]);
  assert.equal(event.finality, "reported");
  assert.equal(event.signature, null);
  assert.equal(event.account, MINT);
  assert.deepEqual(event.route, { from: "pump", to: null });
  assert.equal(eventViewOf(event).explorerUrl, `https://explorer.solana.com/address/${MINT}`);
  /* A token Jupiter has not verified shows no picture: nobody has looked at a minutes-old token's image (B2b). */
  assert.equal(event.token.icon, null);
  assert.equal(event.token.href, `/app/spot?mint=${MINT}`);
});

test("new tokens are capped: Solana makes thousands a day and the feed is more than a list of births", () => {
  const rows = Array.from({ length: 40 }, (_, index) => row({ mint: `${"A".repeat(30)}${String(index).padStart(4, "0")}xyzpump`.slice(0, 44), firstPoolAt: new Date(NOW - index * 60_000).toISOString() }));
  const events = createdEventsOf(rows, READ);
  assert.equal(events.length, NEW_TOKENS_MAX);
  assert.equal(events[0].happenedAt, new Date(NOW).toISOString(), "the newest first");
});

test("out to a DEX from Jupiter: within the day, the pool it entered as the account; older or in the future — no event", () => {
  const listed = listedEventsOf(
    [
      row({ graduated: true, graduatedAt: "2026-10-24T09:00:00Z", graduatedPool: POOL }),
      row({ mint: "Old1111111111111111111111111111111111111pump", graduatedAt: "2026-10-22T09:00:00Z" }),
      row({ mint: "Fut1111111111111111111111111111111111111pump", graduatedAt: "2026-10-24T13:00:00Z" }),
    ],
    READ,
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, "DEX_LISTED");
  assert.equal(listed[0].account, POOL);
  assert.equal(eventViewOf(listed[0]).explorerUrl, `https://explorer.solana.com/address/${POOL}`);
});

test("a pool's liquidity moved by half over the hour in a market of $10K or more — Jupiter's own figure; one record a token an hour", () => {
  const moved = row({ windows: { m5: win, h1: { ...win, liquidityChangePct: -62 }, h6: win, h24: win } });
  const thin = row({ mint: "Thin111111111111111111111111111111111111pump", liquidityUsd: 4_000, windows: { m5: win, h1: { ...win, liquidityChangePct: -80 }, h6: win, h24: win } });
  const calm = row({ mint: "Calm111111111111111111111111111111111111pump", windows: { m5: win, h1: { ...win, liquidityChangePct: 12 }, h6: win, h24: win } });
  const events = liquidityEventsOf([moved, thin, calm], READ);
  assert.equal(events.length, 1);
  assert.equal(events[0].changePct, -62);
  assert.equal(events[0].happenedAt, null, "Jupiter states the hour, not the moment");
  assert.equal(events[0].happenedWithin, "h1");
  const again = liquidityEventsOf([moved], { ...READ, observedAt: "2026-10-24T12:40:00.000Z" });
  assert.equal(again[0].id, events[0].id, "the same hour, the same record");
});

test("a right still on: mint or freeze on a token Jupiter has not verified — seen when read, never «happened» at a guessed time", () => {
  const events = authorityEventsOf([row({ notices: ["MINT_AUTHORITY", "FREEZE_AUTHORITY"] }), row({ mint: "Usdc111111111111111111111111111111111111111", verified: true, notices: ["MINT_AUTHORITY"] })], READ);
  assert.deepEqual(
    events.map((event) => event.authority),
    ["MINT", "FREEZE"],
  );
  assert.ok(events.every((event) => event.happenedAt === null && event.finality === "reported"));
  assert.ok(events[0].flags.includes("MINT_AUTHORITY"), "the token's Pulse flags travel with the event");
});

test("a launch's flight log: every entry with its confirmed transaction, `signature:index`, the graduation from DBC to DAMM v2 and who sent it", () => {
  const events = journalEventsOf(
    [
      entry("LAUNCHED", 0, { pairRaw: "5000000", tokensRaw: "1000000000" }),
      entry("GRADUATED", 1, { actor: "ryntra", pairRaw: "750000000" }),
      entry("CREATOR_SOLD", 2, { soldBps: 2500, soldOf: "bought", pairRaw: "12000000" }),
      entry("FLOOR_PLACED", 3, { actor: "ryntra", pairRaw: "40000000" }),
      entry("FEE_CLAIMED", 4, { actor: "ryntra" }),
    ],
    launch(),
  );
  assert.deepEqual(
    events.map((event) => event.kind),
    ["TOKEN_CREATED", "DEX_LISTED", "CREATOR_SOLD", "LIQUIDITY_CHANGED", "LAUNCH_LOG"],
  );
  assert.deepEqual(
    events.map((event) => event.id),
    [`${SIG(0)}:${EVENT_INDEX.LAUNCHED}`, `${SIG(1)}:${EVENT_INDEX.GRADUATED}`, `${SIG(2)}:${EVENT_INDEX.CREATOR_SOLD}`, `${SIG(3)}:${EVENT_INDEX.FLOOR_PLACED}`, `${SIG(4)}:${EVENT_INDEX.FEE_CLAIMED}`],
  );
  assert.ok(events.every((event) => event.finality === "confirmed" && event.sources.join() === "launch,chain"));
  assert.deepEqual(events[1].route, { from: "meteora-dbc", to: "damm-v2" });
  assert.equal(events[1].actor, "ryntra");
  assert.equal(events[2].soldBps, 2500);
  assert.equal(eventViewOf(events[1]).explorerUrl, `https://explorer.solana.com/tx/${SIG(1)}`);
  assert.equal(events[0].token.href, "/app/launch/RyntraLaunch11111111111111111111111111111111", "a launch opens its own page");
  /* A devnet launch links devnet's explorer, never mainnet's. */
  const [devnet] = journalEventsOf([entry("LAUNCHED", 0)], launch({ network: "devnet" }));
  assert.equal(eventViewOf(devnet).explorerUrl, `https://explorer.solana.com/tx/${SIG(0)}?cluster=devnet`);
});

test("one fact, one record: a webhook sent again, a read repeated, two sources of one graduation — never two cards", () => {
  const ours = ryntraRow();
  const chain = journalEventsOf([entry("GRADUATED", 1, { actor: "meteora" })], launch({ observedAt: "2026-10-24T12:00:05.000Z" }));
  const jupiter = listedEventsOf([{ ...ours, ryntra: null, graduatedAt: "2026-10-24T11:11:30Z", graduatedPool: POOL }], { ...READ, observedAt: "2026-10-24T11:59:00.000Z" });
  const merged = mergeEvents([...jupiter, ...chain, ...chain]);
  assert.equal(merged.length, 1);
  const [one] = merged;
  assert.equal(one.id, `${SIG(1)}:${EVENT_INDEX.GRADUATED}`, "the transaction's own record");
  assert.equal(one.finality, "confirmed");
  assert.equal(one.happenedAt, "2026-10-24T11:11:00.000Z", "the chain's time");
  assert.deepEqual(one.sources, ["chain", "jupiter", "launch"]);
  assert.equal(one.observedAt, "2026-10-24T11:59:00.000Z", "seen when it was first seen");
  /* Idempotent: the merged feed merged again with any of its records is the same feed. */
  assert.deepEqual(mergeEvents([...merged, ...chain, ...jupiter]), merged);
  /* Two events of one transaction stay two records: their indexes differ. */
  const two = journalEventsOf([entry("FLOOR_WITHDRAWN", 5, { actor: "ryntra" }), entry("FLOOR_RAISED", 5, { actor: "ryntra" })], launch());
  assert.equal(mergeEvents(two).length, 2);
});

test("the newest first; a suspicious token's event visible with its reason but never among the first five", () => {
  const minute = (n) => new Date(NOW - n * 60_000).toISOString();
  const clean = Array.from({ length: 8 }, (_, index) => createdEventsOf([row({ mint: `Clean${String(index).padStart(2, "0")}${"1".repeat(32)}pump`.slice(0, 44), firstPoolAt: minute(index + 1) })], READ)[0]);
  const flagged = createdEventsOf([row({ mint: "Flag1111111111111111111111111111111111111pump", firstPoolAt: minute(0), notices: ["FLAGGED"] })], READ)[0];
  assert.deepEqual(flagged.suspicious, ["FLAGGED"]);
  const ordered = orderEvents([flagged, ...clean]);
  assert.equal(ordered.length, 9);
  assert.ok(ordered.slice(0, SUSPICIOUS_FLOOR).every((event) => event.suspicious.length === 0));
  assert.equal(ordered[SUSPICIOUS_FLOOR], flagged, "down to the first place after the top its time allows");
  assert.deepEqual(
    ordered.filter((event) => event !== flagged).map((event) => event.happenedAt),
    clean.map((event) => event.happenedAt),
  );
  /* A fact over the hour stands among the hour-old events; a fact nobody dates goes after every dated one. */
  const hour = liquidityEventsOf([row({ mint: "Hour111111111111111111111111111111111111pump", windows: { m5: win, h1: { ...win, liquidityChangePct: 70 }, h6: win, h24: win } })], READ)[0];
  const right = authorityEventsOf([row({ mint: "Right11111111111111111111111111111111111pump", notices: ["MINT_AUTHORITY"] })], READ)[0];
  const old = createdEventsOf([row({ mint: "Old11111111111111111111111111111111111111pump", firstPoolAt: new Date(NOW - 2 * 3_600_000).toISOString() })], READ)[0];
  assert.deepEqual(
    orderEvents([right, old, hour, clean[0]]).map((event) => event.kind),
    ["TOKEN_CREATED", "LIQUIDITY_CHANGED", "TOKEN_CREATED", "AUTHORITY_OPEN"],
  );
  /* A filter orders again: the flagged event alone with fewer clean ones stands after all of them, never first. */
  const filtered = orderEvents(ordered.filter((event) => event === flagged || event === clean[7]));
  assert.deepEqual(filtered, [clean[7], flagged]);
  /* A first pool in the future is a provider's error, never the top of the feed. */
  assert.equal(createdEventsOf([row({ firstPoolAt: new Date(NOW + 3_600_000).toISOString() })], READ).length, 0);
  /* A name cut for the contract never splits an emoji. */
  const [emoji] = createdEventsOf([row({ name: `${"a".repeat(79)}🐸tail` })], READ);
  assert.equal(eventViewOf(emoji).token.name, "a".repeat(79));
  /* A name copy is suspicious too — another token of the read with the same ticker and name. */
  const [copy] = createdEventsOf([row()], { ...READ, twins: new Map([[MINT, 1]]) });
  assert.deepEqual(copy.suspicious, ["NAME_COPY"]);
});

test("«seen» is when this server first saw the fact: kept while it stays on the feed, never before it happened", () => {
  const sightings = createSightings({ kept: 3, ms: 60 * 60_000 });
  const [born] = createdEventsOf([row({ firstPoolAt: "2026-10-24T11:59:30Z" })], READ);
  /* A held list read before the token was born: seen is clamped to when it happened. */
  const [early] = sightings.apply([{ ...born, observedAt: "2026-10-24T11:58:00.000Z" }], NOW);
  assert.equal(early.observedAt, "2026-10-24T11:59:30.000Z");
  /* A later read of the same fact keeps the first sighting. */
  const [later] = sightings.apply([{ ...born, observedAt: "2026-10-24T12:30:00.000Z" }], NOW + 30 * 60_000);
  assert.equal(later.observedAt, "2026-10-24T11:59:30.000Z");
  /* Still on the feed past the span from its first sighting: its last sighting keeps it known. */
  const [still] = sightings.apply([{ ...born, observedAt: "2026-10-24T13:20:00.000Z" }], NOW + 80 * 60_000);
  assert.equal(still.observedAt, "2026-10-24T11:59:30.000Z");
  /* Past `kept`, the longest unseen goes first — not the one just seen again. */
  const others = ["A", "B", "C"].map((tag) => createdEventsOf([row({ mint: `${tag}${"1".repeat(39)}pump`.slice(0, 44), firstPoolAt: "2026-10-24T11:50:00Z" })], READ)[0]);
  sightings.apply([others[0], others[1]], NOW + 81 * 60_000);
  sightings.apply([{ ...born, observedAt: "2026-10-24T13:22:00.000Z" }], NOW + 82 * 60_000);
  sightings.apply([others[2]], NOW + 83 * 60_000);
  assert.equal(sightings.size(), 3);
  const [kept] = sightings.apply([{ ...born, observedAt: "2026-10-24T13:24:00.000Z" }], NOW + 84 * 60_000);
  assert.equal(kept.observedAt, "2026-10-24T11:59:30.000Z", "the fact seen again stayed; A, the longest unseen, went");
});

test("a creator's lock opening: the cliff and the end its escrow names, for a week after; a time not come is no event", () => {
  const lock = { escrow: ESCROW, cliffAt: "2026-10-23T00:00:00Z", endsAt: "2026-11-23T00:00:00Z" };
  const events = unlockEventsOf(lock, launch());
  assert.equal(events.length, 1);
  assert.equal(events[0].unlock, "cliff");
  assert.equal(events[0].finality, "scheduled");
  assert.equal(events[0].account, ESCROW);
  assert.equal(unlockEventsOf({ ...lock, cliffAt: "2026-10-01T00:00:00Z" }, launch()).length, 0, "older than a week");
  assert.equal(unlockEventsOf(null, launch()).length, 0);
});

test("an Alpha Vault opened on Ryntra: the vault's own transaction", () => {
  const event = vaultEventOf({ vault: POOL, signature: SIG(6), at: "2026-10-24T08:00:00.000Z" }, launch());
  assert.equal(event.kind, "ALPHA_VAULT");
  assert.equal(event.id, `${SIG(6)}:${EVENT_INDEX.VAULT}`);
  assert.equal(event.finality, "confirmed");
});

test("`/api/v1/events` answers the contract: every kind's coverage said, the kinds and the filter's groups", () => {
  const events = orderEvents(
    mergeEvents([
      ...createdEventsOf([row()], READ),
      ...journalEventsOf([entry("LAUNCHED", 0, { pairRaw: "5000000", tokensRaw: "1000000000" }), entry("CREATOR_SOLD", 2, { soldBps: 2500, soldOf: "bought" })], launch()),
      ...unlockEventsOf({ escrow: ESCROW, cliffAt: "2026-10-23T00:00:00Z", endsAt: null }, launch()),
    ]),
  );
  const body = { events: events.map(eventViewOf), total: events.length, observedAt: OBSERVED, stale: false, partial: false, sources: ["chain", "jupiter", "launch"], logs: { read: 1, markets: 1 }, coverage: coverageOf() };
  assert.doesNotThrow(() => MarketEventsResponseSchema.parse(body));
  assert.equal(body.coverage.length, EVENT_KINDS.length);
  assert.equal(EVENT_COVERAGE.CONCENTRATION_CHANGED.state, "not-read", "a kind not read is said, never a quiet market");
  assert.equal(EVENT_COVERAGE.QUOTE_CHANGED.state, "not-read", "SOL-L12 is not live");
  assert.deepEqual(eventKindsOf("UNLOCK,DEX_LISTED,nonsense"), ["DEX_LISTED", "UNLOCK"]);
  assert.deepEqual(eventKindsOf(null), [...EVENT_KINDS]);
  assert.equal(eventKindsOf("nonsense"), null, "an ask that names no known kind is refused, never every kind");
  const grouped = new Set(Object.entries(EVENT_GROUPS).filter(([id]) => id !== "all").flatMap(([, kinds]) => kinds));
  assert.deepEqual([...grouped].sort(), [...EVENT_KINDS].sort(), "every kind sits in one of the filter's groups");
});

test("Pulse rows carry the pool Jupiter states and the hour's change of liquidity — what the feed reads", () => {
  const pulse = pulseRowOf(
    {
      id: MINT,
      name: "Three Fen",
      symbol: "3FEN",
      launchpad: "pump.fun",
      usdPrice: 0.0000369,
      mcap: 36_900,
      liquidity: 12_280,
      holderCount: 412,
      graduatedPool: POOL,
      graduatedAt: "2026-10-24T09:00:00Z",
      firstPool: { id: MINT, createdAt: "2026-10-24T08:00:00Z" },
      stats1h: { liquidityChange: -55.5 },
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
    },
    NOW,
  );
  assert.equal(pulse.graduatedPool, POOL);
  assert.equal(pulse.windows.h1.liquidityChangePct, -55.5);
});

/* ------------------------------------------------------------ the page and the route */

const FEED = read("app/app/markets/events/market-events.tsx");
const WORDS = read("app/app/markets/events/events-words.ts");
const SCREENER = read("app/app/markets/markets-screener.tsx");
const HOME = read("app/app/home/home-surface.tsx");
const ROUTE = read("app/api/v1/events/route.ts");
const TABS = read("lib/markets/screener.ts");

test("«Події» stands in «Ринки» right beside the Radar («Меми»); the menu does not change", () => {
  assert.match(TABS, /SCREENER_TABS = \["all", "memes", "events", "crypto"/);
  assert.match(SCREENER, /\) : events \? \(\s*<MarketEvents locale=\{locale\} query=\{query\} \/>/);
  assert.match(SCREENER, /\{radar \|\| wallets \|\| events \? null : \(/, "no order select of the table above the feed");
  for (const nav of ["app/app/nav.tsx", "app/app/phone-bar.tsx"]) assert.doesNotMatch(read(nav), /events/i, `${nav}: no new menu item`);
});

test("on Home the block stands where Pulse is — right after it, for a guest and for a wallet — with the way to the whole feed", () => {
  const blocks = HOME.match(/<Pulse locale=\{locale\} rows=\{wide \? PULSE_ROWS : PULSE_ROWS_PHONE\} \/>\s*(?:\{\/\*[^]*?\*\/\}\s*)?<MarketEvents locale=\{locale\} place="home"/g) ?? [];
  assert.equal(blocks.length, 2);
  assert.match(FEED, /href="\/app\/markets\?tab=events"/);
});

test("every card: the kind, when it happened and when seen, the sources, the finality, the explorer's link, the risk — no trade button, no wallet", () => {
  for (const part of ["word(`kind_${event.kind}`", "event.happenedAt ?", 'word("seen"', "event.sources.map", "word(`finality_${event.finality}`", "href={event.explorerUrl}", 'target="_blank" rel="noopener noreferrer"', "event.flags.length", "event.suspicious.length > 0"]) {
    assert.ok(FEED.includes(part), `the card draws ${part}`);
  }
  assert.doesNotMatch(FEED, /useQuickBuySums|buy=|quickSum|useSolanaConnection|useWalletProof/, "no quick buy, no wallet");
  assert.match(FEED, /fetch\(url/);
  assert.match(FEED, /"\/api\/v1\/events\?limit=200"/);
});

test("«подія», never «сигнал»; no «safe», no «buy now» — in both languages", () => {
  const said = Object.values(EVENTS_WORDS).flatMap((pair) => [pair.en, pair.uk]).join("\n");
  assert.doesNotMatch(said, /сигнал|signal|безпечн|\bsafe\b|купуй|buy now|profit|прибут/i);
  assert.match(WORDS, /Подія — факт із джерелом, а не порада/);
  assert.match(EVENTS_WORDS.kind_TOKEN_CREATED.uk, /^Новий токен$/);
});

test("the route is v1's own: the major refused or served, rate-limited, public, the contract's types", () => {
  assert.match(ROUTE, /apiMajorRefusal\(request\.headers\)/);
  assert.match(ROUTE, /consumeSolanaReadRequest\(request\.headers\)/);
  assert.match(ROUTE, /satisfies MarketEventsResponse/);
  assert.match(ROUTE, /const picked = orderEvents\(read\.events\.filter\(/, "ordered again after the filter");
  assert.match(FEED, /orderEvents\(\(answer\?\.events \?\? \[\]\)\.filter\(/, "the page orders again after its group and search");
  assert.doesNotMatch(ROUTE, /requireWalletProof|requireSession/, "public: no wallet");
});
