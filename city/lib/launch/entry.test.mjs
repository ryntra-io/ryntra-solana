/**
 * CITY-220 · «Your people first» from the people's side: the window's one step at each moment, the amounts, the read of
 * each step's bytes against Meteora's Alpha Vault IDL, and each step through the flow on the stand. No network.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { IDL } from "@meteora-ag/alpha-vault";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { LaunchEarlyAccessActionBuildRequestSchema, LaunchEarlyAccessDepositBuildRequestSchema, LaunchEarlyAccessDepositSubmitRequestSchema } from "../../../lib/api/v1/contract.ts";
import { ALPHA_VAULT_PROGRAM, checkEntry, walletAccount } from "./entry-check.ts";
import { runEntry } from "./entry-flow.ts";
import { ENTRY_STUB_MINT, stubEntryEngine } from "./entry-stub.ts";
import { amountProblem, earlyFrom, earlyLink, entryStep, httpEntryEngine, ryntraShare, stepAction, units, usdcRaw, wantsWallet } from "./entry.ts";
import { BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED } from "./refusal.ts";

const seeded = (byte) => Keypair.fromSeed(Buffer.alloc(32, byte)).publicKey;
const WALLET = seeded(81);
const VAULT = seeded(82);
const OTHER = seeded(83);
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const coder = new BorshInstructionCoder(IDL);
const PROGRAM = new PublicKey(ALPHA_VAULT_PROGRAM);
const wire = (tx) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

/** An Alpha Vault instruction by the IDL: its accounts in order, the vault and the wallet where the IDL names them. */
function vaultIx(name, args, place) {
  const spec = IDL.instructions.find((ix) => ix.name === name);
  const keys = spec.accounts.map((account, i) => ({ pubkey: place[account.name] ?? seeded(100 + i), isSigner: account.name === "owner" || account.name === "cranker" || account.name === "payer", isWritable: true }));
  return new TransactionInstruction({ programId: PROGRAM, keys, data: coder.encode(name, args) });
}
const tx = (...ixs) => wire(new Transaction({ feePayer: WALLET, recentBlockhash: seeded(99).toBase58() }).add(...ixs));
const base = { builtNetwork: "solana:mainnet", network: "solana:mainnet", wallet: WALLET.toBase58(), vault: VAULT.toBase58() };
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** Where the engine sends a withdrawal or a claim: the wallet's own account of the mint. */
const lands = (owner = WALLET, mint = USDC) => ({ destination_token: new PublicKey(walletAccount(owner.toBase58(), mint.toBase58(), TOKEN.toBase58())), token_mint: mint, token_program: TOKEN });
const deposit = (amount, place = {}) => vaultIx("deposit", { max_amount: new BN(amount) }, { vault: VAULT, owner: WALLET, ...place });

/* ---------------------------------------------------------------- the bytes */

test("each step's bytes, laid out by Meteora's Alpha Vault IDL, read back as the step shown", () => {
  const ata = createAssociatedTokenAccountIdempotentInstruction(WALLET, seeded(90), VAULT, USDC);
  const escrow = vaultIx("create_new_escrow", {}, { vault: VAULT, owner: WALLET, payer: WALLET });
  assert.deepEqual(checkEntry({ ...base, wire: tx(escrow, ata, deposit("100000000")), kind: "DEPOSIT", amountRaw: "100000000" }), { ok: true }, "a first deposit opens its escrow");
  assert.deepEqual(checkEntry({ ...base, wire: tx(ata, deposit("2500000")), kind: "DEPOSIT", amountRaw: "2500000" }), { ok: true });
  assert.deepEqual(checkEntry({ ...base, wire: tx(vaultIx("withdraw", { amount: new BN("2500000") }, { vault: VAULT, owner: WALLET, ...lands() })), kind: "WITHDRAW", amountRaw: "2500000" }), { ok: true });
  assert.deepEqual(checkEntry({ ...base, wire: tx(vaultIx("withdraw_remaining_quote", {}, { vault: VAULT, owner: WALLET, ...lands() })), kind: "WITHDRAW_REMAINING", amountRaw: null }), { ok: true });
  assert.deepEqual(checkEntry({ ...base, wire: tx(vaultIx("claim_token", {}, { vault: VAULT, owner: WALLET, ...lands(WALLET, seeded(91)) })), kind: "CLAIM", amountRaw: null }), { ok: true });
  assert.deepEqual(checkEntry({ ...base, wire: tx(vaultIx("fill_damm_v2", { max_amount: new BN("3200000000") }, { vault: VAULT, cranker: WALLET })), kind: "FILL", amountRaw: "3200000000" }), { ok: true });
});

test("a step other than the one shown never reaches the wallet", () => {
  const ok = { ...base, kind: "DEPOSIT", amountRaw: "100000000" };
  for (const [why, change, reason] of [
    ["another amount", { wire: tx(deposit("100000001")) }, "Another amount."],
    ["another vault", { wire: tx(deposit("100000000", { vault: OTHER })) }, "Another vault."],
    ["another wallet's escrow", { wire: tx(deposit("100000000", { owner: OTHER })) }, "Unexpected signers."],
    ["SOL slipped in", { wire: tx(deposit("100000000"), SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: OTHER, lamports: 1 })) }, "Unexpected program."],
    ["two deposits", { wire: tx(deposit("100000000"), deposit("100000000")) }, "Not the step shown."],
    ["a withdrawal for a deposit", { wire: tx(vaultIx("withdraw", { amount: new BN("100000000") }, { vault: VAULT, owner: WALLET })) }, "Not the step shown."],
    ["another network", { builtNetwork: "solana:devnet" }, "Another network."],
    ["unreadable", { wire: "AAAA" }, "Unreadable transaction."],
  ]) {
    const read = checkEntry({ ...ok, wire: tx(deposit("100000000")), ...change });
    assert.equal(read.ok, false, why);
    assert.equal(read.reason, reason, why);
  }
  /* Paid by someone else: the wallet would sign for a payer it never saw. */
  const paidByOther = wire(new Transaction({ feePayer: OTHER, recentBlockhash: seeded(99).toBase58() }).add(deposit("100000000")));
  assert.equal(checkEntry({ ...ok, wire: paidByOther }).reason, "Unexpected signers.");
  assert.equal(checkEntry({ ...base, kind: "FILL", amountRaw: "1", wire: tx(vaultIx("fill_damm_v2", { max_amount: new BN(1) }, { vault: VAULT, cranker: OTHER })) }).ok, false, "a fill cranked by another wallet");
  /* Review 8.11: the one buy spends exactly what the window showed deposited — never more, never an unread figure. */
  const fill = (max, amountRaw) => checkEntry({ ...base, kind: "FILL", amountRaw, wire: tx(vaultIx("fill_damm_v2", { max_amount: new BN(max) }, { vault: VAULT, cranker: WALLET })) });
  assert.equal(fill("3200000001", "3200000000").reason, "Another amount.", "more than the window showed");
  assert.equal(fill("18446744073709551615", "3200000000").reason, "Another amount.", "the most a u64 holds");
  assert.equal(fill("3200000000", null).reason, "Another amount.", "no figure from the window, no buy");
  /* Review 8.11: the money of a payout lands in the wallet's own account only; no compute budget; no stranger's account. */
  const out = { ...base, kind: "WITHDRAW", amountRaw: "2500000" };
  assert.equal(checkEntry({ ...out, wire: tx(vaultIx("withdraw", { amount: new BN("2500000") }, { vault: VAULT, owner: WALLET, ...lands(), destination_token: OTHER })) }).reason, "Another wallet.", "a withdrawal into a stranger's account");
  assert.equal(checkEntry({ ...out, kind: "CLAIM", amountRaw: null, wire: tx(vaultIx("claim_token", {}, { vault: VAULT, owner: WALLET, ...lands(OTHER, seeded(91)) })) }).reason, "Another wallet.", "a claim into another wallet's account of the coin");
  assert.equal(checkEntry({ ...ok, wire: tx(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 }), deposit("100000000")) }).reason, "Unexpected program.", "a priority fee the engine never adds");
  assert.equal(checkEntry({ ...ok, wire: tx(createAssociatedTokenAccountIdempotentInstruction(WALLET, seeded(92), OTHER, USDC), deposit("100000000")) }).reason, "Unexpected account.", "an account for a stranger at the wallet's cost");
});

/* ---------------------------------------------------------------- the one step of each moment */

const RULES = { mode: "PRO_RATA", depositStartsAt: 1_000, depositEndsAt: 4_600, maxCapRaw: "5000000000", individualCapRaw: null, vestingHours: 0, startMarketCapUsd: 50_000, supply: 1_000_000_000 };
const SCHEDULE = { depositStartsAt: 1_000, depositEndsAt: 4_600, fillStartsAt: 4_900, activatesAt: 8_500, vestingStartsAt: 8_501, vestingEndsAt: 8_501 };
const MINE = { depositedRaw: "100000000", claimableRaw: "0", claimedRaw: "0", allocatedRaw: "0", remainingQuoteRaw: "0", roomRaw: null, refunded: false };
const view = (over = {}) => ({ network: "solana:mainnet", mint: ENTRY_STUB_MINT, vault: VAULT.toBase58(), symbol: "KITE", name: "Kite", rules: RULES, schedule: SCHEDULE, creation: { state: "OPEN" }, read: "OK", depositedRaw: "3200000000", capRaw: "5000000000", filled: false, mine: MINE, ...over });

test("the window offers one step at each moment, from the schedule and the vault as read", () => {
  assert.equal(entryStep(null, 0, true).kind, "missing");
  assert.equal(entryStep(view({ creation: { state: "PARTIAL" } }), 2_000, true).kind, "broken");
  assert.equal(entryStep(view({ creation: { state: "PENDING" } }), 2_000, true).kind, "setting");
  assert.equal(entryStep(view({ read: "MISSING" }), 2_000, true).kind, "setting");
  assert.equal(entryStep(view({ read: "FAILED" }), 2_000, true).kind, "unread");
  assert.deepEqual(entryStep(view(), 500, true), { kind: "soon", opensAt: 1_000, publicAt: 8_500 });
  const join = entryStep(view(), 2_000, true);
  assert.equal(join.kind, "join");
  assert.equal(join.open, true);
  assert.equal(join.takeBack, true, "Pro Rata: a deposit can be taken back while the window is open");
  assert.equal(stepAction(join), "DEPOSIT");
  assert.equal(entryStep(view({ rules: { ...RULES, mode: "FCFS" }, depositedRaw: "5000000000" }), 2_000, true).open, false, "a first-come window that is full");
  assert.equal(entryStep(view({ mine: { ...MINE, roomRaw: "0" } }), 2_000, true).open, false, "no room left for this wallet");
  assert.equal(entryStep(view({ rules: { ...RULES, mode: "FCFS" } }), 2_000, true).takeBack, false, "a first-come deposit stays");
  assert.deepEqual(entryStep(view(), 4_700, true), { kind: "wait", publicAt: 8_500, filled: false, empty: false, mineRaw: "100000000" }, "between the window and the hour of the buy");
  assert.deepEqual(entryStep(view(), 5_000, true), { kind: "fill", publicAt: 8_500, mineRaw: "100000000", depositedRaw: "3200000000" }, "the buy of what the window shows deposited");
  assert.equal(stepAction(entryStep(view(), 5_000, true)), "FILL");
  assert.deepEqual(entryStep(view({ filled: true }), 5_000, true), { kind: "wait", publicAt: 8_500, filled: true, empty: false, mineRaw: "100000000" });
  assert.equal(entryStep(view({ depositedRaw: "0" }), 5_000, true).empty, true, "nothing to buy with");
  assert.deepEqual(entryStep(view({ filled: true, mine: { ...MINE, claimableRaw: "5" } }), 9_000, true), { kind: "claim", amountRaw: "5" });
  assert.deepEqual(entryStep(view({ filled: true, mine: { ...MINE, remainingQuoteRaw: "40000000" } }), 9_000, true), { kind: "refund", amountRaw: "40000000" });
  assert.equal(entryStep(view({ filled: true, mine: { ...MINE, remainingQuoteRaw: "40000000", refunded: true } }), 9_000, true).kind, "done");
});

test("once trading opens, a window without a wallet asks for one: only a wallet says what is its own", () => {
  const anonymous = view({ filled: true, mine: null });
  const step = entryStep(anonymous, 9_000, true);
  assert.equal(step.kind, "done");
  assert.equal(wantsWallet(step, anonymous), true);
  const known = view({ filled: true });
  assert.equal(wantsWallet(entryStep(known, 9_000, true), known), false, "a wallet with nothing left to take is not asked again");
  assert.equal(wantsWallet(entryStep(view(), 500, true), view()), false, "nothing to do before the window opens");
  assert.equal(wantsWallet(entryStep(view({ mine: null }), 2_000, true), view({ mine: null })), true, "coming in needs one");
});

test("a shut door stops people coming in, never a way back to their own tokens and USDC", () => {
  const join = entryStep(view(), 2_000, false);
  assert.equal(join.open, false);
  assert.equal(stepAction(join), null);
  assert.equal(join.takeBack, true, "the deposit back stays");
  assert.equal(stepAction(entryStep(view(), 5_000, false)), "FILL", "the buy for everyone stays");
  assert.equal(stepAction(entryStep(view({ filled: true, mine: { ...MINE, claimableRaw: "5" } }), 9_000, false)), "CLAIM");
  assert.equal(stepAction(entryStep(view({ filled: true, mine: { ...MINE, remainingQuoteRaw: "1" } }), 9_000, false)), "WITHDRAW_REMAINING");
});

test("«Ryntra takes nothing» is said from the launch's terms, never assumed (review 8.11)", async () => {
  const { ENTRY } = await import("../../components/launch/words.ts");
  const terms = (ryntraShareBps) => view({ terms: { startPriceUsd: 0.00005, presaleBps: 1_000, ryntraShareBps } });
  assert.equal(ryntraShare(terms(0)), 0);
  assert.equal(ryntraShare(terms(250)), 250);
  for (const unread of [view(), null, undefined, terms(-1), terms(1.5), terms("0"), terms(20_000)]) assert.equal(ryntraShare(unread), null);
  assert.match(ENTRY.en.fee(ryntraShare(terms(0))), /^Ryntra takes nothing here\. /);
  assert.match(ENTRY.uk.fee(ryntraShare(terms(0))), /^Ryntra тут нічого не бере\. /);
  assert.match(ENTRY.en.fee(ryntraShare(terms(250))), /^Ryntra takes 2\.5% here\. /, "a share the terms name is said as it is");
  assert.match(ENTRY.uk.fee(50), /^Ryntra тут бере 0\.5%\. /);
  for (const lang of ["en", "uk"]) {
    const plain = ENTRY[lang].fee(ryntraShare(view()));
    assert.doesNotMatch(plain, /Ryntra/, `${lang}: terms not read, nothing said of Ryntra's share`);
    assert.match(plain, /Solana/, "the rent is still said");
  }
});

test("a launch Ryntra took down: no window for anyone, only the way back for a wallet with its own money in it (review 8.11)", async () => {
  /* The engine answers a takedown with 404 for everyone else, and with no room to bring more for a depositor. */
  assert.equal(entryStep(null, 2_000, true).kind, "missing");
  const engine = httpEntryEngine(async () => new Response(JSON.stringify({ error: { code: "LAUNCH_NOT_FOUND", message: "No early-access launch of this token here." } }), { status: 404 }));
  const answer = await engine.view(ENTRY_STUB_MINT, null);
  assert.equal(answer.ok, false);
  const depositor = view({ mine: { ...MINE, roomRaw: "0" } });
  const join = entryStep(depositor, 2_000, true);
  assert.deepEqual([join.kind, join.open, join.takeBack, stepAction(join)], ["join", false, true, null], "nothing more comes in; the deposit back stays");
  assert.equal(stepAction(entryStep(view({ filled: true, mine: { ...MINE, roomRaw: "0", claimableRaw: "5" } }), 9_000, true)), "CLAIM");
  assert.equal(stepAction(entryStep(view({ filled: true, mine: { ...MINE, roomRaw: "0", remainingQuoteRaw: "1" } }), 9_000, true)), "WITHDRAW_REMAINING");
});

test("amounts as typed become raw USDC, and the link carries the coin alone", () => {
  assert.equal(usdcRaw("100"), "100000000");
  assert.equal(usdcRaw("2.5"), "2500000");
  assert.equal(usdcRaw("1,000"), "1000000000");
  assert.equal(usdcRaw("$0.000001"), "1");
  assert.equal(usdcRaw("0"), null);
  assert.equal(usdcRaw("1.0000001"), null);
  assert.equal(usdcRaw("abc"), null);
  assert.equal(units("1234500000"), 1234.5);
  const join = entryStep(view({ mine: { ...MINE, roomRaw: "50000000" } }), 2_000, true);
  assert.equal(amountProblem(usdcRaw("60"), join), "room");
  assert.equal(amountProblem(usdcRaw("50"), join), null);
  assert.equal(amountProblem(null, join), "none");
  assert.equal(earlyLink("https://ryntra.io/", ENTRY_STUB_MINT), `https://ryntra.io/?early=${ENTRY_STUB_MINT}`);
  assert.equal(earlyFrom(`?early=${ENTRY_STUB_MINT}&x=1`), ENTRY_STUB_MINT);
  assert.equal(earlyFrom("?early=../../etc"), null);
});

test("the window's routes are the engine's own, and a coin that is not an address is never put in a path", async () => {
  const asked = [];
  const engine = httpEntryEngine(async (path, init) => (asked.push([path, init?.method ?? "GET", init?.body ? JSON.parse(init.body) : null]), new Response(JSON.stringify({}), { status: 200 })));
  await engine.view(ENTRY_STUB_MINT, WALLET.toBase58());
  await engine.depositBuild(ENTRY_STUB_MINT, { wallet: WALLET.toBase58(), amountRaw: "1" });
  await engine.actionBuild(ENTRY_STUB_MINT, { wallet: WALLET.toBase58(), action: "CLAIM" });
  assert.equal((await engine.view("../x", null)).ok, false);
  assert.deepEqual(asked.map(([path, method]) => `${method} ${path}`), [
    `GET /api/v1/launch/${ENTRY_STUB_MINT}/early-access?wallet=${WALLET.toBase58()}`,
    `POST /api/v1/launch/${ENTRY_STUB_MINT}/early-access/deposit/build`,
    `POST /api/v1/launch/${ENTRY_STUB_MINT}/early-access/action/build`,
  ]);
  LaunchEarlyAccessDepositBuildRequestSchema.parse(asked[1][2]);
  LaunchEarlyAccessActionBuildRequestSchema.parse(asked[2][2]);
});

/* ---------------------------------------------------------------- each step through the flow */

const STUB_WALLET = seeded(84).toBase58();
const signerOf = (log = []) => ({ wallet: "Phantom", address: STUB_WALLET, sign: async (wires) => (log.push(wires.length), { ok: true, signed: wires }) });

async function stepOn(phase, overrides = {}) {
  const engine = overrides.engine ?? stubEntryEngine({ phase });
  const seen = await engine.view(ENTRY_STUB_MINT, STUB_WALLET);
  const step = entryStep(seen.data, Math.floor(Date.now() / 1000), overrides.door ?? true);
  const phases = [];
  const result = await runEntry({ engine, signer: overrides.signer ?? signerOf(), network: "solana:devnet", mint: ENTRY_STUB_MINT, vault: seen.data.vault, step, amountRaw: overrides.amountRaw ?? "100000000", takeBack: overrides.takeBack, onPhase: (p) => phases.push(p) });
  const after = (await engine.view(ENTRY_STUB_MINT, STUB_WALLET)).data;
  return { result, phases: phases.map((p) => p.step), after, step };
}

test("each step on the stand: come in, take it back, buy for everyone, take the tokens, take back the rest", async () => {
  const join = await stepOn("join");
  assert.equal(join.result.step, "done", join.result.message);
  assert.deepEqual(join.phases, ["build", "sign", "send", "done"]);
  assert.equal(join.after.mine.depositedRaw, "100000000");
  assert.equal(join.after.depositedRaw, "3300000000");

  const engine = stubEntryEngine({ phase: "join" });
  await stepOn("join", { engine });
  const back = await stepOn("join", { engine, takeBack: true });
  assert.equal(back.result.kind, "WITHDRAW");
  assert.equal(back.after.mine.depositedRaw, "0");

  const fill = await stepOn("fill");
  assert.equal(fill.result.kind, "FILL");
  assert.equal(fill.after.filled, true);

  const claim = await stepOn("claim");
  assert.equal(claim.result.kind, "CLAIM");
  assert.equal(claim.after.mine.claimableRaw, "0");

  const refund = await stepOn("refund");
  assert.equal(refund.result.kind, "WITHDRAW_REMAINING");
  assert.equal(refund.after.mine.remainingQuoteRaw, "0");
});

test("a coming-in through a shut door is not built; the way back is", async () => {
  const shut = await stepOn("join", { door: false });
  assert.equal(shut.result.code, CITY_CLOSED);
  assert.deepEqual(shut.phases, ["failed"]);
  const claim = await stepOn("claim", { door: false });
  assert.equal(claim.result.step, "done");
});

test("bytes for another vault, wallet or amount never open the wallet; a wallet that signs nothing sends nothing", async () => {
  for (const [why, mutate] of [
    ["another amount", (data) => ({ ...data, amountRaw: data.amountRaw })],
    ["another network", (data) => ({ ...data, network: "solana:mainnet" })],
  ]) {
    const stub = stubEntryEngine({ phase: "join" });
    const opened = [];
    const engine = {
      ...stub,
      depositBuild: async (mint, body) => {
        const built = await stub.depositBuild(mint, why === "another amount" ? { ...body, amountRaw: "100000001" } : body);
        return built.ok ? { ok: true, data: mutate(built.data) } : built;
      },
    };
    const { result } = await stepOn("join", { engine, signer: signerOf(opened) });
    assert.equal(result.code, BUILD_UNEXPECTED, why);
    assert.deepEqual(opened, [], `${why}: the wallet was never opened`);
  }
  const declined = await stepOn("join", { signer: { wallet: "Phantom", address: STUB_WALLET, sign: async () => ({ ok: false, reason: "User rejected the request." }) } });
  assert.equal(declined.result.code, WALLET_REFUSED);
  assert.equal(declined.after.mine.depositedRaw, "0", "nothing sent");
  const empty = await stepOn("join", { signer: { wallet: "Phantom", address: STUB_WALLET, sign: async () => ({ ok: true, signed: [] }) } });
  assert.equal(empty.result.code, WALLET_REFUSED);
});

test("a buy for everyone that would spend more than the window showed never opens the wallet (review 8.11)", async () => {
  const stub = stubEntryEngine({ phase: "fill" });
  const opened = [];
  /* The window read less in the vault than the bytes the engine built would spend. */
  const engine = { ...stub, view: async (mint, wallet) => {
    const seen = await stub.view(mint, wallet);
    return seen.ok ? { ok: true, data: { ...seen.data, depositedRaw: (BigInt(seen.data.depositedRaw) - 1n).toString() } } : seen;
  } };
  const { result, step } = await stepOn("fill", { engine, signer: signerOf(opened) });
  assert.equal(step.kind, "fill");
  assert.equal(result.code, BUILD_UNEXPECTED);
  assert.deepEqual(opened, [], "the wallet was never opened");
});

test("what the flow sends is what the contract takes", async () => {
  const stub = stubEntryEngine({ phase: "join" });
  const sent = [];
  const engine = { ...stub, depositSubmit: async (mint, body) => (sent.push(body), stub.depositSubmit(mint, body)) };
  await stepOn("join", { engine });
  assert.equal(sent.length, 1);
  LaunchEarlyAccessDepositSubmitRequestSchema.parse(sent[0]);
});
