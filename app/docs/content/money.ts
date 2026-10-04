import { FEES, FEES_UK, POINTS, REWARDS, TOP_UP, levelRows, pointsTierRows } from "./facts.ts";
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";
import { BRIDGE } from "./trade.ts";

/**
 * Money and Rewards — as the menu draws them: Top up, Send, Receive and
 * Bridge under Money; Rewards, Referrals and Points under Rewards, keeping the
 * `money/*` addresses they have always answered at. Every rate on these pages
 * is read from the ledger's own policy (`./facts`), so the number a reader
 * sees is the number the ledger applies.
 */

export const TOP_UP_PAGE: DocPage = {
  slug: "money/top-up",
  group: "money",
  destination: "top-up",
  title: { en: "Top up", uk: "Поповнити" },
  seoTitle: { en: "Top up: USDC and a little SOL — Ryntra Docs", uk: "Поповнити: USDC і трохи SOL — Документація Ryntra" },
  summary: {
    en: "What your wallet needs to buy: USDC for the purchase and a little SOL for the network — and three ways to bring them.",
    uk: "Що потрібно гаманцю для купівлі: USDC на покупку і трохи SOL на мережу — і три способи їх додати.",
  },
  sections: [
    section("need", "What a purchase needs", "Що потрібно для купівлі", [
      p(
        `A piece of a company is paid for in USDC, from ${TOP_UP.minimum}, and every transaction pays the network a small fee in SOL. Top up shows how much of each your wallet holds and three ways to bring them; Ryntra never takes a payment itself.`,
        `Частинка компанії оплачується в USDC, від ${TOP_UP.minimum}, а кожна транзакція платить мережі невелику плату в SOL. «Поповнити» показує, скільки того й іншого у твоєму гаманці, і три способи їх додати; сама Ryntra платежів не приймає.`,
      ),
      facts(
        [
          ["USDC", "The dollars a purchase spends"],
          ["SOL", `The network's fee; about ${TOP_UP.sol.en} SOL is enough for several purchases`],
          ["Where they stay", "In your wallet, until you sign a purchase"],
        ],
        [
          ["USDC", "Долари, які витрачає купівля"],
          ["SOL", `Плата мережі; близько ${TOP_UP.sol.uk} SOL вистачає на кілька купівель`],
          ["Де вони лежать", "У твоєму гаманці, доки ти не підпишеш купівлю"],
        ],
      ),
    ]),
    section("ways", "Three ways to bring them", "Три способи їх додати", [
      steps(
        [
          "Receive USDC — another wallet sends to your address: the page shows its QR code, the address and the network, Solana.",
          "Buy with a card in your wallet — in Phantom, pay with a card, Apple Pay or Google Pay and buy USDC and a little SOL; Phantom's partner takes the payment, and the methods and fees depend on your country. On a phone, «Open in Phantom» opens Ryntra inside Phantom first.",
          "Transfer from an exchange — withdraw USDC on the Solana network to your address, and a little SOL with it for the network fee.",
        ],
        [
          "Отримати USDC — інший гаманець надсилає на твою адресу: сторінка показує її QR-код, адресу й мережу — Solana.",
          "Купити карткою у своєму гаманці — у Phantom оплати карткою, Apple Pay чи Google Pay й купи USDC та трохи SOL; оплату приймає партнер Phantom, а способи й комісії залежать від країни. На телефоні «Відкрити в Phantom» спершу відкриває Ryntra всередині Phantom.",
          "Переказати з біржі — виведи USDC у мережі Solana на свою адресу, а з ними трохи SOL на плату мережі.",
        ],
      ),
      note(
        "The first purchase of each company also opens its token account in your wallet, and the Review shows that one-time reserve. While something is missing, the page reads your wallet again every fifteen seconds, so money you send appears without a reload.",
        "Перша купівля кожної компанії ще відкриває її рахунок токена у твоєму гаманці, і «Перевірка» показує цей разовий резерв. Поки чогось бракує, сторінка перечитує гаманець кожні п'ятнадцять секунд, тож надіслані гроші з'являються без перезавантаження.",
      ),
    ]),
  ],
  related: ["invest/buy", "money/receive", "start/wallet"],
};

export const SEND: DocPage = {
  slug: "money/send",
  group: "money",
  pageId: "send",
  title: { en: "Send", uk: "Надіслати" },
  summary: {
    en: "A controlled transfer of one asset to one address on Solana: the recipient, the amount, the Review, your signature, a record in History.",
    uk: "Контрольований переказ одного активу на одну адресу в Solana: отримувач, сума, «Перевірка», твій підпис, запис в Історії.",
  },
  sections: [
    section("how", "How to send", "Як надіслати", [
      steps(
        [
          "Choose the asset from what your wallet holds. Search by name, ticker or mint address.",
          "Paste the recipient's Solana address and enter the amount. If the recipient needs a memo, the page asks for it.",
          "Press Review. Ryntra shows the amount, the network fee and, when the recipient has no account for this token yet, the cost of creating one — and warns you about the token itself when there is something to know.",
          "Confirm in your wallet. The transfer appears in History as Sent, then Arrived, with a receipt.",
        ],
        [
          "Обери актив із того, що є у твоєму гаманці. Шукай за назвою, тікером або адресою mint.",
          "Встав Solana-адресу отримувача й введи суму. Якщо отримувачу потрібен memo, сторінка про це попросить.",
          "Натисни «Перевірити». Ryntra покаже суму, плату мережі і — якщо в отримувача ще немає рахунку для цього токена — вартість його створення, а також попередить про сам токен, коли є про що знати.",
          "Підтверди в гаманці. Переказ з'явиться в Історії як «Надіслано», потім «Прибуло», з квитанцією.",
        ],
      ),
    ]),
    section("warnings", "What Ryntra warns you about", "Про що Ryntra попереджає", [
      p(
        "Some tokens carry powers their issuer keeps. Before you sign, Ryntra reads the token's own rules and tells you when they matter for a transfer:",
        "Деякі токени несуть повноваження, які лишає за собою емітент. Перед підписом Ryntra читає правила самого токена й каже, коли вони важать для переказу:",
      ),
      list(
        [
          "The issuer can freeze this token in any account, including the recipient's.",
          "The issuer can move this token out of any account, including the recipient's.",
          "The issuer has paused transfers of this token.",
          "New accounts for this token start frozen, so the recipient may not be able to spend it.",
          "A transfer that is still confirming is not repeated: if an earlier transfer is pending, the page says so instead of sending it again.",
        ],
        [
          "Емітент може заморозити цей токен на будь-якому рахунку, зокрема на рахунку отримувача.",
          "Емітент може забрати цей токен з будь-якого рахунку, зокрема з рахунку отримувача.",
          "Емітент призупинив перекази цього токена.",
          "Нові рахунки цього токена починають замороженими, тож отримувач може не змогти його витратити.",
          "Переказ, що ще підтверджується, не повторюється: якщо попередній переказ очікує, сторінка скаже про це замість надіслати знову.",
        ],
      ),
      note(
        "A Solana transfer is final. Check the address before you sign; Ryntra cannot recall a transfer any more than the network can.",
        "Переказ у Solana остаточний. Перевір адресу до підпису; Ryntra не може відкликати переказ так само, як не може мережа.",
        "caution",
      ),
    ]),
  ],
  related: ["money/receive", "manage/activity", "reference/review"],
};

export const RECEIVE: DocPage = {
  slug: "money/receive",
  group: "money",
  pageId: "receive",
  title: { en: "Receive", uk: "Отримати" },
  summary: {
    en: "Your address, a QR code any Solana wallet can scan, and payment links for an exact amount or an open one.",
    uk: "Твоя адреса, QR-код, який зчитає будь-який гаманець Solana, і платіжні посилання на точну чи відкриту суму.",
  },
  sections: [
    section("address", "Your address", "Твоя адреса", [
      p(
        "Receive shows the connected wallet's Solana address and its QR code. Anything sent to this address on Solana arrives in your wallet; scanning works in any Solana wallet. Make sure the sender uses Solana for the asset — an asset sent on another network does not arrive here.",
        "«Отримати» показує Solana-адресу під'єднаного гаманця та її QR-код. Усе, надіслане на цю адресу в Solana, приходить у твій гаманець; сканування працює в будь-якому гаманці Solana. Переконайся, що відправник використовує Solana для цього активу, — актив, надісланий в іншій мережі, сюди не прийде.",
      ),
    ]),
    section("links", "Payment links", "Платіжні посилання", [
      steps(
        [
          "Sign in with your wallet — a payment link is tied to the account, not only to the browser.",
          "Choose the asset and, if you want, an exact amount. Leave the amount open and the payer chooses it.",
          "Create the link. Send it to the person who should pay: it opens in any browser, no app needed, and its QR opens the same link.",
          "The payment arrives straight in your wallet; Portfolio shows the new balance.",
        ],
        [
          "Увійди гаманцем — платіжне посилання прив'язане до акаунта, а не лише до браузера.",
          "Обери актив і, за бажанням, точну суму. Лиши суму відкритою — і її обере платник.",
          "Створи посилання. Надішли його тому, хто має заплатити: воно відкривається в будь-якому браузері без застосунку, а його QR відкриває те саме посилання.",
          "Платіж приходить просто у твій гаманець; Портфель показує новий баланс.",
        ],
      ),
    ]),
  ],
  related: ["money/send", "money/top-up", "start/wallet"],
};

export const REWARDS_PAGE: DocPage = {
  slug: "money/rewards",
  group: "rewards",
  pageId: "rewards",
  title: { en: "Rewards", uk: "Винагороди" },
  summary: {
    en: "Cashback from the service fee Ryntra actually collects on your purchases and trades, paid in USDC on Solana, plus the referral share from people you invited.",
    uk: "Кешбек із комісії, яку Ryntra справді збирає з твоїх купівель і угод, у USDC на Solana, плюс реферальна частка від запрошених тобою.",
  },
  sections: [
    section("how", "How Rewards work", "Як працюють Винагороди", [
      p(
        "When Ryntra collects its service fee on your purchase, swap, Spot trade or bridge, a share of that fee comes back to you and to the people who invited you. Only a fee actually collected counts: a route that carries no Ryntra fee earns nothing, and a quoted fee that was not collected earns nothing.",
        "Коли Ryntra збирає свою комісію з твоєї купівлі, обміну, угоди на Споті чи мосту, частка цієї комісії повертається тобі й тим, хто тебе запросив. Рахується лише справді зібрана комісія: маршрут без комісії Ryntra не дає нічого, і показана, але не зібрана комісія не дає нічого.",
      ),
      table(
        { en: ["Share of the collected fee", "Goes to"], uk: ["Частка зібраної комісії", "Кому"] },
        {
          en: [
            [`${REWARDS.cashbackPercent}%`, "You — cashback on your own purchase or trade"],
            [`${REWARDS.referralL1Percent}%`, "The person who invited you"],
            [`${REWARDS.referralL2Percent}%`, "The person who invited them"],
            ["The rest", "Ryntra. A missing inviter's share stays with Ryntra; it is never given to someone else"],
          ],
          uk: [
            [`${REWARDS.cashbackPercent}%`, "Тобі — кешбек із твоєї купівлі чи угоди"],
            [`${REWARDS.referralL1Percent}%`, "Тому, хто тебе запросив"],
            [`${REWARDS.referralL2Percent}%`, "Тому, хто запросив його"],
            ["Решта", "Ryntra. Частка відсутнього запрошувача лишається в Ryntra; її ніколи не віддають комусь іншому"],
          ],
        },
      ),
      facts(
        [
          ["Eligible operations", `Purchases (${FEES.company} fee), Swap and Spot (${FEES.swap} fee), Bridge (${FEES.bridge} fee)`],
          ["Paid in", "USDC on Solana, to the wallet you are signed in with"],
          ["Claim from", `$${REWARDS.claimFloorUsd.toFixed(2)} USDC`],
          ["Timing", "A reward reads Pending until the operation has settled and its fee is confirmed, then Available"],
        ],
        [
          ["Що зараховується", `Купівлі (комісія ${FEES_UK.company}), Обмін і Спот (комісія ${FEES_UK.swap}), Міст (комісія ${FEES_UK.bridge})`],
          ["Виплата", "USDC на Solana — на гаманець, яким виконано вхід"],
          ["Виплата від", `$${REWARDS.claimFloorUsd.toFixed(2).replace(".", ",")} USDC`],
          ["Час", "Винагорода читається як «Очікує», поки операція не завершена й комісія не підтверджена, потім — «Доступно»"],
        ],
      ),
    ]),
    section("claim", "How to claim", "Як отримати виплату", [
      steps(
        [
          "Open Rewards and confirm the wallet with a message signature, if the page asks — rewards are read for the signed-in wallet.",
          "Available to claim shows what can be paid now. Press Claim to wallet.",
          "The USDC arrives in your wallet on Solana, and the claim reads Claimed on the Rewards page.",
        ],
        [
          "Відкрий Винагороди й, якщо сторінка попросить, підтверди гаманець підписом повідомлення — винагороди читаються для гаманця, яким виконано вхід.",
          "«Доступно до виплати» показує, що можна виплатити зараз. Натисни «Виплатити на гаманець».",
          "USDC приходять у твій гаманець на Solana, а виплата читається як «Виплачено» на сторінці Винагород.",
        ],
      ),
      note(
        "Rewards are not a token, not an airdrop and not a promise of either. They are a share of a fee you already paid, returned in USDC.",
        "Винагороди — не токен, не airdrop і не обіцянка ані того, ані іншого. Це частка вже сплаченої тобою комісії, повернута в USDC.",
      ),
    ]),
  ],
  related: ["money/referrals", "money/points", "reference/fees"],
};

export const REFERRALS: DocPage = {
  slug: "money/referrals",
  group: "rewards",
  pageId: "rewards",
  title: { en: "Referrals", uk: "Реферали" },
  summary: {
    en: "Your referral link, the two levels it pays, how an inviter is set, and why it cannot be changed afterwards.",
    uk: "Твоє реферальне посилання, два рівні, які воно оплачує, як призначається запрошувач і чому його не можна змінити потім.",
  },
  sections: [
    section("how", "How referrals work", "Як працюють реферали", [
      p(
        `Every signed-in wallet has a referral link. When someone opens Ryntra through it and confirms you as their inviter, you receive ${REWARDS.referralL1Percent}% of the Ryntra service fee collected on their purchases and trades, and ${REWARDS.referralL2Percent}% on those of the people they invite in turn. The shares come out of Ryntra's fee, never out of anyone's amount.`,
        `Кожен гаманець після входу має реферальне посилання. Коли хтось відкриває Ryntra за ним і підтверджує тебе як запрошувача, ти отримуєш ${REWARDS.referralL1Percent}% комісії Ryntra, зібраної з його купівель і угод, і ${REWARDS.referralL2Percent}% — з тих, кого запросить він. Частки йдуть із комісії Ryntra, а не із суми людини.`,
      ),
      steps(
        [
          "Open Rewards and copy your referral link or code.",
          "The invited person opens Ryntra, connects and confirms their wallet, and confirms the inviter. Nothing is set until they confirm.",
          "From that moment their eligible operations accrue your share; the Rewards page shows your direct and second-level invitees and what each has earned you.",
        ],
        [
          "Відкрий Винагороди й скопіюй своє реферальне посилання чи код.",
          "Запрошена людина відкриває Ryntra, під'єднує й підтверджує гаманець і підтверджує запрошувача. Нічого не призначено, поки вона не підтвердить.",
          "Від цієї миті її операції, що зараховуються, накопичують твою частку; сторінка Винагород показує твоїх прямих запрошених і другий рівень, і скільки кожен тобі приніс.",
        ],
      ),
      list(
        [
          "An inviter, once confirmed, cannot be changed. Choose before you confirm.",
          "A wallet cannot invite itself, and a loop of invitations is refused.",
          "A qualified referral — an invited wallet's first active day — also earns you points.",
        ],
        [
          "Підтвердженого запрошувача змінити не можна. Обирай до підтвердження.",
          "Гаманець не може запросити сам себе, а коло запрошень відхиляється.",
          "Кваліфікований реферал — перший активний день запрошеного гаманця — також дає тобі бали.",
        ],
      ),
    ]),
  ],
  related: ["money/rewards", "money/points"],
};

export const POINTS_PAGE: DocPage = {
  slug: "money/points",
  group: "rewards",
  pageId: "rewards",
  title: { en: "Points and levels", uk: "Бали й рівні" },
  summary: {
    en: "Points reflect your genuine activity on Ryntra. How they are earned, the daily cap, the levels, and what they are not.",
    uk: "Бали відображають твою справжню активність у Ryntra. Як вони нараховуються, денна межа, рівні і чим вони не є.",
  },
  sections: [
    section("what", "What points are", "Що таке бали", [
      p(
        "Points are separate from Rewards. They have no cash value, cannot be transferred, and carry no promise of a token, an airdrop or a conversion. They record genuine activity — volume, active days, qualified referrals. Nothing about leverage, profit or loss changes them.",
        "Бали — окремо від Винагород. Вони не мають грошової вартості, не передаються й не несуть обіцянки токена, airdrop чи конвертації. Вони фіксують справжню активність — обсяг, активні дні, кваліфіковані реферали. Плече, прибуток чи збиток на них не впливають.",
      ),
    ]),
    section("earning", `How points are earned (policy ${POINTS.version})`, `Як нараховуються бали (політика ${POINTS.version})`, [
      p(
        "Volume points count eligible volume per wallet per UTC day, in marginal tiers:",
        "Бали за обсяг рахують обсяг, що зараховується, на гаманець за добу UTC, за граничними рівнями:",
      ),
      table(
        { en: ["Daily volume", "Rate"], uk: ["Денний обсяг", "Ставка"] },
        { en: pointsTierRows("en"), uk: pointsTierRows("uk") },
      ),
      facts(
        [
          ["Daily cap", `${POINTS.dailyCap.toLocaleString("en-US")} volume points per day`],
          ["Active day", `+${POINTS.activeDayPoints} points once a day reaches $${POINTS.activeDayMinimumUsd} of eligible volume`],
          ["Qualified referral", `+${POINTS.qualifiedReferralPoints} points when a wallet you invited has its first active day`],
          ["Strategy completed", `${POINTS.strategyCompletedPoints} points in this policy version`],
        ],
        [
          ["Денна межа", `${POINTS.dailyCap.toLocaleString("uk-UA")} балів за обсяг на день`],
          ["Активний день", `+${POINTS.activeDayPoints} балів, щойно день досягає $${POINTS.activeDayMinimumUsd} обсягу, що зараховується`],
          ["Кваліфікований реферал", `+${POINTS.qualifiedReferralPoints} балів, коли запрошений тобою гаманець має перший активний день`],
          ["Завершена стратегія", `${POINTS.strategyCompletedPoints} балів у цій версії політики`],
        ],
      ),
    ]),
    section("levels", "Levels and rank", "Рівні й ранг", [
      table(
        { en: ["Level", "Lifetime points"], uk: ["Рівень", "Бали за весь час"] },
        { en: levelRows("en"), uk: levelRows("uk") },
      ),
      p(
        "Rewards shows your points, level, rank, lifetime volume, trades and active days. There is no public leaderboard; rank is your own position.",
        "Винагороди показують твої бали, рівень, ранг, обсяг за весь час, кількість угод і активних днів. Публічної таблиці лідерів немає; ранг — твоя власна позиція.",
      ),
    ]),
  ],
  related: ["money/rewards", "money/referrals"],
};

export const MONEY_PAGES: readonly DocPage[] = [TOP_UP_PAGE, SEND, RECEIVE, BRIDGE];
export const REWARDS_PAGES: readonly DocPage[] = [REWARDS_PAGE, REFERRALS, POINTS_PAGE];
