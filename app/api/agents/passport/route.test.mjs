import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AgentverseAdapterError } from "../../../../lib/agent-control/adapters/agentverse.ts";
import { createAgentPassportGetHandler } from "./handler.ts";
import { GET as productionGet } from "./route.ts";

const ADDRESS = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyyw9";
const CHECKSUM_MUTATION = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyywq";
const ALPHABET_ONLY_ADDRESS = `agent1${"q".repeat(59)}`;
const ROUTE = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const ALLOWED_RATE = {
  allowed: true,
  limit: 90,
  remaining: 89,
  resetAfterSeconds: 60,
  retryAfterSeconds: 60,
};

function handler(fetchPassport, rate = ALLOWED_RATE) {
  return createAgentPassportGetHandler({
    fetchPassport,
    consumeRequest: () => rate,
  });
}

test("the passport query accepts exactly one strict Agentverse address", async () => {
  let calls = 0;
  const get = handler(async () => {
    calls += 1;
    return { kind: "AGENT_PASSPORT" };
  });

  for (const query of [
    "",
    "?address=not-an-agent",
    `?address=${CHECKSUM_MUTATION}`,
    `?address=${ALPHABET_ONLY_ADDRESS}`,
    `?address=${ADDRESS}&address=${ADDRESS}`,
    `?address=${ADDRESS}&network=testnet`,
    `?agent=${ADDRESS}`,
  ]) {
    const response = await get(new Request(`https://ryntra.test/api/agents/passport${query}`));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(await response.json(), {
      error: {
        code: "INVALID_REQUEST",
        message: "Provide exactly one valid Agentverse address query.",
      },
    });
  }
  assert.equal(calls, 0, "invalid queries must not amplify into provider reads");
});

test("the route uses the shared limiter, fixed schema, caller signal and private no-store headers", () => {
  assert.match(ROUTE, /createAgentPassportGetHandler\(\{/);
  assert.match(ROUTE, /fetchPassport: fetchAgentverseAgentPassport/);
  assert.doesNotMatch(ROUTE, /globalThis|authorization|bearer|cookie|credentials:/i);
});

test("the production route delegates to the strict handler without touching the provider", async () => {
  const response = await productionGet(
    new Request("https://ryntra.test/api/agents/passport?address=invalid"),
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("a valid lookup is abort-aware and remains private no-store", async () => {
  const passport = { kind: "AGENT_PASSPORT", maturity: "SOURCE_PREVIEW" };
  let observedInput;
  let observedDependencies;
  const get = handler(async (input, dependencies) => {
    observedInput = input;
    observedDependencies = dependencies;
    return passport;
  });
  const request = new Request(`https://ryntra.test/api/agents/passport?address=${ADDRESS}`);
  const response = await get(request);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: passport });
  assert.deepEqual(observedInput, { address: ADDRESS });
  assert.deepEqual(Object.keys(observedDependencies), ["signal"]);
  assert.equal(observedDependencies.signal, request.signal);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
});

test("rate limiting rejects before validation or an upstream read", async () => {
  let calls = 0;
  const get = handler(
    async () => {
      calls += 1;
      return { kind: "AGENT_PASSPORT" };
    },
    {
      allowed: false,
      limit: 90,
      remaining: 0,
      resetAfterSeconds: 37,
      retryAfterSeconds: 37,
    },
  );
  const response = await get(new Request("https://ryntra.test/api/agents/passport?bad=query"));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "37");
  assert.equal(calls, 0);
});

test("typed cancellation is bounded and never reflects adapter details", async () => {
  const sentinel = "https://user:secret@example.invalid/?token=do-not-reflect";
  const get = handler(async () => {
    throw new AgentverseAdapterError("ABORTED", sentinel);
  });
  const response = await get(
    new Request(`https://ryntra.test/api/agents/passport?address=${ADDRESS}`),
  );
  const body = await response.json();

  assert.equal(response.status, 499);
  assert.deepEqual(body, {
    error: {
      code: "REQUEST_ABORTED",
      message: "The Agent Passport request was cancelled.",
    },
  });
  assert.doesNotMatch(JSON.stringify(body), /secret|do-not-reflect|example\.invalid/i);
});

test("unexpected failures use one bounded no-store response", async () => {
  const get = handler(async () => {
    throw new Error("provider body contains bearer provider-secret");
  });
  const response = await get(
    new Request(`https://ryntra.test/api/agents/passport?address=${ADDRESS}`),
  );
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(body, {
    error: {
      code: "UPSTREAM_FAILURE",
      message: "The Agent Passport source read could not be completed.",
    },
  });
  assert.doesNotMatch(JSON.stringify(body), /bearer|provider-secret/i);
});
