/**
 * Outbox delivery — Telegram through the person's connected channel, push
 * through the device registry when the push provider's key is set. The
 * Telegram side (the wallet → account lookup and the bot send) is passed in,
 * so this module imports no account RPC and the whole durable loop runs in
 * a test with a memory store and a fake bot. A note is never permission to
 * trade; nothing here reads a quote or an authorization.
 */

import { deliverToTelegramChannel } from "../account/notifications.ts";
import { assetHrefOfRef, BUDGET_HREF, dueOfIdentity, rulePurchaseHref, symbolOfIdentity } from "../autoinvest/links.ts";
import { readRule } from "../autoinvest/store.ts";
import { reminderTelegramText } from "../autoinvest/words.ts";
import type { GuardStore } from "../guard/store.ts";
import { telegramText } from "./copy.ts";
import { issuerEventHref, positionNoteHref } from "./inbox.ts";
import { pushProviderConfigured, sendPushNote } from "./push.ts";
import { inQuietHours, nextQuietEndMs } from "./quiet-hours.ts";
import { listDevices, listInbox, outboxOf, readPreferences, type InboxRecord } from "./store.ts";

export const APP = process.env.RYNTRA_PUBLIC_ORIGIN?.replace(/\/$/, "") || "https://ryntra.io";
export const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000] as const;

function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

/** The Telegram side of delivery, injectable for tests; production uses the account service and the bot. */
export type TelegramDelivery = Readonly<{
  accountByWallet: (chain: "solana", address: string) => Promise<string | null | undefined>;
  send: (chatId: number, text: string, keyboard: [[{ text: string; url: string }]]) => Promise<unknown>;
}>;

/**
 * An autoinvest reminder as a channel carries it (1.12.0): the rule's words in
 * the language the rule was written in, the action on the button, and the link
 * straight to the purchase — the company with the rule and the occurrence,
 * which the page reads afresh behind the wallet's proof. A rule removed since
 * the note falls back to the note itself.
 */
async function reminderMessage(store: GuardStore, inbox: InboxRecord): Promise<Readonly<{ href: string; text: string; button: string }> | null> {
  /* The month's budget spent (1.13.0): its words, and the button straight to the budget's sheet on Home. */
  if (inbox.subject?.kind === "autoinvest-budget") {
    const href = `${APP}${BUDGET_HREF}`;
    const words = inbox.text?.[inbox.locale] ?? { title: inbox.title, reason: inbox.reason };
    return { href, text: reminderTelegramText(words, href), button: inbox.cta };
  }
  /* An issuer's event (1.15.0): the event's words, and the button straight to the swap's Review on the token's page. */
  if (inbox.subject?.kind === "issuer-event") {
    const href = `${APP}${issuerEventHref(inbox.subject.id)}`;
    const words = inbox.text?.[inbox.locale] ?? { title: inbox.title, reason: inbox.reason };
    return { href, text: reminderTelegramText(words, href), button: inbox.cta };
  }
  /* «Ryntra попередить» on a position (1.21.0): the warning's words in the language it was turned on in, and the button straight to the sale. */
  if (inbox.subject?.kind === "position") {
    const href = `${APP}${await positionNoteHref(store, inbox.owner, inbox)}`;
    const words = inbox.text?.[inbox.locale] ?? { title: inbox.title, reason: inbox.reason };
    return { href, text: reminderTelegramText(words, href), button: inbox.cta };
  }
  if (inbox.subject?.kind !== "autoinvest-rule") return null;
  const rule = await readRule(store, inbox.owner, inbox.subject.id).catch(() => null);
  const due = dueOfIdentity(inbox.triggerId, inbox.subject.id);
  const symbol = symbolOfIdentity(inbox.triggerId);
  const href = `${APP}${rule && due ? rulePurchaseHref(rule, due) : symbol ? assetHrefOfRef(symbol) : inbox.href}`;
  const words = inbox.text?.[inbox.locale] ?? { title: inbox.title, reason: inbox.reason };
  return { href, text: reminderTelegramText(words, href), button: inbox.cta };
}

export async function deliverOutbox(store: GuardStore, nowMs: number, deps: Readonly<{ telegram: TelegramDelivery }>): Promise<void> {
  const telegram = deps.telegram;
  const rows = await outboxOf(store).valuesWithPrefix("");
  const at = new Date(nowMs).toISOString();
  for (const row of rows) {
    if (row.state !== "pending") continue;
    if (Date.parse(row.nextAttemptAt) > nowMs) continue;
    const prefs = await readPreferences(store, row.owner);
    if (inQuietHours(nowMs, prefs.quietHours)) {
      const until = nextQuietEndMs(nowMs, prefs.quietHours) ?? nowMs + 15 * 60_000;
      await outboxOf(store).set(row.id, {
        ...row,
        nextAttemptAt: new Date(until).toISOString(),
        updatedAt: at,
      });
      continue;
    }
    if (row.channel === "telegram") {
      const inbox = (await listInbox(store, row.owner)).find((item) => item.id === row.inboxId);
      const reminder = inbox ? await reminderMessage(store, inbox) : null;
      const href = reminder?.href ?? (inbox ? `${APP}${inbox.href}` : `${APP}/app/alerts`);
      const text = reminder
        ? reminder.text
        : inbox
          ? telegramText({ label: inbox.context || inbox.title, reason: inbox.reason, href, paper: inbox.paper })
          : `Ryntra\nYour plan needs attention.\n\nReview plan\n${href}`;
      const button = reminder?.button ?? "Review plan";
      const accountId = await telegram.accountByWallet("solana", row.owner);
      let result: "sent" | "no_channel" | "failed";
      if (accountId === undefined) result = "failed";
      else if (!accountId) result = "no_channel";
      else {
        result = await deliverToTelegramChannel(store, accountId, text, async (chatId, body) => {
          const sent = await telegram.send(chatId, body, [[{ text: button, url: href }]]);
          if (!sent) throw new Error("not delivered");
          return sent;
        });
      }
      const attempts = row.attempts + 1;
      if (result === "sent") {
        await outboxOf(store).set(row.id, { ...row, state: "sent", attempts, lastError: null, updatedAt: at });
      } else if (result === "no_channel") {
        await outboxOf(store).set(row.id, { ...row, state: "skipped_no_destination", attempts, lastError: null, updatedAt: at });
      } else if (attempts >= MAX_ATTEMPTS) {
        await outboxOf(store).set(row.id, { ...row, state: "failed", attempts, lastError: "delivery failed", updatedAt: at });
      } else {
        await outboxOf(store).set(row.id, {
          ...row,
          state: "pending",
          attempts,
          lastError: "delivery failed",
          nextAttemptAt: new Date(nowMs + backoffMs(attempts)).toISOString(),
          updatedAt: at,
        });
      }
      continue;
    }
    const devices = await listDevices(store, row.owner);
    if (devices.length === 0) {
      await outboxOf(store).set(row.id, { ...row, state: "skipped_no_destination", attempts: row.attempts + 1, updatedAt: at });
      continue;
    }
    if (!pushProviderConfigured()) {
      await outboxOf(store).set(row.id, { ...row, state: "skipped_no_provider", attempts: row.attempts + 1, lastError: null, updatedAt: at });
      continue;
    }
    const inbox = (await listInbox(store, row.owner)).find((item) => item.id === row.inboxId);
    const href = inbox ? `${APP}${inbox.href}` : `${APP}/app/alerts`;
    const title = "Ryntra";
    const body = inbox ? `${inbox.context} — ${inbox.title}` : "Your plan needs attention.";
    let sent = 0;
    let unregistered = 0;
    let failed = 0;
    for (const device of devices) {
      const outcome = await sendPushNote({ token: device.token, title, body, href });
      if (outcome === "sent") sent += 1;
      else if (outcome === "unregistered") unregistered += 1;
      else failed += 1;
    }
    const attempts = row.attempts + 1;
    if (sent > 0) {
      await outboxOf(store).set(row.id, { ...row, state: "sent", attempts, lastError: null, updatedAt: at });
    } else if (unregistered === devices.length) {
      await outboxOf(store).set(row.id, { ...row, state: "skipped_no_destination", attempts, lastError: null, updatedAt: at });
    } else if (attempts >= MAX_ATTEMPTS) {
      await outboxOf(store).set(row.id, { ...row, state: "failed", attempts, lastError: "delivery failed", updatedAt: at });
    } else {
      await outboxOf(store).set(row.id, {
        ...row,
        state: "pending",
        attempts,
        lastError: failed > 0 ? "delivery failed" : null,
        nextAttemptAt: new Date(nowMs + backoffMs(attempts)).toISOString(),
        updatedAt: at,
      });
    }
  }
}
