import { test } from "node:test";
import assert from "node:assert/strict";

import { confirmSend, environmentOf, resumeSend, reviewSend, settledWord, signable, transferInput } from "./send.ts";
import { bundle, clock, FRIEND, no, ok, OWNER, scriptedFetch, SIGNATURE, USDC } from "./test-fixtures.mjs";

const PLAN = "/api/solana/transfer/plan";
const ADOPT = "/api/solana/transfer/adopt";
const SETTLE = "/api/solana/transfer/settle";
const RECOVER = "/api/solana/transfer/recover";

const TOKEN = { native: false, mint: USDC, decimals: 6, symbol: "USDC" };
const intent = (over = {}) => ({ wallet: "Phantom", sender: OWNER, asset: TOKEN, recipient: FRIEND, amountRaw: "2500000", name: null, ...over });

/** Everything the flow reaches, recorded; the wallet signs unless told otherwise. */
function rig(script, { sign = async () => ({ ok: true, signedWireBase64: "signed-bytes" }), returned = ["BYTES_MATCH"], names = [] } = {}) {
  const engine = scriptedFetch(script);
  const time = clock();
  const log = { signed: [], remembered: [], forgotten: [], receipts: [], recents: [], phases: [] };
  const verdicts = [...returned];
  const resolved = [...names];
  const deps = {
    fetch: engine.fetch,
    sign: async (wire) => {
      log.signed.push(wire);
      return sign(wire);
    },
    checkReturned: async () => ({ verdict: verdicts.shift() ?? "BYTES_MATCH", signature: SIGNATURE }),
    resolveName: async (name) => resolved.shift() ?? { state: "UNAVAILABLE", name },
    pending: { remember: (p) => log.remembered.push(p), forget: (w) => log.forgotten.push(w) },
    keepReceipt: (wallet, receipt) => log.receipts.push({ wallet, receipt }),
    rememberRecipient: (wallet, recipient) => log.recents.push({ wallet, recipient }),
    now: time.now,
    onPhase: (phase) => log.phases.push(phase),
  };
  return { deps, engine, log, time };
}

test("the engine's transfer input: SOL and a token are two actions, on mainnet", () => {
  const sol = transferInput(intent({ asset: { native: true, mint: null, decimals: 9, symbol: "SOL" }, amountRaw: "1000" }));
  assert.equal(sol.actionRef, "action:solana-token-2022/native-sol-transfer@1");
  assert.equal(sol.network, "mainnet");
  assert.equal("mint" in sol, false);
  const token = transferInput(intent());
  assert.equal(token.actionRef, "action:solana-token-2022/spl-transfer@1");
  assert.deepEqual([token.mint, token.sender, token.recipient, token.amountRaw], [USDC, OWNER, FRIEND, "2500000"]);
});

test("the Review is the engine's: its bundle, and the world it was authorized over", async () => {
  const { deps, engine } = rig({ [PLAN]: [ok({ data: bundle() })] });
  const outcome = await reviewSend(deps, intent());
  assert.equal(outcome.kind, "review");
  assert.equal(outcome.bundle.check.send.amount, "2.5");
  assert.deepEqual(outcome.authorized.bound, { recipient: FRIEND });
  assert.deepEqual(engine.asked(PLAN)[0].body, { input: transferInput(intent()) });
});

test("an engine refusal of the Review is said in Ryntra's words, never as its code", async () => {
  for (const [code, words] of [
    ["RECIPIENT_MINT_MISMATCH", "Check the recipient address."],
    ["INSUFFICIENT_FUNDS", "That amount is unavailable."],
    ["RATE_LIMITED", "Too many requests. Try again in a moment."],
    ["CANARY_EVIDENCE_UNAVAILABLE", "Sending is unavailable right now. Try again later."],
  ]) {
    const { deps } = rig({ [PLAN]: [no(422, code)] });
    const outcome = await reviewSend(deps, intent());
    assert.deepEqual(outcome, { kind: "refused", refusal: { code, message: words } }, code);
  }
  const { deps } = rig({ [PLAN]: [ok({ data: { plan: {} } })] });
  assert.equal((await reviewSend(deps, intent())).refusal.code, "BUILD_UNREADABLE");
});

test("a .skr name is read again before the Review; one that moved is never paid", async () => {
  const name = "alice.skr";
  const moved = rig({ [PLAN]: [] }, { names: [{ state: "FOUND", name, address: OWNER }] });
  const outcome = await reviewSend(moved.deps, intent({ name }));
  assert.equal(outcome.refusal.code, "SKR_CHANGED");
  assert.equal(moved.engine.asked(PLAN).length, 0);
  const unread = rig({ [PLAN]: [] }, { names: [{ state: "UNAVAILABLE", name }] });
  assert.equal((await reviewSend(unread.deps, intent({ name }))).refusal.code, "SKR_UNCHECKED");
});

test("confirm: built again, signed once, checked, sent once — and the signature kept before it left", async () => {
  const fresh = bundle({ hash: "bb" });
  const { deps, engine, log } = rig({
    [PLAN]: [ok({ data: fresh })],
    [SETTLE]: [ok({ data: { state: "RECEIPTED", signature: SIGNATURE, observation: { slot: "1", feeLamports: "6000" }, receipt: { id: "receipt-1" } } })],
  });
  const authorized = environmentOf(bundle(), "USDC");
  const outcome = await confirmSend(deps, intent(), authorized);
  assert.deepEqual(outcome, { kind: "settled", settled: { state: "RECEIPTED", signature: SIGNATURE, observed: true, receipt: { id: "receipt-1" } }, line: null });
  assert.deepEqual(log.signed, ["unsigned-bb"]);
  assert.equal(engine.asked(SETTLE).length, 1);
  const body = engine.asked(SETTLE)[0].body;
  assert.equal(body.signedWireBase64, "signed-bytes");
  assert.equal(body.plan.unsignedWireBase64, "unsigned-bb");
  assert.deepEqual(Object.keys(body).sort(), ["canaryIntent", "canaryVerdict", "plan", "preflight", "provider", "reviewProof", "signedWireBase64", "verdict"]);
  assert.equal(log.remembered.length, 1);
  assert.equal(log.remembered[0].signature, SIGNATURE);
  assert.deepEqual(log.forgotten, [OWNER]);
  assert.deepEqual(log.receipts, [{ wallet: OWNER, receipt: { id: "receipt-1" } }]);
  assert.deepEqual(log.recents, [{ wallet: OWNER, recipient: FRIEND }]);
  assert.deepEqual(log.phases, ["preparing", "wallet", "sending"]);
});

test("a wallet that says no sends nothing", async () => {
  const { deps, engine } = rig({ [PLAN]: [ok({ data: bundle() })] }, { sign: async () => ({ ok: false, reason: "User rejected the request." }) });
  const outcome = await confirmSend(deps, intent(), environmentOf(bundle(), "USDC"));
  assert.deepEqual(outcome, { kind: "cancelled", line: "Wallet approval was cancelled." });
  assert.equal(engine.asked(SETTLE).length, 0);
});

test("bytes the wallet changed are never sent", async () => {
  const { deps, engine, log } = rig({ [PLAN]: [ok({ data: bundle() })] }, { returned: ["BYTES_CHANGED"] });
  const outcome = await confirmSend(deps, intent(), environmentOf(bundle(), "USDC"));
  assert.equal(outcome.kind, "refused");
  assert.equal(outcome.refusal.message, "Your wallet returned a different transaction. Nothing was sent.");
  assert.equal(engine.asked(SETTLE).length, 0);
  assert.equal(log.remembered.length, 0);
});

test("a wallet that added only its fee: the engine re-reviews those bytes, then they go once", async () => {
  const adopted = bundle({ hash: "cc" });
  const { deps, engine } = rig(
    { [PLAN]: [ok({ data: bundle() })], [ADOPT]: [ok({ data: adopted })], [SETTLE]: [ok({ data: { state: "RECEIPTED", signature: SIGNATURE, observation: {}, receipt: null } })] },
    { returned: ["BYTES_FEE_ADDED", "BYTES_MATCH"] },
  );
  const outcome = await confirmSend(deps, intent(), environmentOf(bundle(), "USDC"));
  assert.equal(outcome.kind, "settled");
  assert.equal(engine.asked(ADOPT)[0].body.signedWireBase64, "signed-bytes");
  assert.equal(engine.asked(SETTLE)[0].body.plan.unsignedWireBase64, "unsigned-cc");
});

test("a world that moved since the Review goes back to the Review, wallet closed", async () => {
  const { deps, log } = rig({ [PLAN]: [ok({ data: bundle({ host: "rpc.two" }) })] });
  const outcome = await confirmSend(deps, intent(), environmentOf(bundle({ host: "rpc.one" }), "USDC"));
  assert.equal(outcome.kind, "review");
  assert.match(outcome.line, /Something changed/);
  assert.deepEqual(log.signed, []);
});

test("a Review the engine will not let the wallet open never opens it, and says why", async () => {
  const closed = bundle({ signable: false, blocked: { code: "SIMULATION_FAILED", en: "This transfer would fail on the network right now.", uk: "" } });
  assert.equal(signable(closed), false);
  const { deps, log } = rig({ [PLAN]: [ok({ data: closed })] });
  const outcome = await confirmSend(deps, intent(), environmentOf(closed, "USDC"));
  assert.deepEqual([outcome.kind, outcome.line], ["review", "This transfer would fail on the network right now."]);
  assert.deepEqual(log.signed, []);
  // The engine's verdict alone is not enough: an unsigned Review proof keeps the wallet closed too.
  assert.equal(signable({ ...bundle(), reviewProof: { status: "UNSIGNED" } }), false);
});

test("the engine refusing the signed transfer: said plainly, the kept signature read back by the engine's rule", async () => {
  const { deps, log } = rig({ [PLAN]: [ok({ data: bundle() })], [SETTLE]: [no(403, "SEND_NOT_PERMITTED")] });
  const outcome = await confirmSend(deps, intent(), environmentOf(bundle(), "USDC"));
  assert.deepEqual(outcome, { kind: "refused", refusal: { code: "SEND_NOT_PERMITTED", message: "Sending is turned off right now." } });
  // The record stays until the engine's recovery says the bytes went nowhere.
  assert.equal(log.remembered.length, 1);
  assert.deepEqual(log.forgotten, []);
});

test("an answer that names a signature, or no answer, is unresolved — never sent again", async () => {
  const named = rig({ [PLAN]: [ok({ data: bundle() })], [SETTLE]: [no(502, "SUBMISSION_UNKNOWN", { signature: SIGNATURE })] });
  const one = await confirmSend(named.deps, intent(), environmentOf(bundle(), "USDC"));
  assert.deepEqual(one, { kind: "unresolved", signature: SIGNATURE, line: "An earlier transfer is still being confirmed. Do not send it again." });
  const lost = rig({ [PLAN]: [ok({ data: bundle() })], [SETTLE]: [new TypeError("fetch failed")] });
  const two = await confirmSend(lost.deps, intent(), environmentOf(bundle(), "USDC"));
  assert.equal(two.kind, "unresolved");
  assert.equal(two.signature, SIGNATURE);
  assert.equal(lost.engine.asked(SETTLE).length, 1);
});

test("a settled state without the chain's read says what it is", async () => {
  const { deps } = rig({ [PLAN]: [ok({ data: bundle() })], [SETTLE]: [ok({ data: { state: "LANDED_FAILED", signature: SIGNATURE, receipt: null } })] });
  const outcome = await confirmSend(deps, intent(), environmentOf(bundle(), "USDC"));
  assert.equal(outcome.kind, "settled");
  assert.equal(outcome.line, "The network rejected this transfer. Nothing moved.");
  assert.equal(settledWord(outcome.settled), "Not sent");
  assert.equal(settledWord({ observed: true, state: "RECEIPTED" }), "Sent");
  assert.equal(settledWord({ observed: false, state: "SUBMITTED_UNKNOWN" }), "Not confirmed");
});

test("a signature left open is read back by the engine until it has an answer", async () => {
  const seen = (err = null) => ok({ data: { signature: SIGNATURE, attempt: { state: "SUBMITTED", receiptHash: null }, primary: { state: "READ", status: { seen: true, err, confirmationStatus: "finalized" } } } });
  const unseen = ok({ data: { signature: SIGNATURE, attempt: { state: "SUBMITTED", receiptHash: null }, primary: { state: "READ", status: { seen: false, err: null, confirmationStatus: null } } } });
  const engine = scriptedFetch({ [RECOVER]: [unseen, unseen, seen()] });
  const time = clock();
  const states = [];
  const forgotten = [];
  const pending = { wallet: OWNER, signature: SIGNATURE, network: "mainnet", signedAt: new Date(time.now()).toISOString() };
  const final = await resumeSend({ fetch: engine.fetch, forget: (w) => forgotten.push(w), now: time.now, sleep: time.sleep, onState: (s) => states.push(s), live: () => true }, pending);
  assert.equal(final, "LANDED");
  assert.deepEqual(states, ["CHECKING", "UNKNOWN", "UNKNOWN", "LANDED"]);
  assert.deepEqual(forgotten, [OWNER]);
  assert.deepEqual(engine.asked(RECOVER)[0].body, { network: "mainnet", signature: SIGNATURE });
});

test("bytes nobody claimed, past their life, are forgotten quietly", async () => {
  const engine = scriptedFetch({ [RECOVER]: [ok({ data: { signature: SIGNATURE, attempt: null, primary: { state: "READ", status: { seen: false, err: null, confirmationStatus: null } } } })] });
  const time = clock();
  const pending = { wallet: OWNER, signature: SIGNATURE, network: "mainnet", signedAt: new Date(time.now() - 10 * 60_000).toISOString() };
  const states = [];
  const final = await resumeSend({ fetch: engine.fetch, forget: () => {}, now: time.now, sleep: time.sleep, onState: (s) => states.push(s), live: () => true }, pending);
  assert.equal(final, null);
  assert.deepEqual(states, ["CHECKING", null]);
});
