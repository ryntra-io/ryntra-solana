// Run from repo root: node --test lib/phoenix/collateral.test.mjs
//
// B6 — USDC collateral on Phoenix from the person's wallet: the gate, the amounts, the margin as Phoenix serves it, what
// a built transaction may call (on the SDK's own instructions, taken 20.10 from `@ellipsis-labs/rise` 0.6.2), the
// ticket, and the Review and the relay against a chain that answers from the test.
import assert from "node:assert/strict";
import { createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { loadedDataLimit, reviewCollateral, setLoadedAccountsDataSizeLimit, submitCollateral, tokenAmountOf, TOKEN_ACCOUNT_RENT_LAMPORTS } from "./collateral-actions.ts";
import { collateralReviewHandler, collateralSubmitHandler } from "./collateral-routes.ts";
import {
  admitCollateral,
  CANARY_MAX_USD,
  checkSigned,
  collateralCallsOnly,
  collateralDigest,
  dollarsFromMicro,
  EMBER_STATE,
  issueTicket,
  marginFrom,
  marginWire,
  microFromDollars,
  ownAta,
  parseCollateralRequest,
  PHOENIX_PROGRAM,
  PHOENIX_USD_MINT,
  readTicket,
  traderAccountOf,
  TICKET_TTL_MS,
  USDC_MINT,
  usdcMovedOf,
  web3Instruction,
} from "./collateral.ts";
import { liquidationDistancePercent, liquidationRoomPercent, v1AdditionsAllowed } from "./collateral.ts";
import { buildV1Wire, readV1, V1_PREFIX } from "../solana/v1-tx.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/collateral-instructions.json", import.meta.url), "utf8"));
const VIEW = JSON.parse(readFileSync(new URL("./fixtures/trader-view.json", import.meta.url), "utf8"));
const OWNER = Keypair.fromSeed(new Uint8Array(32).fill(7));
const OWNER_ADDRESS = OWNER.publicKey.toBase58();
const STRANGER = Keypair.generate();
const KEY = "a-test-key-that-is-long-enough";
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const AMOUNT = 2_500_000n;

const open = { RYNTRA_PHOENIX_COLLATERAL: "OPEN", BETA_TOKEN_SECRET: KEY };
const canary = { RYNTRA_PHOENIX_COLLATERAL: "CANARY", RYNTRA_PHOENIX_CANARY_WALLET: OWNER_ADDRESS, BETA_TOKEN_SECRET: KEY };

const kit = (rows) => rows.map((row) => ({ programAddress: row.programAddress, accounts: row.accounts, data: Uint8Array.from(Buffer.from(row.data, "hex")) }));
const built = (action) => kit(FIXTURE[action]).map(web3Instruction);
const txOf = (instructions, payer = OWNER.publicKey) => new Transaction({ feePayer: payer, blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 }).add(...instructions);
const request = (action, amountMicro = AMOUNT) => ({ action, owner: OWNER_ADDRESS, amountMicro });

test("the fixture is the SDK pinned in package.json, built for the test wallet", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies["@ellipsis-labs/rise"], "0.6.2", "an exact version: the SDK is 0.x and breaks often (B7a §10)");
  assert.equal(FIXTURE.sdk, "@ellipsis-labs/rise@0.6.2");
  assert.equal(FIXTURE.owner, OWNER_ADDRESS);
  assert.equal(FIXTURE.amount, AMOUNT.toString());
});

/* ------------------------------------------------------------------ gate */

test("the gate: closed unless set; a canary admits one wallet character for character, each move up to its ceiling; open admits all", () => {
  assert.deepEqual(admitCollateral(OWNER_ADDRESS, {}), { ok: false, code: "ACTIONS_CLOSED" });
  assert.deepEqual(admitCollateral(OWNER_ADDRESS, { RYNTRA_PHOENIX_COLLATERAL: "yes" }), { ok: false, code: "ACTIONS_CLOSED" });
  assert.deepEqual(admitCollateral(OWNER_ADDRESS, canary), { ok: true, mode: "CANARY", maxMicro: BigInt(CANARY_MAX_USD) * 1_000_000n });
  assert.deepEqual(admitCollateral(STRANGER.publicKey.toBase58(), canary), { ok: false, code: "ACTIONS_CLOSED" });
  assert.deepEqual(admitCollateral(OWNER_ADDRESS.toLowerCase(), canary), { ok: false, code: "ACTIONS_CLOSED" });
  assert.deepEqual(admitCollateral(OWNER_ADDRESS, { RYNTRA_PHOENIX_COLLATERAL: "CANARY" }), { ok: false, code: "ACTIONS_CLOSED" }, "a canary with no wallet admits nobody");
  assert.deepEqual(admitCollateral(null, { RYNTRA_PHOENIX_COLLATERAL: " open " }), { ok: true, mode: "OPEN", maxMicro: null });
});

/* --------------------------------------------------------------- amounts */

test("amounts: dollars as typed become micro-dollars; a request is one dollar and up, digits only", () => {
  assert.equal(microFromDollars("12.5"), 12_500_000n);
  assert.equal(microFromDollars("12,50"), 12_500_000n);
  assert.equal(microFromDollars(" 1 000 "), 1_000_000_000n);
  assert.equal(microFromDollars("0.000001"), 1n);
  for (const bad of ["", "-1", "1e3", "1.2.3", "1.0000001", "abc"]) assert.equal(microFromDollars(bad), null, bad);
  assert.equal(dollarsFromMicro(12_500_000n), "12.5");
  assert.equal(dollarsFromMicro(12_345_678n), "12.34", "down to the cent, never up");
  assert.equal(dollarsFromMicro(3_000_000n), "3");
  assert.deepEqual(parseCollateralRequest({ action: "deposit", owner: OWNER_ADDRESS, amount: "1000000" }), { action: "deposit", owner: OWNER_ADDRESS, amountMicro: 1_000_000n });
  assert.equal(parseCollateralRequest({ action: "deposit", owner: OWNER_ADDRESS, amount: "999999" }), null, "under a dollar");
  assert.equal(parseCollateralRequest({ action: "deposit", owner: OWNER_ADDRESS, amount: 1_000_000 }), null, "a number, not digits");
  assert.equal(parseCollateralRequest({ action: "transfer", owner: OWNER_ADDRESS, amount: "1000000" }), null);
  assert.equal(parseCollateralRequest({ action: "withdraw", owner: "not-a-wallet", amount: "1000000" }), null);
});

/* ---------------------------------------------------------------- margin */

test("the margin as Phoenix serves it: amounts in dollars, what may be withdrawn in micro-dollars, the risk and what the account may do", () => {
  const empty = marginFrom(VIEW);
  assert.equal(empty.collateralUsd, 0);
  assert.equal(empty.withdrawableMicro, 0n);
  assert.equal(empty.riskTier, "safe");
  assert.equal(empty.canDeposit, true);
  assert.equal(empty.canWithdraw, true);
  const amount = (value) => ({ value, decimals: 6, ui: String(value / 1e6) });
  const live = marginFrom({
    ...VIEW,
    collateralBalance: amount(120_000_000),
    portfolioValue: amount(131_500_000),
    initialMargin: amount(40_000_000),
    maintenanceMargin: amount(20_000_000),
    withdrawableQuoteCollateral: amount(80_250_000),
    riskTier: "atRisk",
    capabilities: { ...VIEW.capabilities, withdrawCollateral: { immediate: false } },
  });
  assert.deepEqual(marginWire(live), {
    collateralUsd: 120,
    portfolioUsd: 131.5,
    initialMarginUsd: 40,
    maintenanceMarginUsd: 20,
    withdrawableMicro: "80250000",
    riskTier: "atRisk",
    canDeposit: true,
    canWithdraw: false,
    positions: [],
  });
  const unknown = marginFrom({ riskTier: "moon", withdrawableQuoteCollateral: { value: -5, decimals: 6 } });
  assert.equal(unknown.riskTier, null);
  assert.equal(unknown.withdrawableMicro, 0n, "never below zero");
  assert.equal(unknown.canDeposit, false, "a capability Phoenix did not grant is not granted");
});

test("each position's liquidation price and leverage come from Phoenix's view; a figure it did not send stays unknown (SOL-C7)", () => {
  const usd = (value, decimals = 6) => ({ value, decimals, ui: String(value / 10 ** decimals) });
  const margin = marginFrom({
    ...VIEW,
    traderSubaccountIndex: 0,
    positions: [
      /* 12.5 SOL at $186.42 on $233.03 of initial margin: 10×; Phoenix liquidates it at a mark of $112.40. */
      { symbol: "SOL", positionValue: usd(2_330_250_000), positionInitialMargin: usd(233_025_000), liquidationPrice: usd(11_240_000, 5) },
      /* A short: Phoenix's value is signed, the leverage is not. */
      { symbol: "BTC", positionValue: usd(-1_084_200_000), positionInitialMargin: usd(216_840_000), liquidationPrice: usd(139_800_000_000) },
      /* No liquidation price (zero) and no margin: nothing is made up. */
      { symbol: "ETH", positionValue: usd(400_000_000), positionInitialMargin: usd(0), liquidationPrice: usd(0) },
      { symbol: 7 },
    ],
  });
  assert.deepEqual(margin.positions, [
    { symbol: "SOL", subaccount: 0, liquidationPriceUsd: 112.4, leverage: 10 },
    { symbol: "BTC", subaccount: 0, liquidationPriceUsd: 139_800, leverage: 5 },
    { symbol: "ETH", subaccount: 0, liquidationPriceUsd: null, leverage: null },
  ]);
  assert.deepEqual(marginFrom({}).positions, [], "no positions, none made up");
});

test("how near liquidation: the account's room to its maintenance margin, and each position's price distance (SOL-C7)", () => {
  assert.equal(Math.round(liquidationRoomPercent({ portfolioUsd: 1_000, maintenanceMarginUsd: 170 })), 83);
  assert.equal(liquidationRoomPercent({ portfolioUsd: 1_000, maintenanceMarginUsd: 0 }), null, "nothing to liquidate");
  assert.equal(liquidationRoomPercent({ portfolioUsd: null, maintenanceMarginUsd: 20 }), null);
  assert.equal(liquidationRoomPercent({ portfolioUsd: 15, maintenanceMarginUsd: 20 }), 0, "past the limit");
  assert.equal(liquidationRoomPercent({ portfolioUsd: -5, maintenanceMarginUsd: 20 }), 0);
  assert.equal(liquidationDistancePercent("long", 200, 150), 25, "a long is liquidated below the mark");
  assert.equal(liquidationDistancePercent("short", 200, 260), 30, "a short above it");
  assert.equal(liquidationDistancePercent("long", 140, 150), 0, "crossed");
  assert.equal(liquidationDistancePercent("long", null, 150), null);
  assert.equal(liquidationDistancePercent("short", 200, null), null);
});

test("the trader account is PDA index 0, subaccount 0 — the one the SDK's deposit pays into", () => {
  const depositFunds = FIXTURE.deposit.find((row) => row.programAddress === PHOENIX_PROGRAM);
  assert.ok(depositFunds.accounts.some((account) => account.address === traderAccountOf(OWNER_ADDRESS)));
});

/* ------------------------------------------------- what a build may call */

test("the SDK's own deposit and withdrawal pass, for exactly the reviewed amount", () => {
  assert.deepEqual(collateralCallsOnly(txOf(built("deposit")), request("deposit")), { ok: true });
  assert.deepEqual(collateralCallsOnly(txOf(built("withdraw")), request("withdraw")), { ok: true });
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })];
  assert.deepEqual(collateralCallsOnly(txOf([...budget, ...built("deposit")]), request("deposit")), { ok: true });
});

test("anything that is not the action is refused before Review shows it", () => {
  assert.equal(collateralCallsOnly(txOf(built("deposit")), request("deposit", AMOUNT + 1n)).ok, false, "another amount");
  assert.equal(collateralCallsOnly(txOf(built("deposit")), request("withdraw")).ok, false, "a deposit is not a withdrawal");
  assert.equal(collateralCallsOnly(txOf(built("withdraw")), request("deposit")).ok, false, "an approval has no place in a deposit");
  assert.equal(collateralCallsOnly(txOf(built("deposit"), STRANGER.publicKey), request("deposit")).ok, false, "paid by someone else");
  const transfer = SystemProgram.transfer({ fromPubkey: OWNER.publicKey, toPubkey: STRANGER.publicKey, lamports: 1 });
  assert.equal(collateralCallsOnly(txOf([...built("deposit"), transfer]), request("deposit")).ok, false, "a transfer to anyone");
  /* The approval to another delegate: Ember's state is the only one allowed. */
  const withdraw = built("withdraw");
  const approve = withdraw.find((ix) => ix.programId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  approve.keys[1] = { ...approve.keys[1], pubkey: STRANGER.publicKey };
  assert.equal(collateralCallsOnly(txOf(withdraw), request("withdraw")).ok, false, "an approval to a stranger");
  /* The USDC of a withdrawal lands in another account than the wallet's own: refused, whatever the SDK or the API said. */
  const elsewhere = built("withdraw");
  const ember = elsewhere.find((ix) => ix.programId.toBase58() === "EMBERpYNE6ehWmXymZZS2skiFmCa9V5dp14e1iduM5qy");
  ember.keys[4] = { ...ember.keys[4], pubkey: new PublicKey(ownAta(STRANGER.publicKey.toBase58(), USDC_MINT)) };
  assert.equal(collateralCallsOnly(txOf(elsewhere), request("withdraw")).ok, false, "USDC to a stranger's account");
  /* A deposit into someone else's trader account. */
  const theirs = built("deposit");
  const funds = theirs.find((ix) => ix.programId.toBase58() === PHOENIX_PROGRAM);
  funds.keys[5] = { ...funds.keys[5], pubkey: new PublicKey(traderAccountOf(STRANGER.publicKey.toBase58())) };
  assert.equal(collateralCallsOnly(txOf(theirs), request("deposit")).ok, false, "collateral into a stranger's account");
  /* A step twice: a second withdrawal behind the first. */
  const twice = built("withdraw");
  const second = twice.find((ix) => ix.programId.toBase58() === PHOENIX_PROGRAM);
  assert.equal(collateralCallsOnly(txOf([...twice, second]), request("withdraw")).ok, false, "a repeated step");
  /* A step missing: the money would go nowhere Review says. */
  assert.equal(collateralCallsOnly(txOf(built("deposit").filter((ix) => ix.programId.toBase58() !== PHOENIX_PROGRAM)), request("deposit")).ok, false);
  /* A second signer the wallet did not choose. */
  const foreign = new TransactionInstruction({ programId: new PublicKey(PHOENIX_PROGRAM), keys: [{ pubkey: STRANGER.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(FIXTURE.deposit[2].data, "hex") });
  assert.equal(collateralCallsOnly(txOf([...built("deposit").slice(0, 2), foreign]), request("deposit")).ok, false);
});

/* ---------------------------------------------------------------- ticket */

test("a ticket is read back only with the key that sealed it, whole, in time, and not as a pool's", () => {
  const sample = { owner: OWNER_ADDRESS, action: "deposit", amount: "2500000", messages: ["a".repeat(64)] };
  const sealed = issueTicket(sample, open, 1_000);
  const read = readTicket(sealed, open, 2_000);
  assert.equal(read.ok, true);
  assert.equal(read.ticket.expiresAt, 1_000 + TICKET_TTL_MS);
  assert.deepEqual(readTicket(sealed, open, 1_000 + TICKET_TTL_MS + 1), { ok: false, code: "TICKET_EXPIRED" });
  assert.deepEqual(readTicket(sealed, { BETA_TOKEN_SECRET: "another-key-long-enough" }, 2_000), { ok: false, code: "TICKET_INVALID" });
  const [payload, mac] = sealed.split(".");
  const doctored = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), amount: "250000000" })).toString("base64url");
  assert.deepEqual(readTicket(`${doctored}.${mac}`, open, 2_000), { ok: false, code: "TICKET_INVALID" });
  assert.equal(issueTicket(sample, { BETA_TOKEN_SECRET: "short" }), null, "no key, no ticket");
});

test("the relay takes the wallet's bytes only as Review sealed them, and every signature real", () => {
  const tx = txOf(built("deposit"));
  const ticket = readTicket(issueTicket({ owner: OWNER_ADDRESS, action: "deposit", amount: "2500000", messages: [collateralDigest(tx)] }, open), open).ticket;
  const signed = txOf(built("deposit"));
  signed.sign(OWNER);
  const wire = signed.serialize().toString("base64");
  const ok = checkSigned(ticket, [wire]);
  assert.equal(ok.ok, true);
  assert.equal(ok.wire, wire);
  /* A wallet's priority setting under the ceiling is the wallet's to add. */
  const priced = txOf([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ...built("deposit")]);
  priced.sign(OWNER);
  assert.equal(checkSigned(ticket, [priced.serialize().toString("base64")]).ok, true);
  /* Another amount, another wallet, no signature, two transactions: refused. */
  const other = txOf(built("withdraw"));
  other.sign(OWNER);
  assert.deepEqual(checkSigned(ticket, [other.serialize().toString("base64")]), { ok: false, code: "SIGNED_MISMATCH" });
  const unsigned = txOf(built("deposit")).serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  assert.deepEqual(checkSigned(ticket, [unsigned]), { ok: false, code: "NOT_SIGNED" });
  const forged = Buffer.from(wire, "base64");
  forged[10] ^= 0xff;
  assert.deepEqual(checkSigned(ticket, [forged.toString("base64")]), { ok: false, code: "NOT_SIGNED" });
  assert.deepEqual(checkSigned(ticket, [wire, wire]), { ok: false, code: "SIGNED_MISMATCH" });
});

/* --------------------------------------------------------- review, relay */

const tokenAccount = (amount) => {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(amount, 64);
  return data;
};

/** A chain that answers from the test: the wallet's two token accounts, a blockhash, and a simulation's USDC after. */
function chain({ usdc = 10_000_000n, phoenixUsdOpen = true, usdcOpen = true, usdcAfter = null, phoenixUsdAfter = 0n, simulationError = null, send = "ok", seen = true, record = null } = {}) {
  const calls = { sent: 0, simulated: 0 };
  const connection = {
    async getMultipleAccountsInfo(keys) {
      assert.equal(keys[0].toBase58(), ownAta(OWNER_ADDRESS, USDC_MINT));
      assert.equal(keys[1].toBase58(), ownAta(OWNER_ADDRESS, PHOENIX_USD_MINT));
      return [usdcOpen ? { data: tokenAccount(usdc) } : null, phoenixUsdOpen ? { data: tokenAccount(0n) } : null];
    },
    async getLatestBlockhash() {
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 1_150 };
    },
    async simulateTransaction() {
      calls.simulated += 1;
      if (simulationError) return { value: { err: simulationError, logs: ["Program log: refused"] } };
      return { value: { err: null, unitsConsumed: 90_000, accounts: [{ data: [tokenAccount(usdcAfter ?? usdc).toString("base64"), "base64"] }, { data: [tokenAccount(phoenixUsdAfter).toString("base64"), "base64"] }] } };
    },
    sendRawTransaction() {
      calls.sent += 1;
      /* "hang": the endpoint takes the bytes and never answers; an Error: the endpoint's refusal. */
      if (send === "hang") return new Promise(() => {});
      if (send instanceof Error) return Promise.reject(send);
      return Promise.resolve("sig");
    },
    async getSignatureStatuses(signatures) {
      return { value: signatures.map(() => (seen ? { confirmationStatus: "confirmed", err: null } : null)) };
    },
    async getTransaction() {
      return record;
    },
    /* The endpoint's own JSON-RPC, as the v1 path asks it (web3.js 1.98 cannot carry v1). */
    async _rpcRequest(method, args) {
      /* The chain's record, in the JSON shape the endpoint gives with v1 allowed. */
      if (method === "getTransaction") {
        assert.equal(args[1].maxSupportedTransactionVersion, 1);
        return { result: record ? { meta: record.meta, transaction: { message: { accountKeys: record.transaction.message.staticAccountKeys.map((key) => key.toBase58()) } } } : null };
      }
      assert.equal(method, "simulateTransaction");
      calls.simulated += 1;
      calls.v1Wires = [...(calls.v1Wires ?? []), args[0]];
      if (simulationError) return { result: { value: { err: simulationError, logs: ["Program log: refused"] } } };
      return { result: { value: { err: null, unitsConsumed: 90_000, loadedAccountsDataSize: 2_000_000, accounts: [{ data: [tokenAccount(usdcAfter ?? usdc).toString("base64"), "base64"] }, { data: [tokenAccount(phoenixUsdAfter).toString("base64"), "base64"] }] } } };
    },
  };
  return { connection, calls };
}

/* The chain's tip 1 000 blocks high; the bytes live to 1 150 — 150 blocks at 400 ms. */
const READER = { epochInfo: async () => ({ blockHeight: 1_000, absoluteSlot: 2_000 }), performanceSamples: async () => [{ numSlots: 100, samplePeriodSecs: 40 }] };

function deps(env, { trader = { found: true, margin: marginFrom({ ...VIEW, withdrawableQuoteCollateral: { value: 50_000_000, decimals: 6 } }) }, ...chainOptions } = {}) {
  const { connection, calls } = chain(chainOptions);
  return {
    calls,
    deps: {
      env,
      connections: [connection],
      readTrader: async () => trader,
      build: async (r) => kit(FIXTURE[r.action]).map((row) => row),
      chainReader: () => READER,
      now: () => 5_000,
      pollMs: 1,
      ...(chainOptions.relayMs ? { relayMs: chainOptions.relayMs } : {}),
      ...(chainOptions.callMs ? { callMs: chainOptions.callMs } : {}),
    },
  };
}

const ask = (action, amount = "2500000") => ({ action, owner: OWNER_ADDRESS, amount });

test("Review refuses before anything is built: a closed gate, the canary's ceiling, no account, what Phoenix does not allow now", async () => {
  assert.equal((await reviewCollateral(ask("deposit"), deps({}).deps)).code, "ACTIONS_CLOSED");
  assert.equal((await reviewCollateral(ask("deposit", "6000000"), deps(canary).deps)).code, "CANARY_LIMIT");
  assert.equal((await reviewCollateral(ask("withdraw", "6000000"), deps(canary).deps)).code, "CANARY_LIMIT", "the canary's ceiling holds for a withdrawal too");
  assert.equal((await reviewCollateral(ask("deposit"), deps(open, { trader: { found: false } }).deps)).code, "ACCOUNT_NEEDED");
  assert.equal((await reviewCollateral(ask("deposit"), deps(open, { trader: null }).deps)).code, "PHOENIX_UNAVAILABLE");
  const frozen = { found: true, margin: { ...marginFrom(VIEW), canDeposit: false, canWithdraw: false } };
  assert.equal((await reviewCollateral(ask("deposit"), deps(open, { trader: frozen }).deps)).code, "DEPOSIT_CLOSED");
  assert.equal((await reviewCollateral(ask("withdraw"), deps(open, { trader: frozen }).deps)).code, "WITHDRAW_CLOSED");
  assert.equal((await reviewCollateral(ask("withdraw", "60000000"), deps(open).deps)).code, "OVER_WITHDRAWABLE");
  assert.equal((await reviewCollateral(ask("deposit", "20000000"), deps(open).deps)).code, "INSUFFICIENT_USDC");
  assert.equal((await reviewCollateral(ask("deposit"), deps(open, { simulationError: "AccountNotFound" }).deps)).code, "NEEDS_SOL", "a wallet with no SOL for the fee");
  const refused = deps(open, { simulationError: { InstructionError: [3, { Custom: 1 }] } });
  assert.equal((await reviewCollateral(ask("withdraw"), refused.deps)).code, "SIMULATION_FAILED");
});

test("a deposit's Review: the amounts from the simulation, nothing for Ryntra, the rent of an account it opens, one sealed transaction", async () => {
  const { deps: d } = deps(open, { phoenixUsdOpen: false, usdcAfter: 10_000_000n - AMOUNT });
  const answer = await reviewCollateral(ask("deposit"), d);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const review = answer.value;
  assert.equal(review.amount, "2500000");
  assert.equal(review.receive, "2500000");
  assert.equal(review.phoenixFee, "0");
  assert.equal(review.walletUsdc, "10000000");
  assert.equal(review.rentLamports, TOKEN_ACCOUNT_RENT_LAMPORTS.toString(), "Phoenix's dollar account is opened once");
  assert.equal(review.traderAccount, traderAccountOf(OWNER_ADDRESS));
  assert.ok(Number(review.networkFeeLamports) >= 5_000);
  assert.ok(review.signableMs > 0 && review.signableMs < TICKET_TTL_MS);
  const tx = Transaction.from(Buffer.from(review.transaction.wireBase64, "base64"));
  assert.equal(tx.feePayer.toBase58(), OWNER_ADDRESS);
  assert.deepEqual(collateralCallsOnly(tx, request("deposit")), { ok: true });
  assert.equal(readTicket(review.ticket, open, 5_001).ticket.messages[0], collateralDigest(tx));
  /* Phoenix's dollars left behind in the wallet's account, or taken from it: not the deposit Review describes. */
  assert.equal((await reviewCollateral(ask("deposit"), deps(open, { usdcAfter: 10_000_000n - AMOUNT, phoenixUsdAfter: 1n }).deps)).code, "BUILD_REFUSED");
  /* A simulation that moves another amount is not the deposit the person asked for. */
  const off = await reviewCollateral(ask("deposit"), deps(open, { usdcAfter: 10_000_000n - AMOUNT + 1n }).deps);
  assert.equal(off.code, "BUILD_REFUSED");
});

test("a withdrawal's Review: what reaches the wallet is the simulation's, and what Phoenix keeps is its own line", async () => {
  const { deps: d } = deps(open, { usdc: 1_000_000n, usdcAfter: 1_000_000n + AMOUNT - 10_000n });
  const answer = await reviewCollateral(ask("withdraw"), d);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.value.receive, (AMOUNT - 10_000n).toString());
  assert.equal(answer.value.phoenixFee, "10000");
  assert.equal(answer.value.rentLamports, "0");
  assert.equal(answer.value.freeAfter, (50_000_000n - AMOUNT).toString(), "what stays free after it, by Phoenix's figure");
  const deposit = await reviewCollateral(ask("deposit"), deps(open, { usdcAfter: 10_000_000n - AMOUNT }).deps);
  assert.equal(deposit.value.freeAfter, null, "a deposit has no «free after» line");
});

test("the relay sends the signed bytes once and reads the chain; a stranger's ticket or a closed gate sends nothing", async () => {
  const { deps: d, calls } = deps(open, { usdcAfter: 10_000_000n - AMOUNT });
  const review = (await reviewCollateral(ask("deposit"), d)).value;
  const tx = Transaction.from(Buffer.from(review.transaction.wireBase64, "base64"));
  tx.sign(OWNER);
  const relayed = await submitCollateral({ ticket: review.ticket, signed: [tx.serialize().toString("base64")] }, d);
  assert.equal(relayed.ok, true, JSON.stringify(relayed));
  assert.equal(relayed.value.settled, true);
  assert.equal(relayed.value.results[0].state, "LANDED");
  assert.equal(calls.sent, 1);
  const closed = await submitCollateral({ ticket: review.ticket, signed: [tx.serialize().toString("base64")] }, { ...d, env: { BETA_TOKEN_SECRET: KEY } });
  assert.equal(closed.code, "ACTIONS_CLOSED");
  const bad = await submitCollateral({ ticket: "x.y", signed: [] }, d);
  assert.equal(bad.code, "TICKET_INVALID");
  assert.equal(calls.sent, 1, "nothing more was sent");
});

/** A signed deposit and its ticket from a real Review under `env`. */
async function signedDeposit(env = open, options = {}) {
  const made = deps(env, { usdcAfter: 10_000_000n - AMOUNT, ...options });
  const review = (await reviewCollateral(ask("deposit"), made.deps)).value;
  const tx = Transaction.from(Buffer.from(review.transaction.wireBase64, "base64"));
  tx.sign(OWNER);
  return { ...made, review, body: { ticket: review.ticket, signed: [tx.serialize().toString("base64")] } };
}

test("the gate is asked again at the relay: a canary's ceiling below the sealed amount, or a canary of another wallet, sends nothing", async () => {
  /* OPEN at the Review, CANARY at the relay: a ticket sealed for 6 USDC is over the canary's 5 — a withdrawal as much as a deposit. */
  const { deps: d, calls, body } = await signedDeposit();
  const tx = Transaction.from(Buffer.from(body.signed[0], "base64"));
  for (const action of ["deposit", "withdraw"]) {
    const sealed = issueTicket({ owner: OWNER_ADDRESS, action, amount: "6000000", messages: [collateralDigest(tx)] }, open, 5_000);
    const over = await submitCollateral({ ticket: sealed, signed: body.signed }, { ...d, env: canary });
    assert.deepEqual([over.status, over.code], [403, "CANARY_LIMIT"], action);
  }
  /* A stranger's ticket while the canary names another wallet: the same answer as a closed gate. */
  const strangers = issueTicket({ owner: STRANGER.publicKey.toBase58(), action: "deposit", amount: "2500000", messages: [collateralDigest(tx)] }, open, 5_000);
  assert.equal((await submitCollateral({ ticket: strangers, signed: body.signed }, { ...d, env: canary })).code, "ACTIONS_CLOSED");
  /* The Review's own wallet, OPEN at the Review and a canary of someone else at the relay. */
  const narrowed = { ...canary, RYNTRA_PHOENIX_CANARY_WALLET: STRANGER.publicKey.toBase58() };
  assert.equal((await submitCollateral(body, { ...d, env: narrowed })).code, "ACTIONS_CLOSED");
  assert.equal(calls.sent, 0, "nothing was sent");
  /* Within the ceiling the canary's own wallet goes through. */
  const within = await submitCollateral(body, { ...d, env: canary });
  assert.equal(within.ok, true, JSON.stringify(within));
  assert.equal(calls.sent, 1);
});

test("an endpoint that never answers the send: one send, then the chain's word — UNKNOWN, never a second send", async () => {
  const { deps: d, calls, body } = await signedDeposit(open, { send: "hang", seen: false, relayMs: 40 });
  const relayed = await submitCollateral(body, d);
  assert.equal(relayed.ok, true, JSON.stringify(relayed));
  assert.equal(relayed.value.results[0].state, "UNKNOWN");
  assert.equal(relayed.value.settled, false);
  assert.equal("usdcMoved" in relayed.value.results[0], false, "nothing is claimed about the money until it landed");
  assert.equal(calls.sent, 1, "exactly one send");
  /* The send's answer is lost but the bytes landed: the chain is read after the timeout, still with one send. */
  const late = await signedDeposit(open, { send: "hang", seen: true, callMs: 20, relayMs: 2_000 });
  const read = await submitCollateral(late.body, late.deps);
  assert.equal(read.value.results[0].state, "LANDED");
  assert.equal(late.calls.sent, 1, "read from the chain, never sent again");
});

test("a preflight refusal is the network's no before sending: RELAY_REFUSED; an expired blockhash asks for a new Review", async () => {
  const refused = await signedDeposit(open, { send: new Error("failed to send transaction: Transaction simulation failed: Error processing Instruction 3: custom program error: 0x1") });
  const answer = await submitCollateral(refused.body, refused.deps);
  assert.deepEqual([answer.ok, answer.status, answer.code], [false, 422, "RELAY_REFUSED"]);
  assert.equal(refused.calls.sent, 1);
  const aged = await signedDeposit(open, { send: new Error("Transaction simulation failed: Blockhash not found") });
  assert.equal((await submitCollateral(aged.body, aged.deps)).code, "TICKET_EXPIRED");
  /* Already processed is not a refusal: the chain is read. */
  const twice = await signedDeposit(open, { send: new Error("Transaction simulation failed: This transaction has already been processed") });
  assert.equal((await submitCollateral(twice.body, twice.deps)).value.results[0].state, "LANDED");
});

test("a landed relay states the USDC the chain moved, not the Review's figure", async () => {
  /* A withdrawal whose fee at landing was not the simulation's: the receipt's figure is the chain's 2.48, not the Review's 2.49. */
  const arrived = {
    transaction: { message: { staticAccountKeys: [OWNER.publicKey] } },
    meta: { preTokenBalances: [{ mint: USDC_MINT, owner: OWNER_ADDRESS, uiTokenAmount: { amount: "1000000" } }], postTokenBalances: [{ mint: USDC_MINT, owner: OWNER_ADDRESS, uiTokenAmount: { amount: "3480000" } }] },
  };
  const made = deps(open, { usdc: 1_000_000n, usdcAfter: 1_000_000n + AMOUNT - 10_000n, record: arrived });
  const review = (await reviewCollateral(ask("withdraw"), made.deps)).value;
  assert.equal(review.receive, "2490000");
  const signed = Transaction.from(Buffer.from(review.transaction.wireBase64, "base64"));
  signed.sign(OWNER);
  const withdrawn = await submitCollateral({ ticket: review.ticket, signed: [signed.serialize().toString("base64")] }, made.deps);
  assert.equal(withdrawn.value.results[0].usdcMoved, "2480000");
  const balance = (amount, owner = OWNER_ADDRESS, mint = USDC_MINT) => ({ accountIndex: 1, mint, owner, uiTokenAmount: { amount: String(amount) } });
  const record = {
    transaction: { message: { staticAccountKeys: [OWNER.publicKey] } },
    meta: { preTokenBalances: [balance(10_000_000), balance(0, OWNER_ADDRESS, PHOENIX_USD_MINT)], postTokenBalances: [balance(10_000_000n - AMOUNT), balance(0, OWNER_ADDRESS, PHOENIX_USD_MINT)] },
  };
  const { deps: d, body } = await signedDeposit(open, { record });
  const relayed = await submitCollateral(body, d);
  assert.equal(relayed.value.results[0].usdcMoved, (-AMOUNT).toString());
  const unread = await signedDeposit(open, { record: null });
  assert.equal((await submitCollateral(unread.body, unread.deps)).value.results[0].usdcMoved, null, "the chain did not show it: no figure");
});

test("what the chain moved: the owner's USDC after less before; an account opened counts from zero; anything unplain says nothing", () => {
  const b = (amount, owner = OWNER_ADDRESS, mint = USDC_MINT) => ({ mint, owner, uiTokenAmount: { amount } });
  assert.equal(usdcMovedOf({ preTokenBalances: [b("10000000")], postTokenBalances: [b("7500000")] }, OWNER_ADDRESS), -2_500_000n);
  assert.equal(usdcMovedOf({ preTokenBalances: [], postTokenBalances: [b("2490000")] }, OWNER_ADDRESS), 2_490_000n, "a withdrawal that opened the USDC account");
  assert.equal(usdcMovedOf({ preTokenBalances: [b("5", STRANGER.publicKey.toBase58())], postTokenBalances: [b("9", STRANGER.publicKey.toBase58())] }, OWNER_ADDRESS), null, "a stranger's balance is not the wallet's");
  assert.equal(usdcMovedOf({ preTokenBalances: [b("5", OWNER_ADDRESS, PHOENIX_USD_MINT)], postTokenBalances: [] }, OWNER_ADDRESS), null, "Phoenix's dollars are not USDC");
  assert.equal(usdcMovedOf({ preTokenBalances: [b("1e6")], postTokenBalances: [b("0")] }, OWNER_ADDRESS), null);
  assert.equal(usdcMovedOf({}, OWNER_ADDRESS), null);
});

test("the routes: a phone's session acting for another wallet is refused before a Review is built or a byte is sent", async () => {
  const rate = { allowed: true, limit: 60, remaining: 59, resetAfterSeconds: 60, retryAfterSeconds: 60 };
  const door = (body, mismatch) => async () => ({ ok: true, body, rate, mismatch: () => mismatch });
  const asked = { review: 0, submit: 0 };
  const review = async () => {
    asked.review += 1;
    return { ok: true, value: { ticket: "t" } };
  };
  const submit = async () => {
    asked.submit += 1;
    return { ok: true, value: { results: [], settled: false } };
  };
  const request = new Request("https://ryntra.io/api/solana/futures/collateral/review", { method: "POST" });
  const refusedReview = await collateralReviewHandler({ openDoor: door(ask("deposit"), true), review })(request);
  assert.equal(refusedReview.status, 403);
  assert.equal((await refusedReview.json()).error.code, "WALLET_MISMATCH");
  const ticket = issueTicket({ owner: OWNER_ADDRESS, action: "deposit", amount: "2500000", messages: ["a".repeat(64)] }, open);
  const refusedSubmit = await collateralSubmitHandler({ openDoor: door({ ticket, signed: [] }, true), submit, env: () => open })(request);
  assert.equal(refusedSubmit.status, 403);
  assert.equal((await refusedSubmit.json()).error.code, "WALLET_MISMATCH");
  assert.deepEqual(asked, { review: 0, submit: 0 });
  /* The session's own wallet passes through to the action. */
  assert.equal((await collateralReviewHandler({ openDoor: door(ask("deposit"), false), review })(request)).status, 200);
  assert.equal((await collateralSubmitHandler({ openDoor: door({ ticket, signed: [] }, false), submit, env: () => open })(request)).status, 200);
  assert.deepEqual(asked, { review: 1, submit: 1 });
});

test("token amounts are read from the SPL layout; no account is zero", () => {
  assert.equal(tokenAmountOf(tokenAccount(42n)), 42n);
  assert.equal(tokenAmountOf(null), 0n);
  assert.equal(tokenAmountOf(Buffer.alloc(10)), 0n);
  assert.equal(EMBER_STATE.length > 30, true);
});

test("the bytes carry an explicit loaded-data limit, as Phantom asks of a dApp: the simulation's figure with room, in 32 KiB pages", async () => {
  assert.equal(loadedDataLimit(2_000_000), Math.ceil((2_000_000 * 1.25) / 32_768) * 32_768);
  assert.equal(loadedDataLimit(undefined), 8 * 1024 * 1024, "an endpoint that does not say gets 8 MiB");
  assert.equal(loadedDataLimit(1e12), 64 * 1024 * 1024, "never above the runtime's own ceiling");
  const ix = setLoadedAccountsDataSizeLimit(7_340_032);
  assert.equal(ix.programId.toBase58(), "ComputeBudget111111111111111111111111111111");
  assert.deepEqual([...ix.data], [4, ...new Uint8Array(new Uint32Array([7_340_032]).buffer)]);
  const { deps: d } = deps(open, { usdcAfter: 10_000_000n - AMOUNT });
  const review = (await reviewCollateral(ask("deposit"), d)).value;
  const tx = Transaction.from(Buffer.from(review.transaction.wireBase64, "base64"));
  const limit = tx.instructions.find((i) => i.programId.toBase58() === "ComputeBudget111111111111111111111111111111" && i.data[0] === 4);
  assert.ok(limit, "the Review's bytes set the loaded-data limit");
  assert.equal(Buffer.from(limit.data).readUInt32LE(1), 8 * 1024 * 1024);
});

/* ------------------------------------------------------------------- v1 */

/** The wallet's signature over a v1 wire's message, put in its place at the tail — what Phantom returns. */
function signV1(wireBase64, keypair = OWNER) {
  const bytes = Buffer.from(wireBase64, "base64");
  const { messageBytes } = readV1(bytes);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.slice(0, 32))]), format: "der", type: "pkcs8" });
  const signature = edSign(null, Buffer.from(messageBytes), key);
  const signed = Buffer.from(bytes);
  Buffer.from(signature).copy(signed, signed.length - 64);
  return signed.toString("base64");
}

test("a v1 Review — the format Phantom asks for: v1 bytes, the limits in the message's config, no Compute Budget instruction", async () => {
  const { deps: d, calls } = deps(open, { usdcAfter: 10_000_000n - AMOUNT });
  const answer = await reviewCollateral({ ...ask("deposit"), format: "v1" }, d);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const bytes = Buffer.from(answer.value.transaction.wireBase64, "base64");
  assert.equal(bytes[0], V1_PREFIX, "a v1 transaction starts with its version");
  const { view, signers } = readV1(bytes);
  assert.deepEqual(signers, [OWNER_ADDRESS], "the wallet is the one signer");
  assert.equal(view.instructions.some((ix) => ix.programId === "ComputeBudget111111111111111111111111111111"), false, "on v1 the budget lives in the config");
  assert.equal(view.config.computeUnitLimit, Math.ceil(90_000 * 1.2) + 10_000);
  assert.equal(view.config.loadedAccountsDataSizeLimit, loadedDataLimit(2_000_000));
  assert.equal(view.config.priorityFeeLamports, (BigInt(view.config.computeUnitLimit) * 50_000n + 999_999n) / 1_000_000n);
  assert.equal(answer.value.networkFeeLamports, (5_000n + view.config.priorityFeeLamports).toString());
  assert.deepEqual(collateralCallsOnly(view, request("deposit")), { ok: true });
  assert.equal(readTicket(answer.value.ticket, open, 5_001).ticket.messages[0], collateralDigest(view));
  /* The draft runs at the runtime's ceilings, the final bytes at the measured limits: two v1 simulations. */
  assert.equal(calls.v1Wires.length, 2);
  assert.equal(readV1(Buffer.from(calls.v1Wires[0], "base64")).view.config.computeUnitLimit, 1_400_000);
});

test("the relay takes v1 bytes only as Review sealed them, signed by the wallet; nothing else is sent", async () => {
  const { deps: d, calls } = deps(open, { usdcAfter: 10_000_000n - AMOUNT });
  const review = (await reviewCollateral({ ...ask("deposit"), format: "v1" }, d)).value;
  const ticket = readTicket(review.ticket, open, 5_001).ticket;
  const signed = signV1(review.transaction.wireBase64);
  const ok = checkSigned(ticket, [signed]);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.wire, signed);
  assert.deepEqual(checkSigned(ticket, [review.transaction.wireBase64]), { ok: false, code: "NOT_SIGNED" }, "unsigned bytes");
  assert.deepEqual(checkSigned(ticket, [signV1(review.transaction.wireBase64, STRANGER)]), { ok: false, code: "NOT_SIGNED" }, "a stranger's signature");
  /* Other v1 bytes — a withdrawal in place of the reviewed deposit — signed by the wallet: another digest. */
  const other = buildV1Wire({ owner: OWNER_ADDRESS, instructions: kit(FIXTURE.withdraw), blockhash: BLOCKHASH, lastValidBlockHeight: 1_150, limits: { computeUnitLimit: 118_000, loadedAccountsDataSizeLimit: 2_523_136, priorityFeeLamports: 5_900n } });
  assert.deepEqual(checkSigned(ticket, [signV1(other)]), { ok: false, code: "SIGNED_MISMATCH" });
  const relayed = await submitCollateral({ ticket: review.ticket, signed: [signed] }, d);
  assert.equal(relayed.ok, true, JSON.stringify(relayed));
  assert.equal(calls.sent, 1);
});

test("a wallet may raise a v1 priority fee within the relay's cap, never beyond, and adds no signer", () => {
  const view = (config, instructions = []) => ({ format: "v1", payer: OWNER_ADDRESS, lifetime: BLOCKHASH, instructions, config: { heapSize: null, ...config } });
  assert.equal(v1AdditionsAllowed(view({ computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 4_194_304, priorityFeeLamports: 10_000n }), OWNER_ADDRESS, [OWNER_ADDRESS]), true);
  assert.equal(v1AdditionsAllowed(view({ computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 4_194_304, priorityFeeLamports: 6_000_000n }), OWNER_ADDRESS, [OWNER_ADDRESS]), false, "above the cap");
  assert.equal(v1AdditionsAllowed(view({ computeUnitLimit: 2_000_000, loadedAccountsDataSizeLimit: 4_194_304, priorityFeeLamports: 0n }), OWNER_ADDRESS, [OWNER_ADDRESS]), false, "above the runtime's units");
  assert.equal(v1AdditionsAllowed(view({ computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 4_194_304, priorityFeeLamports: 0n }), OWNER_ADDRESS, [OWNER_ADDRESS, STRANGER.publicKey.toBase58()]), false, "a second signer");
  const ok = { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 4_194_304, priorityFeeLamports: 0n };
  /* On v1 the budget lives in the config: a Compute Budget instruction — a price of its own past the cap — is refused. */
  const price = { programId: "ComputeBudget111111111111111111111111111111", keys: [], data: Buffer.from([3, 255, 255, 255, 255, 255, 255, 255, 255]) };
  assert.equal(v1AdditionsAllowed(view(ok, [price]), OWNER_ADDRESS, [OWNER_ADDRESS]), false, "a Compute Budget instruction on v1");
  assert.equal(v1AdditionsAllowed(view({ ...ok, heapSize: 262_144 }), OWNER_ADDRESS, [OWNER_ADDRESS]), false, "a heap request");
});

test("a v1 wire is read strictly: bytes slipped between the message and its signature are refused", async () => {
  const { deps: d } = deps(open, { usdcAfter: 10_000_000n - AMOUNT });
  const review = (await reviewCollateral({ ...ask("deposit"), format: "v1" }, d)).value;
  const bytes = Buffer.from(signV1(review.transaction.wireBase64), "base64");
  const padded = Buffer.concat([bytes.subarray(0, bytes.length - 64), Buffer.from([0]), bytes.subarray(bytes.length - 64)]);
  assert.throws(() => readV1(padded));
  assert.deepEqual(checkSigned(readTicket(review.ticket, open, 5_001).ticket, [padded.toString("base64")]), { ok: false, code: "SIGNED_MISMATCH" });
});

test("a request names its format: v1 or legacy, nothing else", () => {
  assert.equal(parseCollateralRequest({ ...ask("deposit"), format: "v1" }).format, "v1");
  assert.equal(parseCollateralRequest(ask("deposit")).format, undefined);
  assert.equal(parseCollateralRequest({ ...ask("deposit"), format: "v2" }), null);
});
