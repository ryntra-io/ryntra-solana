import type { PublicLocale } from "@/lib/site/locale";
import { NETWORK_RULES_V1 } from "../../../../lib/rewards/network-rules.ts";
import { PARTNER_LEVEL_CREATORS } from "../../../../lib/growth/partner-tracks.ts";
import { MIN_POSITION_USD, POOL_MIN_VERIFIED_USD, STEWARD_DAYS, STRATEGIST_DAYS } from "../../../../lib/growth/liquidity.ts";

/**
 * The Terms of the creator partner programme, in both public languages —
 * the programme's rules as a person reads them. Every number is read from
 * the rules the ledger counts by (`network-1.0.0`), so the page and the
 * ledger cannot drift. No country is named and nobody is excluded: what a
 * service a launch runs on forbids is told as that service's rule. Taxes are
 * the recipient's.
 */

const rules = NETWORK_RULES_V1;
const pct = (bps: number) => `${bps / 100}%`;
const S = rules.schedules.STANDARD;
const F = rules.schedules.FOUNDING;
/** «network-1.0.0» → «1.0»: the version a person reads. */
const VERSION = rules.version.replace(/^network-/, "").split(".").slice(0, 2).join(".");

export type TermsSection = Readonly<{ id: string; title: string; lines: readonly string[] }>;

export type TermsCopy = Readonly<{
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  version: string;
  promise: string;
  intro: string;
  ratesTitle: string;
  ratesHead: Readonly<{ partner: string; share: string; when: string }>;
  rates: readonly Readonly<{ partner: string; share: string; when: string }>[];
  sections: readonly TermsSection[];
  contents: string;
  cta: string;
  kit: string;
}>;

const EN: TermsCopy = {
  metaTitle: "Creator partner terms — Ryntra",
  metaDescription: "Shares, terms, the cap, attribution, states and payouts of the Ryntra creator partner programme.",
  eyebrow: "Ryntra Network",
  title: "Creator partner terms",
  version: `Terms ${VERSION} · rates approved on 13 October 2026`,
  promise: `Bring a creator: ${pct(S[0]!.bps)} of Ryntra's part of their pool for the first ${S[0]!.untilDay} days, then ${pct(S[1]!.bps)}. Counted as Ryntra receives the pool's fees; paid in USDC once partner payouts open after Ryntra's first test payout.`,
  intro:
    "A creator partner is the person who brought the creator of a token launched on Ryntra. The partner receives a share of the part of that launch pool's fees that Ryntra actually receives. Taking part is free: you don't need to buy tokens, add liquidity or recruit anyone.",
  ratesTitle: "Shares",
  ratesHead: { partner: "Partner", share: "Share of Ryntra's part of the pool", when: "When" },
  rates: [
    { partner: "Standard", share: pct(S[0]!.bps), when: `the first ${S[0]!.untilDay} days from the pool's first fee Ryntra receives` },
    { partner: "Standard, after", share: pct(S[1]!.bps), when: "while the pool brings fees and the programme runs" },
    { partner: "Founding", share: pct(F[0]!.bps), when: `days 1–${F[0]!.untilDay} from the pool's first fee Ryntra receives` },
    { partner: "Founding", share: pct(F[1]!.bps), when: `days ${F[0]!.untilDay! + 1}–${F[1]!.untilDay} from the same day` },
    { partner: "Founding", share: pct(F[2]!.bps), when: "after, while the pool brings fees and the programme runs" },
  ],
  sections: [
    {
      id: "base",
      title: "What a share is counted from",
      lines: [
        "Only from the part of a pool's fees Ryntra has actually received (claimed). Not from trading volume, not from the pool's whole fee, and never from the creator's part. No fee received means no share.",
        "On Solana that part is Ryntra's share of the curve's fee (60% of what remains after Meteora's 20%), its share of the graduation fee and the fees of Ryntra's locked position in the pool. Where a launch runs on Circle's network, that part is Ryntra's 20% of the pool's 1% fee, taken on the USDC side.",
        "One dollar is paid once: where traders' cashback on the same pool's trades was already counted from the same fee, that part is not counted again.",
        `Founding partners are the first ${rules.foundingSeats} outside partners Ryntra approves.`,
      ],
    },
    {
      id: "cap",
      title: "The cap",
      lines: [`Everything paid out of one pool's Ryntra part, together, stays within ${pct(rules.poolCapBps)} of it. There is no second payout from the same money.`],
    },
    {
      id: "term",
      title: "Term",
      lines: [
        "The terms renew every year on their own.",
        "A share is a part of the fees a pool still brings, not a debt of Ryntra: when a pool brings no fees, there is nothing to share.",
      ],
    },
    {
      id: "attribution",
      title: "Who brought whom",
      lines: [
        "Your partner code is your personal code, ryntra.io/r/<code>. There are no separate codes.",
        "A creator sees «Invited by: <partner>» on the review step before signing a launch, and can change or remove it until they sign. After the launch it cannot be changed, not even retroactively.",
        "On the creator's next launch the same partner is filled in and shown on the review.",
        "One level only: you share in creators you brought yourself. There is no share for recruiting other partners.",
        "Self-referral earns nothing: the same wallet, wallets of one profile and the team's wallets. A disputed case goes to review, never to an automatic ban.",
      ],
    },
    {
      id: "activated",
      title: "Activated creator",
      lines: [
        "A creator is activated when, for a confirmed launch, at least 3 independent outside wallets make a trade of $1 or more on its launch curve, before it reaches a DEX, within 30 days. Half of a round trip does not count. Where the check cannot see everything, a person confirms the activation.",
        "Outside means not the team, not the creator, not the partner, not their linked wallets and not a wallet they funded. Wallets funded from one source within two steps count as one; whether an exchange or a bridge is such a source, a reviewer decides.",
        "Until the creator is activated, the partner's share of that pool does not become available.",
      ],
    },
    {
      id: "states",
      title: "States and payouts",
      lines: [
        `In the pool (Ryntra has not claimed it yet) → earned (claimed and your share counted) → pending for ${rules.holdDays} days → available → paid. A mistake is corrected by a negative entry.`,
        "Payouts are in USDC on the pool's own network: a Solana pool is paid on Solana, a pool on Circle's network on that network. The minimum is $1. The money comes from the fees Ryntra received.",
        "Partner payouts open after Ryntra's first test payout. Until then your share is counted and shown on «Creator partners», but not paid.",
        "Every entry is kept with its receipt: the pool, the rule and its version, the claim transaction, the amount and, once paid, the payout transaction.",
        `Each $1 of Ryntra's part of your creators' pools also counts 1 rank point once its ${rules.holdDays} days of waiting have passed, the creator is activated and no review holds the pool. Points have no cash value and cannot be transferred or exchanged.`,
      ],
    },
    {
      id: "review",
      title: "Review",
      lines: [
        "Signs of wash trading or fake activity send a case to review, not to a ban. Proven manipulation cancels the reward; the trades stay in the records.",
        "While a case is open, the money it holds waits. You can ask the reviewer a question on «Creator partners»; we answer within 72 hours.",
      ],
    },
    {
      id: "versions",
      title: "Versions",
      lines: [
        "Every entry keeps the version of the terms it was counted under.",
        "The terms change only by a new version, for fees received after it, and with notice. What was earned under the version in force stays.",
      ],
    },
    {
      id: "forbidden",
      title: "Not allowed",
      lines: [
        "Referring yourself, your own wallets or the team's.",
        "Wash trading, round trips, bought or fake activity, and paying people to trade.",
        "Promising profit or safety: «guaranteed», «risk-free», price predictions, investment advice.",
        "Presenting yourself as Ryntra or as its official partner, and spam or unsolicited messages.",
        "The rules of the services a launch runs on apply to you too: Meteora's terms of use (meteora.ag) on Solana, and Circle's where a launch runs on Circle's network; Circle's terms forbid getting around its regional restrictions.",
      ],
    },
    {
      id: "ads",
      title: "Advertising",
      lines: [
        "Ryntra does not pay for posts: a share comes only from real creators who launched with your code.",
        "Paid or partner content carries «Paid Partnership» or «Ad» under the rules of X and of every network you post on; a post with your link is partner content. X has its own rules on paid promotion of crypto products.",
        "Separate paid work happens only with a budget Ryntra names in writing; without one, no payment is promised.",
      ],
    },
    {
      id: "badges",
      title: "Badges",
      lines: [
        `Partner: Scout, Partner, Builder and Council at ${PARTNER_LEVEL_CREATORS.SCOUT}, ${PARTNER_LEVEL_CREATORS.PARTNER}, ${PARTNER_LEVEL_CREATORS.BUILDER} and ${PARTNER_LEVEL_CREATORS.COUNCIL} activated creators. Founding Partner: one of the first ${rules.foundingSeats} approved partners.`,
        "Creator: Launched, Graduated, Returning Builder. Ambassador: Educator, Guide, Community Partner — for useful materials and creators activated by your link, not for likes or reposts; these are not given yet.",
        `Liquidity: Pool Contributor — a Meteora DLMM or DAMM v2 position holding $${MIN_POSITION_USD} or more in verified tokens that you can withdraw, in a live pool (not blacklisted, at least $${POOL_MIN_VERIFIED_USD.toLocaleString("en-US")} in verified tokens, traded in the last day), read from Solana when you open Creator partners; Steward — in range on ${STEWARD_DAYS} different days Ryntra checked it; Strategist — a DLMM position, bins of your choice, in range on ${STRATEGIST_DAYS} different such days. A locked part does not count. Liquidity earns badges, never money. They are shown on the boards only if you turn that on.`,
        "A badge confirms an action, not the safety of a token. Ryntra does not endorse tokens launched by creators.",
      ],
    },
    {
      id: "taxes",
      title: "Taxes",
      lines: ["Taxes on what you receive are yours to declare and pay where you live."],
    },
  ],
  contents: "On this page",
  cta: "Open Creator partners",
  kit: "Media kit",
};

const UK: TermsCopy = {
  metaTitle: "Умови партнера творців — Ryntra",
  metaDescription: "Частки, строки, стеля, атрибуція, стани й виплати програми партнерів творців Ryntra.",
  eyebrow: "Мережа Ryntra",
  title: "Умови партнера творців",
  version: `Умови ${VERSION} · ставки затверджено 13 жовтня 2026 року`,
  promise: `Приведіть творця: ${pct(S[0]!.bps)} частки Ryntra з його пулу перші ${S[0]!.untilDay} днів, далі ${pct(S[1]!.bps)}. Рахуємо, щойно Ryntra отримує комісії пулу; виплата в USDC — коли виплати партнерам відкриються після першої тестової виплати Ryntra.`,
  intro:
    "Партнер творця — людина, яка привела творця токена, запущеного на Ryntra. Партнер отримує частку тієї частини комісій пулу запуску, яку Ryntra справді отримала. Участь безкоштовна: купувати токени, вносити ліквідність чи когось вербувати не треба.",
  ratesTitle: "Частки",
  ratesHead: { partner: "Партнер", share: "Частка від частини Ryntra в пулі", when: "Коли" },
  rates: [
    { partner: "Стандарт", share: pct(S[0]!.bps), when: `перші ${S[0]!.untilDay} днів від першої комісії пулу, яку отримала Ryntra` },
    { partner: "Стандарт, далі", share: pct(S[1]!.bps), when: "поки пул приносить комісії й програма діє" },
    { partner: "Founding", share: pct(F[0]!.bps), when: `дні 1–${F[0]!.untilDay} від першої комісії пулу, яку отримала Ryntra` },
    { partner: "Founding", share: pct(F[1]!.bps), when: `дні ${F[0]!.untilDay! + 1}–${F[1]!.untilDay} від того самого дня` },
    { partner: "Founding", share: pct(F[2]!.bps), when: "далі, поки пул приносить комісії й програма діє" },
  ],
  sections: [
    {
      id: "base",
      title: "З чого рахується частка",
      lines: [
        "Лише з тієї частини комісій пулу, яку Ryntra справді отримала (забрала). Не з обігу, не з усієї комісії пулу й ніколи не з частки творця. Немає отриманої комісії — немає й частки.",
        "На Solana ця частина — частка Ryntra в комісії кривої (60% того, що лишається після 20% Meteora), її частка в комісії виходу на DEX і комісії замкненої позиції Ryntra в пулі. Якщо запуск працює в мережі Circle, ця частина — 20% комісії пулу 1%, що належать Ryntra; комісію беруть з боку USDC.",
        "Один долар платиться раз: якщо кешбек трейдерам на угодах того самого пулу вже пораховано з тієї самої комісії, цю частину вдруге не рахуємо.",
        `Founding — перші ${rules.foundingSeats} зовнішніх партнерів, яких схвалила Ryntra.`,
      ],
    },
    {
      id: "cap",
      title: "Стеля",
      lines: [`Усе, що платиться з частини Ryntra одного пулу, разом — не більше ${pct(rules.poolCapBps)} від неї. Другої виплати з тих самих грошей немає.`],
    },
    {
      id: "term",
      title: "Строк",
      lines: [
        "Умови поновлюються щороку самі.",
        "Частка — це частина комісій, які пул ще приносить, а не борг Ryntra: коли пул не приносить комісій, ділити нічого.",
      ],
    },
    {
      id: "attribution",
      title: "Хто кого привів",
      lines: [
        "Код партнера — ваш особистий код, ryntra.io/r/<код>. Окремих кодів немає.",
        "Творець бачить «Запросив: <партнер>» на кроці перегляду перед підписом запуску й може змінити чи прибрати його до підпису. Після запуску його не змінити — і заднім числом теж.",
        "На наступному запуску творця той самий партнер заповнений наперед і видно на перегляді.",
        "Один рівень: частка лише за творців, яких ви привели самі. За вербування інших партнерів частки немає.",
        "Самореферал не приносить нічого: той самий гаманець, гаманці одного профілю й гаманці команди. Спірне — на перевірку, без автоматичного бану.",
      ],
    },
    {
      id: "activated",
      title: "Активований творець",
      lines: [
        "Творця активовано, коли для підтвердженого запуску щонайменше 3 незалежні зовнішні гаманці роблять угоду від $1 на кривій запуску, до виходу на DEX, за 30 днів. Половина «туди-назад» не рахується. Якщо перевірка бачить не все, активацію підтверджує людина.",
        "Зовнішній — не команда, не творець, не партнер, не їхні пов'язані гаманці й не гаманець, який вони профінансували. Гаманці з одним джерелом коштів у межах двох кроків рахуються як один; чи є таким джерелом біржа чи міст, вирішує рецензент.",
        "Доки творця не активовано, частка партнера з цього пулу не стає доступною.",
      ],
    },
    {
      id: "states",
      title: "Стани й виплати",
      lines: [
        `У пулі (Ryntra ще не забрала) → зароблено (забрано, вашу частку пораховано) → очікує ${rules.holdDays} днів → доступно → виплачено. Помилку виправляє від'ємний запис.`,
        "Виплата — у USDC у власній мережі пулу: пул Solana — на Solana, пул у мережі Circle — у тій самій мережі. Мінімум — $1. Гроші — з комісій, які отримала Ryntra.",
        "Виплати партнерам відкриються після першої тестової виплати Ryntra. До того вашу частку пораховано й видно в «Партнерах творців», але не виплачено.",
        "Кожен запис зберігається з квитанцією: пул, правило та його версія, транзакція claim, сума, а після виплати — її транзакція.",
        `Кожен $1 частини Ryntra з пулів ваших творців також дає 1 очко рангу, щойно мине ${rules.holdDays} днів очікування, творця активовано й пул не тримає перевірка. Очки не мають грошової вартості, їх не можна передати чи обміняти.`,
      ],
    },
    {
      id: "review",
      title: "Перевірка",
      lines: [
        "Ознаки wash-трейдингу чи несправжньої активності ведуть на перевірку, а не в бан. Доведена маніпуляція скасовує винагороду; угоди лишаються в обліку.",
        "Поки справа відкрита, гроші, які вона тримає, чекають. Поставити питання рецензентові можна в «Партнерах творців»; відповідаємо протягом 72 годин.",
      ],
    },
    {
      id: "versions",
      title: "Версії",
      lines: [
        "Кожен запис зберігає версію Умов, за якою його пораховано.",
        "Умови змінюються лише новою версією — для комісій, отриманих після неї, і з повідомленням. Зароблене за чинною версією лишається.",
      ],
    },
    {
      id: "forbidden",
      title: "Заборонено",
      lines: [
        "Запрошувати себе, власні гаманці чи гаманці команди.",
        "Wash-трейдинг, «туди-назад», куплена чи несправжня активність і оплата людям за угоди.",
        "Обіцяти прибуток чи безпеку: «гарантовано», «без ризику», прогнози цін, інвестиційні поради.",
        "Видавати себе за Ryntra чи її офіційного партнера, спам і непрохані повідомлення.",
        "Правила сервісів, на яких працює запуск, діють і для вас: умови користування Meteora (meteora.ag) на Solana й умови Circle там, де запуск працює в мережі Circle; умови Circle забороняють обходити його регіональні обмеження.",
      ],
    },
    {
      id: "ads",
      title: "Реклама",
      lines: [
        "Ryntra не платить за пости: частка — лише за справжніх творців, які запустились за вашим кодом.",
        "Платний чи партнерський допис — з міткою «Paid Partnership» або «Ad» за правилами X і кожної мережі, де ви публікуєте; допис із вашим посиланням — партнерський контент. У X свої правила платного просування крипто-продуктів.",
        "Окрема платна робота — лише з бюджетом, який Ryntra назвала письмово; без нього оплату не обіцяємо.",
      ],
    },
    {
      id: "badges",
      title: "Значки",
      lines: [
        `Партнер: Scout, Partner, Builder і Council — від ${PARTNER_LEVEL_CREATORS.SCOUT}, ${PARTNER_LEVEL_CREATORS.PARTNER}, ${PARTNER_LEVEL_CREATORS.BUILDER} і ${PARTNER_LEVEL_CREATORS.COUNCIL} активованих творців. Founding Partner — один із перших ${rules.foundingSeats} схвалених партнерів.`,
        "Творець: Launched, Graduated, Returning Builder. Амбасадор: Educator, Guide, Community Partner — за корисні матеріали й творців, активованих за вашим посиланням, а не за лайки й репости; їх ще не видають.",
        `Ліквідність: Pool Contributor — позиція Meteora DLMM чи DAMM v2, де від $${MIN_POSITION_USD} у верифікованих токенах, які ви можете вивести, у живому пулі (не в чорному списку, від $${POOL_MIN_VERIFIED_USD.toLocaleString("uk-UA")} у верифікованих токенах, торги за останню добу), прочитана з Solana, коли ви відкриваєте «Партнери творців»; Steward — у діапазоні ${STEWARD_DAYS} різних днів, коли Ryntra її перевіряла; Strategist — позиція DLMM із власними бінами в діапазоні ${STRATEGIST_DAYS} різних таких днів. Замкнена частина не рахується. За ліквідність — значки, а не гроші. У таблицях їх видно, лише якщо ви це ввімкнете.`,
        "Значок підтверджує дію, а не безпеку токена. Ryntra не рекомендує токени, які запускають творці.",
      ],
    },
    {
      id: "taxes",
      title: "Податки",
      lines: ["Податки з отриманого декларує й сплачує отримувач — там, де живе."],
    },
  ],
  contents: "На цій сторінці",
  cta: "Відкрити «Партнери творців»",
  kit: "Медіакіт",
};

export function termsCopy(locale: PublicLocale): TermsCopy {
  return locale === "uk" ? UK : EN;
}
