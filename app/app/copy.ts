// Cabinet chrome copy (en/uk/ru). Technical/brand tokens (Ryntra, SmartTrade, PAPER,
// market symbols, numbers) stay English by convention; the shell is translate="no".

export type CbLang = "en" | "uk" | "ru";

export type CbCopy = {
  nav: { dash: string; term: string; journal: string; settings: string; bot: string; logout: string; connect: string; swap: string; beta: string };
  sections: { work: string; account: string };
  theme: { system: string; dark: string; light: string };
  swap: {
    eyebrow: string;
    title: string;
    sub: string;
    connectWallet: string;
    noWallet: string;
    youPay: string;
    youReceive: string;
    balance: string;
    max: string;
    rate: string;
    minReceived: string;
    slippage: string;
    quoting: string;
    noQuote: string;
    review: string;
    swapBtn: string;
    signIntent: string;
    feeFromPay: string;
    feeFromReceive: string;
    feeBothSides: string;
    platformFee: string;
    signedRouterFee: string;
    networkGas: string;
    networkGasWallet: string;
    feeUnavailable: string;
    executionUnsupported: string;
    executionUnsupportedCta: string;
    swapping: string;
    stepSwitch: string;
    stepApprove: string;
    stepPermit: string;
    stepSwap: string;
    stepRequote: string;
    stepSubmit: string;
    stepConfirm: string;
    confirmTransaction: string;
    confirmHint: string;
    intentExpired: string;
    tradeChanged: string;
    approveOneTime: string;
    approveHint: string;
    allowanceChecking: string;
    allowanceRetry: string;
    complianceChecking: string;
    complianceRetry: string;
    cancelledFresh: string;
    approvalCancelled: string;
    approvalUnknown: string;
    discardSignedQuote: string;
    signedQuoteDiscarded: string;
    submissionLocked: string;
    submissionUnknown: string;
    recoveryWalletCheck: string;
    recoveryViewTransaction: string;
    recoveryClear: string;
    recoveryCleared: string;
    recoveryStorageFailed: string;
    approvalRecovered: string;
    attemptReverted: string;
    expiresAt: string;
    done: string;
    viewOnArcus: string;
    enterAmount: string;
    insufficient: string;
    minOrder: string;
    live: string;
    trust: string;
    trustShort: string;
    wrappedNote: string;
    routes: {
      title: string;
      /** Quote COMPARISON note — never implies route selection; execution runs through Arcus only. */
      choose: string;
      executable: string;
      quoteOnly: string;
      unsupported: string;
      noLiquidity: string;
      checking: string;
      unavailable: string;
      feeLabel: string;
      arcusFee: string;
      uniFee: string;
      best: string;
      stale: string;
    };
    heat: {
      title: string;
      largest: string;
      equities: string;
      crypto: string;
      partial: string;
      concentrated: string;
      correlated: string;
    };
  };
  connect: {
    eyebrow: string;
    title: string;
    sub: string;
    step1: string;
    step1Body: string;
    step1Boundary: string;
    step1Cta: string;
    step1NoWallet: string;
    step1Connected: string;
    step2: string;
    step2Body: string;
    step2Authority: string;
    step2Cta: string;
    step2Signing: string;
    step2Active: string;
    step2Expires: string;
    step2Forget: string;
    step2Revoking: string;
    step2Revoked: string;
    step2ForgetLocal: string;
    step3: string;
    step3Cta: string;
    step3Found: string;
    step3NotFound: string;
    nextNote: string;
    trust1: string;
    trust2: string;
    trust3: string;
  };
  dash: {
    eyebrow: string;
    title: string;
    sub: string;
    kpiPaper: string;
    kpiPaperHint: string;
    kpiDiscipline: string;
    winRate: string;
    adherence: string;
    avgR: string;
    trades: string;
    kpiStatus: string;
    /** Binary access label, not a rung on a ladder. */
    access: string;
    kpiLive: string;
    liveNoWallet: string;
    livePositions: string;
    alertsOn: string;
    attnTitle: string;
    attnWallet: string;
    open: string;
    cardPaper: string;
    cardPaperCta: string;
    cardLive: string;
    cardLiveBody: string;
    cardLiveCta: string;
    cardLiveSetCta: string;
    cardJournal: string;
    cardJournalBody: string;
    cardJournalCta: string;
  };
  /**
   * Ryntra Home — the neutral centre.
   *
   * Every string here describes something the account really has. Two rules the
   * block is written to keep, because Home is exactly where a portfolio product
   * starts inventing numbers:
   *
   *   A source that could not be read is not zero. `srcLiveUnread` and
   *   `pulseUnread` exist so the page can say "we could not ask" in the same
   *   voice it says "nothing here".
   *
   *   There is no single cross-chain total, so nothing here names one.
   *   `sourcesNote` states that rather than adding up numbers that do not share
   *   a unit, a custody model or a valuation basis.
   */
  home: {
    /* No `eyebrow`. It read `Ryntra Home`, which is this workspace's name and
       therefore registry data — the same reason the per-workspace names are
       gone from below. */
    title: string;
    sub: string;
    attnTitle: string;
    /** The visitor branch of Attention, and the two blocks that follow it. */
    attnUnavailable: string;
    observedTitle: string;
    observedSub: string;
    observedNone: string;
    openPortfolio: string;
    attnWallet: string;
    attnJournal: string;
    attnVisitor: string;
    /** Connected sources. */
    sourcesTitle: string;
    sourcesSub: string;
    sourcesNote: string;
    srcPaper: string;
    srcPaperNote: string;
    srcPaperNone: string;
    srcPaperUnread: string;
    srcLive: string;
    srcLiveNote: string;
    srcLiveNone: string;
    srcLiveUnread: string;
    paperOpen: string;
    paperClosed: string;
    /** Workspace cards. */
    spacesTitle: string;
    spacesSub: string;
    open: string;
    /* No per-workspace names. A workspace's name is not copy: it is
       registry data, read from `app/shell/workspaces.ts` at the two places
       Home renders it. Three locales spelling it out was three chances to
       disagree with the switcher, and two of them had already been taken. */
    spaceMarketsNote: string;
    /** Market pulse, from the venue's own market list. */
    pulseTitle: string;
    pulseSub: string;
    pulseOnline: string;
    pulseCrypto: string;
    pulseRwa: string;
    pulseOffHours: string;
    pulseOffHoursNote: string;
    pulseUnread: string;
    /** Recent activity, from closed paper trades. */
    activityTitle: string;
    activitySub: string;
    activityEmpty: string;
    loopTitle: string;
    loopSub: string;
    loopPlan: string;
    loopReadiness: string;
    loopAuthorize: string;
    loopExecute: string;
    loopReceipt: string;
    loopReview: string;
    recordsTitle: string;
    recordsBody: string;
  };
  journal: { eyebrow: string; title: string; sub: string; kpiAdherence: string; kpiWin: string; kpiAvgR: string; kpiClosed: string; kpiJournaled: string; kpiDisciplineHint: string };
  settings: { eyebrow: string; title: string; sub: string };
  beta: { title: string; hint: string; optionalTitle: string };
};

export const CB_COPY: Record<CbLang, CbCopy> = {
  en: {
    nav: { dash: "Dashboard", term: "SmartTrade", journal: "Journal", settings: "Settings", bot: "Telegram bot", logout: "Log out", connect: "Connect Arcus", swap: "Spot Swap", beta: "Beta Access" },
    sections: { work: "Workspace", account: "Account" },
    theme: { system: "System", dark: "Dark", light: "Light" },
    swap: {
      eyebrow: "Arcus Spot · live",
      title: "Spot Swap",
      sub: "Buy tokenized stocks with USDG, or sell back — priced by Arcus RFQ, settled on-chain by your own wallet. Non-custodial: Ryntra never holds funds or keys.",
      connectWallet: "Connect wallet",
      noWallet: "No wallet extension found. Open this page in a browser with MetaMask (or another injected wallet).",
      youPay: "You pay",
      youReceive: "You receive (est.)",
      balance: "Balance",
      max: "Max",
      rate: "Rate",
      minReceived: "Minimum received",
      slippage: "Max slippage",
      quoting: "Getting best price…",
      noQuote: "No quote available for this pair right now.",
      review: "Review the details, then confirm in your wallet.",
      swapBtn: "Swap",
      swapping: "Swapping…",
      signIntent: "Sign intent → {asset}",
      feeFromPay: "from the amount paid",
      feeFromReceive: "from the amount received",
      feeBothSides: "from both sides",
      platformFee: "Quoted provider/platform total",
      signedRouterFee: "Signed router component (included; do not add)",
      networkGas: "Network gas",
      networkGasWallet: "Shown separately in your wallet",
      feeUnavailable: "Quote fee details are missing or inconsistent. Signing is blocked; refresh the quote.",
      executionUnsupported: "Wallet execution is limited to verified, allowlisted USDG routes for TSLA, AAPL, and AMD. This pair remains quote-only; no approval or signature will be requested.",
      executionUnsupportedCta: "Quote only · execution route not allowlisted",
      stepSwitch: "Switch your wallet to Robinhood Chain…",
      stepApprove: "Approve unlimited {sym} to Permit2 in your wallet…",
      stepPermit: "Authorize the router (one-time)…",
      stepSwap: "Sign the swap intent in your wallet…",
      stepRequote: "Refreshing quote…",
      stepSubmit: "Confirm the transaction in your wallet…",
      stepConfirm: "Transaction sent. Waiting for network confirmation…",
      confirmTransaction: "Confirm transaction",
      confirmHint: "Intent signed. One final wallet confirmation is required.",
      intentExpired: "The signed quote expired. Sign a fresh quote to continue.",
      tradeChanged: "The trade changed while signing. Review it and sign again.",
      approveOneTime: "Approve unlimited {sym} to Permit2",
      approveHint: "This on-chain approval sets {sym}'s Permit2 allowance to the maximum and remains until you revoke it. No swap is sent in this step.",
      allowanceChecking: "Checking token approval…",
      allowanceRetry: "Allowance check failed · Retry",
      complianceChecking: "Checking Arcus eligibility…",
      complianceRetry: "Retry eligibility check",
      cancelledFresh: "Cancelled. Sign a fresh quote to try again.",
      approvalCancelled: "Approval cancelled. No token approval was submitted; press Approve when ready.",
      discardSignedQuote: "Discard signed quote",
      signedQuoteDiscarded: "Signed quote discarded. Review the ticket before signing again.",
      approvalUnknown: "Approval status is unknown. Do not approve again until you check wallet activity.",
      submissionLocked: "Check wallet activity before retrying",
      submissionUnknown: "Transaction status is unknown. Do not retry this signed intent; check your wallet activity.",
      expiresAt: "Expires at",
      done: "Swap sent",
      recoveryWalletCheck: "Open your wallet extension and confirm there is no pending request or unexpected transaction before unlocking.",
      recoveryViewTransaction: "View transaction on Blockscout",
      recoveryClear: "Wallet prompt is closed; I checked wallet activity — unlock",
      recoveryCleared: "Recovery lock cleared. Request a fresh quote before continuing.",
      recoveryStorageFailed: "Wallet safety lock could not be saved. No wallet request was sent; enable site storage and retry.",
      approvalRecovered: "Approval confirmed on-chain. Refreshing the allowance.",
      attemptReverted: "The saved transaction reverted on-chain. The recovery lock was cleared.",
      viewOnArcus: "Manage this position on Arcus",
      enterAmount: "Enter an amount",
      insufficient: "Insufficient balance",
      minOrder: "Minimum order",
      live: "Live price",
      trust: "Execution and wallet signing use Arcus RFQ. Uniswap is shown for quote comparison only. Ryntra never touches your funds or keys.",
      trustShort: "Wallet-signed · Non-custodial",
      wrappedNote: "wTokens are Arcus's delivery for long-tail fills when no native token is available. They track the stock and settle to the real Stock Token automatically on the maker's cadence (e.g. every 24h); until then they can't be transferred.",
      routes: {
        title: "Quotes by route",
        choose: "Compare available quotes. Execution in Ryntra is currently available through Arcus only.",
        executable: "Executable · wallet-signed",
        quoteOnly: "Quote only · read-only — no execution in Ryntra",
        unsupported: "Quote only · outside verified execution scope",
        noLiquidity: "No AMM liquidity (checked live)",
        checking: "Checking…",
        unavailable: "Could not check",
        feeLabel: "fee",
        arcusFee: "Provider/platform total comes from the current Arcus quote. The signed router component is included in that total and shown separately for verification; do not add the two. Network gas is separate.",
        uniFee: "Uniswap v3 LP fee shown per quote. Ryntra adds no fee on this route.",
        best: "better quote",
        stale: "stale",
      },
      heat: {
        title: "Portfolio heat",
        largest: "largest",
        equities: "equities",
        crypto: "crypto",
        partial: "partial data — some values unreadable",
        concentrated: "concentrated",
        correlated: "correlated",
      },
    },
    connect: {
      eyebrow: "Arcus setup",
      title: "Connect Arcus",
      sub: "Three steps to verify a scoped Arcus trade key: your wallet signs the provider message, your browser generates the key, and Arcus activates it. Key setup alone enables no live SmartTrade or perps.",
      step1: "1 · Connect wallet",
      step1Body: "The wallet only signs one message — no transaction, no gas, no approvals.",
      step1Boundary: "Connecting here does not link this wallet to your Ryntra account. Only the separate SIWE identity proof can do that.",
      step1Cta: "Connect wallet",
      step1NoWallet: "No wallet extension found. Open this page in a browser with MetaMask (or another injected wallet).",
      step1Connected: "Connected",
      step2: "2 · Create trading key",
      step2Body: "An Ed25519 key pair is generated in this browser. The private key is stored locally (IndexedDB) and never sent anywhere. Arcus enforces that API keys cannot withdraw funds.",
      step2Authority: "This credential can authenticate supported Arcus requests from this browser. It does not authorize an order; every exact action still needs its own review and wallet authorization.",
      step2Cta: "Create trading key",
      step2Signing: "Waiting for wallet signature…",
      step2Active: "Trading key on this device",
      step2Expires: "valid until",
      step2Forget: "Revoke & forget key",
      step2Revoking: "Revoking on Arcus — sign in your wallet…",
      step2Revoked: "Key revoked on Arcus and removed from this device.",
      step2ForgetLocal: "Remove from this device only (stays active on Arcus until expiry)",
      step3: "3 · Verify on Arcus",
      step3Cta: "Check key status",
      step3Found: "Key is active on Arcus. Setup is verified; live SmartTrade and perps remain unavailable.",
      step3NotFound: "Key not visible on Arcus yet — try again in a few seconds.",
      nextNote: "This trade-key setup adds no execution path. Paper trading and read-only account data remain available; the separately supported wallet-signed Arcus spot RFQ is unchanged. Live SmartTrade and perps remain unavailable until separate provider, legal, security, reliability, eligibility, release, and explicit human-authorization gates pass.",
      trust1: "No deposits to Ryntra — funds stay on Arcus.",
      trust2: "The private key never leaves this browser.",
      trust3: "Withdrawals require your wallet signature — enforced by the exchange itself.",
    },
    dash: {
      eyebrow: "Trading workspace",
      title: "Overview",
      sub: "Discipline first: plan the trade, see the risk, review the journal — then size up.",
      kpiPaper: "Paper balance",
      kpiPaperHint: "vs $10,000 start",
      kpiDiscipline: "Discipline",
      winRate: "win rate",
      adherence: "plan adherence",
      avgR: "avg R",
      trades: "closed trades",
      kpiStatus: "Beta Status",
      access: "beta access",
      kpiLive: "Live account",
      liveNoWallet: "wallet not connected",
      livePositions: "open positions",
      alertsOn: "fill alerts on",
      attnTitle: "Needs attention",
      attnWallet: "Add your public wallet address — optional, and it turns on the read-only live view, real-trade journal and Telegram fill alerts.",
      open: "Open",
      cardPaper: "Paper trading",
      cardPaperCta: "Open terminal",
      cardLive: "Live account",
      cardLiveBody: "Real positions, PnL and fills for your public address. Read-only — never keys.",
      cardLiveCta: "View live account",
      cardLiveSetCta: "Add address in Settings",
      cardJournal: "Journal & discipline",
      cardJournalBody: "Every closed trade lands here. Tag mistakes, save lessons, watch adherence.",
      cardJournalCta: "Open journal",
    },
    home: {
      title: "Today",
      sub: "What needs your attention now, what you hold, and what the markets are doing — before you pick a workspace.",
      attnTitle: "Needs attention",
      attnUnavailable: "This attention read did not complete, so nothing is claimed for it.",
      observedTitle: "Observed value",
      observedSub: "The value of the positions Ryntra could price, with the coverage that makes it readable. Depth is in Portfolio.",
      observedNone: "No source is readable for this account yet, so no value is stated — and none is invented. Connect a source to populate this.",
      openPortfolio: "Open Portfolio",
      attnWallet: "Add your public wallet address — optional, and it turns on the read-only live view, real-trade journal and Telegram fill alerts.",
      attnJournal: "You have closed trades that are not journaled. A closed trade without a reason is a result you cannot learn from.",
      attnVisitor: "You are reading Ryntra as a visitor. Everything here is real and read-only; sign in to keep plans, journal and alerts — one confirmation in Telegram, no email and no password.",
      sourcesTitle: "Connected sources",
      sourcesSub: "Each source shown as itself. Simulated and read-only; nothing here is held by Ryntra.",
      sourcesNote:
        "There is no single portfolio total yet. These sources do not share a unit, a custody model or a valuation basis, and adding them would produce a number nothing could back. One total appears when each source can be valued from evidence.",
      srcPaper: "Paper account",
      srcPaperNote: "simulated, $10,000 start",
      srcPaperNone: "no paper account yet — sign in to start one",
      srcPaperUnread: "paper account could not be read",
      srcLive: "Live account",
      srcLiveNote: "open positions · read-only",
      srcLiveNone: "wallet not connected",
      srcLiveUnread: "venue could not be read",
      paperOpen: "open",
      paperClosed: "closed",
      spacesTitle: "Workspaces",
      spacesSub: "Home summarises. The work happens in the workspace that owns it.",
      open: "Open",
      spaceMarketsNote: "Paper terminal, Radar and the registered wallet-signed spot routes.",
      pulseTitle: "Market pulse",
      pulseSub: "Venue-reported market state, not prices. Read live from the Arcus market list.",
      pulseOnline: "markets online",
      pulseCrypto: "crypto · 24/7",
      pulseRwa: "equities, commodities, indices",
      pulseOffHours: "outside regular trading hours",
      pulseOffHoursNote:
        "The venue reports market hours itself. A tokenized market that trades while its underlying is closed carries a different risk regime, which is the fact this panel exists to show.",
      pulseUnread: "The venue could not be read just now. This is not zero — it is an unanswered question, and it is shown as one.",
      activityTitle: "Recent activity",
      activitySub: "Your last closed positions. Full history and the plan behind each one live in the Journal.",
      activityEmpty: "Nothing closed yet. Activity appears here as soon as a position is closed.",
      loopTitle: "The decision loop",
      loopSub: "Where each stage actually stands. States come from the capability registry, not from this page.",
      loopPlan: "Plan",
      loopReadiness: "Readiness",
      loopAuthorize: "Authorize",
      loopExecute: "Execute",
      loopReceipt: "Receipt",
      loopReview: "Review",
      recordsTitle: "Receipts",
      recordsBody: "Home does not keep a receipt ledger yet — the append-only contracts are prepared, not shipped.",
    },
    journal: { eyebrow: "Discipline", title: "Journal", sub: "Paper and real trades side by side — plans, mistakes and lessons.", kpiAdherence: "Plan adherence", kpiWin: "Win rate", kpiAvgR: "Avg R", kpiClosed: "Closed trades", kpiJournaled: "journaled", kpiDisciplineHint: "Discipline, not profit, is the metric" },
    settings: { eyebrow: "Account", title: "Settings", sub: "Language, wallet address and appearance." },
    beta: {
      title: "Beta Access",
      hint: "Confirming in the Telegram bot is the only thing that opens the beta.",
      optionalTitle: "Optional, and optional means optional",
    },
  },
  uk: {
    nav: { dash: "Дашборд", term: "SmartTrade", journal: "Журнал", settings: "Налаштування", bot: "Telegram-бот", logout: "Вийти", connect: "Підключення Arcus", swap: "Spot Swap", beta: "Бета-доступ" },
    sections: { work: "Робота", account: "Акаунт" },
    theme: { system: "Системна", dark: "Темна", light: "Світла" },
    swap: {
      eyebrow: "Arcus Spot · live",
      title: "Spot Swap",
      sub: "Купуй токенізовані акції за USDG або продавай назад — ціна від Arcus RFQ, розрахунок on-chain твоїм гаманцем. Non-custodial: Ryntra не тримає ні коштів, ні ключів.",
      connectWallet: "Підключити гаманець",
      noWallet: "Розширення гаманця не знайдено. Відкрий цю сторінку в браузері з MetaMask (або іншим injected-гаманцем).",
      youPay: "Ти платиш",
      youReceive: "Ти отримаєш (≈)",
      balance: "Баланс",
      max: "Макс",
      rate: "Курс",
      minReceived: "Мінімум до отримання",
      slippage: "Макс. slippage",
      quoting: "Шукаю найкращу ціну…",
      noQuote: "Зараз немає котирування для цієї пари.",
      review: "Перевір деталі й підтверди в гаманці.",
      swapBtn: "Обміняти",
      swapping: "Обмін…",
      stepSwitch: "Перемкни гаманець на Robinhood Chain…",
      signIntent: "Підписати намір → {asset}",
      feeFromPay: "із суми оплати",
      feeFromReceive: "із суми отримання",
      feeBothSides: "з обох сторін",
      platformFee: "Загальна provider/platform fee у котируванні",
      signedRouterFee: "Підписаний router-компонент (включено; не додавати)",
      networkGas: "Комісія мережі",
      networkGasWallet: "Буде показана окремо у гаманці",
      feeUnavailable: "Дані про комісію відсутні або суперечливі. Підпис заблоковано; онови котирування.",
      executionUnsupported: "Виконання через гаманець доступне лише для перевірених USDG-маршрутів TSLA, AAPL та AMD. Для цієї пари доступне лише котирування; дозвіл або підпис не запитуватимуться.",
      executionUnsupportedCta: "Лише котирування · виконання не перевірено",
      stepApprove: "Підтверди необмежений дозвіл {sym} для Permit2 у гаманці…",
      stepPermit: "Авторизуй роутер (одноразово)…",
      stepSwap: "Підпиши намір обміну в гаманці…",
      stepRequote: "Оновлюю котирування…",
      stepSubmit: "Підтверди транзакцію в гаманці…",
      stepConfirm: "Транзакцію надіслано. Чекаю підтвердження мережі…",
      confirmTransaction: "Підтвердити транзакцію",
      confirmHint: "Намір підписано. Залишилося підтвердити транзакцію в гаманці.",
      intentExpired: "Підписане котирування застаріло. Підпиши нове, щоб продовжити.",
      tradeChanged: "Параметри обміну змінилися під час підпису. Перевір їх і підпиши ще раз.",
      approveOneTime: "Необмежений дозвіл {sym} для Permit2",
      approveHint: "Ця on-chain транзакція встановлює максимальний allowance {sym} для Permit2; він діє, доки ти його не відкличеш. На цьому кроці обмін не надсилається.",
      allowanceChecking: "Перевіряю дозвіл токена…",
      allowanceRetry: "Не вдалося перевірити дозвіл · Повторити",
      complianceChecking: "Перевіряю доступність Arcus…",
      complianceRetry: "Повторити перевірку доступності",
      cancelledFresh: "Скасовано. Підпиши свіже котирування, щоб спробувати знову.",
      approvalCancelled: "Дозвіл скасовано. Token approval не надіслано; натисни «Дозволити», коли будеш готовий.",
      discardSignedQuote: "Відкинути підписане котирування",
      signedQuoteDiscarded: "Підписане котирування відкинуто. Перевір тікет перед новим підписом.",
      approvalUnknown: "Статус дозволу невідомий. Не надсилай його повторно, доки не перевіриш активність гаманця.",
      submissionLocked: "Перевір активність гаманця перед повтором",
      submissionUnknown: "Статус транзакції невідомий. Не повторюй цей підписаний намір; перевір активність гаманця.",
      expiresAt: "Діє до",
      done: "Обмін надіслано",
      recoveryWalletCheck: "Відкрий розширення гаманця й переконайся, що немає pending-запиту або неочікуваної транзакції, перш ніж розблокувати.",
      recoveryViewTransaction: "Переглянути транзакцію в Blockscout",
      recoveryClear: "Wallet prompt закрито; активність гаманця перевірено — розблокувати",
      recoveryCleared: "Захисне блокування знято. Перед продовженням отримай свіже котирування.",
      approvalRecovered: "Дозвіл підтверджено on-chain. Оновлюю allowance.",
      recoveryStorageFailed: "Не вдалося зберегти захисне блокування гаманця. Wallet-запит не надіслано; увімкни сховище сайту й повтори.",
      attemptReverted: "Збережена транзакція відкотилася on-chain. Захисне блокування знято.",
      viewOnArcus: "Керувати позицією на Arcus",
      enterAmount: "Введи суму",
      insufficient: "Недостатньо балансу",
      minOrder: "Мінімальний ордер",
      live: "наживо",
      trust: "Виконання і підпис гаманцем — через Arcus RFQ. Uniswap показано лише для порівняння котирувань. Ryntra ніколи не торкається твоїх коштів чи ключів.",
      trustShort: "Підпис гаманцем · Без зберігання коштів",
      wrappedNote: "wTokens — це спосіб доставки Arcus для long-tail філів, коли native-токена немає в наявності. Вони відстежують акцію і автоматично сеттляться в справжній Stock Token за каденцією мейкера (напр., кожні 24 год); до того їх не можна переказувати.",
      routes: {
        title: "Котирування за маршрутами",
        choose: "Порівняння доступних котирувань. Виконання в Ryntra зараз доступне лише через Arcus.",
        executable: "Доступно до виконання · wallet-signed",
        quoteOnly: "Лише котирування · read-only — без виконання в Ryntra",
        unsupported: "Лише котирування · поза перевіреним контуром виконання",
        noLiquidity: "Немає AMM-ліквідності (перевірено наживо)",
        checking: "Перевіряю…",
        unavailable: "Не вдалося перевірити",
        feeLabel: "fee",
        arcusFee: "Загальна provider/platform fee береться з поточного котирування Arcus. Підписаний router-компонент входить у цю суму й показується окремо для перевірки; не додавай їх. Network gas — окремо.",
        uniFee: "LP-комісія Uniswap v3 показується в котируванні. Ryntra не додає комісії на цьому маршруті.",
        best: "краще котирування",
        stale: "застаріло",
      },
      heat: {
        title: "Portfolio heat", // назва фічі — технічний токен, лишається англійською (конвенція)
        largest: "найбільша",
        equities: "акції",
        crypto: "крипто",
        partial: "часткові дані — частину значень не вдалося прочитати",
        concentrated: "концентрація",
        correlated: "кореляція",
      },
    },
    connect: {
      eyebrow: "Налаштування Arcus",
      title: "Підключення Arcus",
      sub: "Три кроки для перевірки обмеженого торгового ключа Arcus: гаманець підписує provider message, браузер генерує ключ, а Arcus його активує. Сам ключ не вмикає live SmartTrade чи perps.",
      step1: "1 · Підключи гаманець",
      step1Body: "Гаманець лише підписує одне повідомлення — без транзакції, без газу, без approvals.",
      step1Boundary: "Підключення тут не прив'язує цей гаманець до акаунта Ryntra. Це може зробити лише окремий SIWE-доказ ідентичності.",
      step1Cta: "Підключити гаманець",
      step1NoWallet: "Розширення гаманця не знайдено. Відкрий цю сторінку в браузері з MetaMask (або іншим injected-гаманцем).",
      step1Connected: "Підключено",
      step2: "2 · Створи торговий ключ",
      step2Body: "Пара ключів Ed25519 генерується в цьому браузері. Приватний ключ зберігається локально (IndexedDB) і нікуди не надсилається. Arcus гарантує: API-ключі не можуть виводити кошти.",
      step2Authority: "Цей credential може автентифікувати підтримані Arcus-запити з цього браузера. Він не авторизує ордер; кожна точна дія все одно потребує окремого review та wallet authorization.",
      step2Cta: "Створити торговий ключ",
      step2Signing: "Чекаю підпис гаманця…",
      step2Active: "Торговий ключ на цьому пристрої",
      step2Expires: "діє до",
      step2Forget: "Відкликати й забути ключ",
      step2Revoking: "Відкликаю на Arcus — підпиши в гаманці…",
      step2Revoked: "Ключ відкликано на Arcus і прибрано з цього пристрою.",
      step2ForgetLocal: "Прибрати лише з цього пристрою (на Arcus діятиме до закінчення строку)",
      step3: "3 · Перевір на Arcus",
      step3Cta: "Перевірити статус ключа",
      step3Found: "Ключ активний на Arcus. Налаштування перевірено; live SmartTrade і perps залишаються недоступними.",
      step3NotFound: "Ключ ще не видно на Arcus — спробуй за кілька секунд.",
      nextNote: "Це налаштування trade-key не додає шляху виконання. Paper-трейдинг і read-only дані акаунта доступні; окремо підтримуваний wallet-signed Arcus spot RFQ не змінюється. Live SmartTrade і perps недоступні, доки окремо не пройдено provider, legal, security, reliability, eligibility, release та явні human-authorization gates.",
      trust1: "Без депозитів у Ryntra — кошти лишаються на Arcus.",
      trust2: "Приватний ключ ніколи не покидає цей браузер.",
      trust3: "Вивід коштів вимагає підпису гаманця — це гарантує сама біржа.",
    },
    dash: {
      eyebrow: "Trading workspace",
      title: "Огляд",
      sub: "Спочатку дисципліна: план угоди, видимий ризик, журнал — і лише потім розмір позиції.",
      kpiPaper: "Paper-баланс",
      kpiPaperHint: "від старту $10,000",
      kpiDiscipline: "Дисципліна",
      winRate: "win rate",
      adherence: "дотримання плану",
      avgR: "середній R",
      trades: "закритих угод",
      kpiStatus: "Beta Status",
      access: "доступ до бети",
      kpiLive: "Live-акаунт",
      liveNoWallet: "wallet не підключено",
      livePositions: "відкритих позицій",
      alertsOn: "алерти на філи увімкнено",
      attnTitle: "Потребує уваги",
      attnWallet: "Підключи wallet-адресу — розблокує read-only live-режим, журнал реальних угод і Telegram-алерти на філи.",
      open: "Відкрити",
      cardPaper: "Paper-трейдинг",
      cardPaperCta: "Відкрити термінал",
      cardLive: "Live-акаунт",
      cardLiveBody: "Реальні позиції, PnL і філи за твоєю публічною адресою. Read-only — жодних ключів.",
      cardLiveCta: "Переглянути live-акаунт",
      cardLiveSetCta: "Додати адресу в Налаштуваннях",
      cardJournal: "Журнал і дисципліна",
      cardJournalBody: "Кожна закрита угода потрапляє сюди. Тегуй помилки, зберігай уроки, стеж за дотриманням плану.",
      cardJournalCta: "Відкрити журнал",
    },
    home: {
      title: "Сьогодні",
      sub: "Що потребує уваги зараз, що у тебе є і що робить ринок — ще до вибору робочого простору.",
      attnTitle: "Потребує уваги",
      attnUnavailable: "Це читання уваги не завершилося, тому нічого не стверджується.",
      observedTitle: "Спостережена вартість",
      observedSub: "Вартість позицій, які Ryntra змогла оцінити, разом із покриттям, що робить її читабельною. Глибина — у Портфелі.",
      observedNone: "Для цього акаунта поки не читається жодне джерело, тому вартість не вказується — і не вигадується. Підключи джерело, щоб заповнити це.",
      openPortfolio: "Відкрити Портфель",
      attnWallet: "Додай публічну адресу гаманця — це необовʼязково і вмикає read-only перегляд рахунку, журнал реальних угод та Telegram-сповіщення про виконання.",
      attnJournal: "Є закриті угоди без запису в журналі. Закрита угода без причини — це результат, з якого нічого не навчишся.",
      attnVisitor: "Ти читаєш Ryntra як відвідувач. Усе тут справжнє і доступне лише для читання; увійди, щоб зберігати плани, журнал і сповіщення — одне підтвердження в Telegram, без пошти й пароля.",
      sourcesTitle: "Підключені джерела",
      sourcesSub: "Кожне джерело показане окремо. Симуляція і read-only; Ryntra нічого з цього не зберігає.",
      sourcesNote:
        "Єдиного підсумку портфеля поки немає. Ці джерела не мають спільної одиниці, моделі зберігання чи бази оцінки, і їх сума була б числом, яке нічим не підтвердити. Один підсумок зʼявиться тоді, коли кожне джерело можна буде оцінити за доказами.",
      srcPaper: "Paper-рахунок",
      srcPaperNote: "симуляція, старт $10 000",
      srcPaperNone: "paper-рахунку ще немає — увійди, щоб його створити",
      srcPaperUnread: "paper-рахунок не вдалося прочитати",
      srcLive: "Реальний рахунок",
      srcLiveNote: "відкритих позицій · read-only",
      srcLiveNone: "гаманець не підключено",
      srcLiveUnread: "венʼю не вдалося прочитати",
      paperOpen: "відкритих",
      paperClosed: "закритих",
      spacesTitle: "Робочі простори",
      spacesSub: "Home підсумовує. Робота відбувається в тому просторі, якому вона належить.",
      open: "Відкрити",
      spaceMarketsNote: "Паперовий термінал, Radar і зареєстровані спот-маршрути з підписом гаманця.",
      pulseTitle: "Пульс ринку",
      pulseSub: "Стан ринків за даними венʼю, не ціни. Читається наживо зі списку ринків Arcus.",
      pulseOnline: "ринків онлайн",
      pulseCrypto: "крипто · 24/7",
      pulseRwa: "акції, товари, індекси",
      pulseOffHours: "поза основною торговою сесією",
      pulseOffHoursNote:
        "Венʼю саме повідомляє години торгів. Токенізований ринок, який торгується, коли його базовий актив закритий, має інший режим ризику — саме це показує ця панель.",
      pulseUnread: "Венʼю зараз не вдалося прочитати. Це не нуль — це питання без відповіді, і воно показане саме так.",
      activityTitle: "Остання активність",
      activitySub: "Твої останні закриті позиції. Повна історія та план за кожною з них — у Журналі.",
      activityEmpty: "Поки нічого не закрито. Активність зʼявиться тут одразу після закриття позиції.",
      loopTitle: "Цикл рішення",
      loopSub: "Де насправді кожен етап. Стани приходять з реєстру спроможностей, а не з цієї сторінки.",
      loopPlan: "План",
      loopReadiness: "Готовність",
      loopAuthorize: "Авторизація",
      loopExecute: "Виконання",
      loopReceipt: "Квитанція",
      loopReview: "Розбір",
      recordsTitle: "Квитанції",
      recordsBody: "Home ще не веде реєстр квитанцій — append-only контракти підготовлені, але не випущені.",
    },
    journal: { eyebrow: "Дисципліна", title: "Журнал", sub: "Paper і реальні угоди поруч — плани, помилки та уроки.", kpiAdherence: "Дотримання плану", kpiWin: "Win rate", kpiAvgR: "Середній R", kpiClosed: "Закритих угод", kpiJournaled: "у журналі", kpiDisciplineHint: "Метрика — дисципліна, не прибуток" },
    settings: { eyebrow: "Акаунт", title: "Налаштування", sub: "Мова, wallet-адреса та вигляд." },
    beta: {
      title: "Бета-доступ",
      hint: "Підтвердження в Telegram-боті — єдине, що відкриває бету.",
      optionalTitle: "Опційне лишається опційним",
    },
  },
  ru: {
    nav: { dash: "Дашборд", term: "SmartTrade", journal: "Журнал", settings: "Настройки", bot: "Telegram-бот", logout: "Выйти", connect: "Подключение Arcus", swap: "Spot Swap", beta: "Бета-доступ" },
    sections: { work: "Работа", account: "Аккаунт" },
    theme: { system: "Системная", dark: "Тёмная", light: "Светлая" },
    swap: {
      eyebrow: "Arcus Spot · live",
      title: "Spot Swap",
      sub: "Покупай токенизированные акции за USDG или продавай обратно — цена от Arcus RFQ, расчёт on-chain твоим кошельком. Non-custodial: Ryntra не держит ни средств, ни ключей.",
      connectWallet: "Подключить кошелёк",
      noWallet: "Расширение кошелька не найдено. Открой эту страницу в браузере с MetaMask (или другим injected-кошельком).",
      youPay: "Ты платишь",
      youReceive: "Ты получишь (≈)",
      balance: "Баланс",
      max: "Макс",
      rate: "Курс",
      minReceived: "Минимум к получению",
      slippage: "Макс. slippage",
      quoting: "Ищу лучшую цену…",
      noQuote: "Сейчас нет котировки для этой пары.",
      review: "Проверь детали и подтверди в кошельке.",
      swapBtn: "Обменять",
      swapping: "Обмен…",
      stepSwitch: "Переключи кошелёк на Robinhood Chain…",
      signIntent: "Подписать намерение → {asset}",
      feeFromPay: "из суммы оплаты",
      feeFromReceive: "из суммы получения",
      feeBothSides: "с обеих сторон",
      platformFee: "Общая provider/platform fee в котировке",
      signedRouterFee: "Подписанный router-компонент (включён; не складывать)",
      networkGas: "Комиссия сети",
      networkGasWallet: "Будет показана отдельно в кошельке",
      feeUnavailable: "Данные о комиссии отсутствуют или противоречивы. Подпись заблокирована; обнови котировку.",
      executionUnsupported: "Исполнение через кошелёк доступно только для проверенных USDG-маршрутов TSLA, AAPL и AMD. Для этой пары доступна только котировка; разрешение или подпись запрашиваться не будут.",
      executionUnsupportedCta: "Только котировка · исполнение не проверено",
      stepApprove: "Подтверди неограниченное разрешение {sym} для Permit2 в кошельке…",
      stepPermit: "Авторизуй роутер (разово)…",
      stepSwap: "Подпиши намерение обмена в кошельке…",
      stepRequote: "Обновляю котировку…",
      stepSubmit: "Подтверди транзакцию в кошельке…",
      stepConfirm: "Транзакция отправлена. Жду подтверждения сети…",
      confirmTransaction: "Подтвердить транзакцию",
      confirmHint: "Намерение подписано. Осталось подтвердить транзакцию в кошельке.",
      intentExpired: "Подписанная котировка устарела. Подпиши новую, чтобы продолжить.",
      tradeChanged: "Параметры обмена изменились во время подписи. Проверь их и подпиши ещё раз.",
      approveOneTime: "Неограниченное разрешение {sym} для Permit2",
      approveHint: "Эта on-chain транзакция устанавливает максимальный allowance {sym} для Permit2; он действует, пока ты его не отзовёшь. На этом шаге обмен не отправляется.",
      allowanceChecking: "Проверяю разрешение токена…",
      allowanceRetry: "Не удалось проверить разрешение · Повторить",
      complianceChecking: "Проверяю доступность Arcus…",
      complianceRetry: "Повторить проверку доступности",
      cancelledFresh: "Отменено. Подпиши свежую котировку, чтобы попробовать снова.",
      approvalCancelled: "Разрешение отменено. Token approval не отправлен; нажми «Разрешить», когда будешь готов.",
      discardSignedQuote: "Отбросить подписанную котировку",
      signedQuoteDiscarded: "Подписанная котировка отброшена. Проверь тикет перед новой подписью.",
      approvalUnknown: "Статус разрешения неизвестен. Не отправляй его повторно, пока не проверишь активность кошелька.",
      submissionLocked: "Проверь активность кошелька перед повтором",
      submissionUnknown: "Статус транзакции неизвестен. Не повторяй это подписанное намерение; проверь активность кошелька.",
      expiresAt: "Действует до",
      done: "Обмен отправлен",
      recoveryWalletCheck: "Открой расширение кошелька и убедись, что нет pending-запроса или неожиданной транзакции, прежде чем разблокировать.",
      recoveryViewTransaction: "Посмотреть транзакцию в Blockscout",
      recoveryClear: "Wallet prompt закрыт; активность кошелька проверена — разблокировать",
      recoveryCleared: "Защитная блокировка снята. Перед продолжением запроси свежую котировку.",
      approvalRecovered: "Разрешение подтверждено on-chain. Обновляю allowance.",
      attemptReverted: "Сохранённая транзакция откатилась on-chain. Защитная блокировка снята.",
      recoveryStorageFailed: "Не удалось сохранить защитную блокировку кошелька. Wallet-запрос не отправлен; включи хранилище сайта и повтори.",
      viewOnArcus: "Управлять позицией на Arcus",
      enterAmount: "Введи сумму",
      insufficient: "Недостаточно баланса",
      minOrder: "Минимальный ордер",
      live: "вживую",
      trust: "Исполнение и подпись кошельком — через Arcus RFQ. Uniswap показан только для сравнения котировок. Ryntra никогда не касается твоих средств или ключей.",
      trustShort: "Подпись кошельком · Без хранения средств",
      wrappedNote: "wTokens — это способ доставки Arcus для long-tail филлов, когда native-токена нет в наличии. Они отслеживают акцию и автоматически сеттлятся в настоящий Stock Token по каденции мейкера (напр., каждые 24 ч); до этого их нельзя переводить.",
      routes: {
        title: "Котировки по маршрутам",
        choose: "Сравнение доступных котировок. Исполнение в Ryntra сейчас доступно только через Arcus.",
        executable: "Доступно к исполнению · wallet-signed",
        quoteOnly: "Только котировка · read-only — без исполнения в Ryntra",
        unsupported: "Только котировка · вне проверенного контура исполнения",
        noLiquidity: "Нет AMM-ликвидности (проверено вживую)",
        checking: "Проверяю…",
        unavailable: "Не удалось проверить",
        feeLabel: "fee",
        arcusFee: "Общая provider/platform fee берётся из текущей котировки Arcus. Подписанный router-компонент входит в эту сумму и показывается отдельно для проверки; не складывай их. Network gas — отдельно.",
        uniFee: "LP-комиссия Uniswap v3 показывается в котировке. Ryntra не добавляет комиссию на этом маршруте.",
        best: "лучшая котировка",
        stale: "устарело",
      },
      heat: {
        title: "Portfolio heat", // название фичи — технический токен, остаётся английским (конвенция)
        largest: "крупнейшая",
        equities: "акции",
        crypto: "крипто",
        partial: "частичные данные — часть значений не удалось прочитать",
        concentrated: "концентрация",
        correlated: "корреляция",
      },
    },
    connect: {
      eyebrow: "Настройка Arcus",
      title: "Подключение Arcus",
      sub: "Три шага для проверки ограниченного торгового ключа Arcus: кошелёк подписывает provider message, браузер генерирует ключ, а Arcus его активирует. Сам ключ не включает live SmartTrade или perps.",
      step1: "1 · Подключи кошелёк",
      step1Body: "Кошелёк лишь подписывает одно сообщение — без транзакции, без газа, без approvals.",
      step1Boundary: "Подключение здесь не привязывает этот кошелёк к аккаунту Ryntra. Это может сделать только отдельное SIWE-доказательство личности.",
      step1Cta: "Подключить кошелёк",
      step1NoWallet: "Расширение кошелька не найдено. Открой эту страницу в браузере с MetaMask (или другим injected-кошельком).",
      step1Connected: "Подключено",
      step2: "2 · Создай торговый ключ",
      step2Body: "Пара ключей Ed25519 генерируется в этом браузере. Приватный ключ хранится локально (IndexedDB) и никуда не отправляется. Arcus гарантирует: API-ключи не могут выводить средства.",
      step2Authority: "Этот credential может аутентифицировать поддержанные Arcus-запросы из этого браузера. Он не авторизует ордер; каждое точное действие всё равно требует отдельного review и wallet authorization.",
      step2Cta: "Создать торговый ключ",
      step2Signing: "Жду подпись кошелька…",
      step2Active: "Торговый ключ на этом устройстве",
      step2Expires: "действует до",
      step2Forget: "Отозвать и забыть ключ",
      step2Revoking: "Отзываю на Arcus — подпиши в кошельке…",
      step2Revoked: "Ключ отозван на Arcus и удалён с этого устройства.",
      step2ForgetLocal: "Удалить только с этого устройства (на Arcus действует до истечения срока)",
      step3: "3 · Проверь на Arcus",
      step3Cta: "Проверить статус ключа",
      step3Found: "Ключ активен на Arcus. Настройка проверена; live SmartTrade и perps остаются недоступными.",
      step3NotFound: "Ключ ещё не виден на Arcus — попробуй через несколько секунд.",
      nextNote: "Эта настройка trade-key не добавляет путь исполнения. Paper-трейдинг и read-only данные аккаунта доступны; отдельно поддерживаемый wallet-signed Arcus spot RFQ не меняется. Live SmartTrade и perps недоступны, пока отдельно не пройдены provider, legal, security, reliability, eligibility, release и явные human-authorization gates.",
      trust1: "Без депозитов в Ryntra — средства остаются на Arcus.",
      trust2: "Приватный ключ никогда не покидает этот браузер.",
      trust3: "Вывод средств требует подписи кошелька — это гарантирует сама биржа.",
    },
    dash: {
      eyebrow: "Trading workspace",
      title: "Обзор",
      sub: "Сначала дисциплина: план сделки, видимый риск, журнал — и только потом размер позиции.",
      kpiPaper: "Paper-баланс",
      kpiPaperHint: "от старта $10,000",
      kpiDiscipline: "Дисциплина",
      winRate: "win rate",
      adherence: "следование плану",
      avgR: "средний R",
      trades: "закрытых сделок",
      kpiStatus: "Beta Status",
      access: "доступ к бете",
      kpiLive: "Live-аккаунт",
      liveNoWallet: "wallet не подключён",
      livePositions: "открытых позиций",
      alertsOn: "алерты на филы включены",
      attnTitle: "Требует внимания",
      attnWallet: "Подключи wallet-адрес — разблокирует read-only live-режим, журнал реальных сделок и Telegram-алерты на филы.",
      open: "Открыть",
      cardPaper: "Paper-трейдинг",
      cardPaperCta: "Открыть терминал",
      cardLive: "Live-аккаунт",
      cardLiveBody: "Реальные позиции, PnL и филы по твоему публичному адресу. Read-only — никаких ключей.",
      cardLiveCta: "Открыть live-аккаунт",
      cardLiveSetCta: "Добавить адрес в Настройках",
      cardJournal: "Журнал и дисциплина",
      cardJournalBody: "Каждая закрытая сделка попадает сюда. Тегируй ошибки, сохраняй уроки, следи за планом.",
      cardJournalCta: "Открыть журнал",
    },
    home: {
      title: "Сегодня",
      sub: "Что требует внимания сейчас, что у вас есть и что делает рынок — ещё до выбора рабочего пространства.",
      attnTitle: "Требует внимания",
      attnUnavailable: "Это чтение внимания не завершилось, поэтому ничего не утверждается.",
      observedTitle: "Наблюдаемая стоимость",
      observedSub: "Стоимость позиций, которые Ryntra смогла оценить, вместе с покрытием, делающим её читаемой. Глубина — в Портфеле.",
      observedNone: "Для этого аккаунта пока не читается ни один источник, поэтому стоимость не указывается — и не выдумывается. Подключите источник, чтобы заполнить это.",
      openPortfolio: "Открыть Портфель",
      attnWallet: "Добавьте публичный адрес кошелька — это необязательно и включает read-only просмотр счёта, журнал реальных сделок и Telegram-уведомления об исполнении.",
      attnJournal: "Есть закрытые сделки без записи в журнале. Закрытая сделка без причины — результат, из которого нечему научиться.",
      attnVisitor: "Вы читаете Ryntra как посетитель. Всё здесь настоящее и доступно только для чтения; войдите, чтобы сохранять планы, журнал и уведомления — одно подтверждение в Telegram, без почты и пароля.",
      sourcesTitle: "Подключённые источники",
      sourcesSub: "Каждый источник показан отдельно. Симуляция и read-only; Ryntra ничего из этого не хранит.",
      sourcesNote:
        "Единого итога портфеля пока нет. У этих источников нет общей единицы, модели хранения и базы оценки, и их сумма была бы числом, которое нечем подтвердить. Один итог появится тогда, когда каждый источник можно будет оценить по доказательствам.",
      srcPaper: "Paper-счёт",
      srcPaperNote: "симуляция, старт $10 000",
      srcPaperNone: "paper-счёта ещё нет — войдите, чтобы создать",
      srcPaperUnread: "paper-счёт не удалось прочитать",
      srcLive: "Реальный счёт",
      srcLiveNote: "открытых позиций · read-only",
      srcLiveNone: "кошелёк не подключён",
      srcLiveUnread: "венью не удалось прочитать",
      paperOpen: "открытых",
      paperClosed: "закрытых",
      spacesTitle: "Рабочие пространства",
      spacesSub: "Home подводит итог. Работа идёт в том пространстве, которому она принадлежит.",
      open: "Открыть",
      spaceMarketsNote: "Бумажный терминал, Radar и зарегистрированные спот-маршруты с подписью кошелька.",
      pulseTitle: "Пульс рынка",
      pulseSub: "Состояние рынков по данным венью, не цены. Читается вживую из списка рынков Arcus.",
      pulseOnline: "рынков онлайн",
      pulseCrypto: "крипто · 24/7",
      pulseRwa: "акции, товары, индексы",
      pulseOffHours: "вне основной торговой сессии",
      pulseOffHoursNote:
        "Венью само сообщает часы торгов. Токенизированный рынок, который торгуется, когда его базовый актив закрыт, имеет другой режим риска — именно это показывает эта панель.",
      pulseUnread: "Венью сейчас не удалось прочитать. Это не ноль — это вопрос без ответа, и он показан именно так.",
      activityTitle: "Последняя активность",
      activitySub: "Ваши последние закрытые позиции. Полная история и план по каждой — в Журнале.",
      activityEmpty: "Пока ничего не закрыто. Активность появится здесь сразу после закрытия позиции.",
      loopTitle: "Цикл решения",
      loopSub: "Где на самом деле каждый этап. Состояния приходят из реестра возможностей, а не с этой страницы.",
      loopPlan: "План",
      loopReadiness: "Готовность",
      loopAuthorize: "Авторизация",
      loopExecute: "Исполнение",
      loopReceipt: "Квитанция",
      loopReview: "Разбор",
      recordsTitle: "Квитанции",
      recordsBody: "Home пока не ведёт реестр квитанций — append-only контракты подготовлены, но не выпущены.",
    },
    journal: { eyebrow: "Дисциплина", title: "Журнал", sub: "Paper и реальные сделки рядом — планы, ошибки и уроки.", kpiAdherence: "Следование плану", kpiWin: "Win rate", kpiAvgR: "Средний R", kpiClosed: "Закрытых сделок", kpiJournaled: "в журнале", kpiDisciplineHint: "Метрика — дисциплина, не прибыль" },
    settings: { eyebrow: "Аккаунт", title: "Настройки", sub: "Язык, wallet-адрес и внешний вид." },
    beta: {
      title: "Бета-доступ",
      hint: "Подтверждение в Telegram-боте — единственное, что открывает бету.",
      optionalTitle: "Опциональное остаётся опциональным",
    },
  },
};
