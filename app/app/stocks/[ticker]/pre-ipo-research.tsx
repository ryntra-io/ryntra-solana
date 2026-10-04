/**
 * The research blocks a pre-IPO row carries beside the market facts: the
 * issuer's own terms in plain words, the company's 24/7 index named for what
 * Pyth says it is, and the structure risks a PreStocks token carries — every
 * statement derived from the row's facts, the chain's or the issuer's
 * published terms, or a dated report with its source, each with the date it
 * was read. Nothing here is a verdict, a rating or advice; it is what the
 * issuer, the chain and the press say, and what they do not.
 */

import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatPercent, formatUsdCompact, formatUsdPrice } from "@/app/solana/workspace/spot/spot-format";
import type { StockAsset } from "@/lib/stocks/asset.server";
import { companyNoticeFor, RESERVE_REPORTS_NOTE } from "@/lib/stocks/company-notices";
import type { StockRow } from "@/lib/stocks/universe.server";

import { clockOf } from "../stock-model";
import styles from "../stocks.module.css";

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

/* ----------------------------------------------------------- the words */

/**
 * PreStocks' own terms, read on 2026-09-25 from its FAQ and the notice every
 * page of its site carries. Plain words for the person; the issuer's terms
 * prevail over any of them.
 */
export const PRESTOCKS_TERMS_READ_ON = "2026-09-25";
export const PRESTOCKS_TERMS_SOURCES: readonly Readonly<{ label: string; url: string }>[] = [{ label: "PreStocks FAQ", url: "https://www.prestocks.com/faq" }];

function preStocksTerms(feePct: string | null): readonly Readonly<{ title: Bi; body: Bi }>[] {
  return [
    {
      title: bi("What the token is", "Що це за токен"),
      body: bi(
        "A token that tracks the price of one private company. The issuer says its price is the company's gross price per share, and that every token is backed 1:1 by holding entities (SPVs) invested in the company's shares; it does not name them.",
        "Токен, що відстежує ціну однієї приватної компанії. Емітент зазначає: його ціна — ціна акції компанії брутто, а кожен токен забезпечений 1:1 холдинговими структурами (SPV), вкладеними в її акції; їхніх назв емітент не розкриває.",
      ),
    },
    {
      title: bi("What it is not", "Чим це не є"),
      body: bi(
        "Not a share. No ownership, voting, dividend, information or other legal rights in the company, which neither issued nor endorsed the token.",
        "Не акція. Без права власності, голосу, дивідендів, інформації чи інших прав у компанії, яка токен не випускала й не схвалювала.",
      ),
    },
    {
      title: bi("Fees", "Комісії"),
      body: feePct
        ? bi(
            `The mint withholds ${feePct} of every transfer — a purchase, a sale, a move between your own wallets. Apps and pools charge their own trading fees on top; there is no yearly management fee.`,
            `Mint утримує ${feePct} з кожного переказу — купівлі, продажу, переказу між власними гаманцями. Застосунки й пули беруть ще й свої комісії за торгівлю; щорічної комісії за управління немає.`,
          )
        : bi(
            "The issuer may charge a fee on transfers; apps and pools charge their own trading fees; there is no yearly management fee.",
            "Емітент може брати комісію з переказів; застосунки й пули беруть свої комісії за торгівлю; щорічної комісії за управління немає.",
          ),
    },
    {
      title: bi("If the company goes public", "Якщо компанія вийде на біржу"),
      body: bi(
        "The token converts on chain into the tokenized public stock, for up to nine months after the IPO; after that deadline it expires worthless. In an acquisition it turns into USDC or the new company's token, with up to six months to convert.",
        "Токен обмінюється в ланцюзі на токенізовану публічну акцію — до дев'яти місяців після IPO; після цього строку він згорає. У разі поглинання — USDC або токен нової компанії, до шести місяців на обмін.",
      ),
    },
    {
      title: bi("Selling", "Продаж"),
      body: bi(
        "You can sell on chain at any time, even if the company never goes public — but the price and whether a sale goes through depend on the pool; the issuer promises no liquidity.",
        "Продати можна в ланцюзі будь-коли, навіть якщо компанія так і не вийде на біржу, — але ціна й те, чи пройде продаж, залежать від пулу; ліквідності емітент не обіцяє.",
      ),
    },
    {
      title: bi("Who may hold it", "Хто може тримати"),
      body: bi(
        "In the issuer's words, not available in the U.S., to U.S. persons, or to other ineligible persons. Buying and selling on chain needs no KYC.",
        "За словами емітента — недоступно в США, особам США та іншим недопустимим особам. Купівля й продаж у ланцюзі не потребують KYC.",
      ),
    },
  ];
}

const WORDS = {
  aboutTitle: bi("About this token — the issuer's own terms", "Про цей токен — умови самого емітента"),
  aboutSub: bi("plain words from the issuer's documentation · not advice · the terms prevail", "простими словами з документації емітента · не порада · умови мають перевагу"),
  readOn: bi("read", "прочитано"),
  sources: bi("Sources", "Джерела"),
  source: bi("Source", "Джерело"),
  risksTitle: bi("Structure risks", "Ризики структури"),
  risksSub: bi("what the instrument carries by design — stated from the row's facts, the chain and dated reports, not a rating", "що інструмент несе за своєю будовою — з фактів рядка, ланцюга й датованих повідомлень, не рейтинг"),
  companyIndex: bi("Company index", "Індекс компанії"),
  companyIndexNone: bi("no 24/7 index on Pyth for this company", "24/7-індексу Pyth для цієї компанії немає"),
  companyIndexUnavailable: bi("unavailable right now", "зараз недоступний"),
  companyIndexStale: bi("stale", "застарілий"),
  companyIndexDefinition: bi(
    "Pyth · an informational, indicative company-level indicator from limited secondary-market data — in Pyth's own words not a stock price, not a valuation and not a price anything can be bought at · not the token's price · no deviation drawn",
    "Pyth · інформаційний, орієнтовний індикатор рівня компанії з обмежених даних вторинного ринку — за словами самого Pyth не ціна акції, не оцінка й не ціна, за якою щось можна купити · не ціна токена · відхилення не рахується",
  ),
  riskCompany: bi("The company's statement", "Заява компанії"),
  riskPrivate: bi("Private company", "Приватна компанія"),
  riskControl: bi("The issuer's control", "Контроль емітента"),
  riskLiquidity: bi("Secondary-market liquidity", "Ліквідність вторинного ринку"),
  riskFee: bi("Transfer fee", "Комісія переказу"),
  riskEvent: bi("A company event", "Подія компанії"),
  riskReference: bi("Reference uncertainty", "Невизначеність референсу"),
  riskReserves: bi("Reserve reports", "Звіти про резерви"),
} as const;

/* ---------------------------------------------------------- the pieces */

const w = (locale: WorkspaceLocale, key: keyof typeof WORDS): string => WORDS[key][locale === "uk" ? "uk" : "en"];

/** «13.05.2026» in Ukrainian, «13 May 2026» in English — a date the way a person reads it. */
function dayOf(iso: string, locale: WorkspaceLocale): string {
  const at = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return locale === "uk" ? at.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The company index as one fact of the Market card: the value with its state and time, or why there is none. */
export function CompanyIndexFact({ row, locale }: { row: StockRow; locale: WorkspaceLocale }) {
  const numberLocale = locale === "uk" ? "uk-UA" : "en-US";
  const index = row.companyIndex ?? null;
  if (!index) {
    return (
      <div>
        <dt>{w(locale, "companyIndex")}</dt>
        <dd translate="no">
          <span className={styles.dash}>—</span>
          <span className={styles.factSub}>{w(locale, "companyIndexNone")}</span>
        </dd>
      </div>
    );
  }
  const clock = clockOf(index.observedAt ?? index.fetchedAt, locale);
  return (
    <div>
      <dt>{w(locale, "companyIndex")}</dt>
      <dd translate="no" data-testid="company-index">
        {index.valueUsd === null ? <span className={styles.dash}>—</span> : formatUsdPrice(index.valueUsd, numberLocale)}
        <span className={styles.factSub} data-tone={index.state === "current" ? undefined : "caution"}>
          {`${index.symbol} · `}
          {/* Why the feed did not answer is the server's business (the log, the close-report); the person sees the state. */}
          {index.state === "unavailable" ? `${w(locale, "companyIndexUnavailable")} · 24/7` : `${clock ?? "—"} UTC${index.state === "stale" ? ` · ${w(locale, "companyIndexStale")}` : ""} · 24/7`}
        </span>
        <span className={styles.factSub}>{w(locale, "companyIndexDefinition")}</span>
      </dd>
    </div>
  );
}

/** The issuer's own terms, one press deep, for a PreStocks token. */
export function AboutPreStocksToken({ row, locale }: { row: StockRow; locale: WorkspaceLocale }) {
  const lang = locale === "uk" ? "uk" : "en";
  const feePct = row.transferFee ? `${(row.transferFee.basisPoints / 100).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: 2 })}%` : null;
  const sources = [...PRESTOCKS_TERMS_SOURCES, ...(row.representation.issuerUrl ? [{ label: row.representation.issuerUrl.replace(/^https:\/\/(www\.)?/, ""), url: row.representation.issuerUrl }] : [])];
  return (
    <details className={`${styles.card} ${styles.w12} ${styles.fold}`} data-testid="about-token">
      <summary>
        {w(locale, "aboutTitle")}
        <span className={styles.foldSub}>{w(locale, "aboutSub")}</span>
      </summary>
      <div className={styles.cardBody}>
        <dl className={styles.terms}>
          {preStocksTerms(feePct).map((term) => (
            <div key={term.title.en}>
              <dt>{term.title[lang]}</dt>
              <dd>{term.body[lang]}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.termsFoot}>
          {w(locale, "sources")}:{" "}
          {sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 ? " · " : ""}
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                {source.label}
              </a>
            </span>
          ))}
          {` · ${w(locale, "readOn")} ${dayOf(PRESTOCKS_TERMS_READ_ON, locale)}`}
        </p>
      </div>
    </details>
  );
}

type RiskItem = Readonly<{ key: keyof typeof WORDS; body: string; sources?: readonly Readonly<{ label: string; url: string }>[]; readOn?: string }>;

/**
 * The structure risks of a PreStocks row, each from a fact the row, the chain
 * or a dated report carries: the company's own statement where it made one,
 * the company, the issuer's control of the mint, the pool, the fee, a company
 * event, the mark, the reserve reports. Numbers are the row's own; nothing is
 * scored. The sources of a report are here, one press below the line the
 * page shows.
 */
export function StructureRisks({ asset, locale }: { asset: StockAsset; locale: WorkspaceLocale }) {
  const { row } = asset;
  const uk = locale === "uk";
  const numberLocale = uk ? "uk-UA" : "en-US";
  const rep = row.representation;
  const company = rep.underlying.name ?? rep.name;
  const issuer = rep.issuer.label;
  const onchain = "error" in asset.onchain ? null : asset.onchain;
  const pool = row.market.liquidityUsd !== null && row.market.liquidityUsd >= 1 ? formatUsdCompact(row.market.liquidityUsd, numberLocale) : null;
  const volume = row.market.volume24hUsd !== null && row.market.volume24hUsd >= 1 ? formatUsdCompact(row.market.volume24hUsd, numberLocale) : null;
  const feePct = row.transferFee ? `${(row.transferFee.basisPoints / 100).toLocaleString(numberLocale, { maximumFractionDigits: 2 })}%` : null;
  const mark = row.issuerMark?.perUnit ?? null;
  const markClock = clockOf(row.issuerMark?.fetchedAt ?? null, locale);
  const premium = row.markPremiumPct;
  const index = row.companyIndex ?? null;
  const deadline = row.lifecycle.deadline ? dayOf(row.lifecycle.deadline, locale) : null;
  const notice = companyNoticeFor(rep.companyKey);

  /* What the mint itself lets the issuer do, from the chain's own read — said only where the chain says it. */
  const powers = onchain
    ? [
        onchain.freezeAuthority ? (uk ? "заморозити токен у будь-якому гаманці" : "freeze the token in any wallet") : null,
        onchain.pausable ? (uk ? "зупинити всі перекази" : "pause every transfer") : null,
        onchain.permanentDelegate ? (uk ? "перемістити чи спалити токен з будь-якого гаманця" : "move or burn the token from any wallet") : null,
      ].filter((power): power is string => power !== null)
    : [];

  const items: readonly RiskItem[] = [
    ...(notice ? [{ key: "riskCompany" as const, body: notice.line[uk ? "uk" : "en"], sources: notice.sources, readOn: notice.readOn }] : []),
    {
      key: "riskPrivate",
      body: uk
        ? `${company} — приватна компанія: без публічної ціни акцій, без біржової звітності й без гарантії, що вона взагалі вийде на біржу чи коли саме.`
        : `${company} is private: there is no public share price, no exchange disclosure, and no assurance that it goes public at all or when.`,
    },
    {
      key: "riskControl",
      body:
        powers.length > 0
          ? uk
            ? `Емітент (${issuer}) може ${powers.join(", ")} — це налаштування самого mint у ланцюзі, не обіцянка.`
            : `The issuer (${issuer}) can ${powers.join(", ")} — settings of the mint itself on chain, not a promise.`
          : uk
            ? "Налаштувань mint зараз не вдалося прочитати з ланцюга; перевір їх перед підписом."
            : "The mint's settings could not be read from the chain right now; check them before signing.",
    },
    {
      key: "riskLiquidity",
      body: uk
        ? `Ліквідність — лише вторинний ринок на DEX: пул ${pool ?? "—"}, обіг за 24 год ${volume ?? "—"}. Велике замовлення зсуває ціну; емітент ліквідності не обіцяє.`
        : `Liquidity is the secondary market on DEXs only: the pool holds ${pool ?? "—"}, ${volume ?? "—"} traded in 24 h. A large order moves the price; the issuer promises no liquidity.`,
    },
    {
      key: "riskFee",
      body: feePct
        ? uk
          ? `Mint утримує ${feePct} з кожного переказу — купівлі, продажу, переказу між власними гаманцями; це вже всередині котирування, але не повертається.`
          : `The mint withholds ${feePct} of every transfer — a buy, a sale, a move between your own wallets; it is inside the quote's figures and is not returned.`
        : uk
          ? "Комісії переказу на mint не зчитано; перевір котирування перед підписом."
          : "No transfer fee was read from the mint; check the quote before signing.",
    },
    {
      key: "riskEvent",
      body: deadline
        ? uk
          ? `Емітент оголосив строк обміну — до ${deadline}; після нього токен згорає.`
          : `The issuer has announced a conversion deadline — ${deadline}; after it the token expires worthless.`
        : uk
          ? "Після IPO чи поглинання токен треба обміняти у вікно емітента — до дев'яти й до шести місяців відповідно; після строку він згорає. Зараз строку не оголошено."
          : "After an IPO or an acquisition the token has to be converted within the issuer's window — up to nine and up to six months; after it the token expires worthless. No deadline is announced now.",
    },
    {
      key: "riskReference",
      body: uk
        ? `Оцінка емітента ${mark === null ? "не опублікована" : `${formatUsdPrice(mark, numberLocale)} за токен (${issuer}, ${markClock ?? "—"} UTC)`} — це його власна цифра, не ринкова ціна; ${
            index ? (index.valueUsd === null ? "індекс Pyth зараз недоступний" : `індекс Pyth ${formatUsdPrice(index.valueUsd, numberLocale)} — орієнтовний`) : "24/7-індексу Pyth для компанії немає"
          }; жодна з них не є ціною, за якою можна торгувати. Ринок${premium === null ? "" : ` зараз ${formatPercent(premium, numberLocale)} до оцінки емітента`}.`
        : `The issuer's mark ${mark === null ? "is not published" : `is ${formatUsdPrice(mark, numberLocale)} per token (${issuer}, ${markClock ?? "—"} UTC)`} — its own figure, not a market price; ${
            index ? (index.valueUsd === null ? "Pyth's index is unavailable right now" : `Pyth's index is ${formatUsdPrice(index.valueUsd, numberLocale)} and indicative`) : "Pyth publishes no 24/7 index for the company"
          }; neither is a price anyone can trade at. The market${premium === null ? "" : ` is ${formatPercent(premium, numberLocale)} against the issuer's mark right now`}.`,
    },
    { key: "riskReserves", body: RESERVE_REPORTS_NOTE.line[uk ? "uk" : "en"], sources: [RESERVE_REPORTS_NOTE.source], readOn: "2026-09-25" },
  ];

  return (
    <section className={`${styles.card} ${styles.w12}`} aria-labelledby="structure-risks-title" data-testid="structure-risks">
      <div className={styles.cardHead}>
        <h2 id="structure-risks-title">{w(locale, "risksTitle")}</h2>
        <span className={styles.cardHeadSpacer} />
        <span className={styles.foldSub}>{w(locale, "risksSub")}</span>
      </div>
      <div className={styles.cardBody}>
        <dl className={styles.terms}>
          {items.map((item) => (
            <div key={item.key} data-risk={item.key}>
              <dt>{w(locale, item.key)}</dt>
              <dd>
                {item.body}
                {item.sources && item.sources.length > 0 ? (
                  <span className={styles.termsSource}>
                    {`${w(locale, item.sources.length > 1 ? "sources" : "source")}: `}
                    {item.sources.map((source, index) => (
                      <span key={source.url}>
                        {index > 0 ? " · " : ""}
                        <a href={source.url} target="_blank" rel="noreferrer noopener">
                          {source.label}
                        </a>
                      </span>
                    ))}
                    {item.readOn ? ` · ${w(locale, "readOn")} ${dayOf(item.readOn, locale)}` : ""}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
