// SOL-L11: a launch in a pair with a tokenized stock — the register of checked pair currencies and its rule. Every
// difference between the mint as it reads and as it was checked closes the launch, and each of them is held here on its
// own: another token program, an extension that was not there, no token badge, a fee the issuer moved, a price too old,
// 0.2.1 against 0.2.2. The mints are laid out by spl-token's own layouts
// (`../../solana/fixtures/token-2022-mints.mjs`); no address here is a real one.
import assert from "node:assert/strict";
import test from "node:test";

import { ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { mintProfileOf } from "../../solana/mint-profile.ts";
import { HOOK, ISSUER, OTHER, fee, metadataPointer, scaledUiAmount, token2022Mint, transferFee } from "../../solana/fixtures/token-2022-mints.mjs";
import {
  DBC_PERMISSIONLESS_EXTENSIONS,
  EXTENSION,
  QUOTE_ASSET_FLAG,
  QUOTE_ASSET_PUBLIC_FIELDS,
  QUOTE_ASSET_REASONS,
  QUOTE_ASSET_REFUSALS,
  QUOTE_ASSET_REGISTRY_ENV,
  QUOTE_PRICE_MAX_AGE_CEILING_SECONDS,
  publicQuoteAsset,
  quoteAssetProblems,
  quoteAssetRecordOf,
  quoteAssetRecords,
  quoteAssetRefusalWords,
  quoteAssetsOffered,
  quoteBadgeRequired,
  quoteConfigVersion,
  quoteFeeAt,
  quoteFeeLive,
  quoteLaunchFigures,
  quoteTransferFeeOn,
} from "./quote-asset.ts";

const MINT = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const PRICE_AT = "2026-10-26T11:58:00.000Z";

/** A stock's mint as the register checked it: the fee extension at zero, its metadata pointer and its scaled unit. */
const stockMint = (extensions = {}) =>
  token2022Mint({
    decimals: 8,
    extensions: { ...transferFee({ authority: ISSUER, withdraw: ISSUER }), ...metadataPointer(), ...scaledUiAmount({ multiplier: 1 }), ...extensions },
  });

/** The record of that mint — every field as it was read on chain. */
const record = (over = {}) => ({
  mint: MINT,
  symbol: "PAIRX",
  program: "token-2022",
  decimals: 8,
  extensions: [EXTENSION.TRANSFER_FEE_CONFIG, EXTENSION.METADATA_POINTER, EXTENSION.SCALED_UI_AMOUNT],
  transferFee: { bps: 0, scheduledBps: 0, authority: ISSUER.toBase58(), withdrawAuthority: ISSUER.toBase58() },
  authorities: { mint: ISSUER.toBase58(), freeze: null, permanentDelegate: null, close: null, transferHook: null },
  defaultAccountState: null,
  multiplier: 1,
  badge: true,
  priceMaxAgeSeconds: 300,
  note: "named in the registry",
  ...over,
});

const observed = (over = {}) => ({
  facts: mintProfileOf(MINT, stockMint()),
  badge: true,
  epoch: 900n,
  multiplier: { current: 1, pending: null, effectiveAt: null },
  priceUsd: 180,
  priceAt: PRICE_AT,
  ...over,
});

const problemsOf = (over = {}, overRecord = {}, sdk = "2.0.0") => quoteAssetProblems(record(overRecord), observed(over), { nowMs: NOW, sdk });

test("SOL-L11: the extension numbers are the token program's own, and the permissionless three are its three", () => {
  assert.equal(EXTENSION.TRANSFER_FEE_CONFIG, ExtensionType.TransferFeeConfig);
  assert.equal(EXTENSION.MINT_CLOSE_AUTHORITY, ExtensionType.MintCloseAuthority);
  assert.equal(EXTENSION.DEFAULT_ACCOUNT_STATE, ExtensionType.DefaultAccountState);
  assert.equal(EXTENSION.PERMANENT_DELEGATE, ExtensionType.PermanentDelegate);
  assert.equal(EXTENSION.TRANSFER_HOOK, ExtensionType.TransferHook);
  assert.equal(EXTENSION.METADATA_POINTER, ExtensionType.MetadataPointer);
  assert.equal(EXTENSION.TOKEN_METADATA, ExtensionType.TokenMetadata);
  assert.equal(EXTENSION.SCALED_UI_AMOUNT, ExtensionType.ScaledUiAmountConfig);
  assert.equal(EXTENSION.PAUSABLE, ExtensionType.PausableConfig);
  assert.deepEqual([...DBC_PERMISSIONLESS_EXTENSIONS].sort((a, b) => a - b), [ExtensionType.TransferFeeConfig, ExtensionType.MetadataPointer, ExtensionType.TokenMetadata].sort((a, b) => a - b));
  /* Every refusal has its plain word: a code reaches nobody without one. */
  for (const refusal of QUOTE_ASSET_REFUSALS) assert.equal(typeof QUOTE_ASSET_REASONS[refusal], "string");
});

test("SOL-L11: a mint that reads as it was checked, with its badge and a fresh price, closes nothing", () => {
  assert.deepEqual(problemsOf(), []);
  assert.equal(quoteAssetRefusalWords([]), "");
});

test("SOL-L11: another token program — the mint is not the one checked", () => {
  const classic = { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82), lamports: 1, executable: false };
  const problems = problemsOf({ facts: { ...mintProfileOf(MINT, classic), program: "spl-token", decimals: 8, mintAuthority: null }, multiplier: null });
  assert.ok(problems.includes("PROGRAM_NOT_REGISTERED"), problems.join(","));
  /* And a mint at an address under no token program at all is simply not read. */
  assert.ok(problemsOf({ facts: mintProfileOf(MINT, null) }).includes("MINT_NOT_READ"));
});

test("SOL-L11: an extension that was not there when it was checked", () => {
  const withDelegate = mintProfileOf(MINT, stockMint({ [ExtensionType.PermanentDelegate]: { delegate: OTHER } }));
  const problems = problemsOf({ facts: withDelegate });
  assert.ok(problems.includes("EXTENSIONS_CHANGED"), problems.join(","));
  assert.ok(problems.includes("AUTHORITY_CHANGED"), "and the delegate itself is an authority nobody checked");
  /* One it lost is a difference too: the register says what the mint is, not what it holds at least. */
  const withoutScaled = mintProfileOf(MINT, token2022Mint({ decimals: 8, extensions: { ...transferFee(), ...metadataPointer() } }));
  assert.ok(problemsOf({ facts: withoutScaled, multiplier: null }).includes("EXTENSIONS_CHANGED"));
});

test("SOL-L11: a transfer hook on the pair currency, or new accounts frozen, closes it whatever the register says", () => {
  const hooked = stockMint({ [ExtensionType.TransferHook]: { authority: ISSUER, programId: HOOK } });
  const hookRecord = {
    extensions: [EXTENSION.TRANSFER_FEE_CONFIG, EXTENSION.METADATA_POINTER, EXTENSION.SCALED_UI_AMOUNT, EXTENSION.TRANSFER_HOOK],
    authorities: { mint: ISSUER.toBase58(), freeze: null, permanentDelegate: null, close: null, transferHook: ISSUER.toBase58() },
  };
  const problems = problemsOf({ facts: mintProfileOf(MINT, hooked) }, hookRecord);
  assert.deepEqual(problems, ["EXTENSION_FORBIDDEN"], "checked or not, Ryntra's own swap and claim refuse a pool with a hook");
  const frozen = stockMint({ [ExtensionType.DefaultAccountState]: { state: 2 } });
  const frozenRecord = {
    extensions: [EXTENSION.TRANSFER_FEE_CONFIG, EXTENSION.DEFAULT_ACCOUNT_STATE, EXTENSION.METADATA_POINTER, EXTENSION.SCALED_UI_AMOUNT],
    defaultAccountState: "frozen",
  };
  assert.deepEqual(problemsOf({ facts: mintProfileOf(MINT, frozen) }, frozenRecord), ["EXTENSION_FORBIDDEN"], "a buyer could not receive what they bought");
});

test("SOL-L11: no token badge — the pair is not offered, and only Meteora can give one", () => {
  assert.deepEqual(problemsOf({ badge: false }), ["BADGE_MISSING"]);
  assert.deepEqual(problemsOf({ badge: null }), ["BADGE_NOT_READ"], "unknown is not «there»");
  /* The badge is the first thing said, because it is the one thing Ryntra cannot obtain. */
  assert.equal(problemsOf({ badge: false, priceUsd: null })[0], "BADGE_MISSING");
});

test("SOL-L11: which mints need a badge at all — the program's own rule", () => {
  const plain = mintProfileOf(MINT, token2022Mint({ extensions: { ...transferFee({ authority: null, withdraw: null }), ...metadataPointer() } }));
  assert.equal(quoteBadgeRequired(plain, 900n), false, "the permissionless extensions and no live fee");
  assert.equal(quoteBadgeRequired(mintProfileOf(MINT, stockMint()), 900n), true, "a scaled unit is not among them");
  const live = mintProfileOf(MINT, token2022Mint({ extensions: { ...transferFee({ older: fee(0, 50), newer: fee(0, 50) }), ...metadataPointer() } }));
  assert.equal(quoteBadgeRequired(live, 900n), true, "a fee in force needs one as well");
});

test("SOL-L11: a fee the issuer moved — in force or scheduled — closes the launch", () => {
  const raised = mintProfileOf(MINT, stockMint(transferFee({ older: fee(0, 100), newer: fee(0, 100) })));
  assert.ok(problemsOf({ facts: raised }).includes("TRANSFER_FEE_CHANGED"));
  /* Scheduled for a later epoch: caught the moment it is set, before it bites. */
  const scheduled = mintProfileOf(MINT, stockMint(transferFee({ newer: fee(950, 100) })));
  assert.ok(problemsOf({ facts: scheduled }).includes("TRANSFER_FEE_CHANGED"));
  assert.equal(quoteFeeAt(scheduled.transferFee, 900n).bps, 0, "and the rate in force is still the old one");
  assert.equal(quoteFeeAt(scheduled.transferFee, 950n).bps, 100);
  /* The fee extension gone altogether is a difference too. */
  const none = mintProfileOf(MINT, token2022Mint({ decimals: 8, extensions: { ...metadataPointer(), ...scaledUiAmount({ multiplier: 1 }) } }));
  assert.ok(problemsOf({ facts: none }).includes("TRANSFER_FEE_CHANGED"));
  /* An authority handed to someone else, with the rate untouched. */
  const handed = mintProfileOf(MINT, stockMint(transferFee({ authority: OTHER, withdraw: ISSUER })));
  assert.ok(problemsOf({ facts: handed }).includes("AUTHORITY_CHANGED"));
  const freeze = mintProfileOf(MINT, token2022Mint({ decimals: 8, freezeAuthority: OTHER, extensions: { ...transferFee(), ...metadataPointer(), ...scaledUiAmount({ multiplier: 1 }) } }));
  assert.ok(problemsOf({ facts: freeze }).includes("AUTHORITY_CHANGED"));
  assert.ok(problemsOf({}, { decimals: 6 }).includes("DECIMALS_CHANGED"));
});

test("SOL-L11: 0.2.1 against 0.2.2 — the version follows the fee, and the deployment must build it", () => {
  const zero = mintProfileOf(MINT, stockMint(transferFee({ authority: null, withdraw: null })));
  assert.equal(quoteFeeLive(zero, 900n), false);
  assert.equal(quoteConfigVersion(zero, 900n), "0.2.1");
  /* An authority that may still set a rate is a live fee even at 0 bps: the program says so, and so does Ryntra. */
  const sleeping = mintProfileOf(MINT, stockMint(transferFee({ authority: ISSUER, withdraw: ISSUER })));
  assert.equal(quoteFeeLive(sleeping, 900n), true);
  assert.equal(quoteConfigVersion(sleeping, 900n), "0.2.2");
  /* A rate with a cap of zero is no fee at all — the token program's own rule. */
  const capped = mintProfileOf(MINT, stockMint(transferFee({ older: fee(0, 100, 0), newer: fee(0, 100, 0), authority: null, withdraw: null })));
  assert.equal(quoteFeeLive(capped, 900n), false);
  /* A pair whose fee needs `createConfig2` is closed where the venue runs 1.5.13, and open on 2.0.0. */
  const feeRecord = { transferFee: { bps: 0, scheduledBps: 0, authority: ISSUER.toBase58(), withdrawAuthority: ISSUER.toBase58() } };
  assert.deepEqual(problemsOf({ facts: sleeping }, feeRecord, "1.5.13"), ["CONFIG_VERSION_UNAVAILABLE"]);
  assert.deepEqual(problemsOf({ facts: sleeping }, feeRecord, "2.0.0"), []);
  /* And a pair without a fee is refused on 2.0.0 — a config made by the wrong path is no config of this register's. */
  const noFeeRecord = { transferFee: { bps: 0, scheduledBps: 0, authority: null, withdrawAuthority: null } };
  assert.deepEqual(problemsOf({ facts: zero }, noFeeRecord, "1.5.13"), []);
  assert.deepEqual(problemsOf({ facts: zero }, noFeeRecord, "2.0.0"), ["CONFIG_VERSION_UNAVAILABLE"]);
});

test("SOL-L11: a price too old, or none, closes the launch — the curve is not set on a figure nobody read", () => {
  assert.deepEqual(problemsOf({ priceAt: "2026-10-26T11:50:00.000Z" }), ["PRICE_STALE"], "ten minutes on a pair that allows five");
  assert.deepEqual(problemsOf({ priceUsd: null }), ["PRICE_UNKNOWN"]);
  assert.deepEqual(problemsOf({ priceUsd: 0 }), ["PRICE_UNKNOWN"]);
  assert.deepEqual(problemsOf({ priceAt: "not a time" }), ["PRICE_STALE"]);
  /* A pair may allow less than the default, never more. */
  assert.deepEqual(problemsOf({ priceAt: "2026-10-26T11:59:30.000Z" }, { priceMaxAgeSeconds: 20 }), ["PRICE_STALE"]);
  assert.equal(quoteAssetRecordOf(record({ priceMaxAgeSeconds: QUOTE_PRICE_MAX_AGE_CEILING_SECONDS + 1 })), null);
});

test("SOL-L11: the unit the issuer sets — changed, or a change in flight", () => {
  assert.deepEqual(problemsOf({ multiplier: { current: 4, pending: null, effectiveAt: null } }), ["MULTIPLIER_CHANGED"]);
  assert.deepEqual(problemsOf({ multiplier: { current: 1, pending: 4, effectiveAt: "2026-10-27T13:30:00.000Z" } }), ["MULTIPLIER_PENDING"], "the figures would not hold through it");
  /* A mint with no such extension is a multiplier of one, and a record of one agrees with it. */
  assert.deepEqual(problemsOf({ facts: mintProfileOf(MINT, token2022Mint({ decimals: 8, extensions: { ...transferFee(), ...metadataPointer() } })), multiplier: null }), ["EXTENSIONS_CHANGED"]);
});

test("the registry's records — whole or left out, one per mint, and the flag over them", () => {
  assert.equal(quoteAssetRecordOf(record()).symbol, "PAIRX");
  assert.equal(quoteAssetRecordOf({ ...record(), mint: "not-an-address" }), null);
  assert.equal(quoteAssetRecordOf({ ...record(), program: "token-2023" }), null);
  assert.equal(quoteAssetRecordOf({ ...record(), extensions: ["1"] }), null);
  assert.equal(quoteAssetRecordOf({ ...record(), multiplier: 0 }), null);
  assert.equal(quoteAssetRecordOf({ ...record(), badge: "yes" }), null);
  /* An authority left unsaid is not a check: the register writes null where the mint names none. */
  const { freeze: _freeze, ...authorities } = record().authorities;
  assert.equal(quoteAssetRecordOf({ ...record(), authorities }), null);
  assert.equal(quoteAssetRecordOf({ ...record(), transferFee: { bps: 0, scheduledBps: 0, authority: "junk", withdrawAuthority: null } }), null);
  assert.equal(quoteAssetRecordOf(record({ transferFee: null })).transferFee, null);
  /* The registry: malformed rows out, the first of two rows on one mint kept. */
  const second = record({ mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "OTHERX" });
  const rows = quoteAssetRecords(JSON.stringify([record(), { mint: "junk" }, record({ symbol: "AGAIN" }), second]));
  assert.deepEqual(rows.map((row) => row.symbol), ["PAIRX", "OTHERX"]);
  assert.deepEqual(quoteAssetRecords("not json"), []);
  assert.deepEqual(quoteAssetRecords(JSON.stringify({ mint: MINT })), []);
  /* Nothing is offered without the flag, and nothing is offered by the flag alone. */
  const registry = JSON.stringify([record()]);
  assert.deepEqual(quoteAssetsOffered({ [QUOTE_ASSET_REGISTRY_ENV]: registry }), []);
  assert.deepEqual(quoteAssetsOffered({ [QUOTE_ASSET_FLAG]: "open" }), []);
  assert.equal(quoteAssetsOffered({ [QUOTE_ASSET_FLAG]: "open", [QUOTE_ASSET_REGISTRY_ENV]: registry }).length, 1);
});

test("SOL-L11: a page reads such a pair as any other pair — the mint, the symbol, the decimals, and nothing else", () => {
  const view = publicQuoteAsset(record());
  assert.deepEqual(Object.keys(view).sort(), [...QUOTE_ASSET_PUBLIC_FIELDS].sort());
  assert.deepEqual(view, { mint: MINT, symbol: "PAIRX", decimals: 8 });
  /* The operator's note stays on the server: nothing of what the pair stands for reaches a surface. */
  const said = JSON.stringify(view);
  assert.ok(!said.includes("Owner"));
  assert.ok(!said.includes("named by"));
});

test("SOL-L11: the threshold and the liquidity at the exit — in the pair's units and in dollars, after every fee", () => {
  /* 1 000 of a pair at 8 decimals: a 2 % move fee, then the issuer's 1 % on what goes into the pool. */
  const figures = quoteLaunchFigures({
    thresholdRaw: 100_000_000_000n,
    graduationFeePct: 2,
    fee: { bps: 100, maxRaw: "100000000000" },
    decimals: 8,
    multiplier: 1,
    usdPrice: 180,
    priceAt: PRICE_AT,
  });
  assert.equal(figures.threshold.units, "1000.000000");
  assert.equal(figures.threshold.usd, 180_000);
  assert.equal(figures.graduationFee.raw, "2000000000", "2 % of the threshold");
  assert.equal(figures.transferFeeOnExit.raw, "980000000", "1 % of what is left, not of the threshold");
  assert.equal(figures.exitLiquidity.raw, "97020000000");
  assert.equal(figures.exitLiquidity.units, "970.200000");
  assert.equal(figures.exitLiquidity.usd, 174_636);
  assert.equal(figures.priceAt, PRICE_AT);
  /* The unit is the issuer's: one token standing for four of them says four times as much in units, the same in dollars. */
  const scaled = quoteLaunchFigures({ thresholdRaw: 100_000_000_000n, graduationFeePct: 0, fee: null, decimals: 8, multiplier: 4, usdPrice: 180, priceAt: PRICE_AT });
  assert.equal(scaled.threshold.units, "4000.000000");
  assert.equal(scaled.threshold.usd, 180_000);
  assert.equal(scaled.exitLiquidity.raw, "100000000000", "no move fee, no issuer's fee — all of it is liquidity");
  /* Without a price there are no dollars, never a zero. */
  const unpriced = quoteLaunchFigures({ thresholdRaw: 100n, graduationFeePct: 2, fee: null, decimals: 8, multiplier: 1, usdPrice: null, priceAt: null });
  assert.equal(unpriced.threshold.usd, null);
  assert.equal(unpriced.exitLiquidity.usd, null);
  /* The move's own rule, to the raw unit: what goes to the pool is rounded up, so the fee is what is left of it. */
  const odd = quoteLaunchFigures({ thresholdRaw: 101n, graduationFeePct: 2, fee: null, decimals: 8, multiplier: 1, usdPrice: null, priceAt: null });
  assert.equal(odd.exitLiquidity.raw, "99", "101 less 2 % is 98.98 of the pair, and the pool is given 99");
  assert.equal(odd.graduationFee.raw, "2");
  const free = quoteLaunchFigures({ thresholdRaw: 0n, graduationFeePct: 2, fee: { bps: 100, maxRaw: "10" }, decimals: 8, multiplier: 1, usdPrice: 180, priceAt: PRICE_AT });
  assert.deepEqual([free.threshold.raw, free.graduationFee.raw, free.exitLiquidity.raw], ["0", "0", "0"], "nothing raised is nothing anywhere");
  /* The mint's own cap on one transfer's fee holds: the token program takes the smaller of the two. */
  assert.equal(quoteTransferFeeOn(100_000_000_000n, { bps: 100, maxRaw: "5" }), 5n);
  assert.equal(quoteTransferFeeOn(1n, { bps: 1, maxRaw: "1000" }), 1n, "rounded up, as the program rounds it");
  assert.equal(quoteTransferFeeOn(100n, null), 0n);
  assert.equal(quoteTransferFeeOn(0n, { bps: 100, maxRaw: "1000" }), 0n);
});

test("SOL-L11: the badge's address is the program's own, and both SDK versions derive the same one", async () => {
  const { DBC_PROGRAM_ID, dbcTokenBadgeAddress } = await import("../venues/meteora-dbc/sdk.server.ts");
  const legacy = dbcTokenBadgeAddress(MINT, "1.5.13");
  const next = dbcTokenBadgeAddress(MINT, "2.0.0");
  assert.equal(legacy.toBase58(), next.toBase58());
  /* The program's own seeds — «token_badge» and the mint — so a badge is read at the account Meteora created. */
  const [derived] = PublicKey.findProgramAddressSync([Buffer.from("token_badge"), new PublicKey(MINT).toBuffer()], DBC_PROGRAM_ID);
  assert.equal(legacy.toBase58(), derived.toBase58());
  assert.ok(TOKEN_2022_PROGRAM_ID.toBase58().length > 0);
});
