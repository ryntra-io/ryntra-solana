/**
 * Contract 1.22.0 (`RYN-MOBILE-MONEY-API-001`): the four transfer routes — plan,
 * adopt, settle, recover — and the v1 reading of what the wallet returned
 * answer exactly the contract's shapes, and the echoed request schema accepts
 * exactly what the settle and adopt handlers' own validator accepts.
 *
 * Unlike `swap-contract.test.mjs`, the route handlers themselves are called
 * with real Requests: only the network is fake — a stubbed JSON-RPC answering
 * the methods the builders, the simulation, the submit, the confirmation and
 * the read-back use — with a memory Guard store marked durable and the issuer
 * and sender keys derived from fixed seeds, so no person's wallet appears.
 *
 * `RYNTRA_WRITE_TRANSFER_EXAMPLES=1 node --test lib/solana/transfer-contract.test.mjs`
 * writes the transfer examples under `docs/api/examples/v1/` from these answers.
 */

import { registerHooks } from "node:module";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidates = [];
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), ROOT).href;
      candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`);
    } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`);
    } else {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith("node:") && specifier.includes("/") && !/\.[cm]?js$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
        throw error;
      }
    }
    for (const candidate of candidates) {
      const path = fileURLToPath(candidate);
      if (existsSync(path) && !statSync(path).isDirectory()) return nextResolve(candidate, context);
    }
    return nextResolve(specifier, context);
  },
});

import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign as signBytes } from "node:crypto";
import test from "node:test";

/* ---------------------------------------------------------------- keys and environment, before any route loads */

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
function keyFromSeed(label) {
  const der = Buffer.concat([PKCS8_ED25519, createHash("sha256").update(label).digest()]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  return { der, privateKey, raw };
}

for (const name of Object.keys(process.env)) {
  if (/^RYNTRA_SOLANA_(RPC|CANARY)|^RYNTRA_AGENT_ISSUER|^RYNTRA_GUARD|^DATABASE_URL|^POSTGRES/.test(name)) delete process.env[name];
}
process.env.RYNTRA_AGENT_ISSUER_PRIVATE_KEY = keyFromSeed("ryntra.contract-example.issuer").der.toString("base64");
process.env.RYNTRA_SOLANA_SEND_STATE = "OPEN";

const kit = await import("@solana/kit");
const { createMemoryGuardStore } = await import(new URL("lib/guard/store.ts", ROOT).href);
const store = { ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" };
globalThis.__ryntraGuardPrototypeRuntime = { store, deployment: "SINGLE_INSTANCE", writes: { allowed: true } };

const C = await import(new URL("lib/api/v1/contract.ts", ROOT).href);
const { SettlementRequestSchema } = await import(new URL("lib/solana/settlement.ts", ROOT).href);
const { SendTransferInputSchema } = await import(new URL("lib/agent-control/adapters/solana-token-2022.ts", ROOT).href);
const { associatedTokenAccount } = await import(new URL("lib/solana/transaction.ts", ROOT).href);
const { LIGHTHOUSE_PROGRAM } = await import(new URL("lib/solana/wallet-modification.ts", ROOT).href);
const plan = await import(new URL("app/api/solana/transfer/plan/route.ts", ROOT).href);
const adopt = await import(new URL("app/api/solana/transfer/adopt/route.ts", ROOT).href);
const settle = await import(new URL("app/api/solana/transfer/settle/route.ts", ROOT).href);
const recover = await import(new URL("app/api/solana/transfer/recover/route.ts", ROOT).href);
const returned = await import(new URL("app/api/v1/money/send/returned/route.ts", ROOT).href);

const sender = keyFromSeed("ryntra.contract-example.sender");
const SENDER = kit.getBase58Decoder().decode(new Uint8Array(sender.raw));
/* The repository's own fixture recipient (on the curve; `lib/solana/lifecycle.test.mjs`). */
const RECIPIENT = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const fixture = (name) => JSON.parse(readFileSync(new URL(`lib/solana/fixtures/${name}.json`, ROOT), "utf8"));

/* ---------------------------------------------------------------- the stubbed chain */

const chain = {
  mint: null,
  recipientAta: null,
  feeForMessage: 5_000,
  sendFails: false,
  /** signature → { wireBase64, amount, fee } */
  sent: new Map(),
  unknownMethods: new Set(),
};

function signatureOf(wireBase64) {
  const decoded = kit.getTransactionDecoder().decode(Buffer.from(wireBase64, "base64"));
  const message = kit.getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const feePayer = message.staticAccounts[0];
  return { signature: kit.getBase58Decoder().decode(decoded.signatures[feePayer]), message };
}

function transactionFor(entry) {
  const { message } = entry;
  const keys = message.staticAccounts.map(String);
  const pre = keys.map((key) => (key === SENDER ? 5_000_000_000 : key === RECIPIENT ? 1_000_000 : 1));
  const post = keys.map((key, index) =>
    key === SENDER ? pre[index] - entry.amount - entry.fee : key === RECIPIENT ? pre[index] + entry.amount : pre[index],
  );
  return {
    slot: 350_123_456,
    blockTime: 1_790_000_000,
    meta: {
      err: null,
      fee: entry.fee,
      preBalances: pre,
      postBalances: post,
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
      loadedAddresses: { writable: [], readonly: [] },
    },
    transaction: {
      message: {
        accountKeys: keys,
        instructions: message.instructions.map((instruction) => ({ programIdIndex: instruction.programAddressIndex, accounts: [], data: "" })),
      },
    },
  };
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let body;
  try {
    body = JSON.parse(typeof init?.body === "string" ? init.body : "");
  } catch {
    return new Response(JSON.stringify({ error: "no network in this test" }), { status: 503 });
  }
  const reply = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json" } });
  const error = (message, code = -32602) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code, message } }), { status: 200, headers: { "content-type": "application/json" } });
  const context = { apiVersion: "2.1.0", slot: 350_123_000 };
  const systemAccount = { data: ["", "base64"], executable: false, lamports: 1_000_000, owner: SYSTEM_PROGRAM, rentEpoch: 0, space: 0 };
  switch (body.method) {
    case "getAccountInfo": {
      const [address] = body.params;
      if (chain.mint && address === chain.mint.mint) {
        return reply({
          context,
          value: { data: [chain.mint.dataBase64, "base64"], executable: false, lamports: 1_000_000, owner: chain.mint.owner, rentEpoch: 0, space: Buffer.from(chain.mint.dataBase64, "base64").length },
        });
      }
      if (address === chain.recipientAta) return reply({ context, value: null });
      return reply({ context, value: systemAccount });
    }
    case "getTokenAccountBalance": {
      const [account] = body.params;
      if (account === chain.recipientAta) return error("Invalid param: could not find account");
      return reply({ context, value: { amount: "5000000", decimals: 6, uiAmount: 5, uiAmountString: "5" } });
    }
    case "getBalance":
      return reply({ context, value: 5_000_000_000 });
    case "getMinimumBalanceForRentExemption":
      return reply(body.params[0] === 0 ? 890_880 : 2_039_280);
    case "getLatestBlockhash":
      return reply({ context, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 350_000_000 } });
    case "getFeeForMessage":
      return reply({ context, value: chain.feeForMessage });
    case "getEpochInfo":
      return reply({ absoluteSlot: 350_123_000, blockHeight: 349_999_000, epoch: 810, slotIndex: 1_000, slotsInEpoch: 432_000, transactionCount: null });
    case "simulateTransaction":
      return reply({ context, value: { err: null, logs: [], accounts: null, unitsConsumed: 450, returnData: null } });
    case "getBlockHeight":
      return reply(349_999_000);
    case "sendTransaction": {
      if (chain.sendFails) throw new TypeError("fetch failed");
      const [wire] = body.params;
      const { signature, message } = signatureOf(wire);
      chain.sent.set(signature, { message, amount: chain.pendingAmount, fee: chain.pendingFee });
      return reply(signature);
    }
    case "getSignatureStatuses": {
      const [[signature]] = body.params;
      return reply({
        context,
        value: [chain.sent.has(signature) ? { slot: 350_123_456, confirmations: null, err: null, confirmationStatus: "confirmed", status: { Ok: null } } : null],
      });
    }
    case "getTransaction": {
      const [signature] = body.params;
      const entry = chain.sent.get(signature);
      return reply(entry ? transactionFor(entry) : null);
    }
    default:
      chain.unknownMethods.add(body.method);
      return error(`unstubbed method ${body.method}`, -32601);
  }
};

/* ---------------------------------------------------------------- requests */

let ip = 0;
function post(route, body, headers = {}) {
  ip += 1;
  return new Request(`http://localhost/api/solana/transfer/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${ip}`,
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
async function call(handler, route, body, headers) {
  const response = await handler.POST(post(route, body, headers));
  return { status: response.status, body: await response.json() };
}

/** Sign exactly the bytes the Review handed over, the way a wallet does. */
function walletSign(unsignedWireBase64) {
  const decoded = kit.getTransactionDecoder().decode(Buffer.from(unsignedWireBase64, "base64"));
  const signature = new Uint8Array(signBytes(null, Buffer.from(decoded.messageBytes), sender.privateKey));
  return Buffer.from(kit.getTransactionEncoder().encode({ messageBytes: decoded.messageBytes, signatures: { ...decoded.signatures, [SENDER]: signature } })).toString("base64");
}

/** What Phantom does to a SOL transfer: a compute budget and price before it, an account-info assertion after it — then it signs. */
function walletAdjustAndSign(unsignedWireBase64, { units = 200_000, microLamports = 375_000n } = {}) {
  const decoded = kit.getTransactionDecoder().decode(Buffer.from(unsignedWireBase64, "base64"));
  const compiled = kit.getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const message = kit.decompileTransactionMessage(compiled, { lastValidBlockHeight: 350_000_000n });
  const limit = { programAddress: COMPUTE_BUDGET, data: new Uint8Array([2, units & 0xff, (units >>> 8) & 0xff, (units >>> 16) & 0xff, (units >>> 24) & 0xff]) };
  const priceData = new Uint8Array(9);
  priceData[0] = 3;
  new DataView(priceData.buffer).setBigUint64(1, microLamports, true);
  const price = { programAddress: COMPUTE_BUDGET, data: priceData };
  const guard = {
    programAddress: LIGHTHOUSE_PROGRAM,
    accounts: [{ address: SENDER, role: kit.AccountRole.READONLY }],
    data: new Uint8Array(Buffer.from("0604030053969c00000000000403000001000000000000000000", "hex")),
  };
  const adjusted = kit.appendTransactionMessageInstructions([guard], kit.prependTransactionMessageInstructions([limit, price], message));
  const transaction = kit.compileTransaction(adjusted);
  const signature = new Uint8Array(signBytes(null, Buffer.from(transaction.messageBytes), sender.privateKey));
  return Buffer.from(kit.getTransactionEncoder().encode({ messageBytes: transaction.messageBytes, signatures: { ...transaction.signatures, [SENDER]: signature } })).toString("base64");
}

function nativeInput(amountRaw) {
  return { schemaVersion: "1.0.0", actionRef: C.TRANSFER_NATIVE_SOL_ACTION_REF, network: "mainnet", sender: SENDER, recipient: RECIPIENT, amountRaw };
}
function settlementOf(data, signedWireBase64) {
  const { plan: p, preflight, verdict, provider, canaryIntent, canaryVerdict, reviewProof } = data;
  return { plan: p, preflight, verdict, provider, canaryIntent, canaryVerdict, reviewProof, signedWireBase64 };
}

/** Parse with the contract's schema and say which paths failed, so a refusal names its rule. */
function parse(schema, value, label) {
  const parsed = schema.safeParse(value);
  assert.ok(parsed.success, `${label}: ${parsed.success ? "" : parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")} — ${i.message}`).join(" · ")}`);
  return parsed.data;
}

/** The request schema must accept exactly what the handler's own validator accepts. */
function sameVerdict(value, label) {
  const contract = C.TransferSettleRequestSchema.safeParse(value).success;
  const handler = SettlementRequestSchema.safeParse(value).success;
  assert.equal(contract, handler, `${label}: the contract says ${contract}, SettlementRequestSchema says ${handler}`);
  return contract;
}

const examples = {};
const record = (name, value) => {
  examples[name] = value;
};

/* ---------------------------------------------------------------- the flows */

const flows = {};

test("plan — a token (PYUSD, Token-2022) answers a Review the contract accepts, with its passport", async () => {
  const mint = fixture("pyusd-t22");
  chain.mint = mint;
  chain.recipientAta = await associatedTokenAccount({ owner: RECIPIENT, mint: mint.mint, tokenProgram: mint.owner });
  chain.feeForMessage = 5_000;
  const request = { input: { schemaVersion: "1.0.0", actionRef: C.TRANSFER_SPL_ACTION_REF, network: "mainnet", mint: mint.mint, sender: SENDER, recipient: RECIPIENT, amountRaw: "1000000" } };
  parse(C.TransferPlanRequestSchema, request, "token plan request");
  const answer = await call(plan, "plan", request);
  assert.equal(answer.status, 200, JSON.stringify(answer.body).slice(0, 600));
  const data = parse(C.TransferReviewResponseSchema, answer.body, "token review").data;
  assert.notEqual(data.passport, null);
  assert.equal(data.plan.actionKind, "TOKEN_2022");
  flows.token = { request, answer: answer.body };
  record("transfer-plan-token.request.json", request);
  record("transfer-review-token.response.json", answer.body);
  sameVerdict(settlementOf(data, walletSign(data.plan.unsignedWireBase64)), "token settle request");
});

test("plan → settle → recover — SOL, the exact bytes: 200 RECEIPTED, then the recovery read", async () => {
  chain.mint = null;
  chain.recipientAta = null;
  chain.feeForMessage = 5_000;
  const request = { input: nativeInput("1000000") };
  parse(C.TransferPlanRequestSchema, request, "SOL plan request");
  const planned = await call(plan, "plan", request);
  assert.equal(planned.status, 200, JSON.stringify(planned.body).slice(0, 600));
  const review = parse(C.TransferReviewResponseSchema, planned.body, "SOL review").data;
  assert.equal(review.passport, null);
  assert.equal(review.reviewProof.status, "SIGNED");
  assert.ok(["ALLOW", "REVIEW"].includes(review.safety.decision), JSON.stringify(review.safety));

  const settleRequest = settlementOf(review, walletSign(review.plan.unsignedWireBase64));
  assert.equal(sameVerdict(settleRequest, "SOL settle request"), true);
  chain.pendingAmount = 1_000_000;
  chain.pendingFee = 5_000;
  const settled = await call(settle, "settle", settleRequest);
  assert.equal(settled.status, 200, JSON.stringify(settled.body).slice(0, 800));
  const result = parse(C.TransferSettleResponseSchema, settled.body, "SOL settled").data;
  parse(C.TransferSettledSchema, result, "SOL settled (the 200 form)");
  assert.equal(result.state, "RECEIPTED");
  assert.equal(result.receipt.outcome.status, "MATCHED", JSON.stringify(result.reconciliation));

  const recoverRequest = { network: "mainnet", signature: result.signature };
  parse(C.TransferRecoverRequestSchema, recoverRequest, "recover request");
  const recovered = await call(recover, "recover", recoverRequest);
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  const recovery = parse(C.TransferRecoverResponseSchema, recovered.body, "recover answer").data;
  /* The settle route never moves the attempt past SUBMITTED_UNKNOWN (the swap execute route does): a receipted Send still reads so. */
  assert.equal(recovery.attempt.state, "SUBMITTED_UNKNOWN");
  assert.equal(recovery.attempt.receiptHash, null);

  /* The same bytes again: the boundary answers SUBMISSION_UNKNOWN with the signature, never a second broadcast. */
  const again = await call(settle, "settle", settleRequest);
  assert.equal(again.status, 422);
  const refusal = parse(C.TransferSettleErrorSchema, again.body, "settle again");
  assert.equal(refusal.error.code, "SUBMISSION_UNKNOWN");
  assert.equal(refusal.error.signature, result.signature);

  /* 1.22.0: what the wallet returned, read by the server — the exact bytes, signed: settle. */
  const returnedRequest = { plan: review.plan, signedWireBase64: settleRequest.signedWireBase64 };
  parse(C.SendReturnedRequestSchema, returnedRequest, "returned request");
  const read = await call(returned, "returned", returnedRequest);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const verdict = parse(C.SendReturnedResponseSchema, read.body, "returned answer");
  assert.deepEqual([verdict.verdict, verdict.next, verdict.signature], ["BYTES_MATCH", "settle", result.signature]);
  record("send-returned.request.json", returnedRequest);
  record("send-returned.response.json", read.body);

  flows.sol = { request, review: planned.body, settleRequest, settled: settled.body, recoverRequest, recovered: recovered.body, again: again.body };
  record("transfer-plan.request.json", request);
  record("transfer-review.response.json", planned.body);
  record("transfer-settle.request.json", settleRequest);
  record("transfer-settle.response.json", settled.body);
  record("transfer-recover.request.json", recoverRequest);
  record("transfer-recover.response.json", recovered.body);
  record("error-transfer-settle.json", again.body);
});

test("plan → the wallet adjusts → adopt → settle — the adopted Review and its settlement", async () => {
  chain.feeForMessage = 5_000;
  const planned = await call(plan, "plan", { input: nativeInput("2000000") });
  assert.equal(planned.status, 200);
  const review = parse(C.TransferReviewResponseSchema, planned.body, "SOL review (to adopt)").data;
  const signedWireBase64 = walletAdjustAndSign(review.plan.unsignedWireBase64);
  const adoptRequest = settlementOf(review, signedWireBase64);
  assert.equal(sameVerdict(adoptRequest, "adopt request"), true);
  /* 1.22.0: the server reads the adjusted bytes and says adopt first. */
  const read = await call(returned, "returned", { plan: review.plan, signedWireBase64 });
  const verdict = parse(C.SendReturnedResponseSchema, read.body, "returned answer (adjusted)");
  assert.deepEqual([verdict.verdict, verdict.next], ["BYTES_FEE_ADDED", "adopt"]);
  record("send-returned-adopt.response.json", read.body);
  parse(C.TransferAdoptRequestSchema, adoptRequest, "adopt request");
  chain.feeForMessage = 80_000;
  const adopted = await call(adopt, "adopt", adoptRequest);
  chain.feeForMessage = 5_000;
  assert.equal(adopted.status, 200, JSON.stringify(adopted.body).slice(0, 800));
  const adoptedReview = parse(C.TransferAdoptResponseSchema, adopted.body, "adopted review").data;
  assert.ok(adoptedReview.plan.walletAugmentation);
  /* The plan route's schema accepts the adopt answer too: it is the same bundle with a null passport. */
  parse(C.TransferReviewResponseSchema, adopted.body, "adopted review, as a plan answer");

  const settleRequest = settlementOf(adoptedReview, signedWireBase64);
  assert.equal(sameVerdict(settleRequest, "adopted settle request"), true);
  chain.pendingAmount = 2_000_000;
  chain.pendingFee = 80_000;
  const settled = await call(settle, "settle", settleRequest);
  assert.equal(settled.status, 200, JSON.stringify(settled.body).slice(0, 800));
  parse(C.TransferSettleResponseSchema, settled.body, "adopted settled");
  flows.adopted = { adoptRequest, adopted: adopted.body, settled: settled.body };
  record("transfer-adopt.response.json", adopted.body);
});

test("settle — a broadcast with no answer: 202 UNKNOWN with the recovery facts and the read-back", async () => {
  chain.feeForMessage = 5_000;
  const planned = await call(plan, "plan", { input: nativeInput("3000000") });
  const review = parse(C.TransferReviewResponseSchema, planned.body, "SOL review (to lose)").data;
  const settleRequest = settlementOf(review, walletSign(review.plan.unsignedWireBase64));
  chain.sendFails = true;
  const settled = await call(settle, "settle", settleRequest);
  chain.sendFails = false;
  assert.equal(settled.status, 202, JSON.stringify(settled.body).slice(0, 800));
  const result = parse(C.TransferSettleResponseSchema, settled.body, "settle 202").data;
  parse(C.TransferSettleRecoverySchema, result, "settle 202 (the recovery form)");
  assert.equal(result.receipt, null);
  assert.equal(result.effectReadback.state, "READ");
  assert.equal(result.effectReadback.value.ok, false);

  const recovered = await call(recover, "recover", { network: "mainnet", signature: result.signature });
  const recovery = parse(C.TransferRecoverResponseSchema, recovered.body, "recover of an unknown outcome").data;
  assert.equal(recovery.primary.status.seen, false);
  flows.lost = { settled: settled.body, recovered: recovered.body };
  record("transfer-settle-pending.response.json", settled.body);
});

test("the refusals of every route parse as their error schemas", async () => {
  const cases = [
    [plan, "plan", C.TransferPlanErrorSchema, { input: { ...nativeInput("0") } }, 400, "VALIDATION_ERROR"],
    [plan, "plan", C.TransferPlanErrorSchema, { input: { ...nativeInput("5"), recipient: SENDER } }, 400, "VALIDATION_ERROR"],
    [plan, "plan", C.TransferPlanErrorSchema, "{", 400, "INVALID_JSON"],
    [adopt, "adopt", C.TransferAdoptErrorSchema, { plan: {} }, 400, "VALIDATION_ERROR"],
    [settle, "settle", C.TransferSettleErrorSchema, { ...flows.sol.settleRequest, extra: true }, 400, "VALIDATION_ERROR"],
    [recover, "recover", C.TransferRecoverErrorSchema, { network: "mainnet", signature: "x" }, 400, "VALIDATION_ERROR"],
  ];
  for (const [handler, route, schema, body, status, code] of cases) {
    const answer = await call(handler, route, body);
    assert.equal(answer.status, status, `${route}: ${JSON.stringify(answer.body)}`);
    assert.equal(parse(schema, answer.body, `${route} ${code}`).error.code, code);
  }
  const noJson = await plan.POST(new Request("http://localhost/api/solana/transfer/plan", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" }, body: "{}" }));
  assert.equal(parse(C.TransferPlanErrorSchema, await noJson.json(), "plan JSON_REQUIRED").error.code, "JSON_REQUIRED");
  const foreign = await call(recover, "recover", flows.sol.recoverRequest, { origin: "https://elsewhere.example", "sec-fetch-site": "cross-site" });
  assert.equal(foreign.status, 403);
  assert.equal(parse(C.TransferRecoverErrorSchema, foreign.body, "recover FORBIDDEN_ORIGIN").error.code, "FORBIDDEN_ORIGIN");
  /* The owner-canary flow: 503 OWNER_CANARY_UNAVAILABLE only while its policy is unreadable; here it reads, so the request goes on and meets the boundary. */
  const canary = await call(settle, "settle", flows.sol.settleRequest, { "x-ryntra-canary-flow": "OWNER_CANARY" });
  assert.ok(canary.status >= 400, JSON.stringify(canary.body));
  parse(C.TransferSettleErrorSchema, canary.body, "settle with the owner-canary flow");
  /* A proof the issuer never signed: 422 with `signature: null` — nothing reached the network. */
  const forged = { ...flows.sol.settleRequest, reviewProof: { ...flows.sol.settleRequest.reviewProof, digest: `0x${"ab".repeat(32)}` } };
  const refused = await call(settle, "settle", forged);
  assert.equal(refused.status, 422, JSON.stringify(refused.body));
  const body = parse(C.TransferSettleErrorSchema, refused.body, "settle REVIEW_PROOF_INVALID");
  assert.equal(body.error.code, "REVIEW_PROOF_INVALID");
  assert.equal(body.error.signature, null);
});

test("the echoed request schema accepts exactly what SettlementRequestSchema accepts", () => {
  const base = flows.sol.settleRequest;
  const adopted = flows.adopted.adoptRequest;
  const variants = {
    "as answered": base,
    "adopted bundle": settlementOf(flows.adopted.adopted.data, flows.adopted.adoptRequest.signedWireBase64),
    "token bundle": settlementOf(flows.token.answer.data, adopted.signedWireBase64),
    "an extra top-level key": { ...base, receiptId: "x" },
    "an extra plan key": { ...base, plan: { ...base.plan, note: "x" } },
    "the first leg disagrees with its projection": { ...base, plan: { ...base.plan, fingerprint: { ...base.plan.fingerprint, transfer: { ...base.plan.fingerprint.transfer, amountRaw: "999" } } } },
    "the legs do not add up": { ...base, plan: { ...base.plan, amountRaw: "7" } },
    "a native plan with a token account": { ...base, plan: { ...base.plan, senderTokenAccount: RECIPIENT } },
    "a program missing from the list": { ...base, plan: { ...base.plan, programs: [COMPUTE_BUDGET] } },
    "an augmentation without the ComputeBudget program": { ...base, plan: { ...base.plan, walletAugmentation: { computeUnitLimit: 1, microLamportsPerUnit: "1", maximumPriorityFeeLamports: "0", lighthouseAssertions: [] } } },
    "a leading zero in an amount": { ...base, plan: { ...base.plan, senderBalanceRaw: "05" } },
    "a 41-digit balance (no length bound)": { ...base, plan: { ...base.plan, senderBalanceRaw: "1".repeat(41) } },
    "a 9000-character memo": { ...base, plan: { ...base.plan, memo: "m".repeat(9000) } },
    "unbounded preflight text": { ...base, preflight: { ...base.preflight, unfilledReason: "r".repeat(20_000), observedAt: "not a time" } },
    "an empty unfilled reason": { ...base, preflight: { ...base.preflight, unfilledReason: "" } },
    "a skipped simulation": { ...base, preflight: { ...base.preflight, simulation: { status: "SKIPPED", reason: "down" } } },
    "an unbounded verdict detail": { ...base, verdict: { ...base.verdict, findings: [{ ...base.verdict.findings[0], detail: "d".repeat(50_000) }] } },
    "no verdict findings": { ...base, verdict: { ...base.verdict, findings: [] } },
    "a 254-character host": { ...base, provider: { ...base.provider, host: "h".repeat(254) } },
    "an EVM canary destination": { ...base, canaryIntent: { ...base.canaryIntent, destination: "eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } },
    "a canary destination that is neither": { ...base, canaryIntent: { ...base.canaryIntent, destination: "not-an-address" } },
    "usd total without its parts": { ...base, canaryIntent: { ...base.canaryIntent, principalUsdMicros: null, feeReserveUsdMicros: null, usdMicros: "5" } },
    "usd total that is not the sum": { ...base, canaryIntent: { ...base.canaryIntent, principalUsdMicros: "2", feeReserveUsdMicros: "2", usdMicros: "5" } },
    "usd total that is the sum": { ...base, canaryIntent: { ...base.canaryIntent, principalUsdMicros: "2", feeReserveUsdMicros: "3", usdMicros: "5" } },
    "nine canary findings": { ...base, canaryVerdict: { ...base.canaryVerdict, findings: base.canaryVerdict.findings.slice(1) } },
    "an unsigned proof": { ...base, reviewProof: { schema: "ryntra.solana.send-review-proof", schemaVersion: "2.0.0", status: "UNSIGNED", digest: base.reviewProof.digest, reasonCode: "NO_ISSUER_KEY_CONFIGURED", issuedAt: base.reviewProof.issuedAt } },
    "a short signed transaction": { ...base, signedWireBase64: "A".repeat(63) },
    "a signed transaction that is not base64": { ...base, signedWireBase64: "!".repeat(100) },
  };
  const verdicts = {};
  for (const [label, value] of Object.entries(variants)) verdicts[label] = sameVerdict(value, label);
  /* Both validators accept exactly these; every other variant is refused by both. The handler checks no base64 here, and neither does the contract. */
  const accepted = ["as answered","adopted bundle","token bundle","a 41-digit balance (no length bound)","unbounded preflight text","a skipped simulation","an unbounded verdict detail","an EVM canary destination","usd total that is the sum","an unsigned proof","a signed transaction that is not base64"];
  for (const [label, verdict] of Object.entries(verdicts)) assert.equal(verdict, accepted.includes(label), label);

  /* the plan request against the route's own `z.object({ input: SendTransferInputSchema }).strict()` */
  const RouteRequest = SendTransferInputSchema;
  for (const input of [flows.sol.request.input, flows.token.request.input, nativeInput("0"), { ...nativeInput("5"), recipient: SENDER }, { ...nativeInput("5"), mint: RECIPIENT }, { ...flows.token.request.input, amountRaw: "01" }]) {
    assert.equal(C.TransferInputSchema.safeParse(input).success, RouteRequest.safeParse(input).success, JSON.stringify(input));
  }
});

test("every stubbed RPC method was answered, and the examples come from these answers", () => {
  assert.equal(chain.unknownMethods.size, 0, `unstubbed RPC methods: ${[...chain.unknownMethods].join(", ")}`);
  assert.ok(Object.keys(examples).length >= 10);
  for (const value of Object.values(examples)) JSON.parse(JSON.stringify(value));
  if (process.env.RYNTRA_WRITE_TRANSFER_EXAMPLES !== "1") return;
  const out = new URL("docs/api/examples/v1/", ROOT);
  for (const [name, value] of Object.entries(examples)) writeFileSync(new URL(name, out), `${JSON.stringify(value, null, 2)}
`);
});

test.after(() => {
  globalThis.fetch = realFetch;
});
