import { PREDICTION_BUY_FEE } from "./facts.ts";
import { facts, list, note, p, section, steps, type DocPage } from "./model.ts";

/**
 * Прогнози — markets on outcomes through AGG, the row «Прогнози» of Торгівля and, on the web, predict.ryntra.io (which
 * leads into the same row). Documented as production has it: a simulation — orders on AGG's paper mode, no real funds,
 * deposits and withdrawals closed. Real money waits for the operator's switches (WP-10), so the page says what is true
 * now and promises nothing. The registered «predictions» page is off the documented surface in the route registry, so
 * this page names no `pageId`; «Open in Ryntra» leads to the row.
 */

export const PREDICTIONS_PAGE: DocPage = {
  slug: "trade/predictions",
  group: "predictions",
  destination: "predictions",
  title: { en: "Predictions", uk: "Прогнози" },
  seoTitle: { en: "Predictions: markets on outcomes — Ryntra Docs", uk: "Прогнози: ринки на події — Документація Ryntra" },
  summary: {
    en: "Markets on outcomes — elections, rates, crypto, sport — from the venues that price them, in one place; today a simulation with no real funds.",
    uk: "Ринки на події — вибори, ставки, крипта, спорт — з майданчиків, що їх оцінюють, в одному місці; сьогодні це симуляція без реальних коштів.",
  },
  sections: [
    section("what", "What Predictions are", "Що таке Прогнози", [
      p(
        "A prediction market prices a question with a yes or a no — «Will the rate be cut in December?» — and the price of Yes reads as the market's probability. Predictions in Ryntra gathers such markets from several venues through AGG, an aggregator: one list, one market page with its chart and probability, one ticket, and the route across the venues that price the same question.",
        "Ринок прогнозів оцінює питання з відповіддю «так» чи «ні» — «Чи знизять ставку в грудні?», — і ціна «Так» читається як імовірність, яку дає ринок. Прогнози в Ryntra збирають такі ринки з кількох майданчиків через агрегатор AGG: один список, одна сторінка ринку з графіком і ймовірністю, один квиток і маршрут через майданчики, що оцінюють те саме питання.",
      ),
      facts(
        [
          ["Mode today", "Simulation — a test environment; no real funds are used"],
          ["Venues", "Those AGG lists, among them Polymarket, Kalshi, Limitless and others; each fill names its venue"],
          ["Ryntra's fee", `${PREDICTION_BUY_FEE.en} of a buy, none on a sell — in the simulation shown, not taken`],
          ["Where", "Trading → Predictions on ryntra.io; predict.ryntra.io leads to the same place"],
          ["Without a wallet", "Every market, its chart and probability are open; the ticket and your positions need a wallet"],
        ],
        [
          ["Режим сьогодні", "Симуляція — тестове середовище; реальні кошти не використовуються"],
          ["Майданчики", "Ті, що має AGG, серед них Polymarket, Kalshi, Limitless та інші; кожне виконання називає свій майданчик"],
          ["Комісія Ryntra", `${PREDICTION_BUY_FEE.uk} купівлі, на продажі немає — у симуляції її показано, але не взято`],
          ["Де", "Торгівля → Прогнози на ryntra.io; predict.ryntra.io веде туди ж"],
          ["Без гаманця", "Кожен ринок, його графік і ймовірність відкриті; квиток і твої позиції — з гаманцем"],
        ],
      ),
    ]),
    section("how", "How to trade in the simulation", "Як торгувати в симуляції", [
      steps(
        [
          "Open Trading → Predictions. Search, or pick an order — Trending, New and the others — or a category.",
          "Open a market: its probability, its chart, its rules and the venues that price it.",
          "Connect your Solana wallet and sign a message to switch the simulation on — a signature that moves nothing and costs nothing. The simulated balance comes from AGG.",
          "On the ticket choose Yes or No and the amount, and read the Review: the price, the contracts you get, the venue and the costs, Ryntra's fee among them.",
          "Confirm. The simulated order fills, and the position, its result and the market's resolution stay on your Predictions page.",
        ],
        [
          "Відкрий Торгівля → Прогнози. Шукай або обери порядок — «У тренді», «Нові» та інші — чи категорію.",
          "Відкрий ринок: його ймовірність, графік, правила й майданчики, що його оцінюють.",
          "Підключи гаманець Solana й підпиши повідомлення, щоб увімкнути симуляцію, — підпис нічого не рухає й нічого не коштує. Симульований баланс дає AGG.",
          "На квитку обери «Так» чи «Ні» і суму та прочитай «Перевірку»: ціну, контракти, які отримаєш, майданчик і витрати, серед них комісію Ryntra.",
          "Підтверди. Симульований ордер виконується, а позиція, її результат і розв'язання ринку лишаються на твоїй сторінці Прогнозів.",
        ],
      ),
      note(
        "In the simulation nothing leaves your wallet and nothing can be won or lost: the balance, the fills and the results are AGG's test environment. Real money is not switched on — deposits and withdrawals are closed.",
        "У симуляції нічого не йде з гаманця, і нічого не можна виграти чи втратити: баланс, виконання й результати — тестове середовище AGG. Реальні гроші не ввімкнено — поповнення й виведення закриті.",
      ),
    ]),
    section("access", "Venues and access", "Майданчики й доступ", [
      list(
        [
          "Which venue may serve you is the venue's and AGG's rule for your location, not Ryntra's; where a venue is closed to you, its markets are shown for reading.",
          "Kalshi needs your own Kalshi account; Novig and ProphetX ask for an identity check.",
          "«Access not confirmed yet» means AGG has not read your access yet — always so for a guest.",
          "AGG may ask for a short bot check when you switch the simulation on.",
        ],
        [
          "Який майданчик може тебе обслуговувати — правило майданчика й AGG для твого місця, а не Ryntra; де майданчик тобі закритий, його ринки показано для читання.",
          "Kalshi потребує твого власного рахунку Kalshi; Novig і ProphetX просять перевірки особи.",
          "«Доступ ще не підтверджено» означає, що AGG ще не прочитав твого доступу, — у гостя так завжди.",
          "AGG може попросити коротку перевірку на бота, коли вмикаєш симуляцію.",
        ],
      ),
    ]),
    section("probability", "What a probability is, and is not", "Чим є ймовірність, а чим ні", [
      p(
        "A price of Yes is what traders are paying now, not a forecast Ryntra makes. Markets with little volume move on small orders, and the same question can trade at different prices on different venues — the page shows each venue's price beside the route's.",
        "Ціна «Так» — те, що трейдери платять зараз, а не прогноз Ryntra. Ринки з малим обсягом рухаються від невеликих ордерів, а те саме питання може торгуватися за різними цінами на різних майданчиках — сторінка показує ціну кожного майданчика поруч із ціною маршруту.",
      ),
      note(
        "Predictions are not in the phone app: open ryntra.io on the phone.",
        "У застосунку для телефона Прогнозів немає: відкрий ryntra.io на телефоні.",
      ),
    ]),
  ],
  related: ["trade/overview", "reference/fees", "reference/networks"],
};
