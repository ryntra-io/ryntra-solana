import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatPercent, formatUsdCompact, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import type { StockAsset } from "@/lib/stocks/asset.server";
import { LIFECYCLE_WORDS, RIGHTS_WORDS } from "@/lib/stocks/instrument";

import { clockOf, ISSUER_FULL, periodTone, periodWord, referenceWord, wordsFor } from "../stock-model";
import styles from "../stocks.module.css";
import { CompanyIndexFact } from "./pre-ipo-research";

/**
 * The asset page's cards of facts — the market, what the person buys, and
 * the chain's own facts one press deep (canon v4.0 §7.3, the clarity pass
 * of 2026-09-16) — shared by the two depths: «Профі» lays them out beside
 * the chart and the deal, and «Простий» keeps every one of them under the
 * company page's «Деталі» (canon v5.1 §2; `RYN-INVEST-SIMPLE-001`, session 2),
 * so the facts a person verifies are written once and read the same way in
 * both. Technical facts sit under the figure they qualify, in one line.
 */

type Facts = ReturnType<typeof factsOf>;

function factsOf(asset: StockAsset, locale: WorkspaceLocale) {
  const { row } = asset;
  const rep = row.representation;
  const multiplier = asset.chainMultiplier ?? row.multiplier;
  const lifecycle = row.lifecycle;
  const fee = row.transferFee;
  return {
    word: wordsFor(locale),
    numberLocale: locale === "uk" ? "uk-UA" : "en-US",
    uk: locale === "uk",
    lang: (locale === "uk" ? "uk" : "en") as "uk" | "en",
    row,
    rep,
    onchain: "error" in asset.onchain ? null : asset.onchain,
    multiplier,
    multiplierState: asset.chainMultiplierState ?? row.multiplierState,
    preIpo: rep.instrument.class === "pre-ipo",
    lifecycle,
    lifecycleClock: clockOf(lifecycle.observedAt, locale),
    deadline: lifecycle.deadline ? `${lifecycle.deadline.slice(0, 10)} ${clockOf(lifecycle.deadline, locale) ?? ""} UTC`.trim() : null,
    fee,
    feePct: fee ? `${(fee.basisPoints / 100).toFixed(2)}%` : null,
    mark: row.issuerMark,
    markClock: clockOf(row.issuerMark?.fetchedAt ?? null, locale),
    markTone: toneOf(row.markPremiumPct),
    deviationTone: toneOf(row.deviationPct),
    sessionTone: periodTone(row.session.period),
    referenceClock: clockOf(row.reference.observedAt ?? row.reference.fetchedAt, locale),
    nextChange: clockOf(row.session.nextChangeAt, locale),
    activation: clockOf(multiplier?.effectiveAt ?? null, locale),
    scaled: multiplier ? Math.abs(multiplier.current - 1) > 1e-9 : false,
    rights: RIGHTS_WORDS[rep.instrument.rights],
  };
}

/** Market: the venue's figures, the issuer's reference or mark, the session, the fee the mint withholds. */
export function MarketCard({ asset, locale, className }: { asset: StockAsset; locale: WorkspaceLocale; className?: string }) {
  const facts = factsOf(asset, locale);
  const { word, numberLocale, uk, row, preIpo, mark, markClock, fee, feePct, markTone, deviationTone, sessionTone, referenceClock, nextChange } = facts;
  return (
    <section className={`${styles.card} ${className ?? styles.w6}`} aria-labelledby="market-title">
      <div className={styles.cardHead}>
        <h2 id="market-title">{word("market")}</h2>
      </div>
      <div className={styles.cardBody}>
        <dl className={styles.facts}>
          {preIpo ? (
            <>
              <div>
                <dt>{word("issuerMark")}</dt>
                <dd translate="no">
                  {mark?.perUnit == null ? "—" : `${formatUsdPrice(mark.perUnit, numberLocale)} ${word("perToken")}`}
                  <span className={styles.factSub} data-tone={mark?.stale ? "caution" : undefined}>
                    {mark ? `${mark.source.label} · ${word("markFetched")} ${markClock ?? "—"} UTC${mark.stale ? ` · ${referenceWord("stale", locale).toLowerCase()}` : ""}` : uk ? "емітент не відповів" : "the issuer did not answer"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{word("issuerValuation")}</dt>
                <dd translate="no">
                  {mark?.valuationUsd == null ? "—" : formatUsdCompact(mark.valuationUsd, numberLocale)}
                  <span className={styles.factSub}>
                    {mark?.impliedValuationUsd != null ? `${word("impliedValuation").toLowerCase()} ${formatUsdCompact(mark.impliedValuationUsd, numberLocale)}` : mark?.holders != null ? `${mark.holders.toLocaleString(numberLocale)} ${uk ? "власників за даними емітента" : "holders as the issuer counts them"}` : uk ? "цифра емітента, не капіталізація токена" : "the issuer's figure, not the token's market cap"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{word("tokenPrice")}</dt>
                <dd translate="no">
                  {formatUsdPrice(row.market.priceUsd, numberLocale)}
                  <span className={styles.factSub}>{formatPercent(row.market.change24hPct, numberLocale)} · 24h · Jupiter · {word("perToken")}</span>
                </dd>
              </div>
              <div>
                <dt>{word("vsMark")}</dt>
                <dd data-tone={row.markPremiumPct === null ? undefined : markTone} translate="no">
                  {formatPercent(row.markPremiumPct, numberLocale)}
                  <span className={styles.factSub}>{word("vsMarkNote")}</span>
                </dd>
              </div>
              <div>
                <dt>{word("transferFee")}</dt>
                <dd translate="no">
                  {feePct ?? word("noTransferFee")}
                  <span className={styles.factSub}>
                    {fee ? word("transferFeeNote") : ""}
                    {fee?.pending ? ` · ${word("transferFeePending")} ${(fee.pending.basisPoints / 100).toFixed(2)}% ${word("fromEpoch")} ${fee.pending.fromEpoch}` : ""}
                  </span>
                </dd>
              </div>
              {/* The company's 24/7 index: context named for what Pyth says it is, never the token's reference. */}
              <CompanyIndexFact row={row} locale={locale} />
            </>
          ) : (
            <>
              <div>
                <dt>{word("referencePerShare")}</dt>
                <dd translate="no">
                  {row.reference.perShare === null ? "—" : formatUsdPrice(row.reference.perShare, numberLocale)}
                  <span className={styles.factSub} data-tone={row.reference.state === "stale" ? "caution" : undefined}>
                    {row.reference.perShare === null
                      ? row.reference.source.id === "pyth"
                        ? uk
                          ? "референс-фід недоступний"
                          : "the reference feed is unavailable"
                        : row.reference.source.id === "issuer-xstocks"
                          ? /* The issuer publishes one; this read did not bring it — never «publishes none». */
                            uk
                            ? "референс емітента зараз недоступний"
                            : "the issuer's reference is unavailable right now"
                          : uk
                            ? "емітент не публікує референс"
                            : "the issuer publishes no reference"
                      : `${referenceWord(row.reference.state, locale)} · ${row.reference.source.label}${referenceClock ? ` · ${referenceClock} UTC` : ""}`}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{word("session")}</dt>
                <dd data-prose="true">
                  {sessionTone ? (
                    <span className={styles.session} data-tone={sessionTone}>
                      <span className={styles.dot} aria-hidden="true" />
                      {periodWord(row.session.period, locale)}
                    </span>
                  ) : (
                    "—"
                  )}
                  <span className={styles.factSub}>
                    {[row.session.exchange?.name ?? null, nextChange ? `${word("nextChange").toLowerCase()} ${nextChange} UTC` : null].filter(Boolean).join(" · ") || (uk ? "розклад невідомий" : "schedule unknown")}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{word("tokenPrice")}</dt>
                <dd translate="no">
                  {formatUsdPrice(row.market.priceUsd, numberLocale)}
                  <span className={styles.factSub}>
                    {formatPercent(row.market.change24hPct, numberLocale)} · 24h · Jupiter · {word("perShare")}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{word("deviation")}</dt>
                <dd data-tone={row.deviationPct === null ? undefined : deviationTone} translate="no">
                  {formatPercent(row.deviationPct, numberLocale)}
                  <span className={styles.factSub}>{uk ? "ціна токена за акцію проти референсу · орієнтир" : "token price per share against the reference · an orientation"}</span>
                </dd>
              </div>
              {fee ? (
                <div>
                  <dt>{word("transferFee")}</dt>
                  <dd translate="no">
                    {feePct}
                    <span className={styles.factSub}>{word("transferFeeNote")}</span>
                  </dd>
                </div>
              ) : null}
            </>
          )}
          <div>
            <dt>{word("colVolume")}</dt>
            <dd translate="no">{formatUsdCompact(row.market.volume24hUsd, numberLocale)}</dd>
          </div>
          <div>
            <dt>{word("liquidity")}</dt>
            <dd translate="no">
              {row.market.liquidityUsd === null || row.market.liquidityUsd < 1 ? word("noPool") : formatUsdCompact(row.market.liquidityUsd, numberLocale)}
              {asset.pool ? (
                <span className={styles.factSub}>
                  {asset.pool.name}
                  {asset.pool.dex ? ` · ${asset.pool.dex}` : ""}
                  {/* The venue's own liquidity figure for the route, not the pool's TVL — the Liquidity card below states the pool's, and the two are different measures of one pool. */}
                  {` · ${uk ? "за списком Jupiter" : "as Jupiter lists it"}`}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/** What you are buying: the issuer, the company or the underlying, the reserves, the rights, the dividends, a private token's status. */
export function WhatYouBuyCard({ asset, locale, className }: { asset: StockAsset; locale: WorkspaceLocale; className?: string }) {
  const facts: Facts = factsOf(asset, locale);
  const { word, numberLocale, uk, lang, rep, multiplier, scaled, rights, preIpo, lifecycle, lifecycleClock, deadline } = facts;
  return (
    <section className={`${styles.card} ${className ?? styles.w6}`} aria-labelledby="overview-title">
      <div className={styles.cardHead}>
        <h2 id="overview-title">{word("whatYouBuy")}</h2>
      </div>
      <div className={styles.cardBody}>
        <dl className={styles.facts}>
          <div>
            <dt>{word("issuer")}</dt>
            <dd data-prose="true">
              {ISSUER_FULL[rep.issuer.id]}
              <span className={styles.factSub}>{rep.issuerConfirmation === "issuer-catalogue" ? (uk ? "mint підтверджено каталогом емітента" : "mint confirmed by the issuer's catalogue") : uk ? "відомий за тегом каталогу Jupiter" : "known by the venue's catalogue tag"}</span>
            </dd>
          </div>
          <div>
            <dt>{preIpo ? word("company") : word("underlying")}</dt>
            <dd translate="no">
              {preIpo ? (rep.underlying.name ?? rep.name) : rep.underlying.symbol}
              <span className={styles.factSub}>
                {preIpo
                  ? rep.issuerNote ?? (uk ? "приватна компанія · без біржового лістингу" : "a private company · no exchange listing")
                  : [rep.underlying.name ?? null, rep.underlying.isin ? `ISIN ${rep.underlying.isin}` : null, rep.underlying.listingCountry ? (uk ? `лістинг ${rep.underlying.listingCountry}` : `listed ${rep.underlying.listingCountry}`) : null].filter(Boolean).join(" · ") || (uk ? "деталі емітент не публікує" : "no further detail from the issuer")}
              </span>
            </dd>
          </div>
          {asset.reserves ? (
            <div>
              <dt>{word("reserves")}</dt>
              <dd translate="no">
                {Number(asset.reserves.sharesHeld).toLocaleString(numberLocale, { maximumFractionDigits: 2 })} {rep.underlying.symbol}
                <span className={styles.factSub}>
                  {uk ? "в обігу" : "in circulation"} {Number(asset.reserves.circulatingSupply).toLocaleString(numberLocale, { maximumFractionDigits: 2 })}
                  {asset.reserves.custodians.length > 0 ? ` · ${asset.reserves.custodians.join(", ")}` : ""}
                  {clockOf(asset.reserves.observedAt, locale) ? ` · ${clockOf(asset.reserves.observedAt, locale)} UTC` : ""}
                </span>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{word("rights")}</dt>
            <dd data-prose="true">
              {rights.title[lang]}
              <span className={styles.factSub}>{rights.body[lang]}</span>
            </dd>
          </div>
          {/* Dividends, where the issuer reinvests them into the amount: the multiplier is the reinvested dividend, said once and applied once (canon v5.0 §9, B.9; RYN-FIRST-SCREEN-001, S2). */}
          {rep.issuer.id === "xstocks" ? (
            <div>
              <dt>{word("dividends")}</dt>
              <dd data-prose="true">
                {word("dividendsInAmount")}
                <span className={styles.factSub}>
                  {scaled && multiplier
                    ? `${word("dividendsHow")}: 1 ${rep.symbol} = ${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(multiplier.current)} ${rep.underlying.symbol} · ${word("dividendsNotPayout")}`
                    : `${word("dividendsHow")} · ${word("dividendsNotPayout")}`}
                </span>
              </dd>
            </div>
          ) : null}
          {preIpo ? (
            <>
              <div>
                <dt>{word("status")}</dt>
                <dd data-prose="true" data-tone={lifecycle.tradable ? undefined : "caution"}>
                  {LIFECYCLE_WORDS[lifecycle.state][lang]}
                  {deadline ? ` · ${word("lifecycleUntil")} ${deadline}` : ""}
                  <span className={styles.factSub}>
                    {lifecycle.note ? `${lifecycle.note} ` : ""}
                    {rep.issuer.id === "prestocks" ? word("exitTermsPreStocks") : ""}
                    {lifecycleClock ? ` · ${lifecycleClock} UTC` : ""}
                    {lifecycle.recheckBy ? ` · ${word("lifecycleRecheck")} ${lifecycle.recheckBy.slice(0, 10)}` : ""}
                  </span>
                  {lifecycle.url ? (
                    <span className={styles.factSub}>
                      <a href={lifecycle.url} target="_blank" rel="noreferrer noopener">
                        {word("issuerNotice")}
                      </a>
                    </span>
                  ) : null}
                </dd>
              </div>
              {rep.issuerUrl ? (
                <div>
                  <dt>{word("issuerPage")}</dt>
                  <dd translate="no">
                    <a href={rep.issuerUrl} target="_blank" rel="noreferrer noopener">
                      {rep.issuerUrl.replace(/^https:\/\/(www\.)?/, "")}
                    </a>
                    <span className={styles.factSub}>{word("notOwnership")}</span>
                  </dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>
      </div>
    </section>
  );
}

/** The chain's own facts — mint, units, authorities, supply — one press deep. */
export function AssetDetailsFold({ asset, locale }: { asset: StockAsset; locale: WorkspaceLocale }) {
  const facts: Facts = factsOf(asset, locale);
  const { word, numberLocale, uk, rep, onchain, multiplier, multiplierState, preIpo, scaled, activation, fee } = facts;
  return (
    <details className={`${styles.card} ${styles.w12} ${styles.fold}`}>
      <summary>
        {word("assetDetails")}
        <span className={styles.foldSub}>{word("assetDetailsSub")}</span>
      </summary>
      <div className={styles.cardBody}>
        <dl className={styles.facts}>
          <div>
            <dt>{word("mint")}</dt>
            <dd translate="no">
              <a href={`https://solscan.io/token/${rep.mint}`} target="_blank" rel="noreferrer noopener">
                {rep.mint.slice(0, 6)}…{rep.mint.slice(-6)}
              </a>
              <span className={styles.factSub}>{onchain ? `${onchain.programKind === "TOKEN_2022" ? "Token-2022" : "Token"} · ${onchain.decimals} ${uk ? "знаків" : "decimals"}` : uk ? "читання з ланцюга недоступне" : "chain read unavailable"}</span>
            </dd>
          </div>
          <div>
            <dt>{word("units")}</dt>
            <dd translate="no">
              {multiplier ? (preIpo ? `${word("tokensAsShown")}${scaled ? ` · ${word("chainMultiplier")} ×${multiplier.current.toFixed(6)}` : ""}` : `1 ${rep.symbol} = ${multiplier.current.toFixed(6)} ${rep.underlying.symbol}`) : "—"}
              <span className={styles.factSub} data-tone={multiplierState === "activation-window" || asset.multiplierAgreement === "differ" ? "caution" : undefined}>
                {multiplierState === "activation-window"
                  ? uk
                    ? "множник змінюється зараз — дочекайтеся"
                    : "the multiplier is changing now — wait"
                  : multiplierState === "pending" && multiplier?.pending
                    ? uk
                      ? `новий множник ${multiplier.pending.toFixed(6)} з ${activation ?? "—"} UTC`
                      : `a new multiplier ${multiplier.pending.toFixed(6)} from ${activation ?? "—"} UTC`
                    : asset.multiplierAgreement === "agree"
                      ? uk
                        ? "ланцюг і емітент згодні"
                        : "the chain and the issuer agree"
                      : asset.multiplierAgreement === "differ"
                        ? uk
                          ? "ланцюг і емітент розходяться — перевірте перед підписом"
                          : "the chain and the issuer differ — check before you sign"
                        : uk
                          ? "з ланцюга · лише одне джерело"
                          : "from the chain · one source only"}
              </span>
            </dd>
          </div>
          {onchain ? (
            <>
              <div>
                <dt>{word("authorities")}</dt>
                <dd data-prose="true">
                  {uk ? "емісія" : "mint"} {onchain.mintAuthority ? (uk ? "у емітента" : "held") : uk ? "відкликано" : "renounced"} · {uk ? "заморозка" : "freeze"} {onchain.freezeAuthority ? (uk ? "у емітента" : "held") : uk ? "відкликано" : "renounced"}
                  {onchain.extensions.length > 0 ? (
                    <span className={styles.factSub} title={onchain.extensions.join(" · ")}>
                      {onchain.extensions.length} {uk ? "розширень Token-2022" : "Token-2022 extensions"}
                    </span>
                  ) : null}
                </dd>
              </div>
              {onchain.permanentDelegate || onchain.pausable || onchain.defaultAccountFrozen || onchain.transferFeeConfig ? (
                <div>
                  <dt>{word("chainFacts")}</dt>
                  <dd data-prose="true">
                    {[
                      onchain.permanentDelegate ? word("permanentDelegate") : null,
                      onchain.pausable ? `${word("pausable")}${onchain.pausable.paused ? ` · ${word("pausedNow")}` : ""}` : null,
                      onchain.defaultAccountFrozen ? word("defaultFrozen") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                    {onchain.transferFeeConfig ? (
                      <span className={styles.factSub} translate="no">
                        {word("transferFee").toLowerCase()}: {(onchain.transferFeeConfig.older.basisPoints / 100).toFixed(2)}% ({uk ? "епоха" : "epoch"} {onchain.transferFeeConfig.older.epoch}) → {(onchain.transferFeeConfig.newer.basisPoints / 100).toFixed(2)}% ({uk ? "епоха" : "epoch"} {onchain.transferFeeConfig.newer.epoch})
                        {fee?.epoch ? ` · ${uk ? "зараз епоха" : "now epoch"} ${fee.epoch}` : ""}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{word("supply")}</dt>
                <dd translate="no">
                  {(Number(BigInt(onchain.supplyRaw)) / 10 ** onchain.decimals).toLocaleString(numberLocale, { maximumFractionDigits: 2 })} {rep.symbol}
                  <span className={styles.factSub}>
                    {uk ? "слот" : "slot"} {onchain.slot ?? "—"}
                    {clockOf(onchain.observedAt, locale) ? ` · ${clockOf(onchain.observedAt, locale)} UTC` : ""}
                  </span>
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>
    </details>
  );
}
