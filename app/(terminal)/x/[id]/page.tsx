import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { cardImage, cardPage, postText, readCard } from "@/lib/agent-drive/card";
import { xText } from "@/lib/agent-drive/events";
import { coinName } from "@/lib/agent-drive/figures";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { XScreen } from "@/terminal/agents/drive/XScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata, SITE_NAME, TWITTER } from "../../../seo";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

async function cardOf(id: string) {
  return readCard(getGuardRuntime().store, id).catch(() => null);
}

/* A closed trade's card under its own address on ryntra.io: what a post on X links to. Its preview is the card's own
   picture, drawn by the server from the kept trade (`/api/v1/agent-drive/card/<id>`, 1200×675). A person's trade:
   shared, never offered to the index. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const card = await cardOf(id);
  const base = buildTerminalMetadata({ name: "Closed trade", path: `/x/${id}`, index: false });
  if (!card) return base;
  const coin = coinName(card.coin, "en");
  const title = card.x === null ? `${coin} · Ryntra` : `${coin} ${xText(card.x)} · Ryntra`;
  const description = postText(card, "en");
  const image = { url: cardImage(card.id), width: 1200, height: 675, alt: description };
  return {
    ...base,
    title: { absolute: title },
    description,
    alternates: { canonical: cardPage(card.id) },
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: cardPage(card.id), images: [image] },
    twitter: { card: "summary_large_image", site: TWITTER, title, description, images: [image] },
  };
}

export default async function Page({ params }: Props) {
  if (!shelfOn("agents")) notFound();
  const { id } = await params;
  const card = await cardOf(id);
  if (!card) notFound();
  return <XScreen card={{ id: card.id, coin: card.coin, entryRaw: card.entryRaw, exitRaw: card.exitRaw, x: card.x, openedAt: card.openedAt, closedAt: card.closedAt }} />;
}
