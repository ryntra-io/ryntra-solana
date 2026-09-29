/**
 * Copy for the raven hero.
 *
 * Kept apart from HOME_COPY because the hero is being rebuilt while the rest of
 * the page still runs on the old system; merging them now would mean editing
 * every locale of a file that is about to be replaced section by section.
 *
 * Claim discipline is unchanged from the rest of the product. The primary
 * action opens the Telegram funnel — it does not "run the scanner", because
 * beta access is closed and the scanner is not reachable without it. The card
 * strip states what the product does, never what a user will earn.
 */

export type RavenLang = "en" | "uk" | "ru";

export type RavenHeroCopy = {
  /** Eyebrow above the headline. */
  eyebrow: string;
  /** Two lines — rendered as separate spans so the break never lands mid-phrase. */
  headline: [string, string];
  lead: string;
  leadDegraded: string;
  primary: string;
  secondary: string;
  /** Legend for the data-state chips. */
  statesNote: string;
  states: { live: string; stale: string; unavailable: string };
  cards: {
    scan: { label: string; title: string; meta: string; readiness: string; verdict: string };
    risk: { label: string; title: string; sources: string; readiness: string };
    receipt: { label: string; mode: string; signer: string };
    guarantees: { label: string; items: [string, string, string] };
  };
  /** Ticker rail — technical tokens stay English in every locale. */
  rail: string[];
};

const RAIL = [
  "ROBINHOOD CHAIN",
  "ARCUS",
  "TOKENIZED T-BILLS",
  "RWA SCANNER",
  "NON-CUSTODIAL",
  "BASE",
  "SOLANA",
  "EVM",
];

const en: RavenHeroCopy = {
  eyebrow: "RISK, STRATEGY & EVIDENCE OS",
  headline: ["Not another", "exchange."],
  lead: "Scan tokenized real-world assets and majors. See the risk and the readiness gate — then sign it yourself. Non-custodial, venue-neutral, no promises.",
  leadDegraded:
    "Scan tokenized real-world assets and majors. See the risk and the readiness gate — then sign it yourself. Route data is unconfirmed right now, and the page says so rather than guessing.",
  primary: "Open free beta",
  secondary: "See how it works",
  statesNote: "honest data states — never invented numbers",
  states: { live: "LIVE", stale: "STALE", unavailable: "UNAVAILABLE" },
  cards: {
    scan: {
      label: "RWA SCAN",
      title: "Robinhood Chain equity",
      meta: "venue-neutral",
      readiness: "READINESS",
      verdict: "PASS",
    },
    risk: {
      label: "RISK BRIEF",
      title: "Thin liquidity. Estimated slippage above your target size.",
      sources: "sources: 3",
      readiness: "readiness: review",
    },
    receipt: { label: "DECISION RECEIPT", mode: "append-only", signer: "signed by you" },
    guarantees: {
      label: "GUARANTEES",
      items: ["NO CUSTODY", "NO AUTO-SIGN", "NO PROFIT PROMISES"],
    },
  },
  rail: RAIL,
};

const uk: RavenHeroCopy = {
  eyebrow: "RISK, STRATEGY & EVIDENCE OS",
  headline: ["Це не ще одна", "біржа."],
  lead: "Скануй токенізовані реальні активи та мажори. Дивись ризик і готовність — і підписуй сам. Non-custodial, незалежно від майданчика, без обіцянок.",
  leadDegraded:
    "Скануй токенізовані реальні активи та мажори. Дивись ризик і готовність — і підписуй сам. Дані маршруту зараз не підтверджені, і сторінка це каже прямо, а не вгадує.",
  primary: "Відкрити безкоштовну бету",
  secondary: "Як це працює",
  statesNote: "чесні стани даних — жодних вигаданих чисел",
  states: { live: "LIVE", stale: "STALE", unavailable: "UNAVAILABLE" },
  cards: {
    scan: {
      label: "RWA SCAN",
      title: "Акції на Robinhood Chain",
      meta: "незалежно від майданчика",
      readiness: "ГОТОВНІСТЬ",
      verdict: "PASS",
    },
    risk: {
      label: "RISK BRIEF",
      title: "Тонка ліквідність. Очікуване прослизання вище за твій розмір.",
      sources: "джерел: 3",
      readiness: "готовність: перевір",
    },
    receipt: { label: "DECISION RECEIPT", mode: "тільки дозапис", signer: "підписано тобою" },
    guarantees: {
      label: "ГАРАНТІЇ",
      items: ["БЕЗ КАСТОДІ", "БЕЗ АВТОПІДПИСУ", "БЕЗ ОБІЦЯНОК ПРИБУТКУ"],
    },
  },
  rail: RAIL,
};

const ru: RavenHeroCopy = {
  eyebrow: "RISK, STRATEGY & EVIDENCE OS",
  headline: ["Это не ещё одна", "биржа."],
  lead: "Сканируй токенизированные реальные активы и мажоры. Смотри риск и готовность — и подписывай сам. Non-custodial, независимо от площадки, без обещаний.",
  leadDegraded:
    "Сканируй токенизированные реальные активы и мажоры. Смотри риск и готовность — и подписывай сам. Данные маршрута сейчас не подтверждены, и страница говорит это прямо, а не угадывает.",
  primary: "Открыть бесплатную бету",
  secondary: "Как это работает",
  statesNote: "честные состояния данных — никаких выдуманных чисел",
  states: { live: "LIVE", stale: "STALE", unavailable: "UNAVAILABLE" },
  cards: {
    scan: {
      label: "RWA SCAN",
      title: "Акции на Robinhood Chain",
      meta: "независимо от площадки",
      readiness: "ГОТОВНОСТЬ",
      verdict: "PASS",
    },
    risk: {
      label: "RISK BRIEF",
      title: "Тонкая ликвидность. Ожидаемое проскальзывание выше твоего размера.",
      sources: "источников: 3",
      readiness: "готовность: проверь",
    },
    receipt: { label: "DECISION RECEIPT", mode: "только дозапись", signer: "подписано тобой" },
    guarantees: {
      label: "ГАРАНТИИ",
      items: ["БЕЗ КАСТОДИ", "БЕЗ АВТОПОДПИСИ", "БЕЗ ОБЕЩАНИЙ ПРИБЫЛИ"],
    },
  },
  rail: RAIL,
};

/* ------------------------------------------------------------------ scanner */

export type RavenScannerCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  /** Three beats of the method, shown under the instrument. */
  steps: { h: string; p: string }[];
  /** Column heads of the readout. */
  columns: { check: string; result: string; state: string };
  sampleTag: string;
  legend: string;
  /**
   * The seven checks, in the order the sweep runs them. The keys are fixed and
   * shared with the sample data in the component; only the label is localised.
   */
  checks: { key: RavenScanCheckKey; label: string }[];
  /** Words for the three outcomes a single check can have. */
  states: { ok: string; warn: string; none: string; idle: string };
  /** Instrument controls. Anything that moves on its own must be stoppable. */
  controls: { run: string; rerun: string; pause: string; resume: string; reset: string };
  /** Evidence coverage meter — how many checks have returned. */
  coverage: string;
  /**
   * The verdict vocabulary. "Safe" is deliberately absent: the scanner reports
   * what it checked, and no combination of checks earns that word.
   */
  verdicts: { ready: string; review: string; blocked: string; idle: string };
  report: {
    title: string;
    /** One line per asset, explaining the verdict in plain words. */
    briefs: Record<string, string>;
    /** Shown before a run has produced anything. */
    empty: string;
  };
};

/** The seven checks the readiness sweep runs, in order. */
export type RavenScanCheckKey =
  | "identity"
  | "session"
  | "liquidity"
  | "spread"
  | "oracle"
  | "route"
  | "unknowns";

const scannerEn: RavenScannerCopy = {
  eyebrow: "THE SCANNER",
  title: "Know what is missing before you act.",
  lead: "Seven checks run in order, and each one reports separately. Ryntra keeps checked facts, warnings and unknowns apart instead of averaging them into a single score that hides all three.",
  steps: [
    { h: "Read", p: "Identity, session, depth, spread and oracle age, per instrument." },
    { h: "Gate", p: "Anything stale, thin or unknown is marked — never silently passed." },
    { h: "Brief", p: "You get the reason and the coverage, so you can judge the gap." },
  ],
  columns: { check: "CHECK", result: "RESULT", state: "STATE" },
  sampleTag: "SAMPLE VALUES · METHOD PREVIEW · NOT LIVE MARKET DATA",
  legend: "Fixed sample values, shown to demonstrate the method. Live figures appear in the product.",
  checks: [
    { key: "identity", label: "Identity" },
    { key: "session", label: "Market session" },
    { key: "liquidity", label: "Liquidity" },
    { key: "spread", label: "Estimated spread" },
    { key: "oracle", label: "Oracle freshness" },
    { key: "route", label: "Route availability" },
    { key: "unknowns", label: "Unknowns" },
  ],
  states: { ok: "checked", warn: "review", none: "unknown", idle: "not run" },
  controls: { run: "Run sample scan", rerun: "Run again", pause: "Pause", resume: "Resume", reset: "Reset" },
  coverage: "EVIDENCE COVERAGE",
  verdicts: { ready: "READY", review: "REVIEW", blocked: "NOT READY", idle: "NOT SCANNED" },
  report: {
    title: "READINESS BRIEF",
    briefs: {
      TSLA: "Every check returned. Depth supports the sample size and the oracle is fresh — the decision is yours to make.",
      AAPL: "Depth is thinner than the sample size wants and the spread widened. Nothing is blocking, but the size deserves a second look.",
      AMD: "The reference market is closed and the oracle is stale, so the quote is priced against an old reference. Two unknowns remain.",
      BTC: "Read-only. The venue reports the market but Ryntra has no supported route here, so no action can be prepared from this screen.",
    },
    empty: "Run the sample scan to see how the evidence is separated.",
  },
};

const scannerUk: RavenScannerCopy = {
  eyebrow: "СКАНЕР",
  title: "Знай, чого бракує, ще до дії.",
  lead: "Сім перевірок ідуть по черзі, і кожна звітує окремо. Ryntra тримає перевірені факти, попередження й невідоме нарізно — замість того, щоб усереднити їх в один бал, який ховає всі три.",
  steps: [
    { h: "Читає", p: "Ідентичність, сесія, глибина, спред і вік оракула — по інструменту." },
    { h: "Фільтрує", p: "Застаріле, тонке чи невідоме позначається — а не проходить мовчки." },
    { h: "Пояснює", p: "Ти отримуєш причину й покриття, щоб самому оцінити прогалину." },
  ],
  columns: { check: "ПЕРЕВІРКА", result: "РЕЗУЛЬТАТ", state: "СТАН" },
  sampleTag: "ЗРАЗКОВІ ЗНАЧЕННЯ · ПОКАЗ МЕТОДУ · НЕ ЖИВІ ДАНІ РИНКУ",
  legend: "Фіксовані зразкові значення для демонстрації методу. Живі цифри — у продукті.",
  checks: [
    { key: "identity", label: "Ідентичність" },
    { key: "session", label: "Торгова сесія" },
    { key: "liquidity", label: "Ліквідність" },
    { key: "spread", label: "Оцінений спред" },
    { key: "oracle", label: "Свіжість оракула" },
    { key: "route", label: "Наявність маршруту" },
    { key: "unknowns", label: "Невідоме" },
  ],
  states: { ok: "перевірено", warn: "перевір", none: "невідомо", idle: "не запускалось" },
  controls: { run: "Запустити зразковий скан", rerun: "Запустити ще раз", pause: "Пауза", resume: "Продовжити", reset: "Скинути" },
  coverage: "ПОКРИТТЯ ДОКАЗАМИ",
  verdicts: { ready: "ГОТОВО", review: "ПЕРЕВІР", blocked: "НЕ ГОТОВО", idle: "НЕ СКАНОВАНО" },
  report: {
    title: "БРИФ ГОТОВНОСТІ",
    briefs: {
      TSLA: "Усі перевірки повернулись. Глибина витримує зразковий розмір, оракул свіжий — рішення за тобою.",
      AAPL: "Глибина тонша, ніж хоче зразковий розмір, і спред розширився. Нічого не блокує, але розмір варто переглянути.",
      AMD: "Референсний ринок закритий, а оракул застарів — котирування спирається на стару ціну. Два пункти лишились невідомими.",
      BTC: "Тільки читання. Майданчик показує ринок, але підтриманого маршруту тут немає, тож дію з цього екрана підготувати неможливо.",
    },
    empty: "Запусти зразковий скан, щоб побачити, як розділяються докази.",
  },
};

const scannerRu: RavenScannerCopy = {
  eyebrow: "СКАНЕР",
  title: "Знай, чего не хватает, до действия.",
  lead: "Семь проверок идут по очереди, и каждая отчитывается отдельно. Ryntra держит проверенные факты, предупреждения и неизвестное порознь — вместо того чтобы усреднить их в один балл, который скрывает все три.",
  steps: [
    { h: "Читает", p: "Идентичность, сессия, глубина, спред и возраст оракула — по инструменту." },
    { h: "Фильтрует", p: "Устаревшее, тонкое или неизвестное помечается — а не проходит молча." },
    { h: "Объясняет", p: "Ты получаешь причину и покрытие, чтобы самому оценить пробел." },
  ],
  columns: { check: "ПРОВЕРКА", result: "РЕЗУЛЬТАТ", state: "СОСТОЯНИЕ" },
  sampleTag: "ОБРАЗЦОВЫЕ ЗНАЧЕНИЯ · ПОКАЗ МЕТОДА · НЕ ЖИВЫЕ ДАННЫЕ РЫНКА",
  legend: "Фиксированные образцовые значения для демонстрации метода. Живые цифры — в продукте.",
  checks: [
    { key: "identity", label: "Идентичность" },
    { key: "session", label: "Торговая сессия" },
    { key: "liquidity", label: "Ликвидность" },
    { key: "spread", label: "Оценённый спред" },
    { key: "oracle", label: "Свежесть оракула" },
    { key: "route", label: "Наличие маршрута" },
    { key: "unknowns", label: "Неизвестное" },
  ],
  states: { ok: "проверено", warn: "проверь", none: "неизвестно", idle: "не запускалось" },
  controls: { run: "Запустить образцовый скан", rerun: "Запустить ещё раз", pause: "Пауза", resume: "Продолжить", reset: "Сбросить" },
  coverage: "ПОКРЫТИЕ ДОКАЗАТЕЛЬСТВАМИ",
  verdicts: { ready: "ГОТОВО", review: "ПРОВЕРЬ", blocked: "НЕ ГОТОВО", idle: "НЕ СКАНИРОВАНО" },
  report: {
    title: "БРИФ ГОТОВНОСТИ",
    briefs: {
      TSLA: "Все проверки вернулись. Глубина выдерживает образцовый размер, оракул свежий — решение за тобой.",
      AAPL: "Глубина тоньше, чем хочет образцовый размер, и спред расширился. Ничто не блокирует, но размер стоит пересмотреть.",
      AMD: "Референсный рынок закрыт, а оракул устарел — котировка опирается на старую цену. Два пункта остались неизвестными.",
      BTC: "Только чтение. Площадка показывает рынок, но поддерживаемого маршрута здесь нет, поэтому действие с этого экрана подготовить нельзя.",
    },
    empty: "Запусти образцовый скан, чтобы увидеть, как разделяются доказательства.",
  },
};

const SCANNER_TABLE: Record<RavenLang, RavenScannerCopy> = {
  en: scannerEn,
  uk: scannerUk,
  ru: scannerRu,
};

export function ravenScannerCopy(lang: string): RavenScannerCopy {
  return SCANNER_TABLE[lang as RavenLang] ?? scannerEn;
}

/* ------------------------------------------------------------------ markets */

export type RavenMarketsCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  /** Why the two families cannot be shown as one uniform list. */
  hoursNote: string;
  clock: { always: string; sessions: string };
};

const marketsEn: RavenMarketsCopy = {
  eyebrow: "COVERAGE",
  title: "Real-world assets and crypto, in one view.",
  lead: "The same screen, but not the same rules. A tokenized equity follows its exchange's calendar; a crypto major never closes. Ryntra shows which clock an instrument is on before you size anything.",
  hoursNote:
    "Market hours are a risk signal, not a footnote: a tokenized equity quoted while its reference market is closed is priced against a stale reference.",
  clock: { always: "24/7", sessions: "MARKET HOURS" },
};

const marketsUk: RavenMarketsCopy = {
  eyebrow: "ПОКРИТТЯ",
  title: "Реальні активи й крипта — в одному вигляді.",
  lead: "Той самий екран, але не ті самі правила. Токенізована акція живе за календарем своєї біржі; крипто-мажор не закривається ніколи. Ryntra показує, за яким годинником іде інструмент, ще до розміру позиції.",
  hoursNote:
    "Години торгів — це сигнал ризику, а не примітка: токенізована акція з котируванням при закритому базовому ринку оцінена проти застарілого орієнтира.",
  clock: { always: "24/7", sessions: "ГОДИНИ ТОРГІВ" },
};

const marketsRu: RavenMarketsCopy = {
  eyebrow: "ПОКРЫТИЕ",
  title: "Реальные активы и крипта — в одном виде.",
  lead: "Тот же экран, но не те же правила. Токенизированная акция живёт по календарю своей биржи; крипто-мажор не закрывается никогда. Ryntra показывает, по каким часам идёт инструмент, ещё до размера позиции.",
  hoursNote:
    "Часы торгов — сигнал риска, а не сноска: токенизированная акция с котировкой при закрытом базовом рынке оценена против устаревшего ориентира.",
  clock: { always: "24/7", sessions: "ЧАСЫ ТОРГОВ" },
};

const MARKETS_TABLE: Record<RavenLang, RavenMarketsCopy> = {
  en: marketsEn,
  uk: marketsUk,
  ru: marketsRu,
};

export function ravenMarketsCopy(lang: string): RavenMarketsCopy {
  return MARKETS_TABLE[lang as RavenLang] ?? marketsEn;
}

/* --------------------------------------------------------------------- loop */

export type RavenLoopCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  /** Why the last step feeds the first one — the reason this is a loop at all. */
  closing: { label: string; body: string };
  /**
   * The five stages of one decision, in order.
   *
   * Each names the registry capability that governs it, so the stage badge is
   * resolved rather than authored — the loop cannot show itself as more closed
   * than the product actually is. Three of the five work today; the block says
   * so instead of drawing a complete circuit and hoping nobody checks.
   */
  stages: {
    key: string;
    /** Registry id whose maturity this stage inherits. */
    capabilityId: string;
    label: string;
    body: string;
    /** The concrete artefact this stage produces. */
    output: string;
  }[];
  /** The stage everything else is arranged around. */
  anchor: { label: string; body: string };
  /** Prefix for the stage list, read by assistive technology. */
  stagesLabel: string;
  outputLabel: string;
  /**
   * What the stage counter counts. Without it "2/5" is a number without a
   * unit, and a reader could reasonably take it for progress rather than for
   * how many stages carry real value today.
   */
  countLabel: string;
};

const loopEn: RavenLoopCopy = {
  eyebrow: "THE DECISION LOOP",
  title: "One decision. One evidence trail.",
  lead: "Five stages carry a single decision from a plan to a reviewed outcome. Two of them are live today, two work on paper and one is still being built — each stage states its own maturity, because the loop is what we are closing, not something already closed.",
  stagesLabel: "Stages of one decision",
  outputLabel: "PRODUCES",
  countLabel: "live today",
  stages: [
    {
      key: "plan",
      capabilityId: "smarttrade-plan",
      label: "Plan",
      body: "Write the entry, the size, the invalidation and the reason before the market has an opinion about you.",
      output: "A written plan with its own limits",
    },
    {
      key: "risk",
      capabilityId: "rwa-risk-pack",
      label: "See the risk",
      body: "Market hours, liquidity, oracle freshness and price against oracle — read for the asset in front of you, with the unknowns left visible.",
      output: "A risk read with its sources and freshness",
    },
    {
      key: "gate",
      capabilityId: "risk-readiness-scanner",
      label: "Readiness gate",
      body: "The evidence is checked against the plan. Anything stale, thin or unknown is marked rather than averaged away.",
      output: "A reason-coded readiness state",
    },
    {
      key: "sign",
      capabilityId: "arcus-spot-rfq",
      label: "You sign",
      body: "Ryntra prepares the action and stops. The wallet prompt is yours, the key is yours, and walking away costs nothing.",
      output: "A transaction you authorised yourself",
    },
    {
      key: "review",
      capabilityId: "decision-journal",
      label: "Review",
      body: "What happened is written next to what you expected, and that record is what the next plan starts from.",
      output: "An append-only record you can read back",
    },
  ],
  anchor: {
    label: "Nothing moves until you sign it",
    body: "Every stage before this one produces evidence. This one produces an action — and it is the only stage Ryntra structurally cannot perform for you.",
  },
  closing: {
    label: "AND BACK",
    body: "The review is what closes the circle. Without it every decision starts from zero and the same mistake stays affordable.",
  },
};

const loopUk: RavenLoopCopy = {
  eyebrow: "ЦИКЛ РІШЕННЯ",
  title: "Одне рішення. Один слід доказів.",
  lead: "П'ять етапів ведуть одне рішення від плану до переглянутого результату. Два з них живі сьогодні, два працюють на папері, один ще будується — і кожен етап сам каже свою зрілість, бо цикл ми замикаємо, а не вже замкнули.",
  stagesLabel: "Етапи одного рішення",
  outputLabel: "ДАЄ НА ВИХОДІ",
  countLabel: "живі сьогодні",
  stages: [
    {
      key: "plan",
      capabilityId: "smarttrade-plan",
      label: "План",
      body: "Запиши вхід, розмір, інвалідацію й причину — доки ринок ще не має думки про тебе.",
      output: "Записаний план із власними лімітами",
    },
    {
      key: "risk",
      capabilityId: "rwa-risk-pack",
      label: "Побач ризик",
      body: "Години ринку, ліквідність, свіжість оракула й ціна проти оракула — для активу перед тобою, з невідомим, яке лишається на видноті.",
      output: "Читання ризику з джерелами та свіжістю",
    },
    {
      key: "gate",
      capabilityId: "risk-readiness-scanner",
      label: "Фільтр готовності",
      body: "Докази звіряються з планом. Застаріле, тонке чи невідоме позначається, а не всереднюється.",
      output: "Стан готовності з кодом причини",
    },
    {
      key: "sign",
      capabilityId: "arcus-spot-rfq",
      label: "Ти підписуєш",
      body: "Ryntra готує дію і зупиняється. Запит гаманця — твій, ключ — твій, а піти геть не коштує нічого.",
      output: "Транзакція, яку ти авторизував сам",
    },
    {
      key: "review",
      capabilityId: "decision-journal",
      label: "Перегляд",
      body: "Те, що сталося, пишеться поруч із тим, чого ти чекав, — і саме з цього запису починається наступний план.",
      output: "Запис тільки на дозапис, який можна перечитати",
    },
  ],
  anchor: {
    label: "Нічого не рухається, доки ти не підпишеш",
    body: "Кожен етап до цього дає докази. Цей дає дію — і це єдиний етап, який Ryntra структурно не може виконати за тебе.",
  },
  closing: {
    label: "І НАЗАД",
    body: "Коло замикає саме перегляд. Без нього кожне рішення починається з нуля, а та сама помилка лишається дешевою.",
  },
};

const loopRu: RavenLoopCopy = {
  eyebrow: "ЦИКЛ РЕШЕНИЯ",
  title: "Одно решение. Один след доказательств.",
  lead: "Пять этапов ведут одно решение от плана к пересмотренному результату. Два из них живы сегодня, два работают на бумаге, один ещё строится — и каждый этап сам говорит свою зрелость, потому что цикл мы замыкаем, а не уже замкнули.",
  stagesLabel: "Этапы одного решения",
  outputLabel: "ДАЁТ НА ВЫХОДЕ",
  countLabel: "живы сегодня",
  stages: [
    {
      key: "plan",
      capabilityId: "smarttrade-plan",
      label: "План",
      body: "Запиши вход, размер, инвалидацию и причину — пока у рынка ещё нет мнения о тебе.",
      output: "Записанный план с собственными лимитами",
    },
    {
      key: "risk",
      capabilityId: "rwa-risk-pack",
      label: "Увидь риск",
      body: "Часы рынка, ликвидность, свежесть оракула и цена против оракула — для актива перед тобой, с неизвестным, которое остаётся на виду.",
      output: "Чтение риска с источниками и свежестью",
    },
    {
      key: "gate",
      capabilityId: "risk-readiness-scanner",
      label: "Фильтр готовности",
      body: "Доказательства сверяются с планом. Устаревшее, тонкое или неизвестное помечается, а не усредняется.",
      output: "Состояние готовности с кодом причины",
    },
    {
      key: "sign",
      capabilityId: "arcus-spot-rfq",
      label: "Ты подписываешь",
      body: "Ryntra готовит действие и останавливается. Запрос кошелька — твой, ключ — твой, а уйти не стоит ничего.",
      output: "Транзакция, которую ты авторизовал сам",
    },
    {
      key: "review",
      capabilityId: "decision-journal",
      label: "Пересмотр",
      body: "То, что произошло, пишется рядом с тем, чего ты ждал, — и именно с этой записи начинается следующий план.",
      output: "Запись только на дозапись, которую можно перечитать",
    },
  ],
  anchor: {
    label: "Ничто не движется, пока ты не подпишешь",
    body: "Каждый этап до этого даёт доказательства. Этот даёт действие — и это единственный этап, который Ryntra структурно не может выполнить за тебя.",
  },
  closing: {
    label: "И ОБРАТНО",
    body: "Круг замыкает именно пересмотр. Без него каждое решение начинается с нуля, а та же ошибка остаётся дешёвой.",
  },
};

const LOOP_TABLE: Record<RavenLang, RavenLoopCopy> = { en: loopEn, uk: loopUk, ru: loopRu };

export function ravenLoopCopy(lang: string): RavenLoopCopy {
  return LOOP_TABLE[lang as RavenLang] ?? loopEn;
}

/* ------------------------------------------------------- principles + close */

export type RavenPrinciplesCopy = {
  eyebrow: string;
  title: string;
  /** Heading over the evidence column, so the proof is not mistaken for a claim. */
  proofLead: string;
};

export type RavenCloseCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  primary: string;
  secondary: string;
  /** Stated at the last possible moment, where a promise would normally go. */
  noPromise: string;
};

const prEn: RavenPrinciplesCopy = {
  eyebrow: "PRINCIPLES",
  title: "Four rules the product cannot break.",
  proofLead: "Verified, not asserted",
};
const prUk: RavenPrinciplesCopy = {
  eyebrow: "ПРИНЦИПИ",
  title: "Чотири правила, які продукт не може порушити.",
  proofLead: "Перевірено, а не заявлено",
};
const prRu: RavenPrinciplesCopy = {
  eyebrow: "ПРИНЦИПЫ",
  title: "Четыре правила, которые продукт не может нарушить.",
  proofLead: "Проверено, а не заявлено",
};

const closeEn: RavenCloseCopy = {
  eyebrow: "START HERE",
  title: "Read the risk before you sign it.",
  lead: "Beta access opens through Telegram. No email, no password, no card — and no balance to top up, because Ryntra never holds your funds.",
  primary: "Open free beta",
  secondary: "Read the methodology",
  noPromise: "Free during beta. Non-custodial. No profit promises, no token, and no date we have not earned.",
};

const closeUk: RavenCloseCopy = {
  eyebrow: "ПОЧАТИ ТУТ",
  title: "Прочитай ризик перед тим, як підписати.",
  lead: "Доступ до бети відкривається через Telegram. Без пошти, пароля й картки — і без балансу, який треба поповнювати, бо Ryntra ніколи не тримає твоїх коштів.",
  primary: "Відкрити безкоштовну бету",
  secondary: "Читати методологію",
  noPromise: "Безкоштовно в беті. Non-custodial. Без обіцянок прибутку, без токена і без дати, якої ми не заслужили.",
};

const closeRu: RavenCloseCopy = {
  eyebrow: "НАЧАТЬ ЗДЕСЬ",
  title: "Прочитай риск перед тем, как подписать.",
  lead: "Доступ к бете открывается через Telegram. Без почты, пароля и карты — и без баланса, который нужно пополнять, потому что Ryntra никогда не держит твоих средств.",
  primary: "Открыть бесплатную бету",
  secondary: "Читать методологию",
  noPromise: "Бесплатно в бете. Non-custodial. Без обещаний прибыли, без токена и без даты, которую мы не заслужили.",
};

const PR_TABLE: Record<RavenLang, RavenPrinciplesCopy> = { en: prEn, uk: prUk, ru: prRu };
const CLOSE_TABLE: Record<RavenLang, RavenCloseCopy> = { en: closeEn, uk: closeUk, ru: closeRu };

export function ravenPrinciplesCopy(lang: string): RavenPrinciplesCopy {
  return PR_TABLE[lang as RavenLang] ?? prEn;
}

export function ravenCloseCopy(lang: string): RavenCloseCopy {
  return CLOSE_TABLE[lang as RavenLang] ?? closeEn;
}

/* ---------------------------------------------------------------------- now */

export type RavenNowCopy = { eyebrow: string };

const NOW_TABLE: Record<RavenLang, RavenNowCopy> = {
  en: { eyebrow: "AVAILABLE NOW" },
  uk: { eyebrow: "ДОСТУПНО ЗАРАЗ" },
  ru: { eyebrow: "ДОСТУПНО СЕЙЧАС" },
};

export function ravenNowCopy(lang: string): RavenNowCopy {
  return NOW_TABLE[lang as RavenLang] ?? NOW_TABLE.en;
}

/* ----------------------------------------------------------------- roadmap */

export type RavenPhase = {
  key: string;
  /** Public name of the milestone — never an internal task id. */
  label: string;
  detail: string;
  /**
   * What has to be true before this milestone can light.
   *
   * Deliberately a dependency and never a date: the roadmap is ordered by gates
   * rather than by calendar, and a milestone that named a month would be making
   * a promise the product does not make.
   */
  gate: string;
};

export type RavenRoadmapCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  /** Milestones in order. Status comes from the registry, not from here. */
  phases: RavenPhase[];
  legendBuild: string;
  /** Shown instead of `lead` when a capability is awaiting re-verification. */
  leadDegraded: string;
  stateLive: string;
  stateAhead: string;
  legendLive: string;
  legendAhead: string;
  /** Filter chips over the rail. `all` is the default. */
  filters: { all: string };
  /** Labels around the detail panel a selected milestone opens. */
  detailLabels: { what: string; gate: string; state: string };
  /** Stated once under the rail, so no milestone has to repeat it. */
  noDates: string;
};

const ROADMAP_TABLE: Record<RavenLang, RavenRoadmapCopy> = {
  en: {
    eyebrow: "THE ROADMAP",
    title: "What works today, and what comes next.",
    lead: "Lit stages are shipped and reachable in the product right now. Dimmed ones are ahead of us. The lights are wired to the capability registry, not to this page — nothing here can glow before it is real.",
    leadDegraded:
      "Lit stages are shipped; dimmed ones are ahead. At least one capability is awaiting re-verification right now, so its stage is not lit — the map says so rather than assuming it still holds.",
    stateLive: "SHIPPED",
    stateAhead: "AHEAD",
    legendLive: "shipped",
    legendAhead: "ahead",
    legendBuild: "in build",
    filters: { all: "All" },
    detailLabels: { what: "WHAT IT IS", gate: "WHAT IT WAITS FOR", state: "STATE" },
    noDates: "No dates, no countdowns, no percentages. Each milestone waits on a gate, not on a calendar.",
    phases: [
      { key: "trade", label: "Signed swaps", detail: "Three Arcus routes, signed in your own wallet.", gate: "Live. Proven on a real swap that finished and was reconciled, with the fee shown before signing." },
      { key: "risk", label: "Risk read first", detail: "Hours, liquidity, oracle freshness before size.", gate: "Live for supported assets. It widens as each new venue is verified on its own, never in bulk." },
      { key: "scanner", label: "RWA Scanner", detail: "Tokenized assets scanned, gated, briefed.", gate: "Needs the modular product foundation underneath it, so a new chain is an adapter rather than a rewrite." },
      { key: "workspace", label: "Personal workspace", detail: "Simple and Pro over the same facts.", gate: "Needs the scanner and the composition root beneath it before depth can mean anything." },
      { key: "meme", label: "Meme intelligence", detail: "Base, EVM and Solana activity, no gem scores.", gate: "Needs wider chain coverage and vetted third-party signal sources before anything is shown as fact." },
      { key: "loop", label: "Closed decision loop", detail: "Strategy, receipt and review as one circuit.", gate: "Needs the readiness gate and the journal to be more than paper — two of the five stages are not yet." },
      { key: "beta", label: "Public beta", detail: "Accessibility, mobile, performance, support.", gate: "Needs accessibility, mobile, performance and support to hold together at once, not one at a time." },
    ],
  },
  uk: {
    eyebrow: "ДОРОЖНЯ КАРТА",
    title: "Що працює сьогодні — і що буде далі.",
    lead: "Підсвічені етапи вже в продукті й доступні зараз. Приглушені — попереду. Підсвітку задає реєстр спроможностей, а не ця сторінка: тут ніщо не засвітиться раніше, ніж стане реальним.",
    leadDegraded:
      "Підсвічені етапи готові, приглушені — попереду. Зараз щонайменше одна спроможність очікує повторної перевірки, тому її етап не світиться: карта каже це прямо, а не припускає, що все ще діє.",
    stateLive: "ГОТОВО",
    stateAhead: "ПОПЕРЕДУ",
    legendLive: "готово",
    legendAhead: "попереду",
    legendBuild: "в роботі",
    filters: { all: "Усі" },
    detailLabels: { what: "ЩО ЦЕ", gate: "НА ЩО ЧЕКАЄ", state: "СТАН" },
    noDates: "Жодних дат, відліків і відсотків. Кожна віха чекає на умову, а не на календар.",
    phases: [
      { key: "trade", label: "Підписані свопи", detail: "Три маршрути Arcus, підпис у твоєму гаманці.", gate: "Живе. Доведено реальним свопом, який завершився і був звірений, з комісією, показаною до підпису." },
      { key: "risk", label: "Спершу ризик", detail: "Години, ліквідність, свіжість оракула — до розміру.", gate: "Живе для підтриманих активів. Розширюється, коли кожен новий майданчик перевірено окремо — ніколи гуртом." },
      { key: "scanner", label: "RWA Scanner", detail: "Токенізовані активи: скан, фільтр, бриф.", gate: "Потребує модульного фундаменту продукту, щоб новий ланцюг був адаптером, а не переписуванням." },
      { key: "workspace", label: "Робочий простір", detail: "Simple і Pro над тими самими фактами.", gate: "Потребує сканера й композиційного кореня під собою — інакше глибина нічого не означає." },
      { key: "meme", label: "Meme intelligence", detail: "Активність Base, EVM і Solana без «gem score».", gate: "Потребує ширшого покриття мереж і перевірених сторонніх джерел сигналу, перш ніж щось подавати як факт." },
      { key: "loop", label: "Замкнений цикл", detail: "Стратегія, receipt і review як один контур.", gate: "Потребує, щоб фільтр готовності та журнал перестали бути папером — два з п'яти етапів ще ним є." },
      { key: "beta", label: "Публічна бета", detail: "Доступність, мобільний, швидкість, підтримка.", gate: "Потребує, щоб доступність, мобільний, швидкість і підтримка трималися разом, а не по черзі." },
    ],
  },
  ru: {
    eyebrow: "ДОРОЖНАЯ КАРТА",
    title: "Что работает сегодня — и что будет дальше.",
    lead: "Подсвеченные этапы уже в продукте и доступны сейчас. Приглушённые — впереди. Подсветку задаёт реестр возможностей, а не эта страница: здесь ничто не загорится раньше, чем станет реальным.",
    leadDegraded:
      "Подсвеченные этапы готовы, приглушённые — впереди. Сейчас как минимум одна возможность ждёт повторной проверки, поэтому её этап не светится: карта говорит это прямо, а не предполагает, что всё ещё в силе.",
    stateLive: "ГОТОВО",
    stateAhead: "ВПЕРЕДИ",
    legendLive: "готово",
    legendAhead: "впереди",
    legendBuild: "в работе",
    filters: { all: "Все" },
    detailLabels: { what: "ЧТО ЭТО", gate: "ЧЕГО ЖДЁТ", state: "СОСТОЯНИЕ" },
    noDates: "Никаких дат, отсчётов и процентов. Каждая веха ждёт условия, а не календаря.",
    phases: [
      { key: "trade", label: "Подписанные свопы", detail: "Три маршрута Arcus, подпись в твоём кошельке.", gate: "Живо. Доказано реальным свопом, который завершился и был сверен, с комиссией, показанной до подписи." },
      { key: "risk", label: "Сначала риск", detail: "Часы, ликвидность, свежесть оракула — до размера.", gate: "Живо для поддерживаемых активов. Расширяется, когда каждая новая площадка проверена отдельно — никогда оптом." },
      { key: "scanner", label: "RWA Scanner", detail: "Токенизированные активы: скан, фильтр, бриф.", gate: "Требует модульного фундамента продукта, чтобы новая сеть была адаптером, а не переписыванием." },
      { key: "workspace", label: "Рабочее пространство", detail: "Simple и Pro над теми же фактами.", gate: "Требует сканера и композиционного корня под собой — иначе глубина ничего не значит." },
      { key: "meme", label: "Meme intelligence", detail: "Активность Base, EVM и Solana без «gem score».", gate: "Требует более широкого покрытия сетей и проверенных сторонних источников сигнала, прежде чем что-то подавать как факт." },
      { key: "loop", label: "Замкнутый цикл", detail: "Стратегия, receipt и review как один контур.", gate: "Требует, чтобы фильтр готовности и журнал перестали быть бумагой — два из пяти этапов ещё ею являются." },
      { key: "beta", label: "Публичная бета", detail: "Доступность, мобильный, скорость, поддержка.", gate: "Требует, чтобы доступность, мобильный, скорость и поддержка держались вместе, а не по очереди." },
    ],
  },
};

export function ravenRoadmapCopy(lang: string): RavenRoadmapCopy {
  return ROADMAP_TABLE[lang as RavenLang] ?? ROADMAP_TABLE.en;
}

const TABLE: Record<RavenLang, RavenHeroCopy> = { en, uk, ru };

/** Locales beyond the three written above fall back to English, as the rest of the landing does. */
export function ravenHeroCopy(lang: string): RavenHeroCopy {
  return TABLE[lang as RavenLang] ?? en;
}

/**
 * Every block's copy for one locale, resolved in a single call.
 *
 * This module holds three locales of nine blocks. When client components
 * imported their own `ravenXxxCopy(lang)` the whole dictionary — all three
 * locales — was pulled into the browser bundle, and growing the middle of the
 * page pushed `/` from 146 kB to 170 kB against a 149 kB budget.
 *
 * Resolving here and passing the result down as props keeps this file on the
 * server: the browser receives one locale of rendered strings instead of the
 * dictionary that produced them. The saving is real and costs no truth, because
 * the strings are identical either way.
 */
export type RavenCopy = {
  hero: RavenHeroCopy;
  caps: RavenCapsCopy;
  scanner: RavenScannerCopy;
  markets: RavenMarketsCopy;
  loop: RavenLoopCopy;
  principles: RavenPrinciplesCopy;
  close: RavenCloseCopy;
  now: RavenNowCopy;
  roadmap: RavenRoadmapCopy;
};

export function ravenCopyFor(lang: string): RavenCopy {
  return {
    hero: ravenHeroCopy(lang),
    caps: ravenCapsCopy(lang),
    scanner: ravenScannerCopy(lang),
    markets: ravenMarketsCopy(lang),
    loop: ravenLoopCopy(lang),
    principles: ravenPrinciplesCopy(lang),
    close: ravenCloseCopy(lang),
    now: ravenNowCopy(lang),
    roadmap: ravenRoadmapCopy(lang),
  };
}

/* ------------------------------------------------------------------ *
 * Capability rows — "what you can do now", with the evidence attached.
 *
 * The headline and description of each row still come from HOME_COPY.cards,
 * because those four sentences are already claim-reviewed and localised. What
 * this table adds is the part a marketing row normally leaves out: the single
 * thing the capability does, the single thing it will never do, and a drawer of
 * evidence fields behind it.
 *
 * The maturity value is deliberately absent here. It is resolved from the
 * capability registry at render time, so a copy author cannot promote a row by
 * typing a better word into a dictionary.
 * ------------------------------------------------------------------ */

export type RavenCapsRow = {
  /** The one thing it does. */
  does: string;
  /** The one thing it will never do — the more informative half. */
  never: string;
  /** Evidence drawer values, keyed the same way in every locale. */
  evidence: { state: string; source: string; can: string; cannot: string; approve: string };
};

export type RavenCapsCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  /** Sits under the rows: the scope changes as capabilities ship. */
  note: string;
  drawerOpen: string;
  drawerClose: string;
  /** Labels of the evidence fields, in render order. */
  keys: { maturity: string; state: string; source: string; can: string; cannot: string; approve: string };
  /** capabilityId → its commitments. Ids match HOME_COPY.cards. */
  rows: Record<string, RavenCapsRow>;
};

const capsEn: RavenCapsCopy = {
  eyebrow: "WHAT YOU CAN DO NOW",
  title: "Start with what already works.",
  lead: "Four capabilities are reachable today. Everything else on this page is labelled before you click it — open a row to see the evidence behind the label.",
  note: "Scope grows as capabilities ship. Every row states its own maturity.",
  drawerOpen: "Evidence",
  drawerClose: "Evidence",
  keys: {
    maturity: "MATURITY",
    state: "DATA STATE",
    source: "SOURCE",
    can: "AVAILABLE ACTION",
    cannot: "UNAVAILABLE ACTION",
    approve: "YOU APPROVE",
  },
  rows: {
    "arcus-spot-rfq": {
      does: "Prepares a supported USDG route and states the cost before you sign.",
      never: "Never submits, signs or delegates anything on your behalf.",
      evidence: {
        state: "Live · venue-confirmed",
        source: "Arcus venue route data",
        can: "Prepare USDG ↔ TSLA, AAPL or AMD",
        cannot: "Unsupported pairs cannot be prepared",
        approve: "The transaction, in your own wallet",
      },
    },
    "rwa-risk-pack": {
      does: "Reads market hours, liquidity, oracle freshness and price versus oracle.",
      never: "Never turns an unknown into a score to make it look settled.",
      evidence: {
        state: "Live · with freshness attached",
        source: "Venue feed and oracle timestamps",
        can: "Read the risk of a supported asset",
        cannot: "No verdict is given where data is missing",
        approve: "Whether the risk is acceptable to you",
      },
    },
    "smarttrade-plan": {
      does: "Runs the same flow with nothing at stake, so the mistake is free.",
      never: "Never touches a venue, a balance or a wallet prompt.",
      evidence: {
        state: "Paper · no funds involved",
        source: "Your own plan, limits and invalidation",
        can: "Write and test a structured plan",
        cannot: "A paper plan cannot become an order",
        approve: "Nothing — there is nothing to sign",
      },
    },
    "decision-journal": {
      does: "Records why you acted, so the next decision starts from evidence.",
      never: "Never edits or deletes an entry after it is written.",
      evidence: {
        state: "Paper · append-only",
        source: "Your own decisions and their outcomes",
        can: "Write an entry and read it back",
        cannot: "A written entry cannot be rewritten",
        approve: "What goes into the record",
      },
    },
  },
};

const capsUk: RavenCapsCopy = {
  eyebrow: "ЩО МОЖНА ЗАРАЗ",
  title: "Почни з того, що вже працює.",
  lead: "Чотири спроможності доступні сьогодні. Усе інше на цій сторінці має позначку ще до кліку — розгорни рядок, щоб побачити докази за нею.",
  note: "Обсяг росте, коли спроможності виходять. Кожен рядок сам каже свою зрілість.",
  drawerOpen: "Докази",
  drawerClose: "Докази",
  keys: {
    maturity: "ЗРІЛІСТЬ",
    state: "СТАН ДАНИХ",
    source: "ДЖЕРЕЛО",
    can: "ДОСТУПНА ДІЯ",
    cannot: "НЕДОСТУПНА ДІЯ",
    approve: "ТИ СХВАЛЮЄШ",
  },
  rows: {
    "arcus-spot-rfq": {
      does: "Готує підтриманий маршрут USDG і показує вартість до підпису.",
      never: "Ніколи не надсилає, не підписує й не делегує щось за тебе.",
      evidence: {
        state: "Live · підтверджено майданчиком",
        source: "Дані маршрутів Arcus",
        can: "Підготувати USDG ↔ TSLA, AAPL або AMD",
        cannot: "Непідтримані пари підготувати неможливо",
        approve: "Транзакцію — у своєму гаманці",
      },
    },
    "rwa-risk-pack": {
      does: "Читає години ринку, ліквідність, свіжість оракула та ціну проти оракула.",
      never: "Ніколи не перетворює невідоме на бал, щоб воно виглядало вирішеним.",
      evidence: {
        state: "Live · зі свіжістю поруч",
        source: "Стрічка майданчика й мітки часу оракула",
        can: "Прочитати ризик підтриманого активу",
        cannot: "Без даних вердикт не видається",
        approve: "Чи прийнятний цей ризик для тебе",
      },
    },
    "smarttrade-plan": {
      does: "Проганяє той самий сценарій без ставки — помилка нічого не коштує.",
      never: "Ніколи не торкається майданчика, балансу чи запиту гаманця.",
      evidence: {
        state: "Paper · без коштів",
        source: "Твій власний план, ліміти й інвалідація",
        can: "Написати й перевірити структурований план",
        cannot: "Паперовий план не стає ордером",
        approve: "Нічого — підписувати нічого",
      },
    },
    "decision-journal": {
      does: "Фіксує, чому ти діяв, щоб наступне рішення починалося з доказів.",
      never: "Ніколи не редагує й не видаляє запис після того, як його зроблено.",
      evidence: {
        state: "Paper · тільки дозапис",
        source: "Твої власні рішення та їхні результати",
        can: "Зробити запис і перечитати його",
        cannot: "Зроблений запис не переписати",
        approve: "Що саме потрапляє в запис",
      },
    },
  },
};

const capsRu: RavenCapsCopy = {
  eyebrow: "ЧТО МОЖНО СЕЙЧАС",
  title: "Начни с того, что уже работает.",
  lead: "Четыре возможности доступны сегодня. Всё остальное на этой странице помечено ещё до клика — разверни строку, чтобы увидеть доказательства за пометкой.",
  note: "Объём растёт, когда возможности выходят. Каждая строка сама говорит свою зрелость.",
  drawerOpen: "Доказательства",
  drawerClose: "Доказательства",
  keys: {
    maturity: "ЗРЕЛОСТЬ",
    state: "СОСТОЯНИЕ ДАННЫХ",
    source: "ИСТОЧНИК",
    can: "ДОСТУПНОЕ ДЕЙСТВИЕ",
    cannot: "НЕДОСТУПНОЕ ДЕЙСТВИЕ",
    approve: "ТЫ ОДОБРЯЕШЬ",
  },
  rows: {
    "arcus-spot-rfq": {
      does: "Готовит поддерживаемый маршрут USDG и показывает стоимость до подписи.",
      never: "Никогда не отправляет, не подписывает и не делегирует что-либо за тебя.",
      evidence: {
        state: "Live · подтверждено площадкой",
        source: "Данные маршрутов Arcus",
        can: "Подготовить USDG ↔ TSLA, AAPL или AMD",
        cannot: "Неподдерживаемые пары подготовить нельзя",
        approve: "Транзакцию — в своём кошельке",
      },
    },
    "rwa-risk-pack": {
      does: "Читает часы рынка, ликвидность, свежесть оракула и цену против оракула.",
      never: "Никогда не превращает неизвестное в балл, чтобы оно выглядело решённым.",
      evidence: {
        state: "Live · со свежестью рядом",
        source: "Лента площадки и метки времени оракула",
        can: "Прочитать риск поддерживаемого актива",
        cannot: "Без данных вердикт не выдаётся",
        approve: "Приемлем ли этот риск для тебя",
      },
    },
    "smarttrade-plan": {
      does: "Прогоняет тот же сценарий без ставки — ошибка ничего не стоит.",
      never: "Никогда не касается площадки, баланса или запроса кошелька.",
      evidence: {
        state: "Paper · без средств",
        source: "Твой собственный план, лимиты и инвалидация",
        can: "Написать и проверить структурированный план",
        cannot: "Бумажный план не становится ордером",
        approve: "Ничего — подписывать нечего",
      },
    },
    "decision-journal": {
      does: "Фиксирует, почему ты действовал, чтобы следующее решение начиналось с доказательств.",
      never: "Никогда не редактирует и не удаляет запись после того, как она сделана.",
      evidence: {
        state: "Paper · только дозапись",
        source: "Твои собственные решения и их результаты",
        can: "Сделать запись и перечитать её",
        cannot: "Сделанную запись не переписать",
        approve: "Что именно попадает в запись",
      },
    },
  },
};

const CAPS_TABLE: Record<RavenLang, RavenCapsCopy> = { en: capsEn, uk: capsUk, ru: capsRu };

export function ravenCapsCopy(lang: string): RavenCapsCopy {
  return CAPS_TABLE[lang as RavenLang] ?? capsEn;
}
