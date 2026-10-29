import Link from "next/link";

import { PageTitle } from "@/app/app/page-title";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { claimNoteLine, firstTenLine, flowLines, hundredNoteLine, launchNoteLine, methodLine, netColumnLabel, partLines, sameTokenLine, venueLines } from "./fees-model";
import { feesWords } from "./fees-words";
import styles from "./fees.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: feesWords(locale)("title") };
}

/**
 * «Комісії» (SOL-X1): what $100 costs through Ryntra against the same route without it, what every trade's receipt
 * shows, and the comparison with Pump.fun, GMGN, Axiom and Jupiter, each figure with its source and the day it was
 * read. Ryntra's figures come from the code that charges them; nothing here changes a rate. A page of History.
 */
export default async function FeesPage() {
  const locale = await solanaServerLocale();
  const lang = locale === "uk" ? "uk" : "en";
  const word = feesWords(locale);
  const flows = flowLines(lang);
  const parts = partLines(lang);
  const venues = venueLines(lang);
  const firstTen = firstTenLine(lang);
  const netLabel = netColumnLabel(lang);
  const claimNote = claimNoteLine(lang);
  return (
    <section className={styles.page} aria-labelledby="fees-title">
      <header className={styles.head}>
        <PageTitle id="fees-title" title={word("title")} help={word("help")} lang={locale} />
      </header>

      <section className={styles.block} aria-labelledby="fees-hundred">
        <h2 id="fees-hundred" className={styles.blockTitle}>{word("hundred")}</h2>
        <div className={styles.tableWrap} role="region" aria-labelledby="fees-hundred" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{word("colWhat")}</th>
                <th scope="col" data-numeric>{word("colRate")}</th>
                <th scope="col" data-numeric>{word("colBuy")}</th>
                <th scope="col" data-numeric>{word("colSell")}</th>
                <th scope="col" data-numeric>{word("colRound")}</th>
                <th scope="col" data-numeric>{word("colBack")}</th>
                <th scope="col" data-numeric>{netLabel}</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((row) => (
                <tr key={row.key} data-flow={row.key}>
                  <th scope="row">{row.what}</th>
                  <td data-numeric data-label={word("colRate")} translate="no">{row.rate}</td>
                  <td data-numeric data-label={word("colBuy")} translate="no">{row.buy}</td>
                  <td data-numeric data-label={word("colSell")} translate="no">{row.sell}</td>
                  <td data-numeric data-label={word("colRound")} translate="no">{row.round}</td>
                  <td data-numeric data-tone="good" data-label={word("colBack")} translate="no">{row.back}</td>
                  <td data-numeric data-label={netLabel} translate="no">{row.net}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{hundredNoteLine(lang)}</p>
        <p className={styles.note}>{launchNoteLine(lang)}</p>
        <p className={styles.note}>{sameTokenLine(lang)}</p>
        <p className={styles.note}>{word("orderNote")}</p>
        {claimNote ? <p className={styles.note}>{claimNote}</p> : null}
        {firstTen ? <p className={styles.note}>{firstTen}</p> : null}
      </section>

      <section className={styles.block} aria-labelledby="fees-parts">
        <div className={styles.blockHead}>
          <h2 id="fees-parts" className={styles.blockTitle}>{word("parts")}</h2>
          <Link className={styles.link} href="/app/receipts" prefetch={false}>{word("receipts")}</Link>
        </div>
        <dl className={styles.parts}>
          {parts.map((part) => (
            <div key={part.key} data-part={part.key}>
              <dt>{part.label}</dt>
              <dd>{part.value}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.note}>{methodLine(lang)}</p>
      </section>

      <section className={styles.block} aria-labelledby="fees-compare">
        <h2 id="fees-compare" className={styles.blockTitle}>{word("compare")}</h2>
        <div className={styles.tableWrap} role="region" aria-labelledby="fees-compare" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{word("colWhere")}</th>
                <th scope="col" data-numeric>{word("colInterface")}</th>
                <th scope="col" data-numeric>{word("colBuy")}</th>
                <th scope="col" data-numeric>{word("colRound")}</th>
                <th scope="col" data-numeric>{word("colAfter")}</th>
                <th scope="col">{word("colSource")}</th>
              </tr>
            </thead>
            <tbody>
              {venues.map((venue) => (
                <tr key={venue.key} data-venue={venue.key}>
                  <th scope="row">
                    <span className={styles.venue}>{venue.name}</span>
                    <span className={styles.venueNote}>{venue.note}</span>
                  </th>
                  <td data-numeric data-label={word("colInterface")} translate="no">{venue.interfaceFee}</td>
                  <td data-numeric data-label={word("colBuy")} translate="no">{venue.buy}</td>
                  <td data-numeric data-label={word("colRound")} translate="no">{venue.round}</td>
                  <td data-numeric data-label={word("colAfter")} translate="no">{venue.after}</td>
                  <td data-label={word("colSource")}>
                    <ul className={styles.sources}>
                      {venue.sources.map((source) => (
                        <li key={source.label}>
                          {source.url ? (
                            <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a>
                          ) : (
                            <span translate="no">{source.label}</span>
                          )}
                          <span className={styles.sourceMeta}>{[source.kind, source.via, source.readAt].filter(Boolean).join(" · ")}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{word("compareNote")}</p>
      </section>
    </section>
  );
}
