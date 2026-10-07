/**
 * The inbox reads the routes and the deep link use: mark a note read, resolve
 * a note to the owned record as it stands now. Ownership-checked; a note that
 * is not this wallet's is not found.
 */

import { assetHrefOfRef, BUDGET_HREF, dueOfIdentity, rulePurchaseHref, symbolOfIdentity } from "../autoinvest/links.ts";
import { readRule } from "../autoinvest/store.ts";
import type { GuardStore } from "../guard/store.ts";
import { swapHref } from "../stocks/conversion-watch.ts";
import { lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { inboxKeyOf } from "./apply.ts";
import { positionSaleHref, readPositionWatch } from "./position-watch.ts";
import { inboxOf, listMonitors } from "./store.ts";

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
    /* The month's budget spent (1.13.0): Home, the budget's sheet open — its one action, «Змінити бюджет». */
    if (inbox.subject?.kind === "autoinvest-budget") return `${BUDGET_HREF}&from=monitoring`;
    /* An issuer's event (1.15.0): the token's page, the swap's Review opening on arrival — the page reads the wallet afresh. An event the registry no longer carries lands in Portfolio. */
    if (inbox.subject?.kind === "issuer-event") return issuerEventHref(inbox.subject.id);
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
