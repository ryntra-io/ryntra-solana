/**
 * «In — out» on Ryntra's side: how much went into the ring through Ryntra's screens and how much came out, as totals
 * per day. What is kept, and nothing more:
 *
 *   { day: "2026-11-19", in: { count, lamports }, out: { count, lamports } }
 *
 * — the UTC day, the number of landed steps each way and their sum in lamports. No address, no signature, no amount
 * of any one person, no time of day: each landed step only adds one to a count and its amount to a sum. «In» is a
 * landed «Hide»; «out» is a landed «Return» and a link taken to a wallet. A private send stays inside the ring and is
 * not counted.
 *
 * It is a watch, not a proof: the steps are reported by Ryntra's own screens after they landed, and the chain stays
 * the record. More out than in through Ryntra alone is possible and honest (money sent privately from another app and
 * returned here); a sum that runs away from the ring's own total is what the watch is for.
 */

export type TallyMove = 'in' | 'out';

export type TallySide = Readonly<{ count: number; lamports: bigint }>;
export type TallyDay = Readonly<{ day: string; in: TallySide; out: TallySide }>;

export type TallyStore = Readonly<{
  add(day: string, move: TallyMove, lamports: bigint): Promise<void>;
  /** Days newest first. */
  read(): Promise<readonly TallyDay[]>;
}>;

/** The most a single reported step may carry: a sanity bound, far above any real deposit (one billion SOL). */
export const TALLY_MAX_LAMPORTS = 10n ** 18n;

/** Days a memory store keeps. */
export const TALLY_DAYS = 400;

/** The UTC day of a moment, as `YYYY-MM-DD`. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A reported step, read from a request body: `{ move: "in" | "out", lamports: "<decimal>" }`; null when it is not one. */
export function readReport(body: unknown): Readonly<{ move: TallyMove; lamports: bigint }> | null {
  if (typeof body !== 'object' || body === null) return null;
  const { move, lamports } = body as { move?: unknown; lamports?: unknown };
  if (move !== 'in' && move !== 'out') return null;
  if (typeof lamports !== 'string' || !/^[1-9]\d{0,18}$/.test(lamports)) return null;
  const amount = BigInt(lamports);
  return amount <= TALLY_MAX_LAMPORTS ? { move, lamports: amount } : null;
}

const ZERO: TallySide = Object.freeze({ count: 0, lamports: 0n });

/** Totals in memory, per server instance since it started — until the owner names a durable store. */
export function memoryTally(days = TALLY_DAYS): TallyStore {
  const rows = new Map<string, { in: TallySide; out: TallySide }>();
  return {
    add: async (day, move, lamports) => {
      const row = rows.get(day) ?? { in: ZERO, out: ZERO };
      row[move] = { count: row[move].count + 1, lamports: row[move].lamports + lamports };
      rows.set(day, row);
      for (const old of [...rows.keys()].sort().slice(0, Math.max(0, rows.size - days))) rows.delete(old);
    },
    read: async () => [...rows.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, row]) => ({ day, in: row.in, out: row.out })),
  };
}

/** All days together. */
export function totalOf(days: readonly TallyDay[]): Readonly<{ in: TallySide; out: TallySide }> {
  const sum = (side: 'in' | 'out'): TallySide => ({
    count: days.reduce((n, d) => n + d[side].count, 0),
    lamports: days.reduce((n, d) => n + d[side].lamports, 0n),
  });
  return { in: sum('in'), out: sum('out') };
}

/** The tally as JSON: sums as decimal text. */
export function tallyJson(days: readonly TallyDay[]) {
  const side = (s: TallySide) => ({ count: s.count, lamports: s.lamports.toString() });
  const total = totalOf(days);
  return { total: { in: side(total.in), out: side(total.out) }, days: days.map((d) => ({ day: d.day, in: side(d.in), out: side(d.out) })) };
}
