import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The words of «Події ринку» (DSC-1) in both languages: «подія», never «сигнал»; a fact and its source,
 * never «купуй», never «безпечно».
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const EVENTS_WORDS = {
  title: bi("Market events", "Події ринку"),
  homeTitle: bi("Market events", "Події ринку"),
  lead: bi("What happened on Solana's markets: each event with its source, its time and its transaction. Facts, not advice.", "Що сталося на ринках Solana: кожна подія — з джерелом, часом і транзакцією. Факти, не поради."),
  groups: bi("Kinds of event", "Види подій"),
  group_all: bi("All", "Усі"),
  group_new: bi("New tokens", "Нові токени"),
  group_dex: bi("To a DEX", "Вихід на DEX"),
  group_liquidity: bi("Liquidity", "Ліквідність"),
  group_rights: bi("Rights", "Права"),
  group_launch: bi("Launch", "Лаунч"),
  /* ---- the kinds */
  kind_TOKEN_CREATED: bi("New token", "Новий токен"),
  kind_DEX_LISTED: bi("Out to a DEX", "Вихід на DEX"),
  kind_ALPHA_VAULT: bi("Alpha Vault opened", "Відкрито Alpha Vault"),
  kind_LIQUIDITY_CHANGED: bi("Liquidity changed", "Зміна ліквідності"),
  kind_CONCENTRATION_CHANGED: bi("Concentration changed", "Зміна концентрації"),
  kind_AUTHORITY_OPEN: bi("Right still on", "Право не вимкнено"),
  kind_UNLOCK: bi("Creator's lock opens", "Розлок творця"),
  kind_CREATOR_SOLD: bi("Creator sold", "Продаж творця"),
  kind_QUOTE_CHANGED: bi("Quote token changed", "Зміна quote-токена"),
  kind_LAUNCH_LOG: bi("Launch event", "Подія Лаунчу"),
  /* ---- what each says */
  bornOn: bi("First pool on {venue}", "Перший пул на {venue}"),
  bornAt: bi("First pool created", "Створено перший пул"),
  launchedOnRyntra: bi("Launched on Ryntra", "Запущено на Ryntra"),
  routeFrom: bi("Left the {from} curve", "Вийшов із кривої {from}"),
  routeFull: bi("{from} → {to}", "{from} → {to}"),
  routeUnknown: bi("Left its launch curve", "Вийшов зі своєї кривої"),
  actor_ryntra: bi("sent by Ryntra", "вихід запустила Ryntra"),
  actor_meteora: bi("sent by Meteora", "вихід запустила Meteora"),
  actor_other: bi("sent by another wallet", "вихід запустив інший гаманець"),
  actor_creator: bi("sent by the creator", "вихід запустив творець"),
  liquidityHour: bi("{change} over the hour · pool {pool}", "{change} за годину · пул {pool}"),
  liquidityHourShort: bi("{change} over the hour", "{change} за годину"),
  authority_MINT: bi("Minting new tokens is still on", "Випуск нових токенів не вимкнено"),
  authority_FREEZE: bi("Freezing holders' tokens is still on", "Заморожування токенів холдерів не вимкнено"),
  unlock_cliff: bi("The first locked tokens are free to claim", "Перші заблоковані токени можна забрати"),
  unlock_end: bi("The lock has ended: every token is free", "Замок завершився: усі токени вільні"),
  soldBought: bi("{pct} of what they bought by then", "{pct} купленого на той момент"),
  soldSupply: bi("{pct} of the supply by then", "{pct} пропозиції на той момент"),
  amountFor: bi("for {amount}", "за {amount}"),
  vaultNote: bi("Early access on Meteora: buyers deposit before the pool opens", "Ранній доступ Meteora: покупці вносять до відкриття пулу"),
  /* ---- the facts of each card */
  happened: bi("Happened", "Сталося"),
  happenedUnknown: bi("Happened: no source states when", "Сталося: жодне джерело не каже коли"),
  happenedUnread: bi("Happened: the transaction's time is not read yet", "Сталося: час транзакції ще не прочитано"),
  happenedHour: bi("Happened: within the hour", "Сталося: протягом години"),
  scheduled: bi("At", "Настало"),
  seen: bi("seen {ago}", "побачено {ago}"),
  seenTitle: bi("When Ryntra first saw it", "Коли Ryntra побачила це вперше"),
  ago: bi("{time} ago", "{time} тому"),
  now: bi("just now", "щойно"),
  source_jupiter: bi("Jupiter", "Jupiter"),
  source_chain: bi("Solana chain", "Мережа Solana"),
  source_launch: bi("Ryntra Launch", "Лаунч Ryntra"),
  sourcesLabel: bi("Sources", "Джерела"),
  finality_confirmed: bi("Confirmed on chain", "Підтверджено мережею"),
  finality_reported: bi("Not read on chain", "У мережі не перечитано"),
  finality_scheduled: bi("Set in the lock's account", "Записано в рахунку замка"),
  staleMark: bi("held from an earlier read", "з попереднього читання"),
  openTx: bi("Transaction", "Транзакція"),
  openAccount: bi("Account", "Рахунок"),
  openToken: bi("Token page", "Сторінка токена"),
  explorerOf: bi("{what} of the event on the explorer: {symbol}", "{what} події в експлорері: {symbol}"),
  devnet: bi("devnet", "devnet"),
  /* ---- risk */
  flags: bi("Risk flags: {count}", "Позначки ризику: {count}"),
  flagsNone: bi("No Pulse risk flag", "Позначок ризику Пульсу немає"),
  flagsUnread: bi("Some figures not stated", "Частину показників не вказано"),
  flag_MINT_AUTHORITY: bi("Minting is still on", "Випуск не вимкнено"),
  flag_FREEZE_AUTHORITY: bi("Freezing is still on", "Заморожування не вимкнено"),
  flag_FLAGGED: bi("Jupiter flags it as suspicious", "Jupiter позначив як підозрілий"),
  flag_BORROWED_NAME: bi("A name tied to {label} — not verified by Jupiter", "Назва, пов'язана з {label}, — Jupiter не перевірив"),
  flag_CREATOR_MANY: bi("The creator made 10 tokens or more", "Творець створив 10 токенів або більше"),
  flag_LIQUIDITY_THIN: bi("Liquidity under $1K or not stated", "Ліквідність менше $1K або не вказана"),
  flag_HOLDERS_FEW: bi("Under 10 holders", "Менше 10 холдерів"),
  flag_BRAND_NEW: bi("Under 10 minutes on the market", "Менше 10 хвилин на ринку"),
  unstated: bi("Not stated: {list}", "Не вказано: {list}"),
  unstated_RIGHTS: bi("whether minting and freezing are off", "чи вимкнено випуск і заморожування"),
  unstated_HOLDERS: bi("holders", "холдери"),
  unstated_CREATOR: bi("the creator's tokens", "токени творця"),
  unstated_AGE: bi("age", "вік"),
  suspiciousTitle: bi("Held below the top", "Не вгорі стрічки"),
  suspicious_FLAGGED: bi("Jupiter flags this token as suspicious.", "Jupiter позначив цей токен як підозрілий."),
  suspicious_BORROWED_NAME: bi("Its name borrows {label}, and Jupiter has not verified it.", "Його назва позичає {label}, і Jupiter його не перевірив."),
  suspicious_NAME_COPY: bi("Another token in this feed has the same ticker and name — check the address.", "Інший токен у цій стрічці має той самий тікер і назву — звір адресу."),
  /* ---- the feed */
  updatedAt: bi("Updated {time}", "Оновлено {time}"),
  held: bi("Some figures are from an earlier read; the next read replaces them.", "Частина цифр — з попереднього читання; наступне читання їх замінить."),
  partial: bi("A source did not answer in full: some events may be missing.", "Джерело відповіло не повністю: частини подій може не бути."),
  failed: bi("The events could not be read now.", "Події зараз не прочиталися."),
  failedAuto: bi("We will try again on our own.", "Спробуємо ще раз самі."),
  retry: bi("Try again", "Спробувати ще"),
  empty: bi("No event of this kind in the last read.", "Подій цього виду в останньому читанні немає."),
  emptyLaunch: bi("No launch event yet: the first ones come with the first launches by people.", "Подій Лаунчу ще немає: перші з'являться з першими лаунчами людей."),
  pending: bi("New events — show", "Нові події — показати"),
  shown: bi("{shown} of {total}", "{shown} з {total}"),
  showMore: bi("Show more", "Показати ще"),
  allEvents: bi("All events", "Усі події"),
  dataFrom: bi("Data: {list}", "Дані: {list}"),
  notRead: bi("Not read yet: {list}", "Ще не читаємо: {list}"),
  notRead_CONCENTRATION_CHANGED: bi("changes of concentration", "зміну концентрації"),
  notRead_QUOTE_CHANGED: bi("changes of a quote token", "зміну quote-токена"),
  partRead: bi("In part: {list}", "Частково: {list}"),
  partRead_TOKEN_CREATED: bi("new tokens — from Jupiter's lists of the newest and most traded, not every token", "нові токени — зі списків Jupiter найновіших і найактивніших, не всі"),
  partRead_DEX_LISTED: bi("exits to a DEX — the day's from Jupiter's lists", "виходи на DEX — денні зі списків Jupiter"),
  partRead_LIQUIDITY_CHANGED: bi("liquidity — Jupiter's hour and Ryntra's own steps, no pool history", "ліквідність — година Jupiter і власні заявки Ryntra, без історії пулу"),
  partRead_AUTHORITY_OPEN: bi("rights — the state now, not when it appeared; no Token-2022 permanent delegate", "права — стан зараз, а не коли з'явились; без постійного делегата Token-2022"),
  newestLoaded: bi("The newest {count} are loaded here; a kind or a search narrows the feed.", "Тут — {count} найновіших; вид або пошук звужують стрічку."),
  logsRead: bi("Launch logs read: {read} of {markets} markets, the most active first", "Журнали Лаунчу: прочитано {read} з {markets} ринків — найактивніші"),
  noAdvice: bi("An event is a fact with its source, not advice. A trade opens on the token's page, with its quote and Review.", "Подія — факт із джерелом, а не порада. Угода відкривається на сторінці токена, з котируванням і Перевіркою."),
  readOnly: bi("Read-only · no wallet needed", "Лише читання · гаманець не потрібен"),
} as const;

export type EventsWord = keyof typeof EVENTS_WORDS;

export function eventsWords(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (key: EventsWord, vars?: Readonly<Record<string, string | number>>) => {
    let text: string = EVENTS_WORDS[key][lang];
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
    return text;
  };
}

/** A launch program by the name people know it by. */
export const VENUE_NAMES: Readonly<Record<string, string>> = { pump: "pump.fun", "meteora-dbc": "Meteora DBC", launchlab: "Raydium LaunchLab", "damm-v2": "Meteora DAMM v2" };

/** How long ago, in the shortest honest unit: «40 с», «12 хв», «3 год», «2 дн». */
export function agoText(seconds: number, locale: WorkspaceLocale): string {
  const uk = locale === "uk";
  if (seconds < 60) return uk ? `${seconds} с` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return uk ? `${minutes} хв` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return uk ? `${hours} год` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return uk ? `${days} дн` : `${days}d`;
}
