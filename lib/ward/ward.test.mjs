/**
 * The pre-sign check against the incidents it exists for (`docs/research/ryntra-system-2026-10-31/`, guard_arena §1):
 * each test rebuilds the shape of a real loss as a real Solana transaction and the state its simulation would report,
 * and asserts the verdict a person or an agent would have seen before signing. Then the honest edges: what a silent
 * chain, a failing simulation, an unreadable intent and a link the check cannot fetch read as.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { WardCheckResponseSchema } from "../api/v1/contract.ts";
import { checkWard as check, WardInputError } from "./check.ts";
import { WARD_CORE_UNKNOWNS, WARD_REASONS } from "./codes.ts";
import { compareIntent, readIntentText } from "./intent.ts";
import { looksLike } from "./threats.ts";
import { accountKeysOf, decodeLookupTable, readWire } from "./wire.ts";
import { encodeAddress } from "./accounts.ts";
import * as f from "./fixtures.mjs";

const SOL = 1_000_000_000n;
/** Every answer in this file is also held to the published contract's shape. */
async function checkWard(request, reads) {
  const result = await check(request, reads);
  WardCheckResponseSchema.parse(result);
  return result;
}
const codes = (result) => result.reasons.map((reason) => reason.code);
const reason = (result, code) => result.reasons.find((entry) => entry.code === code);

/* ---------------------------------------------------------------- incidents */

test("owner swap through `assign` (Solana, December 2025, ~$3M): blocked before the signature", async () => {
  const victim = await f.wallet();
  const drainer = await f.wallet();
  const transaction = f.wire(victim, [f.assign(victim, drainer)]);
  const { reads } = f.chain({
    before: { [victim]: f.walletState(42n * SOL) },
    /* The balance does not move — only the owner does. That is why a balance-only preview showed nothing. */
    after: { [victim]: { lamports: 42n * SOL - 5_000n, owner: drainer, data: new Uint8Array(0) } },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "OWNER_CHANGED");
  assert.match(result.line, /Hands your wallet to another program/);
  assert.deepEqual(reason(result, "OWNER_CHANGED").accounts, [victim, drainer]);
});

test("the same owner swap hidden inside an unknown program's call: the simulation still catches it", async () => {
  const victim = await f.wallet();
  const airdrop = await f.wallet();
  const drainer = await f.wallet();
  const transaction = f.wire(victim, [f.opaque(airdrop, [victim])]);
  const { reads } = f.chain({
    before: { [victim]: f.walletState(3n * SOL) },
    after: { [victim]: { lamports: 3n * SOL, owner: drainer, data: new Uint8Array(0) } },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "block");
  assert.ok(codes(result).includes("OWNER_CHANGED"));
  assert.equal(reason(result, "OWNER_CHANGED").source, "Simulation of these exact bytes against the chain now");
  assert.ok(codes(result).includes("PROGRAMS_UNKNOWN"));
});

test("Lobstar Wilde (Solana, February 2026): asked for 4 SOL, the transaction gives away tokens — blocked on intent", async () => {
  const agent = await f.wallet();
  const beggar = await f.wallet();
  const lobstar = await f.wallet();
  const agentAta = await f.wallet();
  const beggarAta = await f.wallet();
  const supplyShare = 52_439_000n * 1_000_000n;
  const transaction = f.wire(agent, [f.transferChecked(agentAta, lobstar, beggarAta, agent, supplyShare, 6)]);
  const { reads } = f.chain({
    before: {
      [agent]: f.walletState(200n * SOL),
      [agentAta]: f.tokenState({ mint: lobstar, owner: agent, amount: supplyShare }),
      [beggarAta]: f.tokenState({ mint: lobstar, owner: beggar, amount: 0n }),
      [lobstar]: f.mintState({ decimals: 6, supply: 1_000_000_000n * 1_000_000n }),
    },
    after: {
      [agent]: f.walletState(200n * SOL - 5_000n),
      [agentAta]: f.tokenState({ mint: lobstar, owner: agent, amount: 0n }),
      [beggarAta]: f.tokenState({ mint: lobstar, owner: beggar, amount: supplyShare }),
    },
  });
  const result = await checkWard({ transaction, intentText: `send 4 SOL to ${beggar}` }, reads);
  assert.equal(result.verdict, "block");
  assert.ok(codes(result).includes("INTENT_ASSET"), "the tokens were never mentioned");
  assert.match(reason(result, "INTENT_ASSET").line, /52,439,000/);
  assert.ok(codes(result).includes("INTENT_AMOUNT_UNDER"), "and the 4 SOL never leave");
});

test("Lobstar Wilde, the decimals reading: 52,439 declared, 52.4 million sent — blocked as an amount over", async () => {
  const agent = await f.wallet();
  const beggar = await f.wallet();
  const lobstar = await f.wallet();
  const agentAta = await f.wallet();
  const beggarAta = await f.wallet();
  const sent = 52_439_000n * 1_000_000n;
  const transaction = f.wire(agent, [f.transferChecked(agentAta, lobstar, beggarAta, agent, sent, 6)]);
  const { reads } = f.chain({
    before: {
      [agent]: f.walletState(SOL),
      [agentAta]: f.tokenState({ mint: lobstar, owner: agent, amount: sent }),
      [beggarAta]: f.tokenState({ mint: lobstar, owner: beggar, amount: 0n }),
      [lobstar]: f.mintState({ decimals: 6 }),
    },
    after: {
      [agentAta]: f.tokenState({ mint: lobstar, owner: agent, amount: 0n }),
      [beggarAta]: f.tokenState({ mint: lobstar, owner: beggar, amount: sent }),
    },
  });
  const result = await checkWard({ transaction, intent: { kind: "transfer", to: beggar, amount: "52439", mint: lobstar } }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "INTENT_AMOUNT_OVER");
  assert.match(result.line, /Sends 52,439,000 .* the agent said 52,439/);
});

test("poisoned agent memory (ElizaOS research, 2025): the payment goes to someone the agent was never told to pay", async () => {
  const agent = await f.wallet();
  const alice = await f.wallet();
  const mallory = await f.wallet();
  const agentAta = await f.wallet();
  const malloryAta = await f.wallet();
  const transaction = f.wire(agent, [f.transferChecked(agentAta, f.USDC, malloryAta, agent, 25_000_000n, 6)]);
  const { reads } = f.chain({
    before: {
      [agent]: f.walletState(SOL),
      [agentAta]: f.tokenState({ mint: f.USDC, owner: agent, amount: 100_000_000n }),
      [malloryAta]: f.tokenState({ mint: f.USDC, owner: mallory, amount: 0n }),
      [f.USDC]: f.mintState({ decimals: 6, mintAuthority: alice, freezeAuthority: alice }),
    },
    after: {
      [agentAta]: f.tokenState({ mint: f.USDC, owner: agent, amount: 75_000_000n }),
      [malloryAta]: f.tokenState({ mint: f.USDC, owner: mallory, amount: 25_000_000n }),
    },
  });
  const result = await checkWard({ transaction, intentText: `надіслати 25 USDC на ${alice}` }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "INTENT_RECIPIENT");
  assert.ok(reason(result, "INTENT_RECIPIENT").accounts.includes(mallory));
});

test("Bankr × Grok (Base, May 2026), as it would read on Solana: a large transfer to a fresh address nobody asked for", async () => {
  const bot = await f.wallet();
  const attacker = await f.wallet();
  const operator = await f.wallet();
  const transaction = f.wire(bot, [f.systemTransfer(bot, attacker, 900n * SOL)]);
  const { reads } = f.chain({
    before: { [bot]: f.walletState(1_000n * SOL) },
    after: { [bot]: f.walletState(100n * SOL - 5_000n), [attacker]: f.walletState(900n * SOL) },
  });
  const result = await checkWard({ transaction, intent: { kind: "transfer", to: operator, amount: "1", mint: null } }, reads);
  assert.equal(result.verdict, "block");
  assert.ok(codes(result).includes("INTENT_AMOUNT_OVER"));
  assert.ok(codes(result).includes("INTENT_RECIPIENT"));
  assert.ok(codes(result).includes("RECIPIENT_NEW"), "the attacker's address never existed before");
});

test("address poisoning (Phantom user, February 2026, $264K): an address ground to look like one you know", async () => {
  const me = await f.wallet();
  const friend = await f.wallet();
  const poison = f.lookalike(friend);
  const transaction = f.wire(me, [f.systemTransfer(me, poison, 1_000n * SOL)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(1_500n * SOL), [poison]: f.walletState(1_000) },
    after: { [me]: f.walletState(500n * SOL - 5_000n), [poison]: f.walletState(1_000n * SOL + 1_000n) },
  });
  const result = await checkWard({ transaction, known: [friend] }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "RECIPIENT_LOOKALIKE");
  assert.deepEqual(reason(result, "RECIPIENT_LOOKALIKE").accounts, [poison, friend]);
});

test("a look-alike of the address the agent named: blocked twice over — the recipient and the intent", async () => {
  const me = await f.wallet();
  const friend = await f.wallet();
  const poison = f.lookalike(friend);
  const transaction = f.wire(me, [f.systemTransfer(me, poison, 2n * SOL)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(10n * SOL), [poison]: f.walletState(1_000) },
    after: { [me]: f.walletState(8n * SOL - 5_000n), [poison]: f.walletState(2n * SOL + 1_000n) },
  });
  const result = await checkWard({ transaction, intentText: `send 2 SOL to ${friend}` }, reads);
  assert.equal(result.verdict, "block");
  assert.ok(codes(result).includes("RECIPIENT_LOOKALIKE"));
  assert.ok(codes(result).includes("INTENT_RECIPIENT"));
});

test("unlimited approval (token-metadata injection, Blockaid demonstration 14.09.2026): blocked", async () => {
  const agent = await f.wallet();
  const spender = await f.wallet();
  const ata = await f.wallet();
  const transaction = f.wire(agent, [f.approve(ata, spender, agent, (1n << 64n) - 1n)]);
  const { reads } = f.chain({
    before: { [agent]: f.walletState(SOL), [ata]: f.tokenState({ mint: f.USDC, owner: agent, amount: 5_000_000_000n }) },
    after: { [ata]: f.tokenState({ mint: f.USDC, owner: agent, amount: 5_000_000_000n, delegate: spender, delegatedAmount: (1n << 64n) - 1n }) },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "DELEGATE_UNLIMITED");
  assert.equal(result.reasons.filter((entry) => entry.code.startsWith("DELEGATE")).length, 1, "the bytes and the simulation name it once");
});

test("a limited delegate is a warning, not a refusal", async () => {
  const agent = await f.wallet();
  const spender = await f.wallet();
  const ata = await f.wallet();
  const transaction = f.wire(agent, [f.approve(ata, spender, agent, 1_000_000n)]);
  const { reads } = f.chain({
    before: { [agent]: f.walletState(SOL), [ata]: f.tokenState({ mint: f.USDC, owner: agent, amount: 5_000_000n }) },
    after: { [ata]: f.tokenState({ mint: f.USDC, owner: agent, amount: 5_000_000n, delegate: spender, delegatedAmount: 1_000_000n }) },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "warn");
  assert.equal(result.reasons[0].code, "DELEGATE_SET");
});

test("a token account handed to another key (SetAuthority · AccountOwner): blocked", async () => {
  const me = await f.wallet();
  const thief = await f.wallet();
  const ata = await f.wallet();
  const transaction = f.wire(me, [f.setAuthority(ata, me, 2, thief)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(SOL), [ata]: f.tokenState({ mint: f.USDC, owner: me, amount: 9_000_000n }) },
    after: { [ata]: f.tokenState({ mint: f.USDC, owner: thief, amount: 9_000_000n }) },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "TOKEN_OWNER_CHANGED");
});

test("closing your account into someone else's wallet: blocked", async () => {
  const me = await f.wallet();
  const thief = await f.wallet();
  const ata = await f.wallet();
  const transaction = f.wire(me, [f.closeAccount(ata, thief, me)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(SOL), [thief]: f.walletState(SOL), [ata]: f.tokenState({ mint: f.USDC, owner: me, amount: 0n }) },
    after: { [ata]: null, [thief]: f.walletState(SOL + 2_039_280n) },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "block");
  assert.ok(codes(result).includes("CLOSE_TO_OTHER"));
});

test("a durable nonce (drainer pattern: the signature is kept and sent later): warned", async () => {
  const me = await f.wallet();
  const nonce = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.advanceNonce(nonce, me), f.systemTransfer(me, shop, SOL / 10n)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(SOL), [shop]: f.walletState(SOL), [nonce]: { lamports: 1_447_680n, owner: f.SYSTEM, data: new Uint8Array(80) } },
    after: { [me]: f.walletState(SOL - SOL / 10n - 5_000n), [shop]: f.walletState(SOL + SOL / 10n) },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "warn");
  assert.equal(result.reasons[0].code, "DURABLE_NONCE");
  assert.match(result.line, /never expires/);
});

test("a sweep: several balances emptied to one address in one signature — blocked", async () => {
  const me = await f.wallet();
  const thief = await f.wallet();
  const [a, b, c] = [await f.wallet(), await f.wallet(), await f.wallet()];
  const [ma, mb, mc] = [await f.wallet(), await f.wallet(), await f.wallet()];
  const [ta, tb, tc] = [await f.wallet(), await f.wallet(), await f.wallet()];
  const transaction = f.wire(me, [
    f.transferChecked(a, ma, ta, me, 10n, 0),
    f.transferChecked(b, mb, tb, me, 20n, 0),
    f.transferChecked(c, mc, tc, me, 30n, 0),
  ]);
  const { reads } = f.chain({
    before: {
      [me]: f.walletState(SOL),
      [a]: f.tokenState({ mint: ma, owner: me, amount: 10n }),
      [b]: f.tokenState({ mint: mb, owner: me, amount: 20n }),
      [c]: f.tokenState({ mint: mc, owner: me, amount: 30n }),
      [ta]: f.tokenState({ mint: ma, owner: thief, amount: 0n }),
      [tb]: f.tokenState({ mint: mb, owner: thief, amount: 0n }),
      [tc]: f.tokenState({ mint: mc, owner: thief, amount: 0n }),
      [ma]: f.mintState({ decimals: 0 }),
      [mb]: f.mintState({ decimals: 0 }),
      [mc]: f.mintState({ decimals: 0 }),
    },
    after: {
      [a]: f.tokenState({ mint: ma, owner: me, amount: 0n }),
      [b]: f.tokenState({ mint: mb, owner: me, amount: 0n }),
      [c]: f.tokenState({ mint: mc, owner: me, amount: 0n }),
      [ta]: f.tokenState({ mint: ma, owner: thief, amount: 10n }),
      [tb]: f.tokenState({ mint: mb, owner: thief, amount: 20n }),
      [tc]: f.tokenState({ mint: mc, owner: thief, amount: 30n }),
    },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "SWEEPS_ASSETS");
});

/* ---------------------------------------------------------------- Token-2022 */

async function receiving(mintState, { frozen = false } = {}) {
  const me = await f.wallet();
  const pool = await f.wallet();
  const mint = await f.wallet();
  const mine = await f.wallet();
  const vault = await f.wallet();
  const transaction = f.wire(me, [f.transferChecked(vault, mint, mine, pool, 1_000n, 6, mintState.owner)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(SOL), [vault]: f.tokenState({ mint, owner: pool, amount: 5_000n, program: mintState.owner }), [mint]: mintState },
    after: {
      [vault]: f.tokenState({ mint, owner: pool, amount: 4_000n, program: mintState.owner }),
      [mine]: f.tokenState({ mint, owner: me, amount: 1_000n, frozen, program: mintState.owner }),
    },
  });
  return checkWard({ transaction }, reads);
}

test("a token whose issuer can take it back (permanent delegate) and gate every move (transfer hook): warned", async () => {
  const issuer = await f.wallet();
  const hook = await f.wallet();
  const result = await receiving(f.mintState({ extensions: [{ __kind: "PermanentDelegate", delegate: issuer }, { __kind: "TransferHook", authority: issuer, programId: hook }] }));
  assert.equal(result.verdict, "warn");
  assert.ok(codes(result).includes("TOKEN_PERMANENT_DELEGATE"));
  assert.ok(codes(result).includes("TOKEN_TRANSFER_HOOK"));
});

test("a token that arrives frozen, or can never move: blocked", async () => {
  const issuer = await f.wallet();
  const frozen = await receiving(f.mintState({ freezeAuthority: issuer, extensions: [{ __kind: "DefaultAccountState", state: 2 }] }), { frozen: true });
  assert.equal(frozen.verdict, "block");
  assert.equal(frozen.reasons[0].code, "TOKEN_FROZEN_ON_ARRIVAL");
  const bound = await receiving(f.mintState({ extensions: [{ __kind: "NonTransferable" }] }));
  assert.equal(bound.verdict, "block");
  assert.equal(bound.reasons[0].code, "TOKEN_NON_TRANSFERABLE");
});

test("a paused token is blocked; a pausable one is a warning", async () => {
  const issuer = await f.wallet();
  const paused = await receiving(f.mintState({ extensions: [{ __kind: "PausableConfig", authority: { __option: "Some", value: issuer }, paused: true }] }));
  assert.equal(paused.reasons[0].code, "TOKEN_PAUSED");
  const pausable = await receiving(f.mintState({ extensions: [{ __kind: "PausableConfig", authority: { __option: "Some", value: issuer }, paused: false }] }));
  assert.equal(pausable.verdict, "warn");
  assert.ok(codes(pausable).includes("TOKEN_PAUSABLE"));
});

test("market facts the gateway cannot read are named, and do not raise the verdict on their own", async () => {
  const result = await receiving(f.mintState({}));
  assert.equal(result.verdict, "allow");
  assert.ok(codes(result).includes("TOKEN_FACTS_UNREAD"));
  assert.equal(result.notRead, 1);
});

/* ---------------------------------------------------------------- the honest edges */

test("a plain payment to an address with history reads as allow — and nothing anywhere says «safe»", async () => {
  const me = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.systemTransfer(me, shop, SOL / 4n)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(SOL), [shop]: f.walletState(3n * SOL) },
    after: { [me]: f.walletState(SOL - SOL / 4n - 5_000n), [shop]: f.walletState(3n * SOL + SOL / 4n) },
  });
  const result = await checkWard({ transaction, intentText: `send 0.25 SOL to ${shop}` }, reads);
  assert.equal(result.verdict, "allow");
  assert.equal(result.line, "Nothing known stands against this transaction.");
  assert.ok(codes(result).includes("INTENT_MATCH"));
  assert.ok(result.reasons.every((entry) => entry.level === "info"));
  assert.deepEqual(
    result.effects.changes.map((change) => [change.kind, change.raw]),
    [["you", String(-(SOL / 4n) - 5_000n)], ["wallet", String(SOL / 4n)]],
  );
  assert.doesNotMatch(JSON.stringify(result), /\bsafe\b/i);
  assert.ok(!("score" in result));
});

test("a silent chain is never a pass: the same payment without a simulation is a warning", async () => {
  const me = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.systemTransfer(me, shop, SOL / 4n)]);
  const { reads } = f.chain({ before: { [me]: f.walletState(SOL), [shop]: f.walletState(SOL) }, simulation: "unavailable" });
  const result = await checkWard({ transaction, intentText: `send 0.25 SOL to ${shop}` }, reads);
  assert.equal(result.verdict, "warn");
  assert.equal(result.effects.simulated, false);
  assert.ok(codes(result).includes("SIMULATION_UNAVAILABLE"));
  assert.ok(codes(result).includes("INTENT_UNCHECKED"));
  assert.ok(result.notRead >= 2);
});

test("a simulation that runs but reports no accounts is not «nothing moves»", async () => {
  const me = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.systemTransfer(me, shop, SOL / 4n)]);
  const { reads } = f.chain({ before: { [me]: f.walletState(SOL), [shop]: f.walletState(SOL) } });
  const silent = { ...reads, simulate: async () => ({ state: "ran", err: null, logs: [], inner: [], after: new Map() }) };
  const result = await checkWard({ transaction }, silent);
  assert.equal(result.verdict, "warn");
  assert.equal(result.effects.simulated, false);
  assert.ok(codes(result).includes("SIMULATION_UNAVAILABLE"));
});

test("a sweep that takes SOL too names it by the wrapped mint, inside the published shape", async () => {
  const me = await f.wallet();
  const thief = await f.wallet();
  const [a, b, ma, mb, ta, tb] = [await f.wallet(), await f.wallet(), await f.wallet(), await f.wallet(), await f.wallet(), await f.wallet()];
  const transaction = f.wire(me, [f.transferChecked(a, ma, ta, me, 10n, 0), f.transferChecked(b, mb, tb, me, 20n, 0), f.systemTransfer(me, thief, 5n * SOL)]);
  const { reads } = f.chain({
    before: {
      [me]: f.walletState(6n * SOL),
      [thief]: f.walletState(SOL),
      [a]: f.tokenState({ mint: ma, owner: me, amount: 10n }),
      [b]: f.tokenState({ mint: mb, owner: me, amount: 20n }),
      [ta]: f.tokenState({ mint: ma, owner: thief, amount: 0n }),
      [tb]: f.tokenState({ mint: mb, owner: thief, amount: 0n }),
      [ma]: f.mintState({ decimals: 0 }),
      [mb]: f.mintState({ decimals: 0 }),
    },
    after: {
      [me]: f.walletState(SOL - 5_000n),
      [thief]: f.walletState(6n * SOL),
      [a]: f.tokenState({ mint: ma, owner: me, amount: 0n }),
      [b]: f.tokenState({ mint: mb, owner: me, amount: 0n }),
      [ta]: f.tokenState({ mint: ma, owner: thief, amount: 10n }),
      [tb]: f.tokenState({ mint: mb, owner: thief, amount: 20n }),
    },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "block");
  assert.equal(result.reasons[0].code, "SWEEPS_ASSETS");
  assert.ok(result.reasons[0].accounts.includes("So11111111111111111111111111111111111111112"));
});

test("a source that hangs is named as not read, and never holds the verdict back", async () => {
  const me = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.systemTransfer(me, shop, SOL / 4n)]);
  const { reads } = f.chain({ before: { [me]: f.walletState(SOL), [shop]: f.walletState(SOL) }, after: { [shop]: f.walletState(SOL + SOL / 4n) } });
  const hanging = { ...reads, security: () => new Promise(() => {}) };
  const started = Date.now();
  const result = await checkWard({ transaction }, hanging);
  assert.ok(Date.now() - started < 6_000);
  assert.equal(result.verdict, "allow");
  assert.ok(codes(result).includes("RECIPIENT_UNREAD"));
});

test("a failing transaction is named as failing", async () => {
  const me = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.systemTransfer(me, shop, 50n * SOL)]);
  const { reads } = f.chain({ before: { [me]: f.walletState(SOL) }, err: '{"InstructionError":[0,{"Custom":1}]}', logs: ["Transfer: insufficient lamports 1000000000, need 50000000000"] });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "warn");
  assert.equal(result.reasons[0].code, "SIMULATION_FAILED");
  assert.match(result.reasons[0].detail, /insufficient lamports/);
});

test("Ryntra's threat list and the security source both stop a payment", async () => {
  const me = await f.wallet();
  const drainer = await f.wallet();
  const sanctioned = await f.wallet();
  const pay = (to) => f.wire(me, [f.systemTransfer(me, to, SOL / 2n)]);
  const listed = f.chain({
    before: { [me]: f.walletState(SOL), [drainer]: f.walletState(1) },
    after: { [drainer]: f.walletState(SOL / 2n + 1n) },
    threats: [{ address: drainer, kind: "drainer", source: "test entry", addedAt: "2026-10-31" }],
  });
  const one = await checkWard({ transaction: pay(drainer) }, listed.reads);
  assert.equal(one.verdict, "block");
  assert.ok(codes(one).includes("RECIPIENT_KNOWN_THREAT"));
  const flagged = f.chain({
    before: { [me]: f.walletState(SOL), [sanctioned]: f.walletState(1) },
    after: { [sanctioned]: f.walletState(SOL / 2n + 1n) },
    security: { [sanctioned]: { state: "answered", sanctioned: true, band: "critical" } },
  });
  const two = await checkWard({ transaction: pay(sanctioned) }, flagged.reads);
  assert.equal(two.verdict, "block");
  assert.equal(two.reasons[0].code, "RECIPIENT_SANCTIONED");
});

test("a known stablecoin's issuer powers read as information, not as a warning on every dollar", async () => {
  const me = await f.wallet();
  const pool = await f.wallet();
  const vault = await f.wallet();
  const mine = await f.wallet();
  const circle = await f.wallet();
  const transaction = f.wire(me, [f.transferChecked(vault, f.USDC, mine, pool, 5_000_000n, 6)]);
  const { reads } = f.chain({
    before: { [me]: f.walletState(SOL), [vault]: f.tokenState({ mint: f.USDC, owner: pool, amount: 9_000_000n }), [mine]: f.tokenState({ mint: f.USDC, owner: me, amount: 0n }), [f.USDC]: f.mintState({ mintAuthority: circle, freezeAuthority: circle }) },
    after: { [vault]: f.tokenState({ mint: f.USDC, owner: pool, amount: 4_000_000n }), [mine]: f.tokenState({ mint: f.USDC, owner: me, amount: 5_000_000n }) },
  });
  const result = await checkWard({ transaction }, reads);
  assert.equal(result.verdict, "allow");
  assert.equal(reason(result, "TOKEN_FREEZE_AUTHORITY").level, "info");
  assert.ok(!codes(result).includes("TOKEN_FACTS_UNREAD"), "a known issuer's token is not sent to the gateway");
});

test("an intent line that cannot be read is an honest unknown, and keeps the verdict off allow", async () => {
  const me = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.systemTransfer(me, shop, SOL / 4n)]);
  const { reads } = f.chain({ before: { [me]: f.walletState(SOL), [shop]: f.walletState(SOL) }, after: { [shop]: f.walletState(SOL + SOL / 4n) } });
  const result = await checkWard({ transaction, intentText: "do the usual thing" }, reads);
  assert.equal(result.verdict, "warn");
  assert.equal(result.reasons[0].code, "INTENT_UNREADABLE");
});

test("a bare message reads the same as the transaction that wraps it; garbage is refused as input", async () => {
  const me = await f.wallet();
  const shop = await f.wallet();
  const transaction = f.wire(me, [f.systemTransfer(me, shop, 1_000n)], "legacy");
  const bytes = Buffer.from(transaction, "base64");
  const message = bytes.subarray(1 + 64).toString("base64");
  const read = readWire(message);
  assert.ok(read.ok);
  assert.equal(read.message.version, "legacy");
  assert.equal(read.message.wireBase64, transaction);
  await assert.rejects(checkWard({ transaction: "hello world" }, f.chain().reads), WardInputError);
  await assert.rejects(checkWard({ transaction: Buffer.from("not a transaction at all").toString("base64") }, f.chain().reads), WardInputError);
  await assert.rejects(checkWard({}, f.chain().reads), WardInputError);
});

/* ---------------------------------------------------------------- links */

test("a Solana Pay transaction request is not fetched: the check asks for the transaction itself", async () => {
  const result = await checkWard({ link: "solana:https://shop.example/api/pay?order=7" }, f.chain().reads);
  assert.equal(result.verdict, "warn");
  assert.equal(result.reasons[0].code, "LINK_NOT_READ");
  assert.equal(result.input.kind, "link");
});

test("a payment request link: its recipient and amount are compared with what the agent said", async () => {
  const shop = await f.wallet();
  const recipient = async (to, mint) => ({
    input: "solana-pay",
    next: "transfer",
    problem: null,
    address: shop,
    asset: { mint: f.USDC },
    destination: { kind: "wallet", owner: shop, account: shop, opensAccount: false },
    asked: { amount: "40", mint: f.USDC, label: null, message: null },
    link: null,
    checkedAt: "2026-10-31T10:00:00.000Z",
    _seen: { to, mint },
  });
  const { reads } = f.chain({ before: { [f.USDC]: f.mintState({ decimals: 6 }) }, recipient });
  const fine = await checkWard({ link: `solana:${shop}?amount=40&spl-token=${f.USDC}`, intentText: `pay 40 USDC to ${shop}` }, reads);
  assert.equal(fine.verdict, "allow");
  assert.ok(codes(fine).includes("INTENT_MATCH"));
  const over = await checkWard({ link: `solana:${shop}?amount=40&spl-token=${f.USDC}`, intentText: `pay 4 USDC to ${shop}` }, reads);
  assert.equal(over.verdict, "block");
  assert.equal(over.reasons[0].code, "INTENT_AMOUNT_OVER");
});

/* ---------------------------------------------------------------- parts */

test("intent lines read in English and Ukrainian, and nothing else", () => {
  const to = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
  assert.deepEqual(readIntentText(`send 4 SOL to ${to}`), { ok: true, intent: { kind: "transfer", to, amount: "4", mint: null } });
  assert.deepEqual(readIntentText(`Надіслати 2,5 USDC на ${to}`), { ok: true, intent: { kind: "transfer", to, amount: "2.5", mint: f.USDC } });
  assert.deepEqual(readIntentText("swap 1 SOL for USDC"), { ok: true, intent: { kind: "swap", give: { mint: null, amount: "1" }, get: { mint: f.USDC, min: null } } });
  assert.deepEqual(readIntentText("обміняти 10 USDC на щонайменше 0.05 SOL"), { ok: true, intent: { kind: "swap", give: { mint: f.USDC, amount: "10" }, get: { mint: null, min: "0.05" } } });
  assert.equal(readIntentText("send 4 DOGE to " + to).ok, false);
  assert.equal(readIntentText("please help me").ok, false);
});

test("a swap intent: the asset given, the asset received, and nothing else taken", () => {
  const me = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
  const pool = "3EpVCPUgyjq2MfGeCttyey6bs5zya5wjYZ2BE6yDg6bm";
  const intent = { kind: "swap", give: { mint: null, amount: "1" }, get: { mint: f.USDC, min: "150" } };
  const base = { signer: me, costLamports: 10_000n, decimalsOf: (mint) => (mint === null ? 9 : 6), ownerOfAccount: () => null };
  const good = compareIntent(intent, { ...base, changes: [{ holder: me, mint: null, raw: -SOL - 10_000n }, { holder: me, mint: f.USDC, raw: 160_000_000n }, { holder: pool, mint: null, raw: SOL }] });
  assert.deepEqual(good, [{ code: "INTENT_MATCH" }]);
  const short = compareIntent(intent, { ...base, changes: [{ holder: me, mint: null, raw: -SOL }, { holder: me, mint: f.USDC, raw: 100_000_000n }] });
  assert.equal(short[0].code, "INTENT_NOT_RECEIVED");
});

test("look-alikes: seven characters across both ends, at least three at each", () => {
  const known = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
  assert.equal(looksLike(f.lookalike(known), known), true);
  assert.equal(looksLike(known, known), false);
  assert.equal(looksLike("DiY" + "x".repeat(37) + "tHtM", known), false, "three at each end make six — not enough");
  assert.equal(looksLike("DiYB" + "z".repeat(37) + "jHtM", known), true);
  assert.equal(looksLike("3EpVCPUgyjq2MfGeCttyey6bs5zya5wjYZ2BE6yDg6bm", known), false);
});

test("lookup tables resolve into the message's account order", () => {
  const a = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
  const b = "3EpVCPUgyjq2MfGeCttyey6bs5zya5wjYZ2BE6yDg6bm";
  const data = new Uint8Array(56 + 64);
  data.set(f.walletState(0).data, 0);
  const keyBytes = (address) => Uint8Array.from(Buffer.from(require58(address)));
  data.set(keyBytes(a), 56);
  data.set(keyBytes(b), 88);
  assert.deepEqual(decodeLookupTable(data, encodeAddress), [a, b]);
  const message = { staticAccounts: ["S"], lookups: [{ table: "T", writable: [1], readonly: [0] }] };
  assert.deepEqual(accountKeysOf(message, new Map([["T", [a, b]]])), ["S", b, a]);
  assert.deepEqual(accountKeysOf(message, new Map()), ["S", null, null]);
});

function require58(address) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(alphabet.indexOf(char));
  const out = new Uint8Array(32);
  for (let at = 31; at >= 0; at -= 1) {
    out[at] = Number(value & 255n);
    value >>= 8n;
  }
  return out;
}

test("every core unknown is a reason the table knows, at the unknown level", () => {
  for (const code of WARD_CORE_UNKNOWNS) assert.equal(WARD_REASONS[code].level, "unknown", code);
});
