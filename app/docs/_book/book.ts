/**
 * Ryntra's documentation for the terminal: what a person who sees Ryntra for the first time reads. Pure data in two
 * languages, no React, so the pages, the tests and the build read the same words.
 *
 * - **Live means open to people on ryntra.io today.** What stands behind a switch or is still being built is a «coming»
 *   line, never a section of its own; `book.test.mjs` holds every «open» link to a screen the terminal serves.
 * - **Every section answers four questions:** what it is (the line), what you can do now (`does`), how — three to five
 *   steps (`how`), and what is coming. The honest limit is one line (`honest`); the words a newcomer may not know wait
 *   behind «Words used here» (`words`), the rest behind a few quiet disclosures (`more`).
 * - **Plain words.** Short sentences, no jargon; a term is explained where it first appears.
 * - **Honest words.** «Privately», never «anonymously»; no promise of profit, multiples or dates; no fee, rate or share
 *   the site itself does not show; examples name SOL, JUP and MET only; Ryntra's products only. Every sentence for the
 *   agent quoted here was typed on the live site and opened the screen it says.
 * - **Frames** are cut from the live site with no wallet connected (`shots.mjs` here): desk 1440×900 and phone 390×844,
 *   English and Ukrainian, in `public/docs/shots/`.
 */

export type Lang = 'en' | 'uk';

/** A frame of the live site: `public/docs/shots/<shot>-<desk|phone>-<lang>.webp`. */
export const SHOT_IDS = ['market', 'market-table', 'say', 'trade', 'bridge', 'spot', 'stocks', 'launch', 'bots', 'grid', 'ladder', 'agent', 'earn', 'pro', 'pool', 'stock-pool', 'portfolio', 'money', 'rewards'] as const;
export type ShotId = (typeof SHOT_IDS)[number];

export function shotSrc(shot: ShotId, size: 'desk' | 'phone', lang: Lang): string {
  return `/docs/shots/${shot}-${size}-${lang}.webp`;
}

/** A sentence quoted in the reader's language: “…” in English, «…» in Ukrainian (the eyes' pass of 20.11). */
export function quoted(text: string, lang: Lang): string {
  return lang === 'uk' ? `«${text}»` : `“${text}”`;
}

/** One thing a person can do: a short title and one line. A word explained: the word and what it means. */
export type Do = Readonly<{ title: string; line: string }>;
/** One quiet disclosure: its name and a few short sentences. */
export type More = Readonly<{ title: string; text: readonly string[] }>;

export type SectionWords = Readonly<{
  title: string;
  /** What it is, in one line under the title; the card's line on the hub. */
  line: string;
  /** The label of the one amber action that opens the screen. */
  open: string;
  /** What you can do right now. */
  does: readonly Do[];
  /** How: three to five short steps, in the order a person takes them. */
  how: readonly string[];
  /** The honest limit, one line. */
  honest?: string;
  /** Words a newcomer may not know, explained — behind «Words used here». */
  words?: readonly Do[];
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

export const SECTION_IDS = ['start', 'say', 'market', 'trade', 'spot', 'stocks', 'launch', 'bots', 'agent', 'earn', 'portfolio', 'money', 'rewards', 'meteora', 'keys', 'help'] as const;
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
 * The addresses the city's documentation had and the section that covers the same ground now: a kept link still lands
 * on a page that answers. The old handbook's chapters lead to these addresses first (next.config.ts).
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

/** What each frame shows, one line under it. */
export const CAPTIONS: Readonly<Record<Lang, Readonly<Record<ShotId, string>>>> = {
  en: {
    market: 'The Market: the agent’s line on top, the Pulse of new coins and the doors to every section.',
    'market-table': 'The table of every coin: a tab for each kind of asset, lists, filters and columns.',
    say: '“Buy JUP for 1 SOL” typed in the agent’s line: JUP’s page opened, ready to buy for 1 SOL.',
    trade: 'Swap: what you pay, what you get, quick amounts — and the coin’s price beside the form.',
    bridge: 'Bridge: money from another network into Solana.',
    spot: 'SOL’s page: the chart, the latest trades, holders and the buy and sell form.',
    stocks: 'The Stocks tab of the Market: tokenized stocks with their price and volume, and whether the exchange is open.',
    launch: 'Launch: a picture, a name and a ticker, and a preview of how people will see your coin.',
    bots: 'Recurring buys: the form, the coin’s chart beside it, and your bots below.',
    grid: 'Grid: the buy and sell levels drawn on the coin’s chart.',
    ladder: 'Order ladder: several limit orders at once, each price drawn on the chart.',
    agent: 'The Analyst: ask about a coin or the market in your own words.',
    earn: 'Earn: Meteora pools sorted by the fees they made, with quick filters.',
    pro: 'DLMM Pro: every pool with its price, liquidity, fee and limit bonus.',
    pool: 'A pool’s page: the chart, liquidity by price, the book and trades, and the order form.',
    'stock-pool': 'A stock’s DLMM Pro pool on its Position tab: whether the exchange is open, the goal and the range; the issuer’s line stands above the sign button.',
    portfolio: 'Portfolio: everything a wallet holds — connect yours, or look at any address.',
    money: 'Money: send to an address or a name, receive with a QR code, or ask for a payment.',
    rewards: 'Rewards: your points, your rank over thirty days and your invite link.',
  },
  uk: {
    market: 'Ринок: рядок агента вгорі, «Пульс» нових монет і двері до кожного розділу.',
    'market-table': 'Таблиця всіх монет: вкладка на кожен вид активу, списки, фільтри й колонки.',
    say: '«Купи JUP на 1 SOL» у рядку агента: відкрилась сторінка JUP, готова до купівлі на 1 SOL.',
    trade: 'Обмін: що платиш, що отримаєш, швидкі суми — і ціна монети поруч із формою.',
    bridge: 'Міст: гроші з іншої мережі в Solana.',
    spot: 'Сторінка SOL: графік, останні угоди, власники й форма купівлі та продажу.',
    stocks: 'Вкладка «Акції» на Ринку: токенізовані акції з ціною й обігом — і чи відкрита біржа.',
    launch: 'Запуск: картинка, назва й тікер — і як люди побачать твою монету.',
    bots: 'Регулярні покупки: форма, поруч графік монети, нижче — твої боти.',
    grid: 'Сітка: рівні купівлі й продажу просто на графіку монети.',
    ladder: 'Драбина ордерів: кілька ліміток одразу, кожна ціна — на графіку.',
    agent: 'Аналітик: запитай про монету чи ринок своїми словами.',
    earn: 'Заробіток: пули Meteora за комісіями, які вони заробили, і швидкі фільтри.',
    pro: 'DLMM Pro: кожен пул з ціною, ліквідністю, комісією й бонусом лімітки.',
    pool: 'Сторінка пулу: графік, ліквідність за цінами, книга й угоди та форма ордера.',
    'stock-pool': 'Пул DLMM Pro акції на вкладці «Позиція»: чи відкрита біржа, мета й діапазон; рядок про права емітента — над кнопкою підпису.',
    portfolio: 'Портфель: усе, що тримає гаманець, — підключи свій або подивись будь-яку адресу.',
    money: 'Гроші: надішли на адресу чи ім’я, отримай за QR-кодом або попроси оплату.',
    rewards: 'Винагороди: твої бали, рівень за тридцять днів і посилання для друзів.',
  },
};

/** Sentences the agent understands, each typed on the live site: the hub shows them, «Say it» explains them. */
export const SAY_EXAMPLES: Readonly<Record<Lang, readonly string[]>> = {
  en: ['Buy JUP for 1 SOL', 'Swap 10 USDC to SOL', 'Trade JUP every day', 'Launch me a token', 'How is SOL today?'],
  uk: ['Купи JUP на 1 SOL', 'Обміняй 10 USDC на SOL', 'Торгуй JUP щодня', 'Запусти мені токен', 'Як SOL сьогодні?'],
};

/** «Start in a minute» on the hub: the three steps before anything else. */
export const QUICK: Readonly<Record<Lang, readonly Do[]>> = {
  en: [
    { title: 'Connect a wallet', line: 'A Solana wallet is your account. No sign-up, no email, no password.' },
    { title: 'Say what you want', line: 'Type it in the line at the top, or open a section from the menu.' },
    { title: 'Check and sign', line: 'Read the line with what you get and the fee, then sign in your wallet.' },
  ],
  uk: [
    { title: 'Підключи гаманець', line: 'Гаманець Solana — це і є твій акаунт. Без реєстрації, пошти й пароля.' },
    { title: 'Скажи, чого хочеш', line: 'Напиши в рядку вгорі або відкрий розділ у меню.' },
    { title: 'Перевір і підпиши', line: 'Прочитай рядок з тим, що отримаєш, і комісією — і підпиши в гаманці.' },
  ],
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
      line: 'An AI terminal on Solana. Say what you want — your agent opens the right screen and fills it in. You sign.',
      open: 'Open Ryntra',
      does: [
        { title: 'Say it', line: 'Type “Buy JUP for 1 SOL” and the agent opens JUP’s page with the amount filled in.' },
        { title: 'Trade', line: 'Swap any coin for any other, or set your own price with a limit order.' },
        { title: 'Launch', line: 'Put your own coin on Meteora with a picture, a name and one signature.' },
        { title: 'Let bots work', line: 'Recurring buys, a grid or a ladder of orders — by your rules, stopped anytime.' },
        { title: 'Earn', line: 'Put coins into Meteora pools, stake SOL or lend — only your wallet can withdraw.' },
      ],
      how: [
        'Open ryntra.io and connect a Solana wallet. That is your account — there is no sign-up.',
        'Type what you want in “Tell your agent what to do”, or pick a section in the menu on the left.',
        'Check the line before you sign: what you get, the least you get and the fee.',
        'Sign in your wallet. Coins and positions stay under its control; you can stop a bot at any time.',
      ],
      honest: 'Prices move fast and most new coins lose value. Use only what you can afford to lose.',
      words: [
        { title: 'Solana', line: 'A fast public blockchain. Ryntra works only on Solana.' },
        { title: 'Wallet', line: 'An app or browser extension that holds your coins and signs for you.' },
        { title: 'Signature', line: 'Your “yes” in the wallet. Nothing starts without it: each trade, order, launch or bot budget.' },
        { title: 'SOL', line: 'Solana’s own coin. Keep a little of it: every move pays a tiny network fee in SOL.' },
        { title: 'Fee', line: 'What a move costs. It shows on one line before you sign.' },
        { title: 'The least you get', line: 'The smallest amount you receive even if the price moves while you sign.' },
      ],
      more: [
        { title: 'Bot or agent?', text: ['A bot follows a rule you set: an amount, a price, a schedule.', 'An agent is AI: it understands your sentence, reads the market and advises. You decide and sign.'] },
        { title: 'What it costs', text: ['Every fee shows on one line before you sign. Ryntra takes no fee to launch a coin; Solana’s own network cost is always there, and tiny.'] },
        { title: 'On a phone', text: ['Open ryntra.io in your phone’s browser or in your wallet app. Five tabs at the bottom: Market, Swap, Agent, Earn and Portfolio.'] },
      ],
    },
    uk: {
      title: 'Що таке Ryntra',
      line: 'AI-термінал на Solana. Скажи, чого хочеш, — агент відкриє потрібний екран і заповнить його. Підписуєш ти.',
      open: 'Відкрити Ryntra',
      does: [
        { title: 'Скажи', line: 'Напиши «Купи JUP на 1 SOL» — агент відкриє сторінку JUP із уже вписаною сумою.' },
        { title: 'Торгуй', line: 'Обміняй будь-яку монету на будь-яку або постав свою ціну лімітним ордером.' },
        { title: 'Запускай', line: 'Випусти свою монету на Meteora: картинка, назва й один підпис.' },
        { title: 'Дай роботу ботам', line: 'Регулярні покупки, сітка чи драбина ордерів — за твоїми правилами, стоп будь-коли.' },
        { title: 'Заробляй', line: 'Вклади монети в пули Meteora, застейкай SOL чи дай у позику — забрати може лише твій гаманець.' },
      ],
      how: [
        'Відкрий ryntra.io й підключи гаманець Solana. Це і є твій акаунт — реєстрації немає.',
        'Напиши, чого хочеш, у рядку «Скажи агентові, що зробити» або обери розділ у меню зліва.',
        'Перевір рядок перед підписом: що отримаєш, щонайменше скільки й комісію.',
        'Підпиши в гаманці. Монети й позиції лишаються під його керуванням; бота можна зупинити будь-коли.',
      ],
      honest: 'Ціни рухаються швидко, більшість нових монет втрачає в ціні. Вкладай лише те, що готовий втратити.',
      words: [
        { title: 'Solana', line: 'Швидкий публічний блокчейн. Ryntra працює лише на Solana.' },
        { title: 'Гаманець', line: 'Застосунок чи розширення браузера, що тримає твої монети й підписує за тебе.' },
        { title: 'Підпис', line: 'Твоє «так» у гаманці. Без нього нічого не починається: ні угода, ні ордер, ні запуск, ні бюджет бота.' },
        { title: 'SOL', line: 'Власна монета Solana. Тримай трохи: кожна дія платить крихітну комісію мережі в SOL.' },
        { title: 'Комісія', line: 'Скільки коштує дія. Її видно одним рядком до підпису.' },
        { title: 'Щонайменше', line: 'Найменша сума, яку ти отримаєш, навіть якщо ціна зсунеться, поки підписуєш.' },
      ],
      more: [
        { title: 'Бот чи агент?', text: ['Бот виконує правило, яке ставиш ти: суму, ціну, розклад.', 'Агент — це AI: розуміє твоє речення, читає ринок і радить. Вирішуєш і підписуєш ти.'] },
        { title: 'Скільки це коштує', text: ['Кожну комісію видно одним рядком до підпису. За запуск монети Ryntra не бере нічого; власна плата мережі Solana є завжди — і крихітна.'] },
        { title: 'На телефоні', text: ['Відкрий ryntra.io у браузері телефона чи в застосунку гаманця. Унизу п’ять вкладок: Ринок, Обмін, Агент, Заробіток і Портфель.'] },
      ],
    },
  },
  {
    id: 'say',
    group: 'start',
    shot: 'say',
    href: '/',
    en: {
      title: 'Say it',
      line: 'One line at the top of every screen. Write what you want in plain words — the agent opens the screen, filled in.',
      open: 'Try it',
      does: [
        { title: '“Buy JUP for 1 SOL”', line: 'Opens JUP’s page with 1 SOL in the buy form.' },
        { title: '“Swap 10 USDC to SOL”', line: 'Opens Swap with 10 USDC to pay and SOL to get.' },
        { title: '“Trade JUP every day”', line: 'Opens Recurring buys on JUP: set the budget a day and the term.' },
        { title: '“Launch me a token”', line: 'Opens Launch: add a picture, a name and a ticker.' },
        { title: '“How is SOL today?”', line: 'The Analyst answers in plain words.' },
      ],
      how: [
        'Click “Tell your agent what to do” at the top of any screen, or press Ctrl K.',
        'Write a coin, an amount and what to do — in English or Ukrainian.',
        'The line shows what it understood. Press Enter, or tap that row — the screen opens with your words in the form.',
        'Check the numbers, change anything you like, and sign.',
      ],
      honest: 'The agent fills in the form; it never signs a trade for you. If it reads you wrong, nothing happens until you sign.',
      words: [
        { title: 'USDC', line: 'A stablecoin: one USDC aims to stay worth one US dollar.' },
        { title: 'Ticker', line: 'A coin’s short name, like SOL, JUP or MET.' },
      ],
      more: [
        { title: 'More sentences that work', text: ['“Sell MET” opens MET’s page on the sell side.', '“Find new coins” opens the newest launches on the market.', '“Show my portfolio” opens your portfolio; “Send 1 SOL” opens Money.'] },
        { title: 'Tips', text: ['Name the coin by its ticker and give an amount — the agent fills in the rest.', 'One action per sentence works best.'] },
      ],
      coming: ['Sentences with a condition', 'Agents that act on their own'],
    },
    uk: {
      title: 'Скажи агентові',
      line: 'Один рядок угорі кожного екрана. Напиши, чого хочеш, простими словами — агент відкриє екран уже заповненим.',
      open: 'Спробувати',
      does: [
        { title: '«Купи JUP на 1 SOL»', line: 'Відкриває сторінку JUP з 1 SOL у формі купівлі.' },
        { title: '«Обміняй 10 USDC на SOL»', line: 'Відкриває Обмін: платиш 10 USDC, отримуєш SOL.' },
        { title: '«Торгуй JUP щодня»', line: 'Відкриває «Регулярні покупки» на JUP: задай бюджет на день і строк.' },
        { title: '«Запусти мені токен»', line: 'Відкриває Запуск: додай картинку, назву й тікер.' },
        { title: '«Як SOL сьогодні?»', line: 'Аналітик відповідає простими словами.' },
      ],
      how: [
        'Натисни «Скажи агентові, що зробити» вгорі будь-якого екрана або Ctrl K.',
        'Напиши монету, суму й що зробити — українською чи англійською.',
        'Рядок покаже, що він зрозумів. Натисни Enter або цей рядок — екран відкриється з твоїми словами у формі.',
        'Перевір цифри, зміни що хочеш — і підпиши.',
      ],
      honest: 'Агент заповнює форму, але ніколи не підписує угод за тебе. Якщо він зрозумів тебе не так, нічого не станеться без твого підпису.',
      words: [
        { title: 'USDC', line: 'Стейблкоїн: один USDC тримається вартості одного долара США.' },
        { title: 'Тікер', line: 'Коротка назва монети: SOL, JUP чи MET.' },
      ],
      more: [
        { title: 'Ще речення, що працюють', text: ['«Продай MET» відкриває сторінку MET на боці продажу.', '«Знайди нові монети» відкриває найсвіжіші запуски ринку.', '«Покажи мій портфель» відкриває твій портфель; «Надішли 1 SOL» — «Гроші».'] },
        { title: 'Поради', text: ['Називай монету тікером і давай суму — решту агент заповнить сам.', 'Найкраще працює одна дія в одному реченні.'] },
      ],
      coming: ['Речення з умовою', 'Агенти, що діють самі'],
    },
  },
  {
    id: 'market',
    group: 'terminal',
    shot: 'market-table',
    href: '/',
    en: {
      title: 'Market',
      line: 'The first screen: Solana’s traded coins in one live table, new launches as they happen, and the doors to everything else.',
      open: 'Open the Market',
      does: [
        { title: 'Pulse', line: 'New coins in three columns: just launched, almost on a DEX, and out on a DEX.' },
        { title: 'One-tap buy', line: 'Buy a fixed amount right from a card, with one signature.' },
        { title: 'Every kind of asset', line: 'All, Memes, Crypto, Stocks, Pre-IPO and your Saved coins, each on its own tab.' },
        { title: 'Lists and filters', line: 'Trending, rising, falling, most trades — over five minutes up to a day.' },
      ],
      how: [
        'Open ryntra.io: the Market is the first screen.',
        'Pick a tab — say, Memes or Stocks — and a list such as Trending.',
        'Narrow it with Filters, or add columns like liquidity and holders.',
        'Tap a coin to open its page, or the star to keep it in Saved.',
      ],
      honest: 'A coin in the table is not a recommendation. Read its risk mark and its facts before you buy.',
      words: [
        { title: 'DEX', line: 'An exchange on the blockchain itself. A coin “gets on a DEX” when it graduates from its launch curve into a regular pool.' },
        { title: 'Market cap', line: 'The price of one coin times all the coins there are.' },
        { title: 'Liquidity', line: 'How much money stands ready to trade the coin. Low liquidity means big price jumps.' },
        { title: 'Holders', line: 'How many wallets own the coin.' },
      ],
      more: [
        { title: 'Where a coin leads', text: ['Tap a coin to open its page: the chart, trades and a form to buy or sell.'] },
        { title: 'The risk mark', text: ['Each coin shows one risk mark. The facts behind it — holders, the top 10’s share, the creator and what the coin allows — are on its page.'] },
      ],
    },
    uk: {
      title: 'Ринок',
      line: 'Перший екран: монети Solana, що торгуються, в одній живій таблиці, нові запуски в ту ж мить і двері до всього іншого.',
      open: 'Відкрити Ринок',
      does: [
        { title: 'Пульс', line: 'Нові монети в трьох колонках: щойно запущені, майже на DEX і вже на DEX.' },
        { title: 'Купівля в один дотик', line: 'Купи наперед задану суму просто з картки — одним підписом.' },
        { title: 'Усі види активів', line: 'Усі, Меми, Крипта, Акції, Pre-IPO й Обране — кожне на своїй вкладці.' },
        { title: 'Списки й фільтри', line: 'Тренди, ростуть, падають, найбільше угод — за п’ять хвилин і аж до дня.' },
      ],
      how: [
        'Відкрий ryntra.io: Ринок — перший екран.',
        'Обери вкладку — скажімо, Меми чи Акції — і список, як-от Тренди.',
        'Звузь його «Фільтрами» або додай колонки: ліквідність, власники.',
        'Натисни монету, щоб відкрити її сторінку, або зірочку — щоб тримати її в Обраному.',
      ],
      honest: 'Монета в таблиці — не порада. Прочитай її мітку ризику й факти до покупки.',
      words: [
        { title: 'DEX', line: 'Біржа просто в блокчейні. Монета «виходить на DEX», коли переходить з кривої запуску у звичайний пул.' },
        { title: 'Капіталізація', line: 'Ціна однієї монети, помножена на всі монети, що існують.' },
        { title: 'Ліквідність', line: 'Скільки грошей готово до торгівлі монетою. Мала ліквідність — великі стрибки ціни.' },
        { title: 'Власники', line: 'Скільки гаманців тримають монету.' },
      ],
      more: [
        { title: 'Куди веде монета', text: ['Натисни монету — відкриється її сторінка: графік, угоди й форма купівлі чи продажу.'] },
        { title: 'Мітка ризику', text: ['У кожної монети — одна мітка ризику. Факти за нею — власники, частка топ-10, творець і що дозволяє монета — на її сторінці.'] },
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
      line: 'Swap any coin for any other on Solana in one form, and bring money in from other networks.',
      open: 'Open Swap',
      does: [
        { title: 'Swap', line: 'Pick two coins and an amount; the price, what you get and the fee show before you sign.' },
        { title: 'Quick amounts', line: '25%, 50%, 75% or Max of what your wallet holds.' },
        { title: 'Bridge', line: 'Send from another network to Solana, or back, to your address or another one.' },
        { title: 'My transfers', line: 'Every bridge transfer of yours in one list.' },
      ],
      how: [
        'Open Swap from the menu, or say “Swap 10 USDC to SOL”.',
        'Choose the coin you pay with and the coin you want.',
        'Type an amount, or tap 25%, 50%, 75% or Max.',
        'Read what you get and the fee, then sign in your wallet.',
      ],
      honest: 'The price can move a little between the quote and your signature; the form shows the least you will get.',
      words: [
        { title: 'Slippage', line: 'How far the price may move before your swap fills. The form protects you with “the least you get”.' },
        { title: 'Bridge', line: 'A way to move money between two blockchains.' },
      ],
      more: [
        { title: 'Where the price comes from', text: ['Swaps go through Jupiter, which looks for the best route across Solana.'] },
        { title: 'What it costs', text: ['Ryntra’s fee shows on one line before you sign. A bridge transfer shows its own cost before you send.'] },
        { title: 'A chart or a limit order?', text: ['Swap is one form with no chart. For a chart, limit and stop orders, open the coin’s page — see Spot.'] },
      ],
    },
    uk: {
      title: 'Обмін і Міст',
      line: 'Обміняй будь-яку монету на будь-яку в Solana однією формою — і переказуй гроші з інших мереж.',
      open: 'Відкрити Обмін',
      does: [
        { title: 'Обмін', line: 'Обери дві монети й суму — ціну, що отримаєш, і комісію видно до підпису.' },
        { title: 'Швидкі суми', line: '25 %, 50 %, 75 % чи все, що є в гаманці.' },
        { title: 'Міст', line: 'Надішли з іншої мережі в Solana чи назад — на свою адресу або іншу.' },
        { title: 'Мої перекази', line: 'Усі твої перекази мостом — одним списком.' },
      ],
      how: [
        'Відкрий Обмін у меню або скажи «Обміняй 10 USDC на SOL».',
        'Обери монету, якою платиш, і монету, яку хочеш.',
        'Впиши суму або натисни 25 %, 50 %, 75 % чи «Усе».',
        'Прочитай, що отримаєш, і комісію — і підпиши в гаманці.',
      ],
      honest: 'Між ціною у формі й підписом ціна може трохи зсунутись; форма показує, щонайменше скільки ти отримаєш.',
      words: [
        { title: 'Прослизання', line: 'Наскільки може зсунутись ціна, поки обмін виконується. Від нього захищає «щонайменше отримаєш».' },
        { title: 'Міст', line: 'Спосіб переказати гроші між двома блокчейнами.' },
      ],
      more: [
        { title: 'Звідки ціна', text: ['Обмін іде через Jupiter — він шукає найкращий маршрут у Solana.'] },
        { title: 'Скільки це коштує', text: ['Комісію Ryntra видно одним рядком до підпису. Переказ мостом показує свою вартість до відправки.'] },
        { title: 'Графік чи лімітка?', text: ['Обмін — одна форма без графіка. Графік, лімітні й стоп-ордери — на сторінці монети, див. «Спот».'] },
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
      line: 'A coin’s own page: the chart, its trades and holders, and a form with market, limit and stop orders.',
      open: 'Open SOL',
      does: [
        { title: 'Chart', line: 'Candles from one minute to one day, the price or the market cap, with indicators.' },
        { title: 'Market, Limit, Stop', line: 'Buy or sell now, at your price, or when the price reaches your stop.' },
        { title: 'Coin facts', line: 'Holders, the top 10’s share, the creator and whether the coin can be minted or frozen.' },
        { title: 'Trades and holders', line: 'The latest trades, the biggest holders and the coin’s liquidity.' },
      ],
      how: [
        'Tap a coin in the Market, or say “Buy JUP for 1 SOL”.',
        'Choose Buy or Sell, then Market, Limit or Stop.',
        'Type the amount — and for a limit or stop, your price.',
        'Read the fee and what you get, then sign. A limit or stop waits until the price comes.',
      ],
      honest: 'A limit order may never fill if the price does not reach it. You can cancel it while it waits.',
      words: [
        { title: 'Candle', line: 'One bar of the chart: where the price opened, closed, and how high and low it went in that time.' },
        { title: 'Limit order', line: 'An order at your price. It fills only if the market gets there.' },
        { title: 'Stop order', line: 'An order that fires when the price reaches the level you set — most often a sale to cap a loss.' },
        { title: 'Mint, freeze', line: 'Rights a coin’s creator may keep: to make more coins, or to freeze someone’s coins.' },
      ],
      more: [
        { title: 'Limit orders on Meteora', text: ['Where a coin has a Meteora DLMM Pro pool, a limit order rests inside it and earns a bonus when it fills. See Meteora in Ryntra.'] },
        { title: 'What it costs', text: ['The fee and the slippage show on one line before you sign.'] },
      ],
    },
    uk: {
      title: 'Спот',
      line: 'Власна сторінка монети: графік, угоди й власники, і форма з ринковим, лімітним і стоп-ордером.',
      open: 'Відкрити SOL',
      does: [
        { title: 'Графік', line: 'Свічки від хвилини до дня, ціна чи капіталізація, з індикаторами.' },
        { title: 'Ринок, Ліміт, Стоп', line: 'Купи чи продай зараз, за своєю ціною або коли ціна дійде до стопу.' },
        { title: 'Факти монети', line: 'Власники, частка топ-10, творець і чи можна монету довипустити або заморозити.' },
        { title: 'Угоди й власники', line: 'Останні угоди, найбільші власники й ліквідність монети.' },
      ],
      how: [
        'Натисни монету на Ринку або скажи «Купи JUP на 1 SOL».',
        'Обери «Купити» чи «Продати», далі — Ринок, Ліміт або Стоп.',
        'Впиши суму, а для лімітки чи стопу — свою ціну.',
        'Прочитай комісію й що отримаєш — і підпиши. Лімітка чи стоп чекає, доки прийде ціна.',
      ],
      honest: 'Лімітка може так і не виконатися, якщо ціна до неї не дійде. Поки вона чекає, її можна скасувати.',
      words: [
        { title: 'Свічка', line: 'Один стовпчик графіка: де ціна відкрилась, закрилась і як високо й низько ходила за цей час.' },
        { title: 'Лімітка', line: 'Ордер за твоєю ціною. Виконується, лише якщо ринок туди дійде.' },
        { title: 'Стоп', line: 'Ордер, що спрацьовує, коли ціна доходить до заданого рівня, — найчастіше продаж, щоб обмежити збиток.' },
        { title: 'Довипуск, заморозка', line: 'Права, які може лишити собі творець монети: випустити ще монет або заморозити чужі.' },
      ],
      more: [
        { title: 'Лімітки на Meteora', text: ['Де в монети є пул Meteora DLMM Pro, лімітка стоїть усередині нього й отримує бонус, коли виконується. Докладно — «Meteora в Ryntra».'] },
        { title: 'Скільки це коштує', text: ['Комісію й прослизання видно одним рядком до підпису.'] },
      ],
    },
  },
  {
    id: 'stocks',
    group: 'terminal',
    shot: 'stocks',
    href: '/?tab=stock',
    en: {
      title: 'Stocks',
      line: 'Tokenized stocks of real companies on Solana: find them on the Market, buy them like any coin, put them into Meteora pools.',
      open: 'Open Stocks',
      does: [
        { title: 'Find', line: 'Every tokenized stock on the Stocks tab, with its price, volume and whether the exchange is open.' },
        { title: 'Buy and sell', line: 'Swap SOL or USDC for a stock token, or use the stock’s own page with its chart.' },
        { title: 'Meteora pools', line: 'In a verified stock’s DLMM Pro pool, add a position or place a limit order that earns the pool’s bonus.' },
        { title: 'Pre-IPO', line: 'Tokens tied to companies that are not on an exchange yet, on their own tab.' },
      ],
      how: [
        'Open the Market and choose the Stocks tab. A mark above the list says whether the exchange is open.',
        'Tap a stock to open its page: chart, trades and the buy form.',
        'Look for the check mark beside the price: the coin list Ryntra reads marks the token as verified.',
        'Pick an amount, read the fee, and sign.',
      ],
      honest: 'A stock token is not the share itself: its issuer can pause, move or burn tokens, and decides who may swap them for shares.',
      words: [
        { title: 'Tokenized stock', line: 'A token on Solana backed by a real share that its issuer holds. It follows the share’s price.' },
        { title: 'Issuer', line: 'The company that holds the real shares and issues the tokens. Its terms decide who can redeem them.' },
        { title: 'Exchange hours', line: 'The stock exchange trades on weekdays during set hours. The token trades around the clock.' },
        { title: 'Pre-IPO', line: 'A company before it lists on an exchange. Its tokens are riskier and harder to price.' },
      ],
      more: [
        { title: 'When the exchange is closed', text: ['The token keeps trading on Solana at night and on weekends, but the exchange does not. Its price can drift away from the share’s until the exchange opens.', 'In a pool the price stands still outside exchange hours and may jump at the open.'] },
        { title: 'The issuer’s rights', text: ['Each issuer keeps rights over its tokens. They are written in the issuer’s own terms; read them before you buy.'] },
        { title: 'Lookalikes', text: ['Anyone can launch a coin with a stock’s ticker. Buy the token from a known issuer — open it from the Stocks tab, not from a search.'] },
        { title: 'Stocks in pools', text: ['A position works only in the DLMM Pro pool of a verified stock paired with SOL. Regular DLMM pools with stocks do not take positions yet.', 'Before you sign, a line says the issuer can pause the token and take it back, even from the pool.'] },
      ],
      coming: ['Stocks at the exchange price', 'Stocks in regular DLMM pools', 'A coin paired with a stock'],
    },
    uk: {
      title: 'Акції',
      line: 'Токенізовані акції справжніх компаній у Solana: знайди на Ринку, купи як будь-яку монету, поклади в пул Meteora.',
      open: 'Відкрити Акції',
      does: [
        { title: 'Знайти', line: 'Вкладка «Акції» на Ринку — кожна токенізована акція з ціною й обігом і позначка, чи відкрита біржа.' },
        { title: 'Купити й продати', line: 'Обміняй SOL чи USDC на токен акції або відкрий сторінку акції з графіком.' },
        { title: 'Пули Meteora', line: 'У пулі DLMM Pro перевіреної акції додай позицію або постав лімітку, що отримує бонус пулу.' },
        { title: 'Pre-IPO', line: 'Токени компаній, яких ще немає на біржі, — на своїй вкладці.' },
      ],
      how: [
        'Відкрий Ринок і обери вкладку «Акції». Позначка над списком каже, чи відкрита біржа.',
        'Натисни акцію, щоб відкрити її сторінку: графік, угоди й форма купівлі.',
        'Шукай галочку біля ціни: її ставить список монет, який читає Ryntra, — токен перевірено.',
        'Обери суму, прочитай комісію — і підпиши.',
      ],
      honest: 'Токен акції — не сама акція: емітент може призупинити, перемістити чи спалити токени й вирішує, хто може обміняти їх на акції.',
      words: [
        { title: 'Токенізована акція', line: 'Токен у Solana, за яким стоїть справжня акція в емітента. Він іде за ціною акції.' },
        { title: 'Емітент', line: 'Компанія, що тримає справжні акції й випускає токени. Її умови вирішують, хто може їх погасити.' },
        { title: 'Години біржі', line: 'Біржа торгує в робочі дні у визначені години. Токен торгується цілодобово.' },
        { title: 'Pre-IPO', line: 'Компанія до виходу на біржу. Її токени ризиковіші, і їхню ціну важче оцінити.' },
      ],
      more: [
        { title: 'Коли біржа зачинена', text: ['Токен торгується в Solana й уночі, і на вихідних, а біржа — ні. До її відкриття ціна токена може відійти від ціни акції.', 'У пулі ціна поза годинами біржі стоїть, а на відкритті може стрибнути.'] },
        { title: 'Права емітента', text: ['Кожен емітент лишає собі права над токенами. Вони записані в його власних умовах — прочитай їх до покупки.'] },
        { title: 'Підробки', text: ['Монету з тікером акції може запустити будь-хто. Купуй токен відомого емітента — відкривай його з вкладки «Акції», а не з пошуку.'] },
        { title: 'Акції в пулах', text: ['Позиція працює лише в пулі DLMM Pro перевіреної акції в парі з SOL. Звичайні пули DLMM з акціями позицій поки не приймають.', 'Перед підписом рядок каже: емітент може зупинити токен і забрати його, навіть із пулу.'] },
      ],
      coming: ['Акції за ціною біржі', 'Акції у звичайних пулах DLMM', 'Монета в парі з акцією'],
    },
  },
  {
    id: 'launch',
    group: 'terminal',
    shot: 'launch',
    href: '/launch',
    en: {
      title: 'Launch',
      line: 'Your own coin in a minute: a picture, a name, a ticker and one signature. Ryntra takes no launch fee.',
      open: 'Launch a coin',
      does: [
        { title: 'Quick start', line: 'Everyone buys on the same Meteora launch curve; the coin trades from the first second.' },
        { title: 'Own pool', line: 'Or open the coin in a Meteora DLMM Pro pool, with trading at the time you pick.' },
        { title: 'See it first', line: 'A preview shows how people will see your coin on the Market.' },
        { title: 'My coins and New', line: 'The coins you launched, and the newest launches on the market, each on its tab.' },
      ],
      how: [
        'Open Launch, or say “Launch me a token”.',
        'Drop a picture, write a name and a ticker, and a line about the coin.',
        'Choose Quick start or Own pool.',
        'Check the preview and sign. Your coin appears on the Market.',
      ],
      honest: 'Most new coins lose value. A launch is a coin, not a promise that anyone will buy it.',
      words: [
        { title: 'Launch curve', line: 'A price that moves up as people buy and down as they sell. When enough is bought, the coin moves into a pool.' },
        { title: 'Pool', line: 'Two coins locked together so anyone can trade one for the other.' },
        { title: 'Sniper', line: 'A bot that buys a new coin in its first seconds to sell to people who come after.' },
      ],
      more: [
        { title: 'What it costs', text: ['Ryntra takes no launch fee; you pay only Solana’s network costs, shown before you sign.', 'Each trade of your coin pays a fee, and part of it is yours — the share is on the form before you sign.'] },
        { title: 'Built in', text: ['A fee against early snipers that falls over time, and liquidity locked on Meteora — nothing to set.'] },
      ],
    },
    uk: {
      title: 'Запуск',
      line: 'Своя монета за хвилину: картинка, назва, тікер і один підпис. Ryntra не бере плати за запуск.',
      open: 'Запустити монету',
      does: [
        { title: 'Швидкий старт', line: 'Усі купують на тій самій кривій запуску Meteora; монета торгується з першої секунди.' },
        { title: 'Свій пул', line: 'Або відкрий монету в пулі Meteora DLMM Pro — торги почнуться тоді, коли обереш.' },
        { title: 'Подивись наперед', line: 'Прев’ю показує, як люди побачать твою монету на Ринку.' },
        { title: 'Мої монети й Нові', line: 'Монети, які ти запустив, і найсвіжіші запуски ринку — кожне на своїй вкладці.' },
      ],
      how: [
        'Відкрий Запуск або скажи «Запусти мені токен».',
        'Додай картинку, напиши назву, тікер і рядок про монету.',
        'Обери «Швидкий старт» чи «Свій пул».',
        'Перевір прев’ю й підпиши. Монета з’явиться на Ринку.',
      ],
      honest: 'Більшість нових монет втрачає в ціні. Запуск — це монета, а не обіцянка, що її хтось купить.',
      words: [
        { title: 'Крива запуску', line: 'Ціна, що росте, коли люди купують, і падає, коли продають. Коли куплено досить, монета переходить у пул.' },
        { title: 'Пул', line: 'Дві монети, зібрані в одному пулі, щоб будь-хто міг обміняти одну на іншу.' },
        { title: 'Снайпер', line: 'Бот, що купує нову монету в перші секунди, щоб продати тим, хто прийде слідом.' },
      ],
      more: [
        { title: 'Скільки це коштує', text: ['Ryntra не бере плати за запуск — лише витрати мережі Solana, видно до підпису.', 'Кожна угода твоєю монетою платить комісію, і частина її — твоя: частку видно у формі до підпису.'] },
        { title: 'Уже всередині', text: ['Комісія проти ранніх снайперів, що спадає з часом, і ліквідність, замкнена на Meteora, — без налаштувань.'] },
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
      line: 'Automation by your rules, each bot beside the coin’s live chart. Run one or several and stop each one separately.',
      open: 'Open Bots',
      does: [
        { title: 'Recurring buys', line: 'Buys a coin by itself on your budget a day, for as many days as you set.' },
        { title: 'Grid', line: 'Buys lower and sells higher in your price band, as orders in the coin’s Meteora pool, drawn on the chart.' },
        { title: 'Order ladder', line: 'Several limit orders at once, with one signature.' },
        { title: 'Money autopilot', line: 'Write one sum; the bot spreads it over trading, staking and lending, and pools.' },
        { title: 'Signals', line: 'Buys as the trend turns up and sells as it turns down — on paper, with no money.' },
      ],
      how: [
        'Open Bots and pick one — or say “Trade JUP every day”.',
        'Choose the coin and set the budget, the amount per trade and the term.',
        'Try “Practice first” to see how the bot would act, with no money.',
        'Sign once to start. Inside that budget the bot acts by itself; it shows under My bots, with a Stop button.',
      ],
      honest: 'A bot follows its rule even when the market falls, and can end at a loss. Stop it anytime.',
      words: [
        { title: 'Budget a day', line: 'The most a bot may spend in one day — the form’s first field.' },
        { title: 'Grid', line: 'A ladder of buy prices below the market and sell prices above it.' },
        { title: 'On paper', line: 'Practice with the market’s real prices and no real money.' },
      ],
      more: [
        { title: 'What it costs', text: ['Each bot shows its fee before you start.'] },
        { title: 'Where your money is', text: ['A bot spends only what you signed for. What it buys lands in your wallet.'] },
      ],
      coming: ['Signals with real money', 'Copy a wallet', 'Pool keeper'],
    },
    uk: {
      title: 'Боти',
      line: 'Автоматизація за твоїми правилами, кожен бот — поруч із живим графіком монети. Запускай кількох і зупиняй кожного окремо.',
      open: 'Відкрити Боти',
      does: [
        { title: 'Регулярні покупки', line: 'Купує монету сам на твій бюджет на день — стільки днів, скільки задаси.' },
        { title: 'Сітка', line: 'Купує нижче й продає вище в межах твоїх цін — ордерами в пулі монети на Meteora, кожен рівень на графіку.' },
        { title: 'Драбина ордерів', line: 'Кілька ліміток одразу — одним підписом.' },
        { title: 'Автопілот грошей', line: 'Впиши одну суму — бот розподілить її між торгівлею, стейкінгом і депозитами та пулами.' },
        { title: 'Сигнали', line: 'Купує, коли тренд повертає вгору, й продає, коли вниз, — на папері, без грошей.' },
      ],
      how: [
        'Відкрий «Боти» й обери бота — або скажи «Торгуй JUP щодня».',
        'Обери монету й задай бюджет, суму на угоду й строк.',
        'Натисни «Спершу потренуватись», щоб побачити, як діяв би бот, без грошей.',
        'Підпиши один раз, щоб запустити. У межах бюджету бот діє сам; він з’явиться в «Моїх ботах» з кнопкою «Стоп».',
      ],
      honest: 'Бот виконує своє правило навіть тоді, коли ринок падає, і може закінчити в мінусі. Зупини будь-коли.',
      words: [
        { title: 'Бюджет на день', line: 'Найбільше, що бот може витратити за день.' },
        { title: 'Сітка', line: 'Драбина цін купівлі нижче ринку й цін продажу — вище.' },
        { title: 'На папері', line: 'Практика зі справжніми цінами ринку й без справжніх грошей.' },
      ],
      more: [
        { title: 'Скільки це коштує', text: ['Кожен бот показує свою комісію до старту.'] },
        { title: 'Де твої гроші', text: ['Бот витрачає лише те, що ти підписав. Те, що він купує, потрапляє в твій гаманець.'] },
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
      line: 'AI that understands you. Ask the Analyst about any coin, or tell the agent what to do from any screen.',
      open: 'Ask the Analyst',
      does: [
        { title: 'Analyst', line: 'Answers about any coin or the market: “How is SOL today?”, “Why is JUP moving?”.' },
        { title: 'One sentence', line: 'On every screen: say what you want; the agent opens the screen and fills it in.' },
        { title: 'Advice only', line: 'The Analyst explains and advises. You decide, and you sign.' },
      ],
      how: [
        'Open Agents, or tap one of the ready questions.',
        'Ask in your own words about a coin, a move or a risk.',
        'Read the answer; open the coin from it if you want to act.',
      ],
      honest: 'The Analyst can be wrong. It reads the market; it does not know the future.',
      more: [
        { title: 'Bot or agent?', text: ['Bots follow your rules. Agents are AI: they read your words and the market.'] },
      ],
      coming: ['AI trader', 'Scout', 'Your own AI'],
    },
    uk: {
      title: 'Агенти',
      line: 'AI, що тебе розуміє. Запитай Аналітика про будь-яку монету або скажи агентові, що зробити, з будь-якого екрана.',
      open: 'Запитати Аналітика',
      does: [
        { title: 'Аналітик', line: 'Відповідає про будь-яку монету чи ринок: «Як SOL сьогодні?», «Чому рухається JUP?».' },
        { title: 'Одне речення', line: 'На кожному екрані: скажи, чого хочеш, — агент відкриє екран і заповнить його.' },
        { title: 'Лише порада', line: 'Аналітик пояснює й радить. Вирішуєш і підписуєш ти.' },
      ],
      how: [
        'Відкрий «Агенти» або натисни одне з готових питань.',
        'Запитай своїми словами про монету, рух ціни чи ризик.',
        'Прочитай відповідь; якщо хочеш діяти — відкрий монету просто з неї.',
      ],
      honest: 'Аналітик може помилятися. Він читає ринок, але не знає майбутнього.',
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
      line: 'Put coins to work: Meteora pools, SOL staking and lending. Your wallet controls the position — only you can withdraw.',
      open: 'Open Earn',
      does: [
        { title: 'Pools', line: 'Meteora DLMM and DAMM v2 pools, sorted by the fees they made in a day.' },
        { title: 'DLMM Pro', line: 'Meteora pools with built-in limit orders that earn a bonus — a tab of Earn.' },
        { title: 'Your goal, not settings', line: 'Spread evenly, stay near the price, catch moves or draw your own shape — then a wide, medium or narrow range.' },
        { title: 'Staking and lending', line: 'Liquid staking of SOL, and stablecoins or SOL in Jupiter Lend.' },
        { title: 'My positions', line: 'What you put in and what it earns, in one tab.' },
      ],
      how: [
        'Open Earn. The quick filters help: high income, big pools, SOL pairs.',
        'Tap Add on a pool; the form opens beside the list. A pool marked View cannot take a position yet.',
        'Type the amount, pick a goal — Even, Near price or Catch moves — and a range: Wide, Medium or Narrow.',
        'Check the price band and sign. The position appears under My positions.',
      ],
      honest: 'When the price moves a lot, a pool can end with less than you put in, and less than simply holding.',
      words: [
        { title: 'Position', line: 'Your coins inside a pool. You earn a share of every trade’s fee while the price is in your range.' },
        { title: 'Range', line: 'The prices where your position works. Narrow earns more, but stops earning sooner when the price leaves it.' },
        { title: 'Staking', line: 'Delegating your SOL to secure Solana in return for a reward. Liquid staking gives you a token you can still use.' },
        { title: 'Yearly rate', line: 'What a position would earn in a year if the last day repeated. It changes every day.' },
      ],
      more: [
        { title: 'Where the figures come from', text: ['Fees, liquidity and yearly rates are read live from the pools and the protocols. A past day is not a promise.'] },
        { title: 'Add or View', text: ['A pool marked Add takes your position right from the list. A pool marked View opens its page: facts, limit orders and swap.'] },
      ],
      coming: ['Your position’s result', 'Pool keeper'],
    },
    uk: {
      title: 'Заробіток',
      line: 'Дай монетам працювати: пули Meteora, стейкінг SOL і депозити. Позицією керує твій гаманець — забрати можеш лише ти.',
      open: 'Відкрити Заробіток',
      does: [
        { title: 'Пули', line: 'Пули Meteora DLMM і DAMM v2 — за комісіями, які вони заробили за день.' },
        { title: 'DLMM Pro', line: 'Пули Meteora з вбудованими лімітками, що отримують бонус, — вкладка «Заробітку».' },
        { title: 'Мета, а не налаштування', line: '«Рівно», «Біля ціни», «Ловити рухи» чи своя форма — і широкий, середній або вузький діапазон.' },
        { title: 'Стейкінг і депозити', line: 'Ліквідний стейкінг SOL, а стейблкоїни чи SOL — на депозит у Jupiter Lend.' },
        { title: 'Мої позиції', line: 'Що ти вклав і скільки воно заробляє — на одній вкладці.' },
      ],
      how: [
        'Відкрий «Заробіток». Допоможуть швидкі фільтри: високий дохід, великі пули, пари з SOL.',
        'Натисни «Додати» біля пулу — форма відкриється поруч зі списком. Пул з «Оглядом» поки не приймає позицій.',
        'Впиши суму, обери мету — «Рівно», «Біля ціни» чи «Ловити рухи» — і діапазон: широкий, середній чи вузький.',
        'Перевір межі цін і підпиши. Позиція з’явиться в «Моїх позиціях».',
      ],
      honest: 'Коли ціна сильно рухається, пул може закінчитись меншим, ніж ти вклав, і меншим, ніж просте тримання.',
      words: [
        { title: 'Позиція', line: 'Твої монети в пулі. Ти отримуєш частку комісії кожної угоди, поки ціна в твоєму діапазоні.' },
        { title: 'Діапазон', line: 'Ціни, на яких працює позиція. Вузький заробляє більше, але раніше перестає, коли ціна з нього виходить.' },
        { title: 'Стейкінг', line: 'Делегування твоїх SOL на захист Solana за винагороду. Ліквідний стейкінг дає токен, яким можна користуватись.' },
        { title: 'Річна ставка', line: 'Скільки заробила б позиція за рік, якби минулий день повторювався. Щодня інша.' },
      ],
      more: [
        { title: 'Звідки цифри', text: ['Комісії, ліквідність і річні ставки читаються наживо з пулів і протоколів. Минулий день — не обіцянка.'] },
        { title: '«Додати» чи «Огляд»', text: ['Пул з позначкою «Додати» приймає позицію просто зі списку. Пул з «Оглядом» відкриває свою сторінку: факти, лімітки й обмін.'] },
      ],
      coming: ['Результат позиції', 'Доглядач пулу'],
    },
  },
  {
    id: 'portfolio',
    group: 'terminal',
    shot: 'portfolio',
    href: '/portfolio',
    en: {
      title: 'Portfolio',
      line: 'Everything a wallet holds across Solana, on one page — coins, pools, staking, deposits and loans.',
      open: 'Open Portfolio',
      does: [
        { title: 'The whole wallet', line: 'Coins, pools, staking, deposits and loans — with the total.' },
        { title: 'Collect fees', line: 'Collect what your pool positions earned.' },
        { title: 'Exit everything', line: 'Close all your positions in one go.' },
        { title: 'Clean wallet', line: 'Swap tiny leftovers into SOL and get back the small SOL deposit each empty coin account holds.' },
        { title: 'Result after fees', line: 'What your trades made or lost after fees, counted from the date it shows.' },
      ],
      how: [
        'Open Portfolio and connect your wallet — or paste any address to look at it.',
        'Switch between Overview, Positions, History and Saved.',
        'Collect fees, exit a position or clean the wallet from the same page; each needs your signature.',
        'To follow a wallet, open its page and press Watch; the Watch screen keeps your list.',
      ],
      honest: 'Values follow live prices and move with the market.',
      more: [
        { title: 'Tabs', text: ['Overview, Positions, History and Saved coins.'] },
        { title: 'The result', text: ['It counts your trades after fees from the date it shows. With no trades yet it is one quiet line; the calendar and the table appear once there are trades.'] },
        { title: 'Any wallet', text: ['Every wallet has its own page: what it holds, its result and its latest trades. Press Watch to follow it.'] },
      ],
      coming: ['History of another wallet'],
    },
    uk: {
      title: 'Портфель',
      line: 'Усе, що тримає гаманець у Solana, — на одній сторінці: монети, пули, стейкінг, вклади й позики.',
      open: 'Відкрити Портфель',
      does: [
        { title: 'Увесь гаманець', line: 'Монети, пули, стейкінг, вклади й позики — з підсумком.' },
        { title: 'Забрати комісії', line: 'Забери те, що заробили твої позиції в пулах.' },
        { title: 'Вийти з усього', line: 'Вийди з усіх позицій одним дотиком.' },
        { title: 'Очистити гаманець', line: 'Обміняй дрібні залишки на SOL і поверни дрібний депозит SOL, що лежить на кожному порожньому рахунку монети.' },
        { title: 'Результат після комісій', line: 'Скільки твої угоди заробили чи втратили після комісій — від дати, яку він показує.' },
      ],
      how: [
        'Відкрий «Портфель» і підключи гаманець — або встав будь-яку адресу, щоб її подивитись.',
        'Перемикай «Огляд», «Позиції», «Історію» й «Обране».',
        'Забери комісії, вийди з позиції чи очисти гаманець з тієї ж сторінки — кожне твоїм підписом.',
        'Щоб стежити за гаманцем, відкрий його сторінку й натисни «Стежити»; екран стеження тримає твій список.',
      ],
      honest: 'Суми йдуть за живими цінами й рухаються разом із ринком.',
      more: [
        { title: 'Вкладки', text: ['Огляд, Позиції, Історія й Обрані монети.'] },
        { title: 'Результат', text: ['Рахує твої угоди після комісій від дати, яку показує. Поки угод немає, це один тихий рядок; календар і таблиця з’являються, щойно є угоди.'] },
        { title: 'Будь-який гаманець', text: ['Кожен гаманець має свою сторінку: що він тримає, його результат і останні угоди. Натисни «Стежити», щоб стежити за ним.'] },
      ],
      coming: ['Історія іншого гаманця'],
    },
  },
  {
    id: 'money',
    group: 'terminal',
    shot: 'money',
    href: '/money',
    en: {
      title: 'Money',
      line: 'Send, receive and ask for a payment — SOL or any coin, to an address or a name.',
      open: 'Open Money',
      does: [
        { title: 'Send', line: 'To any Solana address, or to a .skr name — a short name owners of the Seeker phone have.' },
        { title: 'Receive', line: 'Your address and its QR code.' },
        { title: 'Invoices', line: 'A payment link for what someone owes you.' },
        { title: 'Recent transfers', line: 'What you sent and received, in one list.' },
      ],
      how: [
        'Open Money and choose Send, Receive or Invoices.',
        'To send: paste the address or name, pick the coin and the amount.',
        'Check the address twice, then sign.',
      ],
      honest: 'A transfer on Solana cannot be taken back. Check the address before you sign.',
      more: [],
      coming: ['Send privately', 'Private transfers to many', 'Contacts and autopay'],
    },
    uk: {
      title: 'Гроші',
      line: 'Надіслати, отримати й попросити оплату — SOL чи будь-яку монету, на адресу або ім’я.',
      open: 'Відкрити Гроші',
      does: [
        { title: 'Надіслати', line: 'На будь-яку адресу Solana або ім’я .skr — коротке ім’я власників телефона Seeker.' },
        { title: 'Отримати', line: 'Твоя адреса і її QR-код.' },
        { title: 'Рахунки', line: 'Посилання на оплату того, що тобі винні.' },
        { title: 'Останні перекази', line: 'Що ти надіслав і отримав — одним списком.' },
      ],
      how: [
        'Відкрий «Гроші» й обери «Надіслати», «Отримати» чи «Рахунки».',
        'Щоб надіслати: встав адресу чи ім’я, обери монету й суму.',
        'Перевір адресу двічі — і підпиши.',
      ],
      honest: 'Переказ у Solana не можна повернути. Перевір адресу до підпису.',
      more: [],
      coming: ['Надіслати приватно', 'Приватні перекази списком', 'Контакти й автоплатежі'],
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
      how: [
        'Open Rewards and connect your wallet.',
        'Copy your invite link and share it.',
        'Trade as usual: points and your rank grow by themselves; your share of friends’ fees shows on the same screen.',
      ],
      honest: 'Points are not money and have no promised value.',
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
      how: [
        'Відкрий «Винагороди» й підключи гаманець.',
        'Скопіюй посилання для друзів і поділися ним.',
        'Торгуй як завжди: бали й рівень ростуть самі; твоя частка з комісій друзів — на тому самому екрані.',
      ],
      honest: 'Бали — не гроші, і їхня цінність нічим не обіцяна.',
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
      line: 'Ryntra’s launches and pools run on Meteora. Where a coin has a DLMM Pro pool, its limit orders pay a bonus.',
      open: 'Open DLMM Pro',
      does: [],
      how: [
        'Open Earn → DLMM Pro and pick a pool.',
        'On the pool’s page choose Limit, then “Buy cheaper” or “Sell higher”.',
        'Set your price — one price or a ladder — and see the bonus before you sign.',
        'Leave “Agent collects what fills” on: it may only bring filled coins back to your wallet — it cannot trade or spend.',
      ],
      honest: 'A limit order earns its bonus only when it fills; in a small pool that may take a long time or never happen.',
      words: [
        { title: 'Meteora', line: 'Solana’s liquidity protocol behind the Dynamic Bonding Curve (the launch curve) and the DLMM, DLMM Pro and DAMM v2 pools.' },
        { title: 'DLMM', line: 'A pool that keeps money at exact prices, in small steps called bins.' },
        { title: 'DAMM v2', line: 'A classic pool that spreads money over a full or a narrower range of prices.' },
        { title: 'DLMM Pro', line: 'Meteora’s pool with built-in limit orders: they live inside it and earn part of its fee.' },
        { title: 'Limit bonus', line: 'The share of the pool’s fee a limit order earns when it fills.' },
      ],
      more: [
        { title: 'What the agent does', text: ['Say it: “Launch me a token”, “Buy MET for 10 USDC”. The agent opens the Meteora screen and fills it in; you sign.'] },
      ],
    },
    uk: {
      title: 'Meteora в Ryntra',
      line: 'Запуски й пули Ryntra працюють на Meteora. Де в монети є пул DLMM Pro, її лімітки платять бонус.',
      open: 'Відкрити DLMM Pro',
      does: [],
      how: [
        'Відкрий «Заробіток» → DLMM Pro й обери пул.',
        'На сторінці пулу обери «Ліміт», далі «Купити дешевше» чи «Продати дорожче».',
        'Постав ціну — одну чи драбиною — і подивись бонус до підпису.',
        'Лиши «Агент збере виконане» увімкненим: він може лише повернути виконане в твій гаманець — ні торгувати, ні витрачати.',
      ],
      honest: 'Лімітка отримує бонус, лише коли виконується; у малому пулі це може тривати довго або не статися.',
      words: [
        { title: 'Meteora', line: 'Протокол ліквідності Solana, що стоїть за Dynamic Bonding Curve (кривою запуску) і пулами DLMM, DLMM Pro та DAMM v2.' },
        { title: 'DLMM', line: 'Пул, що тримає гроші на точних цінах, дрібними кроками — бінами.' },
        { title: 'DAMM v2', line: 'Класичний пул, що розподіляє гроші на повний чи вужчий діапазон цін.' },
        { title: 'DLMM Pro', line: 'Пул Meteora з вбудованими лімітками: вони живуть усередині нього й отримують частину його комісії.' },
        { title: 'Бонус лімітки', line: 'Частка комісії пулу, яку отримує лімітка, коли виконується.' },
      ],
      more: [
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
          line: 'A coin on Meteora’s launch curve, or straight into its own DLMM Pro pool — one signature.',
          more: ['On the curve the coin moves to a Meteora pool by itself as it grows, and its liquidity is locked.', 'In its own pool it trades in DLMM Pro from the start; you choose when trading opens.'],
        },
        uk: {
          title: 'Запуск на Meteora',
          line: 'Монета на кривій запуску Meteora або одразу у своєму пулі DLMM Pro — одним підписом.',
          more: ['На кривій монета сама переходить у пул Meteora, коли росте, а її ліквідність замкнено.', 'У своєму пулі вона торгується в DLMM Pro від початку; коли відкрити торги, обираєш ти.'],
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
          more: ['DLMM holds liquidity in price bins; DAMM v2 is a classic pool with a full or a narrower range.', 'You choose the goal and the width of the range; the screen shows the shape before you sign.', 'Every pool has its own page with its chart, liquidity by price and trades.'],
        },
        uk: {
          title: 'Пули: DLMM і DAMM v2',
          line: 'Кожен пул з комісіями за день, ліквідністю й типом — вклади монети за своєю метою.',
          more: ['DLMM тримає ліквідність у цінових бінах; DAMM v2 — класичний пул з повним чи вужчим діапазоном.', 'Ти обираєш мету й ширину діапазону; форму позиції видно до підпису.', 'У кожного пулу — своя сторінка: графік, ліквідність за цінами й угоди.'],
        },
      },
      {
        key: 'pro',
        shot: 'pro',
        href: '/pro',
        live: true,
        en: {
          title: 'DLMM Pro pools',
          line: 'Every DLMM Pro pool on Solana, read straight from the chain: price, liquidity, fee and the limit bonus.',
          more: ['DLMM Pro is Meteora’s pool with built-in limit orders: they live inside the pool itself.', 'Pools of new launches are marked.', 'Put liquidity in by a goal, or draw your own shape on a grid of prices.'],
        },
        uk: {
          title: 'Пули DLMM Pro',
          line: 'Усі пули DLMM Pro в Solana, прочитані просто з блокчейну: ціна, ліквідність, комісія й бонус лімітки.',
          more: ['DLMM Pro — пул Meteora з вбудованими лімітками: вони живуть усередині самого пулу.', 'Пули нових запусків позначено.', 'Вклади ліквідність за метою або намалюй свою форму на сітці цін.'],
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
          more: ['A filled order gets the coin it asked for at that price, with no slippage.', 'The bonus shows before you sign. Place one price, or a ladder of several at once.', 'With “Agent collects what fills” on, the agent brings what filled to your wallet. That is all it may do: it cannot trade, cancel or spend.'],
        },
        uk: {
          title: 'Лімітки, що платять',
          line: 'Лімітка стоїть на одній точній ціні в пулі й отримує частку комісії пулу, коли виконується.',
          more: ['Виконана лімітка отримує монету саме за своєю ціною, без прослизання.', 'Бонус видно до підпису. Постав одну ціну або драбину з кількох одразу.', 'З «Агент збере виконане» агент забирає виконане в твій гаманець. Це все, що він може: ні торгувати, ні скасовувати, ні витрачати.'],
        },
      },
      {
        key: 'grid',
        shot: 'grid',
        href: '/bots/grid',
        live: true,
        en: {
          title: 'Grid on the chart',
          line: 'A grid bot on Meteora: buy levels below the price and sell levels above it, drawn on the coin’s chart.',
          more: ['Choose the coin, the amount, the low and high price — or ±5%, ±10%, ±20% — and how many levels.', 'Where the coin has a DLMM Pro pool, every filled level also earns the limit bonus.'],
        },
        uk: {
          title: 'Сітка на графіку',
          line: 'Бот «Сітка» на Meteora: рівні купівлі нижче ціни й продажу вище — просто на графіку монети.',
          more: ['Обери монету, суму, нижню й верхню ціну — або ±5 %, ±10 %, ±20 % — і кількість рівнів.', 'Де в монети є пул DLMM Pro, кожен виконаний рівень ще й отримує бонус лімітки.'],
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
          more: ['Choose three to eight prices between the first and the last; every price shows on the chart before you sign.'],
        },
        uk: {
          title: 'Драбина ордерів',
          line: 'Кілька ліміток у пулі монети на Meteora одразу — купити нижче чи продати вище — одним підписом.',
          more: ['Обери від трьох до восьми цін між першою й останньою; кожну ціну видно на графіку до підпису.'],
        },
      },
      {
        key: 'stocks',
        shot: 'stock-pool',
        href: '/pro',
        live: true,
        en: {
          title: 'Stocks in Meteora pools',
          line: 'Put a verified stock into its DLMM Pro pool as a position, or place a limit order that earns the bonus.',
          more: ['Only the DLMM Pro pools of a verified stock paired with SOL take a position; regular DLMM pools with stocks do not yet.', 'Before you sign, a line says the issuer can pause the token and take it back, even from the pool.', 'Outside exchange hours the pool’s price stands still; at the open it may jump.'],
        },
        uk: {
          title: 'Акції в пулах Meteora',
          line: 'Поклади перевірену акцію в її пул DLMM Pro позицією або постав лімітку, що отримує бонус.',
          more: ['Позицію приймають лише пули DLMM Pro перевіреної акції в парі з SOL; звичайні пули DLMM з акціями — поки ні.', 'Перед підписом рядок каже: емітент може зупинити токен і забрати його, навіть із пулу.', 'Поза годинами біржі ціна пулу стоїть, а на відкритті може стрибнути.'],
        },
      },
      {
        key: 'care',
        shot: null,
        href: null,
        live: false,
        en: {
          title: 'Pool keeper',
          line: 'Collect fees, put them back and keep the range near the price — while you are away.',
        },
        uk: {
          title: 'Доглядач пулу',
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
      line: 'Nothing starts without your signature. Ryntra never holds your keys or your money.',
      open: 'Open Ryntra',
      does: [
        { title: 'You sign', line: 'Every swap, launch, order and bot starts with your signature in your wallet.' },
        { title: 'You see it first', line: 'What you get, the least you get and the fee — on one line before you sign.' },
        { title: 'Your budget', line: 'You sign a bot’s budget once; inside it the bot acts by itself, and you can stop it anytime.' },
        { title: 'Coin facts', line: 'Holders, the top 10’s share, the creator and the coin’s rights before you buy.' },
      ],
      how: [
        'Read the line before every signature: what you give, what you get, the fee.',
        'Check a new coin’s facts and risk mark before you buy.',
        'Stop any bot from My bots whenever you want.',
      ],
      honest: 'Ryntra cannot undo a signed transaction, and cannot recover a wallet whose secret phrase is lost.',
      words: [
        { title: 'Keys', line: 'The secret that controls a wallet. Whoever has it controls the money.' },
        { title: 'Secret phrase', line: 'Twelve or twenty-four words that restore your wallet. Never type them into any site.' },
      ],
      more: [
        { title: 'What acts after you sign', text: ['Only two things: a bot, inside the budget you signed, and “Agent collects what fills” on a limit order, which can only bring filled coins back to your wallet.'] },
        { title: 'Positions', text: ['Pool, staking and lending positions and resting orders are controlled by your wallet, not by Ryntra. Only you can withdraw.'] },
        { title: 'Risks', text: ['Prices move and most new coins lose value. A bot or a pool can end at a loss. Use only what you can lose.'] },
        { title: 'Never share', text: ['No one from Ryntra will ever ask for your secret phrase.'] },
      ],
    },
    uk: {
      title: 'Ключі в тебе',
      line: 'Без твого підпису нічого не починається. Ryntra ніколи не тримає ні твоїх ключів, ні твоїх грошей.',
      open: 'Відкрити Ryntra',
      does: [
        { title: 'Підписуєш ти', line: 'Кожен обмін, запуск, ордер і бот починається з твого підпису в гаманці.' },
        { title: 'Бачиш наперед', line: 'Що отримаєш, щонайменше скільки й комісію — одним рядком до підпису.' },
        { title: 'Твій бюджет', line: 'Бюджет бота ти підписуєш один раз; у його межах бот діє сам, і зупинити його можна будь-коли.' },
        { title: 'Факти монети', line: 'Власники, частка топ-10, творець і права монети — до покупки.' },
      ],
      how: [
        'Читай рядок перед кожним підписом: що віддаєш, що отримуєш, комісію.',
        'Перевір факти й мітку ризику нової монети до покупки.',
        'Зупини будь-якого бота в «Моїх ботах», коли захочеш.',
      ],
      honest: 'Ryntra не може скасувати підписану транзакцію й не відновить гаманець, якщо загублено сід-фразу.',
      words: [
        { title: 'Ключі', line: 'Секрет, що керує гаманцем. Хто має його, той керує грошима.' },
        { title: 'Сід-фраза', line: 'Дванадцять чи двадцять чотири слова, що відновлюють гаманець. Ніколи не вписуй їх на жодному сайті.' },
      ],
      more: [
        { title: 'Що діє після підпису', text: ['Лише дві речі: бот — у межах бюджету, який ти підписав, і «Агент збере виконане» в лімітці, що може лише повернути виконані монети в твій гаманець.'] },
        { title: 'Позиції', text: ['Позиціями в пулах, стейкінгу й позиках і лімітками керує твій гаманець, не Ryntra. Забрати можеш лише ти.'] },
        { title: 'Ризики', text: ['Ціни рухаються, більшість нових монет втрачає в ціні. Бот чи пул може закінчитися збитком. Вкладай лише те, що готовий втратити.'] },
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
      how: [],
      more: [
        { title: 'What do I need to start?', text: ['A Solana wallet and a little SOL. SOL pays the tiny network fee of every move.'] },
        { title: 'Do I need an account?', text: ['No. Connect a Solana wallet — that is your account. No email, no password.'] },
        { title: 'Can the agent spend my money by itself?', text: ['No. The agent fills in forms; nothing starts without your signature. A bot spends only the budget you signed once, and you can stop it anytime.', 'On a limit order, “Agent collects what fills” may only bring filled coins back to your wallet.'] },
        { title: 'Can I try without money?', text: ['Yes. Bots have “Practice first”: they run on paper with the market’s real prices.'] },
        { title: 'How do I stop a bot?', text: ['Open Bots, find it under My bots and press Stop. You stop each bot separately.'] },
        { title: 'Where are my coins and pool positions?', text: ['Under your wallet’s control — only you can withdraw. Portfolio and Earn show them.'] },
        { title: 'Why does the fee line change?', text: ['The fee depends on the coin and the route. The line before you sign is the one that counts.'] },
        { title: 'Is there a phone app?', text: ['Open ryntra.io in your phone’s browser or your wallet app — the terminal fits a phone, with five tabs at the bottom.'] },
        { title: 'Something went wrong', text: ['Press “Write to us” on this page: say what you did and give your wallet address. Never send your secret phrase.'] },
      ],
    },
    uk: {
      title: 'Питання',
      line: 'Короткі відповіді на те, що питають найперше.',
      open: 'Написати нам',
      does: [],
      how: [],
      more: [
        { title: 'Що треба, щоб почати?', text: ['Гаманець Solana й трохи SOL. SOL платить крихітну комісію мережі за кожну дію.'] },
        { title: 'Чи потрібен акаунт?', text: ['Ні. Підключи гаманець Solana — це і є твій акаунт. Без пошти й пароля.'] },
        { title: 'Чи може агент сам витратити мої гроші?', text: ['Ні. Агент заповнює форми; без твого підпису нічого не починається. Бот витрачає лише бюджет, який ти підписав один раз, і зупинити його можна будь-коли.', 'У лімітці «Агент збере виконане» може лише повернути виконані монети в твій гаманець.'] },
        { title: 'Чи можна спробувати без грошей?', text: ['Так. У ботів є «Спершу потренуватись»: вони працюють на папері зі справжніми цінами ринку.'] },
        { title: 'Як зупинити бота?', text: ['Відкрий «Боти», знайди його в «Моїх ботах» і натисни «Стоп». Кожного бота зупиняєш окремо.'] },
        { title: 'Де мої монети й позиції в пулах?', text: ['Під керуванням твого гаманця — забрати можеш лише ти. Їх показують «Портфель» і «Заробіток».'] },
        { title: 'Чому змінюється рядок комісії?', text: ['Комісія залежить від монети й маршруту. Важить той рядок, що перед підписом.'] },
        { title: 'Чи є застосунок для телефона?', text: ['Відкрий ryntra.io у браузері телефона чи в застосунку гаманця — термінал підлаштований під телефон, унизу п’ять вкладок.'] },
        { title: 'Щось пішло не так', text: ['Натисни «Написати нам» на цій сторінці: що робив і адресу гаманця. Сід-фразу не надсилай ніколи.'] },
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
    { title: 'Ryntra Private', line: 'A private balance on the same screens: pay many people at once, get paid by private invoices and swap privately.' },
    { title: 'Stocks at the exchange price', line: 'Buy stocks at the price of the exchange, put them into regular DLMM pools, launch a coin paired with a stock.' },
    { title: 'Agents that act', line: 'An AI trader that exits on its own, a scout for new coins and your own AI — inside the budget you sign.' },
  ],
  uk: [
    { title: 'Ryntra Private', line: 'Приватний баланс на тих самих екранах: плати багатьом одразу, отримуй оплату приватними рахунками й обмінюй приватно.' },
    { title: 'Акції за ціною біржі', line: 'Купувати акції за ціною біржі, класти їх у звичайні пули DLMM, запускати монету в парі з акцією.' },
    { title: 'Агенти, що діють', line: 'AI-трейдер, що сам виходить з угод, скаут нових монет і свій AI — у межах бюджету, який ти підписуєш.' },
  ],
};

/** The pages' own words. */
export const UI = {
  en: {
    docs: 'Docs',
    hubTitle: 'Ryntra docs',
    motto: 'Say it. Your agent does the rest.',
    hubLine: 'An AI terminal on Solana: you say it, the agent sets it up, you sign. What it does today, how to use it, and where it is going.',
    start: 'Start here',
    quick: 'Start in a minute',
    featured: 'Built on Meteora',
    ahead: 'Where we’re going',
    roadmap: 'Open the roadmap',
    canDo: 'What you can do',
    how: 'How',
    honest: 'Honestly',
    words: 'Words used here',
    coming: 'Coming',
    live: 'Live',
    prev: 'Previous',
    next: 'Next',
    more: 'More',
    language: 'Language',
    sections: 'Sections',
    shotAlt: (title: string) => `${title} on ryntra.io`,
    open: 'Open',
    tab: 'Ryntra Docs — the AI terminal on Solana',
    tabDocs: 'Ryntra Docs',
  },
  uk: {
    docs: 'Документація',
    hubTitle: 'Документація Ryntra',
    motto: 'Скажи. Твій агент зробить решту.',
    hubLine: 'AI-термінал на Solana: ти кажеш, агент готує, ти підписуєш. Що він уміє сьогодні, як ним користуватись і куди ми рухаємось.',
    start: 'Почни звідси',
    quick: 'Почни за хвилину',
    featured: 'Побудовано на Meteora',
    ahead: 'Куди рухаємось',
    roadmap: 'Відкрити дорожню карту',
    canDo: 'Що можна зробити',
    how: 'Як',
    honest: 'Чесно',
    words: 'Слова на цій сторінці',
    coming: 'Будується',
    live: 'Наживо',
    prev: 'Назад',
    next: 'Далі',
    more: 'Докладніше',
    language: 'Мова',
    sections: 'Розділи',
    shotAlt: (title: string) => `${title} на ryntra.io`,
    open: 'Відкрити',
    tab: 'Документація Ryntra — AI-термінал на Solana',
    tabDocs: 'Документація Ryntra',
  },
} as const;

/**
 * A page's name in the browser's tab, in the reader's language: the docs' first page carries its own line, a section is
 * «<its name> — Ryntra Docs». The server names the page in English (`app/docs/page.tsx`, `app/docs/[...slug]/page.tsx`)
 * before it knows the language the reader keeps; the page puts its own language's name once it does (`useDocsTabTitle`).
 */
export function docsTabTitle(id: SectionId | null, lang: Lang): string {
  return id ? `${sectionOf(id)[lang].title} — ${UI[lang].tabDocs}` : UI[lang].tab;
}
