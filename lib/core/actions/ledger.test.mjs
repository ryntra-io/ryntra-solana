// EXE-2 — the action and budget ledger: one actionId, atomic reservations, append-only events, idempotency, the
// receipt check and the signer handoff. Run: node --test lib/core/actions/ledger.test.mjs
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createOutcomeReceipt } from "../../agent-control/artifacts.ts";
import { attestArtifact, loadIssuerKey, ISSUER_PRIVATE_KEY_ENV } from "../../agent-control/issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "../../agent-control/registry.ts";
import { SOLANA_CAIP2, SOLANA_TOKEN_2022_ADAPTER_REF, SPL_TRANSFER_ACTION_REF } from "../../agent-control/adapters/solana-token-2022.ts";
import { GUARD_COLLECTIONS, createMemoryGuardStore } from "../../guard/store.ts";
import { recordSolanaAction } from "../../solana/action-ledger.ts";
import { BOUNDED_SIGNER_OPEN, checkSignerHandoff, sealHandoff } from "./handoff.ts";
import {
  actionIdForSignature,
  attachReceipt,
  budgetAvailable,
  cancelAction,
  defineBudget,
  issueSignerHandoff,
  markRecovery,
  openAction,
  readAction,
  readBudget,
  readSignerHandoff,
  recordObservation,
  recordSubmission,
  reserveBudget,
} from "./ledger.ts";
import { ACTION_COLLECTIONS, APPEND_ONLY_ACTION_COLLECTIONS, AmountSchema, WRAPPED_SOL_MINT, eventKey } from "./model.ts";
import { actionIdOfHistoryRow, adoptHistoryRow, projectAction } from "./projections.ts";

const NOW = "2026-10-25T10:00:00.000Z";
const LATER = "2026-10-25T10:00:20.000Z";
const EXPIRES = "2026-10-25T10:00:30.000Z";
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // devnet USDC
const PAYER = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5";
const RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SIG_A = "5".repeat(88);
const SIG_B = "4".repeat(88);
const MESSAGE = `0x${"a".repeat(64)}`;

const usdc = (amountRaw) => ({ mint: USDC, decimals: 6, amountRaw });

/**
 * A memory store whose reads and writes each yield to the event loop first, so two calls started together both read
 * before either writes — the race a multi-instance deployment has, made to happen every time.
 */
function racingStore() {
  const base = createMemoryGuardStore();
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  /* How many atomic writes lost a race — proof the test raced at all. */
  const racing = { lost: 0 };
  const wrap = (collection) => ({
    ...collection,
    get: async (key) => { await tick(); return collection.get(key); },
    valuesWithPrefix: async (prefix) => { await tick(); return collection.valuesWithPrefix(prefix); },
  });
  Object.assign(racing, {
    ...base,
    collection: (name) => wrap(base.collection(name)),
    versioned: (name) => {
      const versioned = base.versioned(name);
      return { ...wrap(versioned), compareAndSet: async (...args) => { await tick(); return versioned.compareAndSet(...args); } };
    },
    compareAndSetMany: async (writes) => {
      await tick();
      const wrote = await base.compareAndSetMany(writes);
      if (!wrote) racing.lost += 1;
      return wrote;
    },
    base,
  });
  return racing;
}

function person(overrides = {}) {
  return {
    cluster: "devnet",
    authorityId: "jupiter.swap",
    mode: "MANUAL",
    orgId: null,
    actor: { kind: "PERSON", id: PAYER },
    venue: "jupiter",
    programIds: [JUPITER],
    spend: usdc("25000000"),
    recipient: null,
    idempotencyKey: "swap-0001-abcdef",
    now: NOW,
    ...overrides,
  };
}

function team(overrides = {}) {
  return person({ orgId: "org_ryntra_test", actor: { kind: "TEAM_MEMBER", id: PAYER }, recipient: RECIPIENT, authorityId: "solana.send", venue: "solana", programIds: [TOKEN], mode: "ASSISTED", ...overrides });
}

async function teamBudget(store, limitRaw, budgetId = "org_ryntra_test:ops:2026-10") {
  const made = await defineBudget(store, { budgetId, orgId: "org_ryntra_test", ownerId: "org_ryntra_test", limit: usdc(limitRaw), now: NOW });
  assert.equal(made.ok, true);
  return budgetId;
}

async function collectionRows(store, name) {
  return store.collection(name).valuesWithPrefix("");
}

/* ------------------------------------------------------------ one actionId */

test("an action is opened once: one head, one event, one claim — before anything is signed", async () => {
  const store = createMemoryGuardStore();
  const opened = await openAction(store, person());
  assert.equal(opened.ok, true);
  assert.match(opened.action.actionId, /^act_[0-9a-f]{32}$/);
  assert.equal(opened.action.status, "OPENED");
  assert.equal(opened.action.payer, PAYER, "a person's spend is paid from their own wallet");
  assert.equal(opened.event.type, "OPENED");
  assert.equal(opened.event.prevEventHash, null);
  assert.equal((await collectionRows(store, ACTION_COLLECTIONS.intents)).length, 1);
  assert.equal((await collectionRows(store, ACTION_COLLECTIONS.events)).length, 1);
  assert.equal((await collectionRows(store, ACTION_COLLECTIONS.idempotency)).length, 1);
});

test("the ledger's collections are Guard collections", () => {
  for (const name of Object.values(ACTION_COLLECTIONS)) assert.ok(GUARD_COLLECTIONS.includes(name), name);
});

/* ------------------------------------------------------------- idempotency */

test("a repeat with the same key and the same action replays the first answer and writes nothing", async () => {
  const store = createMemoryGuardStore();
  const first = await openAction(store, person());
  const again = await openAction(store, person({ now: LATER }));
  assert.equal(again.ok, true);
  assert.equal(again.replay, true);
  assert.equal(again.event, null);
  assert.equal(again.action.actionId, first.action.actionId);
  assert.equal((await collectionRows(store, ACTION_COLLECTIONS.intents)).length, 1);
  assert.equal((await collectionRows(store, ACTION_COLLECTIONS.events)).length, 1);
});

test("the same key for another action is a conflict, not a replay — and writes nothing", async () => {
  const store = createMemoryGuardStore();
  await openAction(store, person());
  const other = await openAction(store, person({ spend: usdc("26000000") }));
  assert.equal(other.ok, false);
  assert.equal(other.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await collectionRows(store, ACTION_COLLECTIONS.intents)).length, 1);
});

test("keys are scoped: two people (or two teams) may use one key without meeting", async () => {
  const store = createMemoryGuardStore();
  const one = await openAction(store, person());
  const two = await openAction(store, person({ actor: { kind: "PERSON", id: RECIPIENT } }));
  assert.equal(two.ok, true);
  assert.notEqual(one.action.actionId, two.action.actionId);
});

test("a race of two identical requests opens one action; both callers get its id", async () => {
  const store = racingStore();
  const [left, right] = await Promise.all([openAction(store, person()), openAction(store, person())]);
  assert.equal(left.ok && right.ok, true);
  assert.equal(left.action.actionId, right.action.actionId);
  assert.deepEqual([left.replay, right.replay].sort(), [false, true]);
  assert.ok(store.lost >= 1, "the two requests really raced");
  assert.equal((await collectionRows(store.base, ACTION_COLLECTIONS.intents)).length, 1);
  assert.equal((await collectionRows(store.base, ACTION_COLLECTIONS.events)).length, 1);
});

test("a race of two requests on one key for different actions: one opens, the other is a conflict", async () => {
  const store = racingStore();
  const results = await Promise.all([openAction(store, person()), openAction(store, person({ spend: usdc("1") }))]);
  assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
  assert.equal(results.find((result) => !result.ok).code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await collectionRows(store.base, ACTION_COLLECTIONS.intents)).length, 1);
});

/* ------------------------------------------------- no execution with people's money */

test("no autonomous action opens while the authority matrix calls nothing automatic", async () => {
  const store = createMemoryGuardStore();
  const refused = await openAction(store, person({ authorityId: "ryntra.auto-dca", mode: "AUTONOMOUS" }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "AUTHORITY_NOT_AUTOMATIC");
  const unknown = await openAction(store, person({ authorityId: "nowhere.thing" }));
  assert.equal(unknown.code, "AUTHORITY_UNKNOWN");
  assert.equal((await collectionRows(store, ACTION_COLLECTIONS.intents)).length, 0);
});

test("a bounded signer is closed: no handoff is issued to anything but the person's wallet", async () => {
  assert.equal(BOUNDED_SIGNER_OPEN, false);
  const store = createMemoryGuardStore();
  const budgetId = await teamBudget(store, "100000000");
  const opened = await openAction(store, team());
  await reserveBudget(store, { actionId: opened.action.actionId, budgetId, now: NOW });
  const handoff = await issueSignerHandoff(store, {
    actionId: opened.action.actionId, signer: { kind: "BOUNDED_SIGNER", ref: "kms:ryntra" }, messageHash: MESSAGE,
    recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW,
  });
  assert.equal(handoff.ok, false);
  assert.equal(handoff.code, "SIGNER_NOT_OPEN");
  assert.equal((await readAction(store, opened.action.actionId)).action.status, "RESERVED");
});

/* ------------------------------------------------------------- reservations */

test("two actions racing for the last of a budget: exactly one holds it, the other is refused and recorded", async () => {
  const store = racingStore();
  const budgetId = await teamBudget(store, "40000000");
  const a = await openAction(store, team({ idempotencyKey: "team-pay-0001" }));
  const b = await openAction(store, team({ idempotencyKey: "team-pay-0002" }));
  const [left, right] = await Promise.all([
    reserveBudget(store, { actionId: a.action.actionId, budgetId, now: NOW }),
    reserveBudget(store, { actionId: b.action.actionId, budgetId, now: NOW }),
  ]);
  const won = [left, right].filter((result) => result.ok);
  const lost = [left, right].filter((result) => !result.ok);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].code, "BUDGET_REFUSED");
  assert.deepEqual(lost[0].reasons, ["BUDGET_EXCEEDED"]);
  assert.ok(store.lost >= 1, "both read the budget before either wrote");
  assert.equal(lost[0].action.status, "REFUSED", "the refusal is an event, not a silence");
  assert.equal(lost[0].event.type, "BUDGET_REFUSED");
  const budget = await readBudget(store, budgetId);
  assert.equal(budget.reservedRaw, "25000000");
  assert.equal(budgetAvailable(budget), 15000000n);
  assert.equal((await collectionRows(store.base, ACTION_COLLECTIONS.reservations)).length, 1);
});

test("ten actions racing for a budget that fits three: three hold it, seven are refused, nothing passes the limit", async () => {
  const store = racingStore();
  const budgetId = await teamBudget(store, "75000000");
  const actions = [];
  for (let index = 0; index < 10; index += 1) {
    actions.push((await openAction(store, team({ idempotencyKey: `team-pay-${String(index).padStart(4, "0")}` }))).action.actionId);
  }
  /* Ten writers on one record can lose more than the bounded retry allows; a contended loser says so and is asked again. */
  const reserve = async (actionId) => {
    for (let round = 0; round < 10; round += 1) {
      const result = await reserveBudget(store, { actionId, budgetId, now: NOW });
      if (result.ok || result.code !== "LEDGER_CONTENDED") return result;
    }
    throw new Error("still contended");
  };
  const results = await Promise.all(actions.map(reserve));
  assert.equal(results.filter((result) => result.ok).length, 3);
  assert.ok(store.lost >= 3);
  assert.equal(results.filter((result) => !result.ok && result.code === "BUDGET_REFUSED").length, 7);
  const budget = await readBudget(store, budgetId);
  assert.equal(budget.reservedRaw, "75000000");
  assert.equal(budgetAvailable(budget), 0n);
});

test("the same action reserving twice at once holds the budget once", async () => {
  const store = racingStore();
  const budgetId = await teamBudget(store, "100000000");
  const opened = await openAction(store, team());
  const both = await Promise.all([
    reserveBudget(store, { actionId: opened.action.actionId, budgetId, now: NOW }),
    reserveBudget(store, { actionId: opened.action.actionId, budgetId, now: NOW }),
  ]);
  assert.equal(both.every((result) => result.ok), true);
  assert.deepEqual(both.map((result) => result.replay).sort(), [false, true]);
  assert.ok(store.lost >= 1);
  assert.equal((await readBudget(store, budgetId)).reservedRaw, "25000000");
  const events = (await readAction(store, opened.action.actionId)).events.map((event) => event.type);
  assert.deepEqual(events, ["OPENED", "BUDGET_RESERVED"]);
});

test("a budget refuses another mint, another team's action, a frozen or ended budget", async () => {
  const store = createMemoryGuardStore();
  const budgetId = await teamBudget(store, "100000000");
  const sol = await openAction(store, team({ idempotencyKey: "team-sol-0001", spend: { mint: WRAPPED_SOL_MINT, decimals: 9, amountRaw: "1000" } }));
  assert.equal((await reserveBudget(store, { actionId: sol.action.actionId, budgetId, now: NOW })).code, "BUDGET_MINT_MISMATCH");
  const stranger = await openAction(store, team({ idempotencyKey: "team-other-0001", orgId: "org_someone_else" }));
  assert.equal((await reserveBudget(store, { actionId: stranger.action.actionId, budgetId, now: NOW })).code, "BUDGET_SCOPE_MISMATCH");
  const ended = await defineBudget(store, { budgetId: "org_ryntra_test:ended", orgId: "org_ryntra_test", ownerId: "org_ryntra_test", limit: usdc("100000000"), endsAt: NOW, now: NOW });
  const late = await openAction(store, team({ idempotencyKey: "team-late-0001" }));
  const refused = await reserveBudget(store, { actionId: late.action.actionId, budgetId: ended.budget.budgetId, now: NOW });
  assert.equal(refused.code, "BUDGET_REFUSED");
  assert.deepEqual(refused.reasons, ["BUDGET_ENDED"]);
  assert.equal((await reserveBudget(store, { actionId: late.action.actionId, budgetId: "missing:budget", now: NOW })).code, "STATE_REFUSED", "a refused action is done");
});

test("a budget is defined once: the same terms replay, other terms conflict", async () => {
  const store = createMemoryGuardStore();
  await teamBudget(store, "100");
  const same = await defineBudget(store, { budgetId: "org_ryntra_test:ops:2026-10", orgId: "org_ryntra_test", ownerId: "org_ryntra_test", limit: usdc("100"), now: LATER });
  assert.equal(same.replay, true);
  const other = await defineBudget(store, { budgetId: "org_ryntra_test:ops:2026-10", orgId: "org_ryntra_test", ownerId: "org_ryntra_test", limit: usdc("1000"), now: LATER });
  assert.equal(other.code, "BUDGET_CONFLICT");
});

/* ---------------------------------------------------------------- amounts */

test("amounts are integers of base units with their mint — never a float, a sign or an exponent", () => {
  for (const amountRaw of ["1.5", "-1", "1e9", "01", " 1", ""]) {
    assert.equal(AmountSchema.safeParse({ mint: USDC, decimals: 6, amountRaw }).success, false, amountRaw);
  }
  assert.equal(AmountSchema.safeParse({ mint: USDC, decimals: 6, amountRaw: "0" }).success, true);
  assert.equal(AmountSchema.safeParse({ amountRaw: "1", decimals: 6 }).success, false, "no amount without its mint");
});

test("arithmetic is exact past 2^53 base units", async () => {
  const store = createMemoryGuardStore();
  const big = "18446744073709551615"; // u64::MAX
  await defineBudget(store, { budgetId: "org_ryntra_test:big", orgId: "org_ryntra_test", ownerId: "org_ryntra_test", limit: { mint: WRAPPED_SOL_MINT, decimals: 9, amountRaw: big }, now: NOW });
  const opened = await openAction(store, team({ idempotencyKey: "team-big-0001", spend: { mint: WRAPPED_SOL_MINT, decimals: 9, amountRaw: "9007199254740993" } }));
  const reserved = await reserveBudget(store, { actionId: opened.action.actionId, budgetId: "org_ryntra_test:big", now: NOW });
  assert.equal(reserved.ok, true);
  assert.equal((await readBudget(store, "org_ryntra_test:big")).reservedRaw, "9007199254740993");
  assert.equal(budgetAvailable(await readBudget(store, "org_ryntra_test:big")), 18446744073709551615n - 9007199254740993n);
});

/* ------------------------------------------------------------- the handoff */

async function handedOff(store, overrides = {}) {
  const budgetId = await teamBudget(store, "100000000");
  const opened = await openAction(store, team(overrides));
  await reserveBudget(store, { actionId: opened.action.actionId, budgetId, now: NOW });
  const issued = await issueSignerHandoff(store, {
    actionId: opened.action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE,
    recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW,
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  return { actionId: opened.action.actionId, budgetId, handoff: issued.handoff };
}

test("the handoff names the action, its digest, the exact bytes, the recipient and the amount — sealed", async () => {
  const store = createMemoryGuardStore();
  const { actionId, handoff } = await handedOff(store);
  assert.equal(handoff.actionId, actionId);
  assert.equal(handoff.messageHash, MESSAGE);
  assert.deepEqual(handoff.reservation, { budgetId: "org_ryntra_test:ops:2026-10", amountRaw: "25000000" });
  const recorded = (await readSignerHandoff(store, handoff.handoffId)).handoffDigest;
  assert.equal(recorded, handoff.handoffDigest);
  const presented = { messageHash: MESSAGE, recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], now: NOW };
  assert.deepEqual(checkSignerHandoff(handoff, presented, recorded), { ok: true });
  const reasons = (change) => checkSignerHandoff(handoff, { ...presented, ...change }, recorded).reasons;
  assert.deepEqual(reasons({ messageHash: `0x${"b".repeat(64)}` }), ["DIGEST_MISMATCH"]);
  assert.deepEqual(reasons({ recipient: PAYER }), ["RECIPIENT_MISMATCH"]);
  assert.deepEqual(reasons({ spend: usdc("25000001") }), ["AMOUNT_MISMATCH"]);
  assert.deepEqual(reasons({ spend: usdc("1") }), ["AMOUNT_MISMATCH"], "less is different bytes too");
  assert.deepEqual(reasons({ spend: { mint: WRAPPED_SOL_MINT, decimals: 9, amountRaw: "25000000" } }), ["MINT_MISMATCH"]);
  assert.deepEqual(reasons({ programIds: [JUPITER] }), ["PROGRAM_NOT_ALLOWED"]);
  assert.deepEqual(reasons({ now: EXPIRES }), ["HANDOFF_EXPIRED"]);
  const tampered = { ...handoff, spend: usdc("99000000") };
  assert.ok(checkSignerHandoff(tampered, { ...presented, spend: usdc("99000000") }, recorded).reasons.includes("HANDOFF_TAMPERED"));
  /* Re-sealed on its way: its own digest recomputes, and it is still not the handoff the ledger recorded. */
  const { handoffDigest: _drop, ...body } = handoff;
  const resealed = sealHandoff({ ...body, recipient: PAYER, spend: usdc("99000000") });
  assert.deepEqual(checkSignerHandoff(resealed, { ...presented, recipient: PAYER, spend: usdc("99000000") }, recorded).reasons, ["HANDOFF_TAMPERED"]);
  assert.ok(checkSignerHandoff(handoff, presented, null).reasons.includes("HANDOFF_TAMPERED"), "no recorded handoff, no signature");
  const bounded = sealHandoff({ ...body, signer: { kind: "BOUNDED_SIGNER", ref: "kms:x" } });
  assert.ok(checkSignerHandoff(bounded, presented, bounded.handoffDigest).reasons.includes("SIGNER_NOT_OPEN"));
});

test("a handoff whose bytes would do other than the action says is refused before anything is written", async () => {
  const store = createMemoryGuardStore();
  const budgetId = await teamBudget(store, "100000000");
  const opened = await openAction(store, team());
  await reserveBudget(store, { actionId: opened.action.actionId, budgetId, now: NOW });
  const ask = (change) => issueSignerHandoff(store, {
    actionId: opened.action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE,
    recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW, ...change,
  });
  assert.deepEqual((await ask({ recipient: PAYER })).reasons, ["RECIPIENT_MISMATCH"]);
  assert.deepEqual((await ask({ spend: usdc("25000001") })).reasons, ["AMOUNT_ABOVE_SPEND"]);
  assert.deepEqual((await ask({ signer: { kind: "PERSON_WALLET", ref: RECIPIENT } })).reasons, ["SIGNER_NOT_PAYER"]);
  assert.equal((await readAction(store, opened.action.actionId)).events.length, 2);
  const assisted = await openAction(store, team({ idempotencyKey: "team-pay-unreserved" }));
  const unreserved = await issueSignerHandoff(store, {
    actionId: assisted.action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE,
    recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW,
  });
  assert.equal(unreserved.code, "STATE_REFUSED", "a team's spend is reserved before it is handed to a signer");
});

/* ------------------------------------------------------------ the full cycle */

const KEY = (() => {
  const { privateKey } = generateKeyPairSync("ed25519");
  return loadIssuerKey({ [ISSUER_PRIVATE_KEY_ENV]: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") });
})();
const PIN = registryPin(AGENT_CONTROL_REGISTRY, [SOLANA_TOKEN_2022_ADAPTER_REF, SPL_TRANSFER_ACTION_REF]);

function receiptFor({ transactionHash = SIG_A, chainRef = SOLANA_CAIP2.devnet, status = "MATCHED", signed = true } = {}) {
  const outcome = {
    status, chainRef, transactionHash,
    observedEffects: [{ description: "The recipient's USDC rose by 25000000 base units.", sourceRef: "solana:devnet:rpc:getTransaction", observedAt: LATER }],
    reconciledAt: LATER,
  };
  const args = { id: `outcome_${transactionHash.slice(0, 8)}`, actionPassportHash: `0x${"1".repeat(64)}`, outcome, registry: PIN, now: new Date(LATER) };
  const unsigned = createOutcomeReceipt(args);
  if (!signed) return unsigned;
  return createOutcomeReceipt({ ...args, issuer: attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key: KEY, now: new Date(LATER) }) });
}

const DELTAS = [
  { owner: PAYER, mint: USDC, decimals: 6, deltaRaw: "-24000000" },
  { owner: RECIPIENT, mint: USDC, decimals: 6, deltaRaw: "24000000" },
];

test("the full cycle: open → reserve → handoff → submit → observe → receipt — one actionId in every projection", async () => {
  const store = createMemoryGuardStore();
  const { actionId, budgetId } = await handedOff(store);
  assert.equal((await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER })).ok, true);
  assert.equal(await actionIdForSignature(store, "devnet", SIG_A), actionId);
  const observed = await recordObservation(store, { actionId, signature: SIG_A, outcome: "LANDED", slot: 412_000_000, observedDeltas: DELTAS, feeBreakdown: [{ kind: "NETWORK", mint: WRAPPED_SOL_MINT, amountRaw: "5000", payer: PAYER }], observer: "rpc:finalized", now: LATER });
  assert.equal(observed.ok, true);
  assert.equal(observed.spentRaw, "24000000", "spent is what the chain shows left the payer, not what was asked");
  const budget = await readBudget(store, budgetId);
  assert.equal(budget.reservedRaw, "0");
  assert.equal(budget.spentRaw, "24000000");
  assert.equal(budgetAvailable(budget), 76000000n, "the unused part of the reservation went back");

  const receipt = receiptFor();
  const reconciled = await attachReceipt(store, { actionId, receipt, trustedPublicKeys: [receipt.issuer.publicKey], now: LATER });
  assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
  assert.equal(reconciled.action.status, "RECONCILED");

  const reading = await readAction(store, actionId);
  assert.equal(reading.chain, "INTACT", reading.issues.join(","));
  assert.deepEqual(reading.events.map((event) => event.type), ["OPENED", "BUDGET_RESERVED", "HANDOFF_ISSUED", "SUBMITTED", "OBSERVED", "RECEIPT_VERIFIED"]);
  for (const event of reading.events) {
    for (const field of ["eventId", "actionId", "orgId", "actorId", "mandateId", "policyVersion", "idempotencyKey", "actionDigest", "chainId", "venue", "programId", "signerRef", "quoteId", "slot", "txSignature", "observedDeltas", "feeBreakdown", "eventAt", "observer", "receiptRef"]) {
      assert.ok(field in event, `${event.type} carries ${field} (spec §14.2)`);
    }
  }

  const views = projectAction(reading.action, reading.events);
  const ids = [views.core.actionId, views.trade.actionId, views.teamSpend.actionId, views.sdkReceipt.actionId];
  assert.deepEqual(new Set(ids), new Set([actionId]), "deal, team spend and SDK receipt name one action");
  assert.equal(views.teamSpend.spentRaw, "24000000");
  assert.equal(views.sdkReceipt.contentHash, receipt.contentHash);
  assert.equal(views.core.signerRef, `PERSON_WALLET:${PAYER}`);
  assert.deepEqual(views.core.txSignatures, [SIG_A]);
  assert.equal(views.agentAction, null, "a team member's spend is no agent's act");
});

test("an agent's act under a mandate projects as one, with the same actionId", async () => {
  const store = createMemoryGuardStore();
  const opened = await openAction(store, person({ actor: { kind: "AGENT", id: "agent_research_01" }, payer: PAYER, mandateId: "mandate_01", policyVersion: "3", mode: "ASSISTED", authorityId: "ryntra.agent-mandate", recipient: PAYER, idempotencyKey: "agent-act-0001" }));
  assert.equal(opened.ok, true);
  const reading = await readAction(store, opened.action.actionId);
  const views = projectAction(reading.action, reading.events);
  assert.equal(views.agentAction.actionId, opened.action.actionId);
  assert.equal(views.agentAction.mandateId, "mandate_01");
  assert.equal(views.teamSpend, null);
  assert.equal(views.sdkReceipt, null, "no receipt until one is verified");
});

test("one live attempt: after the send, a second signature is refused; a signature belongs to one action", async () => {
  const store = createMemoryGuardStore();
  const { actionId } = await handedOff(store);
  assert.equal((await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER })).ok, true);
  const replay = await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  assert.equal(replay.replay, true);
  assert.equal((await recordSubmission(store, { actionId, signature: SIG_B, messageHash: MESSAGE, now: LATER })).code, "STATE_REFUSED");

  const second = await openAction(store, team({ idempotencyKey: "team-pay-second" }));
  await reserveBudget(store, { actionId: second.action.actionId, budgetId: "org_ryntra_test:ops:2026-10", now: NOW });
  await issueSignerHandoff(store, { actionId: second.action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW });
  assert.equal((await recordSubmission(store, { actionId: second.action.actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER })).code, "SIGNATURE_TAKEN");
});

test("a submission must be handed-off bytes — and one sent just before its time ran out is still recorded", async () => {
  const store = createMemoryGuardStore();
  const { actionId } = await handedOff(store);
  assert.equal((await recordSubmission(store, { actionId, signature: SIG_A, messageHash: `0x${"c".repeat(64)}`, now: LATER })).code, "HANDOFF_MISMATCH");
  assert.equal((await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: "2026-10-25T10:05:00.000Z" })).ok, true);
});

test("a race of two submissions of the same signature records it once", async () => {
  const store = racingStore();
  const { actionId } = await handedOff(store);
  const both = await Promise.all([
    recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER }),
    recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER }),
  ]);
  assert.equal(both.every((result) => result.ok), true);
  assert.deepEqual((await readAction(store, actionId)).events.filter((event) => event.type === "SUBMITTED").length, 1);
});

test("a lost answer goes to RECOVERY and is settled by the chain's read of the same signature — once", async () => {
  const store = createMemoryGuardStore();
  const { actionId, budgetId } = await handedOff(store);
  await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  assert.equal((await markRecovery(store, { actionId, reason: "SEND_RESPONSE_LOST", now: LATER })).action.status, "RECOVERY");
  const first = await recordObservation(store, { actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observedDeltas: DELTAS, observer: "rpc:finalized", now: LATER });
  const again = await recordObservation(store, { actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observedDeltas: DELTAS, observer: "rpc:finalized", now: LATER });
  assert.equal(first.ok && again.ok, true);
  assert.equal(again.replay, true);
  assert.equal(again.spentRaw, "24000000");
  assert.equal((await readBudget(store, budgetId)).spentRaw, "24000000", "observed twice, spent once");
  assert.equal((await recordObservation(store, { actionId, signature: SIG_B, outcome: "LANDED", slot: 1, observedDeltas: [], observer: "rpc", now: LATER })).code, "TRANSACTION_UNKNOWN");
});

test("more spent than reserved is an incident: RECOVERY, the excess apart, the budget frozen", async () => {
  const store = createMemoryGuardStore();
  const { actionId, budgetId } = await handedOff(store);
  await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  const over = await recordObservation(store, { actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observedDeltas: [{ owner: PAYER, mint: USDC, decimals: 6, deltaRaw: "-30000000" }], observer: "rpc:finalized", now: LATER });
  assert.equal(over.ok, true);
  assert.equal(over.action.status, "RECOVERY");
  assert.equal(over.event.type, "OVERSPEND_DETECTED");
  assert.equal(over.overspentRaw, "5000000");
  const budget = await readBudget(store, budgetId);
  assert.equal(budget.spentRaw, "25000000");
  assert.equal(budget.overspentRaw, "5000000");
  assert.equal(budget.frozen, true);
  const next = await openAction(store, team({ idempotencyKey: "team-pay-after-incident" }));
  const refused = await reserveBudget(store, { actionId: next.action.actionId, budgetId, now: LATER });
  assert.deepEqual(refused.reasons, ["BUDGET_FROZEN"]);
});

test("a failed transaction releases what it did not spend", async () => {
  const store = createMemoryGuardStore();
  const { actionId, budgetId } = await handedOff(store);
  await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  const failed = await recordObservation(store, { actionId, signature: SIG_A, outcome: "FAILED", slot: 1, observedDeltas: [], observer: "rpc:finalized", now: LATER });
  assert.equal(failed.action.status, "FAILED");
  const budget = await readBudget(store, budgetId);
  assert.equal(budget.reservedRaw, "0");
  assert.equal(budget.spentRaw, "0");
});

test("cancelling gives the reservation back — but never while handed-off bytes could still land", async () => {
  const store = createMemoryGuardStore();
  const { actionId, budgetId } = await handedOff(store);
  const live = await cancelAction(store, { actionId, reason: "PERSON_CANCELLED", now: LATER, notFoundOnChain: true });
  assert.equal(live.code, "HANDOFF_STILL_LIVE");
  assert.equal((await cancelAction(store, { actionId, reason: "BLOCKHASH_EXPIRED", now: EXPIRES, notFoundOnChain: true })).code, "HANDOFF_STILL_LIVE", "time alone does not kill a blockhash");
  assert.deepEqual((await cancelAction(store, { actionId, reason: "BLOCKHASH_EXPIRED", now: EXPIRES, blockHeight: 1001 })).reasons, ["CHAIN_NOT_SEARCHED"]);
  const cancelled = await cancelAction(store, { actionId, reason: "BLOCKHASH_EXPIRED", now: EXPIRES, notFoundOnChain: true, blockHeight: 1001 });
  assert.equal(cancelled.action.status, "RELEASED");
  assert.equal((await readBudget(store, budgetId)).reservedRaw, "0");
});

/* ------------------------------------------------------------ the receipt */

test("a receipt is refused unless it proves this action: its transaction, its network, a sound trusted signature", async () => {
  const store = createMemoryGuardStore();
  const { actionId } = await handedOff(store);
  await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  await recordObservation(store, { actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observedDeltas: DELTAS, observer: "rpc:finalized", now: LATER });
  const trusted = [receiptFor().issuer.publicKey];
  const reasons = async (receipt, keys = trusted) => (await attachReceipt(store, { actionId, receipt, trustedPublicKeys: keys, now: LATER })).reasons;
  assert.deepEqual(await reasons(receiptFor({ transactionHash: SIG_B })), ["RECEIPT_TRANSACTION_MISMATCH"]);
  assert.deepEqual(await reasons(receiptFor({ chainRef: SOLANA_CAIP2.mainnet })), ["RECEIPT_NETWORK_MISMATCH"]);
  assert.deepEqual(await reasons(receiptFor({ status: "FAILED" })), ["RECEIPT_OUTCOME_MISMATCH"]);
  assert.deepEqual(await reasons(receiptFor({ signed: false })), ["RECEIPT_UNSIGNED"]);
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
  assert.deepEqual(await reasons(receiptFor(), [other]), ["RECEIPT_UNTRUSTED_KEY"]);
  const tampered = { ...receiptFor(), outcome: { ...receiptFor().outcome, reconciledAt: NOW } };
  assert.ok((await reasons(tampered)).includes("RECEIPT_INTEGRITY_FAILED"));
  assert.deepEqual(await reasons({ kind: "NOT_A_RECEIPT" }), ["RECEIPT_UNRECOGNISED"]);
  const reading = await readAction(store, actionId);
  assert.equal(reading.action.status, "OBSERVED", "a refused receipt reconciles nothing");
  assert.equal(reading.events.filter((event) => event.type === "RECEIPT_REFUSED").length, 7, "and each refusal is on record");
  assert.equal((await attachReceipt(store, { actionId, receipt: receiptFor(), trustedPublicKeys: trusted, now: LATER })).ok, true);
});

/* ----------------------------------------------------------- append-only */

test("events are only ever added: earlier events are byte-identical after every later step", async () => {
  const store = createMemoryGuardStore();
  const { actionId } = await handedOff(store);
  const before = JSON.stringify((await readAction(store, actionId)).events);
  await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  await recordObservation(store, { actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observedDeltas: DELTAS, observer: "rpc", now: LATER });
  const after = (await readAction(store, actionId)).events;
  assert.equal(JSON.stringify(after.slice(0, 3)), before);
  assert.equal(after.length, 5);
});

test("an event cannot be written over: inserting at a taken sequence loses, whoever tries", async () => {
  const store = createMemoryGuardStore();
  const { actionId } = await handedOff(store);
  const [first] = (await readAction(store, actionId)).events;
  const forged = { ...first, type: "CANCELLED" };
  const wrote = await store.compareAndSetMany([{ collection: ACTION_COLLECTIONS.events, key: eventKey(actionId, 1), expectedVersion: null, next: forged }]);
  assert.equal(wrote, false);
  /* Events carry version 1 for ever: a version-checked overwrite would have to expect it and is just as refused by the database's trigger (the migration; proved by the live Postgres test). */
  assert.equal((await readAction(store, actionId)).events[0].type, "OPENED");
});

test("an event changed behind the ledger's back breaks the chain, and the reading says where", async () => {
  const store = createMemoryGuardStore();
  const { actionId } = await handedOff(store);
  const events = store.collection(ACTION_COLLECTIONS.events);
  const second = await events.get(eventKey(actionId, 2));
  await events.set(eventKey(actionId, 2), { ...second, amountRaw: "1" }); // what the database's trigger refuses
  const reading = await readAction(store, actionId);
  assert.equal(reading.chain, "BROKEN");
  assert.ok(reading.issues.includes("EVENT_HASH_MISMATCH_2"));
});

test("the ledger's source never sets or deletes a row of an append-only collection", () => {
  for (const file of ["./ledger.ts", "./projections.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.(set|delete)\(/, `${file} writes only through compareAndSetMany and compareAndSet`);
  }
  const migration = readFileSync(new URL("../../../supabase/prepared/20261025_exe_2_action_ledger_v1.sql", import.meta.url), "utf8");
  for (const name of APPEND_ONLY_ACTION_COLLECTIONS) assert.match(migration, new RegExp(`'${name}'`), `the migration's trigger covers ${name}`);
  assert.match(migration, /actionBudgets/);
});

/* -------------------------------------------- the lanes that exist today */

const ROW = {
  network: "mainnet",
  wallet: PAYER,
  actionId: SIG_A,
  lane: "SWAP",
  outcome: "IN_FLIGHT",
  out: { mint: null, amountRaw: "1000000000", decimals: 9, symbol: "SOL" },
  in: null,
  signature: SIG_A,
  origin: { surface: "LAUNCH", side: "BUY", token: RECIPIENT, venue: "curve" },
  updatedAt: NOW,
};

test("a History row's actionId is a function of the row: the same whoever computes it", () => {
  const id = actionIdOfHistoryRow(ROW);
  assert.match(id, /^act_[0-9a-f]{32}$/);
  assert.equal(actionIdOfHistoryRow({ ...ROW, outcome: "DONE" }), id);
  assert.notEqual(actionIdOfHistoryRow({ ...ROW, network: "devnet" }), id);
  assert.notEqual(actionIdOfHistoryRow({ ...ROW, lane: "SEND" }), id);
  assert.notEqual(actionIdOfHistoryRow({ ...ROW, wallet: RECIPIENT }), id, "two wallets never share an action");
});

test("a launch trade's History row is adopted once, moved once, and its signature names it", async () => {
  const store = createMemoryGuardStore();
  const first = await adoptHistoryRow(store, ROW);
  assert.equal(first.ok, true);
  assert.equal(first.action.authorityId, "meteora-dbc.trade");
  assert.equal(first.action.status, "SUBMITTED");
  assert.deepEqual(first.action.spend, { mint: WRAPPED_SOL_MINT, decimals: 9, amountRaw: "1000000000" });
  assert.equal((await adoptHistoryRow(store, ROW)).replay, true);
  const done = await adoptHistoryRow(store, { ...ROW, outcome: "DONE", updatedAt: LATER });
  assert.equal(done.action.status, "OBSERVED");
  assert.equal((await adoptHistoryRow(store, { ...ROW, outcome: "IN_FLIGHT", updatedAt: LATER })).replay, true, "never moved back");
  assert.equal(await actionIdForSignature(store, "mainnet", SIG_A), actionIdOfHistoryRow(ROW));
  const reading = await readAction(store, done.action.actionId);
  assert.equal(reading.chain, "INTACT");
  assert.deepEqual(reading.events.map((event) => event.type), ["ADOPTED", "OBSERVED"]);
});

test("a payment received through /pay is adopted without claiming the payer's signature", async () => {
  const store = createMemoryGuardStore();
  const received = await adoptHistoryRow(store, { ...ROW, lane: "RECEIVE", actionId: "receive:reference-0001", origin: null, out: null, outcome: "DONE" });
  assert.equal(received.ok, true);
  assert.equal(received.action.authorityId, "solana-pay.pay");
  assert.equal(received.action.spend, null);
  assert.equal(await actionIdForSignature(store, "mainnet", SIG_A), null);
  assert.deepEqual(received.action.signatures, [], "the payer's transaction is not the recipient's to reconcile");
});

test("the History writer records into the ledger only with RYNTRA_ACTION_LEDGER=adopt — off, it writes exactly what it wrote", async () => {
  const before = process.env.RYNTRA_ACTION_LEDGER;
  try {
    delete process.env.RYNTRA_ACTION_LEDGER;
    const off = createMemoryGuardStore();
    assert.equal((await recordSolanaAction(off, { ...ROW, now: NOW })).ok, true);
    assert.equal((await collectionRows(off, ACTION_COLLECTIONS.intents)).length, 0);

    process.env.RYNTRA_ACTION_LEDGER = "adopt";
    const on = createMemoryGuardStore();
    const row = await recordSolanaAction(on, { ...ROW, now: NOW });
    assert.equal(row.ok, true);
    const reading = await readAction(on, actionIdOfHistoryRow(ROW));
    assert.equal(reading.action.projections[0].key, `solana:mainnet:${PAYER}:${SIG_A}`);

    /* A ledger that cannot write never fails the History row. */
    const broken = { ...createMemoryGuardStore() };
    const base = createMemoryGuardStore();
    broken.collection = base.collection;
    broken.versioned = base.versioned;
    broken.compareAndSetMany = async () => { throw new Error("ledger down"); };
    assert.equal((await recordSolanaAction(broken, { ...ROW, now: NOW })).ok, true);
  } finally {
    if (before === undefined) delete process.env.RYNTRA_ACTION_LEDGER;
    else process.env.RYNTRA_ACTION_LEDGER = before;
  }
});

/* ------------------------------------------------- the critic's round 1 */

test("a team's or an agent's spend is never handed to a signer without its reservation, whatever its mode", async () => {
  const store = createMemoryGuardStore();
  const manualTeam = await openAction(store, team({ mode: "MANUAL", idempotencyKey: "team-manual-0001" }));
  const ask = (actionId, ref = PAYER) => issueSignerHandoff(store, { actionId, signer: { kind: "PERSON_WALLET", ref }, messageHash: MESSAGE, recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW });
  const refusedTeam = await ask(manualTeam.action.actionId);
  assert.equal(refusedTeam.code, "STATE_REFUSED");
  assert.deepEqual(refusedTeam.reasons, ["RESERVATION_REQUIRED"]);
  const agent = await openAction(store, person({ actor: { kind: "AGENT", id: "agent_x_01" }, payer: PAYER, recipient: RECIPIENT, programIds: [TOKEN], idempotencyKey: "agent-manual-0001" }));
  assert.deepEqual((await ask(agent.action.actionId)).reasons, ["RESERVATION_REQUIRED"]);
  const own = await openAction(store, person({ recipient: RECIPIENT, programIds: [TOKEN], idempotencyKey: "own-swap-0001" }));
  assert.equal((await ask(own.action.actionId)).ok, true, "a person's own wallet acting for itself needs no budget");
  const unbound = await openAction(store, team({ recipient: null, idempotencyKey: "team-nowhere-0001" }));
  assert.deepEqual(unbound.reasons, ["RECIPIENT_REQUIRED"]);
});

test("one live handoff at a time; cancelling waits until every handed-off copy is dead and searched for", async () => {
  const store = createMemoryGuardStore();
  const budgetId = await teamBudget(store, "100000000");
  const opened = await openAction(store, team());
  const actionId = opened.action.actionId;
  await reserveBudget(store, { actionId, budgetId, now: NOW });
  const issue = (messageHash, now, expiresAt, lastValidBlockHeight = 1000, extra = {}) => issueSignerHandoff(store, { actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash, recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], expiresAt, lastValidBlockHeight, now, ...extra });
  assert.equal((await issue(MESSAGE, NOW, "2026-10-25T10:01:00.000Z", 1000)).ok, true);
  const second = await issue(`0x${"b".repeat(64)}`, LATER, "2026-10-25T10:01:30.000Z");
  assert.equal(second.code, "HANDOFF_STILL_LIVE", "two live copies could both be signed and spend one reservation twice");
  assert.deepEqual((await issue(`0x${"b".repeat(64)}`, NOW, "2026-10-25T10:10:00.000Z")).reasons, ["EXPIRES_AT_TOO_FAR"]);
  const after = "2026-10-25T10:01:05.000Z";
  const fresh = `0x${"b".repeat(64)}`;
  assert.equal((await issue(fresh, after, "2026-10-25T10:01:35.000Z", 1300)).code, "HANDOFF_STILL_LIVE", "past its time, the first copy's block height is not known to be past");
  assert.equal((await issue(fresh, after, "2026-10-25T10:01:35.000Z", 1300, { blockHeight: 1000 })).code, "HANDOFF_STILL_LIVE");
  assert.deepEqual((await issue(fresh, after, "2026-10-25T10:01:35.000Z", 1300, { blockHeight: 1001 })).reasons, ["CHAIN_NOT_SEARCHED"]);
  assert.equal((await issue(fresh, after, "2026-10-25T10:01:35.000Z", 1300, { blockHeight: 1001, previousNotFoundOnChain: true })).ok, true, "a fresh blockhash once the first is dead and not found");
  const late = "2026-10-25T10:02:00.000Z";
  assert.equal((await cancelAction(store, { actionId, reason: "BLOCKHASH_EXPIRED", now: late, notFoundOnChain: true, blockHeight: 1001 })).code, "HANDOFF_STILL_LIVE", "the second copy is not past its height");
  assert.equal((await cancelAction(store, { actionId, reason: "BLOCKHASH_EXPIRED", now: late, notFoundOnChain: true, blockHeight: 1301 })).action.status, "RELEASED");
  const reading = await readAction(store, actionId);
  assert.equal(reading.action.handoffs.length, 2);
});

test("an old handoff's bytes, sent before it died, are still recorded against the action", async () => {
  const store = createMemoryGuardStore();
  const budgetId = await teamBudget(store, "100000000");
  const { action } = await openAction(store, team());
  await reserveBudget(store, { actionId: action.actionId, budgetId, now: NOW });
  const issue = (messageHash, now, expiresAt, lastValidBlockHeight, extra = {}) => issueSignerHandoff(store, { actionId: action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash, recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], expiresAt, lastValidBlockHeight, now, ...extra });
  assert.equal((await issue(MESSAGE, NOW, EXPIRES, 1000)).ok, true);
  assert.equal((await issue(`0x${"b".repeat(64)}`, EXPIRES, "2026-10-25T10:01:00.000Z", 1200, { blockHeight: 1001, previousNotFoundOnChain: true })).ok, true);
  assert.equal((await recordSubmission(store, { actionId: action.actionId, signature: SIG_A, messageHash: MESSAGE, now: "2026-10-25T10:00:40.000Z" })).ok, true);
});

test("the same handoff asked again returns the sealed contract; the same bytes with other facts are refused", async () => {
  const store = createMemoryGuardStore();
  const { actionId, handoff } = await handedOff(store);
  const again = await issueSignerHandoff(store, { actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: LATER });
  assert.equal(again.replay, true);
  assert.deepEqual(again.handoff, handoff);
  const other = await issueSignerHandoff(store, { actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: PAYER, spend: usdc("999999999"), programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: LATER });
  assert.equal(other.code, "HANDOFF_MISMATCH");
});

test("a SOL spend's network fee is not an overspend: the fee is kept apart, the spend counted", async () => {
  const store = createMemoryGuardStore();
  const sol = { mint: WRAPPED_SOL_MINT, decimals: 9, amountRaw: "1000000" };
  await defineBudget(store, { budgetId: "org_ryntra_test:sol", orgId: "org_ryntra_test", ownerId: "org_ryntra_test", limit: { ...sol, amountRaw: "5000000" }, now: NOW });
  const { action } = await openAction(store, team({ spend: sol, programIds: ["11111111111111111111111111111111"], idempotencyKey: "team-sol-fee-0001" }));
  await reserveBudget(store, { actionId: action.actionId, budgetId: "org_ryntra_test:sol", now: NOW });
  await issueSignerHandoff(store, { actionId: action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: RECIPIENT, spend: sol, programIds: ["11111111111111111111111111111111"], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW });
  await recordSubmission(store, { actionId: action.actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  const observed = await recordObservation(store, {
    actionId: action.actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observer: "rpc:finalized", now: LATER,
    observedDeltas: [{ owner: PAYER, mint: WRAPPED_SOL_MINT, decimals: 9, deltaRaw: "-1005000" }],
    feeBreakdown: [{ kind: "NETWORK", mint: WRAPPED_SOL_MINT, amountRaw: "5000", payer: PAYER }],
  });
  assert.equal(observed.action.status, "OBSERVED");
  assert.equal(observed.spentRaw, "1000000");
  const budget = await readBudget(store, "org_ryntra_test:sol");
  assert.equal(budget.frozen, false);
  assert.equal(budget.spentRaw, "1000000");
});

test("a receipt is checked against the deployment's own keys — never without them", async () => {
  const store = createMemoryGuardStore();
  const { actionId } = await handedOff(store);
  await recordSubmission(store, { actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
  await recordObservation(store, { actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observedDeltas: DELTAS, observer: "rpc", now: LATER });
  const bare = await attachReceipt(store, { actionId, receipt: receiptFor(), now: LATER });
  assert.equal(bare.code, "VALIDATION_ERROR");
  assert.deepEqual(bare.reasons, ["TRUSTED_KEYS_REQUIRED"]);
  assert.equal((await attachReceipt(store, { actionId, receipt: receiptFor(), trustedPublicKeys: [], now: LATER })).code, "VALIDATION_ERROR");
  assert.equal((await readAction(store, actionId)).action.status, "OBSERVED");
});

test("a malformed field is a validation refusal, never a retryable outage", async () => {
  const store = createMemoryGuardStore();
  const bad = await openAction(store, team({ recipient: "not-base58-0OIl", idempotencyKey: "team-bad-0001" }));
  assert.equal(bad.code, "VALIDATION_ERROR");
  assert.equal(bad.retryable, false);
  const opened = await openAction(store, team({ idempotencyKey: "team-good-0001" }));
  assert.equal((await cancelAction(store, { actionId: opened.action.actionId, reason: "lower case", now: NOW })).code, "VALIDATION_ERROR");
});

test("a reservation already given back is not reserved again by asking", async () => {
  const store = createMemoryGuardStore();
  const budgetId = await teamBudget(store, "100000000");
  const { action } = await openAction(store, team());
  await reserveBudget(store, { actionId: action.actionId, budgetId, now: NOW });
  await cancelAction(store, { actionId: action.actionId, reason: "PERSON_CANCELLED", now: NOW });
  const again = await reserveBudget(store, { actionId: action.actionId, budgetId, now: LATER });
  assert.equal(again.ok, false);
  assert.deepEqual(again.reasons, ["RESERVATION_SETTLED"]);
});

test("an adopted action claims a signature first seen later, and never another wallet's row", async () => {
  const store = createMemoryGuardStore();
  await adoptHistoryRow(store, { ...ROW, actionId: "intent-digest-0001", lane: "BRIDGE", origin: null, signature: null });
  const later = await adoptHistoryRow(store, { ...ROW, actionId: "intent-digest-0001", lane: "BRIDGE", origin: null, outcome: "DONE", signature: SIG_B });
  assert.deepEqual(later.action.signatures, [SIG_B]);
  assert.equal(await actionIdForSignature(store, "mainnet", SIG_B), later.action.actionId);
});

/* ------------------------------------------------- the critic's round 2 */

test("a fee line hides nothing: only SOL fees the payer itself paid, bounded, are set apart", async () => {
  const run = async (spend, deltaRaw, feeBreakdown, key) => {
    const store = createMemoryGuardStore();
    await defineBudget(store, { budgetId: "org_ryntra_test:fees", orgId: "org_ryntra_test", ownerId: "org_ryntra_test", limit: { ...spend, amountRaw: "100000000000" }, now: NOW });
    const { action } = await openAction(store, team({ spend, programIds: [TOKEN], idempotencyKey: key }));
    await reserveBudget(store, { actionId: action.actionId, budgetId: "org_ryntra_test:fees", now: NOW });
    await issueSignerHandoff(store, { actionId: action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: RECIPIENT, spend, programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: NOW });
    await recordSubmission(store, { actionId: action.actionId, signature: SIG_A, messageHash: MESSAGE, now: LATER });
    return recordObservation(store, { actionId: action.actionId, signature: SIG_A, outcome: "LANDED", slot: 1, observer: "rpc", now: LATER, observedDeltas: [{ owner: PAYER, mint: spend.mint, decimals: spend.decimals, deltaRaw }], feeBreakdown });
  };
  const usdcSpend = usdc("1000");
  const asUsdcFee = await run(usdcSpend, "-1000", [{ kind: "NETWORK", mint: USDC, amountRaw: "1000", payer: PAYER }], "fee-usdc-0001");
  assert.equal(asUsdcFee.spentRaw, "1000", "network fees are never in USDC");
  const sol = { mint: WRAPPED_SOL_MINT, decimals: 9, amountRaw: "1000000" };
  const sponsored = await run(sol, "-1000000", [{ kind: "NETWORK", mint: WRAPPED_SOL_MINT, amountRaw: "5000", payer: RECIPIENT }], "fee-sponsor-0001");
  assert.equal(sponsored.spentRaw, "1000000", "a fee someone else paid is not in the payer's change");
  const huge = await run({ ...sol, amountRaw: "20000000" }, "-20000000", [{ kind: "PRIORITY", mint: WRAPPED_SOL_MINT, amountRaw: "20000000", payer: PAYER }], "fee-huge-0001");
  assert.equal(huge.spentRaw, "10000000", "no more than 0.01 SOL is ever called a fee");
  const rent = await run(sol, "-1002039", [{ kind: "RENT", mint: WRAPPED_SOL_MINT, amountRaw: "2039", payer: PAYER }], "fee-rent-0001");
  assert.equal(rent.action.status, "RECOVERY", "rent is money that left the person: counted, here above the reservation");
});

test("an agent or a team names its spend, recipient and programs — no open-ended handoff", async () => {
  const store = createMemoryGuardStore();
  const agent = await openAction(store, person({ actor: { kind: "AGENT", id: "agent_x_02" }, spend: null, recipient: null, programIds: [], idempotencyKey: "agent-open-0001" }));
  assert.deepEqual(agent.reasons, ["SPEND_REQUIRED", "RECIPIENT_REQUIRED", "PROGRAMS_REQUIRED"]);
});

test("a replay is judged by the facts, not the order of their keys; an older handoff is not replayed", async () => {
  const store = createMemoryGuardStore();
  const { actionId, handoff } = await handedOff(store);
  const reordered = { amountRaw: "25000000", decimals: 6, mint: USDC };
  const again = await issueSignerHandoff(store, { actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: RECIPIENT, spend: reordered, programIds: [TOKEN], lastValidBlockHeight: 1000, expiresAt: EXPIRES, now: LATER });
  assert.equal(again.replay, true);
  assert.equal(again.handoff.handoffDigest, handoff.handoffDigest);
  assert.equal((await issueSignerHandoff(store, { actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: RECIPIENT, spend: reordered, programIds: [TOKEN], expiresAt: EXPIRES, now: LATER })).code, "VALIDATION_ERROR", "no handoff without its last valid block height");
});

test("a stored record that does not read is the store's fault, not the caller's", async () => {
  const store = createMemoryGuardStore();
  const { action } = await openAction(store, person());
  await store.collection(ACTION_COLLECTIONS.intents).set(action.actionId, { broken: true });
  const read = await markRecovery(store, { actionId: action.actionId, reason: "SEND_RESPONSE_LOST", now: LATER });
  assert.equal(read.code, "LEDGER_UNAVAILABLE");
  assert.equal(read.reasons[0], "STORED_RECORD_UNREADABLE");
});

test("an adopted action seen settled first still claims the signature it gains later", async () => {
  const store = createMemoryGuardStore();
  await adoptHistoryRow(store, { ...ROW, outcome: "DONE", signature: null, actionId: "swap-request-0001", origin: null });
  const later = await adoptHistoryRow(store, { ...ROW, outcome: "DONE", signature: SIG_B, actionId: "swap-request-0001", origin: { surface: "SPOT", side: "BUY" } });
  assert.equal(later.event.type, "SIGNATURE_SEEN");
  assert.equal(later.action.status, "OBSERVED");
  assert.equal(await actionIdForSignature(store, "mainnet", SIG_B), later.action.actionId);
});

test("a handoff whose blockhash is already past cannot be issued", async () => {
  const store = createMemoryGuardStore();
  const budgetId = await teamBudget(store, "100000000");
  const { action } = await openAction(store, team());
  await reserveBudget(store, { actionId: action.actionId, budgetId, now: NOW });
  const dead = await issueSignerHandoff(store, { actionId: action.actionId, signer: { kind: "PERSON_WALLET", ref: PAYER }, messageHash: MESSAGE, recipient: RECIPIENT, spend: usdc("25000000"), programIds: [TOKEN], lastValidBlockHeight: 900, blockHeight: 1001, expiresAt: EXPIRES, now: NOW });
  assert.deepEqual(dead.reasons, ["LAST_VALID_BLOCK_HEIGHT_PASSED"]);
});
