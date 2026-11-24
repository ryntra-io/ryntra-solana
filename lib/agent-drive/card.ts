import { createHash } from "node:crypto";

import type { GuardStore } from "../guard/store.ts";
import { SITE_ORIGIN } from "../product/app-address.ts";
import { DRIVE_COLLECTION } from "./settings.ts";
import { closedUp, xOf, xText, type SoldEvent } from "./events.ts";
import { coinName, heldText, solPlain, type Lang } from "./figures.ts";
import { DRIVE_WORDS } from "./words.ts";

/**
 * The «×» card of a closed trade, for X in one tap: kept only from a real closed trade (`SoldEvent`) — the coin, what
 * went in, what came out, its «×», when it opened and closed — and drawn by the server (`next/og`, 1200×675) under its
 * own address on ryntra.io. The card is read by its id alone; nobody writes a figure into its address, so a card can
 * never say what the trade did not. Its wallet is kept to list her own cards and is never drawn.
 *
 * Kept beside the drive's settings (`agentReports`): `x:<id>` the card, `xo:<owner>:<id>` her list.
 */

export type DriveCard = Readonly<{
  v: 1;
  kind: "card";
  id: string;
  owner: string;
  cluster: "devnet" | "mainnet";
  policy: string;
  coin: Readonly<{ mint: string; symbol: string | null }>;
  entryRaw: string;
  exitRaw: string;
  x: number | null;
  openedAt: number | null;
  closedAt: number;
  signature: string;
  locale: Lang;
  createdAt: number;
}>;

const ID = /^[a-f0-9]{20}$/u;
export const isCardId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

/** A card's id: the closed trade's own, so one trade is one card, however often it is told. */
export const cardIdOf = (event: Pick<SoldEvent, "cluster" | "signature">) => createHash("sha256").update(`drive-card:${event.cluster}:${event.signature}`).digest("hex").slice(0, 20);

const cardKey = (id: string) => `x:${id}`;
const ownKey = (owner: string, id: string) => `xo:${owner}:${id}`;
const rows = (store: GuardStore) => store.collection<DriveCard>(DRIVE_COLLECTION);

const isCard = (row: unknown): row is DriveCard => typeof row === "object" && row !== null && (row as DriveCard).kind === "card" && (row as DriveCard).v === 1;

/** The card a closed trade makes; the same trade always makes the same card. */
export function cardOf(event: SoldEvent, locale: Lang, nowMs: number): DriveCard {
  return {
    v: 1,
    kind: "card",
    id: cardIdOf(event),
    owner: event.owner,
    cluster: event.cluster,
    policy: event.policy,
    coin: event.coin,
    entryRaw: event.entryRaw,
    exitRaw: event.exitRaw,
    x: xOf(event.entryRaw, event.exitRaw),
    openedAt: event.openedAt,
    closedAt: event.at,
    signature: event.signature,
    locale,
    createdAt: nowMs,
  };
}

/** Keeps the card once: a second telling of the same trade finds it kept. */
export async function keepCard(store: GuardStore, card: DriveCard): Promise<DriveCard> {
  if (!(await rows(store).insertIfAbsent(cardKey(card.id), card))) {
    const kept = await rows(store).get(cardKey(card.id));
    if (isCard(kept)) return kept;
  }
  await rows(store).insertIfAbsent(ownKey(card.owner, card.id), card);
  return card;
}

/** One card by its id; null — none. */
export async function readCard(store: GuardStore, id: string): Promise<DriveCard | null> {
  if (!isCardId(id)) return null;
  const row = await rows(store).get(cardKey(id));
  return isCard(row) ? row : null;
}

/** Her cards closed since a moment, the newest first. */
export async function cardsOf(store: GuardStore, owner: string, sinceMs = 0): Promise<readonly DriveCard[]> {
  const all = await rows(store).valuesWithPrefix(`xo:${owner}:`);
  return all.filter(isCard).filter((card) => card.owner === owner && card.closedAt >= sinceMs).sort((a, b) => b.closedAt - a.closedAt);
}

/** The card's page — what a post links to; X shows its picture. */
export const cardPage = (id: string, origin = SITE_ORIGIN) => `${origin}/x/${id}`;
/** The card's picture, drawn by the server. */
export const cardImage = (id: string, origin = SITE_ORIGIN) => `${origin}/api/v1/agent-drive/card/${id}`;

/** How long the trade was open, as the card says it; null — the first buy was not read. */
export const cardHeld = (card: Pick<DriveCard, "openedAt" | "closedAt">, lang: Lang): string | null => (card.openedAt === null ? null : heldText(card.closedAt - card.openedAt, lang));

/** The post's words: the coin, the «×», the time — the trade's own facts and nothing of ours. */
export function postText(card: DriveCard, lang: Lang): string {
  const x = card.x === null ? null : xText(card.x, lang);
  const coin = coinName(card.coin, lang);
  return x ? DRIVE_WORDS[lang].post(coin, x, cardHeld(card, lang)) : DRIVE_WORDS[lang].post(coin, `${solPlain(card.entryRaw, lang)} → ${solPlain(card.exitRaw, lang)} SOL`, cardHeld(card, lang));
}

/** X's composer with the post's words and the card's page: one tap, the person posts it herself. */
export function postUrl(card: DriveCard, lang: Lang, origin = SITE_ORIGIN): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(postText(card, lang))}&url=${encodeURIComponent(cardPage(card.id, origin))}`;
}

/** Whether the card is worth a «Share» on the note: the trade came back with more than it cost. */
export const shareWorthy = (card: Pick<DriveCard, "entryRaw" | "exitRaw">): boolean => closedUp(card);

/** The card as a page and a screen read it: no wallet. */
export function cardView(card: DriveCard, lang: Lang): Readonly<{ id: string; coin: DriveCard["coin"]; entryRaw: string; exitRaw: string; x: number | null; openedAt: number | null; closedAt: number; page: string; image: string; post: string; up: boolean }> {
  return { id: card.id, coin: card.coin, entryRaw: card.entryRaw, exitRaw: card.exitRaw, x: card.x, openedAt: card.openedAt, closedAt: card.closedAt, page: cardPage(card.id), image: cardImage(card.id), post: postUrl(card, lang), up: closedUp(card) };
}
