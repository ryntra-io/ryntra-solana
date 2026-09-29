import type { BetaLang, BetaStatus, TaskStatus } from "./types";
import type { RecapAdvice } from "../journal/recap";

// Single source of copy for the bot and the /beta status page (EN full, UK/RU full).
// Brand/technical tokens (Ryntra, Arcus, SmartTrade, X, wallet, 0x…) stay English by convention.

type StatusCopy = { name: string; hint: string };

export type BetaCopy = {
  // bot
  welcomeTitle: string;
  welcomeBody: string;
  welcomeFooter: string;
  /** The single action that opens the beta. There is no second rung behind it. */
  btnConfirm: string;
  btnWallet: string;
  btnWalletDone: string;
  btnStatus: string;
  btnStatusPage: string;
  btnDemo: string;
  paperOpened: (market: string, side: string, entry: string) => string;
  paperClosed: (market: string, pnl: string, reason: string) => string;
  liveFillOpened: (market: string, side: string, size: string, price: string) => string;
  liveFillClosed: (market: string, pnl: string, side: string, size: string, price: string) => string;
  /** Daily discipline recap (see lib/journal/recap.ts). Adherence % leads; one constructive
      next-step; discipline register, never profit. Values are pre-formatted %-strings or "—". */
  dailyRecap: (p: { adherence: string; winRate: string; trades: number; unreviewed: number; advice: RecapAdvice }) => string;
  /** Confirmation succeeded, or had already succeeded — both are a normal outcome. */
  confirmDone: string;
  confirmAlready: string;
  /** The only failure the user ever sees here: state could not be read right now. */
  stateError: string;
  askWallet: string;
  walletSaved: string;
  walletBad: string;
  statusTitle: string;
  nextHint: Record<BetaStatus, string>;
  help: string;
  unknown: string;
  // statuses (shared)
  status: Record<BetaStatus, StatusCopy>;
  taskState: Record<TaskStatus, string>;
  // /beta page
  pageTitle: string;
  pageIntro: string;
  /** Heading of the single access card that replaced the old rung ladder. */
  accessTitle: string;
  pageCta: string;
  pageYourStatus: string;
  /** Says plainly that the optional things are optional. */
  optionalNote: string;
  pageTrust: string[];
  pageNotFound: string;
  authRecovery: string;
  pageOpenBot: string;
  gateTitle: string;
  gateHint: string;
  // unauthenticated /app gate (professional onboarding state, not a bare 401)
  cabinetGateTitle: string;
  cabinetGateIntro: string;
  cabinetGateSteps: readonly string[];
  cabinetGateDemo: string;
  cabinetGateStale: string;
};

/**
 * Access is binary: confirmed in the bot, or not yet.
 *
 * `BetaStatus` keeps its historical enum because the database still computes it and
 * legacy rows still carry values like `arcus_submitted`. Every non-`pending` value
 * implies a verified `telegram_join`, so all of them collapse to one honest label.
 * Nothing here may imply that a channel, an Arcus account, an X follow or an invite
 * changes standing, because none of them does.
 */
function accessCopy(notConfirmed: StatusCopy, confirmed: StatusCopy): Record<BetaStatus, StatusCopy> {
  return {
    pending: notConfirmed,
    telegram_verified: confirmed,
    arcus_submitted: confirmed,
    x_verified: confirmed,
    beta_approved: confirmed,
    priority: confirmed,
  };
}

const STATUS_EN = accessCopy(
  { name: "Not confirmed", hint: "Open the bot and confirm — that is what opens the beta." },
  { name: "Confirmed", hint: "Beta access is confirmed. The Telegram channel, X, Arcus and a wallet are optional and change nothing here." },
);

const STATUS_UK = accessCopy(
  { name: "Не підтверджено", hint: "Відкрий бота й підтверди — саме це відкриває бету." },
  { name: "Підтверджено", hint: "Доступ до бети підтверджено. Канал у Telegram, X, Arcus і гаманець опційні й нічого тут не змінюють." },
);

const STATUS_RU = accessCopy(
  { name: "Не подтверждено", hint: "Открой бота и подтверди — именно это открывает бету." },
  { name: "Подтверждено", hint: "Доступ к бете подтверждён. Канал в Telegram, X, Arcus и кошелёк опциональны и ничего здесь не меняют." },
);

const en: BetaCopy = {
  welcomeTitle: "<b>Welcome to Ryntra 🚀</b>",
  welcomeBody:
    "Ryntra Workspace is the reference client for the Ryntra Evidence Kernel: scoped evidence, paper-first planning, a decision journal, and human-authorized supported actions.\n\nOne confirmation opens the beta. Nothing else does — following on X, joining the Telegram channel, registering with Arcus and adding a wallet are all optional and improve nothing.\n\nConfirming records that you asked for access. It gives Ryntra no custody, no keys, and no permission to move anything.",
  welcomeFooter: "Non-custodial · No deposits to Ryntra · Free during beta\nNo token, no points, no reward programme.",
  btnConfirm: "✅ Confirm beta access",
  btnWallet: "Add wallet address",
  btnWalletDone: "Wallet saved ✓",
  btnStatus: "📊 My status",
  btnStatusPage: "Open status page",
  btnDemo: "🖥 Open terminal",
  paperOpened: (market, side, entry) =>
    `📈 Paper trade opened: <b>${side.toUpperCase()} ${market}</b> @ ${entry}\nSimulated only — no real orders.`,
  paperClosed: (market, pnl, reason) =>
    `📉 Paper trade closed: <b>${market}</b> (${reason.toUpperCase()})\nPaper PnL: <b>${pnl} USD</b>\nAdd your review in the journal.`,
  liveFillOpened: (market, side, size, price) =>
    `🔵 Arcus fill: <b>${side} ${market}</b> ${size} @ ${price}\nSeen on your connected address (read-only).`,
  liveFillClosed: (market, pnl, side, size, price) =>
    `🟣 Arcus position reduced/closed: <b>${market}</b> ${side} ${size} @ ${price}\nRealized PnL: <b>${pnl} USD</b>\nAdd a journal note in the terminal.`,
  dailyRecap: ({ adherence, winRate, trades, unreviewed, advice }) =>
    `📊 <b>Your discipline recap</b>\nPlan adherence: <b>${adherence}</b> · Win rate: ${winRate} · ${trades} closed\n` +
    (advice === "flag-plans"
      ? "Flag whether you followed your plan on each closed trade — that's what unlocks your discipline signal."
      : advice === "review-open"
        ? `${unreviewed} still need a review — tag the mistake, save the lesson.`
        : advice === "on-plan"
          ? "You're sticking to your plans. Keep it up — plan the next trade before you enter."
          : "Your plan-adherence dipped this stretch. No guilt — the fix is simple: write the plan before the next entry.") +
    "\nDiscipline is the metric Ryntra tracks — not profit.",
  confirmDone: "✅ Beta access confirmed. Open the terminal below.",
  confirmAlready: "✅ Already confirmed — your access is active.",
  stateError: "Could not read your state right now. Try again in a moment.",
  askWallet:
    "Send a public wallet address (starts with 0x…).\n\nThis is optional. It turns on the read-only live view and fill alerts, and it changes nothing about your access. Ryntra never asks for a seed phrase or a private key.",
  walletSaved: "✅ Wallet saved. The read-only live view is on; your access is unchanged.",
  walletBad: "That does not look like a wallet address. It starts with 0x and has 42 characters. Try again.",
  statusTitle: "<b>Your beta access</b>",
  nextHint: Object.fromEntries(Object.entries(STATUS_EN).map(([k, v]) => [k, v.hint])) as Record<BetaStatus, string>,
  help:
    "<b>Commands</b>\n/start — open the beta and confirm access\n/status — your access state\n/feedback — send product feedback\n/settings — notifications\n/help — this message\n\nQuestions? Write to hello@ryntra.io",
  unknown: "Tap /start to confirm access, or /help for commands.",
  status: STATUS_EN,
  taskState: { pending: "Pending", submitted: "Submitted", verified: "Verified", rejected: "Rejected" },
  pageTitle: "Ryntra Beta Access",
  pageIntro:
    "Free during beta. Non-custodial. One confirmation in the Telegram bot opens the product, and nothing else affects access.",
  accessTitle: "Beta access",
  pageCta: "Start in Telegram",
  pageYourStatus: "Your beta access",
  optionalNote: "The Telegram channel, X, Arcus and a wallet address are optional. None of them affects access, priority or any reward.",
  pageTrust: [
    "No deposits to Ryntra — the beta never takes custody",
    "No seed phrases and no private keys, ever",
    "Beta access is not a token, points or a reward programme",
    "Confirming in the bot is the only thing that opens the product",
    "Arcus is one supported venue, not a requirement; it is unavailable in the US, UK, Canada and sanctioned regions",
  ],
  pageNotFound: "This status link is invalid or expired. Open the bot and tap “My status” to get a fresh one.",
  authRecovery: "This sign-in link has expired or was already used. Open the bot to generate a fresh secure link.",
  pageOpenBot: "Open @RyntraBeta_bot",
  gateTitle: "One step to the demo",
  gateHint: "Open @RyntraBeta_bot and confirm beta access. That is the only step.",
  cabinetGateTitle: "Your cabinet is one confirmation away",
  cabinetGateIntro:
    "The cabinet shows scoped risk context, paper-first planning, the decision journal, a read-only live account view, and the wallet-signed Arcus spot route where supported. Arcus is the first shipped adapter. Access is confirmed in the Telegram bot — free during beta.",
  cabinetGateSteps: [
    "Open @RyntraBeta_bot",
    "Tap Confirm beta access",
    "Open the cabinet from the bot — it issues your personal link",
  ],
  cabinetGateDemo: "Watch the public demo tour",
  cabinetGateStale: "Had a link already? Cabinet links expire — open the bot and it will issue a fresh one.",
};

const uk: BetaCopy = {
  welcomeTitle: "<b>Ласкаво просимо в Ryntra 🚀</b>",
  welcomeBody:
    "Ryntra Workspace — reference client для Ryntra Evidence Kernel: evidence context, paper-first планування, журнал рішень і лише підтримані дії з авторизацією людини.\n\nОдне підтвердження відкриває бету. Більше нічого — підписка в X, канал у Telegram, реєстрація на Arcus і гаманець опційні й нічого не покращують.\n\nПідтвердження лише фіксує, що ти попросив доступ. Воно не дає Ryntra ні кастодії, ні ключів, ні права щось переміщувати.",
  welcomeFooter: "Non-custodial · Без депозитів у Ryntra · Безкоштовно в беті\nЖодного токена, балів чи програми винагород.",
  btnConfirm: "✅ Підтвердити доступ до бети",
  btnWallet: "Додати адресу гаманця",
  btnWalletDone: "Wallet збережено ✓",
  btnStatus: "📊 Мій статус",
  btnStatusPage: "Сторінка статусу",
  btnDemo: "🖥 Відкрити термінал",
  paperOpened: (market, side, entry) =>
    `📈 Paper-угоду відкрито: <b>${side.toUpperCase()} ${market}</b> @ ${entry}\nЛише симуляція — реальних ордерів немає.`,
  paperClosed: (market, pnl, reason) =>
    `📉 Paper-угоду закрито: <b>${market}</b> (${reason.toUpperCase()})\nPaper PnL: <b>${pnl} USD</b>\nДодай розбір у журнал.`,
  liveFillOpened: (market, side, size, price) =>
    `🔵 Arcus-філ: <b>${side} ${market}</b> ${size} @ ${price}\nПомічено на твоїй підключеній адресі (read-only).`,
  liveFillClosed: (market, pnl, side, size, price) =>
    `🟣 Позицію на Arcus зменшено/закрито: <b>${market}</b> ${side} ${size} @ ${price}\nRealized PnL: <b>${pnl} USD</b>\nДодай нотатку в журнал у терміналі.`,
  dailyRecap: ({ adherence, winRate, trades, unreviewed, advice }) =>
    `📊 <b>Твій підсумок дисципліни</b>\nДотримання плану: <b>${adherence}</b> · Win rate: ${winRate} · закрито: ${trades}\n` +
    (advice === "flag-plans"
      ? "Познач на кожній закритій угоді, чи дотримався плану — саме це вмикає твій сигнал дисципліни."
      : advice === "review-open"
        ? `${unreviewed} ще чекають на розбір — познач помилку, збережи урок.`
        : advice === "on-plan"
          ? "Ти тримаєшся своїх планів. Так тримати — плануй наступну угоду до входу."
          : "Цього відрізка дотримання плану просіло. Без докорів — рецепт простий: спиши план до наступного входу.") +
    "\nМетрика, яку відстежує Ryntra, — дисципліна, не прибуток.",
  confirmDone: "✅ Доступ до бети підтверджено. Відкривай термінал нижче.",
  confirmAlready: "✅ Уже підтверджено — доступ активний.",
  stateError: "Не вдалося зчитати твій стан зараз. Спробуй за мить.",
  askWallet:
    "Надішли публічну адресу гаманця (починається з 0x…).\n\nЦе опційно. Вона вмикає read-only live-режим і алерти про філи й нічого не змінює в доступі. Ryntra ніколи не просить seed phrase чи приватний ключ.",
  walletSaved: "✅ Wallet збережено. Read-only live-режим увімкнено; доступ не змінився.",
  walletBad: "Це не схоже на адресу гаманця. Вона починається з 0x і має 42 символи. Спробуй ще раз.",
  statusTitle: "<b>Твій доступ до бети</b>",
  nextHint: Object.fromEntries(Object.entries(STATUS_UK).map(([k, v]) => [k, v.hint])) as Record<BetaStatus, string>,
  help:
    "<b>Команди</b>\n/start — відкрити бету й підтвердити доступ\n/status — стан твого доступу\n/feedback — надіслати відгук\n/settings — сповіщення\n/help — це повідомлення\n\nПитання? Пиши на hello@ryntra.io",
  unknown: "Натисни /start, щоб підтвердити доступ, або /help для списку команд.",
  status: STATUS_UK,
  taskState: { pending: "Очікує", submitted: "Надіслано", verified: "Підтверджено", rejected: "Відхилено" },
  pageTitle: "Ryntra Beta Access",
  pageIntro:
    "Безкоштовно в беті. Non-custodial. Продукт відкриває одне підтвердження в Telegram-боті, і більше ніщо на доступ не впливає.",
  accessTitle: "Доступ до бети",
  pageCta: "Почати в Telegram",
  pageYourStatus: "Твій доступ до бети",
  optionalNote: "Канал у Telegram, X, Arcus і адреса гаманця — опційні. Жодне з цього не впливає на доступ, пріоритет чи будь-яку винагороду.",
  pageTrust: [
    "Жодних депозитів у Ryntra — бета ніколи не бере кастодію",
    "Ніколи не просимо seed phrase і приватні ключі",
    "Доступ до бети — не токен, не бали й не програма винагород",
    "Підтвердження в боті — єдине, що відкриває продукт",
    "Arcus — один із підтриманих майданчиків, а не вимога; він недоступний у США, Британії, Канаді та санкційних регіонах",
  ],
  pageNotFound: "Це посилання на статус недійсне або застаріло. Відкрий бота й натисни «Мій статус», щоб отримати нове.",
  authRecovery: "Посилання для входу застаріло або вже використане. Відкрий бота, щоб створити нове безпечне посилання.",
  pageOpenBot: "Відкрити @RyntraBeta_bot",
  gateTitle: "Один крок до демо",
  gateHint: "Відкрий @RyntraBeta_bot і підтверди доступ до бети. Це єдиний крок.",
  cabinetGateTitle: "Кабінет — за одне підтвердження",
  cabinetGateIntro:
    "Кабінет показує контекст ризику, paper-first планування, журнал рішень, read-only огляд акаунта і wallet-signed Arcus spot там, де цей маршрут підтриманий. Arcus — перший shipped-адаптер. Доступ підтверджується в Telegram-боті, безкоштовно в беті.",
  cabinetGateSteps: [
    "Відкрий @RyntraBeta_bot",
    "Натисни «Підтвердити доступ до бети»",
    "Відкрий кабінет із бота — він видасть твій особистий лінк",
  ],
  cabinetGateDemo: "Подивитися публічний demo-тур",
  cabinetGateStale: "Уже мав лінк? Лінки кабінету застарівають — відкрий бота, і він видасть новий.",
};

const ru: BetaCopy = {
  welcomeTitle: "<b>Добро пожаловать в Ryntra 🚀</b>",
  welcomeBody:
    "Ryntra Workspace — reference client для Ryntra Evidence Kernel: evidence context, paper-first планирование, журнал решений и только поддерживаемые действия с авторизацией человека.\n\nОдно подтверждение открывает бету. Больше ничего — подписка в X, канал в Telegram, регистрация на Arcus и кошелёк опциональны и ничего не улучшают.\n\nПодтверждение лишь фиксирует, что ты попросил доступ. Оно не даёт Ryntra ни кастодии, ни ключей, ни права что-либо перемещать.",
  welcomeFooter: "Non-custodial · Без депозитов в Ryntra · Бесплатно в бете\nНикакого токена, баллов или программы наград.",
  btnConfirm: "✅ Подтвердить доступ к бете",
  btnWallet: "Добавить адрес кошелька",
  btnWalletDone: "Wallet сохранён ✓",
  btnStatus: "📊 Мой статус",
  btnStatusPage: "Страница статуса",
  btnDemo: "🖥 Открыть терминал",
  paperOpened: (market, side, entry) =>
    `📈 Paper-сделка открыта: <b>${side.toUpperCase()} ${market}</b> @ ${entry}\nТолько симуляция — реальных ордеров нет.`,
  paperClosed: (market, pnl, reason) =>
    `📉 Paper-сделка закрыта: <b>${market}</b> (${reason.toUpperCase()})\nPaper PnL: <b>${pnl} USD</b>\nДобавь разбор в журнал.`,
  liveFillOpened: (market, side, size, price) =>
    `🔵 Arcus-филл: <b>${side} ${market}</b> ${size} @ ${price}\nЗамечен на твоём подключённом адресе (read-only).`,
  liveFillClosed: (market, pnl, side, size, price) =>
    `🟣 Позиция на Arcus уменьшена/закрыта: <b>${market}</b> ${side} ${size} @ ${price}\nRealized PnL: <b>${pnl} USD</b>\nДобавь заметку в журнал в терминале.`,
  dailyRecap: ({ adherence, winRate, trades, unreviewed, advice }) =>
    `📊 <b>Твой итог дисциплины</b>\nСледование плану: <b>${adherence}</b> · Win rate: ${winRate} · закрыто: ${trades}\n` +
    (advice === "flag-plans"
      ? "Отметь на каждой закрытой сделке, следовал ли ты плану — именно это включает твой сигнал дисциплины."
      : advice === "review-open"
        ? `${unreviewed} ещё ждут разбора — отметь ошибку, сохрани урок.`
        : advice === "on-plan"
          ? "Ты держишься своих планов. Так держать — планируй следующую сделку до входа."
          : "На этом отрезке следование плану просело. Без упрёков — рецепт прост: пропиши план до следующего входа.") +
    "\nМетрика, которую отслеживает Ryntra, — дисциплина, не прибыль.",
  confirmDone: "✅ Доступ к бете подтверждён. Открывай терминал ниже.",
  confirmAlready: "✅ Уже подтверждено — доступ активен.",
  stateError: "Не удалось прочитать твоё состояние сейчас. Попробуй через мгновение.",
  askWallet:
    "Отправь публичный адрес кошелька (начинается с 0x…).\n\nЭто опционально. Он включает read-only live-режим и алерты о филлах и ничего не меняет в доступе. Ryntra никогда не просит seed phrase или приватный ключ.",
  walletSaved: "✅ Wallet сохранён. Read-only live-режим включён; доступ не изменился.",
  walletBad: "Это не похоже на адрес кошелька. Он начинается с 0x и содержит 42 символа. Попробуй ещё раз.",
  statusTitle: "<b>Твой доступ к бете</b>",
  nextHint: Object.fromEntries(Object.entries(STATUS_RU).map(([k, v]) => [k, v.hint])) as Record<BetaStatus, string>,
  help:
    "<b>Команды</b>\n/start — открыть бету и подтвердить доступ\n/status — состояние твоего доступа\n/feedback — отправить отзыв\n/settings — уведомления\n/help — это сообщение\n\nВопросы? Пиши на hello@ryntra.io",
  unknown: "Нажми /start, чтобы подтвердить доступ, или /help для списка команд.",
  status: STATUS_RU,
  taskState: { pending: "Ожидает", submitted: "Отправлено", verified: "Подтверждено", rejected: "Отклонено" },
  pageTitle: "Ryntra Beta Access",
  pageIntro:
    "Бесплатно в бете. Non-custodial. Продукт открывает одно подтверждение в Telegram-боте, и больше ничто на доступ не влияет.",
  accessTitle: "Доступ к бете",
  pageCta: "Начать в Telegram",
  pageYourStatus: "Твой доступ к бете",
  optionalNote: "Канал в Telegram, X, Arcus и адрес кошелька — опциональны. Ничто из этого не влияет на доступ, приоритет или какую-либо награду.",
  pageTrust: [
    "Никаких депозитов в Ryntra — бета никогда не берёт кастодию",
    "Никогда не просим seed phrase и приватные ключи",
    "Доступ к бете — не токен, не баллы и не программа наград",
    "Подтверждение в боте — единственное, что открывает продукт",
    "Arcus — одна из поддерживаемых площадок, а не требование; он недоступен в США, Британии, Канаде и санкционных регионах",
  ],
  pageNotFound: "Эта ссылка на статус недействительна или устарела. Открой бота и нажми «Мой статус», чтобы получить новую.",
  authRecovery: "Ссылка для входа устарела или уже использована. Открой бота, чтобы создать новую безопасную ссылку.",
  pageOpenBot: "Открыть @RyntraBeta_bot",
  gateTitle: "Один шаг до демо",
  gateHint: "Открой @RyntraBeta_bot и подтверди доступ к бете. Это единственный шаг.",
  cabinetGateTitle: "Кабинет — в одном подтверждении",
  cabinetGateIntro:
    "Кабинет показывает контекст риска, paper-first планирование, журнал решений, read-only обзор аккаунта и wallet-signed Arcus spot там, где этот маршрут поддерживается. Arcus — первый shipped-адаптер. Доступ подтверждается в Telegram-боте, бесплатно в бете.",
  cabinetGateSteps: [
    "Открой @RyntraBeta_bot",
    "Нажми «Подтвердить доступ к бете»",
    "Открой кабинет из бота — он выдаст твою личную ссылку",
  ],
  cabinetGateDemo: "Посмотреть публичный demo-тур",
  cabinetGateStale: "Уже была ссылка? Ссылки кабинета устаревают — открой бота, и он выдаст новую.",
};

export const BETA_COPY: Record<BetaLang, BetaCopy> = { en, uk, ru };
