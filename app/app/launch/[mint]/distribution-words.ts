import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * «Кампанія розподілу» on a token's page (DROP-2), in both languages: what belongs to a wallet, what it has taken and
 * what is left, with the receipt of each claim. Plain words, nothing promising a price, and nothing calling an unread
 * chain a zero.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const DISTRIBUTION_WORDS = {
  title: bi("Your claim", "Твій claim"),
  lede: bi(
    "The campaign locked the whole list in Met Lock and published its root. Nobody pays you: you take your own allocation with your own signature, and the program cannot pay it twice.",
    "Кампанія заблокувала весь список у Met Lock і опублікувала корінь. Ніхто тобі не платить: свою частку ти забираєш власним підписом, а виплатити її двічі програма не може.",
  ),
  reading: bi("Reading your claim…", "Читаємо твій claim…"),
  unread: bi("The chain could not be read right now, so nothing is stated here.", "Ланцюг зараз не прочитано, тому тут нічого не сказано."),
  readAgain: bi("Read again", "Прочитати ще раз"),
  connect: bi("Connect a wallet to see whether anything belongs to it.", "Підключи гаманець, щоб побачити, чи щось йому належить."),
  noCampaign: bi("This token has no distribution campaign.", "У цього токена немає кампанії розподілу."),
  /* The panel's own rows. */
  owed: bi("Belongs to you", "Належить тобі"),
  taken: bi("Taken", "Забрано"),
  left: bi("Left", "Лишилось"),
  claimable: bi("You can take now", "Можна забрати зараз"),
  nextUnlock: bi("Next part unlocks", "Наступна частина відкриється"),
  endsAt: bi("Finishes unlocking", "Відкриється повністю"),
  escrow: bi("Your escrow", "Твій ескроу"),
  root: bi("The campaign's root", "Корінь кампанії"),
  receipts: bi("Receipts", "Квитанції"),
  receiptsNone: bi("You have taken nothing yet.", "Ти ще нічого не забирав."),
  /* Each state in a person's words. */
  state_NOT_IN_LIST: bi("This wallet is not in the campaign's list.", "Цього гаманця немає у списку кампанії."),
  state_WAITING: bi("Your allocation is in the list; nothing has unlocked yet.", "Твоя частка у списку; поки нічого не відкрилось."),
  state_CLAIMABLE: bi("There is something to take.", "Є що забрати."),
  state_PARTLY_CLAIMED: bi("Part is taken; the rest unlocks on the schedule.", "Частину забрано; решта відкривається за розкладом."),
  state_CLAIMED: bi("You have taken all of it.", "Ти забрав усе."),
  state_NOT_FUNDED: bi("The campaign's escrow does not hold what the list promises, so nothing is offered.", "Ескроу кампанії не тримає обіцяного списком, тому нічого не пропонуємо."),
  state_UNDER_REVIEW: bi("A protection check is open on this wallet: a person looks before anything moves, and you can argue it.", "На цьому гаманці відкрито перевірку: спершу дивиться людина, і її рішення можна оскаржити."),
  state_AFTER_DEX: bi("The campaign starts after the token's proven exit to a DEX.", "Кампанія починається після доведеного виходу токена на DEX."),
  state_CANCELLED: bi("The campaign's owner cancelled this row: what had unlocked stayed yours, the rest went back.", "Власник кампанії скасував цей рядок: відкрите лишилось тобі, решта повернулась."),
  state_UNREAD: bi("The chain was not read, so nothing is stated.", "Ланцюг не прочитано, тому нічого не сказано."),
  /* Why a row waits for a person. The codes, never a word about who anybody is. */
  reason_EXCLUDED_WALLET: bi("The campaign's list leaves this wallet out.", "Список кампанії не включає цей гаманець."),
  reason_BELOW_MIN: bi("Below the campaign's minimum.", "Менше за мінімум кампанії."),
  reason_NOT_BOUGHT: bi("Only tokens bought on the market count; what arrived by a transfer does not.", "Рахуються лише куплені на ринку токени; отримані переказом — ні."),
  reason_HELD_TOO_SHORT: bi("Not held since the slot the campaign asks for.", "Не утримано з того слота, якого просить кампанія."),
  reason_KYC_MISSING: bi("The campaign asks for an identity check.", "Кампанія просить перевірку особи."),
  reason_CLUSTER_CAPPED: bi("Another wallet with the same funding source or device is already paid.", "Інший гаманець із тим самим джерелом поповнення чи пристроєм уже отримує виплату."),
  reason_UNDER_REVIEW: bi("The protection rules opened a case.", "Правила захисту відкрили перевірку."),
  reason_LOW_TRUST: bi("Trust below what the campaign pays without a look.", "Довіра нижча за ту, з якою кампанія платить без перевірки."),
  /* The action. */
  claim: bi("Take it", "Забрати"),
  claiming: bi("Preparing…", "Готуємо…"),
  signing: bi("Sign in your wallet", "Підпиши в гаманці"),
  sending: bi("Sending…", "Надсилаємо…"),
  done: bi("Taken. The receipt is below.", "Забрано. Квитанція нижче."),
  pending: bi("The network did not answer in time. It may still have gone out — read again before signing another.", "Мережа не відповіла вчасно. Дія могла піти — перечитай, перш ніж підписувати ще раз."),
  /* Refusals, each in a person's words. */
  err_WALLET_MISMATCH: bi("This wallet is not in the campaign's list.", "Цього гаманця немає у списку кампанії."),
  err_VALIDATION_ERROR: bi("There is nothing to take right now.", "Зараз немає чого забирати."),
  err_LAUNCH_NOT_FOUND: bi("The campaign could not be found.", "Кампанію не знайдено."),
  err_LAUNCH_PAUSED: bi("Claims are paused right now; nothing was built.", "Claim зараз на паузі; нічого не підготовлено."),
  err_WALLET_REFUSED: bi("The wallet did not sign; nothing was sent.", "Гаманець не підписав; нічого не надіслано."),
  err_LAUNCH_BUILD_EXPIRED: bi("The bytes aged out before the signature. Try again.", "Байти застаріли до підпису. Спробуй ще раз."),
  err_generic: bi("It did not work right now; nothing was sent. Try again.", "Зараз не вийшло; нічого не надіслано. Спробуй ще раз."),
} as const;

export type DistributionWordKey = keyof typeof DISTRIBUTION_WORDS;

export function distributionWords(locale: WorkspaceLocale) {
  return (key: DistributionWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    DISTRIBUTION_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
