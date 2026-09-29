import { list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Portfolio and History under the menu's «Портфель», Settings under Start —
 * what the product knows about your money and your operations, and what it
 * never claims. The pages keep their `manage/*` addresses.
 */

export const PORTFOLIO: DocPage = {
  slug: "manage/portfolio",
  group: "portfolio",
  pageId: "portfolio",
  title: { en: "Portfolio", uk: "Портфель" },
  summary: {
    en: "What you own on Solana and what it is worth, read from the chain for your wallet: positions by company, Autoinvest rules and dollars.",
    uk: "Що ти маєш на Solana і скільки це коштує, прочитане з ланцюга для твого гаманця: позиції за компаніями, правила «Автоінвесту» й долари.",
  },
  sections: [
    section("what", "What Portfolio shows", "Що показує Портфель", [
      p(
        "Portfolio is the state of your money: what the connected wallet holds — each company by its name, with its value — your Autoinvest rules, and your dollars, then every other token. A price is shown where a reliable one exists, and the total says when part of it could not be valued.",
        "Портфель — це стан твоїх грошей: що тримає під'єднаний гаманець — кожна компанія за назвою, з вартістю, — твої правила «Автоінвесту» й долари, а далі кожен інший токен. Ціну показано там, де є надійна, а загальна сума каже, коли частину не вдалося оцінити.",
      ),
      list(
        [
          "Small and unpriced balances can be hidden with one switch; they are never deleted.",
          "A balance that could not be read is shown as unavailable, never as zero. The page says when the list may be incomplete.",
          "A company opens its page; any other asset opens its market in Spot or in Swap.",
        ],
        [
          "Малі й неоцінені баланси можна сховати одним перемикачем; вони ніколи не видаляються.",
          "Баланс, який не вдалося прочитати, показано як недоступний, а не як нуль. Сторінка каже, коли список може бути неповним.",
          "Компанія відкриває свою сторінку; будь-який інший актив — свій ринок у Споті чи Обмін.",
        ],
      ),
    ]),
    section("risk", "Portfolio risk on Home", "Ризик портфеля на Головній", [
      p(
        "Home says one word for the whole wallet — beside «Allocation» on a wide screen, under the balance on a phone — by Ryntra's published rules, once the wallet is confirmed with a signature. «Normal»: no position has reached its loss limit or target, no asset is above 25% of the wallet, private companies together are at most 10%, and no company goes into the weekend without a loss limit. The 25% cap applies from a wallet of $500, the 10% at any size; dollars (USDC, USDT, PYUSD, USDS) count in the total and have no cap.",
        "Головна каже одне слово про весь гаманець — поруч із «Розподілом» на широкому екрані, під балансом на телефоні — за опублікованими правилами Ryntra, щойно гаманець підтверджено підписом. «Нормальний»: жодна позиція не дійшла до межі збитку чи цілі, жоден актив не більший за 25% гаманця, приватні компанії разом — не більше 10%, і жодна компанія не йде на вихідні без межі збитку. Межа 25% діє з гаманця від $500, межа 10% — за будь-якої суми; долари (USDC, USDT, PYUSD, USDS) входять у суму, але межі не мають.",
      ),
      list(
        [
          "«Attention» names the reason and one action — open the sale, set a limit, take a look; more reasons open under it.",
          "«Could not check» says what could not be read — a price, part of the wallet, a position's limit — and is never shown as «Normal». A token Ryntra cannot vouch for — unverified, or with no market — is left out of the risk's count.",
          "It is a hint, not advice: Ryntra buys and sells nothing for you.",
        ],
        [
          "«Увага» називає причину й одну дію — відкрити продаж, поставити межу, подивитись; інші причини відкриваються під нею.",
          "«Не вдалося перевірити» каже, чого не вдалося прочитати — ціни, частини гаманця, межі позиції, — і ніколи не показується як «Нормальний». Токен, за який Ryntra не може поручитися, — неперевірений чи без ринку, — лишається поза розрахунком ризику.",
          "Це підказка, не порада: Ryntra нічого не купує й не продає за тебе.",
        ],
      ),
    ]),
  ],
  related: ["manage/activity", "invest/autoinvest", "start/wallet"],
};

export const ACTIVITY: DocPage = {
  slug: "manage/activity",
  group: "portfolio",
  pageId: "activity",
  title: { en: "History and receipts", uk: "Історія та квитанції" },
  summary: {
    en: "Everything you did through Ryntra in one history — purchases, swaps, sends, claims — with a receipt that keeps the reviewed and the settled figures.",
    uk: "Усі твої дії через Ryntra — в одній історії: купівлі, обміни, перекази, виплати — з квитанцією, що тримає перевірені й фактичні цифри.",
  },
  sections: [
    section("what", "What History is", "Що таке Історія", [
      p(
        "History is the single record of your financial actions in Ryntra. Purchases, Autoinvest, Swap, Spot, Bridge, Send and Rewards do not keep separate histories; everything lands here, newest first, with a filter by kind. Each entry shows the action, the amounts, the network, the transaction, its status and — once it has settled — its receipt.",
        "Історія — єдиний запис твоїх фінансових дій у Ryntra. Купівлі, «Автоінвест», Обмін, Спот, Міст, Надіслати й Винагороди не ведуть окремих історій; усе потрапляє сюди, найновіше зверху, з фільтром за видом. Кожен запис показує дію, суми, мережу, транзакцію, її статус і — після завершення — квитанцію.",
      ),
      table(
        { en: ["Status", "Meaning"], uk: ["Статус", "Значення"] },
        {
          en: [
            ["Pending", "Signed and submitted; the network has not confirmed the final result yet."],
            ["Sent", "Left your wallet. For a bridge, the destination side is still on its way."],
            ["Arrived", "Landed where it was going, in the amount the receipt records."],
            ["Failed", "Did not go through. The reason is shown when the network or the provider gave one; a failure never becomes a zero balance or a missing entry."],
          ],
          uk: [
            ["Очікує", "Підписано й надіслано; мережа ще не підтвердила остаточного результату."],
            ["Надіслано", "Пішло з твого гаманця. Для мосту сторона призначення ще в дорозі."],
            ["Прибуло", "Дійшло, куди йшло, у сумі, яку записує квитанція."],
            ["Помилка", "Не пройшло. Причину показано, коли її дали мережа чи провайдер; помилка ніколи не стає нульовим балансом чи зниклим записом."],
          ],
        },
      ),
    ]),
    section("receipts", "Receipts", "Квитанції", [
      p(
        "A receipt is the detail of an operation, not a separate app. It records what you reviewed — the amounts, the minimum, the fees, the network costs — and what the network then did: the actual amount, the transaction signature, the time. When less arrived than the reviewed minimum, the receipt keeps both figures side by side so the difference is visible, not averaged away.",
        "Квитанція — це деталь операції, а не окремий застосунок. Вона записує перевірене — суми, мінімум, комісії, плату мережі — і те, що потім зробила мережа: фактичну суму, підпис транзакції, час. Коли надійшло менше за перевірений мінімум, квитанція тримає обидві цифри поруч, щоб різницю було видно, а не усереднено.",
      ),
      list(
        [
          "Every receipt links to the transaction on a public Solana explorer.",
          "A purchase by an Autoinvest rule is marked Autoinvest, and its receipt names the rule.",
          "A receipt is Ryntra's record of what it saw. The wallet and the network remain the record of what happened.",
          "History, receipts and portfolio follow the signed-in wallet, so they are the same on every device.",
        ],
        [
          "Кожна квитанція веде на транзакцію в публічному оглядачі Solana.",
          "Купівлю за правилом позначено «Автоінвест», а її квитанція називає правило.",
          "Квитанція — запис Ryntra про те, що вона бачила. Записом того, що сталося, лишаються гаманець і мережа.",
          "Історія, квитанції й портфель ідуть за гаманцем після входу, тож вони однакові на кожному пристрої.",
        ],
      ),
    ]),
  ],
  related: ["manage/portfolio", "reference/review", "reference/troubleshooting"],
};

export const SETTINGS: DocPage = {
  slug: "manage/settings",
  group: "start",
  title: { en: "Settings and notifications", uk: "Налаштування та сповіщення" },
  summary: {
    en: "Your wallet and account, the Telegram notification channel, language and theme, and what clearing site data removes.",
    uk: "Твій гаманець і акаунт, канал сповіщень у Telegram, мова й тема і що прибирає очищення даних сайту.",
  },
  sections: [
    section("account", "Wallet and account", "Гаманець і акаунт", [
      list(
        [
          "The connected wallet, the account signed in with it, and Sign out and Sign out everywhere.",
          "What connecting a wallet allows — balances, prices, mints and your own operations — and why a signature sits beside every figure Ryntra prepares.",
          "Why there is no network switch: the app works on Solana Mainnet only.",
        ],
        [
          "Під'єднаний гаманець, акаунт, у який ним увійдено, і «Вийти» та «Вийти всюди».",
          "Що дозволяє під'єднання гаманця — баланси, ціни, mint-адреси й твої власні операції — і чому підпис стоїть біля кожної цифри, яку готує Ryntra.",
          "Чому немає перемикача мереж: застосунок працює лише на Solana Mainnet.",
        ],
      ),
    ]),
    section("telegram", "Telegram as a notification channel", "Telegram як канал сповіщень", [
      steps(
        [
          "Sign in with your wallet, then open Settings and choose Connect Telegram.",
          "Ryntra shows a one-time link to its bot. Open it in Telegram and press Start; the code in the link binds the chat to your account.",
          "Autoinvest reminders and notes about your operations arrive in that chat. Disconnect from the same place at any time — it removes only the channel, never the account.",
        ],
        [
          "Увійди гаманцем, потім відкрий Налаштування й обери «Під'єднати Telegram».",
          "Ryntra покаже одноразове посилання на свого бота. Відкрий його в Telegram і натисни Start; код у посиланні прив'язує чат до твого акаунта.",
          "Нагадування «Автоінвесту» й нотатки про твої операції приходять у цей чат. Від'єднати можна там само будь-коли — це прибирає лише канал, ніколи не акаунт.",
        ],
      ),
      note(
        "Telegram is a channel, not a sign-in. Ryntra's bot never asks for a wallet, a seed phrase or a payment; a message that does is not from Ryntra.",
        "Telegram — канал, а не спосіб входу. Бот Ryntra ніколи не просить гаманця, сід-фрази чи платежу; повідомлення, яке просить, — не від Ryntra.",
        "caution",
      ),
    ]),
    section("preferences", "Preferences", "Уподобання", [
      table(
        { en: ["Setting", "Where it lives"], uk: ["Налаштування", "Де зберігається"] },
        {
          en: [
            ["Language — English or Ukrainian", "On this device"],
            ["Theme — dark or light", "On this device"],
            ["Watchlist", "On this device at once, and on the account once the wallet is signed in — so it follows the wallet"],
          ],
          uk: [
            ["Мова — англійська чи українська", "На цьому пристрої"],
            ["Тема — темна чи світла", "На цьому пристрої"],
            ["Обране", "Одразу на цьому пристрої, а після входу гаманцем — в акаунті, тож іде за гаманцем"],
          ],
        },
      ),
      p(
        "Clearing site data from Settings removes what this browser keeps — the theme, cached reads and the current session. It does not remove your account, your history or your rewards: those belong to the wallet and come back when you sign in again.",
        "Очищення даних сайту в Налаштуваннях прибирає те, що зберігає цей браузер, — тему, кешовані читання й поточну сесію. Воно не видаляє твого акаунта, історії чи винагород: вони належать гаманцю й повертаються, щойно ти знову ввійдеш.",
      ),
    ]),
  ],
  related: ["start/wallet", "money/rewards"],
};

export const MANAGE_PAGES: readonly DocPage[] = [PORTFOLIO, ACTIVITY];
