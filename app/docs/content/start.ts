import { FEES, FEES_UK, PURCHASE } from "./facts.ts";
import { facts, links, list, note, p, productPages, section, steps, table, type DocPage } from "./model.ts";

/**
 * Start here — what Ryntra is, the first company from $1, the wallet, the
 * menu (since the site's redesign: the hub and «Початок» rewritten for a
 * purchase in dollars rather than a first swap, «the cabinet» become the menu,
 * Ukrainian in «ти» as the app and the landing).
 *
 * The overview is the one page that says what Ryntra is and says it once;
 * every later page describes a thing the reader can open.
 */

export const OVERVIEW: DocPage = {
  slug: "",
  group: "start",
  title: { en: "Ryntra documentation", uk: "Документація Ryntra" },
  seoTitle: { en: "Ryntra Docs — trade, launch and automate on Solana", uk: "Документація Ryntra — торгівля, лаунч і боти на Solana" },
  summary: {
    en: "How every Ryntra product works on Solana — trading, Perps, Predictions, bots, Launch, pools, money, rewards, the assistant, the phone — and what each costs.",
    uk: "Як працює кожен продукт Ryntra на Solana — торгівля, Perps, Прогнози, боти, Лаунч, пули, гроші, винагороди, помічник, телефон — і скільки кожен коштує.",
  },
  sections: [
    section("what", "What Ryntra is", "Що таке Ryntra", [
      p(
        "Ryntra is a Solana-native financial operations platform: trade, launch and automate from your own wallet, in one place. Ryntra finds the route, prepares each action and shows it in the Review; your wallet signs it, and what you hold stays in your wallet.",
        "Ryntra — Solana-native платформа фінансових операцій: торгуй, запускай і автоматизуй зі свого гаманця, в одному місці. Ryntra знаходить маршрут, готує кожну дію й показує її у «Перевірці»; підписує твій гаманець, і все, що маєш, лишається в ньому.",
      ),
      facts(
        [
          ["Network", "Solana Mainnet"],
          ["Your money", "In your own wallet — Ryntra never holds it, and never holds a key"],
          ["Account", "Your wallet; signing in is a message it signs"],
          ["Service fee", `By product: up to ${FEES.flow("MEME")} of a swap of a new token, none between dollars, on launching or in pools — shown with its amount before you sign`],
          ["Languages", "English and Ukrainian"],
        ],
        [
          ["Мережа", "Solana Mainnet"],
          ["Твої гроші", "У твоєму гаманці — Ryntra їх не тримає і не тримає жодного ключа"],
          ["Акаунт", "Твій гаманець; вхід — повідомлення, яке він підписує"],
          ["Комісія Ryntra", `За продуктом: до ${FEES_UK.flow("MEME")} обміну нового токена, нічого між доларами, на запуску токена й у пулах — сума видна до підпису`],
          ["Мови", "Англійська й українська"],
        ],
      ),
    ]),
    section("products", "The products", "Продукти", [
      table(
        { en: ["Product", "What it does", "Where"], uk: ["Продукт", "Що робить", "Де"] },
        {
          en: [
            ["Trading", "Spot, Swap and Markets: crypto, memes and tokenized stocks, at the market or with a limit", "Trading"],
            ["Perps", "Phoenix's perpetual futures with leverage, from your Solana wallet", "Trading → Perps"],
            ["Predictions", "Markets on outcomes from many venues through AGG; today a simulation", "Trading → Predictions"],
            ["Bots and grid", "A grid in a Meteora pool, recurring buys, trade plans", "Automation → Bots"],
            ["Launch", "Your token on a bonding curve in one signature, and the creator's cabinet", "Trading → Launch"],
            ["Portfolio and pools", "Everything you own in one total; Meteora pools and your positions", "Money → Portfolio · Earning → Pools"],
            ["Money and wallet", "Add funds, Send, Receive, Between networks, History", "Money"],
            ["Rewards", "Cashback and referral shares of the fee Ryntra received, in USDC", "Earning → Rewards"],
            ["Ryntra assistant", "Answers, watches the market, briefs you — never trades", "Automation → Ryntra assistant"],
            ["Phone", "Ryntra for Android in the Solana dApp Store", "Seeker and Android"],
          ],
          uk: [
            ["Торгівля", "Спот, Обмін і Ринки: крипта, меми й токенізовані акції, за ринком чи лімітом", "Торгівля"],
            ["Perps", "Безстрокові ф'ючерси Phoenix із плечем, з гаманця Solana", "Торгівля → Perps"],
            ["Прогнози", "Ринки на події з багатьох майданчиків через AGG; сьогодні — симуляція", "Торгівля → Прогнози"],
            ["Боти й грід", "Грід у пулі Meteora, регулярна купівля, плани угод", "Автоматика → Боти"],
            ["Лаунч", "Твій токен на кривій одним підписом і кабінет творця", "Торгівля → Лаунч"],
            ["Портфель і пули", "Усе, що маєш, в одній сумі; пули Meteora й твої позиції", "Гроші → Портфель · Заробіток → Пули"],
            ["Гроші й гаманець", "Поповнити, Надіслати, Отримати, Між мережами, Історія", "Гроші"],
            ["Винагороди", "Кешбек і реферальні частки комісії, яку отримала Ryntra, у USDC", "Заробіток → Винагороди"],
            ["Помічник Ryntra", "Відповідає, стежить за ринком, робить огляди — ніколи не торгує", "Автоматика → Помічник Ryntra"],
            ["Телефон", "Ryntra для Android у Solana dApp Store", "Seeker і Android"],
          ],
        },
      ),
    ]),
    section("principles", "What Ryntra does not do", "Чого Ryntra не робить", [
      list(
        [
          "It does not hold money, keys or seed phrases, and never asks for them.",
          "It does not trade for you. The Ryntra assistant explains; bots remind or wait in a pool you chose; you decide and sign.",
          "It does not show a quote as a result, or a fee as income before it is collected.",
          "It does not promise profit, and nothing here is financial advice.",
        ],
        [
          "Не тримає грошей, ключів чи сід-фраз і ніколи їх не просить.",
          "Не торгує за тебе. Помічник Ryntra пояснює; боти нагадують або чекають у пулі, який ти обрав; вирішуєш і підписуєш ти.",
          "Не видає котирування за результат, а комісію — за дохід до того, як її зібрано.",
          "Не обіцяє прибутку; ніщо тут не є фінансовою порадою.",
        ],
      ),
    ]),
    section("about", "About Ryntra", "Про Ryntra", [
      links([
        { href: "/company", en: "About Ryntra", uk: "Про Ryntra" },
        { href: "/security", en: "Security", uk: "Безпека" },
        { href: "/methodology", en: "Where the figures come from", uk: "Звідки цифри" },
        { href: "/support", en: "Support", uk: "Підтримка" },
        { href: "/contact", en: "Contact", uk: "Контакти" },
      ]),
    ]),
  ],
  related: ["start/getting-started", "trade/overview", "reference/fees", "reference/networks"],
};

export const GETTING_STARTED: DocPage = {
  slug: "start/getting-started",
  group: "start",
  title: { en: "Getting started", uk: "Початок" },
  seoTitle: { en: "Getting started with Ryntra on Solana — Ryntra Docs", uk: "Початок роботи з Ryntra на Solana — Документація Ryntra" },
  summary: {
    en: "Connect a Solana wallet, add USDC and a little SOL, make your first trade through the Review, and find it in Portfolio and History.",
    uk: "Підключи гаманець Solana, додай USDC і трохи SOL, зроби першу угоду через «Перевірку» і знайди її в Портфелі та Історії.",
  },
  sections: [
    section("first", "Your first trade", "Перша угода", [
      steps(
        [
          "Open Ryntra. It opens on Home. On a computer the menu on the left shows every group by name; on a phone the bar at the bottom holds Home, Trading, Money, Portfolio and Menu.",
          "Connect the wallet you already use — Phantom, Solflare, Backpack or any wallet that supports the Solana Wallet Standard. Ryntra reads your public address; it never sees your keys.",
          "If the wallet is empty, open Money → Add funds: USDC to spend and a little SOL for the network, by a card, an exchange, another network or another wallet.",
          `Pick what to trade — a token in Spot or Swap, a company from Markets from $${PURCHASE.minimum} — and type the amount.`,
          "Read the Review — what leaves, what arrives at least, every cost by name — and sign in your wallet.",
          "Find what you bought in Portfolio, and the trade with its receipt in History.",
        ],
        [
          "Відкрий Ryntra. Вона відкривається на Головній. На комп'ютері меню ліворуч показує всі групи за назвами; на телефоні внизу бар: Головна, Торгівля, Гроші, Портфель і Меню.",
          "Підключи гаманець, яким уже користуєшся, — Phantom, Solflare, Backpack чи будь-який гаманець із Solana Wallet Standard. Ryntra читає твою публічну адресу; ключів вона не бачить ніколи.",
          "Якщо гаманець порожній, відкрий Гроші → Поповнити: USDC, щоб витрачати, і трохи SOL на мережу — карткою, з біржі, з іншої мережі чи з іншого гаманця.",
          `Обери, чим торгувати, — токен у Споті чи Обміні, компанію з Ринків від $${PURCHASE.minimum}, — і впиши суму.`,
          "Прочитай «Перевірку» — що спишеться, що надійде щонайменше, кожна витрата на ім'я — і підпиши в гаманці.",
          "Знайди куплене в Портфелі, а угоду з квитанцією — в Історії.",
        ],
      ),
      note(
        "You can look around without a wallet: Markets, every token's and company's page, every launch and every prediction market are open to everyone. What you own, your history and your rewards appear once a wallet is connected, and a trade needs it.",
        "Роздивитися можна й без гаманця: Ринки, сторінка кожного токена й компанії, кожен лаунч і кожен ринок прогнозів відкриті для всіх. Що в тебе є, історія й винагороди з'являються, щойно гаманець підключено, а для угоди він потрібен.",
      ),
    ]),
    section("next", "What next", "Що далі", [
      list(
        [
          "Perps — trade Phoenix's perpetual futures with your collateral on your own Phoenix account.",
          "Bots — place a grid in a Meteora pool, or set a recurring buy that reminds you and waits for your signature.",
          "Launch — put your own token on a bonding curve in one signature, and follow it in the creator's cabinet.",
          "Connect Telegram in Account, and reminders, notes and the assistant come to that chat too.",
        ],
        [
          "Perps — торгуй безстроковими ф'ючерсами Phoenix із заставою на власному рахунку Phoenix.",
          "Боти — постав грід у пулі Meteora або регулярну купівлю, що нагадує й чекає твого підпису.",
          "Лаунч — запусти власний токен на кривій одним підписом і веди його в кабінеті творця.",
          "Підключи Telegram в «Акаунті» — і нагадування, нотатки й помічник прийдуть і в цей чат.",
        ],
      ),
    ]),
  ],
  related: ["start/wallet", "money/top-up", "trade/overview", "reference/review"],
};

export const WALLET: DocPage = {
  slug: "start/wallet",
  group: "money",
  title: { en: "Wallet and account", uk: "Гаманець і акаунт" },
  summary: {
    en: "Your wallet is your account. How connecting, signing in and signing out work, and what Ryntra can and cannot do with a connected wallet.",
    uk: "Твій гаманець — це твій акаунт. Як працюють підключення, вхід і вихід і що Ryntra може й не може робити з підключеним гаманцем.",
  },
  sections: [
    section("connect", "Connecting", "Підключення", [
      steps(
        [
          "Press Connect in the top bar and choose your wallet. Ryntra lists the wallets installed in your browser; on a phone, open ryntra.io inside the wallet's own browser.",
          "Approve the connection in the wallet. This shares your public address and nothing else.",
          "Check the shortened address in the top bar. The app always shows which wallet it is reading.",
        ],
        [
          "Натисни «Підключити» у верхній панелі й обери гаманець. Ryntra показує гаманці, встановлені у твоєму браузері; на телефоні відкрий ryntra.io у вбудованому браузері гаманця.",
          "Схвали підключення в гаманці. Це передає лише твою публічну адресу й нічого більше.",
          "Перевір скорочену адресу у верхній панелі. Застосунок завжди показує, який гаманець він читає.",
        ],
      ),
      facts(
        [
          ["Supported", "Any wallet that implements the Solana Wallet Standard — Phantom, Solflare, Backpack and others"],
          ["Network", "Solana Mainnet only; there is no network switch, so a wrong-network mistake cannot happen"],
          ["Shared with Ryntra", "Your public address"],
          ["Never shared", "Seed phrase, private keys, wallet password"],
        ],
        [
          ["Підтримка", "Будь-який гаманець із Solana Wallet Standard — Phantom, Solflare, Backpack та інші"],
          ["Мережа", "Лише Solana Mainnet; перемикача мереж немає, тож помилки «не та мережа» не буває"],
          ["Передається Ryntra", "Твоя публічна адреса"],
          ["Ніколи не передається", "Сід-фраза, приватні ключі, пароль гаманця"],
        ],
      ),
    ]),
    section("sign-in", "Signing in with the wallet", "Вхід гаманцем", [
      p(
        "A connected wallet lets you see what it holds and trade. Signing in links an account to that wallet: your recurring-buy rules, plans, Rewards, points, referral link and notes follow the wallet, not the browser. The sign-in is a message your wallet signs — it costs nothing and moves nothing.",
        "Підключений гаманець дає бачити, що в ньому, і торгувати. Вхід прив'язує акаунт до цього гаманця: твої правила регулярної купівлі, плани, Винагороди, очки, реферальне посилання й нотатки йдуть за гаманцем, а не за браузером. Вхід — повідомлення, яке підписує гаманець: воно нічого не коштує й нічого не рухає.",
      ),
      list(
        [
          "The wallet is the identity that counts: nothing moves money without its signature, however else you are signed in.",
          "A sign-in lasts up to 30 days on a device; Sign out on this device ends it here, Sign out everywhere ends every session of this wallet.",
          "Telegram can be connected from Account as a notification channel. It is not a way to sign in.",
        ],
        [
          "Ідентичність, що важить, — гаманець: без його підпису гроші не рухаються, хоч як іще ти ввійшов.",
          "Вхід діє на пристрої до 30 днів; «Вийти на цьому пристрої» завершує його тут, «Вийти всюди» — усі сесії цього гаманця.",
          "Telegram можна підключити в «Акаунті» як канал сповіщень. Це не спосіб входу.",
        ],
      ),
    ]),
    section("what-it-allows", "What a connected wallet allows", "Що дозволяє підключений гаманець", [
      table(
        { en: ["Ryntra can", "Ryntra cannot"], uk: ["Ryntra може", "Ryntra не може"] },
        {
          en: [
            ["Read your balances, token accounts and the operations it made for you", "Move any asset without a signature you give for that exact transaction"],
            ["Prepare a transaction for you to review and sign", "Change a transaction after you reviewed it — what you sign is what you reviewed"],
            ["Ask the wallet for a message signature to sign you in", "Sign anything on your behalf, or keep a standing permission"],
          ],
          uk: [
            ["Читати твої баланси, рахунки токенів і операції, які вона для тебе зробила", "Зрушити будь-який актив без твого підпису саме цієї транзакції"],
            ["Підготувати транзакцію, яку ти перевіриш і підпишеш", "Змінити транзакцію після «Перевірки» — підписуєш те, що перевірив"],
            ["Попросити гаманець підписати повідомлення для входу", "Підписати щось від твого імені або тримати постійний дозвіл"],
          ],
        },
      ),
      note(
        "On a shared device, disconnect the wallet and sign out in Account when you finish.",
        "На спільному пристрої від'єднай гаманець і вийди в «Акаунті», коли закінчиш.",
        "caution",
      ),
    ]),
  ],
  related: ["start/getting-started", "manage/settings", "reference/review"],
};

export const CABINET: DocPage = {
  slug: "start/cabinet",
  group: "start",
  title: { en: "The menu", uk: "Меню" },
  seoTitle: { en: "The menu: where everything is — Ryntra Docs", uk: "Меню: де що знайти — Документація Ryntra" },
  summary: {
    en: "Home, the four groups of the menu and the sixteen rows in them — one menu for everyone on the web — and what each row is for.",
    uk: "Головна, чотири групи меню і шістнадцять рядків у них — одне меню для всіх у вебі — і для чого кожен рядок.",
  },
  sections: [
    section("layout", "How the app is laid out", "Як влаштований застосунок", [
      p(
        "The menu is the same on a computer and in a phone's browser, for everyone and for a guest — the Android app draws the rows it has (see Ryntra on the phone): Home, then groups that open and close with their arrow and stay as you leave them. Trading — Spot, Swap, Markets (one screener for stocks, private companies, crypto and memes), Launch (every market launched on Ryntra, and My launches), Perps (Phoenix's perpetual futures) and Predictions (markets on outcomes through AGG). Automation — Bots (your grids, recurring-buy rules and trade plans, each with its result, and the Catalog) and the Ryntra assistant. Earning — Pools and Rewards. Money — Portfolio, Add funds, Send, Receive, Between networks and History; Money is open from your first visit. The menu holds only what works on this network. At the bottom of the menu: Settings — the menu's place, the theme, the density and the language; and Help. On a computer the menu stands on the left — wide, narrow or hidden, as chosen in Settings — and the [ key hides it. On a phone the bar at the bottom holds Home, Trading, Money — its four large actions: Add funds, Send, Receive, Between networks, and History — Portfolio and Menu, which opens this same menu.",
        "Меню однакове на комп'ютері й у браузері телефона, для всіх і для гостя — застосунок для Android показує ті рядки, що в ньому є (дивись «Ryntra в телефоні»): Головна, далі групи, що відкриваються й закриваються стрілкою і лишаються такими, як ти їх залишив. Торгівля — Спот, Обмін, Ринки (один скринер акцій, приватних компаній, крипти й мемів), Лаунч (усі ринки, запущені на Ryntra, і «Мої лаунчі»), Perps (безстрокові ф'ючерси Phoenix) і Прогнози (ринки на події через AGG). Автоматика — Боти (твої гріди, правила регулярної купівлі й плани угод, кожен зі своїм результатом, і «Каталог») та Помічник Ryntra. Заробіток — Пули й Винагороди. Гроші — Портфель, Поповнити, Надіслати, Отримати, Між мережами й Історія; «Гроші» відкриті з першого візиту. У меню лише те, що працює на цій мережі. Унизу меню: «Налаштування» — місце меню, тема, щільність і мова; і «Допомога». На комп'ютері меню стоїть ліворуч — широке, вузьке чи сховане, як обрано в «Налаштуваннях», — а клавіша [ його ховає. На телефоні внизу — бар: Головна, Торгівля, Гроші — її чотири великі дії: Поповнити, Надіслати, Отримати, Між мережами, і Історія, — Портфель і Меню, що відкриває це саме меню.",
      ),
      p(
        "In the header: search (Ctrl K) — a token by its name, its ticker or its contract address (a pasted address opens the token's page), a company, or an action such as «Launch a token» or «Add funds»; your USDC balance; your wallet, whose panel holds the address, what it holds, Account, Notifications — your notes and reminders — Feedback and Disconnect; and the Ryntra button, which opens the assistant with the screen you are on as its context. Nothing stands above a page: every place is a row of the menu, and «Launch a token» and «My launches» are buttons of the Launch page. Every page works, and none of them shows invented balances or quotes.",
        "У шапці: пошук (Ctrl K) — токен за назвою, тікером чи адресою контракту (вставлена адреса відкриває сторінку токена), компанія або дія, як-от «Запустити токен» чи «Поповнити»; твій баланс USDC; твій гаманець — у його панелі адреса, що в ньому, Акаунт, Сповіщення — твої нотатки й нагадування, — Відгук і Від'єднати; і кнопка Ryntra, що відкриває помічника з екраном, на якому ти є, як контекстом. Над сторінкою нічого не стоїть: кожне місце — рядок меню, а «Запустити токен» і «Мої лаунчі» — кнопки сторінки «Лаунч». Кожна сторінка працює, і жодна не показує вигаданих балансів чи котирувань.",
      ),
    ]),
    section("pages", "The pages", "Сторінки", [
      p(
        "The table below is read from the same registry the menu uses, so the documentation and the app cannot disagree about what is open.",
        "Таблиця нижче читається з того самого реєстру, що й меню, тож документація й застосунок не можуть розійтися в тому, що відкрито.",
      ),
      productPages(),
    ]),
    section("modes", "One version, language, theme", "Одна версія, мова, тема", [
      list(
        [
          "Ryntra is one version for everyone: there is no mode to choose. The beginner's path stays clean — one number, one status, one action a screen — and the deeper tools never relax a check.",
          "The app speaks English and Ukrainian; switch in Settings at the foot of the menu, or in Account. The public site has the same switch in its header.",
          "Graphite, the dark theme, is the default; Porcelain, the light one, is in Settings at the foot of the menu and is kept per device.",
          "The product is live on mainnet and still growing.",
        ],
        [
          "Ryntra — одна версія для всіх: режиму обирати не треба. Шлях новачка лишається чистим — одне число, один статус, одна дія на екран, — а глибші інструменти жодної перевірки не послаблюють.",
          "Застосунок говорить англійською й українською; перемикач — у «Налаштуваннях» унизу меню або в «Акаунті». Публічний сайт має такий самий перемикач у шапці.",
          "Graphite, темна тема, — за замовчуванням; Porcelain, світла, — у «Налаштуваннях» унизу меню, і вона зберігається для пристрою.",
          "Продукт працює на mainnet і ще росте.",
        ],
      ),
    ]),
  ],
  related: ["start/getting-started", "reference/statuses"],
};

export const START_PAGES: readonly DocPage[] = [OVERVIEW, GETTING_STARTED, WALLET, CABINET];
