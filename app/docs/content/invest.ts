import { RULE_DIP_PRESETS_PCT } from "../../../lib/autoinvest/limits.ts";
import { helpTopic } from "../../shell/help-topics.ts";
import { AUTOINVEST, FEES, FEES_UK, LOSS_LIMITS, LOSS_TARGETS, PURCHASE, SALE, ukDecimal } from "./facts.ts";
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Invest — the section of the menu where a person buys: a piece of a company
 * from $1, «Автоінвест», the company's page, private companies through
 * PreStocks, and what a token actually is. The five pages are what the old
 * Stocks page said in one scroll, laid out one question a page; its address
 * leads to «What you actually buy» by a 308, and its screener section is the
 * screener's own page under Trade.
 *
 * Every figure is the product's: the least a purchase is, the sum the sheet
 * opens on, the loss limits, the reminder's hours, the rules a wallet holds,
 * the price condition's limits and age, the round-up steps — read from the
 * code the screens use (`./facts`). The issuers' labels are the app's own
 * `?` topics, word for word.
 */

const DIP = RULE_DIP_PRESETS_PCT[0];
const usd = (value: string) => `$${value}`;

const label = (id: "truthXStocks" | "truthBackpack" | "truthOndo" | "truthPreStocks", locale: "en" | "uk") =>
  helpTopic(id, locale, id === "truthPreStocks" ? { fee: null } : undefined);

export const BUY: DocPage = {
  slug: "invest/buy",
  group: "invest",
  destination: "markets",
  title: { en: "Buy a piece of a company", uk: "Купити частинку компанії" },
  seoTitle: { en: "Buy a piece of a company from $1 — Ryntra Docs", uk: "Купити частинку компанії від $1 — Документація Ryntra" },
  summary: {
    en: "Buying in dollars from $1 and selling from your position: the Review in four lines, your signature, the receipt — and the account's one-time reserve.",
    uk: "Купівля в доларах від $1 і продаж із позиції: «Перевірка» в чотири рядки, твій підпис, квитанція — і разовий резерв рахунку.",
  },
  sections: [
    section("how", "How to buy", "Як купити", [
      steps(
        [
          "Open a company from Home or Markets and press Buy.",
          `Type any sum in dollars from ${usd(PURCHASE.minimum)} — the sheet opens on ${usd(PURCHASE.opensOn)} — or take a share of your USDC in one press: ${PURCHASE.shares}. The sheet says at once how much of a share it buys and what the purchase costs, all of it.`,
          `Choose a loss limit, or leave it at None: −${LOSS_LIMITS.careful} or −${LOSS_LIMITS.balanced} below the price you buy at.`,
          "Press Buy. The Review is four lines — You pay, You get at least, All costs, and What it is.",
          "Sign in your wallet. The receipt says what you now own, and the purchase is in History with its receipt.",
        ],
        [
          "Відкрий компанію з Головної чи Ринків і натисни «Купити».",
          `Впиши будь-яку суму в доларах від ${usd(PURCHASE.minimum)} — аркуш відкривається на ${usd(PURCHASE.opensOn)} — або одним натиском візьми частку своїх USDC: ${PURCHASE.shares}. Аркуш одразу каже, скільки частки акції вона купує і скільки коштує купівля — усі витрати.`,
          `Обери межу збитку або лиши «Немає»: −${LOSS_LIMITS.careful} чи −${LOSS_LIMITS.balanced} нижче ціни купівлі.`,
          "Натисни «Купити». «Перевірка» — чотири рядки: Спишеться, Отримаєш щонайменше, Усі витрати і Що це.",
          "Підпиши в гаманці. Квитанція скаже, що тепер у тебе є, а купівля з'явиться в Історії разом із квитанцією.",
        ],
      ),
      note(
        "Nothing is bought until your wallet signs. If the price moves past the Review before you sign, Ryntra asks you to refresh it rather than signing stale terms.",
        "Нічого не куплено, доки не підпише твій гаманець. Якщо ціна вийшла за «Перевірку» до підпису, Ryntra попросить оновити її, а не підписувати застарілі умови.",
      ),
    ]),
    section("sell", "How to sell", "Як продати", [
      steps(
        [
          "On the company's page press Sell beside Your position — or press Sell on the position in Portfolio.",
          `Type any sum in dollars from ${usd(SALE.minimum)} — the sheet opens on ${usd(SALE.opensOn)} when your position is worth that — or take a share of the position in one press: ${SALE.shares}; 100% is exactly what you hold. The sheet says at once how many dollars it brings and what the sale costs, all of it.`,
          "Press Sell. The Review is four lines — You sell, You get at least, All costs, and What it is.",
          "Sign in your wallet. The receipt says Sold with the sum, and the sale is in History with its receipt.",
        ],
        [
          "На сторінці компанії натисни «Продати» біля «Твоя позиція» — або «Продати» на позиції в Портфелі.",
          `Впиши будь-яку суму в доларах від ${usd(SALE.minimum)} — аркуш відкривається на ${usd(SALE.opensOn)}, коли позиція стільки варта, — або одним натиском візьми частку позиції: ${SALE.shares}; 100% — рівно те, що маєш. Аркуш одразу каже, скільки доларів вона принесе і скільки коштує продаж — усі витрати.`,
          "Натисни «Продати». «Перевірка» — чотири рядки: Спишеться, Отримаєш щонайменше, Усі витрати і Що це.",
          "Підпиши в гаманці. Квитанція скаже «Продано» із сумою, а продаж з'явиться в Історії разом із квитанцією.",
        ],
      ),
      note(
        "The dollars arrive as USDC in your own wallet. A PreStocks token may not sell — the issuer promises no liquidity — and its sale pays the issuer's fee on the transfer, read from the chain, on its own line under All costs.",
        "Долари надходять як USDC у твій гаманець. Токен PreStocks продати може не вийти — емітент ліквідності не обіцяє, — а його продаж платить комісію емітента за переказ, прочитану з ланцюга, окремим рядком під «Усі витрати».",
      ),
    ]),
    section("costs", "What a purchase costs", "Скільки коштує купівля", [
      list(
        [
          `All costs is everything the purchase costs beyond what it buys: Ryntra's ${FEES.company} service fee and any fee inside the route, the price impact and the network fee.`,
          "A first purchase of a token also sets aside a small one-time reserve that opens the token's account in your wallet. It stays yours, and the Review states it apart from the costs.",
          "Where $1 has no route for a company, the sheet says that company's own minimum, read from the quote.",
          "A private company's token by PreStocks carries the issuer's fee on every transfer, its rate read from the chain: the Review states it on its own line under All costs, and what arrives is already after it.",
        ],
        [
          `«Усі витрати» — усе, що купівля коштує понад те, що купує: комісія Ryntra ${FEES_UK.company} і будь-яка комісія всередині маршруту, вплив на ціну й плата мережі.`,
          "Перша купівля токена ще відкладає невеликий разовий резерв, що відкриває рахунок цього токена у твоєму гаманці. Він лишається твоїм, і «Перевірка» називає його окремо від витрат.",
          "Якщо для компанії на $1 маршруту немає, аркуш назве її власний мінімум, прочитаний із котирування.",
          "Токен приватної компанії від PreStocks несе комісію емітента з кожного переказу, її ставку прочитано з ланцюга: «Перевірка» показує її окремим рядком під «Усі витрати», а те, що надійде, — уже без неї.",
        ],
      ),
    ]),
    section("limit", "The loss limit", "Межа збитку", [
      p(
        "A loss limit is kept as a plan on your wallet — one message your wallet signs, not a transaction. Once Telegram is connected, Ryntra writes to you there when the price reaches it; it never sells or signs for you, and a price can jump past a limit.",
        "Межа збитку зберігається як план на твоєму гаманці — одне повідомлення, яке підписує гаманець, а не транзакція. Щойно Telegram під'єднано, Ryntra напише туди, коли ціна до неї дійде; вона ніколи не продає й не підписує за тебе, а ціна може проскочити межу.",
      ),
      p(
        `A company you already hold gets one too. In Monitoring, on its page and in Portfolio a position without an exit reads «Attention: bought — no exit set»; «Turn on “Ryntra will warn you”» sets a loss limit and a target from the price now — Careful −${LOSS_LIMITS.careful} / +${LOSS_TARGETS.careful}, Balanced −${LOSS_LIMITS.balanced} / +${LOSS_TARGETS.balanced} — with Telegram connected. Every position then reads one state with one action: On track, Attention, Action needed (the limit or the target reached — Open the sale) or Paused by the issuer.`,
        `Межу можна поставити й на компанію, яку вже маєш. У Нагляді, на її сторінці й у Портфелі позиція без виходу показує «Увага: куплено — вихід не налаштований»; «Увімкнути «Ryntra попередить»» ставить межу збитку й ціль від ціни зараз — «Обережно» −${LOSS_LIMITS.careful} / +${LOSS_TARGETS.careful}, «Збалансовано» −${LOSS_LIMITS.balanced} / +${LOSS_TARGETS.balanced} — з під'єднаним Telegram. Далі в кожної позиції один стан і одна дія: «Все за планом», «Увага», «Дія» (межу чи ціль досягнуто — «Відкрити продаж») або «Пауза емітента».`,
      ),
    ]),
    section("who", "Who can buy", "Хто може купувати", [
      p(
        "The issuer decides. By their own documents xStocks, Backpack and PreStocks are not for the US, and Backpack is not for the UK, the UAE or Japan either; a private company's page carries «Who may hold it». Ryntra never works around an issuer's restrictions.",
        "Це вирішує емітент. За своїми документами xStocks, Backpack і PreStocks — не для США, Backpack — ще й не для Великої Британії, ОАЕ та Японії; у приватних компаній рядок «Хто може тримати» — на сторінці компанії. Ryntra не обходить обмежень емітента.",
      ),
    ]),
  ],
  related: ["invest/what-you-buy", "invest/autoinvest", "reference/review", "reference/fees"],
};

export const AUTOINVEST_PAGE: DocPage = {
  slug: "invest/autoinvest",
  group: "invest",
  destination: "autoinvest",
  title: { en: "Autoinvest", uk: "«Автоінвест»" },
  seoTitle: { en: "Autoinvest: three rules and a budget — Ryntra Docs", uk: "«Автоінвест»: три правила й бюджет — Документація Ryntra" },
  summary: {
    en: "Every day or week, when a price falls, or from every USDC payment: Ryntra reminds you and you sign each purchase. The monthly budget and the price condition.",
    uk: "Щодня чи щотижня, коли ціна впаде, або з кожної оплати USDC: Ryntra нагадує, кожну купівлю підписуєш ти. Бюджет місяця й «Умова ціни».",
  },
  sections: [
    section("what", "What Autoinvest is", "Що таке «Автоінвест»", [
      p(
        "Autoinvest buys a piece of a company by a rule you set. When the rule falls due, Ryntra reminds you, and you sign each purchase; the money stays in your wallet until you do. A rule never buys anything on its own.",
        "«Автоінвест» купує частинку компанії за правилом, яке задаєш ти. Коли настає час правила, Ryntra нагадує, а кожну купівлю підписуєш ти; гроші лежать у твоєму гаманці, доки ти не підпишеш. Правило саме нічого не купує.",
      ),
      table(
        { en: ["Rule", "When it reminds you", "For example"], uk: ["Правило", "Коли нагадує", "Наприклад"] },
        {
          en: [
            ["Regularly", "Every day, every week or every month, on your day and at your time", "$1 of NVIDIA every day at 14:00"],
            ["If it falls", `When the price drops the per cent you choose below its reference point — ${AUTOINVEST.dipPresets}`, `If NVIDIA falls ${DIP}% — buy $20 more`],
            ["From every payment", `A round-up of each USDC payment to ${AUTOINVEST.roundupSteps}, a sum from each payment, or a per cent of what comes in`, "A $3.40 payment → $0.60 into NVIDIA"],
          ],
          uk: [
            ["Регулярно", "Щодня, щотижня чи щомісяця — у твій день і о твоїй годині", "$1 у NVIDIA щодня о 14:00"],
            ["Якщо впаде", `Коли ціна опуститься на обраний відсоток нижче точки відліку — ${AUTOINVEST.dipPresets}`, `Якщо NVIDIA впаде на ${DIP}% — докупити $20`],
            ["З кожної оплати", `Округлення кожної оплати USDC до ${AUTOINVEST.roundupSteps}, сума з кожної оплати або відсоток із надходжень`, "Оплата $3,40 → $0,60 у NVIDIA"],
          ],
        },
      ),
    ]),
    section("set-up", "Set up a rule", "Налаштувати правило", [
      steps(
        [
          "On a company's page press Autoinvest — or Add a rule under Autoinvest on Home, in Portfolio or on the Autoinvest page, or Buy weekly on a purchase's receipt.",
          `Choose the rule, the sum of each purchase — from ${AUTOINVEST.minimum} — and when. The sheet shows when the first reminder comes.`,
          "Press Turn on. Your wallet signs one message to save the rule — not a transaction.",
          "When the rule falls due, a reminder arrives in Ryntra, and in Telegram once it is connected. One tap opens a fresh Review for the rule's sum; sign it, and the receipt names the rule and the next purchase.",
        ],
        [
          "На сторінці компанії натисни «Автоінвест» — або «Додати правило» в блоці «Автоінвест» на Головній, у Портфелі чи на сторінці «Автоінвест», або «Купувати щотижня» в квитанції купівлі.",
          `Обери правило, суму кожної купівлі — від ${AUTOINVEST.minimum} — і коли. Аркуш покаже, коли прийде перше нагадування.`,
          "Натисни «Увімкнути». Гаманець підписує одне повідомлення, щоб зберегти правило, — не транзакцію.",
          "Коли настає час правила, нагадування приходить у Ryntra, а в Telegram — щойно його під'єднано. Один дотик відкриває свіжу «Перевірку» на суму правила; підпиши — і квитанція назве правило й наступну купівлю.",
        ],
      ),
    ]),
    section("reminders", "Reminders", "Нагадування", [
      list(
        [
          "Your rules and the monthly budget are on Home, in Portfolio and on the Autoinvest page, each rule with its switch.",
          "While a reminder is open, the company's page offers Buy $X by your rule first. A one-off purchase — on the page or in Spot — leaves the reminder open: a rule counts only a purchase made by it, and both say so.",
          `A reminder stays open for ${AUTOINVEST.reminderHours} hours. One you do not sign is marked Missed — Ryntra never buys it later and never doubles the next one.`,
          "Pause stops the reminders; turn the rule on again and it counts from then. Deleting a rule keeps its purchases in History, each marked Autoinvest.",
          `A wallet holds up to ${AUTOINVEST.rules} rules. A purchase by a rule goes through the same Review, costs and signature as any other.`,
        ],
        [
          "Твої правила й бюджет місяця — на Головній, у Портфелі й на сторінці «Автоінвест», кожне правило зі своїм перемикачем.",
          "Поки нагадування відкрите, сторінка компанії першою пропонує «Купити $X за правилом». Звичайна купівля — на сторінці чи в Споті — лишає нагадування відкритим: правило рахує лише купівлю за правилом, і обидві про це кажуть.",
          `Нагадування діє ${AUTOINVEST.reminderHours} години. Непідписане позначається «Пропущено»: Ryntra не купує його пізніше й не подвоює наступне.`,
          "Пауза зупиняє нагадування; увімкни правило знову — і відлік піде від тієї миті. Видалене правило лишає свої купівлі в Історії, кожну з позначкою «Автоінвест».",
          `У гаманці може бути до ${AUTOINVEST.rules} правил. Купівля за правилом проходить ту саму «Перевірку», витрати й підпис, що й будь-яка інша.`,
        ],
      ),
    ]),
    section("dip", "If it falls", "Якщо впаде", [
      list(
        [
          `Choose the sum and how far the price should fall — ${AUTOINVEST.dipPresets}. The reference point is the company's price when you turn the rule on; the sheet shows the price the reminder comes at.`,
          "When the price is read at or below that line, one reminder comes — one per fall. If the price comes back above the line and falls again, that is a new reminder.",
          "After a purchase by the rule, the reference point moves to what that purchase paid; turning the rule on again after a pause starts from the price then.",
        ],
        [
          `Обери суму й на скільки має впасти ціна — ${AUTOINVEST.dipPresets}. Точка відліку — ціна компанії, коли ти вмикаєш правило; аркуш показує ціну, при якій прийде нагадування.`,
          "Щойно ціна опиняється на цій позначці або нижче, приходить одне нагадування — одне на падіння. Якщо ціна повернулася вище позначки й знову впала — це нове нагадування.",
          "Після купівлі за правилом точка відліку переходить на ціну цієї купівлі; увімкнене знову після паузи правило рахує від тодішньої ціни.",
        ],
      ),
    ]),
    section("payments", "From every payment", "З кожної оплати", [
      list(
        [
          `The third kind of rule sets money aside for a company from your wallet's own USDC on Solana: round every payment up to the next ${AUTOINVEST.roundupSteps}, a fixed sum from every payment (${AUTOINVEST.fixedFrom}–${AUTOINVEST.fixedTo}), or a per cent of every USDC that comes in (${AUTOINVEST.percentPresets}).`,
          "A payment is a USDC transfer to someone else that your wallet signed; money that came in is USDC someone else sent you. Each one counts once, from the moment the rule is on. Swaps, Ryntra purchases, bridges and transfers between your own accounts never count; a transfer to your other wallet can be marked My account, and such transfers stop counting.",
          `What the rule sets aside gathers — the money stays in your wallet — until it reaches the rule's minimum, ${AUTOINVEST.minimum} or the company's own when its route starts higher. Then one reminder, «From payments: $1.30 → Apple», opens a fresh Review with the price condition, and only your signature buys. The monthly budget counts it; a switch pauses it. Ryntra never names a shop; a payment's Solana Pay label is shown when it has one.`,
        ],
        [
          `Третій вид правила відкладає гроші в компанію з USDC твого гаманця в Solana: округлення кожної оплати до ${AUTOINVEST.roundupSteps}, фіксована сума з кожної оплати (${ukDecimal(AUTOINVEST.fixedFrom)}–${AUTOINVEST.fixedTo}) або відсоток із кожного надходження USDC (${AUTOINVEST.percentPresets}).`,
          "Оплата — переказ USDC комусь іншому, який підписав твій гаманець; надходження — USDC, які тобі надіслав хтось інший. Кожна подія рахується один раз, від миті, коли правило ввімкнено. Обміни, купівлі в Ryntra, мости й перекази між твоїми рахунками не рахуються; переказ на твій інший гаманець можна позначити «Мій рахунок», і такі перекази більше не рахуються.",
          `Відкладене копиться — гроші лежать у твоєму гаманці — доки не набереться мінімум правила: ${AUTOINVEST.minimum} або мінімум самої компанії, коли її маршрут починається вище. Тоді одне нагадування «З оплат: $1,30 → Apple» відкриває свіжу «Перевірку» з «Умовою ціни», і купує лише твій підпис. Бюджет місяця це рахує; пауза — перемикачем. Магазин Ryntra не називає; мітку Solana Pay оплати показує, коли вона є.`,
        ],
      ),
    ]),
    section("budget", "The monthly budget", "Бюджет місяця", [
      list(
        [
          `A ceiling for all your rules in a calendar month, from ${usd(AUTOINVEST.budgetMinimum)}, on your own clock — At most per month, never the sum of one purchase. It is its own line under Autoinvest: No budget set · Set, or $45 of $100 over the month's bar. Only you change it.`,
          "Only finished purchases by rules count; one still on its way counts until its outcome is known. A reminder you did not buy counts nothing.",
          "A purchase that does not fit what is left is not reminded of: one note says the budget is spent, and your rules stand until the 1st — or until you change the budget.",
        ],
        [
          `Стеля для всіх правил на календарний місяць, від ${usd(AUTOINVEST.budgetMinimum)}, за твоїм годинником, — «Не більше на місяць», ніколи не сума однієї купівлі. Це окремий рядок у блоці «Автоінвест»: «Бюджет не задано · Задати» або «$45 з $100» над смужкою місяця. Змінюєш лише ти.`,
          "Рахуються лише завершені купівлі за правилами; незавершена — доки не з'ясується її результат. Нагадування без купівлі не рахується.",
          "Купівлю, що не вміщається в залишок, Ryntra не нагадує: одна нотатка каже, що бюджет вичерпано, і правила стоять до 1-го числа — або доки ти не зміниш бюджет.",
        ],
      ),
    ]),
    section("price", "The price condition", "«Умова ціни»", [
      list(
        [
          `On a company with a reference — PreStocks' valuation for a private company, the issuer's reference per share for a listed one — a rule can carry Price condition: don't buy if it costs more than N% above the reference — ${AUTOINVEST.conditionPresets}, ${AUTOINVEST.conditionDefault} unless you choose another, or No condition. The sheet shows how the price stands now.`,
          `When the rule falls due, Ryntra checks the price against the reference. Within your limit, the reminder comes as usual. Above it — or when the price or the reference is more than ${AUTOINVEST.conditionMaxAgeMinutes} minutes old, or missing — the purchase is deferred: one note in the bell and in Notifications on Home says why, with the figure and the time of the data, and the rule checks again while the reminder is open. Never met, it is marked Missed.`,
          "PreStocks' valuation is PreStocks' own figure — not a fair price and not a market price. The Review of a rule's purchase carries the condition's line: how far the price stands from the reference, the reference, your limit and the time of the data.",
        ],
        [
          `Для компанії з орієнтиром — оцінкою PreStocks для приватної компанії, орієнтиром емітента за акцію для публічної — правило може мати «Умову ціни»: не купувати, якщо дорожче за орієнтир більш ніж на N % — ${AUTOINVEST.conditionPresets}, ${AUTOINVEST.conditionDefault}, якщо ти не обереш інше, або «Без умови». Аркуш показує, як ціна стоїть зараз.`,
          `Коли настає час правила, Ryntra порівнює ціну з орієнтиром. У межах твого ліміту нагадування приходить, як завжди. Понад ліміт — або коли ціна чи орієнтир старші за ${AUTOINVEST.conditionMaxAgeMinutes} хвилин чи їх немає — купівлю відкладено: одна нотатка в дзвіночку й у «Сповіщеннях» на Головній каже чому, з числом і часом даних, а правило перевіряє знову, поки нагадування відкрите. Якщо умову так і не виконано — «Пропущено».`,
          "Оцінка PreStocks — власна цифра PreStocks, не справедлива ціна й не ринкова. «Перевірка» купівлі за правилом має рядок умови: наскільки ціна відходить від орієнтира, сам орієнтир, твій ліміт і час даних.",
        ],
      ),
    ]),
  ],
  related: ["invest/buy", "invest/private-companies", "reference/review"],
};

export const COMPANY_PAGE: DocPage = {
  slug: "invest/company-page",
  group: "invest",
  destination: "markets",
  title: { en: "The company page", uk: "Сторінка компанії" },
  seoTitle: { en: "The company page: figures, path, what you buy — Ryntra", uk: "Сторінка компанії: цифри, шлях, що купуєш — Ryntra" },
  summary: {
    en: "What a company's page shows: the price in $, key figures from SEC filings with dates, the company's path to an exchange, and what the token is.",
    uk: "Що показує сторінка компанії: ціна в $, ключові показники зі звітів SEC з датами, шлях компанії до біржі і що це за токен.",
  },
  sections: [
    section("page", "One page, one action", "Одна сторінка, одна дія", [
      p(
        "A company has one page and one action, the same for everyone: the company by its name and logo, the price in dollars with the day's change, a line over a day, a week, a month or a year, one line about what the token is — and Buy.",
        "Компанія має одну сторінку й одну дію, однакові для всіх: компанія за назвою й логотипом, ціна в доларах зі зміною за день, лінія за день, тиждень, місяць чи рік, один рядок про те, що це за токен, — і «Купити».",
      ),
      table(
        { en: ["Block", "What it holds", "Where it comes from"], uk: ["Блок", "Що в ньому", "Звідки"] },
        {
          en: [
            ["Key figures", "The company's size and results — revenue, earnings, market value, P/E, the dividend — and the price over the year", "Its SEC filings, dated; the price line from the token's pool"],
            ["About the company", "What it does, its industry, where it is, where it lists, its latest report", "Its SEC records and the issuer's catalogue"],
            ["What you buy", "The issuer's label and line, the backing, the dividends, the issuer's fee", "The issuer's documents and reserves; the fee and the multiplier from the chain"],
            ["Trading on Solana", "The token's day: volume, liquidity, holders, traders, buying against selling", "Jupiter's market data, with its time"],
          ],
          uk: [
            ["Ключові показники", "Розмір і результати компанії — виторг, прибуток, ринкова вартість, P/E, дивіденди — і ціна за рік", "Її звіти до SEC, з датою; лінія ціни — з пулу токена"],
            ["Про компанію", "Що робить, галузь, де вона, де торгується, останній звіт", "Її записи в SEC і каталог емітента"],
            ["Що ти купуєш", "Мітка й рядок емітента, забезпечення, дивіденди, комісія емітента", "Документи й резерви емітента; комісія й множник — з ланцюга"],
            ["Торги на Solana", "День токена: обсяг, ліквідність, власники, трейдери, купівлі проти продажів", "Ринкові дані Jupiter, з часом"],
          ],
        },
      ),
      note(
        "A figure no source states is not drawn, and a block with nothing to say is not drawn at all — never a zero, never a guess.",
        "Цифру, якої не дає жодне джерело, не показано, а блок, якому нічого сказати, не показано взагалі — ніколи не нуль і ніколи не здогад.",
      ),
    ]),
    section("path", "The company's path", "Шлях компанії", [
      p(
        "Under the company's name, one strip: Private · PreStocks → IPO → Exchange → Solana, the step the company stands at marked, the date of each step and its sources under Sources. SpaceX's two tokens are one company at two steps — SPACEX by PreStocks and SPCXx by xStocks — each page leading to the other, with the deadline to swap SPACEX under the strip.",
        "Під назвою компанії — одна смужка: Приватна · PreStocks → IPO → Біржа → Solana, крок, на якому компанія зараз, позначено, дата кожного кроку й джерела — у «Джерелах». Два токени SpaceX — одна компанія на двох кроках: SPACEX від PreStocks і SPCXx від xStocks; кожна сторінка веде до іншої, а строк обміну SPACEX — під смужкою.",
      ),
    ]),
    section("deeper", "A tap deeper", "На дотик глибше", [
      p(
        "Everything else is one press away, under Details: Ryntra's Brief, the issuer's reference and the deviation, the reserves, the multiplier, the terms for another sum with the company's other tokens beside it, the pools, the activity on the chain, the risk card and the mint. The candlestick chart is in Spot.",
        "Усе інше — за один дотик, у «Деталях»: Brief від Ryntra, орієнтир емітента й відхилення, резерви, множник, умови для іншої суми з іншими токенами тієї ж компанії поруч, пули, активність у мережі, картка ризику й mint. Свічковий графік — у Споті.",
      ),
    ]),
  ],
  related: ["invest/what-you-buy", "invest/buy", "trade/screener"],
};

export const PRIVATE_COMPANIES: DocPage = {
  slug: "invest/private-companies",
  group: "invest",
  destination: "markets",
  title: { en: "Private companies", uk: "Приватні компанії" },
  seoTitle: { en: "Pre-IPO companies: PreStocks tokens — Ryntra Docs", uk: "Приватні компанії до IPO: токени PreStocks — Ryntra" },
  summary: {
    en: "OpenAI, Anthropic and other private companies through PreStocks: not a share, the issuer's fee from the chain, the price against the valuation, and the IPO.",
    uk: "OpenAI, Anthropic та інші приватні компанії через PreStocks: не акція, комісія емітента з ланцюга, ціна проти оцінки PreStocks і що буде на IPO.",
  },
  sections: [
    section("what", "What a PreStocks token is", "Що таке токен PreStocks", [
      p(
        "A PreStocks token gives economic exposure to a private company — no ownership, no vote, no dividends — under PreStocks' own terms. It is not a share, selling it may not be possible, and the issuer can freeze, move or take back the token. The company's page and the purchase say so before any figure.",
        "Токен PreStocks дає економічну експозицію на приватну компанію — без власності, голосу й дивідендів — на умовах самого PreStocks. Це не акція, продати його може не вийти, а емітент може заморозити, перемістити чи забрати токен. Сторінка компанії й купівля кажуть це раніше за будь-яку цифру.",
      ),
      facts(
        [
          ["Label", label("truthPreStocks", "en").title],
          ["Issuer's fee", "On every transfer, its rate read from the chain and shown in the Review"],
          ["Price", "Per token, set against PreStocks' own valuation of the company"],
          ["Who may hold it", "The company's page says it; by PreStocks' documents, not the US"],
        ],
        [
          ["Мітка", label("truthPreStocks", "uk").title],
          ["Комісія емітента", "З кожного переказу, ставку прочитано з ланцюга й показано в «Перевірці»"],
          ["Ціна", "За токен, поруч з оцінкою компанії від самого PreStocks"],
          ["Хто може тримати", "Про це каже сторінка компанії; за документами PreStocks — не США"],
        ],
      ),
    ]),
    section("valuation", "The price against the valuation", "Ціна проти оцінки", [
      p(
        "Beside the price, one number: how far the token stands above or below PreStocks' own valuation of the company, with the time the valuation was read. The valuation is PreStocks' figure — not a fair price and not a market price. Where a company has spoken about tokens like these, the page says so, with its sources under Details.",
        "Поруч із ціною — одне число: наскільки токен вище чи нижче власної оцінки компанії від PreStocks, з часом, коли оцінку прочитано. Оцінка — цифра PreStocks, не справедлива ціна й не ринкова. Якщо компанія висловилась про такі токени, сторінка каже це, а джерела — у «Деталях».",
      ),
    ]),
    section("ipo", "When the company lists", "Коли компанія виходить на біржу", [
      p(
        "When a private company lists or is bought, its PreStocks token has a deadline: it must be swapped, or it expires. Ryntra shows the event and the deadline on the company's page, in Portfolio and in the bell, with one action — Swap: a fresh Review and your signature. SpaceX has listed, and its page says until when SPACEX can be swapped for SPCXx.",
        "Коли приватна компанія виходить на біржу чи її купують, токен PreStocks має строк: його треба обміняти, інакше він згорить. Ryntra показує подію й строк на сторінці компанії, у Портфелі й у дзвіночку однією дією — «Обміняти»: свіжа «Перевірка» й твій підпис. SpaceX уже на біржі, і її сторінка каже, до коли SPACEX можна обміняти на SPCXx.",
      ),
    ]),
    section("before", "Before you buy", "Перш ніж купити", [
      list(
        [
          "Selling may not be possible: the issuer promises no liquidity.",
          "The issuer can freeze the token, pause transfers, and move or burn it from any wallet.",
          "A full loss is possible, and the price can stand far from the valuation.",
          "Autoinvest works by reminder for these tokens too; each purchase is your signature.",
        ],
        [
          "Продати може не вийти: емітент ліквідності не обіцяє.",
          "Емітент може заморозити токен, зупинити перекази, перемістити чи спалити його з будь-якого гаманця.",
          "Можлива повна втрата, а ціна може стояти далеко від оцінки.",
          "«Автоінвест» для цих токенів теж працює нагадуванням; кожна купівля — твій підпис.",
        ],
      ),
    ]),
  ],
  related: ["invest/what-you-buy", "invest/company-page", "invest/buy"],
};

export const WHAT_YOU_BUY: DocPage = {
  slug: "invest/what-you-buy",
  group: "invest",
  destination: "markets",
  title: { en: "What you actually buy", uk: "Що ти насправді купуєш" },
  seoTitle: { en: "Tokenized stocks: what you actually buy — Ryntra Docs", uk: "Токенізовані акції: що ти насправді купуєш — Ryntra" },
  summary: {
    en: "xStocks and Backpack tokens track a share price; PreStocks tokens give economic exposure to a private company. The rights, the fees and who may hold each.",
    uk: "Токени xStocks і Backpack відстежують ціну акції; токени PreStocks дають економічну експозицію на приватну компанію. Права, комісії й хто може їх тримати.",
  },
  sections: [
    section("token", "A token, not a share", "Токен, а не акція", [
      p(
        "A tokenized stock is a Solana token issued by a third party. It tracks a share's price — NVDAx for NVIDIA, AAPLx for Apple — under the issuer's terms; it is not the share itself. Ryntra says «a token that tracks the price of NVIDIA», never «a NVIDIA share», and every company's page names the issuer and the kind before you buy.",
        "Токенізована акція — це токен Solana, який випускає третя сторона. Він відстежує ціну акції — NVDAx для NVIDIA, AAPLx для Apple — на умовах емітента; це не сама акція. Ryntra каже «токен, що відстежує ціну NVIDIA», а не «акція NVIDIA», і сторінка кожної компанії називає емітента й вид ще до купівлі.",
      ),
    ]),
    section("issuers", "The issuers and their labels", "Емітенти та їхні мітки", [
      table(
        { en: ["Issuer", "Label", "What it means"], uk: ["Емітент", "Мітка", "Що це означає"] },
        {
          en: [
            ["xStocks", label("truthXStocks", "en").title, label("truthXStocks", "en").short],
            ["Backpack", label("truthBackpack", "en").title, label("truthBackpack", "en").short],
            ["Ondo", label("truthOndo", "en").title, label("truthOndo", "en").short],
            ["PreStocks", label("truthPreStocks", "en").title, label("truthPreStocks", "en").short],
          ],
          uk: [
            ["xStocks", label("truthXStocks", "uk").title, label("truthXStocks", "uk").short],
            ["Backpack", label("truthBackpack", "uk").title, label("truthBackpack", "uk").short],
            ["Ondo", label("truthOndo", "uk").title, label("truthOndo", "uk").short],
            ["PreStocks", label("truthPreStocks", "uk").title, label("truthPreStocks", "uk").short],
          ],
        },
      ),
      p(
        "Who may hold each is the issuer's decision: by their own documents xStocks, Ondo and PreStocks are not for the US, and Backpack is not for the US, the UK, the UAE or Japan. Ryntra never works around an issuer's restrictions.",
        "Хто може тримати кожен із них, вирішує емітент: за своїми документами xStocks, Ondo й PreStocks — не для США, а Backpack — не для США, Великої Британії, ОАЕ та Японії. Ryntra не обходить обмежень емітента.",
      ),
    ]),
    section("units", "Dividends and units", "Дивіденди й одиниці", [
      p(
        "Where the issuer's document describes it, dividends are reinvested into the token: your amount grows by the issuer's multiplier instead of a payout to your wallet, and the company's page says «Dividends already in your amount». The multiplier is read from the chain and applied once.",
        "Де це описує документ емітента, дивіденди реінвестуються в токен: твоя кількість зростає на множник емітента замість виплати на гаманець, і сторінка компанії каже «Дивіденди вже в твоїй кількості». Множник прочитано з ланцюга, і його застосовано один раз.",
      ),
    ]),
    section("check", "What to check before you buy", "Що перевірити перед купівлею", [
      list(
        [
          "Hours: the token trades on Solana around the clock, including when the exchange is closed; then it moves on its own supply and demand and can stand above or below the last exchange price.",
          "Liquidity and volume: a token with thin liquidity moves further from its reference, and a large order moves it more.",
          "The issuer's terms and who may hold the token — on the company's page.",
          "The one-time reserve: the first purchase of a token opens its account in your wallet, and the Review shows the exact figure.",
        ],
        [
          "Години: токен торгується на Solana цілодобово, зокрема коли біржа зачинена; тоді він рухається за власним попитом і пропозицією й може стояти вище чи нижче останньої біржової ціни.",
          "Ліквідність і обсяг: токен із тонкою ліквідністю відходить від орієнтира далі, а велика купівля рухає його сильніше.",
          "Умови емітента й хто може тримати токен — на сторінці компанії.",
          "Разовий резерв: перша купівля токена відкриває його рахунок у твоєму гаманці, а «Перевірка» показує точну цифру.",
        ],
      ),
      note(
        "A tokenized stock is not a brokerage account, carries no shareholder rights unless the issuer grants them, and is not available to everyone. Nothing here is investment advice.",
        "Токенізована акція — не брокерський рахунок, не дає прав акціонера, якщо їх не надає емітент, і доступна не всім. Ніщо тут не є інвестиційною порадою.",
        "caution",
      ),
    ]),
  ],
  related: ["invest/private-companies", "invest/buy", "reference/fees"],
};

export const INVEST_PAGES: readonly DocPage[] = [BUY, AUTOINVEST_PAGE, COMPANY_PAGE, PRIVATE_COMPANIES, WHAT_YOU_BUY];
