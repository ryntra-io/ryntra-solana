/**
 * The agent's funnel in the admin (CITY-246): the city's moments from `/api/track` (`city/lib/crew/funnel.ts`), counted
 * by day and device — visits that reached each moment, never people, never wallets. Robots' visits (our own walks and
 * shots, the word `bot`) are left out by the store's read and counted apart. Pure: the route reads the store, the page
 * draws this table, the tests read both.
 */

import { FUNNEL_DEVICES, FUNNEL_SIDE, FUNNEL_STEPS, FUNNEL_WIDE, type FunnelDevice, type FunnelName } from "../../city/lib/crew/funnel.ts";
import { rpcProbe } from "../supabase-probe.ts";

export const FUNNEL_LABEL: Readonly<Record<FunnelName, string>> = {
  agent_home: "Відкрив місто",
  agent_drawn: "Місто намалювалось",
  agent_hint: "Натиснув «Скажи»",
  agent_line: "Відкрив рядок агента",
  agent_said: "Сказав речення",
  agent_card: "Побачив план агента",
  agent_wallet: "Гаманець з карткою агента",
  agent_sign: "Натиснув «Підписати» бюджет",
  agent_signed: "Бюджет підписано",
  agent_connect: "Підключив гаманець",
  agent_signin: "Увійшов гаманцем",
  agent_trade: "Підписує угоду",
  agent_traded: "Угода підтверджена",
  agent_sign_no: "Бюджет не підписано",
  agent_wallet_app: "Пішов у застосунок гаманця",
  agent_trade_no: "Угода не відбулась",
};

/** The table's rows: the agent's path, then the visit's way to money, then what did not happen. */
export const FUNNEL_ORDER: readonly FunnelName[] = [
  "agent_home",
  "agent_drawn",
  "agent_hint",
  "agent_line",
  "agent_said",
  "agent_card",
  "agent_connect",
  "agent_wallet",
  "agent_signin",
  "agent_sign",
  "agent_signed",
  "agent_trade",
  "agent_traded",
  "agent_sign_no",
  "agent_trade_no",
  "agent_wallet_app",
];

/** Which visits a table counts: all, the web (a desk or a phone's browser), the Ryntra app, or one device. */
export const FUNNEL_SCOPES = ["all", "web", "app", "desk", "phone"] as const;
export type FunnelScope = (typeof FUNNEL_SCOPES)[number];

export const FUNNEL_SCOPE_LABEL: Readonly<Record<FunnelScope, string>> = {
  all: "Усі",
  web: "Веб",
  app: "Застосунок",
  desk: "Стіл",
  phone: "Телефон у браузері",
};

const SCOPE_DEVICES: Readonly<Record<FunnelScope, readonly FunnelDevice[]>> = {
  all: FUNNEL_DEVICES,
  web: ["desk", "phone"],
  app: ["app"],
  desk: ["desk"],
  phone: ["phone"],
};

export const isFunnelScope = (value: unknown): value is FunnelScope => typeof value === "string" && (FUNNEL_SCOPES as readonly string[]).includes(value);

export type FunnelCount = Readonly<{ day: string; name: string; device: string; n: number }>;

export type FunnelRead =
  | Readonly<{ status: "measured"; since: string | null; bots: number; rows: readonly FunnelCount[] }>
  | Readonly<{ status: "not_collected" | "unavailable" }>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN: ReadonlySet<string> = new Set<string>([...FUNNEL_STEPS, ...FUNNEL_WIDE, ...FUNNEL_SIDE]);

/** The store's answer held to its shape: a row that is not a known moment, device, day and count is dropped. */
export function funnelRows(value: unknown): FunnelCount[] {
  if (!Array.isArray(value)) return [];
  const out: FunnelCount[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.day !== "string" || !DAY.test(row.day)) continue;
    if (typeof row.name !== "string" || !KNOWN.has(row.name)) continue;
    if (typeof row.device !== "string" || !(FUNNEL_DEVICES as readonly string[]).includes(row.device)) continue;
    if (typeof row.n !== "number" || !Number.isInteger(row.n) || row.n < 0) continue;
    out.push({ day: row.day, name: row.name, device: row.device, n: row.n });
  }
  return out;
}

/**
 * The store's count (`public.admin_agent_funnel`, CITY-246): an unapplied function is «not collected yet», a failing
 * store «unavailable» — never a zero.
 */
export async function readAgentFunnel(days: number): Promise<FunnelRead> {
  const probe = await rpcProbe<{ since?: unknown; bots?: unknown; rows?: unknown }>("admin_agent_funnel", { p_days: days });
  if (probe.kind === "missing") return { status: "not_collected" };
  if (probe.kind === "unavailable" || !probe.data) return { status: "unavailable" };
  const since = typeof probe.data.since === "string" ? probe.data.since : null;
  const bots = typeof probe.data.bots === "number" && Number.isFinite(probe.data.bots) ? probe.data.bots : 0;
  return { status: "measured", since, bots, rows: funnelRows(probe.data.rows) };
}

/** The last `count` days up to `today` (UTC, `YYYY-MM-DD`), oldest first. */
export function funnelDays(today: string, count: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || count < 1) return [];
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export type FunnelTable = Readonly<{
  days: readonly string[];
  rows: readonly Readonly<{ name: FunnelName; label: string; counts: readonly number[]; total: number; ofHome: number | null }>[];
}>;

/** Moments × days for one scope; the share of the first screen's visits for each moment's total. */
export function funnelTable(rows: readonly FunnelCount[], days: readonly string[], scope: FunnelScope): FunnelTable {
  const devices = new Set<string>(SCOPE_DEVICES[scope]);
  const index = new Map(days.map((day, i) => [day, i]));
  const counts = new Map<string, number[]>(FUNNEL_ORDER.map((name) => [name, days.map(() => 0)]));
  for (const row of rows) {
    if (!devices.has(row.device)) continue;
    const i = index.get(row.day);
    const line = counts.get(row.name);
    if (i === undefined || !line) continue;
    line[i] += row.n;
  }
  const sum = (line: readonly number[]) => line.reduce((a, b) => a + b, 0);
  const home = sum(counts.get("agent_home") ?? []);
  return {
    days,
    rows: FUNNEL_ORDER.map((name) => {
      const line = counts.get(name) ?? [];
      const total = sum(line);
      return { name, label: FUNNEL_LABEL[name], counts: line, total, ofHome: home > 0 ? total / home : null };
    }),
  };
}
