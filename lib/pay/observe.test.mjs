import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { assemblePaymentRequest, derivePaymentStatus } from "./model.ts";
import { creditedToRecipient, readReferencePayments, REFERENCE_TRANSACTIONS_MAX, refreshPaymentSettlement } from "./observe.ts";
import { readPaymentSettlement, writePaymentSettlement } from "./store.ts";

const RECIPIENT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAYER = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const RECIPIENT_USDC_ATA = "7Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5j";
const RECIPIENT_BONK_ATA = "8Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5k";

function observed(overrides = {}) {
  return {
    ok: true,
    transactionSucceeded: true,
    transactionError: null,
    invokedPrograms: [],
    postTokenAccounts: [],
    observedEffects: [],
    observation: {
      balanceDeltas: [],
      lamportBalanceDeltas: [
        { account: PAYER, rawDelta: "-1000005000" },
        { account: RECIPIENT, rawDelta: "1000000000" },
      ],
      blockTime: null,
    },
    ...overrides,
  };
}

test("a SOL request is credited by the recipient's lamport delta", () => {
  const credit = creditedToRecipient(observed(), { recipient: RECIPIENT, mint: null });
  assert.deepEqual(credit, { amountRaw: "1000000000", mint: null });
});

test("a token request is credited by the recipient-owned account of that mint", () => {
  const credit = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_USDC_ATA, mint: USDC, owner: RECIPIENT, tokenProgram: null, amountRaw: "12500000", decimals: 6 },
      ],
      observation: {
        balanceDeltas: [{ account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "12500000" }],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(credit, { amountRaw: "12500000", mint: USDC });
});

test("money in another token is reported as that token, never as the requested one", () => {
  const credit = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_BONK_ATA, mint: BONK, owner: RECIPIENT, tokenProgram: null, amountRaw: "5", decimals: 5 },
      ],
      observation: {
        balanceDeltas: [{ account: RECIPIENT_BONK_ATA, mint: BONK, rawDelta: "5" }],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(credit, { amountRaw: "5", mint: BONK });
});

test("a transaction that credited somebody else counts as nothing for this recipient", () => {
  const credit = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_USDC_ATA, mint: USDC, owner: PAYER, tokenProgram: null, amountRaw: "1", decimals: 6 },
      ],
      observation: {
        balanceDeltas: [{ account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "12500000" }],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(credit, { amountRaw: "0", mint: USDC });
});

/* ---- FIX-PAY-1 (SEC-1): carrying the reference is not paying ---- */

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const PAYER_USDC_ATA = "9Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5m";

/** What an attacker's memo transaction looks like: the payer's fee, the reference read-only, nothing to the recipient. */
const emptyTransaction = () =>
  observed({
    observation: {
      balanceDeltas: [],
      lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-10000" }],
      blockTime: null,
    },
  });

test("attack: an empty transaction with the reference credits the recipient nothing, in SOL or a token", () => {
  assert.equal(creditedToRecipient(emptyTransaction(), { recipient: RECIPIENT, mint: null }).amountRaw, "0");
  assert.equal(creditedToRecipient(emptyTransaction(), { recipient: RECIPIENT, mint: USDC }).amountRaw, "0");
});

test("a token credit sums the recipient's accounts of that mint, and reads the Token-2022 fee withheld on the way", () => {
  const credit = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_USDC_ATA, mint: USDC, owner: RECIPIENT, tokenProgram: TOKEN_2022, amountRaw: "12375000", decimals: 6 },
        { account: PAYER_USDC_ATA, mint: USDC, owner: PAYER, tokenProgram: TOKEN_2022, amountRaw: "0", decimals: 6 },
      ],
      observation: {
        balanceDeltas: [
          { account: PAYER_USDC_ATA, mint: USDC, rawDelta: "-12500000" },
          { account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "12375000" },
        ],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(credit, { amountRaw: "12375000", mint: USDC, feeWithheldRaw: "125000" });

  /* A classic SPL token has no transfer fee: a shortfall there is not called one. */
  const classic = creditedToRecipient(
    observed({
      postTokenAccounts: [{ account: RECIPIENT_USDC_ATA, mint: USDC, owner: RECIPIENT, tokenProgram: TOKEN_CLASSIC, amountRaw: "1", decimals: 6 }],
      observation: {
        balanceDeltas: [
          { account: PAYER_USDC_ATA, mint: USDC, rawDelta: "-2000000" },
          { account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "1000000" },
        ],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(classic, { amountRaw: "1000000", mint: USDC });
});

/* A chain the tests answer for: signatures under the reference and each transaction's JSON. */
function chain(transactions) {
  const keys = [PAYER, RECIPIENT, "11111111111111111111111111111111", REFERENCE];
  const rpc = {
    /* Newest first, `limit` per page, `before` the cursor of the page before — as the node pages. */
    getSignaturesForAddress: (_address, options = {}) => ({
      send: async () => {
        const all = [...transactions].reverse().map((entry) => ({ signature: entry.signature, err: entry.err ?? null, blockTime: 1_790_000_000 }));
        const from = options.before ? all.findIndex((row) => row.signature === options.before) + 1 : 0;
        return all.slice(from, from + (options.limit ?? 1_000));
      },
    }),
    getTransaction: (signature) => ({
      send: async () => {
        const entry = transactions.find((candidate) => candidate.signature === signature);
        return {
          slot: 1,
          blockTime: 1_790_000_000,
          meta: { err: null, fee: 5000, preBalances: entry.pre, postBalances: entry.post, preTokenBalances: entry.preTokens ?? [], postTokenBalances: entry.postTokens ?? [] },
          transaction: { message: { accountKeys: keys, instructions: [] } },
        };
      },
    }),
  };
  return { network: "mainnet", endpoint: "test", endpoints: ["test"], rpc, timeoutMs: 1_000, retries: 0, maxResponseBytes: 1_000_000, attempts: () => [], answered: () => null, host: () => "test", source: () => ({ ref: "test", label: "test" }) };
}

const REFERENCE = "7Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5j";
const SOL_RECIPIENT = "Hx6LbkMHe69DYawhPyVNs8Apa6tyfogfzQV6a7XkwBUU";
const ATTACK_SIGNATURES = [
  "5VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1kZ3mA5nB7oC9p",
  "4VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1kZ3mA5nB7oC9p",
];
const REAL_SIGNATURE = "3VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1kZ3mA5nB7oC9p";
/* The attacker pays only the network fee; the recipient's lamports do not move. */
const empty = (signature) => ({ signature, pre: [1_000_000_000, 5_000_000_000, 1, 0], post: [999_990_000, 5_000_000_000, 1, 0] });

function solRequest(amount) {
  const assembled = assemblePaymentRequest({
    id: "3fJ9s2kQ8vB1xR7pL",
    reference: REFERENCE,
    recipient: SOL_RECIPIENT,
    input: { mint: null, amount, description: null, expiration: "24h" },
    decimals: 9,
    symbol: "SOL",
    now: new Date("2026-10-25T12:00:00.000Z"),
  });
  assert.ok(assembled.ok);
  return assembled.request;
}

/* The chain above names the recipient at index 1; the request must name the same wallet. */
function chainFor(recipient, transactions) {
  const handle = chain(transactions);
  const keys = [PAYER, recipient, "11111111111111111111111111111111", REFERENCE];
  const original = handle.rpc.getTransaction;
  handle.rpc.getTransaction = (signature) => ({
    send: async () => ({ ...(await original(signature).send()), transaction: { message: { accountKeys: keys, instructions: [] } } }),
  });
  return handle;
}

test("attack, end to end: empty transactions with the reference never make a request «Paid»", async () => {
  const now = new Date("2026-10-25T12:01:00.000Z");
  for (const amount of [null, "1"]) {
    const store = createMemoryGuardStore();
    const request = solRequest(amount);
    const handle = chainFor(request.recipient, ATTACK_SIGNATURES.map(empty));
    const read = await readReferencePayments(handle, request);
    assert.ok(read.ok, JSON.stringify(read));
    assert.deepEqual(read.payments, [], "an empty transaction is nobody's payment");
    const settlement = await refreshPaymentSettlement({ store, handle, request, now, force: true });
    assert.equal(settlement.state, "NONE", `${amount ?? "open"}: two empty transactions are not a payment, nor an overpayment`);
    const view = derivePaymentStatus({ request, settlement, now });
    assert.equal(view.status, "AWAITING");
    assert.equal(view.note, null);
    assert.equal((await readPaymentSettlement(store, request.id))?.state, "NONE");
  }
});

test("after the empty transactions a real payment still settles the request, by its own signature", async () => {
  const now = new Date("2026-10-25T12:01:00.000Z");
  const store = createMemoryGuardStore();
  const request = solRequest("1");
  const real = { signature: REAL_SIGNATURE, pre: [3_000_000_000, 5_000_000_000, 1, 0], post: [1_999_995_000, 6_000_000_000, 1, 0] };
  const handle = chainFor(request.recipient, [...ATTACK_SIGNATURES.map(empty), real]);
  const settlement = await refreshPaymentSettlement({ store, handle, request, now, force: true });
  assert.equal(settlement.state, "PAID");
  assert.equal(settlement.signature, REAL_SIGNATURE);
  assert.equal(settlement.creditedRaw, "1000000000");
});

/* A distinct, valid signature per index: base58 digits only. */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const signatureAt = (index) => `5VERvQvDdYMk8Jq4wVo3Y8Wq6yG6xWq3s8sX2Zt4aK1bN3cM5dP7eR9fT1gU3hV5iW7jX9kY1kZ3mA5${B58[Math.floor(index / 58)]}${B58[index % 58]}`;

test("spam after a real payment does not push it out of sight: every landed transaction is read, up to a bound", async () => {
  const now = new Date("2026-10-25T12:01:00.000Z");
  const request = solRequest("1");
  const real = { signature: REAL_SIGNATURE, pre: [3_000_000_000, 5_000_000_000, 1, 0], post: [1_999_995_000, 6_000_000_000, 1, 0] };
  /* Twenty empty ones after it, and failed ones that cost nothing to skip. */
  const spam = Array.from({ length: 20 }, (_, index) => empty(signatureAt(index)));
  const failed = Array.from({ length: 40 }, (_, index) => ({ ...empty(signatureAt(100 + index)), err: { InstructionError: [0, "Custom"] } }));
  const settlement = await refreshPaymentSettlement({ store: createMemoryGuardStore(), handle: chainFor(request.recipient, [real, ...spam, ...failed]), request, now, force: true });
  assert.equal(settlement.state, "PAID");
  assert.equal(settlement.signature, REAL_SIGNATURE);

  /* Without a store the newest ones are read, and the read says it is not the whole history. */
  const flood = Array.from({ length: REFERENCE_TRANSACTIONS_MAX }, (_, index) => empty(signatureAt(200 + index)));
  const read = await readReferencePayments(chainFor(request.recipient, [real, ...flood]), request);
  assert.ok(read.ok);
  assert.equal(read.complete, false);
});

test("a request called paid by a transaction that moved nothing, before the fix, is read again and is not «Paid»", async () => {
  const now = new Date("2026-10-25T12:01:00.000Z");
  const store = createMemoryGuardStore();
  const request = solRequest(null);
  const poisoned = {
    schema: "ryntra.pay.settlement",
    schemaVersion: "1.0.0",
    id: request.id,
    state: "PAID",
    signature: ATTACK_SIGNATURES[0],
    creditedRaw: "0",
    payer: PAYER,
    paidAt: null,
    observedAt: "2026-10-25T12:00:30.000Z",
    checkedAt: "2026-10-25T12:00:30.000Z",
    failures: 0,
    lastError: null,
  };
  await writePaymentSettlement(store, poisoned);
  assert.equal(derivePaymentStatus({ request, settlement: poisoned, now }).status, "AWAITING", "no credit is never «Paid»");
  const reread = await refreshPaymentSettlement({ store, handle: chainFor(request.recipient, [empty(ATTACK_SIGNATURES[0])]), request, now, force: true });
  assert.equal(reread.state, "NONE");
});

test("a move between the recipient's own accounts is no credit, and a batch to others names no fee", () => {
  const SECOND = "6Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5n";
  const OTHER = "5Zj6bV1xQmLp9sR2tK4wN8cD5fG3hJ1aB2cD3eF4gH5p";
  const internal = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_USDC_ATA, mint: USDC, owner: RECIPIENT, tokenProgram: TOKEN_CLASSIC, amountRaw: "0", decimals: 6 },
        { account: SECOND, mint: USDC, owner: RECIPIENT, tokenProgram: TOKEN_CLASSIC, amountRaw: "5000000", decimals: 6 },
      ],
      observation: {
        balanceDeltas: [
          { account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "-5000000" },
          { account: SECOND, mint: USDC, rawDelta: "5000000" },
        ],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.equal(internal.amountRaw, "0");

  const batch = creditedToRecipient(
    observed({
      postTokenAccounts: [
        { account: RECIPIENT_USDC_ATA, mint: USDC, owner: RECIPIENT, tokenProgram: TOKEN_2022, amountRaw: "9900000", decimals: 6 },
        { account: OTHER, mint: USDC, owner: PAYER, tokenProgram: TOKEN_2022, amountRaw: "9900000", decimals: 6 },
      ],
      observation: {
        balanceDeltas: [
          { account: PAYER_USDC_ATA, mint: USDC, rawDelta: "-20000000" },
          { account: RECIPIENT_USDC_ATA, mint: USDC, rawDelta: "9900000" },
          { account: OTHER, mint: USDC, rawDelta: "9900000" },
        ],
        lamportBalanceDeltas: [{ account: PAYER, rawDelta: "-5000" }],
        blockTime: null,
      },
    }),
    { recipient: RECIPIENT, mint: USDC },
  );
  assert.deepEqual(batch, { amountRaw: "9900000", mint: USDC });
});

test("attack: empty transactions put under the reference before the payment cannot hold the request in «checking»", async () => {
  const request = solRequest("1");
  const store = createMemoryGuardStore();
  const real = { signature: REAL_SIGNATURE, pre: [3_000_000_000, 5_000_000_000, 1, 0], post: [1_999_995_000, 6_000_000_000, 1, 0] };
  /* Forty empty ones first — more than one read follows — and failed ones that cost nothing to pass. */
  const spam = Array.from({ length: 40 }, (_, index) => empty(signatureAt(index)));
  const failed = Array.from({ length: 30 }, (_, index) => ({ ...empty(signatureAt(300 + index)), err: { InstructionError: [0, "Custom"] } }));
  const history = [...failed, ...spam, real];
  let calls = 0;
  const handle = chainFor(request.recipient, history);
  const getTransaction = handle.rpc.getTransaction;
  handle.rpc.getTransaction = (signature) => ((calls += 1), getTransaction(signature));

  const first = await refreshPaymentSettlement({ store, handle, request, now: new Date("2026-10-25T12:01:00.000Z"), force: true });
  assert.equal(first.state, "NONE");
  assert.equal(first.partial, true, "part of the history is still unread");
  assert.equal(derivePaymentStatus({ request, settlement: first, now: new Date("2026-10-25T12:01:00.000Z") }).status, "CHECKING", "not «awaiting»: it may be paid");
  assert.equal(calls, REFERENCE_TRANSACTIONS_MAX);

  /* The next visit goes on from where the first stopped — even inside the freshness window — and reads nothing twice. */
  const second = await refreshPaymentSettlement({ store, handle, request, now: new Date("2026-10-25T12:01:02.000Z") });
  assert.equal(second.state, "PAID");
  assert.equal(second.signature, REAL_SIGNATURE);
  assert.equal(second.partial, false);
  assert.equal(calls, 41, "forty empty ones and the payment, each read once");
});

test("a read that remembers its place: new payments after it are added to what was found", async () => {
  const request = solRequest("2");
  const store = createMemoryGuardStore();
  const half = (signature) => ({ signature, pre: [3_000_000_000, 5_000_000_000, 1, 0], post: [1_999_995_000, 6_000_000_000, 1, 0] });
  const history = [half(signatureAt(500))];
  const handle = chainFor(request.recipient, history);
  const first = await refreshPaymentSettlement({ store, handle, request, now: new Date("2026-10-25T12:01:00.000Z"), force: true });
  assert.equal(first.state, "UNDERPAID");
  assert.equal(first.creditedRaw, "1000000000");
  history.push(empty(signatureAt(501)), half(signatureAt(502)));
  const second = await refreshPaymentSettlement({ store, handle, request, now: new Date("2026-10-25T12:02:00.000Z"), force: true });
  assert.equal(second.state, "PAID");
  assert.equal(second.creditedRaw, "2000000000");
  assert.equal(second.signature, signatureAt(502));
});

const dustLamports = (signature) => ({ signature, pre: [1_000_000_000, 5_000_000_000, 1, 0], post: [999_989_999, 5_000_000_001, 1, 0] });
/* One unit of another token to the recipient's account (index 4: an account the message names past the four). */
const dustToken = (signature) => ({
  ...empty(signature),
  preTokens: [{ accountIndex: 4, mint: BONK_MINT, owner: SOL_RECIPIENT, programId: TOKEN_CLASSIC, uiTokenAmount: { amount: "0", decimals: 5 } }],
  postTokens: [{ accountIndex: 4, mint: BONK_MINT, owner: SOL_RECIPIENT, programId: TOKEN_CLASSIC, uiTokenAmount: { amount: "1", decimals: 5 } }],
});
/* Twenty token movements between strangers: past the observation schema's bound of sixteen. */
const crowded = (entry) => ({
  ...entry,
  preTokens: Array.from({ length: 20 }, (_, index) => ({ accountIndex: 10 + index, mint: BONK_MINT, owner: PAYER, programId: TOKEN_CLASSIC, uiTokenAmount: { amount: "5", decimals: 5 } })),
  postTokens: Array.from({ length: 20 }, (_, index) => ({ accountIndex: 10 + index, mint: BONK_MINT, owner: PAYER, programId: TOKEN_CLASSIC, uiTokenAmount: { amount: index % 2 ? "4" : "6", decimals: 5 } })),
});
const realPayment = () => ({ signature: REAL_SIGNATURE, pre: [3_000_000_000, 5_000_000_000, 1, 0], post: [1_999_995_000, 6_000_000_000, 1, 0] });

async function settleThrough(request, history, visits = 6) {
  const store = createMemoryGuardStore();
  const handle = chainFor(request.recipient, history);
  let settlement = null;
  for (let visit = 0; visit < visits; visit += 1) {
    settlement = await refreshPaymentSettlement({ store, handle, request, now: new Date(Date.parse("2026-10-25T12:01:00.000Z") + visit * 1_000), force: visit === 0 });
    if (settlement.state === "PAID" || settlement.state === "OVERPAID") break;
  }
  return settlement;
}

test("attack: a flood of real dust under the reference — the requested token or another — never drops the real payment", async () => {
  const request = solRequest("1");
  /* Seventy lamports of dust, each its own credit in the requested mint: folded, never dropped. */
  const lamports = await settleThrough(request, [...Array.from({ length: 70 }, (_, index) => dustLamports(signatureAt(index))), realPayment()]);
  assert.equal(lamports.state, "OVERPAID", "seventy lamports above the amount is more than asked, and said so");
  assert.equal(lamports.creditedRaw, "1000000070");
  assert.equal(derivePaymentStatus({ request, settlement: lamports, now: new Date("2026-10-25T13:00:00.000Z") }).status, "PAID");
  /* Seventy units of another token first: one is the evidence, none stops the payment being read and counted. */
  const foreign = await settleThrough(request, [...Array.from({ length: 70 }, (_, index) => dustToken(signatureAt(index))), realPayment()]);
  assert.equal(foreign.state, "PAID");
  assert.equal(foreign.signature, REAL_SIGNATURE);
  assert.equal(foreign.creditedRaw, "1000000000");
});

test("attack: a transaction too crowded for the observation schema does not stop the reads after it, and is itself read", async () => {
  const request = solRequest("1");
  const after = await settleThrough(request, [crowded(empty(signatureAt(1))), realPayment()]);
  assert.equal(after.state, "PAID");
  assert.equal(after.signature, REAL_SIGNATURE);
  const itself = await settleThrough(request, [crowded(realPayment())]);
  assert.equal(itself.state, "PAID");
  assert.equal(itself.creditedRaw, "1000000000");
});

test("a history longer than one read can list is never called complete", async () => {
  const request = solRequest("1");
  /* Ten pages and one more: the oldest is past what a listing reaches. */
  const history = Array.from({ length: 10_001 }, (_, index) => ({ signature: `${signatureAt(index % 3_000)}${index}`.slice(0, 86), err: { InstructionError: [0, "Custom"] }, pre: [], post: [] }));
  const read = await readReferencePayments(chainFor(request.recipient, history), request, { store: createMemoryGuardStore() });
  assert.ok(read.ok);
  assert.equal(read.complete, false);
});
