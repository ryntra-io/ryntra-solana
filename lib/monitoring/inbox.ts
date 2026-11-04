/**
 * The inbox reads the routes and the deep link use: mark a note read, resolve
 * a note to the owned record as it stands now. Ownership-checked; a note that
 * is not this wallet's is not found.
 */

import { assetHrefOfRef, BUDGET_HREF, dueOfIdentity, rulePurchaseHref, symbolOfIdentity } from "../autoinvest/links.ts";
import { readRule } from "../autoinvest/store.ts";
import type { GuardStore } from "../guard/store.ts";
import { swapHref } from "../stocks/conversion-watch.ts";
import { limitOrderSpotHref } from "../solana/limits/notes.server.ts";
import { isStopNote } from "../stops/notes.ts";
import { isEarnNote } from "../../city/lib/earn/notes.ts";
import { isAgentReportNote } from "../../city/lib/autopilot/report.ts";
import { lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { inboxKeyOf } from "./apply.ts";
import { positionSaleHref, readPositionWatch } from "./position-watch.ts";
import { inboxOf, listMonitors } from "./store.ts";

/** Where a creator's note lands (1.49.0, SOL-L2): «Мої лаунчі». */
export const LAUNCH_CABINET_HREF = "/app/launch/mine";

/** Where a position's note lands (1.21.0): its company with the sale opening — the symbol the watch holds now, else the one the note was written under. */
export async function positionNoteHref(store: GuardStore, owner: string, inbox: Readonly<{ subject?: { kind: string; id: string }; context: string }>): Promise<string> {
  const watch = inbox.subject ? await readPositionWatch(store, owner, inbox.subject.id).catch(() => null) : null;
  return positionSaleHref(watch?.symbol ?? inbox.context);
}

/** Where an issuer's event note lands: the token's page with the swap's Review opening, or Portfolio once the registry no longer carries the event. */
export function issuerEventHref(mint: string): string {
  const symbol = lifecycleEventFor(mint)?.watch?.symbol;
  return symbol ? swapHref(symbol) : "/app/portfolio?from=monitoring";
}

/** Where «Ранковий огляд» of a day opens (1.46.0, AI-10): the assistant's page with that day's brief unfolded. */
export function briefHref(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `/app/ryn?brief=${day}` : "/app/ryn?brief=latest";
}

/** Where a token watch's note opens (1.57.0, AI-05): the assistant's page with the watch in view. */
export function tokenWatchHref(id: string): string {
  return /^wch_[0-9a-f]{24}$/.test(id) ? `/app/ryn?watch=${id}` : "/app/ryn?watch=all";
}

/** A «Доручення» (1.59.0, AI-19): the assistant's page with the task's conversation open. */
export function assistantTaskHref(id: string): string {
  return `/app/ryn?task=${encodeURIComponent(id)}`;
}

/** A followed wallet's note (1.63.0, SOL-R4): «Ринки» → «Гаманці» with the wallet open. */
export function walletWatchHref(wallet: string): string {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) ? `/app/markets?tab=wallets&wallet=${wallet}` : "/app/markets?tab=wallets";
}

export async function markInboxRead(store: GuardStore, owner: string, id: string): Promise<boolean> {
  const key = inboxKeyOf(owner, id);
  const row = await inboxOf(store).get(key);
  if (!row || row.owner !== owner) return false;
  if (!row.unread) return true;
  await inboxOf(store).set(key, { ...row, unread: false });
  return true;
}

export async function resolveInboxLink(store: GuardStore, owner: string, id: string): Promise<string | null> {
  const inbox = await inboxOf(store).get(inboxKeyOf(owner, id));
  if (inbox && inbox.owner === owner) {
    await markInboxRead(store, owner, id);
    /* A reached stop (CITY-149): the city on the stop's coin, its sale opening for the wallet to sign. */
    if (isStopNote(inbox)) return inbox.href;
    /* An Earn note of the city (CITY-100): the city with Earn open on «Mine». */
    if (isEarnNote(inbox)) return inbox.href;
    /* The agent's daily report (CITY-194): the city with the person's agent open. */
    if (isAgentReportNote(inbox)) return inbox.href;
    /* The month's budget spent (1.13.0): Home, the budget's sheet open — its one action, «Змінити бюджет». */
    if (inbox.subject?.kind === "autoinvest-budget") return `${BUDGET_HREF}&from=monitoring`;
    /* An issuer's event (1.15.0): the token's page, the swap's Review opening on arrival — the page reads the wallet afresh. An event the registry no longer carries lands in Portfolio. */
    if (inbox.subject?.kind === "issuer-event") return issuerEventHref(inbox.subject.id);
    /* A spot limit order's note (1.42.0): the base token's Spot page, where «Мої ордери» lists the order. */
    if (inbox.subject?.kind === "limit-order") {
      const href = await limitOrderSpotHref(store, owner, inbox.subject.id);
      return `${href}${href.includes("?") ? "&" : "?"}from=monitoring`;
    }
    /* A creator's note (1.49.0, SOL-L2): «Мої лаунчі», where the launch, its figures and «Забрати» are. */
    if (inbox.subject?.kind === "launch-creator") return `${LAUNCH_CABINET_HREF}?from=monitoring`;
    /* «Ранковий огляд» (1.46.0, AI-10): the assistant's page, the day's brief open. */
    if (inbox.subject?.kind === "assistant-brief") return `${briefHref(inbox.subject.id)}&from=monitoring`;
    /* A token watch (1.57.0, AI-05): the assistant's page, the watch in view with «Пауза», «Змінити», «Вимкнути». */
    if (inbox.subject?.kind === "token-watch") return `${tokenWatchHref(inbox.subject.id)}&from=monitoring`;
    /* A «Доручення» (1.59.0, AI-19): the assistant's page, the task's conversation with every run's answer. */
    if (inbox.subject?.kind === "assistant-task") return `${assistantTaskHref(inbox.subject.id)}&from=monitoring`;
    /* A followed wallet's trade (1.63.0, SOL-R4): «Гаманці», the wallet open with its trades and result. */
    if (inbox.subject?.kind === "wallet-watch") return `${walletWatchHref(inbox.subject.id)}&from=monitoring`;
    /* «Ryntra попередить» on a position (1.21.0): the company, the sale opening on arrival — «Відкрити продаж». */
    if (inbox.subject?.kind === "position") return `${await positionNoteHref(store, owner, inbox)}&from=monitoring`;
    /* An autoinvest reminder opens its purchase: the company with the rule and the occurrence, read afresh there (1.12.0). A rule removed since goes to Monitoring. */
    if (inbox.subject?.kind === "autoinvest-rule") {
      const rule = await readRule(store, owner, inbox.subject.id);
      const due = dueOfIdentity(inbox.triggerId, inbox.subject.id);
      if (rule && due) return `${rulePurchaseHref(rule, due)}&from=monitoring`;
      /* The rule was removed since: its company, a plain purchase. */
      const symbol = symbolOfIdentity(inbox.triggerId);
      return symbol ? assetHrefOfRef(symbol) : "/app/markets";
    }
    const monitor = (await listMonitors(store, owner)).find((row) => row.id === inbox.monitorId);
    const href = monitor?.href ?? "/app/alerts";
    const join = href.includes("?") ? "&" : "?";
    return `${href}${join}from=monitoring`;
  }
  const monitor = (await listMonitors(store, owner)).find((row) => row.id === id);
  if (!monitor) return null;
  const join = monitor.href.includes("?") ? "&" : "?";
  return `${monitor.href}${join}from=monitoring`;
}
