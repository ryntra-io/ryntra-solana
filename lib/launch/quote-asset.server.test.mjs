// SOL-L11: the checked pair currencies read from the chain, and a launch built in one of them. The badge is read at
// the account the DBC program derives for the mint, the mint's own facts are held against the register, and a single
// difference refuses the build with its plain word — the creator pays no rent for a config no launch could follow. The
// mints are laid out by spl-token's own layouts; the node here answers only what a build asks.
import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionType } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { ADVANCED_DEFAULT_CHOICE } from "../core/launch/advanced.ts";
import { EXTENSION } from "../core/launch/quote-asset.ts";
import { DBC_PROGRAM_ID, dbcTokenBadgeAddress } from "../core/venues/meteora-dbc/sdk.server.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { ISSUER, OTHER, fee, metadataPointer, scaledUiAmount, token2022Mint, transferFee } from "../solana/fixtures/token-2022-mints.mjs";
import { prepareAdvancedConfig } from "./advanced.server.ts";
import { launchNetwork, launchPair } from "./config.server.ts";
import { prepareLaunch } from "./flow.server.ts";
import { storeLaunchMetadata } from "./metadata.server.ts";
import { forgetQuoteAssets, readQuoteAssets } from "./quote-asset.server.ts";
import { networkQuotes } from "./quote-watch.server.ts";

const STAND = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" };
const SECRET = { BETA_TOKEN_SECRET: "a-secret-of-thirty-two-characters!" };
const address = () => Keypair.generate().publicKey.toBase58();
const MINT = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const PRICE_AT = "2026-10-26T11:59:00.000Z";

/** The pair currency as the register checked it: a dead fee authority, so 0.2.1 builds its config. */
const checkedMint = (extensions = {}) =>
  token2022Mint({
    decimals: 8,
    extensions: { ...transferFee({ authority: null, withdraw: null }), ...metadataPointer(), ...scaledUiAmount({ multiplier: 1 }), ...extensions },
  });

const record = (over = {}) => ({
  mint: MINT,
  symbol: "PAIRX",
  program: "token-2022",
  decimals: 8,
  extensions: [EXTENSION.TRANSFER_FEE_CONFIG, EXTENSION.METADATA_POINTER, EXTENSION.SCALED_UI_AMOUNT],
  transferFee: { bps: 0, scheduledBps: 0, authority: null, withdrawAuthority: null },
  authorities: { mint: ISSUER.toBase58(), freeze: null, permanentDelegate: null, close: null, transferHook: null },
  defaultAccountState: null,
  multiplier: 1,
  badge: true,
  priceMaxAgeSeconds: 300,
  note: "a note kept with the record",
  ...over,
});

const registry = (over = {}) => ({
  RYNTRA_LAUNCH_QUOTE_ASSETS: "open",
  RYNTRA_LAUNCH_QUOTE_ASSETS_REGISTRY: JSON.stringify([record(over)]),
});

/**
 * A node that answers the mint and the badge by their addresses, and a build's own reads. `badge` — null for no such
 * account, an owner for one; `answers` false makes every read fail.
 */
function node({ mint = checkedMint(), badge = DBC_PROGRAM_ID, answers = true, epoch = 900 } = {}) {
  const badgeKey = dbcTokenBadgeAddress(MINT, "1.5.13").toBase58();
  return {
    getMultipleAccountsInfo: async (keys) => {
      if (!answers) throw new Error("the node did not answer");
      return keys.map((key) => {
        if (key.toBase58() === MINT) return mint === null ? null : { ...mint, owner: mint.owner, lamports: 1, executable: false };
        if (key.toBase58() === badgeKey) return badge === null ? null : { owner: badge, data: Buffer.alloc(80), lamports: 1, executable: false };
        return null;
      });
    },
    getEpochInfo: async () => {
      if (!answers) throw new Error("the node did not answer");
      return { epoch, blockHeight: 900, absoluteSlot: 9_000 };
    },
    getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1_000 }),
    getBalance: async () => 1_000_000_000,
    simulateTransaction: async () => ({ value: { err: null, accounts: [{ lamports: 1_000_000_000 - 7_000_000 }] } }),
    getRecentPerformanceSamples: async () => [{ numSlots: 150, samplePeriodSecs: 60 }],
    getAccountInfo: async () => ({ owner: Keypair.generate().publicKey, data: Buffer.alloc(0) }),
  };
}

const price = (usd = 180, at = PRICE_AT) => async () => ({ usdByMint: usd === null ? {} : { [MINT]: usd }, observedAt: at });

const read = (over = {}, env = registry()) =>
  readQuoteAssets({ cluster: "devnet", connection: node(over), env, now: () => NOW, price: over.price ?? price() });

test("SOL-L11: a pair read as it was checked, with Meteora's badge at the program's own account, is open", async () => {
  const [state] = await read();
  assert.equal(state.state, "OPEN");
  assert.deepEqual(state.problems, []);
  assert.equal(state.configVersion, "0.2.1", "no fee and no live authority — the older path builds it");
  assert.equal(state.feeNow, null);
  assert.equal(state.priceUsd, 180);
  assert.equal(state.priceAt, PRICE_AT);
  assert.equal(state.checkedAt, NOW.toISOString());
  assert.equal(state.record.symbol, "PAIRX");
  /* A record whose mint is thirty-two characters of base58 but no address on this chain is left out, not offered. */
  const bad = { ...registry(), RYNTRA_LAUNCH_QUOTE_ASSETS_REGISTRY: JSON.stringify([record({ mint: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }), record()]) };
  const both = await read({}, bad);
  assert.deepEqual(both.map((entry) => entry.record.mint), [MINT], "the readable one is still read");
  /* Without the flag, or without a record, nothing is read at all. */
  assert.deepEqual(await read({}, { RYNTRA_LAUNCH_QUOTE_ASSETS_REGISTRY: registry().RYNTRA_LAUNCH_QUOTE_ASSETS_REGISTRY }), []);
  assert.deepEqual(await read({}, {}), []);
});

test("SOL-L11: the badge — missing, someone else's account, or unread — closes the pair", async () => {
  assert.deepEqual((await read({ badge: null }))[0].problems, ["BADGE_MISSING"]);
  assert.deepEqual((await read({ badge: new PublicKey(address()) }))[0].problems, ["BADGE_MISSING"], "an account at that address owned by another program is not Meteora's badge");
  const unread = (await read({ answers: false }))[0];
  assert.deepEqual(unread.problems, ["BADGE_NOT_READ", "MINT_NOT_READ"]);
  assert.equal(unread.state, "CLOSED");
  assert.equal(unread.configVersion, null);
});

test("SOL-L11: what the issuer changed after the check closes the pair, each by its own reason", async () => {
  /* A fee switched on, with the authority back in the issuer's hands. */
  const raised = checkedMint(transferFee({ older: fee(0, 100), newer: fee(0, 100), authority: ISSUER, withdraw: ISSUER }));
  const feeMoved = (await read({ mint: raised }))[0];
  assert.ok(feeMoved.problems.includes("TRANSFER_FEE_CHANGED"), feeMoved.problems.join(","));
  assert.ok(feeMoved.problems.includes("AUTHORITY_CHANGED"));
  assert.equal(feeMoved.configVersion, "0.2.2", "a live fee needs createConfig2");
  assert.deepEqual(feeMoved.feeNow, { epoch: "0", bps: 100, maxRaw: "1000000000" });
  /* An extension that was not there. */
  const delegated = checkedMint({ [ExtensionType.PermanentDelegate]: { delegate: OTHER } });
  assert.ok((await read({ mint: delegated }))[0].problems.includes("EXTENSIONS_CHANGED"));
  /* The unit the issuer sets, changed and about to change. */
  const scaled = checkedMint(scaledUiAmount({ multiplier: 4 }));
  assert.ok((await read({ mint: scaled }))[0].problems.includes("MULTIPLIER_CHANGED"));
  const pending = checkedMint(scaledUiAmount({ multiplier: 1, newMultiplier: 4, effectiveAt: Math.floor(NOW.getTime() / 1000) + 3_600 }));
  assert.ok((await read({ mint: pending }))[0].problems.includes("MULTIPLIER_PENDING"));
  /* Bytes that are not a mint, and no account at all. */
  assert.ok((await read({ mint: { owner: checkedMint().owner, data: Buffer.alloc(10) } }))[0].problems.includes("MINT_NOT_READ"));
  assert.ok((await read({ mint: null }))[0].problems.includes("MINT_NOT_READ"));
  /* A price that did not come, or came too long ago. */
  assert.ok((await read({ price: price(null) }))[0].problems.includes("PRICE_UNKNOWN"));
  assert.ok((await read({ price: price(180, "2026-10-26T11:40:00.000Z") }))[0].problems.includes("PRICE_STALE"));
  assert.ok((await read({ price: async () => null }))[0].problems.includes("PRICE_UNKNOWN"));
});

test("SOL-L11: the public read may be a few seconds old; a build takes its own", async () => {
  forgetQuoteAssets();
  let reads = 0;
  const counting = () => {
    const inner = node();
    return { ...inner, getEpochInfo: async () => (reads++, inner.getEpochInfo()) };
  };
  const deps = { cluster: "devnet", connection: counting(), env: registry(), now: () => NOW, price: price() };
  await readQuoteAssets(deps, { cache: true });
  await readQuoteAssets(deps, { cache: true });
  assert.equal(reads, 1, "the listing answers from the read it already has");
  await readQuoteAssets(deps);
  assert.equal(reads, 2, "a build never does");
  forgetQuoteAssets();
  await readQuoteAssets(deps, { cache: true });
  assert.equal(reads, 3);
});

test("SOL-L11: «Розширений» builds a config in a checked pair — and the figures of that very config", async () => {
  const store = createMemoryGuardStore();
  const env = { ...SECRET, ...registry() };
  const network = launchNetwork({ ...STAND, ...registry() });
  const deps = { network, connection: node(), store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => NOW, env, quotePrice: price() };
  const creator = address();
  const choice = { ...ADVANCED_DEFAULT_CHOICE, quoteMint: MINT };
  const built = await prepareAdvancedConfig(deps, { creator, choice });
  assert.equal(built.ok, true, built.message);
  assert.equal(built.terms.quoteMint, MINT, "the config's own pair, kept with its terms for ever");
  assert.equal(built.quote.symbol, "PAIRX");
  assert.equal(built.quote.decimals, 8);
  assert.equal(built.quote.configVersion, "0.2.1");
  const figures = built.quote.figures;
  assert.equal(figures.priceUsd, 180);
  assert.equal(figures.priceAt, PRICE_AT);
  assert.ok(BigInt(figures.threshold.raw) > 0n, "the curve raises something before it moves");
  assert.equal(figures.transferFeeOnExit.raw, "0", "this pair withholds nothing now");
  /* The move's own fee comes off before anything is liquidity, and the dollars are of the price read. */
  const expectedFee = (BigInt(figures.threshold.raw) * BigInt(Math.round(built.terms.graduationFee.pct * 100))) / 10_000n;
  assert.equal(figures.graduationFee.raw, expectedFee.toString());
  assert.equal(BigInt(figures.exitLiquidity.raw), BigInt(figures.threshold.raw) - expectedFee);
  assert.ok(figures.exitLiquidity.usd > 0);
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  assert.equal(tx.feePayer?.toBase58(), creator, "the creator still pays the config's rent");
  /* Every page reads such a pair as any other pair, and no surface turns it into dollars of its own. */
  const pair = launchPair(network, "advanced", MINT, registry());
  assert.deepEqual({ ...pair }, { mint: MINT, symbol: "PAIRX", decimals: 8, usdPrice: 0, dollar: false });
  assert.equal(launchPair(network, "advanced", undefined, registry()).symbol, "USDC", "a launch without one keeps the network's pair");
  assert.throws(() => launchPair(network, "advanced", address(), registry()), /no checked pair/);
});

test("SOL-L11: a pair that moved builds nothing — the refusal says what moved, in the contract's own code", async () => {
  const store = createMemoryGuardStore();
  const env = { ...SECRET, ...registry() };
  const network = launchNetwork({ ...STAND, ...registry() });
  const creator = address();
  const choice = { ...ADVANCED_DEFAULT_CHOICE, quoteMint: MINT };
  /* No badge: the first thing read and the first thing said. */
  const noBadge = { network, connection: node({ badge: null }), store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => NOW, env, quotePrice: price() };
  const refused = await prepareAdvancedConfig(noBadge, { creator, choice });
  assert.equal(refused.code, "QUOTE_PAUSED");
  assert.match(refused.message, /token badge/);
  /* A fee the issuer switched on, and a price nobody could read. */
  const moved = { ...noBadge, connection: node({ mint: checkedMint(transferFee({ older: fee(0, 100), newer: fee(0, 100), authority: ISSUER, withdraw: ISSUER })) }) };
  assert.match((await prepareAdvancedConfig(moved, { creator, choice })).message, /transfer fee/);
  const unpriced = { ...noBadge, connection: node(), quotePrice: price(null) };
  assert.match((await prepareAdvancedConfig(unpriced, { creator, choice })).message, /price/);
  /* A mint this deployment never checked is not a pair at all, and a mint that is not an address is no choice. */
  const open = { ...noBadge, connection: node() };
  assert.equal((await prepareAdvancedConfig(open, { creator, choice: { ...ADVANCED_DEFAULT_CHOICE, quoteMint: address() } })).code, "ADVANCED_INVALID");
  assert.equal((await prepareAdvancedConfig(open, { creator, choice: { ...ADVANCED_DEFAULT_CHOICE, quoteMint: "junk" } })).code, "ADVANCED_INVALID");
  /* And the launch itself reads the pair again: a config made while the pair was open launches nothing after it moved. */
  const config = address();
  const terms = { ...choice, graduationFee: { pct: 2, creatorPct: 40 }, firstBuyCapBps: 200 };
  await store.collection("launchAdvancedConfigs").set(`devnet:${config}`, { cluster: "devnet", config, creator, terms, signature: "s", state: "CREATED", token: null, createdAt: "2026-10-26T11:00:00.000Z" });
  const metadataUri = `https://ryntra.io/api/launch/metadata/${(await storeLaunchMetadata(store, { name: "Wide Owl", symbol: "WOWL", description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t")).sha256}`;
  const launch = await prepareLaunch(moved, { creator, metadataUri, firstBuyRaw: "0", lock: null, preset: "advanced", advancedConfig: config });
  assert.equal(launch.code, "QUOTE_PAUSED");
  assert.match(launch.message, /transfer fee/);
});

test("SOL-L11: a checked pair currency is watched like any other pair — its issuer may change the mint after the launch", () => {
  const network = launchNetwork({ ...STAND, ...registry() });
  const watched = networkQuotes(network, registry());
  assert.ok(watched.some((pair) => pair.mint === MINT && pair.symbol === "PAIRX"), "the register's pair is in the pass");
  assert.ok(watched.some((pair) => pair.symbol === "USDC"), "and the presets' own pair stays in it");
  /* Without the register the pass is what it was. */
  assert.equal(networkQuotes(network, {}).some((pair) => pair.mint === MINT), false);
});
