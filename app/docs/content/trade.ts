import { FEES, FEES_UK, LIMITS, PURCHASE, REWARDS } from "./facts.ts";
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Торгівля — the overview of the group (spot, swap, stocks and memes), Spot with its limit orders, Swap, and the
 * Markets screener with its Trending order, each documented as what it does today. «Між мережами» (Bridge) is
 * documented under Money, where the menu keeps it; how a company is bought and what you buy keep their `invest/*`
 * addresses under this section. Perps and Predictions have their own sections (`perps.ts`, `predictions.ts`).
 */

export const SWAP: DocPage = {
  slug: "trade/swap",
  group: "trade",
  pageId: "swap",
  title: { en: "Swap", uk: "Обмін" },
  summary: {
    en: "The simplest way to exchange one Solana asset for another: the quote, the Review, your signature, the receipt.",
    uk: "Найпростіший спосіб обміняти один актив Solana на інший: котирування, «Перевірка», твій підпис, квитанція.",
  },
  sections: [
    section("what", "What Swap is for", "Для чого Обмін", [
      p(
        "Swap answers one question — «I want to exchange this asset for that one on Solana» — and nothing else. USDC to SOL, SOL to a token, a token back to USDC. Its strength is speed and clarity: it is not a trading terminal, and it does not become one.",
        "Обмін відповідає на одне питання — «хочу обміняти цей актив на той на Solana» — і ні на що інше. USDC на SOL, SOL на токен, токен назад на USDC. Його сила — швидкість і ясність: це не торговий термінал, і він ним не стає.",
      ),
      facts(
        [
          ["Assets", "Any Solana token with a market; verified tokens are marked"],
          ["Quote", "Live, from the aggregated Solana liquidity; refreshes while you look"],
          ["Ryntra service fee", `${FEES.swap} of the amount by the token — none from dollar to dollar — with its amount in the quote you see`],
          ["Your net cost", `${FEES.swapNetOfCashback} after the ${REWARDS.cashbackPercent}% cashback in Rewards when the whole fee reaches Ryntra; ${FEES.swapNetOfCashbackOrder} when Jupiter's order route carries the swap and keeps its share of the fee — major coins carry no Ryntra fee on that route`],
          ["Signature", "Your wallet's, for the exact transaction you reviewed"],
        ],
        [
          ["Активи", "Будь-який токен Solana, що має ринок; перевірені токени позначено"],
          ["Котирування", "Живе, з агрегованої ліквідності Solana; оновлюється, поки ти дивишся"],
          ["Комісія Ryntra", `${FEES_UK.swap} від суми залежно від токена — між доларами немає — із сумою в котируванні, яке ти бачиш`],
          ["Твоя чиста вартість", `${FEES_UK.swapNetOfCashback} після кешбеку ${REWARDS.cashbackPercent}% у Винагородах, коли вся комісія доходить до Ryntra; ${FEES_UK.swapNetOfCashbackOrder}, коли обмін іде маршрутом замовлень Jupiter і він лишає собі частку комісії — великі монети на цьому маршруті комісії Ryntra не мають`],
          ["Підпис", "Твого гаманця — рівно на ту транзакцію, що була в «Перевірці»"],
        ],
      ),
    ]),
    section("how", "How to swap", "Як обміняти", [
      steps(
        [
          "Choose the asset you pay and the asset you receive. Search by name, ticker or mint address.",
          "Enter the amount, or use 25% · 50% · 75% · MAX of what you hold.",
          "Wait for the quote. It shows the rate, the price impact, the network fee and the minimum you will receive.",
          "Press Review. Ryntra simulates the exact transaction and shows what will leave your wallet and what will arrive — including any reserve a new token account keeps.",
          "Confirm in your wallet. If the market moved past the reviewed figures, Ryntra asks you to review again instead of signing stale terms.",
          "Follow the result in History. The receipt keeps the reviewed and the settled figures side by side.",
        ],
        [
          "Обери актив, яким платиш, і актив, який отримуєш. Шукай за назвою, тікером або адресою mint.",
          "Введи суму або візьми 25% · 50% · 75% · MAX від того, що маєш.",
          "Дочекайся котирування. Воно показує курс, вплив на ціну, плату мережі й мінімум, який ти отримаєш.",
          "Натисни «Перевірка». Ryntra симулює точну транзакцію й показує, що спишеться з гаманця і що надійде, — разом із резервом, який лишає новий рахунок токена.",
          "Підтверди в гаманці. Якщо ринок вийшов за перевірені цифри, Ryntra попросить перевірити знову, а не підписувати застарілі умови.",
          "Стеж за результатом в Історії. Квитанція тримає перевірені й фактичні цифри поруч.",
        ],
      ),
    ]),
    section("costs", "What a swap costs", "Скільки коштує обмін", [
      table(
        { en: ["Cost", "Who receives it", "Where you see it"], uk: ["Витрата", "Хто отримує", "Де ти це бачиш"] },
        {
          en: [
            [`Ryntra service fee, ${FEES.swap}`, "Ryntra — half of what it receives comes back to you as cashback", "In the quote and in the Review"],
            ["Network fee", "The Solana network", "In the Review, in SOL"],
            ["Token account reserve", "Kept by your own new token account; refundable when you close it", "In the Review, as the account reserve"],
            ["Price impact and slippage", "The market, not Ryntra", "In the quote; the minimum you receive bounds it"],
          ],
          uk: [
            [`Комісія Ryntra, ${FEES_UK.swap}`, "Ryntra — половина отриманого повертається тобі кешбеком", "У котируванні й у «Перевірці»"],
            ["Плата мережі", "Мережа Solana", "У «Перевірці», в SOL"],
            ["Резерв рахунку токена", "Лишається на твоєму новому рахунку токена; повертається, коли ти його закриваєш", "У «Перевірці», як резерв рахунку"],
            ["Вплив на ціну і прослизання", "Ринок, не Ryntra", "У котируванні; мінімум, який ти отримаєш, їх обмежує"],
          ],
        },
      ),
      note(
        "Ryntra never adds a cost it did not show you. If a route carries no Ryntra fee, the receipt says so and no cashback accrues.",
        "Ryntra ніколи не додає витрати, якої не показала. Якщо маршрут не має комісії Ryntra, квитанція про це каже, і кешбек не нараховується.",
      ),
    ]),
  ],
  related: ["reference/review", "reference/fees", "money/rewards", "trade/spot"],
};

export const BRIDGE: DocPage = {
  slug: "money/bridge",
  group: "money",
  pageId: "bridge",
  title: { en: "Between networks", uk: "Між мережами" },
  summary: {
    en: "Move money between Solana and other networks with your Solana wallet alone: in through a deposit address, out by one reviewed transaction.",
    uk: "Переноси гроші між Solana й іншими мережами лише гаманцем Solana: усередину — через адресу поповнення, назовні — однією перевіреною транзакцією.",
  },
  sections: [
    section("what", "What it is for", "Для чого це", [
      p(
        "Swap changes an asset on Solana. Money → Between networks moves money across chains through Relay, and needs only your Solana wallet: no wallet of another network is ever connected. Money comes into Solana through a deposit address the page gives you; money leaves Solana by a transaction your Solana wallet signs.",
        "Обмін змінює актив на Solana. Гроші → Між мережами переносить гроші між мережами через Relay, і для цього потрібен лише твій гаманець Solana: гаманця іншої мережі ніколи не підключають. У Solana гроші приходять через адресу поповнення, яку дає сторінка; із Solana вони йдуть транзакцією, яку підписує твій гаманець Solana.",
      ),
      facts(
        [
          ["Into Solana", "USDC from Base, Ethereum, Arbitrum, Optimism, Polygon or BNB Chain, to USDC on Solana, from $1"],
          ["Out of Solana", "To Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain and others, and USDG to Robinhood Chain — the form lists what each route offers"],
          ["Ryntra's fee", `None into Solana; ${FEES.bridge} of the amount out of Solana, stated apart from the provider's and the networks' costs`],
          ["Time", "An estimate is shown per route before you sign; History follows the transfer until it arrives"],
        ],
        [
          ["У Solana", "USDC з Base, Ethereum, Arbitrum, Optimism, Polygon чи BNB Chain — у USDC на Solana, від $1"],
          ["Із Solana", "У Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain та інші, а USDG — у Robinhood Chain; форма показує, що пропонує кожен маршрут"],
          ["Комісія Ryntra", `У Solana — немає; із Solana — ${FEES_UK.bridge} від суми, окремо від витрат провайдера й мереж`],
          ["Час", "Оцінку маршруту видно до підпису; Історія веде переказ до прибуття"],
        ],
      ),
    ]),
    section("how", "How to move money", "Як перенести гроші", [
      steps(
        [
          "Choose where the money is and where it goes. Both sides on Solana is a swap, and the page says so.",
          "Into Solana: the page shows a deposit address on the source network. Send USDC there from your exchange or wallet; it arrives in your Solana wallet as USDC.",
          "Out of Solana: enter the amount and the destination address, and read the quote — what arrives, the provider's costs, Ryntra's fee, the network costs and the estimated time. Press Review and sign with your Solana wallet.",
          "Watch History: the transfer reads On its way, then Arrived; if a step needs you, it reads Needs you and says what to do.",
        ],
        [
          "Обери, де гроші й куди вони йдуть. Обидві сторони на Solana — це обмін, і сторінка про це скаже.",
          "У Solana: сторінка показує адресу поповнення у вихідній мережі. Надішли туди USDC зі своєї біржі чи гаманця — вони надійдуть у твій гаманець Solana як USDC.",
          "Із Solana: введи суму й адресу призначення та прочитай котирування — що надійде, витрати провайдера, комісія Ryntra, плата мереж і орієнтовний час. Натисни «Перевірка» й підпиши гаманцем Solana.",
          "Стеж в Історії: переказ читається як «У дорозі», потім «Надійшло»; якщо крок потребує тебе, він читається як «Потрібна твоя дія» і каже, що робити.",
        ],
      ),
      note(
        "Send only USDC, on the network the page names, to a deposit address; a deposit Relay cannot fill is not refunded by itself — it is recovered through Relay's support. Out of Solana, the destination address is part of the amount: check it before you sign, every time.",
        "На адресу поповнення надсилай лише USDC і лише в тій мережі, яку називає сторінка; поповнення, яке Relay не може виконати, саме не повертається — його повертають через підтримку Relay. Із Solana адреса призначення — частина суми: перевіряй її до підпису щоразу.",
        "caution",
      ),
    ]),
  ],
  related: ["reference/networks", "money/top-up", "reference/fees"],
};

export const SPOT: DocPage = {
  slug: "trade/spot",
  group: "trade",
  pageId: "spot",
  title: { en: "Spot", uk: "Спот" },
  summary: {
    en: "For the experienced: crypto, memes and tokenized stocks with a chart, liquidity and volume, and Buy or Sell through the same Review.",
    uk: "Для досвідчених: крипта, меми й токенізовані акції з графіком, ліквідністю й обсягом, і «Купити» чи «Продати» через ту саму «Перевірку».",
  },
  sections: [
    section("what", "What Spot is for", "Для чого Спот", [
      p(
        "Spot is where you look at an asset before you trade it. Every market shows its price, the 24-hour move, a chart with timeframes from a minute to a day, liquidity, volume, market cap, holders and age, plus what you hold of it and what you have traded here. Buy and Sell sit beside that context and go through the same Review and the same wallet signature as Swap.",
        "Спот — місце, де ти дивишся на актив перед тим, як ним торгувати. Кожен ринок показує ціну, рух за 24 години, графік із таймфреймами від хвилини до доби, ліквідність, обсяг, капіталізацію, кількість власників і вік, а ще що з нього є в тебе і твої угоди на ньому. «Купити» й «Продати» стоять поруч із цим і проходять ту саму «Перевірку» й той самий підпис гаманця, що й Обмін.",
      ),
      facts(
        [
          ["Categories", "All · Crypto · Memes · Stocks/RWA · Watchlist"],
          ["Pay or receive in", "USDC or SOL, switched on the ticket"],
          ["Ryntra service fee", `${FEES.spot} of the amount by the token, with its amount in the quote`],
          ["Execution", "Aggregated Solana liquidity; the same engine as Swap"],
          ["Hours", "Around the clock — Solana markets do not close"],
        ],
        [
          ["Категорії", "Усі · Крипта · Меми · Акції/RWA · Обране"],
          ["Оплата чи отримання", "USDC або SOL, перемикач на квитку"],
          ["Комісія Ryntra", `${FEES_UK.spot} від суми залежно від токена, із сумою в котируванні`],
          ["Виконання", "Агрегована ліквідність Solana; той самий рушій, що й Обмін"],
          ["Години", "Цілодобово — ринки Solana не зачиняються"],
        ],
      ),
    ]),
    section("how", "How to trade on Spot", "Як торгувати на Споті", [
      steps(
        [
          "Pick a category or search by name, ticker or address. The list shows price, 24h change, liquidity and volume for each market.",
          "Open a market. Read the chart and the figures; the header says what the asset is — for a tokenized stock, its issuer and the reference it tracks.",
          "On the ticket choose Buy or Sell and whether you pay or receive in USDC or SOL, then the amount.",
          "Press Review. It shows what leaves, what arrives at least, the fees and any account reserve. Confirm in your wallet.",
          "The trade lands in History with its receipt; your holding of the asset updates on the market page and in Portfolio.",
        ],
        [
          "Обери категорію або шукай за назвою, тікером чи адресою. Список показує ціну, зміну за 24 год, ліквідність і обсяг кожного ринку.",
          "Відкрий ринок. Прочитай графік і цифри; заголовок каже, що це за актив, — для токенізованої акції це емітент і орієнтир, за яким вона рухається.",
          "На квитку обери «Купити» чи «Продати», у чому платити чи отримувати — USDC або SOL, — потім суму.",
          "Натисни «Перевірка». Вона показує, що спишеться, що надійде щонайменше, комісії й резерв рахунку, якщо він є. Підтверди в гаманці.",
          "Угода з'являється в Історії з квитанцією; твоя позиція в активі оновлюється на сторінці ринку й у Портфелі.",
        ],
      ),
    ]),
    section("limits", "Limit orders", "Лімітні ордери", [
      p(
        "Beside Buy and Sell at the market, the Spot ticket places a limit — a price you want to buy at or sell at — on one of two venues on Solana. Either way your tokens leave the wallet into an account the venue's program holds for this order alone, and only your signature takes them back; open orders stand under My orders, where you cancel them.",
        "Поруч із ринковими «Купити» й «Продати» квиток Споту ставить ліміт — ціну, за якою хочеш купити чи продати, — на одному з двох майданчиків Solana. В обох випадках токени йдуть із гаманця на рахунок, який програма майданчика тримає лише для цього ордера, і повертає їх лише твій підпис; відкриті ордери стоять у «Мої ордери», де їх і скасовують.",
      ),
      table(
        { en: ["Venue", "How it fills", "Ryntra's fee"], uk: ["Майданчик", "Як виконується", "Комісія Ryntra"] },
        {
          en: [
            ["Jupiter", `Jupiter's keeper swaps when the market reaches your price; from ${LIMITS.triggerMinimum} an order`, `The pair's rate, at least ${LIMITS.triggerFloor.en} — none on a dollar pair — in the token you receive and on top of the price; the Review says at which price the order really fills`],
            ["A Meteora pool", `The pool fills your bins as the price crosses them, up to ${LIMITS.dlmmMaxBins} bins; offered where a pool of the pair takes limits`, `None — you earn ${LIMITS.dlmmMakerShare} of the pool's fee on what your order fills`],
          ],
          uk: [
            ["Jupiter", `Кіпер Jupiter робить обмін, коли ринок доходить до твоєї ціни; ордер від ${LIMITS.triggerMinimum}`, `Ставка пари, щонайменше ${LIMITS.triggerFloor.uk} — на доларовій парі немає, — у токені, який отримуєш, і понад ціну; «Перевірка» каже, за якою ціною ордер справді виконається`],
            ["Пул Meteora", `Пул виконує твої біни, коли ціна їх перетинає, до ${LIMITS.dlmmMaxBins} бінів; доступно там, де пул пари приймає ліміти`, `Немає — тобі йде ${LIMITS.dlmmMakerShare} комісії пулу з того, що виконав твій ордер`],
          ],
        },
      ),
      note(
        "A Spot order carries no TP/SL. «Exit plan» on a meme is a reminder kept on this device while the page is open: when a level is reached you open the Review and sign — nothing sells by itself.",
        "Ордер Споту не має TP/SL. «План виходу» на мемі — нагадування, яке зберігається на цьому пристрої, поки сторінка відкрита: коли рівень досягнуто, ти відкриваєш «Перевірку» і підписуєш — само нічого не продається.",
      ),
    ]),
    section("memes", "Memes", "Меми", [
      p(
        "Memes are a category inside Spot, not a separate venue. Beside the name and the button Ryntra shows what a meme market actually has — liquidity, volume, age, holders, whether the token is verified — because those figures are the difference between a market and a name. A pool without enough liquidity to be called a market is said to be exactly that.",
        "Меми — категорія всередині Споту, а не окремий майданчик. Поруч із назвою й кнопкою Ryntra показує, що мем-ринок має насправді, — ліквідність, обсяг, вік, власників, чи перевірено токен, — бо саме ці цифри відрізняють ринок від назви. Пул без достатньої ліквідності, щоб зватися ринком, так і названо.",
      ),
      note(
        "Nothing on a Spot list is a ranking or a suggestion to buy. The order reflects market figures, and the figures come with their source.",
        "Ніщо в списку Споту не є рейтингом чи порадою купити. Порядок відображає ринкові цифри, а цифри йдуть із джерелом.",
      ),
    ]),
  ],
  related: ["trade/screener", "trade/swap", "reference/review", "manage/portfolio"],
};

export const SCREENER: DocPage = {
  slug: "trade/screener",
  group: "trade",
  pageId: "stocks",
  title: { en: "Markets: the screener", uk: "Ринки: скринер" },
  summary: {
    en: "One table for everything Ryntra trades — tokenized stocks, private companies, crypto and memes — sorted the way you choose.",
    uk: "Одна таблиця для всього, чим торгує Ryntra, — токенізовані акції, приватні компанії, крипта й меми — у порядку, який обираєш ти.",
  },
  sections: [
    section("what", "What the screener shows", "Що показує скринер", [
      p(
        "Markets is one screener. Its tabs All, Crypto, Stocks, Private and Watchlist are views of one table, and the filter above it finds a row by name, ticker, issuer or address; a row opens the token's page — a company's page for a stock or a private company, the market in Spot for a coin. Memes opens the meme radar — six read-only feeds: New, Growing, Near Graduation, Graduated, Trending and Watchlist. Wallets follows the wallets you choose, their trades and results read from the chain.",
        "Ринки — це один скринер. Його вкладки Усі, Крипта, Акції, Приватні й Обране — види однієї таблиці, а фільтр над нею знаходить рядок за назвою, тікером, емітентом чи адресою; рядок відкриває сторінку токена — сторінку компанії для акції чи приватної компанії, ринок у Споті для монети. «Меми» відкривають мем-радар — шість стрічок лише для читання: Нові, Ростуть, Майже на DEX, Вийшли на DEX, Тренди й Обране. «Гаманці» стежать за гаманцями, які обереш ти, — їхні угоди й результати прочитано з ланцюга.",
      ),
      list(
        [
          "For every asset: the price, the change over 24 hours, the volume, the liquidity and, where the venue states it, the market cap.",
          "For crypto, also the hour's change, the age of the first pool, the share the ten largest holders keep and the venue's organic score; a token whose mint or freeze authority is still open says so on its row.",
          "For stocks: the issuer, the exchange's session and the token's deviation from the share's price on the exchange. For private companies: «Not a share» and the token against PreStocks' own valuation — context, not a deviation.",
          "The order is yours: Most traded (the day's volume), Gainers, Losers, Moving now, Newest, Liquidity, or any column's header. Your tab and order are kept on this device; the Watchlist is the same list as Spot's star.",
        ],
        [
          "Для кожного активу: ціна, зміна за 24 години, обсяг, ліквідність і, де майданчик її називає, капіталізація.",
          "Для крипти ще зміна за годину, вік першого пулу, частка десяти найбільших власників і органічна оцінка майданчика; токен, у якого право випуску чи заморозки не відкликано, каже про це у своєму рядку.",
          "Для акцій: емітент, сесія біржі й відхилення ціни токена від ціни акції на біржі. Для приватних компаній: «Це не акція» і ціна токена проти оцінки самого PreStocks — для орієнтиру, не відхилення.",
          "Порядок обираєш ти: «Найбільший обсяг» (денний обсяг), «Зростають», «Падають», «Рух за годину», «Нові», «Ліквідність» або заголовок будь-якої колонки. Вкладка й порядок зберігаються на цьому пристрої; «Обране» — той самий список, що й зірка у Споті.",
        ],
      ),
      note(
        "Every figure is its source's own — the venue's for coins, the issuers' and exchanges' for stocks — and a figure nobody stated is a dash, never a zero. Nothing in the table is a recommendation; the quote for your sum comes when you buy, and is quoted again in the Review.",
        "Кожна цифра — її джерела: майданчика для монет, емітентів і бірж для акцій, — а цифра, якої ніхто не назвав, — риска, ніколи не нуль. Ніщо в таблиці не є рекомендацією; котирування на твою суму приходить, коли купуєш, і котирується заново в «Перевірці».",
      ),
    ]),
  ],
  related: ["invest/what-you-buy", "invest/company-page", "trade/spot"],
};

export const TRENDS: DocPage = {
  slug: "trade/trends",
  group: "trade",
  pageId: "trends",
  title: { en: "Trending", uk: "У тренді" },
  summary: {
    en: "What is moving on Solana today — the Most traded order of the Markets screener and the meme radar's Trending feed, by the venue's own figures.",
    uk: "Що рухається на Solana сьогодні — порядок «Найбільший обсяг» скринера Ринків і стрічка «Тренди» мем-радару, за цифрами самого майданчика.",
  },
  sections: [
    section("today", "What Trending shows", "Що показує «У тренді»", [
      p(
        "Trending is not a page of its own any more. In the Markets screener it is the first order, Most traded — the assets with the most trading on Solana today, by the venue's own figures — with Gainers, Losers and Moving now beside it; for memes it is the Trending feed of the meme radar under Memes.",
        "«У тренді» — більше не окрема сторінка. У скринері Ринків це перший порядок, «Найбільший обсяг», — активи з найбільшим обсягом торгів на Solana сьогодні, за цифрами самого майданчика, — а поруч «Зростають», «Падають» і «Рух за годину»; для мемів це стрічка «Тренди» мем-радару у вкладці «Меми».",
      ),
      list(
        [
          "A row opens the token's page — a coin's market in Spot, where the chart, the watchlist star and the ticket are.",
          "Deposit receipts — a lending position like jlUSDC — are not rows: they are not markets to screen.",
          "It is not a ranking and not advice: a figure the venue did not state shows a dash, never a zero.",
        ],
        [
          "Рядок відкриває сторінку токена — ринок монети в Споті, де графік, зірка обраного й квиток.",
          "Депозитні квитанції — позиція в кредитуванні, як-от jlUSDC, — не рядки: це не ринки для скринера.",
          "Це не рейтинг і не порада: цифру, якої майданчик не назвав, показано рискою, ніколи нулем.",
        ],
      ),
    ]),
  ],
  related: ["trade/spot", "trade/screener", "strategies/overview"],
};

export const TRADE_OVERVIEW: DocPage = {
  slug: "trade/overview",
  group: "trade",
  destination: "spot",
  title: { en: "Trading: overview", uk: "Торгівля: огляд" },
  seoTitle: { en: "Trading on Solana: spot, swap, stocks, memes — Ryntra Docs", uk: "Торгівля на Solana — Документація Ryntra" },
  summary: {
    en: "Spot, Swap and Markets: crypto, memes and tokenized stocks on Solana, at the market or with a limit, each through the same Review and your signature.",
    uk: "Спот, Обмін і Ринки в одній групі: крипта, меми й токенізовані акції на Solana, за ринком чи лімітом, кожне через ту саму «Перевірку» і твій підпис.",
  },
  sections: [
    section("rows", "The rows of Trading", "Рядки Торгівлі", [
      table(
        { en: ["Row", "What it is for"], uk: ["Рядок", "Для чого"] },
        {
          en: [
            ["Spot", "A market's page with its chart, figures and ticket: buy or sell at the market or with a limit, paying or receiving in USDC or SOL"],
            ["Swap", "One asset for another on Solana in the fewest steps"],
            ["Markets", "One screener for stocks, private companies, crypto and memes; a company opens its own page with Buy and Sell in dollars"],
            ["Launch", "Every market launched on Ryntra, and «Launch a token» — see Launch"],
            ["Perps", "Phoenix's perpetual futures — see Perps"],
            ["Predictions", "Markets on outcomes through AGG — see Predictions"],
          ],
          uk: [
            ["Спот", "Сторінка ринку з графіком, цифрами й квитком: купити чи продати за ринком або лімітом, платячи чи отримуючи в USDC або SOL"],
            ["Обмін", "Один актив на інший на Solana за найменше кроків"],
            ["Ринки", "Один скринер для акцій, приватних компаній, крипти й мемів; компанія відкриває свою сторінку з «Купити» й «Продати» в доларах"],
            ["Лаунч", "Кожен ринок, запущений на Ryntra, і «Запустити токен» — дивись «Лаунч»"],
            ["Perps", "Безстрокові ф'ючерси Phoenix — дивись Perps"],
            ["Прогнози", "Ринки на події через AGG — дивись «Прогнози»"],
          ],
        },
      ),
    ]),
    section("what", "What you can trade", "Чим можна торгувати", [
      list(
        [
          `Crypto — SOL, BTC, ETH, JUP and every Solana token with a market; a major coin carries Ryntra's lowest rate, ${FEES.flow("MAJOR")}.`,
          `Memes and new tokens — with their liquidity, age, holders and whether Jupiter verifies them shown beside the button; ${FEES.flow("MEME")} until a token is verified and a week old.`,
          `Tokenized stocks — tokens of xStocks, Backpack and Ondo that track a listed share, and PreStocks tokens of private companies; not shares. A company is bought in dollars from $${PURCHASE.minimum}, at ${FEES.company}.`,
          "Dollars — USDC, USDT and the other dollars on Solana; a dollar for a dollar carries no Ryntra fee.",
        ],
        [
          `Крипта — SOL, BTC, ETH, JUP і кожен токен Solana, що має ринок; велика монета має найнижчу ставку Ryntra — ${FEES_UK.flow("MAJOR")}.`,
          `Меми й нові токени — їхня ліквідність, вік, власники й чи верифікує їх Jupiter видно поруч із кнопкою; ${FEES_UK.flow("MEME")}, доки токен не верифіковано й йому не виповнився тиждень.`,
          `Токенізовані акції — токени xStocks, Backpack і Ondo, що відстежують біржову акцію, і токени PreStocks приватних компаній; це не акції. Компанію купують у доларах від $${PURCHASE.minimum}, за ${FEES_UK.company}.`,
          "Долари — USDC, USDT та інші долари на Solana; долар на долар комісії Ryntra не має.",
        ],
      ),
      note(
        "Every trade is routed on Solana — through Jupiter at the market, through Jupiter or a Meteora pool with a limit — and goes through the Review: what leaves, what arrives at least, every cost by name. Your wallet signs; Ryntra never holds the money.",
        "Кожна угода маршрутизується в Solana — через Jupiter за ринком, через Jupiter чи пул Meteora з лімітом — і проходить «Перевірку»: що спишеться, що надійде щонайменше, кожна витрата на ім'я. Підписує твій гаманець; Ryntra ніколи не тримає грошей.",
      ),
    ]),
  ],
  related: ["trade/spot", "trade/swap", "invest/buy", "reference/fees"],
};
