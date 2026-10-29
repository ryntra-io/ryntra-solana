import { ArrowLeft, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { investWords } from "@/app/app/invest/invest-words";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { readCurrentEpoch, readOnchainMintCached, transferFeeFromMint } from "@/lib/stocks/asset.server";
import { deadlineExact, type WatchedEvent } from "@/lib/stocks/conversion-watch";
import { tokenLine, truthLine } from "@/lib/stocks/truth";
import { multiplierFromChain } from "@/lib/stocks/units";
import { findStockRow } from "@/lib/stocks/universe.server";

import company from "./company.module.css";
import { EventCard } from "./company-event";
import { eventFacts } from "./company-view";

/**
 * The page of a token whose issuer opened a swap window when no catalogue
 * lists the token any more (UX-503): `/app/stocks/SPACEX`, its `?convert=1`
 * and `?sell=1`, and the token's address all land here rather than on «not
 * found». The company and the token by name, then one card — the deadline in
 * red, the swap into the listed token as the one action, the sale for USDC
 * beside it, what the token is — and the issuer's notice with its minute. The
 * swap is the same sheet as on the company's full page (`ConvertSheet`); the
 * token's decimals, multiplier and the issuer's fee are read from the chain,
 * the listed token's facts from the universe when it answers.
 */
export async function CompanyEventPage({ locale, event, nowMs }: Readonly<{ locale: WorkspaceLocale; event: WatchedEvent; nowMs: number }>) {
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const into = event.watch.into;
  const [onchain, epoch, target, targetChain] = await Promise.all([
    readOnchainMintCached(event.mint).catch(() => null),
    readCurrentEpoch().catch(() => null),
    into ? findStockRow(into.mint).catch(() => null) : null,
    into ? readOnchainMintCached(into.mint).catch(() => null) : null,
  ]);
  const chain = onchain && !("error" in onchain) ? onchain : null;
  const feeBps = transferFeeFromMint(onchain, epoch)?.basisPoints ?? null;
  const multiplier = chain?.scaledUi ? multiplierFromChain(chain.scaledUi, nowMs).current : null;
  const listed = target && target.ok ? target.row : null;
  const facts = eventFacts(event, listed, lang, nowMs);
  /* Without the listed token's row the swap still stands when the target's own mint was read — its units from the chain, the exchange's price unread; without either, the sale alone. */
  const targetMint = targetChain && !("error" in targetChain) ? targetChain : null;
  const swapInto =
    facts.into ??
    (into && facts.open && targetMint
      ? { mint: into.mint, symbol: into.symbol, company: into.company, icon: null, multiplier: targetMint?.scaledUi ? multiplierFromChain(targetMint.scaledUi, nowMs).current : null, exchangeUsd: null, truth: truthLine("xstocks", into.company, lang) }
      : null);
  const name = event.watch.company;
  const token = { mint: event.mint, symbol: event.watch.symbol, name, icon: null, decimals: chain?.decimals ?? null, multiplier, issuerFeeBps: feeBps };

  return (
    <section className={`${company.page} ${company.eventPage}`} aria-labelledby="company-title" data-event-page>
      <Link className={company.back} href="/app/markets" prefetch={false}>
        <ArrowLeft size={16} weight="bold" aria-hidden="true" />
        {word("marketsTitle")}
      </Link>
      <header className={company.head}>
        <MarketIcon mint={event.mint} icon={null} symbol={name} size={56} className={company.logo} />
        <div className={company.headText}>
          <h1 id="company-title" className={company.name}>
            {name}
          </h1>
          <p className={company.tokenLine} data-token-line>
            <span translate="no">{event.watch.symbol}</span>
            {tokenLine(event.watch.symbol, "prestocks", lang).slice(event.watch.symbol.length)}
          </p>
        </div>
      </header>
      <EventCard event={{ ...facts, into: swapInto, swapWord: swapInto ? facts.swapWord : null }} token={token} truth={truthLine("prestocks", name, lang, feeBps)} locale={locale} />
      <p className={company.eventSource}>
        <span translate="no">{`${word("issuerDeadline")}: ${deadlineExact(event.deadline, lang)}`}</span>
        <a href={event.url} target="_blank" rel="noopener noreferrer">
          {word("issuerNotice")}
          <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
        </a>
      </p>
    </section>
  );
}
