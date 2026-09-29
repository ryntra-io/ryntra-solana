import type { Prose } from "../site/info/prose.ts";

/**
 * «Безпека» — the words of `/security`, English and Ukrainian together (the
 * new site of canon v5.5, `RYN-SITE-V5-001` subtask 3; the plan's §3 for the
 * title and the description).
 *
 * The twelve sections keep their ids, their numbers and their order from the
 * founder's specification, so nothing that was ever linked stops resolving;
 * what each one says is the product of v5.5 — a purchase from $1 through the
 * Review and the person's signature, «Автоінвест» rules that only remind, the
 * wallet's own payments read and never moved, Ryntra the AI assistant with no
 * tool that buys or signs — checked against the code on `SECURITY_AS_OF`
 * (`lib/site/security.ts`, which also holds the boundary lines and the audit
 * sentence a copy edit cannot soften). No section says what is planned: the
 * page describes what exists (canon §0.0 rule 10).
 */

export type SecurityLocale = "en" | "uk";

export type SecuritySection = Readonly<{
  id: string;
  title: string;
  hint: string;
  body: readonly Prose[];
}>;

export type SecurityCopy = Readonly<{
  meta: Readonly<{ title: string; description: string }>;
  hero: Readonly<{ eyebrow: string; title: string; lead: string; chips: readonly string[] }>;
  boundary: Readonly<{ eyebrow: string; title: string; checked: string; cannot: string; can: string }>;
  known: Readonly<{ eyebrow: string; title: string; facts: readonly string[]; report: string; noCommitment: string }>;
  sections: Readonly<{ eyebrow: string; title: string; lead: string; items: readonly SecuritySection[] }>;
}>;

export const SECURITY_SECTION_IDS = [
  "model",
  "custody",
  "authorization",
  "credentials",
  "agents",
  "ai",
  "providers",
  "replay",
  "receipts",
  "data",
  "assurance",
  "report",
] as const;

export const SECURITY_COPY: Readonly<Record<SecurityLocale, SecurityCopy>> = {
  en: {
    meta: {
      title: "Security — what Ryntra can and cannot touch",
      description: "What Ryntra can access, what it structurally cannot, how signing works, where third-party risk begins, what has not been audited, and how to report an issue.",
    },
    hero: {
      eyebrow: "Security",
      title: "What Ryntra can touch — and what it cannot.",
      lead: "Your money stays in your wallet. Ryntra prepares a purchase, shows it in the Review, and your wallet signs it. What Ryntra has not seen, it does not claim.",
      chips: ["Non-custodial", "No seed phrase", "Your signature on every purchase", "Solana Mainnet"],
    },
    boundary: {
      eyebrow: "The boundary",
      title: "What Ryntra cannot do, before what it can.",
      checked: "Checked against the code on",
      cannot: "Ryntra cannot",
      can: "Ryntra can",
    },
    known: {
      eyebrow: "What is known",
      title: "What has not been reviewed, said plainly.",
      facts: [
        "Nothing on this site should be read as an audited or certified system.",
        "There is no bug bounty, no third-party penetration test and no dedicated security inbox.",
        "Ryntra is a beta on Solana Mainnet: it moves real money.",
      ],
      report: "Report a security issue",
      noCommitment: "There is no dedicated security address and no response-time commitment, because neither is staffed. Reports go to the same inbox as everything else and are read by the people who build the product.",
    },
    sections: {
      eyebrow: "Section by section",
      title: "The detail",
      lead: "Twelve sections, each one tap deeper.",
      items: [
        {
          id: "model",
          title: "Security model",
          hint: "Ryntra sits beside your wallet, never in front of it.",
          body: [
            "Ryntra reads what the chain and your wallet show, prepares an exact transaction, simulates it against the live network, shows you the result in the Review, and asks your wallet — not itself — to sign.",
            "A compromise of Ryntra cannot move your money, because no path exists through which it could. It could mislead — which is why every figure in the Review carries its source, a quote is never shown as a result, and an unknown stays visibly unknown.",
          ],
        },
        {
          id: "custody",
          title: "Custody and keys",
          hint: "No deposits, no keys, no signing for you.",
          body: [{
            list: [
              "Ryntra never accepts deposits and holds no money: there is no deposit address, no pooled balance and no withdrawal path.",
              "What you buy stays in your own wallet through every purchase, swap, bridge and claim.",
              "Ryntra never requests or receives a seed phrase, a private key or a wallet password — no screen asks for one, and no support conversation ever will.",
              "Ryntra never signs and never sends a transaction for you. There is no path that runs on its own.",
            ],
          }],
        },
        {
          id: "authorization",
          title: "Wallet and account",
          hint: "Connecting shares an address; signing in costs nothing and moves nothing.",
          body: [
            "Connecting a wallet shares its public address and nothing else. Signing in is a message your wallet signs — no transaction, no fee — that links your history, receipts, rules and rewards to that wallet. Signing in lasts up to a day on a device, and you can end it on one device or on all of them.",
            "A purchase is authorized once, by your wallet, for the exact transaction you reviewed. Ryntra keeps no standing permission of any kind — no token approval, no delegate, no session key. The next purchase needs the next signature.",
          ],
        },
        {
          id: "credentials",
          title: "Keys to other services",
          hint: "Ryntra holds no key that can move your money.",
          body: [{
            list: [
              "No exchange API key, no trading key, no delegate on any token account.",
              "The services a purchase goes through — Jupiter for the route, a provider for a bridge — receive the transaction your wallet will sign and your public address, never a key.",
              "Server keys exist only for Ryntra's own infrastructure — the database, the Solana RPC, the notification bot, the AI model — and none of them can sign for a wallet.",
            ],
          }],
        },
        {
          id: "agents",
          title: "Autoinvest and reminders",
          hint: "A rule reminds you; only your signature buys.",
          body: [
            "Nothing in Ryntra acts on your behalf. An Autoinvest rule — regularly, if it falls, or from every payment — only plans reminders. It is not a permission to spend, and the monthly budget caps the reminders; it grants nothing either.",
            "When a rule falls due, a reminder comes — in Ryntra, and in Telegram once it is connected. One tap opens a fresh Review for the rule's sum, and nothing is bought until you sign. A reminder you do not sign is marked Missed and is never bought later.",
            "«From every payment» reads your wallet's own USDC payments on Solana — public on the chain — to count what the rule sets aside, and never moves them. Monitoring writes a note when something your rule or plan watches changes; a note never buys or sells.",
          ],
        },
        {
          id: "ai",
          title: "Ryntra, the AI assistant",
          hint: "It explains and prepares drafts; it cannot buy, sell or sign.",
          body: [
            "The assistant explains and prepares drafts; published rules compute and check; you decide and sign. It has no tool to buy, sell, send or sign, it never supplies a missing fact, and where a figure can be computed it is computed rather than guessed.",
            "Your question and the facts it needs are sent from Ryntra's server to the model's provider to be answered; the model's key stays on the server and never reaches your browser. Never paste a seed phrase or a key into a question.",
            "Every screen where the assistant speaks says it is Ryntra, the AI assistant.",
          ],
        },
        {
          id: "providers",
          title: "The services around a purchase",
          hint: "Every figure names its source; an outage is shown as one.",
          body: [
            "Routes and quotes come from Jupiter; market figures from Jupiter and GeckoTerminal; company facts from SEC filings; a private company's valuation from PreStocks; balances from a Solana RPC provider. Tokenized stocks are issued by third parties — xStocks, Backpack, Ondo and PreStocks.",
            {
              list: [
                "A provider's outage is shown as one: the page says what could not be read and what still works.",
                "A token's own rules are read before you buy or send it — an issuer that can freeze, move or burn the token, paused transfers, the issuer's fee on every transfer — and shown in the Review.",
                "A tokenized stock is its issuer's token under that issuer's terms. Ryntra shows the issuer; it does not stand behind the issuer.",
              ],
            },
            { href: "/methodology", label: "Where every figure comes from" },
          ],
        },
        {
          id: "replay",
          title: "Before and after you sign",
          hint: "The bytes you sign are the bytes you reviewed.",
          body: [
            "Before your wallet is asked for anything, Ryntra simulates the exact transaction against the live network and shows that result — what leaves, what arrives at least, what the network charges, what one-time reserve a new token account keeps. A wallet that returns different bytes sends nothing.",
            {
              list: [
                "Terms that moved past the reviewed figures stop the purchase and ask you to review again.",
                "A transfer that is still confirming is not repeated — the page says so instead of sending twice.",
                "A quote is never shown as a fill, and a fee is never shown as collected before it is.",
              ],
            },
            { gap: "Behaviour under long RPC failures, provider rate limits and network congestion is handled as it is found — each case fixed when it appears and held by a test — and has not been reviewed by anyone outside the team." },
          ],
        },
        {
          id: "receipts",
          title: "Receipts",
          hint: "What you reviewed, beside what the network did.",
          body: [
            "A transaction signature is not a receipt. A receipt keeps what you reviewed — the amounts, the minimum, the fees, the network costs — beside what the network did: the actual amount, the signature, the time. When less arrived than the reviewed minimum, both figures stay visible.",
            "Every receipt links to the transaction on a public explorer; your wallet and the network remain the record of what happened.",
          ],
        },
        {
          id: "data",
          title: "Your data",
          hint: "What is kept for a signed-in wallet — and what never is.",
          body: [
            {
              list: [
                "Never collected: seed phrases, private keys, wallet passwords, card details — there is nothing to pay Ryntra.",
                "Kept for a signed-in wallet: its public address and session records, the operations it made through Ryntra and their receipts, its Autoinvest rules, reminders and the payments a rule counted, its plans, its questions to Ryntra the AI assistant and the answers, its notifications, the Rewards and points ledgers, a referral link, a watchlist, and an optional Telegram channel.",
                "Services receive what an action needs and no more: your public address and the transaction for a purchase, the address you send to for a recipient check, your question and the facts it needs for an answer. Usage events carry no wallet and no amount; nothing is sold or shared with advertisers.",
              ],
            },
            { href: "/legal/privacy", label: "Privacy Policy" },
          ],
        },
        {
          id: "assurance",
          title: "Current assurance",
          hint: "No independent audit has been completed.",
          body: [
            {
              list: [
                "Nothing on this site should be read as an audited or certified system.",
                "There is no bug bounty, no third-party penetration test and no dedicated security inbox.",
                "Ryntra is a beta on Solana Mainnet: it moves real money.",
              ],
            },
            { gap: "Saying this plainly is the point: this section changes on the day a report exists that someone can read." },
          ],
        },
        {
          id: "report",
          title: "Report a vulnerability",
          hint: "Enough to reproduce it — and never a key.",
          body: [
            "Write with enough detail to reproduce the issue: the affected page or part, the steps, and the impact you believe it has. Never send a seed phrase or a private key — nobody at Ryntra needs one to investigate. Do not test against other people's wallets or funds; use your own.",
            { gap: "There is no dedicated security address and no response-time commitment, because neither is staffed. Reports go to the same inbox as everything else and are read by the people who build the product." },
          ],
        },
      ],
    },
  },
  uk: {
    meta: {
      title: "Безпека — чого Ryntra може й не може торкнутися",
      description: "Що Ryntra може бачити, чого структурно не може, як працює підпис, де починається ризик третіх сторін, що не проходило аудиту і як повідомити про проблему.",
    },
    hero: {
      eyebrow: "Безпека",
      title: "Чого Ryntra може торкнутися — і чого ні.",
      lead: "Твої гроші лежать у твоєму гаманці. Ryntra готує купівлю, показує її в «Перевірці», а підписує твій гаманець. Чого Ryntra не бачила, того вона не стверджує.",
      chips: ["Кошти — у твоєму гаманці", "Без сід-фрази", "Твій підпис на кожній купівлі", "Solana Mainnet"],
    },
    boundary: {
      eyebrow: "Межа",
      title: "Чого Ryntra не може — раніше, ніж що може.",
      checked: "Звірено з кодом",
      cannot: "Ryntra не може",
      can: "Ryntra може",
    },
    known: {
      eyebrow: "Що відомо",
      title: "Що не перевірено — прямо.",
      facts: [
        "Ніщо на цьому сайті не варто читати як систему, що пройшла аудит чи сертифікацію.",
        "Немає програми винагород за вразливості, стороннього тесту на проникнення й окремої скриньки для безпеки.",
        "Ryntra — бета на Solana Mainnet: вона рухає справжні гроші.",
      ],
      report: "Повідомити про вразливість",
      noCommitment: "Окремої адреси для безпеки й зобов'язань щодо строку відповіді немає — на це немає людей. Звіти приходять у ту саму скриньку, що й усе інше, і їх читають ті, хто будує продукт.",
    },
    sections: {
      eyebrow: "Розділ за розділом",
      title: "Подробиці",
      lead: "Дванадцять розділів, кожен — на дотик глибше.",
      items: [
        {
          id: "model",
          title: "Модель безпеки",
          hint: "Ryntra стоїть поруч із твоїм гаманцем, а не перед ним.",
          body: [
            "Ryntra читає те, що показують ланцюг і твій гаманець, готує точну транзакцію, симулює її в живій мережі, показує результат у «Перевірці» й просить підписати твій гаманець — не себе.",
            "Злам Ryntra не може зрушити твоїх грошей: шляху, яким це можна зробити, немає. Він міг би ввести в оману — тому кожна цифра «Перевірки» має джерело, котирування ніколи не видається за результат, а невідоме лишається видимо невідомим.",
          ],
        },
        {
          id: "custody",
          title: "Кошти й ключі",
          hint: "Жодних депозитів, ключів і підписів за тебе.",
          body: [{
            list: [
              "Ryntra не приймає депозитів і не тримає грошей: немає адреси для поповнення, спільного балансу чи шляху виведення.",
              "Куплене лишається у твоєму гаманці під час кожної купівлі, обміну, мосту й виплати.",
              "Ryntra ніколи не просить сід-фрази, приватного ключа чи пароля гаманця — жоден екран їх не просить, і жодна розмова з підтримкою не попросить.",
              "Ryntra ніколи не підписує й не надсилає транзакцію за тебе. Шляху, що працює сам, немає.",
            ],
          }],
        },
        {
          id: "authorization",
          title: "Гаманець і акаунт",
          hint: "Під'єднання — лише адреса; вхід нічого не коштує й нічого не рухає.",
          body: [
            "Під'єднання гаманця передає його публічну адресу й нічого більше. Вхід — повідомлення, яке підписує гаманець, без транзакції й без комісії; воно прив'язує до гаманця твою історію, квитанції, правила й винагороди. Вхід діє на пристрої до доби, і його можна завершити на одному пристрої чи на всіх.",
            "Купівлю дозволяє твій гаманець — один раз і рівно на ту транзакцію, що була в «Перевірці». Ryntra не тримає жодного постійного дозволу — ні схвалення токена, ні делегата, ні ключа сесії. Наступна купівля — наступний підпис.",
          ],
        },
        {
          id: "credentials",
          title: "Ключі до інших сервісів",
          hint: "Ryntra не тримає жодного ключа, що може рухати твої гроші.",
          body: [{
            list: [
              "Жодного API-ключа біржі, торгового ключа чи делегата на будь-якому рахунку токена.",
              "Сервіси, через які йде купівля, — Jupiter для маршруту, провайдер для мосту, — отримують транзакцію, яку підпише твій гаманець, і твою публічну адресу, ніколи — ключ.",
              "Серверні ключі є лише для власної інфраструктури Ryntra — бази даних, Solana RPC, бота сповіщень, ШІ-моделі, — і жоден не може підписати за гаманець.",
            ],
          }],
        },
        {
          id: "agents",
          title: "«Автоінвест» і нагадування",
          hint: "Правило нагадує; купує лише твій підпис.",
          body: [
            "Ніщо в Ryntra не діє від твого імені. Правило «Автоінвесту» — регулярно, якщо впаде, з кожної оплати — лише планує нагадування. Це не дозвіл витрачати, а бюджет місяця обмежує нагадування й теж нічого не дозволяє.",
            "Коли настає час правила, приходить нагадування — у Ryntra, а в Telegram, щойно його під'єднано. Один дотик відкриває свіжу «Перевірку» на суму правила, і нічого не куплено, доки ти не підпишеш. Непідписане нагадування позначається «Пропущено» й ніколи не купується пізніше.",
            "«З кожної оплати» читає власні оплати USDC твого гаманця в Solana — вони публічні в ланцюгу, — щоб порахувати, що правило відкладає, і ніколи їх не рухає. Нагляд пише нотатку, коли змінюється те, за чим стежить твоє правило чи план; нотатка нічого не купує й не продає.",
          ],
        },
        {
          id: "ai",
          title: "Ryntra — ШІ-помічник",
          hint: "Пояснює й готує чернетки; купувати, продавати чи підписувати не може.",
          body: [
            "Помічник пояснює й готує чернетки; опубліковані правила рахують і перевіряють; вирішуєш і підписуєш ти. У нього немає інструмента купити, продати, надіслати чи підписати; він не вигадує відсутніх фактів, а де цифру можна порахувати — її рахують, а не вгадують.",
            "Твоє запитання й потрібні для нього факти надсилаються із сервера Ryntra постачальнику моделі, щоб отримати відповідь; ключ моделі лишається на сервері й ніколи не потрапляє в браузер. Ніколи не вставляй у запитання сід-фразу чи ключ.",
            "Кожен екран, де говорить помічник, каже, що це Ryntra — ШІ-помічник.",
          ],
        },
        {
          id: "providers",
          title: "Сервіси навколо купівлі",
          hint: "Кожна цифра називає джерело; збій показано як збій.",
          body: [
            "Маршрути й котирування — від Jupiter; ринкові цифри — від Jupiter і GeckoTerminal; факти компаній — зі звітів SEC; оцінка приватної компанії — від PreStocks; баланси — від провайдера Solana RPC. Токенізовані акції випускають треті сторони — xStocks, Backpack, Ondo і PreStocks.",
            {
              list: [
                "Збій провайдера показано як збій: сторінка каже, що не вдалося прочитати і що працює далі.",
                "Власні правила токена читаються до купівлі чи переказу — емітент, що може заморозити, перемістити чи спалити токен, призупинені перекази, комісія емітента з кожного переказу, — і показуються в «Перевірці».",
                "Токенізована акція — токен емітента на його умовах. Ryntra показує емітента, але за нього не ручається.",
              ],
            },
            { href: "/methodology", label: "Звідки кожна цифра" },
          ],
        },
        {
          id: "replay",
          title: "До й після підпису",
          hint: "Підписуєш рівно те, що було в «Перевірці».",
          body: [
            "Перш ніж щось попросити в гаманця, Ryntra симулює точну транзакцію в живій мережі й показує результат: що спишеться, що надійде щонайменше, скільки візьме мережа, який разовий резерв лишить новий рахунок токена. Якщо гаманець поверне інші байти — нічого не надсилається.",
            {
              list: [
                "Якщо умови вийшли за перевірені цифри, купівля зупиняється й просить перевірити знову.",
                "Переказ, що ще підтверджується, не повторюється — сторінка каже про це замість надіслати вдруге.",
                "Котирування ніколи не видається за виконання, а комісія — за зібрану, доки її не зібрано.",
              ],
            },
            { gap: "Поведінку під час довгих збоїв RPC, лімітів провайдерів і завантаженої мережі виправляємо, щойно знаходимо, — кожен випадок закріплює тест, — і ніхто поза командою її не перевіряв." },
          ],
        },
        {
          id: "receipts",
          title: "Квитанції",
          hint: "Перевірене — поруч із тим, що зробила мережа.",
          body: [
            "Підпис транзакції — ще не квитанція. Квитанція тримає перевірене — суми, мінімум, комісії, плату мережі — поруч із тим, що зробила мережа: фактичну суму, підпис, час. Коли надійшло менше за перевірений мінімум, видно обидві цифри.",
            "Кожна квитанція веде до транзакції в публічному оглядачі; запис того, що сталося, — це твій гаманець і мережа.",
          ],
        },
        {
          id: "data",
          title: "Твої дані",
          hint: "Що зберігається для гаманця після входу — і що ніколи.",
          body: [
            {
              list: [
                "Ніколи не збираються: сід-фрази, приватні ключі, паролі гаманців, дані карток — платити Ryntra нема за що.",
                "Для гаманця після входу зберігаються: його публічна адреса й записи сесій, операції через Ryntra та їхні квитанції, правила й нагадування «Автоінвесту» та оплати, які правило врахувало, плани, запитання до Ryntra — ШІ-помічника — і відповіді, сповіщення, облік винагород і балів, реферальне посилання, обране й необов'язковий канал Telegram.",
                "Сервіси отримують те, що потрібно для дії, і не більше: для купівлі — твою публічну адресу й транзакцію, для перевірки отримувача — адресу, на яку надсилаєш, для відповіді — запитання й потрібні для нього факти. Події використання не несуть ні гаманця, ні суми; нічого не продається й не передається рекламодавцям.",
              ],
            },
            { href: "/legal/privacy", label: "Політика приватності" },
          ],
        },
        {
          id: "assurance",
          title: "Що перевірено зараз",
          hint: "Незалежного аудиту не було.",
          body: [
            {
              list: [
                "Ніщо на цьому сайті не варто читати як систему, що пройшла аудит чи сертифікацію.",
                "Немає програми винагород за вразливості, стороннього тесту на проникнення й окремої скриньки для безпеки.",
                "Ryntra — бета на Solana Mainnet: вона рухає справжні гроші.",
              ],
            },
            { gap: "Сказати це прямо — і є мета: цей розділ зміниться в день, коли з'явиться звіт, який можна прочитати." },
          ],
        },
        {
          id: "report",
          title: "Повідомити про вразливість",
          hint: "Достатньо, щоб відтворити, — і ніколи не ключ.",
          body: [
            "Напиши так, щоб проблему можна було відтворити: яка сторінка чи частина, які кроки і який, на твою думку, наслідок. Ніколи не надсилай сід-фразу чи приватний ключ — нікому в Ryntra вони не потрібні для розслідування. Не тестуй на чужих гаманцях чи коштах — лише на своїх.",
            { gap: "Окремої адреси для безпеки й зобов'язань щодо строку відповіді немає — на це немає людей. Звіти приходять у ту саму скриньку, що й усе інше, і їх читають ті, хто будує продукт." },
          ],
        },
      ],
    },
  },
};

export function securityCopy(locale: SecurityLocale): SecurityCopy {
  return SECURITY_COPY[locale];
}
