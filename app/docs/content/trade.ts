import { FEES, FEES_UK, REWARDS } from "./facts.ts";
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Trade — Swap, Spot, the stock screener and Trends, as the menu's «Торгувати»
 * draws them, each documented as what it does today. Bridge is documented
 * under Money, where the product keeps it; what you buy and how a company is
 * bought live under Invest since the site's redesign, and the old Stocks
 * page's address leads there. A page that is not built has no documentation
 * page: Perps is registered and drawn nowhere, and its old address leads to
 * Spot.
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
          "Натисни «Перевірити». Ryntra симулює точну транзакцію й показує, що спишеться з гаманця і що надійде, — разом із резервом, який лишає новий рахунок токена.",
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
  title: { en: "Bridge", uk: "Міст" },
  summary: {
    en: "Move value between Solana and other networks in one reviewed step — you choose the result, Ryntra finds the route.",
    uk: "Перенеси вартість між Solana й іншими мережами одним перевіреним кроком — ти обираєш результат, Ryntra знаходить маршрут.",
  },
  sections: [
    section("what", "What Bridge is for", "Для чого Міст", [
      p(
        "Swap changes an asset on Solana. Bridge moves value between networks: USDC on Base to SOL on Solana, SOL on Solana to USDC on Ethereum. You say where the money is and what you want to end up with; the routing, the providers and the steps in between are Ryntra's job, and every one of them is shown before you sign.",
        "Обмін змінює актив на Solana. Міст переносить вартість між мережами: USDC на Base → SOL на Solana, SOL на Solana → USDC на Ethereum. Ти кажеш, де гроші і що хочеш отримати; маршрут, провайдери й проміжні кроки — робота Ryntra, і кожен із них видно до підпису.",
      ),
      facts(
        [
          ["Networks", "Solana ↔ Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Robinhood Chain"],
          ["Assets", "USDC, SOL, ETH, USDG — the form lists what each route offers"],
          ["Ryntra service fee", `${FEES.bridge} of the amount, stated apart from the provider's and the networks' costs`],
          ["Time", "An estimate is shown per route before you sign; History follows the transfer until it arrives"],
        ],
        [
          ["Мережі", "Solana ↔ Base, Ethereum, Arbitrum, Optimism, Polygon, BNB Chain, Robinhood Chain"],
          ["Активи", "USDC, SOL, ETH, USDG — форма показує, що пропонує кожен маршрут"],
          ["Комісія Ryntra", `${FEES_UK.bridge} від суми, окремо від витрат провайдера й мереж`],
          ["Час", "Оцінку маршруту видно до підпису; Історія веде переказ до прибуття"],
        ],
      ),
    ]),
    section("how", "How to bridge", "Як перенести кошти", [
      steps(
        [
          "Choose the source network and asset, then the destination network and asset. Both sides on Solana is a swap, and the page says so.",
          "Connect the wallet of the source network. A transfer from Base or Ethereum is signed by your wallet on that network; a transfer from Solana by your Solana wallet.",
          "Enter the amount and read the quote: expected receive, provider costs, Ryntra fee, network costs and the estimated time.",
          "Press Review, check the destination address — it is where the money will land — and confirm in your wallet.",
          "Watch History. The transfer reads Sent, then Arrived; if a route cannot complete, the page says what happened and where the money is.",
        ],
        [
          "Обери вихідну мережу й актив, потім мережу й актив призначення. Обидві сторони на Solana — це обмін, і сторінка про це скаже.",
          "Під'єднай гаманець вихідної мережі. Переказ із Base чи Ethereum підписує твій гаманець у тій мережі; переказ із Solana — твій гаманець Solana.",
          "Введи суму й прочитай котирування: скільки очікувано надійде, витрати провайдера, комісія Ryntra, плата мереж і орієнтовний час.",
          "Натисни «Перевірити», звір адресу призначення — саме туди прийдуть гроші — і підтверди в гаманці.",
          "Стеж в Історії. Переказ читається як «Надіслано», потім «Прибуло»; якщо маршрут не може завершитися, сторінка скаже, що сталося і де гроші.",
        ],
      ),
      note(
        "A bridge is two networks and a provider between them. The destination address is part of the amount: check it before you sign, every time.",
        "Міст — це дві мережі й провайдер між ними. Адреса призначення — частина суми: перевіряй її до підпису щоразу.",
        "caution",
      ),
    ]),
  ],
  related: ["trade/swap", "reference/fees", "manage/activity"],
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
        "Spot is where you look at an asset before you trade it. Every market shows its price, the 24-hour move, a chart with timeframes from a minute to a week, liquidity, volume, market cap, holders and age, plus what you hold of it and what you have traded here. Buy and Sell sit beside that context and go through the same Review and the same wallet signature as Swap.",
        "Спот — місце, де ти дивишся на актив перед тим, як ним торгувати. Кожен ринок показує ціну, рух за 24 години, графік із таймфреймами від хвилини до тижня, ліквідність, обсяг, капіталізацію, кількість власників і вік, а ще що з нього є в тебе і твої угоди на ньому. «Купити» й «Продати» стоять поруч із цим і проходять ту саму «Перевірку» й той самий підпис гаманця, що й Обмін.",
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
          "Натисни «Перевірити». Вона показує, що спишеться, що надійде щонайменше, комісії й резерв рахунку, якщо він є. Підтверди в гаманці.",
          "Угода з'являється в Історії з квитанцією; твоя позиція в активі оновлюється на сторінці ринку й у Портфелі.",
        ],
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
  title: { en: "Stock screener", uk: "Скринер акцій" },
  summary: {
    en: "Every tokenized stock on Solana in one list — by issuer, kind, market and session — with its price and day, the issuer's reference, volume and liquidity.",
    uk: "Кожна токенізована акція на Solana в одному списку — за емітентом, видом, ринком і сесією — з ціною токена за день, орієнтиром емітента, обсягом і ліквідністю.",
  },
  sections: [
    section("what", "What the screener shows", "Що показує скринер", [
      p(
        "The screener is the Stock screener row under Trade, and on top of Markets under «For experienced investors». It opens on a strip — the US session as the issuer's calendar states it, how many stock tokens are listed and by how many issuers, how many traded today and for how much, what the pools hold — and then the whole list.",
        "Скринер — рядок «Скринер акцій» у розділі «Торгувати» й угорі Ринків, у ряді «Для досвідчених». Він відкривається смугою — сесія США так, як її називає календар емітента, скільки токенів акцій у каталозі й від скількох емітентів, скільки торгувалося сьогодні й на яку суму, що тримають пули, — а далі весь список.",
      ),
      list(
        [
          "Each row: the token's price and its day, the issuer's reference per share and its state, the deviation between them, the session, the volume and the liquidity.",
          "Filters by issuer, kind, market and session, kept for you; every column sorts, so the most traded, the most liquid and the day's movers are one press away.",
          "Search covers every listed stock by company, ticker or token; a row opens the company's page, and the candlestick chart is in Spot.",
        ],
        [
          "Кожен рядок: ціна токена за день, орієнтир емітента за акцію та його стан, відхилення між ними, сесія, обсяг і ліквідність.",
          "Фільтри за емітентом, видом, ринком і сесією зберігаються для тебе; кожна колонка сортується, тож найбільше торговані, найліквідніші й ті, що рухаються за день, — за один дотик.",
          "Пошук покриває кожну акцію в каталозі за компанією, тікером або токеном; рядок відкриває сторінку компанії, а свічковий графік — у Споті.",
        ],
      ),
      note(
        "A reference in the list is the issuer's cached figure with its fetch time, not a price you can trade at; the quote for your sum comes from the same path a purchase goes through and is quoted again in the Review. Issuers without a public catalogue show the reference as unavailable rather than as a guess.",
        "Орієнтир у списку — кешована цифра емітента з часом отримання, а не ціна, за якою можна купити; котирування на твою суму йде тим самим шляхом, що й купівля, і котирується заново в «Перевірці». Емітенти без публічного каталогу показують орієнтир як недоступний, а не як здогад.",
      ),
    ]),
  ],
  related: ["invest/what-you-buy", "invest/company-page", "trade/spot"],
};

export const TRENDS: DocPage = {
  slug: "trade/trends",
  group: "trade",
  pageId: "trends",
  title: { en: "Trends", uk: "Тренди" },
  summary: {
    en: "Where a trade starts: what is moving on Solana today, by the provider's own figures, one press away from Spot.",
    uk: "Звідки починається угода: що рухається на Solana сьогодні, за цифрами самого постачальника, за одне натискання від Споту.",
  },
  sections: [
    section("today", "What Trends shows", "Що показують Тренди", [
      p(
        "Spot answers «what do I want to trade»; Trends answers «what is worth looking at right now». Trending lists the most traded assets on Solana today, Memes the memes by the day's volume, each row with its price, the day's change, volume, liquidity and whether the token is verified — the provider's own figures, with the time they were read. Above the list, four tiles: the most traded asset, the biggest move, the most liquid, and the day's activity across the list.",
        "Спот відповідає «чим я хочу торгувати»; Тренди — «на що варто подивитися зараз». «У тренді» показує активи з найбільшим обсягом торгів на Solana сьогодні, «Меми» — меми за денним обсягом; кожен рядок має ціну, зміну за день, обсяг, ліквідність і позначку, чи токен перевірено, — цифри самого постачальника з часом, коли їх прочитано. Над списком — чотири плитки: найбільше торгів, найбільший рух, найліквідніший актив і активність за день по списку.",
      ),
      list(
        [
          "A row or a tile opens the asset in Spot, where the chart, the watchlist star and the ticket are.",
          "Stocks/RWA opens the stock screener, where tokenized stocks have their own list.",
          "It is not a ranking and not advice: a figure the provider did not state shows a dash, never a zero.",
        ],
        [
          "Рядок чи плитка відкриває актив у Споті — там графік, зірка обраного й квиток.",
          "«Акції/RWA» відкриває скринер акцій — там токенізовані акції мають власний список.",
          "Це не рейтинг і не порада: цифру, якої постачальник не назвав, показано рискою, ніколи нулем.",
        ],
      ),
    ]),
  ],
  related: ["trade/spot", "trade/screener", "strategies/overview"],
};

/* The prediction demo left the surface on 2026-09-24, so its page is not
   documented to a person; its text stays below, beside the demo's code, and
   its address leads to the menu's page. */
export const PREDICTIONS: DocPage = {
  slug: "trade/predictions",
  group: "trade",
  pageId: "predictions",
  title: { en: "Predictions", uk: "Прогнози" },
  summary: {
    en: "Markets on outcomes — crypto, finance, politics, sports, world — across the venues that price them, with a plan, a Review and paper trading. Paper trading only: simulated funds, no real money.",
    uk: "Ринки на події — крипта, фінанси, політика, спорт, світ — по майданчиках, що їх оцінюють, із планом, перевіркою і paper-торгівлею. Лише paper-торгівля: симульовані кошти, без реальних грошей.",
  },
  sections: [
    section("today", "What Predictions does today", "Що Прогнози роблять сьогодні", [
      p(
        "A prediction market is a market on an outcome: a share of «Yes» pays $1 if the outcome happens and $0 if it does not, so its price is the market's probability. Predictions lists these markets across the venues that trade them — the same question priced side by side — with search, trending, ending soon, the venues' real categories and your watchlist. A market opens into its outcomes and live probabilities, the change over a day and a week, the volume, the time to resolution, and your paper position.",
        "Ринок прогнозів — це ринок на подію: частка «Так» виплачує $1, якщо подія стається, і $0, якщо ні, тож її ціна — це ймовірність, яку дає ринок. Прогнози показують такі ринки по майданчиках, де вони торгуються — одне питання, оцінене поруч, — із пошуком, трендом, тими, що скоро завершуються, справжніми категоріями майданчиків і вашим списком відстеження. Ринок відкривається у свої наслідки й живі ймовірності, зміну за день і тиждень, обсяг, час до резолюції та вашу paper-позицію.",
      ),
      list(
        [
          "Research: each venue's live price, the price history, related markets, generated signals with the model named, the ripple effect, news, and each venue's own resolution rules and where they differ.",
          "Market depth: the aggregated order book with each level's venue breakdown, the books by venue, live trades, venue prices and the cross-venue return where the provider computes one.",
          "A Prediction Plan in three steps — Why, Risk / Money, Conditions — sized on the amount and the entry probability; for a prediction the whole amount is the most you can lose.",
          "A Review before every paper order: the outcome, what you put on it, what it pays if right, what you lose if wrong, the fees, the quote's age, the venues that fill it, the settlement summary, your plan's conditions and every check. The one action is «Place paper order».",
        ],
        [
          "Дослідження: жива ціна кожного майданчика, історія ціни, пов'язані ринки, згенеровані сигнали з названою моделлю, ефект хвилі, новини, а також власні правила резолюції кожного майданчика і де вони різняться.",
          "Глибина ринку: агрегована книга ордерів із розкладом кожного рівня по майданчиках, книги по майданчиках, живі угоди, ціни майданчиків і міжмайданчикова дохідність там, де постачальник її обчислює.",
          "План прогнозу у три кроки — Чому, Ризик / Гроші, Умови — розрахований за сумою і ймовірністю входу; для прогнозу вся сума — найбільше, що можна втратити.",
          "Перевірка перед кожним paper-ордером: наслідок, скільки ви ставите, скільки він виплатить, якщо праві, скільки втратите, якщо ні, комісії, вік котирування, майданчики, що виконують, підсумок резолюції, умови вашого плану і кожна перевірка. Одна дія — «Розмістити paper-ордер».",
        ],
      ),
    ]),
    section("paper", "Paper trading, and what it is not", "Paper-торгівля і чим вона не є", [
      p(
        "Predictions runs in paper mode: a paper balance of simulated funds, paper orders, paper positions. A paper order is priced against the venues' live books and filled by the provider's simulator — no venue receives it, no real funds move, and nothing here is a blockchain testnet. Paper figures never enter your real portfolio: Portfolio shows «Paper Predictions» apart, and History tags every paper operation. Live trading in prediction markets is a separate decision that has not been taken.",
        "Прогнози працюють у paper-режимі: paper-баланс із симульованих коштів, paper-ордери, paper-позиції. Paper-ордер оцінюється за живими книгами майданчиків і виконується симулятором постачальника — жоден майданчик його не отримує, реальні кошти не рухаються, і це не блокчейн-тестнет. Paper-цифри ніколи не потрапляють у ваш реальний портфель: Портфель показує «Paper-прогнози» окремо, а Історія позначає кожну paper-операцію. Live-торгівля на ринках прогнозів — окреме рішення, якого не ухвалено.",
      ),
      note(
        "Enabling paper trading takes one signature with your wallet: the provider issues its own sign-in message, your wallet signs it, and Ryntra keeps the provider session on the server behind your account. You never see a second profile, and no token of the provider's reaches your browser.",
        "Увімкнення paper-торгівлі — один підпис гаманцем: постачальник видає власне повідомлення для входу, гаманець його підписує, а Ryntra тримає сесію постачальника на сервері за вашим акаунтом. Ви ніколи не бачите другого профілю, і жоден токен постачальника не потрапляє у ваш браузер.",
      ),
    ]),
    section("honesty", "What a probability is, and is not", "Чим є ймовірність, а чим ні", [
      p(
        "A probability is a price, not a fact about the future. Generated signals are the provider's model's observations — Ryntra names the model and never turns a signal into a «buy». Venues can settle the same question differently; the resolution rules are each venue's own words, shown as such. A thin book moves on small orders; the Review names the venues and the quote's age so you decide on what is actually there.",
        "Імовірність — це ціна, а не факт про майбутнє. Згенеровані сигнали — спостереження моделі постачальника; Ryntra називає модель і ніколи не перетворює сигнал на «купуй». Майданчики можуть вирішити одне й те саме питання по-різному; правила резолюції — власні слова кожного майданчика, показані як такі. Тонка книга рухається від малих ордерів; перевірка називає майданчики і вік котирування, щоб ви вирішували на підставі того, що є насправді.",
      ),
    ]),
  ],
  related: ["strategies/overview", "manage/portfolio", "reference/statuses"],
};
