import { CLAIM_FLOOR, FEES, REFERRAL_BIND_WINDOW_DAYS, FEES_UK, REWARD_EXTRAS, REWARDS, TOP_UP, rankRows } from "./facts.ts";
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
  destination: "deposit",
  title: { en: "Add funds", uk: "Поповнити" },
  seoTitle: { en: "Add funds: USDC and a little SOL — Ryntra Docs", uk: "Поповнити: USDC і трохи SOL — Документація Ryntra" },
  summary: {
    en: "What your wallet needs to trade — USDC to spend, a little SOL for the network — and four ways to bring them: card, exchange, another network, another wallet.",
    uk: "Що потрібно гаманцю для угод: USDC, щоб витрачати, і трохи SOL на мережу — і чотири способи їх додати: картка, біржа, інша мережа, інший гаманець.",
  },
  sections: [
    section("need", "What a purchase needs", "Що потрібно для купівлі", [
      p(
        `A purchase is paid for in USDC or SOL, from ${TOP_UP.minimum}, and every transaction pays the network a small fee in SOL. Money → Add funds shows how much of each your wallet holds and four ways to bring them; Ryntra never takes a payment itself.`,
        `Купівля оплачується в USDC чи SOL, від ${TOP_UP.minimum}, а кожна транзакція платить мережі невелику плату в SOL. Гроші → Поповнити показує, скільки того й іншого у твоєму гаманці, і чотири способи їх додати; сама Ryntra платежів не приймає.`,
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
    section("ways", "Four ways to bring them", "Чотири способи їх додати", [
      steps(
        [
          "Buy with a card in your wallet — in Phantom, pay with a card, Apple Pay or Google Pay and buy USDC and a little SOL; Phantom's partner takes the payment, and the methods and fees depend on your country. On a phone, «Open in Phantom» opens Ryntra inside Phantom first.",
          "Transfer from an exchange — withdraw USDC on the Solana network to your address, and a little SOL with it for the network fee.",
          "From another network — the page gives you a deposit address for USDC on Base, Ethereum, Arbitrum, Optimism, Polygon or BNB Chain, from $1; it arrives as USDC on Solana, with no Ryntra fee and the provider's cost shown before you send.",
          "Receive — another wallet sends to your address: the page shows its QR code, the address and the network, Solana.",
        ],
        [
          "Купити карткою у своєму гаманці — у Phantom оплати карткою, Apple Pay чи Google Pay й купи USDC та трохи SOL; оплату приймає партнер Phantom, а способи й комісії залежать від країни. На телефоні «Відкрити в Phantom» спершу відкриває Ryntra всередині Phantom.",
          "Переказати з біржі — виведи USDC у мережі Solana на свою адресу, а з ними трохи SOL на плату мережі.",
          "З іншої мережі — сторінка дає адресу поповнення для USDC на Base, Ethereum, Arbitrum, Optimism, Polygon чи BNB Chain, від $1; вони надходять як USDC на Solana, без комісії Ryntra, а витрату провайдера видно до надсилання.",
          "Отримати — інший гаманець надсилає на твою адресу: сторінка показує її QR-код, адресу й мережу — Solana.",
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
          "Paste the recipient's Solana address or .skr name and enter the amount. Send adds no memo. If the recipient's token account itself requires one on chain, the check fails before your wallet opens and nothing is sent; but an exchange that asks for a memo or tag in its deposit instructions is not detected — use a deposit address that needs none, or another deposit method the exchange offers.",
          "Press Review. Ryntra shows the amount, the network fee and, when the recipient has no account for this token yet, the cost of creating one — and warns you about the token itself when there is something to know.",
          "Confirm in your wallet. The transfer appears in History as On its way, then Arrived, with a receipt.",
        ],
        [
          "Обери актив із того, що є у твоєму гаманці. Шукай за назвою, тікером або адресою mint.",
          "Встав Solana-адресу отримувача чи ім'я .skr і введи суму. «Надіслати» не додає memo. Якщо сам рахунок токена отримувача вимагає його ончейн, перевірка не пройде ще до того, як відкриється гаманець, і нічого не буде надіслано; але вимогу біржі вказати memo чи тег у її інструкціях поповнення Ryntra не розпізнає — бери адресу поповнення без memo або інший спосіб поповнення, який пропонує біржа.",
          "Натисни «Перевірка». Ryntra покаже суму, плату мережі і — якщо в отримувача ще немає рахунку для цього токена — вартість його створення, а також попередить про сам токен, коли є про що знати.",
          "Підтверди в гаманці. Переказ з'явиться в Історії як «У дорозі», потім «Надійшло», з квитанцією.",
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
        "«Отримати» показує Solana-адресу підключеного гаманця та її QR-код. Усе, надіслане на цю адресу в Solana, приходить у твій гаманець; сканування працює в будь-якому гаманці Solana. Переконайся, що відправник використовує Solana для цього активу, — актив, надісланий в іншій мережі, сюди не прийде.",
      ),
    ]),
    section("links", "Request a payment", "Запит на оплату", [
      steps(
        [
          "Sign in with your wallet — a payment link is tied to the account, not only to the browser.",
          "Choose the asset and, if you want, an exact amount, a note and how long the link lives — an hour, a day, a week or a month. Leave the amount open and the payer chooses it.",
          "Press Create payment link. Send it to the person who should pay: it opens in any browser, no app needed, and its QR opens the same link.",
          "The payment arrives straight in your wallet; Portfolio shows the new balance.",
        ],
        [
          "Увійди гаманцем — платіжне посилання прив'язане до акаунта, а не лише до браузера.",
          "Обери актив і, за бажанням, точну суму, нотатку й скільки живе посилання — годину, добу, тиждень чи місяць. Лиши суму відкритою — і її обере платник.",
          "Натисни «Створити посилання на оплату». Надішли його тому, хто має заплатити: воно відкривається в будь-якому браузері без застосунку, а його QR відкриває те саме посилання.",
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
    en: "Cashback from the service fee Ryntra actually receives on your purchases and trades, paid in USDC on Solana, plus the referral share from people you invited.",
    uk: "Кешбек із комісії, яку Ryntra справді отримує з твоїх купівель і угод, у USDC на Solana, плюс реферальна частка від запрошених тобою.",
  },
  sections: [
    section("how", "How Rewards work", "Як працюють Винагороди", [
      p(
        "When Ryntra receives its service fee on your purchase, swap, Spot trade or transfer between networks, a share of what it received comes back to you and to the people who invited you — the fee after any provider's own cut. Only a fee actually received counts: a route that carries no Ryntra fee earns nothing, and a quoted fee that was not collected earns nothing.",
        "Коли Ryntra отримує свою комісію з твоєї купівлі, обміну, угоди на Споті чи мосту, частка отриманої комісії — тобто комісії після власної частки провайдера — повертається тобі й тим, хто тебе запросив. Рахується лише справді отримана комісія: маршрут без комісії Ryntra не дає нічого, і показана, але не зібрана комісія не дає нічого.",
      ),
      table(
        { en: ["Share of the received fee", "Goes to"], uk: ["Частка отриманої комісії", "Кому"] },
        {
          en: [
            [`${REWARDS.cashbackPercent}%`, "You — cashback on your own purchase or trade"],
            [`${REWARDS.referralL1Percent}%`, `The person who invited you — by their rank: ${REWARDS.referralL1Ladder.en}`],
            [`${REWARDS.referralL2Percent}%`, "The person who invited them"],
            ["The rest", "Ryntra. A missing inviter's share stays with Ryntra; it is never given to someone else"],
            ...(REWARD_EXTRAS.inviterWindow ? [[`${REWARD_EXTRAS.inviterWindow.percent}%`, `The inviter, whatever their rank, for each friend's first ${REWARD_EXTRAS.inviterWindow.days} days`]] : []),
          ],
          uk: [
            [`${REWARDS.cashbackPercent}%`, "Тобі — кешбек із твоєї купівлі чи угоди"],
            [`${REWARDS.referralL1Percent}%`, `Тому, хто тебе запросив, — за його рангом: ${REWARDS.referralL1Ladder.uk}`],
            [`${REWARDS.referralL2Percent}%`, "Тому, хто запросив його"],
            ["Решта", "Ryntra. Частка відсутнього запрошувача лишається в Ryntra; її ніколи не віддають комусь іншому"],
            ...(REWARD_EXTRAS.inviterWindow ? [[`${REWARD_EXTRAS.inviterWindow.percent}%`, `Запрошувачу, хоч який його ранг, — перші ${REWARD_EXTRAS.inviterWindow.days} днів кожного друга`]] : []),
          ],
        },
      ),
      facts(
        [
          ["Eligible operations", `Purchases (${FEES.company} fee), Swap and Spot (${FEES.swap} fee), Between networks (${FEES.bridge} fee)`],
          ["Paid in", "USDC on Solana, to the wallet you are signed in with"],
          ["Claim from", `${CLAIM_FLOOR.en.withAccount} USDC when your wallet already has a USDC account, ${CLAIM_FLOOR.en.withoutAccount} when it does not; the claim's network fee is paid for you`],
          ["Timing", "A reward reads Pending until the operation has settled and its fee is confirmed, then Available"],
        ],
        [
          ["Що зараховується", `Купівлі (комісія ${FEES_UK.company}), Обмін і Спот (комісія ${FEES_UK.swap}), Між мережами (комісія ${FEES_UK.bridge})`],
          ["Виплата", "USDC на Solana — на гаманець, яким виконано вхід"],
          ["Виплата від", `${CLAIM_FLOOR.uk.withAccount} USDC, якщо в гаманці вже є рахунок USDC, ${CLAIM_FLOOR.uk.withoutAccount} — якщо немає; плату мережі за виплату сплачено за тебе`],
          ["Час", "Винагорода читається як «Очікує», поки операція не завершена й комісія не підтверджена, потім — «Доступно»"],
        ],
      ),
      ...(REWARD_EXTRAS.firstTen
        ? [
            note(
              `«First ${REWARD_EXTRAS.firstTen.cap} back»: for the first ${REWARD_EXTRAS.firstTen.wallets} new wallets each month, the fee Ryntra receives on your trades comes back in full for up to ${REWARD_EXTRAS.firstTen.days} days, up to ${REWARD_EXTRAS.firstTen.cap} — half at once, the rest after a check. A wallet inside the window sees its progress on the Rewards page.`,
              `«Перші ${REWARD_EXTRAS.firstTen.cap} назад»: для перших ${REWARD_EXTRAS.firstTen.wallets} нових гаманців щомісяця комісія, яку Ryntra отримує з твоїх угод, повертається повністю до ${REWARD_EXTRAS.firstTen.days} днів, до ${REWARD_EXTRAS.firstTen.cap} — половина одразу, решта після перевірки. Гаманець у цьому вікні бачить свій поступ на сторінці Винагород.`,
            ),
          ]
        : []),
    ]),
    section("ranks", "Ranks", "Ранги", [
      p(
        `Your rank is read from your rank points over the last ${REWARDS.rankWindowDays} days: a dollar of fee Ryntra received on your own trades or on trades of friends you invited is a rank point. The rank sets the share that comes to you from a friend's trade; the share is fixed at the moment of that trade. The rank has no cash value.`,
        `Твій ранг рахується з очок за останні ${REWARDS.rankWindowDays} днів: долар комісії, яку Ryntra отримала з твоїх угод або з угод друзів, яких ти запросив, — це очко. Ранг задає частку, яка йде тобі з угоди друга; частка фіксується в момент цієї угоди. Ранг не має грошової вартості.`,
      ),
      table(
        { en: ["Rank", "From rank points", "Your share of a friend's trade"], uk: ["Ранг", "Від очок", "Твоя частка з угоди друга"] },
        { en: rankRows("en"), uk: rankRows("uk") },
      ),
      /* The one sentence the merged «Points and levels» page carried that this
         page did not (UX-751): what points are not. */
      note(
        "Points have no cash value and cannot be transferred or exchanged. They carry no promise of a token, an airdrop or a conversion, and nothing about leverage, profit or loss changes them.",
        "Очки не мають грошової вартості, їх не можна передати чи обміняти. Вони не несуть обіцянки токена, airdrop чи конвертації, а плече, прибуток чи збиток на них не впливають.",
      ),
    ]),
    section("claim", "How to claim", "Як отримати виплату", [
      steps(
        [
          "Open Rewards and confirm the wallet with a message signature, if the page asks — rewards are read for the signed-in wallet.",
          "Ready to claim shows what can be paid now. Press Claim to wallet.",
          "The USDC arrives in your wallet on Solana, and the claim reads Claimed on the Rewards page.",
        ],
        [
          "Відкрий Винагороди й, якщо сторінка попросить, підтверди гаманець підписом повідомлення — винагороди читаються для гаманця, яким виконано вхід.",
          "«Можна забрати» показує, що можна отримати зараз. Натисни «Отримати на гаманець».",
          "USDC приходять у твій гаманець на Solana, а на сторінці Винагород вона читається як «Отримано».",
        ],
      ),
      note(
        "Rewards are not a token, not an airdrop and not a promise of either. They are a share of a fee you already paid, returned in USDC.",
        "Винагороди — не токен, не airdrop і не обіцянка ані того, ані іншого. Це частка вже сплаченої тобою комісії, повернута в USDC.",
      ),
    ]),
  ],
  related: ["money/referrals", "reference/fees"],
};

export const REFERRALS: DocPage = {
  slug: "money/referrals",
  group: "rewards",
  pageId: "rewards",
  title: { en: "Referrals", uk: "Реферали" },
  summary: {
    en: "Your referral link, the two levels it pays, how an inviter is set, and the one change a new wallet may make.",
    uk: "Твоє реферальне посилання, два рівні, які воно оплачує, як призначається запрошувач і єдина зміна, яку може зробити новий гаманець.",
  },
  sections: [
    section("how", "How referrals work", "Як працюють реферали", [
      p(
        `Every signed-in wallet has a referral link. When someone opens Ryntra through it and then confirms a wallet, you become their inviter and receive ${REWARDS.referralL1Percent}% of the Ryntra service fee received on their purchases and trades — the share your rank holds at the moment of their trade — and ${REWARDS.referralL2Percent}% on those of the people they invite in turn. The shares come out of Ryntra's fee, never out of anyone's amount.`,
        `Кожен гаманець після входу має реферальне посилання. Коли хтось відкриває Ryntra за ним і потім підтверджує гаманець, ти стаєш його запрошувачем і отримуєш ${REWARDS.referralL1Percent}% комісії Ryntra, отриманої з його купівель і угод, — частку, яку дає твій ранг у момент його угоди, — і ${REWARDS.referralL2Percent}% — з тих, кого запросить він. Частки йдуть із комісії Ryntra, а не із суми людини.`,
      ),
      steps(
        [
          "Open Rewards and copy your referral link or code.",
          "The invited person opens Ryntra through the link and connects and confirms a wallet: the inviter is set then, with no button to find. Opening the link alone sets nothing.",
          "From that moment their eligible operations accrue your share; the Rewards page shows your direct and second-level invitees and what each has earned you.",
        ],
        [
          "Відкрий Винагороди й скопіюй своє реферальне посилання чи код.",
          "Запрошена людина відкриває Ryntra за посиланням, підключає й підтверджує гаманець — тоді запрошувача й призначено, без жодної кнопки. Саме відкриття посилання нічого не призначає.",
          "Від цієї миті її операції, що зараховуються, накопичують твою частку; сторінка Винагород показує твоїх прямих запрошених і другий рівень, і скільки кожен тобі приніс.",
        ],
      ),
      list(
        [
          `A new wallet may change its inviter once, while it is within ${REFERRAL_BIND_WINDOW_DAYS} days of its first earning; after that the inviter is final, and the earlier inviter keeps what settled before the change.`,
          "A wallet cannot invite itself, and a loop of invitations is refused.",
          "A qualified referral — an invited wallet's first active day — also earns you points.",
        ],
        [
          `Новий гаманець може один раз змінити запрошувача, поки не минуло ${REFERRAL_BIND_WINDOW_DAYS} днів від його першого заробітку; після цього запрошувач остаточний, а попередній лишає собі те, що завершилося до зміни.`,
          "Гаманець не може запросити сам себе, а коло запрошень відхиляється.",
          "Кваліфікований реферал — перший активний день запрошеного гаманця — також дає тобі очки.",
        ],
      ),
    ]),
  ],
  related: ["money/rewards", "reference/fees"],
};

export const MONEY_PAGES: readonly DocPage[] = [TOP_UP_PAGE, SEND, RECEIVE, BRIDGE];
export const REWARDS_PAGES: readonly DocPage[] = [REWARDS_PAGE, REFERRALS];
