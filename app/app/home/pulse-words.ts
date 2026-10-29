import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Pulse on Home, in both languages: short, a number where there is one, the
 * source named beside the data it gave.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const PULSE_WORDS = {
  title: bi("Pulse", "Пульс"),
  lead: bi("New Solana tokens, curves close to the DEX and the market's moves — live.", "Нові токени Solana, криві біля DEX і рухи ринку — наживо."),
  feeds: bi("Feeds", "Стрічки"),
  feedNew: bi("New", "Нові"),
  feedSoon: bi("Almost on DEX", "Майже на DEX"),
  feedDex: bi("On DEX", "Вийшли на DEX"),
  feedTrending: bi("Trending", "Тренди"),
  noteNew: bi("Tokens whose first pool is under an hour old — the newest on top.", "Токени з першим пулом молодшим за годину — найновіші зверху."),
  noteSoon: bi("Curves at least 25% of the way to the DEX, the closest on top; Ryntra's markets on a curve first, at any point. The way is read from each curve's own account.", "Криві від 25 % шляху до DEX — найближчі зверху; ринки Ryntra на кривій — першими, на будь-якому етапі. Шлях — з рахунку самої кривої в мережі."),
  noteDex: bi("Left their curve for a DEX in the last 24 hours — the latest on top.", "Вийшли з кривої на DEX за останню добу — найсвіжіші зверху."),
  noteTrending: bi("Jupiter's trending order for the window.", "Порядок трендів Jupiter за вікно."),
  window: bi("Window", "Вікно"),
  m5: bi("5m", "5 хв"),
  h1: bi("1h", "1 год"),
  h6: bi("6h", "6 год"),
  h24: bi("24h", "24 год"),
  filters: bi("Filters", "Фільтри"),
  filtersReset: bi("Reset", "Скинути"),
  filtersResetAll: bi("Reset filters", "Скинути фільтри"),
  fMarketCap: bi("Market cap, $", "Капіталізація, $"),
  fLiquidity: bi("Liquidity, $", "Ліквідність, $"),
  fVolume: bi("Volume in the feed's window, $", "Обсяг за вікно стрічки, $"),
  fInvalid: bi("Not a number: this bound is not applied", "Не число: ця межа не діє"),
  fAge: bi("Age, hours", "Вік, год"),
  fHolders: bi("Holders", "Холдери"),
  fTop10: bi("Top 10 hold, %", "Топ-10 тримають, %"),
  fDev: bi("Creator holds, %", "Творець тримає, %"),
  fCreator: bi("Creator's history", "Історія творця"),
  fCreatorLaunches: bi("tokens, at most", "токенів, до"),
  fCreatorLaunchesLabel: bi("Tokens the creator made, at most", "Токенів, які створив творець, не більше"),
  fCreatorDex: bi("on a DEX, from", "на DEX, від"),
  fCreatorDexLabel: bi("Of the creator's tokens on a DEX, at least", "З токенів творця вийшли на DEX, не менше"),
  fNoNotices: bi("Only tokens with no risk flag, every figure read", "Лише токени без позначок ризику, усе прочитано"),
  from: bi("from", "від"),
  to: bi("to", "до"),
  atMost: bi("at most", "до"),
  colAsset: bi("Token", "Токен"),
  colAge: bi("Age", "Вік"),
  colMarketCap: bi("Mkt cap", "Капіт."),
  colVolume: bi("Volume", "Обсяг"),
  colLiquidity: bi("Liquidity", "Ліквідн."),
  colHolders: bi("Holders", "Холдери"),
  colTop10: bi("Top 10", "Топ-10"),
  colChange: bi("Change", "Зміна"),
  colPrice: bi("Price", "Ціна"),
  colRisk: bi("Risks", "Ризики"),
  colQuick: bi("Quick buy", "Швидка купівля"),
  quickBuyOf: bi("Review a buy of {symbol} for {sum}", "«Перевірка» купівлі {symbol} на {sum}"),
  quickHint: bi("A sum opens the token's Review; nothing is bought until your wallet signs.", "Сума відкриває «Перевірку» токена; нічого не купується, доки не підпише твій гаманець."),
  quickKeys: bi("Right arrow: quick sums", "Стрілка вправо — швидкі суми"),
  toDex: bi("to DEX", "до DEX"),
  curveFull: bi("curve full", "крива заповнена"),
  ryntra: bi("Ryntra", "Ryntra"),
  launchedOnRyntra: bi("Launched on Ryntra", "Запущено на Ryntra"),
  technical: bi("Ryntra test", "Тест Ryntra"),
  creator: bi("Creator", "Творець"),
  holdersShort: bi("holders", "холдерів"),
  noticeNone: bi("Minting and freezing are off, Jupiter does not flag it, and no figure is past its threshold.", "Випуск і заморожування вимкнено, Jupiter не позначає токен, і жоден показник не перетнув межу."),
  unstated: bi("Not stated: {list}", "Не вказано: {list}"),
  unstatedRIGHTS: bi("whether minting and freezing are off", "чи вимкнено випуск і заморожування"),
  unstatedHOLDERS: bi("holders", "холдери"),
  unstatedCREATOR: bi("the creator's tokens", "токени творця"),
  unstatedAGE: bi("age", "вік"),
  noticeCount: bi("Risks: {count}", "Ризиків: {count}"),
  noticeOf: bi("Risks of {symbol}", "Ризики {symbol}"),
  noticeChecked: bi("Facts from Jupiter and the chain. Not a verdict.", "Факти з Jupiter і мережі. Це не вирок."),
  MINT_AUTHORITY: bi("Minting new tokens is still on", "Випуск нових токенів не вимкнено"),
  FREEZE_AUTHORITY: bi("Freezing holders' tokens is still on", "Заморожування токенів холдерів не вимкнено"),
  FLAGGED: bi("Jupiter flags it as suspicious", "Jupiter позначив як підозрілий"),
  BORROWED_NAME: bi("A name tied to {label} — not verified by Jupiter", "Назва, пов'язана з {label}, — Jupiter не перевірив"),
  CREATOR_MANY: bi("The creator made {count} tokens", "Творець створив {count} токенів"),
  LIQUIDITY_THIN: bi("Liquidity under $1K", "Ліквідність менше $1K"),
  LIQUIDITY_UNSTATED: bi("Liquidity not stated", "Ліквідність не вказано"),
  HOLDERS_FEW: bi("Under 10 holders: {count}", "Менше 10 холдерів: {count}"),
  BRAND_NEW: bi("Under 10 minutes on the market: no history yet", "Менше 10 хвилин на ринку: історії ще немає"),
  borrowed: bi("Known name", "Відома назва"),
  twins: bi("{count} more with this name — check the address", "Ще {count} з такою назвою — звір адресу"),
  showMore: bi("Show more", "Показати ще"),
  shown: bi("{shown} of {total}", "{shown} з {total}"),
  updatedAt: bi("Updated {time}", "Оновлено {time}"),
  held: bi("Some figures are from an earlier read; the next read replaces them.", "Частина цифр — з попереднього читання; наступне читання їх замінить."),
  partial: bi("A source did not answer just now: the feed may lack some rows until the next read.", "Одне з джерел зараз не відповіло: до наступного читання в стрічці може бракувати рядків."),
  pending: bi("New figures — show", "Нові цифри — показати"),
  failedAuto: bi("It is read again on its own every 30 seconds.", "Її буде прочитано знову сама кожні 30 секунд."),
  failed: bi("The feed could not be read just now.", "Стрічку зараз не вдалося прочитати."),
  retry: bi("Try again", "Спробувати ще"),
  emptySoon: bi("No curve is 25% of the way to the DEX among the ones trading most right now.", "Зараз серед кривих, що торгуються найбільше, жодна не пройшла 25 % шляху до DEX."),
  emptyDex: bi("No token left its curve in the last 24 hours among the ones trading most.", "За добу серед токенів, що торгуються найбільше, жоден не вийшов на DEX."),
  emptyFeed: bi("Nothing in this feed right now.", "Зараз у цій стрічці нічого немає."),
  emptyFiltered: bi("No token passes the filters.", "Жоден токен не проходить фільтри."),
  sourceJupiter: bi("Data: Jupiter", "Дані: Jupiter"),
  sourceGecko: bi("Powered by GeckoTerminal", "Powered by GeckoTerminal"),
  sourceChain: bi("curve progress: on-chain", "шлях кривих — з мережі"),
  ago: bi("ago", "тому"),
} as const;

export type PulseWord = keyof typeof PULSE_WORDS;

export function pulseWords(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (key: PulseWord, vars?: Readonly<Record<string, string | number>>) => {
    let text: string = PULSE_WORDS[key][lang];
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
    return text;
  };
}

/** A token's age on the market in the shortest honest unit: «45 с», «12 хв», «3 год», «5 дн». */
export function ageText(hours: number | null, locale: WorkspaceLocale): string {
  if (hours === null) return "—";
  const uk = locale === "uk";
  const seconds = Math.max(0, Math.round(hours * 3600));
  if (seconds < 60) return uk ? `${seconds} с` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return uk ? `${minutes} хв` : `${minutes}m`;
  const whole = Math.floor(minutes / 60);
  if (whole < 48) return uk ? `${whole} год` : `${whole}h`;
  const days = Math.floor(whole / 24);
  if (days < 365) return uk ? `${days} дн` : `${days}d`;
  const years = Math.floor(days / 365);
  return uk ? `${years} р` : `${years}y`;
}

/** A change as wide as a row allows: two places under 100 %, one under 1 000 %, none above — the sign the page colours by. */
export function changeText(value: number | null, numbers: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 1_000 ? 0 : abs >= 100 ? 1 : 2;
  const rounded = Number(abs.toFixed(digits));
  /* No grouping: a narrow space in a mono figure reads as two numbers. */
  const text = new Intl.NumberFormat(numbers, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(rounded);
  const sign = "%";
  return rounded === 0 ? `${text}${sign}` : value > 0 ? `+${text}${sign}` : `−${text}${sign}`;
}

/** A share the way the app's figures write it — «24%», «12,4%» — the same as every change beside it. */
export function pctText(value: number, numbers: string, digits = 1): string {
  /* A share above zero too small for its places is said as under the smallest one, never rounded to «0%». */
  const smallest = 10 ** -digits;
  if (value > 0 && value < smallest) return `<${new Intl.NumberFormat(numbers, { maximumFractionDigits: digits }).format(smallest)}%`;
  return `${new Intl.NumberFormat(numbers, { maximumFractionDigits: digits, useGrouping: false }).format(value)}%`;
}

/**
 * A typed bound in the reader's own way of writing numbers: in English a comma groups thousands and a dot marks the
 * cents («10,000», «1.5»); in Ukrainian a space groups and a comma or a dot marks them («10 000», «0,5»); «k» and «m»
 * («к», «м») multiply. Empty is no bound; anything else is not a number.
 */
export function parseBound(text: string, locale: WorkspaceLocale): number | null | "invalid" {
  let cleaned = text.trim().toLowerCase().replace(/[\s  $%]/g, "");
  if (cleaned === "") return null;
  let scale = 1;
  const suffix = /(k|m|к|м)$/.exec(cleaned);
  if (suffix) {
    scale = suffix[1] === "k" || suffix[1] === "к" ? 1_000 : 1_000_000;
    cleaned = cleaned.slice(0, -1);
  }
  if (locale === "uk") {
    if (!/^\d+([.,]\d+)?$/.test(cleaned)) return "invalid";
    cleaned = cleaned.replace(",", ".");
  } else {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$|^\d+(\.\d+)?$/.test(cleaned)) return "invalid";
    cleaned = cleaned.replace(/,/g, "");
  }
  const value = Number(cleaned) * scale;
  return Number.isFinite(value) && value >= 0 ? value : "invalid";
}
