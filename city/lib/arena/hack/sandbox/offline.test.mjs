// Run from repo root: node --test city/lib/arena/hack/sandbox/offline.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import dns from "node:dns";
import http from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { sb, toy, attempt, makeSandbox, makeSnapshot, pinFor, proveContext, recorded, CHECK, PROGRAM, TARGET } from "./fixtures.mjs";

const { offline, NetworkRefused, isOffline } = sb;

test("inside a run every way out throws NetworkRefused — globals, builtins and ESM named imports alike", () => {
  const ways = {
    fetch: () => fetch("https://example.com"),
    "net.connect": () => connect(443, "example.com"),
    "http.request": () => http.request("http://example.com"),
    "dns.lookup": () => dns.lookup("example.com", () => {}),
    "child_process.spawnSync": () => spawnSync("curl", ["https://example.com"]),
    "worker_threads.Worker": () => new Worker("process.exit(0)", { eval: true }),
  };
  for (const [via, reach] of Object.entries(ways)) {
    assert.throws(
      () => offline(reach),
      (error) => error instanceof NetworkRefused && error.via === via,
      via,
    );
  }
});

test("the wall comes down after the run: the process has its network back", () => {
  const original = globalThis.fetch;
  offline(() => 1);
  assert.equal(globalThis.fetch, original);
  assert.equal(isOffline(), false);
  assert.equal(typeof http.request, "function");
  assert.doesNotThrow(() => http.request("http://127.0.0.1:9").on("error", () => {}).destroy());
});

test("an attempt is remembered even when the code that made it swallows the error", () => {
  assert.throws(
    () =>
      offline(() => {
        try {
          fetch("https://example.com");
        } catch {
          /* hidden */
        }
        return "clean";
      }),
    NetworkRefused,
  );
});

test("a run is synchronous: a function that hands back a promise is refused", () => {
  assert.throws(() => offline(() => Promise.resolve(1)), /synchronous/);
});

/** The toy engine with one call that tries to reach out. */
function reaching(where, { swallow = false } = {}) {
  return () => {
    const engine = toy.createToyEngine();
    const reach = () => {
      if (!swallow) return fetch("https://rpc.example.com");
      try {
        connect(8899, "127.0.0.1");
      } catch {
        /* the engine hides it */
      }
    };
    return {
      ...engine,
      load: (snapshot) => (where === "load" && reach(), engine.load(snapshot)),
      execute: (bytes, cu) => (where === "execute" && reach(), engine.execute(bytes, cu)),
    };
  };
}

test("an engine that reaches out while executing: the whole run is refused, no log is handed back", () => {
  const run = makeSandbox({ engine: reaching("execute") }).run(attempt());
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "NETWORK");
  assert.equal(run.log, undefined);
});

test("an engine that reaches out while loading the copy, and hides it, is refused all the same", () => {
  const run = makeSandbox({ engine: reaching("load", { swallow: true }) }).run(attempt());
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "NETWORK");
  assert.match(run.detail, /net\.connect/);
});

test("a store of recorded states that fetches instead of looking up is refused", () => {
  const sandbox = sb.createHackSandbox({
    engine: toy.createToyEngine,
    snapshot: (pin) => (fetch(`https://rpc.example.com/${pin.stateHash}`), makeSnapshot()),
    invariants: [CHECK],
    now: () => 0,
  });
  const run = sandbox.run(attempt());
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "NETWORK");
});

test("a protocol check that reaches out is refused", () => {
  const leaky = { ...CHECK, holds: (read) => (fetch("https://example.com"), CHECK.holds(read)) };
  const run = makeSandbox({ invariants: [leaky] }).run(attempt());
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "NETWORK");
});

test("a replay that reaches out never becomes a proof", () => {
  let built = 0;
  const later = () => {
    built += 1;
    return built === 1 ? toy.createToyEngine() : reaching("load")();
  };
  const sandbox = makeSandbox({ engine: later });
  const run = sandbox.run(attempt());
  assert.equal(run.ok, true);
  assert.equal(sandbox.prove(run, proveContext()), null);
});

test("a devnet target is a live network: the sandbox does not run it", () => {
  const pin = { ...pinFor(), target: { kind: "devnet", program: PROGRAM } };
  const run = makeSandbox().run(attempt({ pin }));
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "NOT_A_FORK");
  const order = makeSandbox().run(attempt({ target: { kind: "devnet", program: PROGRAM } }));
  assert.equal(order.refusal, "NOT_A_FORK");
  assert.equal(makeSandbox().run(attempt({ target: { ...TARGET, slot: 1 } })).refusal, "PIN_MISMATCH");
  assert.equal(typeof recorded, "function");
});
