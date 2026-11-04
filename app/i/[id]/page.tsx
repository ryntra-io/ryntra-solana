import type { Metadata, Viewport } from "next";

import { CityApp } from "@/city/components/CityApp";
import { IntentLayer } from "@/city/components/intent/IntentLayer";
import { factsOf, readCoinCard } from "@/city/lib/coin/read.server";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { coinMintOf, type Gone } from "@/city/lib/intent/check";
import type { CoinLook } from "@/city/lib/intent/store";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";
import { intentsServed } from "@/lib/intents/runtime.server";
import { readIntent } from "@/lib/intents/service";
import { projectIntent, publicIntentOrigin, type IntentView } from "@/lib/intents/view";

import { buildCityMetadata, CITY_WORDS } from "../../seo";

/* `/i/<id>` — the link to confirm an action an agent, a chat or a partner prepared (CITY-161, contract 1.90.0). The
   same city as `/`, opened with one sheet: who prepared it, the engine's live quote or the real recipient, and «Confirm
   in wallet». The intent is read here on the server and handed to the sheet; the page carries nothing of it in its
   preview or its title, and is never offered to the index. Where intents are not served the address is just the city. */

export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, viewportFit: "cover", maximumScale: 1 };

export function generateMetadata(): Metadata {
  return { ...buildCityMetadata(), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }> };

const COIN_WAIT_MS = 2_500;
const PLAIN = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);

/** The coin's own words, when the engine can say them quickly; the sheet names it by its address otherwise. */
async function coinLook(mint: string | null): Promise<CoinLook | null> {
  if (!mint || PLAIN.has(mint)) return null;
  const card = await Promise.race([readCoinCard(mint).catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), COIN_WAIT_MS))]);
  if (!card) return null;
  const facts = factsOf(card);
  return { mint, symbol: facts.symbol, name: facts.name, icon: facts.icon, verified: facts.verified };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const served = intentsServed();
  let view: IntentView | null = null;
  let gone: Gone | null = null;
  if (served.served) {
    const read = await readIntent(served.deps, id);
    if (read.ok) view = projectIntent(read.record, read.status, publicIntentOrigin());
    else if (read.code === "INTENT_NOT_FOUND") gone = "missing";
    else if (read.code === "INTENT_CHANGED") gone = "changed";
  }
  const coin = view ? await coinLook(coinMintOf(view.spec)) : null;
  return (
    <main className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <h1 className={s.hidden}>{CITY_WORDS.title}</h1>
      <CityApp initial={BUNDLED_CITY} />
      {served.served ? <IntentLayer id={id} view={view} gone={gone} coin={coin} /> : null}
    </main>
  );
}
