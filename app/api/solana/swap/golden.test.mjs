/**
 * Golden transcripts of the Solana swap routes.
 *
 * Each scenario drives the real route handlers (`order`, `execute`, `quote`,
 * `recover`, `cancel-review`) against a stubbed network and an in-memory
 * multi-writer store, and records everything observable: the request, the
 * status, the headers, the body, every outbound call in order, and the whole
 * store afterwards. The record is compared with `golden/transcripts.json`.
 *
 *   node --test app/api/solana/swap/golden.test.mjs           compare
 *   GOLDEN_UPDATE=1 node --test app/api/solana/swap/golden.test.mjs   rewrite
 *
 * Nothing reaches the network: `fetch` is replaced for the whole scenario, and
 * a call no scenario answers is recorded as `unexpected` and answered with a
 * deterministic HTTP 599. The clock is frozen at `T0` (`Date` only); the
 * real waits the routes make — the venue's 1.5 s pause and, since SOL-S1, the
 * execute route's 0.5 s landing read — advance the frozen clock by exactly
 * that much and then yield at once, so a poll runs its real number of rounds
 * in no real time. `Server-Timing` (SOL-S1) is recorded by its step names
 * only: its durations are the machine's, not the route's behaviour.
 *
 * One value is not deterministic and is replaced in the record: the referral
 * code a new rewards account receives is 128 random bits, and appears as
 * `<referral-code-N>` in order of first appearance.
 */
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const path = pathResolve(specifier.slice(2));
      for (const extension of ["", ".ts", ".tsx", ".js", "/index.ts"]) {
        if (existsSync(path + extension)) return nextResolve(pathToFileURL(path + extension).href, context);
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && context.parentURL) {
        const path = fileURLToPath(new URL(specifier, context.parentURL));
        for (const extension of [".ts", ".tsx", ".js", "/index.ts"]) {
          if (existsSync(path + extension)) return nextResolve(pathToFileURL(path + extension).href, context);
        }
      }
      /* Next's bundler resolves `next/headers` without an extension; Node's resolver needs `next/headers.js`. */
      if (!specifier.startsWith(".") && !specifier.startsWith("node:") && specifier.includes("/") && !/\.[cm]?js$/.test(specifier)) {
        return nextResolve(`${specifier}.js`, context);
      }
      throw error;
    }
  },
});

import assert from "node:assert/strict";
import test, { after } from "node:test";

const fx = await import("./golden/fixtures.mjs");
const { createMemoryGuardStore, GUARD_COLLECTIONS } = await import("../../../../lib/guard/store.ts");
const { resetJupiterBudget } = await import("../../../../lib/solana/jupiter-budget.ts");
const { resetJupiterReferralCache } = await import("../../../../lib/solana/referral-account.server.ts");
const { resetRentParametersCache } = await import("../../../../lib/solana/rent.ts");
const { resetMsPerSlotCache } = await import("../../../../lib/solana/blockhash-life.ts");
const { getGuardRuntime } = await import("../../../../lib/guard/runtime.ts");

const ROUTES = {
  order: (await import("./order/route.ts")).POST,
  execute: (await import("./execute/route.ts")).POST,
  quote: (await import("./quote/route.ts")).POST,
  recover: (await import("./recover/route.ts")).POST,
  "cancel-review": (await import("./cancel-review/route.ts")).POST,
};

const SNAPSHOT_URL = new URL("./golden/transcripts.json", import.meta.url);
const UPDATE = process.env.GOLDEN_UPDATE === "1";
const recorded = existsSync(SNAPSHOT_URL) ? JSON.parse(readFileSync(SNAPSHOT_URL, "utf8")) : {};
const declared = [];
const written = {};

/* A rewrite keeps the declared order; a scenario filtered out of this run
   keeps its recorded transcript, and one no longer declared is dropped. */
after(() => {
  if (!UPDATE) return;
  const next = {};
  for (const name of declared) if (name in written || name in recorded) next[name] = written[name] ?? recorded[name];
  writeFileSync(SNAPSHOT_URL, `${JSON.stringify(next, null, 1)}\n`);
});

/* ── Recording store ────────────────────────────────────────────────────── */

/**
 * The memory store, declared multi-writer, remembering every key any write
 * touched so the whole state can be read back afterwards by key.
 */
function recordingStore({ durable = true } = {}) {
  const base = createMemoryGuardStore();
  const touched = new Map();
  const note = (name, key) => {
    if (!touched.has(name)) touched.set(name, new Set());
    touched.get(name).add(key);
  };
  const wrap = (name, collection) => ({
    ...collection,
    set: async (key, value) => {
      note(name, key);
      return collection.set(key, value);
    },
    insertIfAbsent: async (key, value) => {
      note(name, key);
      return collection.insertIfAbsent(key, value);
    },
    insertAllIfAbsent: async (entries) => {
      for (const entry of entries) note(name, entry.key);
      return collection.insertAllIfAbsent(entries);
    },
    delete: async (key) => {
      note(name, key);
      return collection.delete(key);
    },
  });
  const store = {
    ...base,
    durability: durable ? "DURABLE_MULTI_WRITER" : base.durability,
    collection: (name) => wrap(name, base.collection(name)),
    versioned: (name) => {
      const versioned = base.versioned(name);
      return {
        ...wrap(name, versioned),
        compareAndSet: async (key, expected, next) => {
          note(name, key);
          return versioned.compareAndSet(key, expected, next);
        },
      };
    },
    compareAndSetMany: async (writes) => {
      for (const write of writes) note(write.collection, write.key);
      return base.compareAndSetMany(writes);
    },
  };
  const dump = async () => {
    const state = {};
    for (const name of [...GUARD_COLLECTIONS].sort()) {
      const keys = [...(touched.get(name) ?? [])].sort();
      const rows = {};
      for (const key of keys) {
        const value = await base.collection(name).get(key);
        if (value !== undefined) rows[key] = plain(value);
      }
      if (Object.keys(rows).length > 0) state[name] = rows;
    }
    return state;
  };
  return { store, dump };
}

/** JSON with sorted keys: the digest of a value means what `deepStrictEqual` compares. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The owner lock carries the whole bundle, proof and Receipt. Outside the
 * scenarios that print them in full they are recorded by digest, which still
 * fails on any change and keeps the snapshot readable.
 */
function compactStore(state) {
  const locks = state.solanaSwapOwnerLocks;
  if (!locks) return state;
  const compacted = {};
  for (const [key, row] of Object.entries(locks)) {
    const next = { ...row };
    for (const field of ["bundle", "proof", "receipt"]) {
      if (next[field] && typeof next[field] === "object") next[field] = { sha256: sha256(canonical(next[field])) };
    }
    compacted[key] = next;
  }
  return { ...state, solanaSwapOwnerLocks: compacted };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? `${entry.toString()}n` : entry)));
}

/* ── The stubbed network ────────────────────────────────────────────────── */

function rpcReply(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const CONTEXT = { slot: 400_000_000, apiVersion: "2.2.0" };

/**
 * Default chain answers; a scenario overrides any of them through `world`.
 * Returning `{ http: n }` answers a non-2xx transport failure.
 */
function defaultRpc(world, method, params) {
  switch (method) {
    case "getAccountInfo":
      return { context: CONTEXT, value: fx.accountInfoValue(params[0]) };
    case "simulateTransaction":
      return {
        context: CONTEXT,
        value: fx.simulationValue(params[0], { addresses: params[1]?.accounts?.addresses ?? [], ...(world.simulation?.(params[0]) ?? {}) }),
      };
    case "isBlockhashValid":
      return { context: CONTEXT, value: world.blockhashValid ?? true };
    /* AG-1: how long the order's bytes may still be signed — the tip and the slot speed (`lib/solana/blockhash-life.ts`). */
    case "getEpochInfo":
      return world.epochInfo ?? { absoluteSlot: CONTEXT.slot, blockHeight: fx.LAST_VALID_BLOCK_HEIGHT - 120, epoch: 925, slotIndex: 0, slotsInEpoch: 432_000, transactionCount: null };
    case "getRecentPerformanceSamples":
      return [{ slot: CONTEXT.slot, numSlots: 300, numTransactions: 0, numNonVoteTransactions: 0, samplePeriodSecs: 60 }];
    case "getSignatureStatuses":
      return { context: CONTEXT, value: [world.signatureStatus?.() ?? null] };
    case "getTransaction":
      return world.transaction?.() ?? null;
    case "sendTransaction":
      return world.sendTransaction?.() ?? null;
    default:
      return undefined;
  }
}

function installNetwork(t, world, currentCalls) {
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const calls = currentCalls();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const rawBody = typeof init.body === "string" ? init.body : null;
    const host = url.host;

    if (host === fx.RPC_PRIMARY_HOST || host === fx.RPC_INDEPENDENT_HOST) {
      const payload = JSON.parse(rawBody);
      /* The JSON-RPC id is a process-wide counter in the client and says nothing
         about the route, so it is not recorded. */
      calls.push({ kind: "rpc", host, method: payload.method, params: payload.params });
      const override = world.rpc?.(host, payload.method, payload.params);
      const answer = override !== undefined ? override : defaultRpc(world, payload.method, payload.params);
      if (answer === undefined) {
        calls[calls.length - 1] = { ...calls[calls.length - 1], kind: "unexpected-rpc" };
        return new Response("golden: unanswered RPC method", { status: 599 });
      }
      if (answer && typeof answer === "object" && "http" in answer) return new Response("golden: refused", { status: answer.http });
      if (answer && typeof answer === "object" && "rpcError" in answer) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: answer.rpcError }), { headers: { "content-type": "application/json" } });
      }
      return rpcReply(payload.id, answer);
    }

    const query = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const record = {
      kind: "http",
      method,
      host,
      path: url.pathname,
      query,
      providerKey: headers.has("x-api-key") ? "SENT" : "ABSENT",
      body: rawBody === null ? null : JSON.parse(rawBody),
    };
    calls.push(record);
    if (host === "api.jup.ag" && url.pathname === "/swap/v2/order" && method === "GET") {
      const answer = world.jupiterOrder ? world.jupiterOrder(url) : jsonResponse(fx.jupiterOrderBody());
      if (answer instanceof Error) throw answer;
      return answer;
    }
    if (host === "api.jup.ag" && url.pathname === "/swap/v2/execute" && method === "POST") {
      const answer = world.jupiterExecute ? world.jupiterExecute(JSON.parse(rawBody)) : undefined;
      if (answer instanceof Error) throw answer;
      if (answer) return answer;
    }
    calls[calls.length - 1] = { ...record, kind: "unexpected-http" };
    return new Response("golden: unanswered request", { status: 599 });
  });
}

/* ── Scenario harness ───────────────────────────────────────────────────── */

let forwardedFor = 0;

function setEnvironment(overrides) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("RYNTRA_")) delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...fx.ENV_BASE, ...overrides })) {
    if (value === null || value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function sortedHeaders(headers) {
  return Object.fromEntries(
    [...headers.entries()]
      .map(([key, value]) => [key, key === "server-timing" ? value.replace(/;dur=[0-9.]+/g, "") : value])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** Random referral codes become stable placeholders, numbered by first appearance. */
function stableReferralCodes(transcript) {
  let text = JSON.stringify(transcript);
  const codes = [];
  for (const account of Object.values(transcript.store.rewardAccounts ?? {})) {
    if (typeof account.code === "string" && !codes.includes(account.code)) codes.push(account.code);
  }
  codes.forEach((code, index) => {
    text = text.split(code).join(`<referral-code-${index + 1}>`);
  });
  return JSON.parse(text);
}

function scenario(name, script, options = {}) {
  declared.push(name);
  test(name, async (t) => {
    const savedEnv = { ...process.env };
    t.after(() => {
      for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
      Object.assign(process.env, savedEnv);
    });
    setEnvironment({});
    t.mock.timers.enable({ apis: ["Date"], now: fx.T0 });
    resetJupiterBudget();
    resetJupiterReferralCache();
    resetRentParametersCache();
    resetMsPerSlotCache();

    const { store, dump } = recordingStore({ durable: options.durable ?? true });
    /* The routes read the process runtime's store; each scenario gets a fresh one. */
    const runtime = getGuardRuntime();
    const previousStore = runtime.store;
    runtime.store = store;
    t.after(() => {
      runtime.store = previousStore;
    });

    const world = {};
    let calls = [];
    let waits = [];
    /* Each step gets its own list; the stub always writes to the current one. */
    installNetwork(t, world, () => calls);
    const realSetTimeout = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (callback, ms, ...rest) => {
      if (ms === 1_500 || ms === 500) {
        waits.push(ms);
        t.mock.timers.tick(ms);
        return realSetTimeout(callback, 0, ...rest);
      }
      return realSetTimeout(callback, ms, ...rest);
    });

    const steps = [];
    const ctx = {
      world,
      tick: (ms) => t.mock.timers.tick(ms),
      /**
       * One request to one route. `summary` replaces the body in the record
       * when the body is a previous answer handed back (an execute bundle).
       */
      async post(route, body, { headers = {}, env = {}, summary, setup = false } = {}) {
        setEnvironment(env);
        calls = [];
        waits = [];
        forwardedFor += 1;
        const request = new Request(`http://localhost/api/solana/swap/${route}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-forwarded-for": `198.51.100.${forwardedFor}`,
            ...headers,
          },
          body: typeof body === "string" ? body : JSON.stringify(body),
        });
        const response = await ROUTES[route](request);
        const text = await response.text();
        const parsed = JSON.parse(text);
        const step = {
          route,
          request: {
            headers: Object.fromEntries(Object.entries(headers).filter(([key]) => key !== "x-forwarded-for")),
            env: Object.keys(env).length > 0 ? env : undefined,
            body: summary ?? body,
          },
          status: response.status,
          headers: sortedHeaders(response.headers),
          body: parsed,
          /* The exact bytes, so a reordered key fails here even where the parsed comparison would pass. */
          bodyBytesSha256: sha256(text),
          calls,
          ...(waits.length > 0 ? { virtualWaitsMs: waits } : {}),
        };
        /* A step that only prepares the scenario (the order before an execute)
           is recorded by digest; its full record is the order scenario's own. */
        steps.push(setup ? { route, setup: true, status: response.status, sha256: sha256(canonical(plain(step))) } : step);
        setEnvironment({});
        return parsed;
      },
    };

    await script(ctx);
    const state = await dump();
    const transcript = stableReferralCodes(plain({ steps, store: options.fullStore ? state : compactStore(state) }));
    if (UPDATE) {
      written[name] = transcript;
      return;
    }
    assert.ok(name in recorded, `no recorded transcript for "${name}"; run with GOLDEN_UPDATE=1 on the reference code`);
    assert.deepStrictEqual(transcript, recorded[name]);
  });
}

/* ── Shared steps ───────────────────────────────────────────────────────── */

const ORDER_INPUT = { input: { inputMint: fx.WSOL, outputMint: fx.USDT, amountRaw: fx.IN_LAMPORTS.toString(), taker: fx.TAKER } };

function executeBody(order, { wire, reviewed } = {}) {
  const signed = wire ?? fx.signWire(order.order.transactionBase64).wire;
  return {
    bundle: order.bundle,
    proof: order.proof,
    signedTransactionBase64: signed,
    ...(reviewed ? { reviewedTransactionBase64: reviewed } : {}),
  };
}


function landedStatus(confirmationStatus = "confirmed", err = null) {
  return { slot: 400_000_123, confirmations: confirmationStatus === "finalized" ? null : 1, err, confirmationStatus, status: err ? { Err: err } : { Ok: null } };
}

function successReport(signature) {
  return jsonResponse({
    status: "Success",
    code: 0,
    signature,
    totalInputAmount: fx.IN_LAMPORTS.toString(),
    totalOutputAmount: fx.OUT_RAW.toString(),
    inputAmountResult: fx.IN_LAMPORTS.toString(),
    outputAmountResult: fx.OUT_RAW.toString(),
  });
}

/** The order route's happy path, then the chain and venue set for the exact execute lane. */
async function orderAndLand(ctx, { finality = "confirmed" } = {}) {
  const order = await ctx.post("order", ORDER_INPUT, { setup: true });
  const { wire, signature } = fx.signWire(order.order.transactionBase64);
  ctx.world.jupiterExecute = () => successReport(signature);
  ctx.world.signatureStatus = () => landedStatus(finality);
  ctx.world.transaction = () => fx.transactionValue(wire, signature);
  return { order, wire, signature };
}

/* ── order ──────────────────────────────────────────────────────────────── */

scenario("order: SOL to USDT with the verified referral fee is a signable Review", async (ctx) => {
  await ctx.post("order", ORDER_INPUT);
}, { fullStore: true });

scenario("order: no referral account configured quotes no service fee", async (ctx) => {
  ctx.world.jupiterOrder = () => jsonResponse(fx.jupiterOrderBody({ referral: false }));
  await ctx.post("order", ORDER_INPUT, { env: { RYNTRA_JUPITER_REFERRAL_ACCOUNT: null } });
});

scenario("order: Spot origin is carried into the signed bundle", async (ctx) => {
  await ctx.post("order", { ...ORDER_INPUT, origin: { surface: "SPOT", side: "SELL" } });
});

scenario("order refused: the swap lane is paused", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { env: { RYNTRA_SOLANA_SWAP_STATE: "PAUSED" } });
});

scenario("order refused: a foreign origin", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { headers: { origin: "https://elsewhere.example" } });
});

scenario("order refused: a body that is not JSON", async (ctx) => {
  await ctx.post("order", "not json", { headers: { "content-type": "text/plain" } });
});

scenario("order refused: schema invalid amount", async (ctx) => {
  await ctx.post("order", { input: { ...ORDER_INPUT.input, amountRaw: "0" } });
});

scenario("order refused: the same mint on both sides", async (ctx) => {
  await ctx.post("order", { input: { ...ORDER_INPUT.input, outputMint: fx.WSOL } });
});

scenario("order refused: a retired mint", async (ctx) => {
  await ctx.post("order", { input: { ...ORDER_INPUT.input, outputMint: fx.RETIRED_MINT } });
});

scenario("order refused: the store is not durable", async (ctx) => {
  await ctx.post("order", ORDER_INPUT);
}, { durable: false });

scenario("order refused: the provider key is missing", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { env: { RYNTRA_JUPITER_API_KEY: null } });
});

scenario("order refused: the issuer key is missing", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { env: { RYNTRA_AGENT_ISSUER_PRIVATE_KEY: null } });
});

/* SOL-S1 (line B's request 60): an unsigned Review no longer holds the wallet — the next order replaces it at once. */
scenario("order: a new order replaces the owner's unsigned Review at once", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { setup: true });
  ctx.world.jupiterOrder = () => jsonResponse(fx.jupiterOrderBody({ overrides: { requestId: "req-replacing-review" } }));
  await ctx.post("order", ORDER_INPUT);
});

scenario("order: an unsigned Review past its window is replaced without asking the chain", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { setup: true });
  ctx.tick(46_000);
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: the owner holds a signature the server claimed", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  ctx.world.jupiterExecute = () => new Error("socket reset");
  ctx.world.signatureStatus = () => null;
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes", setup: true });
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: Jupiter rate-limits both asks", async (ctx) => {
  ctx.world.jupiterOrder = () =>
    jsonResponse({ error: "Too many requests" }, 429, { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000)) });
  await ctx.post("order", ORDER_INPUT);
});

scenario("order: Jupiter rate-limits the first ask and answers the second", async (ctx) => {
  let asks = 0;
  ctx.world.jupiterOrder = () => {
    asks += 1;
    return asks === 1
      ? jsonResponse({ error: "Too many requests" }, 429, { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000)) })
      : jsonResponse(fx.jupiterOrderBody());
  };
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: Jupiter finds no route", async (ctx) => {
  ctx.world.jupiterOrder = () => jsonResponse({ error: "No routes found", errorCode: "COULD_NOT_FIND_ANY_ROUTE" }, 400);
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: Jupiter refuses the referral fee and the order is asked again without it", async (ctx) => {
  let asks = 0;
  ctx.world.jupiterOrder = () => {
    asks += 1;
    return asks === 1
      ? jsonResponse({ error: "Please check that referralAccount is initialized under REFER4Zgm" }, 400)
      : jsonResponse(fx.jupiterOrderBody({ referral: false }));
  };
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: the provider transaction fails inspection", async (ctx) => {
  ctx.world.jupiterOrder = () => jsonResponse(fx.jupiterOrderBody({ transaction: fx.buildSwapWire({ feePayer: fx.labelAddress("someone-else") }) }));
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: the simulation fails", async (ctx) => {
  ctx.world.simulation = () => ({ err: { InstructionError: [2, { Custom: 6001 }] } });
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: the simulation's effects fall below the reviewed minimum", async (ctx) => {
  ctx.world.simulation = () => ({ outRaw: fx.MIN_OUT_RAW - 1n });
  await ctx.post("order", ORDER_INPUT);
});

scenario("order refused: the simulation cannot be reached", async (ctx) => {
  ctx.world.rpc = (_host, method) => (method === "simulateTransaction" ? { http: 503 } : undefined);
  await ctx.post("order", ORDER_INPUT);
});

/* ── execute ────────────────────────────────────────────────────────────── */

scenario("execute: exact bytes through Jupiter settle MATCHED with a Receipt", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  await ctx.post("execute", executeBody(order), { summary: "order bundle and proof unchanged; the order's exact bytes signed by the taker" });
}, { fullStore: true });

scenario("execute: a finalized landing settles MATCHED at finalized", async (ctx) => {
  const { order } = await orderAndLand(ctx, { finality: "finalized" });
  await ctx.post("execute", executeBody(order), { summary: "order bundle and proof unchanged; the order's exact bytes signed by the taker" });
});

scenario("execute refused before submit: the swap lane is paused", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  await ctx.post("execute", executeBody(order), { env: { RYNTRA_SOLANA_SWAP_STATE: "PAUSED" }, summary: "exact signed bytes" });
});

scenario("execute refused before submit: a foreign origin", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  await ctx.post("execute", executeBody(order), { headers: { origin: "https://elsewhere.example" }, summary: "exact signed bytes" });
});

scenario("execute refused before submit: a body outside the schema", async (ctx) => {
  await ctx.post("execute", { bundle: {}, proof: {}, signedTransactionBase64: "AQID" });
});

scenario("execute refused before submit: a tampered bundle", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  const body = executeBody(order);
  body.bundle = { ...body.bundle, lastValidBlockHeight: "300000001" };
  await ctx.post("execute", body, { summary: "bundle.lastValidBlockHeight changed after the proof was issued" });
});

scenario("execute refused before submit: the Review window has closed", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  ctx.tick(46_000);
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes, presented 46 s after the order" });
});

scenario("execute refused before submit: a newer order replaced the Review", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  ctx.world.jupiterOrder = () => jsonResponse(fx.jupiterOrderBody({ overrides: { requestId: "req-replacing-review" } }));
  await ctx.post("order", ORDER_INPUT, { setup: true });
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes of the replaced Review" });
});

scenario("execute refused before submit: modified bytes without the reviewed bytes", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  const modified = fx.signWire(fx.buildSwapWire({ microLamports: 10_000 })).wire;
  await ctx.post("execute", executeBody(order, { wire: modified }), { summary: "wallet re-priced the compute budget; reviewedTransactionBase64 absent" });
});

scenario("execute refused before submit: reviewed bytes that are not the Review's", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  const modified = fx.signWire(fx.buildSwapWire({ microLamports: 10_000 })).wire;
  await ctx.post("execute", executeBody(order, { wire: modified, reviewed: fx.buildSwapWire({ microLamports: 7_000 }) }), {
    summary: "wallet re-priced the compute budget; reviewedTransactionBase64 is a third transaction",
  });
});

scenario("execute refused before submit: a signature that does not verify", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  const forged = fx.signWire(order.order.transactionBase64, fx.STRANGER_PRIVATE_KEY_PKCS8).wire;
  await ctx.post("execute", executeBody(order, { wire: forged }), { summary: "exact bytes signed by a key that is not the taker's" });
});

scenario("execute refused before submit: no independent RPC operator", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  await ctx.post("execute", executeBody(order), { env: { RYNTRA_SOLANA_RPC_MAINNET_FALLBACK: fx.RPC_PRIMARY }, summary: "exact signed bytes" });
});

scenario("execute refused before submit: the issuer key is missing", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  await ctx.post("execute", executeBody(order), { env: { RYNTRA_AGENT_ISSUER_PRIVATE_KEY: null }, summary: "exact signed bytes" });
});

scenario("execute refused: the same signed bytes a second time", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes" });
  await ctx.post("execute", executeBody(order), { summary: "the same exact signed bytes again" });
});

scenario("execute: Jupiter does not answer and the chain has not seen it", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  ctx.world.jupiterExecute = () => new Error("socket reset");
  ctx.world.signatureStatus = () => null;
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes" });
});

scenario("execute: Jupiter reports Failed and the chain never shows it", async (ctx) => {
  const { order } = await orderAndLand(ctx);
  ctx.world.jupiterExecute = () => jsonResponse({ status: "Failed", code: -1000, error: "failed to land" });
  ctx.world.signatureStatus = () => null;
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes" });
});

scenario("execute: the transaction landed and failed on chain", async (ctx) => {
  const { order, wire, signature } = await orderAndLand(ctx);
  const chainError = { InstructionError: [2, { Custom: 6001 }] };
  ctx.world.jupiterExecute = () => jsonResponse({ status: "Failed", code: -1, error: "custom program error", signature });
  ctx.world.signatureStatus = () => landedStatus("confirmed", chainError);
  ctx.world.transaction = () => fx.transactionValue(wire, signature, { err: chainError });
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes" });
});

scenario("execute: the wallet re-priced the compute budget and the adopted bytes settle through the own RPC", async (ctx) => {
  const order = await ctx.post("order", ORDER_INPUT, { setup: true });
  const adopted = fx.signWire(fx.buildSwapWire({ microLamports: 10_000 }));
  const adoptedFee = fx.SIGNATURE_FEE + fx.ADOPTED_PRIORITY_FEE;
  ctx.world.simulation = () => ({ fee: adoptedFee });
  ctx.world.sendTransaction = () => adopted.signature;
  let reads = 0;
  /* Unseen on the first read, so the route's own confirmation poll runs once. */
  ctx.world.signatureStatus = () => (++reads === 1 ? null : landedStatus("confirmed"));
  ctx.world.transaction = () => fx.transactionValue(adopted.wire, adopted.signature, { fee: adoptedFee });
  await ctx.post("execute", executeBody(order, { wire: adopted.wire, reviewed: order.order.transactionBase64 }), {
    summary: "wallet re-priced the compute budget to 10 000 micro-lamports; reviewedTransactionBase64 is the order's bytes",
  });
}, { fullStore: true });

/* SOL-S1: our own broadcast is sent again — the same bytes, the same signature — every 2 s until an operator sees it. */
scenario("execute: the adopted bytes are sent again until the chain shows them", async (ctx) => {
  const order = await ctx.post("order", ORDER_INPUT, { setup: true });
  const adopted = fx.signWire(fx.buildSwapWire({ microLamports: 10_000 }));
  const adoptedFee = fx.SIGNATURE_FEE + fx.ADOPTED_PRIORITY_FEE;
  ctx.world.simulation = () => ({ fee: adoptedFee });
  ctx.world.sendTransaction = () => adopted.signature;
  let reads = 0;
  /* Unseen for the first 4.5 s of reads: two re-sends go out, then it lands. */
  ctx.world.signatureStatus = () => (++reads <= 10 ? null : landedStatus("confirmed"));
  ctx.world.transaction = () => fx.transactionValue(adopted.wire, adopted.signature, { fee: adoptedFee });
  await ctx.post("execute", executeBody(order, { wire: adopted.wire, reviewed: order.order.transactionBase64 }), {
    summary: "adopted bytes; the chain shows them only after two re-sends",
  });
});

scenario("execute: the first send of the adopted bytes does not answer and a re-send lands them", async (ctx) => {
  const order = await ctx.post("order", ORDER_INPUT, { setup: true });
  const adopted = fx.signWire(fx.buildSwapWire({ microLamports: 10_000 }));
  const adoptedFee = fx.SIGNATURE_FEE + fx.ADOPTED_PRIORITY_FEE;
  ctx.world.simulation = () => ({ fee: adoptedFee });
  let sends = 0;
  ctx.world.sendTransaction = () => (++sends === 1 ? { http: 502 } : adopted.signature);
  ctx.world.signatureStatus = () => (sends < 2 ? null : landedStatus("confirmed"));
  ctx.world.transaction = () => fx.transactionValue(adopted.wire, adopted.signature, { fee: adoptedFee });
  await ctx.post("execute", executeBody(order, { wire: adopted.wire, reviewed: order.order.transactionBase64 }), {
    summary: "adopted bytes; the first send answers HTTP 502, the re-send lands",
  });
});

scenario("execute refused before submit: the adopted bytes fail their own simulation", async (ctx) => {
  const order = await ctx.post("order", ORDER_INPUT, { setup: true });
  const adopted = fx.signWire(fx.buildSwapWire({ microLamports: 10_000 }));
  ctx.world.simulation = () => ({ err: { InstructionError: [2, { Custom: 1 }] } });
  await ctx.post("execute", executeBody(order, { wire: adopted.wire, reviewed: order.order.transactionBase64 }), {
    summary: "wallet re-priced the compute budget; the re-simulation fails",
  });
});

/* ── recover and cancel-review ──────────────────────────────────────────── */

scenario("recover: an unanswered execute is recovered by signature once the chain shows it", async (ctx) => {
  const { order, wire, signature } = await orderAndLand(ctx);
  ctx.world.jupiterExecute = () => new Error("socket reset");
  ctx.world.signatureStatus = () => null;
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes" });
  ctx.world.signatureStatus = () => landedStatus("confirmed");
  ctx.world.transaction = () => fx.transactionValue(wire, signature);
  await ctx.post("recover", { owner: fx.TAKER, signature, requestId: fx.REQUEST_ID });
}, { fullStore: true });

scenario("recover: a receipted swap answers from the stored Receipt", async (ctx) => {
  const { order, signature } = await orderAndLand(ctx);
  await ctx.post("execute", executeBody(order), { summary: "exact signed bytes" });
  await ctx.post("recover", { owner: fx.TAKER, signature, requestId: fx.REQUEST_ID });
});

scenario("recover refused: a body outside the schema", async (ctx) => {
  await ctx.post("recover", { owner: fx.TAKER, signature: "short" });
});

scenario("cancel-review: an unclaimed Review whose blockhash is dead is cancelled", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { setup: true });
  ctx.world.blockhashValid = false;
  await ctx.post("cancel-review", { owner: fx.TAKER, requestId: fx.REQUEST_ID });
});

scenario("cancel-review refused: the blockhash is still valid", async (ctx) => {
  await ctx.post("order", ORDER_INPUT, { setup: true });
  ctx.world.blockhashValid = true;
  await ctx.post("cancel-review", { owner: fx.TAKER, requestId: fx.REQUEST_ID });
});

/* ── quote ──────────────────────────────────────────────────────────────── */

const QUOTE_INPUT = { inputMint: fx.WSOL, outputMint: fx.USDT, amountRaw: fx.IN_LAMPORTS.toString() };

scenario("quote: SOL to USDT with the referral fee", async (ctx) => {
  ctx.world.jupiterOrder = () => jsonResponse(fx.jupiterQuoteBody());
  await ctx.post("quote", QUOTE_INPUT);
});

scenario("quote refused: Jupiter finds no route", async (ctx) => {
  ctx.world.jupiterOrder = () => jsonResponse({ error: "No routes found", errorCode: "COULD_NOT_FIND_ANY_ROUTE" }, 400);
  await ctx.post("quote", QUOTE_INPUT);
});

scenario("quote refused: a retired mint", async (ctx) => {
  await ctx.post("quote", { ...QUOTE_INPUT, outputMint: fx.RETIRED_MINT });
});
