import { CREDITS } from "./facts.ts";
import { facts, list, note, p, section, steps, type DocPage } from "./model.ts";

/**
 * Ryntra, the AI assistant — the menu's «Ryntra · ШІ-помічник», documented
 * once, in the words it is held to: it explains and prepares; published rules
 * compute and check; the person decides and signs. What reaches the model's
 * provider is stated plainly — the question and the facts it needs, never the
 * wallet's address, the request not stored by the provider — and nothing it
 * cannot do is dressed as a feature. The name is Ryntra wherever a person
 * reads: no «Ryn».
 */

export const ASSISTANT: DocPage = {
  slug: "ryntra",
  group: "ryntra",
  destination: "agent",
  title: { en: "Ryntra assistant", uk: "Помічник Ryntra" },
  seoTitle: { en: "Ryntra assistant — Ryntra Docs", uk: "Помічник Ryntra — Документація Ryntra" },
  summary: {
    en: "Ask about a token, a price move or your portfolio, let it watch the market, read its morning brief — web and Telegram. It never trades or signs for you.",
    uk: "Спитай про токен, рух ціни чи портфель, доручи стежити за ринком, читай ранковий огляд — у вебі й у Telegram. Він ніколи не торгує й не підписує за тебе.",
  },
  sections: [
    section("ask", "What it does", "Що він робить", [
      list(
        [
          "Answers about a token or a company — its price, what moved it, its pools, holders and authorities, its news — every figure with its source and its time.",
          "Explains a price move: «Explain the move» — under ⋯ on a market's page in Spot, and on a launched token's page — asks it directly.",
          "Reads your portfolio, your plans and their results, and compares assets.",
          "Watches the market for you: a fall or a rise of 10% in a day, a price level, volume three times the usual, liquidity leaving a pool — and tells you when it happens.",
          "Sends a morning brief of what changed in what you watch.",
          "Prepares a draft — a plan, a watch or a trade — that you change, sign or leave.",
        ],
        [
          "Відповідає про токен чи компанію — ціну, що її зрушило, пули, власників і повноваження, новини, — кожна цифра з джерелом і часом.",
          "Пояснює рух ціни: «Пояснити рух» — під ⋯ на сторінці ринку в Споті й на сторінці запущеного токена — питає його прямо.",
          "Читає твій портфель, твої плани та їхні результати й порівнює активи.",
          "Стежить за ринком для тебе: падіння чи ріст на 10% за добу, рівень ціни, обсяг утричі більший за звичайний, ліквідність, що йде з пулу, — і каже, коли це сталося.",
          "Надсилає ранковий огляд того, що змінилося в тому, за чим ти стежиш.",
          "Готує чернетку — план, стеження чи угоду, — яку ти змінюєш, підписуєш або лишаєш.",
        ],
      ),
      p(
        "Ryntra is the Ryntra button at the end of the header on every page — it opens with the screen you are on as its context — and the row «Ryntra assistant» under Automation in the menu, with five tabs: Chat, Watching, Plans, Briefs and Credits.",
        "Ryntra — це кнопка Ryntra в кінці шапки на кожній сторінці: він відкривається з екраном, на якому ти є, як контекстом, — і рядок «Помічник Ryntra» в групі «Автоматика» меню, з п'ятьма вкладками: Розмова, Стежу, Плани, Огляди й Кредити.",
      ),
    ]),
    section("answers", "How it answers", "Як він відповідає", [
      p(
        "A serious answer goes the same way every time: what is observed, what it means, the case against, the risks and what is unknown, what to check, and the possible next steps — every figure with its source and its time. When the data is not there, it says so. «Nothing to do today» is a full answer.",
        "Серйозна відповідь щоразу йде однаково: що спостерігається, що це означає, аргументи проти, ризики й невідоме, що перевірити і можливі наступні кроки — кожна цифра з джерелом і часом. Коли даних немає, він так і каже. «Сьогодні нічого робити не треба» — повноцінна відповідь.",
      ),
    ]),
    section("never", "What it never does", "Чого він ніколи не робить", [
      list(
        [
          "It never buys, sells, sends or signs — it has no tool that could. A draft goes to the same Review and your signature as anything else.",
          "It never tells you what to buy: Ryntra gives no personal investment advice.",
          "It never supplies a missing fact or a price it did not read; the sizes and limits on a draft are computed by published rules, not by the model.",
          "It is not an adviser: the decision and the signature are yours.",
        ],
        [
          "Він ніколи не купує, не продає, не надсилає й не підписує — у нього немає такого інструмента. Чернетка йде в ту саму «Перевірку» й на твій підпис, як і все інше.",
          "Він ніколи не каже, що тобі купити: Ryntra не дає персональних інвестиційних порад.",
          "Він ніколи не вигадує відсутнього факту чи ціни, якої не прочитав; суми й межі в чернетці рахують опубліковані правила, а не модель.",
          "Він не радник: рішення й підпис — твої.",
        ],
      ),
    ]),
    section("credits", "Credits", "Кредити", [
      p(
        "An answer from the model costs credits; an answer built from data alone costs nothing. Credits are the assistant's own units — not a token, not money, never paid out — and the Credits tab shows your balance and what each action costs.",
        "Відповідь моделі коштує кредитів; відповідь, складена лише з даних, нічого не коштує. Кредити — власні одиниці помічника: не токен, не гроші й ніколи не виплачуються; вкладка «Кредити» показує баланс і скільки коштує кожна дія.",
      ),
      facts(
        [
          ["Free every day", `${CREDITS.freeDaily} credits a UTC day, not carried over, spent first`],
          ["Welcome", `${CREDITS.welcome} credits once, for a wallet at least ${CREDITS.welcomeMinAgeDays} days old with at least ${CREDITS.welcomeMinTxs} transactions`],
          ["A question", `${CREDITS.question} credits`],
          ["A token report or a price move explained", `${CREDITS.tokenReport} credits`],
          ["A deep research · a plan", `${CREDITS.deep} · ${CREDITS.plan} credits`],
          ["Buying more", "With USDC on Solana, in packages on the Credits tab; bought credits never expire"],
          ["A day's ceiling", `At most ${CREDITS.dailySpendCap.en} credits of your balance a day`],
        ],
        [
          ["Безкоштовно щодня", `${CREDITS.freeDaily} кредитів за добу UTC, не переносяться, витрачаються першими`],
          ["Привітальні", `${CREDITS.welcome} кредитів один раз — для гаманця віком від ${CREDITS.welcomeMinAgeDays} днів і щонайменше з ${CREDITS.welcomeMinTxs} транзакціями`],
          ["Запитання", `${CREDITS.question} кредити`],
          ["Звіт про токен чи пояснення руху ціни", `${CREDITS.tokenReport} кредитів`],
          ["Глибоке дослідження · план", `${CREDITS.deep} · ${CREDITS.plan} кредитів`],
          ["Докупити", "За USDC на Solana, пакетами у вкладці «Кредити»; куплені кредити не згорають"],
          ["Межа на день", `Не більше ${CREDITS.dailySpendCap.uk} кредитів балансу на добу`],
        ],
      ),
    ]),
    section("telegram", "In Telegram", "У Telegram", [
      steps(
        [
          "Sign in with your wallet, open Account and choose Connect Telegram.",
          "The link opens Ryntra's bot; press Start, and the chat is bound to your account.",
          "Ask in text or by voice, use /watch, /plans, /brief, /credits, /settings and /help, and get your notes and the morning brief there — on the same credits as the web.",
        ],
        [
          "Увійди гаманцем, відкрий «Акаунт» і обери «Підключити Telegram».",
          "Посилання відкриває бота Ryntra; натисни Start — і чат прив'язано до твого акаунта.",
          "Питай текстом чи голосом, користуйся /watch, /plans, /brief, /credits, /settings і /help, отримуй туди нотатки й ранковий огляд — на тих самих кредитах, що й у вебі.",
        ],
      ),
      note(
        "Telegram is a channel, not a sign-in, and it gives no access to your wallet. Ryntra's bot never asks for a wallet, a seed phrase or a payment; a message that does is not from Ryntra.",
        "Telegram — канал, а не спосіб входу, і він не дає доступу до гаманця. Бот Ryntra ніколи не просить гаманця, сід-фрази чи платежу; повідомлення, яке просить, — не від Ryntra.",
        "caution",
      ),
    ]),
    section("data", "What reaches the model", "Що отримує модель", [
      p(
        "To answer, Ryntra's server sends the model's provider your question and the facts it needs — for example your holdings as company and amount — but not your wallet's address, and asks the provider not to keep the request. Your conversations are kept with your account. Questions that reach the model have a daily limit per wallet.",
        "Щоб відповісти, сервер Ryntra надсилає постачальнику моделі твоє запитання й потрібні для нього факти — наприклад, твої позиції як компанію й кількість, — але не адресу гаманця, і просить постачальника не зберігати запит. Твої розмови зберігаються з твоїм акаунтом. Запитання, що доходять до моделі, мають денну межу на гаманець.",
      ),
      note(
        "Never paste a seed phrase, a private key or a password into a question. Ryntra never asks for one.",
        "Ніколи не вставляй у запитання сід-фразу, приватний ключ чи пароль. Ryntra ніколи їх не просить.",
        "caution",
      ),
    ]),
  ],
  related: ["bots", "phone", "reference/review"],
};

export const RYNTRA_PAGES: readonly DocPage[] = [ASSISTANT];
