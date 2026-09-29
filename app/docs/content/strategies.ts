import { list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Strategies — My strategies, Results and the cycle behind them, under the
 * menu's «Портфель» (canon v5.4 В30), keeping their `strategies/*` addresses.
 * Documented as what is built: a page or a strategy type that is not built
 * has no documentation (canon v5.0 §0.0 rule 10) — Ideas is registered and
 * drawn nowhere, and its old address leads to the overview. The overview's
 * status table is held to the route registry by `app/docs/docs.test.mjs`.
 */

export const STRATEGIES_OVERVIEW: DocPage = {
  slug: "strategies/overview",
  group: "portfolio",
  title: { en: "The strategy cycle", uk: "Цикл стратегії" },
  summary: {
    en: "Idea → research → critic → risk → plan → your decision → Review → execution → monitoring → result: what each step is for.",
    uk: "Ідея → дослідження → критика → ризик → план → твоє рішення → «Перевірка» → виконання → нагляд → результат: для чого кожен крок.",
  },
  sections: [
    section("why", "Why a plan", "Навіщо план", [
      p(
        "A trade is one part of a decision. Most tools keep the trade and lose the rest: why you entered, what risk you accepted, what you planned to do if it went wrong, what actually happened. A plan keeps the context before, checks the execution during, and shows the actual result after — and every idea may end in Wait, Watch or Reject, not only in a trade.",
        "Угода — лише частина рішення. Більшість інструментів зберігають угоду й гублять решту: причину входу, прийнятий ризик, план на випадок, якщо піде не так, і те, що сталося насправді. План зберігає контекст до, перевіряє виконання під час і показує фактичний результат після — і кожна ідея може закінчитися «Чекати», «Стежити» чи «Відхилити», а не лише угодою.",
      ),
    ]),
    section("cycle", "The cycle, step by step", "Цикл, крок за кроком", [
      steps(
        [
          "Idea — a note, a link, a piece of news or an asset from Spot or Trends: the thing that made you look.",
          "Research — what is known about the asset, the market and the moment, structured rather than guessed.",
          "Critic — the case against: what does not hold, what is unknown, why the thesis could be wrong.",
          "Risk — the thesis turned into limits: budget, maximum loss, entry, invalidation, position size, liquidity and price impact. Where a figure can be computed exactly, it is computed, not estimated.",
          "Plan — a Trading Plan with those limits, saved with its version.",
          "Your decision — Trade, Wait, Watch or Reject. Ryntra proposes; it never decides.",
          "Review and execution — the same Review and the same wallet signature as every purchase.",
          "Monitoring — the plan's conditions are watched; when something meaningful changes you get Review required, never a silently rewritten rule.",
          "Result — plan against actual, costs kept apart, no-trade outcomes recorded, and the history of your own decisions kept for the next one.",
        ],
        [
          "Ідея — нотатка, посилання, новина чи актив зі Споту або Трендів: те, що змусило подивитися.",
          "Дослідження — що відомо про актив, ринок і момент, структуровано, а не навмання.",
          "Критика — аргументи проти: що не тримається, що невідомо, чому теза може бути хибною.",
          "Ризик — теза, перетворена на межі: бюджет, найбільша втрата, вхід, інвалідація, розмір позиції, ліквідність і вплив на ціну. Де цифру можна порахувати точно, її рахують, а не оцінюють.",
          "План — торговий план із цими межами, збережений зі своєю версією.",
          "Твоє рішення — торгувати, чекати, стежити чи відхилити. Ryntra пропонує; вирішує вона ніколи.",
          "«Перевірка» й виконання — та сама «Перевірка» й той самий підпис гаманця, що й у кожній купівлі.",
          "Нагляд — умови плану відстежуються; коли щось суттєво змінюється, ти отримуєш «Потрібна перевірка», а не тихо переписане правило.",
          "Результат — план проти факту, витрати окремо, результати без угоди записано, а історія твоїх власних рішень збережена для наступного.",
        ],
      ),
    ]),
    section("status", "Where each part stands", "Де стоїть кожна частина", [
      table(
        { en: ["Page", "Status", "What exists today"], uk: ["Сторінка", "Статус", "Що є сьогодні"] },
        {
          en: [
            ["My strategies", "Live", "The Trading Plan: your wallet's plans, each edit a new version, a sized position and a check, a journal of decisions; the Review checks the plan on the exact order and refuses what is outside it."],
            ["Results", "Live", "Every entry and exit made under a plan beside the version it stood on and the Review before the signature; the costs in parts never added together; the plans that made no trade and why; the positions; and a memory of your own decisions that cites its records."],
          ],
          uk: [
            ["Мої стратегії", "Працює", "Торговий план: плани твого гаманця, кожна правка — нова версія, розрахований розмір і перевірка, журнал рішень; «Перевірка» звіряє план на точній угоді й відмовляє в тому, що поза ним."],
            ["Результати", "Працює", "Кожен вхід і вихід за планом поруч із версією, на якій він стояв, і «Перевіркою» перед підписом; витрати частинами, які ніколи не складаються разом; плани, що не дали угоди, і чому; позиції; і пам'ять твоїх власних рішень, що посилається на свої записи."],
          ],
        },
      ),
      note(
        "Ryntra, the AI assistant, helps at Research, Critic and Risk — structuring, explaining, looking for counter-arguments. It does not trade, and the financial action is always your decision, the Review and your signature.",
        "Ryntra — ШІ-помічник — допомагає на дослідженні, критиці й ризику: структурує, пояснює, шукає контраргументи. Він не торгує, а фінансова дія — завжди твоє рішення, «Перевірка» й твій підпис.",
      ),
    ]),
  ],
  related: ["strategies/my-strategies", "strategies/results"],
};

export const MY_STRATEGIES: DocPage = {
  slug: "strategies/my-strategies",
  group: "portfolio",
  pageId: "my-strategies",
  title: { en: "My strategies", uk: "Мої стратегії" },
  summary: {
    en: "The control centre for your rules: your wallet's Trading Plans, each with its versions, a sized position and a check before you sign.",
    uk: "Центр керування твоїми правилами: торгові плани твого гаманця — кожен із версіями, розрахованим розміром і перевіркою перед підписом.",
  },
  sections: [
    section("today", "What a plan holds", "Що тримає план", [
      p(
        "The plans your wallet has written, each on the version it stands on — private to that wallet, read only behind its proof. A plan starts from an asset — a tokenized stock, SOL, or a verified crypto or meme token: the thesis, the planned entry and the price you will not pay more than, the budget and what is kept for costs, the invalidation and the planned risk, the exit, the execution rules. On a token the plan's price is a timestamped market indication, or a figure you enter yourself — context for the plan, never the price you trade at.",
        "Плани, які написав твій гаманець, кожен на версії, на якій стоїть, — приватні для цього гаманця, читаються лише за його доказом. План починається з активу — токенізованої акції, SOL чи перевіреного криптотокена або мем-токена: теза, плановий вхід і ціна, дорожче за яку ти не платиш, бюджет і резерв на витрати, інвалідація й плановий ризик, вихід, правила виконання. На токені ціна плану — позначена часом ринкова індикація або цифра, яку вводиш власноруч, — контекст для плану, ніколи не ціна, за якою ти торгуєш.",
      ),
      p(
        "The size is computed from the rules one way — the loss per unit, a share or a token, to the invalidation; the smaller of the risk-limited and the budget-limited size — with its assumptions beside it: a planning model, never a guaranteed maximum loss, and the invalidation is a rule you act on, not an exit order. Every edit is a new version, and earlier versions stay readable as they stood; the check is deterministic — every contradiction named at once — and is not an opinion on the trade.",
        "Розмір рахується з правил в один спосіб — втрата на одиницю, акцію чи токен, до інвалідації; менший із розмірів за ризиком і за бюджетом — із припущеннями поруч: це модель планування, а не гарантована найбільша втрата, а інвалідація — правило, за яким дієш ти, а не ордер виходу. Кожна правка — нова версія, а попередні лишаються читабельними, як стояли; перевірка детермінована — кожну суперечність названо одразу — і не є думкою про угоду.",
      ),
      p(
        "Trading under a plan opens Spot with the plan and its version named. The Review judges the version on the exact order — the mint, the side, the version, the entry's validity, the budget and what may be spent, the entry bound, the invalidation, the planned risk at this price on the same model, the reference and the deviation bound, the slippage, the quote's age, the liquidity, the units — and an order outside the plan is refused before any transaction exists; a check that cannot be judged is never a pass. A Review made before an edit is not a valid confirmation after it, and after the fill Results puts the plan, the Review and the actual figures side by side.",
        "Торгівля за планом відкриває Спот із названими планом і версією. «Перевірка» судить версію на точній угоді — mint, сторону, версію, чинність входу, бюджет і дозволену суму, межу входу, інвалідацію, плановий ризик за цією ціною за тією самою моделлю, орієнтир і межу відхилення, прослизання, вік котирування, ліквідність, одиниці, — і угоду поза планом відхилено ще до того, як існує транзакція; перевірка, яку неможливо виконати, ніколи не вважається пройденою. «Перевірка» до правки не є чинним підтвердженням після неї, а після виконання Результати кладуть план, «Перевірку» й фактичні цифри поруч.",
      ),
    ]),
    section("evidence", "Conditions on what the market did", "Умови щодо того, що робив ринок", [
      p(
        "A plan can carry rules on the token's onchain activity beside its price and money rules. In Spot and under a company's Details, Analysis reads a few figures from an external onchain source when you ask — the day's or the week's DEX trading volume with its buys and sells, the net movement of the token to or from the addresses the source labels as exchanges or as large holders — each with the time Ryntra asked, how far behind the source may be, and the source named. A movement is not a trade and a label is not a person; a figure the source does not have is a dash, never a zero.",
        "План може нести правила щодо ончейн-активності токена поруч із ціновими й грошовими. У Споті й у «Деталях» компанії «Аналіз» на твій запит читає кілька цифр із зовнішнього ончейн-джерела — обсяг торгів на DEX за день чи тиждень із купівлями й продажами, чистий рух токена до адрес, які джерело позначає як біржі чи великих власників, або з них, — кожну з часом запиту Ryntra, з тим, наскільки джерело може відставати, і з названим джерелом. Переміщення — не угода, мітка — не особа; цифра, якої джерело не має, — риска, ніколи не нуль.",
      ),
      p(
        "Add a condition to the plan turns one figure into a rule: which figure, over which window, at least or at most, a threshold you write, and what happens when the rule is not met — warn you and leave the decision to you, or refuse the order. At the Review the server reads the figure again and judges the rule beside the checks on the money and the deal; a rule that cannot be judged — the source silent, the figure missing, the observation older than its window — is never a pass. Movements of labelled groups can only warn. The Review keeps what it judged, and Results shows it beside the fill.",
        "«Додати умову до плану» перетворює одну цифру на правило: який показник, за яке вікно, не менше чи не більше, поріг, який пишеш ти, і що станеться, коли правило не виконано, — попередити й лишити рішення тобі або відхилити угоду. На «Перевірці» сервер знову читає цифру й судить правило поруч із перевірками грошей і угоди; правило, яке неможливо перевірити, — джерело мовчить, цифри немає, спостереження старше за своє вікно, — ніколи не вважається пройденим. Рухи позначених груп можуть лише попереджати. «Перевірка» зберігає те, що судила, а Результати показують це поруч із виконанням.",
      ),
      note(
        "Onchain figures are shown under the source's terms with its attribution beside them. They are context for your rule, not a price, a quote or advice; a met condition says the rule held at that moment, nothing about whether the trade is good.",
        "Ончейн-цифри показано за умовами джерела з його атрибуцією поруч. Це контекст для твого правила, а не ціна, котирування чи порада; виконана умова означає, що правило трималося тієї миті, і нічого — про те, чи добра угода.",
      ),
    ]),
    section("structure", "Rules on how the token is built", "Правила щодо того, як збудовано токен", [
      p(
        "A second source answers a different question — not what the market did, but how the token itself is built. In Spot and under a company's Details, Risk & due diligence reads it when you ask: how much of the supply the ten largest holders hold together and how many addresses hold the token, whether the mint and the freeze authorities are present or renounced, whether the token takes a tax on every transfer, and — as the source's own labels — what early snipers, bundled buyers and the developer hold now. Each fact says when the source last analysed the token. There is no score and no verdict: the card's head counts facts and never says safe.",
        "Друге джерело відповідає на інше запитання — не що робив ринок, а як збудовано сам токен. У Споті й у «Деталях» компанії «Ризик і перевірка» читає його на твій запит: яку частку пропозиції разом тримають десять найбільших власників і скільки адрес тримають токен, чи є, чи відкинуті право емісії й право заморозки, чи бере токен податок із кожного переказу, і — як власні мітки джерела — що зараз тримають ранні снайпери, пакетні покупці й розробник. Кожен факт каже, коли джерело востаннє аналізувало токен. Тут немає ні оцінки, ні вироку: заголовок картки рахує факти й ніколи не каже «безпечно».",
      ),
      p(
        "Any of these facts can become a rule of the plan the same way — the share held by the top ten at most a bound you write, the holder count at least a figure, the transfer tax at most a per cent, an authority renounced or present. At the Review the server reads the token's structure again; a required rule refuses this version of the plan when the fact is not what you wrote, or when the source did not answer, answered too long ago, or cannot analyse the token. An ordinary purchase, and a plan without such a rule, never wait on this source.",
        "Будь-який із цих фактів може так само стати правилом плану — частка десяти найбільших не більше межі, яку пишеш ти, кількість власників не менше цифри, податок на переказ не більше відсотка, право відкинуто чи є. На «Перевірці» сервер знову читає будову токена; обов'язкове правило відхиляє цю версію плану, коли факт не такий, як у правилі, або коли джерело не відповіло, відповіло надто давно чи не може проаналізувати токен. Звичайна купівля й план без такого правила ніколи не чекають на це джерело.",
      ),
      note(
        "Before you send to an address, Send shows a recipient check from the same source: whether the address is on a sanctions list the source keeps and whether the source found anything about it — never a verdict, never a block.",
        "Перш ніж надіслати на адресу, «Надіслати» показує перевірку отримувача з того самого джерела: чи є адреса в санкційному списку, який веде джерело, і чи знайшло джерело щось про неї — ніколи не вирок і ніколи не блокування.",
      ),
    ]),
  ],
  related: ["strategies/overview", "strategies/results"],
};

export const RESULTS: DocPage = {
  slug: "strategies/results",
  group: "portfolio",
  pageId: "results",
  title: { en: "Results", uk: "Результати" },
  summary: {
    en: "What happened against what you planned: each entry and exit beside its plan version and Review, the costs in parts, and the plans that made no trade.",
    uk: "Що сталося проти плану: кожен вхід і вихід поруч із версією плану й «Перевіркою», витрати частинами і плани, що не дали угоди.",
  },
  sections: [
    section("today", "What the page holds", "Що на сторінці", [
      p(
        "Plan · Before signing · Actual for every execution your wallet made under a Trading Plan, newest first: the entry per share or per token, the spend, the units bought and the modelled loss to the invalidation — as the version planned them, as the Review saw them on the quote before you signed, and as the chain settled them. Every figure is in the units of its own moment, and the fee the row recorded stands beside the figures, never inside them.",
        "План · Перед підписом · Фактично для кожного виконання, яке твій гаманець зробив за торговим планом, найновіші згори: вхід за акцію чи за токен, сума, куплені одиниці й змодельована втрата до інвалідації — як планувала версія, як бачила «Перевірка» на котируванні перед підписом і як підтвердив ланцюг. Кожна цифра — в одиницях свого моменту, а комісія, записана в рядку, стоїть поруч із цифрами, ніколи всередині них.",
      ),
      p(
        "An exit is judged against the version that was in force at the exit's own settled time, and a rule written later is never applied backwards. A settled sale of the plan's exact token by the same wallet, after the plan's entry, is matched to the plan by its asset, and the page says it was matched rather than declared; two plans on one token match no sale.",
        "Вихід судиться за версією, чинною на момент його власного підтвердження, і правило, написане пізніше, ніколи не застосовується заднім числом. Підтверджений продаж саме того токена плану тим самим гаманцем після входу за планом зіставляється з планом за активом, і сторінка каже, що його зіставлено, а не оголошено; два плани на одному токені не зіставляють жодного продажу.",
      ),
      p(
        "The costs stay in three parts that are never added into one number: the market's move between your plan's entry and the Review's price, execution between that price and the fill, and the fee the settled row recorded. A plan that made no trade is a result too: the page says why — the price was never met, the plan expired, it was cancelled — with the rule and what was found. A position adds up the plan's own executions; a realised figure appears only when the position is closed and every leg is valued.",
        "Витрати лишаються трьома частинами, які ніколи не складаються в одну цифру: рух ринку між входом твого плану й ціною «Перевірки», виконання між цією ціною й фактичним виконанням і комісія, записана підтвердженим рядком. План, що не дав угоди, — теж результат: сторінка каже чому — ціна так і не настала, строк плану минув, його скасовано, — з правилом і тим, що знайдено. Позиція складає власні виконання плану; реалізована цифра з'являється лише тоді, коли позицію закрито й кожну частину оцінено.",
      ),
      p(
        "Strategy memory is facts derived from your own records at the moment you read them — each citing the plan, the version, the Review, the signature or the note it stands on. Nothing lives apart from the records, so memory cannot drift from them. Ryntra, the AI assistant, reads the same memory and cites it the same way.",
        "Пам'ять стратегії — це факти, виведені з твоїх власних записів у мить читання, — кожен посилається на план, версію, «Перевірку», підпис чи нотатку, на яких стоїть. Нічого не живе окремо від записів, тож пам'ять не може з ними розійтися. Ryntra — ШІ-помічник — читає ту саму пам'ять і посилається на неї так само.",
      ),
    ]),
    section("limits", "What it cannot establish", "Чого вона не встановлює", [
      list(
        [
          "The market's own move after the fill: no reference is read at settlement, so the parts stop at what was observed.",
          "A stock exit matched by its asset carries no multiplier, so its shares are not counted and its adherence reads unknown rather than being judged in the wrong unit.",
          "Price impact and spread after the fill: on the records that exist they cannot be told apart.",
          "A figure nothing established is a dash, never a zero.",
        ],
        [
          "Власний рух ринку після виконання: під час підтвердження орієнтир не читається, тож частини зупиняються на тому, що спостерігали.",
          "Вихід з акції, зіставлений за активом, не має множника, тож його акції не рахуються, а дотримання читається як невідоме, а не судиться в чужих одиницях.",
          "Вплив на ціну й спред після виконання: на наявних записах їх не розрізнити.",
          "Цифра, яку ніщо не встановило, — риска, ніколи не нуль.",
        ],
      ),
    ]),
  ],
  related: ["strategies/overview", "strategies/my-strategies", "manage/activity"],
};

export const STRATEGY_PAGES: readonly DocPage[] = [MY_STRATEGIES, RESULTS, STRATEGIES_OVERVIEW];
