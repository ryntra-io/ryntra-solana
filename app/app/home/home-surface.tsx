"use client";

import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { companyItem, ShelfRow, TileSkeleton, ShelfTile, isShelfCards, RowSkeleton } from "@/app/app/invest/shelf-ui";
import { FundingActions } from "@/app/app/invest/funding-actions";
import { fundingNeed, fundsOf, solAmount, SUGGESTED_SOL_LAMPORTS, suggestedSolUsd } from "@/app/app/invest/funding-model";
import { investWords, numberLocale, solEnoughLine, type InvestWord } from "@/app/app/invest/invest-words";
import { saveShelfCopy } from "@/app/app/invest/shelf-copy";
import { ShelfSlotProvider, useFailedShelf, useLiveShelf, useShelfSlot } from "@/app/app/invest/shelf-slot";
import styles from "@/app/app/invest/invest.module.css";
import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import { useWalletData } from "@/app/app/wallet-data";
import { holdingValue, usdValueIn, walletValue, type WalletHolding } from "@/app/app/wallet-view-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { formatPercent, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { isWatched, shortEventLine } from "@/lib/stocks/conversion-watch";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { isRetiredMint, RETIRED_WORDS } from "@/lib/stocks/retired";
import { companyFromTokenName, POPULAR_WIDE_COUNT, type ShelfCard } from "@/lib/stocks/shelf";

import { HomeAside } from "./home-aside";
import home from "./home.module.css";
import { PortfolioRisk } from "./portfolio-risk";

/**
 * «Простий»'s Home (canon v5.0 §3; `RYN-INVEST-SIMPLE-001`, session 1).
 *
 * **A guest** reads one promise — «Купи частинку компанії від $1» — one
 * orange action, «Під'єднати гаманець», and the popular companies, each one
 * tap from its page. **A wallet** reads what it holds — «Твої інвестиції» and
 * the positions by the companies' names — with «Купити» the one orange action
 * and «Поповнити» beside it, and «Автоінвест» for every connected wallet: the
 * month's budget as its own line, the rules with their switches and their
 * next purchases, «Додати правило» (session 4; canon v5.3 В29).
 *
 * **Width** (`RYN-WIDTH-PREMIUM-001`): from 1280 px up a main column and a
 * right one (`HomeAside`) — notifications, «Автоінвест», «Спитати Ryntra»,
 * what moves today — so no half of a wide screen stands empty; on a phone
 * the right column's blocks come under the main ones. The head uses its own
 * width too: what the money is in beside the balance, a guest's three steps
 * beside the promise.
 *
 * **The first step without crypto** (session 5, canon §4 «Почати з картки»):
 * the orange action is always the step that works next. A wallet with nothing
 * to buy with reads «Поповни — і купи першу частинку» and «Поповнити»; one
 * with dollars and no SOL for the network reads «Потрібно трохи SOL на
 * мережу» and «Поповнити SOL»; a phone whose browser has no wallet is offered
 * this page inside Phantom instead of a wallet panel that has nothing to list.
 *
 * The balance is the one reader Portfolio uses (`wallet-data.tsx`), so the
 * two places can never disagree about a wallet; an unknown price is left out
 * of the total and said so, never counted as zero.
 */

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** Below this a holding is dust: counted in the total, not a row on Home. */
const DUST_MICRO_USD = 10_000n;
/** Rows of what a wallet owns before «Усе в Портфелі». */
const OWNED_SHOWN = 5;
/** How long a remembered wallet is waited for before the guest's Home is drawn. */
const RESTORE_WAIT_MS = 2_000;

export function HomeSurface({ locale, children }: { locale: WorkspaceLocale; children: ReactNode }) {
  const word = investWords(locale);
  const { connection } = useSolanaConnection();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), RESTORE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={home.layout}>
      <div className={home.main}>
        {connection ? <WalletHead locale={locale} /> : <GuestHead locale={locale} settled={settled} />}
        <section className={styles.section} aria-labelledby="popular-title" data-block="popular">
          <div className={styles.sectionHead}>
            <div className={styles.sectionTitles}>
              <h2 id="popular-title" className={styles.sectionTitle}>{word("popularCompanies")}</h2>
              <p className={styles.sectionNote}>{word("byVolume")}</p>
            </div>
            <Link className={styles.sectionLink} href="/app/markets?tab=companies">
              {word("allCompanies")}
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </Link>
          </div>
          {children}
        </section>
      </div>
      <HomeAside locale={locale} />
    </div>
  );
}

/**
 * The guest's head. While a remembered wallet is being reconnected the
 * promise waits under the shape of a balance (the boot script marks such a
 * browser before paint), so a returning person never sees the invitation to
 * connect a wallet that is already on its way.
 */
function GuestHead({ locale, settled }: { locale: WorkspaceLocale; settled: boolean }) {
  const word = investWords(locale);
  /* A phone's browser without a wallet: the one way in is this page inside Phantom. */
  const { openInWallet, reach } = useWalletReach();
  return (
    <>
      <section className={`${styles.hero} ${home.head} ${home.guest}`} data-settled={settled ? "true" : undefined} aria-labelledby="home-title" data-block="head">
        <div className={home.headMain}>
          <h1 id="home-title" className={styles.heroTitle}>{word("guestHeadline")}</h1>
          <p className={styles.heroLine}>{word("guestLine")}</p>
          <div className={styles.actions}>
            <button type="button" className="rw-btn rw-btn--primary" onClick={reach}>
              {openInWallet ? word("openInPhantom") : word("connectWallet")}
            </button>
          </div>
        </div>
        <ol className={home.steps}>
          {(["stepConnect", "stepTopUp", "stepBuy"] as const).map((step, index) => (
            <li key={step} className={home.step}>
              <span className={home.stepNumber} aria-hidden="true">{index + 1}</span>
              {word(step)}
            </li>
          ))}
        </ol>
      </section>
      <div className={`${styles.hero} ${home.pending}`} data-settled={settled ? "true" : undefined} aria-hidden="true" data-block="head">
        <span className={home.pendingLabel} />
        <span className={home.pendingValue} />
        <span className={home.pendingActions} />
      </div>
    </>
  );
}

type OwnedRow = Readonly<{ key: string; name: string; href: string; mint: string; icon: string | null; value: bigint; change: number | null; symbol: string; stock: boolean; /** A token Ryntra no longer supports (canon v5.2 В26): the row says so; its page says where it can be sold. */ retired: boolean }>;

/** A holding's issuer event in a few words — «Обміняй до 12 березня 2027» (the IPO and conversion watch, canon v5.2 В27); the note in «що потребує уваги» and the token's page say the rest. */
function ownedEventOf(mint: string, locale: WorkspaceLocale): string | undefined {
  const event = lifecycleEventFor(mint);
  return isWatched(event) ? shortEventLine(event, locale === "uk" ? "uk" : "en", Date.now()) : undefined;
}

function ownedRowOf(holding: WalletHolding): OwnedRow | null {
  const value = holdingValue(holding);
  if (value === null || value < DUST_MICRO_USD) return null;
  const mint = holding.kind === "NATIVE_SOL" ? WRAPPED_SOL : holding.mint;
  if (!mint) return null;
  const catalog = holding.catalog ?? null;
  const symbol = holding.kind === "NATIVE_SOL" ? "SOL" : (catalog?.symbol ?? holding.symbol ?? "");
  const stock = catalog?.category === "stock";
  const rawName = catalog?.name ?? holding.name ?? symbol;
  /* A company by its name, a coin by the name people know it by. */
  const name = holding.kind === "NATIVE_SOL" || mint === WRAPPED_SOL ? "Solana" : stock ? companyFromTokenName(rawName) : rawName;
  const change = catalog?.dayChangePct;
  return {
    key: mint,
    name,
    href: stock && symbol ? `/app/stocks/${encodeURIComponent(symbol)}` : `/app/spot?mint=${encodeURIComponent(mint)}`,
    mint,
    icon: catalog?.icon ?? null,
    value,
    change: typeof change === "number" && Number.isFinite(change) ? change : null,
    symbol,
    stock,
    retired: isRetiredMint(mint),
  };
}

function WalletHead({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const { holdings, refresh } = useWalletData();

  const owned = useMemo(() => {
    if (holdings.status !== "ready") return [];
    return holdings.data
      .map(ownedRowOf)
      .filter((row): row is OwnedRow => row !== null)
      .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0));
  }, [holdings]);
  const totals = useMemo(() => (holdings.status === "ready" ? walletValue(holdings.data) : null), [holdings]);
  const day = useMemo(() => (holdings.status === "ready" && holdings.complete && totals ? dayChangeOf(holdings.data, totals.total) : null), [holdings, totals]);
  /* What stands between this wallet and a purchase (session 5): dollars first, then the network's SOL. */
  const funds = useMemo(() => (holdings.status === "ready" ? fundsOf(holdings.data, holdings.complete) : null), [holdings]);
  const need = funds ? fundingNeed(funds) : "unknown";
  const firstStep = need === "usdc" && funds !== null && !funds.ownsCompany;

  return (
    <>
      <section className={`${styles.hero} ${home.head}`} aria-labelledby="home-title" data-need={need} data-block="head">
        <div className={home.headMain}>
          <h1 id="home-title" className={styles.balanceLabel}>{word("yourInvestments")}</h1>
          {holdings.status === "ready" && totals ? (
            <>
              <p className={styles.balance}>{usdValueIn(totals.total, locale)}</p>
              {day ? (
                <p className={styles.change} data-tone={toneOf(day.usd)}>
                  {day.usd >= 0 ? "+" : "−"}
                  {usdValueIn(BigInt(Math.round(Math.abs(day.usd) * 1_000_000)), locale)} · {formatPercent(day.pct, numbers)} {word("dayChange")}
                </p>
              ) : null}
              {/* «Ризик портфеля» (canon §11): the server's one word for the wallet, once there is something in it — here on a narrow head, under «Розподіл» on a wide one. */}
              {owned.length > 0 ? <PortfolioRisk locale={locale} place="main" /> : null}
            </>
          ) : holdings.status === "error" ? (
            /* Unknown is not zero: a dash, and the reason with a retry below. */
            <p className={styles.balance} aria-label={word("walletUnread")}>—</p>
          ) : (
            <span className={home.pendingValue} aria-hidden="true" />
          )}
          {firstStep ? <p className={styles.heroLine}>{word("fundFirst")}</p> : null}
          {need === "sol" && funds ? (
            <p className={home.notice} role="status">
              <b>{word("needSol")}</b>
              {solEnoughLine(locale, solAmount(SUGGESTED_SOL_LAMPORTS, numbers), suggestedSolUsd(funds.solUsd))}
            </p>
          ) : null}
          {/* The orange action is the step that works next: dollars, then the network's SOL, then a purchase. */}
          <FundingActions need={need} firstStep={firstStep} locale={locale} />
          {/* Beside the column on a desk the assistant has its own block; the quiet way stays for a phone. */}
          <Link className={`${styles.quiet} ${home.headAsk}`} href="/app/ryn">
            <Sparkle size={16} weight="bold" aria-hidden="true" />
            {word("askRyntra")}
          </Link>
        </div>
        {holdings.status === "ready" && totals && owned.length > 0 ? <Allocation rows={owned} totalMicro={totals.total} locale={locale} /> : null}
      </section>

      {/* «Автоінвест» stands in the right column (`HomeAside`): the rules and their next purchases beside the money (RYN-WIDTH-PREMIUM-001). */}

      {/* An empty wallet's first step is said once, in the head — not again under «У тебе є». */}
      {firstStep && owned.length === 0 ? null : (
        <section className={styles.section} aria-labelledby="owned-title" data-block="owned">
          <div className={styles.sectionHead}>
            <h2 id="owned-title" className={styles.sectionTitle}>{word("youOwn")}</h2>
            {owned.length > 0 ? (
              <Link className={styles.sectionLink} href="/app/portfolio">
                {word("allInPortfolio")}
                <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
          {holdings.status === "error" ? (
            <div className={styles.status} role="status">
              <p>{word("walletUnread")}</p>
              <button type="button" className="rw-btn" onClick={refresh}>{word("tryAgain")}</button>
            </div>
          ) : holdings.status !== "ready" ? (
            <RowSkeleton count={3} />
          ) : owned.length === 0 ? (
            <p className={styles.empty}>{word("emptyWallet")}</p>
          ) : (
            <div className={`${styles.rows} ${styles.rowsPair}`}>
              {owned.slice(0, OWNED_SHOWN).map((row) => (
                <OwnedLine key={row.key} row={row} locale={locale} numbers={numbers} word={word} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** How many holdings the head names by share before the rest is «Інше». */
const ALLOCATION_SHOWN = 4;

/**
 * What the money is in, beside the balance: one bar and the largest holdings
 * by their share of the wallet — Portfolio's own allocation, in the head's
 * words. The rest, dust included, is «Інше»; an unpriced holding is not in
 * the total and so not in the bar.
 */
function Allocation({ rows, totalMicro, locale }: { rows: readonly OwnedRow[]; totalMicro: bigint; locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  if (totalMicro <= 0n) return null;
  const head = rows.slice(0, ALLOCATION_SHOWN);
  const rest = totalMicro - head.reduce((sum, row) => sum + row.value, 0n);
  const slices = [
    ...head.map((row, index) => ({ key: row.key, label: row.name, value: row.value, index })),
    ...(rest > 0n ? [{ key: "other", label: word("other"), value: rest, index: ALLOCATION_SHOWN }] : []),
  ];
  const share = new Intl.NumberFormat(numbers, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <div className={home.allocation}>
      <p className={home.sideLabel}>{word("allocation")}</p>
      <div className={home.bar} role="img" aria-label={word("allocation")}>
        {slices.map((slice) => (
          <span key={slice.key} className={home.slice} data-slice={slice.index} style={{ flexGrow: Number(slice.value) }} />
        ))}
      </div>
      <ul className={home.legend}>
        {slices.map((slice) => (
          <li key={slice.key} className={home.legendRow}>
            <span className={home.dot} data-slice={slice.index} aria-hidden="true" />
            <span className={home.legendName}>{slice.label}</span>
            <span className={home.legendShare}>{share.format((Number(slice.value) / Number(totalMicro)) * 100)}%</span>
          </li>
        ))}
      </ul>
      <PortfolioRisk locale={locale} place="side" />
    </div>
  );
}

function OwnedLine({ row, locale, numbers, word }: { row: OwnedRow; locale: WorkspaceLocale; numbers: string; word: (key: InvestWord) => string }) {
  return (
    <ShelfRow
      item={{ key: row.key, name: row.name, href: row.href, mint: row.mint, icon: row.icon, price: 0, change24h: null, plainIcon: !row.stock, sub: row.retired ? RETIRED_WORDS.state[locale === "uk" ? "uk" : "en"] : ownedEventOf(row.mint, locale) }}
      locale={numbers}
      figures={
        <>
          <span className={styles.price}>{usdValueIn(row.value, locale)}</span>
          {row.change === null ? null : (
            <span className={styles.change} data-tone={toneOf(row.change)} aria-label={`${formatPercent(row.change, numbers)} ${word("dayChange")}`}>
              {formatPercent(row.change, numbers)}
            </span>
          )}
        </>
      }
    />
  );
}

/**
 * The day's change of what the wallet holds — Portfolio's own rule: value
 * today less value yesterday, `v − v / (1 + Δ)`, over the assets whose price
 * and day are both known, and shown only when those cover most of the value.
 */
function dayChangeOf(holdings: readonly WalletHolding[], totalMicro: bigint): { usd: number; pct: number } | null {
  let covered = 0;
  let delta = 0;
  for (const holding of holdings) {
    const value = holdingValue(holding);
    const change = holding.catalog?.dayChangePct;
    if (value === null || typeof change !== "number" || !Number.isFinite(change)) continue;
    const usd = Number(value) / 1_000_000;
    const ratio = 1 + change / 100;
    if (ratio <= 0) continue;
    covered += usd;
    delta += usd - usd / ratio;
  }
  const total = Number(totalMicro) / 1_000_000;
  if (total <= 0 || covered / total < 0.9) return null;
  const previous = covered - delta;
  return { usd: delta, pct: previous > 0 ? (delta / previous) * 100 : 0 };
}

/* ------------------------------------------------------------ popular */

/**
 * The popular companies' place. The live tiles stream in behind it; until
 * they do, the browser's copy of the last eight it drew stands here, marked
 * as updating, and the skeleton only for a browser that has none.
 */
export function PopularSlot({ locale, children }: { locale: WorkspaceLocale; children: ReactNode }) {
  const word = investWords(locale);
  const { copy, failed, slot } = useShelfSlot("popular", isShelfCards);
  const shown = copy !== null && copy.length > 0;
  return (
    <ShelfSlotProvider slot={slot}>
      <div className={styles.slot} data-copy={shown ? "true" : undefined}>
        {shown ? (
          <div className={styles.copy}>
            {failed ? null : <span className={styles.updating}>{word("updating")}</span>}
            <PopularTiles cards={copy} locale={locale} />
          </div>
        ) : null}
        {children}
      </div>
    </ShelfSlotProvider>
  );
}

/** The tiles' shape while the list is read — hidden when a copy stands in. */
export function PopularSkeleton() {
  return (
    <div className={styles.fallback}>
      <TileSkeleton count={POPULAR_WIDE_COUNT} className={home.popularTiles} />
    </div>
  );
}

/** The live popular companies; the browser keeps them as the next visit's copy. */
export function PopularCards({ cards, locale }: { cards: readonly ShelfCard[]; locale: WorkspaceLocale }) {
  useLiveShelf();
  useEffect(() => {
    saveShelfCopy("popular", cards);
  }, [cards]);
  return (
    <div className={styles.live}>
      <PopularTiles cards={cards} locale={locale} />
    </div>
  );
}

/** The catalogue did not answer: the copy, if any, stays; otherwise one line and one action. */
export function PopularFailed({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  useFailedShelf();
  return (
    <div className={`${styles.fallback} ${styles.status}`} role="status">
      <p>{word("shelfDown")}</p>
      <button type="button" className="rw-btn" onClick={() => window.location.reload()}>{word("reload")}</button>
    </div>
  );
}

function PopularTiles({ cards, locale }: { cards: readonly ShelfCard[]; locale: WorkspaceLocale }) {
  const numbers = numberLocale(locale);
  return (
    <div className={`${styles.tiles} ${home.popularTiles}`}>
      {cards.slice(0, POPULAR_WIDE_COUNT).map((card) => (
        <ShelfTile key={card.mint} item={companyItem(card)} locale={numbers} />
      ))}
    </div>
  );
}

