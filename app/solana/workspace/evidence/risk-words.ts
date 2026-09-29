import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AddressEvidenceSummary, RiskBand, SanctionsState } from "@/lib/evidence/address";
import type { EvidenceUnit } from "@/lib/evidence/metrics";

/**
 * Every word the risk surfaces say — the card on the asset, the compact
 * state, the recipient check in Send — in both languages, and the figure
 * formats they share. The vocabulary is the canon's: a fact with its state,
 * never a verdict. There is no word for "safe" here, no "scam", no "buy",
 * no "sell"; the strongest sentence about a token is which facts stand, the
 * strongest about an address is that nothing was found among what one
 * source keeps today.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const RISK_WORDS = {
  title: bi("Risk & due diligence", "Ризик і перевірка"),
  lead: bi("Who holds it, can its supply change, does it tax transfers.", "Хто його тримає, чи може змінитися пропозиція, чи є податок на перекази."),
  check: bi("Check", "Перевірити"),
  loading: bi("Reading the token's structure… a first look can take a few seconds.", "Читаємо структуру токена… перший погляд може зайняти кілька секунд."),
  refresh: bi("Refresh", "Оновити"),
  tryAgain: bi("Try again", "Спробувати ще раз"),
  details: bi("Details", "Деталі"),
  addCondition: bi("Add a condition to the plan", "Додати умову до плану"),
  observedAt: bi("analysed", "проаналізовано"),
  askedAt: bi("asked", "запит о"),
  sourceLag: bi("the source may be up to", "джерело може відставати до"),
  minutes: bi("min behind", "хв"),
  stale: bi("last check held — the source did not answer just now", "остання збережена перевірка — джерело щойно не відповіло"),
  expired: bi("older than ten minutes — refresh for the current state", "старіше за десять хвилин — онови для актуального стану"),
  noData: bi("The source does not analyse this token.", "Джерело не аналізує цей токен."),
  unavailable: bi("The check is not available right now.", "Перевірка зараз недоступна."),
  reasonPrefix: bi("Reason", "Причина"),
  /* The rows. */
  holdersOf: bi("of", "з"),
  holders: bi("holders", "власників"),
  holdersNotCounted: bi("holders not counted by the source", "джерело не порахувало власників"),
  notMeasured: bi("not measured by the source", "джерело не виміряло"),
  renounced: bi("Renounced", "Відкинуто"),
  present: bi("Present", "Є"),
  mintRenounced: bi("the supply is fixed", "пропозиція зафіксована"),
  mintPresent: bi("the supply can still be increased", "пропозицію ще можна збільшити"),
  freezeRenounced: bi("no one can freeze holders' accounts", "ніхто не може заморозити рахунки власників"),
  freezePresent: bi("holders' accounts can be frozen", "рахунки власників можна заморозити"),
  issuerAuthorityNote: bi("kept by an issuer-backed instrument by design", "інструмент із емітентом лишає це за задумом"),
  issuerConcentrationNote: bi("the issuer's own accounts hold supply by design", "рахунки емітента тримають пропозицію за задумом"),
  taxNone: bi("None", "Немає"),
  taxOnEveryTransfer: bi("on every transfer", "з кожного переказу"),
  taxUnknownSize: bi("a tax of unknown size", "податок невідомого розміру"),
  launchTitle: bi("Early holders", "Ранні власники"),
  launchLead: bi("the source's classification of addresses, not facts about people", "класифікація адрес джерелом, не факти про людей"),
  launchMeansLittle: bi("on a token launched long ago these labels mean little", "для давно запущеного токена ці мітки мало що означають"),
  launchIssuer: bi("for an issuer-backed instrument the 'developer' is the issuer's own supply", "для інструмента з емітентом «розробник» — це власна пропозиція емітента"),
  snipers: bi("early snipers", "ранні снайпери"),
  bundlers: bi("bundled buyers", "пакетні покупці"),
  developer: bi("the developer", "розробник"),
  hold: bi("hold", "тримають"),
  /* The compact state. */
  stateNoFlags: bi("No flags observed", "Прапорців не помічено"),
  stateFlags: bi("flags", "прапорців"),
  stateFlag: bi("flag", "прапорець"),
  stateFlagsTwo: bi("flags", "прапорці"),
  stateNoData: bi("No data", "Немає даних"),
  stateUnavailable: bi("Not available", "Недоступно"),
  stateStale: bi("stale", "застаріло"),
  stateNotChecked: bi("Not checked yet", "Ще не перевірено"),
  changedSince: bi("Changed since your last look", "Змінилося з твого останнього погляду"),
  changedMintPresent: bi("mint authority now present", "право емісії тепер є"),
  changedMintRenounced: bi("mint authority now renounced", "право емісії тепер відкинуто"),
  changedFreezePresent: bi("freeze authority now present", "право заморозки тепер є"),
  changedFreezeRenounced: bi("freeze authority now renounced", "право заморозки тепер відкинуто"),
  changedTaxOn: bi("a transfer tax now applies", "тепер діє податок на переказ"),
  changedTaxOff: bi("the transfer tax is gone", "податку на переказ більше немає"),
  changedTop10: bi("held by the top 10", "у 10 найбільших"),
  flagMint: bi("mint authority present", "право емісії є"),
  flagFreeze: bi("freeze authority present", "право заморозки є"),
  flagTax: bi("transfer tax", "податок на переказ"),
  /* Details. */
  families: bi("Answered by", "Відповіла"),
  familyTradingLite: bi("the source's token analysis (structure, authorities, early holders)", "аналіз токена джерелом (структура, права, ранні власники)"),
  expiresAt: bi("Counted current until", "Вважається актуальним до"),
  coverage: bi("Coverage", "Охоплення"),
  method: bi("How to read it", "Як це читати"),
  methodText: bi(
    "The top-ten share counts what the ten largest holders hold together, as the source counts it — an issuer's, a program's or an exchange's own accounts may be among them. An authority is read off the mint: renounced means the right was given up on-chain, present means somebody can use it. The early-holder shares are the source's labels on addresses from the token's first moments. Nothing here is a price, a quote, a verdict or advice.",
    "Частка десяти найбільших рахує, що разом тримають десять найбільших власників, як рахує джерело — серед них можуть бути рахунки емітента, програми чи біржі. Право читається з мінта: «відкинуто» означає, що право віддано в мережі, «є» — що хтось може ним скористатися. Частки ранніх власників — мітки джерела на адресах із перших хвилин токена. Нічого тут не є ціною, котируванням, вироком чи порадою.",
  ),
  rights: bi("Shown with the source's attribution as derived figures; no address from the source is shown or kept; figures are not kept beyond their window.", "Показано з атрибуцією джерела як похідні цифри; жодна адреса від джерела не показується й не зберігається; цифри не зберігаються довше за своє вікно."),
  notVerdict: bi("Not a verdict", "Не вирок"),
  notVerdictText: bi("A fact that looks alarming on a meme coin can be the design of an issuer-backed instrument. Ryntra never blocks a trade on any of this; a rule of your own plan can.", "Факт, що лякає на мем-коїні, може бути задумом інструмента з емітентом. Ryntra ніколи не блокує угоду через це; правило твого власного плану — може."),
  /* The recipient check. */
  recipientTitle: bi("Recipient check", "Перевірка отримувача"),
  recipientChecking: bi("Checking the address with an external source…", "Перевіряємо адресу в зовнішньому джерелі…"),
  recipientNothingFound: bi("Nothing found among what the source keeps", "Нічого не знайдено серед того, що веде джерело"),
  recipientEvidenceFound: bi("Risk evidence found", "Знайдено свідчення ризику"),
  recipientSanctioned: bi("On a sanctions list the source keeps", "У санкційному списку, який веде джерело"),
  recipientPartly: bi("Partly checked", "Перевірено частково"),
  recipientUnsupported: bi("The source cannot analyse this kind of address", "Джерело не може проаналізувати такий тип адреси"),
  recipientUnavailable: bi("Unable to verify this address right now", "Зараз перевірити цю адресу неможливо"),
  recipientNotSafe: bi("not a guarantee — one source, today", "не гарантія — одне джерело, сьогодні"),
  recipientProgramNote: bi("a program, a vault or an exchange contract — not a wallet the source reads; never read as clean", "програма, сховище чи контракт біржі — не гаманець, який читає джерело; ніколи не читається як чистий"),
  recipientYourCall: bi("Ryntra does not stop a transfer on this — the decision is yours.", "Ryntra не зупиняє переказ через це — рішення твоє."),
  findings: bi("Findings", "Знахідки"),
  findingsNone: bi("none of medium or high severity", "жодної середньої чи високої серйозності"),
  findingsHigh: bi("high", "високої"),
  findingsMedium: bi("medium", "середньої"),
  findingsSeverity: bi("severity", "серйозності"),
  findingsUnsupported: bi("not analysed — unsupported kind of address", "не аналізовано — непідтримуваний тип адреси"),
  findingsUnavailable: bi("the source did not answer", "джерело не відповіло"),
  sourceFigure: bi("the source's own figure", "власна оцінка джерела"),
  sourceBand: bi("on its scale", "за його шкалою"),
  bandLow: bi("low", "низько"),
  bandMedium: bi("medium", "середньо"),
  bandHigh: bi("high", "високо"),
  bandCritical: bi("critical", "критично"),
  sanctions: bi("Sanctions lists", "Санкційні списки"),
  sanctionsClean: bi("not listed", "не в списках"),
  sanctionsSanctioned: bi("listed", "у списку"),
  sanctionsUnknown: bi("screening could not be completed", "перевірку не вдалося завершити"),
  sanctionsUnavailable: bi("the source did not answer", "джерело не відповіло"),
  sanctionsRelated: bi("related to a listed party", "пов'язана зі стороною зі списку"),
  addressKindWallet: bi("a plain wallet", "звичайний гаманець"),
  addressKindProgram: bi("a program or contract", "програма або контракт"),
  addressKindUnknown: bi("kind not told by the source", "тип джерело не назвало"),
} as const;

export type RiskWord = keyof typeof RISK_WORDS;

export function riskWordsFor(locale: WorkspaceLocale): (word: RiskWord) => string {
  return (word) => RISK_WORDS[word][locale];
}

/** A structural figure in the person's language: `38,7%`, `1 016 981`, `Є` / `Відкинуто`. */
export function fmtFigure(value: number, unit: EvidenceUnit, locale: WorkspaceLocale): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  if (unit === "percent") {
    const digits = Math.abs(value) >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(Number(value.toFixed(digits)))}%`;
  }
  if (unit === "count") return new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(Math.round(value));
  if (unit === "flag") return value >= 1 ? RISK_WORDS.present[locale] : RISK_WORDS.renounced[locale];
  if (unit === "wallets") return new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(Math.round(value));
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  return `${sign}$${new Intl.NumberFormat(tag, { maximumFractionDigits: abs >= 1000 ? 0 : 2 }).format(abs)}`;
}

export function bandWord(band: RiskBand, locale: WorkspaceLocale): string {
  return RISK_WORDS[band === "low" ? "bandLow" : band === "medium" ? "bandMedium" : band === "high" ? "bandHigh" : "bandCritical"][locale];
}

export function sanctionsWord(state: SanctionsState, locale: WorkspaceLocale): string {
  return RISK_WORDS[state === "clean" ? "sanctionsClean" : state === "sanctioned" ? "sanctionsSanctioned" : state === "unknown" ? "sanctionsUnknown" : "sanctionsUnavailable"][locale];
}

export function summaryWord(summary: AddressEvidenceSummary, locale: WorkspaceLocale): string {
  const key: RiskWord =
    summary === "nothing-found" ? "recipientNothingFound" : summary === "evidence-found" ? "recipientEvidenceFound" : summary === "sanctioned" ? "recipientSanctioned" : summary === "partly-checked" ? "recipientPartly" : summary === "unsupported" ? "recipientUnsupported" : "recipientUnavailable";
  return RISK_WORDS[key][locale];
}

/** `17:16 UTC`, and with the day when it is not today: `15 Sep, 21:38 UTC`. */
export function fmtWhen(iso: string, locale: WorkspaceLocale, nowMs: number): string {
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  const date = new Date(iso);
  const sameDay = date.toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10);
  const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date);
  if (sameDay) return `${time} UTC`;
  const day = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  return `${day}, ${time} UTC`;
}
