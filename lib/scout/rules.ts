/**
 * The Scout's bars, said once. Every number the Scout judges a new coin by, sizes a paper trade by or leaves a trade by
 * lives here, so the engine, the paper desk, the screen and the weekly review all read the same ones. Change a number
 * here, with its reason in the change — never a copy of it somewhere else.
 *
 * Each stage costs more than the one before it, so each cuts harder: the free screen reads only the numbers the market
 * list already carries; the chain reads cost reads of our gateway and of the chain's index; the thesis costs a model call.
 * The model never sizes a trade and never places one: sizing and every limit are code (`./risk.ts`).
 *
 * Client-safe: constants only.
 */

/** The free screen: numbers the market list states, no read of our own. A number nobody stated never passes its bar. */
export const SCOUT_SCREEN = Object.freeze({
  /** Minutes on the market, from the first pool: younger is a coin nobody has traded yet, older is not new. */
  minAgeMin: 10,
  maxAgeMin: 6 * 60,
  /** The pool a sale would go into, USD. */
  minLiquidityUsd: 8_000,
  /** Traded in the last hour, USD. */
  minVolumeH1Usd: 15_000,
  /** The market's capitalisation, USD. */
  minCapUsd: 25_000,
  maxCapUsd: 5_000_000,
  /** Buys and sells in the last hour together. */
  minTradesH1: 120,
  /** Sales at least this share of buys in the hour: a market nobody sells into may be one nobody can sell into. */
  minSellShare: 0.15,
  /** The market's organic score, 0–100 as the list states it: trading by real wallets rather than by bots. */
  minOrganicScore: 20,
  /** The creator's own share of the supply at most, per cent. */
  maxDevPct: 10,
  /** A creator who made this many coins … */
  serialLaunches: 5,
  /** … of which fewer than this share reached a DEX is a serial creator. */
  serialGraduatedShare: 0.1,
});

/** The chain: who really holds the coin, how it was born, what its creator did. */
export const SCOUT_CHAIN = Object.freeze({
  /** The largest real holder — a wallet, never the curve, a pool, a program or the burn address — at most, per cent. */
  maxTop1Pct: 5,
  /** The ten largest real holders together at most, per cent. */
  maxTop10Pct: 25,
  /** Wallets besides the creator that bought in the coin's first second at most: more were lined up before anyone could see it. */
  maxLaunchBuyers: 3,
  /** Wallets tied into same-second groups (one payer, one transaction) at most, across the coin's early trades. */
  maxBundledWallets: 6,
  /** The creator's own share of the supply at most, per cent, by the chain's read. */
  maxCreatorPct: 10,
  /** The creator sold and now holds less than this, per cent: the creator has left the coin. */
  creatorGonePct: 0.1,
});

/** The model: how many coins a pass may ask it about, and how long one answer may be. */
export const SCOUT_THESIS = Object.freeze({
  /** Coins a pass asks the model about at most — only those that passed the screen and the chain. */
  perPass: 4,
  /** The answer is a short object of codes. */
  maxOutputTokens: 300,
  /** One call's own time; past it the coin waits for the next pass. */
  timeoutMs: 12_000,
  /** The day's ceiling on what the model may cost, USD, unless the deployment sets it lower. */
  dayUsd: 1,
  /** The day's calls at most, whatever the price. */
  dayCalls: 600,
});

/**
 * The chain reads: how many coins a pass reads at most, and how many a day. Each read is one answer of our market-data
 * gateway and one read of the coin's events (at most three calls, behind that read's own switch and day ceiling, which
 * the coin's page shares) — so the Scout never takes more than a part of it.
 */
export const SCOUT_READS = Object.freeze({
  perPass: 6,
  perDay: 300,
  /**
   * How long the Scout waits for the gateway's facts of one coin, ms. The gateway reads the chain one call at a time, a
   * quarter of a second apart, about ten calls for a coin it has not seen — two to three seconds a coin, and a pass asks
   * for six together. The Review's budget (1.5 s, `lib/solana/risk-facts.ts`) is for a person waiting on a trade; a pass
   * is a cron nobody waits on, and with that budget no new coin's holders were ever read. Inside the cron's
   * minute with the thesis after it.
   */
  factsTimeoutMs: 25_000,
});

/** The risk engine: everything a trade's size and timing obey, inside the person's own budget. */
export const SCOUT_RISK = Object.freeze({
  /** A trade at most this share of the pool, basis points: what the market can take without moving far. */
  liquidityShareBps: 200,
  /** Positions open at once at most. */
  maxOpen: 3,
  /** After any position closes, no new one for this long. */
  pauseAfterCloseMs: 15 * 60_000,
  /** A coin closed is not taken again for this long. */
  reentryMs: 6 * 60 * 60_000,
  /** The day's loss reaching this share of the day's budget pauses the rest of the day, basis points. */
  dayLossBps: 3_000,
  /** A trade smaller than this is not worth its fees, lamports (0.001 SOL). */
  minTradeLamports: 1_000_000n,
});

/** How the Scout leaves a trade — the same numbers on paper and, later, with money. */
export const SCOUT_EXIT = Object.freeze({
  /** Sell everything this far under the entry, basis points. */
  stopBps: 3_500,
  /** Sell half once, when the price reaches this multiple of the entry. */
  halfAt: 2,
  /** Close when the last hour's volume falls under this share of the six hours' pace … */
  fadeShare: 0.2,
  /** … once the position is at least this old. */
  fadeAfterMs: 30 * 60_000,
  /** Close any position this old. */
  maxHoldMs: 24 * 60 * 60_000,
  /** Close at the last price read when the price has not been read for this long. */
  unreadMs: 30 * 60_000,
});

/** The paper desk: what a paper trade pays besides Ryntra's fee, basis points of each side. */
export const SCOUT_PAPER = Object.freeze({
  slippageBps: 200,
  /** The reference budget the shared paper desk is run on; each person's own numbers replay it (`./paper.ts`). */
  perDayLamports: 1_000_000_000n,
  perTradeLamports: 100_000_000n,
});

/** The journal: what one pass keeps, and how long. */
export const SCOUT_JOURNAL = Object.freeze({
  /** Entries in one hour's record at most; past it the hour keeps its counts, not each entry. */
  perHour: 400,
  /** Hours the journal keeps: a week, for the weekly review. */
  keepHours: 7 * 24,
  /** Closed paper positions the desk keeps. */
  closedKept: 200,
});
