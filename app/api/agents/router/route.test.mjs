// Run from repo root: node --test app/api/agents/router/route.test.mjs
//
// The address an outside agent asks about money. Two answers matter: the rate
// is the one the product's own order reads, and a request to act is refused
// with what acting would take.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createRouterQuoteHandler, createRouterReadHandler } from "./handler.ts";
import { FEE_POLICY_V2, inputSideFeeRaw } from "../../../../lib/core/fee-policy.ts";
import {
  FIXTURE_MINTS,
  memeFacts,
} from "../../../../lib/agent-control/external/fixtures.ts";

const ENDPOINT = "https://ryntra.io/api/agents/router";
const NOW = new Date("2026-10-26T12:00:00.000Z");

function post(payload, { readSide } = {}) {
  const handle = createRouterQuoteHandler({
    now: () => NOW,
    readSide: readSide ?? (async (mint) => (mint === FIXTURE_MINTS.freshToken ? memeFacts() : null)),
  });
  return handle(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

async function json(response) {
  return response.json();
}

test("the read names the capabilities, the skills, the runtimes and the closed door", async () => {
  const response = createRouterReadHandler()();
  const { data } = await json(response);
  assert.deepEqual(data.capabilities, ["READ", "QUOTE"]);
  assert.ok(data.servedIntents.includes("QUOTE_TRADE"));
  assert.ok(data.skills.length >= 3);
  assert.ok(data.runtimes.length >= 3);
  assert.equal(data.execution.open, false);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("the read's tariff is the table, flow for flow", async () => {
  const { data } = await json(createRouterReadHandler()());
  for (const row of data.tariff.flows) {
    assert.equal(row.bps, FEE_POLICY_V2[row.flow].bps, row.flow);
  }
  assert.ok(data.tariff.launches.length > 0);
});

test("a trade quote answers the exact fee off the input side", async () => {
  const response = await post({
    intent: "QUOTE_TRADE",
    inputMint: FIXTURE_MINTS.usdc,
    outputMint: FIXTURE_MINTS.freshToken,
    amountRaw: "1000000",
  });
  assert.equal(response.status, 200);
  const { data } = await json(response);
  assert.equal(data.flow, "MEME");
  assert.equal(data.feeRaw, inputSideFeeRaw("1000000", FEE_POLICY_V2.MEME.bps));
  assert.equal(data.transaction, null);
  assert.equal(data.execution.open, false);
});

test("a side the catalogue cannot answer about does not raise the fee", async () => {
  const response = await post(
    {
      intent: "QUOTE_TRADE",
      inputMint: FIXTURE_MINTS.usdc,
      outputMint: FIXTURE_MINTS.oldToken,
      amountRaw: "1000000",
    },
    {
      readSide: async () => {
        throw new Error("the catalogue is unavailable");
      },
    },
  );
  const { data } = await json(response);
  assert.equal(data.flow, "AS_NOW");
  assert.ok(data.feeBps < FEE_POLICY_V2.MEME.bps);
});

test("a request to act is refused with what acting would take", async () => {
  for (const intent of ["EXECUTE_TRADE", "SIGN", "SEND_SWAP"]) {
    const response = await post({ intent });
    assert.equal(response.status, 400, intent);
    const body = await json(response);
    assert.equal(body.error.code, "INTENT_KIND_NOT_SERVED", intent);
    assert.equal(body.data.execution.open, false, intent);
    assert.ok(body.data.execution.requires.some((line) => /signature/i.test(line)), intent);
  }
});

test("a malformed intent is refused by its own name, not quoted", async () => {
  const noMints = await post({ intent: "QUOTE_TRADE" });
  assert.equal((await json(noMints)).error.code, "INTENT_MALFORMED");

  const same = await post({
    intent: "QUOTE_TRADE",
    inputMint: FIXTURE_MINTS.usdc,
    outputMint: FIXTURE_MINTS.usdc,
    amountRaw: "1000000",
  });
  assert.equal((await json(same)).error.code, "MINTS_IDENTICAL");

  const badAmount = await post({
    intent: "QUOTE_TRADE",
    inputMint: FIXTURE_MINTS.usdc,
    outputMint: FIXTURE_MINTS.freshToken,
    amountRaw: "1.5",
  });
  assert.equal((await json(badAmount)).error.code, "VALIDATION_ERROR");
});

test("a launch quote answers its preset's terms, and a closed preset refuses", async () => {
  const open = await post({ intent: "QUOTE_LAUNCH_BUY", presetId: "micro" });
  const { data } = await json(open);
  assert.equal(data.terms.presetId, "micro");
  assert.equal(data.transaction, null);

  const closed = await post({ intent: "QUOTE_LAUNCH_BUY", presetId: "advanced" });
  assert.equal((await json(closed)).error.code, "LAUNCH_PRESET_NOT_OPEN_TO_PEOPLE");

  const missing = await post({ intent: "QUOTE_LAUNCH_BUY" });
  assert.equal((await json(missing)).error.code, "INTENT_MALFORMED");
});

test("no answer of this route carries a transaction, an instruction or an account to sign", async () => {
  const bodies = [
    await json(createRouterReadHandler()()),
    await json(
      await post({
        intent: "QUOTE_TRADE",
        inputMint: FIXTURE_MINTS.usdc,
        outputMint: FIXTURE_MINTS.freshToken,
        amountRaw: "1000000",
      }),
    ),
    await json(await post({ intent: "QUOTE_LAUNCH_BUY", presetId: "micro" })),
  ];
  /* Keys, not prose: an answer explaining that a person's signature is needed
     is exactly what should be there, while a field carrying one is not. */
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        const name = key.toLowerCase();
        if (name === "transaction") {
          /* The field exists and has one possible value. Drawn and unreachable
             is the honest shape: a reader sees the step and sees it empty. */
          assert.equal(entry, null, "a transaction field carried something");
        } else {
          assert.doesNotMatch(
            name,
            /(instruction|signer|privatekey|keypair|secret|serialized)/,
            `an answer carried a field named ${key}`,
          );
        }
        walk(entry);
      }
    }
  };
  bodies.forEach(walk);
});
