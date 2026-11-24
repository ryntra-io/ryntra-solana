/* What the agent may do with her money once it sells on its own, and what it may not: the sale's own policy
   (the chain's rules, as the judge reads them) and the agent's signer, each refusal with its test. The route is Jupiter's
   own — the very bytes `/build` gave for the fork (02.11.2026): a pump.fun coin of Token-2022 sold from the
   vault into her wSOL. No network, no real key. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage } from "@solana/web3.js";

import { envKey } from "../launch/signer/env.server.ts";

import { agentTradeInstructions, apiInstruction } from "./agent.ts";
import { AGENT_FEE_CEILING_BPS, agentFeeAccount, agentFeeRaw, feeTransferInstruction, uncataloguedFacts } from "./fee.ts";
import { fits, planEnable, planStop, planWithdrawHeld, tokenAccountOf } from "./human.ts";
import { readAgentRoute } from "./jupiter.server.ts";
import { instructionRefusal } from "./judge.ts";
import { receivedAtLeastInstruction } from "./result.ts";
import { OPEN_SCREEN } from "./ryntra-coins.server.ts";
import { agentSaleFeeRefusal, mandateSigner, screenRefusal, tradeRefusal, tradeSides } from "./signer.server.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, policyExecuteInstruction, ssaAddress } from "./ssa.ts";
import { DLMM_PROGRAM_ID, DLMM_SWAP2, HELD_DAY_ROOM, LAYOUT, heldAccountOf, heldDailyMax, mandatePolicy, proceedsAccountOf, salePolicyOf, termsRefusal } from "./terms.ts";
import { TOKEN_2022_PROGRAM_ID, USDC_MINTS } from "./token-2022.ts";

const K = (text) => new PublicKey(text);
const NOW_S = BigInt(Math.floor(Date.now() / 1000));
const body = JSON.parse(readFileSync(new URL("./fixtures/route-sell-btc.json", import.meta.url), "utf8"));
const fork = JSON.parse(readFileSync(new URL("./fixtures/fork-pass-2022.json", import.meta.url), "utf8"));
const REAL = JSON.parse(readFileSync(new URL("./fixtures/token-2022-mints.json", import.meta.url), "utf8"));

const coin = K(body.inputMint);
const human = K(fork.human);
const vault = K(fork.vault);
const agent = K(fork.agent);
const attacker = Keypair.generate().publicKey;
const USDC = USDC_MINTS[0];
const settings = ssaAddress.settings(77n);
const buyPolicy = ssaAddress.policy(settings, 1n);
const salePolicy = ssaAddress.policy(settings, 2n);
const budgetAccount = tokenAccountOf(vault, NATIVE_MINT);
/* What her day's cap of 0.1 SOL buys of the coin at the price she signs at, twice: the sale's day. */
const held = { mint: coin, program: TOKEN_2022_PROGRAM_ID, dailyMax: heldDailyMax(BigInt(body.inAmount)) };
const vaultCoin = heldAccountOf(vault, held);
const herWsol = tokenAccountOf(human, NATIVE_MINT);
const FEE_WSOL = agentFeeAccount(NATIVE_MINT);
const EPOCH = BigInt(fork.epoch);

const terms = { human, agent, budgetMint: NATIVE_MINT, perTrade: 20_000_000n, perDay: 100_000_000n, slippageBps: 100, expiresAt: NOW_S + 86_400n, venue: { kind: "jupiter" }, heldCoin: held };
const mandate = { cluster: "mainnet", terms, settings, vault, policy: buyPolicy, policySeed: 1n, budgetAccount, salePolicy };
const buy = mandatePolicy(terms, { vault, budgetAccount });
const sale = salePolicyOf(terms, { vault, budgetAccount });

const u64 = (n) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return [...out];
};
const tokenData = (mint, owner, amount = 0n) => Uint8Array.from([...mint.toBytes(), ...owner.toBytes(), ...u64(amount), ...new Array(93).fill(0)]);
const inner = (ix) => ({ programId: ix.programId, accounts: ix.keys.map((k) => k.pubkey), data: ix.data });
const request = { inputMint: coin, outputMint: NATIVE_MINT, amount: BigInt(body.inAmount), vault, agent, receiver: herWsol, slippageBps: 100, fee: { bps: 100, account: FEE_WSOL } };
const route = readAgentRoute(body, request);
/** Jupiter's real swap instruction, with one change. */
const copy = (mutate = () => {}) => {
  const ix = apiInstruction(body.swapInstruction);
  mutate(ix);
  return ix;
};
const setKey = (index, pubkey) => (ix) => (ix.keys[index] = { ...ix.keys[index], pubkey });
const facts = new Map([
  [budgetAccount.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, vault) }],
  [herWsol.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenData(NATIVE_MINT, human, 5_000n) }],
  [vaultCoin.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenData(coin, vault, BigInt(body.inAmount)) }],
  [coin.toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.from(REAL.mints.BTC_PUMP.data, "base64") }],
]);
const SIDES = { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: Date.now() };
const signRequest = (over = {}) => ({ facts, promisedOut: route.outAmount, feeSides: SIDES, epoch: EPOCH, ...over });
const messageAs = (payerKey, instructions) => TransactionMessage.prototype.compileToV0Message.call(new TransactionMessage({ payerKey, recentBlockhash: "11111111111111111111111111111111", instructions: [...instructions] })).serialize();
const messageOf = (instructions) => messageAs(agent, instructions);
const saleMessage = (venueInstruction = copy(), extra = {}) => messageOf(agentTradeInstructions({ mandate: extra.mandate ?? mandate, venueInstruction, holding: 5_000n, side: "sell", ...extra }));

/* ------------------------------------------------------------------ the policies as the chain holds them */

test("two policies, each for its own money: the sale's names only the coin's limit, the buy's only the budget's", () => {
  /* The program lowers no vault account of a coin with no limit (`account_tracking.rs`): no sale spends the budget or the
     vault's SOL, no buy takes the coin. The coin's limit is a day's: what her day's cap buys at the price she signed, twice. */
  assert.deepEqual(sale.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod, l.period]), [[coin.toBase58(), BigInt(body.inAmount) * 2n, "daily"]]);
  assert.ok(sale.spendingLimits[0].maxPerPeriod < (1n << 64n) - 1n, "never every coin there is");
  assert.deepEqual(buy.spendingLimits.map((l) => [l.mint.toBase58(), l.maxPerPeriod]), [[NATIVE_MINT.toBase58(), terms.perDay]]);
  assert.equal(sale.constraints.length, 2, "Jupiter's route and its shared route — nothing else");
  assert.ok(sale.constraints.every((c) => c.programId.toBase58() === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"));
});

test("a buy of a mandate that keeps its coin lands in the vault's account of that coin, pinned — never anywhere else", () => {
  const rule = (index) => buy.constraints[0].accounts.find((a) => a.index === index);
  assert.deepEqual(rule(LAYOUT.routeV2.receiver).rule.keys.map(String), [vaultCoin.toBase58()]);
  assert.deepEqual(rule(LAYOUT.routeV2.own).rule.keys.map(String), [vaultCoin.toBase58()]);
  assert.deepEqual(buy.constraints[1].accounts.find((a) => a.index === LAYOUT.sharedRouteV2.receiver).rule.keys.map(String), [vaultCoin.toBase58()]);
});

test("Jupiter's real sale route meets the sale's rules", () => {
  assert.equal(route.swap.keys[LAYOUT.routeV2.source].pubkey.toBase58(), vaultCoin.toBase58(), "the coin from the vault's account of it");
  assert.equal(route.swap.keys[LAYOUT.routeV2.own].pubkey.toBase58(), budgetAccount.toBase58(), "Jupiter's own leg — the vault's wSOL");
  assert.equal(route.swap.keys[LAYOUT.routeV2.receiver].pubkey.toBase58(), proceedsAccountOf(terms).toBase58(), "the money — her wSOL");
  assert.equal(instructionRefusal(inner(copy()), sale.constraints[0], facts), null);
});

test("the chain refuses every sale that sends the money or the coin anywhere but back to her", () => {
  const cases = [
    ["a stranger receives the money", copy(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(attacker, NATIVE_MINT))), /account 7 is not a pinned one/],
    ["the money stays in the vault's own account", copy(setKey(LAYOUT.routeV2.receiver, budgetAccount)), /account 7 is not a pinned one/],
    ["another output mint (USDC)", copy(setKey(LAYOUT.routeV2.outputMint, USDC)), /account 4 is not a pinned one/],
    ["another output mint, to her own USDC account", copy((ix) => (setKey(LAYOUT.routeV2.outputMint, USDC)(ix), setKey(LAYOUT.routeV2.receiver, tokenAccountOf(human, USDC))(ix))), /account 4 is not a pinned one/],
    ["a vault account other than the coin's is sold — the budget", copy(setKey(LAYOUT.routeV2.source, budgetAccount)), /account 1 is not a pinned one/],
    ["a stranger's coin account as the source", copy(setKey(LAYOUT.routeV2.source, tokenAccountOf(attacker, coin, TOKEN_2022_PROGRAM_ID))), /account 1 is not a pinned one/],
    ["Jupiter's own leg is a stranger's", copy(setKey(LAYOUT.routeV2.own, tokenAccountOf(attacker, NATIVE_MINT))), /account 2 is not a pinned one/],
    ["someone other than the vault signs", copy(setKey(LAYOUT.routeV2.authority, attacker)), /account 0 is not a pinned one/],
    ["the fee to a stranger", copy(setKey(LAYOUT.routeV2.feeAccount, tokenAccountOf(attacker, NATIVE_MINT))), /account 10 is not a pinned one/],
    ["a fee over the table's ceiling", copy((ix) => ix.data.writeUInt16LE(AGENT_FEE_CEILING_BPS + 1, LAYOUT.routeV2.platformFee)), /number at 26 .* breaks lessThanOrEqualTo/],
    ["slippage over the mandate's", copy((ix) => ix.data.writeUInt16LE(101, LAYOUT.routeV2.slippage)), /number at 24 .* breaks lessThanOrEqualTo 100/],
    /* A stolen key's quote of almost nothing and all positive slippage to the fee account: what the route makes over the quote stays hers. */
    ["all positive slippage taken, on a quote of almost nothing", copy((ix) => (ix.data.writeUInt16LE(10_000, LAYOUT.routeV2.positiveSlippage), ix.data.writeBigUInt64LE(1n, LAYOUT.routeV2.quotedOut))), /number at 28 \(10000\) breaks equals 0/],
    ["any share of positive slippage", copy((ix) => ix.data.writeUInt16LE(1, LAYOUT.routeV2.positiveSlippage)), /number at 28 \(1\) breaks equals 0/],
    ["another Jupiter instruction", copy((ix) => ix.data.fill(7, 0, 8)), /bytes at 0 are not the pinned ones/],
    ["a program in Jupiter's place", copy((ix) => (ix.programId = attacker)), /the program is outside the mandate/],
  ];
  for (const [name, ix, reason] of cases) assert.match(instructionRefusal(inner(ix), sale.constraints[0], facts) ?? "kept", reason, name);
});

test("the shared route of a sale is held the same: the vault, its coin, her account, Ryntra's fee", () => {
  const at = LAYOUT.sharedRouteV2;
  const shared = (over = {}) => {
    const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
    keys[at.authority] = { pubkey: over.authority ?? vault, isSigner: true, isWritable: false };
    keys[at.source] = { pubkey: over.source ?? vaultCoin, isSigner: false, isWritable: true };
    keys[at.receiver] = { pubkey: over.receiver ?? herWsol, isSigner: false, isWritable: true };
    keys[at.feeAccount] = { pubkey: over.fee ?? FEE_WSOL, isSigner: false, isWritable: true };
    const data = Buffer.alloc(32);
    Buffer.from([209, 152, 83, 147, 124, 254, 216, 233]).copy(data, 0);
    data.writeUInt16LE(over.slippage ?? 100, at.slippage);
    data.writeUInt16LE(over.feeBps ?? 100, at.platformFee);
    data.writeUInt16LE(over.positive ?? 0, at.positiveSlippage);
    return { programId: K("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), accounts: keys.map((k) => k.pubkey), data };
  };
  assert.equal(instructionRefusal(shared(), sale.constraints[1], facts), null);
  assert.match(instructionRefusal(shared({ receiver: tokenAccountOf(attacker, NATIVE_MINT) }), sale.constraints[1], facts), /account 5/);
  assert.match(instructionRefusal(shared({ receiver: tokenAccountOf(human, USDC) }), sale.constraints[1], facts), /account 5/);
  assert.match(instructionRefusal(shared({ source: budgetAccount }), sale.constraints[1], facts), /account 2/);
  assert.match(instructionRefusal(shared({ authority: attacker }), sale.constraints[1], facts), /account 1/);
  assert.match(instructionRefusal(shared({ fee: tokenAccountOf(attacker, NATIVE_MINT) }), sale.constraints[1], facts), /account 12/);
  assert.match(instructionRefusal(shared({ feeBps: 1_000 }), sale.constraints[1], facts), /breaks lessThanOrEqualTo/);
  assert.match(instructionRefusal(shared({ positive: 10_000 }), sale.constraints[1], facts), /number at 29 \(10000\) breaks equals 0/);
});

test("the sale's day: her day's cap in the coin at the price she signs, twice — never none, never past a u64", () => {
  assert.equal(HELD_DAY_ROOM, 2n);
  assert.equal(heldDailyMax(1_000n), 2_000n);
  assert.throws(() => heldDailyMax(0n), /buys none/);
  assert.equal(heldDailyMax(1n << 63n), (1n << 64n) - 1n);
  assert.match(termsRefusal({ ...terms, heldCoin: { ...held, dailyMax: 0n } }, NOW_S), /a day's share of the coin/);
  /* The rule on positive slippage costs the sale's policy 24 bytes: it still fits one transaction. */
  const plan = planEnable({ cluster: "mainnet", terms, account: { kind: "absent", config: { smartAccountIndex: 76n, creationFee: 0n, treasury: Keypair.generate().publicKey } }, fund: 100_000_000n, nowSeconds: NOW_S, receiveMints: [held] });
  assert.ok(fits(human, plan.transactions.at(-1)));
});

test("neither policy does the other's job: a sale under the buy's rules, a buy under the sale's — both refused", () => {
  /* The sale's route spends the coin, not the budget: the buy's rule pins the budget's account as the source. */
  assert.match(instructionRefusal(inner(copy()), buy.constraints[0], facts), /account 1 is not a pinned one/);
  /* A buy's route through the sale's rules: the source is the budget, not the coin. */
  const buyRoute = copy((ix) => (setKey(LAYOUT.routeV2.source, budgetAccount)(ix), setKey(LAYOUT.routeV2.receiver, vaultCoin)(ix), setKey(LAYOUT.routeV2.own, vaultCoin)(ix)));
  assert.match(instructionRefusal(inner(buyRoute), sale.constraints[0], facts), /account 1 is not a pinned one/);
});

/* ------------------------------------------------------------------ the agent's signer */

test("the signer signs the honest sale: under the sale's policy, the money to her, the rule that it reached her", () => {
  assert.equal(tradeRefusal(saleMessage(), mandate, buy, signRequest()), null);
});

test("the signer refuses every sale that is not one back to her — each with its reason, before the key", () => {
  const extraInner = (() => {
    const instructions = agentTradeInstructions({ mandate, venueInstruction: copy(), holding: 5_000n, side: "sell" });
    const execution = policyExecuteInstruction({ policy: salePolicy, signer: agent, instructions: [copy(), SystemProgram.transfer({ fromPubkey: vault, toPubkey: attacker, lamports: 1n })], constraintIndices: [0, 0] });
    return messageOf(instructions.map((ix) => (ix.programId.equals(execution.programId) ? execution : ix)));
  })();
  const extraOuter = messageOf([...agentTradeInstructions({ mandate, venueInstruction: copy(), holding: 5_000n, side: "sell" }), SystemProgram.transfer({ fromPubkey: agent, toPubkey: attacker, lamports: 1n })]);
  const swapProgram = (() => {
    const instructions = agentTradeInstructions({ mandate, venueInstruction: copy(), holding: 5_000n, side: "sell" });
    const fake = copy((ix) => (ix.programId = attacker));
    const execution = policyExecuteInstruction({ policy: salePolicy, signer: agent, instructions: [fake], constraintIndices: [0] });
    return messageOf(instructions.map((ix) => (ix.programId.equals(execution.programId) ? execution : ix)));
  })();
  const underBuyPolicy = (() => {
    const instructions = agentTradeInstructions({ mandate, venueInstruction: copy(), holding: 5_000n, side: "buy" });
    return messageOf(instructions);
  })();
  const foreignPolicy = saleMessage(copy(), { mandate: { ...mandate, salePolicy: ssaAddress.policy(settings, 9n) } });
  const noRule = messageOf(agentTradeInstructions({ mandate, venueInstruction: copy(), holding: 5_000n, side: "sell" }).filter((ix) => !ix.programId.equals(receivedAtLeastInstruction(herWsol, 1n).programId)));
  const lowRule = messageOf(agentTradeInstructions({ mandate, venueInstruction: copy(), holding: 0n, side: "sell" }));
  const cases = [
    ["a stranger receives the money", saleMessage(copy(setKey(LAYOUT.routeV2.receiver, tokenAccountOf(attacker, NATIVE_MINT)))), /account 7 is not a pinned one/],
    ["another output mint", saleMessage(copy(setKey(LAYOUT.routeV2.outputMint, USDC))), /account 4 is not a pinned one/],
    ["an extra instruction inside the execution", extraInner, /not one venue instruction in the execution/],
    ["an extra instruction beside it", extraOuter, /an instruction of a program outside the mandate/],
    ["a program in Jupiter's place", swapProgram, /the program is outside the mandate/],
    ["the sale under the buy's policy", underBuyPolicy, /account 1 is not a pinned one/],
    ["an execution under a policy that is not this mandate's", foreignPolicy, /an execution under another policy/],
    ["no rule that the money reached her", noRule, /not exactly one rule on what reached the person/],
    ["a rule that asks less than the minimum", lowRule, /the rule asks less than the trade's minimum/],
  ];
  for (const [name, message, reason] of cases) assert.match(tradeRefusal(message, mandate, buy, signRequest()) ?? "signed", reason, name);
  /* The quote the agent was told of is the floor: a route paying less than it promised is not signed. */
  assert.match(tradeRefusal(saleMessage(), mandate, buy, signRequest({ promisedOut: route.outAmount * 2n })), /under what the person was promised/);
  /* A pair the table names no fee for is no sale of the agent's. */
  assert.match(tradeRefusal(saleMessage(), mandate, buy, signRequest({ feeSides: { ...SIDES, input: null } })), /names no router fee/);
  /* One sale over the coin's whole day — the chain refuses it (the sale's limit), and the signer before it; a whole day still signs. */
  const amountIn = BigInt(body.inAmount);
  const narrow = (dailyMax) => ({ ...mandate, terms: { ...terms, heldCoin: { ...held, dailyMax } } });
  assert.match(tradeRefusal(saleMessage(copy(), { mandate: narrow(amountIn - 1n) }), narrow(amountIn - 1n), buy, signRequest()) ?? "signed", /the sale is over the coin's day/);
  assert.equal(tradeRefusal(saleMessage(copy(), { mandate: narrow(amountIn) }), narrow(amountIn), buy, signRequest()), null);
});

test("a mandate that keeps no coin has no sale: its agent signs none", () => {
  const { heldCoin: _held, ...plainTerms } = terms;
  const plain = { ...mandate, terms: plainTerms, salePolicy: undefined };
  assert.throws(() => agentTradeInstructions({ mandate: plain, venueInstruction: copy(), holding: 0n, side: "sell" }), /no policy for a sale/);
  const forged = { ...mandate, terms: plainTerms };
  assert.match(tradeRefusal(saleMessage(copy(), { mandate: forged }), plain, mandatePolicy(plainTerms, { vault, budgetAccount }), signRequest()), /an execution under another policy/);
  assert.throws(() => salePolicyOf(plainTerms, { vault, budgetAccount }), /no sale policy/);
});

/* ------------------------------------------------------------------ her first sale: she holds no wSOL yet */

/*
 * A wallet that never held wSOL — or one whose wSOL a swap or a tidy closed — has no account for a sale's money: the chain
 * has none, so the facts read before the signature lack it, and the venue opens it in the same transaction at the agent's
 * cost (`./agent-service.server.ts` `dlmmVenue`, `./jupiter.server.ts` `routeUnderMandate`). The devnet pass of 21.11
 * found the screen refusing exactly that sale («the coin bought could not be read») while the bounds let it through.
 */
const noWsol = new Map([...facts].filter(([address]) => address !== herWsol.toBase58()));
const opening = (payer, account = herWsol, owner = human, mint = NATIVE_MINT, program = TOKEN_PROGRAM_ID) => createAssociatedTokenAccountIdempotentInstruction(payer, account, owner, mint, program);

test("her first sale, before she holds any wSOL: the agent opens her own account in the same transaction, and its signer signs it", async () => {
  const asked = signRequest({ facts: noWsol });
  const first = saleMessage(copy(), { holding: 0n, setup: [opening(agent)] });
  /* The bounds read the account the message opens as what it will be; the screen reads it the same way — the budget's coin, by its address. */
  assert.equal(tradeRefusal(first, mandate, buy, asked), null);
  assert.equal(tradeSides(first, mandate, asked)?.bought.toBase58(), NATIVE_MINT.toBase58());
  assert.equal(await screenRefusal(first, mandate, asked, OPEN_SCREEN), null);
  /* End to end, with a key of its own: signed, and the journal says so. */
  const pair = Keypair.generate();
  const own = { ...mandate, terms: { ...terms, agent: pair.publicKey } };
  const rows = [];
  const signer = mandateSigner(envKey(JSON.stringify([...pair.secretKey])).signer, { mandate: own, policy: buy, journal: async (row) => void rows.push(row), screen: OPEN_SCREEN });
  const message = messageAs(pair.publicKey, agentTradeInstructions({ mandate: own, venueInstruction: copy(), holding: 0n, side: "sell", setup: [opening(pair.publicKey)] }));
  assert.equal((await signer.signMessage(message, asked)).length, 64);
  assert.deepEqual(rows.map((row) => row.outcome), ["SIGNED"]);
});

test("…and only that one: no other account a message opens, no buy and no mandate without a sale reads any differently", async () => {
  const asked = signRequest({ facts: noWsol });
  /* Not opened at all: refused, by the bounds and by the screen, as before. */
  const bare = saleMessage(copy(), { holding: 0n });
  assert.match(tradeRefusal(bare, mandate, buy, asked), /receiving account could not be read/);
  assert.equal(await screenRefusal(bare, mandate, asked, OPEN_SCREEN), "the coin bought could not be read");
  /* Another account opened — the vault's of the coin — or hers opened by someone other than the agent, or after the trade. */
  for (const message of [
    saleMessage(copy(), { holding: 0n, setup: [opening(agent, vaultCoin, vault, coin, TOKEN_2022_PROGRAM_ID)] }),
    saleMessage(copy(), { holding: 0n, setup: [opening(attacker)] }),
    messageOf([...agentTradeInstructions({ mandate, venueInstruction: copy(), holding: 0n, side: "sell" }), opening(agent)]),
  ]) assert.equal(tradeSides(message, mandate, asked), null);
  /* A buy whose receiving account the message opens reads exactly as before. */
  const buyRoute = copy((ix) => (setKey(LAYOUT.routeV2.source, budgetAccount)(ix), setKey(LAYOUT.routeV2.receiver, vaultCoin)(ix), setKey(LAYOUT.routeV2.own, vaultCoin)(ix)));
  const buyOpening = messageOf(agentTradeInstructions({ mandate, venueInstruction: buyRoute, holding: 0n, side: "buy", setup: [opening(agent, vaultCoin, vault, coin, TOKEN_2022_PROGRAM_ID)] }));
  assert.equal(tradeSides(buyOpening, mandate, signRequest({ facts: new Map([...facts].filter(([address]) => address !== vaultCoin.toBase58())) })), null);
  /* A mandate that keeps no coin has no sale to open anything for. */
  const { heldCoin: _held, ...plainTerms } = terms;
  assert.equal(tradeSides(saleMessage(copy(), { holding: 0n, setup: [opening(agent)] }), { ...mandate, terms: plainTerms, salePolicy: undefined }, asked), null);
});

test("devnet: the pool's first sale into her wSOL — Ryntra's fee, then the swap, her account opened before — is signed", async () => {
  const pool = Keypair.generate().publicKey;
  const tRyn = Keypair.generate().publicKey;
  const dTerms = { ...terms, venue: { kind: "dlmm", pool }, heldCoin: { mint: tRyn, program: TOKEN_PROGRAM_ID, dailyMax: 2_000n } };
  const dMandate = { ...mandate, terms: dTerms };
  const coinAccount = heldAccountOf(vault, dTerms.heldCoin);
  const fee = agentFeeRaw(1_000n, 100);
  const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
  keys[LAYOUT.dlmmSwap2.pool] = { pubkey: pool, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.source] = { pubkey: coinAccount, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.receiver] = { pubkey: herWsol, isSigner: false, isWritable: true };
  keys[LAYOUT.dlmmSwap2.user] = { pubkey: vault, isSigner: true, isWritable: false };
  const data = Buffer.alloc(24);
  Buffer.from(DLMM_SWAP2).copy(data, 0);
  data.writeBigUInt64LE(1_000n - fee, LAYOUT.dlmmSwap2.inAmount);
  data.writeBigUInt64LE(5n, LAYOUT.dlmmSwap2.minOut);
  const swap2 = new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
  const feeIx = feeTransferInstruction({ budgetMint: tRyn, budgetAccount: coinAccount, vault, fee, decimals: 6 });
  const asked = { facts: noWsol, promisedOut: 5n, feeSides: { input: uncataloguedFacts(tRyn.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: Date.now() } };
  const dPolicy = mandatePolicy(dTerms, { vault, budgetAccount });
  const sale = (setup) => messageOf(agentTradeInstructions({ mandate: dMandate, venueInstruction: swap2, fee: feeIx, holding: 0n, side: "sell", setup }));
  const first = sale([opening(agent)]);
  assert.equal(tradeRefusal(first, dMandate, dPolicy, asked), null);
  assert.equal(await screenRefusal(first, dMandate, asked, OPEN_SCREEN), null);
  /* Without her account opened, the same sale is refused as before. */
  assert.match(tradeRefusal(sale([]), dMandate, dPolicy, asked), /receiving account could not be read/);
});

/* ------------------------------------------------------------------ devnet: the pool's sale */

test("devnet: the pool sells the coin from the vault into her wSOL, Ryntra's fee the transfer of the coin just before", () => {
  const pool = Keypair.generate().publicKey;
  const tRyn = Keypair.generate().publicKey;
  const dHeld = { mint: tRyn, program: TOKEN_PROGRAM_ID, dailyMax: 2_000n };
  const dTerms = { ...terms, venue: { kind: "dlmm", pool }, heldCoin: dHeld };
  const dMandate = { ...mandate, cluster: "devnet", terms: dTerms };
  const dSale = salePolicyOf(dTerms, { vault, budgetAccount });
  const coinAccount = heldAccountOf(vault, dHeld);
  const swap2 = (over = {}) => {
    const keys = Array.from({ length: 16 }, () => ({ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }));
    keys[LAYOUT.dlmmSwap2.pool] = { pubkey: over.pool ?? pool, isSigner: false, isWritable: true };
    keys[LAYOUT.dlmmSwap2.source] = { pubkey: over.source ?? coinAccount, isSigner: false, isWritable: true };
    keys[LAYOUT.dlmmSwap2.receiver] = { pubkey: over.receiver ?? herWsol, isSigner: false, isWritable: true };
    keys[LAYOUT.dlmmSwap2.user] = { pubkey: vault, isSigner: true, isWritable: false };
    const data = Buffer.alloc(24);
    Buffer.from(DLMM_SWAP2).copy(data, 0);
    data.writeBigUInt64LE(over.amount ?? 990n, LAYOUT.dlmmSwap2.inAmount);
    data.writeBigUInt64LE(5n, LAYOUT.dlmmSwap2.minOut);
    return new TransactionInstruction({ programId: DLMM_PROGRAM_ID, keys, data });
  };
  const fee = (amount, destination) => {
    const ix = feeTransferInstruction({ budgetMint: tRyn, budgetAccount: coinAccount, vault, fee: amount, decimals: 6 });
    if (destination) ix.keys[2] = { ...ix.keys[2], pubkey: destination };
    return ix;
  };
  assert.equal(instructionRefusal(inner(swap2()), dSale.constraints[0], facts), null);
  assert.equal(instructionRefusal(inner(fee(10n)), dSale.constraints[1], facts), null);
  assert.match(instructionRefusal(inner(swap2({ receiver: tokenAccountOf(attacker, NATIVE_MINT) })), dSale.constraints[0], facts), /account 5/);
  assert.match(instructionRefusal(inner(swap2({ source: budgetAccount })), dSale.constraints[0], facts), /account 4/);
  assert.match(instructionRefusal(inner(swap2({ pool: attacker })), dSale.constraints[0], facts), /account 0/);
  assert.match(instructionRefusal(inner(fee(10n, tokenAccountOf(attacker, tRyn))), dSale.constraints[1], facts), /account 2/);
  /* The signer's share: exactly the table's of the two together, from the coin sold, into Ryntra's account of it. */
  const ok = [inner(fee(agentFeeRaw(1_000n, 100))), inner(swap2({ amount: 1_000n - agentFeeRaw(1_000n, 100) }))];
  assert.equal(agentSaleFeeRefusal(dMandate, ok, 100), null);
  assert.match(agentSaleFeeRefusal(dMandate, [inner(fee(500n)), inner(swap2())], 100), /not the table's share/);
  assert.match(agentSaleFeeRefusal(dMandate, [inner(fee(10n, tokenAccountOf(attacker, tRyn))), inner(swap2())], 100), /other than Ryntra's/);
  assert.match(agentSaleFeeRefusal(dMandate, [inner(swap2())], 100), /not Ryntra's fee and one venue instruction/);
  assert.equal(agentFeeAccount(tRyn).toBase58(), dSale.constraints[1].accounts[1].rule.keys[0].toBase58());
});

/* ------------------------------------------------------------------ her side: one approval on, one signature back */

test("enable writes both policies in the one approval; each fits a transaction", () => {
  const plan = planEnable({ cluster: "mainnet", terms, account: { kind: "absent", config: { smartAccountIndex: 76n, creationFee: 0n, treasury: Keypair.generate().publicKey } }, fund: 100_000_000n, nowSeconds: NOW_S, receiveMints: [held] });
  assert.ok(plan.mandate.salePolicy.equals(ssaAddress.policy(plan.mandate.settings, 2n)), "the next seed of the same account");
  assert.ok(plan.transactions.length >= 2 && plan.transactions.length <= 3, "the relay forwards at most three");
  for (const instructions of plan.transactions) assert.ok(fits(human, instructions));
  /* The vault's account of the coin is opened now, at her cost, under the coin's own program. */
  const opens = plan.transactions.flat().filter((ix) => ix.programId.toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").map((ix) => ix.keys[1].pubkey.toBase58());
  assert.ok(opens.includes(heldAccountOf(plan.mandate.vault, held).toBase58()));
});

test("the terms: a coin kept is a coin, not SOL or USDC, of the token programs, and on devnet's pool a coin of Token", () => {
  assert.equal(termsRefusal(terms, NOW_S), null);
  assert.match(termsRefusal({ ...terms, heldCoin: { mint: NATIVE_MINT, program: TOKEN_PROGRAM_ID } }, NOW_S), /not SOL or USDC/);
  assert.match(termsRefusal({ ...terms, heldCoin: { mint: USDC, program: TOKEN_PROGRAM_ID } }, NOW_S), /not SOL or USDC/);
  assert.match(termsRefusal({ ...terms, heldCoin: { mint: coin, program: attacker } }, NOW_S), /token programs/);
  assert.match(termsRefusal({ ...terms, venue: { kind: "dlmm", pool: attacker } }, NOW_S), /coin of Token/);
  assert.match(termsRefusal({ ...terms, fixedBuy: { amountIn: 1n, outputMint: USDC, minOut: 1n } }, NOW_S), /buys the coin the agent keeps/);
  assert.match(termsRefusal({ ...terms, budgetMint: coin, budgetCoin: { program: TOKEN_2022_PROGRAM_ID, decimals: 6 } }, NOW_S), /no coin the agent keeps/);
});

test("the stop removes both policies; the withdraw takes the coin back to her, all of it, and closes the vault's account to her", () => {
  const stop = planStop(mandate);
  assert.equal(stop.length, 1);
  const policies = stop[0].keys.filter((k) => k.pubkey.equals(buyPolicy) || k.pubkey.equals(salePolicy));
  assert.equal(policies.length, 2);
  const back = planWithdrawHeld(mandate, { ...held, decimals: 6, balance: 123n });
  const execute = back.at(-1);
  assert.ok(execute.keys.some((k) => k.pubkey.equals(vaultCoin)));
  assert.ok(execute.keys.some((k) => k.pubkey.equals(tokenAccountOf(human, coin, TOKEN_2022_PROGRAM_ID))), "to her own account of the coin");
  assert.ok(!execute.keys.some((k) => k.pubkey.equals(attacker)));
  /* A coin with a fee on transfers: what it withheld is swept to its mint first, or the account would not close. */
  assert.equal(planWithdrawHeld(mandate, { ...held, decimals: 6, balance: 1n, transferFee: true }).length, back.length + 1);
});
