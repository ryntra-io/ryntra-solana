import { FEES, FEES_UK } from "./facts.ts";
import { facts, links, list, note, p, productPages, section, steps, table, type DocPage } from "./model.ts";

/**
 * Start here — what Ryntra is, the first company from $1, the wallet, the
 * menu (the new site of canon v5.5, `RYN-SITE-V5-001` subtask 3: the hub and
 * «Початок» rewritten for a purchase in dollars rather than a first swap, «the
 * cabinet» become the menu, Ukrainian in «ти» as the app and the landing).
 *
 * The overview is the one page that says what Ryntra is and says it once;
 * every later page describes a thing the reader can open.
 */

export const OVERVIEW: DocPage = {
  slug: "",
  group: "start",
  title: { en: "Ryntra documentation", uk: "Документація Ryntra" },
  seoTitle: { en: "Ryntra Docs — how to buy tokenized stocks from $1", uk: "Документація Ryntra — як купити токенізовані акції від $1" },
  summary: {
    en: "How Ryntra works: connect a wallet, buy a piece of a company from $1, set Autoinvest, read your receipt — and what you actually buy.",
    uk: "Як працює Ryntra: під'єднати гаманець, купити частинку компанії від $1, налаштувати «Автоінвест», прочитати квитанцію — і що ти насправді купуєш.",
  },
  sections: [
    section("what", "What Ryntra is", "Що таке Ryntra", [
      p(
        "Ryntra lets you invest in tokenized stocks from $1, in your own wallet, on Solana: buy a piece of a company in dollars, or set Autoinvest by your own rule. Ryntra prepares each purchase and shows it in the Review; your wallet signs it, and what you buy stays in your wallet.",
        "Ryntra — це інвестиції в токенізовані акції від $1, у своєму гаманці, на Solana: купуй частинку компанії в доларах або налаштуй «Автоінвест» за своїм правилом. Ryntra готує кожну купівлю й показує її в «Перевірці»; підписує твій гаманець, і куплене лишається в ньому.",
      ),
      facts(
        [
          ["Network", "Solana Mainnet"],
          ["Your money", "In your own wallet — Ryntra never holds it"],
          ["A purchase", "From $1, in dollars"],
          ["Companies", "Listed companies and funds by xStocks and Backpack; private companies by PreStocks"],
          ["Service fee", `${FEES.swap} of a purchase or a swap, ${FEES.bridge} of a bridge — shown before you sign`],
          ["Account", "Your wallet; no email, no password"],
        ],
        [
          ["Мережа", "Solana Mainnet"],
          ["Твої гроші", "У твоєму гаманці — Ryntra їх не тримає"],
          ["Купівля", "Від $1, у доларах"],
          ["Компанії", "Публічні компанії й фонди від xStocks і Backpack; приватні — від PreStocks"],
          ["Комісія Ryntra", `${FEES_UK.swap} купівлі чи обміну, ${FEES_UK.bridge} — мосту; видно до підпису`],
          ["Акаунт", "Твій гаманець; без пошти й пароля"],
        ],
      ),
    ]),
    section("purchase", "How a purchase runs", "Як проходить купівля", [
      steps(
        [
          "Choose a company — on Home, in Markets or by search.",
          "Type a sum in dollars, from $1.",
          "Read the Review in four lines: You pay, You get at least, All costs, What it is.",
          "Sign in your wallet. Nothing is bought without that signature.",
          "Keep the receipt: History records what left, what arrived and what it cost.",
          "Turn on Autoinvest if you want to keep buying — Ryntra reminds you, you sign each time.",
        ],
        [
          "Обери компанію — на Головній, у Ринках чи пошуком.",
          "Впиши суму в доларах — від $1.",
          "Прочитай «Перевірку» в чотири рядки: Спишеться, Отримаєш щонайменше, Усі витрати, Що це.",
          "Підпиши в гаманці. Без цього підпису нічого не купується.",
          "Збережи квитанцію: Історія записує, що пішло, що прийшло і скільки це коштувало.",
          "Увімкни «Автоінвест», якщо хочеш купувати й далі, — Ryntra нагадує, а підписуєш щоразу ти.",
        ],
      ),
    ]),
    section("principles", "What Ryntra does not do", "Чого Ryntra не робить", [
      list(
        [
          "It does not hold money, keys or seed phrases, and never asks for them.",
          "It does not buy for you. Ryntra, the AI assistant, explains; you decide and sign.",
          "It does not show a quote as a result, or a fee as income before it is collected.",
          "It does not promise profit, and nothing here is financial advice.",
        ],
        [
          "Не тримає грошей, ключів чи сід-фраз і ніколи їх не просить.",
          "Не купує за тебе. Ryntra — ШІ-помічник — пояснює; вирішуєш і підписуєш ти.",
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
        { href: "/contact", en: "Contact", uk: "Контакти" },
      ]),
    ]),
  ],
  related: ["start/getting-started", "invest/buy", "invest/what-you-buy", "reference/fees"],
};

export const GETTING_STARTED: DocPage = {
  slug: "start/getting-started",
  group: "start",
  title: { en: "Getting started", uk: "Початок" },
  seoTitle: { en: "Getting started: your first company from $1 — Ryntra Docs", uk: "Початок: перша компанія від $1 — Документація Ryntra" },
  summary: {
    en: "Connect a Solana wallet, top up with USDC and a little SOL, buy a piece of a company from $1 and find it in Portfolio.",
    uk: "Під'єднай гаманець Solana, поповни USDC і трохи SOL, купи частинку компанії від $1 і знайди її в Портфелі.",
  },
  sections: [
    section("first", "Your first company from $1", "Перша компанія від $1", [
      steps(
        [
          "Open Ryntra. It opens on Home: what you own, Top up, Autoinvest and the popular companies. On a computer the menu on the left shows every section; on a phone the bar at the bottom holds Home, Markets, Ryntra, Portfolio and More.",
          "Connect a wallet you already use — Phantom, Solflare, Backpack or any wallet that supports the Solana Wallet Standard. Ryntra reads your public address; it never sees your keys.",
          "If the wallet is empty, top it up: USDC for the purchase and a little SOL for the network. Top up on Home shows three ways to bring them.",
          "Open a company from Home or Markets, press Buy and type a sum from $1.",
          "Read the Review — You pay, You get at least, All costs, What it is — and sign in your wallet.",
          "Find the company in Portfolio, and the purchase with its receipt in History.",
        ],
        [
          "Відкрий Ryntra. Вона відкривається на Головній: що в тебе є, «Поповнити», «Автоінвест» і популярні компанії. На комп'ютері меню ліворуч показує всі розділи; на телефоні внизу — Головна, Ринки, Ryntra, Портфель і Ще.",
          "Під'єднай гаманець, яким уже користуєшся, — Phantom, Solflare, Backpack чи будь-який гаманець із Solana Wallet Standard. Ryntra читає твою публічну адресу; ключів вона не бачить ніколи.",
          "Якщо гаманець порожній, поповни його: USDC на покупку і трохи SOL на мережу. «Поповнити» на Головній показує три способи їх додати.",
          "Відкрий компанію з Головної чи Ринків, натисни «Купити» й впиши суму від $1.",
          "Прочитай «Перевірку» — Спишеться, Отримаєш щонайменше, Усі витрати, Що це — і підпиши в гаманці.",
          "Знайди компанію в Портфелі, а купівлю з квитанцією — в Історії.",
        ],
      ),
      note(
        "You can look around without a wallet: Markets and every company's page are open to everyone. What you own, your history and your rewards appear once a wallet is connected, and a purchase needs it.",
        "Роздивитися можна й без гаманця: Ринки й сторінка кожної компанії відкриті для всіх. Що в тебе є, історія й винагороди з'являються, щойно гаманець під'єднано, а для купівлі він потрібен.",
      ),
    ]),
    section("next", "What next", "Що далі", [
      list(
        [
          "Autoinvest keeps buying by your rule — regularly, if the price falls, or from every payment — with each purchase your signature.",
          "What you actually buy — a token that tracks a share, or a private company's token — is on each company's page under What you buy.",
          "Connect Telegram in Settings, and reminders and notes arrive there too.",
        ],
        [
          "«Автоінвест» купує й далі за твоїм правилом — регулярно, якщо ціна впаде, чи з кожної оплати, — і кожна купівля — твій підпис.",
          "Що ти насправді купуєш — токен, що відстежує ціну акції, чи токен приватної компанії, — написано на сторінці кожної компанії в «Що ти купуєш».",
          "Під'єднай Telegram у Налаштуваннях — і нагадування та нотатки приходитимуть і туди.",
        ],
      ),
    ]),
  ],
  related: ["invest/buy", "money/top-up", "start/wallet", "invest/autoinvest"],
};

export const WALLET: DocPage = {
  slug: "start/wallet",
  group: "start",
  title: { en: "Wallet and account", uk: "Гаманець і акаунт" },
  summary: {
    en: "Your wallet is your account. How connecting, signing in and signing out work, and what Ryntra can and cannot do with a connected wallet.",
    uk: "Твій гаманець — це твій акаунт. Як працюють під'єднання, вхід і вихід і що Ryntra може й не може робити з під'єднаним гаманцем.",
  },
  sections: [
    section("connect", "Connecting", "Під'єднання", [
      steps(
        [
          "Press Connect in the top bar and choose your wallet. Ryntra lists the wallets installed in your browser; on a phone, open ryntra.io inside the wallet's own browser.",
          "Approve the connection in the wallet. This shares your public address and nothing else.",
          "Check the shortened address in the top bar. The app always shows which wallet it is reading.",
        ],
        [
          "Натисни «Під'єднати» у верхній панелі й обери гаманець. Ryntra показує гаманці, встановлені у твоєму браузері; на телефоні відкрий ryntra.io у вбудованому браузері гаманця.",
          "Схвали під'єднання в гаманці. Це передає лише твою публічну адресу й нічого більше.",
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
        "A connected wallet lets you see what it holds and buy. Signing in links an account to that wallet: your History, receipts, Autoinvest rules, Rewards, points, referral link and settings follow the wallet, not the browser. The sign-in is a message your wallet signs — it costs nothing and moves nothing.",
        "Під'єднаний гаманець дає бачити, що в ньому, і купувати. Вхід прив'язує акаунт до цього гаманця: твоя Історія, квитанції, правила «Автоінвесту», Винагороди, бали, реферальне посилання й налаштування йдуть за гаманцем, а не за браузером. Вхід — повідомлення, яке підписує гаманець: воно нічого не коштує й нічого не рухає.",
      ),
      list(
        [
          "There is no email, password or social login for customers. The wallet is the identity.",
          "A sign-in lasts up to a day on a device; Sign out ends it on this device, Sign out everywhere ends every session of this wallet.",
          "Telegram can be connected from Settings as a notification channel. It is not a way to sign in.",
        ],
        [
          "Для клієнтів немає входу через пошту, пароль чи соцмережі. Гаманець і є ідентичністю.",
          "Вхід діє на пристрої до доби; «Вийти» завершує його на цьому пристрої, «Вийти всюди» — усі сесії цього гаманця.",
          "Telegram можна під'єднати в Налаштуваннях як канал сповіщень. Це не спосіб входу.",
        ],
      ),
    ]),
    section("what-it-allows", "What a connected wallet allows", "Що дозволяє під'єднаний гаманець", [
      table(
        { en: ["Ryntra can", "Ryntra cannot"], uk: ["Ryntra може", "Ryntra не може"] },
        {
          en: [
            ["Read your balances, token accounts and the operations it made for you", "Move any asset without a signature you give for that exact transaction"],
            ["Prepare a transaction for you to review and sign", "Change a transaction after you reviewed it — the signed bytes are the reviewed bytes"],
            ["Ask the wallet for a message signature to sign you in", "Sign anything on your behalf, or keep a standing permission"],
          ],
          uk: [
            ["Читати твої баланси, рахунки токенів і операції, які вона для тебе зробила", "Зрушити будь-який актив без твого підпису саме цієї транзакції"],
            ["Підготувати транзакцію, яку ти перевіриш і підпишеш", "Змінити транзакцію після «Перевірки» — підписані байти є перевіреними байтами"],
            ["Попросити гаманець підписати повідомлення для входу", "Підписати щось від твого імені або тримати постійний дозвіл"],
          ],
        },
      ),
      note(
        "On a shared device, disconnect the wallet and sign out from Settings when you finish.",
        "На спільному пристрої від'єднай гаманець і вийди в Налаштуваннях, коли закінчиш.",
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
    en: "The seven sections of the menu and the twelve pages in them — one menu for everyone — and what each one is for.",
    uk: "Сім розділів меню і дванадцять сторінок у них — одне меню для всіх — і для чого кожна.",
  },
  sections: [
    section("layout", "How the app is laid out", "Як влаштований застосунок", [
      p(
        "On a computer the menu on the left shows every section by name, nothing hidden, the same for everyone and for a guest: Home — what you own, Top up, Autoinvest and the popular companies; Invest — Markets, in tabs (All, Companies, Private, Crypto, Memes, Dollars), and Autoinvest, your rules and the month's budget; Trade — Swap, Spot, the stock screener and Trends; Money — Top up, Send, Receive and Bridge; Portfolio — Positions, Strategies, Results and History; Ryntra, the AI assistant; Rewards. Feedback and Settings stand at its foot. On a phone the bar at the bottom holds Home, Markets, Ryntra, Portfolio and More, and More opens the same sections.",
        "На комп'ютері меню ліворуч показує всі розділи за назвами, нічого не сховано, однаково для всіх і для гостя: Головна — що в тебе є, «Поповнити», «Автоінвест» і популярні компанії; Інвестувати — Ринки з вкладками (Усі, Компанії, Приватні, Крипта, Меми, Долари) і Автоінвест — твої правила й бюджет місяця; Торгувати — Обмін, Спот, Скринер акцій і Тренди; Гроші — Поповнити, Надіслати, Отримати й Міст; Портфель — Позиції, Стратегії, Результати й Історія; Ryntra — ШІ-помічник; Винагороди. Унизу меню — Відгук і Налаштування. На телефоні внизу — Головна, Ринки, Ryntra, Портфель і Ще, а «Ще» відкриває ті самі розділи.",
      ),
      p(
        "At the top of every page: search — a company, a coin or an action; the bell with your notifications and the way to all of them; and your wallet, whose menu holds Settings, Language, Theme and Disconnect. Spot with the candlestick chart, the stock screener and Trends are also on top of Markets, under «For experienced investors», with the same checks before every signature. Every page works, and none of them shows invented balances or quotes.",
        "Угорі кожної сторінки: пошук — компанія, монета чи дія; дзвіночок зі сповіщеннями й шляхом до всіх; і твій гаманець — у його меню Налаштування, Мова, Тема й Від'єднати. Спот зі свічковим графіком, скринер акцій і Тренди є й угорі Ринків, у ряді «Для досвідчених», з тими самими перевірками перед кожним підписом. Кожна сторінка працює, і жодна не показує вигаданих балансів чи котирувань.",
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
          "The app speaks English and Ukrainian; switch in your wallet's menu at the top, or in Settings. The public site has the same switch in its header.",
          "Dark is the default theme; Light is available from the same place and is kept per device.",
          "BETA next to the name means what it says: the product is live on mainnet and still growing.",
        ],
        [
          "Ryntra — одна версія для всіх: режиму обирати не треба. Шлях новачка лишається чистим — одне число, один статус, одна дія на екран, — а глибші інструменти жодної перевірки не послаблюють.",
          "Застосунок говорить англійською й українською; перемикач — у меню гаманця вгорі або в Налаштуваннях. Публічний сайт має такий самий перемикач у шапці.",
          "Темна тема — за замовчуванням; світла — там само, і вона зберігається для пристрою.",
          "BETA біля назви означає рівно це: продукт працює на mainnet і ще росте.",
        ],
      ),
    ]),
  ],
  related: ["start/getting-started", "reference/statuses"],
};

export const START_PAGES: readonly DocPage[] = [OVERVIEW, GETTING_STARTED, WALLET, CABINET];
