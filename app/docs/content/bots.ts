import { AUTOINVEST, GRID } from "./facts.ts";

/** «24 години», «12 годин», «1 година» — Ukrainian counts its hours by the number. */
const hoursUk = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? `${n} година` : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? `${n} години` : `${n} годин`);
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Боти й грід — the row «Боти» of Автоматика: everything that runs on a person's rule, and the Catalog of what can be
 * set up (`lib/product/strategy-types.ts`: Grid, Recurring buy, Trade plan are available; the planned types are drawn
 * nowhere and documented nowhere). Said as production does it: a recurring buy reminds and the person signs each buy;
 * a trade plan warns and never sells by itself; a grid is one Meteora DLMM position the person's wallet places and
 * stops, whose levels the pool fills. The detailed pages — Recurring buy (`invest/autoinvest`), the strategy cycle,
 * My strategies, Results — keep their addresses under this section.
 */

export const BOTS_PAGE: DocPage = {
  slug: "bots",
  group: "bots",
  destination: "bots",
  title: { en: "Bots and grid", uk: "Боти й грід" },
  seoTitle: { en: "Bots and grid on Solana — Ryntra Docs", uk: "Боти й грід на Solana — Документація Ryntra" },
  summary: {
    en: "Everything that runs on your rule — a grid in a Meteora pool, a recurring buy, a trade plan — each placed, changed and stopped by your own signature.",
    uk: "Усе, що працює за твоїм правилом, — грід у пулі Meteora, регулярна купівля, план угоди, — кожен ставиш, змінюєш і зупиняєш своїм підписом.",
  },
  sections: [
    section("what", "What Bots are", "Що таке Боти", [
      p(
        "Automation → Bots is one list of what runs on your rule: your grids, your recurring-buy rules and your trade plans, each with its result, and the Catalog — what you can set up today. No bot holds your keys or a standing permission over your wallet: what moves money is placed by your signature, and what only watches the market tells you when to look.",
        "Автоматика → Боти — один список того, що працює за твоїм правилом: твої гріди, правила регулярної купівлі й плани угод, кожен зі своїм результатом, і «Каталог» — що можна налаштувати вже сьогодні. Жоден бот не тримає твоїх ключів чи постійного дозволу на гаманець: те, що рухає гроші, ставиться твоїм підписом, а те, що лише стежить за ринком, каже тобі, коли подивитися.",
      ),
      table(
        { en: ["Bot", "What it does", "Who acts"], uk: ["Бот", "Що робить", "Хто діє"] },
        {
          en: [
            ["Grid", "Levels in a Meteora DLMM pool: buys below the price, sells above, or both", "You place and stop it; the pool fills each level on its own"],
            ["Recurring buy", "A buy on a schedule, if the price falls, or from every payment", "Ryntra reminds you; you sign each buy"],
            ["Trade plan", "Your rules for one trade: entry, size, stop and target", "Ryntra checks the order against it and warns at the stop or target; you sign every trade"],
          ],
          uk: [
            ["Грід", "Рівні в пулі Meteora DLMM: купівля нижче ціни, продаж вище або обидва боки", "Ставиш і зупиняєш ти; кожен рівень пул виконує сам"],
            ["Регулярна купівля", "Купівля за розкладом, якщо ціна впаде, або з кожної оплати", "Ryntra нагадує; кожну купівлю підписуєш ти"],
            ["План угоди", "Твої правила однієї угоди: вхід, розмір, стоп і ціль", "Ryntra звіряє ордер із планом і попереджає на стопі чи цілі; кожну угоду підписуєш ти"],
          ],
        },
      ),
    ]),
    section("grid", "The grid", "Грід", [
      p(
        "A grid is one position in a Meteora DLMM pool, spread over the pool's own price steps. Placed below the price it waits and buys as the price falls; above it, it sells as the price rises; on both sides each fill can turn back the other way. The pool fills the levels on its own — no server of Ryntra's signs anything for you in between — and the trading fees of each fill accrue to your position.",
        "Грід — одна позиція в пулі Meteora DLMM, розкладена по власних кроках ціни пулу. Поставлений нижче ціни, він чекає й купує, коли ціна падає; вище — продає, коли вона росте; з обох боків кожне виконання може повернутися назад. Рівні пул виконує сам — жоден сервер Ryntra нічого за тебе між ними не підписує, — а торгові комісії кожного виконання накопичуються на твоїй позиції.",
      ),
      steps(
        [
          "Open Bots → Catalog → Grid and choose a pool: search a token or a pair; the list shows each pool's step, volume, liquidity and fee.",
          `Choose how it trades — Buy below, Sell above or Both sides — the levels (${GRID.levels}; ${GRID.defaultLevels} to start) and the budget. The form shows the range, the step between levels and what stands at each.`,
          "Press Review and sign. The grid appears under Grids on the Bots page, with its result.",
          "Collect fees whenever you want — the levels stay and keep working — or Stop: the position closes and its tokens and the account's rent come back to your wallet — each through a Review and your signature.",
        ],
        [
          "Відкрий Боти → Каталог → Грід і обери пул: знайди токен чи пару; список показує крок кожного пулу, обсяг, ліквідність і комісію.",
          `Обери, як він торгує, — «Купівля нижче», «Продаж вище» чи «Обидва боки», — рівні (${GRID.levels}; на старті ${GRID.defaultLevels}) і бюджет. Форма показує діапазон, крок між рівнями й що стоїть на кожному.`,
          "Натисни «Перевірка» й підпиши. Грід з'явиться в розділі «Гріди» сторінки «Боти» зі своїм результатом.",
          "«Забрати комісії» — коли хочеш, рівні лишаються й працюють далі; або «Зупинити»: позиція закривається, а її токени й рента рахунку повертаються в гаманець — кожне через «Перевірку» і твій підпис.",
        ],
      ),
      list(
        [
          "Ryntra adds no fee to a grid; the pool's own trading fee is paid by the traders who fill your levels and earned by you.",
          "A grid is a liquidity position, not a promise: if the price leaves the range, the grid stops filling and holds what it bought or sold.",
          "The grid's card is kept in the browser that placed it; in another browser the same position shows under Pools.",
        ],
        [
          "Ryntra не додає до гріда своєї комісії; власну торгову комісію пулу платять трейдери, що виконують твої рівні, а дістається вона тобі.",
          "Грід — позиція ліквідності, а не обіцянка: якщо ціна виходить за діапазон, грід перестає виконуватись і тримає те, що купив чи продав.",
          "Картка гріда зберігається в браузері, де його поставили; в іншому браузері та сама позиція видна в «Пулах».",
        ],
      ),
    ]),
    section("recurring", "Recurring buy", "Регулярна купівля", [
      p(
        "A recurring-buy rule names a token and a sum and when to buy: on a schedule, if the price falls, or from every payment that arrives. On the day Ryntra reminds you in Notifications — and in Telegram once it is connected — and the reminder opens the purchase with the sum filled in; you read the Review and sign. Nothing is bought without that signature, and a missed day is never caught up.",
        "Правило регулярної купівлі називає токен, суму й коли купувати: за розкладом, якщо ціна впаде, або з кожної оплати, що надходить. У день покупки Ryntra нагадує в «Сповіщеннях» — і в Telegram, коли його підключено, — а нагадування відкриває купівлю з уже вписаною сумою; ти читаєш «Перевірку» і підписуєш. Без цього підпису нічого не купується, а пропущений день ніколи не наздоганяється.",
      ),
      facts(
        [
          ["Tokens", `Stocks, coins and memes; a meme or a new token from ${AUTOINVEST.floorUsd.en} of liquidity and ${AUTOINVEST.floorHours} hours on the market`],
          ["A purchase", `From ${AUTOINVEST.minimum}`],
          ["Rules per wallet", `Up to ${AUTOINVEST.rules}`],
          ["A reminder stays open", `${AUTOINVEST.reminderHours} hours`],
          ["Ryntra's fee", "None of its own — the purchase pays the same fee as any purchase of that token"],
        ],
        [
          ["Токени", `Акції, монети й меми; мем чи новий токен — від ${AUTOINVEST.floorUsd.uk} ліквідності й ${hoursUk(AUTOINVEST.floorHours)} на ринку`],
          ["Купівля", `Від ${AUTOINVEST.minimum}`],
          ["Правил на гаманець", `До ${AUTOINVEST.rules}`],
          ["Нагадування відкрите", hoursUk(AUTOINVEST.reminderHours)],
          ["Комісія Ryntra", "Власної немає — купівля платить ту саму комісію, що й будь-яка купівля цього токена"],
        ],
      ),
    ]),
    section("plan", "Trade plan", "План угоди", [
      p(
        "A trade plan is your own rules for one trade — the entry, the size computed from your risk and budget, the stop and the target — saved with its version. Trading under it opens Spot with the plan named, and the Review checks the order against the plan and refuses what is outside it. When the price reaches the stop or the target, Ryntra notifies you; no sale is placed by itself, and what you do then is your decision and your signature.",
        "План угоди — твої власні правила однієї угоди: вхід, розмір, порахований з твого ризику й бюджету, стоп і ціль, — збережені з версією. Торгівля за ним відкриває Спот із названим планом, а «Перевірка» звіряє ордер із планом і відмовляє в тому, що поза ним. Коли ціна доходить до стопу чи цілі, Ryntra сповіщає тебе; жоден продаж сам не ставиться, а що робити далі — твоє рішення й твій підпис.",
      ),
      note(
        "A bot is a rule you set, not advice and not a promise of profit. Ryntra never trades for you: the grid's levels are filled by the pool you chose, and every other buy and sell is your own signature.",
        "Бот — правило, яке ставиш ти, а не порада й не обіцянка прибутку. Ryntra ніколи не торгує за тебе: рівні гріда виконує пул, який ти обрав, а кожну іншу купівлю й продаж — твій власний підпис.",
      ),
    ]),
  ],
  related: ["invest/autoinvest", "strategies/my-strategies", "manage/pools"],
};
