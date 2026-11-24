/* «Повторюй за гаманцем» with money: the copy's policies (the chain's rules, as the judge reads them) and the
   agent's signer, each refusal with its test. The routes are Jupiter's own bytes — `/build`'s sale of a pump.fun coin of
   Token-2022 from the vault into her wSOL — and, for a buy, the same route turned round:
   the budget in, a coin of hers out into the vault's own account of it. No network, no real key.

   What the program does beyond the rules — its count of each vault account before and after (`account_tracking.rs` of
   the smart account program at `0e51082`, the build on mainnet) — is modelled here by `tracked`, so that a test can say
   which coin may leave the vault under which policy; the fork rehearsal (`docs/research/city-376-copy-money/`) proves it on
   the real program. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, TransactionMessage } from "@solana/web3.js";

import { envKey } from "../launch/signer/env.server.ts";

import { agentTradeInstructions, apiInstruction } from "./agent.ts";
import { agentFeeAccount, agentFeeRaw, feeTransferInstruction, pairFeeBps, uncataloguedFacts } from "./fee.ts";
import { copySaleChunk, fits, planEnable, planStop, planWithdrawHeld, tokenAccountOf } from "./human.ts";
import { instructionRefusal } from "./judge.ts";
import { OPEN_SCREEN } from "./ryntra-coins.server.ts";
import { mandateSigner, screenRefusal, tradeRefusal, tradeSides } from "./signer.server.ts";
import { NATIVE_MINT, REFUSAL, TOKEN_PROGRAM_ID, policyExecuteInstruction, ssaAddress } from "./ssa.ts";
import { COPY_COINS_MAX, COPY_COINS_PER_SALE, DLMM_PROGRAM_ID, DLMM_SWAP2, LAYOUT, copyChunkOf, copyChunks, copySalePolicyOf, heldAccountOf, heldDailyMax, mandatePolicy, termsRefusal } from "./terms.ts";
import { TOKEN_2022_PROGRAM_ID, USDC_MINTS } from "./token-2022.ts";

const K = (text) => new PublicKey(text);
const seeded = (name) => Keypair.fromSeed(createHash("sha256").update(`city-376 test ${name}`).digest()).publicKey;
const NOW_S = BigInt(Math.floor(Date.now() / 1000));
const body = JSON.parse(readFileSync(new URL("./fixtures/route-sell-btc.json", import.meta.url), "utf8"));
const fork = JSON.parse(readFileSync(new URL("./fixtures/fork-pass-2022.json", import.meta.url), "utf8"));
const REAL = JSON.parse(readFileSync(new URL("./fixtures/token-2022-mints.json", import.meta.url), "utf8"));

const BTC = K(body.inputMint);
const human = K(fork.human);
const vault = K(fork.vault);
const agent = K(fork.agent);
const attacker = seeded("attacker");
const USDC = USDC_MINTS[0];
const settings = ssaAddress.settings(88n);
const buyPolicy = ssaAddress.policy(settings, 1n);
const budgetAccount = tokenAccountOf(vault, NATIVE_MINT);
const herWsol = tokenAccountOf(human, NATIVE_MINT);
const FEE_WSOL = agentFeeAccount(NATIVE_MINT);
const EPOCH = BigInt(fork.epoch);

/* Her copy: the coin of the real route first (Token-2022, on the agent's list), then coins of Token — seven, two groups. */
const coinB = seeded("coin b");
const others = Array.from({ length: 5 }, (_, i) => seeded(`coin ${i}`));
const day = (n) => heldDailyMax(BigInt(n));
const copyCoins = [{ mint: BTC, program: TOKEN_2022_PROGRAM_ID, dailyMax: day(body.inAmount) }, { mint: coinB, program: TOKEN_PROGRAM_ID, dailyMax: day(5_000_000) }, ...others.map((mint) => ({ mint, program: TOKEN_PROGRAM_ID, dailyMax: day(1_000) }))];
const terms = { human, agent, budgetMint: NATIVE_MINT, perTrade: 20_000_000n, perDay: 100_000_000n, slippageBps: 100, expiresAt: NOW_S + 7n * 86_400n, venue: { kind: "jupiter" }, copyCoins };
const salePolicies = copyChunks(copyCoins).map((_c, chunk) => ssaAddress.policy(settings, 2n + BigInt(chunk)));
const mandate = { cluster: "mainnet", terms, settings, vault, policy: buyPolicy, policySeed: 1n, budgetAccount, salePolicies };
const accounts = { vault, budgetAccount };
const buy = mandatePolicy(terms, accounts);
const sale0 = copySalePolicyOf(terms, accounts, 0);
const sale1 = copySalePolicyOf(terms, accounts, 1);
const vaultBtc = heldAccountOf(vault, copyCoins[0]);
const vaultB = heldAccountOf(vault, copyCoins[1]);
const vaultLast = heldAccountOf(vault, copyCoins.at(-1));

const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const tokenData = (mint, owner, amount = 0n) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...u64(amount), ...new Array(93).fill(0)]);
const inner = (ix) => ({ programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: ix.data });
const setKey = (index, pubkey) => (ix) => (ix.keys[index] = { ...ix.keys[index], pubkey });
const facts = new Map([
  [budgetAccount.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, vault, 80_000_000n) }],
  [herWsol.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, human, 5_000n) }],
  [vaultBtc.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenData(BTC, vault, BigInt(body.inAmount)) }],
  [vaultB.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coinB, vault, 0n) }],
  [vaultLast.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(copyCoins.at(-1).mint, vault, 10n) }],
  [tokenAccountOf(human, coinB).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coinB, human, 0n) }],
  [tokenAccountOf(attacker, coinB).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coinB, attacker, 0n) }],
  [BTC.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.from(REAL.mints.BTC_PUMP.data, "base64") }],
]);

/** Jupiter's real sale route of the coin, with one change. */
const saleRoute = (mutate = () => {}) => {
  const ix = apiInstruction(body.swapInstruction);
  mutate(ix);
  return ix;
};
const SALE_SIDES = { input: uncataloguedFacts(BTC.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: Date.now() };
const BUY_SIDES = { input: uncataloguedFacts(NATIVE_MINT.toBase58()), output: uncataloguedFacts(coinB.toBase58()), nowMs: Date.now() };
const BUY_BPS = pairFeeBps(NATIVE_MINT.toBase58(), coinB.toBase58(), BUY_SIDES);
const BUY_QUOTE = 4_000_000n;
/** The same route turned round: her budget in, coin B out into the vault's own account of it, Ryntra's fee in SOL. */
const buyRoute = (mutate = () => {}) =>
  saleRoute((ix) => {
    setKey(LAYOUT.routeV2.source, budgetAccount)(ix);
    setKey(LAYOUT.routeV2.own, vaultB)(ix);
    setKey(LAYOUT.routeV2.inputMint, NATIVE_MINT)(ix);
    setKey(LAYOUT.routeV2.outputMint, coinB)(ix);
    setKey(LAYOUT.routeV2.receiver, vaultB)(ix);
    ix.data.writeBigUInt64LE(terms.perTrade, LAYOUT.routeV2.inAmount);
    ix.data.writeBigUInt64LE(BUY_QUOTE, LAYOUT.routeV2.quotedOut);
    ix.data.writeUInt16LE(BUY_BPS, LAYOUT.routeV2.platformFee);
    mutate(ix);
  });
const messageAs = (payerKey, instructions) => new TransactionMessage({ payerKey, recentBlockhash: "11111111111111111111111111111111", instructions: [...instructions] }).compileToV0Message().serialize();
const messageOf = (instructions) => messageAs(agent, instructions);
const saleMessage = (venueInstruction = saleRoute(), extra = {}) => messageOf(agentTradeInstructions({ mandate: extra.mandate ?? mandate, venueInstruction, holding: 5_000n, side: "sell", salePolicy: extra.salePolicy ?? salePolicies[0], ...extra }));
const buyMessage = (venueInstruction = buyRoute(), extra = {}) => messageOf(agentTradeInstructions({ mandate: extra.mandate ?? mandate, venueInstruction, holding: 0n, side: "buy", ...extra }));
const saleRequest = (over = {}) => ({ facts, promisedOut: BigInt(body.outAmount), feeSides: SALE_SIDES, epoch: EPOCH, ...over });
const buyRequest = (over = {}) => ({ facts, promisedOut: BUY_QUOTE, feeSides: BUY_SIDES, epoch: EPOCH, ...over });

/**
 * The program's count of the vault's token accounts around an execution, modelled (`account_tracking.rs` at `0e51082`):
 * with any limit in the policy, an account of the vault that fell must have a limit of its mint with that much left of its
 * day; with none, it may not fall at all. `moves` — mint and how much left that account; `used` — what each mint's day spent.
 */
function tracked(policy, moves, used = new Map()) {
  if (!policy.spendingLimits.length) return null;
  for (const { mint, fell } of moves) {
    if (fell <= 0n) continue;
    const limit = policy.spendingLimits.find((entry) => entry.mint.equals(mint));
    if (!limit) return "ProgramInteractionModifiedIllegalBalance";
    if (fell > limit.maxPerPeriod - (used.get(mint.toBase58()) ?? 0n)) return "ProgramInteractionInsufficientTokenAllowance";
  }
  return null;
}

/* ------------------------------------------------------------------ the terms */

test("a copy names one to ten coins of hers, each once, coins not SOL or USDC, of the token programs — and nothing else", () => {
  assert.equal(COPY_COINS_MAX, 10);
  const seven = { ...terms, copyCoins: copyCoins.slice(0, 7) };
  assert.equal(termsRefusal(seven, NOW_S), null);
  const coin = (mint, extra = {}) => ({ mint, program: TOKEN_PROGRAM_ID, dailyMax: 5n, ...extra });
  const cases = [
    [{ copyCoins: [] }, /one to 10 coins/],
    [{ copyCoins: Array.from({ length: 11 }, (_, i) => coin(seeded(`many ${i}`))) }, /one to 10 coins/],
    [{ copyCoins: [coin(coinB), coin(coinB)] }, /each coin once/],
    [{ copyCoins: [coin(NATIVE_MINT)] }, /a coin, not SOL or USDC/],
    [{ copyCoins: [coin(USDC)] }, /a coin, not SOL or USDC/],
    [{ copyCoins: [coin(coinB, { program: SystemProgram.programId })] }, /token programs/],
    [{ copyCoins: [coin(coinB, { dailyMax: 0n })] }, /a day's share/],
    [{ copyCoins: [coin(coinB, { pool: seeded("pool") })] }, /names its pool on devnet, and none through Jupiter/],
    [{ heldCoin: coin(coinB) }, /buys the leader's coins and nothing else/],
    [{ fixedBuy: { amountIn: 1n, outputMint: coinB, minOut: 1n } }, /buys the leader's coins and nothing else/],
    [{ budgetMint: coinB }, /SOL or USDC/],
    [{ slippageBps: 500 }, /at most 1 %/],
    [{ perTrade: 200_000_000n }, /at most the day's cap/],
    [{ agent: human }, /not the person's wallet/],
    [{ expiresAt: NOW_S - 1n }, /in the future/],
  ];
  for (const [over, reason] of cases) assert.match(termsRefusal({ ...seven, ...over }, NOW_S) ?? "written", reason, JSON.stringify(Object.keys(over)));
  /* On devnet each coin names its own pool, the gate's among them, and is a coin of Token. */
  const pool = seeded("gate pool");
  const devnet = { ...terms, venue: { kind: "dlmm", pool }, copyCoins: [coin(coinB, { pool }), coin(others[0], { pool: seeded("second pool") })] };
  assert.equal(termsRefusal(devnet, NOW_S), null);
  assert.match(termsRefusal({ ...devnet, copyCoins: [coin(coinB)] }, NOW_S), /names its pool on devnet/);
  assert.match(termsRefusal({ ...devnet, copyCoins: [coin(coinB, { pool: seeded("x") })] }, NOW_S), /the gate's among them/);
  assert.match(termsRefusal({ ...devnet, copyCoins: [coin(coinB, { pool }), coin(others[0], { pool })] }, NOW_S), /its own pool/);
  assert.match(termsRefusal({ ...devnet, copyCoins: [coin(coinB, { pool, program: TOKEN_2022_PROGRAM_ID })] }, NOW_S), /only a coin of Token/);
});

test("her coins go to sales' policies five at a time, in the order she signed; each coin's group is known", () => {
  assert.equal(COPY_COINS_PER_SALE, 5);
  assert.deepEqual(copyChunks(copyCoins).map((group) => group.length), [5, 2]);
  assert.equal(copyChunkOf(copyCoins, BTC), 0);
  assert.equal(copyChunkOf(copyCoins, copyCoins[5].mint), 1);
  assert.equal(copyChunkOf(copyCoins, attacker), null);
  assert.equal(copySaleChunk(mandate, salePolicies[1]), 1);
  assert.equal(copySaleChunk(mandate, buyPolicy), null);
  /* A mandate whose sales' policies are not one for each group has no copy sale at all. */
  assert.equal(copySaleChunk({ ...mandate, salePolicies: salePolicies.slice(0, 1) }, salePolicies[0]), null);
});

/* ------------------------------------------------------------------ the policies as the chain holds them */

test("the buy's policy: its one limit the budget's day, its output only into a token account of her vault", () => {
  assert.deepEqual(buy.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod, l.period]), [[NATIVE_MINT.toBase58(), terms.perDay, "daily"]]);
  const receiver = buy.constraints[0].accounts.find((a) => a.index === LAYOUT.routeV2.receiver);
  assert.equal(receiver.rule.kind, "data");
  assert.deepEqual([...receiver.rule.constraints[0].value.value], [...vault.toBytes()], "the receiving account's owner is the vault");
  assert.equal(instructionRefusal(inner(buyRoute()), buy.constraints[0], facts), null);
  const cases = [
    ["into her own wallet — the agent could not sell it", buyRoute(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(human, coinB))), /account 7: the bytes at 32 are not the pinned ones/],
    ["into a stranger's account", buyRoute(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(attacker, coinB))), /account 7: the bytes at 32 are not the pinned ones/],
    ["from a coin of the vault, not the budget", buyRoute(setKey(LAYOUT.routeV2.source, vaultBtc)), /account 1 is not a pinned one/],
    ["over the trade cap", buyRoute((ix) => ix.data.writeBigUInt64LE(terms.perTrade + 1n, LAYOUT.routeV2.inAmount)), /number at 8 .* breaks lessThanOrEqualTo/],
    ["slippage over 1 %", buyRoute((ix) => ix.data.writeUInt16LE(101, LAYOUT.routeV2.slippage)), /number at 24 .* breaks lessThanOrEqualTo 100/],
    ["the fee to a stranger", buyRoute(setKey(LAYOUT.routeV2.feeAccount, tokenAccountOf(attacker, NATIVE_MINT))), /account 10 is not a pinned one/],
  ];
  for (const [name, ix, reason] of cases) assert.match(instructionRefusal(inner(ix), buy.constraints[0], facts) ?? "kept", reason, name);
  /* The buy names no limit of any coin: no buy lowers a coin the copy holds. */
  assert.equal(tracked(buy, [{ mint: BTC, fell: 1n }]), "ProgramInteractionModifiedIllegalBalance");
  assert.equal(tracked(buy, [{ mint: NATIVE_MINT, fell: terms.perDay }]), null);
  assert.equal(tracked(buy, [{ mint: NATIVE_MINT, fell: terms.perDay + 1n }]), "ProgramInteractionInsufficientTokenAllowance");
});

test("each sale's policy names a day's limit for each coin of its group and nothing else — no budget, no other group's coin", () => {
  assert.deepEqual(sale0.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod, l.period]), copyCoins.slice(0, 5).map((c) => [c.mint.toBase58(), c.dailyMax, "daily"]));
  assert.deepEqual(sale1.spendingLimits.map((l) => l.mint.toBase58()), copyCoins.slice(5).map((c) => c.mint.toBase58()));
  for (const sale of [sale0, sale1]) {
    assert.ok(sale.spendingLimits.every((l) => l.expiration === terms.expiresAt && l.maxPerPeriod < (1n << 64n)));
    assert.equal(tracked(sale, [{ mint: NATIVE_MINT, fell: 1n }]), "ProgramInteractionModifiedIllegalBalance", "no sale spends the budget");
  }
  assert.equal(tracked(sale0, [{ mint: copyCoins[6].mint, fell: 1n }]), "ProgramInteractionModifiedIllegalBalance", "a coin of the other group");
  assert.equal(tracked(sale0, [{ mint: attacker, fell: 1n }]), "ProgramInteractionModifiedIllegalBalance", "a coin outside her copy");
  assert.equal(tracked(sale0, [{ mint: BTC, fell: copyCoins[0].dailyMax }]), null, "a whole day's share in one sale");
  assert.equal(tracked(sale0, [{ mint: BTC, fell: 1n }], new Map([[BTC.toBase58(), copyCoins[0].dailyMax]])), "ProgramInteractionInsufficientTokenAllowance", "over the coin's day");
  assert.equal(REFUSAL.ProgramInteractionModifiedIllegalBalance, "a coin outside the mandate left the vault");
});

test("Jupiter's real sale route meets the sale's rules of the coin's group; the money only to her account of the budget's token", () => {
  assert.equal(instructionRefusal(inner(saleRoute()), sale0.constraints[0], facts), null);
  const cases = [
    ["a stranger receives the money", saleRoute(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(attacker, NATIVE_MINT))), /account 7 is not a pinned one/],
    ["the money stays in the vault", saleRoute(setKey(LAYOUT.routeV2.receiver, budgetAccount)), /account 7 is not a pinned one/],
    ["another output mint", saleRoute(setKey(LAYOUT.routeV2.outputMint, USDC)), /account 4 is not a pinned one/],
    ["Jupiter's own leg a stranger's", saleRoute(setKey(LAYOUT.routeV2.own, tokenAccountOf(attacker, NATIVE_MINT))), /account 2 is not a pinned one/],
    ["someone other than the vault signs", saleRoute(setKey(LAYOUT.routeV2.authority, attacker)), /account 0 is not a pinned one/],
    ["the fee to a stranger", saleRoute(setKey(LAYOUT.routeV2.feeAccount, tokenAccountOf(attacker, NATIVE_MINT))), /account 10 is not a pinned one/],
    ["slippage over 1 %", saleRoute((ix) => ix.data.writeUInt16LE(101, LAYOUT.routeV2.slippage)), /number at 24 .* breaks lessThanOrEqualTo 100/],
    ["all positive slippage on a quote of almost nothing", saleRoute((ix) => (ix.data.writeUInt16LE(10_000, LAYOUT.routeV2.positiveSlippage), ix.data.writeBigUInt64LE(1n, LAYOUT.routeV2.quotedOut))), /number at 28 \(10000\) breaks equals 0/],
  ];
  for (const [name, ix, reason] of cases) assert.match(instructionRefusal(inner(ix), sale0.constraints[0], facts) ?? "kept", reason, name);
  /* The account sold from is held by the limits, not a pin: the budget as the source passes the rules and falls on the count. */
  assert.equal(instructionRefusal(inner(saleRoute(setKey(LAYOUT.routeV2.source, budgetAccount))), sale0.constraints[0], facts), null);
  assert.equal(tracked(sale0, [{ mint: NATIVE_MINT, fell: BigInt(body.inAmount) }]), "ProgramInteractionModifiedIllegalBalance");
  /* A buy through a sale's rules: the money is her wSOL, never a coin. */
  assert.match(instructionRefusal(inner(buyRoute()), sale0.constraints[0], facts), /account 2 is not a pinned one/);
  /* A sale through the buy's rules: the source is the budget's account, pinned. */
  assert.match(instructionRefusal(inner(saleRoute()), buy.constraints[0], facts), /account 1 is not a pinned one/);
});

test("the shared route of a copy's sale is held the same: the vault, her account, Ryntra's fee, no positive slippage", () => {
  const at = LAYOUT.sharedRouteV2;
  const shared = (over = {}) => {
    const keys = Array.from({ length: 16 }, () => seeded(`shared ${Math.random()}`));
    keys[at.authority] = over.authority ?? vault;
    keys[at.source] = over.source ?? vaultBtc;
    keys[at.receiver] = over.receiver ?? herWsol;
    keys[at.feeAccount] = over.fee ?? FEE_WSOL;
    const data = Buffer.alloc(32);
    Buffer.from([209, 152, 83, 147, 124, 254, 216, 233]).copy(data, 0);
    data.writeUInt16LE(over.slippage ?? 100, at.slippage);
    data.writeUInt16LE(over.feeBps ?? 100, at.platformFee);
    data.writeUInt16LE(over.positive ?? 0, at.positiveSlippage);
    return { programId: K("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), accounts: keys, data };
  };
  assert.equal(instructionRefusal(shared(), sale0.constraints[1], facts), null);
  assert.match(instructionRefusal(shared({ receiver: tokenAccountOf(attacker, NATIVE_MINT) }), sale0.constraints[1], facts), /account 5/);
  assert.match(instructionRefusal(shared({ authority: attacker }), sale0.constraints[1], facts), /account 1/);
  assert.match(instructionRefusal(shared({ fee: tokenAccountOf(attacker, NATIVE_MINT) }), sale0.constraints[1], facts), /account 12/);
  assert.match(instructionRefusal(shared({ positive: 1 }), sale0.constraints[1], facts), /number at 29 \(1\) breaks equals 0/);
  assert.match(instructionRefusal(shared({ slippage: 300 }), sale0.constraints[1], facts), /number at 25/);
});

/* ------------------------------------------------------------------ the agent's signer */

test("the signer signs the copy's honest buy — a coin of hers, into the vault's own account of it — and the honest sale", () => {
  assert.equal(tradeRefusal(buyMessage(), mandate, buy, buyRequest()), null);
  assert.equal(tradeRefusal(saleMessage(), mandate, buy, saleRequest()), null);
  assert.equal(tradeSides(saleMessage(), mandate, saleRequest())?.bought.toBase58(), NATIVE_MINT.toBase58());
});

test("the signer refuses every buy of the copy that is not one of her coins into the vault's own account of it", () => {
  const stranger = seeded("not hers");
  const strangerVault = heldAccountOf(vault, { mint: stranger, program: TOKEN_PROGRAM_ID });
  const herB = tokenAccountOf(human, coinB);
  const withFacts = new Map([...facts, [strangerVault.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(stranger, vault) }]]);
  /* A token account of the vault, but not the vault's own of that coin (another address the vault owns). */
  const sideAccount = seeded("side account");
  const sideFacts = new Map([...facts, [sideAccount.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coinB, vault) }]]);
  const cases = [
    ["a coin she did not sign for", buyMessage(buyRoute((ix) => (setKey(LAYOUT.routeV2.outputMint, stranger)(ix), setKey(LAYOUT.routeV2.own, strangerVault)(ix), setKey(LAYOUT.routeV2.receiver, strangerVault)(ix)))), buyRequest({ facts: withFacts, feeSides: { ...BUY_SIDES, output: uncataloguedFacts(stranger.toBase58()) } }), /the copy buys only a coin she signed for/],
    ["into her wallet, where the agent could not sell it", buyMessage(buyRoute(setKey(LAYOUT.routeV2.receiver, herB))), buyRequest(), /account 7: the bytes at 32 are not the pinned ones/],
    ["into another account the vault owns", buyMessage(buyRoute((ix) => (setKey(LAYOUT.routeV2.own, sideAccount)(ix), setKey(LAYOUT.routeV2.receiver, sideAccount)(ix)))), buyRequest({ facts: sideFacts }), /does not land in the vault's own account of the coin/],
    ["into a stranger's account", buyMessage(buyRoute(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(attacker, coinB)))), buyRequest(), /account 7/],
    ["under a sale's policy", messageOf(agentTradeInstructions({ mandate, venueInstruction: buyRoute(), holding: 0n, side: "sell", salePolicy: salePolicies[0] })), buyRequest(), /account 2 is not a pinned one/],
  ];
  for (const [name, message, request, reason] of cases) assert.match(tradeRefusal(message, mandate, buy, request) ?? "signed", reason, name);
});

test("the signer refuses every sale of the copy that is not a coin of the group, from the vault, to her account", () => {
  const otherGroupSource = saleRoute(setKey(LAYOUT.routeV2.source, vaultLast));
  const cases = [
    ["the budget sold under a sale's policy", saleMessage(saleRoute(setKey(LAYOUT.routeV2.source, budgetAccount))), /the copy sells only a coin of this sale's group/],
    ["a coin of the other group under this group's policy", saleMessage(otherGroupSource), /the copy sells only a coin of this sale's group/],
    ["a coin under the other group's policy", saleMessage(saleRoute(), { salePolicy: salePolicies[1] }), /the copy sells only a coin of this sale's group/],
    ["a stranger receives the money", saleMessage(saleRoute(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(attacker, NATIVE_MINT)))), /account 7 is not a pinned one/],
    ["the coin sold under the buy's policy", messageOf(agentTradeInstructions({ mandate, venueInstruction: saleRoute(), holding: 5_000n, side: "buy" })), /account 1 is not a pinned one/],
    ["a policy that is not hers", saleMessage(saleRoute(), { salePolicy: ssaAddress.policy(settings, 9n) }), /an execution under another policy/],
  ];
  for (const [name, message, reason] of cases) assert.match(tradeRefusal(message, mandate, buy, saleRequest()) ?? "signed", reason, name);
  /* One sale over the coin's whole day: the chain refuses it (its limit), and the signer before it. */
  const small = { ...mandate, terms: { ...terms, copyCoins: [{ ...copyCoins[0], dailyMax: BigInt(body.inAmount) - 1n }, ...copyCoins.slice(1)] } };
  assert.match(tradeRefusal(saleMessage(saleRoute(), { mandate: small }), small, mandatePolicy(small.terms, accounts), saleRequest()), /the sale is over the coin's day/);
  /* An extra instruction in the execution — a transfer of the coin out of the vault — is no sale. */
  const extra = (() => {
    const instructions = agentTradeInstructions({ mandate, venueInstruction: saleRoute(), holding: 5_000n, side: "sell", salePolicy: salePolicies[0] });
    const execution = policyExecuteInstruction({ policy: salePolicies[0], signer: agent, instructions: [saleRoute(), SystemProgram.transfer({ fromPubkey: vault, toPubkey: attacker, lamports: 1n })], constraintIndices: [0, 0] });
    return messageOf(instructions.map((ix) => (ix.programId.equals(execution.programId) ? execution : ix)));
  })();
  assert.match(tradeRefusal(extra, mandate, buy, saleRequest()), /not one venue instruction in the execution/);
  /* The other group's policy sells the other group's coin — and its signer signs that, by its own group's rules. */
  const lastRoute = saleRoute((ix) => (setKey(LAYOUT.routeV2.source, vaultLast)(ix), setKey(LAYOUT.routeV2.inputMint, copyCoins.at(-1).mint)(ix), ix.data.writeBigUInt64LE(1_000n, LAYOUT.routeV2.inAmount)));
  const lastSides = { ...SALE_SIDES, input: uncataloguedFacts(copyCoins.at(-1).mint.toBase58()) };
  assert.equal(tradeRefusal(saleMessage(lastRoute, { salePolicy: salePolicies[1] }), mandate, buy, saleRequest({ feeSides: lastSides })), null);
});

test("Token-2022: a coin of hers with a feature off the agent's list is neither bought nor sold", () => {
  /* The same coin's mint bytes, read as PUMP's — a coin whose issuer runs its own program on every transfer. */
  const hooked = new Map([...facts, [BTC.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.from(REAL.mints.PUMP.data, "base64") }]]);
  assert.match(tradeRefusal(saleMessage(), mandate, buy, saleRequest({ facts: hooked })), /the agent does not trade this coin: .*own program on every transfer/);
  /* Bought: a coin of Token-2022 whose mint is not on the list, into the vault's own account of it. */
  const btcVaultFacts = new Map([...hooked, [vaultBtc.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenData(BTC, vault) }]]);
  const buyBtc = buyRoute((ix) => (setKey(LAYOUT.routeV2.outputMint, BTC)(ix), setKey(LAYOUT.routeV2.own, vaultBtc)(ix), setKey(LAYOUT.routeV2.receiver, vaultBtc)(ix), ix.data.writeUInt16LE(pairFeeBps(NATIVE_MINT.toBase58(), BTC.toBase58(), { ...BUY_SIDES, output: uncataloguedFacts(BTC.toBase58()) }), LAYOUT.routeV2.platformFee)));
  assert.match(tradeRefusal(buyMessage(buyBtc), mandate, buy, buyRequest({ facts: btcVaultFacts, feeSides: { ...BUY_SIDES, output: uncataloguedFacts(BTC.toBase58()) } })), /the agent does not trade this coin/);
  /* With its real mint — on the list — the same buy is signed. */
  assert.equal(tradeRefusal(buyMessage(buyBtc), mandate, buy, buyRequest({ facts: new Map([...facts, [vaultBtc.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenData(BTC, vault) }]]), feeSides: { ...BUY_SIDES, output: uncataloguedFacts(BTC.toBase58()) } })), null);
});

test("the copy's first buy of a coin: the agent opens the vault's own account of it in the same message, and its signer signs it", async () => {
  const noVaultB = new Map([...facts].filter(([address]) => address !== vaultB.toBase58()));
  const open = (payer, account = vaultB, owner = vault, mint = coinB) => createAssociatedTokenAccountIdempotentInstruction(payer, account, owner, mint, TOKEN_PROGRAM_ID);
  const first = buyMessage(buyRoute(), { setup: [open(agent)] });
  const asked = buyRequest({ facts: noVaultB });
  assert.equal(tradeRefusal(first, mandate, buy, asked), null);
  assert.equal(tradeSides(first, mandate, asked)?.bought.toBase58(), coinB.toBase58());
  assert.equal(await screenRefusal(first, mandate, asked, OPEN_SCREEN), null);
  /* Not opened, or opened for someone else, or of another coin: the coin bought is not read — refused as before. */
  assert.equal(await screenRefusal(buyMessage(buyRoute()), mandate, asked, OPEN_SCREEN), "the coin bought could not be read");
  assert.equal(tradeSides(buyMessage(buyRoute(), { setup: [open(attacker)] }), mandate, asked), null);
  assert.equal(tradeSides(buyMessage(buyRoute(), { setup: [open(agent, vaultB, vault, others[0])] }), mandate, asked), null);
  /* A mandate with no copy reads no differently. */
  const plain = { ...mandate, terms: { ...terms, copyCoins: undefined }, salePolicies: undefined };
  assert.equal(tradeSides(first, plain, asked), null);
});

test("end to end, with a key of its own: the copy's buy and sale signed and journalled; a stranger's coin refused before the key", async () => {
  const pair = Keypair.generate();
  const own = { ...mandate, terms: { ...terms, agent: pair.publicKey } };
  const rows = [];
  const signer = mandateSigner(envKey(JSON.stringify([...pair.secretKey])).signer, { mandate: own, policy: mandatePolicy(own.terms, accounts), journal: async (row) => void rows.push(row), screen: OPEN_SCREEN });
  const buyIx = messageAs(pair.publicKey, agentTradeInstructions({ mandate: own, venueInstruction: buyRoute(), holding: 0n, side: "buy" }));
  const saleIx = messageAs(pair.publicKey, agentTradeInstructions({ mandate: own, venueInstruction: saleRoute(), holding: 5_000n, side: "sell", salePolicy: salePolicies[0] }));
  assert.equal((await signer.signMessage(buyIx, buyRequest())).length, 64);
  assert.equal((await signer.signMessage(saleIx, saleRequest())).length, 64);
  assert.equal(await screenRefusal(saleIx, own, saleRequest(), OPEN_SCREEN), null);
  const theirs = messageAs(pair.publicKey, agentTradeInstructions({ mandate: own, venueInstruction: saleRoute(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(attacker, NATIVE_MINT))), holding: 0n, side: "sell", salePolicy: salePolicies[0] }));
  await assert.rejects(signer.signMessage(theirs, saleRequest()), /account 7 is not a pinned one/);
  assert.deepEqual(rows.map((row) => row.outcome), ["SIGNED", "SIGNED", "REFUSED"]);
});

/* ------------------------------------------------------------------ devnet: the pools of her coins */

test("devnet: a copy's buy goes through any pool of her coins into the vault; its sale sells a coin of the group into her wSOL after Ryntra's fee", () => {
  const poolA = seeded("devnet pool a");
  const poolB = seeded("devnet pool b");
  const coinA = { mint: seeded("devnet coin a"), program: TOKEN_PROGRAM_ID, dailyMax: 9_000n, pool: poolA };
  const coinD = { mint: seeded("devnet coin d"), program: TOKEN_PROGRAM_ID, dailyMax: 9_000n, pool: poolB };
  const devTerms = { ...terms, venue: { kind: "dlmm", pool: poolA }, copyCoins: [coinA, coinD] };
  const devMandate = { ...mandate, cluster: "devnet", terms: devTerms, salePolicies: [salePolicies[0]] };
  const devBuy = mandatePolicy(devTerms, accounts);
  const devSale = copySalePolicyOf(devTerms, accounts, 0);
  assert.deepEqual(devBuy.constraints[0].accounts.find((a) => a.index === LAYOUT.dlmmSwap2.pool).rule.keys.map(String), [poolA.toBase58(), poolB.toBase58()]);
  assert.deepEqual(devSale.spendingLimits.map((l) => l.mint.toBase58()), [coinA.mint.toBase58(), coinD.mint.toBase58()]);
  const vaultD = heldAccountOf(vault, coinD);
  const swap = (over = {}) => {
    const keys = Array.from({ length: 16 }, (_, i) => seeded(`dlmm ${i}`));
    keys[LAYOUT.dlmmSwap2.pool] = over.pool ?? poolB;
    keys[LAYOUT.dlmmSwap2.source] = over.source ?? vaultD;
    keys[LAYOUT.dlmmSwap2.receiver] = over.receiver ?? herWsol;
    keys[LAYOUT.dlmmSwap2.user] = vault;
    const data = Buffer.alloc(24);
    Buffer.from(DLMM_SWAP2).copy(data, 0);
    data.writeBigUInt64LE(over.amount ?? 990n, 8);
    data.writeBigUInt64LE(over.minOut ?? 100n, 16);
    return { programId: DLMM_PROGRAM_ID, keys: keys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })), data };
  };
  const fee = (over = {}) => feeTransferInstruction({ budgetMint: over.mint ?? coinD.mint, budgetAccount: over.source ?? vaultD, vault, fee: over.fee ?? agentFeeRaw(1_000n, 100), decimals: 6 });
  const devFacts = new Map([...facts, [vaultD.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(coinD.mint, vault, 1_000n) }]]);
  const message = (venueInstruction, feeInstruction, policy = salePolicies[0]) => messageOf(agentTradeInstructions({ mandate: devMandate, venueInstruction, fee: feeInstruction, holding: 5_000n, side: "sell", salePolicy: policy }));
  const sides = { input: uncataloguedFacts(coinD.mint.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: Date.now() };
  const request = { facts: devFacts, promisedOut: 100n, feeSides: sides };
  assert.equal(pairFeeBps(coinD.mint.toBase58(), NATIVE_MINT.toBase58(), sides), 100);
  assert.equal(tradeRefusal(message(swap(), fee()), devMandate, devBuy, request), null);
  assert.match(tradeRefusal(message(swap({ receiver: tokenAccountOf(attacker, NATIVE_MINT) }), fee()), devMandate, devBuy, request), /account 5 is not a pinned one/);
  assert.match(tradeRefusal(message(swap({ pool: seeded("stranger pool") }), fee()), devMandate, devBuy, request), /account 0 is not a pinned one/);
  assert.match(tradeRefusal(message(swap({ source: budgetAccount }), fee({ mint: NATIVE_MINT, source: budgetAccount })), devMandate, devBuy, request), /account 2 is not a pinned one|the copy sells only a coin of this sale's group/);
  assert.match(tradeRefusal(message(swap(), fee({ fee: 1n })), devMandate, devBuy, request), /not the table's share/);
});

/* ------------------------------------------------------------------ enable, stop, withdraw */

const config = { smartAccountIndex: 87n, creationFee: 0n, treasury: seeded("treasury") };

test("enable writes the buy's policy and a sale's policy for each group, the next seeds, in one approval; each fits a transaction", () => {
  const plan = planEnable({ cluster: "mainnet", terms, account: { kind: "absent", config }, fund: 100_000_000n, nowSeconds: NOW_S, agentFeeLamports: 5_000_000n });
  const { mandate: written } = plan;
  assert.deepEqual(written.salePolicies.map(String), [2n, 3n].map((seed) => ssaAddress.policy(written.settings, seed).toBase58()));
  assert.equal(written.salePolicy, undefined, "no agent's own sale policy beside a copy");
  assert.equal(plan.transactions.length >= 3 && plan.transactions.length <= 4, true);
  for (const transaction of plan.transactions) assert.ok(fits(human, transaction));
  /* Nothing opens the vault's accounts of her coins now: the agent opens each before its first buy, at its own cost. */
  const opened = plan.transactions.flat().filter((ix) => ix.programId.toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").map((ix) => ix.keys[1].pubkey.toBase58());
  for (const coin of copyCoins) assert.ok(!opened.includes(heldAccountOf(written.vault, coin).toBase58()));
});

test("every copy fits at its widest: ten coins of Token-2022 with the largest day on Jupiter, ten pools on devnet", () => {
  const widest = Array.from({ length: COPY_COINS_MAX }, (_, i) => ({ mint: seeded(`wide ${i}`), program: TOKEN_2022_PROGRAM_ID, dailyMax: (1n << 64n) - 1n }));
  const jupiter = planEnable({ cluster: "mainnet", terms: { ...terms, copyCoins: widest, budgetMint: USDC }, account: { kind: "absent", config }, fund: 1n, nowSeconds: NOW_S, agentFeeLamports: 1n });
  assert.equal(jupiter.mandate.salePolicies.length, 2);
  for (const transaction of jupiter.transactions) assert.ok(fits(human, transaction));
  const pools = widest.map((_c, i) => seeded(`wide pool ${i}`));
  const devnet = planEnable({ cluster: "devnet", terms: { ...terms, venue: { kind: "dlmm", pool: pools[0] }, copyCoins: widest.map((coin, i) => ({ ...coin, program: TOKEN_PROGRAM_ID, pool: pools[i] })) }, account: { kind: "absent", config }, fund: 1n, nowSeconds: NOW_S, agentFeeLamports: 1n });
  for (const transaction of devnet.transactions) assert.ok(fits(human, transaction));
});

test("the stop removes the buy's policy and every sale's policy at once; each coin comes home to her, all of it", () => {
  const [stop] = planStop(mandate);
  const named = stop.keys.map((k) => k.pubkey.toBase58());
  for (const policy of [buyPolicy, ...salePolicies]) assert.ok(named.includes(policy.toBase58()));
  const back = planWithdrawHeld(mandate, { ...copyCoins[1], decimals: 6, balance: 77n });
  assert.ok(back.at(-1).keys.some((k) => k.pubkey.equals(vaultB)));
  /* A mandate without a copy stops exactly as before (the golden record holds every such shape byte for byte). */
  const plain = planStop({ ...mandate, salePolicies: undefined, terms: { ...terms, copyCoins: undefined } })[0].keys.map((k) => k.pubkey.toBase58());
  assert.ok(plain.includes(buyPolicy.toBase58()) && salePolicies.every((policy) => !plain.includes(policy.toBase58())));
});
