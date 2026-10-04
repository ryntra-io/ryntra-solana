import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";
import { maskWallet } from "./business.ts";

/**
 * What a feedback thread knows about the person behind it, beside the inbox.
 *
 * The inbox table (`private.feedback_threads`) carries a Telegram id and
 * nothing else about who wrote — and the product's people are wallets, most of
 * them with no account at all. So the thread gets a context record in the
 * Guard store, keyed by the thread id, no DDL: the topic the person chose (a
 * *question* is `other` in the inbox's own categories and *Запитання* here),
 * the wallet that was connected and whether it had proved itself, a contact
 * the person offered, the page they wrote from. The admin list joins it by id;
 * a thread without one reads as before.
 *
 * Nothing here is a boundary. A lost context write costs the operator a
 * masked address on one row, never a thread.
 */

export const FEEDBACK_TOPICS = ["question", "idea", "bug", "security"] as const;
export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number];

export function isFeedbackTopic(value: unknown): value is FeedbackTopic {
  return typeof value === "string" && (FEEDBACK_TOPICS as readonly string[]).includes(value);
}

/** The inbox's own category for a topic — its check constraint knows four words. */
export function inboxCategoryFor(topic: FeedbackTopic): "bug" | "idea" | "security" | "other" {
  return topic === "question" ? "other" : topic;
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const COLLECTION = "feedbackContext" as const;

export const FeedbackContextSchema = z
  .object({
    schema: z.literal("ryntra.feedback-context"),
    schemaVersion: z.literal("1.0.0"),
    /** The inbox thread id — the join key. */
    id: z.string().uuid(),
    publicRef: z.string().min(1).max(40),
    topic: z.enum(FEEDBACK_TOPICS),
    /** The Solana wallet connected when the person wrote, or null. */
    wallet: z.string().regex(BASE58_ADDRESS).nullable(),
    /** True when that wallet had proved it was its owner's in the same session. */
    proven: z.boolean(),
    /** A Telegram handle or an email the person typed, or null. Never shown to another customer. */
    contact: z.string().min(2).max(120).nullable(),
    route: z.string().max(500).nullable(),
    locale: z.string().max(8).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type FeedbackContext = z.output<typeof FeedbackContextSchema>;

/** A contact as typed, trimmed, or null — no shape is enforced beyond length, a person's handle is theirs. */
export function sanitizeFeedbackContact(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const contact = value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  if (contact.length < 2 || contact.length > 120) return null;
  return contact;
}

export function isSolanaWallet(value: unknown): value is string {
  return typeof value === "string" && BASE58_ADDRESS.test(value);
}

export async function recordFeedbackContext(store: GuardStore, context: FeedbackContext): Promise<boolean> {
  try {
    const parsed = FeedbackContextSchema.parse(context);
    return await store.collection<FeedbackContext>(COLLECTION).insertIfAbsent(parsed.id, parsed);
  } catch {
    return false;
  }
}

/** Every context there is, by thread id. Scanned whole; the inbox is small by nature. */
export async function listFeedbackContexts(store: GuardStore): Promise<ReadonlyMap<string, FeedbackContext>> {
  const out = new Map<string, FeedbackContext>();
  try {
    const rows = await store.collection<unknown>(COLLECTION).valuesWithPrefix("");
    for (const row of rows) {
      const parsed = FeedbackContextSchema.safeParse(row);
      if (parsed.success) out.set(parsed.data.id, parsed.data);
    }
  } catch {
    /* An unreadable side table leaves the inbox as it was. */
  }
  return out;
}

export async function readFeedbackContext(store: GuardStore, id: string): Promise<FeedbackContext | null> {
  try {
    const row = await store.collection<unknown>(COLLECTION).get(id);
    const parsed = FeedbackContextSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** What the admin surface may show of a context: the wallet masked, the rest as typed. */
export type FeedbackContextView = Readonly<{
  topic: FeedbackTopic;
  wallet: string | null;
  walletMasked: string | null;
  proven: boolean;
  contact: string | null;
  route: string | null;
}>;

export function feedbackContextView(context: FeedbackContext | null | undefined): FeedbackContextView | null {
  if (!context) return null;
  return {
    topic: context.topic,
    wallet: context.wallet,
    walletMasked: context.wallet ? maskWallet(context.wallet) : null,
    proven: context.proven,
    contact: context.contact,
    route: context.route,
  };
}
