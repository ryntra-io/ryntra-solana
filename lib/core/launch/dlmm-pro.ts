/**
 * A launch straight into a pool — Meteora DLMM Pro: the terms, the steps and the honest-launch check, as
 * plain numbers. No I/O, no clock of its own, no SDK: the server's half (`lib/launch-pool/engine.server.ts`) builds on
 * the venue, the city shows what this file says.
 *
 * **What it is.** The second format beside the live Launch on DBC. There is no curve and no migration: the coin is
 * minted — the same honest Token-2022 the live Launch mints — and the pair's pool is made at once, with the whole
 * supply in it as liquidity above the first price, locked for ever. Trading opens at a moment the creator names; until
 * then only the creator may put liquidity in, and nobody may trade.
 *
 * **The fee against snipers** falls with the market cap, not with time: half of a purchase at the first price, one
 * per cent once the price is four times it (or a day after the opening, whatever the price) — and it climbs back if
 * the price falls back. It is taken only in the pair's coin, SOL or USDC. The fee the schedule settles at is the
 * program's own number, read off the pool's build (`endFeeBps`), never the number asked for.
 *
 * **Who earns it.** The fees of the launch's locked liquidity go 40 % to the creator and 60 % to Ryntra: two locked positions of one shape whose liquidity is 40 : 60. The program divides the
 * fees by liquidity; no contract and no key of Ryntra's stands on a person's money. Before the opening only the
 * creator may open a position, so the creator opens both and hands Ryntra's over.
 *
 * **The creator's ladder** (the take-profit ladder, off unless the creator asks): a twentieth of the supply is
 * kept out of the locked liquidity and rests, before the first purchase, as the creator's sell order on fixed prices
 * from twice the first price to ten times it — more of it the farther. It is the creator's own coin, not locked: the
 * order is the creator's to collect, and once trading is open, to cancel. Before the opening nobody may take it out.
 *
 * **Steps.** A launch is three steps the creator's wallet signs one after another, each built from the chain as the
 * step before it left it: the coin, the pool, the supply (with the ladder, where there is one). A launch left
 * half-way is taken up from the step the chain shows, by its creator alone.
 */

/** Meteora's DLMM Pro program — the one address a launch's pool and positions are made by; the same on mainnet and devnet. */
export const DLMM_PRO_PROGRAM_ID = "dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n";

export const DLMM_PRO_LAUNCH_STAGES = ["COIN", "POOL", "SUPPLY"] as const;
export type DlmmProLaunchStage = (typeof DLMM_PRO_LAUNCH_STAGES)[number];

export const DLMM_PRO_LAUNCH_PAIRS = ["SOL", "USDC"] as const;
export type DlmmProLaunchPair = (typeof DLMM_PRO_LAUNCH_PAIRS)[number];

/** The pair coins' mints: wrapped SOL, the same on every cluster; USDC is the network's own (`LaunchNetwork.pairs`). */
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export type DlmmProFeeTerms = Readonly<{ kind: "marketCap"; curve: "exponential"; startBps: number; endBps: number; periods: number; priceMultiple: number; expiresAfter: number }>;

export const DLMM_PRO_LAUNCH_TERMS = Object.freeze({
  /** As the live Launch mints: Token-2022, six decimals, a billion, no authority left. */
  coin: Object.freeze({ decimals: 6, supply: 1_000_000_000 }),
  /**
   * The market cap a launch starts at, in the pair's own coin — so no price feed stands between a person and a
   * launch: thirty SOL, or five thousand dollars.
   */
  startCap: Object.freeze({ SOL: 30, USDC: 5_000 } satisfies Record<DlmmProLaunchPair, number>),
  pairDecimals: Object.freeze({ SOL: 9, USDC: 6 } satisfies Record<DlmmProLaunchPair, number>),
  tickSpacing: 100,
  /** 50 % at the first price, 1 % at four times it or a day after the opening; sixty steps — the schedule the rehearsal of 14.11 passed on the program. */
  fee: Object.freeze({ kind: "marketCap", curve: "exponential", startBps: 5_000, endBps: 100, periods: 60, priceMultiple: 4, expiresAfter: 86_400 } satisfies DlmmProFeeTerms),
  /** The supply's shape: 461 ticks of the spacing above the first price — about a hundred times it — thinning away from it. */
  shape: Object.freeze({ strategy: "curve", columns: 461 } as const),
  /**
   * The ranges of each locked position. Every range is rent that never comes back — a position locked for ever is
   * never closed — and fourteen open, fill and lock in one transaction with room to spare: a position is on chain
   * whole or not at all. Fifteen fit a pool against SOL with three bytes left of a message's 1 232 (rehearsal of
   * 15.11.2026); one range fewer keeps the step clear of that edge.
   */
  maxRanges: 14,
  /** D-M2: the creator's part of the locked liquidity, and Ryntra's. */
  split: Object.freeze({ creatorBps: 4_000, ryntraBps: 6_000 }),
  /**
   * The creator's take-profit ladder: its share of the supply, and the order it rests as — five prices
   * from twice the first price (`nearBps` above it) to ten times it (`farBps`), more the farther, on fixed ticks: before
   * the opening the price stands still. `lowestMultiple` — the least a price of the ladder may be of the first price
   * for the launch to be the one shown: twice it, less the spacing a tick is aligned to.
   */
  ladder: Object.freeze({ shareBps: 500, nearBps: 10_000, farBps: 90_000, rungs: 5, spread: "further", lowestMultiple: 1.95 } as const),
  opening: Object.freeze({
    /** Seconds from the build to the opening when the creator names no time. */
    defaultAfter: 900,
    /** The least a launch's opening lies ahead when its coin is built: room for the three steps, and the program's own two minutes before the pool. */
    minAfter: 300,
    /** The program lets an opening lie thirty days ahead; a day is kept off it for the steps. */
    maxAfter: 29 * 86_400,
  }),
});

/** The first price of a launch: the pair's coin per one coin, whole tokens, as a decimal string a tick is read from. */
export function dlmmProStartPrice(pair: DlmmProLaunchPair): string {
  const cap = DLMM_PRO_LAUNCH_TERMS.startCap[pair];
  /* Twelve decimals hold 30 / 10^9 exactly; the tick the price lands on is the program's own rounding. */
  return (cap / DLMM_PRO_LAUNCH_TERMS.coin.supply).toFixed(12);
}

/** The whole supply in base units. */
export const DLMM_PRO_SUPPLY_RAW = BigInt(DLMM_PRO_LAUNCH_TERMS.coin.supply) * 10n ** BigInt(DLMM_PRO_LAUNCH_TERMS.coin.decimals);

/** The creator's ladder's part of the supply, base units; zero — a launch without one. */
export function dlmmProLadderRaw(ladder: boolean): bigint {
  return ladder ? (DLMM_PRO_SUPPLY_RAW * BigInt(DLMM_PRO_LAUNCH_TERMS.ladder.shareBps)) / 10_000n : 0n;
}

/**
 * The parts of the supply: the creator's ladder (none unless asked), the creator's position, and Ryntra's — which is
 * the rest, so nothing of the supply is left out by rounding.
 */
export function dlmmProSupplyParts(split: boolean, ladder = false): Readonly<{ creatorRaw: bigint; ryntraRaw: bigint; ladderRaw: bigint }> {
  const ladderRaw = dlmmProLadderRaw(ladder);
  const locked = DLMM_PRO_SUPPLY_RAW - ladderRaw;
  if (!split) return { creatorRaw: locked, ryntraRaw: 0n, ladderRaw };
  const creatorRaw = (locked * BigInt(DLMM_PRO_LAUNCH_TERMS.split.creatorBps)) / 10_000n;
  return { creatorRaw, ryntraRaw: locked - creatorRaw, ladderRaw };
}

/**
 * When a launch opens, unix seconds: the creator's own moment, or a quarter of an hour from `now`. Null — the moment
 * named is too close for the three steps or further than the program lets a pool wait.
 */
export function dlmmProOpensAt(now: number, asked: number | null | undefined): number | null {
  const terms = DLMM_PRO_LAUNCH_TERMS.opening;
  if (asked === null || asked === undefined) return now + terms.defaultAfter;
  if (!Number.isSafeInteger(asked)) return null;
  if (asked < now + terms.minAfter || asked > now + terms.maxAfter) return null;
  return asked;
}

/* ------------------------------------------------------------------ the steps */

/** What the chain shows of a launch: the coin, the pool, and each locked position — whole on chain, and where its NFT is. */
export type DlmmProLaunchChain = Readonly<{
  coin: boolean;
  pool: boolean;
  /** The creator's position: on chain, whole — funded and locked. */
  creatorPosition: boolean;
  /** Ryntra's: null — the launch has no split; `made` — on chain whole; `handed` — its NFT is Ryntra's. */
  ryntraPosition: Readonly<{ made: boolean; handed: boolean }> | null;
  /**
   * The creator's ladder: null — the launch has none; true — it rested (its order is on chain, or the pool is open
   * and the step that placed it landed: an open order is its owner's to close).
   */
  ladder: boolean | null;
}>;

/** The step a launch waits for; null — every step is on chain. A step is never offered before the one it stands on. */
export function dlmmProNextStage(chain: DlmmProLaunchChain): DlmmProLaunchStage | null {
  if (!chain.coin) return "COIN";
  if (!chain.pool) return "POOL";
  if (!chain.creatorPosition) return "SUPPLY";
  if (chain.ryntraPosition && (!chain.ryntraPosition.made || !chain.ryntraPosition.handed)) return "SUPPLY";
  if (chain.ladder === false) return "SUPPLY";
  return null;
}

/* ------------------------------------------------------------------ the honest-launch check */

/**
 * What the chain holds of a launch, as the check reads it. Every field is the chain's own: the mint as the token
 * program keeps it, the pool as the venue models it, each position as it reads.
 */
export type DlmmProLaunchFacts = Readonly<{
  creator: string;
  /** What the launch was built with (its record). */
  /**
   * What the launch was built with (its record). `endFeeBps` and `settlesAtPriceMultiple` are what its own pool step
   * said the schedule settles at; null — the launch's own step never built a pool, and whatever pool stands there is
   * not the one its creator was shown.
   */
  terms: Readonly<{ pair: DlmmProLaunchPair; quoteMint: string; opensAt: number; initialTickId: number; endFeeBps: number | null; settlesAtPriceMultiple: number | null; dynamicCeilingBps: number | null; ryntra: string | null; poolSource: "launch" | "config"; config: string | null; /** Whether the launch was built with the creator's ladder; absent — it was not. */ ladder?: boolean }>;
  mint: Readonly<{ token2022: boolean; mintAuthority: string | null; freezeAuthority: string | null; supplyRaw: string; decimals: number; extensions: readonly string[]; metadataAuthority: string | null }>;
  pool: Readonly<{
    kind: "static" | "dynamic" | "launch";
    creator: string;
    tokenX: string;
    tokenY: string;
    tickSpacing: number;
    initialTickId: number;
    feeMode: string;
    /** The schedule's steps, and when it settles: seconds after the opening whatever the price, and the multiple of the first price. */
    periods: number;
    settlesAfter: number | null;
    settlesAtPriceMultiple: number | null;
    /** Liquidity mining on the pool: a launch's pool is made without it. */
    liquidityMining: boolean;
    /** The most the volatility fee adds on top, basis points. */
    dynamicCeilingBps: number;
    startBps: number;
    endBps: number;
    collectedIn: "output" | "tokenY";
    partner: string | null;
    /** The pool's opening rules; null — it was made open from its first block. */
    /** `withdrawAt` — when liquidity may first be taken out by anyone: an order rests whole until then. */
    rules: Readonly<{ swapAt: number; withdrawAt: number; depositor: string | null; swapper: string | null; withdrawer: string | null }> | null;
    /**
     * The coin the launch's own locked positions were given, base units: what their liquidity is worth at the pool's
     * first price. A position's liquidity does not change when the pool trades, so this is the supply that went in —
     * before the opening and after it alike. The pool's vault says nothing of it once anybody has bought.
     */
    suppliedRaw: string;
  }>;
  positions: readonly Readonly<{ role: "creator" | "ryntra"; holder: string | null; lockedBps: number; liquidity: string }>[];
  /**
   * The creator's ladder as the chain holds it: what rests in its order (collected prices count nothing), the tick of
   * its nearest price, and whether every price still rests unfilled; null — no order lives at its NFT. Absent — the
   * launch has none.
   */
  ladder?: Readonly<{ amountRaw: string; nearestTickId: number | null; resting: boolean; /** Who holds the order's NFT of the creator's wallet; null — not the creator. */ holder: string | null }> | null;
  /** Whether trading is open now, by the pool's own clock; absent — it is not. */
  open?: boolean;
}>;

/** The Token-2022 extensions an honest coin carries: its metadata, in the mint itself. */
const HONEST_EXTENSIONS: ReadonlySet<string> = new Set(["MetadataPointer", "TokenMetadata"]);
/** Atoms of the supply a deposit's rounding may leave with the creator: a hundredth of a basis point. */
export const DLMM_PRO_SUPPLY_DUST_RAW = DLMM_PRO_SUPPLY_RAW / 1_000_000n;

/**
 * Why a launch is not the honest one its creator was shown — every reason, in plain words; empty — it is. The check
 * is the chain's word against the terms: nothing here trusts a record of Ryntra's for what the chain can say.
 */
/** The facts of a launch's pool alone — its coin, its terms and the pool as the chain holds it. */
export type DlmmProPoolFacts = Pick<DlmmProLaunchFacts, "creator" | "terms"> & Readonly<{ pool: Omit<DlmmProLaunchFacts["pool"], "suppliedRaw"> }>;

/**
 * Why a launch's pool is not the one its creator was shown — the pool's half of the honest check, asked again before
 * the supply goes in: the supply goes only into the pool the launch's own step made, on the launch's own terms.
 */
export function dlmmProPoolProblems(facts: DlmmProPoolFacts): string[] {
  const problems: string[] = [];
  const terms = DLMM_PRO_LAUNCH_TERMS;
  const { pool } = facts;
  const fromConfig = facts.terms.poolSource === "config";
  if (pool.kind !== (fromConfig ? "dynamic" : "launch")) problems.push("the pool is not the kind the launch was built as");
  if (pool.creator !== facts.creator) problems.push("the pool was made by another wallet");
  if (pool.tokenY !== facts.terms.quoteMint) problems.push("the pool pairs with another coin");
  if (pool.tickSpacing !== terms.tickSpacing || pool.initialTickId !== facts.terms.initialTickId) problems.push("the pool starts at another price");
  /* Every number of the schedule, against the terms and what the launch's own pool step said — a comparison that cannot be read is a difference, never a pass. */
  const near = (a: number | null, b: number | null, room: number) => a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= room;
  if (facts.terms.endFeeBps === null) problems.push("the pool was not made by this launch's own step");
  if (
    pool.feeMode !== "marketCapExponential" ||
    pool.startBps !== terms.fee.startBps ||
    pool.periods !== terms.fee.periods ||
    !near(pool.endBps, facts.terms.endFeeBps, 0.005) ||
    !near(pool.settlesAfter, terms.fee.expiresAfter + 1, 0) ||
    !near(pool.settlesAtPriceMultiple, facts.terms.settlesAtPriceMultiple, 0.01)
  ) {
    problems.push("the pool's fee is not the launch's schedule");
  }
  if (pool.liquidityMining) problems.push("the pool pays rewards the launch was not built with");
  if (!near(pool.dynamicCeilingBps, facts.terms.dynamicCeilingBps, 0.005)) problems.push("the pool's volatility fee is not the launch's");
  if (pool.collectedIn !== "tokenY") problems.push("the pool takes its fee in the coin itself");
  if (!fromConfig && pool.partner !== null) problems.push("the pool names a partner");
  if (!pool.rules) problems.push("the pool has no opening time");
  else {
    if (pool.rules.swapAt !== facts.terms.opensAt) problems.push("the pool opens at another time");
    if (pool.rules.depositor !== facts.creator) problems.push("another wallet may put liquidity in before the opening");
    if (pool.rules.swapper !== null) problems.push("a wallet may trade before the opening");
    if (pool.rules.withdrawer !== null) problems.push("a wallet may take liquidity out before the opening");
    if (!(pool.rules.withdrawAt >= facts.terms.opensAt)) problems.push("liquidity may be taken out before the opening");
  }
  return problems;
}

export function dlmmProHonestProblems(facts: DlmmProLaunchFacts): string[] {
  const problems: string[] = [];
  const terms = DLMM_PRO_LAUNCH_TERMS;
  const { mint, pool } = facts;

  if (!mint.token2022) problems.push("the coin is not a Token-2022 coin");
  if (mint.mintAuthority !== null) problems.push("the coin can still be minted");
  if (mint.freezeAuthority !== null) problems.push("the coin's accounts can be frozen");
  if (mint.metadataAuthority !== null) problems.push("the coin's name can still be changed");
  if (mint.decimals !== terms.coin.decimals || mint.supplyRaw !== DLMM_PRO_SUPPLY_RAW.toString()) problems.push("the supply is not a billion coins");
  const strange = mint.extensions.filter((name) => !HONEST_EXTENSIONS.has(name));
  if (strange.length) problems.push(`the coin carries ${strange.join(", ")}`);

  problems.push(...dlmmProPoolProblems(facts));
  let supplied = 0n;
  try {
    supplied = BigInt(pool.suppliedRaw);
  } catch {
    problems.push("what went into the pool could not be read");
  }
  /* What the locked positions hold is the supply less the creator's ladder; the ladder is checked on its own below. */
  const ladderRaw = dlmmProLadderRaw(facts.terms.ladder === true);
  if (supplied < DLMM_PRO_SUPPLY_RAW - ladderRaw - DLMM_PRO_SUPPLY_DUST_RAW) problems.push("the supply did not all go into the pool");
  if (facts.terms.ladder === true) problems.push(...dlmmProLadderProblems(facts, ladderRaw));

  const creator = facts.positions.find((position) => position.role === "creator");
  const ryntra = facts.positions.find((position) => position.role === "ryntra");
  if (!creator) problems.push("the creator's position is not on chain");
  else {
    if (creator.lockedBps !== 10_000) problems.push("the creator's liquidity is not locked for ever");
    if (creator.holder !== facts.creator) problems.push("the creator's position is held by another wallet");
  }
  if (facts.terms.ryntra === null) {
    if (ryntra) problems.push("the launch has a second position it was not built with");
  } else if (!ryntra) problems.push("Ryntra's position is not on chain");
  else {
    if (ryntra.lockedBps !== 10_000) problems.push("Ryntra's liquidity is not locked for ever");
    if (ryntra.holder !== facts.terms.ryntra) problems.push("Ryntra's position was not handed over");
    if (creator) {
      const mine = BigInt(creator.liquidity);
      const theirs = BigInt(ryntra.liquidity);
      const whole = mine + theirs;
      /* A hundredth of a per cent of room for the rounding of two deposits. */
      const share = whole === 0n ? 0 : Number((theirs * 1_000_000n) / whole) / 100;
      if (Math.abs(share - terms.split.ryntraBps) > 1) problems.push("the fees are not divided 40 : 60");
    }
  }
  return problems;
}

/**
 * Why a launch's ladder is not the one its creator was shown. Before the opening it must rest whole — its share of the
 * supply, every price unfilled — so the coins out of the locked liquidity are on sale and nowhere else; once trading is
 * open the order is its owner's, and only where it sells is held: never below twice the first price.
 */
function dlmmProLadderProblems(facts: DlmmProLaunchFacts, ladderRaw: bigint): string[] {
  const problems: string[] = [];
  const terms = DLMM_PRO_LAUNCH_TERMS;
  const ladder = facts.ladder ?? null;
  if (ladder === null) {
    if (facts.open !== true) problems.push("the creator's ladder is not resting");
    return problems;
  }
  let rests = 0n;
  try {
    rests = BigInt(ladder.amountRaw);
  } catch {
    problems.push("what rests in the creator's ladder could not be read");
  }
  if (rests > ladderRaw) problems.push("the creator's ladder holds more than its share of the supply");
  if (facts.open !== true && (!ladder.resting || rests < ladderRaw - DLMM_PRO_SUPPLY_DUST_RAW)) problems.push("the creator's ladder is not resting");
  /* Until the opening the order is the creator's own: its NFT anywhere else is a ladder somebody else may take down. */
  if (facts.open !== true && ladder.holder !== facts.creator) problems.push("the creator's ladder is held by another wallet");
  /* A tick is a basis point of price: the ladder's nearest price over the first one. */
  const nearest = ladder.nearestTickId === null ? null : Math.pow(1.0001, ladder.nearestTickId - facts.terms.initialTickId);
  if (nearest !== null && !(nearest >= terms.ladder.lowestMultiple)) problems.push("the creator's ladder sells below twice the first price");
  return problems;
}

/* ------------------------------------------------------------------ what a person is told */

/** The phase of a launch for whoever looks at its tower. */
export type DlmmProLaunchPhase = "BUILDING" | "COUNTDOWN" | "OPEN";

export function dlmmProPhase(args: Readonly<{ next: DlmmProLaunchStage | null; opensAt: number; now: number }>): DlmmProLaunchPhase {
  if (args.next !== null) return "BUILDING";
  return args.now >= args.opensAt ? "OPEN" : "COUNTDOWN";
}

/** A fee in basis points as a person reads it: «50 %», «1 %», «1.06 %» — never more digits than it has. */
export function feePercent(bps: number): string {
  const percent = Math.round(bps) / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2).replace(/0$/, "")} %`;
}
