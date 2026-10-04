"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { PageHero, Section, StatePill } from "@/app/site/parts";
import type { StateTone } from "@/app/site/truth-view";
import {
  filterOperations,
  OPERATION_PRODUCTS,
  OPERATION_RANGES,
  summarizeOperations,
  type OperationProduct,
  type OperationRange,
  type OperationSummary,
  type OperationVerification,
  type PublicOperation,
} from "@/lib/analytics/operations";
import type { PublicRegistryRow } from "@/lib/attribution/registry";
import type { StatsModel } from "@/lib/attribution/stats-model";
import { isPublicLocale, type PublicLocale } from "@/lib/site/locale";
import { EVM_EXPLORER_TX } from "@/lib/swap/catalog";

import { STATS_COPY, type StatsCopy } from "./copy";

const EXPLORER_ACCOUNT = "https://solscan.io/account/";
const EXPLORER_TX = "https://solscan.io/tx/";

/* ------------------------------------------------------------ formatting */

function intl(locale: PublicLocale): string {
  return locale === "uk" ? "uk-UA" : "en-GB";
}

function dateText(iso: string | null, locale: PublicLocale, withTime = false): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intl(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" } : { timeZone: "UTC" }),
  }).format(date);
}

/** `15 Sep · 21:39` — the day and the minute, UTC, short enough for a row. */
function rowTime(iso: string, locale: PublicLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = new Intl.DateTimeFormat(intl(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date);
  return `${day} · ${time}`;
}

function count(value: number, locale: PublicLocale): string {
  return new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US").format(value);
}

/** A dollar figure reads `$122.01` in both languages — the product's own money notation, one token that never wraps. */
function usd(value: number | null, _locale: PublicLocale): string {
  void _locale;
  /* A figure the page could not read is unknown, never a zero. */
  if (value === null) return "—";
  /* Under ten cents the figure keeps its fourth decimal, so a fee, its share and its cashback still add up on the page; a real amount below that is never printed as a zero. */
  const small = value !== 0 && Math.abs(value) < 0.1;
  if (small && Math.abs(value) < 0.00005) return value > 0 ? "<$0.0001" : "−<$0.0001";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: small ? 4 : 2, maximumFractionDigits: small ? 4 : 2 }).format(value);
}

/** Up to six significant decimals, trailing zeros dropped — a fee reads as `0.0005235 SOL`, not `0.000524`. */
function amountText(text: string | null, symbol: string | null): string {
  if (text === null) return "—";
  const [whole, fraction = ""] = text.split(".");
  let trimmed = fraction;
  if (fraction.length > 6) {
    const lead = fraction.match(/^0*/)?.[0].length ?? 0;
    trimmed = fraction.slice(0, Math.min(fraction.length, Math.max(6, lead + 4)));
  }
  trimmed = trimmed.replace(/0+$/, "");
  const number = trimmed ? `${whole}.${trimmed}` : whole;
  return symbol ? `${number} ${symbol}` : number;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** A transaction on its network's explorer; null where the network has none we link. */
function txUrl(network: string, tx: string): string | null {
  if (network === "solana") return `${EXPLORER_TX}${tx}`;
  /* The core names BNB Chain `bsc`; the swap catalogue names it `bnb`. */
  const evm = (EVM_EXPLORER_TX as Readonly<Record<string, string>>)[network === "bsc" ? "bnb" : network];
  return evm ? `${evm}${tx}` : null;
}


const VERIFICATION_TONE: Readonly<Record<OperationVerification, StateTone>> = {
  VERIFIED: "verified",
  PENDING: "neutral",
  NOT_ATTRIBUTABLE: "evidence",
  NOT_APPLICABLE: "evidence",
};

function actionText(row: PublicOperation, copy: StatsCopy): string {
  if (row.side && row.asset) return `${copy.feed.side[row.side]} ${row.asset}`;
  return row.action;
}

const STABLE = new Set(["USDC", "USDT", "USDG"]);

function feeLines(summary: OperationSummary, key: "gross" | "ryntra"): readonly string[] {
  /* A summary reads a stablecoin in cents; the feed's detail keeps every unit. */
  return summary.fees
    .map((fee) => (STABLE.has(fee.symbol.toUpperCase()) && fee[key] !== null ? `${Number(fee[key]).toFixed(2)} ${fee.symbol}` : amountText(fee[key], fee.symbol)))
    .filter((text) => text !== "—");
}

/* ---------------------------------------------------------------- pieces */

function Figure({ label, value, note, kind = "number" }: { label: string; value: string | readonly string[]; note?: ReactNode; kind?: "number" | "text" | "list" }) {
  return (
    <div className="rx-stats-figure" data-kind={kind}>
      <dt>{label}</dt>
      <dd>
        {Array.isArray(value) ? (
          <span className="rx-stats-value rx-stats-value--list">
            {value.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        ) : (
          <span className="rx-stats-value">{value as string}</span>
        )}
        {note ? <span className="rx-stats-figure-note">{note}</span> : null}
      </dd>
    </div>
  );
}

function Chips<T extends string>({ label, options, value, words, onChange }: { label: string; options: readonly T[]; value: T; words: Record<T, string>; onChange: (next: T) => void }) {
  return (
    <div className="rx-stats-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option} type="button" className="rx-stats-chip" aria-pressed={option === value} onClick={() => onChange(option)}>
          {words[option]}
        </button>
      ))}
    </div>
  );
}

function Detail({ row, copy, locale }: { row: PublicOperation; copy: StatsCopy; locale: PublicLocale }) {
  const words = copy.feed.detail;
  const paid = row.out ? amountText(row.out.amount, row.out.symbol) : words.none;
  const received = row.in ? amountText(row.in.amount, row.in.symbol) : words.none;
  let execution: string = words.none;
  if (row.out?.amount && row.in?.amount && row.out.symbol && row.in.symbol) {
    const paidValue = Number(row.out.amount);
    const receivedValue = Number(row.in.amount);
    if (paidValue > 0 && receivedValue > 0) {
      /* The effective rate quotes the asset in the money — one SOL in USDC —
         whichever side the stablecoin was on; between two non-stablecoins the
         received asset is quoted in the one paid. */
      const stable = (symbol: string) => ["USDC", "USDT", "USDG"].includes(symbol.toUpperCase());
      const paidIsMoney = stable(row.out.symbol) && !stable(row.in.symbol);
      const [baseAmount, baseSymbol, quoteAmount, quoteSymbol] = paidIsMoney
        ? [receivedValue, row.in.symbol, paidValue, row.out.symbol]
        : [paidValue, row.out.symbol, receivedValue, row.in.symbol];
      execution = `1 ${baseSymbol} = ${new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7 }).format(quoteAmount / baseAmount)} ${quoteSymbol}`;
    }
  }
  const fee = row.fee;
  const feeText = fee ? (fee.collected ? `${amountText(fee.gross, fee.symbol)}${fee.basisPoints !== null ? ` · ${(fee.basisPoints / 100).toFixed(2)}%` : ""}` : `${copy.feed.noFee}${fee.note ? ` — ${fee.note}` : ""}`) : copy.feed.noFee;
  return (
    <dl className="rx-stats-detail">
      <div>
        <dt>{words.wallet}</dt>
        <dd>
          <code>{row.wallet}</code>
        </dd>
      </div>
      <div>
        <dt>{words.input}</dt>
        <dd>{paid}</dd>
      </div>
      <div>
        <dt>{words.output}</dt>
        <dd>{received}</dd>
      </div>
      <div>
        <dt>{words.execution}</dt>
        <dd>
          {execution}
          {row.usd !== null && row.usdBasis ? <span className="rx-stats-detail-note"> · {usd(row.usd, locale)} {copy.feed.basis[row.usdBasis]}</span> : null}
        </dd>
      </div>
      <div>
        <dt>{words.provider}</dt>
        <dd>{words.providers[row.provider]}</dd>
      </div>
      <div>
        <dt>{words.fee}</dt>
        <dd>
          {feeText}
          {fee?.collected && fee.ryntra ? <span className="rx-stats-detail-note"> · {words.retained}: {amountText(fee.ryntra, fee.symbol)}</span> : null}
        </dd>
      </div>
      <div>
        <dt>{words.confirmedAt}</dt>
        <dd>{dateText(row.confirmedAt, locale, true)}</dd>
      </div>
      {row.signature ? (
        <div>
          <dt>{words.signature}</dt>
          <dd>
            <code>{row.signature}</code>
          </dd>
        </div>
      ) : null}
      {row.providerRef ? (
        <div>
          <dt>{words.requestId}</dt>
          <dd>
            <code>{row.providerRef}</code>
          </dd>
        </div>
      ) : null}
      <div>
        <dt>{words.plan}</dt>
        <dd>{row.underPlan ? words.planYes : words.planNo}</dd>
      </div>
      <div>
        <dt>{words.verification}</dt>
        <dd>
          <StatePill label={copy.feed.verification[row.verification]} tone={VERIFICATION_TONE[row.verification]} />
          <span className="rx-stats-detail-note"> {copy.feed.verificationLong[row.verification]}</span>
        </dd>
      </div>
      {row.links.length ? (
        <div>
          <dt>{words.proof}</dt>
          <dd className="rx-stats-links">
            {row.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label} ↗
              </a>
            ))}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/* ----------------------------------------------------------------- page */

export function StatsContent({ model, initialLocale }: { model: StatsModel; initialLocale: PublicLocale }) {
  const [locale, setLocale] = useState<PublicLocale>(initialLocale);
  const [product, setProduct] = useState<OperationProduct | "ALL">("ALL");
  const [range, setRange] = useState<OperationRange>("all");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setLocale(initialLocale);
    const update = (event: Event) => {
      const next: unknown = (event as CustomEvent).detail;
      if (isPublicLocale(next)) setLocale(next);
    };
    window.addEventListener("ryntra:public-locale", update);
    return () => window.removeEventListener("ryntra:public-locale", update);
  }, [initialLocale]);

  const copy = STATS_COPY[locale];
  const chain = model.onchain;
  const ledger = model.ledger;
  /* The page is rendered per request; its own moment is the clock every
     filter is measured from, on the server and on the client alike. */
  const now = useMemo(() => new Date(model.generatedAt), [model.generatedAt]);
  const rows = useMemo(() => (ledger.state === "ok" ? ledger.operations : []), [ledger]);
  const visible = useMemo(() => filterOperations(rows, { product, range, now }), [rows, product, range, now]);
  /* The totals are the server's, over the whole ledger; the page only picks the filter's. */
  const empty = useMemo(() => summarizeOperations([], { now }), [now]);
  const summary = ledger.state === "ok" ? ledger.summaries[product][range] : empty;
  const day = ledger.state === "ok" ? ledger.summaries[product]["24h"] : empty;
  const whole = ledger.state === "ok" ? ledger.summaries.ALL.all : empty;

  const networks = [...new Set(whole.breakdown.map((line) => line.network).filter((value): value is NonNullable<typeof value> => value !== null))];
  const meta: string[] = [networks.length > 1 ? `${copy.meta.paidOn}: ${networks.map((id) => copy.networks[id]).join(" · ")}` : copy.meta.network];
  if (ledger.state === "ok" && whole.since) meta.push(`${copy.meta.since} ${dateText(whole.since, locale)}`);
  meta.push(`${copy.meta.updated} ${dateText(model.generatedAt, locale, true)}`);
  if (chain.state === "ok") meta.push(`${copy.meta.chain} ${dateText(chain.updatedAt, locale, true)}`);

  const products: readonly (OperationProduct | "ALL")[] = ["ALL", ...OPERATION_PRODUCTS];
  const gross = feeLines(summary, "gross");
  const money = summary.money;
  const rewardsRead = ledger.state === "ok" && ledger.rewards === "ok";
  const registryRows = model.registry.rows;
  /* The sections in the order a reader meets them; a section with nothing to show takes no number. */
  const sections = ["overview", ...(ledger.state === "ok" && summary.breakdown.length > 0 ? ["breakdown"] : []), ...(registryRows.length > 0 ? ["registry"] : []), "feed", "method"];
  const sectionIndex = (name: string) => String(sections.indexOf(name) + 1).padStart(2, "0");

  return (
    <main id="main" className="rx-stats" tabIndex={-1} lang={locale}>
      <PageHero eyebrow={copy.eyebrow} heading={copy.title} lead={copy.lead} meta={meta} />

      <Section
        index="01"
        kicker={copy.overview.kicker}
        heading={copy.overview.heading}
        meta={ledger.state === "ok" && summary.operations > 0 ? <VerifiedPill summary={summary} copy={copy} /> : null}
        headExtra={
          ledger.state === "ok" ? (
            <div className="rx-stats-filters">
              <Chips label={copy.feed.columns.product} options={products} value={product} words={copy.products} onChange={setProduct} />
              <Chips label={copy.period} options={OPERATION_RANGES} value={range} words={copy.ranges} onChange={setRange} />
            </div>
          ) : null
        }
      >
        {ledger.state !== "ok" ? (
          <p className="rx-stats-empty">{copy.overview.unavailable}</p>
        ) : summary.operations === 0 ? (
          <p className="rx-stats-empty">{copy.overview.empty}</p>
        ) : (
          <>
            <dl className="rx-stats-grid rx-stats-grid--six">
              <Figure
                label={copy.overview.volume}
                value={summary.unvalued === summary.operations ? "—" : usd(summary.volumeUsd, locale)}
                note={
                  <>
                    {range === "all" && day.operations > 0 ? (
                      <span>{day.unvalued === day.operations ? copy.overview.day24hUnvalued(day.unvalued) : copy.overview.volume24h(`${usd(day.volumeUsd, locale)}${day.unvalued > 0 ? ` ${copy.breakdown.unvalued(day.unvalued)}` : ""}`)}</span>
                    ) : null}
                    {summary.unvalued > 0 ? <span>{copy.overview.unvalued(summary.unvalued)}</span> : null}
                  </>
                }
              />
              <Figure label={copy.overview.operations} value={count(summary.operations, locale)} />
              <Figure label={copy.overview.wallets} value={count(summary.wallets, locale)} note={copy.overview.walletsNote} />
              <Figure
                label={copy.overview.fees}
                value={gross.length ? (money.feesUsd === 0 && money.feesUnvalued > 0 ? "—" : usd(money.feesUsd, locale)) : copy.overview.noFees}
                kind={gross.length ? "number" : "text"}
                note={
                  gross.length ? (
                    <>
                      <span>{copy.overview.feesNote(gross.join(", "))}</span>
                      {money.feesUnvalued > 0 ? <span>{copy.overview.feesUnvalued(money.feesUnvalued)}</span> : null}
                    </>
                  ) : null
                }
              />
              <Figure
                label={copy.overview.revenue}
                value={rewardsRead && !(money.revenueUsd === 0 && money.revenueExcluded > 0) ? usd(money.revenueUsd, locale) : "—"}
                note={
                  rewardsRead ? (
                    <>
                      <span>{copy.overview.revenueNote}</span>
                      {money.revenueExcluded > 0 ? <span>{copy.overview.revenueExcluded(money.revenueExcluded)}</span> : null}
                    </>
                  ) : (
                    copy.overview.rewardsUnavailable
                  )
                }
              />
              <Figure
                label={copy.overview.cashback}
                value={rewardsRead && !(money.cashbackUsd === 0 && money.rewardsUnvalued > 0) ? usd(money.cashbackUsd, locale) : "—"}
                note={
                  rewardsRead ? (
                    <>
                      <span>{copy.overview.cashbackNote}</span>
                      {money.rewardsUnvalued > 0 ? <span>{copy.overview.rewardsUnvalued(money.rewardsUnvalued)}</span> : null}
                    </>
                  ) : (
                    copy.overview.rewardsUnavailable
                  )
                }
              />
            </dl>
            <p className="rx-stats-note">
              {copy.overview.basis}
              {summary.own.operations > 0 ? ` ${copy.overview.own(summary.own.operations, summary.own.wallets)}` : ""}
            </p>
          </>
        )}
      </Section>

      {ledger.state === "ok" && summary.breakdown.length > 0 ? (
        <Section
          index={sectionIndex("breakdown")}
          kicker={copy.breakdown.kicker}
          heading={copy.breakdown.heading}
          meta={product !== "ALL" || range !== "all" ? <StatePill label={`${copy.products[product]} · ${copy.ranges[range]}`} tone="neutral" /> : null}
        >
          <div className="rx-stats-feed rx-stats-feed--spaced">
            <table className="rx-table rx-stats-table rx-stats-breakdown">
              <thead>
                <tr>
                  <th scope="col">{copy.breakdown.columns.product}</th>
                  <th scope="col">{copy.breakdown.columns.network}</th>
                  <th scope="col" className="rx-stats-num">{copy.breakdown.columns.operations}</th>
                  <th scope="col" className="rx-stats-num">{copy.breakdown.columns.volume}</th>
                  <th scope="col" className="rx-stats-num">{copy.breakdown.columns.fees}</th>
                  <th scope="col" className="rx-stats-num">{copy.breakdown.columns.revenue}</th>
                  <th scope="col" className="rx-stats-num">{copy.breakdown.columns.cashback}</th>
                  <th scope="col" className="rx-stats-num">{copy.breakdown.columns.users}</th>
                </tr>
              </thead>
              <tbody>
                {summary.breakdown.map((line) => (
                  <tr key={`${line.product}|${line.network ?? ""}`}>
                    <th scope="row" data-label={copy.breakdown.columns.product}>{copy.products[line.product]}</th>
                    <td data-label={copy.breakdown.columns.network}>{line.network ? copy.networks[line.network] : copy.breakdown.noNetwork}</td>
                    <td data-label={copy.breakdown.columns.operations} className="rx-stats-num">{count(line.operations, locale)}</td>
                    <td data-label={copy.breakdown.columns.volume} className="rx-stats-num">
                      {line.unvalued === line.operations ? "—" : usd(line.volumeUsd, locale)}
                      {line.unvalued > 0 ? <span className="rx-stats-cellnote">{line.unvalued === line.operations ? copy.breakdown.allUnvalued(line.unvalued) : copy.breakdown.unvalued(line.unvalued)}</span> : null}
                    </td>
                    <td data-label={copy.breakdown.columns.fees} className="rx-stats-num">
                      {line.feesUsd === 0 && line.feesUnvalued > 0 ? "—" : usd(line.feesUsd, locale)}
                      {line.feesUnvalued > 0 ? <span className="rx-stats-cellnote">{line.feesUsd === 0 ? copy.breakdown.allUnvalued(line.feesUnvalued) : copy.breakdown.unvalued(line.feesUnvalued)}</span> : null}
                    </td>
                    <td data-label={copy.breakdown.columns.revenue} className="rx-stats-num">
                      {!rewardsRead || line.revenueExcluded === line.operations ? "—" : usd(line.revenueUsd, locale)}
                      {rewardsRead && line.revenueExcluded > 0 ? (
                        <span className="rx-stats-cellnote">{line.revenueExcluded === line.operations ? copy.breakdown.allExcluded(line.revenueExcluded) : copy.breakdown.revenueExcluded(line.revenueExcluded)}</span>
                      ) : null}
                    </td>
                    <td data-label={copy.breakdown.columns.cashback} className="rx-stats-num">
                      {rewardsRead && !(line.cashbackUsd === 0 && line.cashbackUnvalued > 0) ? usd(line.cashbackUsd, locale) : "—"}
                      {rewardsRead && line.cashbackUnvalued > 0 ? <span className="rx-stats-cellnote">{line.cashbackUsd === 0 ? copy.breakdown.allUnvalued(line.cashbackUnvalued) : copy.breakdown.unvalued(line.cashbackUnvalued)}</span> : null}
                    </td>
                    <td data-label={copy.breakdown.columns.users} className="rx-stats-num">{count(line.wallets, locale)}</td>
                  </tr>
                ))}
              </tbody>
              {summary.breakdown.length > 1 ? (
                <tfoot>
                  <tr className="rx-stats-total">
                    <th scope="row">{copy.breakdown.total}</th>
                    <td aria-hidden="true" />
                    <td className="rx-stats-num">{count(summary.operations, locale)}</td>
                    <td className="rx-stats-num">
                      {summary.unvalued === summary.operations ? "—" : usd(summary.volumeUsd, locale)}
                      {summary.unvalued > 0 ? <span className="rx-stats-cellnote">{summary.unvalued === summary.operations ? copy.breakdown.allUnvalued(summary.unvalued) : copy.breakdown.unvalued(summary.unvalued)}</span> : null}
                    </td>
                    <td className="rx-stats-num">
                      {money.feesUsd === 0 && money.feesUnvalued > 0 ? "—" : usd(money.feesUsd, locale)}
                      {money.feesUnvalued > 0 ? <span className="rx-stats-cellnote">{copy.breakdown.unvalued(money.feesUnvalued)}</span> : null}
                    </td>
                    <td className="rx-stats-num">
                      {rewardsRead && !(money.revenueUsd === 0 && money.revenueExcluded > 0) ? usd(money.revenueUsd, locale) : "—"}
                      {rewardsRead && money.revenueExcluded > 0 ? <span className="rx-stats-cellnote">{copy.breakdown.revenueExcluded(money.revenueExcluded)}</span> : null}
                    </td>
                    <td className="rx-stats-num">
                      {rewardsRead && !(money.cashbackUsd === 0 && money.rewardsUnvalued > 0) ? usd(money.cashbackUsd, locale) : "—"}
                      {rewardsRead && money.rewardsUnvalued > 0 ? <span className="rx-stats-cellnote">{copy.breakdown.unvalued(money.rewardsUnvalued)}</span> : null}
                    </td>
                    <td className="rx-stats-num">{count(summary.wallets, locale)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <p className="rx-stats-note">{copy.breakdown.note}</p>
        </Section>
      ) : null}

      {registryRows.length > 0 ? (
        <Section index={sectionIndex("registry")} kicker={copy.registry.kicker} heading={copy.registry.heading} lead={copy.registry.lead}>
          <div className="rx-stats-feed">
            <table className="rx-table rx-stats-table rx-stats-registry">
              <thead>
                <tr>
                  <th scope="col">{copy.registry.columns.network}</th>
                  <th scope="col">{copy.registry.columns.products}</th>
                  <th scope="col">{copy.registry.columns.role}</th>
                  <th scope="col">{copy.registry.columns.address}</th>
                  <th scope="col">{copy.registry.columns.start}</th>
                  <th scope="col">{copy.registry.columns.example}</th>
                </tr>
              </thead>
              <tbody>
                {registryRows.map((row) => (
                  <RegistryRow key={row.id} row={row} observed={row.observed} copy={copy} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="rx-stats-note">
            <a className="rx-stats-inline" href="/api/stats/registry">
              {copy.registry.json}
            </a>
            {" · "}
            {copy.registry.bridgeNote}
          </p>
        </Section>
      ) : null}

      <Section index={sectionIndex("feed")} kicker={copy.feed.kicker} heading={copy.feed.heading} lead={copy.feed.lead}>
        {ledger.state !== "ok" ? (
          <p className="rx-stats-empty">{copy.overview.unavailable}</p>
        ) : visible.length === 0 ? (
          <p className="rx-stats-empty">{copy.feed.empty}</p>
        ) : (
          <>
            <div className="rx-stats-feed">
              <table className="rx-table rx-stats-table">
                <thead>
                  <tr>
                    <th scope="col">{copy.feed.columns.time}</th>
                    <th scope="col">{copy.feed.columns.product}</th>
                    <th scope="col">{copy.feed.columns.wallet}</th>
                    <th scope="col">{copy.feed.columns.action}</th>
                    <th scope="col" className="rx-stats-num">
                      {copy.feed.columns.value}
                    </th>
                    <th scope="col" className="rx-stats-num">
                      {copy.feed.columns.fee}
                    </th>
                    <th scope="col">{copy.feed.columns.verification}</th>
                    <th scope="col">{copy.feed.columns.proof}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const expanded = open === row.id;
                    const proof = row.links[0] ?? null;
                    return (
                      <RowGroup key={row.id}>
                        <tr className="rx-stats-row" data-open={expanded ? "true" : undefined} onClick={() => setOpen(expanded ? null : row.id)}>
                          <td data-label={copy.feed.columns.time}>
                            <button type="button" className="rx-stats-rowtoggle" aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setOpen(expanded ? null : row.id); }}>
                              <span className="rx-stats-caret" aria-hidden />
                              {rowTime(row.confirmedAt ?? row.startedAt, locale)}
                            </button>
                          </td>
                          <td data-label={copy.feed.columns.product}>{copy.products[row.product]}</td>
                          <td data-label={copy.feed.columns.wallet}>
                            <span className="rx-stats-wallet">
                              <code>{row.wallet}</code>
                              {row.internal ? <span className="rx-stats-own" title="Ryntra">·</span> : null}
                            </span>
                          </td>
                          <td data-label={copy.feed.columns.action}>{actionText(row, copy)}</td>
                          <td data-label={copy.feed.columns.value} className="rx-stats-num">
                            {row.usd === null ? copy.feed.unvalued : usd(row.usd, locale)}
                          </td>
                          <td data-label={copy.feed.columns.fee} className="rx-stats-num">
                            {row.fee?.collected ? amountText(row.fee.gross, row.fee.symbol) : copy.feed.noFee}
                          </td>
                          <td data-label={copy.feed.columns.verification}>
                            <StatePill label={copy.feed.verification[row.verification]} tone={VERIFICATION_TONE[row.verification]} />
                          </td>
                          <td data-label={copy.feed.columns.proof}>
                            {proof ? (
                              <a href={proof.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                                {proof.label} ↗
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="rx-stats-rowdetail">
                            <td colSpan={8}>
                              <Detail row={row} copy={copy} locale={locale} />
                            </td>
                          </tr>
                        ) : null}
                      </RowGroup>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {ledger.truncated > 0 ? <p className="rx-stats-note">{copy.feed.more(ledger.truncated)}</p> : null}
          </>
        )}
      </Section>


      <Section index={sectionIndex("method")} kicker={copy.method.kicker}>
        <details className="rx-stats-method">
          <summary>{copy.method.summary}</summary>
          {ledger.state === "ok" ? (
            <dl className="rx-stats-grid rx-stats-grid--two rx-stats-two">
              <Figure label={copy.method.confirmed} value={`${count(whole.operations, locale)} · ${usd(whole.volumeUsd, locale)}`} kind="text" />
              <Figure
                label={copy.method.attributable}
                value={chain.state === "ok" ? `${count(chain.operations, locale)} · ${usd(chain.volumeUsd, locale)}` : "—"}
                note={chain.state === "ok" ? (chain.coverage.complete ? copy.method.coverageComplete : copy.method.coveragePartial) : copy.method.chainUnavailable}
                kind="text"
              />
            </dl>
          ) : null}
          <p className="rx-stats-note">{copy.method.gap}</p>
          <ol className="rx-stats-rule">
            {copy.method.rule.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ol>
          {chain.state === "ok" ? (
            <dl className="rx-stats-verify">
              {model.dashboardUrl ? (
                <div>
                  <dt>{copy.method.dashboard}</dt>
                  <dd>
                    <a href={model.dashboardUrl} target="_blank" rel="noopener noreferrer">
                      {model.dashboardUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{copy.method.sources}</dt>
                <dd>
                  <span>{chain.sources.join(" · ")}</span>
                </dd>
              </div>
              <div>
                <dt>{copy.method.ruleVersion}</dt>
                <dd>
                  <span>
                    {chain.ruleVersion} · {dateText(chain.updatedAt, locale, true)}
                  </span>
                </dd>
              </div>
            </dl>
          ) : null}
        </details>
      </Section>
    </main>
  );
}

/**
 * How much of the window the chain can vouch for. A bridge carries no marker on
 * chain by design — it is attributed from the provider's own record — so it is
 * named beside the count, never counted as a check that failed.
 */
function VerifiedPill({ summary, copy }: { summary: OperationSummary; copy: StatsCopy }) {
  const record = summary.verification.NOT_APPLICABLE;
  const checkable = summary.operations - record;
  const verified = summary.verification.VERIFIED;
  const label =
    checkable > 0
      ? `${copy.overview.verified(verified, checkable)}${record > 0 ? ` · ${copy.overview.providerRecord(record)}` : ""}`
      : copy.overview.providerRecord(record);
  return <StatePill label={label} tone={checkable > 0 && verified === checkable ? "verified" : "evidence"} />;
}

/** One public identity: where it is, what it serves, its job, its address, when it started, and a transaction. */
function RegistryRow({ row, observed, copy, locale }: { row: PublicRegistryRow; observed: boolean; copy: StatsCopy; locale: PublicLocale }) {
  const words = copy.registry;
  const networkName = (id: string) => (words.networks as Readonly<Record<string, string | undefined>>)[id] ?? id;
  const network = networkName(row.network);
  const products = row.products.map((product) => words.products[product]).join(" · ");
  const symbol = row.mint ? KNOWN_SYMBOL[row.mint] ?? shortAddress(row.mint) : null;
  const kind = row.kind === "JUPITER_REFERRAL_TOKEN_ACCOUNT" && symbol ? `${words.kinds[row.kind]} · ${symbol}` : words.kinds[row.kind];
  const address = row.address ?? "";
  const addressUrl = row.network === "solana" ? `${EXPLORER_ACCOUNT}${address}` : null;
  const start = row.start;
  const exampleUrl = row.example && start ? txUrl(start.network, row.example) : null;
  return (
    <tr>
      <td data-label={words.columns.network}>{network}</td>
      <td data-label={words.columns.products}>{products || "—"}</td>
      <td data-label={words.columns.role}>
        <span className="rx-stats-stack">
          <span>{words.roles[row.role]}</span>
          <span className="rx-stats-cellnote">{kind}</span>
        </span>
      </td>
      <td data-label={words.columns.address}>
        {addressUrl ? (
          <a href={addressUrl} target="_blank" rel="noopener noreferrer" title={address}>
            <code>{shortAddress(address)}</code>
          </a>
        ) : (
          <code title={address}>{shortAddress(address)}</code>
        )}
      </td>
      <td data-label={words.columns.start}>
        {start ? (
          <span className="rx-stats-stack">
            <span>{words.block(networkName(start.network), count(start.block, locale))}</span>
            {start.time ? <span className="rx-stats-cellnote">{dateText(start.time, locale)}</span> : null}
          </span>
        ) : observed ? (
          words.noTransaction
        ) : (
          "—"
        )}
      </td>
      <td data-label={words.columns.example}>
        {row.example && exampleUrl ? (
          <a href={exampleUrl} target="_blank" rel="noopener noreferrer" title={row.example}>
            <code>{shortAddress(row.example)}</code> ↗
          </a>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

const KNOWN_SYMBOL: Readonly<Record<string, string>> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
};

/** Two rows that belong together — the row and its opened detail — without a wrapper element a table would refuse. */
function RowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
