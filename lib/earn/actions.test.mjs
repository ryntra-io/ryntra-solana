// Run from repo root: node --test lib/earn/actions.test.mjs
//
// Earn's Review and relay, end to end over the real Jupiter Lend adapter with the provider's answers
// and the chain stood in by fixtures. No network, no key and no wallet of anybody's: the transactions are
// signed by a keypair this file generates and thrown away.
//
// The five cases the registry's row turns on are each a test here: a market with no liquidity, a withdrawal
// the market can only half pay, a rate that moved between the quote and the signature, a provider that
// refuses, and a key that was never issued. Two more are tested because they are the ways money could leak
// out of this lane: a gate that is shut, and bytes that are not the ones Review sealed.
import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { readEarnSurface, reviewEarn, submitEarn, parseEarnRequest } from "./actions.ts";
import { heldReaderFrom } from "./chain.ts";
import { jupiterLendAdapter } from "./jupiter-adapter.ts";
import { kaminoLendAdapter } from "./kamino-adapter.ts";
import {
  FIXTURE_HELD,
  JUPITER_EARNINGS,
  JUPITER_POSITIONS,
  JUPITER_TOKENS,
  JUPITER_TOKENS_LIQUIDITY_GONE,
  JUPITER_TOKENS_RATE_FELL,
  USDC_MINT,
  USDT_MINT,
  WSOL_MINT,
} from "./fixtures.ts";

const SECRET = "earn-ticket-secret-for-tests-only";
const WALLET = Keypair.generate();
const OWNER = WALLET.publicKey.toBase58();
const NOW = Date.parse("2026-10-26T10:00:00.000Z");

const held = heldReaderFrom(new Map(Object.entries(FIXTURE_HELD).map(([mint, raw]) => [mint, BigInt(raw)])), "rpc.fixture");

/**
 * One unsigned v0 transaction, standing in for the bytes Jupiter Lend would hand back.
 *
 * Its content does not matter and is deliberately boring — a one-lamport transfer to itself. What matters is
 * that it is a real versioned transaction with this wallet as the only signer, because that is what the seal
 * is computed over and what the wallet signs.
 */
function unsignedTransaction(owner = OWNER, blockhash = "11111111111111111111111111111111") {
  const payer = new PublicKey(owner);
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

function sign(unsigned, keypair = WALLET) {
  const transaction = VersionedTransaction.deserialize(Buffer.from(unsigned, "base64"));
  transaction.sign([keypair]);
  return Buffer.from(transaction.serialize()).toString("base64");
}

/**
 * Jupiter Lend, answered from fixtures.
 *
 * `tokens` may be a list or a function of the call count, which is how «the rate moved between the Review and
 * the signature» is staged: the first market read answers one thing and the second another, exactly as a live
 * market would without being asked to.
 */
function jupiterStub(options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const address = String(url);
    calls.push({ url: address, method: init?.method ?? "GET" });
    if (options.status) return new Response("no", { status: options.status });
    if (options.throws) throw new Error("socket hung up");
    if (address.includes("/earn/tokens")) {
      const tokens = typeof options.tokens === "function" ? options.tokens(calls.filter((call) => call.url.includes("/earn/tokens")).length) : (options.tokens ?? JUPITER_TOKENS);
      return Response.json(tokens);
    }
    if (address.includes("/earn/positions")) return Response.json(options.positions ?? JUPITER_POSITIONS);
    if (address.includes("/earn/earnings")) return Response.json(options.earnings ?? JUPITER_EARNINGS);
    if (address.includes("/earn/deposit") || address.includes("/earn/withdraw")) {
      return Response.json({ transaction: options.transaction ?? unsignedTransaction() });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

/** Kamino's reserves, answered from a fixture shaped like its own. */
function kaminoStub() {
  return async () =>
    Response.json({
      reserves: [
        {
          reserveAddress: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59",
          liquidityToken: USDC_MINT,
          liquidityTokenDecimals: 6,
          symbol: "USDC",
          supplyInterestAPY: 0.0375,
          price: 1,
          totalSupply: "5000000000000",
          availableAmount: "900000000000",
        },
      ],
    });
}

function deps(options = {}) {
  const stub = options.stub ?? jupiterStub();
  const sent = [];
  return {
    sent,
    calls: stub.calls,
    deps: {
      env: {
        BETA_TOKEN_SECRET: options.sealed === false ? undefined : SECRET,
        RYNTRA_EARN_ACTIONS: options.actions ?? "OPEN",
        RYNTRA_EARN_CANARY_WALLET: options.canaryWallet,
        ...options.env,
      },
      adapters: [
        jupiterLendAdapter({ key: options.key === null ? null : (options.key ?? "test-key"), readHeld: held, fetchImpl: stub.fetchImpl, now: () => NOW }),
        kaminoLendAdapter({ on: options.kamino === true, baseUrl: options.kaminoUrl ?? null, fetchImpl: kaminoStub(), now: () => NOW }),
      ],
      readHeld: held,
      handle: () => ({ /* only the send and the status read touch this, and both are stubbed */ }),
      signableWindowMs: async () => options.signableMs ?? 30_000,
      send: async ({ signedWireBase64 }) => {
        sent.push(signedWireBase64);
        if (options.sendThrows) throw new Error(options.sendThrows);
        return "signature";
      },
      now: () => NOW,
    },
  };
}

const review = (fixture, body) => reviewEarn({ provider: "jupiter", action: "deposit", owner: OWNER, market: USDC_MINT, amount: "2000000", ...body }, fixture.deps);

/* -------------------------------------------------------------- the request */

test("a body that is not a request is refused before anything is asked", () => {
  assert.equal(parseEarnRequest(null), null);
  assert.equal(parseEarnRequest({ provider: "aave", action: "deposit", owner: OWNER, market: USDC_MINT, amount: "1" }), null);
  assert.equal(parseEarnRequest({ provider: "jupiter", action: "borrow", owner: OWNER, market: USDC_MINT, amount: "1" }), null);
  assert.equal(parseEarnRequest({ provider: "jupiter", action: "deposit", owner: "nope", market: USDC_MINT, amount: "1" }), null);
  assert.equal(parseEarnRequest({ provider: "jupiter", action: "deposit", owner: OWNER, market: USDC_MINT, amount: "0" }), null);
  assert.equal(parseEarnRequest({ provider: "jupiter", action: "deposit", owner: OWNER, market: USDC_MINT, amount: "1.5" }), null);
  const parsed = parseEarnRequest({ provider: "jupiter", action: "withdraw", owner: OWNER, market: USDT_MINT, amount: "40000000" });
  assert.deepEqual(parsed, { provider: "jupiter", action: "withdraw", owner: OWNER, marketId: USDT_MINT, amount: "40000000" });
});

/* ------------------------------------------------------------- the surface */

test("without a key the page says the provider is unavailable, never an empty market list", async () => {
  const fixture = deps({ key: null });
  const surface = await readEarnSurface(OWNER, fixture.deps);
  const [jupiter, kamino] = surface.providers;
  assert.equal(jupiter.ok, false);
  assert.equal(jupiter.code, "NO_KEY");
  assert.match(jupiter.reason, /API key with Lend access/);
  assert.equal(kamino.ok, false);
  assert.equal(kamino.code, "DISABLED");
  assert.deepEqual(surface.positions, []);
  assert.equal(fixture.calls.length, 0, "a provider with no key is not called at all");
  assert.equal(surface.feeBps, 0);
});

test("a provider that refuses is drawn as refusing, and the other provider is still drawn", async () => {
  const fixture = deps({ stub: jupiterStub({ status: 500 }), kamino: true, kaminoUrl: "https://kamino.example" });
  const surface = await readEarnSurface(OWNER, fixture.deps);
  const [jupiter] = surface.providers;
  assert.equal(jupiter.ok, false);
  assert.equal(jupiter.code, "PROVIDER_DOWN");
  assert.match(jupiter.reason, /HTTP 500/);
  assert.equal(surface.providers.length, 2, "one provider's outage is not the page's outage");
});

test("a key the provider refuses reads as the key's problem", async () => {
  const fixture = deps({ stub: jupiterStub({ status: 403 }) });
  const surface = await readEarnSurface(OWNER, fixture.deps);
  assert.equal(surface.providers[0].code, "NO_KEY");
});

test("an unreachable provider is an outage rather than a market with nothing in it", async () => {
  const fixture = deps({ stub: jupiterStub({ throws: true }) });
  const surface = await readEarnSurface(OWNER, fixture.deps);
  assert.equal(surface.providers[0].ok, false);
  assert.equal(surface.providers[0].code, "PROVIDER_DOWN");
});

test("the markets and the wallet's positions are read, and an empty position is not listed", async () => {
  const fixture = deps();
  const surface = await readEarnSurface(OWNER, fixture.deps);
  const [jupiter] = surface.providers;
  assert.equal(jupiter.ok, true);
  assert.equal(jupiter.markets.length, 3);
  assert.equal(surface.positions.length, 2, "the SOL market has no shares, so it is not a position");
  const usdc = surface.positions.find((position) => position.marketId === USDC_MINT);
  assert.equal(usdc.underlyingRaw, "512400000");
  assert.equal(usdc.earnedRaw, "12400000");
  assert.equal(usdc.readFrom, "rpc.fixture", "a position names where it was read from");
  assert.equal(surface.actions.open, true);
  assert.equal(surface.actions.mode, "OPEN");
});

test("a chain that did not answer leaves the positions unknown, and they are still listed", async () => {
  const fixture = deps();
  const unread = async (_owner, mints) => ({ held: new Map(mints.map((mint) => [mint, null])), host: "unread", readAt: new Date(0).toISOString() });
  const withUnreadChain = {
    ...fixture.deps,
    adapters: [jupiterLendAdapter({ key: "test-key", readHeld: unread, fetchImpl: jupiterStub().fetchImpl, now: () => NOW }), fixture.deps.adapters[1]],
  };
  const surface = await readEarnSurface(OWNER, withUnreadChain);
  assert.equal(surface.providers[0].ok, true, "the markets were read even though the wallet was not");
  assert.equal(surface.positions.length, 3, "a position nobody could read is listed as unknown, not dropped");
  for (const position of surface.positions) {
    assert.equal(position.sharesRaw, null);
    assert.equal(position.underlyingRaw, null);
    assert.equal(position.earnedRaw, null);
  }
});

test("a guest sees the markets and no positions", async () => {
  const fixture = deps();
  const surface = await readEarnSurface(null, fixture.deps);
  assert.equal(surface.providers[0].ok, true);
  assert.deepEqual(surface.positions, []);
  assert.equal(surface.actions.open, false, "no wallet, no action");
});

/* -------------------------------------------------------------- the Review */

test("a deposit Review quotes the rate, the minimum and the zero fee", async () => {
  const fixture = deps();
  const answer = await review(fixture);
  assert.equal(answer.ok, true);
  const { value } = answer;
  assert.equal(value.action, "deposit");
  assert.equal(value.amountRaw, "2000000");
  assert.equal(value.partial, false);
  assert.equal(value.rateAnnualPercent, 4.12);
  assert.equal(value.minimumRaw, "1000000");
  assert.equal(value.costs.find((line) => line.id === "ryntra").bps, 0);
  assert.equal(value.quotedAt, "2026-10-26T10:00:00.000Z");
  assert.equal(value.expiresAt, "2026-10-26T10:00:45.000Z");
  assert.equal(value.signableMs, 30_000, "the window comes from the chain, not from a number in the page");
  assert.ok(value.ticket.includes("."), "the Review is sealed");
  assert.ok(value.transaction.wireBase64.length > 64);
  assert.match(value.transaction.messageSha256, /^[0-9a-f]{64}$/);
});

test("a deposit under the minimum and one over the wallet are refused with the figure that refused them", async () => {
  const fixture = deps();
  const small = await review(fixture, { amount: "999999" });
  assert.equal(small.ok, false);
  assert.equal(small.code, "BELOW_MINIMUM");
  const big = await review(fixture, { amount: "2000000000" });
  assert.equal(big.ok, false);
  assert.equal(big.code, "OVER_WALLET");
});

test("a withdrawal the market can only half pay is reviewed as partial", async () => {
  const fixture = deps();
  const answer = await reviewEarn({ provider: "jupiter", action: "withdraw", owner: OWNER, market: USDT_MINT, amount: "100000000" }, fixture.deps);
  assert.equal(answer.ok, true);
  assert.equal(answer.value.partial, true);
  assert.equal(answer.value.amountRaw, "40000000", "what the market can pay today");
  assert.equal(answer.value.askedRaw, "100000000");
  assert.equal(answer.value.leftRaw, "81000000", "and what stays in the position");
  assert.equal(answer.value.positionRaw, "121000000");
});

test("a market with no liquidity refuses the withdrawal rather than building bytes for it", async () => {
  const fixture = deps();
  const answer = await reviewEarn({ provider: "jupiter", action: "withdraw", owner: OWNER, market: WSOL_MINT, amount: "1000000" }, fixture.deps);
  assert.equal(answer.ok, false);
  assert.equal(answer.code, "NOTHING_IN_POSITION", "no shares in that market, and that is said before liquidity");
  const built = fixture.calls.filter((call) => call.method === "POST");
  assert.deepEqual(built, [], "nothing was built for a withdrawal that cannot happen");
});

test("a withdrawal from a market that cannot pay anything is refused by liquidity", async () => {
  const fixture = deps({ stub: jupiterStub({ tokens: JUPITER_TOKENS_LIQUIDITY_GONE }) });
  const answer = await reviewEarn({ provider: "jupiter", action: "withdraw", owner: OWNER, market: USDT_MINT, amount: "10000000" }, fixture.deps);
  assert.equal(answer.ok, false);
  assert.equal(answer.code, "NO_LIQUIDITY");
});

test("a Review is not built while the gate is shut", async () => {
  const closed = deps({ actions: "CLOSED" });
  const answer = await review(closed);
  assert.equal(answer.ok, false);
  assert.equal(answer.code, "ACTIONS_CLOSED");
  assert.equal(closed.calls.length, 0);

  const unsealed = deps({ sealed: false });
  const unsealedAnswer = await review(unsealed);
  assert.equal(unsealedAnswer.ok, false);
  assert.equal(unsealedAnswer.code, "ACTIONS_CLOSED", "a Review that cannot be sealed is not offered");
});

test("the canary's ceiling is in dollars, and it is checked on what will move", async () => {
  const canary = deps({ actions: "CANARY", canaryWallet: OWNER });
  const inside = await review(canary, { amount: "4000000" });
  assert.equal(inside.ok, true);
  const outside = await review(canary, { amount: "6000000" });
  assert.equal(outside.ok, false);
  assert.equal(outside.code, "CANARY_LIMIT");

  const stranger = deps({ actions: "CANARY", canaryWallet: Keypair.generate().publicKey.toBase58() });
  const refused = await review(stranger);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "ACTIONS_CLOSED");
});

test("Kamino answers the same interface and refuses the action while it is off", async () => {
  const off = deps();
  const answer = await reviewEarn({ provider: "kamino", action: "deposit", owner: OWNER, market: USDC_MINT, amount: "2000000" }, off.deps);
  assert.equal(answer.ok, false);
  assert.equal(answer.code, "DISABLED");

  const on = deps({ kamino: true, kaminoUrl: "https://kamino.example" });
  /* Kamino names a market by its reserve rather than by the asset, which the contract allows: a market id is
     whatever its own provider calls one. */
  const on_markets = await readEarnSurface(OWNER, on.deps);
  const reserve = on_markets.providers[1].markets[0].id;
  assert.equal(reserve, "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59");
  const built = await reviewEarn({ provider: "kamino", action: "deposit", owner: OWNER, market: reserve, amount: "2000000" }, on.deps);
  assert.equal(built.ok, false);
  assert.match(built.reason, /referrer rate/, "switched on it reads reserves, and a deposit still waits on a decision");
});

/* --------------------------------------------------------------- the relay */

test("the signed bytes the Review sealed are sent once, and the receipt says what was signed", async () => {
  const fixture = deps();
  const reviewed = await review(fixture);
  assert.equal(reviewed.ok, true);
  const signed = sign(reviewed.value.transaction.wireBase64);
  const relayed = await submitEarn({ ticket: reviewed.value.ticket, signed }, fixture.deps);
  assert.equal(relayed.ok, true);
  assert.equal(fixture.sent.length, 1);
  assert.equal(relayed.value.state, "UNKNOWN", "the chain was not read here, and unknown is the honest state");
  assert.equal(relayed.value.amountRaw, "2000000");
  assert.equal(relayed.value.feeBps, 0);
  assert.equal(relayed.value.rateAnnualPercent, 4.12);
  assert.equal(relayed.value.rateDriftBps, 0);
  assert.equal(relayed.value.asset.symbol, "USDC");
});

test("a rate that fell between the Review and the signature sends nothing", async () => {
  /* The first market read answers 4.12 %, every later one 3.10 % — a live market, staged. */
  /* The Review reads the markets twice — once to size the action, once with the bytes — so the fall lands on
     the third read, which is the one the relay makes. */
  const fixture = deps({ stub: jupiterStub({ tokens: (call) => (call <= 2 ? JUPITER_TOKENS : JUPITER_TOKENS_RATE_FELL) }) });
  const reviewed = await review(fixture);
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.value.rateAnnualPercent, 4.12);
  const relayed = await submitEarn({ ticket: reviewed.value.ticket, signed: sign(reviewed.value.transaction.wireBase64) }, fixture.deps);
  assert.equal(relayed.ok, false);
  assert.equal(relayed.code, "RATE_MOVED");
  assert.equal(relayed.status, 409);
  assert.match(relayed.reason, /Nothing was sent/);
  assert.equal(fixture.sent.length, 0, "a signature is not a reason to send bytes whose figures are gone");
});

test("liquidity taken while the wallet was open stops a signed withdrawal", async () => {
  const fixture = deps({
    stub: jupiterStub({ tokens: (call) => (call <= 2 ? JUPITER_TOKENS : JUPITER_TOKENS_LIQUIDITY_GONE) }),
  });
  const reviewed = await reviewEarn({ provider: "jupiter", action: "withdraw", owner: OWNER, market: USDT_MINT, amount: "40000000" }, fixture.deps);
  assert.equal(reviewed.ok, true);
  const relayed = await submitEarn({ ticket: reviewed.value.ticket, signed: sign(reviewed.value.transaction.wireBase64) }, fixture.deps);
  assert.equal(relayed.ok, false);
  assert.equal(relayed.code, "NO_LIQUIDITY");
  assert.equal(fixture.sent.length, 0);
});

test("bytes that are not the ones Review showed are refused", async () => {
  const fixture = deps();
  const reviewed = await review(fixture);
  /* Same wallet, same instruction, a different blockhash — and therefore a different message to seal. */
  const other = sign(unsignedTransaction(OWNER, Keypair.generate().publicKey.toBase58()));
  const relayed = await submitEarn({ ticket: reviewed.value.ticket, signed: other }, fixture.deps);
  assert.equal(relayed.ok, false);
  assert.equal(relayed.code, "SIGNED_MISMATCH");
  assert.equal(fixture.sent.length, 0);
});

test("unsigned bytes are refused, and so is somebody else's signature", async () => {
  const fixture = deps();
  const reviewed = await review(fixture);
  const unsigned = await submitEarn({ ticket: reviewed.value.ticket, signed: reviewed.value.transaction.wireBase64 }, fixture.deps);
  assert.equal(unsigned.ok, false);
  assert.equal(unsigned.code, "NOT_SIGNED");
  /* 64 bytes that are not a signature of anything: the shape a signature has, with none of its meaning. */
  const forged = VersionedTransaction.deserialize(Buffer.from(reviewed.value.transaction.wireBase64, "base64"));
  forged.signatures[0] = new Uint8Array(64).fill(7);
  const stranger = await submitEarn({ ticket: reviewed.value.ticket, signed: Buffer.from(forged.serialize()).toString("base64") }, fixture.deps);
  assert.equal(stranger.ok, false);
  assert.equal(stranger.code, "NOT_SIGNED", "bytes shaped like a signature do not verify over this message");
  assert.equal(fixture.sent.length, 0);
});

test("a ticket this server did not seal, and one that aged out, both send nothing", async () => {
  const fixture = deps();
  const reviewed = await review(fixture);
  const forged = await submitEarn({ ticket: `${reviewed.value.ticket}x`, signed: sign(reviewed.value.transaction.wireBase64) }, fixture.deps);
  assert.equal(forged.ok, false);
  assert.equal(forged.code, "TICKET_INVALID");

  const later = {
    ...fixture.deps,
    now: () => NOW + 10 * 60_000,
  };
  const expired = await submitEarn({ ticket: reviewed.value.ticket, signed: sign(reviewed.value.transaction.wireBase64) }, later);
  assert.equal(expired.ok, false);
  assert.equal(expired.code, "TICKET_EXPIRED");
  assert.equal(fixture.sent.length, 0);
});

test("a gate that closed while the wallet was open sends nothing", async () => {
  const fixture = deps();
  const reviewed = await review(fixture);
  const shut = { ...fixture.deps, env: { ...fixture.deps.env, RYNTRA_EARN_ACTIONS: "CLOSED" } };
  const relayed = await submitEarn({ ticket: reviewed.value.ticket, signed: sign(reviewed.value.transaction.wireBase64) }, shut);
  assert.equal(relayed.ok, false);
  assert.equal(relayed.code, "ACTIONS_CLOSED");
  assert.equal(fixture.sent.length, 0);
});

test("a preflight refusal is reported as nothing moved; an unreadable answer is not", async () => {
  const refused = deps({ sendThrows: "Transaction simulation failed: Blockhash not found" });
  const reviewedRefused = await review(refused);
  const relayed = await submitEarn({ ticket: reviewedRefused.value.ticket, signed: sign(reviewedRefused.value.transaction.wireBase64) }, refused.deps);
  assert.equal(relayed.ok, false);
  assert.equal(relayed.code, "TICKET_EXPIRED");
  assert.match(relayed.reason, /Nothing moved/);

  /* A send that failed for a reason the cluster did not give — a dropped socket — is not «nothing moved»:
     the bytes may be in flight, so the receipt stands with the chain unread. */
  const lost = deps({ sendThrows: "socket hang up" });
  const reviewedLost = await review(lost);
  const answer = await submitEarn({ ticket: reviewedLost.value.ticket, signed: sign(reviewedLost.value.transaction.wireBase64) }, lost.deps);
  assert.equal(answer.ok, true);
  assert.equal(answer.value.state, "UNKNOWN");
});

test("the window a wallet gets is the chain's, capped by the Review's own", async () => {
  const short = deps({ signableMs: 9_000 });
  const measured = await review(short);
  assert.equal(measured.ok, true);
  assert.equal(measured.value.signableMs, 9_000, "bytes with nine seconds left offer nine seconds");

  const long = deps({ signableMs: 10 * 60_000 });
  const capped = await review(long);
  assert.equal(capped.ok, true);
  assert.equal(capped.value.signableMs, 45_000, "and a long-lived blockhash still only buys the Review's window");
});
