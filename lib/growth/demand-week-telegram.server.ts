import type { GuardStore } from "../guard/store.ts";
import { claimTrigger } from "../monitoring/store.ts";
import type { InlineKeyboard } from "../telegram/api.ts";
import { DEMAND_WEEK_ENV, demandMessage, demandTrigger, demandWeekSends, lastClosedWeek, type DemandWeek } from "./demand-week.ts";
import { readDemandWeek } from "./demand-week.server.ts";

/**
 * The owner's week of demand in Telegram (CITY-197): once a week, the week that has just closed, to the owner's own chat
 * (`ALERT_TELEGRAM_ID`, the one the engine's alerts reach), with one button to the page in the admin. Claimed once per
 * week (`monitoringTriggers`), so two passes never tell it twice; a send that fails gives the claim back for the next
 * pass. Shut unless `RYNTRA_DEMAND_WEEK=on`. Reads, and sends one message; it moves nothing.
 */

type Env = Readonly<Record<string, string | undefined>>;

export const DEMAND_PAGE = "https://ryntra.io/admin/growth";

export type DemandAnswer =
  | Readonly<{ ran: false; why: "closed" | "read-only" | "no-chat" | "told" }>
  | Readonly<{ ran: true; week: string; sent: boolean }>;

export type DemandSendDeps = Readonly<{
  now?: () => number;
  read?: (store: GuardStore, week: string) => Promise<DemandWeek>;
  send?: (chatId: number, text: string, keyboard: InlineKeyboard) => Promise<boolean>;
}>;

async function telegram(chatId: number, text: string, keyboard: InlineKeyboard): Promise<boolean> {
  const { sendPlainMessage } = await import("../telegram/api.ts");
  return (await sendPlainMessage(chatId, text, keyboard)) !== null;
}

export async function runDemandWeek(env: Env, guard: Readonly<{ store: GuardStore; writes: { allowed: boolean } }>, deps: DemandSendDeps = {}): Promise<DemandAnswer> {
  if (!demandWeekSends(env[DEMAND_WEEK_ENV])) return { ran: false, why: "closed" };
  if (!guard.writes.allowed) return { ran: false, why: "read-only" };
  const chat = Number(env.ALERT_TELEGRAM_ID?.trim());
  if (!Number.isSafeInteger(chat) || chat === 0) return { ran: false, why: "no-chat" };
  const week = lastClosedWeek((deps.now ?? Date.now)());
  const identity = demandTrigger(week);
  if (!(await claimTrigger(guard.store, identity, new Date((deps.now ?? Date.now)()).toISOString()))) return { ran: false, why: "told" };
  try {
    const slice = await (deps.read ?? ((store, at) => readDemandWeek(store, at, env)))(guard.store, week);
    const sent = await (deps.send ?? telegram)(chat, demandMessage(slice), [[{ text: "Відкрити зріз", url: DEMAND_PAGE }]]);
    if (!sent) await guard.store.collection("monitoringTriggers").delete(identity);
    return { ran: true, week, sent };
  } catch (error) {
    await guard.store.collection("monitoringTriggers").delete(identity).catch(() => undefined);
    throw error;
  }
}
