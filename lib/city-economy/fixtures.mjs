/*
 * Facts for the points tests (`points.test.mjs`, `never.test.mjs`): wallets, transactions and trades judged by the
 * real honest count (`honest-count.ts`), so a rule is tested on the same judgements the server would hand it.
 */
import { judgeTrade } from "./honest-count.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const code = (n, width) => Array.from({ length: width }, (_, i) => B58[Math.floor(n / 58 ** i) % 58]).join("");

/** A distinct Solana address for every n. */
export const addr = (n) => `W${code(n, 3)}`.padEnd(44, "z");
/** A distinct transaction signature for every n. */
export const sig = (n) => `S${code(n, 4)}`.padEnd(88, "5");

export const CREATOR = addr(1);
export const OWNER = addr(2);
export const MINT = addr(3);
export const POSITION = addr(4);

export const DAY_MS = 86_400_000;
export const LAUNCH = "2026-10-05T09:00:00.000Z";
export const at = (base, days) => new Date(Date.parse(base) + days * DAY_MS).toISOString();
export const usd = (dollars) => BigInt(Math.round(dollars * 1_000_000));

let txCounter = 1_000;

/**
 * A buy of `mint` by `buyer`, judged by the honest count. `cluster` is what the Growth line answers about the buyer and
 * the party: "separate", "same" or "unknown". `party` names whom the trade credits (the creator by default).
 */
export function judged({ buyer, when, dollars = 25, cluster = "separate", party = CREATOR, slot = "creator", mint = MINT, signers = null }) {
  const trade = {
    tx: sig(txCounter++),
    at: when,
    mint,
    buyer,
    signers: signers ?? [buyer],
    creator: slot === "creator" ? party : null,
    host: slot === "host" ? party : null,
    friend: slot === "friend" ? party : null,
    usdMicros: dollars === null ? null : usd(dollars),
  };
  const judgement = judgeTrade(trade, () =>
    cluster === "same" ? { verdict: "same", reason: "shared_funder", rules: "test" } : cluster === "separate" ? { verdict: "separate", rules: "test" } : { verdict: "unknown", why: "test" },
  );
  return { trade, judgement };
}

/** The facts of a coin's day: alive, launched first in its month, bought by `buyers` in the week before the day. */
export function survivalFacts({ day = 7, buyers = 3, cluster = "separate", dollars = 25, alive = true, launchedAt = LAUNCH, monthLaunches = null, mint = MINT } = {}) {
  const when = at(launchedAt, day - 1);
  return {
    mint,
    creator: CREATOR,
    launchedAt,
    day,
    alive,
    monthLaunches: monthLaunches ?? [{ mint, launchedAt }],
    buys: Array.from({ length: buyers }, (_, i) => judged({ buyer: addr(100 + i), when, dollars, cluster, mint })),
  };
}

export const MONDAY = "2026-10-19T00:00:00.000Z";

/** A week of a position in range, every day earning fees from one trade outside the owner's cluster. */
export function poolWeek({ week = MONDAY, openedAt = "2026-10-01T00:00:00.000Z", position = POSITION, ownerPositions = null, cluster = "separate", value = 50, pool = 50_000, fees = 0.4, inRange = true, dollars = 25 } = {}) {
  return {
    position,
    owner: OWNER,
    openedAt,
    ownerPositions: ownerPositions ?? [{ position, openedAt }],
    week,
    days: Array.from({ length: 7 }, (_, i) => {
      const day = at(week, i).slice(0, 10);
      return {
        day,
        inRange,
        valueUsdMicros: value === null ? null : usd(value),
        poolUsdMicros: pool === null ? null : usd(pool),
        feesUsdMicros: fees === null ? null : usd(fees),
        trades: [judged({ buyer: addr(500 + i), when: `${day}T12:00:00.000Z`, dollars, cluster, party: OWNER, mint: addr(7) })],
      };
    }),
  };
}

/** A visit to the host's quarter. */
export const visit = (visitorId, when, cluster = "separate", verifiedHuman = true) => ({
  visitorId,
  day: when.slice(0, 10),
  at: when,
  verifiedHuman,
  cluster: cluster === "same" ? { verdict: "same", reason: "shared_device", rules: "test" } : cluster === "separate" ? { verdict: "separate", rules: "test" } : { verdict: "unknown", why: "test" },
});

/** A small seeded random source, so a failing case can be run again. */
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
