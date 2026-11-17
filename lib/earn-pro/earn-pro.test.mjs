/**
 * The surface of earning on DLMM Pro, with no network: its gate, its coins, its seal, its Review and relay,
 * and the agent's pass — on the moments of the chain the rehearsal froze (the build deployed on mainnet, in LiteSVM)
 * and with the rehearsal's own keys, which exist nowhere else.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { readFixture, rpcConnection, snapshotSource, toBase58 } from "../core/venues/meteora-dlmm-pro/fixture-kit.mjs";

const { earnProCoins, pierPairOf, SOL_MINT } = await import("./coins.ts");
const { EARN_PRO_ACTIONS, earnProGate, earnProStopped, heldByStop } = await import("./gate.ts");
const { PRO_CARE_PENDING_MS, PRO_CARE_STOP_PCTS, inTokenY, lamportsInTokenY, proCareAction, proCareDay, proCareKey, settleExit, stopBelowOf, watchOf, withEvent, PRO_CARE_EVENTS_KEPT } = await import("./care.ts");
const { checkEarnProSigned, issueEarnProTicket, readEarnProTicket, openCosigners } = await import("./ticket.ts");
const { readBoats, readPiers, lamportsOf, priceOfTick } = await import("./piers.server.ts");
const { proBinsAnswer, readProBins } = await import("./bins.server.ts");
const { stepBpsOfSpacing } = await import("../earn-pools/bins.ts");
const { EARN_PRO_MAX_LAMPORTS, EARN_PRO_MIN_LAMPORTS, parseEarnProReview, reviewEarnPro, submitEarnPro } = await import("./actions.server.ts");
const { actAsAgent, holdProCare, proCareGate, proCareMinute, proCareStep, proCaresOf, recordProCare, endProCare } = await import("./care.server.ts");
const { earnProPiersAnswer, earnProPositionsAnswer } = await import("./service.server.ts");
const { earnProVenue, DlmmProRefusal } = await import("./venue.server.ts");
const { EarnBinsResponseSchema, EarnProPiersResponseSchema, EarnProPositionsResponseSchema, EarnProReviewRequestSchema, EarnProSummarySchema } = await import("../api/v1/contract.ts");
const { createMemoryGuardStore } = await import("../guard/store.ts");
const { envKey } = await import("../launch/signer/env.server.ts");

const fixture = readFixture(new URL("../core/venues/meteora-dlmm-pro/fixtures/earn-rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;
const keyOf = (name) => Keypair.fromSeed(createHash("sha256").update(`city-249/${name}`).digest());
const person = keyOf("person");
const agent = keyOf("agent");
assert.equal(person.publicKey.toBase58(), who.person);
assert.equal(agent.publicKey.toBase58(), who.agent);

/* The stand's referral owner is a devnet deployment's own word. */
process.env.RYNTRA_EARN_PRO_DEVNET_REFERRAL = who.referral;
/* The door asks the deployment's own gate: this test is a devnet deployment. */
process.env.RYNTRA_EARN_PRO = "devnet";
const ENV = Object.freeze({
  RYNTRA_EARN_PRO: "devnet",
  /* The stand's pool is of SOL against USDC at mainnet's address: on devnet a deployment names its coin. */
  RYNTRA_EARN_PRO_DEVNET_COIN: `${addresses.usdc}:USDC`,
  BETA_TOKEN_SECRET: "a-test-secret-of-enough-length",
  RYNTRA_AGENT_CARE: "devnet",
  RYNTRA_AGENT_CARE_AGENT: who.agent,
  RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...agent.secretKey]),
});

/** A frozen moment that also takes what is sent to it: every send is kept and reads as confirmed. */
/** The person's own wrapped-SOL account, empty, as the owner's first collect in SOL leaves it. */
function wrappedSolOf(owner) {
  const data = Buffer.alloc(165);
  new PublicKey("So11111111111111111111111111111111111111112").toBuffer().copy(data, 0);
  new PublicKey(owner).toBuffer().copy(data, 32);
  data.writeUInt8(1, 108);
  data.writeUInt32LE(1, 109);
  data.writeBigUInt64LE(2_039_280n, 113);
  return { [getAssociatedTokenAddressSync(new PublicKey("So11111111111111111111111111111111111111112"), new PublicKey(owner), true).toBase58()]: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", lamports: 2_039_280, data: data.toString("base64") } };
}

function at(moment, extra = {}) {
  const sent = [];
  const snapshot = { ...fixture.snapshots[moment], accounts: { ...fixture.snapshots[moment].accounts, ...extra } };
  const source = {
    ...snapshotSource(snapshot, {}, () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null })),
    send: (bytes) => {
      const tx = VersionedTransaction.deserialize(bytes);
      sent.push(tx);
      return toBase58(tx.signatures[0]);
    },
    status: () => ({ slot: 1, confirmations: null, err: null, confirmationStatus: "confirmed" }),
  };
  const connection = rpcConnection(source);
  return { connection, venue: earnProVenue("devnet", connection), sent };
}
const signedBy = (wire, signer) => {
  const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
  tx.sign([signer]);
  return Buffer.from(tx.serialize()).toString("base64");
};

/* ------------------------------------------------------------------ the gate, the coins */

test("the surface is closed unless a deployment names devnet; mainnet waits for the venue's own word; the stop holds only what brings money in", () => {
  assert.equal(earnProGate({}).open, false);
  assert.deepEqual(earnProGate({ RYNTRA_EARN_PRO: "devnet" }), { open: true, network: "devnet" });
  assert.deepEqual(earnProGate({ RYNTRA_EARN_PRO: "mainnet" }), { open: false, reason: "owner-word" });
  assert.equal(earnProStopped({}), false);
  assert.equal(earnProStopped({ RYNTRA_EARN_PRO_STOP: "1" }), true);
  assert.deepEqual(EARN_PRO_ACTIONS.filter(heldByStop), ["open", "compound", "care_on"]);
  assert.deepEqual(EARN_PRO_ACTIONS.filter((action) => !heldByStop(action)), ["collect", "leave", "close", "care_off"]);
});

test("a pier is SOL against a coin Earn knows — any other pool is not one", () => {
  const mainnet = earnProCoins("mainnet");
  assert.deepEqual(mainnet.map((coin) => coin.symbol), ["SOL", "USDC", "JupSOL", "INF", "JitoSOL"]);
  const usdc = mainnet[1].mint;
  assert.equal(pierPairOf(mainnet, SOL_MINT, usdc).solIsX, true);
  assert.equal(pierPairOf(mainnet, usdc, SOL_MINT).solIsX, false);
  assert.equal(pierPairOf(mainnet, usdc, mainnet[2].mint), null, "no SOL on either side");
  assert.equal(pierPairOf(mainnet, SOL_MINT, who.stranger), null, "a coin nobody checked");
  assert.equal(pierPairOf(mainnet, SOL_MINT, SOL_MINT), null);
  assert.equal(earnProCoins("devnet").length, 2);
  assert.deepEqual(earnProCoins("devnet", { RYNTRA_EARN_PRO_DEVNET_COIN: `${who.stranger}:TEST` }).at(-1), { mint: who.stranger, symbol: "TEST", kind: "test" });
  assert.equal(earnProCoins("devnet", { RYNTRA_EARN_PRO_DEVNET_COIN: "not-an-address:TEST" }).length, 2);
  assert.equal(earnProCoins("devnet", { RYNTRA_EARN_PRO_DEVNET_COIN: `${who.stranger}:<b>` }).length, 2);
});

/* ------------------------------------------------------------------ the piers and the boats, from the chain */

test("the piers are read from the chain: price, fee, depth in SOL, the reward — and a pool of an unknown coin is left out", async () => {
  const { connection } = at("caring");
  const { piers } = await readPiers("devnet", { env: ENV, connection });
  assert.equal(piers.length, 1);
  const [pier] = piers;
  assert.equal(pier.address, addresses.pool);
  assert.deepEqual([pier.x.symbol, pier.y.symbol, pier.solIsX, pier.tickSpacing, pier.takesDeposits], ["SOL", "USDC", true, 10, true]);
  assert.ok(Math.abs(pier.price - 150) < 3 && pier.feeBps === 25, `${pier.price} · ${pier.feeBps}`);
  assert.ok(BigInt(pier.depthLamports) > 800_000_000_000n, `${pier.depthLamports} lamports deep`);
  assert.deepEqual(pier.rewards.map((reward) => [reward.symbol, reward.perDayRaw, reward.running]), [["USDC", "864000000", true]]);
  assert.deepEqual((await readPiers("devnet", { env: { RYNTRA_EARN_PRO: "devnet" }, connection })).piers, [], "without the coin named, the pool is no pier");
  assert.equal(lamportsOf(pier, 1_000_000_000n, 150_000_000n) > 1_900_000_000n, true);
  assert.ok(Math.abs(priceOfTick(pier.tickId, 9, 6) - pier.price) / pier.price < 0.0002);
});

test("a wallet's boats: worth, the fees, the reward, and whether an agent looks after each", async () => {
  const { connection } = at("caring");
  const boats = await readBoats("devnet", who.person, who.agent, { env: ENV, connection });
  assert.equal(boats.length, 1);
  const [boat] = boats;
  assert.deepEqual([boat.nftMint, boat.pool, boat.inRange, boat.cared, boat.empty], [addresses.personPosition, addresses.pool, true, true, false]);
  assert.ok(boat.lowerPrice < 150 && boat.upperPrice > 150 && boat.ranges >= 2 && boat.ranges <= 7);
  assert.ok(BigInt(boat.worth.lamports) > 1_500_000_000n && BigInt(boat.fees.lamports) > 0n, JSON.stringify(boat.worth));
  assert.deepEqual(boat.rewards.map((reward) => [reward.symbol, reward.running]), [["USDC", true]]);
  assert.equal((await readBoats("devnet", who.person, null, { env: ENV, connection }))[0].cared, false, "where no agent is offered, nothing is cared for");
  assert.deepEqual(await readBoats("devnet", who.stranger, who.agent, { env: ENV, connection }), []);
});

test("a pier's liquidity by price: the steps around the price in the contract's shape, the market's price beside them, null for no pool, closed with the surface", async () => {
  const { connection } = at("caring");
  const market = async (mints) => ({ [mints[0]]: 150, [mints[1]]: 1 });
  const answer = await readProBins("devnet", addresses.pool, 20, { connection, env: ENV, market, now: () => 1_763_000_000_000 });
  assert.equal(EarnBinsResponseSchema.safeParse({ ...answer, bins: [...answer.bins] }).success, true);
  assert.equal(answer.venue, "pro");
  assert.equal(answer.rent, null);
  assert.equal(answer.bins.length, 41);
  assert.equal(answer.bins[20].offset, 0);
  assert.equal(answer.bins[20].id, answer.activeId);
  assert.ok(Math.abs(answer.stepBps - stepBpsOfSpacing(10)) < 1e-12 && answer.stepBps > 10 && answer.stepBps < 10.01);
  /* Each step is the spacing's ratio above the last; the price stands inside the step at offset 0. */
  assert.ok(Math.abs(answer.bins[21].price / answer.bins[20].price - (1 + answer.stepBps / 10_000)) < 1e-9);
  assert.ok(answer.bins[20].price <= answer.price && answer.price < answer.bins[21].price);
  assert.ok(answer.bins.slice(0, 20).every((bin) => bin.x === "0") && answer.bins.slice(21).every((bin) => bin.y === "0"));
  assert.ok(answer.bins.some((bin) => bin.x !== "0") && answer.bins.some((bin) => bin.y !== "0"));
  assert.equal(answer.market.price, 150);
  assert.ok(Math.abs(answer.market.gapPct - (answer.price / 150 - 1) * 100) < 1e-9);
  /* Jupiter silent, or a network it does not price: the bins stand without a market price. */
  const silent = await readProBins("devnet", addresses.pool, 20, { connection, env: ENV, market: async () => Promise.reject(new Error("down")) });
  assert.deepEqual(silent.market, { price: null, gapPct: null });
  assert.deepEqual((await readProBins("devnet", addresses.pool, 20, { connection, env: ENV })).market, { price: null, gapPct: null });
  assert.equal(await readProBins("devnet", addresses.usdc, 20, { connection, env: ENV }), null);
  await assert.rejects(() => readProBins("devnet", addresses.pool, 20, { connection, env: {} }), /not served/);
  /* A venue of the server's own: one read at a time for a pool and a width, the answer kept — «no pool» too. */
  let reads = 0;
  const steps = { pool: addresses.sol, tokenX: { mint: addresses.sol, decimals: 9 }, tokenY: { mint: addresses.usdc, decimals: 6 }, tickSpacing: 10, tickId: 5, hereTickId: 0, price: 1, steps: [{ offset: 0, tickLowerId: 0, tickUpperId: 10, price: 1, xRaw: "1", yRaw: "1" }] };
  const venue = { bins: { around: async () => ((reads += 1), await new Promise((resolve) => setTimeout(resolve, 5)), steps) } };
  const [first, second] = await Promise.all([readProBins("devnet", addresses.sol, 7, { venue, env: ENV, market: async () => ({}) }), readProBins("devnet", addresses.sol, 7, { venue, env: ENV, market: async () => ({}) })]);
  assert.deepEqual([reads, first === second, first.bins.length], [1, true, 1]);
  await readProBins("devnet", addresses.sol, 7, { venue, env: ENV });
  assert.equal(reads, 1, "kept twenty seconds");
  await readProBins("devnet", addresses.sol, 8, { venue, env: ENV, market: async () => ({}) });
  assert.equal(reads, 2, "another width is another read");
  let misses = 0;
  const none = { bins: { around: async () => ((misses += 1), Promise.reject(new DlmmProRefusal("NO_POOL", "none"))) } };
  assert.deepEqual([await readProBins("devnet", addresses.usdc, 9, { venue: none, env: ENV }), await readProBins("devnet", addresses.usdc, 9, { venue: none, env: ENV }), misses], [null, null, 1]);
  /* A chain that did not answer is not kept: the next read asks again. */
  let fails = 0;
  const down = { bins: { around: async () => ((fails += 1), Promise.reject(new Error("rpc down"))) } };
  await assert.rejects(() => readProBins("devnet", addresses.pool, 9, { venue: down, env: ENV }), /rpc down/);
  await assert.rejects(() => readProBins("devnet", addresses.pool, 9, { venue: down, env: ENV }), /rpc down/);
  assert.equal(fails, 2);
  assert.equal(proBinsAnswer({ pool: addresses.pool, tokenX: { mint: addresses.sol, decimals: 9 }, tokenY: { mint: addresses.usdc, decimals: 6 }, tickSpacing: 10, tickId: 5, hereTickId: 0, price: 1, steps: [] }, {}, 0).at, "1970-01-01T00:00:00.000Z");
});

test("the routes' answers are the contract's own shapes, and null where the surface is closed", async () => {
  const { connection } = at("caring");
  const store = createMemoryGuardStore();
  const piers = await earnProPiersAnswer(ENV, { connection });
  assert.equal(EarnProPiersResponseSchema.safeParse(piers).success, true, JSON.stringify(EarnProPiersResponseSchema.safeParse(piers).error?.issues));
  assert.equal(piers.care, true);
  await recordProCare({ owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: 135 }, { env: ENV, connection, store, now: () => 1_000 });
  const positions = await earnProPositionsAnswer(who.person, ENV, { connection, now: () => 2_000, care: { store } });
  assert.equal(EarnProPositionsResponseSchema.safeParse(positions).success, true, JSON.stringify(EarnProPositionsResponseSchema.safeParse(positions).error?.issues));
  assert.deepEqual(positions.positions[0].care, { status: "working", stoppedBy: null, stopBelow: 135, claimedInY: 0, lastAt: null });
  /* An approval not on the chain yet — held before the relay — says nothing on the boat, never «taken back». */
  await holdProCare({ owner: who.holder, pool: addresses.pool, nftMint: addresses.holderPosition, stopBelow: null }, { env: ENV, store, now: () => 1_000 });
  const theirs = await earnProPositionsAnswer(who.holder, ENV, { connection, now: () => 2_000, care: { store } });
  assert.equal(theirs.positions.find((boat) => boat.nftMint === addresses.holderPosition)?.care, null);
  /* The agent's key away: no care is offered, yet the boat still shows its agent — and can take it back. */
  const keyless = await earnProPositionsAnswer(who.person, { ...ENV, RYNTRA_AGENT_MANDATE_KEY: undefined }, { connection, now: () => 2_000, care: { store } });
  assert.deepEqual([keyless.care, keyless.positions[0].cared], [false, true]);
  assert.equal(await earnProPiersAnswer({}, { connection }), null);
  assert.equal(await earnProPositionsAnswer(who.person, { RYNTRA_EARN_PRO: "mainnet" }, { connection }), null);
  assert.equal((await earnProPiersAnswer({ ...ENV, RYNTRA_AGENT_CARE: undefined }, { connection })).care, false, "the piers work where no agent is offered");
});

/* ------------------------------------------------------------------ the seal */

test("a ticket is read back only as this server sealed it, and only while its transactions live", () => {
  const input = { network: "devnet", owner: who.person, action: "open", pool: addresses.pool, nftMint: addresses.personPosition, messages: ["a".repeat(64)], cosign: null, stopBelow: null };
  const ticket = issueEarnProTicket(input, ENV, 1_000_000);
  const read = readEarnProTicket(ticket, ENV, 1_000_500);
  assert.equal(read.ok && read.ticket.owner === who.person && read.ticket.expiresAt === 1_000_000 + 30_000, true);
  assert.deepEqual(readEarnProTicket(ticket, ENV, 1_031_000), { ok: false, code: "TICKET_EXPIRED" });
  assert.deepEqual(readEarnProTicket(`${ticket.slice(0, -2)}xx`, ENV, 1_000_500), { ok: false, code: "TICKET_INVALID" });
  assert.deepEqual(readEarnProTicket(ticket, { BETA_TOKEN_SECRET: "another-secret-of-enough-length" }, 1_000_500), { ok: false, code: "TICKET_INVALID" });
  assert.equal(issueEarnProTicket(input, {}, 1_000_000), null, "no key, no ticket");
  for (const broken of [{ action: "drain" }, { messages: [] }, { messages: ["zz"] }, { network: "testnet" }, { stopBelow: -1 }, { owner: "x" }]) {
    assert.deepEqual(readEarnProTicket(issueEarnProTicket({ ...input, ...broken }, ENV, 1_000_000), ENV, 1_000_500), { ok: false, code: "TICKET_INVALID" }, JSON.stringify(broken));
  }
});

/* ------------------------------------------------------------------ a Review and its relay */

test("a request is a Review's only as the contract shapes it", () => {
  const open = { action: "open", owner: who.person, pool: addresses.pool, goal: "near", style: "balanced", lamports: "2000000000" };
  assert.deepEqual(parseEarnProReview(open), open);
  assert.equal(EarnProReviewRequestSchema.safeParse(open).success, true);
  for (const broken of [{ goal: "moon" }, { style: "wide" }, { lamports: "2e9" }, { lamports: 2 }, { owner: "me" }, { action: "drain" }]) {
    assert.equal(parseEarnProReview({ ...open, ...broken }), null, JSON.stringify(broken));
    assert.equal(EarnProReviewRequestSchema.safeParse({ ...open, ...broken }).success, false, JSON.stringify(broken));
  }
  assert.equal(parseEarnProReview({ action: "leave", owner: who.person, pool: addresses.pool }), null, "a position's action names the position");
  assert.equal(parseEarnProReview({ action: "care_on", owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopPct: 5 }), null);
  assert.deepEqual([...PRO_CARE_STOP_PCTS], [0, 10, 25]);
});

test("an opening from SOL alone: two transactions for one approval, what they do in numbers, and a relay that sends exactly those — once, in order", async () => {
  const { connection, sent } = at("poolOpen");
  const fresh = keyOf("a-fresh-nft");
  const reviewed = await reviewEarnPro({ action: "open", owner: who.person, pool: addresses.pool, goal: "near", style: "balanced", lamports: "2000000000" }, { env: ENV, connection, now: () => 5_000_000, freshKey: () => fresh });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  const { value } = reviewed;
  assert.equal(value.transactions.length, 2);
  assert.equal(EarnProSummarySchema.safeParse(value.summary).success, true, JSON.stringify(EarnProSummarySchema.safeParse(value.summary).error?.issues));
  const summary = value.summary;
  assert.equal(summary.action, "open");
  /* The rehearsal's own numbers: what went in, the band, the ranges. */
  assert.deepEqual([summary.goesIn.xRaw, summary.goesIn.yRaw, summary.bandBps, summary.ranges], [fixture.kept.open.deposit.lamports, fixture.kept.open.deposit.usdcRaw, fixture.kept.open.bandBps, fixture.kept.open.ranges]);
  assert.ok(summary.lowerPrice < 150 && summary.upperPrice > 150);
  /* What was named is what goes in, what the pool's fee on the swap takes, and what stays in the wallet: «Near price» is sized for its whole band, and about a fifth stays — said before the signature. */
  const named = 2_000_000_000n;
  assert.ok(BigInt(summary.goesIn.lamports) + BigInt(summary.staysLamports) <= named && BigInt(summary.goesIn.lamports) * 100n > named * 75n && BigInt(summary.staysLamports) * 100n < named * 25n, JSON.stringify(summary));
  assert.equal(summary.swap.referral, true);
  assert.equal(summary.nftMint, fresh.publicKey.toBase58());
  /* The bytes carry no signature: the wallet signs first. */
  for (const wire of value.transactions) assert.ok(VersionedTransaction.deserialize(Buffer.from(wire, "base64")).signatures.every((signature) => signature.every((byte) => byte === 0)));

  const signed = value.transactions.map((wire) => signedBy(wire, person));
  const relayed = await submitEarnPro({ ticket: value.ticket, signed }, { env: ENV, connection, now: () => 5_010_000, pollMs: 1 });
  assert.equal(relayed.ok, true, JSON.stringify(relayed));
  assert.deepEqual(relayed.value.results.map((result) => result.state), ["LANDED", "LANDED"]);
  assert.equal(relayed.value.settled, true);
  assert.equal(sent.length, 2);
  /* The opening went out with the fresh key's signature beside the wallet's — added after the wallet's, by the relay. */
  assert.equal(sent[1].signatures.length, 2);
  assert.ok(sent[1].signatures.every((signature) => signature.some((byte) => byte !== 0)));
  assert.equal(sent[1].message.staticAccountKeys[1].toBase58(), fresh.publicKey.toBase58());

  /* What the relay refuses, before anything is sent. */
  const before = sent.length;
  const refusal = async (body, now = 5_010_000, env = ENV) => {
    const answer = await submitEarnPro(body, { env, connection, now: () => now, pollMs: 1 });
    return answer.ok ? "sent" : answer.code;
  };
  assert.equal(await refusal({ ticket: value.ticket, signed: [signed[1], signed[0]] }), "SIGNED_MISMATCH", "another order");
  assert.equal(await refusal({ ticket: value.ticket, signed: [signed[0]] }), "SIGNED_MISMATCH", "one short");
  assert.equal(await refusal({ ticket: value.ticket, signed: value.transactions }), "NOT_SIGNED", "unsigned");
  /* A signature in the wallet's slot that is not the wallet's: another key's over the same message. */
  const forged = value.transactions.map((wire) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    const other = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    other.message.staticAccountKeys[0] = keyOf("stranger").publicKey;
    other.sign([keyOf("stranger")]);
    tx.signatures[0] = other.signatures[0];
    return Buffer.from(tx.serialize()).toString("base64");
  });
  assert.equal(await refusal({ ticket: value.ticket, signed: forged }), "NOT_SIGNED", "signed by another wallet");
  const other = await reviewEarnPro({ action: "open", owner: who.person, pool: addresses.pool, goal: "even", style: "calm", lamports: "1000000000" }, { env: ENV, connection, now: () => 5_000_000 });
  assert.equal(await refusal({ ticket: value.ticket, signed: other.value.transactions.map((wire) => signedBy(wire, person)) }), "SIGNED_MISMATCH", "another Review's bytes");
  assert.equal(await refusal({ ticket: value.ticket, signed }, 5_031_000), "TICKET_EXPIRED");
  assert.equal(await refusal({ ticket: `${value.ticket}x`, signed }), "TICKET_INVALID");
  assert.equal(await refusal({ ticket: value.ticket, signed }, 5_010_000, { ...ENV, RYNTRA_EARN_PRO: "off" }), "EARN_PRO_CLOSED");
  assert.equal(await refusal({ ticket: value.ticket, signed }, 5_010_000, { ...ENV, RYNTRA_EARN_PRO_STOP: "1" }), "EARN_PRO_STOPPED");
  assert.equal(await refusal({ ticket: value.ticket }), "BAD_REQUEST");
  assert.equal(sent.length, before, "nothing of it was sent");
});

test("what a Review refuses before it builds: closed, stopped, too little, too much, not a pier, a wallet that cannot pay", async () => {
  const { connection } = at("poolOpen");
  const open = { action: "open", owner: who.person, pool: addresses.pool, goal: "even", style: "calm", lamports: "1000000000" };
  const code = async (input, env = ENV) => {
    const answer = await reviewEarnPro(input, { env, connection });
    return answer.ok ? "built" : `${answer.status} ${answer.code}`;
  };
  assert.equal(await code(open), "built");
  assert.equal(await code(open, {}), "404 EARN_PRO_CLOSED");
  assert.equal(await code(open, { ...ENV, RYNTRA_EARN_PRO: "mainnet" }), "404 EARN_PRO_CLOSED", "mainnet stays closed until the code opens it");
  assert.equal(await code(open, { ...ENV, RYNTRA_EARN_PRO_STOP: "yes" }), "403 EARN_PRO_STOPPED");
  assert.equal(await code(open, { ...ENV, BETA_TOKEN_SECRET: undefined }), "503 UNAVAILABLE", "no key to seal with");
  assert.equal(await code({ ...open, lamports: (EARN_PRO_MIN_LAMPORTS - 1n).toString() }), "422 AMOUNT_LOW");
  assert.equal(await code({ ...open, lamports: (EARN_PRO_MAX_LAMPORTS + 1n).toString() }), "422 AMOUNT_HIGH");
  assert.equal(await code({ ...open, pool: who.stranger }), "404 NOT_A_PIER");
  assert.equal(await code(open, { ...ENV, RYNTRA_EARN_PRO_DEVNET_COIN: undefined }), "404 NOT_A_PIER", "a pool of a coin Earn does not know");
  assert.equal(await code({ ...open, owner: who.stranger, lamports: "9000000000" }), "built", "the stand's stranger holds 50 SOL");
  assert.equal(await code({ ...open, owner: addresses.usdc }), "422 BALANCE_LOW");
});

test("the position's own actions: what was earned in one approval, leaving in one approval, the care given and taken back — and the stop never holds money in", async () => {
  const { connection } = at("caring");
  const base = { owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition };
  const review = (action, more = {}, env = ENV) => reviewEarnPro({ action, ...base, ...more }, { env, connection });
  const collect = await review("collect");
  assert.equal(collect.ok, true, JSON.stringify(collect));
  assert.equal(collect.value.transactions.length, 2, "the fees, and the reward");
  assert.deepEqual([collect.value.summary.fees.xRaw, collect.value.summary.fees.yRaw], [fixture.kept.careFees.toOwner.lamportsWrapped, fixture.kept.careFees.toOwner.usdcRaw]);
  assert.deepEqual(collect.value.summary.rewards.map((reward) => reward.symbol), ["USDC"]);
  const leave = await review("leave");
  assert.equal(leave.ok && leave.value.transactions.length === 3 && leave.value.summary.bandBps === 100, true, JSON.stringify(leave));
  assert.ok(BigInt(leave.value.summary.minimum.lamports) <= BigInt(leave.value.summary.expected.lamports) && BigInt(leave.value.summary.expected.lamports) > 1_500_000_000n);
  const compound = await review("compound");
  assert.equal(compound.ok && compound.value.transactions.length === 1, true, JSON.stringify(compound));
  assert.equal((await review("close")).code, "REFUSED", "a position that still holds something is not closed");
  const off = await review("care_off");
  assert.equal(off.ok && off.value.transactions.length === 1, true);
  const on = await review("care_on", { stopPct: 10 });
  assert.equal(on.ok, true, JSON.stringify(on));
  assert.deepEqual([on.value.summary.agent, on.value.summary.rights], [who.agent, ["claimFee", "claimReward", "removeLiquidity"]]);
  /* The stand's pool pairs SOL with a test coin: the stop watches that coin in SOL. */
  assert.deepEqual([on.value.summary.stopCoin, on.value.summary.stopUnit], ["USDC", "SOL"]);
  assert.ok(Math.abs(on.value.summary.stopBelow * 150 - 0.9) < 0.02, `${on.value.summary.stopBelow}`);
  assert.equal((await review("care_on", { stopPct: 0 })).value.summary.stopBelow, null);
  assert.equal((await review("care_on", { stopPct: 10 }, { ...ENV, RYNTRA_AGENT_CARE: undefined })).code, "CARE_CLOSED");
  /* Somebody else's position, and a position of another pool's name. */
  assert.equal((await reviewEarnPro({ action: "collect", ...base, owner: who.holder }, { env: ENV, connection })).code, "REFUSED");
  assert.equal((await review("collect", { nftMint: who.stranger })).code, "REFUSED");
  /* The stop: new money and a new care are held; what takes out or takes back is not. */
  const stopped = { ...ENV, RYNTRA_EARN_PRO_STOP: "1" };
  assert.deepEqual(
    await Promise.all(["compound", "collect", "leave", "care_off"].map(async (action) => ((await review(action, {}, stopped)).ok ? "built" : "held"))),
    ["held", "built", "built", "built"],
  );
  assert.equal((await review("care_on", { stopPct: 0 }, stopped)).code, "EARN_PRO_STOPPED");
});

/* ------------------------------------------------------------------ the care */

test("the stop is a price under the price at the approval; the agent exits under it, collects what is worth its fee, and otherwise waits", () => {
  assert.equal(stopBelowOf(150, 0), null);
  assert.equal(stopBelowOf(150, 10), 135);
  assert.equal(stopBelowOf(0, 10), null);
  const reading = { price: 150, hasLiquidity: true, feesInY: 1, txCostInY: 0.0015 };
  assert.deepEqual(proCareAction({ ...reading, price: 134 }, { stopBelow: 135, lastClaimAt: null }, 0), { kind: "exit", reason: "stop" });
  assert.deepEqual(proCareAction(reading, { stopBelow: 135, lastClaimAt: null }, 0), { kind: "claim", to: "wallet" });
  assert.deepEqual(proCareAction({ ...reading, feesInY: 0.01 }, { stopBelow: null, lastClaimAt: null }, 0), { kind: "wait", reason: "fees-small" });
  assert.deepEqual(proCareAction(reading, { stopBelow: null, lastClaimAt: 1_000 }, 2_000), { kind: "wait", reason: "cooldown" });
  assert.deepEqual(proCareAction({ ...reading, hasLiquidity: false, feesInY: 0 }, { stopBelow: 135, lastClaimAt: null }, 0), { kind: "wait", reason: "empty" });
  /* It never moves the range and never puts fees back, whatever the price does. */
  for (const price of [1, 100, 150, 10_000]) assert.ok(["exit", "claim", "wait"].includes(proCareAction({ ...reading, price }, { stopBelow: 135, lastClaimAt: null }, 0).kind));
  assert.equal(inTokenY(1_000_000_000n, 5_000_000n, { price: 150, decimalsX: 9, decimalsY: 6 }), 155);
  assert.equal(lamportsInTokenY(10_000, { price: 150, solIsX: true }), 0.0015);
  assert.equal(lamportsInTokenY(10_000, { price: 0.002, solIsX: false }), 0.00001);
  assert.equal(proCareKey("devnet", "owner", "nft"), "p:devnet:owner:nft");
});

test("a row keeps what the agent did — the last sixty — and its day is what reached the wallet", () => {
  let entry = { v: 1, kind: "dlmm-pro", key: "p:devnet:o:n", network: "devnet", owner: "o", pool: "p", nftMint: "n", agent: "a", stopBelow: null, status: "working", stoppedBy: null, confirmed: true, lastClaimAt: null, events: [], createdAt: 0, updatedAt: 0 };
  for (let index = 0; index < PRO_CARE_EVENTS_KEPT + 5; index += 1) entry = withEvent(entry, { at: index * 1_000, kind: "claim", valueInY: 1, signature: `s${index}` }, { lastClaimAt: index * 1_000 });
  assert.equal(entry.events.length, PRO_CARE_EVENTS_KEPT);
  entry = withEvent(entry, { at: 90_000_000, kind: "refused", valueInY: 0, signature: null });
  entry = withEvent(entry, { at: 90_000_500, kind: "exit", valueInY: 300, signature: "x" }, { status: "stopped", stoppedBy: "stop" });
  assert.deepEqual(proCareDay(entry, 90_001_000), { claimedInY: 300, lastAt: 90_000_500, refusals: 1 });
  assert.deepEqual([entry.status, entry.stoppedBy, entry.updatedAt], ["stopped", "stop", 90_000_500]);
});

test("the care's gate is both switches on one network, and its book holds only what the chain shows", async () => {
  assert.deepEqual(proCareGate(ENV), { open: true, network: "devnet", agent: who.agent });
  assert.equal(proCareGate({ ...ENV, RYNTRA_AGENT_CARE: undefined }).open, false);
  assert.equal(proCareGate({ ...ENV, RYNTRA_EARN_PRO: undefined }).open, false);
  assert.equal(proCareGate({ ...ENV, RYNTRA_AGENT_CARE: "mainnet" }).open, false, "another network's care is not this one's");
  assert.equal(proCareGate({ ...ENV, RYNTRA_AGENT_MANDATE_KEY: undefined }).open, false, "no care is offered where no key would keep it");
  assert.equal(proCareGate({ ...ENV, RYNTRA_AGENT_MANDATE_KEY: JSON.stringify([...keyOf("stranger").secretKey]) }).open, false, "nor where the key is not the agent's");
  const store = createMemoryGuardStore();
  const { connection } = at("caring");
  const deps = { env: ENV, connection, store, now: () => 7_000 };
  const row = await recordProCare({ owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: 135 }, deps);
  assert.deepEqual([row.status, row.agent, row.stopBelow, row.key], ["working", who.agent, 135, `p:devnet:${who.person}:${addresses.personPosition}`]);
  /* A position the agent is not approved on is not written, whatever the request says. */
  assert.equal(await recordProCare({ owner: who.holder, pool: addresses.pool, nftMint: addresses.holderPosition, stopBelow: null }, deps), null);
  assert.equal(await recordProCare({ owner: who.stranger, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: null }, deps), null);
  assert.equal((await proCaresOf(who.person, deps)).length, 1);
  assert.deepEqual(await proCaresOf(who.holder, deps), []);
  await endProCare({ owner: who.person, nftMint: addresses.personPosition }, deps);
  assert.deepEqual((await proCaresOf(who.person, deps)).map((entry) => [entry.status, entry.stoppedBy]), [["stopped", "owner"]]);
});

test("the agent's key signs a care's build and nothing else; every signature has its journal row", async () => {
  const { connection, venue, sent } = at("caring");
  const store = createMemoryGuardStore();
  const key = envKey(ENV.RYNTRA_AGENT_MANDATE_KEY).signer;
  const entry = { v: 1, kind: "dlmm-pro", key: proCareKey("devnet", who.person, addresses.personPosition), network: "devnet", owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, agent: who.agent, stopBelow: null, status: "working", stoppedBy: null, confirmed: true, lastClaimAt: null, events: [], createdAt: 0, updatedAt: 0 };
  const context = { connection, store, key, now: () => 9_000 };
  const fees = await venue.positions.collect({ pool: addresses.pool, nftMint: addresses.personPosition, owner: who.person, signer: who.agent });
  const landed = await actAsAgent(fees, entry, context);
  assert.equal(landed.status, "landed", JSON.stringify(landed));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.staticAccountKeys[0].toBase58(), who.agent);
  /* A build for the person's own wallet — an opening — is not the agent's to sign, even handed to it by our own code. */
  const approval = await venue.earn.endCare({ nftMint: addresses.personPosition, owner: who.person });
  assert.deepEqual(await actAsAgent(approval, entry, context), { status: "refused", reason: "the agent is not the one payer and signer" });
  /* Nor is a care's build for another care's position. */
  assert.deepEqual(await actAsAgent(fees, { ...entry, nftMint: addresses.holderPosition }, context), { status: "refused", reason: "a call on another position" });
  assert.equal(sent.length, 1, "what was refused was not sent");
  const journal = await store.collection("agentSignatures").valuesWithPrefix("care:devnet:");
  assert.deepEqual(journal.map((row) => row.outcome).sort(), ["REFUSED", "REFUSED", "SIGNED"]);
  assert.ok(journal.every((row) => row.signer === who.agent && row.policy.startsWith("dlmm-pro:") && row.action === "care.action"));
});

test("the agent's pass goes on where the last one stopped: a book longer than one pass is walked round, not only its head", async () => {
  const store = createMemoryGuardStore();
  const book = store.collection("agentCare");
  const keys = ["p:devnet:a:1", "p:devnet:b:2", "p:devnet:c:3", "p:devnet:d:4"];
  for (const key of keys) await book.set(key, { v: 1, kind: "dlmm-pro", key, network: "devnet", owner: "o", pool: "p", nftMint: "n", agent: "a", stopBelow: null, status: "working", stoppedBy: null, confirmed: true, lastClaimAt: null, events: [], createdAt: 0, updatedAt: 0 });
  let clock = 0;
  const seen = [];
  /* Each step takes 15 s of the pass's 20 and changes nothing — the rows a step leaves alone must not come first for ever. */
  const step = async (row) => {
    seen.push(row.key);
    clock += 15_000;
    return row;
  };
  const { connection } = at("caring");
  const pass = (from) => {
    clock = from;
    return proCareMinute(ENV, { connection, store, key: {}, now: () => clock, step });
  };
  for (const from of [100, 110, 120]) assert.deepEqual(await pass(from * 60_000), { ran: true, cares: 4, acted: 0, skipped: 2 });
  assert.deepEqual(seen, [keys[0], keys[1], keys[2], keys[3], keys[0], keys[1]]);
});

test("the agent's pass: fees worth their fee go to the owner; under the stop everything goes out; a care taken back stops the row", async () => {
  /* Fees this small do not pay for the owner's wrapped-SOL account the collect would have to open: the agent waits. */
  const bare = at("caring");
  const bareStore = createMemoryGuardStore();
  await recordProCare({ owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: null }, { env: ENV, connection: bare.connection, store: bareStore, now: () => 1 });
  assert.deepEqual(await proCareMinute(ENV, { connection: bare.connection, store: bareStore, now: () => 50_000_000 }), { ran: true, cares: 1, acted: 0, skipped: 0 });
  assert.equal(bare.sent.length, 0);

  /* With the account there, they do. */
  const store = createMemoryGuardStore();
  const { connection, sent } = at("caring", wrappedSolOf(who.person));
  const deps = { connection, store, now: () => 50_000_000 };
  await recordProCare({ owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: null }, { ...deps, env: ENV });
  const first = await proCareMinute(ENV, deps);
  assert.deepEqual(first, { ran: true, cares: 1, acted: 1, skipped: 0 });
  /* The fees and the reward: two transactions, each the agent's, each a care's. */
  assert.equal(sent.length, 2);
  const [row] = await proCaresOf(who.person, { env: ENV, store });
  assert.deepEqual([row.status, row.lastClaimAt, row.events.map((event) => event.kind)], ["working", 50_000_000, ["claim"]]);
  assert.ok(row.events[0].valueInY > 0 && typeof row.events[0].signature === "string");
  /* The same window again: the tick is held, nothing is sent twice. */
  assert.deepEqual(await proCareMinute(ENV, deps), { ran: true, cares: 1, acted: 0, skipped: 1 });
  assert.equal(sent.length, 2);

  /* The stop, on a fresh book: the price is under it, so the liquidity goes out, then what the position earned. */
  const stopStore = createMemoryGuardStore();
  const stop = at("caring");
  await recordProCare({ owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: 400 }, { env: ENV, connection: stop.connection, store: stopStore, now: () => 1 });
  assert.deepEqual(await proCareMinute(ENV, { connection: stop.connection, store: stopStore, now: () => 60_000_000 }), { ran: true, cares: 1, acted: 1, skipped: 0 });
  assert.equal(stop.sent.length, 3, "the removal, the fees, the reward");
  const [stopped] = await proCaresOf(who.person, { env: ENV, store: stopStore });
  assert.deepEqual([stopped.status, stopped.stoppedBy, stopped.events.at(-1).kind], ["stopped", "stop", "exit"]);
  assert.ok(stopped.events.at(-1).valueInY > 200, `${stopped.events.at(-1).valueInY} USDC out`);
  assert.deepEqual(await proCareMinute(ENV, { connection: stop.connection, store: stopStore, now: () => 70_000_000 }), { ran: true, cares: 0, acted: 0, skipped: 0 }, "a stopped care is not read again");

  /* A care the owner took back on the chain: the row stops, nothing is sent. */
  const backStore = createMemoryGuardStore();
  const back = at("careTakenBack");
  const entry = { v: 1, kind: "dlmm-pro", key: proCareKey("devnet", who.holder, addresses.holderPosition), network: "devnet", owner: who.holder, pool: addresses.pool, nftMint: addresses.holderPosition, agent: who.agent, stopBelow: null, status: "working", stoppedBy: null, confirmed: true, lastClaimAt: null, events: [], createdAt: 0, updatedAt: 0 };
  const key = envKey(ENV.RYNTRA_AGENT_MANDATE_KEY).signer;
  const after = await proCareStep(entry, { env: ENV, network: "devnet", connection: back.connection, venue: back.venue, store: backStore, key, now: () => 5 });
  assert.deepEqual([after.status, after.stoppedBy], ["stopped", "owner"]);
  /* A position that is no longer the owner's. */
  const gone = await proCareStep({ ...entry, owner: who.stranger }, { env: ENV, network: "devnet", connection: back.connection, venue: back.venue, store: backStore, key, now: () => 5 });
  assert.deepEqual([gone.status, gone.stoppedBy], ["stopped", "gone"]);
  assert.equal(back.sent.length, 0);

  /* Closed, or with no key here, the pass sits still and says why. */
  assert.deepEqual(await proCareMinute({ ...ENV, RYNTRA_EARN_PRO: undefined }, deps), { ran: false, reason: "closed" });
  assert.deepEqual(await proCareMinute({ ...ENV, RYNTRA_AGENT_MANDATE_KEY: undefined }, deps), { ran: false, reason: "closed" });
  assert.deepEqual(await proCareMinute(ENV, { ...deps, key: null }), { ran: false, reason: "no agent key here" });
  assert.equal(openCosigners(null, ENV).length, 0);
  assert.equal(typeof checkEarnProSigned, "function");
});

test("a care's row is written before its approval leaves; the pass confirms it from the chain, or lets it go", async () => {
  const { connection, venue } = at("caring");
  const store = createMemoryGuardStore();
  const key = envKey(ENV.RYNTRA_AGENT_MANDATE_KEY).signer;
  const context = (now) => ({ env: ENV, network: "devnet", connection, venue, store, key, now: () => now, act: async () => ({ status: "landed", signature: "s" }) });
  /* The person's own position, approved on the chain: the pending row is confirmed by the first pass that reads it. */
  const { entry: held } = await holdProCare({ owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: null }, { env: ENV, store, now: () => 1_000 });
  assert.deepEqual([held.status, held.confirmed], ["working", false]);
  const confirmed = await proCareStep(held, context(2_000));
  assert.deepEqual([confirmed.status, confirmed.confirmed], ["working", true]);
  /* A position the chain shows no approval on: the pending row waits, then is let go — never read as «taken back». */
  const hold = await holdProCare({ owner: who.holder, pool: addresses.pool, nftMint: addresses.holderPosition, stopBelow: null }, { env: ENV, store, now: () => 1_000 });
  const pending = hold.entry;
  assert.equal(await proCareStep(pending, context(1_000 + PRO_CARE_PENDING_MS - 1)), pending, "still on its way");
  const gone = await proCareStep(pending, context(1_000 + PRO_CARE_PENDING_MS));
  assert.deepEqual([gone.status, gone.stoppedBy], ["stopped", null]);
  /* Nothing sent after all: the book goes back — no row where there was none, the old row where there was one. */
  await hold.undo();
  assert.equal(await store.collection("agentCare").get(pending.key), undefined);
  await store.collection("agentCare").set(pending.key, { ...gone, stoppedBy: "stop" });
  const again = await holdProCare({ owner: who.holder, pool: addresses.pool, nftMint: addresses.holderPosition, stopBelow: 120 }, { env: ENV, store, now: () => 9_000 });
  await again.undo();
  assert.deepEqual((await store.collection("agentCare").get(pending.key)).stoppedBy, "stop");
  /* Another tab's approval written since: this hold's undo leaves it as it is. */
  const first = await holdProCare({ owner: who.holder, pool: addresses.pool, nftMint: addresses.holderPosition, stopBelow: 120 }, { env: ENV, store, now: () => 10_000 });
  await holdProCare({ owner: who.holder, pool: addresses.pool, nftMint: addresses.holderPosition, stopBelow: 130 }, { env: ENV, store, now: () => 11_000 });
  await first.undo();
  assert.equal((await store.collection("agentCare").get(pending.key)).stopBelow, 130);
  /* A removal at the stop not seen land: kept as sent, nothing written of an exit yet. */
  const sent = await proCareStep({ ...held, confirmed: true, stopBelow: 400 }, { ...context(12_000), act: async () => ({ status: "unknown", signature: "u" }) });
  assert.deepEqual([sent.status, sent.exitSent?.signature, sent.events.length], ["working", "u", 0]);
  /* The next pass asks the signature first: not seen yet and young — the row waits, nothing is sent again. */
  const asking = (status) => Object.assign(Object.create(connection), { getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [status] }) });
  const never = async () => assert.fail("no second removal while the first may land");
  assert.equal(await proCareStep(sent, { ...context(12_000 + 60_000), connection: asking(null), act: never }), sent);
  /* Landed: the exit is written, as it was sent. */
  const landedRow = await proCareStep({ ...sent, stopBelow: null }, { ...context(12_000 + 60_000), connection: asking({ err: null, confirmationStatus: "confirmed" }) });
  assert.deepEqual([landedRow.exitSent, landedRow.events.find((event) => event.kind === "exit")?.signature], [null, "u"]);
  /* Refused: dropped — nothing of an exit. */
  const refusedRow = await proCareStep({ ...sent, stopBelow: null }, { ...context(12_000 + 60_000), connection: asking({ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }) });
  assert.deepEqual([refusedRow.exitSent, refusedRow.events.some((event) => event.kind === "exit")], [null, false]);
  /* Where no care is offered, nothing is held. */
  assert.equal(await holdProCare({ owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, stopBelow: null }, { env: { ...ENV, RYNTRA_AGENT_CARE: undefined }, store }), null);
});

test("a pass cut short mid-step: the next one goes on after the row it stopped at", async () => {
  const store = createMemoryGuardStore();
  const book = store.collection("agentCare");
  const keys = ["p:devnet:a:1", "p:devnet:b:2", "p:devnet:c:3", "p:devnet:d:4"];
  for (const key of keys) await book.set(key, { v: 1, kind: "dlmm-pro", key, network: "devnet", owner: "o", pool: "p", nftMint: "n", agent: "a", stopBelow: null, status: "working", stoppedBy: null, confirmed: true, lastClaimAt: null, events: [], createdAt: 0, updatedAt: 0 });
  const seen = [];
  let hang = true;
  /* The second row's step never ends — the function's minute is over before it does. */
  const step = (row) => {
    seen.push(row.key);
    return hang && row.key === keys[1] ? new Promise(() => {}) : Promise.resolve(row);
  };
  const { connection } = at("caring");
  void proCareMinute(ENV, { connection, store, key: {}, now: () => 100 * 60_000, step });
  await new Promise((resolve) => setTimeout(resolve, 200));
  hang = false;
  await proCareMinute(ENV, { connection, store, key: {}, now: () => 110 * 60_000, step });
  assert.deepEqual(seen, [keys[0], keys[1], keys[2], keys[3], keys[0], keys[1]]);
});

test("a removal not seen land is settled from the chain on the next pass", () => {
  const row = { v: 1, kind: "dlmm-pro", key: "p:devnet:o:n", network: "devnet", owner: "o", pool: "p", nftMint: "n", agent: "a", stopBelow: 100, status: "working", stoppedBy: null, confirmed: true, lastClaimAt: null, events: [], createdAt: 0, updatedAt: 0, exitSent: { signature: "s", at: 5, valueInY: 99 } };
  /* Landed: the exit, as it was sent. */
  const gone = settleExit(row, true);
  assert.deepEqual([gone.exitSent, gone.events.map((event) => [event.kind, event.valueInY, event.signature])], [null, [["exit", 99, "s"]]]);
  /* Refused, or too old to land: nothing is written of it. */
  const there = settleExit(row, false);
  assert.deepEqual([there.exitSent, there.events.length], [null, 0]);
  /* Nothing sent: the same row. */
  const plain = { ...row, exitSent: null };
  assert.equal(settleExit(plain, false), plain);
});

test("the stop watches the coin whose fall is the risk, whichever side of the pool it was made on", () => {
  const sol = { symbol: "SOL" };
  const usdc = { symbol: "USDC" };
  const jito = { symbol: "JitoSOL" };
  assert.deepEqual(watchOf({ solIsX: true, price: 150, x: sol, y: usdc }, "dollar"), { value: 150, coin: "SOL", unit: "USDC" });
  assert.deepEqual(watchOf({ solIsX: false, price: 1 / 150, x: usdc, y: sol }, "dollar"), { value: 150, coin: "SOL", unit: "USDC" });
  assert.deepEqual(watchOf({ solIsX: false, price: 1.26, x: jito, y: sol }, "staked-sol"), { value: 1.26, coin: "JitoSOL", unit: "SOL" });
  const flipped = watchOf({ solIsX: true, price: 1 / 1.26, x: sol, y: jito }, "staked-sol");
  assert.ok(Math.abs(flipped.value - 1.26) < 1e-12 && flipped.coin === "JitoSOL" && flipped.unit === "SOL", "a depeg of the staked SOL lowers what the stop watches, on either side");
});

test("the door asks the gate itself: a caller that forgot to is refused", () => {
  const { connection } = at("caring");
  assert.throws(() => earnProVenue("mainnet", connection), /not served/);
  assert.throws(() => earnProVenue("devnet", connection, {}), /not served/);
  assert.ok(earnProVenue("devnet", connection, { RYNTRA_EARN_PRO: "devnet" }));
});
