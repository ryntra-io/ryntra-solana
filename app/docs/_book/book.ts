/**
 * Ryntra's documentation for the terminal: what a person who sees Ryntra for the first time reads. Pure
 * data in two languages, no React, so the pages, the tests and the build read the same words.
 *
 * - **Live means open to people on ryntra.io today.** What stands behind a switch or is still being built is a «coming»
 *   line, never a section of its own; `book.test.mjs` holds every «open» link to a screen the terminal serves.
 * - **Short.** A section is its name, one line, one frame of the live site, what you can do (a title and a line each)
 *   and a few quiet disclosures. Everything else waits behind «More» or on the roadmap.
 * - **Honest words.** «Privately», never «anonymously»; no promise of profit, multiples or dates; no fee, rate or share
 *   the site itself does not show; examples name SOL, JUP and MET only; Ryntra's products only.
 * - **Frames** are cut from the live site with no wallet connected (`scripts/shots.cjs` here): desk 1440×900 and phone
 *   390×844, English and Ukrainian, in `public/docs/shots/`.
 */

export type Lang = 'en' | 'uk';

/** A frame of the live site: `public/docs/shots/<shot>-<desk|phone>-<lang>.webp`. */
export const SHOT_IDS = ['market', 'market-table', 'trade', 'bridge', 'spot', 'launch', 'bots', 'grid', 'ladder', 'agent', 'earn', 'pro', 'pool', 'portfolio', 'money', 'rewards'] as const;
export type ShotId = (typeof SHOT_IDS)[number];

export function shotSrc(shot: ShotId, size: 'desk' | 'phone', lang: Lang): string {
  return `/docs/shots/${shot}-${size}-${lang}.webp`;
}

/** One thing a person can do: a short title and one line. */
export type Do = Readonly<{ title: string; line: string }>;
/** One quiet disclosure: its name and a few short sentences. */
export type More = Readonly<{ title: string; text: readonly string[] }>;

export type SectionWords = Readonly<{
  title: string;
  /** One line under the title, and the card's line on the hub. */
  line: string;
  /** The label of the one amber action that opens the screen. */
  open: string;
  does: readonly Do[];
  more: readonly More[];
  /** What is still being built in this section, one short name each: shown as «Coming». */
  coming?: readonly string[];
}>;

/** A part of a long section (Meteora): its own frame, a line, and whether it is open to people. */
export type Part = Readonly<{
  key: string;
  shot: ShotId | null;
  /** The screen it opens; null for what is still coming. */
  href: string | null;
  live: boolean;
  en: Readonly<{ title: string; line: string; more?: readonly string[] }>;
  uk: Readonly<{ title: string; line: string; more?: readonly string[] }>;
}>;

export const GROUP_IDS = ['start', 'terminal', 'meteora', 'trust'] as const;
export type GroupId = (typeof GROUP_IDS)[number];

export const SECTION_IDS = ['start', 'market', 'trade', 'spot', 'launch', 'bots', 'agent', 'earn', 'portfolio', 'money', 'rewards', 'meteora', 'keys', 'help'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type Section = Readonly<{
  id: SectionId;
  group: GroupId;
  /** The section's one frame; null when the section is words only. */
  shot: ShotId | null;
  /** The screen of the terminal it describes; null for a section of words. */
  href: string | null;
  en: SectionWords;
  uk: SectionWords;
  parts?: readonly Part[];
}>;

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && (SECTION_IDS as readonly string[]).includes(value);
}

export function docHref(id: SectionId): string {
  return `/docs/${id}`;
}

/**
 * The addresses the city's documentation had and the section that covers the same ground now: a kept link
 * still lands on a page that answers. The old handbook's chapters lead to these addresses first (next.config.ts).
 */
export const OLD_SECTIONS: Readonly<Record<string, SectionId>> = {
  city: 'market',
  orders: 'spot',
  partners: 'rewards',
  security: 'keys',
  fees: 'keys',
  guard: 'keys',
};

export const GROUP_WORDS: Readonly<Record<Lang, Readonly<Record<GroupId, string>>>> = {
  en: { start: 'Start', terminal: 'The terminal', meteora: 'Meteora', trust: 'Trust' },
  uk: { start: 'Початок', terminal: 'Термінал', meteora: 'Meteora', trust: 'Довіра' },
};

const SOL = 'So11111111111111111111111111111111111111112';

export const SECTIONS: readonly Section[] = [
  {
    id: 'start',
    group: 'start',
    shot: 'market',
    href: '/',
    en: {
      title: 'What is Ryntra',
      line: 'An AI terminal on Solana. Say what to do — your agent does the rest.',
      open: 'Open Ryntra',
      does: [
        { title: 'Say it', line: 'Type «Trade JUP every day» — the agent opens the right screen and fills it in.' },
        { title: 'Sign in your wallet', line: 'Connect a Solana wallet. Every move is one signature of yours.' },
        { title: 'One terminal', line: 'Market, trade, launch, bots, agents, earn, portfolio and money in one place.' },
        { title: 'Keys stay yours', line: 'You choose the budget and can stop anytime. Ryntra never holds your keys.' },
      ],
      more: [
        { title: 'Bot or agent?', text: ['A bot follows a rule you set: an amount, a price, a schedule.', 'An agent is AI: it understands your sentence, reads the market and advises. You decide and sign.'] },
        { title: 'First steps', text: ['Connect a wallet. Say what to do, or open a section from the menu.', 'Read the line with the fee and what you get, then sign.'] },
        { title: 'What it costs', text: ['Every fee shows on one line before you sign. Some screens have none.'] },
      ],
    },
    uk: {
      title: 'Що таке Ryntra',
      line: 'AI-термінал на Solana. Скажи, що зробити, — агент зробить решту.',
      open: 'Відкрити Ryntra',
      does: [
        { title: 'Скажи', line: 'Напиши «Торгуй JUP щодня» — агент відкриє потрібний екран і заповнить його.' },
        { title: 'Підпис — у твоєму гаманці', line: 'Підключи гаманець Solana. Кожна дія — один твій підпис.' },
        { title: 'Один термінал', line: 'Ринок, торгівля, запуск, боти, агенти, заробіток, портфель і гроші — в одному місці.' },
        { title: 'Ключі в тебе', line: 'Бюджет обираєш ти, зупинити можна будь-коли. Ryntra ніколи не тримає твоїх ключів.' },
      ],
      more: [
        { title: 'Бот чи агент?', text: ['Бот виконує правило, яке ставиш ти: суму, ціну, розклад.', 'Агент — це AI: розуміє твоє речення, читає ринок і радить. Вирішуєш і підписуєш ти.'] },
        { title: 'Перші кроки', text: ['Підключи гаманець. Скажи, що зробити, або відкрий розділ у меню.', 'Прочитай рядок з комісією й тим, що отримаєш, — і підпиши.'] },
        { title: 'Скільки це коштує', text: ['Кожну комісію видно одним рядком до підпису. На деяких екранах її немає.'] },
      ],
    },
  },
  {
    id: 'market',
    group: 'terminal',
    shot: 'market-table',
    href: '/',
    en: {
      title: 'Market',
      line: 'Every Solana coin in one live table — and the doors to everything else.',
      open: 'Open the Market',
      does: [
        { title: 'Pulse', line: 'New coins as they launch, coins almost on a DEX and coins that just made it.' },
        { title: 'One-tap buy', line: 'Buy a fixed amount right from a row or a card, with one signature.' },
        { title: 'Every kind of asset', line: 'All, Memes, Crypto, Stocks, Pre-IPO and your Saved coins — each on its own tab.' },
        { title: 'Filters and columns', line: 'Trending, rising, falling, most trades; liquidity, holders, risk and more.' },
      ],
      more: [
        { title: 'Where a coin leads', text: ['Tap a coin to open its page: the chart, trades and a ticket to buy or sell.'] },
        { title: 'Risk', text: ['Each coin shows one risk mark. The facts behind it — holders, top 10, the creator and the coin’s rights — are on its page.'] },
      ],
    },
    uk: {
      title: 'Ринок',
      line: 'Кожна монета Solana в одній живій таблиці — і двері до всього іншого.',
      open: 'Відкрити Ринок',
      does: [
        { title: 'Пульс', line: 'Нові монети в момент запуску, майже на DEX і ті, що щойно вийшли.' },
        { title: 'Купівля в один дотик', line: 'Купи наперед задану суму просто з рядка чи картки — одним підписом.' },
        { title: 'Усі види активів', line: 'Усі, Меми, Крипта, Акції, Pre-IPO й Обране — кожне на своїй вкладці.' },
        { title: 'Фільтри й колонки', line: 'Тренди, ростуть, падають, найбільше угод; ліквідність, власники, ризик тощо.' },
      ],
      more: [
        { title: 'Куди веде монета', text: ['Натисни монету — відкриється її сторінка: графік, угоди й квиток купівлі чи продажу.'] },
        { title: 'Ризик', text: ['У кожної монети — одна мітка ризику. Факти за нею — власники, топ-10, творець і права монети — на її сторінці.'] },
      ],
    },
  },
  {
    id: 'trade',
    group: 'terminal',
    shot: 'trade',
    href: '/swap',
    en: {
      title: 'Swap and Bridge',
      line: 'Any coin for any coin on Solana, and money in from other networks.',
      open: 'Open Swap',
      does: [
        { title: 'Swap', line: 'Pick two coins and an amount; the price, what you get and the fee show before you sign.' },
        { title: 'Quick amounts', line: '25%, 50%, 75% or Max of what your wallet holds.' },
        { title: 'Bridge', line: 'Send from another network to Solana, or back, to your address or another one.' },
        { title: 'My transfers', line: 'Every bridge transfer of yours in one list.' },
      ],
      more: [
        { title: 'Where the price comes from', text: ['Swaps go through Jupiter, which looks for the best route across Solana.'] },
        { title: 'What it costs', text: ['Ryntra’s fee shows on one line before you sign. A bridge transfer shows its own cost before you send.'] },
      ],
    },
    uk: {
      title: 'Обмін і Міст',
      line: 'Будь-яка монета на будь-яку в Solana — і гроші з інших мереж.',
      open: 'Відкрити Обмін',
      does: [
        { title: 'Обмін', line: 'Обери дві монети й суму — ціну, що отримаєш, і комісію видно до підпису.' },
        { title: 'Швидкі суми', line: '25 %, 50 %, 75 % чи все, що є в гаманці.' },
        { title: 'Міст', line: 'Надішли з іншої мережі в Solana чи назад — на свою адресу або іншу.' },
        { title: 'Мої перекази', line: 'Усі твої перекази мостом — одним списком.' },
      ],
      more: [
        { title: 'Звідки ціна', text: ['Обмін іде через Jupiter — він шукає найкращий маршрут у Solana.'] },
        { title: 'Скільки це коштує', text: ['Комісію Ryntra видно одним рядком до підпису. Переказ мостом показує свою вартість до відправки.'] },
      ],
    },
  },
  {
    id: 'spot',
    group: 'terminal',
    shot: 'spot',
    href: `/coin/${SOL}`,
    en: {
      title: 'Spot',
      line: 'A coin’s own desk: the chart, its trades and a ticket with market, limit and stop orders.',
      open: 'Open SOL',
      does: [
        { title: 'Chart', line: 'Candles from one minute to one day, price or market cap, with indicators.' },
        { title: 'Market, Limit, Stop', line: 'Buy or sell now, at your price, or when the price falls to your stop.' },
        { title: 'Coin facts', line: 'Holders, the top 10’s share, the creator and whether the coin can be minted or frozen.' },
        { title: 'Trades and liquidity', line: 'The coin’s latest trades and its liquidity.' },
      ],
      more: [
        { title: 'Limit orders on Meteora', text: ['Where a coin has a Meteora DLMM Pro pool, a limit order rests inside it and earns a bonus when it fills. See Meteora in Ryntra.'] },
        { title: 'What it costs', text: ['The fee and the slippage show on one line before you sign.'] },
      ],
    },
    uk: {
      title: 'Спот',
      line: 'Торговий стіл монети: графік, угоди й квиток з ринковим, лімітним і стоп-ордером.',
      open: 'Відкрити SOL',
      does: [
        { title: 'Графік', line: 'Свічки від хвилини до дня, ціна чи капіталізація, з індикаторами.' },
        { title: 'Ринок, Ліміт, Стоп', line: 'Купи чи продай зараз, за своєю ціною або коли ціна впаде до стопу.' },
        { title: 'Факти монети', line: 'Власники, частка топ-10, творець і чи можна монету довипустити або заморозити.' },
        { title: 'Угоди й ліквідність', line: 'Останні угоди монети і її ліквідність.' },
      ],
      more: [
        { title: 'Лімітки на Meteora', text: ['Де в монети є пул Meteora DLMM Pro, лімітка стоїть усередині нього й отримує бонус, коли виконується. Докладно — «Meteora в Ryntra».'] },
        { title: 'Скільки це коштує', text: ['Комісію й прослизання видно одним рядком до підпису.'] },
      ],
    },
  },
  {
    id: 'launch',
    group: 'terminal',
    shot: 'launch',
    href: '/launch',
    en: {
      title: 'Launch',
      line: 'A coin in a minute: a picture, a name, a ticker and one signature.',
      open: 'Launch a coin',
      does: [
        { title: 'On the curve', line: 'A fair launch on Meteora’s curve; the coin moves to a pool by itself as it grows.' },
        { title: 'Straight to a pool', line: 'Or open the coin right away in a Meteora DLMM Pro pool.' },
        { title: 'When trading opens', line: 'At once, or in fifteen minutes, an hour or six hours.' },
        { title: 'My coins', line: 'The coins you launched, in one tab.' },
      ],
      more: [
        { title: 'What it costs', text: ['There is no launch fee. Each trade of your coin pays a fee, and part of it is yours — the share is on the form before you sign.'] },
        { title: 'Built in', text: ['A fee against early snipers that falls over time, and liquidity locked on Meteora — nothing to set.'] },
        { title: 'Say it', text: ['Tell the agent «Launch me a token» — it fills the form; you sign.'] },
        { title: 'Honestly', text: ['Most new coins lose value.'] },
      ],
    },
    uk: {
      title: 'Запуск',
      line: 'Монета за хвилину: картинка, назва, тікер і один підпис.',
      open: 'Запустити монету',
      does: [
        { title: 'На кривій', line: 'Чесний запуск на кривій Meteora; монета сама переходить у пул, коли росте.' },
        { title: 'Одразу в пул', line: 'Або відкрий монету одразу в пулі Meteora DLMM Pro.' },
        { title: 'Коли відкриються торги', line: 'Одразу, за п’ятнадцять хвилин, за годину чи за шість.' },
        { title: 'Мої монети', line: 'Монети, які ти запустив, — на одній вкладці.' },
      ],
      more: [
        { title: 'Скільки це коштує', text: ['Плати за запуск немає. Кожна угода твоєю монетою платить комісію, і частина її — твоя: частку видно у формі до підпису.'] },
        { title: 'Уже всередині', text: ['Комісія проти ранніх снайперів, що спадає з часом, і ліквідність, замкнена на Meteora, — без налаштувань.'] },
        { title: 'Скажи', text: ['Скажи агентові «Запусти мені токен» — він заповнить форму, ти підпишеш.'] },
        { title: 'Чесно', text: ['Більшість нових монет втрачає в ціні.'] },
      ],
    },
  },
  {
    id: 'bots',
    group: 'terminal',
    shot: 'bots',
    href: '/bots/recurring',
    en: {
      title: 'Bots',
      line: 'Automation by your rules. Run one or several at once; each stops on its own.',
      open: 'Open Bots',
      does: [
        { title: 'Recurring buys', line: 'Buys a coin by itself on your budget a day, for as many days as you set.' },
        { title: 'Grid', line: 'Buys lower and sells higher inside your price band, on Meteora.' },
        { title: 'Order ladder', line: 'Several limit orders at once, with one signature.' },
        { title: 'Money autopilot', line: 'One plan for your whole budget: trading, savings and what stays in your wallet.' },
        { title: 'Signals', line: 'Buys as the trend turns up and sells as it turns down — on paper, with no money.' },
      ],
      more: [
        { title: 'Practice first', text: ['Try a bot on paper with the market’s own prices before real money.'] },
        { title: 'What it costs', text: ['Each bot shows its fee before you start.'] },
        { title: 'Honestly', text: ['A bot can end in minus. Stop it anytime; your keys stay yours.'] },
      ],
      coming: ['Signals with real money', 'Copy a wallet', 'Pool keeper'],
    },
    uk: {
      title: 'Боти',
      line: 'Автоматизація за твоїми правилами. Запускай одного чи кількох — кожен зупиняється окремо.',
      open: 'Відкрити Боти',
      does: [
        { title: 'Регулярні покупки', line: 'Купує монету сам на твій бюджет на день — стільки днів, скільки задаси.' },
        { title: 'Сітка', line: 'Купує нижче й продає вище в межах твоїх цін — на Meteora.' },
        { title: 'Драбина ордерів', line: 'Кілька ліміток одразу — одним підписом.' },
        { title: 'Автопілот грошей', line: 'Один план на весь бюджет: торгівля, заощадження й те, що лишається в гаманці.' },
        { title: 'Сигнали', line: 'Купує, коли тренд повертає вгору, й продає, коли вниз, — на папері, без грошей.' },
      ],
      more: [
        { title: 'Спершу практика', text: ['Спробуй бота на папері за справжніми цінами ринку — до справжніх грошей.'] },
        { title: 'Скільки це коштує', text: ['Кожен бот показує свою комісію до старту.'] },
        { title: 'Чесно', text: ['Бот може закінчити в мінусі. Зупини будь-коли; ключі лишаються в тебе.'] },
      ],
      coming: ['Сигнали зі справжніми грошима', 'Повтор за гаманцем', 'Доглядач пулу'],
    },
  },
  {
    id: 'agent',
    group: 'terminal',
    shot: 'agent',
    href: '/agent',
    en: {
      title: 'Agents',
      line: 'AI that understands you. Ask about any coin, or say what to do.',
      open: 'Ask the Analyst',
      does: [
        { title: 'Analyst', line: 'Answers about any coin or the market: «How is SOL today?», «Why is JUP moving?».' },
        { title: 'One sentence', line: 'On every screen: say what you want; the agent opens the screen and fills it in.' },
        { title: 'Advice only', line: 'The Analyst explains and advises. You decide, and you sign.' },
      ],
      more: [
        { title: 'Bot or agent?', text: ['Bots follow your rules. Agents are AI: they read your words and the market.'] },
      ],
      coming: ['AI trader', 'Scout', 'Your own AI'],
    },
    uk: {
      title: 'Агенти',
      line: 'AI, що тебе розуміє. Запитай про будь-яку монету або скажи, що зробити.',
      open: 'Запитати Аналітика',
      does: [
        { title: 'Аналітик', line: 'Відповідає про будь-яку монету чи ринок: «Як SOL сьогодні?», «Чому рухається JUP?».' },
        { title: 'Одне речення', line: 'На кожному екрані: скажи, чого хочеш, — агент відкриє екран і заповнить його.' },
        { title: 'Лише порада', line: 'Аналітик пояснює й радить. Вирішуєш і підписуєш ти.' },
      ],
      more: [
        { title: 'Бот чи агент?', text: ['Боти виконують твої правила. Агенти — це AI: читають твої слова й ринок.'] },
      ],
      coming: ['AI-трейдер', 'Скаут', 'Свій AI'],
    },
  },
  {
    id: 'earn',
    group: 'terminal',
    shot: 'earn',
    href: '/earn',
    en: {
      title: 'Earn',
      line: 'Put coins to work: Meteora pools, SOL staking and lending. The position stays in your wallet.',
      open: 'Open Earn',
      does: [
        { title: 'Pools', line: 'Meteora DLMM and DAMM v2 pools, sorted by the fees they made in a day.' },
        { title: 'DLMM Pro', line: 'Meteora’s newest pools, where limit orders earn a bonus — a tab of Earn.' },
        { title: 'Your goal, not settings', line: 'Even, near the price, catch moves or your own shape; a wide, medium or narrow range.' },
        { title: 'Staking and lending', line: 'Liquid staking of SOL, and stablecoins or SOL in Jupiter Lend.' },
        { title: 'My positions', line: 'What you put in and what it earns, in one tab.' },
      ],
      more: [
        { title: 'Where the figures come from', text: ['Fees, liquidity and yearly rates are read live from the pools and the protocols. A past day is not a promise.'] },
        { title: 'Honestly', text: ['A pool can lose value against simply holding when the price moves.'] },
      ],
    },
    uk: {
      title: 'Заробіток',
      line: 'Поклади монети працювати: пули Meteora, стейкінг SOL і позики. Позиція — у твоєму гаманці.',
      open: 'Відкрити Заробіток',
      does: [
        { title: 'Пули', line: 'Пули Meteora DLMM і DAMM v2 — за комісіями, які вони заробили за день.' },
        { title: 'DLMM Pro', line: 'Найновіші пули Meteora, де лімітки отримують бонус, — вкладка «Заробітку».' },
        { title: 'Мета, а не налаштування', line: 'Рівно, біля ціни, ловити рухи чи своя форма; широкий, середній або вузький діапазон.' },
        { title: 'Стейкінг і позики', line: 'Ліквідний стейкінг SOL, а стейблкоїни чи SOL — у Jupiter Lend.' },
        { title: 'Мої позиції', line: 'Що ти вклав і скільки воно заробляє — на одній вкладці.' },
      ],
      more: [
        { title: 'Звідки цифри', text: ['Комісії, ліквідність і річні ставки читаються наживо з пулів і протоколів. Минулий день — не обіцянка.'] },
        { title: 'Чесно', text: ['Пул може відстати від простого тримання, коли ціна рухається.'] },
      ],
    },
  },
  {
    id: 'portfolio',
    group: 'terminal',
    shot: 'portfolio',
    href: '/portfolio',
    en: {
      title: 'Portfolio',
      line: 'Everything a wallet holds across Solana, on one page.',
      open: 'Open Portfolio',
      does: [
        { title: 'The whole wallet', line: 'Coins, pools, staking, deposits and loans — with the total.' },
        { title: 'Collect fees', line: 'Collect what your pool positions earned.' },
        { title: 'Exit everything', line: 'Leave your positions in one go.' },
        { title: 'Clean wallet', line: 'Tidy up the dust of small balances.' },
      ],
      more: [
        { title: 'Tabs', text: ['Overview, Positions, History and Saved coins.'] },
      ],
    },
    uk: {
      title: 'Портфель',
      line: 'Усе, що тримає гаманець у Solana, — на одній сторінці.',
      open: 'Відкрити Портфель',
      does: [
        { title: 'Увесь гаманець', line: 'Монети, пули, стейкінг, вклади й позики — з підсумком.' },
        { title: 'Забрати комісії', line: 'Забери те, що заробили твої позиції в пулах.' },
        { title: 'Вийти з усього', line: 'Залиш позиції одним заходом.' },
        { title: 'Очистити гаманець', line: 'Прибери пил дрібних залишків.' },
      ],
      more: [
        { title: 'Вкладки', text: ['Огляд, Позиції, Історія й Обрані монети.'] },
      ],
    },
  },
  {
    id: 'money',
    group: 'terminal',
    shot: 'money',
    href: '/money',
    en: {
      title: 'Money',
      line: 'Send, receive and ask for a payment.',
      open: 'Open Money',
      does: [
        { title: 'Send', line: 'To any Solana address, with the amount you choose.' },
        { title: 'Receive', line: 'Your address and its QR code.' },
        { title: 'Invoices', line: 'A payment link for what someone owes you.' },
        { title: 'Recent transfers', line: 'What you sent and received, in one list.' },
      ],
      more: [],
      coming: ['Send privately', 'Contacts', 'Autopay'],
    },
    uk: {
      title: 'Гроші',
      line: 'Надіслати, отримати й попросити оплату.',
      open: 'Відкрити Гроші',
      does: [
        { title: 'Надіслати', line: 'На будь-яку адресу Solana, будь-яку суму.' },
        { title: 'Отримати', line: 'Твоя адреса і її QR-код.' },
        { title: 'Рахунки', line: 'Посилання на оплату того, що тобі винні.' },
        { title: 'Останні перекази', line: 'Що ти надіслав і отримав — одним списком.' },
      ],
      more: [],
      coming: ['Надіслати приватно', 'Контакти', 'Автоплатежі'],
    },
  },
  {
    id: 'rewards',
    group: 'terminal',
    shot: 'rewards',
    href: '/rewards',
    en: {
      title: 'Rewards',
      line: 'Points for trading, and a share of the fees of friends you bring.',
      open: 'Open Rewards',
      does: [
        { title: 'Points', line: 'For every trade, for each day you trade and for friends who trade.' },
        { title: 'Rank', line: 'Your rank over thirty days lifts your share of a friend’s fee.' },
        { title: 'Invite a friend', line: 'Your link to share.' },
      ],
      more: [{ title: 'Where the numbers are', text: ['The points for each action and the share for each rank are on the Rewards screen.'] }],
    },
    uk: {
      title: 'Винагороди',
      line: 'Бали за торгівлю й частка комісій друзів, яких ти привів.',
      open: 'Відкрити Винагороди',
      does: [
        { title: 'Бали', line: 'За кожну угоду, за кожен день торгівлі й за друзів, що торгують.' },
        { title: 'Рівень', line: 'Твій рівень за тридцять днів збільшує частку з комісії друга.' },
        { title: 'Запросити друга', line: 'Твоє посилання, щоб поділитися.' },
      ],
      more: [{ title: 'Де цифри', text: ['Бали за кожну дію й частка кожного рівня — на екрані «Винагороди».'] }],
    },
  },
  {
    id: 'meteora',
    group: 'meteora',
    /* Each part below carries its own frame. */
    shot: null,
    href: '/pro',
    en: {
      title: 'Meteora in Ryntra',
      line: 'Ryntra is built on Meteora: coins launch on its curve, pools earn its fees, and DLMM Pro limit orders pay a bonus.',
      open: 'Open DLMM Pro',
      does: [],
      more: [
        { title: 'What Meteora is', text: ['Meteora runs liquidity on Solana: the launch curve, DLMM and DAMM v2 pools, and DLMM Pro — its newest pool.'] },
        { title: 'What the agent does', text: ['Say it: «Launch me a token», «Buy MET for 10 USDC». The agent opens the Meteora screen and fills it in; you sign.'] },
      ],
    },
    uk: {
      title: 'Meteora в Ryntra',
      line: 'Ryntra стоїть на Meteora: монети запускаються на її кривій, пули заробляють її комісії, а лімітки DLMM Pro платять бонус.',
      open: 'Відкрити DLMM Pro',
      does: [],
      more: [
        { title: 'Що таке Meteora', text: ['Meteora тримає ліквідність у Solana: криву запуску, пули DLMM і DAMM v2 і найновіший — DLMM Pro.'] },
        { title: 'Що робить агент', text: ['Скажи: «Запусти мені токен», «Купи MET на 10 USDC». Агент відкриє екран Meteora й заповнить його, ти підпишеш.'] },
      ],
    },
    parts: [
      {
        key: 'launch',
        shot: 'launch',
        href: '/launch',
        live: true,
        en: {
          title: 'Launch on Meteora',
          line: 'A coin on Meteora’s launch curve, or straight into a DLMM Pro pool — one signature.',
          more: ['On the curve the coin moves to a Meteora pool by itself as it grows, and its liquidity is locked.', 'Straight to a pool, it trades in a DLMM Pro pool from the start; you choose when trading opens.'],
        },
        uk: {
          title: 'Запуск на Meteora',
          line: 'Монета на кривій запуску Meteora або одразу в пулі DLMM Pro — одним підписом.',
          more: ['На кривій монета сама переходить у пул Meteora, коли росте, а її ліквідність замкнено.', 'Одразу в пулі — торгується в пулі DLMM Pro від першої хвилини; коли відкрити торги, обираєш ти.'],
        },
      },
      {
        key: 'pools',
        shot: 'earn',
        href: '/earn',
        live: true,
        en: {
          title: 'Pools: DLMM and DAMM v2',
          line: 'Every pool with its fees for the day, liquidity and type — put coins in by your goal.',
          more: ['DLMM holds liquidity in price bins; DAMM v2 is a classic pool with a full or a focused range.', 'You choose the goal and the width of the range; the screen shows the shape before you sign.', 'Every pool has its own page: add a position, place a limit order or swap.'],
        },
        uk: {
          title: 'Пули: DLMM і DAMM v2',
          line: 'Кожен пул з комісіями за день, ліквідністю й типом — вклади монети за своєю метою.',
          more: ['DLMM тримає ліквідність у цінових бінах; DAMM v2 — класичний пул з повним чи вужчим діапазоном.', 'Ти обираєш мету й ширину діапазону; форму позиції видно до підпису.', 'У кожного пулу — своя сторінка: додати позицію, поставити лімітку чи обміняти.'],
        },
      },
      {
        key: 'pro',
        shot: 'pro',
        href: '/pro',
        live: true,
        en: {
          title: 'DLMM Pro pools',
          line: 'Every DLMM Pro pool on Solana, read straight from the program: price, liquidity, fee and the limit bonus.',
          more: ['DLMM Pro is Meteora’s newest pool: limit orders live inside the pool itself.', 'Pools of new launches are marked.', 'Put liquidity in by a goal, or draw your own shape on a grid of prices.'],
        },
        uk: {
          title: 'Пули DLMM Pro',
          line: 'Усі пули DLMM Pro в Solana, прочитані просто з програми: ціна, ліквідність, комісія й бонус лімітки.',
          more: ['DLMM Pro — найновіший пул Meteora: лімітки живуть усередині самого пулу.', 'Пули нових запусків позначено.', 'Вклади ліквідність за метою або намалюй свою форму на сітці цін.'],
        },
      },
      {
        key: 'limits',
        shot: 'pool',
        href: '/pro',
        live: true,
        en: {
          title: 'Limit orders that pay',
          line: 'A limit order rests on one exact price inside the pool and earns a share of the pool’s fee when it fills.',
          more: ['A filled order gets the coin it asked for at that price, with no slippage.', 'The bonus shows before you sign. Each pool’s page has its liquidity by price, its book and trades, and three tabs: Position, Limit, Swap.', 'Switch on «Agent collects what fills» and the agent takes the filled coins to your wallet for you.'],
        },
        uk: {
          title: 'Лімітки, що платять',
          line: 'Лімітка стоїть на одній точній ціні в пулі й отримує частку комісії пулу, коли виконується.',
          more: ['Виконана лімітка отримує монету саме за своєю ціною, без прослизання.', 'Бонус видно до підпису. На сторінці кожного пулу — ліквідність за цінами, книга й угоди та три вкладки: «Позиція», «Ліміт», «Обмін».', 'Увімкни «Агент збере виконане» — і агент сам забере виконані монети в твій гаманець.'],
        },
      },
      {
        key: 'grid',
        shot: 'grid',
        href: '/bots/grid',
        live: true,
        en: {
          title: 'Grid',
          line: 'A grid bot on Meteora: buy lines below the price, sell lines above, all on the chart.',
          more: ['Choose the coin, the amount, the low and high price and how many levels.', 'Where the coin has a DLMM Pro pool, every filled level also earns the limit bonus.'],
        },
        uk: {
          title: 'Сітка',
          line: 'Грід-бот на Meteora: лінії купівлі нижче ціни, продажу — вище, усе на графіку.',
          more: ['Обери монету, суму, нижню й верхню ціну та кількість рівнів.', 'Де в монети є пул DLMM Pro, кожен виконаний рівень ще й отримує бонус лімітки.'],
        },
      },
      {
        key: 'ladder',
        shot: 'ladder',
        href: '/bots/ladder',
        live: true,
        en: {
          title: 'Order ladder',
          line: 'Several limit orders on a coin’s Meteora pool at once — buy lower or sell higher — with one signature.',
        },
        uk: {
          title: 'Драбина ордерів',
          line: 'Кілька ліміток у пулі монети на Meteora одразу — купити нижче чи продати вище — одним підписом.',
        },
      },
      {
        key: 'care',
        shot: null,
        href: null,
        live: false,
        en: {
          title: 'The agent looks after your position',
          line: 'Collect fees, put them back and keep the range near the price — while you are away.',
        },
        uk: {
          title: 'Агент доглядає позицію',
          line: 'Забирати комісії, вкладати їх назад і тримати діапазон біля ціни — поки тебе немає.',
        },
      },
    ],
  },
  {
    id: 'keys',
    group: 'trust',
    shot: null,
    href: null,
    en: {
      title: 'Keys stay yours',
      line: 'Your wallet signs every move. Ryntra never holds your keys.',
      open: 'Open Ryntra',
      does: [
        { title: 'You sign', line: 'Every swap, launch, order and bot starts with your signature in your wallet.' },
        { title: 'You see it first', line: 'What you get, the least you get and the fee — on one line before you sign.' },
        { title: 'Your budget', line: 'A bot works inside the budget you set and stops when you say.' },
        { title: 'Coin facts', line: 'Holders, the top 10’s share, the creator and the coin’s rights before you buy.' },
      ],
      more: [
        { title: 'Positions', text: ['Pool, staking and lending positions are in your wallet, not with Ryntra.'] },
        { title: 'Risks', text: ['Prices move and most new coins lose value. A bot or a pool can end in minus. Use only what you can lose.'] },
        { title: 'Never share', text: ['No one from Ryntra will ever ask for your seed phrase.'] },
      ],
    },
    uk: {
      title: 'Ключі в тебе',
      line: 'Кожну дію підписує твій гаманець. Ryntra ніколи не тримає твоїх ключів.',
      open: 'Відкрити Ryntra',
      does: [
        { title: 'Підписуєш ти', line: 'Кожен обмін, запуск, ордер і бот починається з твого підпису в гаманці.' },
        { title: 'Бачиш наперед', line: 'Що отримаєш, щонайменше скільки й комісію — одним рядком до підпису.' },
        { title: 'Твій бюджет', line: 'Бот працює в межах бюджету, який задаєш ти, і зупиняється, коли скажеш.' },
        { title: 'Факти монети', line: 'Власники, частка топ-10, творець і права монети — до покупки.' },
      ],
      more: [
        { title: 'Позиції', text: ['Позиції в пулах, стейкінгу й позиках — у твоєму гаманці, не в Ryntra.'] },
        { title: 'Ризики', text: ['Ціни рухаються, більшість нових монет втрачає в ціні. Бот чи пул може закінчити в мінусі. Вкладай лише те, що готовий втратити.'] },
        { title: 'Нікому не кажи', text: ['Ніхто з Ryntra ніколи не попросить твою сід-фразу.'] },
      ],
    },
  },
  {
    id: 'help',
    group: 'trust',
    shot: null,
    href: '/support',
    en: {
      title: 'Questions',
      line: 'Short answers to what people ask first.',
      open: 'Write to us',
      does: [],
      more: [
        { title: 'Do I need an account?', text: ['No. Connect a Solana wallet — that is your account.'] },
        { title: 'How do I stop a bot?', text: ['Open Bots, find it under My bots and stop it. Each bot stops on its own.'] },
        { title: 'Where are my pool positions?', text: ['In your wallet. Earn and Portfolio show them.'] },
        { title: 'Why does a fee line change?', text: ['The fee depends on the coin and the route. The line before you sign is the one that counts.'] },
        { title: 'Something went wrong', text: ['Write to us from the Help page with what you did and your wallet address. Never send your seed phrase.'] },
      ],
    },
    uk: {
      title: 'Питання',
      line: 'Короткі відповіді на те, що питають найперше.',
      open: 'Написати нам',
      does: [],
      more: [
        { title: 'Чи потрібен акаунт?', text: ['Ні. Підключи гаманець Solana — це і є твій акаунт.'] },
        { title: 'Як зупинити бота?', text: ['Відкрий «Боти», знайди його в «Моїх ботах» і зупини. Кожен бот зупиняється окремо.'] },
        { title: 'Де мої позиції в пулах?', text: ['У твоєму гаманці. Їх показують «Заробіток» і «Портфель».'] },
        { title: 'Чому змінюється рядок комісії?', text: ['Комісія залежить від монети й маршруту. Важить той рядок, що перед підписом.'] },
        { title: 'Щось пішло не так', text: ['Напиши нам зі сторінки «Допомога»: що робив і адресу гаманця. Сід-фразу не надсилай ніколи.'] },
      ],
    },
  },
];

export function sectionOf(id: SectionId): Section {
  return SECTIONS.find((section) => section.id === id)!;
}

/** The order a reader walks the sections: the hub's order, for «Previous» and «Next». */
export function neighbours(id: SectionId): Readonly<{ prev: SectionId | null; next: SectionId | null }> {
  const at = SECTION_IDS.indexOf(id);
  return { prev: at > 0 ? SECTION_IDS[at - 1]! : null, next: at < SECTION_IDS.length - 1 ? SECTION_IDS[at + 1]! : null };
}

/** «Where we're going» on the hub: three things that are coming, words only — the roadmap has the rest. */
export const AHEAD: Readonly<Record<Lang, readonly Do[]>> = {
  en: [
    { title: 'Ryntra Private', line: 'A private balance on the same screens — send, swap and earn privately.' },
    { title: 'Stocks', line: 'Buy stocks at the exchange price through Sunrise, put them in Meteora pools, launch a coin paired with a stock.' },
    { title: 'Agents that act', line: 'An AI trader that exits on its own, a scout and your own AI — inside the budget you sign.' },
  ],
  uk: [
    { title: 'Ryntra Private', line: 'Приватний баланс на тих самих екранах — надсилати, обмінювати й заробляти приватно.' },
    { title: 'Акції', line: 'Купити акції за ціною біржі через Sunrise, покласти в пули Meteora, запустити монету в парі з акцією.' },
    { title: 'Агенти, що діють', line: 'AI-трейдер, що сам виходить з угод, скаут і свій AI — у межах бюджету, який ти підписуєш.' },
  ],
};

/** The pages' own words. */
export const UI = {
  en: {
    docs: 'Docs',
    hubTitle: 'Ryntra docs',
    motto: 'Say it. Your agent does the rest.',
    hubLine: 'An AI terminal on Solana. What it does today, how, and where it is going.',
    start: 'Start here',
    featured: 'Our strongest part',
    ahead: 'Where we’re going',
    roadmap: 'Open the roadmap',
    canDo: 'What you can do',
    coming: 'Coming',
    live: 'Live',
    prev: 'Previous',
    next: 'Next',
    more: 'More',
    language: 'Language',
    sections: 'Sections',
    shotAlt: (title: string) => `${title} on ryntra.io`,
    open: 'Open',
  },
  uk: {
    docs: 'Документи',
    hubTitle: 'Документи Ryntra',
    motto: 'Скажи. Твій агент зробить решту.',
    hubLine: 'AI-термінал на Solana. Що він уміє сьогодні, як це працює і куди ми рухаємось.',
    start: 'Почни звідси',
    featured: 'Наша найсильніша частина',
    ahead: 'Куди рухаємось',
    roadmap: 'Відкрити дорожню карту',
    canDo: 'Що можна зробити',
    coming: 'Будується',
    live: 'Наживо',
    prev: 'Назад',
    next: 'Далі',
    more: 'Докладніше',
    language: 'Мова',
    sections: 'Розділи',
    shotAlt: (title: string) => `${title} на ryntra.io`,
    open: 'Відкрити',
  },
} as const;
