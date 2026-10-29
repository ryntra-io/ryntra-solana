import { list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Portfolio and History under the menu's «Портфель», Settings under Start —
 * what the product knows about your money and your operations, and what it
 * never claims. The pages keep their `manage/*` addresses.
 */

export const PORTFOLIO: DocPage = {
  slug: "manage/portfolio",
  group: "portfolio",
  pageId: "portfolio",
  title: { en: "Portfolio", uk: "Портфель" },
  summary: {
    en: "What your wallet owns and what it is worth, read from the chain: tokens, stocks and memes, pool positions, open orders and Perps collateral in one total.",
    uk: "Що має твій гаманець і скільки це коштує, прочитане з ланцюга: токени, акції й меми, позиції в пулах, відкриті ордери й застава Perps — в одній сумі.",
  },
  sections: [
    section("what", "What Portfolio shows", "Що показує Портфель", [
      p(
        "Money → Portfolio is the state of your money on Solana, read by your wallet's public address — no signature needed. The total value adds up the wallet, your positions in pools, what waits in your open orders and your collateral on Phoenix; the day's change beside it is the wallet's. Below it, the holdings as a broker would show them — price, the day's move, amount, value and share of the wallet — under All, Crypto, Stocks/RWA and Memes.",
        "Гроші → Портфель — стан твоїх грошей на Solana, прочитаний за публічною адресою гаманця, без підпису. Загальна вартість складає гаманець, твої позиції в пулах, те, що чекає у відкритих ордерах, і твою заставу на Phoenix; денна зміна поруч — гаманця. Нижче — активи так, як їх показав би брокер: ціна, рух за день, кількість, вартість і частка гаманця — у вкладках «Усі», «Крипта», «Акції/RWA» й «Меми».",
      ),
      list(
        [
          "An unknown price is not zero: the total is the sum of what could be priced, it says how many assets it could not price, and an unpriced row shows a dash.",
          "Small and unpriced balances fold under one line; they are never deleted.",
          "When part of the wallet could not be read, the page says the list may be incomplete and the value is at least the figure shown.",
          "Your pool positions, your Perps positions on Phoenix — entry, mark and result — and what is moving between networks have their own blocks; a row opens the asset, a company opens its page.",
        ],
        [
          "Невідома ціна — не нуль: сума складається з того, що вдалося оцінити, каже, скільки активів оцінити не вдалося, а рядок без ціни показує риску.",
          "Малі й неоцінені баланси згорнуто в один рядок; вони ніколи не видаляються.",
          "Коли частину гаманця не вдалося прочитати, сторінка каже, що список може бути неповним, а вартість — щонайменше показана.",
          "Твої позиції в пулах, позиції Perps на Phoenix — вхід, марк і результат — і те, що рухається між мережами, мають свої блоки; рядок відкриває актив, компанія — свою сторінку.",
        ],
      ),
    ]),
    section("risk", "Portfolio risk on Home", "Ризик портфеля на Головній", [
      p(
        "Home says one word for the whole wallet, by Ryntra's published rules, once the wallet is confirmed with a signature. «Normal»: no position has reached its loss limit or target, no asset is above 25% of the wallet, private companies together are at most 10%, and no company goes into the weekend without a loss limit. The 25% cap applies from a wallet of $500, the 10% at any size; dollars (USDC, USDT, PYUSD, USDS) count in the total and have no cap.",
        "Головна каже одне слово про весь гаманець за опублікованими правилами Ryntra, щойно гаманець підтверджено підписом. «Нормальний»: жодна позиція не дійшла до межі збитку чи цілі, жоден актив не більший за 25% гаманця, приватні компанії разом — не більше 10%, і жодна компанія не йде на вихідні без межі збитку. Межа 25% діє з гаманця від $500, межа 10% — за будь-якої суми; долари (USDC, USDT, PYUSD, USDS) входять у суму, але межі не мають.",
      ),
      list(
        [
          "«Attention» names the reason and one action — open the sale, set a limit, take a look; more reasons open under it.",
          "«Could not check» says what could not be read — a price, part of the wallet, a position's limit — and is never shown as «Normal». A token Ryntra cannot vouch for — unverified, or with no market — is left out of the risk's count.",
          "It is a hint, not advice: Ryntra buys and sells nothing for you.",
        ],
        [
          "«Увага» називає причину й одну дію — відкрити продаж, поставити межу, подивитись; інші причини відкриваються під нею.",
          "«Не вдалося перевірити» каже, чого не вдалося прочитати — ціни, частини гаманця, межі позиції, — і ніколи не показується як «Нормальний». Токен, за який Ryntra не може поручитися, — неперевірений чи без ринку, — лишається поза розрахунком ризику.",
          "Це підказка, не порада: Ryntra нічого не купує й не продає за тебе.",
        ],
      ),
    ]),
  ],
  related: ["manage/pools", "manage/activity", "start/wallet"],
};

export const POOLS: DocPage = {
  slug: "manage/pools",
  group: "portfolio",
  destination: "pools",
  title: { en: "Pools", uk: "Пули" },
  seoTitle: { en: "Pools: Meteora liquidity on Solana — Ryntra Docs", uk: "Пули: ліквідність Meteora на Solana — Документація Ryntra" },
  summary: {
    en: "Meteora's pools on Solana — how deep, what traded, what trades pay — and your own positions: add liquidity, collect fees, withdraw, each with your signature.",
    uk: "Пули Meteora на Solana — глибина, обіг, комісія угоди — і твої власні позиції: додати ліквідність, забрати комісії, вилучити, кожне твоїм підписом.",
  },
  sections: [
    section("what", "What Pools are", "Що таке Пули", [
      p(
        "Earning → Pools lists Meteora's pools on Solana of two kinds: stepped (DLMM — liquidity in the pool's price steps) and smooth (DAMM v2 — liquidity along a curve). Each row shows the pool's depth (TVL), its volume and fees over the past day, its fee now and fees against TVL — a fact of the day gone, never a projected yield. Search by a pair or an address, sort by any column; a pool's page shows how its liquidity is spread and a simulator of a position against simply holding.",
        "Заробіток → Пули показує пули Meteora на Solana двох видів: покрокові (DLMM — ліквідність у кроках ціни пулу) і плавні (DAMM v2 — ліквідність уздовж кривої). Кожен рядок показує глибину пулу (TVL), обсяг і комісії за минулу добу, комісію зараз і комісії до TVL — факт минулого дня, ніколи не прогноз дохідності. Шукай за парою чи адресою, сортуй за будь-якою колонкою; сторінка пулу показує, як розкладено його ліквідність, і симулятор позиції проти «просто тримати».",
      ),
    ]),
    section("act", "Your positions", "Твої позиції", [
      steps(
        [
          "Open a pool and press Add liquidity. On a stepped pool choose the range around the price; on a smooth one the tokens go into the curve. The form shows what you put in, the range and the rent a new position keeps.",
          "Read the Review and sign. The position appears under My positions with its holdings, its unclaimed fees and whether the price is inside its range.",
          "Claim fees, add more, or withdraw part or all — each through its own Review and signature. Closing a position returns its rent.",
        ],
        [
          "Відкрий пул і натисни «Додати ліквідність». На покроковому пулі обери діапазон навколо ціни; на плавному токени лягають у криву. Форма показує, що ти вносиш, діапазон і ренту, яку тримає нова позиція.",
          "Прочитай «Перевірку» і підпиши. Позиція з'явиться в «Мої позиції» зі своїм вмістом, незабраними комісіями й тим, чи ціна в її діапазоні.",
          "Забери комісії, додай ще або вилучи частину чи все — кожне через свою «Перевірку» і підпис. Закриття позиції повертає ренту.",
        ],
      ),
      list(
        [
          "Ryntra adds no fee to adding, withdrawing or collecting; the pool's own fee is what traders pay and what your position earns.",
          "A position earns while the price is inside its range. Outside it, the position holds one token and earns nothing, and against simply holding it can be worth less — the simulator shows both before you add.",
          "A grid from Bots is a stepped position too, and shows here as well.",
        ],
        [
          "Ryntra не додає комісії до внесення, вилучення чи збору; власна комісія пулу — це те, що платять трейдери й заробляє твоя позиція.",
          "Позиція заробляє, поки ціна в її діапазоні. Поза ним позиція тримає один токен і нічого не заробляє, а проти «просто тримати» може коштувати менше — симулятор показує обидва варіанти до внесення.",
          "Грід із Ботів — теж покрокова позиція, і вона видна тут також.",
        ],
      ),
    ]),
  ],
  related: ["bots", "manage/portfolio", "reference/fees"],
};

export const ACTIVITY: DocPage = {
  slug: "manage/activity",
  group: "money",
  pageId: "activity",
  title: { en: "History", uk: "Історія" },
  summary: {
    en: "Everything your wallet did through Ryntra in one list — swaps, Spot and Launch trades, bridges, sends and receipts — with a status in one word and an export.",
    uk: "Усе, що твій гаманець зробив через Ryntra, — одним списком: обміни, угоди Споту й Лаунчу, мости, перекази й надходження — зі статусом одним словом і експортом.",
  },
  sections: [
    section("what", "What History is", "Що таке Історія", [
      p(
        "Money → History is the record of your wallet's operations through Ryntra, newest first, filtered by kind: All, Spot, Launch, Swap, Between networks, Sent, Received and Needs you. Each entry shows what left, what arrived, the transaction and where it stands; opening it shows its receipt.",
        "Гроші → Історія — запис операцій твого гаманця через Ryntra, найновіші зверху, з фільтром за видом: Усі, Спот, Лаунч, Обмін, Між мережами, Надіслано, Отримано й «Потрібна твоя дія». Кожен запис показує, що пішло, що надійшло, транзакцію й де вона зараз; відкритий запис показує квитанцію.",
      ),
      table(
        { en: ["Status", "Meaning"], uk: ["Статус", "Значення"] },
        {
          en: [
            ["On its way", "Signed and sent; the network or the provider has not finished yet."],
            ["Arrived", "Landed where it was going, in the amount the receipt records."],
            ["Did not happen", "Did not go through. The reason is shown when the network or the provider gave one; a failure never becomes a zero balance or a missing entry."],
            ["Needs you", "Waits for your action — for example, a refund that arrived and is worth a look."],
          ],
          uk: [
            ["У дорозі", "Підписано й надіслано; мережа чи постачальник ще не завершили."],
            ["Надійшло", "Дійшло, куди йшло, у сумі, яку записує квитанція."],
            ["Не відбулося", "Не пройшло. Причину показано, коли її дали мережа чи провайдер; невдача ніколи не стає нульовим балансом чи зниклим записом."],
            ["Потрібна твоя дія", "Чекає на тебе — наприклад, повернення, що надійшло й на яке варто глянути."],
          ],
        },
      ),
      p(
        "Export downloads the list you see as a CSV — the date, the kind, the state, what was sent and received, the transactions and Ryntra's fee when it was collected.",
        "«Експорт» завантажує видимий список як CSV — дата, вид, стан, що надіслано й отримано, транзакції й комісія Ryntra, коли її зібрано.",
      ),
    ]),
  ],
  related: ["reference/receipts", "manage/portfolio", "reference/troubleshooting"],
};

export const SETTINGS: DocPage = {
  slug: "manage/settings",
  group: "start",
  title: { en: "Account and notifications", uk: "Акаунт і сповіщення" },
  summary: {
    en: "Your wallet and account, the Telegram notification channel, language and theme, and what clearing site data removes.",
    uk: "Твій гаманець і акаунт, канал сповіщень у Telegram, мова й тема і що прибирає очищення даних сайту.",
  },
  sections: [
    section("account", "Wallet and account", "Гаманець і акаунт", [
      list(
        [
          "The connected wallet, the account signed in with it, and Sign out on this device and Sign out everywhere.",
          "What connecting a wallet allows — balances, prices, mints and your own operations — and why a signature sits beside every figure Ryntra prepares.",
          "Why there is no network switch: the app works on Solana Mainnet only.",
        ],
        [
          "Підключений гаманець, акаунт, у який ним увійдено, і «Вийти на цьому пристрої» та «Вийти всюди».",
          "Що дозволяє підключення гаманця — баланси, ціни, mint-адреси й твої власні операції — і чому підпис стоїть біля кожної цифри, яку готує Ryntra.",
          "Чому немає перемикача мереж: застосунок працює лише на Solana Mainnet.",
        ],
      ),
    ]),
    section("telegram", "Telegram as a notification channel", "Telegram як канал сповіщень", [
      steps(
        [
          "Sign in with your wallet, then open Account from your wallet's panel and choose Connect Telegram.",
          "Ryntra shows a one-time link to its bot. Open it in Telegram and press Start; the code in the link binds the chat to your account.",
          "Recurring-buy reminders and notes about your operations arrive in that chat. Disconnect from the same place at any time — it removes only the channel, never the account.",
        ],
        [
          "Увійди гаманцем, потім відкрий «Акаунт» у панелі гаманця й обери «Підключити Telegram».",
          "Ryntra покаже одноразове посилання на свого бота. Відкрий його в Telegram і натисни Start; код у посиланні прив'язує чат до твого акаунта.",
          "Нагадування регулярної купівлі й нотатки про твої операції приходять у цей чат. Від'єднати можна там само будь-коли — це прибирає лише канал, ніколи не акаунт.",
        ],
      ),
      note(
        "Telegram is a channel, not a sign-in. Ryntra's bot never asks for a wallet, a seed phrase or a payment; a message that does is not from Ryntra.",
        "Telegram — канал, а не спосіб входу. Бот Ryntra ніколи не просить гаманця, сід-фрази чи платежу; повідомлення, яке просить, — не від Ryntra.",
        "caution",
      ),
    ]),
    section("preferences", "Preferences", "Уподобання", [
      table(
        { en: ["Setting", "Where it lives"], uk: ["Налаштування", "Де зберігається"] },
        {
          en: [
            ["Language — English or Ukrainian", "On this device"],
            ["Theme — dark or light", "On this device"],
            ["Watchlist", "On this device at once, and on the account once the wallet is signed in — so it follows the wallet"],
          ],
          uk: [
            ["Мова — англійська чи українська", "На цьому пристрої"],
            ["Тема — темна чи світла", "На цьому пристрої"],
            ["Обране", "Одразу на цьому пристрої, а після входу гаманцем — в акаунті, тож іде за гаманцем"],
          ],
        },
      ),
      p(
        "Clearing this site's data in your browser removes what the browser keeps — the theme, cached reads, the current session and the receipts kept here. It does not remove your account, your history or your rewards: those belong to the wallet and come back when you sign in again.",
        "Очищення даних цього сайту у браузері прибирає те, що зберігає браузер, — тему, кешовані читання, поточну сесію й збережені тут квитанції. Воно не видаляє твого акаунта, історії чи винагород: вони належать гаманцю й повертаються, щойно ти знову ввійдеш.",
      ),
    ]),
  ],
  related: ["start/wallet", "money/rewards"],
};

export const MANAGE_PAGES: readonly DocPage[] = [PORTFOLIO, ACTIVITY];
