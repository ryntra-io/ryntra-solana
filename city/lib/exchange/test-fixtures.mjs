// Test helpers for the Exchange: Phoenix's markets, accounts and margin views shaped as the engine's routes answer
// them (`lib/phoenix/market-data.ts`, `collateral-model.ts`), Reviews and relays of the order and collateral routes, an
// engine that answers from a script, and a clock the tests move.

export const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
export const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const SIG = "4hXbMVF2Kz9nqPYmEWZg2cRrTn8L1vU5sQ7xDdA3jJbCkN6tHfW9yGmPeR2oZaLs8iUq1BcVvXxY4wT7nM5pDkE";

/** A Phoenix market as `/api/solana/futures/markets` answers it. SOL: a tick is $0.01, a lot 0.001 SOL. */
export function market(changes = {}) {
  return {
    symbol: "SOL",
    status: "active",
    state: "trading",
    group: "crypto",
    name: "Solana",
    aliases: ["solana"],
    fundingIntervalSeconds: 3600,
    nextFundingAt: null,
    calendar: false,
    session: null,
    maxLeverage: 20,
    leverageTiers: [{ maxLeverage: 20, maxSizeUnits: 1000 }],
    maintenanceRatio: 0.5,
    openInterestUnits: null,
    isolatedOnly: false,
    tickSize: 10,
    baseLotsDecimals: 3,
    takerRate: 0.00035,
    makerRate: 0.00005,
    markPrice: 150,
    oraclePrice: 149.9,
    prevDayMarkPrice: 146.34,
    dayVolumeUsd: 48_200_000,
    ...changes,
  };
}

export const SOL = market();
/** BTC: a tick is $1, a lot 0.0001 BTC. */
export const BTC = market({ symbol: "BTC", name: "Bitcoin", aliases: ["bitcoin"], tickSize: 100, baseLotsDecimals: 4, markPrice: 67_000, oraclePrice: 66_990, prevDayMarkPrice: 68_000, maxLeverage: 25, dayVolumeUsd: 91_000_000 });
/** PUMP: decimals below zero — a lot is a hundred coins. */
export const PUMP = market({ symbol: "PUMP", name: "Pump", aliases: [], tickSize: 2, baseLotsDecimals: -2, markPrice: 0.0042, oraclePrice: 0.0042, prevDayMarkPrice: 0.004, maxLeverage: 5, dayVolumeUsd: 2_100_000 });
/** A market Phoenix lists but does not take orders on. */
export const GOLD = market({ symbol: "GOLD", name: "Gold", aliases: [], status: "gated", state: "underlyingClosed", calendar: true, session: "closed", isolatedOnly: true, markPrice: 2400, prevDayMarkPrice: 2391, maxLeverage: 10, dayVolumeUsd: 300_000 });

export const MARKETS = { markets: [SOL, BTC, PUMP, GOLD], observedAt: 1_700_000_000_000 };

/** Phoenix's margin view as the account route carries it. */
export function margin(changes = {}) {
  return {
    collateralUsd: 120,
    portfolioUsd: 131.2,
    initialMarginUsd: 30,
    maintenanceMarginUsd: 15,
    withdrawableMicro: "90000000",
    riskTier: "safe",
    canDeposit: true,
    canWithdraw: true,
    positions: [{ symbol: "SOL", subaccount: 0, liquidationPriceUsd: 118.4, leverage: 4.6 }],
    ...changes,
  };
}

/** A wallet's account as `/api/solana/futures/account` answers it: one long, its TP/SL, one resting order. */
export function account(changes = {}) {
  return {
    wallet: OWNER,
    state: "active",
    collateralUsd: 120,
    collateralSol: null,
    positions: [{ symbol: "SOL", subaccount: 0, side: "long", size: 4, entryPrice: 147.2, tpPrice: 165, slPrice: 140 }],
    orders: [
      { id: "0:SOL:101", symbol: "SOL", subaccount: 0, side: "buy", type: "limit", price: 138, size: 1, reduceOnly: false, stop: false, status: "open", sequence: "101" },
      { id: "0:SOL:202", symbol: "SOL", subaccount: 0, side: "sell", type: "limit", price: 165, size: 4, reduceOnly: true, stop: true, status: "open", sequence: "202", conditional: 3, conditionalLeg: "tp" },
    ],
    margin: margin(),
    observedAt: 1_700_000_000_000,
    ...changes,
  };
}

export const NO_ACCOUNT = { wallet: OWNER, state: "none", collateralUsd: null, collateralSol: null, positions: [], orders: [], observedAt: 1 };

/** The ticket's figures as `/api/solana/futures/ticket` answers them. */
export function figures(changes = {}) {
  return {
    symbol: "SOL",
    account: { riskTier: "safe", portfolioUsd: 131.2, effectiveUsd: 131.2, initialMarginUsd: 30, maintenanceMarginUsd: 15, availableUsd: 101.2 },
    maxLots: "13000",
    order: { marginUsd: 1.5, marginAtLeverageUsd: 15, feesUsd: 0.0105, carried: true, liquidation: { kind: "price", priceUsd: 112.6 }, after: { riskTier: "safe", portfolioUsd: 131.19, effectiveUsd: 131.19, initialMarginUsd: 45, maintenanceMarginUsd: 22.5, availableUsd: 86.19 } },
    markUsd: 150,
    observedAt: 1_700_000_000_000,
    ...changes,
  };
}

/** A base58 address as its 32 bytes. */
export function keyBytes(address) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const character of address) value = value * 58n + BigInt(alphabet.indexOf(character));
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index -= 1) {
    bytes[index] = Number(value & 255n);
    value >>= 8n;
  }
  return bytes;
}

/**
 * A signed legacy transaction's wire: the signature count, one signature of `byte`s, and a message whose header names
 * one signer and whose first static account — the fee payer — is `payer`; a zero blockhash and no instructions.
 */
export function wire(byte = 7, payer = OWNER) {
  const bytes = new Uint8Array(1 + 64 + 3 + 1 + 32 + 32 + 1);
  bytes[0] = 1;
  bytes.fill(byte, 1, 65);
  bytes.set([1, 0, 0, 1], 65);
  bytes.set(keyBytes(payer), 69);
  return Buffer.from(bytes).toString("base64");
}

/** The same with a v0 message: its version byte (`0x80`) before the header. */
export function wireV0(byte = 7, payer = OWNER) {
  const bytes = new Uint8Array(1 + 64 + 1 + 3 + 1 + 32 + 32 + 1 + 1);
  bytes[0] = 1;
  bytes.fill(byte, 1, 65);
  bytes.set([0x80, 1, 0, 0, 1], 65);
  bytes.set(keyBytes(payer), 70);
  return Buffer.from(bytes).toString("base64");
}

/**
 * A v1 transaction's wire (SIMD-0385): the message first — the version byte, one signer, the config mask, the lifetime,
 * no instructions, one static account (`payer`) — and the signature of `byte`s at the tail.
 */
export function wireV1(byte = 9, payer = OWNER) {
  const bytes = new Uint8Array(1 + 3 + 4 + 32 + 1 + 1 + 32 + 64);
  bytes[0] = 0x81;
  bytes[1] = 1;
  bytes[41] = 1;
  bytes.set(keyBytes(payer), 42);
  bytes.fill(byte, 74);
  return Buffer.from(bytes).toString("base64");
}

/** An order's Review as `/api/solana/futures/orders/review` answers it. */
export function orderReview(changes = {}) {
  return {
    kind: "open",
    symbol: "SOL",
    tif: "fok",
    side: "long",
    type: "market",
    sizeLots: "200",
    sizeUnits: "0.2",
    priceUsd: 150.75,
    markUsd: 150,
    indexUsd: 149.9,
    slippageBps: 50,
    notionalUsd: 30.15,
    before: { collateralUsd: 120, accountValueUsd: 131.2, liquidationUsd: 118.4, positionUnits: "4", initialMarginUsd: 30 },
    after: { positionUnits: "4.2", entryUsd: 147.34, positionValueUsd: 630, liquidationUsd: 117.9, liquidationStatus: "found", leverage: 4.8, collateralUsd: 119.99, accountValueUsd: 131.19, collateralChangeUsd: -0.0106, freeCollateralUsd: 86.2, initialMarginUsd: 45, riskTier: "safe" },
    fees: { takerRate: 0.00035, makerRate: 0.00005, venueUsd: 0.0106, venueLiquidity: "taker", builderBps: 0, builderUsd: 0 },
    funding: { ratePercent: 0.0012, payer: "long", intervalSeconds: 3600 },
    tpUsd: null,
    slUsd: null,
    clearsLegs: false,
    impact: { averageUsd: 150.02, bestUsd: 150.01, percent: 0.007 },
    book: "walked",
    order: null,
    cancelAll: null,
    conditional: null,
    rentLamports: "0",
    networkFeeLamports: "5000",
    traderAccount: "TraderPda1111111111111111111111111111111111",
    transaction: { wireBase64: wire(1) },
    ticket: "order-ticket-1",
    expiresAt: 0,
    signableMs: 30_000,
    ...changes,
  };
}

/** A collateral Review as `/api/solana/futures/collateral/review` answers it. */
export function collateralReview(changes = {}) {
  return {
    action: "deposit",
    amount: "25000000",
    receive: "25000000",
    phoenixFee: "0",
    walletUsdc: "184000000",
    freeAfter: null,
    rentLamports: "0",
    networkFeeLamports: "5000",
    traderAccount: "TraderPda1111111111111111111111111111111111",
    transaction: { wireBase64: wire(2) },
    ticket: "collateral-ticket-1",
    expiresAt: 0,
    signableMs: 30_000,
    ...changes,
  };
}

export const FILL = { sizeUnits: 0.2, priceUsd: 150.02, feeUsd: 0.0106, realizedPnlUsd: 0, liquidity: "taker" };

export const ok = (value, status = 200) => ({ ok: true, value, status });
export const no = (code, message = "refused") => ({ ok: false, failure: { code, message } });

/**
 * An engine that answers from a script: each route takes its answers in order and repeats the last one. Every call is
 * kept, so a test can say what was asked and how often.
 */
export function scriptedEngine(script = {}) {
  const calls = [];
  const answer = (route) => (...args) => {
    calls.push({ route, args });
    const queue = script[route];
    if (!queue || queue.length === 0) return Promise.resolve(no("NOT_SCRIPTED"));
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(typeof next === "function" ? next(...args) : next);
  };
  const routes = ["markets", "funding", "book", "candles", "account", "ticket", "orderStates", "collateralStates", "history", "reviewOrder", "submitOrder", "orderStatus", "reviewCollateral", "submitCollateral", "collateralStatus"];
  const engine = Object.fromEntries(routes.map((route) => [route, answer(route)]));
  return { engine, calls, routes: (route) => calls.filter((call) => call.route === route) };
}

/** A clock the tests move: `sleep` passes the time at once. */
export function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    pass: (ms) => {
      now += ms;
    },
  };
}
