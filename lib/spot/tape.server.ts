/**
 * The landing's market tape, read (SOL-T4): the eight markets' prices and day's change from Jupiter's catalogue in one
 * read, and a day of hourly closes per market from the chart source the spot page uses (`readSpotCandles`, which keeps
 * its own reads and its own budget). Kept for `TAPE_TTL_MS`; a read never waits past `TAPE_DEADLINE_MS` — while a
 * refresh runs or when the sources do not answer, the last good read is shown, and past its time it says it is stale.
 * A market whose line did not come keeps its last line for half an hour, aged from its own read, and its price.
 */
import "server-only";

import { readSpotCandles } from "./candles.server.ts";
import { readSpotMarketsByMint } from "./markets.server.ts";
import { TAPE_MARKETS, TAPE_PARTIAL_TTL_MS, TAPE_TTL_MS, tapeIcon, tapePoints, type TapeRead, type TapeRow } from "./tape.ts";

let kept: { value: TapeRead; readAt: number } | null = null;
/* Each market's last good line: a read the source refused this time keeps it, aged from when it was read. */
const lastLines = new Map<string, { points: TapeRow["points"]; at: number }>();
/** How long a market's last line stands in for a refused read. */
const LINE_GRACE_MS = 30 * 60_000;
/** The longest a first read waits for the sources; a later one waits less, with the last read in hand. */
const TAPE_DEADLINE_MS = 20_000;
const REFRESH_WAIT_MS = 3_000;
let pending: Promise<TapeRead | null> | null = null;

async function readOnce(): Promise<TapeRead | null> {
  const markets = await readSpotMarketsByMint(TAPE_MARKETS.map((market) => market.mint));
  if (!markets.ok) return null;
  /* At the "page" priority: the minute's reserve stays with the charts people have open, and each market's line is
     kept by the chart source itself, so a later read asks only for the lines still missing. */
  const lines = await Promise.all(TAPE_MARKETS.map((market) => readSpotCandles(market.mint, "1h", "page").catch(() => null)));
  let linesAt: number | null = null;
  const now = Date.now();
  const rows: TapeRow[] = TAPE_MARKETS.map((entry, index) => {
    const market = markets.byMint.get(entry.mint);
    const line = lines[index];
    let points: TapeRow["points"] = [];
    let at: number | null = null;
    if (line?.ok) {
      points = tapePoints(line.candles);
      at = Date.parse(line.observedAt);
      if (points.length > 1 && Number.isFinite(at)) lastLines.set(entry.mint, { points, at });
    } else {
      const last = lastLines.get(entry.mint);
      if (last && now - last.at < LINE_GRACE_MS) ({ points, at } = last);
    }
    /* An hourly line's age speaks for itself under the tape; only prices that did not come make the tape stale. */
    if (at !== null && Number.isFinite(at)) linesAt = linesAt === null ? at : Math.min(linesAt, at);
    return {
      mint: entry.mint,
      symbol: entry.symbol,
      icon: tapeIcon(entry.mint, market?.icon ?? null),
      price: market?.price ?? null,
      change24hPct: market?.change24hPct ?? null,
      points,
    };
  });
  const complete = rows.every((row) => row.points.length > 1);
  return { rows, observedAt: markets.observedAt, linesAt: linesAt === null ? null : new Date(linesAt).toISOString(), stale: false, complete };
}

const within = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });

/** The refresh still running, if any: the route keeps the function alive for it (`after`), so it lands for the next visitor. */
export function tapeRefresh(): Promise<unknown> | null {
  return pending;
}

/** The tape: the kept read while it is fresh, a fresh one within its deadline, or the kept one — stale past its time. */
export async function readTape(): Promise<TapeRead | null> {
  const now = Date.now();
  const due = kept ? now - kept.readAt >= (kept.value.complete ? TAPE_TTL_MS : TAPE_PARTIAL_TTL_MS) : true;
  if (kept && !due) return kept.value;
  pending ??= readOnce()
    .catch(() => null)
    .then((fresh) => {
      if (fresh) kept = { value: fresh, readAt: Date.now() };
      return fresh;
    })
    .finally(() => {
      pending = null;
    });
  const fresh = await within(pending, kept ? REFRESH_WAIT_MS : TAPE_DEADLINE_MS);
  if (fresh) return fresh;
  if (!kept) return null;
  /* The last read stands while a refresh runs; past twice its time it says it is stale. */
  return Date.now() - kept.readAt < 2 * TAPE_TTL_MS ? kept.value : { ...kept.value, stale: true };
}
