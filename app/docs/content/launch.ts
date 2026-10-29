import { CREATOR_LOCK_IDS, CREATOR_LOCK_SCHEDULES } from "../../../lib/core/launch/creator-lock.ts";
import { termsOf } from "../../../lib/core/launch/preset-terms.ts";
import { LAUNCH_PRESETS } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { facts, list, note, p, section, steps, table, type DocPage } from "./model.ts";

/**
 * Launch — «Запустити токен» and «Мої лаунчі»: the row «Лаунч» of Торгівля (Menu 3) with both of them on its page.
 * Every number is read from the presets' own file, the one the configs on chain were built from, and every share of a
 * fee from `presetTerms` — the same terms the form and the review show — so the page cannot say a fee the chain does
 * not charge. «Спільнота» has no config on mainnet yet (one is made
 * per community token), so the page documents the three presets people can pick —
 * Класичний, Захищений and Micro. The demo market is Ryntra's own technical
 * validation and is not documented for people.
 */

const CLASSIC = LAUNCH_PRESETS.classic;
const PROTECTED = LAUNCH_PRESETS.protected;
const MICRO = LAUNCH_PRESETS.micro;
const CLASSIC_TERMS = termsOf(CLASSIC);
const MICRO_TERMS = termsOf(MICRO);
const round = (value: number) => Math.round(value);
const microLockMonths = Math.round((MICRO.creatorLockMinDays ?? 0) / 30);
const pct = (bps: number) => `${bps / 100}`.replace(/\.0+$/, "");
/* The same figure as Ukrainian writes it, with a decimal comma. */
const pctUk = (bps: number) => pct(bps).replace(".", ",");
const curveSplitEn = (terms: typeof CLASSIC_TERMS) => `You ${pct(terms.curve.split.creatorBps)} % · Ryntra ${pct(terms.curve.split.ryntraBps)} % · Meteora ${pct(terms.curve.split.meteoraBps)} %`;
const curveSplitUk = (terms: typeof CLASSIC_TERMS) => `Тобі ${pctUk(terms.curve.split.creatorBps)} % · Ryntra ${pctUk(terms.curve.split.ryntraBps)} % · Meteora ${pctUk(terms.curve.split.meteoraBps)} %`;
const poolSplitEn = (terms: typeof CLASSIC_TERMS) => `You ${pct(terms.pool.creatorPositionBps)} % · Ryntra ${pct(terms.pool.ryntraPositionBps)} % · back into the pool ${pct(terms.pool.compoundingBps)} % · Meteora ${pct(terms.pool.meteoraBps)} %`;
const poolSplitUk = (terms: typeof CLASSIC_TERMS) => `Тобі ${pctUk(terms.pool.creatorPositionBps)} % · Ryntra ${pctUk(terms.pool.ryntraPositionBps)} % · назад у пул ${pctUk(terms.pool.compoundingBps)} % · Meteora ${pctUk(terms.pool.meteoraBps)} %`;
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
    en: "Your token on a bonding curve in one signature. Snipers pay more, the DEX exit liquidity stays locked for ever, every fair-launch mark is an account to open.",
    uk: "Твій токен на кривій одним підписом. Снайпери платять більше, ліквідність виходу на DEX замкнена назавжди, кожна позначка чесного лаунчу — рахунок у ланцюгу.",
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
          ["Token", "Token-2022, a fixed supply of 1,000,000,000, 6 decimals"],
          ["Pays in", "USDC"],
          ["Curve", `From ${usd(CLASSIC.curve.startMarketCapUsd)} to ${usd(CLASSIC.curve.graduationMarketCapUsd)} of market cap; on Micro from ${usd(round(MICRO.curve.startMarketCapUsd))} to ${usd(round(MICRO.curve.graduationMarketCapUsd))}, ${MICRO.curve.graduationQuote} USDC raised; then a DEX pool`],
          ["Your signature", "One wallet window: the token, your first purchase if you want one, its lock if you choose it — always on Micro"],
          ["What it costs to create", "No creation fee; the network's rent and fee for the new accounts, shown before you sign"],
        ],
        [
          ["Мережа", "Solana"],
          ["Токен", "Token-2022, фіксована пропозиція 1 000 000 000, 6 знаків"],
          ["Валюта", "USDC"],
          ["Крива", `Від ${usdUk(CLASSIC.curve.startMarketCapUsd)} до ${usdUk(CLASSIC.curve.graduationMarketCapUsd)} капіталізації; на Micro — від ${usdUk(round(MICRO.curve.startMarketCapUsd))} до ${usdUk(round(MICRO.curve.graduationMarketCapUsd))}, коли зібрано ${MICRO.curve.graduationQuote} USDC; далі пул на DEX`],
          ["Твій підпис", "Одне вікно гаманця: токен, твоя перша покупка, якщо хочеш, і її замок, якщо обереш, — на Micro завжди"],
          ["Скільки коштує створити", "Плати за створення немає; оренда й комісія мережі за нові рахунки — видно до підпису"],
        ],
      ),
    ]),
    section("presets", "Three presets", "Три пресети", [
      table(
        { en: ["", CLASSIC.name.en, PROTECTED.name.en, MICRO.name.en], uk: ["", CLASSIC.name.uk, PROTECTED.name.uk, MICRO.name.uk] },
        {
          en: [
            ["To reach the DEX", `${usd(CLASSIC.curve.graduationMarketCapUsd)} of market cap`, `${usd(PROTECTED.curve.graduationMarketCapUsd)} of market cap`, `${MICRO.curve.graduationQuote} USDC raised, ${usd(round(MICRO.curve.graduationMarketCapUsd))} of market cap`],
            ["Fee for snipers", `${pct(CLASSIC.sniperFee.startBps)} % falling to ${pct(CLASSIC.sniperFee.endBps)} % over ${minutes(CLASSIC.sniperFee.seconds)} minutes`, `${pct(PROTECTED.sniperFee.startBps)} % falling to ${pct(PROTECTED.sniperFee.endBps)} % over ${minutes(PROTECTED.sniperFee.seconds)} minutes`, `${pct(MICRO.sniperFee.startBps)} % falling to ${pct(MICRO.sniperFee.endBps)} % over ${minutes(MICRO.sniperFee.seconds)} minutes`],
            ["Fee after that", `${pct(CLASSIC.sniperFee.endBps)} %, higher while the price swings`, `${pct(PROTECTED.sniperFee.endBps)} %, higher while the price swings`, `${pct(MICRO.sniperFee.endBps)} %, higher while the price swings`],
            ["Your first purchase", `Up to ${pct(CLASSIC.creatorFirstBuyCapBps)} % of the supply`, `Up to ${pct(PROTECTED.creatorFirstBuyCapBps)} % of the supply`, `Up to ${pct(MICRO.creatorFirstBuyCapBps)} % of the supply, signed into a lock: nothing unlocks for ${microLockMonths} months`],
            ["Of every fee on the curve", curveSplitEn(CLASSIC_TERMS), "The same", curveSplitEn(MICRO_TERMS)],
            ["Graduation fee", `${pct(CLASSIC_TERMS.graduation.feeBps)} % of the threshold: you ${pct(CLASSIC_TERMS.graduation.creatorBps)} %, Ryntra ${pct(CLASSIC_TERMS.graduation.ryntraBps)} %`, "The same", `${pct(MICRO_TERMS.graduation.feeBps)} % of the threshold, all of it to the market's budget, none yours`],
            ["Pool fee after the DEX", `${pct(CLASSIC.graduatedPool.startFeeBps)} % falling to ${pct(CLASSIC.graduatedPool.endFeeBps)} % as the market cap grows`, "The same", `${pct(MICRO.graduatedPool.startFeeBps)} % falling to ${pct(MICRO.graduatedPool.endFeeBps)} % as the market cap grows`],
            ["Of every fee in the pool", poolSplitEn(CLASSIC_TERMS), "The same", poolSplitEn(MICRO_TERMS)],
            ["Liquidity of the move to the DEX", "Two positions, yours and Ryntra's, half each, locked for ever; a holder who adds liquidity later keeps it", "The same", "The same"],
          ],
          uk: [
            ["Вихід на DEX", `${usdUk(CLASSIC.curve.graduationMarketCapUsd)} капіталізації`, `${usdUk(PROTECTED.curve.graduationMarketCapUsd)} капіталізації`, `зібрано ${MICRO.curve.graduationQuote} USDC, ${usdUk(round(MICRO.curve.graduationMarketCapUsd))} капіталізації`],
            ["Комісія для снайперів", `${pctUk(CLASSIC.sniperFee.startBps)} %, що спадає до ${pctUk(CLASSIC.sniperFee.endBps)} % за ${minutes(CLASSIC.sniperFee.seconds)} хв`, `${pctUk(PROTECTED.sniperFee.startBps)} %, що спадає до ${pctUk(PROTECTED.sniperFee.endBps)} % за ${minutes(PROTECTED.sniperFee.seconds)} хв`, `${pctUk(MICRO.sniperFee.startBps)} %, що спадає до ${pctUk(MICRO.sniperFee.endBps)} % за ${minutes(MICRO.sniperFee.seconds)} хв`],
            ["Комісія потім", `${pctUk(CLASSIC.sniperFee.endBps)} %, вища, поки ціна скаче`, `${pctUk(PROTECTED.sniperFee.endBps)} %, вища, поки ціна скаче`, `${pctUk(MICRO.sniperFee.endBps)} %, вища, поки ціна скаче`],
            ["Твоя перша покупка", `До ${pctUk(CLASSIC.creatorFirstBuyCapBps)} % пропозиції`, `До ${pctUk(PROTECTED.creatorFirstBuyCapBps)} % пропозиції`, `До ${pctUk(MICRO.creatorFirstBuyCapBps)} % пропозиції, підписується під замок: ${microLockMonths} міс. не розблоковується нічого`],
            ["З кожної комісії на кривій", curveSplitUk(CLASSIC_TERMS), "Так само", curveSplitUk(MICRO_TERMS)],
            ["Комісія виходу на DEX", `${pctUk(CLASSIC_TERMS.graduation.feeBps)} % порогу: тобі ${pctUk(CLASSIC_TERMS.graduation.creatorBps)} %, Ryntra ${pctUk(CLASSIC_TERMS.graduation.ryntraBps)} %`, "Так само", `${pctUk(MICRO_TERMS.graduation.feeBps)} % порогу — увесь у бюджет ринку, твоїх 0 %`],
            ["Комісія пулу після DEX", `${pctUk(CLASSIC.graduatedPool.startFeeBps)} %, що спадає до ${pctUk(CLASSIC.graduatedPool.endFeeBps)} % з ростом капіталізації`, "Так само", `${pctUk(MICRO.graduatedPool.startFeeBps)} %, що спадає до ${pctUk(MICRO.graduatedPool.endFeeBps)} % з ростом капіталізації`],
            ["З кожної комісії пулу", poolSplitUk(CLASSIC_TERMS), "Так само", poolSplitUk(MICRO_TERMS)],
            ["Ліквідність виходу на DEX", "Дві позиції, твоя й Ryntra, по половині, замкнені назавжди; хто додасть ліквідність пізніше, лишає її собі", "Так само", "Так само"],
          ],
        },
      ),
      note(
        `«Protected» is chosen for you: its fee for snipers is higher and lasts longer, so the first minutes belong to the people who follow you, not to bots. A preset is written into its config on chain for ever — nobody, Ryntra included, can change it for a token already launched. A share is of every fee a trader pays: Meteora keeps ${pct(CLASSIC_TERMS.curve.split.meteoraBps)} %, and of the rest you take ${CLASSIC.creatorTradingFeePct} %. A trade sent through Ryntra gives Ryntra's referral ${pct(CLASSIC_TERMS.curve.splitThroughRyntra.ryntraBps - CLASSIC_TERMS.curve.split.ryntraBps)} % out of Meteora's part, never out of yours. In the pool, a holder who adds liquidity later takes their part of the ${pct(CLASSIC_TERMS.pool.positionsBps)} % paid to positions, and yours and Ryntra's shrink alike.`,
        `«Захищений» обрано за замовчуванням: його комісія для снайперів вища й триває довше, тож перші хвилини належать людям, що йдуть за тобою, а не ботам. Пресет записано в його конфіг у ланцюгу назавжди — ніхто, зокрема Ryntra, не змінить його для вже запущеного токена. Частка — від кожної комісії, яку платить трейдер: Meteora бере ${pctUk(CLASSIC_TERMS.curve.split.meteoraBps)} %, а з решти ти отримуєш ${CLASSIC.creatorTradingFeePct} %. Угода через Ryntra дає реферальній частці Ryntra ${pctUk(CLASSIC_TERMS.curve.splitThroughRyntra.ryntraBps - CLASSIC_TERMS.curve.split.ryntraBps)} % із частки Meteora, а не з твоєї. У пулі той, хто додасть ліквідність пізніше, бере свою частку з ${pctUk(CLASSIC_TERMS.pool.positionsBps)} %, що йдуть позиціям, і твоя й Ryntra частки меншають однаково.`,
      ),
      p(
        `Micro is for a small market: it reaches the DEX once ${MICRO.curve.graduationQuote} USDC is raised. Its whole graduation fee is the market's budget — the partner's share, which only Ryntra's executor can claim on this config; until it does, it waits in Meteora's program. On a market Ryntra launched itself the executor claims it, with a quarter of the partner's curve fees and of its locked liquidity's fees (the other three quarters are Ryntra's revenue, kept apart), and the budget pays for the ladder. A market launched by people gets the same budget and ladder, by the same rules, while Ryntra keeps people's markets open and its creator's wallet was watched from the launch — the ladder's money and any loss are Ryntra's; while they are closed, its partner fees wait in Meteora's pools. The token's page says which holds. You earn ${pct(MICRO_TERMS.curve.split.creatorBps)} % of every fee on the curve and your locked liquidity's fees, as on every preset. Your first purchase on Micro is signed into a lock together with the launch, so holders see you cannot sell it for ${microLockMonths} months; if the lock does not land, the token's page says the rule was not kept.`,
        `Micro — для малого ринку: на DEX він виходить, щойно зібрано ${MICRO.curve.graduationQuote} USDC. Уся його комісія виходу на DEX — бюджет ринку: це частка партнера, яку на цьому конфігу може забрати лише виконавець Ryntra; доки не забрав, вона чекає в програмі Meteora. На ринку, який запустила сама Ryntra, виконавець забирає її разом із чвертю партнерських комісій кривої й комісій замкненої ліквідності (решта три чверті — дохід Ryntra, окремо), і з цього бюджету живе драбина. Ринок, запущений людьми, отримує той самий бюджет і драбину за тими самими правилами, поки Ryntra тримає ринки людей відкритими і стежила за гаманцем творця від запуску — гроші драбини і збиток несе Ryntra; поки закрито, його партнерські комісії чекають у пулах Meteora. Сторінка токена каже, що діє зараз. Ти отримуєш ${pctUk(MICRO_TERMS.curve.split.creatorBps)} % кожної комісії на кривій і комісії своєї замкненої ліквідності, як у кожному пресеті. Твою першу покупку на Micro ти підписуєш під замок разом із запуском — холдери бачать, що ${microLockMonths} міс. ти її не продаси; якщо замок не ляже, сторінка токена скаже, що правило не виконано.`,
      ),
    ]),
    section("how", "How to launch", "Як запустити", [
      steps(
        [
          "Open Trading → Launch, press «Launch a token» and connect your wallet.",
          "Add a picture, a name, a ticker, a few words and your links (website, X, Telegram). A name or ticker that borrows a known brand or person is refused, with the names it reads as.",
          "Pick a preset.",
          `If you want, buy first: the purchase lands in the same transaction that opens the curve, at the base fee and under the preset's cap. You can lock it with a vesting schedule — ${LOCKS_EN} — and the token's page shows «The creator locked their purchase».`,
          "Read «Before you sign»: the network, the preset and its terms — who gets each fee, the graduation fee, the locked liquidity — your purchase and its lock, who invited you, and what the network takes in SOL. Then sign once.",
          "Your token's page opens: share its link. Its picture, name and links can never change.",
        ],
        [
          "Відкрий Торгівля → Лаунч, натисни «Запустити токен» і підключи гаманець.",
          "Додай картинку, назву, тікер, кілька слів і посилання (сайт, X, Telegram). Назву чи тікер, що позичає відомий бренд або людину, буде відхилено — з назвами, на які вони схожі.",
          "Обери пресет.",
          `Якщо хочеш, купи першим: покупка йде в тій самій транзакції, що відкриває криву, за базовою комісією і під стелею пресету. Її можна замкнути з вестингом — ${LOCKS_UK} — і сторінка токена покаже «Творець заблокував свою покупку».`,
          "Прочитай «Перед підписом»: мережа, пресет і його умови — хто отримує кожну комісію, комісія виходу, замкнена ліквідність, — твоя покупка і її замок, хто тебе запросив, і що мережа візьме в SOL. Потім підпиши один раз.",
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
          "After the DEX, the liquidity of the move — the creator's position and Ryntra's — is locked for ever; a holder's later entry stays the holder's.",
          "Each of these is a mark on the token's page, and each mark opens the account on chain that proves it.",
        ],
        [
          "Гроші покупців лишаються в кривій: їх тримає програма, і забрати їх не може ніхто.",
          "Ніхто не може випустити більше: право випуску віддано при створенні, пропозиція фіксована.",
          "Ніхто не може заморозити токени холдера, і жоден transfer hook на них не діє.",
          "Назву, тікер і картинку змінити неможливо.",
          "Після DEX ліквідність виходу — позиції творця й Ryntra — замкнена назавжди; пізніший вхід тримача лишається його.",
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
        `Buy and sell on the token's page: on the curve with Meteora's own instruction, after the DEX in its pool — one transaction your wallet signs and pays, with the fee, the slippage and «at least» shown before you sign. Ryntra adds no fee of its own on the curve or in the pool: it earns as the partner of the config — ${pct(CLASSIC_TERMS.curve.split.ryntraBps)} % of every fee on the curve, ${pct(CLASSIC_TERMS.graduation.ryntraBps)} % of the graduation fee (on Micro all of it, the market's budget), and the fees of its own locked liquidity after the DEX. A graduated token can also be swapped in Swap, at Swap's own fee.`,
        `Купуй і продавай на сторінці токена: на кривій — власною інструкцією Meteora, після DEX — у його пулі; одна транзакція, яку підписує й оплачує твій гаманець, з комісією, прослизанням і «щонайменше» до підпису. Ryntra не додає своєї комісії ні на кривій, ні в пулі: вона заробляє як партнер конфігу — ${pctUk(CLASSIC_TERMS.curve.split.ryntraBps)} % кожної комісії на кривій, ${pctUk(CLASSIC_TERMS.graduation.ryntraBps)} % комісії виходу на DEX (на Micro — усю, це бюджет ринку) і комісії власної замкненої ліквідності після DEX. Токен, що вийшов на DEX, можна обміняти й в Обміні — за комісією Обміну.`,
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
        "Ryntra's executor watches every market launched on Ryntra and acts only by the policies the token's page lists: it sends the move to the DEX as soon as a curve fills — and sends it again itself if it does not go through — and keeps the ladder where Ryntra has placed one. On Micro the ladder lives on the market's budget: at most 70 % of it in steps 2.5 % apart, at least 5 USDC a step; no new money goes in while the price has fallen more than 30 % within an hour, after a sale from the creator's wallet in the market's first week, or while the executor holds less than 0.1 SOL — and on a price two nodes disagree on, it neither adds to the ladder nor moves it in that pass — a move already begun is finished, the money going back into the steps. The log notes its first pass over a market and each state the market moves into after the curve: the core market on the DEX, the ladder's budget, the ladder placed, its upkeep, maturity after thirty days. Ryntra's operator can stop the executor on one market or on every market; each stop and each resume is in the log, and while a market is stopped Ryntra signs nothing on it.",
        "Виконавець Ryntra стежить за кожним ринком, запущеним на Ryntra, і діє лише за політиками, які показує сторінка токена: надсилає вихід на DEX, щойно крива набере поріг, — і надсилає знову сам, якщо вихід не пройшов, — і тримає драбину там, де Ryntra її поставила. На Micro драбина живе з бюджету ринку: у сходинках — не більше 70 % бюджету, сходинки через 2,5 %, не менше 5 USDC кожна; нових грошей у драбину виконавець не кладе, поки ціна впала понад 30 % за годину, після продажу з гаманця творця в перший тиждень ринку або поки в нього менше 0,1 SOL — а коли ціна з двох вузлів розходиться, у цьому проході драбину не поповнює й не рухає — лише завершує вже почате переміщення, повертаючи гроші в сходинки. Журнал записує його перший прохід над ринком і кожен стан, у який ринок переходить після кривої: основний ринок на DEX, бюджет драбини, драбина розміщена, обслуговування, зрілість після тридцяти днів. Оператор Ryntra може зупинити виконавця на одному ринку чи на всіх; кожна зупинка й кожне відновлення — у журналі, а поки ринок зупинено, Ryntra нічого на ньому не підписує.",
      ),
    ]),
    section("markets", "Every launch, without a wallet", "Кожен лаунч — без гаманця", [
      p(
        "Trading → Launch opens every market launched on Ryntra — newest, closest to the DEX, on the DEX — with its price, market cap, way to the DEX and holders. Reading it needs no wallet; a token's page opens its chart, its marks, its holders and its flight log the same way. The wallet is needed to launch, to trade and to claim.",
        "Торгівля → Лаунч відкриває кожен ринок, запущений на Ryntra, — нові, найближчі до DEX, уже на DEX — з ціною, капіталізацією, шляхом до DEX і власниками. Щоб читати, гаманець не потрібен; сторінка токена так само відкриває графік, позначки, власників і бортовий журнал. Гаманець потрібен, щоб запустити, торгувати й забирати.",
      ),
      note(
        "A launch is not an investment Ryntra offers, and nothing here promises a price. Anyone can launch a token; read its page — its marks, its holders, its facts — before you buy.",
        "Лаунч — не інвестиція, яку пропонує Ryntra, і ніщо тут не обіцяє ціни. Токен може запустити будь-хто; прочитай його сторінку — позначки, холдерів, факти — перед покупкою.",
      ),
    ]),
  ],
  related: ["launch/creator", "reference/fees", "trade/swap"],
};

export const CREATOR: DocPage = {
  slug: "launch/creator",
  group: "launch",
  destination: "launch",
  title: { en: "The creator's cabinet", uk: "Кабінет творця" },
  seoTitle: { en: "The creator's cabinet: income and Claim — Ryntra Docs", uk: "Кабінет творця: дохід і «Забрати» — Документація Ryntra" },
  summary: {
    en: "My launches: what each of your tokens earned you by source, its holders and traders, your own trades and lock — and Claim, in one transaction you sign.",
    uk: "«Мої лаунчі»: що кожен твій токен тобі заробив по джерелах, його власники й трейдери, твої угоди й замок — і «Забрати» однією транзакцією, яку підписуєш ти.",
  },
  sections: [
    section("what", "What the cabinet shows", "Що показує кабінет", [
      p(
        "Trading → Launch → «My launches» is the creator's cabinet of the connected wallet. Every figure is read from the programs' own counters and the chain, never estimated; a figure that could not be read says so instead of showing a zero.",
        "Торгівля → Лаунч → «Мої лаунчі» — кабінет творця підключеного гаманця. Кожна цифра — з лічильників самих програм і з ланцюга, ніколи не оцінка; цифра, яку не вдалося прочитати, так і позначена, а не показана нулем.",
      ),
      list(
        [
          "Earned — over the last 24 hours, 7 days or all time — by source: the curve's fee, the DEX exit fee and your locked liquidity's fees; what waits to be claimed and what you have claimed.",
          "Your launches side by side: the way to the DEX, holders, traders and those who came back, volume and earnings.",
          "Your market on the DEX: liquidity, market cap, the pool's fees, your share of the pool, and how large a buy or a sale would move the price by 2 %.",
          "Your own trades with the token — what you bought and sold, and the share sold — and your lock with its unlock dates.",
          "Notifications — when your token launches, passes 10, 25, 50, 100… holders, moves to the DEX and when fees are ready — in the app and in Telegram once it is connected.",
          "A public profile: your launches, their results, locks and sales, one link to share.",
        ],
        [
          "Зароблено — за 24 години, 7 днів чи весь час — за джерелами: комісія кривої, комісія виходу на DEX і комісії твоєї замкненої ліквідності; що чекає, щоб забрати, і що вже забрано.",
          "Твої запуски поруч: шлях до DEX, власники, трейдери й ті, хто повернувся, обсяг і заробіток.",
          "Твій ринок на DEX: ліквідність, капіталізація, комісії пулу, твоя частка пулу і яка купівля чи продаж зрушить ціну на 2 %.",
          "Твої угоди з токеном — що куплено й продано і яку частку продано — і твій замок із датами розблокування.",
          "Сповіщення — коли токен запуститься, набере 10, 25, 50, 100… власників, вийде на DEX і коли комісії готові, — у застосунку, а в Telegram, коли його підключено.",
          "Публічний профіль: твої запуски, їхні результати, замки й продажі — одне посилання, щоб поділитися.",
        ],
      ),
    ]),
    section("claim", "Claim", "Забрати", [
      steps(
        [
          "Open «My launches» with the wallet that launched the token.",
          "Press «Claim» with the amount on the launch's row: it gathers what waits on that launch — the curve's fee, the DEX exit fee, your locked liquidity's fees — into one transaction.",
          "Your wallet opens with the transaction: check it there and sign. Your wallet pays the network fee; the receipt is read from the programs' own events and kept in the cabinet.",
        ],
        [
          "Відкрий «Мої лаунчі» гаманцем, яким запущено токен.",
          "Натисни «Забрати» із сумою в рядку лаунчу: воно збирає те, що чекає на цьому лаунчі, — комісію кривої, комісію виходу на DEX, комісії твоєї замкненої ліквідності — в одну транзакцію.",
          "Гаманець відкривається з транзакцією: перевір її там і підпиши. Плату мережі сплачує твій гаманець; квитанцію прочитано з подій самих програм, і вона лишається в кабінеті.",
        ],
      ),
      note(
        `Your share is written into the token's config on chain at launch — on every preset ${pct(CLASSIC_TERMS.curve.split.creatorBps)} % of every fee on the curve and, after the DEX, your locked position's fees — and nobody, Ryntra included, can change it or claim it for you.`,
        `Твоя частка записана в конфіг токена в ланцюгу під час запуску — у кожному пресеті ${pctUk(CLASSIC_TERMS.curve.split.creatorBps)} % кожної комісії на кривій і, після DEX, комісії твоєї замкненої позиції, — і ніхто, зокрема Ryntra, не може її змінити чи забрати за тебе.`,
      ),
    ]),
  ],
  related: ["launch/launch-a-token", "reference/fees", "reference/receipts"],
};

export const LAUNCH_PAGES: readonly DocPage[] = [LAUNCH, CREATOR];
