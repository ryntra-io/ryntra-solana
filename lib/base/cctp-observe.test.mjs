import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BASE_CCTP_TOPICS,
  BASE_MESSAGE_TRANSMITTER_V2,
  BASE_TOKEN_MESSENGER_V2,
  BASE_USDC,
  USED_NONCES_SELECTOR,
  observeBaseCctpMint,
  readBaseNonceState,
  reconcileBaseMint,
  secondOperator,
} from "./cctp-observe.ts";
import { createBaseRpcHandle } from "./rpc.ts";

const FIXTURE = JSON.parse(
  readFileSync(new URL("../solana/fixtures/cctp-v2-solana-to-base.json", import.meta.url), "utf8"),
);

const NONCE = FIXTURE.expected.nonce;
const RECIPIENT = "0xc1062b7c5dc8e4b1df9f200fe360cdc0ed6e7741";
const MINT_TX = "0x8c031cf27ded22a8835cd0c2f12d8f52bf790847bb177a3359cab990b74bdeb6";
/* Burned 514539, Circle took 51, so 514488 was minted. All three read from the
   same live transfer, which is what makes the arithmetic a check rather than a
   restatement. */
const MINTED_RAW = "514488";
const FEE_RAW = "51";

const pad = (address) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
const uint = (value) => BigInt(value).toString(16).padStart(64, "0");

const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const result = (value) => json({ jsonrpc: "2.0", id: 1, result: value });
const rpcError = (message, code = -32000) => json({ jsonrpc: "2.0", id: 1, error: { code, message } });

const messageReceivedLog = {
  address: BASE_MESSAGE_TRANSMITTER_V2,
  topics: [BASE_CCTP_TOPICS.messageReceived, pad(RECIPIENT), NONCE, `0x${uint(1000)}`],
  data: "0x",
  blockNumber: "0x3062064",
  transactionHash: MINT_TX,
  logIndex: "0x200",
};

const mintAndWithdrawLog = {
  address: BASE_TOKEN_MESSENGER_V2,
  topics: [BASE_CCTP_TOPICS.mintAndWithdraw, pad(RECIPIENT), pad(BASE_USDC)],
  data: `0x${uint(MINTED_RAW)}${uint(FEE_RAW)}`,
  blockNumber: "0x3062064",
  transactionHash: MINT_TX,
  logIndex: "0x203",
};

/** Answers by method, and for eth_call by the contract being called. */
function chain({ usedNonces = 1, logs = [messageReceivedLog], receipt = { logs: [mintAndWithdrawLog] }, logsError = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(String(init.body));
    calls.push({ host: new URL(String(url)).host, method: body.method, params: body.params });
    if (body.method === "eth_call") {
      const { to, data } = body.params[0];
      assert.equal(to.toLowerCase(), BASE_MESSAGE_TRANSMITTER_V2.toLowerCase());
      assert.equal(data.slice(0, 10), USED_NONCES_SELECTOR);
      return result(`0x${uint(usedNonces)}`);
    }
    if (body.method === "eth_getLogs") return logsError ? rpcError(logsError) : result(logs);
    if (body.method === "eth_getTransactionReceipt") return result(receipt);
    throw new Error(`unexpected ${body.method}`);
  };
  impl.calls = calls;
  return impl;
}

const handleWith = (fetchImpl) => createBaseRpcHandle({ env: {}, fetchImpl });

const observe = (fetchImpl) =>
  observeBaseCctpMint(handleWith(fetchImpl), {
    nonce: NONCE,
    fromBlock: 50_749_000n,
    toBlock: 50_750_000n,
    now: () => new Date("2026-09-01T12:00:00.000Z"),
  });

test("the topics are the V2 ones the chain actually emitted", () => {
  /* Circle's contract-interfaces page still documents the V1 shapes for these
     V2 contracts, and both V1 topics are absent from the V2 mint path. An
     integration written from that page filters on them and finds nothing. */
  assert.equal(BASE_CCTP_TOPICS.messageReceived, FIXTURE.topics["MessageReceived(address,uint32,bytes32,bytes32,uint32,bytes)"]);
  assert.equal(BASE_CCTP_TOPICS.mintAndWithdraw, FIXTURE.topics["MintAndWithdraw(address,uint256,address,uint256)"]);
  assert.equal(BASE_CCTP_TOPICS.usdcMint, FIXTURE.topics["Mint(address,address,uint256)"]);
  assert.equal(BASE_CCTP_TOPICS.transfer, FIXTURE.topics["Transfer(address,address,uint256)"]);
});

test("the addresses come from the CCTP registry, not from a second copy", () => {
  assert.equal(BASE_MESSAGE_TRANSMITTER_V2, FIXTURE.messageTransmitterV2);
  assert.equal(BASE_TOKEN_MESSENGER_V2, FIXTURE.tokenMessengerV2);
});

test("the all-zero nonce is refused before it is asked", async () => {
  /* The transmitter pre-marks usedNonces[bytes32(0)] as consumed at
     deployment, so a malformed message would come back `already minted`. A
     boundary that accepted that answer would report the safest-sounding
     conclusion at exactly the moment it knew nothing. */
  const fetchImpl = chain();
  const read = await readBaseNonceState(handleWith(fetchImpl), `0x${"0".repeat(64)}`);
  assert.equal(read.state, "UNREADABLE");
  assert.match(read.reason, /pre-marked consumed/);
  assert.equal(fetchImpl.calls.length, 0);
});

test("a nonce that is not 32 bytes never reaches the chain", async () => {
  const fetchImpl = chain();
  const read = await readBaseNonceState(handleWith(fetchImpl), "0xdeadbeef");
  assert.equal(read.state, "UNREADABLE");
  assert.equal(fetchImpl.calls.length, 0);
});

test("an unconsumed nonce means the mint has not happened", async () => {
  const observation = await observe(chain({ usedNonces: 0 }));
  assert.equal(observation.state, "NOT_MINTED");
  assert.equal(observation.nonceState, "UNCONSUMED");
  assert.equal(observation.facts, null);
});

test("a consumed nonce with its log read is a mint, with the amounts the chain reported", async () => {
  const fetchImpl = chain();
  const observation = await observe(fetchImpl);
  assert.equal(observation.state, "MINTED");
  assert.equal(observation.nonceState, "CONSUMED");
  assert.ok(observation.facts);
  assert.equal(observation.facts.transactionHash, MINT_TX);
  assert.equal(observation.facts.mintRecipient, RECIPIENT);
  assert.equal(observation.facts.mintToken, BASE_USDC.toLowerCase());
  assert.equal(observation.facts.mintedRaw, MINTED_RAW);
  assert.equal(observation.facts.feeCollectedRaw, FEE_RAW);
  assert.equal(
    (BigInt(FIXTURE.expected.amountRaw) - BigInt(observation.facts.feeCollectedRaw)).toString(),
    observation.facts.mintedRaw,
    "burned minus the executed fee is what arrived",
  );
});

test("the log filter leaves the caller open, because the mint is usually relayed", async () => {
  const fetchImpl = chain();
  await observe(fetchImpl);
  const logsCall = fetchImpl.calls.find((entry) => entry.method === "eth_getLogs");
  assert.ok(logsCall);
  const [filter] = logsCall.params;
  assert.equal(filter.address, BASE_MESSAGE_TRANSMITTER_V2);
  assert.equal(filter.topics[0], BASE_CCTP_TOPICS.messageReceived);
  assert.equal(filter.topics[1], null, "anyone may relay the mint; pinning the caller would miss it");
  assert.equal(filter.topics[2], NONCE);
});

test("consumed but unseen is its own state, and it is never NOT_MINTED", async () => {
  /* The single most consequential distinction in this module. The chain says
     the message was minted and the log is outside every reachable window. The
     money arrived; this product cannot yet show the transaction. Reporting
     that as "not minted" would invite a second burn. */
  const observation = await observe(chain({ logs: [] }));
  assert.equal(observation.state, "CONSUMED_UNSEEN");
  assert.equal(observation.nonceState, "CONSUMED");
  assert.equal(observation.facts, null);
  assert.match(observation.reason, /outside the searched window/);
  assert.deepEqual(observation.searched, { fromBlock: "50749000", toBlock: "50750000" });
});

test("an unreadable log query downgrades to consumed-unseen rather than to an absence", async () => {
  const observation = await observe(chain({ logsError: "request timeout on the free plan" }));
  assert.equal(observation.state, "CONSUMED_UNSEEN");
  assert.equal(observation.facts, null);
});

test("a receipt with no MintAndWithdraw is consumed-unseen, not a mint of zero", async () => {
  const observation = await observe(chain({ receipt: { logs: [messageReceivedLog] } }));
  assert.equal(observation.state, "CONSUMED_UNSEEN");
  assert.equal(observation.facts, null);
  assert.match(observation.reason, /carries no MintAndWithdraw/);
});

test("an unreadable nonce is unavailable, which authorizes nothing either way", async () => {
  const fetchImpl = async () => {
    throw new Error("socket hang up");
  };
  const observation = await observe(fetchImpl);
  assert.equal(observation.state, "UNAVAILABLE");
  assert.equal(observation.nonceState, "UNREADABLE");
  assert.notEqual(observation.state, "NOT_MINTED");
});

test("reconciliation separates what the chain did from what was asked for", async () => {
  const observation = await observe(chain());
  const matched = reconcileBaseMint(observation, { recipient: RECIPIENT, receivedRaw: MINTED_RAW });
  assert.equal(matched.verdict, "MATCHED");
  assert.deepEqual(matched.deviations, []);

  const wrongRecipient = reconcileBaseMint(observation, {
    recipient: "0x152d11000000000000000000000000000000c401",
    receivedRaw: MINTED_RAW,
  });
  assert.equal(wrongRecipient.verdict, "DEVIATION_RECORDED");
  assert.equal(wrongRecipient.deviations.length, 1);
  assert.match(wrongRecipient.deviations[0], /^recipient:/);

  const wrongAmount = reconcileBaseMint(observation, { recipient: RECIPIENT, receivedRaw: "2000000" });
  assert.equal(wrongAmount.verdict, "DEVIATION_RECORDED");
  assert.match(wrongAmount.deviations[0], /^amount:/);
});

test("an unobserved mint reconciles to neither matched nor deviation", async () => {
  const observation = await observe(chain({ logs: [] }));
  const verdict = reconcileBaseMint(observation, { recipient: RECIPIENT, receivedRaw: MINTED_RAW });
  assert.equal(verdict.verdict, "NOT_OBSERVED");
  assert.notEqual(verdict.verdict, "MATCHED", "an unseen mint must never read as a matched one");
});

test("the second operator is a different host, or honestly absent", () => {
  const handle = createBaseRpcHandle({ env: {} });
  assert.equal(secondOperator(handle, "mainnet.base.org")?.host, "base.drpc.org");
  const single = createBaseRpcHandle({
    env: {
      RYNTRA_BASE_RPC_MAINNET: "https://only.example.test",
      RYNTRA_BASE_RPC_MAINNET_FALLBACK: "not a url",
      RYNTRA_BASE_RPC_MAINNET_INDEPENDENT: "not a url",
    },
  });
  assert.equal(
    secondOperator(single, "only.example.test"),
    null,
    "asking the same host twice and calling it agreement is the failure this prevents",
  );
});
