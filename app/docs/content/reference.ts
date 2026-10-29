import { CREDITS, FEES, FEES_UK, JUPITER_ORDER_MIN_FEE_BPS, LAUNCH_FEES, LIMITS, PREDICTION_BUY_FEE, REWARDS } from "./facts.ts";
import { FEE_POLICY_V2 } from "../../../lib/core/fee-policy.ts";
import { links, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Reference — the rules that hold across every page: the Review, fees,
 * statuses, troubleshooting, the questions people ask first, the glossary.
 * «Security and risk» left the documentation on 2026-09-26 for the Security
 * page itself (`/security`, by a 308): one place states the boundary, so two
 * places cannot start disagreeing.
 */

export const REVIEW: DocPage = {
  slug: "reference/review",
  group: "reference",
  title: { en: "Review and signing", uk: "Перевірка і підпис" },
  summary: {
    en: "The one step every financial action goes through: what the Review shows, what your signature means, and why nothing can change in between.",
    uk: "Крок, через який проходить кожна фінансова дія: що показує «Перевірка», що означає твій підпис і чому між ними нічого не може змінитися.",
  },
  sections: [
    section("what", "What the Review shows", "Що показує «Перевірка»", [
      p(
        "Before Ryntra asks your wallet for anything, it shows you the whole action in one place. A purchase of a company is four lines — You pay, You get at least, All costs, What it is — and a sale from your position the same four, You sell first; a swap, a transfer or a move between networks shows what it needs:",
        "Перш ніж щось попросити в гаманця, Ryntra показує всю дію в одному місці. Купівля компанії — це чотири рядки: Спишеться, Отримаєш щонайменше, Усі витрати, Що це, — і продаж із позиції ті самі чотири; обмін, переказ чи рух між мережами показують те, що потрібно їм:",
      ),
      list(
        [
          "What leaves your wallet and what arrives — the expected amount and the minimum you accept.",
          "Ryntra's service fee, stated as its own line, and the provider's, the issuer's and the network's costs, stated as theirs.",
          "Slippage and price impact where a market is involved.",
          "Any reserve a new token account keeps, as the exact figure the network requires — yours, not a fee.",
          "For a move between networks: the source, the destination, the address the money lands on and the estimated time.",
        ],
        [
          "Що спишеться з твого гаманця і що надійде — очікувана сума й мінімум, який ти приймаєш.",
          "Комісія Ryntra окремим рядком, а витрати провайдера, емітента й мережі — окремими.",
          "Прослизання й вплив на ціну там, де задіяний ринок.",
          "Резерв, який лишає новий рахунок токена, — точною цифрою, якої вимагає мережа; він твій, це не комісія.",
          "Для мосту: звідки, куди, адреса, на яку прийдуть гроші, і орієнтовний час.",
        ],
      ),
    ]),
    section("signature", "What your signature means", "Що означає твій підпис", [
      steps(
        [
          "Ryntra simulates the exact transaction against the live network and shows the result of that simulation — not a quote.",
          "You confirm in your wallet. The wallet shows the same transaction; what you sign is what you reviewed. A swap accepts only the exact reviewed bytes; in other actions a wallet may add only its own checks and a capped priority fee for the network.",
          "If the market moved past the reviewed figures before you signed, Ryntra stops and asks you to review again rather than submitting stale terms.",
          "If your wallet returns a transaction that changes anything else, nothing is sent.",
        ],
        [
          "Ryntra симулює точну транзакцію в живій мережі й показує результат цієї симуляції — не котирування.",
          "Ти підтверджуєш у гаманці. Гаманець показує ту саму транзакцію; підписуєш те, що перевірив. Обмін приймає лише точні перевірені байти; в інших діях гаманець може додати тільки власні перевірки й обмежену пріоритетну плату мережі.",
          "Якщо ринок вийшов за перевірені цифри ще до підпису, Ryntra зупиняється й просить перевірити знову, а не надсилати застарілі умови.",
          "Якщо гаманець поверне транзакцію, що змінює ще щось, нічого не надсилається.",
        ],
      ),
      note(
        "Your wallet. Your decision. Ryntra prepares and explains; it never holds a key, a standing permission or the ability to sign for you.",
        "Твій гаманець. Твоє рішення. Ryntra готує й пояснює; вона ніколи не тримає ключа, постійного дозволу чи змоги підписати за тебе.",
      ),
    ]),
  ],
  related: ["reference/fees", "start/wallet", "invest/buy"],
};

/* The flows whose rate is under the order route's minimum — that route carries no Ryntra fee for them. */
const ORDER_FREE_EN = (["MAJOR", "XSTOCK"] as const).filter((flow) => FEE_POLICY_V2[flow].bps > 0 && FEE_POLICY_V2[flow].bps < JUPITER_ORDER_MIN_FEE_BPS).map((flow) => (flow === "MAJOR" ? "major coins" : "xStocks")).join(" and ");
const ORDER_FREE_UK = (["MAJOR", "XSTOCK"] as const).filter((flow) => FEE_POLICY_V2[flow].bps > 0 && FEE_POLICY_V2[flow].bps < JUPITER_ORDER_MIN_FEE_BPS).map((flow) => (flow === "MAJOR" ? "великі монети" : "xStocks")).join(" і ");

export const FEES_PAGE: DocPage = {
  slug: "reference/fees",
  group: "reference",
  title: { en: "Fees", uk: "Комісії" },
  seoTitle: { en: "Fees: every Ryntra fee by product — Ryntra Docs", uk: "Комісії Ryntra за продуктами — Документація Ryntra" },
  summary: {
    en: "Every fee Ryntra takes, product by product, who receives it and where you see it before you sign — read from the code that charges it. There are no others.",
    uk: "Кожна комісія, яку бере Ryntra, — продукт за продуктом, хто її отримує і де ти бачиш її до підпису, — прочитана з коду, що її стягує. Інших немає.",
  },
  sections: [
    section("service", "Ryntra's fee, product by product", "Комісія Ryntra за продуктами", [
      table(
        { en: ["Where", "Ryntra's fee", "Notes"], uk: ["Де", "Комісія Ryntra", "Примітки"] },
        {
          en: [
            ["Swap and Spot — new and meme tokens", FEES.flow("MEME"), `Younger than seven days, or not verified by Jupiter; ${REWARDS.cashbackPercent}% of what Ryntra receives returns to you as cashback`],
            ["Swap and Spot — verified tokens", FEES.flow("TRENDING"), `Verified by Jupiter and at least a week old; ${REWARDS.cashbackPercent}% cashback of what Ryntra receives`],
            ["Swap and Spot — major coins: SOL, BTC, ETH, JUP, staked SOL", FEES.flow("MAJOR"), `${REWARDS.cashbackPercent}% cashback of what Ryntra receives`],
            ["Dollar to dollar — USDC, USDT and other dollars", "None", "No Ryntra fee between two dollars"],
            ["A company — xStocks", FEES.flow("XSTOCK"), "A line of All costs in the Review, with its amount"],
            ["A company — Ondo", FEES.flow("ONDO"), "The same line; Ondo trades on Jupiter through market makers"],
            ["Pre-IPO — PreStocks", FEES.flow("PRESTOCK"), "The same line, beside the issuer's own fee"],
            ["Spot — limit order on Jupiter", `The pair's rate, at least ${LIMITS.triggerFloor.en}; none on a dollar pair`, `Paid in the token you receive, on top of the price — so the order fills a little later; from ${LIMITS.triggerMinimum} an order`],
            ["Spot — limit order in a Meteora pool", "None", `You earn ${LIMITS.dlmmMakerShare} of the pool's fee on what your order fills`],
            ["Perps on Phoenix", "Builder fee", "At the rate registered on Phoenix's chain, only on the part of an order that fills at once; shown in the Review — with its amount on a market order, as a rate on a limit. Collateral in and out: none"],
            ["Predictions", `${PREDICTION_BUY_FEE.en} of a buy`, "None on a sell; in today's simulation shown, not taken"],
            ["Launch — creating a token", "None", "Only the network's rent and fee for the new accounts, in SOL, shown before you sign"],
            ["Launch — trading a launched token", "Inside the curve's and the pool's own fee", `Nothing is added on top: Ryntra's part is a share of the fee every trader pays — ${LAUNCH_FEES.curve.en} on the curve after the first minutes, ${LAUNCH_FEES.poolStart.en} falling to ${LAUNCH_FEES.poolEnd.en} in the pool; see Launch a token`],
            ["Pools and grids", "None", "The pool's own fee is paid by traders and earned by your position"],
            ["Between networks — out of Solana", FEES.bridge, "Stated apart from the provider's and the networks' costs; cashback applies when the fee is collected"],
            ["Between networks — into Solana, and Add funds", "None", "The provider's cost only, shown before you send"],
            ["Send, Receive, Rewards claims", "None", "Send pays the network's own fee; a Rewards claim's network fee is paid for you"],
            ["Ryntra assistant", "Credits", `${CREDITS.freeDaily} free credits a day; a question costs ${CREDITS.question}; see Ryntra assistant`],
          ],
          uk: [
            ["Обмін і Спот — нові й мем-токени", FEES_UK.flow("MEME"), `Молодші за сім днів або без верифікації Jupiter; ${REWARDS.cashbackPercent}% того, що отримує Ryntra, повертається тобі кешбеком`],
            ["Обмін і Спот — верифіковані токени", FEES_UK.flow("TRENDING"), `Верифіковані Jupiter і старші за тиждень; кешбек ${REWARDS.cashbackPercent}% того, що отримує Ryntra`],
            ["Обмін і Спот — великі монети: SOL, BTC, ETH, JUP, стейкінговий SOL", FEES_UK.flow("MAJOR"), `Кешбек ${REWARDS.cashbackPercent}% того, що отримує Ryntra`],
            ["Долар на долар — USDC, USDT та інші долари", "Немає", "Між двома доларами комісії Ryntra немає"],
            ["Компанія — xStocks", FEES_UK.flow("XSTOCK"), "Рядок «Усі витрати» у «Перевірці», із сумою"],
            ["Компанія — Ondo", FEES_UK.flow("ONDO"), "Той самий рядок; Ondo торгується на Jupiter через маркет-мейкерів"],
            ["Pre-IPO — PreStocks", FEES_UK.flow("PRESTOCK"), "Той самий рядок, поруч із власною комісією емітента"],
            ["Спот — лімітний ордер на Jupiter", `Ставка пари, щонайменше ${LIMITS.triggerFloor.uk}; на доларовій парі немає`, `Сплачується в токені, який отримуєш, понад ціну — тож ордер виконується трохи пізніше; ордер від ${LIMITS.triggerMinimum}`],
            ["Спот — лімітний ордер у пулі Meteora", "Немає", `Тобі йде ${LIMITS.dlmmMakerShare} комісії пулу з того, що виконав твій ордер`],
            ["Perps на Phoenix", "Комісія білдера", "За ставкою, записаною в ланцюгу Phoenix, лише на частину ордера, що виконується одразу; видно у «Перевірці» — із сумою на ринковому ордері, ставкою на ліміті. Поповнення й виведення застави — без комісії"],
            ["Прогнози", `${PREDICTION_BUY_FEE.uk} купівлі`, "На продажі немає; у сьогоднішній симуляції її показано, але не взято"],
            ["Лаунч — створити токен", "Немає", "Лише оренда й плата мережі за нові рахунки, у SOL, видно до підпису"],
            ["Лаунч — торгівля запущеним токеном", "Усередині власної комісії кривої й пулу", `Згори нічого не додається: частка Ryntra — частина комісії, яку платить кожен трейдер, — ${LAUNCH_FEES.curve.uk} на кривій після перших хвилин, ${LAUNCH_FEES.poolStart.uk} зі спаданням до ${LAUNCH_FEES.poolEnd.uk} у пулі; дивись «Запустити токен»`],
            ["Пули й гріди", "Немає", "Власну комісію пулу платять трейдери, а заробляє твоя позиція"],
            ["Між мережами — із Solana", FEES_UK.bridge, "Окремо від витрат провайдера й мереж; кешбек діє, коли комісію зібрано"],
            ["Між мережами — у Solana, і «Поповнити»", "Немає", "Лише витрата провайдера, видна до надсилання"],
            ["Надіслати, Отримати, виплати Винагород", "Немає", "Переказ платить власну плату мережі; плату мережі за виплату Винагород сплачено за тебе"],
            ["Помічник Ryntra", "Кредити", `${CREDITS.freeDaily} безкоштовних кредитів щодня; запитання коштує ${CREDITS.question}; дивись «Помічник Ryntra»`],
          ],
        },
      ),
      p(
        `When Jupiter's order route carries a swap because it pays you more, Jupiter keeps its share of the referral fee, and a rate under that route's minimum is not charged at all — ${ORDER_FREE_EN} carry no Ryntra fee there. The Review always names the lane and the fee it carries.`,
        `Коли обмін іде маршрутом замовлень Jupiter, бо він дає тобі більше, Jupiter лишає собі частку реферальної комісії, а ставка, нижча за мінімум цього маршруту, не стягується зовсім — ${ORDER_FREE_UK} там комісії Ryntra не мають. «Перевірка» завжди називає маршрут і комісію, яку він несе.`,
      ),
      p(
        "Ryntra earns when you actually use the product — there is no subscription and no charge for looking, and nothing for the checks that protect you. A route that carries no Ryntra fee says so on its receipt, and the app's Fees page sets $100 through Ryntra beside the same route without it.",
        "Ryntra заробляє, коли ти справді користуєшся продуктом: підписки немає, за перегляд плати немає, і нічого — за перевірки, що тебе захищають. Маршрут без комісії Ryntra каже про це у квитанції, а сторінка «Комісії» в застосунку ставить $100 через Ryntra поруч із тим самим маршрутом без неї.",
      ),
    ]),
    section("other", "Costs that are not Ryntra's", "Витрати, що не належать Ryntra", [
      table(
        { en: ["Cost", "Who receives it", "When"], uk: ["Витрата", "Хто отримує", "Коли"] },
        {
          en: [
            ["Network fee", "The Solana network (or the source network of a move between networks)", "Every transaction, in the network's own coin"],
            ["Token account reserve", "Your own new token account; refunded when you close it", "The first time you receive a token you never held"],
            ["The issuer's fee", "The issuer of a PreStocks token; its rate is read from the chain", "Every transfer of that token, a purchase included"],
            ["Venue fees", "Phoenix, the prediction venues, Meteora's pools", "On their own trades, at their own rates; shown in the Review"],
            ["Provider costs", "The routing or bridging provider", "Bridges and deposits from another network; shown as their own line"],
            ["Price impact and slippage", "The market", "Any trade; bounded by the minimum you accept"],
          ],
          uk: [
            ["Плата мережі", "Мережа Solana (або вихідна мережа мосту)", "Кожна транзакція, у власній монеті мережі"],
            ["Резерв рахунку токена", "Твій власний новий рахунок токена; повертається, коли ти його закриваєш", "Перше отримання токена, якого в тебе ще не було"],
            ["Комісія емітента", "Емітент токена PreStocks; її ставку прочитано з ланцюга", "Кожен переказ цього токена, зокрема купівля"],
            ["Комісії майданчиків", "Phoenix, майданчики прогнозів, пули Meteora", "На їхніх власних угодах, за їхніми ставками; видно у «Перевірці»"],
            ["Витрати провайдера", "Провайдер маршруту чи мосту", "Мости й поповнення з іншої мережі; окремим рядком"],
            ["Вплив на ціну й прослизання", "Ринок", "Будь-яка угода; обмежені мінімумом, який ти приймаєш"],
          ],
        },
      ),
      note(
        "Ryntra never shows a fee as income before it is collected, and never adds a cost it did not show in the Review.",
        "Ryntra ніколи не показує комісію як дохід, доки її не зібрано, і ніколи не додає витрати, якої не показала у «Перевірці».",
      ),
      links([{ href: "/app/fees", en: "Fees in the app: $100 through Ryntra and without", uk: "Комісії в застосунку: $100 через Ryntra і без" }]),
    ]),
  ],
  related: ["reference/receipts", "money/rewards", "reference/review"],
};

export const NETWORKS: DocPage = {
  slug: "reference/networks",
  group: "reference",
  title: { en: "Networks", uk: "Мережі" },
  seoTitle: { en: "Networks: Solana, and money from other chains — Ryntra Docs", uk: "Мережі: Solana й гроші з інших мереж — Документація Ryntra" },
  summary: {
    en: "Ryntra works on Solana Mainnet. Which networks money can come from and go to, and where the other venues — Phoenix, AGG, Meteora, Jupiter — sit.",
    uk: "Ryntra працює на Solana Mainnet. З яких мереж можуть прийти гроші й куди піти, і де стоять інші майданчики — Phoenix, AGG, Meteora, Jupiter.",
  },
  sections: [
    section("solana", "One network: Solana", "Одна мережа: Solana", [
      p(
        "Everything you do in Ryntra — trading, Perps, launches, bots, pools, rewards — happens on Solana Mainnet, with your Solana wallet. The plate «Solana Mainnet Beta» beside the logo names the network; it is a label, not a switch, so there is no network to choose and no «wrong network» to land on.",
        "Усе, що ти робиш у Ryntra, — торгівля, Perps, лаунчі, боти, пули, винагороди — відбувається в Solana Mainnet, з твоїм гаманцем Solana. Плашка «Solana Mainnet Beta» біля логотипа називає мережу; це напис, а не перемикач, тож обирати мережу не треба і «не тієї мережі» не буває.",
      ),
      table(
        { en: ["Product", "Where it runs"], uk: ["Продукт", "Де працює"] },
        {
          en: [
            ["Swap, Spot, companies", "Solana — Jupiter's routing; limit orders on Jupiter or in a Meteora pool"],
            ["Perps", "Solana — Phoenix's program"],
            ["Launch", "Solana — Meteora's bonding curve, then a Meteora pool"],
            ["Pools and grids", "Solana — Meteora's DLMM and DAMM v2 pools"],
            ["Predictions", "The venues AGG aggregates; in Ryntra a simulation, signed in with your Solana wallet"],
          ],
          uk: [
            ["Обмін, Спот, компанії", "Solana — маршрутизація Jupiter; лімітні ордери на Jupiter чи в пулі Meteora"],
            ["Perps", "Solana — програма Phoenix"],
            ["Лаунч", "Solana — крива Meteora, далі пул Meteora"],
            ["Пули й гріди", "Solana — пули Meteora DLMM і DAMM v2"],
            ["Прогнози", "Майданчики, які збирає AGG; у Ryntra — симуляція, вхід гаманцем Solana"],
          ],
        },
      ),
    ]),
    section("between", "Money between networks", "Гроші між мережами", [
      p(
        "Money → Between networks moves value across chains through Relay, with only your Solana wallet: money comes in to a deposit address the page gives you, and goes out by a transaction your Solana wallet signs.",
        "Гроші → Між мережами переносить вартість між мережами через Relay, лише з гаманцем Solana: гроші приходять на адресу поповнення, яку дає сторінка, а йдуть транзакцією, яку підписує твій гаманець Solana.",
      ),
      table(
        { en: ["Direction", "Networks", "What"], uk: ["Напрям", "Мережі", "Що"] },
        {
          en: [
            ["Into Solana", "Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain", "USDC to USDC on Solana, from $1; no Ryntra fee"],
            ["Out of Solana", "Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain and others the form lists; Robinhood Chain for USDG", `What each route offers, listed in the form; Ryntra's fee ${FEES.bridge}`],
          ],
          uk: [
            ["У Solana", "Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain", "USDC у USDC на Solana, від $1; без комісії Ryntra"],
            ["Із Solana", "Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain та інші, які показує форма; Robinhood Chain — для USDG", `Що пропонує кожен маршрут, перелічено у формі; комісія Ryntra ${FEES_UK.bridge}`],
          ],
        },
      ),
      note(
        "Send only what the page names, on the network it names. A deposit address takes any amount, but a deposit Relay cannot fill is not refunded by itself — it is recovered through Relay's support.",
        "Надсилай лише те, що називає сторінка, і в тій мережі, яку вона називає. Адреса поповнення приймає будь-яку суму, але поповнення, яке Relay не може виконати, саме не повертається — його повертають через підтримку Relay.",
        "caution",
      ),
    ]),
  ],
  related: ["money/bridge", "money/top-up", "start/wallet"],
};

export const RECEIPTS: DocPage = {
  slug: "reference/receipts",
  group: "reference",
  title: { en: "Receipts", uk: "Квитанції" },
  seoTitle: { en: "Receipts: what was reviewed, what happened — Ryntra Docs", uk: "Квитанції: що перевірено і що сталося — Документація Ryntra" },
  summary: {
    en: "A receipt keeps what you reviewed beside what the chain did — amounts, fees, transactions — signed by Ryntra, with a file to download and a check to run.",
    uk: "Квитанція тримає перевірене поруч із тим, що зробив ланцюг, — суми, комісії, транзакції, — з підписом Ryntra, файлом для завантаження й перевіркою.",
  },
  sections: [
    section("what", "What a receipt holds", "Що тримає квитанція", [
      p(
        "Every operation in History opens its receipt. It records what you reviewed — the amounts, the minimum, the route, Ryntra's fee and the network's costs — and what then happened on chain: the actual amounts, the transaction signatures, the time, and whether the two agree. When less arrived than the reviewed minimum, both figures stay side by side, so the difference is visible, not averaged away.",
        "Кожна операція в Історії відкриває свою квитанцію. Вона записує, що ти перевірив, — суми, мінімум, маршрут, комісію Ryntra й витрати мережі, — і що потім сталося в ланцюгу: фактичні суми, підписи транзакцій, час і чи збігаються вони. Коли надійшло менше за перевірений мінімум, обидві цифри стоять поруч, тож різницю видно, а не усереднено.",
      ),
      list(
        [
          "A receipt says whether Ryntra's fee was actually collected; a fee that was quoted and not taken is never shown as paid.",
          "Each transaction opens on a public Solana explorer; a move between networks shows the source and the destination transaction.",
          "A creator's Claim keeps its receipt in the creator's cabinet, read from the programs' own events; a pool action keeps its receipt on the pool's page.",
        ],
        [
          "Квитанція каже, чи комісію Ryntra справді зібрано; показана, але не взята комісія ніколи не виглядає сплаченою.",
          "Кожна транзакція відкривається в публічному оглядачі Solana; рух між мережами показує транзакцію відправлення й призначення.",
          "«Забрати» творця зберігає квитанцію в кабінеті творця, прочитану з подій самих програм; дія в пулі — на сторінці пулу.",
        ],
      ),
    ]),
    section("verify", "Keep it and check it", "Зберегти й перевірити", [
      steps(
        [
          "Open the receipt from History and press More.",
          "Download signed JSON keeps the receipt as a file: Ryntra signs its exact bytes with an Ed25519 key.",
          "Verify receipt checks four things and names each: the file is intact, Ryntra issued it, your wallet authorized the action, and what was observed of it.",
        ],
        [
          "Відкрий квитанцію з Історії й натисни «Більше».",
          "«Завантажити підписаний JSON» зберігає квитанцію файлом: Ryntra підписує її точні байти ключем Ed25519.",
          "«Перевірити квитанцію» перевіряє чотири речі й називає кожну: файл цілий, його видала Ryntra, дію дозволив твій гаманець, і що про неї спостережено.",
        ],
      ),
      note(
        "Receipts are kept in this browser. To keep one for good, download its signed JSON; the chain itself — the transactions the receipt links to — stays the record of what happened.",
        "Квитанції зберігаються в цьому браузері. Щоб зберегти назавжди, завантаж її підписаний JSON; записом того, що сталося, лишається сам ланцюг — транзакції, на які веде квитанція.",
      ),
    ]),
  ],
  related: ["manage/activity", "reference/fees", "reference/review"],
};

export const STATUSES: DocPage = {
  slug: "reference/statuses",
  group: "reference",
  title: { en: "Statuses", uk: "Статуси" },
  summary: {
    en: "The four words History uses for an operation — On its way, Arrived, Did not happen, Needs you — and what each one commits to.",
    uk: "Чотири слова, якими Історія описує операцію, — У дорозі, Надійшло, Не відбулося, Потрібна твоя дія — і що кожне з них означає.",
  },
  sections: [
    section("operations", "Operation statuses", "Статуси операцій", [
      list(
        [
          "On its way — signed and sent; the network or the provider has not finished. Do not send it again.",
          "Arrived — landed where it was going, in the amount the receipt records.",
          "Did not happen — did not go through; the reason is shown when one was given. Money that never left is still in your wallet.",
          "Needs you — waits on a step only you can take, such as a refund that arrived and is worth a look.",
        ],
        [
          "У дорозі — підписано й надіслано; мережа чи постачальник ще не завершили. Не надсилай знову.",
          "Надійшло — дійшло, куди йшло, у сумі, яку записує квитанція.",
          "Не відбулося — не пройшло; причину показано, коли її дали. Гроші, що не пішли, досі у твоєму гаманці.",
          "Потрібна твоя дія — чекає на крок, який можеш зробити лише ти, наприклад повернення, на яке варто глянути.",
        ],
      ),
    ]),
  ],
  related: ["manage/activity", "reference/receipts"],
};

export const TROUBLESHOOTING: DocPage = {
  slug: "reference/troubleshooting",
  group: "reference",
  title: { en: "Troubleshooting", uk: "Усунення проблем" },
  summary: {
    en: "What to do when a wallet will not connect, a quote expires, a list is empty, a status is unknown or a balance is missing — without repeating an action twice.",
    uk: "Що робити, коли гаманець не підключається, котирування застаріло, список порожній, статус невідомий чи баланс не читається, — не повторюючи дію двічі.",
  },
  sections: [
    section("rule", "The one rule", "Одне правило", [
      note(
        "Stop and check the state before repeating an action. A transfer that is On its way is not lost; a second signature is a second transfer.",
        "Зупинись і перевір стан, перш ніж повторювати дію. Переказ у стані «У дорозі» не втрачено; другий підпис — це другий переказ.",
        "caution",
      ),
    ]),
    section("cases", "Common cases", "Типові випадки", [
      table(
        { en: ["What you see", "What to do"], uk: ["Що ти бачиш", "Що робити"] },
        {
          en: [
            ["No Solana wallet in this browser", "Install Phantom, Solflare or Backpack, unlock it, and reload. On a phone, open ryntra.io inside the wallet's browser."],
            ["Wallet not connecting", "Unlock the extension, confirm the site permission in the wallet, then connect again from the top bar."],
            ["Quote expired or the figures changed", "Refresh the price and read the new minimum. Ryntra will not sign stale terms."],
            ["An empty list on arrival", "Wait a moment — the list asks again on its own. If it still fails, press Try again."],
            ["Did not simulate cleanly", "The network refused the exact transaction. Read the reason in the Review; usually a balance, a reserve or a token rule. Nothing was sent."],
            ["Status unknown", "Open History and the explorer link. Do not submit again while the result is uncertain."],
            ["Balance unavailable", "Retry the read. Ryntra keeps an unavailable result apart from a real zero."],
            ["Rewards or points unavailable", "Confirm the wallet with a message signature; if the page still cannot read, try again later — nothing is lost."],
          ],
          uk: [
            ["Гаманець Solana не знайдено", "Встанови Phantom, Solflare чи Backpack, розблокуй його й перезавантаж сторінку. На телефоні відкрий ryntra.io у браузері гаманця."],
            ["Гаманець не підключається", "Розблокуй розширення, підтвердь дозвіл сайту в гаманці й підключися знову з верхньої панелі."],
            ["Котирування застаріло або цифри змінилися", "Онови ціну й прочитай новий мінімум. Ryntra не підписуватиме застарілих умов."],
            ["Порожній список на вході", "Зачекай мить — список запитує знову сам. Якщо не вдається, натисни «Спробувати ще раз»."],
            ["«Не вдалося чисто симулювати»", "Мережа відмовила точній транзакції. Прочитай причину в «Перевірці»; зазвичай це баланс, резерв чи правило токена. Нічого не надіслано."],
            ["Статус невідомий", "Відкрий Історію й посилання на оглядач. Не надсилай знову, поки результат невизначений."],
            ["Баланс недоступний", "Повтори читання. Ryntra відрізняє недоступний результат від справжнього нуля."],
            ["Винагороди чи очки недоступні", "Підтвердь гаманець підписом повідомлення; якщо сторінка все одно не читає, спробуй пізніше — нічого не втрачено."],
          ],
        },
      ),
      p(
        "Still stuck? Write to Ryntra from the Contact page with the visible error message. Never share keys or seed phrases with anyone, Ryntra included.",
        "Не вдається? Напиши Ryntra зі сторінки «Контакти» й додай видиме повідомлення про помилку. Ніколи не ділися ключами чи сід-фразами ні з ким, зокрема з Ryntra.",
      ),
      links([{ href: "/contact", en: "Contact", uk: "Контакти" }]),
    ]),
  ],
  related: ["manage/activity", "start/wallet"],
};

export const FAQ: DocPage = {
  slug: "reference/faq",
  group: "reference",
  title: { en: "Questions and answers", uk: "Запитання і відповіді" },
  seoTitle: { en: "Questions and answers — Ryntra Docs", uk: "Запитання і відповіді — Документація Ryntra" },
  summary: {
    en: "Where your money is, what it costs, what you buy, whether anything trades for you, and who may buy — the questions people ask first, answered plainly.",
    uk: "Де твої гроші, скільки це коштує, що купуєш, чи торгує щось за тебе і кому можна купувати — запитання, які ставлять першими, з прямими відповідями.",
  },
  sections: [
    section("faq", "Asked first", "Питають першим", [
      table(
        { en: ["Question", "Answer"], uk: ["Запитання", "Відповідь"] },
        {
          en: [
            ["What do I buy?", "A token that tracks a share price (xStocks, Backpack, Ondo), or a PreStocks token of economic exposure to a private company — not a share. The company's page says which, under What you buy."],
            ["From how much?", "From $1. Where $1 has no route, Ryntra tells you that company's minimum. A first purchase of a token leaves a one-time account reserve in your wallet — its own line in the Review."],
            ["Where is my money?", "In your own wallet. Ryntra never holds your money or keys and never signs for you."],
            ["How much does it cost?", `It depends on the product: a swap or a Spot trade ${FEES.swap} by the token, a company ${FEES.company}; launching, pools and grids carry no Ryntra fee. Every fee is in the Review before you sign, ${REWARDS.cashbackPercent}% of what Ryntra receives comes back as cashback, and the Fees page lists them all.`],
            ["Does anything trade for me?", "No. A recurring buy reminds you and you sign each buy; a trade plan warns and never sells by itself; a grid's levels are filled by the Meteora pool you placed it in. Ryntra never signs for you."],
            ["Who can buy?", "The issuer decides. By their own documents xStocks, Backpack and PreStocks are not for the US, Backpack is not for the UK, the UAE or Japan either, and each issuer names more places; a private company's page carries «Who may hold it». Ryntra never works around an issuer's restrictions."],
            ["Can I sell?", "Yes — from your position, on the company's page or in Portfolio: a sum in dollars or a share of what you hold, the same Review and your signature. A PreStocks token may not sell: the issuer promises no liquidity."],
            ["What is the Ryntra assistant?", "An assistant that explains tokens, price moves and your portfolio, watches the market for you and prepares drafts. Only you buy, sell and sign."],
            ["Is there a phone app?", "Yes — Ryntra for Android in the Solana dApp Store, with your wallet through Mobile Wallet Adapter. Perps, Predictions and Pools are on ryntra.io, not in the app."],
            ["Do I need an account?", "Your wallet is the account. Signing in is a message your wallet signs — it costs nothing and moves nothing."],
            ["Is Ryntra audited?", "No. Ryntra has not completed an independent security audit, and its Security page says so."],
            ["What are points worth?", "Nothing in money. They record genuine activity and cannot be transferred; there is no token and no airdrop promise."],
          ],
          uk: [
            ["Що я купую?", "Токен, що відстежує ціну акції (xStocks, Backpack, Ondo), або токен PreStocks з економічною експозицією на приватну компанію — не акцію. Що саме — у «Що ти купуєш» на сторінці компанії."],
            ["Від якої суми?", "Від $1. Якщо на $1 маршруту немає, Ryntra скаже мінімум цієї компанії. Перша купівля токена лишає в гаманці разовий резерв рахунку — окремим рядком «Перевірки»."],
            ["Де мої гроші?", "У твоєму гаманці. Ryntra не тримає коштів і ключів і не підписує за тебе."],
            ["Скільки це коштує?", `Залежить від продукту: обмін чи угода на Споті — ${FEES_UK.swap} залежно від токена, компанія — ${FEES_UK.company}; запуск токена, пули й гріди комісії Ryntra не мають. Кожну комісію видно у «Перевірці» до підпису, ${REWARDS.cashbackPercent}% того, що отримує Ryntra, повертається кешбеком, а сторінка «Комісії» перелічує їх усі.`],
            ["Чи торгує щось за мене?", "Ні. Регулярна купівля нагадує, і кожну купівлю підписуєш ти; план угоди попереджає й ніколи не продає сам; рівні гріда виконує пул Meteora, у який ти його поставив. Ryntra ніколи не підписує за тебе."],
            ["Хто може купувати?", "Це вирішує емітент. За своїми документами xStocks, Backpack і PreStocks — не для США, Backpack — ще й не для Великої Британії, ОАЕ та Японії, і кожен емітент називає ще інші місця; у приватних компаній рядок «Хто може тримати» — на сторінці компанії. Ryntra не обходить обмежень емітента."],
            ["Чи можна продати?", "Так — з позиції, на сторінці компанії чи в Портфелі: сума в доларах або частка того, що маєш, та сама «Перевірка» й твій підпис. Токен PreStocks продати може не вийти: емітент ліквідності не обіцяє."],
            ["Що таке помічник Ryntra?", "Помічник, що пояснює токени, рух цін і твій портфель, стежить за ринком для тебе й готує чернетки. Купуєш, продаєш і підписуєш лише ти."],
            ["Чи є застосунок для телефона?", "Так — Ryntra для Android у Solana dApp Store, з твоїм гаманцем через Mobile Wallet Adapter. Perps, Прогнози й Пули — на ryntra.io, у застосунку їх немає."],
            ["Чи потрібен акаунт?", "Твій гаманець і є акаунтом. Вхід — повідомлення, яке підписує гаманець: воно нічого не коштує й нічого не рухає."],
            ["Чи є в Ryntra аудит?", "Ні. Ryntra не проходила незалежного аудиту безпеки, і її сторінка «Безпека» про це каже."],
            ["Скільки коштують очки?", "У грошах — нічого. Вони фіксують справжню активність і не передаються; токена й обіцянки airdrop немає."],
          ],
        },
      ),
    ]),
  ],
  related: ["reference/fees", "invest/what-you-buy", "start/getting-started"],
};

export const GLOSSARY: DocPage = {
  slug: "reference/glossary",
  group: "reference",
  title: { en: "Glossary", uk: "Словник" },
  summary: {
    en: "The words this documentation uses, defined once.",
    uk: "Слова, якими користується ця документація, визначені один раз.",
  },
  sections: [
    section("terms", "Terms", "Терміни", [
      table(
        { en: ["Term", "Meaning"], uk: ["Термін", "Значення"] },
        {
          en: [
            ["The app", "The product at ryntra.io/app: Home, the four groups of the menu and the sixteen rows in them, one menu for everyone."],
            ["Review", "The screen before any financial action that shows exactly what will happen; nothing is signed without it. A purchase shows four lines."],
            ["Receipt", "Ryntra's record of one operation: what was reviewed and what the network did."],
            ["Recurring buy (Autoinvest)", "Your rule for buying a token or a company — on a schedule, if it falls, or from every payment. Ryntra reminds you; you sign each purchase."],
            ["Grid", "Levels of one Meteora DLMM position that buy below the price and sell above it; the pool fills them, you place and stop it."],
            ["Perps", "Perpetual futures — a long or a short with leverage and no expiry; in Ryntra, Phoenix's, with your collateral on your own Phoenix account."],
            ["Liquidation price", "The price at which a leveraged position is closed by the venue and its collateral taken; the Review shows it before you sign."],
            ["Bonding curve", "The market a launched token opens on: the price rises as people buy and falls as they sell, until the curve fills and the token moves to a pool."],
            ["Pool", "Two tokens held by a program so anyone can trade between them; those who add liquidity earn the trades' fees."],
            ["Simulation", "Predictions' test environment today: orders, balance and results without real funds."],
            ["Credits", "The assistant's own units for answers from the model — not a token, not money, never paid out."],
            ["Reference", "What a price is set against: the issuer's price per share for a listed company, PreStocks' valuation for a private one."],
            ["Service fee", "Ryntra's own fee on a purchase, a swap, a trade or a move between networks, stated as its own line."],
            ["Cashback", "The share of the service fee Ryntra received, returned to you through Rewards."],
            ["Points", "A record of genuine activity with no cash value."],
            ["Tokenized stock", "A Solana token issued by a third party that tracks a listed share's price."],
            ["PreStocks token", "A token of economic exposure to a private company — not a share, with the issuer's fee on every transfer."],
            ["Token account", "The account a Solana wallet keeps for each token it holds; a new one keeps a small refundable reserve."],
            ["Slippage", "The difference between the expected price and the executed one; bounded by the minimum you accept."],
            ["Price impact", "How much your own order moves the market's price."],
            ["Liquidity", "How much can be traded in a market without moving its price far."],
            ["Wallet Standard", "The Solana convention that lets any compatible wallet connect to any app."],
            ["For experienced investors", "What a trader reaches for: the Markets screener with every column and order; Spot with the candlestick chart under Trading; the trade plans and their results under Automation → Bots; History under Money. The same checks before every signature."],
          ],
          uk: [
            ["Застосунок", "Продукт на ryntra.io/app: Головна, чотири групи меню і шістнадцять рядків у них, одне меню для всіх."],
            ["«Перевірка»", "Екран перед будь-якою фінансовою дією, що показує, що саме станеться; без нього нічого не підписується. Купівля — це чотири рядки."],
            ["Квитанція", "Запис Ryntra про одну операцію: що перевірено і що зробила мережа."],
            ["Регулярна купівля («Автоінвест»)", "Твоє правило купівлі токена чи компанії — за розкладом, якщо впаде, чи з кожної оплати. Ryntra нагадує; кожну купівлю підписуєш ти."],
            ["Грід", "Рівні однієї позиції Meteora DLMM, що купують нижче ціни й продають вище; виконує їх пул, ставиш і зупиняєш ти."],
            ["Perps", "Безстрокові ф'ючерси — лонг чи шорт із плечем і без експірації; у Ryntra — Phoenix, із заставою на твоєму власному рахунку Phoenix."],
            ["Ціна ліквідації", "Ціна, за якої майданчик закриває позицію з плечем і забирає її заставу; «Перевірка» показує її до підпису."],
            ["Крива", "Ринок, на якому відкривається запущений токен: ціна росте, коли купують, і падає, коли продають, доки крива не заповниться й токен не перейде в пул."],
            ["Пул", "Два токени, які тримає програма, щоб будь-хто міг обмінювати їх між собою; хто додає ліквідність, заробляє комісії угод."],
            ["Симуляція", "Тестове середовище Прогнозів сьогодні: ордери, баланс і результати без реальних коштів."],
            ["Кредити", "Власні одиниці помічника для відповідей моделі — не токен, не гроші, ніколи не виплачуються."],
            ["Орієнтир", "З чим порівнюють ціну: ціна емітента за акцію для публічної компанії, оцінка PreStocks — для приватної."],
            ["Комісія Ryntra", "Власна комісія Ryntra на купівлю, обмін, угоду чи рух між мережами, окремим рядком."],
            ["Кешбек", "Частка комісії, яку отримала Ryntra, повернута тобі через Винагороди."],
            ["Очки", "Запис справжньої активності без грошової вартості."],
            ["Токенізована акція", "Токен Solana від третьої сторони, що відстежує ціну біржової акції."],
            ["Токен PreStocks", "Токен економічної експозиції на приватну компанію — не акція, з комісією емітента на кожен переказ."],
            ["Рахунок токена", "Рахунок, який гаманець Solana тримає для кожного свого токена; новий лишає невеликий поворотний резерв."],
            ["Прослизання", "Різниця між очікуваною ціною й виконаною; обмежена мінімумом, який ти приймаєш."],
            ["Вплив на ціну", "Наскільки твоя власна угода зсуває ціну ринку."],
            ["Ліквідність", "Скільки можна проторгувати на ринку, не зсунувши ціну далеко."],
            ["Wallet Standard", "Домовленість Solana, що дає будь-якому сумісному гаманцю підключатися до будь-якого застосунку."],
            ["Для досвідчених", "Те, чим користується трейдер: скринер Ринків з усіма колонками й порядками; Спот зі свічковим графіком — у групі «Торгівля»; плани угод і їхні результати — у «Автоматика → Боти»; Історія — у групі «Гроші». Ті самі перевірки перед кожним підписом."],
          ],
        },
      ),
    ]),
  ],
  related: ["reference/faq"],
};

export const REFERENCE_PAGES: readonly DocPage[] = [NETWORKS, FEES_PAGE, RECEIPTS, REVIEW, STATUSES, TROUBLESHOOTING, FAQ, GLOSSARY];
