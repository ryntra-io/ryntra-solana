import { FEES, FEES_UK, REWARDS } from "./facts.ts";
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
        "Before Ryntra asks your wallet for anything, it shows you the whole action in one place. A purchase of a company is four lines — You pay, You get at least, All costs, What it is — and a sale from your position the same four, You sell first; a swap, a transfer or a bridge shows what it needs:",
        "Перш ніж щось попросити в гаманця, Ryntra показує всю дію в одному місці. Купівля компанії — це чотири рядки: Спишеться, Отримаєш щонайменше, Усі витрати, Що це, — і продаж із позиції ті самі чотири; обмін, переказ чи міст показують те, що потрібно їм:",
      ),
      list(
        [
          "What leaves your wallet and what arrives — the expected amount and the minimum you accept.",
          "Ryntra's service fee, stated as its own line, and the provider's, the issuer's and the network's costs, stated as theirs.",
          "Slippage and price impact where a market is involved.",
          "Any reserve a new token account keeps, as the exact figure the network requires — yours, not a fee.",
          "For a bridge: the source, the destination, the address the money lands on and the estimated time.",
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
          "You confirm in your wallet. The wallet shows the same transaction; the bytes you sign are the bytes you reviewed.",
          "If the market moved past the reviewed figures before you signed, Ryntra stops and asks you to review again rather than submitting stale terms.",
          "If your wallet returns a different transaction from the one prepared, nothing is sent.",
        ],
        [
          "Ryntra симулює точну транзакцію в живій мережі й показує результат цієї симуляції — не котирування.",
          "Ти підтверджуєш у гаманці. Гаманець показує ту саму транзакцію; байти, які ти підписуєш, — це байти, які були в «Перевірці».",
          "Якщо ринок вийшов за перевірені цифри ще до підпису, Ryntra зупиняється й просить перевірити знову, а не надсилати застарілі умови.",
          "Якщо гаманець поверне іншу транзакцію, ніж підготовлена, нічого не надсилається.",
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

export const FEES_PAGE: DocPage = {
  slug: "reference/fees",
  group: "reference",
  title: { en: "Fees", uk: "Комісії" },
  summary: {
    en: "Every fee on Ryntra, who receives it and where you see it before you sign. There are no others.",
    uk: "Кожна комісія в Ryntra, хто її отримує і де ти бачиш її до підпису. Інших немає.",
  },
  sections: [
    section("service", "Ryntra's service fee", "Комісія Ryntra", [
      table(
        { en: ["Operation", "Service fee", "Notes"], uk: ["Операція", "Комісія", "Примітки"] },
        {
          en: [
            ["New and meme tokens", FEES.flow("MEME"), `Younger than seven days, or not verified by Jupiter; ${REWARDS.cashbackPercent}% of what Ryntra receives returns to you as cashback`],
            ["Verified tokens", FEES.flow("TRENDING"), `Verified by Jupiter and at least a week old; ${REWARDS.cashbackPercent}% of what Ryntra receives returns as cashback`],
            ["Major coins — SOL, BTC, ETH, JUP, staked SOL", FEES.flow("MAJOR"), `${REWARDS.cashbackPercent}% of what Ryntra receives returns as cashback`],
            ["Dollar to dollar — USDC, USDT and other dollars", "None", "No Ryntra fee between two dollars"],
            ["A company — xStocks", FEES.flow("XSTOCK"), "A line of All costs in the Review, with its amount"],
            ["A company — Ondo", FEES.flow("ONDO"), "The same line; Ondo trades on Jupiter through market makers"],
            ["Pre-IPO — PreStocks", FEES.flow("PRESTOCK"), "The same line, beside the issuer's own fee"],
            ["Bridge", FEES.bridge, "Stated apart from the provider's and the networks' costs; cashback applies when the fee is collected"],
            ["Send, Receive, Rewards claims", "None", "Only the network's own fee"],
          ],
          uk: [
            ["Нові й мем-токени", FEES_UK.flow("MEME"), `Молодші за сім днів або без верифікації Jupiter; ${REWARDS.cashbackPercent}% того, що отримує Ryntra, повертається тобі кешбеком`],
            ["Верифіковані токени", FEES_UK.flow("TRENDING"), `Верифіковані Jupiter і старші за тиждень; ${REWARDS.cashbackPercent}% того, що отримує Ryntra, повертається кешбеком`],
            ["Великі монети — SOL, BTC, ETH, JUP, стейкінговий SOL", FEES_UK.flow("MAJOR"), `${REWARDS.cashbackPercent}% того, що отримує Ryntra, повертається кешбеком`],
            ["Долар на долар — USDC, USDT та інші долари", "Немає", "Між двома доларами комісії Ryntra немає"],
            ["Компанія — xStocks", FEES_UK.flow("XSTOCK"), "Рядок «Усі витрати» в «Перевірці», із сумою"],
            ["Компанія — Ondo", FEES_UK.flow("ONDO"), "Той самий рядок; Ondo торгується на Jupiter через маркет-мейкерів"],
            ["Pre-IPO — PreStocks", FEES_UK.flow("PRESTOCK"), "Той самий рядок, поруч із власною комісією емітента"],
            ["Міст", FEES_UK.bridge, "Окремо від витрат провайдера й мереж; кешбек діє, коли комісію зібрано"],
            ["Надіслати, Отримати, виплати Винагород", "Немає", "Лише власна плата мережі"],
          ],
        },
      ),
      p(
        `In the Android app every swap still carries a ${FEES.flow("AS_NOW")} fee until its next update reads these rates.`,
        `У застосунку для Android кожен обмін ще має комісію ${FEES_UK.flow("AS_NOW")}, доки наступне оновлення не прочитає ці ставки.`,
      ),
      p(
        "Ryntra earns when you actually use the product — there is no subscription and no charge for looking, and nothing for the checks that protect you. A route that carries no Ryntra fee says so on its receipt.",
        "Ryntra заробляє, коли ти справді користуєшся продуктом: підписки немає, за перегляд плати немає, і нічого — за перевірки, що тебе захищають. Маршрут без комісії Ryntra каже про це у квитанції.",
      ),
    ]),
    section("other", "Costs that are not Ryntra's", "Витрати, що не належать Ryntra", [
      table(
        { en: ["Cost", "Who receives it", "When"], uk: ["Витрата", "Хто отримує", "Коли"] },
        {
          en: [
            ["Network fee", "The Solana network (or the source network of a bridge)", "Every transaction, in the network's own coin"],
            ["Token account reserve", "Your own new token account; refunded when you close it", "The first time you receive a token you never held"],
            ["The issuer's fee", "The issuer of a PreStocks token; its rate is read from the chain", "Every transfer of that token, a purchase included"],
            ["Provider costs", "The routing or bridging provider", "Bridges; shown as their own line"],
            ["Price impact and slippage", "The market", "Any trade; bounded by the minimum you accept"],
          ],
          uk: [
            ["Плата мережі", "Мережа Solana (або вихідна мережа мосту)", "Кожна транзакція, у власній монеті мережі"],
            ["Резерв рахунку токена", "Твій власний новий рахунок токена; повертається, коли ти його закриваєш", "Перше отримання токена, якого в тебе ще не було"],
            ["Комісія емітента", "Емітент токена PreStocks; її ставку прочитано з ланцюга", "Кожен переказ цього токена, зокрема купівля"],
            ["Витрати провайдера", "Провайдер маршруту чи мосту", "Мости; окремим рядком"],
            ["Вплив на ціну й прослизання", "Ринок", "Будь-яка угода; обмежені мінімумом, який ти приймаєш"],
          ],
        },
      ),
      note(
        "Ryntra never shows a fee as income before it is collected, and never adds a cost it did not show in the Review.",
        "Ryntra ніколи не показує комісію як дохід, доки її не зібрано, і ніколи не додає витрати, якої не показала в «Перевірці».",
      ),
    ]),
  ],
  related: ["money/rewards", "reference/review", "invest/buy"],
};

export const STATUSES: DocPage = {
  slug: "reference/statuses",
  group: "reference",
  title: { en: "Statuses", uk: "Статуси" },
  summary: {
    en: "The four words the app uses for an operation — and what each one commits to.",
    uk: "Чотири слова, якими застосунок описує операцію, — і що кожне з них означає.",
  },
  sections: [
    section("operations", "Operation statuses", "Статуси операцій", [
      list(
        [
          "Pending — signed and submitted; the final network result is not known yet. Do not submit again.",
          "Sent — left your wallet; a bridge's destination side is still on its way.",
          "Arrived — landed where it was going, in the amount the receipt records.",
          "Failed — did not go through; the reason is shown when one was given. Money that never left is still in your wallet.",
        ],
        [
          "Очікує — підписано й надіслано; остаточний результат мережі ще невідомий. Не надсилай знову.",
          "Надіслано — пішло з твого гаманця; сторона призначення мосту ще в дорозі.",
          "Прибуло — дійшло, куди йшло, у сумі, яку записує квитанція.",
          "Помилка — не пройшло; причину показано, коли її дали. Гроші, що не пішли, досі у твоєму гаманці.",
        ],
      ),
    ]),
  ],
  related: ["start/cabinet", "manage/activity"],
};

export const TROUBLESHOOTING: DocPage = {
  slug: "reference/troubleshooting",
  group: "reference",
  title: { en: "Troubleshooting", uk: "Усунення проблем" },
  summary: {
    en: "What to do when a wallet will not connect, a quote expires, a list is empty, a status is unknown or a balance is missing — without repeating an action twice.",
    uk: "Що робити, коли гаманець не під'єднується, котирування застаріло, список порожній, статус невідомий чи баланс не читається, — не повторюючи дію двічі.",
  },
  sections: [
    section("rule", "The one rule", "Одне правило", [
      note(
        "Stop and check the state before repeating an action. A transfer that is Pending is not lost; a second signature is a second transfer.",
        "Зупинись і перевір стан, перш ніж повторювати дію. Переказ у стані «Очікує» не втрачено; другий підпис — це другий переказ.",
        "caution",
      ),
    ]),
    section("cases", "Common cases", "Типові випадки", [
      table(
        { en: ["What you see", "What to do"], uk: ["Що ти бачиш", "Що робити"] },
        {
          en: [
            ["No Solana wallet detected", "Install Phantom, Solflare or Backpack, unlock it, and reload. On a phone, open ryntra.io inside the wallet's browser."],
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
            ["Гаманець не під'єднується", "Розблокуй розширення, підтвердь дозвіл сайту в гаманці й під'єднайся знову з верхньої панелі."],
            ["Котирування застаріло або цифри змінилися", "Онови ціну й прочитай новий мінімум. Ryntra не підписуватиме застарілих умов."],
            ["Порожній список на вході", "Зачекай мить — список запитує знову сам. Якщо не вдається, натисни «Спробувати ще раз»."],
            ["«Не вдалося чисто симулювати»", "Мережа відмовила точній транзакції. Прочитай причину в «Перевірці»; зазвичай це баланс, резерв чи правило токена. Нічого не надіслано."],
            ["Статус невідомий", "Відкрий Історію й посилання на оглядач. Не надсилай знову, поки результат невизначений."],
            ["Баланс недоступний", "Повтори читання. Ryntra відрізняє недоступний результат від справжнього нуля."],
            ["Винагороди чи бали недоступні", "Підтвердь гаманець підписом повідомлення; якщо сторінка все одно не читає, спробуй пізніше — нічого не втрачено."],
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
    en: "What you buy, from how much, where your money is, what it costs, and who may buy — the questions people ask first, answered plainly.",
    uk: "Що купуєш, від якої суми, де твої гроші, скільки це коштує і кому можна купувати — запитання, які ставлять першими, з прямими відповідями.",
  },
  sections: [
    section("faq", "Asked first", "Питають першим", [
      table(
        { en: ["Question", "Answer"], uk: ["Запитання", "Відповідь"] },
        {
          en: [
            ["What do I buy?", "A token that tracks a share price (xStocks, Backpack), or a PreStocks token of economic exposure to a private company — not a share. The company's page says which, under What you buy."],
            ["From how much?", "From $1. Where $1 has no route, Ryntra tells you that company's minimum. A first purchase of a token leaves a one-time account reserve in your wallet — its own line in the Review."],
            ["Where is my money?", "In your own wallet. Ryntra never holds your money or keys and never signs for you."],
            ["How much does it cost?", `Ryntra's fee is ${FEES.swap} of the sum, shown in the Review before you sign, and ${REWARDS.cashbackPercent}% of what Ryntra receives comes back as cashback; the Solana network fee is separate; PreStocks tokens carry the issuer's fee, read from the chain.`],
            ["Does Autoinvest buy on its own?", "No. Ryntra reminds you by your rule — you sign every purchase, and the money stays in your wallet until you do."],
            ["Who can buy?", "The issuer decides. By their own documents xStocks, Backpack and PreStocks are not for the US, and Backpack is not for the UK, the UAE or Japan either; a private company's page carries «Who may hold it». Ryntra never works around an issuer's restrictions."],
            ["Can I sell?", "Yes — from your position, on the company's page or in Portfolio: a sum in dollars or a share of what you hold, the same Review and your signature. A PreStocks token may not sell: the issuer promises no liquidity."],
            ["What is Ryntra, the AI assistant?", "An assistant that explains companies, prices and your portfolio and prepares drafts. Only you buy, sell and sign."],
            ["Do I need an account?", "Your wallet is the account. Signing in is a message your wallet signs, with no email or password."],
            ["Is Ryntra audited?", "No. Ryntra has not completed an independent security audit, and its Security page says so."],
            ["What are points worth?", "Nothing in money. They record genuine activity and cannot be transferred; there is no token and no airdrop promise."],
          ],
          uk: [
            ["Що я купую?", "Токен, що відстежує ціну акції (xStocks, Backpack), або токен PreStocks з економічною експозицією на приватну компанію — не акцію. Що саме — у «Що ти купуєш» на сторінці компанії."],
            ["Від якої суми?", "Від $1. Якщо на $1 маршруту немає, Ryntra скаже мінімум цієї компанії. Перша купівля токена лишає в гаманці разовий резерв рахунку — окремим рядком «Перевірки»."],
            ["Де мої гроші?", "У твоєму гаманці. Ryntra не тримає коштів і ключів і не підписує за тебе."],
            ["Скільки це коштує?", `Комісія Ryntra — ${FEES_UK.swap} суми, її видно в «Перевірці» до підпису, і ${REWARDS.cashbackPercent}% того, що отримує Ryntra, повертається кешбеком; плата мережі Solana — окремо; у токенів PreStocks — комісія емітента з ланцюга.`],
            ["«Автоінвест» купує сам?", "Ні. Ryntra нагадує за твоїм правилом — кожну купівлю підписуєш ти, а гроші лежать у гаманці, доки ти не підпишеш."],
            ["Хто може купувати?", "Це вирішує емітент. За своїми документами xStocks, Backpack і PreStocks — не для США, Backpack — ще й не для Великої Британії, ОАЕ та Японії; у приватних компаній рядок «Хто може тримати» — на сторінці компанії. Ryntra не обходить обмежень емітента."],
            ["Чи можна продати?", "Так — з позиції, на сторінці компанії чи в Портфелі: сума в доларах або частка того, що маєш, та сама «Перевірка» й твій підпис. Токен PreStocks продати може не вийти: емітент ліквідності не обіцяє."],
            ["Що таке Ryntra — ШІ-помічник?", "Помічник, що пояснює компанії, ціни й твій портфель і готує чернетки. Купуєш, продаєш і підписуєш лише ти."],
            ["Чи потрібен акаунт?", "Твій гаманець і є акаунтом. Вхід — повідомлення, яке підписує гаманець, без пошти й пароля."],
            ["Чи є в Ryntra аудит?", "Ні. Ryntra не проходила незалежного аудиту безпеки, і її сторінка «Безпека» про це каже."],
            ["Скільки коштують бали?", "У грошах — нічого. Вони фіксують справжню активність і не передаються; токена й обіцянки airdrop немає."],
          ],
        },
      ),
    ]),
  ],
  related: ["invest/what-you-buy", "reference/fees", "start/getting-started"],
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
            ["The app", "The product at ryntra.io/app: the eight sections of the menu and the twelve pages in them, one menu for everyone."],
            ["Review", "The screen before any financial action that shows exactly what will happen; nothing is signed without it. A purchase shows four lines."],
            ["Receipt", "Ryntra's record of one operation: what was reviewed and what the network did."],
            ["Autoinvest", "Your rule for buying a company — regularly, if it falls, or from every payment. Ryntra reminds you; you sign each purchase."],
            ["Reference", "What a price is set against: the issuer's price per share for a listed company, PreStocks' valuation for a private one."],
            ["Service fee", "Ryntra's own fee on a purchase, a swap, a trade or a bridge, stated as its own line."],
            ["Cashback", "The share of the service fee Ryntra received, returned to you through Rewards."],
            ["Points", "A record of genuine activity with no cash value."],
            ["Tokenized stock", "A Solana token issued by a third party that tracks a listed share's price."],
            ["PreStocks token", "A token of economic exposure to a private company — not a share, with the issuer's fee on every transfer."],
            ["Token account", "The account a Solana wallet keeps for each token it holds; a new one keeps a small refundable reserve."],
            ["Slippage", "The difference between the expected price and the executed one; bounded by the minimum you accept."],
            ["Price impact", "How much your own order moves the market's price."],
            ["Liquidity", "How much can be traded in a market without moving its price far."],
            ["Wallet Standard", "The Solana convention that lets any compatible wallet connect to any app."],
            ["For experienced investors", "What a trader reaches for: Spot, the stock screener and Trends under Trade in the menu and on top of Markets; the full plans, Results and History under Portfolio. The same checks before every signature."],
          ],
          uk: [
            ["Застосунок", "Продукт на ryntra.io/app: вісім розділів меню і дванадцять сторінок у них, одне меню для всіх."],
            ["«Перевірка»", "Екран перед будь-якою фінансовою дією, що показує, що саме станеться; без нього нічого не підписується. Купівля — це чотири рядки."],
            ["Квитанція", "Запис Ryntra про одну операцію: що перевірено і що зробила мережа."],
            ["«Автоінвест»", "Твоє правило купівлі компанії — регулярно, якщо впаде, чи з кожної оплати. Ryntra нагадує; кожну купівлю підписуєш ти."],
            ["Орієнтир", "З чим порівнюють ціну: ціна емітента за акцію для публічної компанії, оцінка PreStocks — для приватної."],
            ["Комісія Ryntra", "Власна комісія Ryntra на купівлю, обмін, угоду чи міст, окремим рядком."],
            ["Кешбек", "Частка комісії, яку отримала Ryntra, повернута тобі через Винагороди."],
            ["Бали", "Запис справжньої активності без грошової вартості."],
            ["Токенізована акція", "Токен Solana від третьої сторони, що відстежує ціну біржової акції."],
            ["Токен PreStocks", "Токен економічної експозиції на приватну компанію — не акція, з комісією емітента на кожен переказ."],
            ["Рахунок токена", "Рахунок, який гаманець Solana тримає для кожного свого токена; новий лишає невеликий поворотний резерв."],
            ["Прослизання", "Різниця між очікуваною ціною й виконаною; обмежена мінімумом, який ти приймаєш."],
            ["Вплив на ціну", "Наскільки твоя власна угода зсуває ціну ринку."],
            ["Ліквідність", "Скільки можна проторгувати на ринку, не зсунувши ціну далеко."],
            ["Wallet Standard", "Домовленість Solana, що дає будь-якому сумісному гаманцю під'єднуватися до будь-якого застосунку."],
            ["Для досвідчених", "Те, чим користується трейдер: Спот, скринер акцій і Тренди — у розділі «Торгувати» меню й угорі Ринків; повні плани, Результати й Історія — у Портфелі. Ті самі перевірки перед кожним підписом."],
          ],
        },
      ),
    ]),
  ],
  related: ["reference/faq"],
};

export const REFERENCE_PAGES: readonly DocPage[] = [REVIEW, FEES_PAGE, STATUSES, TROUBLESHOOTING, FAQ, GLOSSARY];
