import { CREATOR_LOCK_IDS, CREATOR_LOCK_SCHEDULES } from "../../../lib/core/launch/creator-lock.ts";
import { LAUNCH_PRESETS } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Launch — «Запустити токен» and «Мої лаунчі», as the menu's «Лаунч» draws
 * them since 2026-10-06. Every number is read from the presets' own file, the
 * one the configs on chain were built from, so the page cannot say a fee the
 * chain does not charge. «Спільнота» has no config on mainnet yet (one is made
 * per community token), so the page documents the two presets people can pick.
 */

const CLASSIC = LAUNCH_PRESETS.classic;
const PROTECTED = LAUNCH_PRESETS.protected;
const pct = (bps: number) => `${bps / 100}`.replace(/\.0+$/, "");
const usd = (value: number) => `$${value.toLocaleString("en-US")}`;
const usdUk = (value: number) => `$${value.toLocaleString("en-US").replace(/,/g, " ")}`;
const minutes = (seconds: number) => seconds / 60;
const months = (days: number) => Math.round(days / 30);
const LOCKS_EN = CREATOR_LOCK_IDS.map((id) => `${months(CREATOR_LOCK_SCHEDULES[id].cliffDays)} + ${months(CREATOR_LOCK_SCHEDULES[id].vestDays)} months`).join(" · ");
const LOCKS_UK = CREATOR_LOCK_IDS.map((id) => `${months(CREATOR_LOCK_SCHEDULES[id].cliffDays)} + ${months(CREATOR_LOCK_SCHEDULES[id].vestDays)} міс.`).join(" · ");

export const LAUNCH: DocPage = {
  slug: "launch/launch-a-token",
  group: "launch",
  destination: "launch",
  title: { en: "Launch a token", uk: "Запустити токен" },
  seoTitle: { en: "Launch a token on Solana — Ryntra Docs", uk: "Запустити токен на Solana — Документація Ryntra" },
  summary: {
    en: "Your token on a bonding curve in one signature. Snipers pay more, liquidity stays locked for ever, and every fair-launch mark is an account you can open.",
    uk: "Твій токен на кривій одним підписом. Снайпери платять більше, ліквідність замкнена назавжди, а кожна позначка чесного лаунчу — рахунок, який можна відкрити.",
  },
  sections: [
    section("what", "What Launch is", "Що таке Лаунч", [
      p(
        "Launch makes a new token on Solana and opens its market at once, on a bonding curve of Meteora's Dynamic Bonding Curve program: the price rises as people buy and falls as they sell, and the money buyers pay stays in the curve — the program holds it, not the creator and not Ryntra. When the curve fills, the token moves to a pool on a DEX by itself, and trading goes on there.",
        "Лаунч створює новий токен на Solana й одразу відкриває його ринок — на кривій програми Meteora Dynamic Bonding Curve: ціна росте, коли купують, і падає, коли продають, а гроші покупців лишаються в кривій — їх тримає програма, а не творець і не Ryntra. Коли крива заповнюється, токен сам переходить у пул на DEX, і торгівля йде далі там.",
      ),
      facts(
        [
          ["Network", "Solana"],
          ["Token", "Token-2022, a fixed supply of 1 000 000 000, 6 decimals"],
          ["Pays in", "USDC"],
          ["Curve", `From ${usd(CLASSIC.curve.startMarketCapUsd)} to ${usd(CLASSIC.curve.graduationMarketCapUsd)} of market cap; then a DEX pool`],
          ["Your signature", "One wallet window: the token, your first purchase if you want one, its lock if you choose it"],
          ["What it costs to create", "No creation fee; the network's rent and fee for the new accounts, shown before you sign"],
        ],
        [
          ["Мережа", "Solana"],
          ["Токен", "Token-2022, фіксована пропозиція 1 000 000 000, 6 знаків"],
          ["Валюта", "USDC"],
          ["Крива", `Від ${usdUk(CLASSIC.curve.startMarketCapUsd)} до ${usdUk(CLASSIC.curve.graduationMarketCapUsd)} капіталізації; далі пул на DEX`],
          ["Твій підпис", "Одне вікно гаманця: токен, твоя перша покупка, якщо хочеш, і її замок, якщо обереш"],
          ["Скільки коштує створити", "Плати за створення немає; оренда й комісія мережі за нові рахунки — видно до підпису"],
        ],
      ),
    ]),
    section("presets", "Two presets", "Два пресети", [
      table(
        { en: ["", CLASSIC.name.en, PROTECTED.name.en], uk: ["", CLASSIC.name.uk, PROTECTED.name.uk] },
        {
          en: [
            ["Fee for snipers", `${pct(CLASSIC.sniperFee.startBps)} % falling to ${pct(CLASSIC.sniperFee.endBps)} % over ${minutes(CLASSIC.sniperFee.seconds)} minutes`, `${pct(PROTECTED.sniperFee.startBps)} % falling to ${pct(PROTECTED.sniperFee.endBps)} % over ${minutes(PROTECTED.sniperFee.seconds)} minutes`],
            ["Fee after that", `${pct(CLASSIC.sniperFee.endBps)} %, higher while the price swings`, `${pct(PROTECTED.sniperFee.endBps)} %, higher while the price swings`],
            ["Your first purchase", `Up to ${pct(CLASSIC.creatorFirstBuyCapBps)} % of the supply`, `Up to ${pct(PROTECTED.creatorFirstBuyCapBps)} % of the supply`],
            ["Your share of the curve's fee", `${CLASSIC.creatorTradingFeePct} % of what is left after Meteora's part`, `${PROTECTED.creatorTradingFeePct} % of what is left after Meteora's part`],
            ["Graduation fee", `${CLASSIC.graduationFee.pct} % of the threshold, ${CLASSIC.graduationFee.creatorPct} % of it yours`, `${PROTECTED.graduationFee.pct} % of the threshold, ${PROTECTED.graduationFee.creatorPct} % of it yours`],
            ["Liquidity after the DEX", "Yours and Ryntra's locked for ever, 100 %; you keep earning its fees", "The same"],
          ],
          uk: [
            ["Комісія для снайперів", `${pct(CLASSIC.sniperFee.startBps)} %, що спадає до ${pct(CLASSIC.sniperFee.endBps)} % за ${minutes(CLASSIC.sniperFee.seconds)} хв`, `${pct(PROTECTED.sniperFee.startBps)} %, що спадає до ${pct(PROTECTED.sniperFee.endBps)} % за ${minutes(PROTECTED.sniperFee.seconds)} хв`],
            ["Комісія потім", `${pct(CLASSIC.sniperFee.endBps)} %, вища, поки ціна скаче`, `${pct(PROTECTED.sniperFee.endBps)} %, вища, поки ціна скаче`],
            ["Твоя перша покупка", `До ${pct(CLASSIC.creatorFirstBuyCapBps)} % пропозиції`, `До ${pct(PROTECTED.creatorFirstBuyCapBps)} % пропозиції`],
            ["Твоя частка комісії кривої", `${CLASSIC.creatorTradingFeePct} % того, що лишається після частки Meteora`, `${PROTECTED.creatorTradingFeePct} % того, що лишається після частки Meteora`],
            ["Комісія виходу на DEX", `${CLASSIC.graduationFee.pct} % порогу, з них ${CLASSIC.graduationFee.creatorPct} % — твої`, `${PROTECTED.graduationFee.pct} % порогу, з них ${PROTECTED.graduationFee.creatorPct} % — твої`],
            ["Ліквідність після DEX", "Твоя й Ryntra замкнені назавжди, 100 %; комісії з неї ти отримуєш і далі", "Так само"],
          ],
        },
      ),
      note(
        "«Protected» is chosen for you: its fee for snipers is higher and lasts longer, so the first minutes belong to the people who follow you, not to bots. A preset is written into its config on chain for ever — nobody, Ryntra included, can change it for a token already launched.",
        "«Захищений» обрано за замовчуванням: його комісія для снайперів вища й триває довше, тож перші хвилини належать людям, що йдуть за тобою, а не ботам. Пресет записано в його конфіг у ланцюгу назавжди — ніхто, зокрема Ryntra, не змінить його для вже запущеного токена.",
      ),
    ]),
    section("how", "How to launch", "Як запустити", [
      steps(
        [
          "Open Launch → Launch a token and connect your wallet.",
          "Add a picture, a name, a ticker, a few words and your links (website, X, Telegram). A name or ticker that borrows a known brand or person is refused, with the names it reads as.",
          "Pick a preset.",
          `If you want, buy first: the purchase lands in the same transaction that opens the curve, at the base fee and under the preset's cap. You can lock it with a vesting schedule — ${LOCKS_EN} — and the token's page shows «The creator locked their purchase».`,
          "Read «Before you sign»: the network, the preset, your purchase and its lock, and what the network takes in SOL. Then sign once.",
          "Your token's page opens: share its link. Its picture, name and links can never change.",
        ],
        [
          "Відкрий Лаунч → «Запустити токен» і під'єднай гаманець.",
          "Додай картинку, назву, тікер, кілька слів і посилання (сайт, X, Telegram). Назву чи тікер, що позичає відомий бренд або людину, буде відхилено — з назвами, на які вони схожі.",
          "Обери пресет.",
          `Якщо хочеш, купи першим: покупка йде в тій самій транзакції, що відкриває криву, за базовою комісією і під стелею пресету. Її можна замкнути з вестингом — ${LOCKS_UK} — і сторінка токена покаже «Творець заблокував свою покупку».`,
          "Прочитай «Перед підписом»: мережа, пресет, твоя покупка і її замок, і що мережа візьме в SOL. Потім підпиши один раз.",
          "Відкривається сторінка токена: поділися посиланням. Картинку, назву й посилання змінити неможливо.",
        ],
      ),
      note(
        "One wallet launches at most three tokens a day. Ryntra pays the rent of a new token's accounts and your wallet pays it back in the same transaction — that is the SOL «Before you sign» shows.",
        "Один гаманець запускає щонайбільше три токени на добу. Оренду нових рахунків токена платить Ryntra, а твій гаманець повертає її в тій самій транзакції — це і є SOL, який показує «Перед підписом».",
      ),
    ]),
    section("fair", "A fair launch you can check", "Чесний лаунч, який можна перевірити", [
      list(
        [
          "The money buyers pay stays in the curve: the program holds it, and nobody can pull it.",
          "No one can mint more: the right to mint is given up when the token is made, the supply is fixed.",
          "No one can freeze a holder's tokens, and no transfer hook runs on them.",
          "The name, the ticker and the picture can never change.",
          "After the DEX, the creator's liquidity and Ryntra's are locked for ever, 100 %.",
          "Each of these is a mark on the token's page, and each mark opens the account on chain that proves it.",
        ],
        [
          "Гроші покупців лишаються в кривій: їх тримає програма, і забрати їх не може ніхто.",
          "Ніхто не може випустити більше: право випуску віддано при створенні, пропозиція фіксована.",
          "Ніхто не може заморозити токени холдера, і жоден transfer hook на них не діє.",
          "Назву, тікер і картинку змінити неможливо.",
          "Після DEX ліквідність творця й Ryntra замкнена назавжди, 100 %.",
          "Кожне з цього — позначка на сторінці токена, і кожна відкриває рахунок у ланцюгу, що це доводить.",
        ],
      ),
      p(
        "What cannot be forbidden is made visible. A token's page labels its holders — the creator, snipers (bought in the first two minutes after the curve opens, whatever the preset's fee) and a bundle (bought in the creation's block, or paid for by the creator's wallet) — with their shares, says «The creator sold» with the transaction when they did, lists the creator's earlier launches and what happened to them, and shows facts of risk with their reasons — facts, never a verdict.",
        "Те, чого заборонити неможливо, стає видимим. Сторінка токена позначає холдерів — творець, снайпери (купили в перші дві хвилини після відкриття кривої, хоч скільки триває комісія пресету) і бандл (купили в блоці створення або коштом гаманця творця) — з їхніми частками, каже «Творець продав» із транзакцією, коли він продав, показує попередні лаунчі творця і що з ними сталося, і факти ризику з причинами — факти, ніколи не вирок.",
      ),
    ]),
    section("trade", "Trading a launch", "Торгівля токеном лаунчу", [
      p(
        `Buy and sell on the token's page: on the curve with Meteora's own instruction, after the DEX in its pool — one transaction your wallet signs and pays, with the fee, the slippage and «at least» shown before you sign. Ryntra adds no fee of its own on the curve or in the pool: it earns as the partner of the config — ${100 - CLASSIC.creatorTradingFeePct} % of the curve's fee after Meteora's part, ${100 - CLASSIC.graduationFee.creatorPct} % of the graduation fee, and the fees of its own locked liquidity after the DEX. A graduated token can also be swapped in Swap, at Swap's own fee.`,
        `Купуй і продавай на сторінці токена: на кривій — власною інструкцією Meteora, після DEX — у його пулі; одна транзакція, яку підписує й оплачує твій гаманець, з комісією, прослизанням і «щонайменше» до підпису. Ryntra не додає своєї комісії ні на кривій, ні в пулі: вона заробляє як партнер конфігу — ${100 - CLASSIC.creatorTradingFeePct} % комісії кривої після частки Meteora, ${100 - CLASSIC.graduationFee.creatorPct} % комісії виходу на DEX і комісії власної замкненої ліквідності після DEX. Токен, що вийшов на DEX, можна обміняти й в Обміні — за комісією Обміну.`,
      ),
    ]),
    section("log", "The flight log", "Бортовий журнал", [
      p(
        "Every token's page keeps its flight log: what happened to the token, the newest first, each entry with its time, its amount and the transaction anyone can open — the launch and the creator's first purchase, the creator's lock, every sale of the creator's with the share of what they bought sold by then, and the graduation to the DEX with who sent it. Anyone may send a full curve's graduation — Ryntra's executor, Meteora itself or any wallet — and the log names whoever did.",
        "Сторінка кожного токена веде бортовий журнал: що відбувалося з токеном, найновіше зверху, кожен запис — з часом, сумою й транзакцією, яку може відкрити будь-хто: запуск і перша покупка творця, замок творця, кожен продаж творця з часткою куплених, проданих на той момент, і вихід на DEX — із тим, хто його запустив. Вихід повної кривої може надіслати будь-хто — виконавець Ryntra, сама Meteora чи будь-який гаманець, — і журнал називає того, хто це зробив.",
      ),
      p(
        "When Ryntra places its Fee-Funded Liquidity Ladder on a graduated token — buy steps below the market, funded from Ryntra's own fees on that token — the log and the page show it as it stands: how much is in it, the prices it buys at, what it has bought and holds, and every move up after the price, each with its transaction. It is liquidity and nothing more: it promises no price, what it buys it never sells into a fall, and unlike the share of the DEX pool it is not locked.",
        "Коли Ryntra ставить на токен, що вийшов на DEX, Драбину ліквідності з комісій — сходинки на купівлю під ринком, з комісій самої Ryntra на цьому токені, — журнал і сторінка показують її такою, як вона є: скільки в ній, за якими цінами вона купує, що купила й тримає, і кожен підйом слідом за ціною — кожен із транзакцією. Це ліквідність і нічого більше: ціни вона не обіцяє, куплене в падіння не продає, і на відміну від частки в пулі DEX вона не замкнена.",
      ),
      p(
        "Ryntra's executor watches every market launched on Ryntra and acts only by the policies the token's page lists: it sends the move to the DEX as soon as a curve fills — and sends it again itself if it does not go through — and keeps the ladder where Ryntra has placed one. The log notes its first pass over a market and each state the market moves into after the curve: the core market on the DEX, the ladder's budget, the ladder placed, its upkeep, maturity after thirty days. Ryntra's operator can stop the executor on one market or on every market; each stop and each resume is in the log, and while a market is stopped Ryntra signs nothing on it.",
        "Виконавець Ryntra стежить за кожним ринком, запущеним на Ryntra, і діє лише за політиками, які показує сторінка токена: надсилає вихід на DEX, щойно крива набере поріг, — і надсилає знову сам, якщо вихід не пройшов, — і тримає драбину там, де Ryntra її поставила. Журнал записує його перший прохід над ринком і кожен стан, у який ринок переходить після кривої: основний ринок на DEX, бюджет драбини, драбина розміщена, обслуговування, зрілість після тридцяти днів. Оператор Ryntra може зупинити виконавця на одному ринку чи на всіх; кожна зупинка й кожне відновлення — у журналі, а поки ринок зупинено, Ryntra нічого на ньому не підписує.",
      ),
    ]),
    section("mine", "My launches", "Мої лаунчі", [
      p(
        "Launch → My launches is your creator's cabinet: each of your tokens with its way to the DEX, its volume and holders, and what it earned you by source — the curve's fee, the graduation fee, your locked liquidity's fees — every figure a program's own counter, never an estimate. «Claim» takes everything waiting in one transaction your wallet signs, and keeps a receipt read from the programs' own events.",
        "Лаунч → «Мої лаунчі» — твій кабінет творця: кожен твій токен із шляхом до DEX, обсягом і холдерами, і що він тобі заробив по джерелах — комісія кривої, комісія виходу на DEX, комісії твоєї замкненої ліквідності; кожна цифра — лічильник самої програми, ніколи не оцінка. «Забрати» бере все, що чекає, однією транзакцією, яку підписує твій гаманець, і зберігає квитанцію з подій самих програм.",
      ),
      note(
        "A launch is not an investment Ryntra offers, and nothing here promises a price. Anyone can launch a token; read its page — its marks, its holders, its facts — before you buy.",
        "Лаунч — не інвестиція, яку пропонує Ryntra, і ніщо тут не обіцяє ціни. Токен може запустити будь-хто; прочитай його сторінку — позначки, холдерів, факти — перед покупкою.",
      ),
    ]),
  ],
  related: ["trade/swap", "reference/fees", "start/cabinet"],
};

export const LAUNCH_PAGES: readonly DocPage[] = [LAUNCH];
