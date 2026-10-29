import { checkBeacons, sanitizeBeacons, sanitizeStates, tellsTelegram, type TowerRead } from "./rules";
import { telegramWords } from "./words";
import type { BeaconStore } from "./store";

/**
 * The server's check of every beacon, on its cron: one market read of the city
 * for all, the engine over each account's rules, the states written back, and
 * a Telegram message for each beacon that lit — only when the person asked
 * for it, outside their hours of quiet, and only to a chat their account
 * connected.
 *
 * The states are written before anything is said, and only while the rules
 * are still at the revision checked: a beacon edited mid-pass is not told,
 * and a pass taken again never tells the same firing twice. A message that
 * did not go is not tried again — the tower still lights in the city.
 */

export type MarketRead = Readonly<{ towers: ReadonlyMap<string, TowerRead>; at: number }>;

export type RunDeps = Readonly<{
  store: BeaconStore;
  /** The city's market read; null when there is none fresh enough to check against. */
  market: () => Promise<MarketRead | null>;
  /** Say one message to the account's Telegram chat, if it has one. */
  telegram: (accountId: string, text: string, link: string) => Promise<"sent" | "no_channel" | "failed">;
  /** The tower's address in the city. */
  link: (mint: string) => string;
  now?: () => number;
  pageSize?: number;
  /** The most accounts one pass looks at; the rest wait for the next. */
  maxRows?: number;
}>;

export type RunReport = { checked: number; written: number; fired: number; told: number; failed: number; read: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function runBeacons(deps: RunDeps): Promise<RunReport> {
  const report: RunReport = { checked: 0, written: 0, fired: 0, told: 0, failed: 0, read: false };
  const market = await deps.market();
  /* No read: nothing is known, so nothing would fire nor arm — and nothing is written. */
  if (!market) return report;
  report.read = true;
  const pageSize = deps.pageSize ?? 100;
  const maxRows = deps.maxRows ?? 2_000;
  let after: string | null = null;
  while (report.checked < maxRows) {
    const rows = await deps.store.due({ after, limit: pageSize });
    if (rows.length === 0) break;
    for (const row of rows) {
      report.checked += 1;
      const rules = sanitizeBeacons(row.rules);
      const before = sanitizeStates(row.states, rules);
      const now = deps.now?.() ?? Date.now();
      const { states, fired } = checkBeacons(rules, before, market.towers, market.at, now);
      if (same(states, before)) continue;
      const written = await deps.store.step({ accountId: row.accountId, revision: row.revision, states, now: new Date(now) });
      if (!written) continue;
      report.written += 1;
      for (const firing of fired) {
        report.fired += 1;
        if (!tellsTelegram(firing.rule, now)) continue;
        const link = deps.link(firing.rule.mint);
        const said = await deps.telegram(row.accountId, telegramWords(firing.rule, firing.tower, link), link).catch(() => "failed" as const);
        if (said === "sent") report.told += 1;
        else if (said === "failed") report.failed += 1;
      }
    }
    after = rows[rows.length - 1]!.accountId;
    if (rows.length < pageSize) break;
  }
  return report;
}
