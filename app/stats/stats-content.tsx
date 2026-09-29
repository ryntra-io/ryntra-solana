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
import type { StatsModel } from "@/lib/attribution/stats-model";
import { isPublicLocale, type PublicLocale } from "@/lib/site/locale";

import { STATS_COPY, type StatsCopy } from "./copy";

const EXPLORER_ACCOUNT = "https://solscan.io/account/";

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
function usd(value: number, _locale: PublicLocale): string {
  void _locale;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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
  const number = trimmed ? `${whole}.${trimmed}` : whole;
  return symbol ? `${number} ${symbol}` : number;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
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

function feeLines(summary: OperationSummary, key: "gross" | "ryntra"): readonly string[] {
  return summary.fees.map((fee) => amountText(fee[key], fee.symbol)).filter((text) => text !== "—");
}

/* ---------------------------------------------------------------- pieces */

function Figure({ label, value, note, kind = "number" }: { label: string; value: string | readonly string[]; note?: string | null; kind?: "number" | "text" | "list" }) {
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
  const summary = useMemo(() => summarizeOperations(rows, { product, range, now }), [rows, product, range, now]);
  const day = useMemo(() => summarizeOperations(rows, { product, range: "24h", now }), [rows, product, now]);
  const whole = useMemo(() => summarizeOperations(rows, { range: "all", now }), [rows, now]);

  const meta: string[] = [copy.meta.network];
  if (ledger.state === "ok" && whole.since) meta.push(`${copy.meta.since} ${dateText(whole.since, locale)}`);
  meta.push(`${copy.meta.updated} ${dateText(model.generatedAt, locale, true)}`);
  if (chain.state === "ok") meta.push(`${copy.meta.chain} ${dateText(chain.updatedAt, locale, true)}`);

  const products: readonly (OperationProduct | "ALL")[] = ["ALL", ...OPERATION_PRODUCTS];
  const gross = feeLines(summary, "gross");
  const retained = feeLines(summary, "ryntra");

  return (
    <main id="main" className="rx-stats" tabIndex={-1} lang={locale}>
      <PageHero eyebrow={copy.eyebrow} heading={copy.title} lead={copy.lead} meta={meta} />

      <Section
        index="01"
        kicker={copy.overview.kicker}
        heading={copy.overview.heading}
        meta={ledger.state === "ok" && summary.operations > 0 ? <StatePill label={copy.overview.verified(summary.verification.VERIFIED, summary.operations)} tone={summary.verification.VERIFIED === summary.operations ? "verified" : "evidence"} /> : null}
        headExtra={
          ledger.state === "ok" ? (
            <div className="rx-stats-filters">
              <Chips label={copy.feed.columns.product} options={products} value={product} words={copy.products} onChange={setProduct} />
              <Chips label={copy.feed.columns.time} options={OPERATION_RANGES} value={range} words={copy.ranges} onChange={setRange} />
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
            <dl className="rx-stats-grid">
              <Figure label={copy.overview.volume} value={usd(summary.volumeUsd, locale)} note={range === "all" ? copy.overview.volume24h(usd(day.volumeUsd, locale)) : null} />
              <Figure label={copy.overview.operations} value={count(summary.operations, locale)} note={summary.unvalued > 0 ? copy.overview.unvalued(summary.unvalued) : null} />
              <Figure label={copy.overview.wallets} value={count(summary.wallets, locale)} />
              <Figure label={copy.overview.fees} value={gross.length ? gross : copy.overview.noFees} note={retained.length ? `${copy.overview.retained}: ${retained.join(" · ")}` : null} kind={gross.length ? "list" : "text"} />
            </dl>
            <p className="rx-stats-note">
              {copy.overview.basis}
              {summary.own.operations > 0 ? ` ${copy.overview.own(summary.own.operations, summary.own.wallets)}` : ""}
            </p>
          </>
        )}
      </Section>

      <Section index="02" kicker={copy.feed.kicker} heading={copy.feed.heading} lead={copy.feed.lead}>
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

      <Section index="03" kicker={copy.method.kicker}>
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
              <div>
                <dt>{copy.method.referral}</dt>
                <dd>
                  <a href={`${EXPLORER_ACCOUNT}${chain.referralAccount}`} target="_blank" rel="noopener noreferrer">
                    <code>{chain.referralAccount}</code>
                  </a>
                </dd>
              </div>
              <div>
                <dt>{copy.method.accounts}</dt>
                <dd>
                  {chain.tokenAccounts.map((account) => (
                    <a key={account.address} href={`${EXPLORER_ACCOUNT}${account.address}`} target="_blank" rel="noopener noreferrer">
                      <code>{shortAddress(account.address)}</code> {account.symbol}
                    </a>
                  ))}
                </dd>
              </div>
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

/** Two rows that belong together — the row and its opened detail — without a wrapper element a table would refuse. */
function RowGroup({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
