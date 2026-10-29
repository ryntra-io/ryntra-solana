/**
 * The trade plan's words — English and Ukrainian, each sentence one block
 * of at most two lines on a phone. Every figure is printed by the agent's
 * own formatters, so a plan and a conversation never print one number two
 * ways. The plan never tells a person what to trade: these sentences say
 * what was planned, what happened and what it costs.
 */

import { pctText, unitsText, usdText } from "../../agent/provenance.ts";

export type Locale = "en" | "uk";

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);
const usd = (value: number, locale: Locale): string => usdText(value, locale);

/** The assumptions a version names, and how to recognise one a person's own figure replaced. */
export function assumptionWords(locale: Locale) {
  const tags: Record<string, readonly string[]> = {
    entry: [w(locale, "Entry taken", "Вхід узято")],
    max: [w(locale, "Maximum price", "Максимальна ціна")],
    invalidation: [w(locale, "Invalidation", "Інвалідація"), w(locale, "invalidation at", "інвалідацію на")],
    target: [w(locale, "First target", "Перша ціль"), w(locale, "target at", "ціль на")],
    money: [w(locale, "Loss limit", "Ліміт збитку"), w(locale, "Budget", "Бюджет")],
  };
  return {
    invalidationWord: w(locale, "invalidation at", "інвалідацію на"),
    targetWord: w(locale, "target at", "ціль на"),
    noEntry: w(locale, "No price of this token is available right now: name your entry.", "Ціни цього токена зараз немає: назви свій вхід."),
    noMoney: w(locale, "Name your loss limit or your budget: the money is yours to decide.", "Назви свій ліміт збитку або бюджет: гроші — твоє рішення."),
    entryFromMarket: (entry: number) => w(locale, `Entry taken as the price now, ${usd(entry, locale)} — not the executable quote.`, `Вхід узято як ціну зараз, ${usd(entry, locale)} — це не котирування для угоди.`),
    maxPriceRule: (value: number) => w(locale, `Maximum price ${usd(value, locale)}: two per cent above the entry, the builder's rule.`, `Максимальна ціна ${usd(value, locale)}: на два відсотки вище входу, правило конструктора.`),
    invalidationRule: (value: number) => w(locale, `Invalidation ${usd(value, locale)}: ten per cent under the entry — replace it with where your idea is wrong.`, `Інвалідація ${usd(value, locale)}: на десять відсотків нижче входу — заміни рівнем, де твоя ідея хибна.`),
    targetRule: (value: number) => w(locale, `First target ${usd(value, locale)}: twice the distance to the invalidation, the plan engine's example.`, `Перша ціль ${usd(value, locale)}: удвічі далі, ніж до інвалідації, — приклад рушія планів.`),
    levelByRyntra: (what: string, value: number) => w(locale, `Ryntra proposed the ${what} ${usd(value, locale)} from the data — yours to replace.`, `Ryntra запропонувала ${what} ${usd(value, locale)} за даними — заміни, якщо бачиш інакше.`),
    riskFromBudget: (value: number) => w(locale, `Loss limit ${usd(value, locale)}: a tenth of the budget, assumed — the loss is your decision.`, `Ліміт збитку ${usd(value, locale)}: десята частина бюджету, припущення — збиток вирішуєш ти.`),
    budgetFromRisk: (value: number) => w(locale, `Budget ${usd(value, locale)}: what your loss limit sizes to at these prices, with the reserve.`, `Бюджет ${usd(value, locale)}: скільки дозволяє твій ліміт збитку за цих цін, з резервом.`),
    validityRule: w(locale, "The entry stays valid thirty days — the builder's rule.", "Вхід дійсний тридцять днів — правило конструктора."),
    /** True when an assumption speaks of one of the replaced fields. */
    concerns: (text: string, replaced: ReadonlySet<string>): boolean => [...replaced].some((key) => (tags[key] ?? []).some((tag) => text.includes(tag))),
  };
}

/** The rules' findings, by id: the plan engine's own checks, the same on every read. */
export function findingWords(locale: Locale) {
  return {
    rewardBelowRisk: (ratio: number) => w(locale, `At the first target the plan makes ${ratio.toFixed(2)} of what it loses at the invalidation, after fees.`, `На першій цілі план заробляє ${ratio.toFixed(2).replace(".", ",")} від того, що втрачає на інвалідації, з комісіями.`),
    rewardThin: (ratio: number) => w(locale, `Reward to risk after fees is ${ratio.toFixed(2)}: one loss takes most of a win.`, `Винагорода до ризику з комісіями — ${ratio.toFixed(2).replace(".", ",")}: один збиток з'їдає більшу частину виграшу.`),
    feesEatReward: (fees: number, share: number) => w(locale, `Fees and costs of ${usd(fees, locale)} take ${Math.round(share)} % of the move to the first target.`, `Комісії й витрати ${usd(fees, locale)} забирають ${Math.round(share)} % руху до першої цілі.`),
    lossAboveLimit: (loss: number, limit: number) => w(locale, `With every fee the loss at the invalidation is ${usd(loss, locale)} against your limit of ${usd(limit, locale)}.`, `З усіма комісіями збиток на інвалідації — ${usd(loss, locale)} при твоєму ліміті ${usd(limit, locale)}.`),
    invalidationTight: (pct: number) => w(locale, `The invalidation is ${pctText(pct, locale).replace("+", "")} under the entry — inside an ordinary hour's move.`, `Інвалідація на ${pctText(pct, locale).replace("+", "")} нижче входу — це в межах звичайного руху за годину.`),
    invalidationWide: (pct: number) => w(locale, `The invalidation is ${pctText(pct, locale).replace("+", "")} under the entry: the size is small, the drawdown deep.`, `Інвалідація на ${pctText(pct, locale).replace("+", "")} нижче входу: розмір малий, просідання глибоке.`),
    entryFar: (entry: number, price: number) => w(locale, `The entry ${usd(entry, locale)} is far from the price now, ${usd(price, locale)}: the plan waits for a move first.`, `Вхід ${usd(entry, locale)} далеко від ціни зараз, ${usd(price, locale)}: план спершу чекає руху.`),
    priceBelowInvalidation: (price: number, invalidation: number) => w(locale, `The price now, ${usd(price, locale)}, is already at or under the invalidation ${usd(invalidation, locale)}.`, `Ціна зараз, ${usd(price, locale)}, уже на інвалідації ${usd(invalidation, locale)} або нижче.`),
    entryAboveMax: (price: number, max: number) => w(locale, `The price now, ${usd(price, locale)}, is above the plan's maximum ${usd(max, locale)}: the Review would refuse an entry now.`, `Ціна зараз, ${usd(price, locale)}, вища за максимум плану ${usd(max, locale)}: Review зараз відмовить у вході.`),
    targetFar: (target: number, high: number) => w(locale, `The first target ${usd(target, locale)} is above the highest daily high of 30 days, ${usd(high, locale)}.`, `Перша ціль ${usd(target, locale)} вища за найвищий денний максимум за 30 днів, ${usd(high, locale)}.`),
    invalidationAboveLow: (invalidation: number, low: number) => w(locale, `The invalidation ${usd(invalidation, locale)} sits above the week's daily low ${usd(low, locale)}: an ordinary week's swing reaches it.`, `Інвалідація ${usd(invalidation, locale)} вища за денний мінімум тижня ${usd(low, locale)}: її зачіпає звичайне коливання тижня.`),
    capitalLimited: (loss: number, limit: number) => w(locale, `The budget, not the loss limit, sets the size: at the invalidation you lose ${usd(loss, locale)}, under your ${usd(limit, locale)}.`, `Розмір задає бюджет, а не ліміт збитку: на інвалідації втрата ${usd(loss, locale)}, менше за твої ${usd(limit, locale)}.`),
    liquidityThin: (liquidity: number, notional: number) => w(locale, `Liquidity of ${usd(liquidity, locale)} is thin for ${usd(notional, locale)}: the exit can cost more than the buffer.`, `Ліквідність ${usd(liquidity, locale)} мала для ${usd(notional, locale)}: вихід може коштувати більше за запас.`),
    liquidityUnknown: w(locale, "The token's liquidity was not read: the cost of an exit is unknown.", "Ліквідність токена не прочитано: скільки коштуватиме вихід — невідомо."),
    priceStale: w(locale, "The price the plan stands on is stale: check it before the Review.", "Ціна, на якій стоїть план, застаріла: перевір її перед Review."),
    priceMissing: w(locale, "No price of the token was read: the plan stands on your figures alone.", "Ціни токена не прочитано: план стоїть лише на твоїх цифрах."),
    thesisShort: w(locale, "The thesis is a few words: write what must happen for the idea to hold.", "Теза — кілька слів: напиши, що має статися, щоб ідея справдилась."),
    ryntraLevels: w(locale, "Some levels are Ryntra's proposal from the data, not your own: check each one.", "Частина рівнів — пропозиція Ryntra за даними, не твоя: перевір кожен."),
    gapNoModel: w(locale, "The strong critic did not run on this version: only the plan engine's checks stand.", "Сильний критик цю версію не перевіряв: стоять лише перевірки рушія планів."),
    gapNoNews: w(locale, "No news of the token was read, so nothing was checked against events.", "Новин токена не прочитано, тож проти подій нічого не перевірено."),
    gapNoCandles: w(locale, "No daily candles were read, so the levels were not checked against the range.", "Денних свічок не прочитано, тож рівні не звірено з діапазоном."),
  };
}

/** «План проти реальності» and the receipt of a trade, in words. */
export function realityWords(locale: Locale) {
  return {
    buy: (units: number, symbol: string, price: number | null, usdPaid: number | null) =>
      price !== null
        ? w(locale, `Bought ${unitsText(units, locale)} ${symbol} at ${usd(price, locale)}${usdPaid !== null ? ` for ${usd(usdPaid, locale)}` : ""}.`, `Куплено ${unitsText(units, locale)} ${symbol} по ${usd(price, locale)}${usdPaid !== null ? ` за ${usd(usdPaid, locale)}` : ""}.`)
        : w(locale, `Bought ${unitsText(units, locale)} ${symbol}; the price of the fill is not known.`, `Куплено ${unitsText(units, locale)} ${symbol}; ціна виконання невідома.`),
    sell: (units: number, symbol: string, price: number | null, proceeds: number | null) =>
      price !== null
        ? w(locale, `Sold ${unitsText(units, locale)} ${symbol} at ${usd(price, locale)}${proceeds !== null ? ` for ${usd(proceeds, locale)}` : ""}.`, `Продано ${unitsText(units, locale)} ${symbol} по ${usd(price, locale)}${proceeds !== null ? ` за ${usd(proceeds, locale)}` : ""}.`)
        : w(locale, `Sold ${unitsText(units, locale)} ${symbol}; the price of the fill is not known.`, `Продано ${unitsText(units, locale)} ${symbol}; ціна виконання невідома.`),
    failed: w(locale, "The transaction failed: nothing moved.", "Транзакція не пройшла: нічого не перемістилось."),
    pending: w(locale, "The chain has not confirmed this trade yet.", "Мережа ще не підтвердила цю угоду."),
    priceVsPlan: (pct: number, entry: number) =>
      Math.abs(pct) < 0.05
        ? w(locale, `That is the plan's entry, ${usd(entry, locale)}.`, `Це вхід плану, ${usd(entry, locale)}.`)
        : pct > 0
          ? w(locale, `That is ${pctText(pct, locale).replace("+", "")} above the plan's entry ${usd(entry, locale)}.`, `Це на ${pctText(pct, locale).replace("+", "")} вище за вхід плану ${usd(entry, locale)}.`)
          : w(locale, `That is ${pctText(-pct, locale).replace("+", "")} under the plan's entry ${usd(entry, locale)}.`, `Це на ${pctText(-pct, locale).replace("+", "")} нижче за вхід плану ${usd(entry, locale)}.`),
    aboveMax: (max: number) => w(locale, `It is above the plan's maximum ${usd(max, locale)}: the entry broke the plan's own bound.`, `Це вище за максимум плану ${usd(max, locale)}: вхід порушив межу самого плану.`),
    sizeVsPlan: (pct: number, planned: number) =>
      Math.abs(pct) < 1
        ? w(locale, `The size is the plan's, ${unitsText(planned, locale)}.`, `Розмір — як у плані, ${unitsText(planned, locale)}.`)
        : pct > 0
          ? w(locale, `The size is ${Math.round(pct)} % over the plan's ${unitsText(planned, locale)}: the loss at the invalidation grows with it.`, `Розмір на ${Math.round(pct)} % більший за плановий ${unitsText(planned, locale)}: збиток на інвалідації росте разом з ним.`)
          : w(locale, `The size is ${Math.round(-pct)} % under the plan's ${unitsText(planned, locale)}.`, `Розмір на ${Math.round(-pct)} % менший за плановий ${unitsText(planned, locale)}.`),
    fee: (fee: number | null, estimate: number) =>
      fee !== null
        ? w(locale, `Ryntra's fee was ${usd(fee, locale)}; the network's is a fraction of a cent.`, `Комісія Ryntra — ${usd(fee, locale)}; мережа бере частку цента.`)
        : w(locale, `The fee of this trade was not recorded; the plan estimated about ${usd(estimate, locale)} for the way in.`, `Комісію цієї угоди не записано; план оцінював близько ${usd(estimate, locale)} на вхід.`),
    riskNow: (loss: number, limit: number) =>
      loss <= limit * 1.02
        ? w(locale, `If the price reaches the invalidation, this position loses about ${usd(loss, locale)} — within your limit of ${usd(limit, locale)}.`, `Якщо ціна дійде до інвалідації, позиція втратить близько ${usd(loss, locale)} — у межах ліміту ${usd(limit, locale)}.`)
        : w(locale, `If the price reaches the invalidation, this position loses about ${usd(loss, locale)} — over your limit of ${usd(limit, locale)}.`, `Якщо ціна дійде до інвалідації, позиція втратить близько ${usd(loss, locale)} — більше за ліміт ${usd(limit, locale)}.`),
    riskUnknown: w(locale, "What this position risks now cannot be counted: a figure of the fill is missing.", "Скільки ця позиція ризикує зараз, порахувати не можна: бракує цифри виконання."),
    noOrder: w(locale, "The invalidation is a rule you act on: no order sits at it.", "Інвалідація — правило, за яким дієш ти: ордера на ній немає."),
    exitFollowed: w(locale, "The exit followed the rules that stood before it.", "Вихід відповідав правилам, що стояли до нього."),
    exitDeviated: w(locale, "The exit did not follow a rule that stood before it.", "Вихід не відповідав правилу, що стояло до нього."),
    summaryNone: w(locale, "No trade under this plan yet.", "Під цим планом угод ще немає."),
    summaryOpen: (units: number, symbol: string) => w(locale, `The position holds ${unitsText(units, locale)} ${symbol}.`, `Позиція тримає ${unitsText(units, locale)} ${symbol}.`),
    summaryClosed: (realised: number | null) =>
      realised !== null
        ? w(locale, `The position is closed: ${realised >= 0 ? "made" : "lost"} ${usd(Math.abs(realised), locale)} after fees.`, `Позицію закрито: ${realised >= 0 ? "заробіток" : "збиток"} ${usd(Math.abs(realised), locale)} з комісіями.`)
        : w(locale, "The position is closed; its result cannot be counted whole.", "Позицію закрито; її результат повністю не порахувати."),
    summaryDeviated: (count: number) => w(locale, `${count} trade(s) left the plan — see each one below.`, `Угод поза планом: ${count} — дивись кожну нижче.`),
    summaryFollowed: w(locale, "Every trade so far kept to the plan.", "Кожна угода поки трималась плану."),
  };
}

/** The critic's own lines on the model's output, and the plan's state in a word. */
export function stateWord(state: string, locale: Locale): string {
  const words: Record<string, readonly [string, string]> = {
    draft: ["Draft", "Чернетка"],
    checked: ["Checked", "Перевірено"],
    approved: ["Approved", "Схвалено"],
    watching: ["Watching", "Стежимо"],
    done: ["Done", "Виконано"],
    cancelled: ["Cancelled", "Скасовано"],
    broken: ["Broken", "Зламано"],
  };
  const pair = words[state] ?? [state, state];
  return pair[locale === "uk" ? 1 : 0];
}

export const plansW = w;
