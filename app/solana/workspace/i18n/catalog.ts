import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Ukrainian projection of existing Solana copy.
 *
 * English is the canonical source text in the components and module registry;
 * Ukrainian is an exact keyed projection. Missing copy throws instead of
 * silently mixing languages. Raw addresses, codes and provider values never
 * pass through this table.
 */
export const SOLANA_UK_TEXT: Readonly<Record<string, string>> = {
  /* `.skr` names in the wallet, «Надіслати», the Portfolio and the receipts; the look-alike address (SKR-4, SEC-2). */
  "Name": "Ім'я",
  "Solana address or .skr name": "Адреса Solana або ім'я .skr",
  "Finding the name…": "Шукаю ім'я…",
  "No such .skr name": "Такого імені .skr немає",
  "The name could not be checked right now.": "Ім'я зараз не вдалося перевірити.",
  "Check the name": "Перевір ім'я",
  "Check the whole address": "Перевір усю адресу",
  "Looks like your own address, but it is another. Check the whole address.": "Схожа на твою адресу, але інша. Перевір усю адресу.",
  "Looks like a recent address, but it is another. Check the whole address.": "Схожа на адресу з нещодавніх, але інша. Перевір усю адресу.",
  "It is the right address": "Адреса правильна",
  /* The first transfer to a new address, and the standing fact of every Review (SEC-2) — the phone's words
     (`apps/mobile/src/features/money/pay-copy.ts`, `features/wallet/signing-copy.ts`). */
  "Nothing was sent to this address yet. Match its first and last characters with whoever gave it.":
    "На цю адресу переказів ще не було. Звір перші й останні символи з тим, хто її дав.",
  "Address checked": "Адресу звірено",
  "Check the new address": "Звір нову адресу",
  "Ryntra never sees your keys.": "Ryntra не бачить твоїх ключів.",
  "The name now points to another address. Check it and review again.": "Ім'я тепер веде на іншу адресу. Перевір її й переглянь ще раз.",
  "The name could not be checked again before signing. Nothing was sent.": "Ім'я не вдалося перевірити ще раз перед підписом. Нічого не надіслано.",
  /* The token page. */
  "GeckoTerminal's check could not be read just now; that is not a «no».": "Перевірку GeckoTerminal зараз не вдалося прочитати; це не означає «ні».",
  "Not read": "Не прочитано",
  "Top holders, as Jupiter counts them": "Топ-холдери, за підрахунком Jupiter",
  "Program accounts among these 20": "Рахунки програм серед цих 20",
  "Total liquidity from Jupiter; pools by depth; trades 24h are buys / sells": "Загальна ліквідність — від Jupiter; пули за глибиною; угоди 24 год — купівлі / продажі",
  "The share of the supply in the largest wallets, as Jupiter counts them.": "Частка пропозиції в найбільших гаманцях, за підрахунком Jupiter.",
  /* The token page. */
  "The issuer": "Емітент",
  "My trades": "Мої угоди",
  /* The token page. */
  "Show more": "Показати ще",
  /* The token page. */
  "Solana chain": "Ланцюг Solana",
  "Last read": "Останнє прочитане",
  "Read": "Прочитано",
  "Could not refresh — showing the last read.": "Не вдалося оновити — показано останнє прочитане.",
  "This could not be read just now.": "Зараз це не вдалося прочитати.",
  "You": "Ти",
  "Creator": "Творець",
  "Pool": "Пул",
  "Top 10": "Топ-10",
  "Show trades": "Показати угоди",
  "Buys": "Купівлі",
  "Sells": "Продажі",
  "$1K+": "$1K+",
  "No trades in this pool lately.": "Останнім часом у цьому пулі немає угод.",
  "No trades of this kind among the last read.": "Серед останніх прочитаних немає таких угод.",
  "Who": "Хто",
  "Market cap then": "Капіталізація тоді",
  "Open in the explorer": "Відкрити в оглядачі",
  "The last trades of": "Останні угоди пулу",
  "market cap at the trade's price and today's supply": "капіталізація — за ціною угоди й сьогоднішньою кількістю в обігу",
  "No holder could be read.": "Не вдалося прочитати жодного холдера.",
  "Holder": "Холдер",
  "Of supply": "Частка",
  "Change": "Зміна",
  "The 20 largest accounts on the chain, by owner": "20 найбільших рахунків у ланцюгу, за власником",
  "change: the holder's own buys and sells in the main pool": "зміна — власні купівлі й продажі холдера в головному пулі",
  "transfers not counted": "перекази не враховано",
  "change: no trades read": "зміна — угод не прочитано",
  "No pool of this token is listed.": "Жодного пулу цього токена не знайдено.",
  "Trades 24h": "Угоди 24 год",
  "Active": "Діє",
  "Revoked": "Відкликано",
  "Not verified": "Не перевірено",
  "High": "Висока",
  "Medium": "Середня",
  "Low": "Низька",
  "Selling looks blocked": "Продаж схоже заблоковано",
  "Selling not blocked": "Продаж не заблоковано",
  "Facts about how the token is built and traded, each with its source. Ryntra gives no verdict.": "Факти про те, як токен влаштовано й як ним торгують, кожен зі своїм джерелом. Ryntra не виносить вироку.",
  "Link": "Посилання",
  "The creator's own addresses, as the token's catalogue lists them. Ryntra has not checked them.": "Власні адреси творця, як їх перелічує каталог токенів. Ryntra їх не перевіряла.",
  "The issuer's facts could not be read just now.": "Зараз не вдалося прочитати факти емітента.",
  "undated": "без дати",
  "Price against the issuer's mark": "Ціна проти оцінки емітента",
  "Price against the exchange": "Ціна проти біржі",
  "the price may drift from the exchange": "ціна може відхилятися від біржової",
  "Dividends": "Дивіденди",
  "Source": "Джерело",
  "Where the issuer does not offer it": "Де емітент його не пропонує",
  "Only for investors who pass the issuer's tests:": "Лише для інвесторів, що проходять перевірки емітента:",
  "Ryntra blocks no country: these are the issuer's own terms, so you can check your case.": "Ryntra не блокує жодної країни: це власні умови емітента, за якими можна перевірити свій випадок.",
  "The issuer's own terms for the token were not found; the list is its platform's.": "Власних умов емітента для токена не знайдено; список — його платформи.",
  "read": "прочитано",
  "Exchange price": "Біржова ціна",
  "Creator sold": "Творець продав",
  "On DEX": "На DEX",
  "Window": "Вікно",
  "Volume": "Обсяг",
  "Socials": "Соцмережі",
  "Minting right": "Право випуску",
  "Freezing right": "Право заморозки",
  "Jupiter verification": "Перевірка Jupiter",
  "Organic activity": "Органічна активність",
  "The creator holds": "Творець тримає",
  "Tokens the creator made": "Токенів створив творець",
  "Liquidity, 24h": "Ліквідність, 24 год",
  "Honeypot check": "Перевірка на «пастку»",
  "Whoever holds it can create new tokens and dilute every holder.": "Той, у кого воно є, може випустити нові токени й розмити частку кожного холдера.",
  "No one can create more of this token.": "Ніхто не може випустити більше цього токена.",
  "The issuer creates tokens against the shares it holds.": "Емітент випускає токени під акції, які тримає.",
  "Whoever holds it can freeze any holder's tokens.": "Той, у кого воно є, може заморозити токени будь-якого холдера.",
  "No one can freeze holders' tokens.": "Ніхто не може заморозити токени холдерів.",
  "The issuer can freeze an account, as its terms describe.": "Емітент може заморозити рахунок, як описано в його умовах.",
  "Jupiter's own checks marked this token as suspicious; it does not say why.": "Власні перевірки Jupiter позначили цей токен як підозрілий; чому — не кажуть.",
  "Jupiter checked that this address is the token it names.": "Jupiter перевірив, що ця адреса — саме той токен, який вона називає.",
  "Jupiter has not checked this address; a copy can borrow a name.": "Jupiter цю адресу не перевіряв; копія може позичити назву.",
  "How much of the trading Jupiter counts as real people rather than bots.": "Яку частку торгівлі Jupiter вважає справжніми людьми, а не ботами.",
  "The share of the supply in the wallet Jupiter names as the creator.": "Частка пропозиції в гаманці, який Jupiter називає творцем.",
  "How many tokens the creator's wallet has launched, as Jupiter counts them.": "Скільки токенів запустив гаманець творця, за підрахунком Jupiter.",
  "Money in the pools; the smaller it is, the more one sale moves the price.": "Гроші в пулах; що їх менше, то сильніше один продаж зрушує ціну.",
  "How the money in the pools changed over the last day.": "Як змінилися гроші в пулах за останню добу.",
  "Since the token's first pool.": "Від першого пулу токена.",
  "GeckoTerminal's check says the token may not let holders sell.": "Перевірка GeckoTerminal каже, що токен може не дати холдерам продати.",
  "GeckoTerminal's check found no block on selling.": "Перевірка GeckoTerminal не знайшла блокування продажу.",
  "No pool of this token traded in the last day.": "За останню добу жоден пул цього токена не торгувався.",
  "The catalogue does not list this token.": "Каталог не містить цього токена.",
  "SOL is held by every wallet on the network; its holders are not listed.": "SOL тримає кожен гаманець мережі; його холдерів не перелічуємо.",
  "Trading": "Торгується",
  "This wallet is marked as a test wallet and earns no rewards.": "Цей гаманець позначений як тестовий і не отримує винагород.",
  "Loading your rewards…": "Завантажуємо твої винагороди…",
  "The payout could not be checked right now. Refresh its status before trying again.": "Зараз не вдалося перевірити виплату. Онови її статус перед повторною спробою.",
  "The referral could not be updated. Try again.": "Не вдалося оновити запрошення. Спробуй ще раз.",
  "Provider fees and the Ryntra fee are already included in the quote. Source network fees are paid separately.": "Комісії провайдера та Ryntra вже враховані в котировці. Комісія вихідної мережі сплачується окремо.",
  "Token details could not be loaded.": "Не вдалося завантажити дані токена.",
  "Search is unavailable right now. Try again.": "Пошук зараз недоступний. Спробуй ще раз.",
  "Not enough for the network fee": "Недостатньо для комісії мережі",
  "Review the price impact": "Перевір вплив на ціну",
  "I understand the value lost in this quote.": "Я розумію втрату вартості за цією котировкою.",
  "Balance unavailable": "Баланс недоступний",
  "No tokens found": "Токенів не знайдено",
  /* Spot — one market terminal. */
  /* Spot — the coin as a stock has it: what it is, its position, its capitalisation. */
  "Less": "Менше",
  "Your position": "Твоя позиція",
  /* SOL-R2 — the exit plan's level named in its sale's Review. */
  "Exit plan": "План виходу",
  "This level's sale is already on its way or sold — see the exit plan.": "Продаж цього рівня вже в дорозі або завершений — дивись план виходу.",
  "This level's sale is open in another tab.": "Продаж цього рівня відкрито в іншій вкладці.",
  "Price is back below this level now.": "Ціна вже знову нижче цього рівня.",
  "Price is back above this level now.": "Ціна вже знову вище цього рівня.",
  "This order is not the exit plan's sale any more — nothing was signed. Ask for the level's sale again.": "Цей ордер уже не продаж за планом виходу — нічого не підписано. Попроси продаж рівня ще раз.",
  "The Solana network's own coin: every transaction's fee is paid in it.": "Рідна монета мережі Solana: нею платять комісію за кожну транзакцію.",
  "What the token says about itself could not be read just now.": "Що токен каже про себе, зараз не вдалося прочитати.",
  "The token's creator wrote no description.": "Творець токена не написав опису.",
  "From the creator · not checked": "Від творця · не перевірено",
  "The description and the links are set by the token's creator; Ryntra has not checked them.": "Опис і посилання задає творець токена; Ryntra їх не перевіряла.",
  "The chart shows": "Графік показує",
  "Market cap at today's circulating supply": "Капіталізація за нинішньої кількості в обігу",
  /* The spot chart on the core's chart (CH-17): the marks' words, the look and full screen. */
  "Large buy": "Велика купівля",
  "Large sale": "Великий продаж",
  "Chart look": "Вигляд графіка",
  "Candle colours": "Кольори свічок",
  "High contrast": "Контрастні",
  "Colour-blind": "Для дальтонізму",
  "Time labels": "Час на осі",
  "My time": "Мій час",
  "Full screen": "На весь екран",
  "Exit full screen": "Вийти з повного екрана",
  "Tokenized": "Токенізований",
  "Tokenized asset": "Токенізований актив",
  "Meme": "Мем",
  "Market": "Ринок",
  "Pick a market": "Обери ринок",
  "Remove from watchlist": "Прибрати зі списку спостереження",
  "Add to watchlist": "Додати до списку спостереження",
  "Price feed unavailable": "Ціна зараз недоступна",
  "Last known price": "Остання відома ціна",
  "min ago": "хв тому",
  "s ago": "с тому",
  "h ago": "год тому",
  "Liquidity": "Ліквідність",
  "Volume 24h": "Обсяг за 24 год",
  "1h": "1 год",
  "Market cap": "Капіталізація",
  "Holders": "Холдери",
  "Age": "Вік",
  "Top holders": "Топ-холдери",
  "Trades": "Угоди",
  "On-chain, 24/7": "У мережі, 24/7",
  "Website": "Сайт",
  "decimals": "знаків",
  "Verified by Jupiter": "Перевірено Jupiter",
  "Minting on": "Випуск увімкнено",
  "Freeze on": "Заморожування увімкнено",
  "The issuer can still mint more of this token.": "Емітент досі може випустити більше цього токена.",
  "The issuer can still freeze this token in any wallet.": "Емітент досі може заморозити цей токен у будь-якому гаманці.",
  "More actions": "Ще дії",
  "Listed today": "З'явився сьогодні",
  "Facts from Jupiter, not a verdict. «Risk» has each one with its source.": "Факти Jupiter, не вердикт. У «Ризику» — кожен із джерелом.",
  "Chart scale": "Шкала графіка",
  "Candle type": "Вигляд свічок",
  "Change over 24 hours": "Зміна за 24 години",
  "Your history shows this trade as done.": "Історія гаманця показує цю угоду виконаною.",
  "Your history shows this trade as failed.": "Історія гаманця показує, що ця угода не пройшла.",
  "The order is in «Orders».": "Ордер — в «Ордерах».",
  "Review needs refreshing": "Онови умови обміну",
  "Insufficient balance": "Недостатній баланс",
  "SOL's price is not read yet: pay in USDC or type the amount.": "Ціну SOL ще не прочитано: плати в USDC або впиши суму.",
  "Connect a wallet to buy in SOL by the dollar, or pay in USDC.": "Підключи гаманець, щоб купувати за SOL у доларах, або плати в USDC.",
  "Share a trade": "Поділитися угодою",
  "Caution": "Увага",
  "Flagged by Jupiter": "Позначено Jupiter як підозрілий",
  "The previous transaction can still reach the network. Wait for it to expire, then get a new quote.": "Попередня транзакція ще може потрапити до мережі. Дочекайся завершення її строку дії й отримай нову котировку.",
  "Includes Jupiter's share. Already included in the quote.": "Містить частку Jupiter. Уже враховано в котировці.",
  "Additional Jupiter fee": "Додаткова комісія Jupiter",
  "The network has seen this transaction, but its receipt is unavailable. Check the explorer.": "Мережа побачила транзакцію, але квитанція недоступна. Перевір її в експлорері.",
  "The outcome is not yet known. Keep checking this transaction; do not send another.": "Результат ще невідомий. Продовжуй перевіряти цю транзакцію; не надсилай іншу.",
  "The signed transaction failed its final check. Nothing was sent. Get a new quote.": "Підписана транзакція не пройшла фінальну перевірку. Нічого не надіслано. Отримай нову котировку.",
  "This route could not be confirmed. Nothing was sent. Get a new quote.": "Не вдалося підтвердити цей маршрут. Нічого не надіслано. Отримай нову котировку.",
  "Not verified by Jupiter": "Не перевірено Jupiter",
  "organic score": "органічний бал",
  "Authorities": "Повноваження",
  "revoked": "відкликано",
  "active": "активне",
  "Freeze": "Заморозка",
  "Market data": "Ринкові дані",
  "Jupiter": "Jupiter",
  "Chart": "Графік",
  "Links": "Посилання",
  "Create strategy": "Створити стратегію",
  "A tokenized asset: a Solana token issued against the underlying by its issuer, not a brokerage share. Trading is on-chain, 24/7, at the token's own price; the issuer's terms and eligibility rules apply.":
    "Токенізований актив: токен Solana, випущений емітентом під базовий актив, а не брокерська акція. Торгівля відбувається в мережі, 24/7, за власною ціною токена; діють умови емітента та його правила доступу.",
  "Not verified by the catalogue. Check the address before trading; a copy can borrow a name.":
    "Не верифіковано каталогом. Перевір адресу перед торгівлею: копія може позичити назву.",
  "Crypto": "Крипто",
  "Memes": "Меми",
  "Stocks / RWA": "Акції / RWA",
  "Stocks/RWA": "Акції/RWA",
  "Search markets": "Пошук ринків",
  "The market list is unavailable right now.": "Список ринків зараз недоступний.",
  "Search still works; try again in a moment.": "Пошук працює; спробуй ще раз за хвилину.",
  "Loading markets…": "Завантажуємо ринки…",
  "Loading market…": "Завантажуємо ринок…",
  "Nothing found.": "Нічого не знайдено.",
  "Try the ticker, the full name or the mint address.": "Спробуй тікер, повну назву або адресу mint.",
  "Your watchlist is empty.": "Твій список спостереження порожній.",
  "Star a market and it stays here.": "Познач ринок зірочкою — і він залишиться тут.",
  "No markets in this category right now.": "У цій категорії зараз немає ринків.",
  "Vol": "Обсяг",
  "Kept in this browser.": "Зберігається в цьому браузері.",
  "Waiting for wallet…": "Чекаємо на гаманець…",
  "Sync across devices": "Синхронізувати між пристроями",
  "Saved here; sync will retry.": "Збережено тут; синхронізацію буде повторено.",
  "Start over": "Почати заново",
  "Sign": "Підписати",
  "Preparing Review…": "Готуємо Review…",
  "Pricing…": "Рахуємо ціну…",
  "Order ticket": "Тікет ордера",
  "Finished with a note": "Завершено з приміткою",
  /* The settled answer in the person's words. */
  "Filled, with a note": "Виконано, з приміткою",
  "Nothing happened": "Нічого не сталося",
  "Not filled": "Не виконано",
  "Market buy": "Ринкова купівля",
  "Market sell": "Ринковий продаж",
  "for": "за",
  "received": "отримано",
  "Trade again": "Торгувати далі",
  "Less arrived than the reviewed minimum. The receipt keeps the reviewed and the settled figures side by side.":
    "Надійшло менше за мінімум із Review. Квитанція зберігає перевірені й фактичні цифри поруч.",
  "The chain's figures differ from the Review. The receipt keeps both.": "Цифри мережі відрізняються від Review. Квитанція зберігає обидві.",
  "The network rejected the transaction. Only the network fee was spent; what you were spending did not move.":
    "Мережа відхилила транзакцію. Витрачено лише мережеву комісію; те, що ти витрачаєш, не зрушило з місця.",
  "Landed and receipted earlier. The receipt holds the amounts.": "Виконано й підтверджено квитанцією раніше. Суми — у квитанції.",
  "Some balances could not be read.": "Частину балансів не вдалося прочитати.",
  /* Activity as a statement. */
  "Today": "Сьогодні",
  "Yesterday": "Вчора",
  "Open Spot": "Відкрити Спот",
  "You paid": "Сплачено",
  "Signed record": "Підписаний запис",
  /* Portfolio as a broker shows it. */
  "Other": "Інше",
  "Total value": "Загальна вартість",
  "today": "сьогодні",
  "Allocation": "Розподіл",
  "24h": "24 год",
  "Small and unpriced balances": "Дрібні й неоцінені баланси",
  "Hide small and unpriced balances": "Сховати дрібні й неоцінені баланси",
  "Tokenized by": "Токенізовано:",
  /* Tokenized stocks — the reference, the session and the units beside a stock
     in Spot and Portfolio. */
  "Reading the reference…": "Читаємо референс…",
  "Reference price": "Референсна ціна",
  "Deviation": "Відхилення",
  "Research": "Дослідити",
  "Underlying units": "Одиниць базового активу",
  "Per share": "За акцію",
  "Session": "Сесія",
  "Units": "Одиниці",
  "multiplier changing now": "множник змінюється зараз",
  "a new multiplier is pending": "очікується новий множник",
  "Reference source": "Джерело референсу",
  "Deviation from the reference": "Відхилення від референсу",
  "Stock context unavailable": "Контекст акції недоступний",
  "the issuer's terms apply": "діють умови емітента",
  "Paid": "Сплачено",
  "New order": "Новий ордер",
  "Side": "Сторона",
  "Spend": "Витратити",
  "Pay with": "Платити в",
  "You get": "Ти отримаєш",
  "estimate": "оцінка",
  "Receive in": "Отримати в",
  "Exact Review": "Точна «Перевірка»",
  "Review this order carefully.": "Уважно перевір цей ордер.",
  "This asset did not pass Ryntra's checks, so no order is offered for it.": "Цей актив не пройшов перевірки Ryntra, тому ордер для нього не пропонується.",
  "The quote expired; a fresh one is on its way.": "Котирування закінчилося; нове вже в дорозі.",
  "Chart source paused — showing the last read": "Джерело графіка на паузі — показано останнє зчитування",
  "Loading chart…": "Завантажуємо графік…",
  "No candles for this timeframe yet": "Для цього інтервалу ще немає свічок",
  "This Review's transaction could still reach the chain until its blockhash expires, so a new one cannot be prepared yet. Nothing was signed; it clears itself within about a minute.":
    "Транзакція цього Review ще може дійти до мережі, доки не мине її blockhash, тому нову поки не підготувати. Нічого не підписано; це минає само приблизно за хвилину.",
  "Chart unavailable": "Графік недоступний",
  "The chart is unavailable right now": "Графік зараз недоступний",
  "No pool prices this asset on the chart source.": "Жоден пул на джерелі графіків не дає ціни цього активу.",
  "This asset is only paired against assets whose dollar price cannot be trusted.": "Цей актив торгується лише в парах з активами, доларовій ціні яких не можна довіряти.",
  "No pool for this asset holds enough liquidity to be called its market.": "Жоден пул цього активу не має достатньої ліквідності, щоб називатися його ринком.",
  "No pool for this asset traded in the last day.": "Жоден пул цього активу не торгувався за останню добу.",
  "The newest candle is more than three days old.": "Найновішій свічці більше трьох днів.",
  "The pool's price does not agree with the market price of this asset.": "Ціна пулу не збігається з ринковою ціною цього активу.",
  "Buy and Sell still work from the live quote.": "Купівля і продаж працюють за живим котируванням.",
  "The price and the order ticket still work; the chart will return on its own.": "Ціна і тікет ордера працюють; графік повернеться сам.",
  "Trading state": "Стан торгівлі",
  "Holding": "Позиція",
  "Recent fills": "Останні виконання",
  "Connect a wallet to see what you hold and what you have traded here.": "Підключи гаманець, щоб бачити, що ти тримаєш і чим торгуєш тут.",
  "Balances are unavailable right now.": "Баланси зараз недоступні.",
  "Reading balances…": "Читаємо баланси…",
  "You do not hold": "Ти не тримаєш",
  "yet.": "поки що.",
  "Pick a market.": "Обери ринок.",
  "Of wallet": "Частка гаманця",
  "History is unavailable right now.": "Історія зараз недоступна.",
  "Reading fills…": "Читаємо виконання…",
  "No fills in": "Немає виконань у",
  "from this wallet yet.": "з цього гаманця поки що.",
  "Spot Buy": "Spot купівля",
  "Autoinvest": "Автоінвест",
  "Recurring buy": "Регулярна купівля",
  /* A launch's trade in History: its place, and Ryntra's part of the curve's or the pool's own fee. */
  "Launch": "Лаунч",
  "Ryntra's part of the fee": "Частка Ryntra в комісії",
  "Spot Sell": "Spot продаж",
  "Filled": "Виконано",
  "In flight": "У дорозі",

  /* Solana swap failures, named rather than collapsed. */
  "The provider priced this and would not build it — usually the wallet does not cover the amount plus its fee.":
    "Провайдер порахував ціну, але не став будувати транзакцію — зазвичай це означає, що гаманця не вистачає на суму разом з комісією.",
  "The swap provider could not be reached just now. Nothing was sent.": "Зараз не вдалося зв'язатися з провайдером обміну. Нічого не відправлено.",
  "The swap provider refused this request. Nothing was sent.": "Провайдер обміну відхилив цей запит. Нічого не відправлено.",
  "One of these tokens could not be checked, so no swap was offered for it.": "Один із цих токенів не вдалося перевірити, тому обмін для нього не пропонувався.",
  "This swap did not pass Ryntra's own checks, so it was not offered.": "Цей обмін не пройшов власні перевірки Ryntra, тому не був запропонований.",
  "The transaction that came back was not the one that was reviewed, so it was not sent.":
    "Транзакція, що повернулася, не збігається з переглянутою, тому її не відправлено.",
  "That took too long and was stopped. Nothing was sent — try again.": "Це тривало задовго і було зупинено. Нічого не відправлено — спробуй ще раз.",
  "Ryntra could not be reached. Nothing was sent.": "Не вдалося зв'язатися з Ryntra. Нічого не відправлено.",

  /* Cross-chain swap lane. */
  "No route for this pair right now. Nothing was sent — try another amount, or another asset.":
    "Зараз для цієї пари немає маршруту. Нічого не відправлено — спробуй іншу суму або інший актив.",
  "One of those addresses does not belong to its network.": "Одна з цих адрес не належить своїй мережі.",
  "The provider could not be reached. Nothing was sent.": "Не вдалося зв'язатися з провайдером. Нічого не відправлено.",
  "Connect the wallet you are sending from — this route is priced for the wallet that signs it.":
    "Підключи гаманець, з якого відправляєш: ціна цього маршруту рахується для гаманця, що його підписує.",
  "Connect the sending wallet and add the destination address — this route is priced for both.":
    "Підключи гаманець-відправник і вкажи адресу отримання: ціна цього маршруту рахується для обох.",
  "The price could not be read right now. Nothing was sent.": "Зараз не вдалося прочитати ціну. Нічого не відправлено.",
  "This did not complete. Whatever was sent, if anything, is read from the chain below — nothing is ever sent twice.":
    "Крок не завершився. Що саме пішло в мережу, якщо взагалі пішло, читається з мережі нижче — двічі нічого не відправляється.",
  "Swaps inside one Ethereum-style network are not offered yet": "Обміни всередині однієї мережі Ethereum-типу поки не пропонуються",
  "That network will not carry that asset": "Ця мережа не приймає цей актив",
  "Pick an asset on both sides": "Обери актив з обох боків",
  "This network's router refuses that asset outright, so no amount of it can be swapped here.":
    "Роутер цієї мережі прямо відмовляє в цьому активі, тож обміняти тут не вийде жодної його кількості.",
  "Choose a different network on one side. Swapping within one Ethereum-style network is not offered here.":
    "Обери іншу мережу з одного боку. Обмін усередині однієї мережі Ethereum-типу тут не пропонується.",
  /* Feedback in the cabinet. */
  "Feedback": "Відгук",
  "Question": "Запитання",
  "Idea": "Ідея",
  "Bug": "Помилка",
  "Security": "Безпека",
  "Ask anything about how Ryntra works.": "Запитай будь-що про те, як працює Ryntra.",
  "What would make the product better for you.": "Що зробило б продукт кращим для тебе.",
  "What you did, what you expected, what happened instead.": "Що ти робиш, чого чекаєш і що стається натомість.",
  "Marked and read first. Do not include seed phrases or keys.": "Позначається і читається першим. Не надсилай seed-фрази чи ключі.",
  "Write a little more — at least ten characters.": "Напиши трохи більше — щонайменше десять символів.",
  "Too many messages in a row. Try again in a few minutes.": "Забагато повідомлень поспіль. Спробуй за кілька хвилин.",
  "The message could not be saved right now. Try again in a moment.": "Зараз не вдалося зберегти повідомлення. Спробуй за хвилину.",
  "Received. Thank you.": "Отримано. Дякуємо.",
  "Reference": "Номер звернення",
  "We read every message. If you left a contact, the answer comes there.": "Ми читаємо кожне повідомлення. Якщо в повідомленні є контакт, відповідь прийде туди.",
  "Done": "Готово",
  "What is it about": "Про що це",
  "Your message": "Твоє повідомлення",
  "What happened, or what should change": "Що сталося або що варто змінити",
  "How to reach you": "Як з тобою зв'язатися",
  "Telegram @name or email": "Telegram @name або email",
  "Attached": "Додано",
  "wallet": "гаманець",
  /* Ryntra Points V1. */
  "Ryntra Points": "Ryntra Points",
  "Points are unavailable right now.": "Бали зараз недоступні.",
  "Level": "Рівень",
  "points": "балів",
  "Points reflect your genuine activity on Ryntra. They have no cash value and cannot be transferred.":
    "Бали відображають твою справжню активність у Ryntra. Вони не мають грошової вартості й не передаються.",
  "Your rank": "Твоє місце",
  "Not ranked yet": "Ще без місця",
  "Top level": "Найвищий рівень",
  "at": "від",
  "Lifetime eligible volume": "Зарахований обсяг за весь час",
  "Completed trades": "Завершених угод",
  "Active days": "Активних днів",
  "Your first settled trade starts your points.": "Перша завершена угода відкриє твої бали.",
  "An eligible trade can earn you more Points.": "Угода, що відповідає умовам, може принести тобі ще більше балів.",
  "How points work": "Як працюють бали",
  "Only a settled trade earns — a Swap, a Spot order or a Bridge that arrived. A quote, a review, a failed or cancelled operation earns nothing.":
    "Бали дає лише завершена угода — Swap, Spot-ордер або Bridge, що дійшов. Котирування, перевірка, невдала чи скасована операція не дають нічого.",
  "The first $1,000 you trade in a day earns 1 point per dollar; the rate then steps down at $1,000, $5,000 and $25,000, with a daily ceiling.":
    "Перші $1,000 обсягу за день дають 1 бал за долар; далі ставка знижується на $1,000, $5,000 і $25,000, і є денна стеля.",
  "An active day — $10 or more traded — adds 10 points. When someone you invited has their first active day, you receive 100.":
    "Активний день — $10 або більше обсягу — додає 10 балів. Коли запрошена тобою людина має свій перший активний день, ти отримуєш 100.",
  "Points have no cash value and cannot be transferred. Nothing about leverage, profit or loss changes them.":
    "Бали не мають грошової вартості й не передаються. Плече, прибуток чи збиток на них не впливають.",
  /* Ryntra Rewards V1. */
  /* The referral's Pending -> Confirmed flow. */
  "Referral invitation detected": "Знайдено реферальне запрошення",
  "Referral invitation": "Реферальне запрошення",
  "Invited by": "Запросив",
  "Referral code": "Реферальний код",
  "Referral code not found": "Реферальний код не знайдено",
  "Nothing is set until you confirm. Your inviter cannot be changed afterwards.": "Нічого не закріплюється, поки ти не підтвердиш. Після підтвердження змінити запрошувача вже не можна.",
  "Confirm inviter": "Підтвердити запрошувача",
  "Change code": "Змінити код",
  "Change referral code": "Змінити реферальний код",
  "Continue without referral": "Продовжити без реферала",
  "Have a code or link?": "Маєш код чи посилання?",
  "Enter code": "Ввести код",
  "Look up": "Знайти",
  "Use this code": "Взяти цей код",
  "Cancel": "Скасувати",
  "Your inviter": "Твій запрошувач",
  "Confirm this wallet first, then set your inviter.": "Спочатку підтверди гаманець, потім задай запрошувача.",
  "That is your own link.": "Це твоє власне посилання.",
  "This wallet already has an inviter.": "У цього гаманця вже є запрошувач.",
  "Those two wallets cannot invite each other.": "Ці два гаманці не можуть запрошувати один одного.",
  "Earned from friends": "Зароблено з друзів",
  "Earned from their friends": "Зароблено з друзів друзів",
  "Rewards have not started yet. Trades made before they do earn nothing.": "Винагороди ще не запущені. Операції, зроблені до запуску, нічого не дають.",
  "Open Rewards": "Відкрити Винагороди",
  "Rewards": "Винагороди",
  "Earn cashback when you trade, and more when people you invite trade.": "Отримуй кешбек за свої операції та більше — за операції запрошених тобою.",
  "Rewards could not be read right now.": "Зараз не вдалося прочитати винагороди.",
  "Connect a wallet to see what you have earned.": "Підключи гаманець, щоб побачити свої винагороди.",
  "Confirm this wallet to see your rewards.": "Підтверди цей гаманець, щоб побачити винагороди.",
  "Confirming…": "Підтверджуємо…",
  "Confirm wallet": "Підтвердити гаманець",
  "Pending": "Очікує",
  "Lifetime earned": "Зароблено за весь час",
  "Claim to wallet": "Отримати на гаманець",
  "Where your rewards came from": "Звідки твої винагороди",
  "Cashback": "Кешбек",
  "50% of the Ryntra fee on your trades": "50% комісії Ryntra з твоїх операцій",
  "Referral L1": "Від друзів",
  "10% from people you invited": "10% від запрошених тобою",
  "Referral L2": "Від друзів друзів",
  "5% from the people they invited": "5% від тих, кого запросили вони",
  "Invite a friend": "Запроси друга",
  "10% Level 1": "10% рівень 1",
  "5% Level 2": "5% рівень 2",
  "Your referral link": "Твоє реферальне посилання",
  "Copy": "Копіювати",
  "Friends": "Друзі",
  "Their friends": "Друзі друзів",
  "Recent rewards": "Останні винагороди",
  "Your rewards will appear here after your first trade.": "Твої винагороди з’являться тут після першої операції.",
  "Claimed": "Отримано",
  "How rewards work": "Як працюють винагороди",
  "50% cashback of the Ryntra service fee on your own trade.": "50% кешбеку від сервісної комісії Ryntra з твоєї власної операції.",
  "10% of the Ryntra service fee from someone you invited, and 5% from the people they invited.": "10% сервісної комісії Ryntra від запрошених тобою, і 5% — від тих, кого запросили вони.",
  "Claim from $1.00 USDC, to the wallet you are signed in with.": "Отримання від $1.00 USDC — на гаманець, яким ти входиш.",
  "Only fees actually collected after Rewards launched are eligible. Routes with no Ryntra fee earn nothing.": "Зараховуються лише комісії, фактично отримані після запуску Винагород. Маршрути без комісії Ryntra не дають нічого.",
  /* Rewards as a canvas. */
  "Available to claim": "Доступно до отримання",
  "Where it came from": "Звідки надійшло",
  "to Level": "до рівня",
  "Some rewards are still being priced.": "Частину винагород ще оцінюють.",
  "Pending rewards become claimable as the reward reserve covers them.": "Винагороди в очікуванні стають доступними, коли резерв винагород їх покриває.",
  "Make a trade": "Зробити угоду",
  "Eligible volume": "Зарахований обсяг",
  "To your wallet": "На твій гаманець",
  "Your trade": "Твоя угода",
  "A trade by someone you invited": "Угода запрошеної тобою людини",
  "A trade by someone they invited": "Угода того, кого запросили вони",
  "Grid": "Сітка ордерів (Grid)",
  "A strategy with defined price levels and a fixed budget.": "Стратегія з визначеними ціновими рівнями та фіксованим бюджетом.",
  "Grid remains a planned strategy pattern; the builder and execution adapter are not implemented.": "Grid залишається запланованим шаблоном стратегії; конструктор та адаптер виконання ще не реалізовані.",
  "The strategy direction is accepted; there is no Grid execution engine.": "Напрям стратегії прийнято; механізму виконання Grid ще немає.",
  "A grid specification, simulation, limits, execution provider and user-authorized lifecycle.": "Специфікація сітки, симуляція, ліміти, провайдер виконання та дії за дозволом користувача.",
  "Waits on the Grid builder, simulation and a separate execution acceptance.": "Чекає на конструктор Grid, симуляцію та окреме приймання виконання.",
  /* Unified Swap V1. */
  "The approval is still confirming. Nothing else was sent; press Review when it lands.": "Дозвіл ще підтверджується. Більше нічого не відправлено; натисни Перегляд, коли він завершиться.",
  "Swapping across chains": "Обмін між мережами…",
  "Add the destination address": "Додай адресу призначення",
  "Check the destination address": "Перевір адресу призначення",
  "is the most this wallet can swap — the rest stays for the network fee and the order account the provider opens on Solana.": "— це найбільше, що цей гаманець може обміняти: решта лишається на комісію мережі та на рахунок ордера, який провайдер відкриває в Solana.",
  "is the most this wallet can swap — the rest stays for gas.": "— це найбільше, що цей гаманець може обміняти: решта лишається на газ.",
  "is the most this wallet can swap.": "— це найбільше, що цей гаманець може обміняти.",
  "This wallet holds no ETH on Base, and gas is paid in ETH. Add a little ETH before swapping.": "У цьому гаманці немає ETH у Base, а газ оплачується в ETH. Додай трохи ETH перед обміном.",
  "This wallet holds no ETH for gas. Add a little ETH before swapping.": "У цьому гаманці немає ETH на газ. Додай трохи ETH перед обміном.",
  "Use my Base wallet": "Взяти з мого гаманця Base",
  "Use my Ethereum wallet": "Взяти з мого гаманця Ethereum",
  "No Ethereum-style wallet is available in this browser. Paste the address instead.": "У цьому браузері немає гаманця Ethereum. Встав адресу вручну.",
  "The wallet did not share an address.": "Гаманець не надав адресу.",
  "The wallet could not be read. Paste the address instead.": "Гаманець не вдалося прочитати. Встав адресу вручну.",
  "Use part of the balance": "Використати частину балансу",
  "Solana": "Solana",
  "Base": "Base",
  "Ethereum": "Ethereum",
  /* Robinhood Chain. A chain name is a proper noun and stays in both
     languages; the words around it do not. */
  "Robinhood Chain": "Robinhood Chain",
  "Add the address the money goes to — then you will see how much arrives.": "Вкажи адресу, куди прийдуть гроші, — і побачиш, скільки ти отримаєш.",
  "To your Robinhood Chain address": "На твою адресу в Robinhood Chain",
  "Robinhood Chain address": "Адреса в Robinhood Chain",
  "Use my Robinhood Chain wallet": "Взяти з мого гаманця Robinhood Chain",
  "Connect a Robinhood Chain wallet": "Підключити гаманець Robinhood Chain",
  /* Arc as a network money arrives on (B9, 15.10). */
  "Arc": "Arc",
  "To your Arc address": "На твою адресу в Arc",
  "Arc address": "Адреса в Arc",
  "Use my Arc wallet": "Взяти з мого гаманця Arc",
  "Connect an Arc wallet": "Підключити гаманець Arc",
  "Arc receives here, it does not send": "Arc тут лише отримує, не надсилає",
  "Money arrives on Arc from here. To move it out of Arc, use Ryntra on Arc.": "Звідси гроші лише надходять в Arc. Щоб вивести їх з Arc, скористайся Ryntra on Arc.",
  "Use my Solana wallet": "Взяти з мого гаманця Solana",
  "s": "с",
  "min": "хв",
  "The market moved. Look at the new figures before continuing.": "Ринок змінився. Переглянь нові цифри, перш ніж продовжити.",
  "Not available for this pair right now.": "Для цієї пари зараз недоступно.",
  "The provider is busy. Try again in a moment.": "Провайдер зайнятий. Спробуй за мить.",
  "Cross-chain swaps are not open yet.": "Крос-чейн обміни ще не відкриті.",
  "The Review expired. Nothing left your wallet; look at the figures again.": "Перегляд вичерпано. З гаманця нічого не пішло; подивися цифри ще раз.",
  "The Review expired before sending. Nothing left your wallet.": "Перегляд вичерпано до відправлення. З гаманця нічого не пішло.",
  "The wallet did not sign. Nothing left your wallet.": "Гаманець не підписав. З гаманця нічого не пішло.",
  "The approval did not go through. Nothing left your wallet.": "Дозвіл не пройшов. З гаманця нічого не пішло.",
  "Approval sent. Once it lands, press Review again to see the final figures.": "Дозвіл відправлено. Коли він підтвердиться, натисни Перегляд ще раз, щоб побачити остаточні цифри.",
  "This order would fail on chain as built, so it was not offered.": "Цей ордер зірвався б у мережі, тому його не запропоновано.",
  "The wallet returned a different transaction than the one reviewed, so it was not sent.": "Гаманець повернув іншу транзакцію, ніж переглянута, тому її не відправлено.",
  "The wallet rebuilt the transaction in a different format than the one reviewed, so it was not sent.":
    "Гаманець перебудував транзакцію в іншому форматі, ніж переглянута, тому її не відправлено.",
  "The wallet changed which address tables the transfer reads, so it was not sent.":
    "Гаманець змінив адресні таблиці, які читає переказ, тому його не відправлено.",
  "The wallet changed who has to sign, so it was not sent.":
    "Гаманець змінив, хто має підписати, тому транзакцію не відправлено.",
  "The wallet changed what one of the accounts is allowed to do, so it was not sent.":
    "Гаманець змінив права одного з акаунтів, тому транзакцію не відправлено.",
  "The wallet added a program that was not in the Review, so it was not sent.":
    "Гаманець додав програму, якої не було в Перегляді, тому транзакцію не відправлено.",
  "The wallet asked for a priority fee this product could not read, so nothing was sent.":
    "Гаманець запросив пріоритетну комісію, яку продукт не зміг прочитати, тому нічого не відправлено.",
  "The wallet added a safety check this product could not verify, so nothing was sent.":
    "Гаманець додав перевірку безпеки, яку продукт не зміг звірити, тому нічого не відправлено.",
  "The wallet changed what the transaction does, so it was not sent.":
    "Гаманець змінив те, що робить транзакція, тому її не відправлено.",
  "Nothing about the swap changed — the wallet refreshed the transaction while it waited. Press Review and confirm without pausing.":
    "В обміні нічого не змінилося — гаманець оновив транзакцію, поки вона чекала. Натисни Перегляд і підтверди без пауз.",
  "The network did not confirm whether the order was sent. Nothing is sent again; the status below is read from the chain.": "Мережа не підтвердила, чи ордер відправлено. Повторно нічого не відправляється; стан нижче читається з ланцюга.",
  "The order could not be prepared right now. Nothing left your wallet.": "Ордер зараз не вдалося підготувати. З гаманця нічого не пішло.",
  "This route is not offered from Solana right now.": "Цей маршрут із Solana зараз не пропонується.",
  "Ryntra could not be reached. Nothing left your wallet.": "Ryntra недосяжна. З гаманця нічого не пішло.",
  "Something did not go through. Nothing was sent twice.": "Щось не пройшло. Нічого не відправлено двічі.",
  "Sent from your wallet": "Відправлено з твого гаманця",
  "Provider is filling the order": "Провайдер виконує ордер",
  "Refunded on the source network": "Повернено в мережі відправлення",
  "Being read from the chain": "Читається з ланцюга",
  "Preparing": "Підготовка",
  "What you receive": "Що ти отримаєш",
  "At least": "Щонайменше",
  "Provider fees": "Комісії провайдера",
  /* The same line, named costs rather than fees, because what it holds is
     the rail's whole charge and not one fee among them. */
  "Provider costs": "Витрати провайдера",
  "Time": "Час",
  "Quote age": "Вік котирування",
  "Approvals": "Дозволи",
  "Account rent on Solana": "Оренда рахунку на Solana",
  "Cross-chain swaps are not open yet. The figures are live; the button is not.": "Крос-чейн обміни ще не відкриті. Цифри живі; кнопка — ні.",
  "That is not a Solana address.": "Це не адреса Solana.",
  "That is not an Ethereum-style address.": "Це не адреса у форматі Ethereum.",
  "Network fee, at most": "Комісія мережі, не більше",
  /* Ryntra’s own fee — 0.50% on Jupiter, 0.25% on Relay — named after the
     company charging it and never folded into the provider's row. The rate
     per mechanism is `RYNTRA_SERVICE_FEE_POLICY`. */
  "Ryntra service fee": "Комісія Ryntra",
  /* A quote whose own figures disagreed with each other. Refused rather than
     shown, because a price nothing can fill is worse than no price. */
  "This price did not check out, so it was not offered. Try again in a moment.":
    "Ця ціна не збіглася сама з собою, тому її не запропоновано. Спробуй ще раз за мить.",
  "Wallet prompts": "Запитів гаманця",
  "Expected time": "Очікуваний час",
  "Destination": "Призначення",
  "Once sent, this cannot be undone from Ryntra.": "Після відправлення це не можна скасувати з Ryntra.",
  "If nobody fills the order by its deadline, the money returns on the source network — possibly as USDC or ETH rather than the asset you sent.": "Якщо ніхто не виконає ордер до дедлайну, кошти повернуться в мережі відправлення — можливо, як USDC або ETH, а не як відправлений актив.",
  "The USDC leg moves through Circle; the swap into the destination asset happens on arrival.": "Нога в USDC проходить через Circle; обмін у актив призначення відбувається після прибуття.",
  "Where this swap is": "Де цей обмін",
  "Filling": "Виконання",
  "Refunded": "Повернено",
  "Status": "Стан",
  "You sent": "Відправлено",
  "You received": "Отримано",
  "Refund": "Повернення",
  "Refund transaction": "Транзакція повернення",
  "New swap": "Новий обмін",
  "The order is read from the chain every few seconds. Nothing is sent again.": "Ордер читається з ланцюга кожні кілька секунд. Повторно нічого не відправляється.",
  "Connect a Solana wallet": "Підключити гаманець Solana",
  "Connect a Base wallet": "Підключити гаманець Base",
  "Connect an Ethereum wallet": "Підключити гаманець Ethereum",
  "Approve in wallet": "Дозволити в гаманці",
  "Approving…": "Дозвіл…",
  "Native coin": "Нативна монета",
  "Choose two different assets": "Обери два різні активи",
  "Swaps on Base and Ethereum are not offered yet": "Обміни на Base та Ethereum ще не пропонуються",
  "Not available for this pair": "Для цієї пари недоступно",
  /* Swap and Bridge became two pages on 2026-09-10, and these are the sentences
     that keep a person from walking into the wall between them. */
  "Funds on another network?": "Кошти в іншій мережі?",
  /* SOL-C13: Swap as simple as Spot — the pair beside the converter, «Поповнити» for an empty wallet, «Немає зв'язку». */
  "Swap one asset for another inside Solana at Jupiter's best route. Review shows every cost before your wallet signs.":
    "Обмін одного активу на інший у Solana найкращим маршрутом Jupiter. Перевірка перед підписом гаманця показує всі витрати.",
  "The pair": "Пара",
  "About": "Про актив",
  "Other sections": "Інші розділи",
  "Account reserve, returned when the account closes": "Резерв рахунку — повертається, коли рахунок закривають",
  "Chart and limit orders": "Графік і лімітні ордери",
  "No connection": "Немає зв'язку",
  "No connection. The price and the quote come back when it does.": "Немає зв'язку. Ціна й котирування повернуться разом із ним.",
  "Top up SOL": "Поповнити SOL",
  "Top up USDC": "Поповнити USDC",
  "Jupiter's share is part of the Ryntra fee above.": "Частка Jupiter — у рядку «Ryntra» вище.",
  /* The mark on a quote that has outlived its 60 s and is no longer an offer.
     `Expired` and `Refreshing…` were already in this catalogue — reused rather
     than restated, so one English word never has two Ukrainian answers. */
  "Try again shortly": "Спробуй за мить",
  "stays for the network fee": "лишається на комісію мережі",
  "This route now asks for more wallet approvals than it stated, so nothing was sent.":
    "Цей маршрут тепер просить більше підтверджень у гаманці, ніж заявляв, тож нічого не відправлено.",
  "Not carrying right now": "Зараз не везе",
  /* The four networks added on 2026-09-10. The names are proper nouns and
     stay as they are; everything wrapped around them is translated. */
  "Arbitrum": "Arbitrum",
  "To your Arbitrum address": "На твою адресу Arbitrum",
  "Arbitrum address": "Адреса Arbitrum",
  "Use my Arbitrum wallet": "Взяти з мого гаманця Arbitrum",
  "Connect an Arbitrum wallet": "Підключити гаманець Arbitrum",
  "Optimism": "Optimism",
  "To your Optimism address": "На твою адресу Optimism",
  "Optimism address": "Адреса Optimism",
  "Use my Optimism wallet": "Взяти з мого гаманця Optimism",
  "Connect an Optimism wallet": "Підключити гаманець Optimism",
  "Polygon": "Polygon",
  "To your Polygon address": "На твою адресу Polygon",
  "Polygon address": "Адреса Polygon",
  "Use my Polygon wallet": "Взяти з мого гаманця Polygon",
  "Connect a Polygon wallet": "Підключити гаманець Polygon",
  "BNB Chain": "BNB Chain",
  "To your BNB Chain address": "На твою адресу BNB Chain",
  "BNB Chain address": "Адреса BNB Chain",
  "Use my BNB Chain wallet": "Взяти з мого гаманця BNB Chain",
  "Connect a BNB Chain wallet": "Підключити гаманець BNB Chain",
  /* The one-shot correction, and the refusal that no amount can fix. */
  "Maximum updated to leave": "Максимум оновлено, лишається",
  "for network fees.": "на комісію мережі.",
  "The amount was lowered so the network fee is covered. Press Review again.":
    "Суму зменшено, щоб покрити комісію мережі. Натисни «Переглянути» ще раз.",
  "There is not enough": "Недостатньо",
  "in this wallet to pay the network fee. Nothing was sent.":
    "у цьому гаманці, щоб сплатити комісію мережі. Нічого не відправлено.",
  "This needs about": "Потрібно приблизно",
  "for the network fee, and the wallet has less. Nothing was sent.":
    "на комісію мережі, а в гаманці менше. Нічого не відправлено.",
  "Bring funds to Solana instead": "Натомість завести кошти в Solana",
  "Need to move funds out of Solana?": "Потрібно вивести кошти з Solana?",
  "Connect a Solana wallet to get an address for USDC from another network.": "Підключи гаманець Solana — і отримаєш адресу для USDC з іншої мережі.",
  "Bring them to Solana": "Перенести їх у Solana",
  "Both sides are on Solana, so this is a swap, not a move between networks.":
    "Обидві сторони в Solana — це обмін, а не переказ між мережами.",
  "Swap it on Solana": "Обміняти в Solana",
  "This network's router refuses that asset outright, so no amount of it can be moved here.":
    "Маршрутизатор цієї мережі відмовляє цьому активу повністю, тож жодну його кількість тут не перенести.",
  "Choose a different network on one side: this page moves money between networks.":
    "Обери іншу мережу з одного боку: тут гроші переходять між мережами.",
  "Pick an asset on both sides.": "Обери актив з обох боків.",
  "No route for this pair right now. Nothing was sent.":
    "Зараз для цієї пари немає маршруту. Нічого не відправлено.",
  "Prices are being refreshed too often right now. The figures above stand — a new one follows in a moment.":
    "Зараз ціни оновлюються надто часто. Цифри вище лишаються чинними — нові будуть за мить.",
  "Swap on Solana": "Обмін на Solana",
  "USDC transfer": "Переказ USDC",
  "Cross-chain swap": "Крос-чейн обмін",
  "~1 min": "~1 хв",
  "15–20 min": "15–20 хв",
  "Fee": "Комісія",
  "~5 s": "~5 с",
  "Supported: USDC between Solana, Base and Ethereum; SOL ⇄ ETH; SOL ⇄ USDC on Base or Ethereum; any pair on Solana.": "Підтримується: USDC між Solana, Base та Ethereum; SOL ⇄ ETH; SOL ⇄ USDC на Base або Ethereum; будь-яка пара на Solana.",
  "Transfers run between Solana and another network. Base ⇄ Ethereum is not offered.": "Перекази йдуть між Solana та іншою мережею. Base ⇄ Ethereum не пропонується.",
  "Only USDC moves as the same asset between networks. ETH or SOL across networks is a cross-chain swap.": "Лише USDC переходить між мережами як той самий актив. ETH або SOL між мережами — це крос-чейн обмін.",
  "Pick a different asset on one side.": "Обери інший актив з одного боку.",
  "Two assets are offered on this network.": "У цій мережі пропонуються два активи.",
  "Swapped across chains": "Обміняно між мережами",
  "Across chains": "Між мережами",
  "Archive on Ryntra": "Архів у Ryntra",
  "Prove this wallet to keep receipts on Ryntra and read them from another device.": "Підтверди гаманець, щоб зберігати квитанції в Ryntra й читати їх з іншого пристрою.",
  "Prove wallet": "Підтвердити гаманець",
  "Signing…": "Підписання…",
  "Saving…": "Збереження…",
  "Save receipts to Ryntra": "Зберегти квитанції в Ryntra",
  "Show archived receipts": "Показати архівні квитанції",
  "Import to this device": "Імпортувати на цей пристрій",
  "Nothing archived yet": "В архіві ще нічого немає",
  "Everything archived is already on this device.": "Усе з архіву вже є на цьому пристрої.",
  "Saved": "Збережено",
  "Imported": "Імпортовано",
  "new": "нових",
  "receipts": "квитанцій",
  "The wallet refused.": "Гаманець відмовив.",
  "This wallet cannot sign a message.": "Цей гаманець не може підписати повідомлення.",
  "Archive unavailable right now.": "Архів зараз недоступний.",
  "No account was found at this address": "Акаунт за цією адресою не знайдено",
  "This address is not a token": "Ця адреса не належить токену",
  "This token could not be read": "Не вдалося прочитати цей токен",
  "Check the token address": "Перевір адресу токена",
  "Could not load this asset. Try again.": "Не вдалося завантажити актив. Спробуй ще раз.",
  "No supported token was found at this address": "Токен за цією адресою не знайдено",
  "The token's transfer rules could not be read": "Не вдалося прочитати правила цього токена",
  "Assets": "Активи",
  "Back to Terminal": "До Терміналу",
  "Current price": "Поточна ціна",
  "Asset details": "Відомості про актив",
  /* The door from a holding to the plan it came from. */
  "Under a plan": "За планом",
  plans: "планів",
  "What you planned, and what actually happened": "Що ти планував і що сталося насправді",
  "Additional issuance": "Додатковий випуск",
  "Possible": "Можливе",
  "Balance freezing": "Заморожування балансу",
  "Updated": "Оновлено",
  "Transfer rules": "Правила переказу",
  "Some transfer rules could not be read": "Частина правил цього токена не розпізнана",
  "Open in Solana Explorer": "Відкрити в Solana Explorer",
  "Your wallet did not complete this transfer, and Base shows activity on the account since it was prepared — so it is being read rather than sent again. Open Evidence and recovery below.":
    "Твій гаманець не завершив цей переказ, а Base показує активність на цьому акаунті після підготовки — тому його читають, а не надсилають знову. Відкрий «Докази й відновлення» нижче.",
  "Receiving is a second transaction you send on Solana and pay for in SOL, including a small deposit for the record that stops it being received twice. Its cost is read and shown at that step.":
    "Отримання — це друга транзакція, яку ти надсилаєш в Solana і оплачуєш в SOL, разом із невеликим депозитом за запис, який не дає отримати його двічі. Вартість читається й показується на тому кроці.",
  /* Bridge — the Ethereum lane and the network chooser, 2026-09-05. Every
     sentence that names a chain exists once per chain, as a whole sentence,
     so the noun is inflected here rather than glued in. */
  "Leaves Ethereum": "Залишає Ethereum",
  "Arrives on Ethereum": "Надходить на Ethereum",
  "You send from Ethereum": "Ти надсилаєш з Ethereum",
  "To your Ethereum address": "На твою адресу Ethereum",
  "Ethereum address": "Адреса Ethereum",
  "That is not an Ethereum address. A Solana address here would send the money nowhere.":
    "Це не адреса Ethereum. Адреса Solana тут відправила б кошти в нікуди.",
  "That is not a Solana address. An Ethereum address here would send the money nowhere.":
    "Це не адреса Solana. Адреса Ethereum тут відправила б кошти в нікуди.",
  "That is not a Solana address. An address for another network here would send the money nowhere.":
    "Це не адреса Solana. Адреса іншої мережі тут відправила б кошти в нікуди.",
  "That is more USDC than this wallet holds on Ethereum.":
    "Це більше USDC, ніж цей гаманець має на Ethereum.",
  "Connect your Ethereum wallet": "Підключити гаманець Ethereum",
  "Enter your Ethereum address": "Введи свою адресу Ethereum",
  "to Ethereum": "на Ethereum",
  "To Solana": "На Solana",
  "Receive on Ethereum": "Отримати на Ethereum",
  "Ethereum wallet": "Гаманець Ethereum",
  "Ethereum transaction": "Транзакція Ethereum",
  "Cost on Ethereum": "Вартість на Ethereum",
  "Receiving is a second transaction you send on Ethereum and pay for in ETH. Its gas is read at that step, so it is not part of the total above.":
    "Отримання — це друга транзакція, яку ти надсилаєш в Ethereum і оплачуєш в ETH. Її газ читається на тому кроці, тому він не входить у суму вище.",
  "Standard speed settles when the sending chain does. Receiving on Ethereum is a second, separate step you take yourself.":
    "Стандартна швидкість завершується разом із мережею-відправником. Отримання на Ethereum — другий, окремий крок, який ти робиш власноруч.",
  "Your wallet will open on Ethereum for the last step. Anyone holding this transfer's message can complete it, which is why it is not stuck if you stop here.":
    "Для останнього кроку твій гаманець відкриється на Ethereum. Завершити цей переказ може будь-хто, у кого є його повідомлення — тому він не зависає, якщо ти зупинишся тут.",
  "The permission has not appeared on Ethereum yet. Nothing was sent — check your wallet and try the review again.":
    "Дозвіл ще не з'явився на Ethereum. Нічого не надіслано — перевір гаманець і повернися до перевірки.",
  "Your wallet did not complete this transfer, and Ethereum shows activity on the account since it was prepared — so it is being read rather than sent again. Open Evidence and recovery below.":
    "Твій гаманець не завершив цей переказ, а Ethereum показує активність на цьому акаунті після підготовки — тому його читають, а не надсилають знову. Відкрий «Докази й відновлення» нижче.",
  "The transfer did not go through on Ethereum and nothing left your wallet. You can prepare it again.":
    "Переказ не пройшов на Ethereum, і з твого гаманця нічого не вийшло. Ти можеш підготувати його знову.",
  "Not open yet": "Ще не відкрито",
  "No route": "Немає маршруту",
  "USDC only. ETH and SOL would change asset on the way — that is a swap, not offered yet.":
    "Лише USDC. ETH і SOL дорогою змінили б актив — це обмін, який ще не пропонується.",
  "Bridging with Ethereum is not open yet. Nothing was sent.": "Брідж із Ethereum ще не відкрито. Нічого не надіслано.",
  "Bridging with this network is not open yet. Nothing was sent.": "Брідж із цією мережею ще не відкрито. Нічого не надіслано.",
  "Bridging is paused right now.": "Брідж зараз на паузі.",
  "Ethereum opens after its first transfer is verified on both chains.":
    "Ethereum відкриється після перевірки першого переказу в обох мережах.",
  "This network opens after its first transfer is verified on both chains.":
    "Ця мережа відкриється після перевірки першого переказу в обох мережах.",
  "Robinhood Chain has no USDC route — only a swap into another token, not offered here.":
    "Robinhood Chain не має маршруту USDC — лише обмін в інший токен, який тут не пропонується.",
  "Robinhood Chain has no USDC route. Its money is USDG, which Swap reaches as a swap between networks.":
    "Robinhood Chain не має маршруту USDC. Її гроші — USDG, і Обмін дістає їх обміном між мережами.",
  "This network has no USDC route.": "Ця мережа не має маршруту USDC.",
  "If nobody fills the order, the deposit is refunded on the source network. There is no fixed deadline for that.":
    "Якщо ордер ніхто не виконає, депозит повернеться у вихідній мережі. Фіксованого строку для цього немає.",
  "The money arrived on Solana.": "Гроші прийшли на Solana.",
  "The money arrived on Ethereum.": "Гроші прийшли на Ethereum.",
  "Solana has accepted this transfer — the message is spent, so the money is there. The transaction that did it was not found in the range read, because anyone may relay it. Read the recipient's balance on Solana.":
    "Solana прийняла цей переказ — повідомлення витрачено, отже гроші там. Транзакцію, яка це зробила, не знайдено в прочитаному діапазоні, бо відправити її міг будь-хто. Прочитай баланс отримувача на Solana.",
  "Ethereum has accepted this transfer — the message is spent, so the money is there. The transaction that did it was not found in the range read, because anyone may relay it. Widen the search or read the recipient's balance on Ethereum.":
    "Ethereum прийняв цей переказ — повідомлення витрачено, отже гроші там. Транзакцію, яка це зробила, не знайдено в прочитаному діапазоні, бо відправити її міг будь-хто. Розшир пошук або прочитай баланс отримувача на Ethereum.",
  "Solana has not received this transfer yet. Nothing is lost; the message is still waiting to be used.":
    "Solana ще не отримала цей переказ. Нічого не втрачено, повідомлення чекає на використання.",
  "Ethereum has not received this transfer yet. Nothing is lost; the message is still waiting to be used.":
    "Ethereum ще не отримав цей переказ. Нічого не втрачено, повідомлення чекає на використання.",
  "Ethereum could not be read just now. Nothing changed on either chain — this is a read, and it can be repeated.":
    "Ethereum зараз не вдалося прочитати. В обох мережах нічого не змінилось — це читання, його можна повторити.",
  "The answer from Solana could not be understood, so nothing is claimed about where the money is. Try the read again.":
    "Відповідь Solana не вдалося зрозуміти, тому про місцезнаходження грошей нічого не стверджується. Спробуй прочитати ще раз.",
  "The answer from Ethereum could not be understood, so nothing is claimed about where the money is. Try the read again.":
    "Відповідь Ethereum не вдалося зрозуміти, тому про місцезнаходження грошей нічого не стверджується. Спробуй прочитати ще раз.",
  "Solana returned a state this page does not recognise, so nothing is claimed about where the money is.":
    "Solana повернула стан, якого ця сторінка не знає, тому про місцезнаходження грошей нічого не стверджується.",
  "Ethereum returned a state this page does not recognise, so nothing is claimed about where the money is.":
    "Ethereum повернув стан, якого ця сторінка не знає, тому про місцезнаходження грошей нічого не стверджується.",
  "The transaction was sent to Base. Reading it now.": "Транзакцію надіслано в Base. Читаємо її зараз.",
  "The transaction was sent to Ethereum. Reading it now.": "Транзакцію надіслано в Ethereum. Читаємо її зараз.",
  "Your USDC has left Base and Circle is signing for it.": "Твої USDC залишили Base, і Circle підписує їх.",
  "Your USDC has left Ethereum and Circle is signing for it.": "Твої USDC залишили Ethereum, і Circle підписує їх.",
  "Circle has signed. The last step is to receive it on Solana.": "Circle підписав. Останній крок — отримати кошти на Solana.",
  "Circle has signed. The last step is to receive it on Ethereum.": "Circle підписав. Останній крок — отримати кошти на Ethereum.",
  "Something was interrupted. Reading Base, then Circle, then Solana — in that order.":
    "Щось перервалось. Читаємо Base, потім Circle, потім Solana — саме в такому порядку.",
  "Something was interrupted. Reading Ethereum, then Circle, then Solana — in that order.":
    "Щось перервалось. Читаємо Ethereum, потім Circle, потім Solana — саме в такому порядку.",
  "Something was interrupted. Reading Solana, then Circle, then Ethereum — in that order.":
    "Щось перервалось. Читаємо Solana, потім Circle, потім Ethereum — саме в такому порядку.",
  "The transaction on Solana was sent. Reading both chains now.": "Транзакцію на Solana надіслано. Читаємо обидва ланцюги.",
  "The transaction on Ethereum was sent. Reading both chains now.": "Транзакцію на Ethereum надіслано. Читаємо обидва ланцюги.",
  "The money arrived on Solana. Writing your receipt.": "Кошти надійшли на Solana. Записуємо твою квитанцію.",
  "The money arrived on Ethereum. Writing your receipt.": "Кошти надійшли на Ethereum. Записуємо твою квитанцію.",
  "Circle has the transaction and is waiting for Base to settle it.": "Circle має транзакцію й чекає, поки Base її завершить.",
  "Circle has the transaction and is waiting for Ethereum to settle it.": "Circle має транзакцію й чекає, поки Ethereum її завершить.",
  "Circle has signed. You can receive it on Solana.": "Circle підписав. Ти можеш отримати кошти на Solana.",
  "Circle has signed. You can receive it on Ethereum.": "Circle підписав. Ти можеш отримати кошти на Ethereum.",
  /* Bridge — the reverse lane, and everything the card had to learn to say
     about two directions rather than one. */
  "Leaves Base": "Залишає Base",
  "Arrives on Solana": "Надходить на Solana",
  "You send from Solana": "Ти надсилаєш з Solana",
  "You send from Base": "Ти надсилаєш з Base",
  "To your Solana address": "На твою адресу Solana",
  "Solana address": "Адреса Solana",
  "That is not a Solana address. A Base address here would send the money nowhere.":
    "Це не адреса Solana. Адреса Base тут відправила б кошти в нікуди.",
  "Enter your Solana address": "Введи свою адресу Solana",
  "Change direction": "Змінити напрямок",
  "MAX": "МАКС",
  "You hold": "У тебе є",
  "Connect the sending wallet to see what you hold.":
    "Підключи гаманець-відправник, щоб побачити свій баланс.",
  "That is more USDC than this wallet holds on Solana.":
    "Це більше USDC, ніж цей гаманець має на Solana.",
  "That is more USDC than this wallet holds on Base.":
    "Це більше USDC, ніж цей гаманець має на Base.",
  "More than you hold": "Більше, ніж у тебе є",
  "Smallest": "Найменша сума",
  "Largest": "Найбільша сума",
  "Fast allowance at Circle": "Ліміт Fast у Circle",
  "Connect your Base wallet": "Підключити гаманець Base",
  "Connect your Solana wallet to receive this transfer.":
    "Підключи гаманець Solana, щоб отримати цей переказ.",
  "Base wallet": "Гаманець Base",
  "Receiving USDC account": "USDC-акаунт отримувача",
  "This wallet has no USDC account yet. One is created in the same step that receives your transfer, and its small deposit is shown before you sign.":
    "У цього гаманця ще немає USDC-акаунта. Його буде створено тим самим кроком, який отримує твій переказ, і його невеликий депозит буде показано до підпису.",
  "Wallet approvals": "Підтверджень у гаманці",
  "Circle's permission": "Дозвіл для Circle",
  "Allow Circle to move": "Дозволити Circle перемістити",
  "Waiting for the permission to appear…": "Чекаємо, поки дозвіл з'явиться…",
  "The permission has not appeared on Base yet. Nothing was sent — check your wallet and try the review again.":
    "Дозвіл ще не з'явився на Base. Нічого не надіслано — перевір гаманець і повернися до перевірки.",
  "The transfer did not go through on Base and nothing left your wallet. You can prepare it again.":
    "Переказ не пройшов на Base, і з твого гаманця нічого не вийшло. Ти можеш підготувати його знову.",
  "The last step is not ready yet. Your money is safe and this can be retried.":
    "Останній крок ще не готовий. Твої кошти в безпеці, спробу можна повторити.",
  "Solana could not be read just now. Nothing changed on either chain — this is a read, and it can be repeated.":
    "Solana зараз не вдалося прочитати. У жодній мережі нічого не змінилося — це читання, і його можна повторити.",
  "to Base": "на Base",
  "to Solana": "на Solana",
  "to Robinhood Chain": "на Robinhood Chain",
  "Receive on Solana": "Отримати на Solana",
  "Cost on Solana": "Витрати на Solana",
  "and Circle signs before the sending chain finalises, so it arrives sooner. It still takes minutes, and Circle can refuse it once the allowance is spent.":
    "і Circle підписує ще до фіналізації мережі-відправника, тож переказ надходить раніше. Це все одно займає хвилини, і Circle може відмовити, коли ліміт вичерпано.",
  "and Circle signs once the sending chain finalises.":
    "і Circle підписує після фіналізації мережі-відправника.",
  "This will open your wallet twice: once to let Circle move exactly this amount, and once to send it. The permission is for this amount only, never for your whole balance.":
    "Гаманець відкриється двічі: один раз — щоб дозволити Circle перемістити саме цю суму, і один раз — щоб надіслати її. Дозвіл стосується лише цієї суми й ніколи не поширюється на весь твій баланс.",
  "This will open your wallet once. Circle already has permission to move this much USDC from this wallet.":
    "Гаманець відкриється один раз. Circle уже має дозвіл перемістити стільки USDC із цього гаманця.",
  "Your USDC lands in the USDC account your Solana wallet owns. If it does not have one yet, it is created in the same step that receives the transfer.":
    "Твої USDC надходять на USDC-акаунт, яким володіє твій гаманець Solana. Якщо його ще немає, його буде створено тим самим кроком, який отримує переказ.",
  "Standard speed settles when the sending chain does. Receiving on Base is a second, separate step you take yourself.":
    "Стандартна швидкість завершується разом із мережею-відправником. Отримання на Base — другий, окремий крок, який ти робиш власноруч.",
  "Standard speed settles when the sending chain does. Receiving on Solana is a second, separate step you take yourself.":
    "Стандартна швидкість завершується разом із мережею-відправником. Отримання на Solana — другий, окремий крок, який ти робиш власноруч.",
  "Your wallet will open on Solana for the last step. Anyone holding this transfer's message can complete it, which is why it is not stuck if you stop here.":
    "Для останнього кроку твій гаманець відкриється на Solana. Завершити цей переказ може будь-хто, у кого є його повідомлення — тому він не зависає, якщо ти зупинишся тут.",
  /* Bridge — one transfer between two chains. */
  "Leaves Solana": "Залишає Solana",
  "Circle signs": "Circle підписує",
  "Arrives on Base": "Надходить на Base",
  "Checked both sides": "Перевірено з двох боків",
  "Solana to Base": "Solana → Base",
  "Where this transfer is": "Де зараз цей переказ",
  "From your Solana wallet": "З твого гаманця Solana",
  "To your Base address": "На твою адресу Base",
  "Base address": "Адреса Base",
  "That is not a Base address. A Solana address here would send the money nowhere.":
    "Це не адреса Base. Адреса Solana тут відправила б кошти в нікуди.",
  "Transfer fee": "Комісія переказу",
  "Refundable deposit": "Поворотний депозит",
  "Signing opens your wallet once. A second signature happens here in this tab, from a one-time key made for this transfer — it can create the message account and can never move money.":
    "Підпис відкриє твій гаманець один раз. Другий підпис відбувається тут, у цій вкладці, одноразовим ключем, створеним саме для цього переказу — він може створити акаунт повідомлення й ніколи не може рухати кошти.",
  "The deposit comes back to you, and not before five days.":
    "Депозит повертається тобі, і не раніше ніж через п'ять днів.",
  "Standard speed settles when Solana does. Receiving on Base is a second, separate step you take yourself.":
    "Стандартна швидкість завершується разом із Solana. Отримання на Base — другий, окремий крок, який ти робиш власноруч.",
  "On its way": "У дорозі",
  "Ready to receive": "Готово до отримання",
  "Your wallet will open on Base for the last step. Anyone holding this transfer's message can complete it, which is why it is not stuck if you stop here.":
    "Для останнього кроку твій гаманець відкриється на Base. Завершити цей переказ може будь-хто, у кого є його повідомлення — тому він не зависає, якщо ти зупинишся тут.",
  "Arrived": "Надійшло",
  "Evidence and recovery": "Докази й відновлення",
  "Solana wallet": "Гаманець Solana",
  "Circle programme on Solana": "Програма Circle на Solana",
  "Transfer reference": "Ідентифікатор переказу",
  "Read by": "Прочитано через",
  "Solana transaction": "Транзакція Solana",
  "Base transaction": "Транзакція Base",
  "Both sides agree": "Обидва боки збігаються",
  "Receipt checked": "Квитанцію перевірено",
  "This transfer was already under way when you came back. Nothing was started again — the card picked it up where it stood.":
    "Цей переказ уже тривав до твого повернення. Нічого не починалося заново — картка підхопила його там, де він стояв.",
  "The transaction lives about 30 seconds, so this review was rebuilt against the current network. The transfer is the same — check it once more and confirm.":
    "Транзакція живе близько 30 секунд, тож цей review зібрано наново за поточною мережею. Переказ той самий — перевір ще раз і підтверди.",
  "A difference was recorded": "Зафіксовано розбіжність",
  "Opening your wallet…": "Відкриваємо твій гаманець…",
  "Enter your Base address": "Введи свою адресу Base",
  "Preparing…": "Готуємо…",
  "Send 2 USDC to Base": "Надіслати 2 USDC на Base",
  "Not available": "Недоступно",
  "Waiting for your wallet…": "Чекаємо на твій гаманець…",
  "Check again": "Перевірити ще раз",
  "Waiting for Circle…": "Чекаємо на Circle…",
  "Receive on Base": "Отримати на Base",
  "Check both sides": "Перевірити обидва боки",
  "Finished": "Завершено",
  /* Bridge — what went wrong, said once, in a sentence. */
  "This transfer could not be prepared. Nothing was sent.":
    "Цей переказ не вдалося підготувати. Нічого не надіслано.",
  "The last step could not be prepared just now. Your money is safe and this can be retried.":
    "Останній крок зараз не вдалося підготувати. Твої кошти в безпеці, спробу можна повторити.",
  "This wallet holds less USDC than this transfer would send.":
    "На цьому гаманці менше USDC, ніж потребує цей переказ.",
  "This wallet holds too little SOL for the network fee and the one-time message account.":
    "На цьому гаманці замало SOL для мережевої комісії та одноразового акаунта повідомлення.",
  "Live Solana data, and what each token's issuer can still do to what you hold.": "Живі дані Solana — і що емітент кожного токена ще може зробити з тим, що ти тримаєш.",
  "What each issuer can still do to your balance": "Що емітент ще може зробити з твоїм балансом",
  "Token": "Токен",
  "Can create more": "Може випустити ще",
  "Can freeze your balance": "Може заморозити твій баланс",
  "Extra transfer rules": "Додаткові правила переказу",
  "Get a live price for any pair": "Дізнатися живу ціну для будь-якої пари",
  "A token with strings attached": "Токен із застереженнями",
  "PYUSD — the issuer can move or freeze your balance": "PYUSD — емітент може перемістити або заморозити твій баланс",
  "A token that charges you to send it": "Токен, який бере комісію за переказ",
  "BERN — you receive less than you send": "BERN — отримувач дістає менше, ніж ти надсилаєш",
  "Your address to be paid, or a request for an exact amount of an exact token.": "Твоя адреса для оплати або запит на точну суму конкретного токена.",
  "Two jobs on one card. The address, with a QR any Solana wallet can scan, is the one most people need. A payment request adds a token, an amount and a note, and carries a reference so this request can be told apart from any other for the same amount — which a wallet address alone cannot do.": "Дві задачі на одній картці. Адреса з QR-кодом, який зчитає будь-який гаманець Solana — це те, що потрібно більшості. Запит на оплату додає токен, суму й нотатку, і несе ідентифікатор, щоб цей запит можна було відрізнити від будь-якого іншого на ту саму суму — чого сама лише адреса гаманця не дозволяє.",
  "The address as a scannable code, and a payment request as a normal link — https://ryntra.io/pay/<id> — that opens in any browser with the amount, the token, what it is for, who is paid and until when, a code for phone wallets and Pay with wallet in the browser. Ryntra watches the request's own reference on chain and says Awaiting, Paid or Expired; a paid request appears in Activity. The payer signs with their own wallet; nothing here signs.": "Адреса як код для сканування і запит на оплату як звичайне посилання — https://ryntra.io/pay/<id>, — що відкривається в будь-якому браузері із сумою, токеном, призначенням, отримувачем і терміном дії, кодом для гаманця на телефоні та кнопкою «Оплатити гаманцем» у браузері. Ryntra стежить за власним ідентифікатором запиту в мережі й каже: очікує оплати, оплачено чи термін минув; оплачений запит з'являється в Операціях. Платник підписує власним гаманцем; тут нічого не підписується.",
  "A Payment Receipt for what somebody else sent you: Activity shows the received payment with its transaction, and the receipt model does not yet describe an incoming transfer.": "Квитанція про те, що тобі надіслав хтось інший: Операції показують отриманий платіж із його транзакцією, а модель квитанцій ще не описує вхідний переказ.",
  "Incoming observation and the Payment Receipt arrive with the wallet-scoped action ledger.": "Вхідне спостереження і квитанція про оплату прийдуть разом із журналом дій, прив'язаним до гаманця.",
  "Connect your wallet to show its address and accept payments.": "Підключи гаманець, щоб показати його адресу й приймати платежі.",
  "My address": "Моя адреса",
  "Request a payment": "Запит на оплату",
  "Your Solana address": "Твоя адреса Solana",
  "Anything sent to this address arrives in your wallet. Scanning works in any Solana wallet.": "Усе, що надіслано на цю адресу, потрапляє у твій гаманець. Сканування працює в будь-якому гаманці Solana.",
  "Scan to pay this address": "Скануй, щоб оплатити на цю адресу",
  "optional": "необов'язково",
  "What is it for": "За що",
  "The payer chooses the amount.": "Платник обирає суму.",
  "Copy link": "Копіювати посилання",
  "Share": "Поділитися",
  "Hide details": "Сховати деталі",
  "Payment link": "Посилання на оплату",
  "Token address": "Адреса токена",
  "Request identifier": "Ідентифікатор запиту",
  "Expires in": "Дійсне",
  "1 hour": "1 година",
  "24 hours": "24 години",
  "7 days": "7 днів",
  "30 days": "30 днів",
  "Create payment link": "Створити посилання на оплату",
  "Creating…": "Створюємо…",
  "Sign in with your wallet to create a payment link.": "Увійди через гаманець, щоб створити посилання на оплату.",
  "Confirm in wallet to create a link": "Підтвердь у гаманці, щоб створити посилання",
  "Sign in with wallet": "Увійти через гаманець",
  "Check your wallet…": "Перевір гаманець…",
  "The payment link could not be created.": "Не вдалося створити посилання на оплату.",
  "Copy payment link": "Копіювати посилання на оплату",
  "Scan to open this payment link": "Скануй, щоб відкрити посилання на оплату",
  "Send this link to the person who should pay. It opens in any browser, no app needed.": "Надішли це посилання тому, хто має заплатити. Воно відкривається в будь-якому браузері, без застосунку.",
  "New request": "Новий запит",
  "Wallet link": "Посилання для гаманця",
  "Valid until": "Дійсне до",
  "Received": "Отримано",
  "Receiving": "Отримуємо",
  "Open payment request": "Відкрити запит на оплату",
  "What this wallet owns, and what it is worth where a price exists.": "Що тримає цей гаманець і скільки це коштує там, де ціна відома.",
  "One list rather than a wall of widgets, because the question is 'what do I have'. Read live from the connected address across both token programs, priced from the token catalogue where the catalogue has a price. An asset nobody prices shows a dash and is counted separately from the total, never as zero.": "Один список замість стіни віджетів, бо питання одне: що в мене є. Читається наживо з підключеної адреси по обох токен-програмах, ціна береться з каталогу токенів там, де вона є. Актив без ціни показує риску й рахується окремо від суми, ніколи як нуль.",
  "Live balances for the connected wallet, native SOL and every non-zero SPL and Token-2022 account, with search, a value total and an explicit count of what could not be priced. An unreadable balance renders as unreadable rather than as an empty wallet.": "Живі баланси підключеного гаманця — нативний SOL і кожен ненульовий SPL та Token-2022 акаунт, — із пошуком, сумою вартості та явною кількістю того, що не вдалося оцінити. Непрочитаний баланс показується як непрочитаний, а не як порожній гаманець.",
  "Funds currently in motion through Bridge or Swap, and per-chain totals for a linked EVM wallet. Both wait on the wallet-scoped action ledger and on explicit signed wallet linking.": "Кошти, що зараз рухаються через Bridge або Swap, і суми по мережах для прив'язаного EVM-гаманця. І те, і те чекає на журнал дій за гаманцем і на явне підписане зв'язування гаманців.",
  "Funds in motion and multi-chain totals arrive with the wallet-scoped action ledger.": "Кошти в русі й суми по мережах прийдуть разом із журналом дій, прив'язаним до гаманця.",
  "Connect your wallet to see what it holds.": "Підключи гаманець, щоб побачити, що він тримає.",
  "Value": "Вартість",
  "plus": "плюс",
  "without a price": "без ціни",
  "Search": "Пошук",
  "Search your holdings": "Пошук по твоїх активах",
  "Refresh": "Оновити",
  "Some balances could not be read, so this list may be incomplete.": "Частину балансів не вдалося прочитати, тож цей список може бути неповним.",
  "Nothing here matches that.": "Нічого не збігається із цим запитом.",
  "Enter an amount greater than zero.": "Введи суму більшу за нуль.",
  "Choose a wallet above": "Обери гаманець вище",
  "This wallet holds no tokens yet.": "На цьому гаманці ще немає токенів.",
  "Balances could not be loaded just now. Try again in a moment.":
    "Баланси зараз не вдалося завантажити. Спробуй за мить.",
  "Too many attempts. Wait a minute.": "Забагато спроб. Зачекай хвилину.",
  "Sign-in is unavailable right now.": "Вхід зараз недоступний.",
  "Wallet changed. Start sign-in again.": "Гаманець змінився. Почни вхід знову.",
  "This wallet belongs to another Ryntra account. Sign out, then sign in with this wallet to open it.": "Цей гаманець належить іншому акаунту Ryntra. Вийди й увійди цим гаманцем, щоб відкрити його.",
  "Sign in to your account first, then link the wallet.": "Спершу увійди в акаунт, потім прив'яжи гаманець.",
  "That signature could not be verified.": "Цей підпис не вдалося перевірити.",
  "The request could not be completed.": "Запит не вдалося виконати.",
  "Sign-in can't be checked right now. Try again in a moment.": "Вхід зараз не вдається перевірити. Спробуй за мить.",
  "This site is not set up to sign swaps right now.": "Цей сайт зараз не налаштований підписувати обміни.",
  "This swap was checked and not offered for signing.": "Цей обмін перевірено і не запропоновано до підпису.",
  "This swap did not simulate cleanly, so it was not offered for signing.":
    "Цей обмін не пройшов симуляцію чисто, тому його не запропоновано до підпису.",
  "No route for this pair right now.": "Для цієї пари зараз немає маршруту.",
  "This wallet does not hold enough for this swap.": "На цьому гаманці недостатньо коштів для цього обміну.",
  "This amount cannot be swapped.": "Цю суму не можна обміняти.",
  "Too many requests just now. Try again in a moment.": "Забагато запитів. Спробуй за мить.",
  "This request was not accepted.": "Цей запит не прийнято.",
  "Not available right now": "Зараз недоступно",
  "Amount in USDC": "Сума в USDC",
  "USDC from your Solana wallet": "USDC з твого гаманця Solana",
  "Bridging is turned off right now.": "Переказ між мережами зараз вимкнено.",
  "Swapping is turned off right now.": "Обмін зараз вимкнено.",
  "This transfer needs a fresh one-time account. Try again.":
    "Цьому переказу потрібен новий одноразовий акаунт. Спробуй ще раз.",
  "Circle's fee for this route could not be read just now, so nothing can be quoted.":
    "Комісію Circle для цього маршруту зараз не вдалося прочитати, тому нічого не котирується.",
  "This wallet's USDC account could not be read.":
    "USDC-акаунт цього гаманця не вдалося прочитати.",
  "The network did not answer in time. Nothing was sent.":
    "Мережа не відповіла вчасно. Нічого не надіслано.",
  "The owner rules could not be read, so nothing may be prepared.":
    "Правила власника не вдалося прочитати, тому нічого не готується.",
  "Too many requests. Wait a moment and try again.":
    "Забагато запитів. Зачекай трохи й спробуй ще раз.",
  "This exact transfer has already been started. Open recovery below — it is never started twice.":
    "Саме цей переказ уже розпочато. Відкрий відновлення нижче — двічі він не починається ніколи.",
  "The transfer was sent and the answer was lost. Your money may already be moving; recovery below reads where it is.":
    "Переказ надіслано, а відповідь загубилася. Твої кошти вже можуть бути в русі; відновлення нижче читає, де вони.",
  "The transfer stopped before anything was sent. Nothing moved.":
    "Переказ зупинився до того, як щось було надіслано. Нічого не рухалось.",
  "This review is too old to send. Prepare it again.":
    "Цей перегляд застарів для надсилання. Підготуй його знову.",
  "This transfer is not permitted right now.": "Цей переказ зараз не дозволено.",
  "The review changed after it was signed. Prepare it again.":
    "Перегляд змінився після підписання. Підготуй його знову.",
  "Your wallet did not sign this transaction. Nothing was sent.":
    "Твій гаманець не підписав цю транзакцію. Нічого не надіслано.",
  "The one-time signature in this tab did not complete. Nothing was sent.":
    "Одноразовий підпис у цій вкладці не завершився. Нічого не надіслано.",
  "Only one network provider answered, so this transfer could not be checked twice. Nothing was sent.":
    "Відповів лише один мережевий провайдер, тож цей переказ не вдалося перевірити двічі. Нічого не надіслано.",
  "This request did not come from this site. Nothing was sent.":
    "Цей запит надійшов не з цього сайту. Нічого не надіслано.",
  "The network would not accept the transfer your wallet returned. Nothing was sent.":
    "Мережа не прийняла переказ, який повернув твій гаманець. Нічого не надіслано.",
  "This transfer did not go through. Nothing was sent.":
    "Цей переказ не пройшов. Нічого не надіслано.",
  "You declined in your wallet. Nothing was sent.":
    "Відхилено в гаманці. Нічого не надіслано.",
  "The wallet did not answer. Nothing was sent.": "Гаманець не відповів. Нічого не надіслано.",
  "Your wallet is locked. Unlock it and try again.":
    "Твій гаманець заблокований. Розблокуй його й спробуй ще раз.",
  "Your wallet could not complete this. Nothing was sent.":
    "Твій гаманець не зміг це завершити. Нічого не надіслано.",
  /* Bridge — where the money is. */
  "Nothing has been sent yet.": "Ще нічого не надіслано.",
  "Nothing moved. You can prepare this transfer again.":
    "Нічого не рухалось. Ти можеш підготувати цей переказ знову.",
  "The transaction was sent to Solana. Reading it now.":
    "Транзакцію надіслано в Solana. Читаємо її зараз.",
  "Your USDC has left Solana and Circle is signing for it.":
    "Твої USDC залишили Solana, і Circle підписує їх.",
  "Circle has signed. The last step is to receive it on Base.":
    "Circle підписав. Останній крок — отримати кошти на Base.",
  "Something was interrupted. Reading Solana, then Circle, then Base — in that order.":
    "Щось перервалось. Читаємо Solana, потім Circle, потім Base — саме в такому порядку.",
  "The transaction on Base was sent. Reading both chains now.":
    "Транзакцію на Base надіслано. Читаємо обидва ланцюги.",
  "The money arrived on Base. Writing your receipt.":
    "Кошти надійшли на Base. Записуємо твою квитанцію.",
  "Finished. Both sides were read and they agree.":
    "Завершено. Обидва боки прочитано, і вони збігаються.",
  "Reading where this transfer stands.": "Читаємо, на чому стоїть цей переказ.",
  "Circle has not seen the transaction yet. This is normal and it is still on its way.":
    "Circle ще не побачив транзакцію. Це нормально, вона все ще в дорозі.",
  "Circle has the transaction and is waiting for Solana to settle it.":
    "Circle має транзакцію й чекає, поки Solana її завершить.",
  "Circle has signed. You can receive it on Base.":
    "Circle підписав. Ти можеш отримати кошти на Base.",
  "Circle could not be reached just now. Your transfer is unaffected and this will retry.":
    "До Circle зараз не вдалося достукатись. На твій переказ це не впливає, спроба повториться.",
  "Not executed": "Не виконано",
  "Set on the exact order": "Встановлюється на точному ордері",
  "Default pair · not a recommendation": "Типова пара · не рекомендація",
  "The pair and amount, not this quote": "Пара й сума, а не це котирування",
  "Keyless lane · labelled degraded": "Лінія без ключа · позначено degraded",
  "Asset Passports": "Паспорти активів",
  "Pick a pair and an amount.": "Обери пару й суму.",
  "Start typing to search every mainnet asset.":
    "Почни вводити, щоб шукати серед усіх активів мейннету.",
  "Verified and Flagged are Jupiter's labels, not Ryntra's.":
    "Verified і Flagged — позначки Jupiter, не Ryntra.",
  "Provider-reported shares do not total 100%: these legs are sequential, so no bar is drawn.":
    "Частки від провайдера не дають 100%: ці ноги послідовні, тому смуга не малюється.",
  "Confirm in wallet": "Підтвердити в гаманці",
  "Your wallet returned different bytes. Nothing was submitted.":
    "Гаманець повернув інші байти. Нічого не надіслано.",
  "A signed attempt is unresolved. Recover it before a new order.":
    "Є непідтверджена підписана спроба. Віднови її перед новим ордером.",
  "The transaction was sent but never reached the chain, and the block it needed has passed. Nothing moved, and nothing can now. You can trade again.":
    "Транзакцію надіслали, але вона не потрапила в мережу, а потрібний їй блок уже минув. Нічого не переміщено й переміститися вже не може. Можна торгувати далі.",
  "The transaction was never sent and the block it needed has passed. Nothing moved. You can trade again.":
    "Транзакцію не надсилали, а потрібний їй блок уже минув. Нічого не переміщено. Можна торгувати далі.",
  /* One name for the work, «Між мережами» — never «Міст» (B18; the core's menu word). */
  "Bridge": "Між мережами",
  "Cross-chain": "Між мережами",
  "Between networks": "Між мережами",
  /* «Гроші» (B18): the name once, the side column, the chips under «Кому». */
  "One transfer on Solana: what leaves, where it goes and the network fee — all of it before your wallet signs.":
    "Один переказ у Solana: що йде, куди й плата мережі — усе це до підпису в гаманці.",
  "Paste": "Вставити",
  "Recent recipients": "Останні отримувачі",
  "Recent transfers": "Останні перекази",
  "Recent incoming": "Останні надходження",
  "Recent moves between networks": "Останні перекази між мережами",
  "Send only on the Solana network.": "Надсилай лише в мережі Solana.",
  "Connect a wallet — your Solana address and its code will be here.": "Підключи гаманець — тут буде твоя адреса Solana і її QR-код.",
  "Connect a wallet — then ask for an exact amount with a link anyone can pay.":
    "Підключи гаманець — і попроси точну суму посиланням, яке може оплатити будь-хто.",
  "Your Solana address to be paid at, and a link that asks for an exact amount — it opens in any browser.":
    "Твоя адреса Solana для оплати й посилання на точну суму — воно відкривається в будь-якому браузері.",
  "USDC from another network to your Solana wallet by an address, or from Solana to another network — signed by your Solana wallet.":
    "USDC з іншої мережі — у твій гаманець Solana за адресою; із Solana в іншу мережу — з підписом твого гаманця Solana.",
  "Transfer between networks": "Переказ між мережами",
  "Review bridge": "Перевірити переказ між мережами",
  "Mainnet · read only": "Мейннет · лише читання",
  "Mainnet · user-signed": "Мейннет · підпис користувача",
  "Mainnet · review required": "Мейннет · потрібна перевірка",
  "Workspace": "Робочий простір",
  "Overview": "Огляд",
  "Assets & Passport": "Активи й паспорт",
  "Markets": "Ринки",
  "Market overview": "Огляд ринку",
  "Market universes": "Ринкові добірки",
  /* The product's settled Ukrainian for this domain is `Портфель`, decided with
     the six domain names on 2026-09-04 and carried by `app/shell/domains.ts`.
     This table said `Портфоліо`, so the rail and the page it opened called the
     same place two different things. */
  "Portfolio": "Портфель",
  "Transfers": "Перекази",
  "Journal": "Журнал",
  "Spot": "Спот",
  "Perps": "Ф'ючерси",
  "Limit & DCA": "Лімітні ордери та DCA",
  "Watchlist": "Список спостереження",
  "Money": "Кошти",
  "Nothing is moving right now.": "Зараз нічого не рухається.",
  "Everything you send, swap or bridge shows here while it travels.": "Усе, що ти надсилаєш, обмінюєш чи переводиш, видно тут, поки воно в дорозі.",
  "Portfolio value": "Вартість портфеля",
  "Priced assets": "Активи з ціною",
  "No price": "Без ціни",
  "In motion": "У дорозі",
  "Recent": "Останні",
  "See all": "Усі",
  "Connect a wallet to see what you hold and what is moving.": "Підключи гаманець, щоб побачити, що ти тримаєш і що в дорозі.",
  /* Markets — the risk column, the price column and the trades a wallet made
     on this surface. `Обмін` is the settled Ukrainian for Swap, so the control
     that opens it says the same word the page it opens is called. */
  "Price": "Ціна",
  "Open Swap": "Відкрити Обмін",
  "Your trades": "Твої угоди",
  "You have not traded here yet.": "Тут ще немає твоїх угод.",
  "Connect a wallet to see the trades you have made here.": "Підключи гаманець, щоб побачити свої угоди тут.",
  /* Settings — a short system surface, not documentation about the
     architecture. The long sentences are the ones that used to be printed at
     rest as panel values; they are unchanged, and they now live in the hint
     beside the row each explains. */
  "Every read here is Solana mainnet, because that is where the real mints are and mainnet is the only network this product treats as a release target. A devnet endpoint stays configured as an internal regression fixture; a switch between the two would offer a choice that means nothing.": "Тут усе читається з Solana mainnet, бо саме там справжні мінти, і mainnet — єдина мережа, яку цей продукт вважає релізною. Devnet лишається налаштованим лише як внутрішня регресійна фікстура; перемикач між ними давав би вибір, який нічого не означає.",
  "What is read": "Що читається",
  "Balances, prices, mints and your own operations": "Баланси, ціни, мінти й твої операції",
  "If a read fails": "Якщо читання не вдалося",
  "How a read is bounded": "Які межі має читання",
  "Ten seconds per endpoint, the primary asked first and an independent operator answering when it does not, one bounded retry, and the answering host stamped on every read. A read that could not complete says so rather than showing you a zero.": "Десять секунд на вузол: спершу основний, а якщо він мовчить — незалежний оператор; одна обмежена повторна спроба, і кожне читання позначене тим, хто відповів. Читання, яке не завершилось, каже про це, а не показує нуль.",
  "It says so, and never shows a zero": "Каже про це і ніколи не показує нуль",
  "Appearance and layout": "Вигляд і розкладка",
  "In the top bar": "У верхній панелі",
  "Your wallet": "Твій гаманець",
  "What Ryntra never does": "Чого Ryntra не робить ніколи",
  "Holds none, requests none": "Не зберігає й не запитує",
  "Seed phrase": "Сід-фраза",
  "Never sees one, never asks": "Ніколи не бачить і не запитує",
  "The one named exception": "Єдиний названий виняток",
  "Your own wallet signs every transfer, and no Ryntra server holds a key. A CCTP bridge needs a second signature no wallet can give — Circle's message account has to sign for its own creation — so the page makes a key for that one transaction, in this browser only. It can move no money, it is sent nowhere, and it is discarded once the burn is submitted. A boundary with an unnamed exception is not a boundary.": "Кожен переказ підписує твій власний гаманець, і жоден сервер Ryntra не тримає ключа. Мосту CCTP потрібен другий підпис, якого не може дати жоден гаманець — акаунт повідомлення Circle мусить підписати власне створення — тому сторінка створює ключ для цієї однієї транзакції, лише в цьому браузері. Він не може перемістити кошти, нікуди не надсилається і зникає після подання burn. Межа з неназваним винятком — це не межа.",
  "Your wallet, one transaction at a time": "Твій гаманець, по одній транзакції",
  "What is kept about an action": "Що зберігається про дію",
  "What it did and what it cost, recorded against your wallet address — never a key, a seed phrase or signed bytes. That much is already public on the chain.": "Що вона зробила і скільки коштувала, записане за адресою твого гаманця — ніколи ключ, сід-фраза чи підписані байти. Це й так публічне в мережі.",
  "What an action did and cost": "Що дія зробила і скільки коштувала",
  "Nothing to sign up for": "Реєструватися нема куди",
  "Your data": "Твої дані",
  "Ryntra's access": "Доступ Ryntra",
  "What connecting a wallet allows": "Що дає підключення гаманця",
  "Connecting lets this workspace read public balances and ask your wallet to show you a transaction. Every signature is yours, given in your own wallet, one transaction at a time. No Ryntra server holds a key and none can move anything on your behalf.": "Підключення дозволяє читати публічні баланси й попросити твій гаманець показати тобі транзакцію. Кожен підпис — твій, зроблений у твоєму гаманці, по одній транзакції. Жоден сервер Ryntra не тримає ключа і не може нічого перемістити за тебе.",
  "Read, and ask you to sign": "Читати й просити тебе підписати",
  "Managed in": "Керується в",
  "Ryntra account": "Акаунт Ryntra",
  "Two separate principals": "Два окремі суб'єкти",
  "A Ryntra account and a Solana wallet are separate. Signing in does not authorize anything your wallet does, and connecting a wallet does not sign you in. The account exists for agents, policies and approvals.": "Акаунт Ryntra і гаманець Solana — окремі. Вхід не авторизує нічого, що робить твій гаманець, а підключення гаманця не виконує вхід. Акаунт існує для агентів, політик і погоджень.",
  "Separate from your wallet": "Окремо від гаманця",
  "Receipts in this browser": "Квитанцій у цьому браузері",
  "Kept where": "Де зберігаються",
  "What clearing site data removes": "Що видаляє очищення даних сайту",
  "Receipts are stored in this browser, so clearing site data clears them. The signed file you download is the copy that outlives it, and it verifies without trusting this site. What an action did is also recorded against your wallet address on our side, because that much is already public on the chain.": "Квитанції зберігаються в цьому браузері, тож очищення даних сайту стирає їх. Підписаний файл, який ти завантажуєш, — це копія, що переживе браузер, і вона перевіряється без довіри до цього сайту. Що зробила дія, також записано за адресою твого гаманця на нашому боці, бо це й так публічне в мережі.",
  "This browser": "Цей браузер",
  "All of them": "Усі",
  "Export your operations": "Експорт твоїх операцій",
  /* Activity — the one timeline of the whole product. `Операції` is the settled
     domain word and `Активність` is forbidden vocabulary, so the page carries
     the domain name and the panels inside it carry their own. */
  "Activity": "Історія",
  "Summary": "Підсумок",
  /* Portfolio — value, coverage and what has left but not yet arrived. */
  "Without a price": "Без ціни",
  "Moving to Solana": "Прямує в Solana",
  "Moving to Base": "Прямує в Base",
  "Moving between chains": "Прямує між мережами",
  "Swapping": "Обмінюється",
  "Sending": "Надсилається",
  /* Money — the domain around Send, Receive and Bridge. `Кошти` is the settled
     domain word; these are the panels every one of its three jobs carries. */
  "What you can move": "Що можна переказати",
  "Connect a wallet to see what you can move.": "Підключи гаманець, щоб побачити, що можна переказати.",
  "This wallet holds nothing to move yet.": "У цьому гаманці ще немає чого переказувати.",
  "You can move": "Доступно",
  "Held": "Усього",
  "Unnamed": "Без назви",
  "Your transfers": "Твої перекази",
  "Connect a wallet to see the transfers you have made.": "Підключи гаманець, щоб побачити свої перекази.",
  "You have not moved anything yet.": "Твоїх переказів ще немає.",
  "What": "Що",
  /* Swap — the panels beside the ticket. Jupiter's own claims are named as
     Jupiter's, because a bare "Verified" beside an asset would read as a
     Ryntra verdict on it, and this product does not make those. */
  "Listed price": "Ціна за списком",
  "Rate": "Курс",
  "Trade value": "Сума угоди",
  "Quote valid for": "Котирування дійсне ще",
  "Enter an amount to price this pair.": "Введи суму, щоб отримати ціну для цієї пари.",
  "Route and cost": "Маршрут і вартість",
  "Filled by": "Виконує",
  "Most you can lose to price movement": "Максимум втрат від руху ціни",
  "The route appears once this pair is priced.": "Маршрут з'явиться, коли пара отримає ціну.",
  "What these issuers can do": "Що можуть емітенти цих токенів",
  "Flagged on Jupiter's list": "Позначено у списку Jupiter",
  "Verified on Jupiter's list": "Підтверджено у списку Jupiter",
  "Not on Jupiter's verified list": "Немає у списку підтверджених Jupiter",
  "Sold": "Продано",
  "Bought": "Куплено",
  /* The loop's last step on the settled card of a purchase made under a plan. */
  "Ryntra watches your loss limit": "Ryntra стежить за межею збитку",
  "Open the plan": "Відкрити план",
  "State": "Стан",
  "When": "Коли",
  "Traded": "Обміняно",
  "Nothing has moved yet.": "Ще нічого не рухалось.",
  "Your first transfer appears here.": "Твій перший переказ з'явиться тут.",
  "Holdings": "Активи портфеля",

  "Check what happened": "Перевірити, що сталося",
  "Checking…": "Перевіряємо…",

  /* Corrected module copy: three modules named the action ledger as absent. */
  "Watched mints, and a resting summary of recent activity. History has its own page now; this screen does not yet carry a view of it.":
    "Відстежувані мінти й зведення нещодавніх дій у спокої. Історія тепер має власну сторінку; цей екран її огляду ще не показує.",
  "The watchlist waits on Phase B's retention decision. A summary of History on this screen is a separate piece of work.":
    "Список спостереження чекає на рішення про зберігання у фазі B. Зведення історії на цьому екрані — окрема задача.",
  "Per-chain totals for a linked EVM wallet. A Solana wallet and an EVM wallet are not one person because both are open in one browser, so this waits on each being signed for explicitly.":
    "Підсумки за мережами для прив'язаного EVM-гаманця. Гаманець Solana і гаманець EVM не є однією людиною через те, що обидва відкриті в одному браузері, тож це чекає на явний підпис кожного з них.",
  "Multi-chain totals wait on the wallet sign-in that proves ownership, and this repository has no Solana sign-in yet.":
    "Підсумки за кількома мережами чекають на вхід гаманцем, який доводить володіння, а входу для Solana в цьому репозиторії ще немає.",
  "Phase B — subscriptions, allowances and the wider payments business tools. The incoming-payment receipt waits on the receipt model naming an incoming transfer.":
    "Фаза B — підписки, ліміти й ширші бізнес-інструменти платежів. Квитанція про вхідний платіж чекає, доки модель квитанцій опише вхідний переказ.",
  "Live balances for the connected wallet, native SOL and every non-zero SPL and Token-2022 account, with search, a value total and an explicit count of what could not be priced. Money that has left and not yet settled is counted above the total rather than folded into it. An unreadable balance renders as unreadable rather than as an empty wallet.":
    "Живі баланси підключеного гаманця: нативний SOL і кожен ненульовий рахунок SPL та Token-2022, з пошуком, загальною вартістю і явною кількістю активів, які не вдалося оцінити. Кошти, які пішли й ще не завершились, показані над підсумком, а не приховані в ньому. Нечитабельний баланс показується як нечитабельний, а не як порожній гаманець.",

  /* The History module's registry fields. */
  "Every transfer this wallet made here, and where each one is right now.":
    "Кожен переказ, який зробив цей гаманець тут, і де він зараз.",
  "One list, keyed by the connected wallet rather than by the browser it was started in. A transfer that is still moving says so; one waiting on a step only this person can take says that instead, because telling somebody to wait for themselves is the worst thing this screen could do. State is read back from the lane that owns it on every load, so a row cannot age into a lie.":
    "Один список, прив'язаний до підключеного гаманця, а не до браузера, у якому все почалося. Переказ, який ще в русі, так і каже; той, що чекає на крок, який може зробити лише ця людина, каже саме це — бо сказати комусь чекати на самого себе було б найгіршим, що цей екран може зробити. Стан перечитується з тієї смуги, якій він належить, при кожному відкритті, тож рядок не може застаріти в неправду.",
  "Send, Swap and Bridge write to a wallet-first action ledger, and this reads it back for the connected address with the current state of each lane. A swap that never came back can be asked what happened, from any browser that connects the wallet.":
    "Send, Swap і Bridge пишуть у журнал дій, ключем якого є гаманець, а ця сторінка читає його для підключеної адреси разом з поточним станом кожної смуги. В обміну, який так і не повернувся, можна запитати, що сталося, з будь-якого браузера, у якому підключено цей гаманець.",
  "Transfers made before this ledger existed, and any made outside Ryntra: both are on the chain and not in here, and the page says so rather than implying the wallet did nothing. Swap amounts are unlabelled because that lane stores no decimals anywhere.":
    "Перекази, зроблені до появи цього журналу, і будь-які зроблені поза Ryntra: вони є в мережі, але не тут, і сторінка про це каже, а не вдає, ніби гаманець нічого не робив. Суми обмінів без підпису, бо та смуга ніде не зберігає кількість знаків.",
  "Full onchain reconstruction is not planned yet. The private half is notes: wallet-scoped private data that waits on Solana sign-in.":
    "Повна реконструкція історії з мережі поки не запланована. Приватна половина — це нотатки: приватні дані, прив'язані до гаманця, які чекають на вхід гаманцем для Solana.",
  "still moving, and not counted below": "ще в русі й не враховано нижче",

  /* History — the wallet's own list of what it did here. */
  "Connect a wallet — your transfers will be here, and where each one is.": "Підключи гаманець — тут будуть твої перекази й де кожен із них.",
  "This history could not be read just now. Nothing is wrong with your transfers.":
    "Цю історію зараз не вдалося прочитати. З твоїми переказами все гаразд.",
  "still moving. Money that has left and not yet settled shows here until it does.":
    "ще в русі. Кошти, які пішли й ще не завершились, показуються тут, доки не завершаться.",
  "Nothing yet.": "Поки нічого.",
  "Transfers you make here appear in this list, on any browser you connect this wallet from.":
    "Перекази, які ти тут робиш, з'являються в цьому списку — у будь-якому браузері, з якого ти підключиш цей гаманець.",
  "This covers what you did here. Anything sent from another app is on the chain and not in this list.":
    "Тут те, що ти робиш у Ryntra. Надіслане з іншого застосунку є в мережі, але не в цьому списку.",
  "Part of this history could not be read, so the list may be incomplete.":
    "Частину історії не вдалося прочитати, тож список може бути неповним.",
  "Moved": "Переведено",
  "Moved between chains": "Переведено між мережами",
  "between chains": "між мережами",
  "Moved to Base": "Переведено на Base",
  "Did not happen": "Не відбулося",
  "Needs you": "Потрібна твоя дія",

  /* The wallet gate — the whole screen before a wallet is chosen. One line per
     surface, saying what that screen shows once it has one. */
  "Your assets, and what they are worth.": "Твої активи та їхня вартість.",
  "Connect a wallet — your address and requests for an exact amount will be here.": "Підключи гаманець — тут будуть твоя адреса й запити на точну суму.",
  "Connect a wallet — the receipts of your transfers will be here.": "Підключи гаманець — тут будуть квитанції твоїх переказів.",
  "No Solana wallet in this browser.": "У цьому браузері немає гаманця Solana.",
  "Phantom, Solflare and Backpack all work.": "Phantom, Solflare і Backpack підходять.",
  "Opening…": "Відкриваємо…",
  "Continue with": "Продовжити з",
  "Risk & Loss Guard": "Ризики та захист",
  "Alerts": "Сповіщення",
  "Strategy Lab": "Лабораторія стратегій",
  "Automation": "Автоматизація",
  "Receive": "Отримати",
  "Payments": "Платежі",
  "History": "Історія",
  "Provider status": "Стан провайдерів",
  "Launches": "Нові запуски",
  "Market flow": "Ринкові потоки",
  "Wallet intelligence": "Аналітика гаманців",
  "RWA markets": "Ринки RWA",
  "Business": "Бізнес",
  "Creator & Treasury": "Проєкти та казначейство",
  "Subscriptions & x402": "Підписки та x402",
  "Agent Control": "Agent Control",
  "Navigation depth": "Режим меню",
  "Simple": "Simple",
  "Pro": "Pro",
  "Universes & Watchlist": "Всесвіти й список спостереження",
  "Scanner": "Сканер",
  "Trade": "Торгівля",
  "Strategy": "Стратегія",
  "Receipts": "Квитанції",
  "Send": "Надіслати",
  "Developers": "Розробникам",
  "SDK & MCP": "SDK і MCP",
  "Settings": "Налаштування",
  "Owner policy": "Політика власника",
  "Home": "Головна",
  "Observe": "Спостереження",
  "Prove": "Докази",
  "Build": "Розробка",
  "Control": "Контроль",
  "Solana Hub Map": "Мапа Solana Hub",
  "Language": "Мова",
  "Planned": "Заплановано",
  "Solana Hub": "Solana Hub",
  "CCTP V2 native USDC, Solana ↔ Base, through the pre-canary boundary.":
    "CCTP V2 для native USDC між Solana й Base до межі pre-canary.",
  "Native USDC across Solana and Base through Circle CCTP V2. This surface reads the route, fees and allowance, builds a pre-canary Review, and stops before any approval, burn, mint or signature.":
    "Native USDC між Solana й Base через Circle CCTP V2. Поверхня читає route, fees і allowance, будує pre-canary Review та зупиняється до approval, burn, mint чи підпису.",
  "A keyed Jupiter Swap API V2 mainnet ticket: exact quote and fee fields, both Asset Passports, a hash-bound Review window and the policy verdict. Keyless access is explicit and degraded. Execution exists only in the owner-canary console below — a wallet signature, one execute, independent read, signed Receipt.":
    "Mainnet ticket Jupiter Swap API V2 з ключем: точні quote/fee fields, обидва паспорти активів, Review window з hash binding і verdict policy. Доступ без ключа явний і degraded. Виконання існує лише в owner-canary консолі нижче — підпис гаманця, одне виконання, незалежне читання, підписана квитанція.",
  "A read-only workspace over Solana mainnet: exact mint identity, issuer powers, every Token-2022 extension with its provenance — and a registry that states what exists against what still waits on a gate. Nothing here holds a key, signs, or executes.":
    "Робочий простір лише для читання над Solana mainnet: точна ідентичність mint, повноваження емітента, кожне розширення Token-2022 з походженням і реєстр, що відділяє наявне від того, що чекає gate. Тут нічого не тримає ключ, не підписує й не виконує.",
  "Which network this workspace reads and through which endpoint, and the boundaries that are structural rather than configurable. Appearance and layout are in the Customize control in the top bar.":
    "Яку мережу й через який endpoint читає простір, а також межі, що є структурними, а не налаштовуваними. Вигляд і макет знаходяться в контролі налаштування.",
  "The first owner-signed Solana Mainnet lifecycle is finalized and independently read back. Its signed Outcome Receipt is downloadable, verifier-valid and preserves the exact deviation it recorded.":
    "Перший owner-signed lifecycle Solana Mainnet фіналізовано й незалежно прочитано. Його підписану Outcome Receipt можна завантажити; verifier підтверджує її, а записане відхилення збережено без переписування.",
  "Choose an asset, a recipient and an amount. Ryntra reads the mint, simulates the exact bytes and judges them against policy. Your wallet signs; this site never holds a key. The exact ATA-create canary is finalized and receipted; every other mainnet transfer remains review-only until its own gate.":
    "Обери актив, отримувача й суму. Ryntra читає mint, симулює точні bytes і оцінює їх за policy. Підписує твій wallet; сайт ніколи не тримає ключ. Точний ATA-create canary фіналізовано й забезпечено Receipt; кожен інший mainnet-переказ лишається review-only до власного gate.",
  "Paste a mint address to read what it structurally is: which program owns it, what its authorities and extensions can do to a holding, and what is not known. The page's address is the shareable link, and opening one re-reads the chain.":
    "Встав адресу mint, щоб прочитати його структуру: яка program ним володіє, що authorities і extensions можуть зробити з активом та що невідомо. Адреса сторінки є посиланням; відкриття повторно читає chain.",
  "What this workspace reads, from which source, under which contract — and exactly what the kit refuses to do. The SDK, the local MCP server and the CLI are published: ryntra-io/ryntra-solana-evidence, Apache-2.0, v1.0.0, cloned and verified from GitHub as a stranger would. It holds no key and has no signing path, which is a property of the kit rather than a gap in it.":
    "Що простір читає, з якого джерела й за яким контрактом — та що саме kit відмовляється робити. SDK, локальний MCP server і CLI опубліковані: ryntra-io/ryntra-solana-evidence, Apache-2.0, v1.0.0; їх клоновано й перевірено з GitHub як стороннім користувачем. Kit не тримає ключа й не має signing path — це його властивість, а не прогалина.",
  "Owner policy unavailable": "Політика власника недоступна",
  "Bridge unavailable": "Переказ між мережами недоступний",
  "Bridge pre-canary": "Переказ між мережами до canary",
  "The owner-canary policy configuration could not be read. No bridge review was built.":
    "Конфігурацію owner-canary policy не вдалося прочитати. Bridge Review не побудовано.",
  "Bridge plan": "План переказу між мережами",
  "Pre-canary": "До canary",
  "What Review bridge does": "Що робить перевірка переказу між мережами",
  "It re-reads Circle's public mainnet fee and allowance facts and rebuilds this Review from the URL. No transaction bytes, approval, signature, burn or mint are created.":
    "Повторно читає публічні mainnet facts Circle щодо fee й allowance та перебудовує Review з URL. Transaction bytes, approval, підпис, burn і mint не створюються.",
  "Direction": "Напрямок",
  "Solana → Base": "Solana → Base",
  "Base → Solana": "Base → Solana",
  "Amount · USDC": "Сума · USDC",
  "Speed": "Швидкість",
  "Standard": "Стандартний",
  "Fast · allowance-dependent": "Швидкий · залежить від allowance",
  "Review": "Перевірка",
  "Why the verdict is not an execution permission": "Чому verdict не є дозволом на виконання",
  "This bridge is pre-canary architecture. The owner policy remains fail-closed, destination gas is not estimated, and no approval or signature is requested. A later owner-present canary starts from a new Review.":
    "Цей міст є pre-canary архітектурою. Owner policy лишається fail-closed, destination gas не оцінено, approval чи підпис не запитуються. Пізніший canary у присутності власника почнеться з нового Review.",
  "Source chain": "Вихідний chain",
  "Destination chain": "Цільовий chain",
  "Exact source asset": "Точний вихідний актив",
  "Exact destination asset": "Точний цільовий актив",
  "Representation": "Представлення",
  "Native USDC → native USDC · no wrapped token or liquidity pool":
    "Native USDC → native USDC · без wrapped token чи liquidity pool",
  "Provider / protocol": "Провайдер / протокол",
  "Circle · CCTP V2": "Circle · CCTP V2",
  "Source wallet": "Вихідний wallet",
  "Destination recipient": "Цільовий отримувач",
  "Not provided": "Не вказано",
  "Amount": "Сума",
  "Protocol fee": "Комісія протоколу",
  "Relayer fee": "Комісія relayer",
  "Unknown · Forwarding Service is not selected": "Невідомо · Forwarding Service не обрано",
  "Destination gas": "Gas у цільовій мережі",
  "Unknown · no destination transaction is built": "Невідомо · цільова транзакція не будується",
  "Expected receive": "Очікуване отримання",
  "Speed / finality": "Швидкість / finality",
  "Approvals / signatures": "Approvals / підписи",
  "Required only at canary · none requested here": "Потрібні лише для canary · тут нічого не запитується",
  "Owner canary": "Canary власника",
  "new risk remains closed": "новий ризик лишається закритим",
  "Recovery path": "Шлях відновлення",
  "Inspect existing burn → message → attestation → mint; never burn twice":
    "Перевірити наявні burn → message → attestation → mint; ніколи не робити другий burn",
  "Provider health": "Стан провайдера",
  "What the reachability state means": "Що означає стан доступності",
  "Mainnet Iris is pinned to one origin. A Cloudflare 1009 edge block is environment unreachability, not a Circle refusal. No failed read becomes a zero fee or empty allowance.":
    "Mainnet Iris закріплено за одним origin. Edge block Cloudflare 1009 означає недоступність із середовища, а не відмову Circle. Невдале читання не стає нульовою fee чи порожнім allowance.",
  "Endpoint": "Endpoint",
  "Public keys": "Публічні ключі",
  "Fast allowance": "Fast allowance",
  "Fast fee": "Fast fee",
  "Standard fee": "Standard fee",
  "Provider reason": "Причина стану",
  "All required reads answered": "Усі потрібні читання відповіли",
  "Lifecycle": "Lifecycle",
  "No transfer": "Переказу немає",
  "When completion is allowed": "Коли дозволено completion",
  "`COMPLETED` requires a confirmed source burn, Circle message and attestation, destination mint, independent destination observation and expected-versus-actual reconciliation. Provider success alone cannot reach it.":
    "`COMPLETED` потребує підтвердженого source burn, message і attestation Circle, destination mint, незалежного спостереження цільової мережі та reconciliation очікуваного з фактичним. Однієї відповіді провайдера недостатньо.",
  "Current model state": "Поточний стан моделі",
  "no burn signature exists": "burn signature не існує",
  "Value in motion": "Кошти в русі",
  "Completion rule": "Правило completion",
  "Both sides observed + reconciled": "Обидві сторони спостережено + reconciled",
  "Recovery & receipt": "Відновлення й квитанція",
  "Why recovery starts from the existing burn": "Чому recovery починається з наявного burn",
  "Circle minting is idempotent. A failed destination mint reuses the same message and attestation; an expired attestation is re-read or re-attested in a later authorized flow. A second burn is never a recovery action.":
    "Minting Circle є idempotent. Невдалий destination mint повторно використовує ті самі message й attestation; прострочений attestation повторно читається або re-attested у пізнішому авторизованому flow. Другий burn ніколи не є recovery action.",
  "Recovery action": "Recovery action",
  "Where value is": "Де перебуває value",
  "Second burn": "Другий burn",
  "Refused after any burn may exist": "Відмовлено, щойно burn може існувати",
  "Receipt schema": "Схема квитанції",
  "Receipt state": "Стан квитанції",
  "No Bridge Receipt exists yet":
    "Bridge Receipt ще не існує",
  "Execution boundary": "Межа виконання",
  "No transaction is built, signed or submitted in the bridge preview":
    "У попередньому перегляді мосту транзакція не будується, не підписується й не надсилається",
  "Choose Solana → Base or Base → Solana.": "Обери Solana → Base або Base → Solana.",
  "Choose Standard or Fast.": "Обери Standard або Fast.",
  "Network": "Мережа",
  "Config fact": "Факт конфігурації",
  "Why there is no network switch": "Чому немає перемикача мережі",
  "Every read here is Solana mainnet, because that is where the real mints are, and mainnet is the only network this product treats as a release target. A devnet endpoint stays configured only as an internal regression fixture; Send has moved to mainnet semantics — a fixture is not a step, and a switch between the two would offer a choice that means nothing to a reader. There are two mainnet endpoints rather than one because a single public endpoint is not production infrastructure: the primary is asked first and an independent operator answers when it does not, and the workspace says which one answered instead of substituting quietly.":
    "Кожне читання тут виконується в Solana mainnet, де існують реальні мінти; mainnet є єдиною release target мережею продукту. Devnet endpoint лишається лише внутрішнім regression fixture; Send переведено на mainnet semantics — fixture не є етапом, а перемикач створив би вибір без сенсу. Mainnet має два endpoint, бо один публічний endpoint не є production infrastructure: спочатку запитується primary, потім незалежний оператор, і простір прямо називає, хто відповів.",
  "Reads": "Читання",
  "Solana mainnet, read-only": "Solana mainnet, лише читання",
  "Venue quotes": "Котирування venue",
  "Jupiter Swap API V2 `/order`, keyed production and read-only — keyless access exists only when explicitly selected and is labelled degraded":
    "Jupiter Swap API V2 `/order`, production з ключем і лише читання — доступ без ключа існує тільки при явному виборі та позначений degraded",
  "Mainnet endpoint": "Mainnet endpoint",
  "Independent fallback": "Незалежний fallback",
  "supplied through the environment": "надано через environment",
  "public default, not production infrastructure": "публічний default, не production infrastructure",
  "Override": "Override",
  "a provider URL enters through the environment, never through code":
    "URL провайдера надходить через environment, ніколи через code",
  "Read discipline": "Дисципліна читання",
  "10s per endpoint, primary then fallback, one bounded retry, an 8 MiB response ceiling, freshness and the answering host stamped on every read":
    "10s на endpoint, primary потім fallback, один bounded retry, ліміт відповіді 8 MiB, freshness і host відповіді в кожному читанні",
  "Owner canary control": "Контроль owner canary",
  "What this control can and cannot do": "Що цей контроль може й не може робити",
  "This is the enforced pre-sign policy for the first owner-controlled mainnet canaries. It does not create a wallet, move funds or authorize a transaction. The operator switch is deployment configuration, not a public browser control; missing or invalid configuration fails closed.":
    "Це примусова pre-sign policy для перших mainnet canary під контролем власника. Вона не створює wallet, не рухає кошти й не авторизує транзакцію. Operator switch є deployment configuration, а не публічним browser control; відсутня або невалідна конфігурація fail-closed.",
  "Emergency stop": "Аварійна зупинка",
  "new value-moving reservations only; reads and recovery remain available":
    "лише нові value-moving reservations; читання й recovery лишаються доступними",
  "Operator switch": "Перемикач оператора",
  "defaults to PAUSED": "типово PAUSED",
  "Package ceiling": "Ліміт пакета",
  "20 USD equivalent · upper bound, not a spending target":
    "еквівалент 20 USD · верхня межа, не ціль витрат",
  "Reserved / spent": "Зарезервовано / витрачено",
  "UNKNOWN — durable ledger could not be read": "UNKNOWN — durable ledger не вдалося прочитати",
  "Fee reserve": "Резерв fees",
  "UNKNOWN — SOL fee/rent exposure is not available": "UNKNOWN — SOL fee/rent exposure недоступний",
  "reserved": "зарезервовано",
  "spent": "витрачено",
  "Durability": "Стійкість",
  "production requires DURABLE_MULTI_WRITER": "production потребує DURABLE_MULTI_WRITER",
  "Decision vocabulary": "Словник рішень",
  "Meaning": "Значення",
  "ALLOW means only that this exact intent fits this exact policy and evidence.":
    "ALLOW означає лише, що цей точний intent відповідає цій точній policy та evidence.",
  "Canary family limits": "Ліміти canary family",
  "Policy v1": "Policy v1",
  "Why each family is separate": "Чому кожна family окрема",
  "Send, ATA creation, Swap, CCTP and Token-2022 prove different effects. One successful action never spends or proves another family's budget. Destination, mint and program allowlists are checked per family; an empty allowlist blocks rather than reviews.":
    "Send, створення ATA, Swap, CCTP і Token-2022 доводять різні effects. Успіх однієї дії не витрачає й не доводить budget іншої family. Allowlists destination, mint і program перевіряються окремо; порожній allowlist блокує, а не переводить у review.",
  "destinations": "отримувачі",
  "mints": "мінти",
  "programs": "програми",
  "Policy": "Політика",
  "What this workspace cannot do": "Чого цей простір не може робити",
  "Structural": "Структурно",
  "Cannot, not may-not": "Не може, а не просто не дозволено",
  "These are absences of code paths, not toggles set to off. Signing is the one worth stating exactly: your wallet signs, and this workspace only forwards bytes it has compared against the ones it built and showed you. The single exception is named below, because a boundary with an unnamed exception is not a boundary.":
    "Це відсутні шляхи в коді, а не перемикачі, вимкнені в налаштуваннях. Підпис — те, що варто назвати точно: підписує твій гаманець, а цей кабінет лише передає байти, які звірив із тими, що сам побудував і показав тобі. Єдиний виняток названо нижче, бо межа з неназваним винятком — це не межа.",
  "Keys": "Ключі",
  "Holds none, requests none, never sees a seed phrase.":
    "Не тримає й не запитує ключів, ніколи не бачить seed phrase.",
  "Signing": "Підписання",
  "Ryntra holds no signer. The exact ATA-create canary is finalized and receipted; every other mainnet Send remains review-only until the general Send canary.":
    "Ryntra не тримає signer. Точний ATA-create canary фіналізовано й забезпечено Receipt; усі інші mainnet Send лишаються review-only до загального Send canary.",
  "Accounts": "Акаунти",
  "There is nothing to sign up for; the workspace is open.":
    "Реєстрація не потрібна; робочий простір відкритий.",
  "Retention": "Зберігання",
  "Your receipts are kept in this browser, so clearing site data clears them — the signed JSON you download is the copy that outlives it. What an action did is also recorded against your wallet address on our side, because that much is already public on the chain.":
    "Твої квитанції зберігаються в цьому браузері, тож очищення даних сайту стирає їх — копія, яка це переживе, це підписаний JSON, який ти завантажуєш. Те, що зробила дія, ми додатково записуємо за адресою твого гаманця, бо це вже й так публічний факт у мережі.",
  "Canary ledger": "Canary ledger",
  "Only intent identity, budget exposure and later outcome state; never a key or signed bytes.":
    "Лише identity intent, budget exposure і майбутній outcome state; ніколи не ключ чи підписані bytes.",
  "Agent Control projection": "Проєкція Agent Control",
  "Solana receipts": "Квитанції Solana",
  "Verified receipt": "Перевірена квитанція",
  "0.5 USDC": "0.5 USDC",
  "Outcome": "Результат",
  "ATA created": "ATA створено",
  "Transaction": "Транзакція",
  "Receipt": "Квитанція",
  "Download receipt": "Завантажити квитанцію",
  "Download signed JSON": "Завантажити підписаний JSON",
  "Issued": "Створено",
  "Verification available": "Перевірка доступна",
  "Open receipt": "Відкрити квитанцію",
  "The transfer is finalized. The signed receipt preserves a reconciliation deviation; open Receipts for its exact evidence.":
    "Переказ фіналізовано. Підписана receipt зберігає reconciliation deviation; відкрий Receipts для точного доказу.",
  "What a receipt binds": "Що зв'язує квитанція",
  "The intent that was authorized, the transaction the chain actually recorded, an independent read-back, the expected-versus-actual reconciliation — a deviation records as a deviation — and an Ed25519 signature over the exact bytes. Change one byte and verification says so.":
    "Авторизований intent, транзакція, яку фактично записав chain, незалежний read-back, reconciliation очікуваного з фактичним — deviation записується як deviation — і підпис Ed25519 над точними bytes. Зміни один byte, і verification це покаже.",
  "Verify any Ryntra artifact": "Перевірити будь-який артефакт Ryntra",
  "Live": "Працює",
  "Why this already works": "Чому це вже працює",
  "The verifier is one unified surface for every artifact kind this product signs. The M1B receipt returns valid integrity and issuer signature while keeping its historical deviation visible.":
    "Verifier є однією поверхнею для кожного виду артефактів, які підписує продукт. Receipt M1B повертає valid integrity і issuer signature, зберігаючи історичне відхилення видимим.",
  "Public verifier": "Публічний verifier",
  "Open — this leaves for the Agent Control workspace": "Відкрити — перехід до простору Agent Control",
  "What it checks": "Що він перевіряє",
  "Integrity against the canonical bytes, the issuer signature, and the authorization axis — each reported separately.":
    "Integrity відносно canonical bytes, підпис issuer і authorization axis — кожен результат окремо.",
  "Registry entry": "Запис реєстру",
  "Shipped": "Поставлено",
  "Why an adapter registers": "Навіщо adapter реєструється",
  "Agent Control artifacts name their adapter and action by versioned, hash-pinned reference, so a verifier that has never heard of Solana still reads that the action commits value. The adapter entered the shipped registry through a neutral manifest — the central sources never name a provider, and a test fails if one appears.":
    "Артефакти Agent Control називають adapter і action версіонованим hash-pinned reference, тому verifier, який не знає Solana, усе одно бачить, що action зобов'язує value. Adapter увійшов до shipped registry через нейтральний manifest — центральні sources не називають провайдера, і тест падає, якщо він з'явиться.",
  "Adapter": "Adapter",
  "Action": "Дія",
  "Canonical class": "Canonical class",
  "readable without knowing the chain": "читабельний без знання chain",
  "Amounts": "Суми",
  "Raw base-unit strings end to end; a float cannot exist as a concept.":
    "Raw base-unit strings від початку до кінця; float не може існувати як концепт.",
  "Published contracts": "Опубліковані контракти",
  "Public": "Публічні",
  "Where these live": "Де вони розміщені",
  "Four JSON Schemas generated from the zod sources into `docs/solana/schemas/`, with a parity test that regenerates and compares — drift fails the suite. They ship in the public evidence kit, so the contract a stranger reads and the contract this workspace enforces are the same four files.":
    "Чотири JSON Schema генеруються із zod sources у `docs/solana/schemas/`; parity test повторно генерує й порівнює — drift валить suite. Вони входять до public evidence kit, тож контракт для стороннього читача й контракт цього простору — ті самі чотири файли.",
  "Public kit": "Публічний kit",
  "Apache-2.0, SDK, local MCP server and CLI, read-only":
    "Apache-2.0, SDK, локальний MCP server і CLI, лише читання",
  "RPC sources": "Джерела RPC",
  "How an endpoint is chosen": "Як обирається endpoint",
  "An explicit endpoint wins over the environment; the environment wins over the public default. Mainnet resolves to a pair rather than one host: the primary is asked first, and a transport failure — a timeout, a refusal, a response over the ceiling — moves the same call to an independent operator. A JSON-RPC answer is never retried, because “not found” is a fact and re-asking does not change facts. Every read carries a 10s per-endpoint timeout, an 8 MiB response ceiling and one bounded retry, and every fact it produces is stamped with the host that actually answered.":
    "Явний endpoint має пріоритет над environment; environment — над public default. Mainnet розв'язується у пару, а не один host: спочатку primary, а transport failure — timeout, refusal чи відповідь понад ліміт — переносить той самий call до незалежного оператора. JSON-RPC answer не повторюється, бо “not found” є фактом. Кожне читання має timeout 10s на endpoint, ліміт відповіді 8 MiB, один bounded retry і stamp host, який відповів.",
  "Mainnet primary": "Mainnet primary",
  "Mainnet fallback — independent operator": "Mainnet fallback — незалежний оператор",
  "from the environment": "з environment",
  "Devnet — internal fixture only": "Devnet — лише внутрішній fixture",
  "a regression fixture for the Send path awaiting its mainnet rewrite, never a release gate":
    "regression fixture для Send path, що чекає на переписування під mainnet, ніколи не release gate",
  "Environment overrides": "Environment overrides",
  "keyed production configured": "production з ключем налаштовано",
  "production key required": "потрібен production key",
  "the key enters only through": "ключ надходить лише через",
  "Custom route contract": "Контракт custom route",
  "typed for the future allowlist path; no network caller yet":
    "типізований для майбутнього allowlist path; network caller поки немає",
  "What this kit refuses": "Що цей kit відмовляється робити",
  "By construction": "За конструкцією",
  "Why refusals are listed": "Навіщо перелічені відмови",
  "A boundary that is not written down gets renegotiated by accident. These are structural: no code path here signs anything and no key reaches Ryntra. Send is the one surface that reaches the network at all, and it forwards bytes your own wallet signed, after comparing them to the ones that were built.":
    "Межа, яку не записано, випадково переглядається. Ці межі структурні: жоден code path тут не підписує, жоден key не доходить до Ryntra. Send є єдиною поверхнею, що доходить до мережі, і передає bytes, підписані твоїм wallet, після порівняння з побудованими.",
  "Keys and signing": "Ключі та підписання",
  "Never. No key reaches Ryntra and no code path here signs.":
    "Ніколи. Жоден key не доходить до Ryntra, жоден code path тут не підписує.",
  "Guessing": "Припущення",
  "An account that is not a mint is refused by name; an extension without written semantics is reported, not interpreted.":
    "Account, який не є mint, відхиляється з названою причиною; extension без описаної semantics звітується, а не інтерпретується.",
  "Unknown references": "Невідомі references",
  "The registry resolves fail-closed: an unknown adapter, version or kind is a refusal, not a fallback.":
    "Registry працює fail-closed: невідомий adapter, version або kind є відмовою, а не fallback.",
  "Verdict vocabulary": "Словник verdict",
  "The policy ladder bottoms out at NO_KNOWN_BLOCKER — the word “safe” is not in it, and a test holds that.":
    "Policy ladder закінчується на NO_KNOWN_BLOCKER — слова “safe” в ній немає, і це тримає тест.",
  "Exists": "Існує",
  "Missing": "Відсутнє",
  "Gate": "Gate",
  "Last verified": "Остання перевірка",
  "Never — nothing to verify yet.": "Ніколи — поки немає що перевіряти.",
  "Open": "Відкрити",
  "What a state word means here": "Що тут означає слово стану",
  "Available": "Доступно",
  "A real, working thing today: a page here that reads and moves nothing, or a published kit you can clone.":
    "Реальна працююча річ сьогодні: сторінка, що читає й нічого не рухає, або опублікований kit для клонування.",
  "Owner canary verified": "Owner canary verified",
  "One owner-signed mainnet action of that family ran, reconciled and receipted. None wears it yet.":
    "Одна підписана власником mainnet дія цієї family виконана, reconciled і має квитанцію. Поки жодна family не має цього стану.",
  "Preview": "Попередній перегляд",
  "Bridge preview": "Попередній перегляд переказу між мережами",
  "Preview native USDC between Solana and Base through Circle CCTP V2. Transfers remain unavailable until the separately approved owner canary is completed.":
    "Переглянь маршрут native USDC між Solana та Base через Circle CCTP V2. Перекази залишаються недоступними до завершення окремо підтвердженого owner canary.",
  "What this preview does": "Що робить цей перегляд",
  "Technical details": "Технічні деталі",
  "Bridge transfers are not available yet. This preview never opens your wallet or moves funds.":
    "Перекази через міст ще недоступні. Цей перегляд не відкриває гаманець і не переміщує кошти.",
  "Enter a valid USDC amount.": "Введи коректну суму USDC.",
  "Preview route": "Переглянути маршрут",
  "Route preview": "Попередній перегляд маршруту",
  "Preview only": "Лише перегляд",
  "You send": "Ти надсилаєш",
  "You receive": "Ти отримуєш",
  "Fast": "Швидкий",
  "Provider fee": "Комісія провайдера",
  "Availability": "Доступність",
  "Transfer unavailable · preview only": "Переказ недоступний · лише перегляд",
  "Built enough to open, not proven against a live source.":
    "Побудовано достатньо для відкриття, але не доведено на live source.",
  "In build": "У розробці",
  "Active work with a registered task.": "Активна робота із зареєстрованою task.",
  "An accepted direction with no active work.": "Прийнятий напрямок без активної роботи.",
  "Gated": "За gate",
  "Blocked on a named condition, stated on the card.": "Заблоковано названою умовою, вказаною на картці.",
  "And what an environment word means": "І що означає слово environment",
  "Real mints and ledger state. Moves nothing and needs no wallet.":
    "Реальні мінти й стан ledger. Нічого не рухає й не потребує wallet.",
  "Prepares an action the owner signs in their own wallet. It says what the surface is for, never that anything has been signed — the state word beside it carries that.":
    "Готує action, яку власник підписує у власному wallet. Це опис призначення поверхні, а не твердження про підпис — фактичний стан показано поруч.",
  "Touches no network — preferences, documentation, this map.":
    "Не торкається мережі — preferences, документація й ця мапа.",
  "Solana Hub overview": "Огляд Solana Hub",
  "Issuer powers on the starting set": "Повноваження емітентів у стартовому наборі",
  "Chain fact": "Факт chain",
  "What this table states": "Що показує ця таблиця",
  "For each mint on the starting set: whether anyone can still mint more, whether holdings can be frozen, and how many extensions can change the outcome of a transfer. Read from each mint account on this visit; a mint that did not resolve shows its reason instead of a guess.":
    "Для кожного mint стартового набору: чи може хтось створити ще tokens, чи можна заморозити holdings і скільки extensions можуть змінити результат transfer. Дані читаються з mint account під час цього візиту; нерозв'язаний mint показує причину, а не припущення.",
  "Mint": "Mint",
  "Can mint more": "Може створити ще",
  "Can freeze": "Може заморозити",
  "Transfer-affecting": "Впливає на transfer",
  "Passport": "Паспорт",
  "Yes": "Так",
  "No": "Ні",
  "None": "Немає",
  "extension": "extension",
  "extensions": "extensions",
  "Start here": "Почни тут",
  "What to do on this workspace": "Що робити в цьому просторі",
  "Paste any mainnet mint address and read its passport — identity, issuer powers, extensions, and what is not known. The passport's address is a shareable link.":
    "Встав адресу будь-якого mainnet mint і прочитай паспорт — identity, issuer powers, extensions і невідомі факти. Адреса паспорта є посиланням для поширення.",
  "Read any mint": "Прочитати будь-який mint",
  "Open the Asset Passport": "Відкрити паспорт активу",
  "Quote a swap, read-only": "Отримати swap quote, лише читання",
  "Live mainnet quotes, judged by policy": "Живі mainnet quotes, оцінені policy",
  "See a hard case": "Подивитися складний випадок",
  "PYUSD — permanent delegate, fee config, hook": "PYUSD — permanent delegate, fee config, hook",
  "See a real transfer fee": "Подивитися реальну transfer fee",
  "BERN — the fee reduces what arrives": "BERN — fee зменшує отриману суму",
  "Everything registered": "Усе зареєстроване",
  "Network read": "Читання мережі",
  "What this panel reads": "Що читає ця панель",
  "One epoch-info call and every mint read on this page, against the workspace's mainnet endpoint pair, stamped with when they answered. It is a liveness fact about the read path, not a market signal.":
    "Один epoch-info call і кожне mint read на сторінці через mainnet endpoint pair простору зі stamp часу відповіді. Це liveness fact read path, а не market signal.",
  "The pair is a primary and an independent operator, because a single public endpoint is not production infrastructure. Healthy means the primary answered everything on this page. Degraded means the fallback answered instead — the facts are real and they did not come from the endpoint this workspace asks first, which is stated rather than substituted quietly. Unavailable means nobody answered and the facts are absent, not stale.":
    "Пара складається з primary та незалежного оператора, бо один public endpoint не є production infrastructure. Healthy означає, що primary відповів на все. Degraded означає відповідь fallback — факти реальні, але не з першого endpoint, і це вказано. Unavailable означає, що ніхто не відповів і факти відсутні, а не stale.",
  "Endpoint pair": "Пара endpoint",
  "Epoch": "Епоха",
  "Slot": "Slot",
  "Answered by": "Відповів",
  "No endpoint answered": "Жоден endpoint не відповів",
  "What exists and what waits": "Що існує й що чекає",
  "Why this panel exists": "Навіщо ця панель",
  "So the front door describes exactly the product behind it. Every number here is computed from the module registry, and each unbuilt module carries its gate on the Hub Map rather than a promise here.":
    "Щоб вхідна сторінка точно описувала продукт. Кожне число обчислюється з module registry, а кожен непобудований модуль має свій gate на Hub Map замість обіцянки тут.",
  "Surfaces you can open": "Поверхні, які можна відкрити",
  "Gate-named in the rail": "З названим gate у rail",
  "Registered on the map": "Зареєстровано на мапі",
  "more, each with its gate": "ще, кожен зі своїм gate",
  "Next in the queue": "Наступне в черзі",
  "No Solana work is active — the roadmap chooses what starts next":
    "Активної роботи над Solana немає — що стартує далі, визначає дорожня карта",
  "What this workspace reads live, which issuer powers sit on real mints, and what waits on which gate.":
    "Що цей простір читає наживо, які повноваження емітента мають реальні мінти та що чекає на який gate.",
  "Mission control for a read-only workspace: the mainnet epoch as the endpoint answered it, issuer powers across the six verified mints, and the registry's own account of what exists against what is registered with a gate.":
    "Операційний центр простору лише для читання: епоха мейннету з відповіді endpoint, повноваження емітента для шести перевірених мінтів і власний облік реєстру — що існує, а що зареєстровано за gate.",
  "Live epoch read, live issuer-power rows over the six fixture-verified mints, and the module ledger.":
    "Живе читання епохи, живі рядки повноважень емітента для шести мінтів, перевірених fixtures, і реєстр модулів.",
  "Watched mints and recent activity, both of which need a store this workspace does not keep yet.":
    "Мінти під спостереженням і недавня активність; обом потрібне сховище, якого цей простір ще не веде.",
  "A retention decision — the same one Stellar answered with browser-local storage — registered with Phase B's watchlist.":
    "Рішення про зберігання — таке саме, яке Stellar закрив локальним сховищем браузера, — зареєстроване зі списком спостереження Phase B.",
  "Paste a mint address and read what it structurally is — and share the read as a link.":
    "Встав адресу мінта, прочитай його структуру та поділися читанням як посиланням.",
  "The Solana Asset Passport: exact identity, what the issuer can do to a holding (mint, freeze, and every transfer-affecting Token-2022 extension), every extension with its provenance, and a permanent unknowns rail. The page's address is the shareable deep link; opening it re-reads the chain.":
    "Паспорт активу Solana: точна ідентичність, що емітент може зробити з активом (додаткова емісія, замороження та кожне розширення Token-2022, що впливає на переказ), походження кожного розширення й постійний блок невідомого. Адреса сторінки є посиланням; відкриття повторно читає chain.",
  "The full passport over any mainnet mint — SPL or Token-2022 — with provenance on every field, plus six real mints to start from.":
    "Повний паспорт будь-якого мінта мейннету — SPL або Token-2022 — з походженням кожного поля та шістьма реальними мінтами для початку.",
  "Off-chain metadata (name, logo, issuer's own description), price, liquidity and holder concentration.":
    "Off-chain metadata (назва, логотип, опис емітента), ціна, ліквідність і концентрація власників.",
  "Phase B data adapters for metadata and prices; the scanner for concentration.":
    "Адаптери даних Phase B для metadata й цін; сканер для концентрації.",
  "Curated market universes with prices, metadata and freshness on every read.":
    "Керовані ринкові всесвіти з цінами, metadata та свіжістю кожного читання.",
  "Token lists and prices from named providers, compared rather than trusted singly, over curated universes — tokenized assets, majors, stables — with a stated method and never a claimed index. The live quote path already runs on the Swap surface; this module is the market view around it.":
    "Списки токенів і ціни від названих провайдерів, які порівнюються, а не приймаються поодинці, для керованих всесвітів — токенізованих активів, основних активів і стейблкоїнів — з описаним методом, але без заяви про індекс. Живий шлях котирування вже працює в Обміні; цей модуль додає ринковий контекст.",
  "The quote adapter and venue health, live on Swap since the swap preview shipped.":
    "Адаптер котирувань і стан venue, що працюють в Обміні відтоді, як запрацював попередній перегляд обміну.",
  "Market data adapters (prices, metadata, OHLCV decision), the universes and the page.":
    "Адаптери ринкових даних (ціни, metadata, рішення щодо OHLCV), всесвіти й сторінка.",
  "Phase B — the data adapters, and separately the universes and watchlist.":
    "Phase B — адаптери даних, а окремо — всесвіти й список спостереження.",
  "Curated sets of tokenized assets, majors and stables — and a watchlist that stays in your browser.":
    "Керовані набори токенізованих активів, основних активів і стейблкоїнів — та список спостереження, що лишається у твоєму браузері.",
  "Curated means curated: Solana has no asset index this product reads, so coverage is a set with a stated method, never a market. The watchlist follows the Stellar retention decision — browser-local, deletable, nowhere else.":
    "Керований означає керований: продукт не читає індекс активів Solana, тому покриття є набором з описаним методом, а не ринком. Список спостереження наслідує рішення Stellar — локальний у браузері, видаляється й ніде більше не зберігається.",
  "Nothing. The curated-scope discipline is inherited from the Stellar Observe slice, where it is enforced in the type.":
    "Нічого. Дисципліна керованого scope успадкована від Stellar Observe, де вона закріплена типом.",
  "The universes, the page, and the local store.": "Всесвіти, сторінка й локальне сховище.",
  "Phase B — universes and watchlist.": "Фаза B — всесвіти й список спостереження.",
  "Structural facts across many mints at once — never a score.":
    "Структурні факти одразу для багатьох мінтів — ніколи не score.",
  "Liquidity depth, pool age, holder concentration, authorities present, extension risk flags, price change. Facts with provenance, filterable; UNKNOWN stays UNKNOWN instead of defaulting to reassurance.":
    "Глибина ліквідності, вік пулу, концентрація власників, наявні повноваження, risk flags розширень і зміна ціни. Факти з походженням і фільтрами; UNKNOWN лишається UNKNOWN, а не стає заспокійливою відповіддю.",
  "Nothing. The per-mint facts it would aggregate are the passport's, already read with provenance.":
    "Нічого. Факти окремих мінтів, які він агрегуватиме, уже читає паспорт із походженням.",
  "The multi-mint read path, the filters and the saved-scan store.":
    "Шлях читання багатьох мінтів, фільтри й сховище збережених сканів.",
  "Phase B — the scanner itself.": "Фаза B — сам сканер.",
  "A live mainnet swap quote for any pair, and your own wallet's signature to execute it.":
    "Живе котирування swap у мейннеті для будь-якої пари та власний підпис твого гаманця для виконання.",
  "Jupiter Swap API V2's exact order fields — quote, minimum received, total/platform/priority fees, router, mode, route and a bounded Review window — beside both Asset Passports and the thirteen-rule policy verdict. Keyless access is explicit and degraded. The execute path adds a taker order, the exact-bytes firewall, a simulation whose proven deltas must equal the reviewed legs, the swap policy verdict, your own wallet signature, one execute and an independent chain read.":
    "Точні поля order від Jupiter Swap API V2 — котирування, мінімальне отримання, загальні/platform/priority fees, router, mode, route й обмежене вікно Review — поруч з обома паспортами активів і verdict політики з 13 правил. Доступ без ключа явний і degraded. Шлях виконання додає taker order, firewall точних байтів, симуляцію, доведені дельти якої мають дорівнювати переглянутим сторонам, verdict політики swap, власний підпис твого гаманця, одне виконання і незалежне читання ланцюга.",
  "The full keyed production surface: any pair and any amount, live `/order` quotes, exact base-unit arithmetic, separate fee rows, hash-bound freshness, the tested policy verdict, explicit refusal/degraded states, and the signable execute path behind the swap policy.":
    "Повна keyed production поверхня: будь-яка пара і будь-яка сума, живі котирування `/order`, точна арифметика base units, окремі fee rows, свіжість, прив'язана hash, перевірений verdict політики, явні стани refusal/degraded і шлях виконання з підписом за політикою swap.",
  "A settled Receipt from this surface. Nothing here is promoted on the strength of the path alone.":
    "Розрахована квитанція з цієї поверхні. Ніщо тут не promoted лише на підставі самого шляху.",
  "None. What can be signed is bounded by what the bytes prove, not by a pair or an amount.":
    "Немає. Те, що можна підписати, обмежене доведеним у байтах, а не парою чи сумою.",
  "Review native USDC across Solana and Base through Circle CCTP V2 before any burn can exist.":
    "Перевір native USDC між Solana і Base через Circle CCTP V2 до появи будь-якого burn.",
  "The CCTP V2 pre-canary desk: official domains/programs/contracts, exact native-USDC representation, live Iris fee and Fast-allowance reads, the ten-state burn-to-mint lifecycle, message-first recovery and the Bridge Receipt contract. It exposes no transaction builder or signer.":
    "Pre-canary desk CCTP V2: офіційні domains/programs/contracts, точне представлення native USDC, живі читання Iris fee та Fast allowance, десятистановий lifecycle burn-to-mint, recovery від наявного message і контракт Bridge Receipt. Builder транзакції та signer відсутні.",
  "The complete pre-canary Review and recovery architecture for both Solana ↔ Base directions, with provider-edge unreachability separated from refusal and every unknown kept explicit.":
    "Повна pre-canary архітектура Review і recovery для обох напрямків Solana ↔ Base, де недосяжність provider edge відділена від refusal, а кожне невідоме лишається явним.",
  "The owner canary itself: no approval, burn, attestation for a real message, destination mint, signature, transaction or Bridge Receipt exists.":
    "Сам owner canary: немає approval, burn, attestation реального message, destination mint, підпису, транзакції чи Bridge Receipt.",
  "One 2–5 USDC owner-signed CCTP mainnet canary, observed on both chains, reconciled and receipted.":
    "Один підписаний власником CCTP canary мейннету на 2–5 USDC, спостережений в обох chains, reconciled і з квитанцією.",
  "Formalize a strategy, test it on history, prove it on paper — before it touches a venue.":
    "Формалізуй стратегію, перевір на історії та доведи у paper-режимі до контакту з venue.",
  "The Strategy Lab core exists in this product for other markets. Binding it to Solana instruments — specs, historical data with provenance, deterministic backtests, walk-forward, paper trading — is its own registered phase, and pretending a binding exists before it does is what this card exists to prevent.":
    "Ядро Strategy Lab уже існує для інших ринків. Прив'язка до інструментів Solana — specs, історичні дані з походженням, детерміновані backtests, walk-forward і paper trading — є окремою зареєстрованою фазою; ця картка не дозволяє вдавати, що прив'язка вже існує.",
  "The chain-neutral Strategy Lab kernel, live elsewhere in the product.":
    "Chain-neutral ядро Strategy Lab, що працює в іншій частині продукту.",
  "Every Solana binding: instruments, data, backtests, paper lifecycle.":
    "Усі прив'язки Solana: інструменти, дані, backtests і paper lifecycle.",
  "Phase C — all seven of its steps.": "Фаза C — усі сім її кроків.",
  "One real transfer: built, simulated, signed in the owner's wallet, observed independently, reconciled, receipted.":
    "Один реальний переказ: побудований, симульований, підписаний у wallet власника, незалежно спостережений, reconciled і з квитанцією.",
  "The first Solana transaction this product stands behind. The wallet is yours, the signature is yours, and the observation is an independent read-back — Ryntra holds no key and asks the wallet to sign rather than to sign-and-send, so a comparison still happens between your approval and the network. A deviation records as a deviation, never rounded to a match.":
    "Перша транзакція Solana, за доказ якої відповідає продукт. Wallet і підпис належать тобі, а спостереження є незалежним read-back: Ryntra не тримає ключ і просить wallet підписати, а не sign-and-send, тому твоє approval порівнюється з мережею. Відхилення записується як відхилення, а не округлюється до match.",
  "Open the first signed Solana Outcome Receipt and independently check what it proves.":
    "Відкрий першу підписану Solana Outcome Receipt і незалежно перевір, що саме вона доводить.",
  "M1B produced the first owner-signed Solana Mainnet Outcome Receipt. Its exact 0.5 USDC movement and ATA creation match two independent RPC reads; the immutable receipt remains DEVIATION_RECORDED because its issued fee split and expected program set were incomplete, and the public verifier returns valid integrity and issuer signature.":
    "M1B створив першу owner-signed Solana Mainnet Outcome Receipt. Точний рух 0.5 USDC і створення ATA збігаються у двох незалежних RPC-read; незмінна receipt лишається DEVIATION_RECORDED через неповний поділ fee та expected program set, а public verifier підтверджує integrity й issuer signature.",
  "The signed Outcome Receipt of the ATA-create canary, immutable JSON download, explorer proof, unified public verifier and the Bridge Receipt verifier.":
    "Підписана Outcome Receipt для ATA-create canary, незмінний JSON download, explorer proof, unified public verifier і Bridge Receipt verifier.",
  "No Swap, Bridge or Token-2022 receipt exists; the general Send owner canary remains its own gate.":
    "Receipt для Swap, Bridge чи Token-2022 ще немає; general Send owner canary лишається окремим gate.",
  "The ATA-create canary is closed for its exact case. The general Send owner canary remains separate.":
    "ATA-create canary закрито для його точного case. General Send owner canary лишається окремим.",
  "M1B finalized one exact 0.5 USDC ATA-create transfer on Solana Mainnet: wallet-signed, one-shot submitted, independently read by two RPC operators and bound to a signed Outcome Receipt. The explicit asset picker, simulation, policy and durable reservation remain the working path.":
    "M1B фіналізував один точний ATA-create переказ 0.5 USDC у Solana Mainnet: wallet-signed, one-shot submitted, незалежно прочитаний двома RPC-операторами й прив'язаний до підписаної Outcome Receipt. Явний asset picker, simulation, policy і durable reservation лишаються робочим шляхом.",
  "Every mainnet Send outside that exact proved ATA-create case remains review-only. The general owner canary is still its own gate; the ATA-create proof does not promote another destination, amount or transfer shape.":
    "Кожен mainnet Send поза точним доведеним ATA-create case лишається review-only. General owner canary досі є окремим gate; доказ ATA-create не промотує інший destination, amount або transfer shape.",
  "The general owner canary for other Sends remains separate.":
    "General owner canary для інших Send лишається окремим.",
  "The read adapter, its sources, its published contracts and its refusals.":
    "Read adapter, його джерела, опубліковані контракти та відмови.",
  "Every read this workspace performs, from which endpoint, under which timeout — and the exact things the kit refuses to do. The passport and preflight contracts are published as JSON Schemas generated from the source types, with a parity test that fails on drift.":
    "Кожне читання простору: з якого endpoint і з яким timeout — та точні дії, які kit відмовляється виконувати. Контракти passport і preflight опубліковані як JSON Schema зі source types; parity test падає при drift.",
  "The registry entry, four published schemas, the RPC source table, the refusal list — and the public evidence kit itself, Apache-2.0 at `ryntra-io/ryntra-solana-evidence`.":
    "Registry entry, чотири опубліковані schema, таблиця RPC source, список відмов і сам публічний evidence kit Apache-2.0 у `ryntra-io/ryntra-solana-evidence`.",
  "A package-registry release. The kit is cloned and run from source; nothing is published to npm.":
    "Реліз у package registry. Kit клонують і запускають із source; в npm нічого не опубліковано.",
  "None for the kit — it shipped public. A registry release is its own separate operator decision.":
    "Для kit gate немає — його опубліковано. Реліз у registry потребує окремого рішення оператора.",
  "The same evidence, callable from your own code and readable by an assistant that cannot act on it.":
    "Ті самі докази, доступні з твого коду й читабельні асистентом, який не може діяти.",
  "`inspect_solana_mint`, `preflight_solana_action`, `verify_solana_receipt` — read tools only. An assistant may explain, formalize, compare and review; it never supplies a missing fact, decides a policy, authorizes, signs or executes.":
    "`inspect_solana_mint`, `preflight_solana_action`, `verify_solana_receipt` — лише read tools. Асистент може пояснювати, формалізувати, порівнювати й перевіряти; він не вигадує відсутній факт, не визначає політику, не авторизує, не підписує й не виконує.",
  "The whole kit, public and Apache-2.0 at `ryntra-io/ryntra-solana-evidence`: the typed SDK, the local stdio MCP server, the CLI, the four schemas and a green verify workflow. It holds no key and has no signing path — that is a property of the kit, not a gap in it.":
    "Увесь публічний kit Apache-2.0 у `ryntra-io/ryntra-solana-evidence`: typed SDK, локальний stdio MCP server, CLI, чотири schema та зелений verify workflow. Він не тримає ключа й не має signing path — це властивість kit, а не прогалина.",
  "Nothing in scope. A write tool is not planned: an assistant that could sign is the boundary this kit exists to hold.":
    "У scope нічого не бракує. Write tool не планується: межа kit саме в тому, що асистент не може підписати.",
  "None. The kit is published; a package-registry release is a separate operator decision, not a gate on this module.":
    "Немає. Kit опубліковано; реліз у package registry — окреме рішення оператора, а не gate модуля.",
  "Which network is read, how the owner-canary policy is bounded, and what this workspace structurally cannot do.":
    "Яку мережу читають, як обмежено owner-canary policy і чого простір структурно не може робити.",
  "The endpoint table, the enforced 20 USD owner-canary package with per-family allowlists and durable exposure, the operator emergency stop, and the boundary list. The public page can read policy state and cannot mutate it.":
    "Таблиця endpoint, примусовий owner-canary пакет 20 USD з allowlists для кожної family та durable exposure, emergency stop оператора й список меж. Публічна сторінка читає стан policy й не може його змінити.",
  "Network facts, policy limits, durable ledger boundary, verdict vocabulary and the fail-closed operator switch state.":
    "Факти мережі, limits policy, межа durable ledger, vocabulary verdict і стан fail-closed operator switch.",
  "Nothing in scope for this module.": "У scope цього модуля нічого не бракує.",
  "None.": "Немає.",
  "A mint address is the 32-to-44-character base58 account that defines the token. On Solana the address is the identity; a ticker is somebody's label for it, so this surface never resolves one. Nothing here reads a wallet or moves value.":
    "Адреса mint — це base58 account із 32–44 символів, що визначає token. У Solana саме адреса є ідентичністю; ticker — лише чиясь назва, тому ця поверхня не визначає актив за ticker. Тут нічого не читає wallet і не рухає value.",
  "About this passport": "Про цей паспорт",
  "Anyone opening it re-reads the chain — the link shares the question, not a cached answer.":
    "Кожен, хто відкриє посилання, повторно прочитає chain: посилання передає запит, а не кешовану відповідь.",
  "Bonk — classic SPL memecoin, decoded here for the plain-SPL baseline":
    "Bonk — класичний SPL memecoin, декодований як базовий приклад звичайного SPL",
  "BonkEarn — a Token-2022 mint whose transfer fee reduces what the recipient receives":
    "BonkEarn — mint Token-2022, де transfer fee зменшує суму, яку отримує адресат",
  "CONFLICTING": "СУПЕРЕЧЛИВЕ",
  "Can freeze holdings": "Може заморожувати активи",
  "Circle USDC — classic SPL, mint and freeze authorities present":
    "Circle USDC — класичний SPL, наявні mint і freeze authorities",
  "Classic SPL mints carry no extensions; the decoded layout is the whole story.":
    "Класичні SPL mints не мають extensions; декодована структура містить усі дані.",
  "Computed from this read plus the standing gaps of this release, not written per asset. A field that stops resolving appears here on the next read, and this is the only place a reason is written — no section repeats it.":
    "Список обчислено з поточного читання та відомих прогалин релізу, а не задано окремо для активу. Поле, яке перестало визначатися, з'явиться тут під час наступного читання; причина вказується лише тут і не дублюється.",
  "DERIVED": "ОБЧИСЛЕНЕ",
  "Decimals": "Десяткові знаки",
  "Extension": "Розширення",
  "Extensions, as read": "Розширення за даними читання",
  "Freeze authority": "Freeze authority",
  "Holder concentration": "Концентрація власників",
  "How this list is built": "Як формується цей список",
  "How this list was chosen": "Як обрано цей список",
  "ISSUER DECLARED": "ЗАЯВЛЕНО ЕМІТЕНТОМ",
  "Identity and supply": "Ідентичність і пропозиція",
  "Initialized": "Ініціалізовано",
  "Largest-account reads belong to the scanner.":
    "Читання найбільших accounts належить Scanner.",
  "Mint address": "Адреса mint",
  "Mint authority": "Mint authority",
  "Name, symbol and issuer description": "Назва, символ і опис емітента",
  "No extensions are present on this mint.": "Цей mint не має extensions.",
  "No ticker is shown because the chain does not state one, and this surface does not guess.":
    "Ticker не показано, бо chain його не містить, а поверхня не вгадує.",
  "No venue is read yet. The swap preview brings live quotes, read-only.":
    "Venue ще не читається. Swap preview додає живі котирування лише для читання.",
  "None possible — classic SPL mints carry no extensions.":
    "Неможливо: класичні SPL mints не мають extensions.",
  "None present on this mint.": "На цьому mint немає.",
  "Not a ranking": "Не рейтинг",
  "ONCHAIN VERIFIED": "ПЕРЕВІРЕНО В CHAIN",
  "Off-chain metadata is not read yet. Phase B's data adapters bring it, labelled as the issuer describing itself.":
    "Off-chain metadata ще не читається. Data adapters фази B додадуть її з явною позначкою, що це опис емітента.",
  "Open passport": "Відкрити паспорт",
  "PayPal USD — carries PermanentDelegate, a transfer-fee config, a transfer hook and confidential transfers at once":
    "PayPal USD — одночасно має PermanentDelegate, конфігурацію transfer fee, transfer hook і confidential transfers",
  "Present on chain with no written semantics in this version; reported rather than guessed.":
    "Присутнє в chain без описаної семантики в цій версії; показано без припущень.",
  "Price and liquidity": "Ціна й ліквідність",
  "Program": "Програма",
  "Program id": "ID програми",
  "Read a mint": "Прочитати mint",
  "Read again": "Прочитати знову",
  "Real mainnet mints to start from": "Реальні mainnet mints для початку",
  "Shareable link": "Посилання для поширення",
  "Solana mainnet · read-only": "Solana mainnet · лише читання",
  "Supply": "Пропозиція",
  "Supply in base units": "Пропозиція в базових одиницях",
  "Tether USD — classic SPL, mint and freeze authorities present":
    "Tether USD — класичний SPL, наявні mint і freeze authorities",
  "That is not the shape of a mint address — expected 32 to 44 base58 characters (no 0, O, I or l). Nothing was read.":
    "Це не схоже на адресу mint: очікується 32–44 символи base58 (без 0, O, I та l). Нічого не прочитано.",
  "The adapter reports exactly why a read stopped instead of guessing past it. An address that is not a mint, an account that does not exist, bytes this version cannot decode, and an endpoint that did not answer are four different facts, and each renders as itself.":
    "Adapter точно повідомляє, чому читання зупинилося, і не підміняє прогалину припущенням. Адреса не є mint, account не існує, bytes не декодуються цією версією та endpoint не відповів — це чотири різні факти, і кожен показується окремо.",
  "The chain stores an integer of base units; the decimal form is that same integer with the point placed, computed exactly — never rounded, never floated.":
    "Chain зберігає ціле число базових одиниць; десяткова форма є тим самим числом із точно поставленою крапкою — без округлення і floating-point.",
  "The mint account's own authorities and extensions are enforced by the token program, not claimed by anyone. They are read on each visit, and a power the issuer holds is shown as a caution whichever way it points.":
    "Authorities і extensions самого mint account примусово виконуються token program, а не є чиєюсь заявою. Вони читаються під час кожного візиту; повноваження емітента завжди показується як застереження.",
  "The read stopped. The exact adapter reason follows:": "Читання зупинено. Точна причина adapter:",
  "The ticker shown is a label from this site's starting list, not something the chain states.":
    "Показаний ticker є назвою зі стартового списку сайту, а не фактом із chain.",
  "These are the six real mints whose raw account bytes were captured live from mainnet as this product's test fixtures — chosen because together they exercise every consequential case, from a plain SPL mint to PYUSD's permanent delegate. Each line states what the mint is — never whether it is good.":
    "Це шість реальних mints, raw account bytes яких були зняті з mainnet як test fixtures продукту. Разом вони охоплюють усі суттєві випадки — від звичайного SPL mint до permanent delegate у PYUSD. Кожен рядок описує, чим є mint, а не оцінює його.",
  "This mint could not be read": "Цей mint не вдалося прочитати",
  "Token program": "Token program",
  "Token-2022 attaches behaviour to a mint as typed extensions. Each one here is decoded from the account's own bytes and carries what kind of claim it is; one this version cannot decode is reported as unsupported rather than guessed at.":
    "Token-2022 додає поведінку mint через типізовані extensions. Кожне з них декодується з bytes самого account і має тип твердження; те, що ця версія не може декодувати, позначається unsupported без припущень.",
  "Transfer-affecting extensions": "Extensions, що впливають на переказ",
  "UNSUPPORTED": "НЕ ПІДТРИМУЄТЬСЯ",
  "What a refusal means": "Що означає відмова",
  "What an extension is": "Що таке extension",
  "What counts as an identity": "Що вважається ідентичністю",
  "What it is": "Що це",
  "What the issuer can do to what you hold": "Що емітент може зробити з твоїми активами",
  "What this mint structurally is, who controls it, and what is not known — every field was read from the chain this visit and carries its claim type.":
    "Структура mint, хто ним керує та що невідомо: кожне поле прочитано з chain під час цього візиту й має позначений тип твердження.",
  "What we do not know": "Чого ми не знаємо",
  "Where these powers come from": "Звідки походять ці повноваження",
  "Why supply is stated twice": "Чому пропозицію вказано двічі",
  "Native SOL, traded through its SPL wrapper — the swap wraps and unwraps around the trade, and the balance shown is your native SOL. No mint authority":
    "Нативний SOL, торгується через свій SPL wrapper — swap загортає і розгортає його навколо угоди, а показаний баланс є твоїм нативним SOL. Без mint authority",
  "decimal places": "десяткових знаків",
  "observed": "спостережено",
  "open": "відкрито",
  "passport": "паспорт",
  "present": "наявні",

  "Every transfer is taxed: the issuer takes a configured fee out of the amount, so the recipient receives less than was sent.":
    "Кожен переказ оподатковується: емітент утримує налаштовану fee із суми, тому отримувач одержує менше, ніж було надіслано.",
  "The issuer's delegate can move or burn tokens from any holder's account without the holder's approval — custody is shared with the issuer by construction.":
    "Delegate емітента може переміщати або спалювати tokens із account будь-якого власника без його згоди — custody конструктивно розділена з емітентом.",
  "A separate program runs on every transfer and can add its own rules or refusals; what it does is that program's code, not this mint's data.":
    "Окрема program виконується під час кожного переказу й може додавати власні правила або відмови; її поведінку визначає code цієї program, а не дані mint.",
  "New token accounts can start frozen: receiving the token does not yet mean being able to move it until the issuer thaws the account.":
    "Нові token accounts можуть бути заморожені відразу: отримання token ще не означає можливість переміщувати його, доки емітент не розморозить account.",
  "Tokens cannot be transferred at all once received — this asset is bound to the account that holds it.":
    "Після отримання tokens узагалі не можна переказувати — актив прив'язаний до account, що його утримує.",
  "The issuer can pause the whole token: while paused, transfers stop for every holder at once.":
    "Емітент може призупинити весь token: під час паузи перекази зупиняються для всіх власників одночасно.",
  "Confidential transfers are configured: amounts can move encrypted, under the issuer's auditor settings.":
    "Налаштовано confidential transfers: суми можуть переміщуватися зашифрованими відповідно до auditor settings емітента.",
  "The issuer can mint and burn confidentially — supply changes are not publicly readable per operation.":
    "Емітент може confidentially mint і burn — зміни supply не читаються публічно для кожної операції.",
  "Fees on confidential transfers are configured and collected under the issuer's fee authority.":
    "Fees для confidential transfers налаштовані й збираються під контролем fee authority емітента.",
  "An authority may close this mint account entirely once its supply is zero.":
    "Authority може повністю закрити цей mint account, коли його supply дорівнює нулю.",
  "Displayed balances accrue interest by configuration; the on-chain raw amount and the shown amount differ by the accrual math.":
    "Відображені balances нараховують відсотки за конфігурацією; on-chain raw amount і показана сума відрізняються через формулу нарахування.",
  "Displayed balances are multiplied by an issuer-set factor that can change; the raw amount and the shown amount are different numbers.":
    "Відображені balances множаться на змінний коефіцієнт емітента; raw amount і показана сума є різними числами.",
  "Points at the account that holds this token's metadata — identity comes from wherever this points.":
    "Вказує на account із metadata цього token — ідентичність походить із адреси, на яку він посилається.",
  "Name, symbol and URI are stored on the mint itself and controlled by the metadata update authority.":
    "Name, symbol і URI зберігаються на самому mint та контролюються metadata update authority.",
  "Points at a token-group definition this mint belongs to or defines.":
    "Вказує на визначення token group, до якої належить цей mint або яку він визначає.",
  "Points at this mint's membership record inside a token group.":
    "Вказує на запис членства цього mint у token group.",
  "This mint defines a token group.": "Цей mint визначає token group.",
  "This mint is a member of a token group.": "Цей mint є членом token group.",
  "A configured authority can burn tokens under permissioned rules.":
    "Налаштована authority може burn tokens за permissioned rules.",
  "Withheld transfer fees ledger.": "Ledger утриманих transfer fees.",
  "Transfer-hook per-account state.": "Стан transfer hook для окремого account.",
  "Confidential-transfer per-account state.": "Стан confidential transfer для окремого account.",
  "Confidential fee per-account ledger.": "Ledger confidential fee для окремого account.",
  "Incoming transfers to this account must carry a memo.": "Вхідні перекази на цей account повинні містити memo.",
  "Blocks certain cross-program actions on this account.": "Блокує певні cross-program дії на цьому account.",
  "The account's owner can never be changed.": "Власника account неможливо змінити.",
  "Per-account marker of a non-transferable token.": "Маркер non-transferable token для окремого account.",
  "Per-account marker of a pausable token.": "Маркер pausable token для окремого account.",
  "An uninitialized extension slot.": "Неініціалізований slot extension.",
  "No mint authority: the supply is fixed and nobody can mint more.":
    "Mint authority немає: supply фіксована, і ніхто не може створити більше tokens.",
  "No freeze authority: nobody can freeze holders' token accounts.":
    "Freeze authority немає: ніхто не може заморозити token accounts власників.",
  "This authority can mint new tokens and change the supply.":
    "Ця authority може mint нові tokens і змінювати supply.",
  "This authority can freeze any holder's token account.":
    "Ця authority може заморозити token account будь-якого власника.",
  "Total raw supply at the observed slot, in base units.":
    "Загальна raw supply у спостереженому slot, у базових одиницях.",
  "The mint is initialized.": "Mint ініціалізовано.",
  "The mint account exists but is not initialized.": "Mint account існує, але не ініціалізований.",
  "No transfer-hook program is set, so nothing extra runs on a transfer today; the hook authority can install one, and it would then run on every transfer.":
    "Transfer-hook program не задано, тому зараз під час переказу нічого додаткового не виконується; hook authority може її встановити, після чого вона запускатиметься для кожного переказу.",
  "A transfer fee is configured at zero, so the recipient currently receives the full amount; the fee authority can raise it, and the new rate applies from the epoch it names.":
    "Transfer fee налаштована на нуль, тому зараз отримувач одержує повну суму; fee authority може її підвищити, і нова ставка діятиме з указаного epoch.",
  "Access": "Доступ",
  "Answered in": "Час відповіді",
  "Anyone opening it gets a fresh order — the link shares the question, not this answer.":
    "Кожен, хто відкриє посилання, отримає новий order: посилання передає запит, а не цю відповідь.",
  "Asking again is a new quote, not a retry of this one — reload to re-ask.":
    "Повторний запит створює нове котирування, а не повторює це; перезавантаж сторінку, щоб запитати знову.",
  "Asks Jupiter for a live mainnet quote, read-only, and judges what receiving the output token would subject any holder to. Both mints are re-read from the chain on every quote. Nothing here can sign or execute, and no wallet is asked for.":
    "Запитує в Jupiter живе котирування mainnet лише для читання та оцінює наслідки отримання вихідного token для будь-якого власника. Обидва mints повторно читаються з chain для кожного котирування. Тут нічого не підписує, не виконує й не запитує wallet.",
  "Base signature fee": "Базова fee підпису",
  "Both sides need a mint address — 32 to 44 base58 characters. Nothing was read.":
    "Для обох сторін потрібна адреса mint із 32–44 символів base58. Нічого не прочитано.",
  "Checking the Review window": "Перевіряється вікно Review",
  "Choose keyed production or the explicitly labelled keyless fallback.":
    "Обери production із ключем або явно позначений fallback без ключа.",
  "Chosen route": "Обраний маршрут",
  "Coverage": "Покриття",
  "Default pair": "Типова пара",
  "Each exercises a different consequence: a plain large-cap pair, a pair whose output carries a permanent delegate the review policy refuses, and a long-tail pair. What they are, never whether they are good.":
    "Кожна пара перевіряє інший наслідок: звичайну large-cap пару, пару з permanent delegate у вихідному активі, яку policy відхиляє, і long-tail пару. Описується, чим вони є, а не чи вони добрі.",
  "Enter an amount to quote.": "Введи суму для котирування.",
  "Estimated receive": "Орієнтовне отримання",
  "Evaluated": "Оцінено",
  "Explicit keyless degraded": "Явний degraded-доступ без ключа",
  "Fees": "Комісії",
  "Fresh for Review until": "Актуальне для Review до",
  "Get quote": "Отримати котирування",
  "Hop": "Крок",
  "Jupiter Swap API V2, rendered as the fields it produced. Raw token amounts remain strings and are scaled only with each mint's on-chain decimals. Ryntra adds a fifteen-second Review window; it never invents a provider expiry.":
    "Jupiter Swap API V2 показано через поля, які повернув провайдер. Raw token amounts лишаються рядками й масштабуються лише за on-chain decimals кожного mint. Ryntra додає 15-секундне вікно Review і не вигадує provider expiry.",
  "Jupiter USD estimate": "Оцінка Jupiter у USD",
  "Jupiter platform fee": "Platform fee Jupiter",
  "Jupiter total and platform fee are distinct provider fields. `/order` does not separately quote a route/provider amount, so it stays unknown. Ryntra sends no referral or integrator fee and never hides a spread inside the price.":
    "Total fee і platform fee Jupiter є окремими полями провайдера. `/order` не котирує route/provider fee окремо, тому вона лишається невідомою. Ryntra не надсилає referral чи integrator fee й не приховує spread у ціні.",
  "Jupiter total fee": "Загальна fee Jupiter",
  "Keyed V2": "V2 із ключем",
  "Keyed production": "Production із ключем",
  "Keyless degraded": "Degraded без ключа",
  "Keyless degraded access · Review unavailable. Choose production and ask for a new quote.":
    "Degraded-доступ без ключа · Review недоступний. Обери production і запроси нове котирування.",
  "Lower rate limit · not production access · Review unavailable.":
    "Нижчий rate limit · не production-доступ · Review недоступний.",
  "Managed order": "Керований order",
  "Minimum received": "Мінімальне отримання",
  "No route, a refused request, a rate limit and an unreachable endpoint are four different facts, and each renders as itself — with the venue's own error code when it sent one. Nothing is served from a cached quote.":
    "Відсутній route, відхилений запит, rate limit і недоступний endpoint — чотири різні факти; кожен показується окремо разом із error code venue, якщо він був. Кешоване котирування не підставляється.",
  "None · no referral or integrator parameter was sent.":
    "Немає · параметр referral чи integrator не надсилався.",
  "Not a recommendation": "Не рекомендація",
  "Not quoted": "Не котирується",
  "Not separately quoted by `/order`.": "Не котирується окремо в `/order`.",
  "Opened without a pair, this page quotes the first of the three below so the numbers and the verdict are on screen rather than behind a button. It is a default, not a recommendation. Change either side, or pick another pair, and the quote is re-read.":
    "Якщо сторінку відкрито без пари, вона котирує першу з трьох нижче, щоб числа й verdict були одразу на екрані. Це типове значення, а не рекомендація. Зміни будь-яку сторону або обери іншу пару — котирування буде прочитано знову.",
  "Order reference": "Reference order",
  "Other pairs": "Інші пари",
  "Passports": "Паспорти",
  "Price impact, as Jupiter states it": "Price impact за даними Jupiter",
  "Priority fee": "Priority fee",
  "Provider / route fee": "Fee провайдера / маршруту",
  "Provider access": "Доступ до провайдера",
  "Provider returned no route rows.": "Провайдер не повернув жодного рядка route.",
  "Quote a swap": "Отримати swap-котирування",
  "Quote expired": "Котирування прострочене",
  "Quote freshness": "Актуальність котирування",
  "Quote only": "Лише котирування",
  "Real pairs to start from": "Реальні пари для початку",
  "Refresh for a new quote": "Оновити для нового котирування",
  "Rent": "Rent",
  "Review binding": "Прив'язка Review",
  "Review stopped. The exact preflight reason follows:": "Review зупинено. Точна причина preflight:",
  "Route": "Маршрут",
  "Source split": "Розподіл джерел",
  "Balance": "Баланс",
  "Allowed": "Дозволено",
  "Read over the mint you would receive, this visit. The engine has no word for safe.": "Прочитано щодо мінта, який ти отримаєш, цього візиту. Рушій не має слова «безпечно».",
  "Every rule and its evidence": "Усі правила та їхні докази",
  "Use the full spendable balance": "Взяти весь доступний баланс",
  "Shares are provider-reported per leg and do not total 100%, so these legs are sequential rather than a parallel split. No bar is drawn for a total Ryntra cannot verify.": "Частки надає провайдер окремо для кожної гілки, і разом вони не дають 100%: отже гілки послідовні, а не паралельний розподіл. Смугу не намальовано, бо Ryntra не може підтвердити цю суму.",
  "Route-affecting options": "Опції, що впливають на маршрут",
  "Router / mode": "Router / режим",
  "Ryntra fee": "Комісія Ryntra",
  "Separated": "Розділено",
  "A signature exists only in the owner-canary console, under the canary budget, and every submit is one-shot with recovery by signature.":
    "Підпис існує лише в owner-canary консолі, в межах canary-бюджету, і кожен submit одноразовий з відновленням лише за підписом.",
  "Solana mainnet · quote evidence only": "Solana mainnet · лише evidence котирування",
  "Swap preview": "Попередній перегляд swap",
  "Swap type": "Тип swap",
  "The Jupiter credential is server-only environment configuration. It is never rendered, returned, placed in a URL or sent to another origin. A production failure never triggers keyless access automatically.":
    "Credential Jupiter є server-only конфігурацією environment. Він ніколи не рендериться, не повертається, не потрапляє в URL і не надсилається на інший origin. Production failure ніколи автоматично не вмикає доступ без ключа.",
  "The exact ticket": "Точний ticket",
  "The mint you pay with could not be read": "Mint для оплати не вдалося прочитати",
  "The mint you would receive could not be read": "Mint для отримання не вдалося прочитати",
  "The output review could not be built": "Review вихідного активу не вдалося побудувати",
  "The swap owner canary is active: the execute path exists, and it opens only in the console below — a fresh taker order, the exact-bytes firewall, a simulation, the canary policy verdict, a visible wallet signature, one execute and an independently observed Swap Receipt. This shareable ticket itself stays quote evidence.":
    "Swap owner canary активна: шлях виконання існує і відкривається лише в консолі нижче — свіжий taker order, firewall точних байтів, симуляція, verdict canary-політики, видимий підпис гаманця, одне виконання і незалежно спостережена Swap-квитанція. Сам цей shareable ticket залишається evidence котирування.",
  "Owner canary gated": "За owner canary",
  "Owner canary — one signed swap": "Owner canary — один підписаний swap",
  "Swap canary · operator signature only": "Swap canary · лише підпис оператора",
  "real funds": "реальні кошти",
  "Connect the owner wallet to ask for an executable order. Nothing signs without your visible confirmation.":
    "Підключи гаманець власника, щоб запросити виконуваний order. Ніщо не підписується без твого видимого підтвердження.",
  "No Wallet Standard wallet is registered in this browser.":
    "У цьому браузері не зареєстровано жодного гаманця Wallet Standard.",
  "Swap direction": "Напрям swap",
  "Asking Jupiter…": "Запит до Jupiter…",
  "Request executable order": "Запросити виконуваний order",
  "Review exact transaction": "Перевірити точну транзакцію",
  "Exact executable Review": "Точний виконуваний Review",
  "Confirm exact Review in wallet": "Підтвердити точний Review у гаманці",
  "Exact Review expired": "Точна «Перевірка» прострочена",
  "Cancel expired Review": "Скасувати прострочений Review",
  "Checking exact blockhash…": "Перевірка точного blockhash…",
  "Proof": "Доказ",
  "Owner effects": "Ефекти для власника",
  "Recovery required": "Потрібне відновлення",
  "Recover by signature": "Відновити за підписом",
  "Ask for a fresh order": "Запросити новий ордер",
  "Swapped": "Обміняно",
  "Ready to sign": "Готово до підпису",
  "You receive at least": "Ти отримаєш щонайменше",
  "Network cost": "Вартість мережі",
  "These exact bytes were decoded, simulated and proved to move only what is shown here. Your wallet signs them next.":
    "Саме ці bytes розібрано, симульовано й доведено, що вони рухають лише показане тут. Далі їх підписує твій wallet.",
  "Exact bytes checked": "Перевірені точні bytes",
  "The Review was built again — its bytes live about 30 seconds. Check it and sign.":
    "Review зібрано наново — його bytes живуть близько 30 секунд. Перевір і підпиши.",
  "The transaction was built again — its bytes live about 30 seconds. Nothing left your wallet; check the fresh Review and sign.":
    "Транзакцію зібрано наново — її bytes живуть близько 30 секунд. Нічого не пішло з гаманця; перевір свіжий Review і підпиши.",
  "Your wallet answered after these bytes stopped living (about 30 seconds). Nothing was sent. Here is a fresh Review — check it and sign.":
    "Гаманець відповів пізніше, ніж живуть ці bytes (близько 30 секунд). Нічого не надіслано. Ось свіжий Review — перевір і підпиши.",
  "Your wallet answered after the price stopped holding (about 30 seconds). Nothing was sent. Check the new figures and confirm.":
    "Гаманець відповів пізніше, ніж тримається ціна (близько 30 секунд). Нічого не надіслано. Перевір нові цифри й підтверди.",
  "The price moved past what you reviewed. Nothing was sent. Check the new figures and confirm.":
    "Ціна вийшла за межі переглянутого. Нічого не надіслано. Перевір нові цифри й підтверди.",
  "A newer Review for this wallet replaced this one. Nothing was sent. Get a new quote to continue here.":
    "Новіший перегляд для цього гаманця замінив цей. Нічого не надіслано. Онови котирування, щоб продовжити тут.",
  "The price moved while you read. The figures above are new — check them before you confirm.":
    "Ціна змінилась під час читання. Цифри вище — нові, перевір їх перед підтвердженням.",
  "Check the new figures": "Перевір нові цифри",
  "The price was refreshed while you read. The figures above are the ones your wallet will show.":
    "Ціну оновлено під час читання. Цифри вище — ті, що покаже гаманець.",
  "Price refreshed at signing. The figures above are the ones your wallet shows.":
    "Ціну оновлено в мить підпису. Цифри вище — ті, що показує гаманець.",
  "The bytes were built again at the moment of signing, and a figure changed. Check the fresh Review and sign.":
    "У мить підпису bytes зібрано наново, і одна з цифр змінилась. Перевір свіжий Review і підпиши.",
  "Your wallet did not answer before this Review's window closed. Nothing was signed or sent; ask for a fresh order.":
    "Твій wallet не відповів до закриття вікна цього Review. Нічого не підписано й не надіслано; запроси новий ордер.",
  "The Review window closed while your wallet was open. That signature was never sent and cannot be — ask for a fresh order and sign that one.":
    "Вікно Review закрилося, поки твій wallet був відкритий. Той підпис не надсилали й надіслати не можна — запроси новий ордер і підпиши його.",
  "An earlier Review for this wallet is still open. It is released as soon as its bytes can no longer reach the chain, and a fresh order follows.":
    "Попередній Review для цього гаманця ще відкритий. Він звільняється, щойно його bytes більше не зможуть потрапити в chain, і одразу готується новий ордер.",
  "This quote's window closed. A stale quote never reaches a signature, so the next one is asked for fresh.":
    "Вікно цього котирування закрилося. Застаріле котирування ніколи не доходить до підпису, тож наступне запитується заново.",
  "Set on the exact order, from the venue's own slippage estimate":
    "Встановлюється на точному ордері, за власною оцінкою slippage майданчика",
  "Priced on the exact order": "Оцінюється на точному ордері",
  "Your wallet returned a different transaction than the one reviewed. Nothing was submitted, and it could not be: this venue's execute lane accepts only the exact order it built.":
    "Твій wallet повернув іншу транзакцію, ніж переглянута. Нічого не надіслано — і не могло бути: lane виконання цього майданчика приймає лише той самий ордер, який він побудував.",
  "The transaction you approved can still reach the chain, so a second one cannot be prepared yet. This clears itself when the blockhash expires — try again in a moment.":
    "Підтверджена тобою транзакція ще може потрапити в chain, тож другу поки не можна підготувати. Це минає само, щойно blockhash застаріє — спробуй за мить.",
  "Your wallet did not return the reviewed transaction, so nothing was submitted. A fresh order is prepared as soon as the one you approved can no longer reach the chain.":
    "Твій wallet не повернув переглянуту транзакцію, тож нічого не надіслано. Новий ордер готується, щойно підтверджена тобою транзакція більше не зможе потрапити в chain.",
  "This Review's window closed before it was signed. Nothing was submitted; the next one starts clean.":
    "Вікно цього Review закрилося до підпису. Нічого не надіслано; наступний починається з чистого аркуша.",
  "Signed attempt recorded": "Підписану спробу записано",
  "Reading both assets…": "Читаємо обидва активи…",
  "Search by name, ticker or mint address": "Пошук за назвою, тікером або адресою mint",
  "Search by name, ticker or address": "Пошук за назвою, тікером або адресою",
  "Unverified": "Не підтверджено",
  "These are search results, not checked or recommended assets. Several tokens can share a ticker — match the address.":
    "Це результати пошуку, а не перевірені чи рекомендовані активи. Кілька токенів можуть мати однаковий тікер — звіряй адресу.",
  "Start typing to search every mainnet asset, or pick one below.":
    "Почни вводити, щоб шукати серед усіх активів mainnet, або обери один зі списку нижче.",
  "Named by Jupiter's catalogue. Verified and flagged are its claims, not Ryntra's — and every mint you pick is re-read from the chain before any quote.":
    "Назви з каталогу Jupiter. «Перевірено» і «Позначено» — це його твердження, не Ryntra; кожен обраний mint перечитується з chain перед будь-яким quote.",
  "Verified": "Перевірено",
  "Flagged": "Позначено",
  "Searching…": "Шукаємо…",
  "No asset matched that search.": "Жоден актив не збігся з пошуком.",
  "Reading the signature…": "Читання підпису…",
  "Owner canary attempt recorded": "Спробу owner canary зафіксовано",
  "First build and inspect the executable order. The wallet opens only after you review that exact order on this card.":
    "Спочатку побудуй і перевір виконуваний order. Гаманець відкриється лише після перегляду саме цього order на картці.",
  "This second action approves the exact order shown above. One submit; recovery only by signature.":
    "Ця друга дія схвалює точний order, показаний вище. Один submit; відновлення лише за підписом.",
  "This signed attempt locks the card. Recover or verify by its signature; never create a second order from an unknown result.":
    "Ця підписана спроба блокує картку. Відновлюй або перевіряй за її підписом; ніколи не створюй другий order з невідомого результату.",
  "This signed attempt locks the card. Recovery performs independent reads only; it never submits transaction bytes.":
    "Ця підписана спроба блокує картку. Recovery виконує лише незалежні читання й ніколи не надсилає байти транзакції.",
  "The server's durable owner lock holds the exact proof. Recovery performs independent reads only; it never submits transaction bytes.":
    "Durable owner lock на сервері зберігає точний proof. Recovery виконує лише незалежні читання й ніколи не надсилає байти транзакції.",
  "The exact executable order is no longer fresh.":
    "Точний виконуваний order більше не є свіжим.",
  "Owner cancellation succeeds only after an independent RPC reports the exact issued blockhash invalid.":
    "Скасування власником спрацює лише після того, як незалежний RPC підтвердить недійсність точного виданого blockhash.",
  "The wallet signature could not be recorded. Nothing was submitted.":
    "Підпис гаманця не вдалося зафіксувати. Нічого не було надіслано.",
  "The execute answer is unknown. Recover only by this signature; never request or sign another order.":
    "Відповідь execute невідома. Відновлюй лише за цим підписом; ніколи не запитуй і не підписуй інший order.",
  "The independent operator has not observed this signature yet.":
    "Незалежний оператор ще не спостерігав цей підпис.",
  "The durable ledger already records this Receipt hash; no transaction was submitted again.":
    "Durable ledger уже зберігає hash цієї Receipt; жодну транзакцію повторно не надсилали.",
  "A signed swap attempt is already recorded. Recover or verify it by signature before any new order.":
    "Підписану спробу swap уже зафіксовано. Віднови або перевір її за підписом до будь-якого нового order.",
  "Quoted out": "Котирований вихід",
  "Price impact": "Вплив на ціну",
  "Review window": "Вікно Review",
  "Expired": "Прострочено",
  "Firewall": "Firewall",
  "instructions": "інструкцій",
  "message": "повідомлення",
  "Every canary rule passed on the current budget snapshot.":
    "Кожне правило canary пройдено на поточному знімку бюджету.",
  "Waiting for the wallet…": "Очікування гаманця…",
  "Executing once…": "Виконання, один раз…",
  "Sign in the wallet · execute once": "Підписати в гаманці · виконати один раз",
  "Your visible wallet confirmation is the recorded human approval. One submit; recovery only by signature.":
    "Твоє видиме підтвердження в гаманці — це зафіксоване людське схвалення. Один submit; відновлення лише за підписом.",
  "The order expired before a signature. Ask for a fresh executable order; nothing was signed or submitted.":
    "Order прострочився до підпису. Запроси свіжий виконуваний order; ніщо не було підписано чи надіслано.",
  "The wallet returned different bytes than the reviewed message. Nothing was submitted; ask for a fresh order.":
    "Гаманець повернув інші байти, ніж перевірене повідомлення. Ніщо не було надіслано; запроси свіжий order.",
  "Open in explorer": "Відкрити в explorer",
  "Open verifier": "Відкрити verifier",
  "The receipt preserves a reconciliation deviation":
    "Квитанція зберігає відхилення reconciliation",
  "The outcome is not resolved yet. The signature is never submitted again; it is read until the chain answers.":
    "Результат ще не з'ясовано. Підпис ніколи не надсилається вдруге; його читають, доки ланцюг не відповість.",
  "Receipt facts were withheld": "Факти квитанції не видано",
  "Slippage": "Сліпедж",
  "Evidence & sharing": "Evidence і поширення",
  "fresh for Review until": "свіже для Review до",
  "All rules, with evidence": "Усі правила, з evidence",
  "All thirteen rules passed on this read. Every rule and its evidence is below.":
    "Усі тринадцять правил пройдено на цьому читанні. Кожне правило і його evidence — нижче.",
  "Exact mints — advanced": "Точні mints — advanced",
  "Every hop": "Кожен hop",
  "The quote stopped. The exact provider reason follows:": "Котирування зупинено. Точна причина провайдера:",
  "The two sides are the same mint; there is nothing to swap.":
    "Обидві сторони мають однаковий mint; обмінювати нічого.",
  "The venue did not quote this": "Venue не надало котирування",
  "The workspace's own review policy, evaluated by the tested engine over the output mint as read this visit: permanent delegates and transfer hooks are refused, fees above 1% are refused, and the ladder bottoms out at NO KNOWN BLOCKER — the engine has no word for safe. An owner-editable policy console is registered for a later packet.":
    "Власна review policy простору оцінюється протестованим engine над вихідним mint, прочитаним під час цього візиту: permanent delegates і transfer hooks відхиляються, fees понад 1% відхиляються, а найнижчий verdict — NO KNOWN BLOCKER; engine не має слова safe. Редагована власником policy console зареєстрована для пізнішого пакета.",
  "This ticket is not executed. It is fresh provider evidence plus chain Passports and a policy result. When the Review window expires,":
    "Цей ticket не виконується. Це свіже evidence провайдера, chain Passports і результат policy. Коли вікно Review спливе,",
  "Use labelled keyless fallback": "Використати позначений fallback без ключа",
  "Venue access": "Доступ до venue",
  "What is and is not a fee": "Що є fee, а що ні",
  "What receiving it subjects you to": "Які наслідки має отримання",
  "What this form does": "Що робить ця форма",
  "What this route means": "Що означає цей маршрут",
  "Where the credential lives": "Де зберігається credential",
  "Whose numbers these are": "Чиї це числа",
  "Whose policy this is": "Чия це policy",
  "Why execution is a separate console": "Чому виконання — окрема консоль",
  "Why these three": "Чому саме ці три",
  "You pay": "Ти платиш",
  "You pay (mint)": "Ти сплачуєш (mint)",
  "You receive (mint)": "Ти отримуєш (mint)",
  "`/order` is the managed Meta-Aggregator path. The quote request asks without taker, payer, referral, custom slippage or excluded routers, so it receives quote evidence and no transaction. `/build` is typed for the later allowlist path but has no network caller.":
    "`/order` є керованим шляхом Meta-Aggregator. Запит котирування йде без taker, payer, referral, custom slippage чи excluded routers, тому отримує evidence котирування без транзакції. `/build` типізовано для пізнішого allowlist-шляху, але він не має network caller.",
  "asset transfer fee": "transfer fee активу",
  "bps per transfer": "bps за переказ",
  "cap applied": "cap застосовано",
  "mint evidence, not a Jupiter fee": "evidence mint, не fee Jupiter",
  "not stated": "не вказано",
  "payer": "платник",
  "provider-derived": "обчислено провайдером",
  "quote": "котирування",
  "ALLOWED": "ДОЗВОЛЕНО",
  "BLOCKED": "ЗАБЛОКОВАНО",
  "INCOMPLETE": "НЕПОВНЕ",
  "REVIEW REQUIRED": "ПОТРІБЕН REVIEW",
  "NO KNOWN BLOCKER": "НЕМАЄ ВІДОМОГО БЛОКЕРА",
  "Address": "Адреса",
  "An authorization is open in your wallet. Nothing proceeds until you answer it.":
    "У твоєму гаманці відкрито запит на авторизацію. Нічого не продовжиться, доки ти не відповіси.",
  "Choose a wallet": "Обери гаманець",
  "Connect": "Підключити",
  "Connecting only reads your wallet's balances. Nothing is signed until you approve the exact transaction.":
    "Підключення лише читає баланси гаманця. Нічого не підписується, доки ти не схвалиш саме цю транзакцію.",
  "Connecting…": "Підключаємо…",
  "Connection": "Підключення",
  "Copied": "Скопійовано",
  "Copy address": "Скопіювати адресу",
  "Disconnect": "Від'єднати",
  "Mainnet": "Мейннет",
  "Manage connections": "Керувати підключеннями",
  "No SPL or Token-2022 balance on this address.": "На цій адресі немає balance SPL або Token-2022.",
  /* A browser with no wallet at all, and the way on. */
  "No wallet in this browser": "У цьому браузері немає гаманця",
  "On a phone, Ryntra opens inside your wallet app.": "На телефоні Ryntra відкривається всередині застосунку гаманця.",
  "Install Phantom, Solflare or Backpack, then reload this page.": "Встанови Phantom, Solflare або Backpack і онови сторінку.",
  /* B14: the header's panel with no wallet in the browser. */
  "Open in Solflare": "Відкрити в Solflare",
  "On a Seeker? Connect with Seeker": "Маєш Seeker? Підключи через Seeker",
  "Seeker didn't answer. This button opens the wallet on a Seeker phone; on another phone, open Ryntra in Phantom or Solflare.":
    "Seeker не відповів. Ця кнопка відкриває гаманець на телефоні Seeker; на іншому телефоні відкрий Ryntra у Phantom чи Solflare.",
  "Install Solflare": "Встановити Solflare",
  "Install Backpack": "Встановити Backpack",
  "Installed already? Reload the page": "Уже встановлено? Онови сторінку",
  "Open in Phantom": "Відкрити в Phantom",
  "Install Phantom": "Встановити Phantom",
  /* «Простий»'s empty Portfolio: a guest, and a wallet with nothing yet. */
  "Connect a wallet — your assets and positions will be here.": "Підключи гаманець — тут будуть твої активи й позиції.",
  "Top up — and make your first buy.": "Поповни — і зроби першу купівлю.",
  "Top up": "Поповнити",
  "Take your time. This review refreshes itself in": "Читай спокійно. Цей огляд оновить себе через",
  "rebuilding": "перебудовуємо",
  "The money arrived on Base.": "Гроші прийшли на Base.",
  "Base has accepted this transfer — the message is spent, so the money is there. The transaction that did it was not found in the range read, because anyone may relay it. Widen the search or read the recipient's balance on Base.": "Base прийняв цей переказ — повідомлення витрачено, отже гроші там. Транзакцію, яка це зробила, не знайдено в прочитаному діапазоні, бо відправити її міг будь-хто. Розшир пошук або прочитай баланс отримувача на Base.",
  "Base has not received this transfer yet. Nothing is lost; the message is still waiting to be used.": "Base ще не отримав цей переказ. Нічого не втрачено, повідомлення чекає на використання.",
  "Base could not be read just now. Nothing changed on either chain — this is a read, and it can be repeated.": "Base зараз не вдалося прочитати. В обох мережах нічого не змінилось — це читання, його можна повторити.",
  "The answer from Base could not be understood, so nothing is claimed about where the money is. Try the read again.": "Відповідь Base не вдалося зрозуміти, тому про місцезнаходження грошей нічого не стверджується. Спробуй прочитати ще раз.",
  "Base returned a state this page does not recognise, so nothing is claimed about where the money is.": "Base повернув стан, якого ця сторінка не знає, тому про місцезнаходження грошей нічого не стверджується.",
  "Speed and fees": "Швидкість і комісії",
  "chosen": "обрано",
  "not used for this transfer": "не використовується для цього переказу",
  "and Circle signs before Solana finalises, so it arrives sooner. It still takes minutes, and Circle can refuse it once the allowance is spent.": "і Circle підписує до фіналізації в Solana, тому приходить швидше. Це все одно хвилини, і Circle може відмовити, коли ліміт вичерпано.",
  "and Circle signs once Solana finalises.": "і Circle підписує після фіналізації в Solana.",
  "Circle did not answer for its fee tiers, so only the chosen speed above is known.": "Circle не відповів про свої тарифи, тому відома лише обрана швидкість вище.",
  "Fast allowance left at Circle": "Залишок ліміту Fast у Circle",
  "Cost on Base": "Вартість на Base",
  "Receiving is a second transaction you send on Base and pay for in ETH. Its gas is read at that step, so it is not part of the total above.": "Отримання це друга транзакція, яку ти надсилаєш на Base і оплачуєш в ETH. Її газ читається на тому кроці, тому він не входить у суму вище.",
  "No mainnet endpoint answered, so balances are unknown rather than zero.":
    "Жоден mainnet endpoint не відповів, тому balances невідомі, а не нульові.",
  "Not connected": "Не підключено",
  "Open the wallet extension and answer the request waiting there. Nothing new can be sent until that one is closed.":
    "Відкрий extension wallet і дай відповідь на запит, що очікує там. Новий запит не можна надіслати, доки цей не закрито.",
  "Prove ownership": "Підтверджувати володіння",
  "Read balances": "Читати balances",
  "Read from": "Прочитано з",
  "Reading…": "Читання…",
  "Sign authorizations": "Підписувати авторизації",
  "Sign transactions": "Підписувати транзакції",
  "Solana Mainnet": "Solana Mainnet",
  "Switch network": "Змінити мережу",
  "Switch to": "Перейти на",
  "Switch to continue.": "Зміни мережу, щоб продовжити.",
  "The wallet did not connect": "Wallet не підключився",
  "The wallet refused": "Wallet відхилив запит",
  "This connection can": "Це підключення може",
  "This workspace works on": "Цей простір працює в",
  "Try again": "Спробувати знову",
  "Unavailable": "Недоступно",
  "Unknown": "Невідомо",
  "View on explorer": "Відкрити в explorer",
  "Waiting for you": "Очікуємо на тебе",
  "Waiting…": "Очікування…",
  "Wallet": "Гаманець",
  "Pools": "Пули",
  "In orders": "В ордерах",
  "Phoenix collateral": "Застава Phoenix",
  "Reading": "Читаємо",
  "wallet today": "гаманця за день",
  "Not everything answered: the value is at least this.": "Відповіло не все: вартість — щонайменше стільки.",
  "Connect your wallet to send": "Підключи гаманець, щоб надіслати",
  "Connecting reads your balances. Nothing is signed until you approve the exact transfer in your wallet.":
    "Підключення лише читає твої баланси. Нічого не підписується, доки ти не підтвердиш точний переказ у гаманці.",
  "Your receipts": "Твої квитанції",
  "Receipts are the durable handoff after Send or Swap: what was authorized, what the chain recorded, how the two reconcile, and whether the signed artifact verifies.":
    "Квитанції — це довготривалий результат після Send або Swap: що було підтверджено, що записав ланцюг, як ці факти звіряються та чи проходить перевірку підписаний артефакт.",
  "Recorded receipt": "Зафіксована квитанція",
  "Recorded Swap receipt": "Зафіксована квитанція обміну",
  "Correction recorded": "Виправлення зафіксовано",
  "What was corrected": "Що виправлено",
  "The transaction and signed receipt remain immutable. A separate hash-bound public record corrects two provenance labels without changing the observed swap or issuing another transaction.":
    "Транзакція та підписана квитанція залишаються незмінними. Окремий публічний запис, прив'язаний до хешу, виправляє два описи походження без зміни зафіксованого обміну й без нової транзакції.",
  "0.000005125 SOL platform": "0.000005125 SOL комісія платформи",
  "0.00001953 SOL network": "0.00001953 SOL комісія мережі",
  "Connect your wallet to see receipts saved in this browser.":
    "Підключи гаманець, щоб побачити квитанції, збережені в цьому браузері.",
  "Connecting only reads the receipt journal for that address.":
    "Підключення лише читає журнал квитанцій для цієї адреси.",
  "No receipts in this browser": "У цьому браузері квитанцій немає",
  "Completed Send and Swap receipts appear here after reconciliation.":
    "Квитанції завершених Send і Swap зʼявляються тут після звірки результату.",
  "This history stays in this browser. Download the signed JSON for a durable copy.":
    "Ця історія зберігається лише в цьому браузері. Завантаж підписаний JSON для довготривалої копії.",
  "Verification failed": "Не вдалося перевірити квитанцію",
  "The receipt could not be loaded.": "Не вдалося завантажити квитанцію.",
  "The provenance correction could not be loaded.": "Не вдалося завантажити виправлення походження.",
  "The provenance correction is malformed.": "Виправлення походження має неправильний формат.",
  "Provenance correction recorded": "Виправлення походження зафіксовано",
  "The original signed receipt remains valid and immutable. Its submitter sentence and action-path label are corrected by this hash-bound public record.":
    "Оригінальна підписана квитанція залишається дійсною та незмінною. Дані про того, хто надіслав транзакцію, і шлях дії виправлені цим публічним записом, прив'язаним до хешу.",
  "Open correction record": "Відкрити запис виправлення",
  "Jupiter Swap API V2's exact order fields — quote, minimum received, total/platform/priority fees, router, mode, route and a bounded Review window — beside both Asset Passports and the thirteen-rule policy verdict. One owner-signed USDC to SOL canary finalized and reconciled; its immutable receipt is valid and carries a separate public correction for two legacy provenance labels.":
    "Точні поля Jupiter Swap API V2 — котирування, мінімальне отримання, загальна комісія, комісії платформи й пріоритету, router, mode, route та обмежене вікно Review — розміщені поруч з обома Asset Passports і policy verdict із тринадцяти правил. Один owner-signed canary USDC → SOL фіналізовано й звірено; його незмінна квитанція дійсна та має окреме публічне виправлення двох застарілих описів походження.",
  "One exact 2.622093 USDC to 0.025621005 SOL transaction is finalized, independently read by two RPC operators and bound to a signed receipt plus an exact-hash correction record. The full keyed production surface still quotes routed pairs and amounts behind the same evidence and wallet controls.":
    "Одну точну транзакцію 2.622093 USDC → 0.025621005 SOL фіналізовано, незалежно прочитано двома RPC-операторами та прив'язано до підписаної квитанції й запису виправлення з точним хешем. Повна keyed production surface і далі котирує routed пари та суми під тими самими доказовими й wallet controls.",
  "The provenance and canary-accounting disposition is not accepted yet, so this action family is not promoted.":
    "Рішення щодо виправлень походження та обліку canary ще не прийнято, тому ця action family ще не промотована.",
  "One explicit disposition closes the swap canary; no second swap or wallet signature is required.":
    "Одне явне рішення закриває swap canary; другий обмін або новий підпис гаманця не потрібні.",
  "The M2 Swap receipt and M1B Send receipt are both immutable observations. M2's integrity and issuer signature are valid; its public correction explicitly records the inaccurate legacy submitter sentence and action-path label rather than presenting a clean verdict.":
    "Квитанція M2 Swap і квитанція M1B Send є незмінними спостереженнями. Цілісність і підпис видавця M2 дійсні; публічне виправлення явно фіксує неточне застаріле речення про submitter і label шляху дії, а не показує чистий verdict.",
  "The signed M2 Swap Outcome Receipt, its hash-bound public correction, the signed M1B Outcome Receipt for Send, explorer proofs and both verifier paths.":
    "Підписана M2 Swap Outcome Receipt, її публічне виправлення, прив'язане до хешу, підписана M1B Send Outcome Receipt, докази explorer і обидва verifier paths.",
  "No Bridge or Token-2022 receipt exists; the general Send owner canary remains its own gate.":
    "Квитанції Bridge або Token-2022 ще немає; загальний Send owner canary залишається окремим gate.",
  "The swap canary awaits one explicit disposition. The general Send canary and the bridge canary remain separate action-family gates.":
    "Swap canary очікує одного явного рішення. Загальний Send canary і bridge canary залишаються окремими gates для своїх action families.",
  "One exact owner canary verifies this action family; it does not guarantee every pair, amount, route or future landing, and it creates no autonomous or public execution authority.":
    "Один точний owner canary підтверджує цю action family; він не гарантує кожну пару, суму, route або майбутнє виконання й не створює автономної чи публічної execution authority.",
  "None. Swap is closed as a product; every later swap still requires a fresh route, an exact Review and the person's own visible wallet signature.":
    "Немає. Swap закрито як продукт; кожен наступний обмін і далі потребує свіжого маршруту, точного Review і власного видимого підпису людини в гаманці.",
  "Open signed Solana Outcome Receipts and independently check what each one proves.":
    "Відкривай підписані Solana Outcome Receipts і незалежно перевіряй, що саме доводить кожна з них.",
  "The swap canary is closed for its exact Swap action. The general Send canary and the bridge canary remain separate action-family gates.":
    "Swap canary закрито для його точної Swap-дії. Загальний Send canary і bridge canary залишаються окремими gates для своїх action families.",
  "Verifying…": "Перевіряємо…",
  "Integrity": "Цілісність",
  "Issuer": "Видавець",
  "Observation": "Спостереження",
  "Human authorization": "Підтвердження людиною",
  "Valid": "Дійсна",
  "Invalid": "Недійсна",
  "Signature valid": "Підпис дійсний",
  "Signature invalid": "Підпис недійсний",
  "Unsigned": "Без підпису",
  "Untrusted issuer": "Непідтверджений видавець",
  "Authorized": "Підтверджено",
  "Not authorized": "Не підтверджено",
  "Demo acknowledgement only": "Лише демонстраційне підтвердження",
  "Not applicable": "Не застосовується",
  "On the bound proposal, not on this receipt":
    "На пов'язаній пропозиції, не на цій квитанції",
  "Settled": "Розраховано",

  /* The thirteen capabilities that left the rail on 2026-09-03. `translateSolana`
     throws on a missing key rather than falling back, so a registry entry with an
     untranslated field is a 500 for every Ukrainian visitor to the Hub Map — the
     way `/settings` and `/map` once were. */
  "Phase B — Radar and the data-coverage truth model, which owns the curated-scope discipline this needs.":
    "Фаза B — Radar і модель правди про покриття даних, якій належить дисципліна курованих наборів, потрібна тут.",
  "New mints and new pools, with how little is known about them stated first.":
    "Нові мінти й нові пули — і насамперед сказано, як мало про них відомо.",
  "A new token is the case where coverage matters most and exists least: no price history, no holder history, often no metadata beyond what the issuer wrote. Anything here has to lead with what is unknown rather than rank on what little is known.":
    "Новий токен — це випадок, де покриття важить найбільше і є найменше: ні історії ціни, ні історії власників, часто жодних метаданих, крім написаних емітентом. Усе тут мусить починати з невідомого, а не ранжувати за тим дрібним, що відомо.",
  "Nothing is built.": "Не побудовано нічого.",
  "Pool-creation and mint-age discovery, a candidate list, and the coverage model that would make such a list readable rather than a leaderboard.":
    "Виявлення створення пулів і віку мінтів, список кандидатів і модель покриття, яка зробила б цей список читабельним, а не таблицею лідерів.",
  "Phase B — Radar and the data-coverage truth model, which owns discovery and the coverage vocabulary this needs.":
    "Фаза B — Radar і модель правди про покриття даних, якій належать виявлення та словник покриття, потрібні тут.",
  "Where volume actually went, and how much of that is one address.":
    "Куди насправді пішов обсяг і скільки з нього — одна адреса.",
  "Net flow, large trades and liquidity change over time. Its value is entirely in the coverage statement beside it: a flow figure assembled from partial sources is a confident number about an unknown quantity.":
    "Чистий потік, великі угоди та зміна ліквідності в часі. Уся цінність — у заяві про покриття поруч: цифра потоку, зібрана з часткових джерел, це впевнене число про невідому величину.",
  "Buy and sell volume, net flow, large-trade observation, liquidity and holder change, and any aggregation across sources.":
    "Обсяг купівель і продажів, чистий потік, спостереження великих угод, зміна ліквідності й власників — і будь-яке зведення між джерелами.",
  "Phase B — Radar and the data-coverage truth model.":
    "Фаза B — Radar і модель правди про покриття даних.",
  "What a set of addresses has done, without pretending to know who they are.":
    "Що робив набір адрес — без удавання, ніби ми знаємо, хто за ними.",
  "Clustering and labelling addresses is the easiest place in this product to state a guess as a fact. Nothing here may name a person, and a cohort has to carry the method that built it.":
    "Кластеризація й маркування адрес — найлегше місце в цьому продукті, щоб подати здогад як факт. Ніщо тут не має права називати людину, а кожна когорта мусить несли метод, яким її побудовано.",
  "Nothing is built. This repository reads a wallet only when somebody hands it one, and tracks no address.":
    "Не побудовано нічого. Цей репозиторій читає гаманець лише тоді, коли його хтось сам передав, і не відслідковує жодної адреси.",
  "Clustering, labelling, cohorts, ranking and any tracking of an address the person did not supply.":
    "Кластеризація, маркування, когорти, ранжування — і будь-яке відслідковування адреси, якої людина не давала.",
  "No work is planned for this yet. It is the least-planned part of the Radar family, and its own work would have to follow Phase B's Radar, because the coverage model comes first.":
    "Для цього поки не заплановано жодної роботи. Це найменш запланована частина Radar-родини, і її власна робота мала б іти після Radar фази B, бо модель покриття йде першою.",
  "Tokenized real-world assets on Solana, with the issuer's powers stated before the price.":
    "Токенізовані реальні активи на Solana — і повноваження емітента названі раніше за ціну.",
  "A tokenized share is a claim with a controller, a jurisdiction and a schedule. The passport discipline this workspace already applies to a mint is the part that transfers; the market data is not the hard half.":
    "Токенізована акція — це вимога з контролером, юрисдикцією і розписом. Паспортна дисципліна, яку цей кабінет уже застосовує до мінта, — саме те, що переноситься; ринкові дані тут не складна половина.",
  "Nothing on Solana. A real tokenized-asset kernel exists in this repository and every line of it is Robinhood Chain: ERC-8056 multipliers and eth_call, with no mint, no SPL or Token-2022 and no Solana RPC in it.":
    "На Solana — нічого. Справжнє ядро токенізованих активів у цьому репозиторії є, і кожен його рядок — це Robinhood Chain: множники ERC-8056 та eth_call, без жодного мінта, без SPL чи Token-2022 і без Solana RPC.",
  "Any Solana-side tokenized-asset read: the mint-level passport for an RWA, the issuer-power model in SPL terms, and the market view over it.":
    "Будь-яке читання токенізованого активу з боку Solana: паспорт RWA на рівні мінта, модель повноважень емітента в термінах SPL і ринковий вид над цим.",
  "Phase B — the Solana RWA passport and the Pro view.":
    "Фаза B — паспорт RWA для Solana і вид Pro.",
  "Being told when something you hold changes, rather than finding out by opening a page.":
    "Дізнаватися про зміну в тому, що ти тримаєш, а не відкривши сторінку.",
  "Alerts belong to Home, because the question is about a person's whole position and not one network's slice. What Solana owes is the projection: the events worth waking somebody for, and the freshness behind each one.":
    "Сповіщення належать Home, бо питання стоїть про цілу позицію людини, а не про зріз однієї мережі. Solana винна проєкцію: події, за які варто когось будити, і свіжість за кожною з них.",
  "A real Alerts surface, and it is Home's rather than Solana's: /app/alerts renders over lib/home/alerts/channels.ts with routing and delivery already built.":
    "Справжня поверхня сповіщень існує, і вона належить Home, а не Solana: /app/alerts малюється над lib/home/alerts/channels.ts, маршрутизація й доставка вже побудовані.",
  "The Solana projection. Nothing in the Home alert machinery mentions Solana, and no Solana event can raise an alert today.":
    "Проєкція для Solana. Ніде в механіці сповіщень Home Solana не згадана, і жодна подія Solana сьогодні не може підняти сповіщення.",
  "No Solana work is planned for Alerts yet. Their categories are already fixed, and the Home surface they project into already exists.":
    "Для сповіщень у Solana поки не заплановано жодної роботи. Їхні категорії вже зафіксовані, а поверхня Home, у яку вони проєктуються, уже існує.",
  "For the people who issued a token: who holds it, where it moved, and what the treasury did.":
    "Для тих, хто випустив токен: хто його тримає, куди він рухався і що робила скарбниця.",
  "This is the business side of the same passport read — holder concentration, large exits, treasury balances and team approvals. It is a different reader with a different job, not a Pro version of the consumer page.":
    "Це бізнесова сторона того самого паспортного читання — концентрація власників, великі виходи, баланси скарбниці й погодження команди. Це інший читач з іншою роботою, а не Pro-версія користувацької сторінки.",
  "Nothing is built. There is no treasury, multi-signer or team-approval machinery in the Solana lane.":
    "Не побудовано нічого. У Solana-лінії немає ні скарбниці, ні багатопідписної механіки, ні погоджень команди.",
  "Holder counts and concentration, treasury balances, large-exit observation, project events, and any multi-signer approval path.":
    "Кількість і концентрація власників, баланси скарбниці, спостереження великих виходів, події проєкту — і будь-який шлях багатопідписного погодження.",
  "No work is planned for this capability yet. Its scope is defined, and Business Tools open through Settings rather than the rail.":
    "Для цієї можливості поки не заплановано жодної роботи. Її обсяг визначено, а Business Tools відкриваються через Settings, а не через рейку.",
  "An order ticket for people who trade, rather than a swap box.":
    "Ордер-тікет для тих, хто торгує, а не віконце обміну.",
  "One market terminal: find an asset, see its real price and chart, and buy or sell it with your own signature.":
    "Один ринковий термінал: знайти актив, побачити його справжню ціну й графік, купити або продати його власним підписом.",
  "Markets with search and a watchlist; Crypto, Memes and Stocks/RWA as categories from Jupiter's own tags; real candles from a pool that is provably the market; an order ticket with the exact costs; the wallet's holding and fills below. Market Buy and Sell run the same direct Jupiter order and execute path Swap runs.":
    "Ринки з пошуком і списком спостереження; Crypto, Memes і Stocks/RWA як категорії з тегів самого Jupiter; справжні свічки з пулу, який доказово є ринком; ордер-тікет із точними витратами; холдинг і виконання гаманця нижче. Market Buy і Sell йдуть тим самим прямим шляхом Jupiter order → execute, що й Swap.",
  "Live at /app/spot since 2026-09-11: the markets, the chart, the ticket, the server-side watchlist, the Activity row that reads Spot Buy or Spot Sell, and a settled fill shown as a fill. Every category trades, tokenized stocks and RWA included, with the issuer named on the ticket; the first Spot fill landed on 2026-09-11.":
    "Живе на /app/spot із 2026-09-11: ринки, графік, тікет, серверний список спостереження, рядок Історії, що читається як Spot Buy або Spot Sell, і виконання, показане як виконання. Торгується кожна категорія, включно з токенізованими акціями та RWA, з емітентом, названим на тікеті; перше виконання Spot відбулося 2026-09-11.",
  "Standing orders (Limit, TP-SL) and an order book.":
    "Відкладені ордери (Limit, TP-SL) і книга ордерів.",
  "None for Market Buy and Sell. Standing orders wait on an Advanced Orders decision; a tokenized stock trades under its issuer's terms, which the ticket names.":
    "Для Market Buy і Sell — жодного. Відкладені ордери чекають на рішення Advanced Orders; токенізована акція торгується за умовами емітента, які тікет називає.",
  "Markets on outcomes — crypto, macro, business, politics, sports — through aggregated venues.":
    "Ринки на події — крипто, макро, бізнес, політика, спорт — через агреговані майданчики.",
  "Discovery across venues with the same question priced side by side, a position opened and closed through Review with the person's own signature, its result in Activity, and prediction signals beside the markets they refer to. Prediction detail lives inside the page and is never a row of its own.":
    "Пошук по майданчиках, де одне питання оцінене поруч; позиція, відкрита й закрита через Review з власним підписом людини; її результат в Історії; сигнали прогнозів поряд із ринками, яких вони стосуються. Деталі прогнозу живуть усередині сторінки і ніколи не стають окремим рядком.",
  "A visible locked page at /app/predictions that states what it will own. No market, odd, balance or trading action is shown.":
    "Видима заблокована сторінка /app/predictions, яка каже, чим володітиме. Жодного ринку, коефіцієнта, балансу чи торгової дії не показано.",
  "The aggregator integration: market discovery, pricing, order construction, settlement and the model's own notes. Partner/API access has been requested and is pending.":
    "Інтеграція агрегатора: пошук ринків, ціни, побудова ордера, розрахунок і нотатки моделі. Партнерський/API-доступ запитано, очікуємо.",
  "A separate surface only after its own data, custody, risk and canary gate — and, before that, the aggregator's partner/API access, requested and pending.":
    "Окрема поверхня лише після власного гейта даних, кастодії, ризику й canary — а перед тим партнерський/API-доступ агрегатора, який запитано й очікується.",
  "Predictions": "Прогнози",
  "Spot is a surface where size comes from a plan and market context sits beside the ticket. Swap is the action; Spot is the workspace around it, and it is not a tab of Swap.":
    "Spot — це поверхня, де розмір походить із плану, а ринковий контекст стоїть поруч із тікетом. Swap — це дія; Spot — робоче місце навколо неї, і він не є вкладкою Swap.",
  "Nothing is built as a Spot surface. There is no route, no module and no order ticket in this workspace.":
    "Як поверхня Spot не побудовано нічого. У цьому кабінеті немає ні маршруту, ні модуля, ні ордер-тікета.",
  "The route, the ticket, size-from-plan and the market context beside it.":
    "Маршрут, тікет, розмір із плану і ринковий контекст поруч.",
  "Spot opens as a separate surface only after its own data, custody, risk and canary gate.":
    "Spot відкривається як окрема поверхня лише після власного гейта даних, кастодії, ризику й канарки.",
  "An order that waits, and a schedule that keeps buying — each with the custody question answered first.":
    "Ордер, який чекає, і розпис, який продовжує купувати — і в кожного першим відповідене питання кастодії.",
  "A limit order that waits has to hold funds somewhere, and a schedule that keeps buying acts while nobody is watching. Both are custody questions before they are trading features, which is why the product puts Schedule → notification → fresh evidence → fresh quote → Review → wallet signature in that order.":
    "Лімітний ордер, який чекає, мусить десь тримати кошти, а розпис, який продовжує купувати, діє, коли ніхто не дивиться. Обидва — питання кастодії раніше, ніж торгові функції; саме тому продукт ставить розпис → сповіщення → свіжі факти → свіже котирування → Review → підпис гаманця саме в цьому порядку.",
  "Nothing is built. There is no Trigger or Recurring adapter in this repository.":
    "Не побудовано нічого. У цьому репозиторії немає ні адаптера Trigger, ні Recurring.",
  "The order construction, the custodial-vault deposit, withdrawal and recovery path, and the DCA schedule with its per-draw Review.":
    "Побудова ордера, внесення до кастодіального сховища, шлях виведення й відновлення — і розпис DCA з окремим Review на кожне списання.",
  "The blocking condition is named rather than dated: the custody disclosure and the withdrawal path must exist before an order may wait on anyone's funds.":
    "Блокуюча умова названа, а не прив'язана до дати: розкриття кастодії та шлях виведення мусять існувати, перш ніж ордер отримає право чекати на чиїхось коштах.",
  "Leveraged positions, which is the one place on this product where a person can lose more than they put in.":
    "Позиції з плечем — єдине місце в цьому продукті, де людина може втратити більше, ніж внесла.",
  "Funding, margin and liquidation are the whole feature; the order ticket is the easy part. The product sets a five-rung ladder for exactly that reason, and nothing about it is reachable by extending Swap.":
    "Фандинг, маржа й ліквідація — це і є вся функція; ордер-тікет тут легка частина. Саме тому продукт ставить п'ятищаблеву драбину, і ніщо з цього не досягається розширенням Swap.",
  "Nothing is built. There is no perps client, market read, position, funding, margin or liquidation model in the Solana tree.":
    "Не побудовано нічого. У Solana-дереві немає ні клієнта перпів, ні читання ринку, ні позиції, ні моделі фандингу, маржі чи ліквідації.",
  "A venue adapter, market and funding reads, position and margin state, leverage input, liquidation-price calculation, and the paper rung that has to come before any of it moves money.":
    "Адаптер майданчика, читання ринку й фандингу, стан позиції та маржі, введення плеча, розрахунок ціни ліквідації — і паперовий щабель, який мусить іти перед тим, як щось із цього почне рухати гроші.",
  "The perps release ladder, whose first rung is a read-only market and position model with no order path at all.":
    "Драбина випуску perps, чий перший щабель — модель ринку й позиції лише для читання, узагалі без шляху для ордера.",
  "Ask someone for a payment, and know when it actually arrived.":
    "Попросити когось про платіж — і знати, коли він справді надійшов.",
  "The link is the easy half. What makes a payment request a product is everything after it: an expiry, the expected amount against the observed one, and a receipt for the person who paid as well as the person who asked.":
    "Посилання — легка половина. Продуктом запит на платіж робить усе, що після нього: строк дії, очікувана сума проти спостереженої і квитанція як для того, хто заплатив, так і для того, хто попросив.",
  "The URL half, and it ships inside Receive rather than a Payments surface: buildSolanaPayUrl produces a real Solana Pay transfer request with recipient, amount, SPL token and reference.":
    "Половина з посиланням — і вона живе всередині Receive, а не на поверхні Payments: buildSolanaPayUrl створює справжній запит переказу Solana Pay з отримувачем, сумою, SPL-токеном і референсом.",
  "Everything after the URL — expiry, policy, observed payment, expected against actual, and the Receipt a payment request requires.":
    "Усе після посилання — строк дії, політика, спостережений платіж, очікуване проти фактичного і квитанція, якої вимагає запит на оплату.",
  "Phase B — Payments, subscriptions, x402 and agents, as Business Tools rather than a consumer hero.":
    "Фаза B — платежі, підписки, x402 і агенти, як Business Tools, а не як головна користувацька обіцянка.",
  "A recurring charge you can see, cap and stop.":
    "Регулярне списання, яке ти бачиш, можеш обмежити й зупинити.",
  "An allowance is a promise about the future, so the whole feature is the revoke path and the cap — not the charge. The shape is fixed: a delegate with a cap, a cadence, an expiry, and expected draws recorded against actual ones.":
    "Дозвіл на списання — це обіцянка про майбутнє, тому вся функція це шлях відкликання і межа, а не саме списання. Форма зафіксована: делегат з межею, періодичністю, строком дії та очікуваними списаннями, записаними проти фактичних.",
  "Nothing is built in the Solana lane. x402 and B402 appear nowhere under lib/solana or app/solana, and there is no allowance machinery.":
    "У Solana-лінії не побудовано нічого. x402 і B402 не зустрічаються ні під lib/solana, ні під app/solana, і механіки дозволів немає.",
  "The delegate, cap, cadence, expiry and revocation, the expected-against-actual draw record, and the receipts for each charge.":
    "Делегат, межа, періодичність, строк дії та відкликання, запис очікуваних списань проти фактичних — і квитанція на кожне списання.",
  "Phase B — the same work as Payments. It must implement the allowance shape described above.":
    "Фаза B — та сама робота, що й платежі. Вона мусить реалізувати описану вище форму дозволу.",
  "Something that acts while you are not looking — which is why it is a policy question, not a feature.":
    "Те, що діє, коли ти не дивишся, — і саме тому це питання політики, а не функція.",
  "The ladder is fixed: watch, then paper, then prepare, and only then anything guarded. Agent Control is the product that would govern the last rung, and it currently pins execution off and human authorization on by contract.":
    "Драбина зафіксована: спостерігати, потім папір, потім підготовка — і лише тоді щось під охороною. Останнім щаблем керував би Agent Control, а він контрактом тримає виконання вимкненим і людську авторизацію обов'язковою.",
  "Nothing is built. There is no scheduler, recurring action or unattended execution path in this repository, and Agent Control is structurally incapable of executing: its policy contract pins execution disabled and human authorization required.":
    "Не побудовано нічого. У цьому репозиторії немає ні планувальника, ні регулярної дії, ні шляху виконання без нагляду, а Agent Control структурно не здатний виконувати: його контракт політики тримає виконання вимкненим, а людську авторизацію обов'язковою.",
  "Every rung above Prepare, and the Agent Control authorization path that would have to carry it.":
    "Кожен щабель вище за підготовку — і шлях авторизації Agent Control, який мусив би це нести.",
  "No Solana automation work is planned yet. The ladder above governs it, and the Strategy Lab owns the rungs beneath it.":
    "Для автоматизації Solana поки не заплановано жодної роботи. Нею керує описана вище драбина, а щаблі під нею належать Strategy Lab.",
  "Which provider answered, how fresh the answer was, and what to do when one is down.":
    "Який провайдер відповів, наскільки свіжою була відповідь і що робити, коли один із них лежить.",
  "This is the one capability here whose engine already exists and whose surface does not. The four provider states are implemented over the endpoint pair and are read on every request; nothing renders them.":
    "Це єдина можливість тут, чий рушій уже існує, а поверхня — ні. Чотири стани провайдерів реалізовані над парою ендпоінтів і читаються на кожному запиті; ніщо їх не малює.",
  "The engine. lib/solana/health.ts implements the four states over the mainnet endpoint pair, with tests, running in production on every read.":
    "Рушій. lib/solana/health.ts реалізує чотири стани над парою мейннет-ендпоінтів, із тестами, і працює у проді на кожному читанні.",
  "The surface. No page, route or panel renders the health state anywhere in this workspace.":
    "Поверхня. Ні сторінка, ні маршрут, ні панель ніде в цьому кабінеті не малюють стан здоров'я.",
  "No work is planned for the surface yet. The contract — the provider list, the four states and the degraded-read discipline — is fixed, and the engine already satisfies it.":
    "Для поверхні поки не заплановано жодної роботи. Контракт — список провайдерів, чотири стани й дисципліна деградованого читання — зафіксований, і рушій його вже задовольняє.",
  "A real, working thing today. Some of these only read; others move money, and always with your own wallet — the line beside the name says which.":
    "Справжня робоча річ уже сьогодні. Одні лише читають, інші рухають гроші — і завжди твоїм власним гаманцем; рядок біля назви каже, що саме.",
  "Move native USDC between Solana and Base through Circle CCTP V2, signed in your own wallet.":
    "Переміщення нативного USDC між Solana і Base через Circle CCTP V2, підписане твоїм власним гаманцем.",
  "A burn on the source chain, Circle's attestation, a mint on the destination, and a Bridge Receipt that reconciles both sides from endpoints that did not build the transfer. Recovery is message-first, so a closed tab or a slow confirmation is a state you can resume from rather than a transfer you have lost.":
    "Спалення на вихідному ланцюзі, атестація Circle, карбування на цільовому і квитанція мосту, яка звіряє обидві сторони з ендпоінтів, що не будували цей переказ. Відновлення йде від повідомлення, тож закрита вкладка чи повільне підтвердження — це стан, з якого можна продовжити, а не втрачений переказ.",
  "The Solana to Base direction, for any amount your balance and the provider allow. One owner-signed transfer of 2 USDC is finalized and reconciled MATCHED on both chains, with a receipt the public verifier reads as valid.":
    "Напрямок Solana → Base, на будь-яку суму, яку дозволяють твій баланс і провайдер. Один переказ на 2 USDC, підписаний власником, фіналізовано і звірено як MATCHED на обох ланцюгах, із квитанцією, яку публічний верифікатор читає як дійсну.",
  "The Base to Solana direction, provider-driven token and route discovery, and live provider minimums and maximums.":
    "Напрямок Base → Solana, визначення токенів і маршрутів із боку провайдера та живі мінімуми й максимуми провайдера.",
  "Waits on the reverse leg, which is a build, not a switch: an ERC-20 approve, a Base depositForBurn encoder, a Solana receiveMessage builder and a chain-tagged duplicate-burn claim.":
    "Чекає на зворотне плече — це збірка, а не перемикач: approve для ERC-20, кодувальник depositForBurn на Base, будівник receiveMessage на Solana і заявка проти подвійного спалення з позначкою ланцюга.",
  "below the quote, above your minimum": "менше за котирування, вище за твій мінімум",
  "above the quote": "більше за котирування",
  "Observed": "Спостережено",
  "Not observed": "Не спостережено",
  "Bridge receipt": "Квитанція переказу між мережами",
  "This route has reached a limit Ryntra keeps on its own transfers. Nothing has been sent and your funds are untouched.":
    "Цей маршрут досяг ліміту, який Ryntra тримає на власні перекази. Нічого не надіслано, твої кошти недоторкані.",
  "Transfers on this route are paused right now. Nothing has been sent and your funds are untouched.":
    "Перекази цим маршрутом зараз призупинені. Нічого не надіслано, твої кошти недоторкані.",
  "This transfer could not be checked against Ryntra's own limits just now, so it was not offered to your wallet.":
    "Цей переказ зараз не вдалося звірити з власними лімітами Ryntra, тому його не запропоновано твоєму гаманцю.",
  "This transfer needs one more check before it can be offered to your wallet.":
    "Цей переказ потребує ще однієї перевірки, перш ніж його можна запропонувати твоєму гаманцю.",
  "This transfer needs a valid sending and receiving address and an amount inside the allowed range.":
    "Цей переказ потребує коректної адреси відправника й отримувача та суми в дозволених межах.",
  "Ryntra's own internal transfer limits do not apply here. They are recorded as evidence and decide nothing about this transfer.":
    "Власні внутрішні ліміти Ryntra тут не застосовуються. Вони фіксуються як доказ і нічого не вирішують щодо цього переказу.",
  "Send receipt": "Квитанція Send",
  "Swap receipt": "Квитанція Swap",
  "Launch trade receipt": "Квитанція угоди лаунчу",
  "Verification": "Перевірка",
  "Verify this receipt": "Перевірити цю квитанцію",
  "Matched": "Збігається",
  "Deviation recorded": "Відхилення зафіксовано",
  "Failed": "Не виконано",
  "Wrong network": "Неправильна мережа",
  "Your wallet is already asking": "Твій wallet уже очікує відповіді",
  "and": "і",
  "connected": "підключено",
  "connected to the wrong network": "підключено до неправильної мережі",
  "connecting": "підключення",
  "more with a balance": "інших із balance",
  "no wallet detected": "гаманець не виявлено",
  "not connected": "не підключено",
  "the wallet did not connect": "wallet не підключився",
  "waiting for your authorization": "очікується твоя авторизація",
  "ALLOW": "ДОЗВОЛИТИ",
  "Asset": "Актив",
  "BASE FEE UNKNOWN": "БАЗОВА FEE НЕВІДОМА",
  "BLOCK": "БЛОКУВАТИ",
  "Back": "Назад",
  "Base fee": "Базова fee",
  "0 priority fee": "0 priority fee",
  "Building preview": "Побудова preview",
  "CANARY NOT CLEAR": "CANARY НЕ ДОЗВОЛЕНО",
  "CONFIRMED": "ПІДТВЕРДЖЕНО",
  "Choose": "Обрати",
  "Choose an asset first.": "Спочатку обери актив.",
  "Choose an asset.": "Обери актив.",
  "Confirmed": "Підтверджено",
  "EXPIRED": "ПРОСТРОЧЕНО",
  "Enter a plain decimal amount — digits, and at most one point.":
    "Введи звичайну десяткову суму: лише цифри й не більше однієї крапки.",
  "Enter a recipient address.": "Введи адресу отримувача.",
  "Enter an amount.": "Введи суму.",
  "Close asset selector": "Закрити вибір активу",
  "FAIL": "ПОМИЛКА",
  "MATCHED": "ЗБІГАЄТЬСЯ",
  "Max": "Макс.",
  "Native SOL": "Нативний SOL",
  "Network fee": "Комісія мережі",
  "No asset in this wallet matches": "У цьому wallet немає активу, що відповідає запиту",
  "OBSERVED": "СПОСТЕРЕЖЕНО",
  "Open on explorer": "Відкрити в explorer",
  "Other assets": "Інші активи",
  "PASS": "ПРОЙДЕНО",
  "PAUSE": "ПАУЗА",
  "POLICY NOT CLEAR": "POLICY НЕ ДОЗВОЛЯЄ",
  "Preview to see fees and the exact payload.": "Створи preview, щоб побачити fees і точний payload.",
  "Preview transfer": "Перевірити переказ",
  "READY": "ГОТОВО",
  "RECEIPTED": "КВИТАНЦІЮ СТВОРЕНО",
  "RECONCILED": "ЗВІРЕНО",
  "RECOVERY": "ВІДНОВЛЕННЯ",
  "REVIEW PROOF UNSIGNED": "REVIEW PROOF НЕ ПІДПИСАНО",
  "Reading balances": "Читання balances",
  "Refreshing Review": "Оновлюємо Review",
  "This action is review-only. Mainnet signing is open only for the exact M1B ATA canary.":
    "Ця дія лишається review-only. Підпис у мейннеті відкрито лише для точного M1B ATA canary.",
  "This ATA canary is capped at 0.5 USDC.": "Цей ATA canary обмежено сумою 0.5 USDC.",
  "Preview again after applying the canary limit.": "Після застосування ліміту створи preview ще раз.",
  "Use 0.5 USDC": "Використати 0.5 USDC",
  "SOLANA MAINNET · real funds": "SOLANA MAINNET · реальні кошти",
  "Exact wallet": "Точний wallet",
  "Provider": "Провайдер",
  "Owner-canary checks allow this exact Review.": "Перевірки owner canary дозволяють саме цей Review.",
  "Sending is paused by the owner-canary policy. No transaction can be signed.":
    "Переказ призупинено політикою owner canary. Жодну транзакцію не можна підписати.",
  "Why sending is paused": "Чому переказ призупинено",
  "Recipient account": "Account отримувача",
  "Recipient gets": "Отримувач одержить",
  "Request failed:": "Запит завершився помилкою:",
  "Reviewing wallet adjustments": "Перевіряємо зміни wallet",
  "Review is incomplete.": "Review неповний.",
  "SIMULATION FAILED": "СИМУЛЯЦІЯ НЕВДАЛА",
  "SIMULATION MISSING": "СИМУЛЯЦІЯ ВІДСУТНЯ",
  "SPL transfer": "Переказ SPL",
  "SUBMITTED": "НАДІСЛАНО",
  "Search SOL, Solana or mint": "Пошук за SOL, Solana або mint",
  "Search symbol, name, or mint address": "Пошук за символом, назвою або mint-адресою",
  "Search wallet assets": "Пошук активів wallet",
  "Select asset": "Вибрати актив",
  "Sign & send in": "Підписати й надіслати через",
  "Sign in": "Підписати в",
  "Signed bytes check:": "Перевірка підписаних bytes:",
  "Simulation": "Симуляція",
  "Submit": "Надіслати",
  "Submitting": "Надсилання",
  "Submitting signed transaction": "Надсилаємо підписану транзакцію",
  "The amount is zero; there is nothing to quote.": "Сума дорівнює нулю; котирувати нічого.",
  "The adopted wallet transaction did not match its exact Review.":
    "Прийнята транзакція wallet не збіглася зі своїм точним Review.",
  "The transaction window expired. Sign & send again; Ryntra will rebuild it.":
    "Час транзакції минув. Натисни підписати й надіслати ще раз — Ryntra перебудує її.",
  "The signature is not submitted again. Recovery starts from its cluster status.":
    "Підпис не надсилається повторно. Recovery починається зі статусу в cluster.",
  "To": "Кому",
  "Token Extensions": "Розширення token",
  "Token account will be created": "Token account буде створено",
  "Transfer": "Переказ",
  "UNKNOWN": "НЕВІДОМО",
  "USD from Jupiter Price": "USD за ціною Jupiter",
  "Verified by Jupiter Tokens": "Перевірено Jupiter Tokens",
  "Waiting for": "Очікування відповіді від",
  "Wallet response:": "Відповідь wallet:",
  "Wallet holdings": "Активи wallet",
  "assets in this wallet": "активів у цьому wallet",
  "bps fee": "bps fee",
  "created": "буде створено",
  "exists": "існує",
  "fails": "не проходить",
  "flagged": "позначено",
  "no mint fee": "без mint fee",
  "shown": "показано",
  "skipped": "пропущено",
  "succeeds": "проходить",
  "to": "кому",
  "unknown mint": "невідомий mint",
  "unknown mints": "невідомих mints",
  "your wallet": "твоєму wallet",
  "CCTP lifecycle states": "Стани lifecycle CCTP",
  "domain": "домен",
  "threshold": "поріг",
  "rent": "rent",
  "Output-token policy": "Policy вихідного token",
  "Verify an artifact": "Перевірити артефакт",
  "Risk": "Ризик",
  "The thirteen dials that decide what a transfer may do before anyone signs it.":
    "Тринадцять правил, які визначають, що переказ може зробити до будь-якого підпису.",
  "The evidence policy remains thirteen dials. The owner-canary layer adds an immutable package/family budget, destination/mint/program allowlists, durable submit-once exposure and ALLOW / REVIEW / BLOCK / PAUSE / UNKNOWN under a fail-closed operator switch.":
    "Evidence policy лишається набором із 13 правил. Owner-canary layer додає незмінний package/family budget, allowlists destination/mint/program, durable submit-once exposure і ALLOW / REVIEW / BLOCK / PAUSE / UNKNOWN під fail-closed operator switch.",
  "Both deterministic engines: the thirteen-rule evidence policy and the durable owner-canary policy. Send binds both verdicts into one issuer-signed Review bundle; Settings renders the canary control plane read-only.":
    "Обидва детерміновані engines: evidence policy з 13 правил і durable owner-canary policy. Send зв'язує обидва verdict в одному підписаному issuer Review bundle; Налаштування показують canary control plane лише для читання.",
  "A general user-editable policy builder. The canary switch remains operator configuration, never an unauthenticated browser control.":
    "Загальний policy builder для редагування користувачем. Canary switch лишається конфігурацією оператора, а не неавтентифікованим browser control.",
  "None for the enforced owner-canary policy. A general policy editor belongs to a later bounded control task.":
    "Для примусової owner-canary policy gate немає. Загальний policy editor належить пізнішій обмеженій control task.",

  /* Trade, rebuilt as one swap card. The surface stopped being a document and
     became the swap itself, so its copy is new and its Ukrainian projection is
     new with it. The terms of art the workspace already keeps in Latin —
     wallet, mint, chain, policy, route, recovery — stay that way here. */
  "The two sides are the same asset.": "Обидві сторони — той самий актив.",
  "The wallet returned different bytes than the reviewed message. Nothing was submitted.":
    "Wallet повернув інші байти, ніж перевірене повідомлення. Нічого не надіслано.",
  "Swap": "Обмін",
  "This pair or amount is unavailable.": "Ця пара або сума зараз недоступна.",
  "The quote expired. Get a new quote.": "Котирування застаріло. Онови його.",
  "Wallet approval was cancelled.": "Підтвердження в гаманці скасовано.",
  "Jupiter is busy. Try again in a moment.": "Jupiter зайнятий. Спробуй за мить.",
  "Checking the previous swap. Try again in a moment.": "Перевіряємо попередній обмін. Спробуй за мить.",
  "Swap could not continue. Try again.": "Обмін не вдалося продовжити. Спробуй ще раз.",
  "Both sides are the same asset. Change one of them.":
    "З обох боків той самий актив. Зміни один із них.",
  "Checking transaction…": "Перевіряємо транзакцію…",
  "Check transaction": "Перевірити транзакцію",
  "Refreshing…": "Оновлюємо…",
  "Get a new quote": "Оновити котирування",
  "Preparing swap…": "Готуємо обмін…",
  "Swapping…": "Обмінюємо…",
  "Finding a route…": "Шукаємо маршрут…",
  "Try another pair": "Обери іншу пару",
  "Unavailable for this asset": "Недоступно для цього активу",
  "Refresh quote": "Оновити котирування",
  "Review swap": "Переглянути обмін",
  "Verify receipt": "Перевірити квитанцію",
  "Network fee estimate": "Орієнтовна комісія мережі",
  "Account reserve": "Резерв для рахунку",
  "Review before confirming": "Перевір перед підтвердженням",
  "This asset needs extra review.": "Цей актив потребує додаткової перевірки.",
  "The price may move by more than 3%.": "Ціна може змінитися більш ніж на 3%.",
  "The quote and minimum received use different slippage.": "Котирування й мінімальна сума отримання використовують різний slippage.",
  "This swap may move the market price.": "Цей обмін може вплинути на ринкову ціну.",
  "USD value is unavailable.": "Оцінка в USD недоступна.",
  "Review this swap carefully.": "Уважно перевір цей обмін.",
  "Swap Solana tokens through Jupiter.": "Обмінюй токени Solana через Jupiter.",
  "Asset checks passed": "Перевірки активів пройдено",
  "No wallet detected": "Гаманець не виявлено",
  "Connect wallet": "Підключити гаманець",
  "Add SOL for the network fee": "Додай SOL на комісію мережі",
  "Enter an amount": "Введи суму",
  "Finding the best route…": "Шукаємо найкращий route…",
  "No quote": "Немає котирування",
  "Blocked by the review policy": "Заблоковано policy перевірки",
  "The policy refuses what receiving this asset would subject a holder to.":
    "Policy відмовляє через те, чому отримання цього активу піддає власника.",
  "Pair outside the owner canary": "Пара поза owner canary",
  "The first signature is bounded to USDC ↔ SOL, 2–5 USDC.":
    "Перший підпис обмежено парою USDC ↔ SOL на 2–5 USDC.",
  "Change the amount to ask for a fresh one; a stale quote never reaches a signature.":
    "Зміни суму, щоб запитати свіже; застаріле котирування ніколи не доходить до підпису.",
  "Preparing the exact transaction…": "Готуємо точну транзакцію…",
  "Review in wallet & swap": "Перевірити у wallet і обміняти",
  "Your visible wallet confirmation is the authorization. One submit; recovery only by signature.":
    "Твоїм дозволом є видиме підтвердження у wallet. Одне надсилання; recovery лише за підписом.",
  "Solana mainnet": "Solana mainnet",
  "Sell": "Продати",
  "Amount to sell": "Сума до продажу",
  "Flip the pair": "Поміняти сторони місцями",
  "Buy": "Купити",
  "Quoting…": "Котирування…",
  "expired": "минуло",
  "All thirteen review rules passed over the asset you would receive.":
    "Усі тринадцять правил перевірки пройдено для активу, який ти отримаєш.",
  "Explorer": "Explorer",
  "Receipt JSON": "JSON квитанції",
  "Verify": "Перевірити",
  "Details": "Деталі",
  "None reported": "Не повідомлено",
  "Network fees": "Мережеві fees",
  "Venue": "Venue",
  "Asset review": "Перевірка активу",
  "Live read": "Живе читання",
  "Awaiting a quote": "Очікування котирування",
  "What receiving": "Чому отримання",
  "would subject any holder to, judged by the workspace's own review policy over the mint as read this visit. The engine has no word for safe; its floor is NO KNOWN BLOCKER.":
    "піддає будь-якого власника — за оцінкою власної policy перевірки цього простору над mint, прочитаним у цьому візиті. Engine не має слова «безпечно»; його підлога — NO KNOWN BLOCKER.",
  "Asset Passports — every issuer power and extension, with its evidence.":
    "Паспорти активів — кожне повноваження емітента й кожне розширення разом із доказом.",
  "Pick a pair and an amount. Both mints are re-read from the chain on every quote, and the review policy judges the asset you would receive before any wallet is asked for anything.":
    "Обери пару й суму. Обидва mints повторно читаються з chain для кожного котирування, а policy перевірки оцінює актив, який ти отримаєш, ще до будь-якого запиту до wallet.",
  "Choose an asset": "Обери актив",
  "Close": "Закрити",
  "Six real mainnet mints, each decoded from its own on-chain bytes. Not a ranking.":
    "Шість справжніх mainnet mints, кожен декодовано з власних on-chain байтів. Це не рейтинг.",
  "Swap any pair on Solana mainnet through the keyed Jupiter Swap API V2 contract. Every quote is server-built, both mints are re-read from the chain, and the workspace's own review policy judges the asset you would receive before a wallet is asked for anything. Execution stays yours: the exact bytes are inspected and simulated, your own visible wallet signature approves them, one submit follows, then an independent chain read and a signed Receipt.":
    "Обмін у Solana mainnet через контракт Jupiter Swap API V2 з ключем. Кожне котирування будується на сервері, обидва mints повторно читаються з chain, а власна policy перевірки простору оцінює актив, який ти отримаєш, ще до будь-якого запиту до wallet. Виконання лишається твоїм: точні bytes перевіряються й симулюються, їх підтверджує власний видимий підпис твого wallet, далі одне надсилання, незалежне читання chain і підписана квитанція.",
  "A default pair, quoted so the numbers are on screen rather than behind a button. It is a default, not a recommendation.":
    "Типова пара, яку котирується, щоб числа були одразу на екрані, а не за кнопкою. Це типове значення, а не рекомендація.",
  "The address bar carries this pair and amount — the link shares the question, not this answer.":
    "Адресний рядок містить цю пару й суму — посилання передає запитання, а не цю відповідь.",
  "Its Review window closed. Ask for a fresh one; a stale quote never reaches a signature.":
    "Його вікно Review закрилося. Запитай свіже; застаріле котирування ніколи не доходить до підпису.",
  "Ask without a key · degraded": "Запитати без ключа · degraded",
  "Asked on the public keyless lane: rate-limited, unkeyed and labelled degraded. It is the venue's own answer, never a cached one.":
    "Запит зроблено публічною смугою без ключа: rate-limited, без ключа й позначено degraded. Це власна відповідь venue, а не кешована.",

  /* ── Send, as one card ────────────────────────────────────────────────
     The rebuilt Send surface speaks to a person about their money, so its
     Ukrainian says the same thing in the same register: no rule identifiers,
     no lamports, no internal task names. Where the English names an authority
     and what it can do, the Ukrainian names the same authority and the same
     power — a softened translation would be a different promise. */
  "Amount to send": "Сума до надсилання",
  "Recipient address": "Адреса отримувача",
  "Your assets": "Твої активи",
  "No asset in your wallet matched that search.": "У твоєму гаманці немає активу за цим запитом.",
  "From": "Звідки",
  "Account setup": "Створення account",
  "Read before confirming": "Прочитай перед підтвердженням",

  "Reading your balances…": "Читаємо твої баланси…",
  "Preparing transfer…": "Готуємо переказ…",
  "Sending…": "Надсилаємо…",
  "Enter a recipient": "Введи отримувача",
  "Enter a different recipient": "Введи іншого отримувача",
  "Check the recipient address": "Перевір адресу отримувача",
  "Not enough": "Недостатньо",
  "Review transfer": "Перевірити переказ",
  "Cannot be sent": "Надіслати неможливо",

  "Sent": "Надіслано",
  "Not sent": "Не надіслано",
  "Not confirmed": "Не підтверджено",
  "The recipient is ready to receive this token.": "Отримувач готовий прийняти цей токен.",
  "This address has no account for this token yet — you pay a one-time setup cost.":
    "У цієї адреси ще немає account для цього токена — ти одноразово платиш за його створення.",

  "This transfer never reached the network. Nothing moved.":
    "Цей переказ так і не дійшов до мережі. Нічого не переміщено.",
  "The network rejected this transfer. Nothing moved.":
    "Мережа відхилила цей переказ. Нічого не переміщено.",
  "This transfer is not confirmed yet. Open it on the explorer before sending again.":
    "Цей переказ ще не підтверджено. Відкрий його в explorer, перш ніж надсилати ще раз.",

  "That amount is unavailable.": "Ця сума недоступна.",
  "Check the recipient address.": "Перевір адресу отримувача.",
  "The transfer window closed. Review it again.":
    "Вікно переказу закрилося. Перевір його ще раз.",
  "Your wallet returned a different transaction. Nothing was sent.":
    "Гаманець повернув іншу транзакцію. Нічого не надіслано.",
  "An earlier transfer is still being confirmed. Do not send it again.":
    "Попередній переказ ще підтверджується. Не надсилай його вдруге.",
  "Sending is turned off right now.": "Надсилання зараз вимкнено.",
  "Sending is unavailable right now. Try again later.":
    "Надсилання зараз недоступне. Спробуй пізніше.",
  "Too many requests. Try again in a moment.": "Забагато запитів. Спробуй за мить.",
  "The transfer could not continue. Try again.": "Переказ не вдалося продовжити. Спробуй ще раз.",
  "Your wallet did not approve this transfer.": "Гаманець не підтвердив цей переказ.",
  "Something changed since you reviewed this transfer. Review it again.":
    "Від моменту перевірки цього переказу дещо змінилося. Перевір його ще раз.",

  "This token cannot be transferred at all.": "Цей токен неможливо переказувати взагалі.",
  "The issuer has paused transfers of this token.": "Емітент призупинив перекази цього токена.",
  "Your account for this token is frozen, so nothing can leave it.":
    "Твій account для цього токена заморожено, тож із нього нічого не піде.",
  "Your account for this token could not be read.":
    "Твій account для цього токена не вдалося прочитати.",
  "The recipient's account for this token is frozen.":
    "Account отримувача для цього токена заморожено.",
  "New accounts for this token start frozen, so the recipient may not be able to spend it.":
    "Нові accounts для цього токена створюються замороженими, тож отримувач може не змогти ним скористатися.",
  "This token requires a confidential transfer, which Ryntra cannot build.":
    "Цей токен вимагає конфіденційного переказу, який Ryntra не будує.",
  "This token supports hidden balances. This transfer is a public one.":
    "Цей токен підтримує приховані баланси. Цей переказ — публічний.",
  "The issuer runs its own code on every transfer of this token.":
    "Емітент виконує власний код на кожному переказі цього токена.",
  "The issuer runs its own code on this token and it could not be resolved.":
    "Емітент виконує власний код на цьому токені, і його не вдалося розібрати.",
  "The issuer can move this token out of any account, including the recipient's.":
    "Емітент може вивести цей токен з будь-якого account, зокрема з account отримувача.",
  "The issuer can freeze this token in any account, including the recipient's.":
    "Емітент може заморозити цей токен у будь-якому account, зокрема в account отримувача.",
  "The issuer keeps a fee out of every transfer of this token.":
    "Емітент утримує комісію з кожного переказу цього токена.",
  "This token may require a memo, and that could not be read.":
    "Цей токен може вимагати memo, і це не вдалося прочитати.",
  "The recipient's account requires a memo with every transfer.":
    "Account отримувача вимагає memo при кожному переказі.",
  "This token has a feature Ryntra does not yet understand.":
    "Цей токен має властивість, якої Ryntra ще не розуміє.",
  "This transfer would fail on the network right now.":
    "Просто зараз цей переказ не пройшов би в мережі.",
  "The network fee for this transfer could not be read.":
    "Комісію мережі за цей переказ не вдалося прочитати.",
  "The cost of setting up the recipient's account could not be read.":
    "Вартість створення account отримувача не вдалося прочитати.",
  "This transfer does something Ryntra cannot explain, so it will not be sent.":
    "Цей переказ робить те, чого Ryntra не може пояснити, тож він не буде надісланий.",
  "Ryntra could not produce a signed record for this transfer.":
    "Ryntra не змогла створити підписаний запис про цей переказ.",
  "This transfer cannot be sent.": "Цей переказ неможливо надіслати.",

  "The network could not check this transfer. Review it again.":
    "Мережа не змогла перевірити цей переказ. Перевір його ще раз.",
  "This transfer did not pass Ryntra's checks.": "Цей переказ не пройшов перевірок Ryntra.",
  "This transfer cannot succeed as built.": "Цей переказ у такому вигляді не може виконатися.",
  "Ryntra cannot yet explain how this token moves.":
    "Ryntra ще не може пояснити, як рухається цей токен.",
  "The network fee could not be read. Review it again.":
    "Комісію мережі не вдалося прочитати. Перевір переказ ще раз.",
  "This transfer is not ready to send.": "Цей переказ ще не готовий до надсилання.",
  /* ── The general Send proof ──────────────────────────────────────────── */
  "Three immutable observations. The M1 Send receipt reconciled MATCHED with no deviation to record. M1B's preserves the deviation it found rather than reissuing a cleaner one, and M2's carries a hash-bound public correction naming the two inaccurate provenance sentences it shipped with.":
    "Три незмінні спостереження. Квитанція M1 для Send звірилася MATCHED — записувати відхилення не було чого. Квитанція M1B зберігає знайдене відхилення, а не перевидає чистішу версію, а квитанція M2 несе прив'язану за хешем публічну корекцію, яка називає два неточні речення про походження, з якими вона вийшла.",
  "The signed M1 Send Outcome Receipt, the signed M1B Outcome Receipt, the signed M2 Swap Outcome Receipt with its hash-bound correction, explorer proofs and both verifier paths.":
    "Підписана Outcome Receipt M1 для Send, підписана Outcome Receipt M1B, підписана Outcome Receipt M2 для Swap разом із прив'язаною за хешем корекцією, докази в explorer і обидва шляхи перевірки.",
  "No Bridge or Token-2022 receipt exists.": "Квитанцій для Bridge чи Token-2022 не існує.",
  "Send and Swap are closed for their exact proved actions. The bridge canary and the Token-2022 canary remain separate action-family gates.":
    "Send і Swap закриті для своїх точних доведених дій. Bridge canary і Token-2022 canary лишаються окремими гейтами родин дій.",
  "Two exact owner-signed transfers are finalized on Solana Mainnet. M1 moved 0.5 USDC to a recipient who already held an account and reconciled MATCHED — the first Solana receipt this product matched outright. M1B proved the harder shape before it, creating the recipient's account and paying its rent. Both were wallet-signed, submitted once and read back by two independent RPC operators.":
    "У мейннеті Solana фіналізовано два точні перекази, підписані власником. M1 переказав 0.5 USDC отримувачу, який уже мав account, і звірився MATCHED — це перша квитанція Solana, яку продукт звірив без жодного відхилення. M1B до нього довів складнішу форму: створив account отримувача й оплатив його ренту. Обидва підписані гаманцем, надіслані один раз і прочитані назад двома незалежними RPC-операторами.",
  "Neither proof promotes an amount, a destination or an asset beyond the ones actually sent. Nothing here executes on anyone's behalf: every transfer still needs a fresh build, a fresh simulation and the owner's own wallet confirmation.":
    "Жоден із цих доказів не поширюється на суму, адресу чи актив поза тими, які справді надіслали. Тут ніщо не виконується від чийогось імені: кожен переказ і далі потребує свіжої побудови, свіжої симуляції та власного підтвердження в гаманці власника.",
  "Send is proved for owner-signed classic SPL transfers. Supported Token-2022 cases wait on the Token-2022 canary, and Send as a finished product waits on its own production step.":
    "Send доведено для класичних SPL-переказів, підписаних власником. Підтримані випадки Token-2022 чекають на канарку Token-2022, а Send як завершений продукт — на власний виробничий крок.",

  /* Settings and the Hub Map. Fifteen keys that were never written, and the
     omission was not cosmetic: `translateSolana` throws rather than falling
     back to English, so a Ukrainian visitor met a 500 on `/settings` and on
     `/map` — two of the three surfaces a person opens before trusting the
     rest. Eleven of the fifteen sit behind the operator gate and only an
     operator could reach them; the other four are on the panel every visitor
     sees, which is why the page failed for everyone rather than for staff. */
  "Your own wallet signs every transfer, and no Ryntra server holds a key. A CCTP bridge needs a second signature no wallet can give — Circle's message account has to sign for its own creation — so the page makes a key for that one transaction, in this browser only. It can move no money, it is sent nowhere, and it is discarded once the burn is submitted.":
    "Кожен переказ підписує твій власний гаманець, і жоден сервер Ryntra не тримає ключа. Міст CCTP потребує другого підпису, якого не може дати жоден гаманець — обліковий запис повідомлення Circle мусить підписати власне створення — тому сторінка створює ключ на цю одну транзакцію і лише в цьому браузері. Він не може рухати гроші, нікуди не надсилається і стирається, щойно burn відправлено.",
  "Records": "Записи",
  "What is kept about an action is what it did and what it cost — never a key, a seed phrase or signed bytes.":
    "Про дію зберігається те, що вона зробила і скільки коштувала — ніколи ключ, seed-фраза чи підписані байти.",
  "Remaining": "Залишок",
  "of": "з",
  "What the canary budget was spent on": "На що витрачено канарковий бюджет",
  "On chain": "У мережі",
  "Why a signature is beside every figure": "Чому біля кожної цифри стоїть підпис",
  "A budget that prints only a total asks to be believed. Each row below names the transaction the exposure was settled against, and that transaction is a public fact: read it back on the chain and the ledger is either telling the truth or it is not. A HELD row is money promised to an action whose outcome is not yet known; it is counted against the ceiling and never counted as a spend.":
    "Бюджет, який друкує самий лише підсумок, просить вірити йому на слово. Кожен рядок нижче називає транзакцію, якою закрито експозицію, і ця транзакція — публічний факт: прочитай її в мережі, і реєстр або каже правду, або ні. Рядок HELD — це гроші, обіцяні дії, результат якої ще не відомий; вони рахуються проти стелі й ніколи не рахуються як витрата.",
  "Entries": "Рядки",
  "None. No canary action has committed or held budget under this policy.":
    "Немає. Жодна канаркова дія не списала і не зарезервувала бюджет за цією політикою.",
  "held, outcome unknown": "зарезервовано, результат невідомий",
  "no signature recorded": "підпис не записано",
  "remaining": "лишилося",
  "What the words on this page mean": "Що означають слова на цій сторінці",
  "Checking an earlier transfer…": "Перевіряємо попередній переказ…",
  "Waiting for an earlier transfer": "Чекаємо на попередній переказ",
  "Narrow this list": "Звузити список",
  "Export": "Експорт",
  "Owner Canary Policy": "Політика owner canary",
  "Customer money flows": "Клієнтські грошові потоки",
  "Unaffected": "Не зачеплені",
  "Owner canaries": "Owner canary",
  "Canary budget writes": "Записи в бюджет canary",
  "Enabled": "Увімкнено",
  "Disabled": "Вимкнено",
  "Reason": "Причина",
  "Last checked": "Останнє читання",
  "All": "Усі",
  "Still moving": "Ще в дорозі",
  "Nothing here under this filter.": "За цим фільтром нічого немає.",
  "History could not be loaded.": "Не вдалося завантажити історію.",
  "Some activity could not be loaded.": "Частину операцій не вдалося завантажити.",
  "Result": "Результат",
  "Date": "Дата",
  "Details not available": "Деталі недоступні",
  "No matching receipt in this browser": "У цьому браузері немає відповідної квитанції",
  "Show all": "Показати всі",
  "Stored on this device": "Збережено на цьому пристрої",
  "Operation details": "Деталі операції",
  "Operation details unavailable": "Деталі операції недоступні",
  "More": "Більше",
  "Source transaction": "Вихідна транзакція",
  "Destination transaction": "Цільова транзакція",
  /* The plan on the Spot ticket: the chip, the Strategy block, the gate. */
  "Under plan": "За планом",
  "Reading the plan…": "Читаємо план…",
  "Confirm your wallet to trade under the plan.": "Підтверди гаманець, щоб торгувати за планом.",
  "No such plan for this wallet.": "Такого плану для цього гаманця немає.",
  "This market is not the plan's asset.": "Цей ринок — не актив плану.",
  "Only an active plan is traded under.": "Торгувати можна лише за активним планом.",
  "Sized": "Розмір",
  "budget": "бюджет",
  "planned risk": "плановий ризик",
  "Trade without the plan": "Торгувати без плану",
  "Not under this plan": "Не за цим планом",
  "Within the plan": "У межах плану",
  "Within the plan · your call": "У межах плану · твоє рішення",
  "Outside the plan": "Поза планом",
  /* 1.7.0 — the refusal in one sentence, and the Review's four answers. */
  "could not be judged right now": "зараз не вдалося перевірити",
  "the plan expects": "план очікує",
  "A required check that cannot be judged does not sign — try again in a moment.": "Обов'язкова перевірка, яку не вдалося виконати, не підписує — спробуй за хвилину.",
  "The price now is": "Ціна зараз",
  "but your plan pays": "а план платить",
  "Wait for the price, or raise the bound in a new version of the plan.": "Дочекайся ціни або підніми межу в новій версії плану.",
  "The modelled loss at this price is": "Змодельована втрата за цією ціною",
  "more than the planned risk": "більше за плановий ризик",
  "Use the amount that fits the plan, or change the plan.": "Візьми суму, що вміщається в план, або зміни план.",
  "This amount": "Ця сума",
  "is above what the plan may spend": "більша за те, що план може витратити",
  "Lower the amount.": "Зменш суму.",
  "at or below the plan's invalidation": "на рівні або нижче інвалідації плану",
  "At this price the thesis is already wrong; the plan does not buy here.": "За цією ціною теза вже хибна; план тут не купує.",
  "The plan is": "План",
  "The plan moved to a newer version.": "План перейшов на новішу версію.",
  "Open it again and review on the current one.": "Відкрий його знову й пройди Review на поточній.",
  "The plan's entry validity is over": "Строк дії входу плану минув",
  "Extend it in a new version, or let the plan rest.": "Продовж його в новій версії або залиш план у спокої.",
  "This order is not the plan's": "Ця заявка не належить плану",
  "The reference is": "Референс",
  "the plan requires": "план вимагає",
  "Wait for a current reference, or change the rule in a new version.": "Дочекайся поточного референсу або зміни правило в новій версії.",
  "The price deviates": "Ціна відхиляється на",
  "from the reference": "від референсу",
  "the plan allows": "план дозволяє",
  "Review in four answers": "«Перевірка» у чотирьох відповідях",
  "Leaves your wallet": "Іде з гаманця",
  "Arrives, at least": "Надійде щонайменше",
  "expected": "очікувано",
  "All costs": "Усі витрати",
  "network": "мережа",
  "account reserve": "резерв рахунку",
  "impact": "вплив",
  "slippage up to": "сліпедж до",
  "Your plan": "Твій план",
  "No plan — a plain order": "Без плану — звичайна заявка",
  /* «Ринок · Регулярно» and a rule's purchase in the order (1.31.0) */
  "Order type": "Тип ордера",
  "Recurring": "Регулярно",
  "A rule reminds you on its day — you sign every purchase. Your money stays in your wallet.": "Правило нагадає в його день — кожну купівлю підписуєш ти. Гроші лишаються у твоєму гаманці.",
  "Confirm your wallet to set or see a rule on this token.": "Підтверди гаманець, щоб налаштувати чи побачити правило на цей токен.",
  "Your rules could not be read right now.": "Правила зараз не вдалося прочитати.",
  "Reading the rule…": "Читаємо правило…",
  "Not under this rule": "Не за цим правилом",
  "By your rule": "За правилом",
  "Bought by your rule": "Куплено за правилом",
  "Your rule": "Твоє правило",
  "Trade without the rule": "Купити без правила",
  "Confirm your wallet to buy by your rule.": "Підтверди гаманець, щоб купити за правилом.",
  "This rule is no longer in your wallet.": "Цього правила вже немає у твоєму гаманці.",
  "This market is not the rule's token.": "Цей ринок — не токен правила.",
  "This reminder's purchase is already bought.": "Купівлю за цим нагадуванням уже зроблено.",
  "A purchase under this reminder is already on its way.": "Купівля за цим нагадуванням уже в дорозі.",
  "The rule's purchase waits — its rule says why.": "Купівля за правилом чекає — чому, сказано в правилі.",
  "This reminder has closed. The next one comes on the rule's day.": "Це нагадування вже не діє. Наступне прийде в день правила.",
  "The token's pool is under the floor for a recurring buy now — the rule's purchase waits.": "Пул токена зараз нижче порогу регулярної купівлі — купівля за правилом чекає.",
  "The rule's price condition is not met right now — its purchase waits.": "Умова ціни правила зараз не виконана — купівля чекає.",
  "What is left of this month's budget does not cover the rule's purchase.": "Залишок бюджету місяця не покриває купівлю за правилом.",
  "This reminder can no longer be bought — read the rule again.": "За цим нагадуванням уже не купити — прочитай правило знову.",
  "The token's liquidity or price cannot be read right now — try again in a moment.": "Ліквідність чи ціну токена зараз не прочитати — спробуй за мить.",
  "Jupiter's audit flags this token, or Ryntra no longer supports it — the rule does not buy it.": "Аудит Jupiter позначає цей токен або Ryntra його більше не підтримує — правило його не купує.",
  "Modelled loss to the invalidation at this price": "Змодельована втрата до інвалідації за цією ціною",
  "planned": "заплановано",
  "checks passed": "перевірок пройдено",
  "Use the amount that fits the plan": "Взяти суму, що вміщується в план",
  "advisory": "порада",
  "unknown": "невідомо",
  "Plan is active": "План активний",
  "Exact representation": "Точне представлення",
  "Plan version": "Версія плану",
  "Entry still valid": "Вхід ще чинний",
  "Within the budget": "У межах бюджету",
  "Within what the plan may spend": "У межах того, що план може витратити",
  "Entry price bound": "Межа ціни входу",
  "Above the invalidation": "Вище за інвалідацію",
  "Planned risk": "Плановий ризик",
  "Sized spend": "Плановий обсяг",
  "Slippage bound": "Межа сліпеджу",
  "Pool liquidity": "Ліквідність пулу",
  "Units known": "Одиниці відомі",
  /* The evidence condition on the Review — the person's own rule on an observation. */
  "Evidence condition": "Умова за доказом",
  /* The second source on the Review — a rule on how the token is built, and one line per source under the checks. */
  "Due diligence": "Перевірка токена",
  "Onchain activity": "Активність у мережі",
  "Evidence sources": "Джерела доказів",
  "analysed": "проаналізовано",
  "asked": "запит о",
  "no observation": "спостереження немає",
  "the source may be up to": "джерело може відставати до",
  "min behind": "хв",
  "stale": "застаріло",
  "no data": "немає даних",
  "not available": "недоступно",
  /* The plan's price bound said beside the order before the Review. */
  "The price of this order is above your plan's limit.": "Ціна цієї заявки вища за ліміт твого плану.",
  "Now": "Зараз",
  "Your limit": "Твій ліміт",
  "This order, per share": "Ця заявка, за акцію",
  "The Review decides at signing.": "Вирішує Review при підписі.",
  /* Pre-IPO instruments in the Spot Review — the token as the unit, the issuer's mark named as such, the transfer fee the mint withholds. */
  "Tokens": "Токенів",
  "This order, per token": "Ця заявка, за токен",
  "Per token": "За токен",
  "Issuer's mark": "Оцінка емітента",
  "Token vs mark": "Токен проти оцінки",
  "not a market reference": "не ринковий референс",
  "Token transfer fee": "Комісія переказу токена",
  "the issuer's, inside the route": "емітента, всередині маршруту",
  "tokens as the wallet shows them": "токени, як їх показує гаманець",
  "Mark source": "Джерело оцінки",
  /* The pre-IPO context beside the executable price: this order against the issuer's mark, and the company's 24/7 index named for what Pyth says it is. */
  "vs the mark": "до оцінки",
  "Company index": "Індекс компанії",
  "indicative · not the token's price": "орієнтовний · не ціна токена",
  "unavailable": "недоступний",
  "The issuer no longer offers this token for purchase.": "Емітент більше не пропонує цей токен для купівлі.",
  /* A token Ryntra no longer supports: Spot's ticket, the Portfolio row, History. */
  "No longer supported in Ryntra": "Більше не підтримується в Ryntra",
  "You can sell it in your own wallet": "Продати можна у своєму гаманці",
  /* The order route's refusals under a plan — lib/solana/swap-failure-copy.ts. */
  "This order is outside the plan, so it was not offered. Change the amount, or the plan.": "Цей ордер поза планом, тому його не запропоновано. Зміни суму або план.",
  "The plan changed since this Review. Nothing was sent — review again on the current version.": "План змінився після цього Review. Нічого не відправлено — перевір знову на поточній версії.",
  "The plan is no longer active, so nothing was sent under it.": "План уже не активний, тому за ним нічого не відправлено.",
  "The confirmed wallet is not the one placing this order.": "Підтверджений гаманець — не той, що робить цей ордер.",
  "The plan could not record the Review. Nothing was sent — try again.": "План не зміг записати Review. Нічого не відправлено — спробуй ще раз.",
  /* Spot limits (B3): the «Ліміт» ticket and «Мої ордери» — app/solana/workspace/spot/limit-ticket.tsx, my-orders.tsx. */
  "Limit": "Ліміт",
  "Limit price": "Ціна ліміту",
  "per": "за",
  "Priced in": "Ціна в",
  "from the market": "від ринку",
  "Set the price.": "Вкажи ціну.",
  "This price is already the market: use a market order.": "Ця ціна вже є ринковою: став ринковий ордер.",
  "More than the wallet holds.": "Більше, ніж є в гаманці.",
  "Where the order waits": "Де чекає ордер",
  "Any pair · Ryntra fee by the pair": "Будь-яка пара · комісія Ryntra за парою",
  "Checking pools…": "Перевіряємо пули…",
  "No pool of this pair takes limits": "Немає пулу цієї пари з лімітами",
  "On-chain bin · no fee, earns pool fees": "Бін у пулі · без комісії, заробляє комісії пулу",
  "The order could not be prepared. Nothing was sent.": "Ордер не вдалося підготувати. Нічого не відправлено.",
  "The wallet did not sign. Nothing was sent.": "Гаманець не підписав. Нічого не відправлено.",
  "The order was not placed.": "Ордер не виставлено.",
  "Limit order placed": "Ліміт виставлено",
  "Sent — waiting for the network": "Надіслано — чекаємо мережу",
  "Trading is turned off right now.": "Торгівлю зараз вимкнено.",
  "Share of the available balance": "Частка доступного балансу",
  "Distance from the market": "Відступ від ринку",
  "Jupiter takes limit orders from 5 USD.": "Jupiter приймає ліміти від 5 USD.",
  "The network would refuse this order: check the balance and the SOL for fees.": "Мережа відхилила б цей ордер: перевір баланс і SOL на комісії.",
  "This order is already closed or being closed.": "Цей ордер уже закрито або закривається.",
  "No answer from Ryntra. Nothing was sent.": "Ryntra не відповіла. Нічого не відправлено.",
  "Waits for": "Чекає ціну",
  "New limit order": "Новий ліміт",
  "none": "немає",
  "none — the order earns half of its bin's swap fees": "немає — ордер отримує половину комісій свого біна",
  "Order account and pool bins, rent": "Рахунок ордера й біни пулу, рента",
  "Order account, rent returned on close": "Рахунок ордера, рента повертається при закритті",
  "at a limit on": "за лімітом на",
  "of what you get": "від отриманого",
  "Your price": "Твоя ціна",
  "Fills at": "Спрацює за",
  "Market now": "Ринок зараз",
  "The amount waits in Jupiter's order account until the market pays this price; Jupiter's keeper then swaps it into your wallet. Cancel at any time.": "Сума чекає в рахунку ордера Jupiter, доки ринок не дасть цю ціну; тоді кіпер Jupiter обміняє її у твій гаманець. Скасувати можна будь-коли.",
  "The amount sits in one price bin of the Meteora pool; when the market crosses it, the pool converts it at that price. Take it back at any time.": "Сума стоїть в одному ціновому біні пулу Meteora; коли ринок його перетне, пул обміняє її за цією ціною. Забрати можна будь-коли.",
  "Order account": "Рахунок ордера",
  "Ryntra fee account": "Рахунок комісії Ryntra",
  "not charged on this order": "на цьому ордері не береться",
  "A limit fills only if the market reaches its price.": "Ліміт спрацює, лише якщо ринок дійде до його ціни.",
  "The order was not cancelled.": "Ордер не скасовано.",
  "Taken back into your wallet.": "Повернуто у твій гаманець.",
  "Cancelled. The amount is back in your wallet.": "Скасовано. Сума повернулась у гаманець.",
  "Order": "Ордер",
  "Take back": "Забрати",
  /* The core's Review before a limit's cancellation (SOL-C14). */
  "Cancel the limit order": "Скасувати лімітний ордер",
  "Take back the converted order": "Забрати виконаний ордер",
  "the order account's rent": "рента рахунку ордера",
  "Filled so far": "Уже виконано",
  "Jupiter closes the order: what has not filled comes back to your wallet with the order account's rent. What already filled stays in your wallet.":
    "Jupiter закриває ордер: те, що не виконалось, повертається на твій гаманець разом з рентою рахунку ордера. Те, що вже виконалось, лишається на гаманці.",
  "Meteora closes the order in the pool: what has not converted, what has converted, the fees it earned and the rent come back to your wallet in one signature.":
    "Meteora закриває ордер у пулі: те, що не обмінялось, те, що обмінялось, зароблені ним комісії й рента повертаються на твій гаманець одним підписом.",
  "Connect a wallet to see your orders.": "Підключи гаманець, щоб бачити свої ордери.",
  "My orders": "Мої ордери",
  "Your orders could not be read right now.": "Зараз не вдалося прочитати твої ордери.",
  "No limit orders yet. Set one in the ticket: «Limit».": "Лімітних ордерів ще немає. Постав у тікеті: «Ліміт».",
  "Some venues did not answer; the list may be incomplete.": "Частина майданчиків не відповіла; список може бути неповним.",
  "Placing": "Виставляється",
  "Waiting": "Чекає",
  "Part filled": "Частково виконано",
  "Cancelling": "Скасовується",
  "Cancelled": "Скасовано",
  /* B16 — the terminal as a workplace: the bottom panel's account tabs, «Аналітика», «Про токен». */
  "Orders": "Ордери",
  "Position": "Позиція",
  "Mine": "Мої",
  "Analytics": "Аналітика",
  "About the token": "Про токен",
  "Need the chart and the trades?": "Потрібні графік і угоди?",
  /* B16, step 2: Spot on the core's terminal and its trade ticket — spot-terminal.tsx, spot-ticket.tsx, spot-workspace.tsx. */
  "Back to the order": "Назад до ордера",
  "Before you sign": "Перед підписом",
  "Fills at, after fees": "Спрацює за, з комісією",
  "Bin price": "Ціна біна",
  "Layout": "Розкладка",
  "needs an order book": "потрібен стакан",
  "Buy / Sell": "Купити / Продати",
  "No trades of this market were read yet.": "Угод цього ринку ще не прочитано.",
  "SOL is the network's own coin: its holders are not listed.": "SOL — власна монета мережі: її холдерів не перелічують.",
  "No holders were read yet.": "Холдерів ще не прочитано.",
  "No pools of this market were read yet.": "Пулів цього ринку ще не прочитано.",
  "No risk facts were read yet.": "Фактів ризику ще не прочитано.",
  "The chain has not confirmed this order yet. Look for it in «Orders» before you place another.": "Мережа ще не підтвердила цей ордер. Перш ніж ставити новий, пошукай його в «Ордерах».",
  "The outcome is not known. Check the transaction before you trade again.": "Підсумок невідомий. Перевір транзакцію, перш ніж торгувати далі.",

  /* Developers — Ryntra API v1: the contract, the generated document, the
     read-only client, its refusals, its cursors and what is deliberately not
     there yet (DEV-1). */
  "Ryntra API v1": "Ryntra API v1",
  "The contract, and the document": "Контракт і документ",
  "Why the document is generated": "Чому документ генерується",
  "The zod schemas the routes validate with are the only description of this API. The OpenAPI document is generated from them and a test regenerates it and compares, so the document cannot describe a field the routes do not produce — and the worked answers beside it are built the same way and parsed back with the same schemas. A hand-written OpenAPI file is a second description, and second descriptions disagree silently.": "Схеми zod, якими маршрути перевіряють запити, — єдиний опис цього API. Документ OpenAPI генерується з них, а тест перегенеровує його й порівнює, тож документ не може описати поле, якого маршрути не віддають, — і готові відповіді поруч побудовані так само й розібрані тими самими схемами. Написаний руками файл OpenAPI — це другий опис, а другі описи розходяться тихо.",
  "Contract version": "Версія контракту",
  "major": "мажор",
  "which every client names in": "який кожен клієнт називає в",
  "Every answer carries": "Кожна відповідь несе",
  "the exact version the route implements": "точну версію, яку реалізує маршрут",
  "Source of truth": "Джерело правди",
  "The document": "Документ",
  "generated by": "генерує",
  "Worked answers": "Готові відповіді",
  "real bodies, generated from the same schemas": "справжні тіла відповідей, згенеровані з тих самих схем",
  "Written reference": "Письмовий довідник",
  "The client": "Клієнт",
  "Reads only": "Лише читання",
  "Where its surface comes from": "Звідки береться його поверхня",
  "The client is generated from the document, and the document derives its read surface itself: every GET it serves without a bearer. Nothing is picked by hand, so a new public read joins the package the moment it joins the contract, and a read the document does not describe cannot be called from the package at all. The request discipline, the validator, the cursor walk and the error classes are written by hand beside it, because those are decisions rather than transcriptions.": "Клієнт генерується з документа, а документ сам виводить свою поверхню читання: кожен GET, який він віддає без bearer. Нічого не вибирається руками, тож нове публічне читання з'являється в пакеті тієї ж миті, коли з'являється в контракті, а читання, якого документ не описує, з пакета взагалі не викликати. Дисципліна запиту, перевірка, хід по курсору й класи помилок написані руками поруч, бо це рішення, а не перепис.",
  "Package": "Пакет",
  "no dependency beyond fetch, and no build step": "жодної залежності, крім fetch, і без кроку збірки",
  "Reads it serves": "Читань віддає",
  "Methods": "Методи",
  "one answer, a page at a time, the cursor flattened": "одна відповідь, сторінка за сторінкою, курсор зведений у список",
  "Answers are checked": "Відповіді перевіряються",
  "Every answer is validated against the contract's own schema before the client returns it. A field the contract does not know about is not a failure: the point of an additive contract is that adding one is safe, so a client already in use must survive it.": "Кожну відповідь перевірено за власною схемою контракту, перш ніж клієнт її віддасть. Поле, якого контракт не знає, — не збій: сенс додаткового контракту саме в тому, що додати поле безпечно, тож клієнт, який уже працює, має це витримати.",
  "Boundary": "Межа",
  "Reads only, and structurally rather than by policy: every read is a GET the contract serves without a bearer, so there is nothing to sign in with and nothing to authorise. The package holds no key, builds no transaction and signs nothing, because none of that code is in it.": "Лише читання, і це властивість будови, а не правило: кожне читання — GET, який контракт віддає без bearer, тож нема чим входити й нема чого дозволяти. Пакет не тримає ключів, не будує транзакцій і нічого не підписує, бо такого коду в ньому немає.",
  "Runnable example": "Приклад, який запускається",
  "a clean npm install, then one command; its own test runs offline": "чистий npm install, потім одна команда; власний тест працює без мережі",
  "Refusals, and whether to ask again": "Відмови й чи варто питати ще раз",
  "From the contract": "З контракту",
  "Why retryability is a table rather than a judgement": "Чому повторюваність — таблиця, а не здогад",
  "A 409 is a decision and a 429 is a queue. The client reads which is which from the contract's own error table instead of guessing from the status, so «can I ask again?» has one answer in one place — and a code newer than the client is still an error with a code, never a crash. Branch on the class and the code; the message is for a person and may change.": "409 — це рішення, а 429 — черга. Клієнт читає, де що, з власної таблиці помилок контракту, а не вгадує зі статусу, тож «чи можна спитати ще раз?» має одну відповідь в одному місці — а код, новіший за клієнт, лишається помилкою з кодом, а не падінням. Розгалужуйся за класом і кодом; повідомлення написане для людини й може змінитися.",
  "Codes": "Кодів",
  "of them worth asking again": "з них варто спитати ще раз",
  "Statuses used": "Використані статуси",
  "The request never got an answer. Always worth asking again, because nothing was decided.": "Запит не отримав відповіді. Завжди варто спитати ще раз, бо нічого не вирішено.",
  "A /api/v1 refusal with a stable code; its retryability comes from the contract's own table.": "Відмова /api/v1 зі стабільним кодом; чи варто повторювати — з власної таблиці контракту.",
  "A route outside /api/v1 refused, with its own code rather than a borrowed one.": "Відмовив маршрут поза /api/v1 — із власним кодом, а не позиченим.",
  "Something answered, but not with an answer.": "Щось відповіло, але не відповіддю.",
  "A 200 that is not the shape the contract states. Never retryable: the server meant it, and it disagrees with the document.": "200, форма якого не та, яку називає контракт. Повторювати не варто: сервер зробив, що хотів, і це розходиться з документом.",
  "Cursors, and the idempotency key": "Курсори й ключ ідемпотентності",
  "Stated as it is": "Сказано як є",
  "What the key does today": "Що ключ робить сьогодні",
  "The client sends the header on everything that is not a GET, and the caller may fix it so a retry repeats the same key — the point of a key is that one intent keeps one key. No route reads it yet: the store that would remember a key belongs with the API keys of the developer console. The consequence is drawn rather than hidden — a write is never retried automatically, because until the server remembers the key, retrying a write is writing twice.": "Клієнт надсилає заголовок на все, що не GET, і той, хто викликає, може задати його сам, щоб повтор повторив той самий ключ, — сенс ключа в тому, що один намір тримає один ключ. Жоден маршрут його ще не читає: сховище, яке пам'ятало б ключ, належить до ключів API консолі розробника. Наслідок не схований, а названий: запис ніколи не повторюється автоматично, бо поки сервер не пам'ятає ключа, повторити запис означає записати двічі.",
  "Paging": "Сторінки",
  "in,": "всередину,",
  "out; null means there is no next page. No total and no page number.": "назовні; null означає, що наступної сторінки немає. Ні загальної кількості, ні номера сторінки.",
  "Reads that page today": "Читання, які сьогодні сторінкуються",
  "Idempotency header": "Заголовок ідемпотентності",
  "sent by the client on every request that is not a GET": "клієнт надсилає на кожному запиті, який не GET",
  "Honoured by a route": "Чи читає його маршрут",
  "yes": "так",
  "Not yet — no route reads the header, so the client never retries a write on its own.": "Поки ні — жоден маршрут не читає заголовка, тож клієнт сам ніколи не повторює запис.",
  "What is not here": "Чого тут немає",
  "Absences, not plans": "Відсутності, не плани",
  "Why absences are listed": "Чому відсутності перелічені",
  "A developer surface that lists what it will have is a surface somebody tries to use. Each line below is an absence with the exact thing that would end it, and no date — because a date is a promise and a gate is a fact.": "Поверхня для розробників, яка перелічує те, що в неї буде, — це поверхня, якою хтось спробує скористатися. Кожен рядок нижче — відсутність із точною умовою, що її закриє, і без дати: дата — це обіцянка, а умова — факт.",
  "No route reads the idempotency header.": "Жоден маршрут не читає заголовка ідемпотентності.",
  "The client has no writes.": "У клієнті немає записів.",
  "What would end it: an authority a key-free package has no way to carry.": "Що це закриє: повноваження, яких пакет без ключів не має чим нести.",
  "The package is not published.": "Пакет не опубліковано.",
  "What would end it: a store that remembers a key for the window a retry lives in. The console's keys gave it somewhere to belong; nothing reads the header yet, so the client still never retries a write on its own.": "Що це закриє: сховище, яке пам'ятає ключ стільки, скільки живе повтор. Ключі консолі дали йому де оселитися; заголовка поки не читає ніхто, тож клієнт сам досі не повторює запис.",
  "A key reaches three reads, not the whole surface.": "Ключ дістає три читання, а не всю поверхню.",
  "The console's scopes are enforced where a route asks for one, and three routes do. The other public reads take no key because they need none; the keyed surface grows as routes adopt the check, not as names are added to the scope list.": "Межі консолі діють там, де маршрут їх питає, а питають три маршрути. Решта публічних читань ключа не беруть, бо він їм не потрібен; поверхня під ключем росте тоді, коли маршрути беруть перевірку, а не тоді, коли в список меж дописують назви.",
  "There is one webhook event, and it is the test one.": "Подія вебхука одна, і вона тестова.",
  "Deliveries are signed, retried and logged for real, and a replay is refused on the server. What is missing is producers: a product event joins the catalogue with the task that emits it.": "Доставки справді підписуються, повторюються й пишуться в журнал, а повтор сервер відхиляє. Бракує джерел: продуктова подія з'явиться в переліку разом із задачею, яка її породжує.",
  "No tariff is stated.": "Жодного тарифу не названо.",
  "The console names the fields a tariff has and fills none of them, and a quota window with no number is counted rather than refused. What would end it: the figures being set.": "Консоль називає поля тарифу й жодного не заповнює, а вікно квоти без числа рахується, а не відмовляє. Що це закриє: задані числа.",

  /* Developers — the console itself (DEV-2): projects, credentials, signed webhooks, quotas and the rights behind them. */
  "The developer console": "Консоль розробника",
  "Shipped, behind its switch": "Зроблено, за своїм перемикачем",
  "Why a secret key is refused in a browser rather than allowed carefully": "Чому секретний ключ у браузері відхиляють, а не дозволяють обережно",
  "An allowlist of origins is a rule about where a credential is used, and a secret key's problem is where it is kept. Once it is in a page it is in the reader's hands, and no list of origins changes that. So the console issues two different things: a secret key a server holds, which the server refuses outright on any request carrying an Origin, and a public key that has no secret at all — its id is the whole credential, and what bounds it is the origins it names.": "Перелік дозволених origin — це правило про те, звідки ключем користуються, а проблема секретного ключа в тому, де він лежить. Щойно він опинився на сторінці, він у руках читача, і жоден перелік origin цього не змінить. Тому консоль видає дві різні речі: секретний ключ, який тримає сервер і який сервер відхиляє на будь-якому запиті з Origin, і публічний ключ, у якого секрету немає зовсім, — його ідентифікатор і є весь ключ, а межі йому задають названі origin.",
  "Projects and environments": "Проєкти й середовища",
  "a project belongs to a team, and both environments exist from its first day; nothing is promoted between them": "проєкт належить команді, і обидва середовища є з першого дня; між ними нічого не переносять",
  "Credentials": "Ключі",
  "a secret key's token is returned in the answer that makes it and in no other, ever: the store keeps a SHA-256 of it and a key's read view has no field one could be in. Rotation leaves the predecessor answering for the hours you give it; revocation ends it from the next request on.": "токен секретного ключа повертається у відповіді, яка його створює, і в жодній іншій ніколи: сховище тримає його SHA-256, а в поданні ключа немає поля, де він міг би бути. Ротація лишає попередній ключ чинним на задані години; відкликання завершує його з наступного запиту.",
  "Scopes and origins": "Межі й origin",
  "each one gating a route that asks for it, so holding one changes an answer": "кожна закриває маршрут, який її питає, тож мати її — означає отримати іншу відповідь",
  "Signed webhooks": "Підписані вебхуки",
  "HMAC-SHA256 over the delivery's id, its second and the body. A receiver that checks only the signature is not protected from a replay: the same bytes verify for ever. The server refuses on a bad signature, a timestamp outside the window, or a delivery id this endpoint has already had verified.": "HMAC-SHA256 над ідентифікатором доставки, її секундою й тілом. Приймач, який перевіряє лише підпис, від повтору не захищений: ті самі байти перевіряються завжди. Сервер відхиляє хибний підпис, мітку часу поза вікном і ідентифікатор доставки, який для цього вебхука вже перевіряли.",
  "Quotas": "Квоти",
  "counted per project and environment, with what is left on the answer's headers. A window this deployment states no number for is counted and never refused.": "рахуємо на проєкт і середовище, а скільки лишилось — у заголовках відповіді. Вікно, для якого це розгортання числа не називає, рахується й ніколи не відмовляє.",
  "Rights": "Права",
  "Every action is one of the team's own rights, checked on the server on every request: reading is view, making a project is draft, issuing and revoking a credential is submit, the delivery log is receipts. The console invents no right and asks for no high-risk one.": "Кожна дія — це одне з прав самої команди, і сервер перевіряє його на кожному запиті: читання — перегляд, створення проєкту — чернетка, видача й відкликання ключа — подача, журнал доставок — квитанції. Консоль не вигадує прав і жодного високоризикового не просить.",
  "Tariffs": "Тарифи",
  "The fields a tariff has are named and none of them is filled: a price, an included call count and a ceiling are set outside this build.": "Поля тарифу названі, і жодне не заповнене: ціну, включені виклики й стелю задають поза цією збіркою.",
  "What would end it: a publication, which is the owner's own act.": "Що це закриє: публікація, а це дія власника.",
}


export function translateSolana(locale: WorkspaceLocale, english: string): string {
  if (locale === "en") return english;
  const translated = SOLANA_UK_TEXT[english];
  if (!translated) throw new Error(`Missing Ukrainian Solana translation: ${english}`);
  return translated;
}

/** Translate the bounded dynamic evidence sentences emitted by the adapter. */
export function translateSolanaMeaning(locale: WorkspaceLocale, english: string): string {
  if (locale === "en") return english;

  const decimals = /^Amounts divide into (\d+) decimal places\.$/.exec(english);
  if (decimals) return `Суми поділяються на ${decimals[1]} десяткових знаків.`;

  const unsupported = /^Extension "([^"]+)" is present on chain; this version has no written semantics for it yet\.$/.exec(english);
  if (unsupported) {
    return `Розширення «${unsupported[1]}» присутнє в chain; ця версія ще не має для нього описаної семантики.`;
  }

  const suffix = " (Account-scoped: normally lives on token accounts, observed here on the mint.)";
  if (english.endsWith(suffix)) {
    return `${translateSolanaMeaning(locale, english.slice(0, -suffix.length))} (Account-scoped: зазвичай міститься в token account; тут спостережено на mint.)`;
  }

  return translateSolana(locale, english);
}

/** Translate bounded validation output whose variable facts cannot be catalog keys. */
export function translateSolanaRuntime(locale: WorkspaceLocale, english: string): string {
  if (locale === "en") return english;

  const precision = /^This mint has (\d+) decimal places?; (\d+) were entered, and rounding silently would change the amount\.$/.exec(english);
  if (precision) {
    return `Цей mint має ${precision[1]} десяткових знаків; введено ${precision[2]}, а непомітне округлення змінило б суму.`;
  }

  const emptyAddress = /^Enter the (.+) — 32 to 44 base58 characters, copied from the wallet that owns it\.$/.exec(english);
  if (emptyAddress) return "Введи адресу отримувача: 32–44 символи base58, скопійовані з wallet, якому вона належить.";

  const foreignAddress = /^That is not a (.+) — it contains (.+), and base58 uses only digits and letters\.$/.exec(english);
  if (foreignAddress) return `Це не адреса отримувача: вона містить ${foreignAddress[2]}, а base58 використовує лише цифри й літери.`;

  const confusableAddress = /^That (.+) contains "([0OIl])", which base58 leaves out — 0, O, I and l are excluded because they are the characters people misread\. Copy the key rather than retyping it\.$/.exec(english);
  if (confusableAddress) return `Адреса отримувача містить «${confusableAddress[2]}», якого немає в base58. Символи 0, O, I та l виключені через схожість; скопіюй ключ замість ручного введення.`;

  const lengthAddress = /^A (.+) is 32 to 44 base58 characters; that one is (\d+)\. A short one is usually a truncated paste\.$/.exec(english);
  if (lengthAddress) return `Адреса отримувача повинна містити 32–44 символи base58; тут їх ${lengthAddress[2]}. Коротка адреса зазвичай означає неповне вставлення.`;

  return translateSolana(locale, english);
}
