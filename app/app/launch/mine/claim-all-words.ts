import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * «Забрати все» (SOL-L12) — the Review before the creator's claim, in both languages: every pocket by name, what this
 * claim does about it, how many transactions the wallet signs and what each takes, the locked position as the NFT it is.
 * Short: a word or a number where there is one; what was not read is said so.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const CLAIM_ALL_WORDS = {
  claimAll: bi("Claim all · {amount}", "Забрати все · {amount}"),
  reviewTitle: bi("Claim all from ${symbol}", "Забрати все з ${symbol}"),
  whatItIs: bi("Every pocket of your side of ${symbol}: what is marked «in transaction» is taken by the {n} transaction(s) you sign; the rest stays where it is. Ryntra signs nothing.", "Кожна кишеня твоєї сторони ${symbol}: позначене «у транзакції» забирають транзакції, які підписуєш ти ({n}); решта лишається, де є. Ryntra нічого не підписує."),
  whatItIsBlocked: bi("Every pocket of your side of ${symbol}. The claim as built names a position that is no longer yours, so nothing is taken now.", "Кожна кишеня твоєї сторони ${symbol}. Запит у нинішньому вигляді називає позицію, що вже не твоя, тож зараз нічого не забирається."),
  blockedMoved: bi("The locked position's NFT is with another wallet: a claim that names it would be refused whole. Nothing can be signed here now.", "NFT замкненої позиції в іншому гаманці: запит, що її називає, мережа відхилить цілком. Зараз тут нічого підписати."),
  whatItIsNothing: bi("Every pocket of your side of ${symbol}: nothing to take now.", "Кожна кишеня твоєї сторони ${symbol}: зараз нічого забрати."),
  txRow: bi("Transaction {n}", "Транзакція {n}"),
  positionRow: bi("Locked position (NFT)", "Замкнена позиція (NFT)"),
  positionValue: bi("{holder} · {lock}", "{holder} · {lock}"),
  reviewReading: bi("Reading every pocket from the chain…", "Читаємо кожну кишеню з ланцюга…"),
  reviewUnread: bi("The pockets could not be read now; nothing was built. Try again.", "Кишені зараз не прочитано; нічого не зібрано. Спробуй ще раз."),
  reviewAgain: bi("Read again", "Прочитати ще раз"),
  pocket_curve: bi("Curve trading fee", "Комісія кривої"),
  pocket_graduation: bi("DEX exit fee, your part", "Частка комісії виходу на DEX"),
  pocket_surplus: bi("Curve surplus", "Надлишок кривої"),
  pocket_lp: bi("Locked position fees (DAMM v2)", "Комісії замкненої позиції (DAMM v2)"),
  pocket_leftover: bi("Curve leftover tokens", "Залишок токенів кривої"),
  pocket_transferFee: bi("Withheld transfer fee", "Утримана комісія за переказ"),
  state_IN_CLAIM: bi("in transaction {n}", "у транзакції {n}"),
  state_EMPTY: bi("nothing now", "зараз нічого"),
  state_BEFORE_DEX: bi("after the DEX", "після виходу на DEX"),
  state_WAITING: bi("not in this claim now", "зараз не в цьому запиті"),
  state_CLOSED: bi("not taken on this network yet", "у цій мережі поки не забираємо"),
  state_NOT_YOURS: bi("goes to {holder}", "отримує {holder}"),
  state_NONE: bi("none on this token", "у цього токена немає"),
  state_LATER: bi("collected on its own, not by this claim", "збирається окремо, не цим запитом"),
  state_UNREAD: bi("not read", "не прочитано"),
  leftoverHint: bi("The curve's leftover tokens go to the receiver its config names — never through «Claim».", "Залишок токенів кривої отримує той, кого називає конфіг, — не через «Забрати»."),
  surplusSplit: bi("Surplus {total}: creator's side {creator} · partner {partner} · Meteora {protocol}", "Надлишок {total}: сторона творця {creator} · партнер {partner} · Meteora {protocol}"),
  txNothing: bi("Nothing to take now — no transaction to sign.", "Зараз нічого забрати — підписувати нічого."),
  txPayout: bi("the shared vault pays your share", "спільне сховище виплачує твою частку"),
  txFundsVault: bi("into the shared vault: {what}", "у спільне сховище: {what}"),
  networkCostUnknown: bi("not simulated", "не змодельовано"),
  positionTitle: bi("The locked position is an NFT", "Замкнена позиція — це NFT"),
  positionHolder: bi("Held by", "Тримає"),
  holder_YOU: bi("your wallet", "твій гаманець"),
  holder_VAULT: bi("the shared vault", "спільне сховище"),
  holder_UNREAD: bi("not read", "не прочитано"),
  positionLocked: bi("locked for ever", "замкнено назавжди"),
  positionLockedPart: bi("{pct} locked for ever", "{pct} замкнено назавжди"),
  positionSend: bi(
    "Whoever holds the NFT takes the position's fees. Sending it (Meteora's «Send Position») moves the fees to the new holder; the liquidity stays locked for ever.",
    "Комісії позиції забирає той, хто тримає NFT. Передача (Send Position у Meteora) віддає комісії новому власнику; ліквідність лишається замкненою назавжди.",
  ),
  positionGone: bi("The NFT is no longer with this launch's creator side: its fees go to its holder.", "NFT уже не в творця цього лаунчу: комісії отримує його власник."),
  calendarTitle: bi("Unlock calendar", "Календар розлоку"),
  calendarTokensCliff: bi("Your tokens unlock from", "Розлок твоїх токенів з"),
  calendarTokensEnd: bi("Fully unlocked", "Розлоковано повністю"),
  calendarLp: bi("Locked liquidity", "Замкнена ліквідність"),
  calendarNever: bi("never", "ніколи"),
  changed: bi("The claim changed since this Review — nothing was signed. Look at it again.", "Запит змінився після перевірки — нічого не підписано. Переглянь ще раз."),
  closedNote: bi("Ryntra does not take the curve's surplus on this network yet: it stays on the curve for the creator's side.", "У цій мережі Ryntra поки не забирає надлишок кривої: він лишається на кривій для сторони творця."),
} as const;

export type ClaimAllWordKey = keyof typeof CLAIM_ALL_WORDS;

export function claimAllWords(locale: WorkspaceLocale) {
  return (key: ClaimAllWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    CLAIM_ALL_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
