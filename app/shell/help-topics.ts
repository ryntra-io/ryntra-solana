import type { WorkspaceLocale } from "./locale";

/**
 * What the product's `?` says, in both languages — the Owner's decision of
 * 2026-09-15 (Premium Product UI Pass §3): one help primitive, one shape of
 * text. Every topic is *what it is* in one or two plain sentences, a simple
 * example with real-looking figures, and the one limitation a person must
 * know. No formula by default; the size module's arithmetic lives in
 * `lib/api/v1/contract.ts`, not on the screen.
 *
 * A material financial risk is never *only* here: the planned risk's model
 * note and the invalidation's "a rule, not an order" also stand on the
 * surface in one short line. The help adds the example and the reason.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export type HelpTopic = Readonly<{
  title: Bi;
  /** One line, for the hover tooltip. */
  short: Bi;
  /** What it is, one or two sentences. */
  what: Bi;
  /** A simple example, one line per entry; figures in the product's own units. */
  example: readonly Bi[];
  /** The one limitation a person must know. */
  important: Bi;
}>;

export const HELP_TOPICS = {
  /* What a person actually buys — one label per issuer from the issuer's own documents, the line behind it one press deeper (canon v5.0 §7). No asset here is "a real share". */
  truthXStocks: {
    title: bi("Backed tracker", "Трекер із забезпеченням"),
    short: bi("Tracks the share price. A custodian holds the share. No voting.", "Відстежує ціну акції. Акцію тримає кастодіан. Голосу немає."),
    what: bi(
      "By the issuer's documents an xStocks token is a tracker certificate from Backed Assets (Jersey), backed one to one by the share a custodian holds. It is not direct ownership of the company.",
      "За документами емітента токен xStocks — сертифікат-трекер від Backed Assets (Джерсі), забезпечений один до одного акцією, яку тримає кастодіан. Це не пряма власність у компанії.",
    ),
    example: [bi("You buy SPYx: its price follows the SPY share, and the token stays in your wallet.", "Купуєш SPYx: його ціна йде за акцією SPY, а токен лежить у твоєму гаманці.")],
    important: bi("No vote at the company's meetings. Not for U.S. persons; availability depends on your country.", "Голосу на зборах компанії немає. Не для осіб із США; доступність залежить від країни."),
  },
  truthOndo: {
    title: bi("Backed tracker", "Трекер із забезпеченням"),
    short: bi("Tracks the price and the dividends. It is not a share.", "Відстежує ціну й дивіденди. Це не акція."),
    what: bi(
      "By the issuer's documents an Ondo token is a fully backed total-return tracker: it follows the share with its dividends, and it is not itself a stock, an ETF or an ADR.",
      "За документами емітента токен Ondo — повністю забезпечений трекер повної дохідності: іде за акцією разом із її дивідендами і сам не є ні акцією, ні ETF, ні ADR.",
    ),
    example: [bi("You hold the token, not the share; there is no dividend payout to your wallet.", "У тебе токен, а не акція; виплати дивідендів на гаманець немає.")],
    important: bi("No vote and no claim on the share itself. Not for U.S. persons.", "Голосу й права на саму акцію немає. Не для осіб із США."),
  },
  truthBackpack: {
    title: bi("Tracker · exchangeable for the share", "Трекер · обмін на акцію"),
    short: bi("Can be exchanged for the share through a Backpack account with KYC. No voting yet.", "Можна обміняти на акцію через акаунт Backpack із KYC. Голосу поки немає."),
    what: bi(
      "By the issuer's documents the token in your wallet is a claim on a vehicle that holds the share. Inside a Backpack account with KYC it can be exchanged one to one for the share itself.",
      "За документами емітента токен у гаманці — вимога до структури, що тримає акцію. В акаунті Backpack із KYC його можна обміняти на саму акцію один до одного.",
    ),
    example: [bi("In your wallet: the token. In a verified Backpack account: the share, one for one.", "У гаманці — токен. В акаунті Backpack із перевіркою — акція, один до одного.")],
    important: bi("Voting and cash dividends are not available yet. Not for the U.S., the UK, the UAE or Japan.", "Голос і грошові дивіденди поки недоступні. Не для США, Великої Британії, ОАЕ та Японії."),
  },
  truthPreStocks: {
    title: bi("Economic exposure · private", "Економічна експозиція · приватна"),
    short: bi(
      "No ownership, no vote, no dividends. Selling may not be possible. An issuer fee on every transfer{fee}; the issuer can freeze or take away the token.",
      "Ні власності, ні голосу, ні дивідендів. Продати може не вийти. Комісія емітента на кожен переказ{fee}; емітент може заморозити чи забрати токен.",
    ),
    what: bi(
      "By the issuer's documents the token gives only economic exposure to a private company through a holding entity — no ownership, voting, dividend or information rights. The mint itself withholds a fee on every transfer, and its settings let the issuer freeze the token, pause transfers, and move or burn it from any wallet.",
      "За документами емітента токен дає лише економічну експозицію до приватної компанії через холдингову структуру — без прав власності, голосу, дивідендів чи інформації. Сам mint утримує комісію з кожного переказу, а його налаштування дають емітентові змогу заморозити токен, зупинити перекази, перемістити чи спалити його з будь-якого гаманця.",
    ),
    example: [bi("The company is not listed: the token's price is what the pool pays, not a stock-exchange price.", "Компанія не на біржі: ціна токена — те, що платить пул, а не біржова ціна.")],
    important: bi("A full loss is possible and liquidity is not guaranteed. Not for U.S. persons.", "Можлива повна втрата, ліквідність не гарантована. Не для осіб із США."),
  },
  /* The warning a purchase with a loss limit stands on, in full one press deep (canon v5.0 §5.4). */
  lossLimitWarning: {
    title: bi("Before you sign", "Перед підписом"),
    short: bi("Ryntra is an AI assistant, not an adviser. You can lose part or all of the money.", "Ryntra — ШІ-помічник, не радник. Можна втратити частину або всі гроші."),
    what: bi(
      "The figures on the card are computed by Ryntra's published rules from your amount and your loss limit; the decision and the signature are yours.",
      "Цифри на картці рахують опубліковані правила Ryntra з твоєї суми й межі збитку; рішення й підпис — твої.",
    ),
    example: [bi("$20 with the −10% limit: the card shows the most the Review lets you lose, costs included.", "$20 з межею −10%: картка показує найбільше, що Перевірка дозволить утратити, разом із витратами.")],
    important: bi("A limit does not guarantee the loss: the price can jump past it. Ryntra warns you; it does not sell or sign for you.", "Межа не гарантує збитку: ціна може проскочити її. Ryntra попереджає, але не продає й не підписує за тебе."),
  },
  portfolioRisk: {
    title: bi("Portfolio risk", "Ризик портфеля"),
    short: bi("One word for the whole wallet, by Ryntra's published rules — from the prices and data that could be read.", "Одне слово про весь гаманець — за опублікованими правилами Ryntra, з цін і даних, які вдалося прочитати."),
    what: bi(
      "«Normal»: no position has reached its limit or target, no asset is above 25% of the wallet, private companies together are at most 10%, and no company goes into the weekend without a loss limit. The 25% cap applies from a wallet of $500, the 10% at any size; dollars (USDC, USDT, PYUSD, USDS) count in the total and have no cap.",
      "«Нормальний»: жодна позиція не дійшла до межі чи цілі, жоден актив не більший за 25% гаманця, приватні компанії разом — не більше 10%, і жодна компанія не йде на вихідні без межі збитку. Межа 25% діє з гаманця від $500, межа 10% — за будь-якої суми; долари (USDC, USDT, PYUSD, USDS) входять у суму, але межі не мають.",
    ),
    example: [bi("$1,000 in the wallet, $400 of it in NVIDIA: 40% → «Attention: NVIDIA is 40% of the wallet — above 25%».", "$1 000 у гаманці, з них $400 в NVIDIA: 40% → «Увага: NVIDIA — 40% гаманця, понад 25%».")],
    important: bi(
      "If a price or part of the wallet could not be read, Ryntra says «Could not check» — never «Normal». A token Ryntra cannot vouch for — unverified, or with no market — is left out of the risk's count. A hint, not advice: Ryntra buys and sells nothing for you.",
      "Якщо ціну чи частину гаманця не вдалося прочитати, Ryntra каже «Не вдалося перевірити» — ніколи не «Нормальний». Токен, за який Ryntra не може поручитися, — неперевірений чи без ринку, — лишається поза розрахунком ризику. Це підказка, не порада: Ryntra нічого не купує й не продає за тебе.",
    ),
  },
  plannedEntry: {
    title: bi("Planned entry", "Плановий вхід"),
    short: bi("The price per share you plan to buy at — the basis of every size in the plan.", "Ціна за акцію, за якою ти плануєш купити — основа кожного розміру в плані."),
    what: bi(
      "The price per underlying share you plan to buy at. The size of the plan and the loss to the invalidation are both computed from it.",
      "Ціна за одну акцію, за якою ти плануєш купити. Від неї рахуються і розмір плану, і втрата до інвалідації.",
    ),
    example: [bi("Planned entry $212 · budget $1,000 → at most about 4.7 shares.", "Плановий вхід $212 · бюджет $1 000 → щонайбільше близько 4,7 акції.")],
    important: bi("The Review checks the executable price against your bound, not against this figure.", "Review перевіряє виконувану ціну проти твоєї межі, а не проти цієї цифри."),
  },
  maxPrice: {
    title: bi("Do not pay more than", "Не платити більше ніж"),
    short: bi("Above this price per share the Review refuses the trade.", "Вище цієї ціни за акцію Review відмовляє в угоді."),
    what: bi(
      "The most you are willing to pay per share. When the executable price at the Review is above it, the plan refuses the trade before you sign.",
      "Найбільше, що ти готовий заплатити за акцію. Якщо виконувана ціна на Review вища, план відмовляє в угоді ще до підпису.",
    ),
    example: [bi("Bound $216.60 · quote $214.10 → within the plan. Quote $217.20 → refused.", "Межа $216,60 · котирування $214,10 → у межах плану. Котирування $217,20 → відмова.")],
    important: bi("Without a bound the price is reported and nothing is refused.", "Без межі ціна лише показується, і ніщо не відмовляє."),
  },
  validUntil: {
    title: bi("Entry valid until", "Вхід чинний до"),
    short: bi("After this moment the entry rule is expired and the plan needs a new version.", "Після цього моменту правило входу прострочене, і плану потрібна нова версія."),
    what: bi(
      "The moment your entry rule stops applying. After it the plan reads Expired: the Review refuses a trade under it until you write a new version or cancel it.",
      "Момент, після якого правило входу перестає діяти. Далі план читається як прострочений: Review відмовляє в угоді за ним, доки ти не напишеш нову версію або не скасуєш план.",
    ),
    example: [bi("Valid until Oct 15 · today Sep 20 → the plan can be traded. On Oct 16 it is expired.", "Чинний до 15 жовтня · сьогодні 20 вересня → за планом можна торгувати. 16 жовтня він прострочений.")],
    important: bi("Nothing is bought or sold when the date passes; only the rule stops.", "Коли дата минає, нічого не купується і не продається — лише правило перестає діяти."),
  },
  budget: {
    title: bi("Budget", "Бюджет"),
    short: bi("The most this plan may spend, including what is kept for costs.", "Найбільше, що цей план може витратити, разом із резервом на витрати."),
    what: bi(
      "What this plan may spend in total. The part kept for costs is not spent on shares; the Review refuses an amount above the budget.",
      "Скільки цей план може витратити загалом. Частина, відкладена на витрати, не йде на акції; Review відмовляє в сумі понад бюджет.",
    ),
    example: [bi("Budget $1,000 · kept for costs $10 → up to $990 on shares.", "Бюджет $1 000 · резерв на витрати $10 → до $990 на акції.")],
    important: bi("The budget is a ceiling, not the amount that will be spent — the planned risk usually sets a smaller size.", "Бюджет — це стеля, а не сума, яку буде витрачено: плановий ризик зазвичай дає менший розмір."),
  },
  plannedRisk: {
    title: bi("Planned risk", "Плановий ризик"),
    short: bi("The loss you plan for if the price reaches your invalidation; the plan sizes itself to it.", "Втрата, яку ти плануєш, якщо ціна дійде до інвалідації; план сам підбирає під неї розмір."),
    what: bi(
      "The amount you choose to risk under the assumptions of this plan. Ryntra sizes the position so the modelled loss at the invalidation stays near this figure.",
      "Сума, якою ти вирішуєш ризикнути за припущеннями цього плану. Ryntra підбирає розмір так, щоб змодельована втрата на інвалідації трималася біля цієї цифри.",
    ),
    example: [
      bi("Entry $200 · invalidation $190 · modelled costs 1% → about $12 lost per share.", "Вхід $200 · інвалідація $190 · змодельовані витрати 1% → близько $12 втрати на акцію."),
      bi("Planned risk $60 → about 5 shares, about $1,000 spent.", "Плановий ризик $60 → близько 5 акцій, близько $1 000 витрат."),
    ],
    important: bi("A model, not a guaranteed maximum loss: a gap through the invalidation, missing liquidity or a missed exit can lose more.", "Це модель, а не гарантована максимальна втрата: геп крізь інвалідацію, брак ліквідності або пропущений вихід можуть коштувати більше."),
  },
  invalidation: {
    title: bi("Where the thesis is wrong (invalidation)", "Де теза хибна (інвалідація)"),
    short: bi("The price at which you admit the idea failed and leave. A rule you act on — no stop order is placed.", "Ціна, за якої ти визнаєш, що ідея не спрацювала, і виходиш. Правило, за яким дієш ти — стоп-ордер не виставляється."),
    what: bi(
      "You buy because you expect the price to rise. The invalidation is the price at which that expectation has failed — where you agree with yourself to leave and take the small loss rather than wait for a bounce. Ryntra computes the loss per share and the size from it; it does not place an exit order for you.",
      "Ти купуєш, бо чекаєш зростання. Інвалідація — ціна, за якої це очікування не справдилося: рівень, на якому ти домовляєшся сам із собою вийти й зафіксувати малу втрату, а не чекати відскоку. Ryntra рахує від нього втрату на акцію й розмір; ордер на вихід за тебе не виставляється.",
    ),
    example: [
      bi("Entry $755 · where the thesis is wrong $682 → $73 at stake per share, about $80 with 1% costs.", "Вхід $755 · теза хибна на $682 → $73 на кону за акцію, близько $80 з 1% витрат."),
      bi("Planned risk $3 → the plan buys at most $3 / $80 ≈ 0.037 shares.", "Плановий ризик $3 → план купує щонайбільше $3 / $80 ≈ 0,037 акції."),
    ],
    important: bi("Closer to the entry — less lost per share but a normal dip takes you out; further — the opposite. Leaving when the price gets there is your own action; the plan only reminds you of the level.", "Ближче до входу — менша втрата на акцію, але звичайне коливання виб'є; далі — навпаки. Вийти, коли ціна туди дійде — твоя власна дія; план лише нагадує рівень."),
  },
  costBuffer: {
    title: bi("Modelled costs and slippage", "Змодельовані витрати й сліпедж"),
    short: bi("What the size model adds for fees and slippage, in and out together.", "Скільки модель розміру додає на комісії та сліпедж, на вхід і вихід разом."),
    what: bi(
      "A percentage of the entry the size model adds to the loss per share, standing in for fees and slippage on the way in and out. It makes the planned size a little smaller and the risk estimate a little more honest.",
      "Відсоток від входу, який модель розміру додає до втрати на акцію замість комісій і сліпеджу на вхід і вихід. Через нього плановий розмір трохи менший, а оцінка ризику — трохи чесніша.",
    ),
    example: [bi("1.00% of a $200 entry → $2 added to the loss per share.", "1,00% від входу $200 → $2 додано до втрати на акцію.")],
    important: bi("An estimate for sizing; the real fee and slippage are shown on the Review before you sign.", "Оцінка для розміру; справжня комісія і сліпедж показані на Review перед підписом."),
  },
  target: {
    title: bi("Target", "Ціль"),
    short: bi("The price per share you would take profit at — written down, not placed as an order.", "Ціна за акцію, за якої ти б зафіксував прибуток — записана, не виставлена як ордер."),
    what: bi(
      "The price per share at which your thesis has played out. It is kept with the plan so the result can be read against it; no order is placed.",
      "Ціна за акцію, за якої твоя теза спрацювала. Вона зберігається з планом, щоб результат можна було читати проти неї; ордер не виставляється.",
    ),
    example: [bi("Entry $212 · target $250 → about 18% above the entry.", "Вхід $212 · ціль $250 → близько 18% над входом.")],
    important: bi("Optional. A plan without a target is still a complete plan.", "Необов'язково. План без цілі — усе одно повний план."),
  },
  timeExit: {
    title: bi("Time exit", "Вихід за часом"),
    short: bi("The moment you plan to leave the position whatever the price.", "Момент, коли ти плануєш вийти з позиції незалежно від ціни."),
    what: bi(
      "A date by which you intend to close the position even if neither the target nor the invalidation has been reached.",
      "Дата, до якої ти маєш намір закрити позицію, навіть якщо ні ціль, ні інвалідація не досягнуті.",
    ),
    example: [bi("Horizon 8 weeks · time exit Nov 10 → a reminder to decide by then.", "Горизонт 8 тижнів · вихід за часом 10 листопада → нагадування вирішити до того часу.")],
    important: bi("Optional, and acted on by you; nothing is sold automatically.", "Необов'язково, і діє через тебе; нічого не продається автоматично."),
  },
  horizon: {
    title: bi("Horizon", "Горизонт"),
    short: bi("How long you expect the thesis to take.", "Скільки часу, на твою думку, потрібно тезі."),
    what: bi(
      "How long you expect the thesis to need — days, weeks or months. It frames the plan and the result; it changes no rule on its own.",
      "Скільки часу, на твою думку, потрібно тезі — дні, тижні чи місяці. Він задає рамку плану й результату; сам по собі не змінює жодного правила.",
    ),
    example: [bi("Earnings in three weeks → horizon 4 weeks.", "Звіт за три тижні → горизонт 4 тижні.")],
    important: bi("A horizon is not an expiry; the entry's validity is a separate rule.", "Горизонт — не строк дії; чинність входу — окреме правило."),
  },
  maxSlippage: {
    title: bi("Max slippage", "Макс. сліпедж"),
    short: bi("How far the executed price may differ from the quote; beyond it the trade is not sent.", "Наскільки виконана ціна може відрізнятися від котирування; понад це угода не надсилається."),
    what: bi(
      "The most the price may move against you between the quote and the execution. Under a plan this bound is sent to the venue as a fixed limit: a fill outside it fails instead of going through.",
      "Найбільше, на скільки ціна може зрушити проти тебе між котируванням і виконанням. За планом ця межа передається майданчику як фіксований ліміт: виконання поза нею не проходить.",
    ),
    example: [bi("Quote $214.00 · max slippage 0.50% → the trade must fill at $215.07 or better.", "Котирування $214,00 · макс. сліпедж 0,50% → угода має виконатися за $215,07 або краще.")],
    important: bi("A tight bound protects the price and can make a thin market fail to fill.", "Вузька межа захищає ціну, але на тонкому ринку може не дати виконатися."),
  },
  maxQuoteAge: {
    title: bi("Max quote age", "Макс. вік котирування"),
    short: bi("A quote older than this at the Review is refused, not signed.", "Котирування, старше за це на момент Review, відхиляється, а не підписується."),
    what: bi(
      "How old the quote may be when you sign. An older quote is refused so you never sign a price the market has already left.",
      "Наскільки старим може бути котирування на момент підпису. Старше відхиляється, щоб ти ніколи не підписував ціну, яку ринок уже залишив.",
    ),
    example: [bi("Max 60 s · the Review was taken 75 s ago → refused; take a fresh one.", "Макс. 60 с · Review взято 75 с тому → відмова; візьми свіже.")],
    important: bi("The venue's own quote lifetime still applies on top of it.", "Власний строк життя котирування на майданчику діє на додачу."),
  },
  referencePrice: {
    title: bi("Reference price", "Референсна ціна"),
    short: bi("The issuer's price per share for the underlying stock — what the token is meant to track.", "Ціна за акцію від емітента для базової акції — те, що токен має відстежувати."),
    what: bi(
      "The price per share of the underlying stock as the issuer's own feed states it. The token's price is compared to it to see whether you are paying a premium or getting a discount.",
      "Ціна за акцію базової акції, як її подає власний канал емітента. Ціну токена порівнюють із нею, щоб побачити, платиш ти премію чи отримуєш знижку.",
    ),
    example: [bi("Reference $212.20 · token $213.93 per share → +0.8% above the reference.", "Референс $212,20 · токен $213,93 за акцію → +0,8% над референсом.")],
    important: bi("Outside the exchange session the reference is the last available figure, and the page says so.", "Поза сесією біржі референс — останнє доступне значення, і сторінка це каже."),
  },
  deviation: {
    title: bi("Deviation", "Відхилення"),
    short: bi("How far the token's price per share is from the reference, in percent.", "Наскільки ціна токена за акцію відрізняється від референсу, у відсотках."),
    what: bi(
      "The token's price per share against the issuer's reference. Positive means you would pay above the underlying stock's price; negative, below it.",
      "Ціна токена за акцію проти референсу емітента. Плюс — ти платиш вище за ціну базової акції; мінус — нижче.",
    ),
    example: [bi("Reference $212.20 · token $214.32 → deviation +1.00%.", "Референс $212,20 · токен $214,32 → відхилення +1,00%.")],
    important: bi("An estimate for orientation, not a quote; the Review measures the real amount.", "Оцінка для орієнтації, не котирування; Review вимірює справжню суму."),
  },
  maxDeviation: {
    title: bi("Max deviation from the reference", "Макс. відхилення від референсу"),
    short: bi("Above this premium over the reference the Review refuses the trade.", "Вище цієї премії над референсом Review відмовляє в угоді."),
    what: bi(
      "How far above the issuer's reference price you are willing to buy. When the executable price per share exceeds it, the plan refuses the trade.",
      "Наскільки вище за референсну ціну емітента ти готовий купувати. Коли виконувана ціна за акцію перевищує це, план відмовляє в угоді.",
    ),
    example: [bi("Max 1.50% · reference $212.20 → the trade must fill at $215.38 per share or better.", "Макс. 1,50% · референс $212,20 → угода має пройти за $215,38 за акцію або краще.")],
    important: bi("With the reference required, a missing or stale reference also blocks the trade; advisory only names it.", "Коли референс обов'язковий, його відсутність чи застарілість теж блокує угоду; попереджувальний режим лише називає це."),
  },
  liquidity: {
    title: bi("Liquidity", "Ліквідність"),
    short: bi("What the pool holds. A small pool moves the price against you.", "Скільки тримає пул. Малий пул рухає ціну проти тебе."),
    what: bi(
      "The value held in the pool the token trades in. The larger it is next to your order, the less your own order moves the price.",
      "Вартість, яку тримає пул, де торгується токен. Що вона більша поряд із твоїм ордером, то менше твій ордер рухає ціну.",
    ),
    example: [bi("Order $1,000 into a $1.8M pool → a small price move. The same order into a $60K pool → a large one.", "Ордер $1 000 у пул $1,8M → малий зсув ціни. Той самий ордер у пул $60K → великий.")],
    important: bi("The venue's figure at the time of the list; it changes with every trade.", "Цифра майданчика на момент списку; змінюється з кожною угодою."),
  },
  /* Where the stock page's Meteora figures come from — the note that used to sit under the liquidity card (RYN-FIRST-SCREEN-001, S4). */
  meteoraPools: {
    title: bi("Where it trades on Meteora", "Де торгується на Meteora"),
    short: bi("Meteora's own figures for the pools that hold this token, as of the time shown.", "Власні цифри Meteora про пули з цим токеном — на вказаний час."),
    what: bi(
      "The pools on Meteora that hold this token, with the figures Meteora publishes for each: how much the pool holds (both sides counted), what traded through it in the last 24 hours, the fees the pool earned and its base fee rate per trade. The primary pool is the deepest one paired with a stablecoin or SOL; a pair with another stock leads only when no such pool holds $1,000.",
      "Пули на Meteora, які тримають цей токен, із цифрами, які Meteora публікує для кожного: скільки в пулі (обидві сторони разом), скільки через нього проторгували за останні 24 години, скільки комісій заробив пул і яка його базова ставка за угоду. Основний пул — найглибший у парі зі стейблкоїном чи SOL; пара з іншою акцією стає основною, лише коли жоден такий пул не тримає $1 000.",
    ),
    example: [bi("OPENAI-USDC · $219K in the pool · $463K traded in 24 h · base rate 0.75% per trade.", "OPENAI-USDC · $219 тис. у пулі · $463 тис. торгів за 24 год · базова ставка 0,75% за угоду.")],
    important: bi("The fees are what the pool earned, not what you pay, and every figure moves with each trade. Nothing here is a recommendation.", "Комісії — це те, що заробив пул, а не те, що платиш ти, і кожна цифра змінюється з кожною угодою. Ніщо тут не є рекомендацією."),
  },
  minLiquidity: {
    title: bi("Min pool liquidity", "Мін. ліквідність пулу"),
    short: bi("Below this pool size the Review refuses the trade.", "Нижче цього розміру пулу Review відмовляє в угоді."),
    what: bi(
      "The smallest pool you are willing to trade into. A thinner pool at the Review refuses the trade before you sign.",
      "Найменший пул, у який ти готовий торгувати. Тонший пул на Review відмовляє в угоді до підпису.",
    ),
    example: [bi("Min $500K · pool $1.8M → within the plan. Pool $420K → refused.", "Мін. $500K · пул $1,8M → у межах плану. Пул $420K → відмова.")],
    important: bi("Optional; without it the pool size is shown and never refuses.", "Необов'язково; без нього розмір пулу показується й ніколи не відмовляє."),
  },
  size: {
    title: bi("Planned size", "Плановий розмір"),
    short: bi("How much the rules let you buy — the smaller of the risk-limited and the budget-limited size.", "Скільки правила дозволяють купити — менший із розмірів за ризиком і за бюджетом."),
    what: bi(
      "The number of underlying units the plan buys, computed from the rules: the size the planned risk allows, or the size the budget allows, whichever is smaller.",
      "Кількість одиниць базового активу, яку купує план, порахована з правил: розмір, який дозволяє плановий ризик, або розмір, який дозволяє бюджет — що менше.",
    ),
    example: [bi("Risk allows 0.02 shares · budget allows 4.66 → the plan buys 0.02, limited by the planned risk.", "Ризик дозволяє 0,02 акції · бюджет дозволяє 4,66 → план купує 0,02, обмежено плановим ризиком.")],
    important: bi("Under the assumptions of the model; the Review quotes the real amount before you sign.", "За припущеннями моделі; Review котирує справжню суму перед підписом."),
  },
  multiplier: {
    title: bi("Units per token", "Одиниць на токен"),
    short: bi("How many underlying shares one token stands for, as the chain states it.", "Скільки базових акцій представляє один токен, як каже ланцюг."),
    what: bi(
      "How many underlying shares one token represents. After a split or a dividend the issuer changes it on the chain, and every per-share figure follows.",
      "Скільки базових акцій представляє один токен. Після спліту чи дивіденду емітент змінює це на ланцюгу, і кожна цифра за акцію йде за ним.",
    ),
    example: [bi("1 token = 1 share, then a 10-for-1 split → 1 token = 10 shares.", "1 токен = 1 акція, потім спліт 10 до 1 → 1 токен = 10 акцій.")],
    important: bi("Around an announced change the issuer advises a pause; the page shows a pending multiplier when there is one.", "Довкола оголошеної зміни емітент радить паузу; сторінка показує очікуваний множник, коли він є."),
  },
  planVsActual: {
    title: bi("Plan vs Actual", "План і факт"),
    short: bi("What you planned, what the Review checked before signing, what the chain settled.", "Що ти планував, що Review перевірив перед підписом, що підтвердив ланцюг."),
    what: bi(
      "The same four figures in three columns: the version you planned, the Review that stood before your signature, and the row the chain settled. The verdict is about the entry only.",
      "Ті самі чотири цифри у трьох колонках: версія, яку ти планував, Review, що стояв перед підписом, і рядок, який підтвердив ланцюг. Вердикт стосується лише входу.",
    ),
    example: [bi("Planned entry $212.36 · before signing $213.10 · actual $213.42 → the plan was followed.", "Плановий вхід $212,36 · перед підписом $213,10 · фактично $213,42 → план дотримано.")],
    important: bi("No exit adherence, profit or stop discipline is claimed here.", "Дотримання виходу, прибуток чи дисципліна стопу тут не оцінюються."),
  },
  volume: {
    title: bi("Volume 24h", "Обсяг 24h"),
    short: bi("How much was traded in the last day, in dollars — the venue's own figure.", "Скільки наторгували за останню добу в доларах — цифра самого майданчика."),
    what: bi(
      "The dollar value traded in the last twenty-four hours as the venue reports it. Activity, not quality: a busy token is not a good one.",
      "Доларова вартість торгів за останні двадцять чотири години за даними майданчика. Активність, не якість: жвавий токен — не обов'язково хороший.",
    ),
    example: [bi("$29.6M in a day on a $4.3M pool → the pool turned over seven times.", "$29,6M за день на пулі $4,3M → пул обернувся сім разів.")],
    important: bi("Not a ranking of what to buy and not advice.", "Не рейтинг того, що купувати, і не порада."),
  },
  verified: {
    title: bi("Verification", "Верифікація"),
    short: bi("Whether the venue verified this token's identity. Unverified is a caution, not a verdict.", "Чи підтвердив майданчик ідентичність цього токена. Не верифіковано — застереження, а не вердикт."),
    what: bi(
      "Whether the venue's token list verifies the token's identity. A verified token is the one it claims to be; an unverified one may be a look-alike borrowing a symbol.",
      "Чи підтверджує список токенів майданчика ідентичність токена. Верифікований — той, ким себе називає; неверифікований може бути двійником, що позичив символ.",
    ),
    example: [bi("Two tokens called BONK: one verified, one not. Only the verified one is the BONK people trade.", "Два токени з назвою BONK: один верифікований, другий ні. Лише верифікований — той BONK, яким торгують.")],
    important: bi("Verification says who the token is, not whether it is worth anything.", "Верифікація каже, хто цей токен, а не чи він чогось вартий."),
  },
  session: {
    title: bi("Session", "Сесія"),
    short: bi("Whether the US stock market is open now; the token trades around the clock, the reference does not.", "Чи відкрита зараз фондова біржа США; токен торгується цілодобово, референс — ні."),
    what: bi(
      "The state of the US exchange session for the underlying stock, as the issuer's calendar states it. The token trades on Solana at any hour; the reference price only moves while the exchange is open.",
      "Стан сесії біржі США для базової акції, як його подає календар емітента. Токен торгується на Solana будь-якої години; референсна ціна рухається лише поки біржа відкрита.",
    ),
    example: [bi("Market open until 20:00 UTC → the reference is live. After that, the last close stands until the next session.", "Ринок відкритий до 20:00 UTC → референс живий. Після цього стоїть останнє закриття до наступної сесії.")],
    important: bi("Outside the session the token can drift from the reference more than usual.", "Поза сесією токен може відхилятися від референсу більше, ніж зазвичай."),
  },
  versions: {
    title: bi("Versions", "Версії"),
    short: bi("Every change of the rules is a new version; the old one stays readable exactly as it stood.", "Кожна зміна правил — нова версія; стара лишається читабельною точно такою, як була."),
    what: bi(
      "A plan is never edited in place. New rules make a new version with your reason; a trade is bound to the version that stood before the signature, so the result can be read against the rules of its own moment.",
      "План ніколи не правиться на місці. Нові правила створюють нову версію з твоєю причиною; угода прив'язана до версії, що стояла перед підписом, тож результат читається проти правил свого моменту.",
    ),
    example: [bi("v1 planned risk $100 → v2 planned risk $0.50 for a first live check.", "v1 плановий ризик $100 → v2 плановий ризик $0,50 для першої живої перевірки.")],
    important: bi("A trade under an older version is refused; the Review checks the version you are on.", "Угода за старішою версією відхиляється; Review перевіряє версію, на якій ти стоїш."),
  },
  /* The evidence — an external source's observations of the token, and the person's own rule on them (RYN-NANSEN-EVIDENCE-001). */
  onchainActivity: {
    title: bi("Onchain activity", "Активність у мережі"),
    short: bi("What the market did with this token in the window — trades and movements, from an external source.", "Що ринок робив із цим токеном за вікно — угоди й переміщення, із зовнішнього джерела."),
    what: bi(
      "A few figures about this token from an external onchain analytics source, read when you ask: how much was traded on decentralised exchanges, and how much moved to or from the groups of addresses the source labels. Each figure says when Ryntra asked and how far behind the source may be.",
      "Кілька цифр про цей токен із зовнішнього джерела ончейн-аналітики, прочитаних на твій запит: скільки торгували на децентралізованих біржах і скільки перемістилося до груп адрес, які джерело позначає, або з них. Кожна цифра каже, коли Ryntra запитала і наскільки джерело може відставати.",
    ),
    example: [bi("24h DEX volume $700K · buys $339K · sells $361K · moved to exchanges +$965K.", "Обсяг DEX за 24 год $700K · покупки $339K · продажі $361K · рух на біржі +$965K.")],
    important: bi("A movement is not a trade, a label is not a person, and none of it is a price or advice. When the source has no figures, the card says so — it never shows a zero in their place.", "Переміщення — не угода, мітка — не особа, і нічого з цього не є ціною чи порадою. Коли у джерела немає цифр, картка так і каже — нуль замість них не показується."),
  },
  tokenMovement: {
    title: bi("Token movement", "Рух токенів"),
    short: bi("The net USD value that moved into or out of a labelled group of addresses — a transfer, not necessarily a trade.", "Чиста вартість у USD, що перемістилася до позначеної групи адрес або з неї — переказ, не обов'язково угода."),
    what: bi(
      "The source labels some addresses as exchanges or as large holders and adds up what moved into them (above zero) and out of them (below zero) in the window. A transfer to an exchange may be a sale about to happen, or a deposit for something else entirely.",
      "Джерело позначає частину адрес як біржі або великих власників і додає те, що перемістилося на них (вище нуля) і з них (нижче нуля) за вікно. Переказ на біржу може бути продажем, що ось-ось станеться, або депозитом зовсім для іншого.",
    ),
    example: [bi("Moved to exchanges +$965K while DEX sells were $361K: most of the movement was not a DEX trade.", "Рух на біржі +$965K, тоді як продажі на DEX — $361K: більшість руху не була угодою на DEX.")],
    important: bi("Groups can overlap and one person can hold many addresses; the count is addresses, never people.", "Групи можуть перетинатися, а одна людина може мати багато адрес; лічильник — це адреси, ніколи не люди."),
  },
  evidenceCondition: {
    title: bi("Evidence condition", "Умова за доказом"),
    short: bi("Your own rule on an observation, checked by the server before you sign.", "Твоє власне правило щодо спостереження, яке сервер перевіряє перед підписом."),
    what: bi(
      "A rule you write on one of the figures — a metric, a window, at least or at most, a threshold. At the Review the server reads the observation again and judges the rule. Warn names the result and leaves the decision to you; Require refuses this version of the plan when the rule is not met — or when it cannot be judged.",
      "Правило, яке ти пишеш на одну з цифр — метрика, вікно, не менше або не більше, поріг. На Review сервер знову читає спостереження й судить правило. «Попередити» називає результат і лишає рішення тобі; «Вимагати» відхиляє цю версію плану, коли правило не виконано — або коли його неможливо перевірити.",
    ),
    example: [bi("Require: 24h DEX trading volume at least $250,000 — a day with $180,000 blocks the order; a day the source cannot answer blocks it too.", "Вимагати: обсяг торгів на DEX за 24 год не менше ніж $250 000 — день із $180 000 блокує заявку; день, коли джерело не відповідає, теж блокує.")],
    important: bi("A met condition says the rule held at that moment — not that the trade is safe or the price fair. Movements of labelled groups can only warn, never require.", "Виконана умова означає, що правило трималося в ту мить — не що угода безпечна чи ціна справедлива. Рухи позначених груп можуть лише попереджати, ніколи не вимагати."),
  },
  /* The token's structure and the recipient check — the security and due-diligence source (RYN-DDXYZ-RISK-001). */
  riskDueDiligence: {
    title: bi("Risk & due diligence", "Ризик і перевірка"),
    short: bi("How the token is built, from an external security source: who holds it, whether its supply can still change, whether it taxes transfers.", "Як збудований токен, із зовнішнього джерела безпеки: хто його тримає, чи може ще змінитися пропозиція, чи бере він податок із переказів."),
    what: bi(
      "A few facts about the token itself, read when you ask: how much of the supply the ten largest holders hold, how many addresses hold it, whether the mint and freeze authorities are present or renounced, and whether the token takes a fee on every transfer. Each fact says when the source last analysed the token and how far behind it may be.",
      "Кілька фактів про сам токен, прочитаних на твій запит: яку частку пропозиції тримають десять найбільших власників, скільки адрес його тримають, чи є або відкинуті права емісії та заморозки, чи бере токен комісію з кожного переказу. Кожен факт каже, коли джерело востаннє аналізувало токен і наскільки воно може відставати.",
    ),
    example: [bi("Held by the top 10: 38.7% of 1,016,981 holders · mint authority renounced · freeze authority renounced · transfer tax none.", "У 10 найбільших: 38,7% з 1 016 981 власників · право емісії відкинуто · право заморозки відкинуто · податку на переказ немає.")],
    important: bi("None of this is a verdict. A fact that looks alarming on a meme coin can be the design of an issuer-backed instrument, whose issuer holds supply and keeps a freeze right on purpose. When the source has no figure, the card says so — never a zero, never green.", "Ніщо з цього не вирок. Факт, що лякає на мем-коїні, може бути задумом інструмента з емітентом, який тримає пропозицію і навмисно лишає право заморозки. Коли у джерела немає цифри, картка так і каже — ніколи нуль, ніколи зелений."),
  },
  tokenAuthorities: {
    title: bi("Mint and freeze authority", "Права емісії та заморозки"),
    short: bi("Two rights a Solana token can keep or give up: to create more supply, and to freeze token accounts.", "Два права, які токен Solana може лишити або відкинути: створювати ще пропозицію та заморожувати рахунки."),
    what: bi(
      "A Solana mint may carry a mint authority (an address that can create more tokens) and a freeze authority (an address that can freeze any holder's account). Renounced means the right was given up on-chain and nobody can use it; present means somebody can. The source reads the mint and reports which it is.",
      "Мінт Solana може мати право емісії (адреса, що може створити ще токенів) і право заморозки (адреса, що може заморозити рахунок будь-якого власника). «Відкинуто» означає, що право віддано в мережі й ним ніхто не скористається; «є» — що хтось може. Джерело читає мінт і каже, як саме.",
    ),
    example: [bi("A meme coin with a present mint authority can have its supply doubled at any moment; a tokenized stock may keep a freeze right because its issuer must be able to comply with a court order.", "Мем-коїн з наявним правом емісії може подвоїти пропозицію будь-якої миті; токенізована акція може лишати право заморозки, бо емітент мусить виконати рішення суду.")],
    important: bi("A rule on an authority is either renounced or present — nothing in between — and can be required, so a plan version refuses to trade when the state is not what you wrote or cannot be read.", "Правило щодо права — або «відкинуто», або «є», нічого посередині — і може бути обов'язковим, тож версія плану відмовиться торгувати, коли стан не такий, як ти написав, або його неможливо прочитати."),
  },
  launchCohort: {
    title: bi("Early snipers, bundled buyers, the developer", "Ранні снайпери, пакетні покупці, розробник"),
    short: bi("Shares of supply held by addresses the source labels from the token's first moments — a classification, not a fact about people.", "Частки пропозиції в адрес, які джерело позначає за першими хвилинами токена — класифікація, не факт про людей."),
    what: bi(
      "The source looks at who bought in the first moments after launch (snipers), which buys were packed into the launch transactions (bundlers) and which address it takes for the developer's, and adds up what those addresses hold now. On a fresh meme coin these say whether the supply is in a few coordinated hands; on a token launched years ago, or on an issuer-backed instrument, the labels mean little — the issuer's own accounts are 'the developer'.",
      "Джерело дивиться, хто купував у перші хвилини після запуску (снайпери), які покупки були зібрані в транзакції запуску (бандлери) і яку адресу воно вважає розробником, і додає, що ці адреси тримають зараз. На свіжому мем-коїні це каже, чи пропозиція в кількох узгоджених руках; на токені, запущеному роки тому, або на інструменті з емітентом мітки мало що означають — рахунки емітента і є «розробник».",
    ),
    example: [bi("Snipers hold 12% and the developer 30% of a week-old coin: most of the supply sits in a few early hands.", "Снайпери тримають 12%, розробник 30% тижневого коїна: більшість пропозиції — в кількох ранніх руках.")],
    important: bi("These figures inform and can only warn; a plan cannot require them, because a label is the source's guess about an address, never a fact about a person.", "Ці цифри інформують і можуть лише попереджати; план не може їх вимагати, бо мітка — здогад джерела про адресу, ніколи не факт про особу."),
  },
  paymentsRule: {
    title: bi("From every payment", "З кожної оплати"),
    short: bi("Sets a little of every USDC payment aside for a company — the money stays in your wallet, and only your signature buys.", "Відкладає частинку кожної оплати USDC у компанію — гроші лежать у гаманці, купує лише твій підпис."),
    what: bi(
      "Ryntra reads this wallet's USDC on Solana. A payment is a transfer to someone else that you signed; money that came in is USDC someone else sent you. Each one counts once, from the moment the rule is on. Swaps, Ryntra purchases, bridges and transfers between your own accounts never count. The sum gathers until the minimum, then one reminder opens a fresh Review, and only your signature buys.",
      "Ryntra читає USDC цього гаманця в Solana. Оплата — переказ комусь іншому, який ти підписав; надходження — USDC, які тобі надіслав хтось інший. Кожна подія рахується один раз, від миті, коли правило ввімкнено. Обміни, купівлі в Ryntra, мости й перекази між твоїми рахунками не рахуються. Сума копиться до мінімуму, тоді одне нагадування відкриває свіжу «Перевірку», і купує лише твій підпис.",
    ),
    example: [bi("Round-up to $1: payments of $3.40 and $2.30 → $0.60 + $0.70 = $1.30 → «From payments: $1.30 → Apple».", "Округлення до $1: оплати $3,40 і $2,30 → $0,60 + $0,70 = $1,30 → «З оплат: $1,30 → Apple».")],
    important: bi("Ryntra never names a shop. A transfer to your other wallet looks like any payment — mark it «My account», and such transfers stop counting.", "Ryntra не називає магазин. Переказ на твій інший гаманець виглядає як оплата — познач його «Мій рахунок», і такі перекази більше не рахуються."),
  },
  recipientCheck: {
    title: bi("Recipient check", "Перевірка отримувача"),
    short: bi("What an external security source knows about the address you are sending to — before you sign, never in your way.", "Що зовнішнє джерело безпеки знає про адресу, на яку ти надсилаєш — перед підписом, ніколи на заваді."),
    what: bi(
      "Ryntra asks the source two things about the recipient: is the address on a sanctions list the source keeps, and did the source find anything about it — how many findings and how serious, on the source's own scale. A wallet it cannot analyse (a program, a vault, an exchange contract) is reported as unsupported, not as clean.",
      "Ryntra питає джерело дві речі про отримувача: чи адреса є в санкційному списку, який веде джерело, і чи знайшло джерело щось про неї — скільки знахідок і наскільки серйозних за його власною шкалою. Гаманець, який воно не може проаналізувати (програму, сховище, контракт біржі), показано як «не підтримується», а не як чистий.",
    ),
    example: [bi("Nothing found among what the source keeps · not on its sanctions lists · analysed yesterday 21:38 UTC.", "Нічого не знайдено серед того, що веде джерело · не в його санкційних списках · проаналізовано вчора о 21:38 UTC.")],
    important: bi("Ryntra never stops a transfer on this: the words are your information, the decision is yours. 'Nothing found' is not 'safe' — it is what one source knows today.", "Ryntra ніколи не зупиняє переказ через це: слова — твоя інформація, рішення — твоє. «Нічого не знайдено» — не «безпечно», а те, що одне джерело знає сьогодні."),
  },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof HELP_TOPICS;

/**
 * A rate a topic names is the token's own, read from the chain and formatted
 * by the page that draws it — the same text as the fact beside it — never a
 * figure typed here. `{fee}` marks where it stands: the PreStocks line said
 * «1% today» while the issuer set 3 % on seven of its tokens from epoch 1043
 * (the Owner's word of 2026-09-26, `RYN-SITE-NOW-001`). Without a reading the
 * sentence names no rate at all.
 */
export type HelpFacts = Readonly<{ fee?: string | null }>;

function fill(text: string, facts: HelpFacts | undefined): string {
  if (!text.includes("{fee}")) return text;
  const fee = facts?.fee?.trim();
  return text.split("{fee}").join(fee ? ` (${fee})` : "");
}

export function helpTopic(id: HelpTopicId, locale: WorkspaceLocale, facts?: HelpFacts) {
  const topic = HELP_TOPICS[id];
  return {
    title: topic.title[locale],
    short: fill(topic.short[locale], facts),
    what: fill(topic.what[locale], facts),
    example: topic.example.map((line) => fill(line[locale], facts)),
    important: fill(topic.important[locale], facts),
  };
}

export const HELP_WORDS = {
  open: bi("What is this?", "Що це?"),
  close: bi("Close", "Закрити"),
  example: bi("Example", "Приклад"),
  important: bi("Important", "Важливо"),
} as const;
