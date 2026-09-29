import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { encodeReceiveMessage, planBaseCctpMint, RECEIVE_MESSAGE_SELECTOR } from "./cctp-mint.ts";
import { BASE_MESSAGE_TRANSMITTER_V2, USED_NONCES_SELECTOR } from "./cctp-observe.ts";
import { createBaseRpcHandle } from "./rpc.ts";

const FIXTURE = JSON.parse(
  readFileSync(new URL("../solana/fixtures/cctp-v2-solana-to-base.json", import.meta.url), "utf8"),
);
const NONCE = FIXTURE.expected.nonce;
const ATTESTATION = `0x${"ab".repeat(130)}`;
const FROM = "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401";

const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const result = (value) => json({ jsonrpc: "2.0", id: 1, result: value });
const rpcError = (message) => json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message } });
const uint = (value) => BigInt(value).toString(16).padStart(64, "0");

function chain({ usedNonces = 0, gas = 165_000, gasPrice = 6_000_000, ethBalance = 273_024_989_000_000n, usdc = 1000, gasError = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ method: body.method, params: body.params });
    switch (body.method) {
      case "eth_call": {
        const { to, data } = body.params[0];
        if (to.toLowerCase() === BASE_MESSAGE_TRANSMITTER_V2.toLowerCase() && data.startsWith(USED_NONCES_SELECTOR)) {
          return result(`0x${uint(usedNonces)}`);
        }
        return result(`0x${uint(usdc)}`);
      }
      case "eth_getBalance":
        return result(`0x${ethBalance.toString(16)}`);
      case "eth_estimateGas":
        return gasError ? rpcError(gasError) : result(`0x${gas.toString(16)}`);
      case "eth_gasPrice":
        return result(`0x${gasPrice.toString(16)}`);
      default:
        throw new Error(`unexpected ${body.method}`);
    }
  };
  impl.calls = calls;
  return impl;
}

const handleWith = (fetchImpl) => createBaseRpcHandle({ env: {}, fetchImpl });

test("the calldata layout is the one a live Base mint actually used", () => {
  /* The reference transaction put the message at offset 0x40 and the
     attestation at 0x280. A 514-byte message pads to 544, so the second offset
     is 64 + 32 + 544 = 640 = 0x280 — which is how this encoder is checked
     against the chain rather than against an ABI encoder that might agree with
     it and both be wrong. */
  const data = encodeReceiveMessage(FIXTURE.messageHex, ATTESTATION);
  assert.equal(data.slice(0, 10), RECEIVE_MESSAGE_SELECTOR);
  const word = (index) => data.slice(10 + index * 64, 10 + (index + 1) * 64);
  assert.equal(BigInt(`0x${word(0)}`), 64n, "message offset 0x40");
  assert.equal(BigInt(`0x${word(1)}`), 640n, "attestation offset 0x280");
  assert.equal(BigInt(`0x${word(2)}`), BigInt(FIXTURE.messageBytes), "message length in bytes");
});

test("the message body round-trips out of the calldata unchanged", () => {
  const data = encodeReceiveMessage(FIXTURE.messageHex, ATTESTATION);
  const body = data.slice(10);
  const messageOffset = Number(BigInt(`0x${body.slice(0, 64)}`));
  const length = Number(BigInt(`0x${body.slice(messageOffset * 2, messageOffset * 2 + 64)}`));
  const message = body.slice(messageOffset * 2 + 64, messageOffset * 2 + 64 + length * 2);
  assert.equal(`0x${message}`, FIXTURE.messageHex.toLowerCase());

  const attestationOffset = Number(BigInt(`0x${body.slice(64, 128)}`));
  const attestationLength = Number(BigInt(`0x${body.slice(attestationOffset * 2, attestationOffset * 2 + 64)}`));
  assert.equal(attestationLength, 130, "two 65-byte signatures");
});

test("empty or malformed inputs refuse rather than encoding a call to nothing", () => {
  assert.throws(() => encodeReceiveMessage("0x", ATTESTATION));
  assert.throws(() => encodeReceiveMessage(FIXTURE.messageHex, "0x"));
  assert.throws(() => encodeReceiveMessage("not hex", ATTESTATION));
  assert.throws(() => encodeReceiveMessage("0xabc", ATTESTATION), /whole-byte/);
});

test("a message already received needs no transaction at all", async () => {
  const plan = await planBaseCctpMint(handleWith(chain({ usedNonces: 1 })), {
    from: FROM,
    nonce: NONCE,
    messageHex: FIXTURE.messageHex,
    attestationHex: ATTESTATION,
  });
  assert.equal(plan.state, "ALREADY_MINTED");
  assert.match(plan.reason, /would revert and mint nothing/);
});

test("a ready mint carries the chain's own gas estimate and its cost", async () => {
  const plan = await planBaseCctpMint(handleWith(chain()), {
    from: FROM,
    nonce: NONCE,
    messageHex: FIXTURE.messageHex,
    attestationHex: ATTESTATION,
  });
  assert.equal(plan.state, "READY");
  assert.equal(plan.to, BASE_MESSAGE_TRANSMITTER_V2);
  assert.equal(plan.chainId, 8453);
  assert.equal(plan.gasEstimate, "165000");
  assert.equal(plan.gasPriceWei, "6000000");
  assert.equal(plan.maximumCostWei, (165_000n * 6_000_000n).toString());
  assert.equal(plan.affordable, true);
  assert.equal(plan.usdcBeforeRaw, "1000");
});

test("a wallet that cannot pay is not ready, and says which half is short", async () => {
  const plan = await planBaseCctpMint(handleWith(chain({ ethBalance: 1n })), {
    from: FROM,
    nonce: NONCE,
    messageHex: FIXTURE.messageHex,
    attestationHex: ATTESTATION,
  });
  assert.equal(plan.state, "NOT_READY");
  assert.equal(plan.affordable, false);
  assert.match(plan.reason, /less ETH on Base than this call would cost/);
});

test("a call the chain will not price is not offered to a wallet", async () => {
  const plan = await planBaseCctpMint(handleWith(chain({ gasError: "execution reverted" })), {
    from: FROM,
    nonce: NONCE,
    messageHex: FIXTURE.messageHex,
    attestationHex: ATTESTATION,
  });
  assert.equal(plan.state, "NOT_READY");
  assert.match(plan.reason, /would likely revert/);
});

test("permissionless is stated, and never as a guarantee", async () => {
  const plan = await planBaseCctpMint(handleWith(chain()), {
    from: FROM,
    nonce: NONCE,
    messageHex: FIXTURE.messageHex,
    attestationHex: ATTESTATION,
  });
  assert.equal(plan.permissionless.destinationCallerIsZero, true);
  assert.equal(plan.permissionless.meaning, "ANYONE_HOLDING_THE_MESSAGE_AND_ATTESTATION_MAY_SUBMIT_IT");
  assert.equal(
    plan.permissionless.notAGuarantee,
    "PERMISSIONLESS_MEANS_ANYONE_MAY_SUBMIT_IT_NOT_THAT_SOMEONE_WILL",
    "anyone may is not someone will, and the plan carries the difference itself",
  );
});

test("an unreadable replay guard stops the plan instead of guessing", async () => {
  const plan = await planBaseCctpMint(handleWith(chain()), {
    from: FROM,
    nonce: `0x${"0".repeat(64)}`,
    messageHex: FIXTURE.messageHex,
    attestationHex: ATTESTATION,
  });
  assert.equal(plan.state, "UNAVAILABLE");
  assert.match(plan.reason, /pre-marked consumed/);
});

test("an address that is not twenty bytes never reaches the chain", async () => {
  const fetchImpl = chain();
  const plan = await planBaseCctpMint(handleWith(fetchImpl), {
    from: "0xnope",
    nonce: NONCE,
    messageHex: FIXTURE.messageHex,
    attestationHex: ATTESTATION,
  });
  assert.equal(plan.state, "UNAVAILABLE");
  assert.equal(fetchImpl.calls.length, 0);
});
