/**
 * What each stock issuer's own documents say of where its tokens are not
 * offered, and of dividends — «Правда про актив» on the token page.
 *
 * Every entry is the issuer's own wording turned into a list, with the
 * document's name, address and date, and the day Ryntra read it. Ryntra
 * blocks no country: this is a fact about the issuer's
 * terms, shown before a purchase so a person can check their own case. Where
 * the issuer's own document was not found, the entry says so and names the
 * document it does rest on. Pure and client-safe.
 */

import type { StockIssuerId } from "./representations.ts";

type Bi = Readonly<{ en: string; uk: string }>;

export type IssuerDocument = Readonly<{ title: string; url: string; /** The date the document carries, or null when it carries none. */ dated: string | null; readOn: string }>;

export type IssuerTerms = Readonly<{
  issuer: StockIssuerId;
  /** Where the issuer says its tokens are not offered, as it names them. */
  excluded: readonly Bi[];
  /** Where the issuer allows them only to investors who pass its tests (professional, qualified). */
  limited: readonly Bi[];
  /** The issuer's words beyond the list, said once — sanctions, «any other prohibited jurisdiction». */
  also: Bi | null;
  document: IssuerDocument;
  /** False when no document of the issuer itself was found and the list rests on its platform's. */
  issuerOwn: boolean;
  dividends: Readonly<{ kind: "reinvested" | "reflected" | "none"; words: Bi; document: IssuerDocument }>;
}>;

const READ_ON = "2026-10-11";

const c = (en: string, uk: string): Bi => ({ en, uk });

export const ISSUER_TERMS: Readonly<Record<StockIssuerId, IssuerTerms>> = {
  xstocks: {
    issuer: "xstocks",
    excluded: [c("the United States and U.S. persons", "США й особи США"), c("the United Kingdom (retail clients)", "Велика Британія (роздрібні клієнти)"), c("Iran", "Іран"), c("North Korea", "Північна Корея"), c("Syria", "Сирія")],
    limited: [c("the United Kingdom — qualified investors only", "Велика Британія — лише кваліфіковані інвестори")],
    also: c("and jurisdictions the FATF calls high-risk", "і юрисдикції, які FATF називає високоризиковими"),
    document: { title: "Backed Assets (JE) Limited — Base Prospectus, «Selling Restrictions»", url: "https://assets.backed.fi/legal-documentation", dated: "2026-05-08", readOn: READ_ON },
    issuerOwn: true,
    dividends: {
      kind: "reinvested",
      words: c("Dividends are reinvested into more of the same stock: the token's multiplier grows, and the wallet shows more units.", "Дивіденди реінвестуються в ту саму акцію: множник токена росте, і гаманець показує більше одиниць."),
      document: { title: "xStocks — Dividends and stock splits", url: "https://docs.xstocks.fi/docs/dividends-and-stock-splits", dated: null, readOn: READ_ON },
    },
  },
  ondo: {
    issuer: "ondo",
    excluded: [
      c("the United States and U.S. persons", "США й особи США"),
      c("Canada", "Канада"),
      c("Russia", "Росія"),
      c("Belarus", "Білорусь"),
      c("occupied regions of Ukraine", "окуповані регіони України"),
      c("Afghanistan", "Афганістан"),
      c("Cuba", "Куба"),
      c("North Korea", "Північна Корея"),
      c("Iran", "Іран"),
      c("Libya", "Лівія"),
      c("Myanmar", "М'янма"),
      c("Somalia", "Сомалі"),
      c("South Sudan", "Південний Судан"),
      c("Sudan", "Судан"),
      c("Syria", "Сирія"),
    ],
    limited: [c("the European Economic Area", "Європейська економічна зона"), c("the United Kingdom", "Велика Британія"), c("Switzerland", "Швейцарія"), c("Brazil", "Бразилія"), c("Hong Kong", "Гонконг"), c("Malaysia", "Малайзія"), c("Singapore", "Сінгапур")],
    also: null,
    document: { title: "Ondo Global Markets — Ondo Stocks «Eligibility»", url: "https://docs.ondo.finance/ondo-stocks/eligibility", dated: null, readOn: READ_ON },
    issuerOwn: true,
    dividends: {
      kind: "reinvested",
      words: c("Dividends are invested back into the stock and show in the token: the wallet shows more units.", "Дивіденди інвестуються назад в акцію й видно в токені: гаманець показує більше одиниць."),
      document: { title: "Ondo Stocks — Corporate actions", url: "https://docs.ondo.finance/ondo-stocks/corporate-actions", dated: null, readOn: READ_ON },
    },
  },
  backpack: {
    issuer: "backpack",
    excluded: [c("the United States", "США"), c("the United Kingdom", "Велика Британія"), c("the United Arab Emirates", "ОАЕ"), c("Japan", "Японія"), c("the EU entity of Backpack", "ЄС-підрозділ Backpack")],
    limited: [],
    also: null,
    document: { title: "Backpack — What is Backpack Securities", url: "https://learn.backpack.exchange/articles/what-is-backpack-securities", dated: "2026-09-15", readOn: READ_ON },
    /* The token issuer's own terms (Backpack's tokenization terms, Trek Nexus Markets) were not found: the list is the platform's. */
    issuerOwn: false,
    dividends: {
      kind: "reflected",
      words: c("Backpack says dividends are reflected in the token; it does not say how.", "Backpack каже, що дивіденди враховано в токені, але не каже як."),
      document: { title: "Backpack — What is Sunrise", url: "https://learn.backpack.exchange/articles/what-is-sunrise", dated: "2026-07-17", readOn: READ_ON },
    },
  },
  prestocks: {
    issuer: "prestocks",
    excluded: [
      c("the United States", "США"),
      c("Russia", "Росія"),
      c("Belarus", "Білорусь"),
      c("Ukraine, including Crimea", "Україна, зокрема Крим"),
      c("China (mainland)", "Китай (материковий)"),
      c("Singapore", "Сінгапур"),
      c("Panama", "Панама"),
      c("the British Virgin Islands", "Британські Віргінські Острови"),
      c("Serbia", "Сербія"),
      c("Montenegro", "Чорногорія"),
      c("Bosnia and Herzegovina", "Боснія і Герцеговина"),
      c("Albania", "Албанія"),
      c("Kosovo", "Косово"),
      c("Iran", "Іран"),
      c("Iraq", "Ірак"),
      c("Syria", "Сирія"),
      c("Lebanon", "Ліван"),
      c("Yemen", "Ємен"),
      c("Afghanistan", "Афганістан"),
      c("Myanmar", "М'янма"),
      c("North Korea", "Північна Корея"),
      c("Cuba", "Куба"),
      c("Nicaragua", "Нікарагуа"),
      c("Venezuela", "Венесуела"),
      c("Libya", "Лівія"),
      c("Sudan", "Судан"),
      c("South Sudan", "Південний Судан"),
      c("Somalia", "Сомалі"),
      c("Eritrea", "Еритрея"),
      c("Ethiopia", "Ефіопія"),
      c("Mali", "Малі"),
      c("Liberia", "Ліберія"),
      c("Côte d'Ivoire", "Кот-д'Івуар"),
      c("the Central African Republic", "Центральноафриканська Республіка"),
      c("the Democratic Republic of the Congo", "Демократична Республіка Конго"),
      c("Zimbabwe", "Зімбабве"),
    ],
    limited: [],
    also: c("and any jurisdiction under OFAC, UN, UK or EU sanctions", "і будь-яка юрисдикція під санкціями OFAC, ООН, Великої Британії чи ЄС"),
    document: { title: "PreStocks — Terms of Service, «Prohibited Jurisdictions»", url: "https://prestocks.notion.site/terms-of-service", dated: "2026-09-08", readOn: READ_ON },
    issuerOwn: true,
    dividends: {
      kind: "none",
      words: c("No dividends: the token gives no right to dividends or other payouts.", "Без дивідендів: токен не дає права на дивіденди чи інші виплати."),
      document: { title: "PreStocks — Terms of Service", url: "https://prestocks.notion.site/terms-of-service", dated: "2026-09-08", readOn: READ_ON },
    },
  },
};

/**
 * «Ціна чесна»: the token's price against the exchange's, in one word with
 * its number — from the existing issuer-reference deviation, free sources
 * only. Within half a per cent either way it
 * is fair; dearer than the exchange it says by how much; cheaper it says that
 * too; with no reference it says the exchange's price is not available, and
 * with the exchange shut that the price may drift.
 */
export type FairPriceWord = "fair" | "slightly-dearer" | "dear" | "cheaper" | "no-reference";

export const FAIR_PRICE_BAND_PCT = 0.5;
export const DEAR_PCT = 1;

export function fairPriceOf(deviationPct: number | null): FairPriceWord {
  if (deviationPct === null || !Number.isFinite(deviationPct)) return "no-reference";
  if (Math.abs(deviationPct) <= FAIR_PRICE_BAND_PCT) return "fair";
  if (deviationPct < 0) return "cheaper";
  return deviationPct > DEAR_PCT ? "dear" : "slightly-dearer";
}

export const FAIR_PRICE_WORDS: Readonly<Record<FairPriceWord, Bi>> = {
  fair: c("Fair price", "Ціна чесна"),
  "slightly-dearer": c("Slightly dearer", "Трохи дорожче"),
  dear: c("Dear", "Дорого"),
  cheaper: c("Cheaper than the exchange", "Дешевше за біржу"),
  "no-reference": c("Exchange price unavailable", "Ціна біржі недоступна"),
};
