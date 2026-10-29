import type { WorkspaceLocale } from "@/app/shell/locale";
import type { TrackBadgeId } from "@/lib/growth/badges";
import { MIN_POSITION_USD, STEWARD_DAYS, STRATEGIST_DAYS } from "../../../../lib/growth/liquidity.ts";

/**
 * The words of «Creator partners» and its media kit, in both languages,
 * beside the pages that say them — like `rank-copy.ts`, because the
 * workspace catalogue is the core's file. A missing language is a type error.
 *
 * The line under the title is a fact with its state — the share, and whether
 * it is paid or only counted until partner payouts open (`programme-copy.ts`,
 * Ріст 19) — never a promise to earn: a partner's share is a part of the fee
 * Ryntra actually receives from a pool, and nothing here forecasts one.
 */

export type PoolStatusWord = "EARNING" | "WAITING" | "REVIEW" | "BLOCKED" | "NOT_COUNTED";
export type FunnelStep = "opened" | "signed" | "launched" | "earned";
export type TierWord = "STANDARD" | "FOUNDING";

type Copy = Readonly<{
  title: string;
  loading: string;
  unavailable: string;
  retry: string;
  gateTitle: string;

  tier: Readonly<Record<TierWord, string>>;
  foundingSeat: (seat: number, seats: number) => string;
  levelNone: string;
  levelNext: (name: string, creators: number) => string;
  levelTop: string;
  code: string;
  link: string;
  copy: string;
  copied: string;
  activated: (n: number) => string;
  activatedHintLine: string;

  pending: string;
  available: string;
  paid: string;
  nextOn: (day: string) => string;
  payoutsClosed: string;
  claim: (amount: string) => string;
  claiming: string;
  checkingAmount: (amount: string) => string;
  paidAmount: (amount: string) => string;
  awaitingReserve: (amount: string) => string;
  payout: Readonly<Record<"checking" | "paid" | "failed" | "reserve" | "review" | "stopped" | "error" | "closed" | "paused" | "nothing" | "signIn", string>>;
  minimum: (amount: string) => string;
  debt: (amount: string) => string;
  elsewhere: (amount: string) => string;
  receiptsTitle: (n: number) => string;
  receiptPayout: string;
  receiptClaim: string;
  receiptRules: (version: string) => string;
  receiptDebt: string;
  held: (amount: string) => string;
  moneyLater: string;
  incomplete: string;

  shareNow: string;
  shareUntil: (share: string, day: string) => string;
  shareOpen: (share: string) => string;
  shareSeveral: (share: string, pools: number) => string;
  nextStep: (day: string) => string;
  fromFirstFee: (share: string) => string;
  schedule: (tier: TierWord, steps: readonly Readonly<{ untilDay: number | null; bps: number }>[]) => string;

  funnelTitle: string;
  funnel: Readonly<Record<FunnelStep, string>>;
  funnelHint: Readonly<Record<FunnelStep, string>>;
  funnelWhat: string;
  openedSince: (day: string) => string;
  openedFromNext: string;

  marketsTitle: string;
  marketsLabel: string;
  showMore: (n: number) => string;
  showLess: string;
  market: string;
  status: string;
  share: string;
  earned: string;
  creator: (masked: string) => string;
  launchedOn: (day: string) => string;
  poolStatus: Readonly<Record<PoolStatusWord, string>>;
  activatedYes: string;
  activatedNo: string;
  noData: string;
  unnamed: (pool: string) => string;
  network: Readonly<Record<"solana" | "arc", string>>;
  ask: string;
  askLabel: string;
  askPlaceholder: string;
  send: string;
  sending: string;
  sent: string;
  asked: string;
  askFailed: string;
  cancel: string;

  emptyTitle: string;
  emptyLead: string;
  emptyOpens: (opens: number) => string;
  emptyCounting: string;

  badgesTitle: string;
  badgesHint: string;
  track: Readonly<Record<"partner" | "founding" | "creator" | "ambassador" | "liquidity", string>>;
  badge: Readonly<Record<TrackBadgeId, string>>;
  badgeHow: Readonly<Record<TrackBadgeId, string>>;
  /* Liquidity badges: how the days are counted, what today's read found, and the wallet's choice about the boards. */
  liquidityUnread: (held: boolean) => string;
  liquidityPartial: string;
  liquidityUnpriced: string;
  liquidityUnder: string;
  liquidityDays: (have: number, need: number) => string;
  liquidityShow: string;
  liquiditySaveFailed: string;
  liquidityTagAloud: string;
  earnedOn: (day: string) => string;
  notYet: (name: string) => string;
  notHeld: string;
  badgesHeld: (held: number, total: number) => string;

  howTitle: string;
  how: readonly string[];
  terms: string;
  kit: string;

  /* The media kit. */
  kitTitle: string;
  kitLead: string;
  kitLinkTitle: string;
  kitLinkGate: string;
  kitLinkLoading: string;
  screensTitle: string;
  screensLead: string;
  screen: Readonly<Record<"launch" | "rules" | "review", string>>;
  download: string;
  brandTitle: string;
  brandRules: readonly string[];
  colors: Readonly<{ orange: string; graphite: string; font: string }>;
  marks: Readonly<{ mark: string; heat: string; navy: string; sand: string }>;
  feesTitle: string;
  fees: readonly string[];
  lockedTitle: string;
  locked: readonly string[];
  shareTitle: string;
  shareLines: readonly string[];
  postsTitle: string;
  postsLead: string;
  posts: readonly ((link: string) => string)[];
  adLabel: string;
  back: string;
}>;

const pct = (bps: number) => `${bps / 100}%`;

const EN_BADGE: Record<TrackBadgeId, string> = {
  SCOUT: "Scout",
  PARTNER: "Partner",
  BUILDER: "Builder",
  COUNCIL: "Council",
  FOUNDING_PARTNER: "Founding Partner",
  LAUNCHED: "Launched",
  GRADUATED: "Graduated",
  RETURNING_BUILDER: "Returning Builder",
  EDUCATOR: "Educator",
  GUIDE: "Guide",
  COMMUNITY_PARTNER: "Community Partner",
  POOL_CONTRIBUTOR: "Pool Contributor",
  STEWARD: "Steward",
  STRATEGIST: "Strategist",
};

const EN: Copy = {
  title: "Creator partners",
  loading: "Loading your partner page…",
  unavailable: "Your partner page can't be read right now.",
  retry: "Try again",
  gateTitle: "Connect a wallet to see your creator partners.",

  tier: { STANDARD: "Standard", FOUNDING: "Founding" },
  foundingSeat: (seat, seats) => `Founding · seat ${seat} of ${seats}`,
  levelNone: "No level yet",
  levelNext: (name, creators) => `Next: ${name} at ${creators} activated ${creators === 1 ? "creator" : "creators"}`,
  levelTop: "The highest level",
  code: "Your code",
  link: "Your link",
  copy: "Copy",
  copied: "Copied",
  activated: (n) => (n === 1 ? "Activated creator" : "Activated creators"),
  activatedHintLine: "A creator is activated when 3 independent outside wallets trade $1 or more on their launch curve, before it reaches a DEX, within 30 days. Where the check cannot see everything, a person confirms it.",

  pending: "Pending",
  available: "Available",
  paid: "Paid",
  nextOn: (day) => `next on ${day}`,
  payoutsClosed: "Partner payouts aren't open yet. Your share is counted and kept.",
  claim: (amount) => `Get ${amount}`,
  claiming: "Sending…",
  checkingAmount: (amount) => `We are checking your ${amount} payout. Do not start another one.`,
  paidAmount: (amount) => `${amount} paid to your wallet.`,
  awaitingReserve: (amount) => `${amount} more is recorded and waits until the reward reserve covers it.`,
  payout: {
    checking: "We are checking your payout. Do not start another one.",
    paid: "Paid to your wallet.",
    failed: "That payout did not go through. Your balance is unchanged and you can try again.",
    reserve: "Your share is recorded. It waits until the reward reserve covers it.",
    review: "The payout is being reviewed.",
    stopped: "Payouts to this wallet were stopped after a review.",
    error: "The payout could not be checked right now. Try again.",
    closed: "Partner payouts aren't open yet. Your share is counted and kept.",
    paused: "Partner payouts are paused. Your share is counted and kept.",
    nothing: "Nothing is available to get right now.",
    signIn: "Sign in with your wallet again, then try once more.",
  },
  minimum: (amount) => `Payout available from ${amount}.`,
  debt: (amount) => `${amount} already paid was corrected down; it is taken off your payouts until covered.`,
  elsewhere: (amount) => `${amount} is on the EVM network, where partner payouts aren't open yet.`,
  receiptsTitle: (n) => `Receipts · ${n}`,
  receiptPayout: "Payout",
  receiptClaim: "Fee claimed",
  receiptRules: (version) => `rules ${version.replace(/^network-/, "")}`,
  receiptDebt: "reversed earlier",
  held: (amount) => `${amount} waits before it can become available.`,
  moneyLater: "Sums appear here once a market brings your share.",
  incomplete: "Some data is missing, so these sums may be short.",

  shareNow: "Share now",
  shareUntil: (share, day) => `${share} until ${day}`,
  shareOpen: (share) => `${share}, while the pool brings fees`,
  shareSeveral: (share, pools) => `up to ${share} across ${pools} markets`,
  nextStep: (day) => `next step ends ${day}`,
  fromFirstFee: (share) => `${share} from the first fee`,
  schedule: (tier, steps) =>
    tier === "FOUNDING"
      ? `${pct(steps[0]!.bps)} for ${steps[0]!.untilDay} days from a pool's first fee, ${pct(steps[1]!.bps)} to day ${steps[1]!.untilDay}, then ${pct(steps[2]!.bps)}`
      : `${pct(steps[0]!.bps)} for ${steps[0]!.untilDay} days from a pool's first fee, then ${pct(steps[1]!.bps)}`,

  funnelTitle: "From your link to your share",
  funnel: { opened: "Opened", signed: "Signed in", launched: "Launched", earned: "Earned" },
  funnelHint: {
    opened: "opens of your link, at most once a day per browser, without link previews",
    signed: "people who chose you with a wallet, by your link or by launching with you as «Invited by»",
    launched: "creators who launched a token with you as «Invited by»",
    earned: "creators whose market came alive and brought a fee your share is counted from",
  },
  funnelWhat: "What each step counts",
  openedSince: (day) => `Opens counted from ${day}`,
  openedFromNext: "Counting starts with the next open",

  marketsTitle: "Markets",
  marketsLabel: "Markets you are named on",
  showMore: (n) => `Show ${n} more`,
  showLess: "Show less",
  market: "Market",
  status: "Status",
  share: "Share",
  earned: "Earned",
  creator: (masked) => `Creator ${masked}`,
  launchedOn: (day) => `Launched ${day}`,
  poolStatus: {
    EARNING: "Live",
    WAITING: "Waiting for the first fee",
    REVIEW: "Under review",
    BLOCKED: "Not counted after a review",
    NOT_COUNTED: "Demo market, not counted",
  },
  activatedYes: "Activated",
  activatedNo: "Not activated yet",
  noData: "Some data is missing",
  unnamed: (pool) => `Pool ${pool}`,
  network: { solana: "Solana", arc: "EVM" },
  ask: "Ask a question",
  askLabel: "Your question to the reviewer",
  askPlaceholder: "What would you like to ask?",
  send: "Send",
  sending: "Sending…",
  sent: "Sent to the reviewer.",
  asked: "Your question is with the reviewer.",
  askFailed: "It wasn't sent. Try again in a moment.",
  cancel: "Cancel",

  emptyTitle: "No creators yet",
  emptyLead: "Share your link with a creator — their market appears here.",
  emptyOpens: (opens) => `Your link was opened ${opens} ${opens === 1 ? "time" : "times"}.`,
  emptyCounting: "Opens of your link are counted from the next one.",

  badgesTitle: "Network badges",
  badgesHint: "Choose a badge to see what it is for.",
  track: { partner: "Partner", founding: "Founding", creator: "Creator", ambassador: "Ambassador", liquidity: "Liquidity" },
  badge: EN_BADGE,
  badgeHow: {
    SCOUT: "1 activated creator",
    PARTNER: "3 activated creators",
    BUILDER: "10 activated creators",
    COUNCIL: "25 activated creators",
    FOUNDING_PARTNER: "One of the first 20 approved partners",
    LAUNCHED: "A confirmed launch of your own",
    GRADUATED: "A launch of yours that reached a DEX",
    RETURNING_BUILDER: "A second real market 30 or more days after your first",
    EDUCATOR: "Useful materials that helped creators launch, not likes or reposts. Not given yet",
    GUIDE: "Useful materials and creators activated by your link. Not given yet",
    COMMUNITY_PARTNER: "A community that brings creators activated by your link. Not given yet",
    POOL_CONTRIBUTOR: `$${MIN_POSITION_USD} or more in verified tokens in a live Meteora pool, read from Solana when you open this page`,
    STEWARD: `A counted position in range on ${STEWARD_DAYS} different days Ryntra checked it`,
    STRATEGIST: `A DLMM position, bins of your choice, in range on ${STRATEGIST_DAYS} different days Ryntra checked it`,
  },
  liquidityUnread: (held) => (held ? "Your positions couldn't be read just now. Badges you hold stay." : "Your positions couldn't be read just now."),
  liquidityPartial: "Some of your positions couldn't be read just now.",
  liquidityUnpriced: "A position without a price isn't counted today.",
  liquidityUnder: `None of your positions counts today: it takes $${MIN_POSITION_USD} or more you can withdraw, in verified tokens, in a pool that traded today.`,
  liquidityDays: (have, need) => `${have} of ${need} days`,
  liquidityShow: "Show my liquidity badge on the boards",
  liquiditySaveFailed: "It wasn't saved. Try again in a moment.",
  liquidityTagAloud: "Liquidity badge:",
  earnedOn: (day) => `held since ${day}`,
  notYet: (name) => `${name}, not yet held`,
  notHeld: "not yet held",
  badgesHeld: (held, total) => `${held} of ${total}`,

  howTitle: "How it works",
  how: [
    "Your share comes out of the part of a pool's fees Ryntra actually receives. Never out of the creator's part, never from trading volume.",
    "Everything paid from one pool's Ryntra part stays within 40% of it.",
    "A share waits 14 days, then becomes available once the creator is activated.",
    "One level: you share only in creators you brought yourself. Your own wallets and the team's count for nothing.",
    "Each entry keeps the version of the terms it was counted under.",
  ],
  terms: "Partner terms",
  kit: "Media kit",

  kitTitle: "Media kit",
  kitLead: "Real screens, the brand and the words to explain Ryntra to a creator.",
  kitLinkTitle: "Your link",
  kitLinkGate: "Connect a wallet to get your personal link.",
  kitLinkLoading: "Loading your link…",
  screensTitle: "Screens",
  screensLead: "The live product on 16 October 2026, without a wallet.",
  screen: { launch: "Launch a token", rules: "Market rules", review: "Review before signing" },
  download: "Download",
  brandTitle: "Brand",
  brandRules: [
    "Write Ryntra: one word, capital R.",
    "Use the mark as it is: no rotating, recolouring or stretching.",
    "Orange is for one action: never a background for long text.",
  ],
  colors: { orange: "Ryntra orange", graphite: "Graphite", font: "Typeface" },
  marks: { mark: "Mark", heat: "Mark, heat", navy: "Mark, navy", sand: "Mark, sand" },
  feesTitle: "Fees of a launch on Solana",
  fees: [
    "Launching costs nothing but the network's rent.",
    "On the curve, a trade pays 1%: more in the first minutes, so snipers pay, plus a volatility fee when the price moves fast.",
    "Meteora keeps 20% of that fee. Of the rest, 40% goes to the creator and 60% to Ryntra.",
    "At graduation, 2% of what the curve raised is a fee: 40% of it to the creator.",
    "After graduation the market trades in a Meteora pool whose fee falls from 2% to 0.5% as the price grows tenfold or over 30 days, whichever comes first.",
    "These are the Classic and Protected launches.",
  ],
  lockedTitle: "Locked liquidity",
  locked: [
    "At graduation the liquidity moves into the pool and is locked: half belongs to the creator, half to Ryntra.",
    "Locked means no one can withdraw the pool's liquidity.",
    "Both halves keep collecting the pool's fees for as long as the market trades; half of those fees goes back into the pool and deepens it.",
  ],
  shareTitle: "Where your share comes from",
  shareLines: [
    "Only from Ryntra's part of a pool's fees.",
    "An example in plain arithmetic, not a forecast: Ryntra receives $100 from a pool; a Standard partner's 20% is $20.",
  ],
  postsTitle: "Words to post",
  postsLead: "Copy, change as you like, keep it true.",
  posts: [
    (link) => `Launching a token? On Ryntra the creator keeps 40% of the curve's fees after Meteora, and the liquidity is locked at graduation. Start here: ${link} #ad`,
    (link) => `A market that stays: Ryntra locks the pool's liquidity at graduation, half for the creator. Launch with my link: ${link} #ad`,
  ],
  adLabel: "Each post carries #ad; on X also turn on «Paid Partnership».",
  back: "Creator partners",
};

const UK: Copy = {
  title: "Партнери творців",
  loading: "Завантажуємо сторінку партнера…",
  unavailable: "Сторінку партнера зараз не вдалося прочитати.",
  retry: "Спробувати знову",
  gateTitle: "Підключіть гаманець, щоб побачити своїх творців.",

  tier: { STANDARD: "Стандарт", FOUNDING: "Founding" },
  foundingSeat: (seat, seats) => `Founding · місце ${seat} з ${seats}`,
  levelNone: "Рівня ще немає",
  levelNext: (name, creators) => `Далі — ${name}, від ${creators} ${ukCreators(creators)}`,
  levelTop: "Найвищий рівень",
  code: "Ваш код",
  link: "Ваше посилання",
  copy: "Копіювати",
  copied: "Скопійовано",
  activated: (n) => {
    const last = n % 10;
    const tens = n % 100;
    if (last === 1 && tens !== 11) return "Активований творець";
    if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "Активовані творці";
    return "Активованих творців";
  },
  activatedHintLine: "Творця активовано, коли 3 незалежні зовнішні гаманці торгують від $1 на кривій запуску, до виходу на DEX, за 30 днів. Якщо перевірка бачить не все, активацію підтверджує людина.",

  pending: "Очікує",
  available: "Доступно",
  paid: "Виплачено",
  nextOn: (day) => `наступне — ${day}`,
  payoutsClosed: "Виплати партнерам ще не відкриті. Вашу частку пораховано й збережено.",
  claim: (amount) => `Отримати ${amount}`,
  claiming: "Надсилаємо…",
  checkingAmount: (amount) => `Перевіряємо стан виплати ${amount}. Не починайте іншу.`,
  paidAmount: (amount) => `${amount} виплачено на ваш гаманець.`,
  awaitingReserve: (amount) => `Ще ${amount} зафіксовано — чекає, доки резерв винагород їх покриє.`,
  payout: {
    checking: "Перевіряємо стан виплати. Не починайте іншу.",
    paid: "Виплачено на ваш гаманець.",
    failed: "Виплата не пройшла. Ваш баланс не змінився, спробуйте ще раз.",
    reserve: "Вашу частку зафіксовано. Вона чекає, доки резерв винагород її покриє.",
    review: "Виплата на перевірці.",
    stopped: "Виплати на цей гаманець зупинено після перевірки.",
    error: "Зараз не вдалося перевірити виплату. Спробуйте ще раз.",
    closed: "Виплати партнерам ще не відкриті. Вашу частку пораховано й збережено.",
    paused: "Виплати партнерам призупинено. Вашу частку пораховано й збережено.",
    nothing: "Зараз нічого отримати.",
    signIn: "Увійдіть гаманцем ще раз і спробуйте знову.",
  },
  minimum: (amount) => `Отримати можна від ${amount}.`,
  debt: (amount) => `${amount} з уже виплаченого виправлено в менший бік — вираховується з ваших виплат, доки не покриється.`,
  elsewhere: (amount) => `${amount} — у мережі EVM, де виплати партнерам ще не відкриті.`,
  receiptsTitle: (n) => `Квитанції · ${n}`,
  receiptPayout: "Виплата",
  receiptClaim: "Комісію забрано",
  receiptRules: (version) => `правила ${version.replace(/^network-/, "")}`,
  receiptDebt: "сторно",
  held: (amount) => `${amount} чекає, перш ніж стати доступним.`,
  moneyLater: "Суми з'являться тут, коли ринок принесе вашу частку.",
  incomplete: "Бракує частини даних, тож суми можуть бути неповні.",

  shareNow: "Частка зараз",
  shareUntil: (share, day) => `${share} до ${day}`,
  shareOpen: (share) => `${share}, поки пул приносить комісії`,
  shareSeveral: (share, pools) => `до ${share} на ${pools} ринках`,
  nextStep: (day) => `наступний крок — ${day}`,
  fromFirstFee: (share) => `${share} від першої комісії`,
  schedule: (tier, steps) =>
    tier === "FOUNDING"
      ? `${pct(steps[0]!.bps)} — ${steps[0]!.untilDay} днів від першої комісії пулу, ${pct(steps[1]!.bps)} — до ${steps[1]!.untilDay}-го дня, далі ${pct(steps[2]!.bps)}`
      : `${pct(steps[0]!.bps)} — ${steps[0]!.untilDay} днів від першої комісії пулу, далі ${pct(steps[1]!.bps)}`,

  funnelTitle: "Від посилання до вашої частки",
  funnel: { opened: "Перейшов", signed: "Підписав", launched: "Запустив", earned: "Заробив" },
  funnelHint: {
    opened: "відкриття вашого посилання — не частіше разу на добу в браузері, без прев'ю посилань",
    signed: "люди, що обрали вас гаманцем — за посиланням або запустивши токен із вами в «Запросив»",
    launched: "творці, що запустили токен із вами в «Запросив»",
    earned: "творці, чий ринок ожив і приніс комісію, з якої рахується ваша частка",
  },
  funnelWhat: "Що рахує кожен крок",
  openedSince: (day) => `Відкриття рахуємо з ${day}`,
  openedFromNext: "Рахуємо з наступного відкриття",

  marketsTitle: "Ринки",
  marketsLabel: "Ринки, де ви — «Запросив»",
  showMore: (n) => `Показати ще ${n}`,
  showLess: "Згорнути",
  market: "Ринок",
  status: "Стан",
  share: "Частка",
  earned: "Зароблено",
  creator: (masked) => `Творець ${masked}`,
  launchedOn: (day) => `Запуск ${day}`,
  poolStatus: {
    EARNING: "Працює",
    WAITING: "Чекає першої комісії",
    REVIEW: "На перевірці",
    BLOCKED: "Не рахується після перевірки",
    NOT_COUNTED: "Демо-ринок, не рахується",
  },
  activatedYes: "Активовано",
  activatedNo: "Ще не активовано",
  noData: "Бракує даних",
  unnamed: (pool) => `Пул ${pool}`,
  network: { solana: "Solana", arc: "EVM" },
  ask: "Поставити питання",
  askLabel: "Ваше питання рецензентові",
  askPlaceholder: "Що ви хочете спитати?",
  send: "Надіслати",
  sending: "Надсилаємо…",
  sent: "Надіслано рецензентові.",
  asked: "Ваше питання вже в рецензента.",
  askFailed: "Не вдалося надіслати. Спробуйте за хвилину.",
  cancel: "Скасувати",

  emptyTitle: "Творців ще немає",
  emptyLead: "Поділіться посиланням із творцем — його ринок з'явиться тут.",
  emptyOpens: (opens) => `Ваше посилання відкрили ${opens} ${opens % 10 === 1 && opens % 100 !== 11 ? "раз" : opens % 10 >= 2 && opens % 10 <= 4 && (opens % 100 < 12 || opens % 100 > 14) ? "рази" : "разів"}.`,
  emptyCounting: "Відкриття посилання рахуємо з наступного.",

  badgesTitle: "Значки Мережі",
  badgesHint: "Оберіть значок, щоб побачити, за що він.",
  track: { partner: "Партнер", founding: "Founding", creator: "Творець", ambassador: "Амбасадор", liquidity: "Ліквідність" },
  badge: EN_BADGE,
  badgeHow: {
    SCOUT: "1 активований творець",
    PARTNER: "3 активовані творці",
    BUILDER: "10 активованих творців",
    COUNCIL: "25 активованих творців",
    FOUNDING_PARTNER: "Один із перших 20 схвалених партнерів",
    LAUNCHED: "Ваш підтверджений запуск",
    GRADUATED: "Ваш запуск, що вийшов на DEX",
    RETURNING_BUILDER: "Другий справжній ринок через 30+ днів після першого",
    EDUCATOR: "Корисні матеріали, що допомогли творцям запуститись, — не лайки й репости. Ще не видається",
    GUIDE: "Корисні матеріали й творці, активовані за вашим посиланням. Ще не видається",
    COMMUNITY_PARTNER: "Спільнота, що приводить творців, активованих за вашим посиланням. Ще не видається",
    POOL_CONTRIBUTOR: `Від $${MIN_POSITION_USD} у верифікованих токенах у живому пулі Meteora — читаємо з Solana, коли ви відкриваєте цю сторінку`,
    STEWARD: `Врахована позиція в діапазоні ${STEWARD_DAYS} різних днів, коли Ryntra її перевіряла`,
    STRATEGIST: `Позиція DLMM із власними бінами в діапазоні ${STRATEGIST_DAYS} різних днів, коли Ryntra її перевіряла`,
  },
  liquidityUnread: (held) => (held ? "Не вдалося прочитати позиції. Отримані значки лишаються." : "Не вдалося прочитати позиції."),
  liquidityPartial: "Частину позицій зараз не прочитано.",
  liquidityUnpriced: "Позицію без ціни сьогодні не враховано.",
  liquidityUnder: `Сьогодні жодну позицію не враховано: потрібно від $${MIN_POSITION_USD}, які можна вивести, у верифікованих токенах, у пулі з торгами за добу.`,
  liquidityDays: (have, need) => `${have} з ${need} днів`,
  liquidityShow: "Показувати мій значок ліквідності в таблицях",
  liquiditySaveFailed: "Не збережено. Спробуйте ще раз за мить.",
  liquidityTagAloud: "Значок ліквідності:",
  earnedOn: (day) => `з ${day}`,
  notYet: (name) => `${name}, ще не отримано`,
  notHeld: "ще не отримано",
  badgesHeld: (held, total) => `${held} з ${total}`,

  howTitle: "Як це працює",
  how: [
    "Ваша частка — з тієї частини комісій пулу, яку Ryntra справді отримала. Ніколи не з частки творця й не з обігу.",
    "Усе, що платиться з частки Ryntra одного пулу, разом — не більше 40% від неї.",
    "Частка чекає 14 днів, а доступною стає, коли творця активовано.",
    "Один рівень: частка лише за творців, яких ви привели самі. Ваші власні гаманці й гаманці команди не рахуються.",
    "Кожен запис зберігає версію Умов, за якою його пораховано.",
  ],
  terms: "Умови партнера",
  kit: "Медіакіт",

  kitTitle: "Медіакіт",
  kitLead: "Справжні екрани, бренд і слова, щоб пояснити Ryntra творцеві.",
  kitLinkTitle: "Ваше посилання",
  kitLinkGate: "Підключіть гаманець, щоб отримати особисте посилання.",
  kitLinkLoading: "Завантажуємо ваше посилання…",
  screensTitle: "Екрани",
  screensLead: "Живий продукт 16 жовтня 2026 року, без гаманця.",
  screen: { launch: "Запуск токена", rules: "Правила ринку", review: "Перевірка перед підписом" },
  download: "Завантажити",
  brandTitle: "Бренд",
  brandRules: [
    "Пишіть Ryntra — одним словом, з великої R.",
    "Знак — як є: без поворотів, нових кольорів і розтягування.",
    "Помаранчевий — для однієї дії, ніколи не тло довгого тексту.",
  ],
  colors: { orange: "Помаранчевий Ryntra", graphite: "Графіт", font: "Шрифт" },
  marks: { mark: "Знак", heat: "Знак, теплий", navy: "Знак, темно‑синій", sand: "Знак, пісочний" },
  feesTitle: "Комісії запуску на Solana",
  fees: [
    "Запуск коштує лише ренту мережі.",
    "На кривій угода платить 1%: більше в перші хвилини, щоб платили снайпери, плюс комісія волатильності, коли ціна рухається швидко.",
    "Meteora лишає собі 20% цієї комісії. З решти 40% отримує творець, 60% — Ryntra.",
    "При виході на DEX 2% зібраного кривою — комісія; 40% з неї — творцю.",
    "Після виходу ринок торгує в пулі Meteora, комісія якого спадає з 2% до 0,5%, коли ціна зросте вдесятеро або мине 30 днів — що настане раніше.",
    "Так працюють запуски «Класичний» і «Захищений».",
  ],
  lockedTitle: "Замкнена ліквідність",
  locked: [
    "При виході на DEX ліквідність переходить у пул і замикається: половина належить творцеві, половина — Ryntra.",
    "Замкнена — значить ліквідність пулу не може вивести ніхто.",
    "Обидві половини збирають комісії пулу, доки ринок торгує; половина цих комісій повертається в пул і поглиблює його.",
  ],
  shareTitle: "Звідки ваша частка",
  shareLines: [
    "Лише з частини комісій пулу, яку отримує Ryntra.",
    "Приклад — арифметика, не прогноз: Ryntra отримала з пулу $100; 20% партнера «Стандарт» — $20.",
  ],
  postsTitle: "Слова для допису",
  postsLead: "Копіюйте, змінюйте як хочете, лишайте правду.",
  posts: [
    (link) => `Запускаєте токен? На Ryntra творець отримує 40% комісій кривої після Meteora, а ліквідність замикається при виході на DEX. Почніть тут: ${link} #реклама`,
    (link) => `Ринок, що лишається: Ryntra замикає ліквідність пулу при виході на DEX, половина — творцеві. Запускайте за моїм посиланням: ${link} #реклама`,
  ],
  adLabel: "Кожен допис — з #реклама; в X увімкніть ще «Paid Partnership».",
  back: "Партнери творців",
};

function ukCreators(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (last === 1 && tens !== 11) return "активованого творця";
  return "активованих творців";
}

export function partnerCopy(locale: WorkspaceLocale): Copy {
  return locale === "uk" ? UK : EN;
}
