import { test } from "node:test";
import assert from "node:assert/strict";

import { createSolanaRpcHandle } from "./rpc.ts";
import { recoverSend } from "./recover.ts";
import { submitClearedTransfer } from "./submit.ts";
import { resetSubmitOnceForTests } from "./submit-once.ts";

const LOCAL_SIGNATURE = "localVerifiedSignature111111111111111111111111111111111111111111";
const RPC_SIGNATURE = "rpcReturnedDifferentSignature22222222222222222222222222222222222222";

function plan(messageHash) {
  return {
    network: "devnet",
    lastValidBlockHeight: "100",
    fingerprint: { messageHash },
  };
}

function clearedCheck() {
  return {
    verdict: "CLEARED",
    comparisons: [],
    signature: {
      value: LOCAL_SIGNATURE,
      signer: "sender",
      detail: "locally verified",
    },
    detail: "locally verified",
  };
}

function handle() {
  return createSolanaRpcHandle({
    network: "devnet",
    endpoint: "https://primary.invalid",
    fallbackEndpoint: "https://fallback.invalid",
    retries: 2,
    timeoutMs: 50,
  });
}

function rpcReply(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("ambiguous submit performs one primary send and preserves the locally verified signature", async () => {
  resetSubmitOnceForTests();
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url: String(url), method: payload.method });
    throw new Error("connection reset after request bytes left the process");
  };
  try {
    const result = await submitClearedTransfer({
      handle: handle(),
      plan: plan("0xambiguous"),
      check: clearedCheck(),
      signedWireBase64: "signed",
      now: new Date("2026-08-27T10:00:00.000Z"),
    });

    assert.deepEqual(calls, [{ url: "https://primary.invalid", method: "sendTransaction" }]);
    assert.equal(result.ok, false);
    assert.equal(result.code, "AMBIGUOUS");
    assert.equal(result.signature, LOCAL_SIGNATURE);
  } finally {
    globalThis.fetch = original;
  }
});

test("an RPC signature mismatch preserves the local signature for recovery", async () => {
  resetSubmitOnceForTests();
  const original = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    methods.push(payload.method);
    return rpcReply(payload.id, RPC_SIGNATURE);
  };
  try {
    const result = await submitClearedTransfer({
      handle: handle(),
      plan: plan("0xmismatch"),
      check: clearedCheck(),
      signedWireBase64: "signed",
    });

    assert.deepEqual(methods, ["sendTransaction"]);
    assert.equal(result.ok, false);
    assert.equal(result.code, "SIGNATURE_MISMATCH");
    assert.equal(result.signature, LOCAL_SIGNATURE);
  } finally {
    globalThis.fetch = original;
  }
});

test("a matching RPC signature is submitted once before status reads begin", async () => {
  resetSubmitOnceForTests();
  const original = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    methods.push(payload.method);
    if (payload.method === "sendTransaction") return rpcReply(payload.id, LOCAL_SIGNATURE);
    if (payload.method === "getSignatureStatuses") {
      return rpcReply(payload.id, {
        context: { slot: 44 },
        value: [{ confirmationStatus: "finalized", err: null, slot: 44 }],
      });
    }
    throw new Error(`unexpected ${payload.method}`);
  };
  try {
    const result = await submitClearedTransfer({
      handle: handle(),
      plan: plan("0xmatching"),
      check: clearedCheck(),
      signedWireBase64: "signed",
    });

    assert.equal(methods.filter((method) => method === "sendTransaction").length, 1);
    assert.equal(result.ok, true);
    assert.equal(result.signature, LOCAL_SIGNATURE);
  } finally {
    globalThis.fetch = original;
  }
});

test("confirmation has one whole-operation deadline below the route budget and returns recovery data", { timeout: 500 }, async () => {
  resetSubmitOnceForTests();
  const original = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    methods.push(payload.method);
    if (payload.method === "sendTransaction") return rpcReply(payload.id, LOCAL_SIGNATURE);
    if (payload.method === "getSignatureStatuses") return await new Promise(() => {});
    throw new Error(`unexpected ${payload.method}`);
  };
  try {
    const started = Date.now();
    const result = await submitClearedTransfer({
      handle: handle(),
      plan: plan("0xdeadline"),
      check: clearedCheck(),
      signedWireBase64: "signed",
      confirmationDeadlineMs: 20,
      confirmationPollIntervalMs: 1,
    });
    assert.ok(Date.now() - started < 250);
    assert.equal(methods.filter((method) => method === "sendTransaction").length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_CONFIRMED");
    assert.equal(result.signature, LOCAL_SIGNATURE);
  } finally {
    globalThis.fetch = original;
  }
});

test("absolute request deadline includes submit latency before confirmation", { timeout: 500 }, async () => {
  resetSubmitOnceForTests();
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    if (payload.method === "sendTransaction") {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return rpcReply(payload.id, LOCAL_SIGNATURE);
    }
    if (payload.method === "getSignatureStatuses") return await new Promise(() => {});
    throw new Error(`unexpected ${payload.method}`);
  };
  try {
    const started = Date.now();
    const result = await submitClearedTransfer({
      handle: handle(),
      plan: plan("0xabsolute-deadline"),
      check: clearedCheck(),
      signedWireBase64: "signed",
      operationDeadlineAt: started + 45,
      confirmationPollIntervalMs: 1,
    });
    assert.ok(Date.now() - started < 250);
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_CONFIRMED");
    assert.equal(result.signature, LOCAL_SIGNATURE);
  } finally {
    globalThis.fetch = original;
  }
});

test("signature-status RPC failure remains UNKNOWN and cannot be reclassified EXPIRED", async () => {
  const original = globalThis.fetch;
  const methods = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    methods.push(payload.method);
    if (payload.method === "getBlockHeight") return rpcReply(payload.id, 101);
    throw new Error("status providers unavailable");
  };
  try {
    const result = await recoverSend({
      handle: handle(),
      signature: LOCAL_SIGNATURE,
      lastValidBlockHeight: "1",
    });

    assert.equal(result.state, "UNKNOWN");
    assert.equal(result.facts.statusRead.state, "UNKNOWN");
    assert.equal(result.facts.status.seen, false);
    assert.equal(result.facts.blockHeight, null);
    assert.equal(methods.includes("getBlockHeight"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("a successful unseen status read may become EXPIRED after the block height read", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    if (payload.method === "getSignatureStatuses") {
      return rpcReply(payload.id, { context: { slot: 44 }, value: [null] });
    }
    if (payload.method === "getBlockHeight") return rpcReply(payload.id, 101);
    throw new Error(`unexpected ${payload.method}`);
  };
  try {
    const result = await recoverSend({
      handle: handle(),
      signature: LOCAL_SIGNATURE,
      lastValidBlockHeight: "100",
    });
    assert.equal(result.state, "EXPIRED");
    assert.equal(result.facts.statusRead.state, "READ");
    assert.equal(result.facts.status.seen, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("recovery attempts independent effect read-back after an unresolved status without resubmitting", async () => {
  const original = globalThis.fetch;
  const methods = [];
  const effectSignatures = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    methods.push(payload.method);
    throw new Error("status providers unavailable");
  };
  try {
    const result = await recoverSend({
      handle: handle(),
      signature: LOCAL_SIGNATURE,
      lastValidBlockHeight: "1",
      readEffects: async (signature) => {
        effectSignatures.push(signature);
        return { recipientDelta: "1000000" };
      },
    });

    assert.deepEqual(effectSignatures, [LOCAL_SIGNATURE]);
    assert.deepEqual(result.effectReadback, {
      state: "READ",
      value: { recipientDelta: "1000000" },
    });
    assert.equal(methods.includes("sendTransaction"), false);
  } finally {
    globalThis.fetch = original;
  }
});
