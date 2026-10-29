import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * «Реальність послідовника» (SOL-R3) in both languages: on a wallet's page, before any copying — what a person copying
 * it would have kept, where the rest went, and copying on paper. On «ти»; an estimate, never advice or a promise.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const REALITY_WORDS = {
  title: bi("If you copied this wallet", "Якби ти копіював цей гаманець"),
  intro: bi(
    "What you would have kept of its trades — after your delay, the pool's depth, slippage, fees and failed transactions.",
    "Що лишилося б тобі з його угод — після затримки, глибини пулу, прослизання, комісій і невдалих транзакцій.",
  ),
  walletMade: bi("Its trades, at your size", "Його угоди — у твоєму розмірі"),
  walletOwn: bi("The wallet itself: {pct} on {spent} SOL", "Сам гаманець: {pct} на {spent} SOL"),
  youKept: bi("You would have kept", "Тобі лишилося б"),
  onSize: bi("{spent} SOL in, {result} SOL", "вкладено {spent} SOL, результат {result} SOL"),
  size: bi("Per buy", "На кожну купівлю"),
  delay: bi("Your delay", "Твоя затримка"),
  delayHint: bi("2 min is about how late an alert reaches you.", "2 хв — приблизно стільки йде сповіщення."),
  slippage: bi("Slippage tolerance", "Допуск прослизання"),
  seconds: bi("{n} s", "{n} с"),
  minutes: bi("{n} min", "{n} хв"),
  breakdown: bi("Where the result went", "Куди пішов результат"),
  stepIdeal: bi("Its trades at your size", "Його угоди у твоєму розмірі"),
  stepDelay: bi("Delay of your entry", "Затримка входу"),
  stepLiquidity: bi("Pool depth", "Ліквідність пулу"),
  stepSlippage: bi("Slippage while landing", "Прослизання"),
  stepFees: bi("Fees: Ryntra and network", "Комісії: Ryntra і мережа"),
  stepFailures: bi("Failed transactions", "Невдалі транзакції"),
  stepResult: bi("You would have kept", "Тобі лишилося б"),
  copied: bi("Buys copied: {copied} of {buys}", "Скопійовано купівель: {copied} з {buys}"),
  missedSlippage: bi("missed — the price moved past {pct}% three times: {count}", "пропущено — ціна тричі вийшла за {pct} %: {count}"),
  stuck: bi("sales that did not land, still held — counted at no more than the sale would have got: {count}", "продажі, що не пройшли, досі в позиції — рахуємо не дорожче, ніж дав би продаж: {count}"),
  colToken: bi("Token", "Токен"),
  colWallet: bi("The wallet", "Гаманець"),
  colYou: bi("You", "Ти"),
  notMeasured: bi("Not measured", "Не виміряно"),
  NO_PATH: bi("no price history of its pool", "немає історії ціни пулу"),
  NO_PRICE_NOW: bi("no price now", "немає ціни зараз"),
  NOT_PRICED: bi("bought with another token or paid for by another wallet", "куплено за інший токен або оплачено іншим гаманцем"),
  NOT_READ: bi("its pool's prices could not be read just now — try again in a minute", "ціни його пулу зараз не прочиталися — спробуй за хвилину"),
  BEYOND_FOUR: bi("measured are the four tokens bought last", "міряємо чотири останні куплені токени"),
  BOUGHT_BEFORE: bi("bought before the trades read", "куплено раніше за прочитані угоди"),
  fresh: bi("recent trades, counted in a few minutes: {count}", "свіжі угоди, врахуємо за кілька хвилин: {count}"),
  liquidityUnknown: bi("tokens with liquidity not known (your size moved nothing there): {count}", "токени з невідомою ліквідністю (твоя сума там нічого не зрушила): {count}"),
  capped: bi("tokens whose pool is too thin for {size} SOL at your tolerance — such a swap would fail as sent; counted at its full impact: {count}", "токени, де пул затонкий для {size} SOL за твого допуску, — такий обмін не пройшов би; рахуємо з повним впливом: {count}"),
  noPriceNow: bi("tokens with no price now — what is held of them counts at zero: {count}", "токени без ціни зараз — що в позиції, рахуємо за нуль: {count}"),
  leftOut: bi("Left out: {count} tokens, {sol} SOL of the wallet's buys — see «Not measured» below.", "Не враховано: токенів — {count}, {sol} SOL купівель гаманця — див. «Не виміряно» нижче."),
  noneCopied: bi("No buy copied", "Жодної купівлі не скопійовано"),
  TOO_FRESH: bi("too recent — measured in a few minutes", "надто свіже — виміряємо за кілька хвилин"),
  noneMeasured: bi("Nothing could be measured this time — the reasons are below.", "Цього разу нічого не вдалося виміряти — причини нижче."),
  reading: bi("Reading the pools' prices around its trades…", "Читаємо ціни пулів навколо його угод…"),
  failed: bi("The pools' prices could not be read just now.", "Ціни пулів зараз не вдалося прочитати."),
  retry: bi("Try again", "Спробувати ще"),
  assumptions: bi(
    "Prices — the pool's {width} bars (GeckoTerminal) around each trade; liquidity — today's, scaled back to each trade by its price; your size's impact counted whole. Fees — Ryntra {fee}% on memes, network {network} SOL and priority {priority} SOL per attempt; one transaction in {fail} lands on the second try, {retry} s later. Open positions at the price now.",
    "Ціни — свічки пулу по {width} (GeckoTerminal) навколо кожної угоди; ліквідність — сьогоднішня, зведена до кожної угоди за її ціною; вплив твоєї суми — повністю. Комісії — Ryntra {fee} % на мемах, мережа {network} SOL і пріоритет {priority} SOL за спробу; одна транзакція з {fail} проходить з другої спроби, через {retry} с. Відкриті позиції — за ціною зараз.",
  ),
  approx: bi("Dollar trades in SOL at today's price.", "Угоди в доларах — у SOL за ціною зараз."),
  estimate: bi("An estimate from past trades — not a promise and not advice.", "Оцінка з минулих угод — не обіцянка й не порада."),
  paperTitle: bi("Copy on paper", "Копіювати на папері"),
  paperNote: bi(
    "No money moves. From now on Ryntra fills each of this wallet's trades on paper at the price of the moment it sees it — the delay is the real one — with your size and tolerance above, the pool's depth of that moment, Ryntra's and the network's fees (with the retries' share). Slippage while landing is not counted on paper.",
    "Гроші не рухаються. Відтепер Ryntra виконує кожну угоду цього гаманця на папері за ціною моменту, коли її побачила, — затримка справжня — з твоєю сумою й допуском вище, глибиною пулу того моменту, комісіями Ryntra й мережі (з часткою повторів). Прослизання під час посадки папір не рахує.",
  ),
  paperStart: bi("Start on paper", "Почати на папері"),
  paperSave: bi("Use these settings", "Взяти ці налаштування"),
  paperStop: bi("Stop", "Зупинити"),
  paperSince: bi("On paper since {date} · {size} SOL per buy · {pct}% tolerance", "На папері з {date} · {size} SOL на купівлю · допуск {pct} %"),
  paperResult: bi("Paper result", "Результат на папері"),
  paperIn: bi("{spent} SOL in · fees {fees} SOL · {filled} filled · {missed} missed", "вкладено {spent} SOL · комісії {fees} SOL · виконано {filled} · пропущено {missed}"),
  paperNoPrice: bi("held tokens with no price now, counted at zero: {count}", "токени в позиції без ціни зараз, рахуємо за нуль: {count}"),
  paperNoSol: bi("SOL's price could not be read just now.", "Ціну SOL зараз не вдалося прочитати."),
  paperEmpty: bi("Nothing copied yet. The wallet's next trade is filled within about two minutes.", "Ще нічого не скопійовано. Наступну угоду гаманця виконаємо приблизно за дві хвилини."),
  paperBought: bi("Bought {symbol}", "Купив {symbol}"),
  paperSold: bi("Sold {symbol}", "Продав {symbol}"),
  paperLate: bi("{delay} after the wallet", "через {delay} після гаманця"),
  missed_liquidity: bi("Missed: pool too thin", "Пропущено: пул замалий"),
  missed_price: bi("Missed: no price", "Пропущено: немає ціни"),
  missed_late: bi("Missed: seen too late", "Пропущено: побачили запізно"),
  missed_full: bi("Missed: 30 tokens held already", "Пропущено: вже 30 токенів у позиціях"),
  paperUnread: bi("Your paper copies could not be read just now.", "Копії на папері зараз не вдалося прочитати."),
  paperLimit: bi("You copy five wallets on paper — stop one first.", "Ти вже копіюєш п'ять гаманців на папері — спершу зупини один."),
  paperFailed: bi("That did not go through. Try again.", "Не вдалося. Спробуй ще раз."),
  paperConnect: bi("Connect a wallet to copy on paper.", "Підключи гаманець, щоб копіювати на папері."),
  paperProve: bi("Confirm your wallet to copy on paper.", "Підтверди гаманець, щоб копіювати на папері."),
  liveTitle: bi("Live copying", "Живе копіювання"),
  liveLocked: bi(
    "Not open yet. Live copying comes after a legal review, and then only within spending limits you set yourself. Until then — on paper.",
    "Ще не відкрито. Живе копіювання з'явиться після юридичної перевірки, і тоді лише в межах лімітів витрат, які ти задаєш сам. До того — на папері.",
  ),
} as const;

export type RealityWord = keyof typeof REALITY_WORDS;

export function realityWords(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (key: RealityWord, values?: Readonly<Record<string, string | number>>) => {
    let text: string = REALITY_WORDS[key][lang];
    if (values) for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}
