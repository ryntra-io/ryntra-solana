import type { BetaLang } from "@/lib/beta/types";
import type { HomeConnectionNetwork, HomeReadScope } from "@/lib/home/connections";
import type {
  InvestorContextDraft,
} from "@/lib/home/investor-context";

type ContextOptionField = Exclude<
  keyof InvestorContextDraft,
  "goals" | "excludedActivities" | "notes"
>;

export type ConnectionCenterCopy = Readonly<{
  title: string;
  subtitle: string;
  localOnly: string;
  planes: Readonly<{
    identity: Readonly<{ title: string; body: string }>;
    data: Readonly<{ title: string; body: string }>;
    authority: Readonly<{ title: string; body: string }>;
  }>;
  wallets: Readonly<{
    title: string;
    body: string;
    session: string;
    telegramSession: string;
    walletSession: string;
    telegramVerified: string;
    telegramUnverified: string;
    identityWallet: string;
    noIdentityWallet: string;
    linkWallet: string;
    provedNow: string;
    legacyWatch: string;
    legacyBody: string;
    importLegacy: string;
    imported: string;
  }>;
  venues: Readonly<{
    title: string;
    body: string;
    lockedTitle: string;
    lockedBody: string;
    provider: string;
    credentialScope: string;
    authority: string;
  }>;
  watch: Readonly<{
    title: string;
    body: string;
    addTitle: string;
    label: string;
    labelPlaceholder: string;
    network: string;
    address: string;
    scopes: string;
    add: string;
    empty: string;
    active: string;
    revoked: string;
    remove: string;
    removed: string;
    history: string;
    ownership: string;
    authority: string;
    storage: string;
    networkLabels: Readonly<Record<HomeConnectionNetwork, string>>;
    scopeLabels: Readonly<Record<HomeReadScope, string>>;
    errors: Readonly<Record<string, string>>;
  }>;
  twin: Readonly<{
    title: string;
    body: string;
    statusMissing: string;
    statusPartial: string;
    statusComplete: string;
    version: string;
    missing: string;
    noMissing: string;
    declaredBy: string;
    formTitle: string;
    fields: Readonly<Record<ContextOptionField | "goals" | "excludedActivities" | "notes", string>>;
    options: Readonly<Record<string, string>>;
    save: string;
    saved: string;
    unchanged: string;
    invalid: string;
    limit: string;
    saveUnavailable: string;
    history: string;
    noHistory: string;
    disclaimer: string;
  }>;
  storage: Readonly<{
    loading: string;
    degradedTitle: string;
    degradedBody: string;
    unavailableTitle: string;
    unavailableBody: string;
    reset: string;
    resetDone: string;
  }>;
  summary: Readonly<{
    title: string;
    body: string;
    identity: string;
    data: string;
    context: string;
    authority: string;
    missing: string;
    open: string;
    signedOut: string;
    unavailable: string;
  }>;
}>;

const MACHINE_OPTIONS = {
  USD: "USD",
  EUR: "EUR",
  GBP: "GBP",
  UAH: "UAH",
  OTHER: "Other",
  UNDECLARED: "Undeclared",
  UNDER_1_YEAR: "Under 1 year",
  ONE_TO_THREE_YEARS: "1–3 years",
  THREE_TO_SEVEN_YEARS: "3–7 years",
  SEVEN_PLUS_YEARS: "7+ years",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CAPITAL_PRESERVATION: "Capital preservation",
  INCOME: "Income",
  GROWTH: "Growth",
  TRADING_DISCIPLINE: "Trading discipline",
  LEVERAGE: "Leverage",
  PERPETUALS: "Perpetuals",
  ILLIQUID_ASSETS: "Illiquid assets",
  AUTOMATED_EXECUTION: "Automated execution",
} as const;

export const CONNECTION_CENTER_COPY: Record<BetaLang, ConnectionCenterCopy> = {
  en: {
    title: "Connection Center",
    subtitle: "One place to see how you entered Ryntra, what data it may read, which provider credentials exist, and why none of that authorizes an action.",
    localOnly: "Read connections and Financial Twin versions are stored in this browser for this account. They do not sync to another device.",
    planes: {
      identity: { title: "Identity", body: "The signed account/session. SIWE proves one wallet only when that wallet minted this session." },
      data: { title: "Read-only data", body: "Public addresses and declared scopes Ryntra may read. Watch-only never proves ownership." },
      authority: { title: "Exact action authority", body: "Not granted here. It starts with one reviewed ActionCase and stays in Agent Control." },
    },
    wallets: {
      title: "Wallets & session",
      body: "Account identity and addresses selected for observation are different records.",
      session: "Session subject",
      telegramSession: "Telegram account session",
      walletSession: "SIWE wallet session",
      telegramVerified: "Telegram access verified",
      telegramUnverified: "Telegram access not verified",
      identityWallet: "SIWE-proven identity wallet",
      noIdentityWallet: "No wallet is proved by this session.",
      linkWallet: "Link a wallet with SIWE",
      provedNow: "Wallet proved in this session",
      legacyWatch: "Legacy watch address",
      legacyBody: "Compatibility data for existing account views. It is not identity and is not automatically imported.",
      importLegacy: "Import as watch-only",
      imported: "Legacy address imported as an explicit read connection.",
    },
    venues: {
      title: "Venues",
      body: "Provider credentials keep their own scope, storage and revoke path.",
      lockedTitle: "Arcus credential controls are locked",
      lockedBody: "This account can use local read connections and the Financial Twin. Creating or revoking an Arcus trade key still requires the existing verified-session server gate.",
      provider: "Arcus",
      credentialScope: "Browser-held trade-key credential · supported requests only",
      authority: "A credential does not authorize an order. Exact review and wallet authorization remain separate.",
    },
    watch: {
      title: "Watch-only",
      body: "Add public addresses to a declared read scope. Ryntra does not infer who owns them.",
      addTitle: "Add a read connection",
      label: "Label",
      labelPlaceholder: "Treasury watch",
      network: "Address family",
      address: "Public address",
      scopes: "Read scopes",
      add: "Add watch-only connection",
      empty: "No browser-local read connections yet.",
      active: "Active read record",
      revoked: "Revoked record",
      remove: "Revoke local read connection",
      removed: "Read connection revoked. Its history remains visible.",
      history: "Revoked history",
      ownership: "Ownership",
      authority: "Action authority",
      storage: "Storage",
      networkLabels: { EVM: "EVM address", SOLANA: "Solana address", STELLAR: "Stellar account" },
      scopeLabels: { BALANCES: "Balances", POSITIONS: "Positions", ACTIVITY: "Activity", ASSET_EVIDENCE: "Asset evidence" },
      errors: {
        INVALID_DRAFT: "Check the address, label and at least one read scope.",
        DUPLICATE_ACTIVE_CONNECTION: "That address family and address already have an active read connection.",
        CONNECTION_LIMIT_REACHED: "This browser has reached the 25-record history limit. Export is not part of this packet; keep the existing history or reset local Home data.",
        CONNECTION_NOT_FOUND: "That connection no longer exists. Reload and try again.",
        ALREADY_REVOKED: "That connection is already revoked.",
      },
    },
    twin: {
      title: "Financial Twin",
      body: "A versioned record of what you declare about your goals, horizon, liquidity and limits. It is context for later planning, not a personality or eligibility score.",
      statusMissing: "No InvestorContext yet",
      statusPartial: "Partial declarations",
      statusComplete: "Declared context complete",
      version: "Active version",
      missing: "Still undeclared",
      noMissing: "No required declaration is missing.",
      declaredBy: "User-declared",
      formTitle: "Create the next version",
      fields: { displayCurrency: "Display currency", horizon: "Horizon", liquidityNeed: "Liquidity need", lossCapacity: "Loss-bearing capacity", riskTolerance: "Risk tolerance", goals: "Goals", excludedActivities: "Explicit exclusions", notes: "Notes" },
      options: MACHINE_OPTIONS,
      save: "Save new version",
      saved: "A new immutable InvestorContext version was saved in this browser.",
      unchanged: "Nothing material changed, so no duplicate version was created.",
      invalid: "One or more declarations are invalid or too long.",
      limit: "The 50-version browser history limit is reached.",
      saveUnavailable: "Browser storage refused the new version. Nothing was saved.",
      history: "Version history",
      noHistory: "No versions saved yet.",
      disclaimer: "Ryntra records your declarations. It does not decide legal status, eligibility, suitability or what you should buy or sell.",
    },
    storage: {
      loading: "Reading this account's browser-local Home state…",
      degradedTitle: "Local Home data could not be trusted",
      degradedBody: "The stored envelope is corrupt, belongs to another account or uses an unsupported future version. Nothing was imported.",
      unavailableTitle: "Browser storage is unavailable",
      unavailableBody: "Connections and InvestorContext versions cannot be saved in this browser. No success is claimed.",
      reset: "Reset local Home data",
      resetDone: "Local Home data reset for this account.",
    },
    summary: {
      title: "Financial Twin",
      body: "Identity, read connections and declared context — with action authority kept separate.",
      identity: "Identity",
      data: "Read connections",
      context: "InvestorContext",
      authority: "Authority",
      missing: "not declared",
      open: "Open Connection Center",
      signedOut: "Sign in to create an account-bound Financial Twin.",
      unavailable: "Browser-local Financial Twin data is unavailable or could not be trusted.",
    },
  },
  uk: {
    title: "Центр підключень",
    subtitle: "Одне місце, де видно, як ви увійшли в Ryntra, які дані дозволили читати, які provider credentials існують і чому жодне з цього не авторизує дію.",
    localOnly: "Read connections і версії Financial Twin зберігаються в цьому браузері для цього акаунта. На інший пристрій вони не синхронізуються.",
    planes: {
      identity: { title: "Ідентичність", body: "Підписаний account/session. SIWE доводить один wallet лише тоді, коли саме він створив цю сесію." },
      data: { title: "Read-only дані", body: "Публічні адреси й оголошені scopes, які Ryntra може читати. Watch-only ніколи не доводить володіння." },
      authority: { title: "Точна авторизація дії", body: "Тут не надається. Вона починається з одного переглянутого ActionCase і залишається в Agent Control." },
    },
    wallets: {
      title: "Wallets і сесія",
      body: "Ідентичність акаунта та адреси для спостереження — різні записи.",
      session: "Subject сесії",
      telegramSession: "Сесія Telegram-акаунта",
      walletSession: "SIWE wallet session",
      telegramVerified: "Telegram access verified",
      telegramUnverified: "Telegram access not verified",
      identityWallet: "Identity wallet, доведений SIWE",
      noIdentityWallet: "Ця сесія не доводить жодного wallet.",
      linkWallet: "Прив'язати wallet через SIWE",
      provedNow: "Wallet доведено в цій сесії",
      legacyWatch: "Legacy watch address",
      legacyBody: "Compatibility data для чинних account views. Це не identity і адреса не імпортується автоматично.",
      importLegacy: "Імпортувати як watch-only",
      imported: "Legacy address імпортовано як явне read connection.",
    },
    venues: {
      title: "Venues",
      body: "Provider credentials мають власний scope, storage і revoke path.",
      lockedTitle: "Arcus credential controls заблоковані",
      lockedBody: "Цей акаунт може використовувати локальні read connections і Financial Twin. Створення або revoke Arcus trade key все ще потребує чинного verified-session server gate.",
      provider: "Arcus",
      credentialScope: "Trade-key credential у браузері · лише підтримані requests",
      authority: "Credential не авторизує ордер. Exact review і wallet authorization залишаються окремими.",
    },
    watch: {
      title: "Watch-only",
      body: "Додайте публічні адреси до оголошеного read scope. Ryntra не виводить, хто ними володіє.",
      addTitle: "Додати read connection",
      label: "Назва",
      labelPlaceholder: "Treasury watch",
      network: "Тип адреси",
      address: "Публічна адреса",
      scopes: "Read scopes",
      add: "Додати watch-only connection",
      empty: "Локальних read connections у цьому браузері ще немає.",
      active: "Активний read record",
      revoked: "Відкликаний record",
      remove: "Відкликати локальне read connection",
      removed: "Read connection відкликано. Історія лишилася видимою.",
      history: "Історія revoke",
      ownership: "Володіння",
      authority: "Action authority",
      storage: "Storage",
      networkLabels: { EVM: "EVM address", SOLANA: "Solana address", STELLAR: "Stellar account" },
      scopeLabels: { BALANCES: "Баланси", POSITIONS: "Позиції", ACTIVITY: "Активність", ASSET_EVIDENCE: "Asset evidence" },
      errors: {
        INVALID_DRAFT: "Перевірте адресу, назву й хоча б один read scope.",
        DUPLICATE_ACTIVE_CONNECTION: "Для цього типу адреси й самої адреси вже є активне read connection.",
        CONNECTION_LIMIT_REACHED: "Досягнуто ліміту історії у 25 записів. Export не входить у цей packet; збережіть історію або reset local Home data.",
        CONNECTION_NOT_FOUND: "Connection більше не існує. Оновіть сторінку й повторіть.",
        ALREADY_REVOKED: "Connection уже відкликано.",
      },
    },
    twin: {
      title: "Financial Twin",
      body: "Versioned record ваших декларацій про цілі, горизонт, ліквідність і межі. Це контекст для майбутнього планування, не personality чи eligibility score.",
      statusMissing: "InvestorContext ще немає",
      statusPartial: "Часткові декларації",
      statusComplete: "Declared context complete",
      version: "Активна версія",
      missing: "Ще не оголошено",
      noMissing: "Усі обов'язкові декларації заповнено.",
      declaredBy: "User-declared",
      formTitle: "Створити наступну версію",
      fields: { displayCurrency: "Display currency", horizon: "Горизонт", liquidityNeed: "Потреба в ліквідності", lossCapacity: "Loss-bearing capacity", riskTolerance: "Risk tolerance", goals: "Цілі", excludedActivities: "Явні виключення", notes: "Нотатки" },
      options: { ...MACHINE_OPTIONS, OTHER: "Інша", UNDECLARED: "Не оголошено", UNDER_1_YEAR: "До 1 року", ONE_TO_THREE_YEARS: "1–3 роки", THREE_TO_SEVEN_YEARS: "3–7 років", SEVEN_PLUS_YEARS: "7+ років", LOW: "Низька", MEDIUM: "Середня", HIGH: "Висока", CAPITAL_PRESERVATION: "Збереження капіталу", INCOME: "Дохід", GROWTH: "Зростання", TRADING_DISCIPLINE: "Торгова дисципліна", LEVERAGE: "Leverage", PERPETUALS: "Perpetuals", ILLIQUID_ASSETS: "Неліквідні активи", AUTOMATED_EXECUTION: "Автоматичне виконання" },
      save: "Зберегти нову версію",
      saved: "Нову immutable версію InvestorContext збережено в цьому браузері.",
      unchanged: "Нічого material не змінилося, тому duplicate version не створено.",
      invalid: "Одна або кілька декларацій невалідні чи задовгі.",
      limit: "Досягнуто browser limit у 50 версій.",
      saveUnavailable: "Browser storage відмовив новій версії. Нічого не збережено.",
      history: "Історія версій",
      noHistory: "Збережених версій ще немає.",
      disclaimer: "Ryntra записує ваші декларації. Вона не вирішує legal status, eligibility, suitability або що вам купувати чи продавати.",
    },
    storage: {
      loading: "Читаю локальний Home state цього акаунта…",
      degradedTitle: "Локальним Home data не можна довіряти",
      degradedBody: "Stored envelope пошкоджений, належить іншому акаунту або має непідтриману future version. Нічого не імпортовано.",
      unavailableTitle: "Browser storage недоступний",
      unavailableBody: "Connections і версії InvestorContext не можна зберегти в цьому браузері. Success не заявляється.",
      reset: "Reset local Home data",
      resetDone: "Локальний Home state цього акаунта скинуто.",
    },
    summary: {
      title: "Financial Twin",
      body: "Identity, read connections і declared context — action authority лишається окремо.",
      identity: "Identity",
      data: "Read connections",
      context: "InvestorContext",
      authority: "Authority",
      missing: "не оголошено",
      open: "Відкрити Центр підключень",
      signedOut: "Увійдіть, щоб створити прив'язаний до акаунта Financial Twin.",
      unavailable: "Локальний Financial Twin недоступний або його data не пройшли перевірку.",
    },
  },
  ru: {
    title: "Центр подключений",
    subtitle: "Одно место, где видно, как вы вошли в Ryntra, какие данные разрешили читать, какие provider credentials существуют и почему ничто из этого не авторизует действие.",
    localOnly: "Read connections и версии Financial Twin хранятся в этом браузере для этого аккаунта. На другое устройство они не синхронизируются.",
    planes: {
      identity: { title: "Идентичность", body: "Подписанный account/session. SIWE доказывает один wallet только когда он создал эту сессию." },
      data: { title: "Read-only данные", body: "Публичные адреса и объявленные scopes, которые Ryntra может читать. Watch-only никогда не доказывает владение." },
      authority: { title: "Точная авторизация действия", body: "Здесь не предоставляется. Она начинается с одного просмотренного ActionCase и остаётся в Agent Control." },
    },
    wallets: {
      title: "Wallets и сессия", body: "Идентичность аккаунта и адреса для наблюдения — разные записи.", session: "Subject сессии", telegramSession: "Сессия Telegram-аккаунта", walletSession: "SIWE wallet session", telegramVerified: "Telegram access verified", telegramUnverified: "Telegram access not verified", identityWallet: "Identity wallet, доказанный SIWE", noIdentityWallet: "Эта сессия не доказывает ни одного wallet.", linkWallet: "Привязать wallet через SIWE", provedNow: "Wallet доказан в этой сессии", legacyWatch: "Legacy watch address", legacyBody: "Compatibility data для текущих account views. Это не identity и адрес не импортируется автоматически.", importLegacy: "Импортировать как watch-only", imported: "Legacy address импортирован как явное read connection."
    },
    venues: {
      title: "Venues", body: "Provider credentials имеют собственный scope, storage и revoke path.", lockedTitle: "Arcus credential controls заблокированы", lockedBody: "Этот аккаунт может использовать локальные read connections и Financial Twin. Создание или revoke Arcus trade key всё ещё требует текущего verified-session server gate.", provider: "Arcus", credentialScope: "Trade-key credential в браузере · только поддержанные requests", authority: "Credential не авторизует ордер. Exact review и wallet authorization остаются отдельными."
    },
    watch: {
      title: "Watch-only", body: "Добавьте публичные адреса в объявленный read scope. Ryntra не выводит, кто ими владеет.", addTitle: "Добавить read connection", label: "Название", labelPlaceholder: "Treasury watch", network: "Тип адреса", address: "Публичный адрес", scopes: "Read scopes", add: "Добавить watch-only connection", empty: "Локальных read connections в этом браузере ещё нет.", active: "Активный read record", revoked: "Отозванный record", remove: "Отозвать локальное read connection", removed: "Read connection отозван. История осталась видимой.", history: "История revoke", ownership: "Владение", authority: "Action authority", storage: "Storage",
      networkLabels: { EVM: "EVM address", SOLANA: "Solana address", STELLAR: "Stellar account" },
      scopeLabels: { BALANCES: "Балансы", POSITIONS: "Позиции", ACTIVITY: "Активность", ASSET_EVIDENCE: "Asset evidence" },
      errors: { INVALID_DRAFT: "Проверьте адрес, название и хотя бы один read scope.", DUPLICATE_ACTIVE_CONNECTION: "Для этого типа адреса и самого адреса уже есть активное read connection.", CONNECTION_LIMIT_REACHED: "Достигнут лимит истории в 25 записей. Export не входит в этот packet; сохраните историю или reset local Home data.", CONNECTION_NOT_FOUND: "Connection больше не существует. Обновите страницу и повторите.", ALREADY_REVOKED: "Connection уже отозвано." }
    },
    twin: {
      title: "Financial Twin", body: "Versioned record ваших деклараций о целях, горизонте, ликвидности и пределах. Это контекст для будущего планирования, не personality или eligibility score.", statusMissing: "InvestorContext ещё нет", statusPartial: "Частичные декларации", statusComplete: "Declared context complete", version: "Активная версия", missing: "Ещё не объявлено", noMissing: "Все обязательные декларации заполнены.", declaredBy: "User-declared", formTitle: "Создать следующую версию",
      fields: { displayCurrency: "Display currency", horizon: "Горизонт", liquidityNeed: "Потребность в ликвидности", lossCapacity: "Loss-bearing capacity", riskTolerance: "Risk tolerance", goals: "Цели", excludedActivities: "Явные исключения", notes: "Заметки" },
      options: { ...MACHINE_OPTIONS, OTHER: "Другая", UNDECLARED: "Не объявлено", UNDER_1_YEAR: "До 1 года", ONE_TO_THREE_YEARS: "1–3 года", THREE_TO_SEVEN_YEARS: "3–7 лет", SEVEN_PLUS_YEARS: "7+ лет", LOW: "Низкая", MEDIUM: "Средняя", HIGH: "Высокая", CAPITAL_PRESERVATION: "Сохранение капитала", INCOME: "Доход", GROWTH: "Рост", TRADING_DISCIPLINE: "Торговая дисциплина", LEVERAGE: "Leverage", PERPETUALS: "Perpetuals", ILLIQUID_ASSETS: "Неликвидные активы", AUTOMATED_EXECUTION: "Автоматическое исполнение" },
      save: "Сохранить новую версию", saved: "Новая immutable версия InvestorContext сохранена в этом браузере.", unchanged: "Ничего material не изменилось, поэтому duplicate version не создана.", invalid: "Одна или несколько деклараций невалидны или слишком длинные.", limit: "Достигнут browser limit в 50 версий.", saveUnavailable: "Browser storage отказал новой версии. Ничего не сохранено.", history: "История версий", noHistory: "Сохранённых версий ещё нет.", disclaimer: "Ryntra записывает ваши декларации. Она не решает legal status, eligibility, suitability или что вам покупать либо продавать."
    },
    storage: { loading: "Читаю локальный Home state этого аккаунта…", degradedTitle: "Локальным Home data нельзя доверять", degradedBody: "Stored envelope повреждён, принадлежит другому аккаунту или имеет неподдержанную future version. Ничего не импортировано.", unavailableTitle: "Browser storage недоступен", unavailableBody: "Connections и версии InvestorContext нельзя сохранить в этом браузере. Success не заявляется.", reset: "Reset local Home data", resetDone: "Локальный Home state этого аккаунта сброшен." },
    summary: { title: "Financial Twin", body: "Identity, read connections и declared context — action authority остаётся отдельно.", identity: "Identity", data: "Read connections", context: "InvestorContext", authority: "Authority", missing: "не объявлено", open: "Открыть Центр подключений", signedOut: "Войдите, чтобы создать привязанный к аккаунту Financial Twin.", unavailable: "Локальный Financial Twin недоступен или его data не прошли проверку." },
  },
};
