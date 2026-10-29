import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Execution truth (SOL-X1) in both languages: what arrived against the same route without Ryntra's fee, every fee
 * of the trade and its actual cashback — the receipt's words, read off its own signed facts.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const TRUTH_WORDS = {
  title: bi("Execution truth", "Правда виконання"),
  received: bi("Received", "Отримано"),
  direct: bi("Same route without Ryntra's fee", "Той самий маршрут без комісії Ryntra"),
  directExact: bi("{amount} · {gap} more", "{amount} · на {gap} більше"),
  directEstimate: bi("at most {amount} · up to {gap} more", "не більше {amount} · до {gap} більше"),
  directOrderDefault: bi(
    "estimate — without Ryntra, Jupiter charges its own fee on this route",
    "оцінка — без Ryntra Jupiter бере на цьому маршруті власну комісію",
  ),
  directSame: bi("the same — Ryntra took no fee from this trade", "те саме — Ryntra не брала комісії з цієї угоди"),
  directSameLaunch: bi(
    "the same — Ryntra adds nothing on top; its part is inside the pool fee",
    "так само — Ryntra нічого не додає зверху; її частка — всередині комісії пулу",
  ),
  directUnknown: bi("not sized: the fee is in a third token", "не пораховано: комісія в іншому токені"),
  directUnread: bi("not sized: the fee's amount is not read from the chain", "не пораховано: суму комісії не прочитано з ланцюга"),
  directNoMint: bi("not sized: the fee's token is not stated", "не пораховано: токен комісії не вказано"),
  directNotBelow: bi("not sized: the fee is not less than the amount priced", "не пораховано: комісія не менша за суму котирування"),
  quote: bi("Quote → fill", "Котирування → виконання"),
  quoteLine: bi("{quoted} → {filled} · {gap}", "{quoted} → {filled} · {gap}"),
  minimumMet: bi("your minimum kept", "мінімум дотримано"),
  minimumMissed: bi("below your minimum", "нижче твого мінімуму"),
  ryntra: bi("Ryntra fee", "Комісія Ryntra"),
  ryntraCharged: bi("{rate} · {amount}", "{rate} · {amount}"),
  ryntraNotCharged: bi("{rate} quoted — the chain shows none taken", "{rate} у котируванні — ланцюг не показує стягнення"),
  ryntraNone: bi("None", "Немає"),
  ryntraLaunch: bi("0 on top · {part} of the pool fee", "0 зверху · {part} з комісії пулу"),
  ryntraLaunchUnsized: bi("0 on top · its part is inside the pool fee", "0 зверху · її частка — всередині комісії пулу"),
  ryntraUnread: bi("{rate} — not yet read from the chain", "{rate} — ще не прочитано з ланцюга"),
  providerShare: bi("Jupiter keeps {pct} of it — inside the fee, not on top", "з неї Jupiter залишає {pct} — усередині, не зверху"),
  protocol: bi("Protocol", "Протокол"),
  jupiterNone: bi("Jupiter 0 · pool fees are inside the route's price", "Jupiter — 0 · комісії пулів — у ціні маршруту"),
  jupiterOwn: bi("Jupiter {rate} · pool fees are inside the route's price", "Jupiter — {rate} · комісії пулів — у ціні маршруту"),
  jupiterUnknown: bi("Pool fees are inside the route's price", "Комісії пулів — у ціні маршруту"),
  poolFee: bi("Pool fee {amount} · Ryntra's part {part}, inside it", "Комісія пулу {amount} · частка Ryntra {part}, усередині неї"),
  network: bi("Network", "Мережа"),
  priority: bi("Priority", "Пріоритет"),
  tip: bi("Tip", "Чайові"),
  tipZero: bi("0 — Ryntra adds none", "0 — Ryntra їх не додає"),
  tipUnknown: bi("not recorded apart — Jupiter built this transaction", "окремо не записано — транзакцію зібрав Jupiter"),
  notInReceipt: bi("not in this receipt", "немає в цій квитанції"),
  cashback: bi("Cashback", "Кешбек"),
  cashbackHeld: bi("{usd} · part after the wallet check", "{usd} · частина — після перевірки гаманця"),
  cashbackUnvalued: bi("credited — no dollar figure yet", "нараховано — суми в доларах ще немає"),
  cashbackNone: bi("none on record for this trade", "для цієї угоди запису немає"),
  cashbackNoFee: bi("0 — no Ryntra fee, no cashback", "0 — без комісії Ryntra кешбеку немає"),
  cashbackNotShown: bi("not shown here — sign in with this wallet, or see Rewards", "тут не показано — увійди цим гаманцем або дивись «Винагороди»"),
  cashbackPending: bi("not on record yet — see it in History", "запису ще немає — дивись в «Історії»"),
  how: bi("How we count", "Як ми рахуємо"),
  noScale: bi("—", "—"),
} as const;

export type TruthWord = keyof typeof TRUTH_WORDS;

export function truthWords(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (key: TruthWord, vars?: Readonly<Record<string, string | number>>) => {
    let text: string = TRUTH_WORDS[key][lang];
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
    return text;
  };
}
