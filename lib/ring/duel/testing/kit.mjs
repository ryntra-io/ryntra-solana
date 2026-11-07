/*
 * Shared pieces of the duels' tests (CITY-51): a manual clock, a harness stamp key made fresh each run, configs of both
 * formats and scripted agents. The bars here are constructed shapes for the engine's arithmetic — not market data.
 */
import { generateKeyPairSync } from "node:crypto";

const d = await import("../index.ts");
const j = await import("../../judge/index.ts");

export const T0 = Date.parse("2026-11-06T12:00:00Z");

export function clock(step = 1_000) {
  let t = T0;
  return () => (t += step);
}

export function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { stamp: j.createStamper(privateKey), verifyStamp: j.stampVerifier([j.signerOf(publicKey)]) };
}

export const PHRASES = ["amber falcon river", "violet socket tiger"];

export function crackConfig(matchId, extra = {}) {
  return { harness: d.HARNESS_ID, ...d.CRACK_DEFAULTS, commits: [d.phraseCommit(matchId, 0, PHRASES[0]), d.phraseCommit(matchId, 1, PHRASES[1])], ...extra };
}

/** A wave with a drift: bars whose open is the last close, wicks half a point out. */
export function bars(n = 32, drift = 0.3) {
  const close = (i) => 100 + 5 * Math.sin(i / 3) + i * drift;
  return Array.from({ length: n }, (_, i) => {
    const o = i === 0 ? 100 : close(i - 1);
    const c = close(i);
    return [o, Math.max(o, c) + 0.5, Math.min(o, c) - 0.5, c].map((v) => Math.round(v * 1e4) / 1e4);
  });
}

export function marketConfig(extra = {}) {
  const { steps = d.MARKET_DEFAULTS.steps, lookback = d.MARKET_DEFAULTS.lookback } = extra;
  return { harness: d.HARNESS_ID, ...d.MARKET_DEFAULTS, bars: bars(steps + lookback), ...extra };
}

/** An agent that answers each view with `reply(view)` — a move object, or a whole reply when it has `kind`. */
export function scripted(reply) {
  return {
    async act(view, signal) {
      const out = await reply(view, signal);
      return out && typeof out === "object" && "kind" in out ? out : { kind: "move", move: out, thought: "", costMicroUsd: 0 };
    },
  };
}

export const say = (line, guess = null) => scripted(() => ({ say: line, guess }));
export const never = { act: () => new Promise(() => {}) };
