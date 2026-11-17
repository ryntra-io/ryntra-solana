// The lane between a person and DLMM Pro's limit orders: its gate, its Review and relay, its orders, and
// the agent's collecting pass — on the rehearsal's recorded state, with no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { deriveLimitOrder, findNftAccount } from "@meteora-ag/dlmm-pro-sdk";

import { readFixture, rpcConnection, snapshotSource } from "../core/venues/meteora-dlmm-pro/fixture-kit.mjs";

const { DLMM_PRO_LIMITS_MAINNET, DLMM_PRO_OPEN_TO_PEOPLE } = await import("../core/venues/meteora-dlmm-pro/gate.ts");
const { createDlmmProVenue } = await import("../core/venues/meteora-dlmm-pro/venue.server.ts");
const { DLMM_PRO_PROGRAM } = await import("../core/venues/meteora-dlmm-pro/sdk.server.ts");
const { MAINNET_USDC, PRO_LIMITS_START, WRAPPED_SOL, proLimitsGate, proLimitsWindow, proQuotes } = await import("./gate.ts");
const { forgetProMarkets, proCollectPass, proMarket, proOrders, proQuote, proReview, proSubmit } = await import("./service.ts");
const { readProTicket } = await import("./ticket.ts");

const fixture = readFixture(new URL("../core/venues/meteora-dlmm-pro/fixtures/rehearsal.json.gz", import.meta.url));
const { who, addresses } = fixture;
/* The rehearsal's keys live only in its process: each is the hash of its name. */
const keyOf = (name) => Keypair.fromSeed(createHash("sha256").update(`city-211/${name}`).digest());
const MAKER = keyOf("maker");
const AGENT = keyOf("agent");
assert.equal(MAKER.publicKey.toBase58(), who.maker);
assert.equal(AGENT.publicKey.toBase58(), who.agent);

const ENV = { BETA_TOKEN_SECRET: "a-test-secret-of-enough-length" };
const key = (address) => new PublicKey(address);
const ata = (mint, owner, program) => getAssociatedTokenAddressSync(key(mint), key(owner), true, program).toBase58();
const lands = () => ({ err: null, logs: [], unitsConsumed: 0, accounts: null, returnData: null });

/** A moment of the rehearsal as a network that takes what it is sent: every send lands, and is kept. */
function network(moment, change = (accounts) => accounts) {
  const snapshot = fixture.snapshots[moment];
  const source = snapshotSource({ ...snapshot, accounts: change({ ...snapshot.accounts }) }, {}, lands);
  const sent = [];
  const connection = rpcConnection({
    ...source,
    send: (bytes) => {
      const tx = VersionedTransaction.deserialize(bytes);
      sent.push(tx);
      return createHash("sha256").update(bytes).digest("hex");
    },
    status: () => ({ slot: 1, confirmations: null, err: null, confirmationStatus: "confirmed" }),
  });
  return { connection, venue: createDlmmProVenue({ connection, referralOwner: who.referral }), sent };
}
/* The rehearsal's pool is quoted in USDC at its mainnet address: the gate of a network that has it. */
const QUOTES = [
  { mint: WRAPPED_SOL, symbol: "SOL", decimals: 9, maxRaw: null, minRungRaw: 2_000_000n },
  { mint: addresses.usdc, symbol: "USDC", decimals: 6, maxRaw: null, minRungRaw: 500_000n },
];
function deps(moment, options = {}) {
  forgetProMarkets();
  const on = network(moment, options.change);
  return {
    sent: on.sent,
    deps: {
      env: ENV,
      gate: () => options.gate ?? { open: true, network: "devnet", quotes: options.quotes ?? QUOTES },
      on: async () => on,
      collector: () => (options.collector === undefined ? who.agent : options.collector),
      referral: () => who.referral,
      relayMs: 2_000,
      pollMs: 5,
      now: options.now,
    },
  };
}
const intent = { action: "buy", farBps: 3_000, amountRaw: "250000000" };
/** What the wallet does with a Review: signs each transaction, the fee payer's slot alone. */
function signedBy(wallet, transactions) {
  return transactions.map((wire) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    tx.sign([wallet]);
    return Buffer.from(tx.serialize()).toString("base64");
  });
}
/** The moment the bids were filled, with the holder's own account of the coin standing — a collector opens none. */
const withMakerCoin = (accounts) => {
  const source = accounts[ata(addresses.coin, who.buyer, TOKEN_2022_PROGRAM_ID)];
  const data = Buffer.from(source.data, "base64");
  key(who.maker).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(0n, 64);
  accounts[ata(addresses.coin, who.maker, TOKEN_2022_PROGRAM_ID)] = { ...source, data: data.toString("base64") };
  return accounts;
};

/** Both orders of the moment let the agent in: the approval of nothing on each holder's NFT account and each order's bit. */
const delegateBoth = (accounts) => {
  for (const [nftMint, owner] of [[addresses.asks, who.buyer], [addresses.bids, who.maker]]) {
    const nft = findNftAccount(key(nftMint), key(owner)).toBase58();
    const order = deriveLimitOrder(key(nftMint), key(DLMM_PRO_PROGRAM)).toBase58();
    if (!accounts[nft] || !accounts[order]) continue;
    const nftData = Buffer.from(accounts[nft].data, "base64");
    nftData.writeUInt32LE(1, 72);
    key(who.agent).toBuffer().copy(nftData, 76);
    nftData.writeBigUInt64LE(0n, 121);
    const orderData = Buffer.from(accounts[order].data, "base64");
    orderData.writeUInt32LE(1, 104);
    accounts[nft] = { ...accounts[nft], data: nftData.toString("base64") };
    accounts[order] = { ...accounts[order], data: orderData.toString("base64") };
  }
  return accounts;
};

test("the gate: closed unless a deployment names a network; mainnet stays closed whatever a deployment says", () => {
  assert.equal(DLMM_PRO_OPEN_TO_PEOPLE, false);
  assert.equal(DLMM_PRO_LIMITS_MAINNET, false, "a change of code");
  assert.deepEqual(proLimitsGate({}), { open: false });
  for (const value of ["", "open", "OPEN", "true", "1", "Mainnet", "testnet"]) assert.deepEqual(proLimitsGate({ RYNTRA_PRO_LIMITS: value }), { open: false }, value);
  assert.deepEqual(proLimitsGate({ RYNTRA_PRO_LIMITS: "mainnet" }), { open: false }, "no switch of a deployment opens mainnet");
  assert.deepEqual(proLimitsGate({ RYNTRA_PRO_LIMITS: "mainnet", NEXT_PUBLIC_RYNTRA_CITY_PRO_LIMITS: "mainnet", RYNTRA_PRO_LIMITS_CAP_TIMES: "10" }), { open: false });
  const devnet = proLimitsGate({ RYNTRA_PRO_LIMITS: " devnet " });
  assert.equal(devnet.open && devnet.network, "devnet");
  assert.ok(devnet.quotes.every((quote) => quote.maxRaw === null), "devnet's test money has no cap");
  /* The window's switch names a network to draw the panel for, and opens nothing. */
  assert.equal(proLimitsWindow("devnet"), "devnet");
  assert.equal(proLimitsWindow("mainnet"), "mainnet");
  assert.equal(proLimitsWindow("open"), null);
  assert.equal(proLimitsWindow(undefined), null);
});

test("the caps a mainnet ladder would start with: 1 SOL or 200 USDC a ladder, raised by a variable ten times at the most", () => {
  const start = proQuotes({}, "mainnet");
  assert.deepEqual(start.map((quote) => [quote.mint, quote.symbol, quote.maxRaw]), [[WRAPPED_SOL, "SOL", PRO_LIMITS_START.sol], [MAINNET_USDC, "USDC", PRO_LIMITS_START.usdc]]);
  assert.equal(proQuotes({ RYNTRA_PRO_LIMITS_CAP_TIMES: "5" }, "mainnet")[1].maxRaw, 1_000_000_000n);
  for (const value of ["11", "1000", "9999999"]) assert.equal(proQuotes({ RYNTRA_PRO_LIMITS_CAP_TIMES: value }, "mainnet")[0].maxRaw, 10_000_000_000n, value);
  for (const value of ["0", "-3", "2.5", "many", ""]) assert.equal(proQuotes({ RYNTRA_PRO_LIMITS_CAP_TIMES: value }, "mainnet")[0].maxRaw, PRO_LIMITS_START.sol, value);
});

test("closed, every way in answers as if it were not there — and builds, reads and signs nothing", async () => {
  const { deps: closed, sent } = deps("ordersResting", { gate: { open: false } });
  const asked = [];
  closed.on = () => {
    asked.push("on");
    return null;
  };
  for (const answer of [
    await proMarket(addresses.coin, closed),
    await proQuote({ mint: addresses.coin, intent }, closed),
    await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent, agent: true }, closed),
    await proReview({ action: "close", owner: who.maker, pool: addresses.pool, nftMint: addresses.bids }, closed),
    await proSubmit({ ticket: "x.y", signed: [] }, closed),
    await proOrders({ owner: who.maker }, closed),
    await proCollectPass(closed, { address: who.agent, sign: async () => assert.fail("a closed lane asks no key") }),
  ]) {
    assert.deepEqual(answer, { ok: false, code: "CAPABILITY_UNAVAILABLE", message: "Ladders are not served here." });
  }
  assert.deepEqual([asked, sent], [[], []], "no endpoint was even asked for");
});

test("the coin's market is its deepest pool against a quote coin: the price, the bonus as one number, the slider's ends", async () => {
  const { deps: open } = deps("ordersResting");
  const { value: market } = await proMarket(addresses.coin, open);
  assert.equal(market.pool, addresses.pool);
  assert.deepEqual(market.coin, { mint: addresses.coin, decimals: 6 });
  assert.deepEqual(market.quote, { mint: addresses.usdc, symbol: "USDC", decimals: 6 });
  assert.ok(market.price > 0.000005 && market.price < 0.00005, String(market.price));
  assert.deepEqual(market.reach, { buyBps: 9_900, sellBps: 990_000 });
  assert.ok(market.bonus.ownerBps > 0 && Math.abs(market.bonus.referralBps * 4 - market.bonus.ownerBps) < 0.05, "Ryntra's part is a fifth of the maker's half");
  assert.equal(market.placing, true);
  assert.equal(market.collector, who.agent);
  assert.deepEqual(market.cap, { maxRaw: null, minRungRaw: "500000" });
  /* A quote coin is nobody's market, nor is a coin with no pool; a pool quoted in a coin the network does not name is not found. */
  assert.deepEqual(await proMarket(addresses.usdc, open), { ok: true, value: null });
  assert.deepEqual(await proMarket(who.stranger, open), { ok: true, value: null });
  const { deps: other } = deps("ordersResting", { quotes: [QUOTES[0]] });
  assert.deepEqual(await proMarket(addresses.coin, other), { ok: true, value: null });
});

test("a ladder is quoted for the coin; what cannot be placed is told with a reason", async () => {
  const { deps: open } = deps("ordersResting");
  const { value: quote } = await proQuote({ mint: addresses.coin, intent }, open);
  assert.equal(quote.action, "buy");
  assert.equal(quote.rungs.length, 25);
  assert.deepEqual({ restsIn: quote.restsIn, paysIn: quote.paysIn }, { restsIn: addresses.usdc, paysIn: addresses.coin });
  assert.equal(quote.amountRaw, "250000000");
  assert.equal(quote.bonus.referral, who.referral);
  assert.ok(!("plan" in quote) && !("tickId" in quote.rungs[0]), "ticks stay under the hood");
  assert.equal((await proQuote({ mint: addresses.coin, intent: { ...intent, farBps: 10_000 } }, open)).code, "VALIDATION_ERROR");
  assert.equal((await proQuote({ mint: who.stranger, intent }, open)).code, "PRO_LIMIT_NO_MARKET");
});

test("placing: one approval of the placing and the person's own accounts; the relay sends only those bytes, and signs the order's fresh key after the wallet", async () => {
  const { deps: open, sent } = deps("ordersResting");
  const answer = await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent, agent: true }, open);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const review = answer.value;
  assert.equal(review.agent, true);
  assert.equal(review.transactions.length, 2, "the placing, then the maker's own account of the coin it will be paid in");
  assert.equal(review.quote.rungs.length, 25);
  assert.ok(Number(review.rentLamports) > 25_000_000 && Number(review.accountsLamports) > 1_000_000 && Number(review.networkFeeLamports) === 15_000, JSON.stringify([review.rentLamports, review.accountsLamports, review.networkFeeLamports]));
  /* The bytes the wallet is shown are signed by nobody: the fresh key's slot is empty, and the key is in the ticket, sealed. */
  const shown = VersionedTransaction.deserialize(Buffer.from(review.transactions[0], "base64"));
  assert.equal(shown.message.header.numRequiredSignatures, 2);
  assert.ok(shown.signatures.every((signature) => signature.every((byte) => byte === 0)));
  const ticket = readProTicket(review.ticket, ENV, Date.now());
  assert.deepEqual([ticket.ticket.action, ticket.ticket.owner, ticket.ticket.pool, ticket.ticket.nftMint, ticket.ticket.network], ["place", who.maker, addresses.pool, review.nftMint, "devnet"]);
  assert.ok(!Buffer.from(review.ticket.split(".")[0], "base64url").toString().includes(Buffer.from(MAKER.secretKey).toString("base64").slice(0, 16)));

  const signed = signedBy(MAKER, review.transactions);
  const relay = await proSubmit({ ticket: review.ticket, signed }, open);
  assert.deepEqual([relay.ok, relay.value.settled, relay.value.results.map((result) => result.state)], [true, true, ["LANDED", "LANDED"]]);
  assert.equal(sent.length, 2);
  /* What went out: the wallet's signature and the fresh mint's, both real, over the bytes the Review showed. */
  const [placed] = sent;
  assert.deepEqual(placed.message.staticAccountKeys.slice(0, 2).map((entry) => entry.toBase58()).sort(), [who.maker, review.nftMint].sort());
  assert.ok(placed.signatures.every((signature) => signature.some((byte) => byte !== 0)));
  assert.deepEqual(Buffer.from(placed.message.serialize()), Buffer.from(shown.message.serialize()));

  /* Other bytes, a missing signature, another wallet's signature, a changed ticket, an old ticket: nothing is sent. */
  const before = sent.length;
  const other = await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent: { ...intent, amountRaw: "260000000" }, agent: true }, open);
  assert.equal((await proSubmit({ ticket: review.ticket, signed: signedBy(MAKER, other.value.transactions) }, open)).code, "PRO_LIMIT_SIGNED_OTHER_BYTES");
  assert.equal((await proSubmit({ ticket: review.ticket, signed: review.transactions }, open)).code, "PRO_LIMIT_SIGNED_OTHER_BYTES");
  assert.equal((await proSubmit({ ticket: review.ticket, signed: signed.slice(0, 1) }, open)).code, "PRO_LIMIT_SIGNED_OTHER_BYTES");
  assert.equal((await proSubmit({ ticket: review.ticket, signed: [...signed].reverse() }, open)).code, "PRO_LIMIT_SIGNED_OTHER_BYTES");
  const added = (() => {
    const tx = VersionedTransaction.deserialize(Buffer.from(review.transactions[1], "base64"));
    const message = TransactionMessage.decompile(tx.message);
    message.instructions.push(SystemProgram.transfer({ fromPubkey: MAKER.publicKey, toPubkey: key(who.stranger), lamports: 1_000_000 }));
    const next = new VersionedTransaction(message.compileToV0Message());
    next.sign([MAKER]);
    return Buffer.from(next.serialize()).toString("base64");
  })();
  assert.equal((await proSubmit({ ticket: review.ticket, signed: [signed[0], added] }, open)).code, "PRO_LIMIT_SIGNED_OTHER_BYTES");
  /* A changed ticket: a character inside its seal (the last one of base64url carries only four bits, so the change is made where every bit counts). */
  const at = review.ticket.length - 10;
  const tampered = `${review.ticket.slice(0, at)}${review.ticket[at] === "A" ? "B" : "A"}${review.ticket.slice(at + 1)}`;
  assert.equal((await proSubmit({ ticket: tampered, signed }, open)).code, "VALIDATION_ERROR");
  assert.equal((await proSubmit({ ticket: review.ticket, signed }, { ...open, now: () => Date.now() + 120_000 })).code, "PRO_LIMIT_REVIEW_EXPIRED");
  assert.equal((await proSubmit({ ticket: review.ticket, signed }, { ...open, gate: () => ({ open: true, network: "mainnet", quotes: QUOTES }) })).code, "VALIDATION_ERROR");
  assert.equal(sent.length, before);
  /* A priority price the wallet adds on signing is its own to add. */
  const tipped = (() => {
    const tx = VersionedTransaction.deserialize(Buffer.from(review.transactions[1], "base64"));
    const message = TransactionMessage.decompile(tx.message);
    message.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }));
    const next = new VersionedTransaction(message.compileToV0Message());
    next.sign([MAKER]);
    return Buffer.from(next.serialize()).toString("base64");
  })();
  assert.equal((await proSubmit({ ticket: review.ticket, signed: [signed[0], tipped] }, open)).ok, true);
});

test("placing without the agent is the placing alone; a cap and a least price are told before anything is signed", async () => {
  const { deps: open } = deps("ordersResting");
  const alone = await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent, agent: false }, open);
  assert.deepEqual([alone.value.agent, alone.value.transactions.length, alone.value.accountsLamports], [false, 1, "0"]);
  const nobody = await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent, agent: true }, deps("ordersResting", { collector: null }).deps);
  assert.deepEqual([nobody.value.agent, nobody.value.transactions.length], [false, 1], "with no collector on the network nobody is named");
  /* The most one ladder may rest, in the quote coin: 200 USDC here. */
  const capped = deps("ordersResting", { quotes: [QUOTES[0], { ...QUOTES[1], maxRaw: 200_000_000n }] }).deps;
  assert.equal((await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent, agent: true }, capped)).code, "PRO_LIMIT_CAP");
  assert.equal((await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent: { ...intent, amountRaw: "200000000" }, agent: true }, capped)).ok, true);
  /* A price the agent would collect holds at least half a dollar: 25 prices of 0,4 USDC are refused, placed without the agent they are not. */
  assert.equal((await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent: { ...intent, amountRaw: "10000000" }, agent: true }, open)).code, "PRO_LIMIT_CAP");
  assert.equal((await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent: { ...intent, amountRaw: "10000000" }, agent: false }, open)).ok, true);
  /* A wallet that does not hold it. */
  assert.equal((await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent: { ...intent, amountRaw: "900000000000000" }, agent: false }, open)).code, "PRO_LIMIT_BALANCE_LOW");
  /* No key to seal with: nothing is built for anyone. */
  assert.equal((await proReview({ action: "place", owner: who.maker, mint: addresses.coin, intent, agent: false }, { ...open, env: {} })).code, "UNAVAILABLE");
});

test("a wallet's ladders are read from the chain: what rests, what filled and at what price, the bonus waiting, whether the agent collects", async () => {
  const { deps: resting } = deps("ordersResting");
  const { value: before } = await proOrders({ owner: who.maker, mint: addresses.coin }, resting);
  assert.equal(before.length, 1);
  assert.deepEqual([before[0].nftMint, before[0].action, before[0].state, before[0].prices, before[0].filledPrices, before[0].agent], [addresses.bids, "buy", "resting", 5, 0, false]);
  assert.ok(before[0].highPrice > before[0].lowPrice && before[0].filledPrice === null);
  /* The maker let the agent in, and has no account of the coin yet: the agent could collect nothing — «paused», not «collects». */
  const { deps: bare } = deps("bidsFilled");
  const paused = (await proOrders({ owner: who.maker }, bare)).value.find((entry) => entry.nftMint === addresses.bids);
  assert.deepEqual([paused.agent, paused.agentReady, paused.agentOffered], [true, false, true]);
  const { deps: filled } = deps("bidsFilled", { change: withMakerCoin });
  const { value: after } = await proOrders({ owner: who.maker }, filled);
  const order = after.find((entry) => entry.nftMint === addresses.bids);
  assert.ok(order.state === "filled" || order.state === "filling", order.state);
  assert.deepEqual([order.agent, order.agentReady], [true, true], "the maker let the agent collect, and its accounts stand");
  assert.equal(order.partialPrices >= 0, true);
  /* The asks named no referral: the agent is not offered on them. */
  const { deps: filling } = deps("ordersFilling");
  const asks = (await proOrders({ owner: who.buyer }, filling)).value.find((entry) => entry.nftMint === addresses.asks);
  assert.deepEqual([asks.agent, asks.agentOffered], [false, false]);
  assert.ok(order.filledPrices > 0 && BigInt(order.proceedsRaw) > 0n && BigInt(order.bonus.ownerRaw) > 0n);
  assert.ok(order.filledPrice <= order.highPrice * 1.0001 && order.filledPrice >= order.lowPrice * 0.9999, `what filled, filled at the order's own prices: ${order.lowPrice} ≤ ${order.filledPrice} ≤ ${order.highPrice}`);
  assert.equal(BigInt(order.bonus.referralRaw) * 4n <= BigInt(order.bonus.ownerRaw), true);
  /* Another coin's window shows none of them; a wallet with none has none. */
  assert.deepEqual((await proOrders({ owner: who.maker, mint: addresses.coinB }, filled)).value, []);
  assert.deepEqual((await proOrders({ owner: who.stranger }, filled)).value, []);
});

test("taking what filled, cancelling, and the agent's leave are each one Review of the wallet's own", async () => {
  const { deps: open } = deps("ordersFilling");
  /* The buyer's asks: some prices filled, some resting — taking collects the filled ones and leaves the rest. */
  const take = await proReview({ action: "collect", owner: who.buyer, pool: addresses.pool, nftMint: addresses.asks }, open);
  assert.equal(take.ok, true, JSON.stringify(take));
  assert.equal(take.value.action, "collect");
  assert.ok(BigInt(take.value.receives.yRaw) > 0n && take.value.receives.y === addresses.usdc);
  assert.equal(take.value.referral, null, "the asks named nobody");
  /* Cancelling takes everything and returns the order's rent. */
  const cancel = await proReview({ action: "close", owner: who.buyer, pool: addresses.pool, nftMint: addresses.asks }, open);
  assert.equal(cancel.value.action, "close");
  assert.ok(Number(cancel.value.rentLamports) <= 0 && BigInt(cancel.value.receives.xRaw) > 0n, "the unfilled coin comes back with the proceeds");
  /* Nothing filled yet: nothing to take. */
  const { deps: resting } = deps("ordersResting");
  assert.equal((await proReview({ action: "collect", owner: who.buyer, pool: addresses.pool, nftMint: addresses.asks }, resting)).code, "PRO_LIMIT_NOTHING_TO_DO");
  /* Somebody else's order is nobody's to take. */
  assert.equal((await proReview({ action: "close", owner: who.stranger, pool: addresses.pool, nftMint: addresses.asks }, open)).code, "VALIDATION_ERROR");
  /* Letting the agent in after the placing, and taking that back — only on an order placed here: the asks named no referral, so the agent does not collect them. */
  assert.equal((await proReview({ action: "delegate", owner: who.buyer, pool: addresses.pool, nftMint: addresses.asks, agent: true }, open)).code, "PRO_LIMIT_REFUSED");
  const lets = await proReview({ action: "delegate", owner: who.maker, pool: addresses.pool, nftMint: addresses.bids, agent: true }, open);
  assert.deepEqual([lets.ok, lets.value.agent, lets.value.action], [true, true, "delegate"]);
  const back = await proReview({ action: "delegate", owner: who.maker, pool: addresses.pool, nftMint: addresses.bids, agent: false }, open);
  assert.deepEqual([back.value.agent, back.value.transactions.length], [false, 1]);
});

test("the agent's pass collects what filled for its holder, opens nothing, and signs only what its judge lets it", async () => {
  const signer = { address: who.agent, sign: async (message) => (await import("@noble/curves/ed25519")).ed25519.sign(message, AGENT.secretKey.subarray(0, 32)) };
  /* The holder's account of the coin stands: the bids' filled prices are collected, signed by the agent alone. */
  const { deps: ready, sent } = deps("bidsFilled", { change: withMakerCoin });
  const pass = await proCollectPass(ready, signer);
  assert.equal(pass.ok, true, JSON.stringify(pass));
  const line = pass.value.find((entry) => entry.order === addresses.bids);
  assert.deepEqual([line.did, line.why], ["collected", null]);
  assert.equal(sent.length, 1);
  const [collect] = sent;
  assert.equal(collect.message.header.numRequiredSignatures, 1);
  assert.equal(collect.message.staticAccountKeys[0].toBase58(), who.agent);
  const keys = collect.message.staticAccountKeys.map((entry) => entry.toBase58());
  const call = collect.message.compiledInstructions.find((ix) => keys[ix.programIdIndex] === DLMM_PRO_PROGRAM);
  /* Where the money goes: the maker's own accounts — the program would take no other. */
  assert.deepEqual([keys[call.accountKeyIndexes[9]], keys[call.accountKeyIndexes[10]]], [ata(addresses.coin, who.maker, TOKEN_2022_PROGRAM_ID), ata(addresses.usdc, who.maker, key("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"))]);
  assert.equal(keys[call.accountKeyIndexes[7]], deriveLimitOrder(key(addresses.bids), key(DLMM_PRO_PROGRAM)).toBase58());
  assert.equal(keys[call.accountKeyIndexes[8]], findNftAccount(key(addresses.bids), key(who.maker)).toBase58());

  /* As the rehearsal left it — the holder with no account of the coin — the agent opens none and leaves the order to its holder. */
  const { deps: bare, sent: none } = deps("bidsFilled");
  const left = await proCollectPass(bare, signer);
  assert.deepEqual([left.value.find((entry) => entry.order === addresses.bids).did, none.length], ["skipped", 0]);
  assert.match(left.value.find((entry) => entry.order === addresses.bids).why, /the holder opens it/);
  /* Nothing filled: nothing collected. Nobody let the agent in: nothing found. */
  assert.deepEqual((await proCollectPass(deps("ordersResting").deps, signer)).value, []);
  /* A key that is not the network's collector signs nothing, and a pass with no key does not run. */
  assert.equal((await proCollectPass(ready, { address: who.stranger, sign: signer.sign })).code, "UNAVAILABLE");
  assert.equal((await proCollectPass(ready, null)).code, "UNAVAILABLE");
  /* A fill smaller than the least one price holds is left for the person: the collector's fee is not spent on dust. */
  const { deps: dusty, sent: dustSent } = deps("bidsFilled", { change: withMakerCoin, quotes: [QUOTES[0], { ...QUOTES[1], minRungRaw: 10n ** 15n }] });
  const small = await proCollectPass(dusty, signer);
  assert.deepEqual([small.value.find((entry) => entry.order === addresses.bids).did, dustSent.length], ["nothing", 0]);
  /* Wherever the pass starts in the list, it walks all of it: two orders let the agent in, the asks filling, the bids resting. */
  for (const start of [0, 1, 7]) {
    const { deps: rotated, sent: rotatedSent } = deps("ordersFilling", { change: delegateBoth });
    const lines = (await proCollectPass({ ...rotated, referral: () => null, passStart: () => start }, signer)).value;
    assert.deepEqual(lines.map((entry) => entry.order).sort(), [addresses.asks, addresses.bids].sort(), `start ${start}: both looked at`);
    assert.equal(lines.find((entry) => entry.order === addresses.asks)?.did, "collected", `start ${start}`);
    assert.equal(lines.find((entry) => entry.order === addresses.bids)?.did, "nothing", `start ${start}`);
    assert.equal(rotatedSent.length, 1);
    if (start === 0 || start === 1) assert.equal(lines[0].order, [addresses.asks, addresses.bids].find((_, index) => index === start) ?? lines[0].order);
  }
  /* The asks' fill is paid in USDC: under the least one price holds, the pass leaves it — the sale side of the worth. */
  const { deps: dustAsk, sent: dustAskSent } = deps("ordersFilling", { change: delegateBoth, quotes: [QUOTES[0], { ...QUOTES[1], minRungRaw: 10n ** 15n }] });
  const dustLines = (await proCollectPass({ ...dustAsk, referral: () => null }, signer)).value;
  assert.deepEqual([dustLines.find((entry) => entry.order === addresses.asks)?.did, dustAskSent.length], ["nothing", 0]);
  /* Out of time: it starts on nothing more. */
  const { deps: late, sent: lateSent } = deps("bidsFilled", { change: withMakerCoin });
  assert.deepEqual([(await proCollectPass({ ...late, passMs: -1 }, signer)).value, lateSent.length], [[], 0]);
  /* A key that signs as somebody else is caught before anything is sent. */
  const { deps: again, sent: unsent } = deps("bidsFilled", { change: withMakerCoin });
  const forged = await proCollectPass(again, { address: who.agent, sign: async (message) => (await import("@noble/curves/ed25519")).ed25519.sign(message, MAKER.secretKey.subarray(0, 32)) });
  assert.deepEqual([forged.value.find((entry) => entry.order === addresses.bids).did, unsent.length], ["failed", 0]);
});
