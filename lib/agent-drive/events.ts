/**
 * The agent's drive: every move it makes for the person — bought, sold, paused, stopped, and a sale her rules called for
 * that did not go (`exit_failed`) — told at once, in Telegram and
 * on the phone, with «Stop» under it. This file is the event itself: its shape, the identity that tells it once, and the
 * one figure a closed trade carries — its «×», what came out over what went in. Pure: the watch (`./watch.ts`), the
 * telling (`./tell.ts`), the cards (`./card.ts`) and the tests read it.
 *
 * Every figure is a fact of the person's own trade as the agent's book keeps it: lamports spent, lamports received,
 * the moment. Nothing is estimated forward, nothing is promised; a figure not read is absent, never zero.
 */

import { z } from "zod";

import type { PauseReason } from "../mandate/strategy.ts";

/** The kinds she turns on and off one by one (`./settings.ts`); a sale that did not go is told under «sold» (`topicOf`). */
export const DRIVE_KINDS = ["bought", "sold", "paused", "stopped"] as const;
export type DriveKind = (typeof DRIVE_KINDS)[number];

/** The agent's own sale her rules called for did not go — she hears it under «sold», with «Stop» under it. */
export const EXIT_FAILED = "exit_failed" as const;

/** The switch of her settings an event is told under. */
export const topicOf = (kind: DriveKind | typeof EXIT_FAILED): DriveKind => (kind === EXIT_FAILED ? "sold" : kind);

/** Why the agent stopped: the person's «Stop», her budget taken back, its term over, its budget spent. */
export const STOP_WHYS = ["you", "withdrawn", "ended", "spent"] as const;
export type StopWhy = (typeof STOP_WHYS)[number];

/** Why the agent paused itself — the book's own reasons (`lib/mandate/strategy.ts` `PauseReason`). */
export const PAUSE_WHYS = ["failing", "loss", "losses", "short", "unread", "take", "stop", "late", "market", "balance", "mismatch", "fade", "time", "blind"] as const satisfies readonly PauseReason[];
export type PauseWhy = (typeof PAUSE_WHYS)[number];

/**
 * Why a trade was closed, when the seller says it: her stop, half at 2x, the volume faded, its time, her own sale: the grid sold a level one step up, the signal turned.
 */
export const SALE_WHYS = ["stop", "take", "fade", "time", "you", "grid", "signal"] as const;
export type SaleWhy = (typeof SALE_WHYS)[number];

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u);
const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/u);
const Raw = z.string().regex(/^\d{1,30}$/u);
const Ms = z.number().int().nonnegative();
const Ticker = z.string().regex(/^[A-Za-z0-9]{1,10}$/u);

const Base = {
  owner: Base58,
  cluster: z.enum(["devnet", "mainnet"]),
  /** The mandate the agent works under — its policy's address. */
  policy: Base58,
  /** The coin it trades for her, and its ticker when one was read. */
  coin: z.object({ mint: Base58, symbol: Ticker.nullable() }).strict(),
  at: Ms,
};

export const BoughtEventSchema = z
  .object({
    kind: z.literal("bought"),
    ...Base,
    signature: Signature,
    /** The budget it spent, lamports. */
    spentRaw: Raw,
    /** What reached her wallet, base units of the coin; null — not read yet. */
    receivedRaw: Raw.nullable(),
  })
  .strict();

/**
 * A closed trade — the agent sold what it bought for her. The seller (the person's sale through the agent today, the
 * agent's own exit tomorrow) hands this over; `entryRaw` is what the coins sold cost her, `exitRaw` the SOL that came
 * back to her wallet, both lamports. `openedAt` — the first buy of those coins; null — not read.
 */
export const SoldEventSchema = z
  .object({
    kind: z.literal("sold"),
    ...Base,
    signature: Signature,
    entryRaw: Raw,
    exitRaw: Raw,
    openedAt: Ms.nullable(),
    why: z.enum(SALE_WHYS).nullable(),
  })
  .strict();

export const PausedEventSchema = z.object({ kind: z.literal("paused"), ...Base, why: z.enum(PAUSE_WHYS) }).strict();

export const StoppedEventSchema = z.object({ kind: z.literal("stopped"), ...Base, why: z.enum(STOP_WHYS) }).strict();

/**
 * The agent's own sale did not go: why her rules called for it, and when it tries again. It always tries again —
 * the note says so, with «Stop» under it for her to take the coin home herself.
 */
export const ExitFailedEventSchema = z.object({ kind: z.literal(EXIT_FAILED), ...Base, why: z.enum(SALE_WHYS), retryAt: Ms }).strict();

export const DriveEventSchema = z.discriminatedUnion("kind", [BoughtEventSchema, SoldEventSchema, PausedEventSchema, StoppedEventSchema, ExitFailedEventSchema]);

export type BoughtEvent = z.infer<typeof BoughtEventSchema>;
export type SoldEvent = z.infer<typeof SoldEventSchema>;
export type PausedEvent = z.infer<typeof PausedEventSchema>;
export type StoppedEvent = z.infer<typeof StoppedEventSchema>;
export type ExitFailedEvent = z.infer<typeof ExitFailedEventSchema>;
export type DriveEvent = z.infer<typeof DriveEventSchema>;

/** Every drive note carries this in the engine's inbox, so the delivery says it in its own words and buttons. */
export const DRIVE_TRIGGER = "agent-drive:" as const;

/**
 * The identity that tells an event once, whoever sees it first and however often: a trade by its signature, a state by
 * the step of the watch's cursor that saw it change (`mark`). Claimed in the engine's triggers before anything is told.
 */
export function driveIdentity(event: DriveEvent, mark?: number): string {
  switch (event.kind) {
    case "bought":
    case "sold":
      return `${DRIVE_TRIGGER}${event.kind}:${event.cluster}:${event.signature}`;
    case "paused":
    case "stopped":
      return `${DRIVE_TRIGGER}${event.kind}:${event.cluster}:${event.policy}:${event.why}:${mark ?? event.at}`;
    case EXIT_FAILED:
      return `${DRIVE_TRIGGER}${event.kind}:${event.cluster}:${event.policy}:${event.at}`;
  }
}

/** The weekly summary's identity: one a week per wallet, her ISO week. */
export const weekIdentity = (owner: string, week: string) => `${DRIVE_TRIGGER}week:${owner}:${week}`;

/**
 * A closed trade's «×»: what came out over what went in, to the thousandth, rounded down — a card never reads better than
 * the trade. Null when nothing went in.
 */
export function xOf(entryRaw: string, exitRaw: string): number | null {
  const entry = BigInt(entryRaw);
  if (entry <= 0n) return null;
  return Number((BigInt(exitRaw) * 1000n) / entry) / 1000;
}

/** «×1.24», «×0.87»: two places under ten, one under a hundred, none above. */
export function xText(x: number, lang: "en" | "uk" = "en"): string {
  const places = x < 10 ? 2 : x < 100 ? 1 : 0;
  const step = 10 ** places;
  const text = (Math.floor(x * step + 1e-9) / step).toFixed(places);
  return `×${lang === "uk" ? text.replace(".", ",") : text}`;
}

/** Whether the closed trade brought back more than it cost. */
export const closedUp = (event: Pick<SoldEvent, "entryRaw" | "exitRaw">): boolean => BigInt(event.exitRaw) > BigInt(event.entryRaw);
