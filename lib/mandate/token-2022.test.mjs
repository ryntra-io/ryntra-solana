import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AddressLookupTableAccount, PublicKey } from "@solana/web3.js";

import { agentTradeInstructions, apiInstruction } from "./agent.ts";
import { agentFeeAccount } from "./fee.ts";
import { planEnable, planWithdraw, tokenAccountOf, unsignedTransaction } from "./human.ts";
import { readReceivedAtLeast, tradeTerms } from "./result.ts";
import { policyOf } from "./run.server.ts";
import { tradeRefusal } from "./signer.server.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "./ssa.ts";
import { feeMintOf, jupiterQuoteFloor, mandatePolicy, termsRefusal } from "./terms.ts";
import { EXTENSION, TOKEN_2022_PROGRAM_ID, afterTransferFee, coinRefusal, mintExtensions, readCoin, withheldOn } from "./token-2022.ts";

const K = (text) => new PublicKey(text);
const NOW = 1_762_000_000n;
const BLOCKHASH = "11111111111111111111111111111111";

/* ------------------------------------------------------------------ mints: real bytes and made ones */

/* Mints read from mainnet 02.11.2026 (`getMultipleAccounts`): Ryntra's launchpad coins and coins Jupiter lists. */
const REAL = JSON.parse(readFileSync(new URL("./fixtures/token-2022-mints.json", import.meta.url), "utf8"));
const real = (name) => ({ mint: K(REAL.mints[name].address), info: { owner: K(REAL.mints[name].owner), data: Buffer.from(REAL.mints[name].data, "base64") } });
const EPOCH = BigInt(REAL.epoch);

const u16 = (value) => [value & 0xff, value >> 8];
const u64 = (value) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return [...bytes];
};

/** A Token-2022 mint as the program writes it: the base, padding to 165, the account type, then each extension. */
function mint2022(extensions, decimals = 6) {
  const base = Array.from({ length: 82 }, (_, at) => (at === 44 ? decimals : at === 45 ? 1 : 0));
  const tlv = extensions.flatMap(([type, data]) => [...u16(type), ...u16(data.length), ...data]);
  return { owner: TOKEN_2022_PROGRAM_ID, data: Uint8Array.from([...base, ...new Array(83).fill(0), 1, ...tlv]) };
}
const pointer = [EXTENSION.MetadataPointer, new Array(64).fill(7)];
const metadata = [EXTENSION.TokenMetadata, new Array(90).fill(3)];
const transferFee = (bps, { newerBps = bps, newerEpoch = 0, maximumFee = 2n ** 64n - 1n, olderEpoch = 0 } = {}) => [
  EXTENSION.TransferFeeConfig,
  [...new Array(64).fill(9), ...u64(0), ...u64(olderEpoch), ...u64(maximumFee), ...u16(bps), ...u64(newerEpoch), ...u64(maximumFee), ...u16(newerBps)],
];
const COIN = K("Ga7cZ1yWqwtosWx3c4A5bLKQKiVnc2Ld7dWuQapPrRLL");

test("every coin of Ryntra's launchpad and pump.fun's new coins are Token-2022 with a name and a picture only: the agent trades them", () => {
  for (const name of ["STAIR", "WICK", "THUMB", "BTC_PUMP"]) {
    const { mint, info } = real(name);
    assert.ok(info.owner.equals(TOKEN_2022_PROGRAM_ID), name);
    assert.deepEqual(mintExtensions(info.data).map((extension) => extension.type), [EXTENSION.MetadataPointer, EXTENSION.TokenMetadata], name);
    const reading = readCoin(mint, info, EPOCH);
    assert.ok(reading.ok, name);
    assert.equal(reading.coin.transferFee, null);
    assert.equal(reading.coin.decimals, 6);
  }
  /* A coin of Token has no features at all. */
  const usdc = readCoin(real("USDC").mint, real("USDC").info);
  assert.ok(usdc.ok && usdc.coin.program.equals(TOKEN_PROGRAM_ID));
});

test("real coins Jupiter lists are refused for what their issuer can do, in one sentence", () => {
  const reason = (name) => coinRefusal(real(name).mint, real(name).info, EPOCH);
  assert.match(reason("PUMP"), /runs its issuer's own program on every transfer/);
  for (const name of ["EUROP", "PYUSD", "TSLAx", "CASH"]) assert.match(reason(name), /take the coin out of any wallet/, name);
  assert.match(reason("ZCAT"), /takes 3% on every transfer, above the 2%/);
  /* BERN's 4.2 % is history: from its newer epoch on, the 2.69 % in force is what is judged. */
  assert.match(reason("BERN"), /takes 2.69% on every transfer/);
  assert.match(coinRefusal(real("BERN").mint, real("BERN").info), /takes 4.2%/, "with no epoch, either rate counts");
  for (const name of ["PUMP", "EUROP", "PYUSD", "ZCAT"]) assert.match(reason(name), /^the agent does not trade this coin: /);
});

test("each feature the agent does not trade is a refusal of its own, and a feature it does not know is refused too", () => {
  const refusal = (...extensions) => coinRefusal(COIN, mint2022([pointer, metadata, ...extensions]), EPOCH);
  assert.match(refusal([EXTENSION.TransferHook, new Array(64).fill(0)]), /own program on every transfer/);
  assert.match(refusal([EXTENSION.PermanentDelegate, new Array(32).fill(1)]), /take the coin out of any wallet/);
  assert.match(refusal([EXTENSION.NonTransferable, []]), /cannot be moved, so it could never be sold/);
  assert.match(refusal([EXTENSION.ConfidentialTransferMint, new Array(65).fill(0)]), /hide its amounts/);
  assert.match(refusal([EXTENSION.ConfidentialTransferFeeConfig, new Array(129).fill(0)]), /hide its amounts/);
  assert.match(refusal([EXTENSION.DefaultAccountState, [2]]), /new wallets of this coin start frozen/);
  assert.match(refusal([EXTENSION.DefaultAccountState, [1]]), /can make new wallets of this coin start frozen/);
  assert.match(refusal([EXTENSION.PausableConfig, new Array(33).fill(0)]), /stop every transfer/);
  assert.match(refusal([EXTENSION.InterestBearingConfig, new Array(52).fill(0)]), /shown amount changes on its own/);
  assert.match(refusal([EXTENSION.ScaledUiAmountConfig, new Array(56).fill(0)]), /shown amount changes on its own/);
  assert.match(refusal([EXTENSION.MintCloseAuthority, new Array(32).fill(0)]), /close the coin itself/);
  assert.match(refusal([99, [1, 2, 3]]), /feature the agent does not know/);
  /* The gravest one is named: a delegate over a hook over a pause. */
  assert.match(refusal([EXTENSION.PausableConfig, new Array(33).fill(0)], [EXTENSION.TransferHook, new Array(64).fill(0)], [EXTENSION.PermanentDelegate, new Array(32).fill(1)]), /take the coin out/);
  /* Groups are names, as metadata is. */
  assert.equal(refusal([EXTENSION.GroupMemberPointer, new Array(64).fill(0)], [EXTENSION.TokenGroupMember, new Array(72).fill(0)]), null);
  /* Bytes that are not a whole mint. */
  assert.match(coinRefusal(COIN, { owner: TOKEN_2022_PROGRAM_ID, data: Uint8Array.from([...mint2022([pointer]).data, 18, 0, 200, 0]) }), /cannot be read whole/);
  assert.match(coinRefusal(COIN, { owner: K("11111111111111111111111111111111"), data: new Uint8Array(82) }), /not a token/);
  assert.match(coinRefusal(COIN, null), /could not be read/);
});

test("a coin its issuer can freeze is refused on either token program; USDC, the budget's own money, is not", () => {
  const freezable = (info) => {
    const data = Uint8Array.from(info.data);
    data[46] = 1;
    return { owner: info.owner, data };
  };
  const token = { owner: TOKEN_PROGRAM_ID, data: Uint8Array.from({ length: 82 }, (_, at) => (at === 44 ? 6 : at === 45 ? 1 : 0)) };
  assert.equal(coinRefusal(COIN, token), null);
  assert.match(coinRefusal(COIN, freezable(token)), /^the agent does not trade this coin: its issuer can freeze your wallet of it/);
  assert.equal(coinRefusal(COIN, mint2022([pointer, metadata]), EPOCH), null);
  assert.match(coinRefusal(COIN, freezable(mint2022([pointer, metadata])), EPOCH), /can freeze your wallet of it, and a frozen coin cannot be sold/);
  /* Ryntra's launchpad coins name no freeze authority (mainnet 02.11.2026); USDC names Circle's, and is the budget itself. */
  for (const name of ["STAIR", "WICK", "THUMB"]) assert.equal(real(name).info.data[46], 0, name);
  assert.equal(real("USDC").info.data[46], 1);
  assert.equal(coinRefusal(real("USDC").mint, real("USDC").info), null);
});

test("a transfer fee is traded up to the launchpad's own ceiling, at the rate in force and any rate already set to come", () => {
  assert.equal(coinRefusal(COIN, mint2022([pointer, transferFee(100)]), EPOCH), null);
  assert.equal(coinRefusal(COIN, mint2022([pointer, transferFee(200)]), EPOCH), null);
  assert.match(coinRefusal(COIN, mint2022([pointer, transferFee(201)]), EPOCH), /2.01% on every transfer/);
  /* A higher rate set to start next epoch is refused now: it would apply before the agent's next look. */
  assert.match(coinRefusal(COIN, mint2022([transferFee(100, { newerBps: 500, newerEpoch: Number(EPOCH) + 2 })]), EPOCH), /5% on every transfer/);
  assert.equal(coinRefusal(COIN, mint2022([transferFee(500, { newerBps: 100, newerEpoch: Number(EPOCH) - 1 })]), EPOCH), null);
  const si = readCoin(real("SI").mint, real("SI").info, EPOCH);
  assert.ok(si.ok);
  assert.equal(si.coin.transferFee.newer.bps, 100);
});

test("the token program's fee math: the rate rounded up, at most its maximum, the newer rate from its epoch; each transfer withholds again", () => {
  const coin = readCoin(COIN, mint2022([transferFee(100, { newerBps: 50, newerEpoch: 10, maximumFee: 1_000n })]), 0n).coin;
  assert.equal(withheldOn(10_001n, coin.transferFee, 9n), 101n);
  assert.equal(withheldOn(10_001n, coin.transferFee, 10n), 51n);
  assert.equal(withheldOn(10_000_000n, coin.transferFee, 9n), 1_000n, "the maximum caps it");
  assert.equal(withheldOn(0n, coin.transferFee, 9n), 0n);
  assert.equal(afterTransferFee(10_000n, coin, 9n, 1), 9_900n);
  assert.equal(afterTransferFee(10_000n, coin, 9n, 2), 9_801n);
  assert.equal(afterTransferFee(10_000n, { transferFee: null }, 9n, 2), 10_000n);
});

/* ------------------------------------------------------------------ the mandate: buys and sales of Token-2022 coins */

const route = JSON.parse(readFileSync(new URL("./fixtures/jup-build-fee.json", import.meta.url), "utf8"));
const HUMAN = K("4jh9GEonrg7rpoQv99NWrtQaiskHbiFZp59TyUfZfBGB");
const AGENT = K("9uk3gTx3paCi3zvUav7M4LyMfDVmGWworUgRGypHLjRP");
const VAULT = K(route.swapInstruction.accounts[0].pubkey);
const BUDGET = K(route.swapInstruction.accounts[1].pubkey);
const VAULT_OWN = K(route.swapInstruction.accounts[2].pubkey);
const HER_COIN = getAssociatedTokenAddressSync(COIN, HUMAN, true, TOKEN_2022_PROGRAM_ID);
const HER_WSOL = getAssociatedTokenAddressSync(NATIVE_MINT, HUMAN, true);
const FEE_WSOL = agentFeeAccount(NATIVE_MINT);
const ALT_KEY = K(Object.keys(route.addressesByLookupTableAddress)[0]);
const ALT = new AddressLookupTableAccount({ key: ALT_KEY, state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: route.addressesByLookupTableAddress[ALT_KEY.toBase58()].map(K) } });
const PROMISED = BigInt(route.outAmount);
/* A coin no catalogue reads is the table's MEME: 1 %. */
const MEME = { mint: COIN.toBase58(), verified: false, tags: [], firstPoolAt: null };

const tokenData = (mint, owner) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...new Uint8Array(101)]);
const factsWith = (coinMint) =>
  new Map([
    [VAULT_OWN.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenData(COIN, VAULT) }],
    [HER_COIN.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenData(COIN, HUMAN) }],
    [HER_WSOL.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, HUMAN) }],
    [COIN.toBase58(), coinMint],
  ]);

const terms = (extra = {}) => ({ human: HUMAN, agent: AGENT, budgetMint: NATIVE_MINT, perTrade: 500_000_000n, perDay: 2_000_000_000n, slippageBps: 100, expiresAt: NOW + 30n * 86_400n, venue: { kind: "jupiter" }, raised: true, ...extra });
const mandateOf = (t) => ({ cluster: "mainnet", terms: t, settings: K("3SH5NF7iMYLrfu9TfuCUXaVxXhe9E4bzH6Dzz8aYRx7n"), vault: VAULT, policy: K("29fL4E8eBR62Rf9CHBYvgSv9Nk63JVJ8kLnF7DQThuUf"), policySeed: 1n, budgetAccount: BUDGET });

/** The route bought into a coin of Token-2022: her account of it receives, Ryntra's 1 % in the fee slot. */
function buyRoute(mutate = () => undefined) {
  const ix = apiInstruction(route.swapInstruction);
  ix.keys[7] = { ...ix.keys[7], pubkey: HER_COIN };
  ix.data.writeUInt16LE(100, 26);
  mutate(ix);
  return ix;
}

function judge(mandate, venueInstruction, request, built = {}) {
  const instructions = agentTradeInstructions({ mandate, venueInstruction, holding: built.holding ?? 0n, setup: built.setup ?? [], transferFee: built.transferFee });
  return { instructions, refusal: tradeRefusal(unsignedTransaction(AGENT, instructions, BLOCKHASH, [ALT]).message.serialize(), mandate, policyOf(mandate), { lookupTables: [ALT], promisedOut: PROMISED, ...request }) };
}

test("the agent buys a launchpad coin of Token-2022: the chain's rules take her Token-2022 account, the signer reads the coin from its mint", () => {
  const mandate = mandateOf(terms());
  const launchpad = real("STAIR").info;
  const request = { facts: factsWith(launchpad), feeSides: { input: null, output: MEME, nowMs: Date.now() } };
  assert.equal(judge(mandate, buyRoute(), request).refusal, null);
  /* Her account not there yet: the trade opens it under the coin's own program, at the agent's cost. */
  const absent = new Map(request.facts);
  absent.delete(HER_COIN.toBase58());
  const open = createAssociatedTokenAccountIdempotentInstruction(AGENT, HER_COIN, HUMAN, COIN, TOKEN_2022_PROGRAM_ID);
  assert.equal(judge(mandate, buyRoute(), { ...request, facts: absent }, { setup: [open] }).refusal, null);
  /* Opened under the wrong program, or by a program that is no token program: refused. */
  const wrong = createAssociatedTokenAccountIdempotentInstruction(AGENT, getAssociatedTokenAddressSync(COIN, HUMAN, true), HUMAN, COIN);
  assert.match(judge(mandate, buyRoute((ix) => (ix.keys[7] = { ...ix.keys[7], pubkey: wrong.keys[1].pubkey })), { ...request, facts: absent }, { setup: [wrong] }).refusal, /not of its coin's program/);
  const alien = createAssociatedTokenAccountIdempotentInstruction(AGENT, HER_COIN, HUMAN, COIN, K("11111111111111111111111111111111"));
  assert.match(judge(mandate, buyRoute(), { ...request, facts: absent }, { setup: [alien] }).refusal, /other than the token programs/);
  /* The mint unread: the signer does not guess. */
  const unread = new Map(request.facts);
  unread.delete(COIN.toBase58());
  assert.match(judge(mandate, buyRoute(), { ...request, facts: unread }).refusal, /mint could not be read/);
});

test("the signer refuses a buy of a coin whose issuer can take it, hook it, freeze it, hide it or keep it from moving", () => {
  const mandate = mandateOf(terms());
  const feeSides = { input: null, output: MEME, nowMs: Date.now() };
  const refusalWith = (extension) => judge(mandate, buyRoute(), { facts: factsWith(mint2022([pointer, metadata, extension])), feeSides, epoch: EPOCH }).refusal;
  assert.match(refusalWith([EXTENSION.TransferHook, new Array(64).fill(0)]), /own program on every transfer/);
  assert.match(refusalWith([EXTENSION.PermanentDelegate, new Array(32).fill(1)]), /take the coin out of any wallet/);
  assert.match(refusalWith([EXTENSION.NonTransferable, []]), /could never be sold/);
  assert.match(refusalWith([EXTENSION.ConfidentialTransferMint, new Array(65).fill(0)]), /hide its amounts/);
  assert.match(refusalWith([EXTENSION.DefaultAccountState, [2]]), /start frozen/);
  assert.match(refusalWith(transferFee(300)), /3% on every transfer/);
  /* The real mints too: PUMP's hook, PYUSD's delegate. */
  for (const [name, reason] of [["PUMP", /own program/], ["PYUSD", /take the coin out/]]) {
    assert.match(judge(mandate, buyRoute(), { facts: factsWith(real(name).info), feeSides, epoch: EPOCH }).refusal, reason, name);
  }
});

test("a coin with a transfer fee is bought only when the rule asks exactly what is left of the minimum after its fee", () => {
  const mandate = mandateOf(terms());
  const si = real("SI").info;
  const feeSides = { input: null, output: MEME, nowMs: Date.now() };
  const request = { facts: factsWith(si), feeSides, epoch: EPOCH };
  const coin = readCoin(COIN, si, EPOCH).coin;
  const honest = judge(mandate, buyRoute(), request, { transferFee: { coin, epoch: EPOCH } });
  assert.equal(honest.refusal, null);
  const rule = readReceivedAtLeast(honest.instructions.at(-1));
  const ix = buyRoute();
  const { minOut } = tradeTerms({ programId: ix.programId, accounts: ix.keys.map((key) => key.pubkey), data: ix.data });
  /* After Jupiter's minimum the coin crosses one transfer to her: 1 % withheld, rounded up (measured on the fork). */
  assert.equal(rule.amount, minOut - (minOut + 99n) / 100n);
  assert.ok(rule.account.equals(HER_COIN));
  /* A rule that ignores the fee could never be met: the agent does not pay to hear it fail. */
  assert.match(judge(mandate, buyRoute(), request).refusal, /does not count the coin's transfer fee/);
  /* The epoch unknown: the rate cannot be known. */
  assert.match(judge(mandate, buyRoute(), { ...request, epoch: undefined }, { transferFee: { coin, epoch: EPOCH } }).refusal, /epoch the coin's transfer fee is read at/);
  /* A rule asking less than what is left: refused, as ever. */
  const less = judge(mandate, buyRoute(), request, { transferFee: { coin, epoch: EPOCH }, holding: 0n });
  const lowered = [...less.instructions];
  const asked = readReceivedAtLeast(lowered.at(-1));
  lowered[lowered.length - 1] = { ...lowered.at(-1), data: Buffer.from(lowered.at(-1).data) };
  lowered.at(-1).data.writeBigUInt64LE(asked.amount - 1n, 3);
  assert.match(tradeRefusal(unsignedTransaction(AGENT, lowered, BLOCKHASH, [ALT]).message.serialize(), mandate, policyOf(mandate), { lookupTables: [ALT], promisedOut: PROMISED, ...request }), /asks less than the trade's minimum/);
});

test("a regular buy of a Token-2022 coin pins her account under its program, and her floor holds after the coin's fee", () => {
  /* Her floor: 98 % of the quote — the route's own minimum is 99.5 %. */
  const minOut = (PROMISED * 98n) / 100n;
  const fixed = { amountIn: 500_000_000n, outputMint: COIN, minOut, outputProgram: TOKEN_2022_PROGRAM_ID };
  const mandate = mandateOf(terms({ fixedBuy: fixed }));
  const [route2] = mandatePolicy(mandate.terms, { vault: VAULT, budgetAccount: BUDGET }).constraints;
  assert.deepEqual(route2.accounts.find((a) => a.index === 7).rule.keys.map((k) => k.toBase58()), [HER_COIN.toBase58()]);
  const feeSides = { input: null, output: MEME, nowMs: Date.now() };
  assert.equal(judge(mandate, buyRoute(), { facts: factsWith(real("STAIR").info), feeSides }).refusal, null);
  /* With 2 % withheld on the way to her, the route's 99.5 % leaves her 97.5 %, under the floor: refused. */
  const steep = mint2022([pointer, transferFee(200)]);
  const coin = readCoin(COIN, steep, EPOCH).coin;
  assert.match(judge(mandate, buyRoute(), { facts: factsWith(steep), feeSides, epoch: EPOCH }, { transferFee: { coin, epoch: EPOCH } }).refusal, /less than the person's floor/);
  assert.match(termsRefusal({ ...mandate.terms, fixedBuy: { ...fixed, outputProgram: K("11111111111111111111111111111111") } }, NOW), /token programs/);
});

/* A sale: her coin in the vault, exactly its size each time, for at least her floor in SOL, to her wallet. */
const saleTerms = (extra = {}) =>
  terms({
    budgetMint: COIN,
    budgetCoin: { program: TOKEN_2022_PROGRAM_ID, decimals: 6 },
    perTrade: 500_000_000n,
    perDay: 1_000_000_000n,
    fixedBuy: { amountIn: 500_000_000n, outputMint: NATIVE_MINT, minOut: (PROMISED * 90n) / 100n },
    ...extra,
  });

/** The route sold her coin for SOL: from the vault's account of the coin, SOL to her, Ryntra's 1 % in SOL in the fee slot. */
function saleRoute(mutate = () => undefined) {
  const ix = apiInstruction(route.swapInstruction);
  ix.keys[7] = { ...ix.keys[7], pubkey: HER_WSOL };
  ix.data.writeUInt16LE(100, 26);
  mutate(ix);
  return ix;
}

test("the terms of a sale: a coin of the token programs, through Jupiter, a fixed size for SOL or USDC at her floor", () => {
  assert.equal(termsRefusal(saleTerms(), NOW), null);
  assert.ok(feeMintOf(saleTerms()).equals(NATIVE_MINT), "Ryntra's fee is taken in what she receives");
  assert.ok(feeMintOf(terms()).equals(NATIVE_MINT));
  assert.match(termsRefusal(saleTerms({ fixedBuy: undefined }), NOW), /names its size/);
  assert.match(termsRefusal(saleTerms({ fixedBuy: { amountIn: 1n, outputMint: COIN, minOut: 1n } }), NOW), /paid in SOL or USDC/);
  assert.match(termsRefusal(saleTerms({ venue: { kind: "dlmm", pool: COIN } }), NOW), /through Jupiter/);
  assert.match(termsRefusal(saleTerms({ budgetMint: NATIVE_MINT }), NOW), /not a coin to sell/);
  assert.match(termsRefusal(saleTerms({ budgetCoin: { program: K("11111111111111111111111111111111"), decimals: 6 } }), NOW), /token programs/);
  assert.match(termsRefusal(saleTerms({ fixedBuy: { amountIn: 600_000_000n, outputMint: NATIVE_MINT, minOut: 1n } }), NOW), /within the trade cap/);
  assert.match(termsRefusal(saleTerms({ expiresAt: NOW + 91n * 86_400n }), NOW), /90 days/);
  /* The policy: her account of SOL pinned, Ryntra's SOL account in the fee slot, the quote at her floor, the coin's day cap. */
  const policy = mandatePolicy(saleTerms(), { vault: VAULT, budgetAccount: BUDGET });
  const [route2] = policy.constraints;
  assert.deepEqual(route2.accounts.find((a) => a.index === 7).rule.keys.map((k) => k.toBase58()), [HER_WSOL.toBase58()]);
  assert.deepEqual(route2.accounts.find((a) => a.index === 10).rule.keys.map((k) => k.toBase58()), [FEE_WSOL.toBase58()]);
  assert.deepEqual(route2.data.find((d) => d.offset === 16).value.value, jupiterQuoteFloor((PROMISED * 90n) / 100n, 100));
  assert.deepEqual(policy.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod]), [[COIN.toBase58(), 1_000_000_000n]]);
});

test("the agent sells her Token-2022 coin for SOL: the signer reads both coins, takes Ryntra's rate from the table, and refuses a coin off the list", () => {
  const mandate = mandateOf(saleTerms());
  const feeSides = { input: MEME, output: null, nowMs: Date.now() };
  assert.equal(judge(mandate, saleRoute(), { facts: factsWith(real("STAIR").info), feeSides }).refusal, null);
  /* A coin with a fee on transfers is sold too: the vault's transfer to the pool withholds it, and Jupiter's quote counts it. */
  assert.equal(judge(mandateOf(saleTerms({ budgetCoin: { program: TOKEN_2022_PROGRAM_ID, decimals: 6, transferFee: true } })), saleRoute(), { facts: factsWith(real("SI").info), feeSides, epoch: EPOCH }).refusal, null);
  assert.match(judge(mandate, saleRoute(), { facts: factsWith(mint2022([pointer, [EXTENSION.PermanentDelegate, new Array(32).fill(1)]])), feeSides }).refusal, /take the coin out/);
  assert.match(judge(mandate, saleRoute(), { facts: factsWith(mint2022([pointer, [EXTENSION.TransferHook, new Array(64).fill(0)]])), feeSides }).refusal, /own program/);
  /* Ryntra's fee goes only to its SOL account, at the table's 1 % for a coin no catalogue reads. */
  assert.match(judge(mandate, saleRoute((ix) => ix.data.writeUInt16LE(10, 26)), { facts: factsWith(real("STAIR").info), feeSides }).refusal, /not the table's rate/);
  assert.match(judge(mandate, saleRoute((ix) => (ix.keys[10] = { ...ix.keys[10], pubkey: agentFeeAccount(K("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")) })), { facts: factsWith(real("STAIR").info), feeSides }).refusal, /account 10/);
  /* Under her floor, or the output not hers: the chain's own rules. */
  assert.match(judge(mandate, saleRoute((ix) => ix.data.writeBigUInt64LE(2n, 16)), { facts: factsWith(real("STAIR").info), feeSides, promisedOut: 1n }).refusal, /number at 16/);
  assert.match(judge(mandate, saleRoute((ix) => (ix.keys[7] = { ...ix.keys[7], pubkey: HER_COIN })), { facts: factsWith(real("STAIR").info), feeSides }).refusal, /account 7/);
});

test("turning a sale on moves her coin into the vault under its program; taking it back sweeps a withheld fee first", () => {
  const config = { smartAccountIndex: 597_750n, creationFee: 0n, treasury: K("BrQAbGdWQ9YUHmWWgKFdFe4miTURH71jkYFPXfaosqDv") };
  const t = saleTerms({ budgetCoin: { program: TOKEN_2022_PROGRAM_ID, decimals: 6, transferFee: true } });
  const plan = planEnable({ cluster: "mainnet", terms: t, account: { kind: "absent", config }, fund: 1_000_000_000n, nowSeconds: NOW });
  const flat = plan.transactions.flat();
  const budget = tokenAccountOf(plan.mandate.vault, COIN, TOKEN_2022_PROGRAM_ID);
  assert.ok(plan.mandate.budgetAccount.equals(budget));
  const fund = flat.find((ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID));
  assert.ok(fund && fund.keys[0].pubkey.equals(tokenAccountOf(HUMAN, COIN, TOKEN_2022_PROGRAM_ID)) && fund.keys[2].pubkey.equals(budget));
  /* Her SOL account and the vault's own are opened under Token. */
  assert.ok(flat.some((ix) => ix.keys[1]?.pubkey.equals(HER_WSOL)));
  const back = planWithdraw(plan.mandate, 400_000_000n);
  /* Token-2022's `HarvestWithheldTokensToMint` (26): nothing moves to anyone, and the account can close. */
  const sweep = back.find((ix) => ix.programId.equals(TOKEN_2022_PROGRAM_ID));
  assert.ok(sweep && sweep.data[0] === 26 && sweep.keys[1].pubkey.equals(budget));
  /* A buy of a Token-2022 coin: her account and the vault's own opened under its program. */
  const buy = planEnable({ cluster: "mainnet", terms: terms(), account: { kind: "absent", config }, fund: 0n, nowSeconds: NOW, receiveMints: [{ mint: COIN, program: TOKEN_2022_PROGRAM_ID }] });
  const opened = buy.transactions.flat().filter((ix) => ix.keys[3]?.pubkey.equals(COIN));
  assert.deepEqual(opened.map((ix) => [ix.keys[1].pubkey.toBase58(), ix.keys[5].pubkey.toBase58()]), [
    [HER_COIN.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()],
    [tokenAccountOf(buy.mandate.vault, COIN, TOKEN_2022_PROGRAM_ID).toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()],
  ]);
});
