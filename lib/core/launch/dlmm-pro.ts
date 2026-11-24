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
 * **The reward for the pool's liquidity** (off unless the creator asks): a part of the supply — a tenth at
 * most — is kept out of the locked liquidity and paid, as the pool's liquidity-mining reward, to the liquidity at the
 * price, second by second, from the opening for the days the creator picks. The program pays it to every position whose
 * range holds the price, in proportion to its liquidity — the launch's own locked positions among them: until somebody
 * else puts liquidity at the price, the creator's and Ryntra's locked positions earn it 40 : 60. A pool's creator has
 * one reward slot of the program's two (the other is Meteora's operator's), so a launch pays one coin: its own. The
 * whole reward is paid into the pool's vault at the supply's step and cannot be taken back; only what the program
 * emitted while no liquidity stood at the price returns to the creator, once the days are over — and the launch's own
 * locked liquidity stands at every price from the first one to about a hundred times it.
 *
 * **Steps.** A launch is three steps the creator's wallet signs one after another, each built from the chain as the
 * step before it left it: the coin, the pool, the supply (with the ladder and the reward, where there are). A launch
 * left half-way is taken up from the step the chain shows, by its creator alone.
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
  /**
   * The reward for the pool's liquidity: the program's reward slot a pool's creator sets up — its only one
   * (SDK 0.1.3 `CREATOR_REWARD_INDEX`; slot 1 is set up by Meteora's operator alone, `MissingOperatorAccount`) —, the
   * least and the most of the supply it may be, basis points, and its days: the program's one day to one year
   * (`MIN_REWARD_DURATION`, `MAX_REWARD_DURATION`). `shares` and `days` are the choices the form offers; a sentence
   * may name any share and any whole number of days inside the bounds.
   */
  reward: Object.freeze({
    slot: 0,
    minShareBps: 10,
    maxShareBps: 1_000,
    minDays: 1,
    maxDays: 365,
    shares: Object.freeze([100, 200, 500, 1_000] as const),
    days: Object.freeze([7, 30, 90] as const),
    /** The default the form starts at when the creator switches it on. */
    defaultShareBps: 200,
    defaultDays: 30,
  }),
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

/** What the creator asks the reward for the pool's liquidity to be: a share of the supply, basis points, over whole days. */
export type DlmmProRewardAsk = Readonly<{ shareBps: number; days: number }>;

/** Why a reward cannot be the one asked for, in plain words; null — it can. */
export function dlmmProRewardProblem(ask: DlmmProRewardAsk): string | null {
  const terms = DLMM_PRO_LAUNCH_TERMS.reward;
  if (!Number.isSafeInteger(ask.shareBps) || ask.shareBps < terms.minShareBps || ask.shareBps > terms.maxShareBps) return `A reward is ${terms.minShareBps / 100} % to ${terms.maxShareBps / 100} % of the supply.`;
  if (!Number.isSafeInteger(ask.days) || ask.days < terms.minDays || ask.days > terms.maxDays) return `A reward runs ${terms.minDays} to ${terms.maxDays} days.`;
  return null;
}

/** The reward's part of the supply, base units; zero — a launch without one. */
export function dlmmProRewardRaw(shareBps: number | null | undefined): bigint {
  return shareBps ? (DLMM_PRO_SUPPLY_RAW * BigInt(shareBps)) / 10_000n : 0n;
}

/** The seconds of a reward's days. */
export const dlmmProRewardSeconds = (days: number): number => days * 86_400;

/**
 * The program's emission of an amount over a window: atoms a second, Q64.64, rounded down — and what the vault is
 * funded with for it, rounded up as the program rounds: never more than the amount, short of it by under an atom a
 * second. The same arithmetic as the venue's own `emissionOf` (`lib/core/venues/meteora-dlmm-pro/rewards.server.ts`).
 */
export function dlmmProEmission(amountRaw: bigint, seconds: number): Readonly<{ perSecondX64: bigint; fundedRaw: bigint }> {
  const window = BigInt(seconds);
  if (window <= 0n) return { perSecondX64: 0n, fundedRaw: 0n };
  const perSecondX64 = (amountRaw << 64n) / window;
  const q64 = 1n << 64n;
  return { perSecondX64, fundedRaw: (perSecondX64 * window + q64 - 1n) / q64 };
}

/**
 * Who earns the reward while the launch's own locked liquidity is the only liquidity at the price: the
 * creator's position and Ryntra's, by their liquidity — 40 : 60 with the split of D-M2, the whole to the creator's one
 * position without it. The program pays every position that holds the price by its liquidity and has no way to leave
 * one out: no flag on a position, no second reward slot for the creator (slot 1 is Meteora's operator's), no delegate
 * that could send a position's reward to anyone but its owner. So nothing keeps Ryntra's locked position from earning
 * it; the creator is told how much before the signature instead.
 */
export function dlmmProRewardLockedShare(split: boolean): Readonly<{ creatorBps: number; ryntraBps: number }> {
  return split ? { creatorBps: DLMM_PRO_LAUNCH_TERMS.split.creatorBps, ryntraBps: DLMM_PRO_LAUNCH_TERMS.split.ryntraBps } : { creatorBps: 10_000, ryntraBps: 0 };
}

/** A day of the reward, base units: the whole over its days, rounded down. */
export function dlmmProRewardPerDayRaw(amountRaw: bigint, days: number): bigint {
  return Number.isSafeInteger(days) && days > 0 ? amountRaw / BigInt(days) : 0n;
}

/**
 * A day of the reward, divided as the program divides it, when others hold `othersBps` of the liquidity at the price:
 * theirs, and the rest by the launch's locked positions' liquidity. With nobody else there (`othersBps` 0) Ryntra's
 * locked position earns 60 % of each day; with others holding 62.4 % (the rehearsal of 20.11), 22.6 %.
 */
export function dlmmProRewardDay(perDayRaw: bigint, split: boolean, othersBps = 0): Readonly<{ othersRaw: bigint; creatorRaw: bigint; ryntraRaw: bigint }> {
  const others = BigInt(Math.max(0, Math.min(10_000, Math.round(othersBps))));
  const othersRaw = (perDayRaw * others) / 10_000n;
  const locked = perDayRaw - othersRaw;
  const ryntraRaw = (locked * BigInt(dlmmProRewardLockedShare(split).ryntraBps)) / 10_000n;
  return { othersRaw, creatorRaw: locked - ryntraRaw, ryntraRaw };
}

/**
 * What the creator has spent of the reward so far, from the pool's own slot: `flowedRaw` — what flowed to
 * the liquidity at the price; `idleRaw` — what found no liquidity there, the creator's to take back once the days are
 * over; `leftRaw` — what is still to flow. `idleSeconds` are the program's own count, as of `updatedAt`; seconds since
 * then count as idle only while nothing stands at the price (`liquidityNow` false).
 */
export function dlmmProRewardSpent(args: Readonly<{ perSecondX64: bigint; fundedRaw: bigint; opensAt: number; endsAt: number; idleSeconds: number; updatedAt: number; liquidityNow: boolean; now: number }>): Readonly<{ flowedRaw: bigint; idleRaw: bigint; leftRaw: bigint }> {
  const until = Math.min(args.now, args.endsAt);
  const elapsed = Math.max(0, until - args.opensAt);
  const lateIdle = args.liquidityNow ? 0 : Math.max(0, until - Math.max(args.updatedAt, args.opensAt));
  const idleSeconds = Math.min(elapsed, Math.max(0, args.idleSeconds) + lateIdle);
  const of = (seconds: number) => (args.perSecondX64 * BigInt(seconds)) >> 64n;
  const emitted = elapsed >= args.endsAt - args.opensAt ? args.fundedRaw : of(elapsed) < args.fundedRaw ? of(elapsed) : args.fundedRaw;
  const idleRaw = of(idleSeconds) < emitted ? of(idleSeconds) : emitted;
  return { flowedRaw: emitted - idleRaw, idleRaw, leftRaw: args.fundedRaw - emitted };
}

/**
 * The parts of the supply: the creator's ladder (none unless asked), the reward for the pool's liquidity (none unless
 * asked), the creator's position, and Ryntra's — which is the rest, so nothing of the supply is left out by rounding.
 */
export function dlmmProSupplyParts(split: boolean, ladder = false, rewardRaw = 0n): Readonly<{ creatorRaw: bigint; ryntraRaw: bigint; ladderRaw: bigint; rewardRaw: bigint }> {
  const ladderRaw = dlmmProLadderRaw(ladder);
  const locked = DLMM_PRO_SUPPLY_RAW - ladderRaw - rewardRaw;
  if (!split) return { creatorRaw: locked, ryntraRaw: 0n, ladderRaw, rewardRaw };
  const creatorRaw = (locked * BigInt(DLMM_PRO_LAUNCH_TERMS.split.creatorBps)) / 10_000n;
  return { creatorRaw, ryntraRaw: locked - creatorRaw, ladderRaw, rewardRaw };
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
  /**
   * The reward for the pool's liquidity: null or absent — the launch has none; true — the pool's creator slot pays the
   * launch's coin and its emission is funded.
   */
  reward?: boolean | null;
}>;

/** The step a launch waits for; null — every step is on chain. A step is never offered before the one it stands on. */
export function dlmmProNextStage(chain: DlmmProLaunchChain): DlmmProLaunchStage | null {
  if (!chain.coin) return "COIN";
  if (!chain.pool) return "POOL";
  if (!chain.creatorPosition) return "SUPPLY";
  if (chain.ryntraPosition && (!chain.ryntraPosition.made || !chain.ryntraPosition.handed)) return "SUPPLY";
  if (chain.ladder === false) return "SUPPLY";
  if (chain.reward === false) return "SUPPLY";
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
  terms: Readonly<{ pair: DlmmProLaunchPair; quoteMint: string; opensAt: number; initialTickId: number; endFeeBps: number | null; settlesAtPriceMultiple: number | null; dynamicCeilingBps: number | null; ryntra: string | null; poolSource: "launch" | "config"; config: string | null; /** Whether the launch was built with the creator's ladder; absent — it was not. */ ladder?: boolean; /** The reward for the pool's liquidity it was built with — its coins and its seconds; null or absent — none. */ reward?: Readonly<{ amountRaw: string; seconds: number }> | null }>;
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
  /**
   * The pool's creator reward slot as the chain holds it: its coin, its authority and its emission; null — the slot was
   * never set up. Absent — the launch has no reward.
   */
  reward?: Readonly<{ mint: string; authority: string; emissionPerSecondX64: string; opensAt: number; endsAt: number }> | null;
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
  const rewarded = Boolean(facts.terms.reward);
  if (pool.liquidityMining && !rewarded) problems.push("the pool pays rewards the launch was not built with");
  if (!pool.liquidityMining && rewarded) problems.push("the pool cannot pay the launch's reward");
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
  /* What the locked positions hold is the supply less the creator's ladder and the reward; each is checked on its own below. */
  const ladderRaw = dlmmProLadderRaw(facts.terms.ladder === true);
  let rewardRaw = 0n;
  try {
    rewardRaw = facts.terms.reward ? BigInt(facts.terms.reward.amountRaw) : 0n;
  } catch {
    problems.push("the launch's reward could not be read");
  }
  if (supplied < DLMM_PRO_SUPPLY_RAW - ladderRaw - rewardRaw - DLMM_PRO_SUPPLY_DUST_RAW) problems.push("the supply did not all go into the pool");
  if (facts.terms.ladder === true) problems.push(...dlmmProLadderProblems(facts, ladderRaw));
  if (facts.terms.reward) problems.push(...dlmmProRewardProblems(facts, rewardRaw, facts.terms.reward.seconds));

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

/**
 * Why a launch's reward is not the one its creator was shown: the pool's creator slot pays the launch's own coin, its
 * authority is the creator, and its emission is the reward's coins over its days — starting no sooner than the
 * opening. A start later than the opening (the supply's step signed late) pays the same coins over the same days.
 */
function dlmmProRewardProblems(facts: DlmmProLaunchFacts, rewardRaw: bigint, seconds: number): string[] {
  const reward = facts.reward ?? null;
  if (reward === null) return ["the launch's reward is not set up"];
  const problems: string[] = [];
  if (reward.mint !== facts.pool.tokenX) problems.push("the reward pays another coin");
  if (reward.authority !== facts.creator) problems.push("the reward is in another wallet's hands");
  if (!(reward.opensAt >= facts.terms.opensAt) || reward.endsAt - reward.opensAt !== seconds) problems.push("the reward runs for another time");
  const told = dlmmProEmission(rewardRaw, seconds).perSecondX64;
  if (told === 0n || reward.emissionPerSecondX64 !== told.toString()) problems.push("the reward pays another amount");
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
