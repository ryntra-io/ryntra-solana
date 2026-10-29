// Test helpers for the trade card: the engine's own recorded answers (the swap routes' golden transcripts), an engine
// that answers from a script, a wallet stub that signs with the test-only key those transcripts use, and a clock.
import { readFileSync } from "node:fs";

import { createEngine } from "./engine.ts";

export { signWire, TAKER, T0, WSOL, USDT, STRANGER_PRIVATE_KEY_PKCS8 } from "../../../app/api/solana/swap/golden/fixtures.mjs";

const golden = JSON.parse(readFileSync(new URL("../../../app/api/solana/swap/golden/transcripts.json", import.meta.url), "utf8"));

/** The body (and status) of one recorded step: `step` counts from the end when negative. */
export function recorded(name, step = -1) {
  const steps = golden[name]?.steps;
  if (!steps) throw new Error(`No golden transcript named "${name}".`);
  const found = steps.at(step);
  return { status: found.status, body: structuredClone(found.body) };
}

export const QUOTE = recorded("quote: SOL to USDT with the referral fee").body;
export const ORDER = recorded("order: SOL to USDT with the verified referral fee is a signable Review").body;
export const ORDER_NO_FEE = recorded("order: no referral account configured quotes no service fee").body;
export const EXECUTED = recorded("execute: exact bytes through Jupiter settle MATCHED with a Receipt").body;
export const RECOVERED = recorded("recover: an unanswered execute is recovered by signature once the chain shows it").body;
export const RECEIPTED = recorded("recover: a receipted swap answers from the stored Receipt").body;

/** A copy of the recorded order with some of its figures changed. */
export function orderWith(changes = {}, base = ORDER) {
  const copy = structuredClone(base);
  Object.assign(copy.order, changes);
  return copy;
}

/**
 * An engine whose routes answer from a script: `{ quote: [answer…], order: […], execute: […], recover: […] }`, each
 * answer `{ status, body }` or `"network"` for a request that never arrived. Every request is recorded.
 */
export function scriptedEngine(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([route, answers]) => [route, [...answers]]));
  const fetchStub = async (url, init) => {
    const route = url.split("/").at(-1);
    calls.push({ route, body: JSON.parse(init.body) });
    const queue = queues[route] ?? [];
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (!answer) throw new Error(`Nothing scripted for ${route}.`);
    if (answer === "network") throw new TypeError("fetch failed");
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => structuredClone(answer.body) };
  };
  const engine = createEngine(fetchStub, { wait: async () => {}, timers: { set: () => 0, clear: () => {} } });
  return { engine, calls, routes: (route) => calls.filter((call) => call.route === route) };
}

/** Where the open signature is kept, in memory. */
export function memoryAttempts() {
  const log = [];
  let current = null;
  return {
    log,
    store: {
      read: () => current,
      write: (attempt) => {
        current = attempt;
        log.push(attempt.state);
      },
      clear: () => {
        current = null;
        log.push("CLEARED");
      },
    },
    get current() {
      return current;
    },
  };
}

/** A clock the test moves: waiting moves it, nothing waits for real. */
export function testClock(start) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    sleep: async (ms) => {
      now += ms;
    },
  };
}

/** A wallet that signs whatever it is shown with the transcripts' taker key, and remembers what it was shown. */
export function signingWallet(signWire) {
  const shown = [];
  return {
    shown,
    sign: async (wire) => {
      shown.push(wire);
      return { ok: true, signedWireBase64: signWire(wire).wire };
    },
  };
}
