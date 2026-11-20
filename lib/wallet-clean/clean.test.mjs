import assert from "node:assert/strict";
import { test } from "node:test";

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createCloseAccountInstruction } from "@solana/spl-token";

import {
  DUST_MAX_USD,
  MAX_CLOSES_PER_TX,
  MAX_SWAPS,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  USDC_MINT,
  WSOL_MINT,
  alreadyProcessed,
  backOf,
  chainAccountOf,
  cleanItems,
  closeSteps,
  mintExtrasOf,
  planOf,
  rentBackLamports,
  riskOf,
  takenItems,
} from "./rules.ts";
import { checkCleanSigned, issueCleanTicket, readCleanTicket, stepDigest } from "./ticket.ts";

const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const RENT = 2_039_280;
let n = 0;
const address = () => {
  n += 1;
  return Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58();
};

const account = (over = {}) => ({
  account: address(),
  mint: address(),
  program: TOKEN_PROGRAM,
  amountRaw: "0",
  decimals: 6,
  lamports: RENT,
  frozen: false,
  native: false,
  closeAuthority: null,
  withheldRaw: "0",
  confidential: false,
  ...over,
});

const facts = (mint, over = {}) => ({
  mint,
  symbol: "COIN",
  name: "Coin",
  icon: null,
  price: 1,
  verified: true,
  organicLow: false,
  mintOff: true,
  freezeOff: true,
  liquidityUsd: 1_000_000,
  transferFeeBps: 0,
  hook: false,
  permanentDelegate: false,
  nonTransferable: false,
  ...over,
});

test("the two token programs are the chain's own ids: a mistyped one makes every read of the wallet fail", () => {
  assert.equal(TOKEN_PROGRAM, TOKEN_PROGRAM_ID.toBase58());
  assert.equal(TOKEN_2022_PROGRAM, TOKEN_2022_PROGRAM_ID.toBase58());
});

test("a verified coin carries no mark; its issuer's rights are not marks", () => {
  assert.deepEqual(riskOf(facts("x", { freezeOff: false, mintOff: false, permanentDelegate: true })), []);
  assert.deepEqual(riskOf(facts(USDC_MINT, { verified: false })), []);
});

test("an unverified coin says why: rights still on, a delegate, thin, low score — in that order", () => {
  const risk = riskOf(facts("x", { verified: false, mintOff: false, freezeOff: false, permanentDelegate: true, liquidityUsd: 500, organicLow: true }));
  assert.deepEqual(risk, ["unverified", "mint", "freeze", "delegate", "thin", "score"]);
  assert.deepEqual(riskOf(null), ["unverified"]);
});

test("a transfer fee or a hook marks any coin, verified or not", () => {
  assert.deepEqual(riskOf(facts("x", { transferFeeBps: 100 })), ["fee"]);
  assert.deepEqual(riskOf(facts("x", { hook: true })), ["hook"]);
});

test("the wallet sorted: empty accounts picked; wrapped SOL listed, picked only when empty; small coins picked; marked coins listed, not picked; larger ones out", () => {
  const empty = account();
  const wrapped = account({ mint: WSOL_MINT, native: true, amountRaw: "5000000", lamports: RENT + 5_000_000, decimals: 9 });
  const small = account({ amountRaw: "2000000" }); // 2 coins at $1
  const risky = account({ amountRaw: "1000000" });
  const big = account({ amountRaw: "50000000" }); // $50
  const litter = account({ amountRaw: "777" });
  const frozen = account({ frozen: true });
  const others = account({ closeAuthority: address() });
  const map = new Map([
    [small.mint, facts(small.mint)],
    [risky.mint, facts(risky.mint, { verified: false })],
    [big.mint, facts(big.mint)],
    [litter.mint, facts(litter.mint, { price: null, verified: false })],
    [empty.mint, facts(empty.mint, { verified: false })],
  ]);
  const items = cleanItems(OWNER, [empty, wrapped, small, risky, big, litter, frozen, others], map);
  const by = new Map(items.map((item) => [item.account, item]));
  assert.equal(by.get(empty.account).kind, "empty");
  assert.equal(by.get(empty.account).picked, true, "an empty account is closed whatever its coin");
  assert.equal(by.get(wrapped.account).kind, "wrapped");
  assert.equal(by.get(small.account).kind, "small");
  assert.equal(by.get(small.account).picked, true);
  assert.equal(by.get(risky.account).picked, false);
  assert.equal(by.get(litter.account).kind, "litter");
  assert.equal(by.get(litter.account).picked, false);
  assert.equal(by.has(big.account), false, `over $${DUST_MAX_USD} stays`);
  assert.equal(by.has(frozen.account), false);
  assert.equal(by.has(others.account), false);
  assert.equal(items[0].kind, "wrapped");
  assert.equal(by.get(wrapped.account).symbol, "wSOL", "wrapped SOL is named as what it is, never plain SOL");
  assert.equal(by.get(wrapped.account).picked, false, "wrapped SOL with a balance waits for the person's own choice");
  assert.equal(by.get(wrapped.account).lamports, RENT, "wrapped SOL's own balance is never «got back»");
  assert.equal(rentBackLamports(items.filter((item) => item.picked)), RENT * 2);
});

test("wrapped SOL: a whale's 86 260 wrapped SOL is never in a clean by default; an empty wrapped account is", () => {
  const whale = account({ mint: WSOL_MINT, native: true, amountRaw: "86260508921310", lamports: 86_260_510_409_753, decimals: 9 });
  const emptyWrapped = account({ mint: WSOL_MINT, native: true, amountRaw: "0", lamports: RENT, decimals: 9 });
  const items = cleanItems(OWNER, [whale, emptyWrapped], new Map());
  const by = new Map(items.map((item) => [item.account, item]));
  assert.equal(by.get(whale.account).picked, false);
  assert.equal(by.get(whale.account).lamports, 86_260_510_409_753 - 86_260_508_921_310, "only its rent counts as got back");
  assert.equal(by.get(emptyWrapped.account).picked, true, "an empty wrapped account gives its rent back and touches no coin");
  assert.deepEqual(takenItems(items).map((item) => item.account), [emptyWrapped.account]);
  // Picked by hand, it is unwrapped by closing, as before: the plan is the same one.
  const plan = planOf(takenItems(items, { add: [whale.account] }));
  assert.deepEqual(new Set(plan.closes.flat().map((item) => item.account)), new Set([whale.account, emptyWrapped.account]));
  assert.deepEqual(closeSteps(by.get(whale.account)), { harvest: false, burnRaw: null, close: true }, "unwrapping never burns");
  assert.deepEqual(backOf(OWNER, [whale, emptyWrapped]), { lamports: RENT, accounts: 1 }, "the short reader counts only the empty one");
});

test("no price is never picked; a known coin or an NFT-shaped account is never litter", () => {
  const unpriced = account({ amountRaw: "10000000000" });
  const usdc = account({ mint: USDC_MINT, amountRaw: "10000000000" });
  const position = account({ amountRaw: "1", decimals: 0, program: TOKEN_2022_PROGRAM });
  const emptyNft = account({ decimals: 0 });
  const map = new Map([
    [unpriced.mint, facts(unpriced.mint, { price: null })],
    [usdc.mint, facts(usdc.mint, { price: null })],
    [position.mint, facts(position.mint, { price: null, verified: false })],
  ]);
  const items = cleanItems(OWNER, [unpriced, usdc, position, emptyNft], map);
  const by = new Map(items.map((item) => [item.account, item]));
  assert.equal(by.get(unpriced.account).kind, "litter");
  assert.equal(by.get(unpriced.account).picked, false, "a verified coin the market gave no price is not burnt by default");
  assert.equal(by.has(usdc.account), false);
  assert.equal(by.has(position.account), false, "a position's NFT is never offered to burn");
  assert.equal(by.get(emptyNft.account).kind, "empty", "an empty NFT account still closes");
});

test("wrapped SOL waits for a clean without swaps", () => {
  const wrapped = account({ mint: WSOL_MINT, native: true, amountRaw: "7", decimals: 9 });
  const small = account({ amountRaw: "1000000" });
  const items = cleanItems(OWNER, [wrapped, small], new Map([[small.mint, facts(small.mint)]]));
  const plan = planOf(takenItems(items, { add: [wrapped.account] }));
  assert.equal(plan.swaps.length, 1);
  assert.equal(plan.closes.flat().length, 0);
  assert.equal(plan.left, 1);
  assert.equal(planOf(takenItems(items, { add: [wrapped.account], drop: [small.account] })).closes.flat()[0].kind, "wrapped");
});

test("a marked coin enters only by hand; any item may be taken out", () => {
  const small = account({ amountRaw: "1000000" });
  const risky = account({ amountRaw: "1000000" });
  const map = new Map([
    [small.mint, facts(small.mint)],
    [risky.mint, facts(risky.mint, { verified: false })],
  ]);
  const items = cleanItems(OWNER, [small, risky], map);
  assert.deepEqual(takenItems(items).map((item) => item.account), [small.account]);
  assert.deepEqual(new Set(takenItems(items, { add: [risky.account], drop: [small.account] }).map((item) => item.account)), new Set([risky.account]));
});

test("one clean: closes first in batches, at most six swaps, the swapped accounts closed after; a coin under a cent is burnt", () => {
  const map = new Map();
  const accounts = [];
  for (let i = 0; i < MAX_SWAPS + 2; i += 1) {
    const a = account({ amountRaw: "1000000" });
    map.set(a.mint, facts(a.mint));
    accounts.push(a);
  }
  const crumb = account({ amountRaw: "1" });
  map.set(crumb.mint, facts(crumb.mint));
  for (let i = 0; i < MAX_CLOSES_PER_TX + 1; i += 1) accounts.push(account());
  const plan = planOf(takenItems(cleanItems(OWNER, [...accounts, crumb], map)));
  assert.equal(plan.swaps.length, MAX_SWAPS);
  assert.deepEqual(plan.after, plan.swaps);
  assert.equal(plan.closes.length, 2);
  assert.equal(plan.closes[0].length, MAX_CLOSES_PER_TX);
  assert.ok(plan.closes.flat().some((item) => item.account === crumb.account), "a crumb is burnt and closed, never swapped");
  assert.equal(plan.left, 2);
});

test("closing: litter is burnt first, Token-2022 fees held back go to the mint, an empty account only closes", () => {
  const [litter] = cleanItems(OWNER, [account({ amountRaw: "42", program: TOKEN_2022_PROGRAM, withheldRaw: "3" })], new Map());
  assert.deepEqual(closeSteps(litter), { harvest: true, burnRaw: "42", close: true });
  const [empty] = cleanItems(OWNER, [account()], new Map());
  assert.deepEqual(closeSteps(empty), { harvest: false, burnRaw: null, close: true });
});

test("the short reader counts only empty accounts — an empty wrapped SOL account among them, never one with SOL in it", () => {
  const back = backOf(OWNER, [account(), account({ amountRaw: "5" }), account({ mint: WSOL_MINT, native: true, amountRaw: "10", lamports: RENT + 10 }), account({ mint: WSOL_MINT, native: true, amountRaw: "0" }), account({ frozen: true })]);
  assert.deepEqual(back, { lamports: RENT * 2, accounts: 2 });
});

test("the chain's parsed rows: an account with its held fees, a mint with its fee in force and its hook", () => {
  const row = chainAccountOf(
    OWNER,
    {
      lamports: RENT,
      data: { parsed: { type: "account", info: { mint: WSOL_MINT, state: "initialized", isNative: false, tokenAmount: { amount: "12", decimals: 9 }, extensions: [{ extension: "transferFeeAmount", state: { withheldAmount: 7 } }] } } },
    },
    TOKEN_2022_PROGRAM,
  );
  assert.equal(row.withheldRaw, "7");
  assert.equal(row.amountRaw, "12");
  assert.equal(chainAccountOf(OWNER, { data: { parsed: { type: "mint", info: {} } } }, TOKEN_PROGRAM), null);
  const extras = mintExtrasOf(
    {
      data: {
        parsed: {
          info: {
            extensions: [
              { extension: "transferFeeConfig", state: { olderTransferFee: { epoch: 1, transferFeeBasisPoints: 10 }, newerTransferFee: { epoch: 900, transferFeeBasisPoints: 250 } } },
              { extension: "transferHook", state: { programId: OWNER, authority: null } },
            ],
          },
        },
      },
    },
    800,
  );
  assert.deepEqual(extras, { transferFeeBps: 10, hook: true, permanentDelegate: false, nonTransferable: false });
});

/* ── the seal ─────────────────────────────────────────────────────────── */

const ENV = { BETA_TOKEN_SECRET: "a-secret-of-enough-length" };

function closeTx(owner, blockhash, target, extra = []) {
  const ix = createCloseAccountInstruction(new PublicKey(target), owner.publicKey, owner.publicKey, [], new PublicKey(TOKEN_PROGRAM));
  const message = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions: [...extra, ix] }).compileToV0Message();
  return new VersionedTransaction(message);
}

test("the ticket seals what each transaction does; the relay takes the same bytes signed by that wallet, and a wallet's own priority", () => {
  const owner = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const target = address();
  const tx = closeTx(owner, blockhash, target);
  const wire = Buffer.from(tx.serialize()).toString("base64");
  const ticket = issueCleanTicket({ owner: owner.publicKey.toBase58(), steps: [{ kind: "close", digest: stepDigest(wire), lookups: [], requestId: null }] }, ENV, 1_000);
  const read = readCleanTicket(ticket, ENV, 2_000);
  assert.equal(read.ok, true);
  assert.equal(readCleanTicket(ticket + "x", ENV, 2_000).ok, false);
  assert.equal(readCleanTicket(ticket, ENV, 10_000_000).code, "TICKET_EXPIRED");

  const unsigned = checkCleanSigned(read.ticket, [wire], new Map());
  assert.deepEqual(unsigned, { ok: false, code: "NOT_SIGNED", index: 0 });

  tx.sign([owner]);
  const signed = checkCleanSigned(read.ticket, [Buffer.from(tx.serialize()).toString("base64")], new Map());
  assert.equal(signed.ok, true);

  // The wallet adds its own priority: still the same clean.
  const withPriority = closeTx(owner, blockhash, target, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })]);
  withPriority.sign([owner]);
  assert.equal(checkCleanSigned(read.ticket, [Buffer.from(withPriority.serialize()).toString("base64")], new Map()).ok, true);

  const another = closeTx(owner, blockhash, address());
  another.sign([owner]);
  assert.deepEqual(checkCleanSigned(read.ticket, [Buffer.from(another.serialize()).toString("base64")], new Map()), { ok: false, code: "SIGNED_MISMATCH", index: 0 });

  const stranger = Keypair.generate();
  const theirs = closeTx(stranger, blockhash, target);
  theirs.sign([stranger]);
  assert.equal(checkCleanSigned(read.ticket, [Buffer.from(theirs.serialize()).toString("base64")], new Map()).ok, false);
  assert.equal(checkCleanSigned(read.ticket, [], new Map()).ok, false);
});

test("a landed repeat is never «not sent»: «already processed» is read on any line of the node's error", () => {
  // web3.js: the first line is its own, the node's words follow.
  assert.equal(alreadyProcessed(new Error("Simulation failed. \nMessage: Transaction simulation failed: This transaction has already been processed. \nLogs: []")), true);
  assert.equal(alreadyProcessed(new Error("failed to send transaction: AlreadyProcessed")), true);
  assert.equal(alreadyProcessed(new Error("Simulation failed. \nMessage: Transaction simulation failed: Blockhash not found.")), false);
  assert.equal(alreadyProcessed(new Error("fetch failed")), false);
  assert.equal(alreadyProcessed(undefined), false);
});
