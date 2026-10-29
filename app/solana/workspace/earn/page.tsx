import { readEarnSurface } from "@/lib/earn/service.server";

import { solanaServerLocale } from "../i18n/server.ts";
import { EarnSurface } from "./earn-surface.tsx";
import { earnWord } from "./earn-words.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: earnWord(locale === "uk" ? "uk" : "en", "title") };
}

/**
 * «Earn» — a person's own asset in a lending market, at `/app/earn`.
 *
 * The markets are read here, on the server, because the key that reads them belongs on the server and
 * because the first paint should carry the figures a person came for. The position cannot be: it belongs to a
 * wallet only the browser knows about, so the page hands this read to the surface and the surface asks again
 * with the wallet — from the chain, every time, rather than from anything the interface remembers.
 *
 * Served wherever the app is served, including where no provider can be reached: a person then reads which
 * provider is unavailable and why, which is the truth, instead of a page that looks like a market with
 * nothing in it.
 */
export default async function SolanaEarnPage() {
  const locale = await solanaServerLocale();
  const surface = await readEarnSurface(null);
  return <EarnSurface initial={surface} lang={locale === "uk" ? "uk" : "en"} />;
}
