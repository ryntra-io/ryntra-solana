"use client";

import { CircleNotch, ImageSquare, Wallet } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { LaunchHolderPositionsResponse } from "@/lib/api/v1/contract";

import { Positions } from "../[mint]/pool-panel";
import { formatDate, formatMove, formatRaw } from "../launch-format";
import { launchWords } from "../launch-words";
import styles from "../launch.module.css";

type Read = { wallet: string; data: LaunchHolderPositionsResponse | null; failed: boolean };

/**
 * «Мої позиції» — every position the wallet entered through Ryntra, the totals
 * first (what went in, what it is worth now — a loss as visible as a gain —
 * the fees and what the collector brought, each currency apart), then each
 * position under its token. Every figure is the chain's, read now; a position
 * not read is said as not read and left out of the totals.
 */
export function PositionsBoard({ locale, network }: { locale: WorkspaceLocale; network: "solana:devnet" | "solana:mainnet" }) {
  const word = launchWords(locale);
  const { connection } = useSolanaConnection();
  const { reach } = useWalletReach();
  const wallet = connection?.address ?? null;
  const [read, setRead] = useState<Read | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    setRead((current) => (current?.wallet === wallet ? { ...current, failed: false } : { wallet, data: null, failed: false }));
    try {
      const response = await fetch(`/api/v1/launch/holders/${wallet}`, { headers: { "X-Ryntra-API": "1" }, cache: "no-store" });
      setRead({ wallet, data: response.ok ? ((await response.json()) as LaunchHolderPositionsResponse) : null, failed: !response.ok });
    } catch {
      setRead({ wallet, data: null, failed: true });
    }
  }, [wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = read?.wallet === wallet ? read?.data : null;
  const reading = Boolean(wallet) && (!read || read.wallet !== wallet || (!read.data && !read.failed));

  return (
    <div className={styles.page}>
      <header className={styles.mineHeadGrid}>
        <div className={styles.headRow}>
          <h1 className={styles.title}>{word("positionsTitle")}</h1>
          {network === "solana:devnet" ? (
            <span className={styles.netChip} title={word("devnetHint")}>
              {word("devnet")}
            </span>
          ) : null}
        </div>
        <p className={styles.lede}>{word("positionsLede")}</p>
      </header>

      {!wallet ? (
        <section className={`${styles.card} ${styles.mineEmpty}`}>
          <Wallet size={28} aria-hidden className={styles.mineEmptyIcon} />
          <h2 className={styles.cardTitle}>{word("positionsConnectTitle")}</h2>
          <button type="button" className="rw-btn rw-btn--primary" onClick={() => reach()}>
            <Wallet size={18} aria-hidden /> {word("mineConnect")}
          </button>
        </section>
      ) : reading ? (
        <section className={`${styles.card} ${styles.mineEmpty}`} aria-busy="true">
          <CircleNotch size={22} aria-hidden className={styles.spin} />
          <p className={styles.hint}>{word("positionsReading")}</p>
        </section>
      ) : !data ? (
        <section className={`${styles.card} ${styles.mineEmpty}`} role="alert">
          <p className={styles.hint}>{word("positionsUnread")}</p>
          <button type="button" className="rw-btn" onClick={() => void load()}>
            {word("mineReadAgain")}
          </button>
        </section>
      ) : data.positions.length === 0 ? (
        <section className={`${styles.card} ${styles.mineEmpty}`}>
          <h2 className={styles.cardTitle}>{word("positionsEmpty")}</h2>
          <p className={styles.hint}>{word("positionsEmptyHow")}</p>
        </section>
      ) : (
        <div className={styles.positionsBoard}>
          <Totals data={data} locale={locale} />
          <ul className={styles.positionTokens}>
            {data.positions.map((position) => (
              <li key={position.position} className={styles.card}>
                <div className={styles.positionToken}>
                  <span className={styles.positionTokenMark} aria-hidden>
                    <ImageSquare size={18} />
                  </span>
                  <span className={styles.positionTokenName}>
                    <strong>{position.name ?? position.token.slice(0, 6)}</strong>
                    {position.symbol ? <span className={styles.tokenSymbol}> ${position.symbol}</span> : null}
                  </span>
                  <Link className={styles.markLink} href={`/app/launch/${position.token}`}>
                    {word("openToken")}
                  </Link>
                </div>
                {position.pair ? (
                  <Positions
                    data={{ network: data.network, pair: position.pair, tokenDecimals: position.tokenDecimals ?? 6, collector: data.collector, open: data.open, positions: [position] }}
                    symbol={position.symbol ?? ""}
                    locale={locale}
                    word={word}
                    onChanged={() => void load()}
                    heading={false}
                  />
                ) : (
                  <p className={styles.unread}>{word("posUnread")}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** What all the positions came to, each currency apart — the card's own figures. */
function Totals({ data, locale }: { data: LaunchHolderPositionsResponse; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const card = data.card;
  return (
    <section className={styles.card} aria-labelledby="positions-totals" data-area="totals">
      <h2 id="positions-totals" className={styles.cardTitle}>
        {word("positionsTotals")}
      </h2>
      {card.amounts.map((amount) => {
        const money = (raw: string) => {
          const text = formatRaw(raw, amount.decimals, locale, 2);
          return amount.dollar ? `$${text}` : `${text} ${amount.symbol}`;
        };
        const entered = BigInt(amount.enteredRaw);
        const change = entered > 0n ? Number(((BigInt(amount.valueRaw) - entered) * 10_000n) / entered) : null;
        return (
          <dl key={amount.pairMint} className={styles.positionFigures}>
            <div>
              <dt>{word("posEntered")}</dt>
              <dd>{money(amount.enteredRaw)}</dd>
            </div>
            <div>
              <dt>{word("posWorth")}</dt>
              <dd>
                {money(amount.valueRaw)}
                {change !== null ? (
                  <span className={styles.positionChange} data-dir={change > 0 ? "up" : change < 0 ? "down" : undefined}>
                    {" "}
                    {formatMove(change, locale)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>{word("posFees")}</dt>
              <dd>{money(amount.feesRaw)}</dd>
            </div>
            <div>
              <dt>{word("posCollected")}</dt>
              <dd>{money(amount.collectedRaw)}</dd>
            </div>
          </dl>
        );
      })}
      <p className={styles.positionWhen}>
        {word("positionsPeriod", { from: formatDate(card.period.from, locale) })}
        {card.unread ? ` · ${word("positionsUnreadSome", { n: card.unread })}` : ""}
      </p>
    </section>
  );
}
