/**
 * The words of `/stats`, in both public languages.
 *
 * Every sentence states a fact the page can back or names a limit; nothing
 * here promises, estimates or persuades. Internal vocabulary — task ids,
 * specification references, gates — never appears: a test pins it. The page
 * is an operations dashboard first: figures, filters and the feed carry it;
 * how the counting works sits behind one disclosure at the end.
 */

import type { OperationProduct, OperationRange, OperationVerification } from "@/lib/analytics/operations";
import type { PublicLocale } from "@/lib/site/locale";

/** Ukrainian count forms: 1 операція · 2–4 операції · 5+ операцій (11–14 take the third). */
export function ukCount(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

type ProductWords = Record<OperationProduct | "ALL", string>;
type RangeWords = Record<OperationRange, string>;
type VerificationWords = Record<OperationVerification, string>;

export const STATS_COPY = {
  en: {
    eyebrow: "Stats",
    title: "Every operation through Ryntra, as it confirmed.",
    lead: "Live from Ryntra's own operation ledger, verified against public Solana transactions. A row appears the moment it confirms; nothing is estimated.",
    meta: { network: "Solana Mainnet", updated: "Ledger read", since: "Since", chain: "Chain read" },
    products: { ALL: "All", SWAP: "Swap", SPOT: "Spot", STOCK: "Stocks", BRIDGE: "Bridge" } satisfies ProductWords,
    ranges: { "24h": "24H", "7d": "7D", "30d": "30D", all: "All" } satisfies RangeWords,
    overview: {
      kicker: "Overview",
      heading: "What was executed.",
      volume: "Executed volume",
      volume24h: (usd: string) => `24h: ${usd}`,
      operations: "Operations",
      wallets: "Wallets",
      fees: "Gross fees",
      retained: "Ryntra retained",
      noFees: "No fee collected in this window",
      unvalued: (count: number) => `${count} operation${count === 1 ? "" : "s"} without a dollar value, counted but not valued`,
      own: (operations: number, wallets: number) => `Includes ${operations} operation${operations === 1 ? "" : "s"} from ${wallets} of Ryntra's own wallet${wallets === 1 ? "" : "s"}, used for testing.`,
      verified: (verified: number, total: number) => `${verified} of ${total} verified on chain`,
      basis: "Stablecoin leg at par where one exists; otherwise the provider's own dollar figure for the fill, recorded at settlement.",
      empty: "No confirmed operation in this window.",
      unavailable: "Ryntra's ledger could not be read just now. Nothing is shown in its place.",
    },
    feed: {
      kicker: "Recent activity",
      heading: "Confirmed operations, newest first.",
      lead: "Open a row for the execution detail. Every operation links to the transaction that proves it.",
      columns: { time: "Time (UTC)", product: "Product", wallet: "Wallet", action: "Action", value: "Executed value", fee: "Fee", verification: "Verification", proof: "Proof" },
      side: { BUY: "Buy", SELL: "Sell" },
      verification: { VERIFIED: "Verified", PENDING: "Pending", NOT_ATTRIBUTABLE: "Confirmed", NOT_APPLICABLE: "Confirmed" } satisfies VerificationWords,
      verificationLong: {
        VERIFIED: "Verified on chain — the transaction carries Ryntra's service-fee credit.",
        PENDING: "Confirmed by Ryntra; the chain read has not caught up with this operation yet.",
        NOT_ATTRIBUTABLE: "Confirmed by Ryntra; no service-fee marker on chain, so it cannot be attributed by the public rule.",
        NOT_APPLICABLE: "Confirmed by Ryntra; attributed from the provider's own record.",
      } satisfies VerificationWords,
      more: (count: number) => `${count} older operation${count === 1 ? "" : "s"} not listed here.`,
      empty: "Nothing yet in this window.",
      unvalued: "—",
      basis: { PAR: "at par", PROVIDER_STATED: "provider's figure" },
      noFee: "no fee",
      detail: {
        wallet: "Wallet",
        input: "Paid",
        output: "Received",
        execution: "Actual execution",
        provider: "Provider",
        providers: { JUPITER: "Jupiter Swap", RELAY: "Relay", MAYAN: "Mayan", CIRCLE: "Circle CCTP" },
        fee: "Ryntra fee",
        retained: "Ryntra's share",
        providerShare: "Provider's share",
        signature: "Signature",
        requestId: "Provider request",
        plan: "Trading plan",
        planYes: "Executed under a trading plan",
        planNo: "No plan",
        verification: "On-chain verification",
        confirmedAt: "Confirmed",
        proof: "Open on",
        none: "—",
      },
    },
    method: {
      kicker: "How this is counted",
      summary: "Methodology and verification",
      confirmed: "Confirmed through Ryntra",
      attributable: "Attributable on chain by the public rule",
      gap: "The two numbers differ where an operation confirmed through Ryntra left no service-fee credit on chain: operations before the referral account existed, and operations where the provider took no fee. The difference is stated, never smoothed.",
      rule: [
        "An operation counts once it is confirmed, once, by its transaction. A quote, a review or an attempt that did not land is never volume.",
        "Executed value is the person's stablecoin leg at par where one exists — what left or arrived — and otherwise the provider's own dollar figure for that exact fill, recorded at settlement. Nothing is priced later.",
        "The chain is the second witness, not the count: a Solana transaction is attributable when it credited a token account owned by Ryntra's Jupiter referral account — the service fee the person paid. Bridge accrues its fee in the provider's own record and carries no on-chain marker.",
        "Fees are what reached the referral accounts, in the asset the provider chose; the provider keeps the share its referral project states, and Ryntra's share is the rest.",
        "Liquidity belongs to the pools a route crossed, never to Ryntra, and is never shown as Ryntra's.",
      ],
      referral: "Referral account",
      accounts: "Fee accounts",
      dashboard: "Public dashboard",
      sources: "Chain read from",
      coverageComplete: "Complete — every movement of the fee accounts was read and sums to their balances.",
      coveragePartial: "Partial — not every transaction of the fee accounts could be read; the attributable figure is a lower bound.",
      chainUnavailable: "The chain could not be read just now; verification marks wait for the next read.",
      ruleVersion: "Rule version",
    },
  },
  uk: {
    eyebrow: "Статистика",
    title: "Кожна операція через Ryntra — так, як вона підтвердилась.",
    lead: "Наживо з власного реєстру операцій Ryntra, звірено з публічними транзакціями Solana. Рядок з'являється тієї ж миті, як операція підтверджується; нічого не оцінено приблизно.",
    meta: { network: "Solana Mainnet", updated: "Реєстр прочитано", since: "Від", chain: "Ланцюг прочитано" },
    products: { ALL: "Усі", SWAP: "Swap", SPOT: "Spot", STOCK: "Акції", BRIDGE: "Bridge" } satisfies ProductWords,
    ranges: { "24h": "24Г", "7d": "7Д", "30d": "30Д", all: "Усе" } satisfies RangeWords,
    overview: {
      kicker: "Огляд",
      heading: "Що виконано.",
      volume: "Виконаний обсяг",
      volume24h: (usd: string) => `24 год: ${usd}`,
      operations: "Операцій",
      wallets: "Гаманців",
      fees: "Комісії брутто",
      retained: "Утримано Ryntra",
      noFees: "У цьому вікні комісій не зібрано",
      unvalued: (count: number) => `${count} ${ukCount(count, "операція", "операції", "операцій")} без доларової оцінки: пораховано, але не оцінено`,
      own: (operations: number, wallets: number) =>
        `Включно з ${operations} ${ukCount(operations, "операцією", "операціями", "операціями")} з ${wallets} ${ukCount(wallets, "власного гаманця", "власних гаманців", "власних гаманців")} Ryntra, ${ukCount(wallets, "що використовується", "що використовуються", "що використовуються")} для тестування.`,
      verified: (verified: number, total: number) => `${verified} з ${total} підтверджено в ланцюгу`,
      basis: "Стейблкоїн-нога за номіналом, де вона є; інакше — власна доларова оцінка провайдера для цього виконання, записана при розрахунку.",
      empty: "У цьому вікні підтверджених операцій немає.",
      unavailable: "Реєстр Ryntra зараз не вдалося прочитати. Замість цифр нічого не показано.",
    },
    feed: {
      kicker: "Останні операції",
      heading: "Підтверджені операції, найновіші зверху.",
      lead: "Відкрийте рядок, щоб побачити деталі виконання. Кожна операція веде на транзакцію, яка її доводить.",
      columns: { time: "Час (UTC)", product: "Продукт", wallet: "Гаманець", action: "Дія", value: "Виконаний обсяг", fee: "Комісія", verification: "Перевірка", proof: "Доказ" },
      side: { BUY: "Купівля", SELL: "Продаж" },
      verification: { VERIFIED: "Перевірено", PENDING: "Очікує", NOT_ATTRIBUTABLE: "Підтверджено", NOT_APPLICABLE: "Підтверджено" } satisfies VerificationWords,
      verificationLong: {
        VERIFIED: "Перевірено в ланцюгу — транзакція містить зарахування сервісної комісії Ryntra.",
        PENDING: "Підтверджено Ryntra; читання ланцюга ще не дійшло до цієї операції.",
        NOT_ATTRIBUTABLE: "Підтверджено Ryntra; в ланцюгу немає маркера сервісної комісії, тож за публічним правилом операцію не атрибутувати.",
        NOT_APPLICABLE: "Підтверджено Ryntra; атрибутовано за власним записом провайдера.",
      } satisfies VerificationWords,
      more: (count: number) => `Ще ${count} ${ukCount(count, "давніша операція", "давніші операції", "давніших операцій")} тут не показано.`,
      empty: "У цьому вікні поки нічого немає.",
      unvalued: "—",
      basis: { PAR: "за номіналом", PROVIDER_STATED: "оцінка провайдера" },
      noFee: "без комісії",
      detail: {
        wallet: "Гаманець",
        input: "Сплачено",
        output: "Отримано",
        execution: "Фактичне виконання",
        provider: "Провайдер",
        providers: { JUPITER: "Jupiter Swap", RELAY: "Relay", MAYAN: "Mayan", CIRCLE: "Circle CCTP" },
        fee: "Комісія Ryntra",
        retained: "Частка Ryntra",
        providerShare: "Частка провайдера",
        signature: "Підпис",
        requestId: "Запит провайдера",
        plan: "Торговий план",
        planYes: "Виконано за торговим планом",
        planNo: "Без плану",
        verification: "Перевірка в ланцюгу",
        confirmedAt: "Підтверджено",
        proof: "Відкрити в",
        none: "—",
      },
    },
    method: {
      kicker: "Як це рахується",
      summary: "Методологія та перевірка",
      confirmed: "Підтверджено через Ryntra",
      attributable: "Атрибутовано в ланцюгу за публічним правилом",
      gap: "Ці два числа розходяться там, де операція, підтверджена через Ryntra, не лишила в ланцюгу зарахування сервісної комісії: операції до появи реферального рахунку та операції, де провайдер комісії не взяв. Різницю названо, а не згладжено.",
      rule: [
        "Операція рахується після підтвердження, один раз, за своєю транзакцією. Котирування, перевірка чи спроба, що не відбулась, ніколи не є обсягом.",
        "Виконаний обсяг — стейблкоїн-нога людини за номіналом, де вона є (те, що вийшло або надійшло), інакше — власна доларова оцінка провайдера для саме цього виконання, записана при розрахунку. Нічого не оцінюється пізніше.",
        "Ланцюг — другий свідок, а не лічильник: транзакція Solana атрибутується, якщо зарахувала кошти на токен-рахунок, яким володіє реферальний рахунок Ryntra в Jupiter, — це сервісна комісія, яку сплатила людина. Bridge нараховує комісію у власному записі провайдера й маркера в ланцюгу не має.",
        "Комісії — те, що надійшло на реферальні рахунки, в активі, який обрав провайдер; провайдер лишає частку, яку зазначає його реферальний проєкт, частка Ryntra — решта.",
        "Ліквідність належить пулам, які пройшов маршрут, а не Ryntra, і ніколи не показується як ліквідність Ryntra.",
      ],
      referral: "Реферальний рахунок",
      accounts: "Рахунки комісій",
      dashboard: "Публічний дашборд",
      sources: "Ланцюг прочитано з",
      coverageComplete: "Повно — кожен рух рахунків комісій прочитано, і сума збігається з їхніми балансами.",
      coveragePartial: "Частково — не всі транзакції рахунків комісій вдалося прочитати; атрибутована цифра — нижня межа.",
      chainUnavailable: "Ланцюг зараз не вдалося прочитати; позначки перевірки чекають наступного читання.",
      ruleVersion: "Версія правила",
    },
  },
} as const satisfies Record<PublicLocale, unknown>;

export type StatsCopy = (typeof STATS_COPY)[PublicLocale];
