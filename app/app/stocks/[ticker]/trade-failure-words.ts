/**
 * What a stock sheet says when its quote or its action fails (SOL-K1): the
 * same codes Swap names (`lib/solana/swap-failure-copy.ts`), in the words of a
 * purchase, a sale or a swap of a company — never «маршрут», «пара» or
 * «провайдер обміну» on a purchase — and in the sheets' own «ти». Whether a
 * second press can help stays the hook's (`useSpotTicket`): only the sentence
 * changes. A code this map does not know keeps the hook's sentence.
 */

export type TradeKind = "buy" | "sell" | "swap";
type Lang = "en" | "uk";
type Line = Readonly<Record<TradeKind, Readonly<Record<Lang, string>>>>;

const same = (en: string, uk: string): Readonly<Record<TradeKind, Readonly<Record<Lang, string>>>> => ({ buy: { en, uk }, sell: { en, uk }, swap: { en, uk } });
const each = (buy: readonly [string, string], sell: readonly [string, string], swap: readonly [string, string]): Line => ({
  buy: { en: buy[0], uk: buy[1] },
  sell: { en: sell[0], uk: sell[1] },
  swap: { en: swap[0], uk: swap[1] },
});

/* In the order Swap's copy tests them: the first family that matches the code speaks. */
const FAMILIES: readonly (readonly [RegExp, Line])[] = [
  [/SWAP_PAUSED/, each(["Buying is turned off right now.", "Купівлю зараз вимкнено."], ["Selling is turned off right now.", "Продаж зараз вимкнено."], ["Swapping is turned off right now.", "Обмін зараз вимкнено."])],
  [/^ASSET_NOT_OFFERED$/, same("The issuer no longer offers this token for purchase.", "Емітент більше не пропонує цей токен для купівлі.")],
  [/PROOF_NOT_SIGNED|ISSUER_KEY_MISSING|STORE_NOT_DURABLE|PROVIDER_KEY_MISSING|NO_INDEPENDENT_RPC|PRODUCTION_KEY_REQUIRED|DURABLE_MULTI_WRITER/, same("Trading is not available on this site right now. Nothing was sent.", "Торгівля на цьому сайті зараз недоступна. Нічого не надіслано.")],
  [/SWAP_PRE_SIGN_REFUSED/, same("This trade was checked and not offered for signing. Nothing was sent.", "Цю угоду перевірено й не запропоновано до підпису. Нічого не надіслано.")],
  [/^ADOPTED_SIMULATION_(FAILED|UNAVAILABLE)$/, same("The signed transaction failed its final check. Nothing was sent — get a new price.", "Підписана транзакція не пройшла останню перевірку. Нічого не надіслано — отримай нову ціну.")],
  [/^SIMULATION_(FAILED|UNAVAILABLE)$/, same("This price could not be confirmed. Nothing was sent — get a new price.", "Цю ціну не вдалося підтвердити. Нічого не надіслано — отримай нову ціну.")],
  [/SIMULATION/, same("This trade did not pass its check, so it was not offered for signing.", "Ця угода не пройшла перевірку, тож її не запропоновано до підпису.")],
  [/IMPLAUSIBLE_QUOTE/, same("This price did not check out, so it was not offered. Try again in a moment.", "Ця ціна не пройшла перевірку, тож її не запропоновано. Спробуй за мить.")],
  [/ORDER_BUILD_FAILED/, same("The market priced this and would not prepare it — usually the wallet does not cover the amount plus the network fee.", "Ринок дав ціну, але не підготував угоду — зазвичай гаманець не покриває суму разом із платою мережі.")],
  [/ORDER_UNREACHABLE|ORDER_HTTP_ERROR|EXECUTE_UNREACHABLE|EXECUTE_HTTP_ERROR/, same("The market could not be reached just now. Nothing was sent.", "Ринок зараз не відповів. Нічого не надіслано.")],
  [/ORDER_REFUSED|ORDER_MALFORMED|EXECUTE_REFUSED|EXECUTE_MALFORMED/, same("The market refused this request. Nothing was sent.", "Ринок відхилив цей запит. Нічого не надіслано.")],
  [/PASSPORT_REFUSED|MINT_UNREADABLE/, same("This token could not be checked, so no trade was offered for it.", "Цей токен не вдалося перевірити, тож угоду для нього не запропоновано.")],
  [/INTENT_REFUSED|SWAP_POLICY_BLOCKED|PREFLIGHT_REFUSED/, same("This trade did not pass Ryntra's own checks, so it was not offered.", "Ця угода не пройшла власні перевірки Ryntra, тож її не запропоновано.")],
  [/^PLAN_REVIEW_BLOCKED$/, same("This order is outside the plan, so it was not offered. Change the amount, or the plan.", "Ця заявка поза планом, тож її не запропоновано. Зміни суму або план.")],
  [/^PLAN_VERSION_CONFLICT$/, same("The plan changed since this Review. Nothing was sent — review again.", "План змінився після цієї Перевірки. Нічого не надіслано — перевір ще раз.")],
  [/^PLAN_STATE_REFUSED$/, same("The plan is no longer active, so nothing was sent under it.", "План більше не діє, тож за ним нічого не надіслано.")],
  [/^PLAN_NOT_FOUND$/, same("No such plan for this wallet.", "Такого плану для цього гаманця немає.")],
  [/^UNAUTHORIZED$/, same("Confirm your wallet to trade under the plan.", "Підтверди гаманець, щоб торгувати за планом.")],
  [/^WALLET_MISMATCH$/, same("The confirmed wallet is not the one placing this order.", "Підтверджений гаманець — не той, що робить цю заявку.")],
  [/^UNAVAILABLE$/, same("The plan could not record the Review. Nothing was sent — try again.", "План не зміг записати Перевірку. Нічого не надіслано — спробуй ще раз.")],
  [/TRANSACTION_|REVIEWED_BYTES_MISMATCH|WALLET_MODIFIED_BYTES|WALLET_GUARDS/, same("The transaction that came back was not the one in the Review, so it was not sent.", "Транзакція, що повернулась, не та, що в Перевірці, тож її не надіслано.")],
  [/^HTTP_(502|503|504)$|TIMEOUT|GATEWAY/, same("That took too long and was stopped. Nothing was sent — try again.", "Це тривало задовго й було зупинено. Нічого не надіслано — спробуй ще раз.")],
  [/^NETWORK$/, same("Ryntra could not be reached. Nothing was sent.", "Не вдалося з'єднатися з Ryntra. Нічого не надіслано.")],
  [/NO_ROUTE/, each(["This amount can't be bought right now.", "Цю суму зараз не купити."], ["This amount can't be sold right now.", "Цю суму зараз не продати."], ["This amount can't be swapped right now.", "Цю суму зараз не обміняти."])],
  [/INSUFFICIENT|BALANCE/, same("This wallet does not hold enough for this amount.", "У гаманці недостатньо коштів на цю суму.")],
  [/AMOUNT/, each(["This amount can't be bought.", "Цю суму не купити."], ["This amount can't be sold.", "Цю суму не продати."], ["This amount can't be swapped.", "Цю суму не обміняти."])],
  [/EXPIRED|STALE|BLOCKHASH/, same("The price is out of date. Get a new one.", "Ціна застаріла. Отримай нову.")],
  [/WALLET_REFUSED|USER_REJECTED|CANCELLED/, same("The wallet did not sign — nothing was sent.", "Гаманець не підписав — нічого не надіслано.")],
  [/RATE_LIMITED/, same("Too many requests just now. Try again in a moment.", "Забагато запитів. Спробуй за мить.")],
  [/OWNER.*LOCK|SUBMISSION_UNKNOWN|RECOVERY/, each(["Checking your previous purchase. Try again in a moment.", "Перевіряємо твою попередню купівлю. Спробуй за мить."], ["Checking your previous sale. Try again in a moment.", "Перевіряємо твій попередній продаж. Спробуй за мить."], ["Checking your previous swap. Try again in a moment.", "Перевіряємо твій попередній обмін. Спробуй за мить."])],
  [/VALIDATION|FORBIDDEN_ORIGIN/, same("This request was not accepted.", "Цей запит не прийнято.")],
];

const FALLBACK = each(
  ["The purchase could not continue. Try again.", "Купівлю не вдалося продовжити. Спробуй ще раз."],
  ["The sale could not continue. Try again.", "Продаж не вдалося продовжити. Спробуй ще раз."],
  ["The swap could not continue. Try again.", "Обмін не вдалося продовжити. Спробуй ще раз."],
);

/** Codes whose sentence the hook writes itself, from what it saw — kept as the hook says them. */
const OWN_SENTENCE = new Set(["BLOCKHASH_STILL_VALID", "SIGNATURE_UNREADABLE", "SAME_MINT", "REVIEW_CLOSED_UNDER_WALLET"]);

/**
 * The sheet's sentence for a failure: the family's words for this kind of
 * trade, or the hook's own sentence for the few it writes itself; null when
 * nothing failed.
 */
export function tradeFailureLine(failure: Readonly<{ code: string }> | null, hookMessage: string | null, kind: TradeKind, lang: Lang): string | null {
  if (!failure) return null;
  if (OWN_SENTENCE.has(failure.code)) return hookMessage;
  const family = FAMILIES.find(([pattern]) => pattern.test(failure.code));
  return (family ? family[1] : FALLBACK)[kind][lang];
}
