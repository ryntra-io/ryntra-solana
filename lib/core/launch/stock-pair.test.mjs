// A coin launched in a pair with a stock. The quote rule is judged on the real bytes of two stock tokens and
// their DBC token badges as mainnet answered them (`./fixtures/stock-quote-mainnet.json`, read by
// `scripts/launch-qa/stock-pair-mainnet-read.mjs`): Backpack's ANT and SPCX pass once the flag is open; a hook with a
// program, a stock with no badge, a token that borrows a stock's symbol, a paused stock and an unread shelf do not;
// and with the flag closed the rule is the one it was. Then the preset's numbers, the shelf, and the line before the
// signature.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ExtensionType } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { mintProfileOf } from "../../solana/mint-profile.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS, honestLaunchProblems } from "../venues/meteora-dbc/presets.ts";
import { EXTENSION, QUOTE_ASSET_REASONS, QUOTE_ASSET_REFUSALS, quoteAssetProblems, quoteAssetRecordOf, quoteBadgeRequired } from "./quote-asset.ts";
import {
  STOCK_PAIR_FLAG,
  STOCK_PAIR_RISKS,
  STOCK_PAIR_TERMS,
  stockOnShelf,
  stockPairHonesty,
  stockPairMarketCaps,
  stockPairOpen,
  stockPairPreset,
  stockPairQuote,
  stockPairTermsOf,
  stockPairThreshold,
  stockShelfEntries,
  unitsOf,
} from "./stock-pair.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/stock-quote-mainnet.json", import.meta.url), "utf8"));
const DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const NOW = Date.parse("2026-11-19T19:10:00.000Z");
const PRICE_AT = "2026-11-19T19:09:00.000Z";
const accountOf = (address) => {
  const raw = FIXTURE.accounts[address];
  return raw ? { owner: new PublicKey(raw.owner), data: Buffer.from(raw.data, "base64"), lamports: raw.lamports, executable: false } : null;
};
const factsOf = (symbol, bytes = null) => {
  const { mint } = FIXTURE.stocks[symbol];
  const account = accountOf(mint);
  return mintProfileOf(mint, bytes ? { ...account, data: bytes } : account);
};
/** The record the register keeps of a stock — every field as read (what `quote-asset-check.mjs` prints for the operator). */
const recordOf = (symbol, facts = factsOf(symbol), mint = FIXTURE.stocks[symbol].mint) =>
  quoteAssetRecordOf({
    mint,
    symbol,
    program: facts.program,
    decimals: facts.decimals,
    extensions: facts.extensions.map(Number),
    transferFee: null,
    authorities: { mint: facts.mintAuthority, freeze: facts.freezeAuthority, permanentDelegate: facts.permanentDelegate, close: facts.closeAuthority, transferHook: facts.transferHook?.authority ?? null },
    defaultAccountState: facts.defaultAccountState,
    multiplier: 1,
    badge: true,
    priceMaxAgeSeconds: 300,
    note: null,
  });
/** The badge as the server reads it: an account at the program's address, owned by DBC. */
const badgeOf = (symbol) => accountOf(FIXTURE.stocks[symbol].badge)?.owner.toBase58() === DBC;
const observedOf = (symbol, over = {}) => ({
  facts: factsOf(symbol),
  badge: badgeOf(symbol),
  epoch: BigInt(FIXTURE.epoch),
  multiplier: { current: 1, pending: null, effectiveAt: null },
  priceUsd: 94.2,
  priceAt: PRICE_AT,
  ...over,
});
const judge = (symbol, { over = {}, stock = { onShelf: true }, record = recordOf(symbol) } = {}) =>
  quoteAssetProblems(record, observedOf(symbol, over), { nowMs: NOW, sdk: "1.5.13", ...(stock ? { stock } : {}) });

/** The mint's bytes with one Token-2022 extension's state rewritten — the TLV after the account-type byte at 165. */
function patched(symbol, type, edit) {
  const data = Buffer.from(accountOf(FIXTURE.stocks[symbol].mint).data);
  for (let at = 166; at + 4 <= data.length; ) {
    const kind = data.readUInt16LE(at);
    const length = data.readUInt16LE(at + 2);
    if (kind === type) {
      edit(data, at + 4);
      return data;
    }
    at += 4 + length;
  }
  throw new Error(`no extension ${type}`);
}

test("the fixture is mainnet's own — two stock tokens of Token-2022, each with Meteora's DBC badge", () => {
  for (const symbol of ["ANT", "SPCX"]) {
    const facts = factsOf(symbol);
    assert.equal(facts.program, "token-2022");
    assert.equal(facts.decimals, 6);
    /* The hook's extension is there, and no program in it: what made the engine refuse every stock until now. */
    assert.ok(facts.extensions.includes(String(EXTENSION.TRANSFER_HOOK)));
    assert.deepEqual(facts.transferHook && { program: facts.transferHook.program }, { program: null });
    assert.equal(facts.defaultAccountState, "initialized");
    assert.equal(facts.pausable?.paused, false);
    assert.ok(facts.permanentDelegate, "the issuer's delegate");
    assert.equal(quoteBadgeRequired(facts, BigInt(FIXTURE.epoch)), true, "DBC takes such a mint only with its badge");
    assert.equal(badgeOf(symbol), true, `${symbol}: the badge account is DBC's`);
    const [derived] = PublicKey.findProgramAddressSync([Buffer.from("token_badge"), new PublicKey(FIXTURE.stocks[symbol].mint).toBuffer()], new PublicKey(DBC));
    assert.equal(derived.toBase58(), FIXTURE.stocks[symbol].badge, "at the program's own seeds");
  }
  assert.equal(EXTENSION.CONFIDENTIAL_TRANSFER_MINT, ExtensionType.ConfidentialTransferMint);
});

test("before: with the flag closed, a stock is refused for its hook's extension alone — the engine as it was", () => {
  assert.deepEqual(judge("ANT", { stock: null }), ["EXTENSION_FORBIDDEN"]);
  assert.deepEqual(judge("SPCX", { stock: null }), ["EXTENSION_FORBIDDEN"]);
});

test("after: ANT and SPCX pass — an empty hook, Meteora's badge, the shelf", () => {
  assert.deepEqual(judge("ANT"), []);
  assert.deepEqual(judge("SPCX", { over: { priceUsd: 137.56 } }), []);
});

test("a hook with a program is refused as before, whatever the shelf says", () => {
  const live = patched("ANT", ExtensionType.TransferHook, (data, at) => new PublicKey("Hook111111111111111111111111111111111111111").toBuffer().copy(data, at + 32));
  const facts = factsOf("ANT", live);
  assert.ok(facts.transferHook?.program);
  assert.deepEqual(judge("ANT", { over: { facts } }), ["EXTENSION_FORBIDDEN"]);
  assert.deepEqual(judge("ANT", { over: { facts }, stock: null }), ["EXTENSION_FORBIDDEN"]);
});

test("a stock with no badge is not offered — only Meteora gives one", () => {
  assert.deepEqual(judge("ANT", { over: { badge: false } }), ["BADGE_MISSING"]);
  assert.deepEqual(judge("ANT", { over: { badge: null } }), ["BADGE_NOT_READ"]);
});

test("a token borrowing a stock's symbol is not on the shelf — the shelf goes by the mint", () => {
  /* The same bytes at another address, named ANT by whoever made it: the register could even carry it by mistake. */
  const fake = "4WdnZ7TGnSRtTrJ3sZ1hk5NzTZd6sVuxx1vrFdUtbpmp";
  const facts = mintProfileOf(fake, accountOf(FIXTURE.stocks.ANT.mint));
  const shelf = [{ mint: FIXTURE.stocks.ANT.mint, symbol: "ANT" }];
  assert.equal(stockOnShelf(shelf, fake), null);
  const onShelf = stockOnShelf(shelf, fake) !== null;
  const problems = quoteAssetProblems(recordOf("ANT", facts, fake), { ...observedOf("ANT"), facts }, { nowMs: NOW, sdk: "1.5.13", stock: { onShelf } });
  assert.deepEqual(problems, ["STOCK_NOT_ON_SHELF"]);
  assert.ok(stockOnShelf(shelf, FIXTURE.stocks.ANT.mint), "the stock itself is");
});

test("a paused stock and an unread shelf close the pair", () => {
  const paused = factsOf("ANT", patched("ANT", ExtensionType.PausableConfig, (data, at) => (data[at + 32] = 1)));
  assert.equal(paused.pausable?.paused, true);
  /* The pause is the issuer's; the record does not hold it, so only the stock rule sees it. */
  assert.deepEqual(judge("ANT", { over: { facts: paused } }), ["PAIR_PAUSED"]);
  assert.deepEqual(judge("ANT", { stock: { onShelf: null } }), ["SHELF_NOT_READ"]);
  assert.deepEqual(judge("ANT", { stock: { onShelf: false } }), ["STOCK_NOT_ON_SHELF"]);
  for (const refusal of ["STOCK_NOT_ON_SHELF", "SHELF_NOT_READ", "PAIR_PAUSED"]) {
    assert.ok(QUOTE_ASSET_REFUSALS.includes(refusal));
    assert.equal(typeof QUOTE_ASSET_REASONS[refusal], "string");
  }
});

test("a mint DBC takes without a badge needs no shelf — the rule is about an issuer's powers", () => {
  /* ANT's bytes with every extension but the metadata gone would be a plain token: built here as a profile. */
  const plain = { ...factsOf("ANT"), extensions: [String(EXTENSION.METADATA_POINTER), String(EXTENSION.TOKEN_METADATA)], permanentDelegate: null, pausable: null, transferHook: null, defaultAccountState: null, freezeAuthority: null };
  const record = quoteAssetRecordOf({ ...recordOf("ANT"), extensions: [EXTENSION.METADATA_POINTER, EXTENSION.TOKEN_METADATA], defaultAccountState: null, authorities: { mint: plain.mintAuthority, freeze: null, permanentDelegate: null, close: null, transferHook: null } });
  assert.deepEqual(quoteAssetProblems(record, { ...observedOf("ANT"), facts: plain }, { nowMs: NOW, sdk: "1.5.13", stock: { onShelf: false } }), []);
});

test("the flag — open only when it says so", () => {
  assert.equal(stockPairOpen({}), false);
  assert.equal(stockPairOpen({ [STOCK_PAIR_FLAG]: "yes" }), false);
  assert.equal(stockPairOpen({ [STOCK_PAIR_FLAG]: " open " }), true);
});

/* ------------------------------------------------------------------ the shelf */

const row = (over = {}) => ({
  representation: {
    mint: FIXTURE.stocks.ANT.mint,
    symbol: "ANT",
    name: "Anthropic - Backpack Securities",
    issuer: { id: "backpack", label: "Backpack Securities", catalogue: false },
    issuerConfirmation: "tag-only",
    instrument: { class: "listed-equity", unitBasis: "share", rights: "issuer-terms" },
    underlying: { symbol: "ANT", isin: null, listingCountry: "US", name: "Anthropic" },
    exchange: { mic: "XNAS", name: "Nasdaq", timezone: "America/New_York" },
    tradingHalted: false,
    ...over.representation,
  },
  market: { priceUsd: 94.2, change24hPct: null, volume24hUsd: 26_000_000, liquidityUsd: 2_200_000, verified: true, observedAt: PRICE_AT, icon: null, ...over.market },
  lifecycle: { state: "active", tradable: true, source: "none", observedAt: null, ...over.lifecycle },
  session: { period: "market", exchangeOpen: true, nextChangeAt: "2026-11-19T21:00:00.000Z", exchange: { mic: "XNAS", name: "Nasdaq", timezone: "America/New_York" }, source: "feed-catalogue", ...over.session },
});

test("the shelf a stock pairs from — listed, offered, priced; never a pre-IPO token, a halted one or another issuer's", () => {
  const entries = stockShelfEntries(
    [
      row(),
      row({ representation: { mint: FIXTURE.stocks.SPCX.mint, symbol: "SPCX" }, market: { priceUsd: 137.56, liquidityUsd: 2_525_000 } }),
      row({ representation: { mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", symbol: "ANTHROPIC", issuer: { id: "prestocks", label: "PreStocks", catalogue: true }, instrument: { class: "pre-ipo", unitBasis: "token", rights: "economic-exposure" } } }),
      row({ representation: { mint: "5Kz7XsHzEyBDhcV7zAVGjndaKyAWYv3h5fC2a9Tjondo", symbol: "ANTon", issuer: { id: "ondo", label: "Ondo Global Markets", catalogue: false } } }),
      row({ representation: { mint: "HaLtedHaLtedHaLtedHaLtedHaLtedHaLtedHaLted1", symbol: "HALT", tradingHalted: true } }),
    ],
    NOW,
  );
  assert.deepEqual(entries.map((entry) => entry.symbol), ["ANT", "SPCX"]);
  const ant = entries[0];
  assert.deepEqual(ant.issuer, { id: "backpack", label: "Backpack Securities" });
  assert.equal(ant.session, "open");
  assert.equal(ant.nextChangeAt, "2026-11-19T21:00:00.000Z");
  assert.equal(ant.liquidityUsd, 2_200_000);
  assert.ok(ant.termsUrl?.startsWith("https://"));
});

/* ------------------------------------------------------------------ the threshold and the preset */

test("the threshold is in the stock — 1 % of its depth, from twice the keeper's $750 to Класичний's $15 000, two figures up", () => {
  const ant = stockPairThreshold({ priceUsd: 94.2, decimals: 6, liquidityUsd: 2_200_000 });
  assert.ok(ant.ok);
  assert.deepEqual({ units: ant.threshold.units, raw: ant.threshold.raw, basis: ant.threshold.basis }, { units: "160", raw: 160_000_000n, basis: "ceiling" });
  const spcx = stockPairThreshold({ priceUsd: 137.56, decimals: 6, liquidityUsd: 2_525_000 });
  assert.ok(spcx.ok);
  assert.equal(spcx.threshold.units, "110");
  /* A thinner name: its depth sets the curve. */
  const middling = stockPairThreshold({ priceUsd: 40, decimals: 6, liquidityUsd: 600_000 });
  assert.ok(middling.ok);
  assert.deepEqual([middling.threshold.units, middling.threshold.basis], ["150", "depth"]);
  /* Thin, but not too thin: the floor holds, and its dollars stay at least the floor. */
  const thin = stockPairThreshold({ priceUsd: 12.3, decimals: 6, liquidityUsd: 60_000 });
  assert.ok(thin.ok);
  assert.deepEqual([thin.threshold.units, thin.threshold.basis], ["130", "floor"]);
  assert.ok(thin.threshold.usd >= STOCK_PAIR_TERMS.keeperFloorUsd * STOCK_PAIR_TERMS.floorMultiple);
  /* An expensive share: fractions of it, still two figures. */
  const dear = stockPairThreshold({ priceUsd: 4_700, decimals: 8, liquidityUsd: 900_000 });
  assert.ok(dear.ok);
  assert.equal(dear.threshold.units, "2", "1.91… of a share, up to two figures");
  /* Refused: too thin to feed even the floor, no price, no depth. */
  assert.deepEqual(stockPairThreshold({ priceUsd: 50, decimals: 6, liquidityUsd: 20_000 }), { ok: false, reason: "TOO_THIN" });
  assert.deepEqual(stockPairThreshold({ priceUsd: null, decimals: 6, liquidityUsd: 2_000_000 }), { ok: false, reason: "PRICE_UNKNOWN" });
  assert.deepEqual(stockPairThreshold({ priceUsd: 94.2, decimals: 6, liquidityUsd: null }), { ok: false, reason: "DEPTH_UNKNOWN" });
  assert.equal(unitsOf(1_900_000n, 6), "1.9");
  assert.equal(unitsOf(160_000_000n, 6), "160");
});

test("the preset — Захищений's shape on the «Розширений» template, its curve in the stock's units", async () => {
  const { presetCurve } = await import("../venues/meteora-dbc/launch.server.ts");
  const threshold = stockPairThreshold({ priceUsd: 94.2, decimals: 6, liquidityUsd: 2_200_000 });
  assert.ok(threshold.ok);
  const preset = stockPairPreset(threshold.threshold);
  assert.equal(preset.id, "advanced", "built as a config of one launch, the only kind made from numbers of its own");
  assert.equal(preset.pair, "QUOTE_ASSET");
  assert.deepEqual(preset.sniperFee, LAUNCH_PRESETS.protected.sniperFee);
  assert.equal(preset.creatorTradingFeePct, 40);
  assert.deepEqual(preset.graduationFee, { pct: 2, creatorPct: 40 });
  assert.equal(preset.creatorFirstBuyCapBps, LAUNCH_PRESETS.advanced.creatorFirstBuyCapBps);
  const curve = presetCurve(preset, stockPairQuote(FIXTURE.stocks.ANT.mint, 6));
  /* The threshold the config carries for ever is the stock's own amount, to the raw unit. */
  assert.equal(curve.migrationQuoteThreshold.toString(), "160000000");
  assert.equal(curve.collectFeeMode, 0, "every fee is taken in the stock: the creator's share comes in it");
  assert.equal(curve.creatorTradingFeePercentage, 40);
  /* «Чесний лаунч» holds on it exactly as on every preset. */
  const fields = {
    hasTransferHook: false,
    transferHookProgram: null,
    tokenType: curve.tokenType,
    tokenUpdateAuthority: curve.tokenUpdateAuthority,
    migrationOption: curve.migrationOption,
    partnerLiquidityPercentage: curve.partnerLiquidityPercentage,
    partnerPermanentLockedLiquidityPercentage: curve.partnerPermanentLockedLiquidityPercentage,
    partnerVestingPercentage: curve.partnerLiquidityVestingInfo?.vestingPercentage ?? 0,
    creatorLiquidityPercentage: curve.creatorLiquidityPercentage,
    creatorPermanentLockedLiquidityPercentage: curve.creatorPermanentLockedLiquidityPercentage,
    creatorVestingPercentage: curve.creatorLiquidityVestingInfo?.vestingPercentage ?? 0,
    lockedVestingAmount: "0",
    baseFeeMode: curve.poolFees.baseFee.baseFeeMode,
    migratedCollectFeeMode: curve.migratedPoolFee.collectFeeMode,
    compoundingFeeBps: curve.compoundingFeeBps,
    migratedPoolBaseFeeMode: curve.migratedPoolBaseFeeMode,
    enableFirstSwapWithMinFee: curve.enableFirstSwapWithMinFee,
    preMigrationTokenSupply: String(curve.tokenSupply?.preMigrationTokenSupply ?? "0"),
    postMigrationTokenSupply: String(curve.tokenSupply?.postMigrationTokenSupply ?? "0"),
  };
  assert.deepEqual(honestLaunchProblems(fields), []);
  /* The market caps in the stock and in dollars at the price read: Класичний's size in dollars today, fixed in ANT. */
  const caps = stockPairMarketCaps(threshold.threshold, 94.2);
  assert.ok(Math.abs(caps.start.units - 51.7652) < 0.001, String(caps.start.units));
  assert.ok(Math.abs(caps.graduation.units / caps.start.units - 15) < 1e-4, "the curve's multiple of fifteen");
  /* The terms its config is kept with — the record every config of one launch has. */
  const terms = stockPairTermsOf(threshold.threshold, FIXTURE.stocks.ANT.mint, 94.2);
  assert.equal(terms.quoteMint, FIXTURE.stocks.ANT.mint);
  assert.deepEqual([terms.firstBuyCapBps, terms.graduationFee.pct, terms.sniper], [200, 2, "strong"]);
});

test("the presets people pick and their numbers are untouched", () => {
  assert.deepEqual([...PEOPLE_PRESET_IDS], ["classic", "protected", "community", "micro"]);
  assert.equal(LAUNCH_PRESETS.advanced.pair, "USDC");
  assert.equal(LAUNCH_PRESETS.protected.curve.startMarketCapUsd, 5_000);
});

/* ------------------------------------------------------------------ the line before the signature */

test("before the signature — the issuer can pause and take the stock, and the exchange's hours", () => {
  const [ant] = stockShelfEntries([row()], NOW);
  const open = stockPairHonesty(factsOf("ANT"), ant);
  assert.deepEqual(open.powers, { pause: true, take: true, freeze: true, setHook: true, mint: true });
  assert.equal(open.paused, false);
  assert.deepEqual(open.risks, ["ISSUER_CAN_PAUSE", "ISSUER_CAN_TAKE", "ISSUER_CAN_FREEZE", "ISSUER_CAN_SET_HOOK"]);
  assert.deepEqual(open.exchange, { session: "open", nextChangeAt: "2026-11-19T21:00:00.000Z" });
  assert.equal(open.issuer.id, "backpack");
  assert.ok(open.terms.excluded.some((place) => place.en === "the United States"));
  assert.equal(open.terms.issuerOwn, false, "Backpack's own token terms were not found: the list is the platform's, and it says so");
  const [closed] = stockShelfEntries([row({ session: { period: "closed", exchangeOpen: false } })], NOW);
  assert.ok(stockPairHonesty(factsOf("ANT"), closed).risks.includes("EXCHANGE_CLOSED"));
  const [unknown] = stockShelfEntries([row({ session: { period: "unknown", exchangeOpen: null, nextChangeAt: null } })], NOW);
  assert.equal(stockPairHonesty(factsOf("ANT"), unknown).risks.at(-1), "EXCHANGE_UNKNOWN");
  for (const risk of stockPairHonesty(factsOf("ANT"), closed).risks) assert.ok(STOCK_PAIR_RISKS.includes(risk));
});
