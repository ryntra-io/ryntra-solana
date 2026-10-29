import { PERPS } from "./facts.ts";
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Perps — Phoenix's perpetuals inside Ryntra on Solana (B7, B6, B6b; decision 56), the row «Perps» of Торгівля.
 * Documented as it works: orders and collateral are open to every wallet since 22.10, cross margin on the wallet's
 * Phoenix account, market and limit, TP/SL on the position. The registered «perps» page stays planned in the route
 * registry for the API's sake, so this page names no `pageId`: «Open in Ryntra» leads to the row. Every bound is read
 * from the ticket's own code (`lib/phoenix/orders-model.ts`, `collateral-model.ts`); Ryntra's builder rate lives on
 * chain, not in code, so the page says where it is shown rather than typing it.
 */

export const PERPS_PAGE: DocPage = {
  slug: "trade/perps",
  group: "perps",
  destination: "futures",
  title: { en: "Perps on Phoenix", uk: "Perps на Phoenix" },
  seoTitle: { en: "Perps on Phoenix, from your Solana wallet — Ryntra Docs", uk: "Perps на Phoenix з гаманця Solana — Документація Ryntra" },
  summary: {
    en: "Perpetual futures of Phoenix inside Ryntra: long or short with leverage, market or limit, TP/SL on the position — your collateral on your own Phoenix account.",
    uk: "Безстрокові ф'ючерси Phoenix у Ryntra: лонг чи шорт із плечем, ринковий чи лімітний ордер, TP/SL на позицію — застава на твоєму рахунку Phoenix.",
  },
  sections: [
    section("what", "What Perps are", "Що таке Perps", [
      p(
        "Perps is the row of Trading where you trade Phoenix's perpetual futures without leaving Ryntra: the markets Phoenix lists, its order book, the chart and your position, in one screen. A perpetual has no expiry; you hold a long or a short against your collateral, and the funding rate between longs and shorts is shown per hour. The orders go to Phoenix's program on Solana and your wallet signs every one of them — Ryntra never holds the collateral and cannot trade it.",
        "Perps — рядок Торгівлі, де ти торгуєш безстроковими ф'ючерсами Phoenix, не виходячи з Ryntra: ринки, які має Phoenix, його книга ордерів, графік і твоя позиція — на одному екрані. Безстроковий контракт не має дати експірації; ти тримаєш лонг чи шорт проти своєї застави, а фандинг між лонгами й шортами показано за годину. Ордери йдуть у програму Phoenix на Solana, і кожен підписує твій гаманець — Ryntra не тримає застави й не може нею торгувати.",
      ),
      facts(
        [
          ["Venue", "Phoenix, on Solana"],
          ["Markets", "Those Phoenix lists as open; SOL opens first. A market Phoenix trades on isolated margin only is shown for reading — its orders go on phoenix.trade"],
          ["Margin", "Cross margin on your Phoenix account"],
          ["Collateral", `USDC from your Solana wallet, ${PERPS.collateralMin} to ${PERPS.collateralMax.en} a move`],
          ["Smallest order", `${PERPS.minNotional} of notional`],
          ["Signature", "Your wallet's, for every order, change and close"],
        ],
        [
          ["Майданчик", "Phoenix, на Solana"],
          ["Ринки", "Ті, які Phoenix показує відкритими; першим відкривається SOL. Ринок, де Phoenix торгує лише з ізольованою маржею, показано для читання — його ордери ставлять на phoenix.trade"],
          ["Маржа", "Крос-маржа на твоєму рахунку Phoenix"],
          ["Застава", `USDC з твого гаманця Solana, від ${PERPS.collateralMin} до ${PERPS.collateralMax.uk} за раз`],
          ["Найменший ордер", `${PERPS.minNotional} номіналу`],
          ["Підпис", "Твого гаманця — на кожен ордер, зміну й закриття"],
        ],
      ),
      note(
        "Phoenix opens trading accounts by invitation. If your wallet has no Phoenix account, the page says so, and the ticket waits until there is one.",
        "Phoenix відкриває торгові рахунки за запрошенням. Якщо в твого гаманця немає рахунку Phoenix, сторінка про це скаже, і квиток чекатиме, доки рахунок з'явиться.",
      ),
    ]),
    section("collateral", "Collateral", "Застава", [
      steps(
        [
          "Open Perps and connect your Solana wallet.",
          "In the Collateral panel choose «Add collateral», type an amount of USDC and press Review: it shows what leaves the wallet and what reaches your Phoenix account.",
          "Sign in your wallet. The collateral is on your own Phoenix account; Withdraw brings USDC back to the same wallet the same way.",
        ],
        [
          "Відкрий Perps і підключи гаманець Solana.",
          "У панелі «Застава» обери «Поповнити», впиши суму USDC і натисни «Переглянути»: видно, що піде з гаманця і що дійде на твій рахунок Phoenix.",
          "Підпиши в гаманці. Застава лежить на твоєму власному рахунку Phoenix; «Вивести» повертає USDC на той самий гаманець так само.",
        ],
      ),
      p(
        "Ryntra takes nothing on a deposit or a withdrawal. Phoenix's own cost, when there is one, is shown as the difference between what leaves and what arrives.",
        "На поповненні й виведенні застави Ryntra нічого не бере. Власну витрату Phoenix, коли вона є, показано як різницю між тим, що пішло, і тим, що дійшло.",
      ),
    ]),
    section("order", "Opening and managing a position", "Відкрити й вести позицію", [
      steps(
        [
          "Choose the market, Long or Short, and the size in dollars or in the asset. The leverage slider runs from 1× to the market's tier maximum and sizes the order; the margin is cross.",
          `Choose Market or Limit. A market order carries a price tolerance — ${PERPS.tolerance.default} by default, from ${PERPS.tolerance.min} to ${PERPS.tolerance.max}; a limit that crosses the mark by more than ${PERPS.limitFar} is refused, since it would be a market order without its tolerance.`,
          "If you want, set TP/SL with a market order: a take profit and a stop loss on the whole position, triggered by the mark price.",
          "Press Long or Short. The Review shows the type, the worst or limit price, the tolerance and the mark; the position, leverage and liquidation price after; the collateral and free collateral after; funding per hour; TP/SL; and the costs — Phoenix, Ryntra, the network and the rent of the TP/SL account. It is valid for about thirty seconds.",
          "Sign in your wallet. The position, its entry, mark and result appear under the chart and in Portfolio.",
          "Manage the position — Cut, Close or TP/SL — or cancel an open limit, each through its own Review and signature.",
        ],
        [
          "Обери ринок, «Лонг» чи «Шорт» і розмір у доларах чи в активі. Повзунок плеча йде від 1× до максимуму рівня ринку й задає розмір ордера; маржа — крос.",
          `Обери «Ринок» чи «Ліміт». Ринковий ордер має допуск ціни — ${PERPS.toleranceUk.default} за замовчуванням, від ${PERPS.toleranceUk.min} до ${PERPS.toleranceUk.max}; ліміт, що перетинає марк більше ніж на ${PERPS.toleranceUk.max}, відхиляється, бо це ринковий ордер без допуску.`,
          "За бажанням постав TP/SL разом із ринковим ордером: тейк-профіт і стоп-лос на всю позицію, що спрацьовують за марк-ціною.",
          "Натисни «Лонг» чи «Шорт». «Перевірка» показує тип, найгіршу чи лімітну ціну, допуск і марк; позицію, плече й ціну ліквідації після; заставу й вільну заставу після; фандинг за годину; TP/SL; і витрати — Phoenix, Ryntra, мережа й рента рахунку TP/SL. Вона дійсна близько тридцяти секунд.",
          "Підпиши в гаманці. Позиція, її вхід, марк і результат з'являються під графіком і в Портфелі.",
          "«Керувати» позицією — «Зменшити», «Закрити» чи TP/SL — або скасуй відкритий ліміт, кожне через свою «Перевірку» і підпис.",
        ],
      ),
      note(
        `A stop is a trigger, not a promised price: in a fast market it may fill up to ${PERPS.stopSlippage} away from its trigger. With leverage a small move against you can liquidate the position and take its collateral — read the liquidation price in the Review before you sign.`,
        `Стоп — це тригер, а не обіцяна ціна: на швидкому ринку він може виконатися до ${PERPS.stopSlippage} від свого тригера. З плечем невеликий рух проти тебе може ліквідувати позицію й забрати її заставу — прочитай ціну ліквідації у «Перевірці» до підпису.`,
        "caution",
      ),
    ]),
    section("costs", "What a trade costs", "Скільки коштує угода", [
      table(
        { en: ["Cost", "Who receives it", "When"], uk: ["Витрата", "Хто отримує", "Коли"] },
        {
          en: [
            ["Phoenix's trading fee", "Phoenix", "Every fill, at Phoenix's rate"],
            ["Ryntra's builder fee", "Ryntra, through Phoenix's builder program", "Only on the part of an order that fills at once, at the rate registered on chain; shown in the Review — with its amount on a market order, as a rate on a limit"],
            ["Funding", "Longs or shorts, whichever side pays", "Every hour the position is open"],
            ["TP/SL account rent", "Your own account on chain", "The first time a position carries TP/SL"],
            ["Network fee", "The Solana network", "Every transaction"],
          ],
          uk: [
            ["Торгова комісія Phoenix", "Phoenix", "Кожне виконання, за ставкою Phoenix"],
            ["Комісія білдера Ryntra", "Ryntra — через програму білдерів Phoenix", "Лише на частину ордера, що виконується одразу, за ставкою, записаною в ланцюгу; видно у «Перевірці» — із сумою на ринковому ордері, ставкою на ліміті"],
            ["Фандинг", "Лонги чи шорти — та сторона, що платить", "Щогодини, поки позиція відкрита"],
            ["Рента рахунку TP/SL", "Твій власний рахунок у ланцюгу", "Уперше, коли позиція має TP/SL"],
            ["Плата мережі", "Мережа Solana", "Кожна транзакція"],
          ],
        },
      ),
      list(
        [
          "A resting limit that fills later, as a maker, carries no Ryntra fee.",
          "A position opened on phoenix.trade in isolated margin is shown here read-only; manage it there.",
          "Perps are not in the phone app: open ryntra.io on the phone to trade them.",
        ],
        [
          "Ліміт, що стоїть і виконується пізніше, як мейкер, не має комісії Ryntra.",
          "Позицію з ізольованою маржею, відкриту на phoenix.trade, тут показано лише для перегляду; веди її там.",
          "У застосунку для телефона Perps немає: щоб торгувати ними, відкрий ryntra.io на телефоні.",
        ],
      ),
    ]),
  ],
  related: ["reference/fees", "manage/portfolio", "reference/review"],
};
