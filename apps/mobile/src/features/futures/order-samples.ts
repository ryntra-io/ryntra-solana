/**
 * Phoenix order answers as the server sends them (B6b's `reviewOrder` and `submitOrder`, line A) — the open path the
 * gate keeps closed on production until the operator's canary: the tests read them, the gallery draws them. Every identity
 * is visibly synthetic (M28): never a real wallet, trader account, ticket or signature. The figures are a SOL market's
 * as Phoenix states them (tick 100, two base decimals, taker 3.5 bps, maker 0.5 bps).
 */

const SAMPLE_WALLET = 'samp1eWa11et1111111111111111111111111111111'
const SAMPLE_TRADER = 'samp1eTrader111111111111111111111111111111'
const SAMPLE_SIGNATURE = 'samp1eSignature11111111111111111111111111111111111111111111111111111111111111111111'
/** A legacy wire's head: one signature's room, then a message — enough for the phone's version check, never a real transaction. */
export const SAMPLE_WIRE =
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAE='

const base = {
  symbol: 'SOL',
  indexUsd: 103.87,
  rentLamports: '0',
  networkFeeLamports: '5000',
  traderAccount: SAMPLE_TRADER,
  transaction: { wireBase64: SAMPLE_WIRE },
  ticket: 'sample-ticket',
  expiresAt: 0,
  signableMs: 24_000,
  order: null,
  tpUsd: null,
  slUsd: null,
  clearsLegs: false,
}

const fees = (venueUsd: number | null) => ({
  takerRate: 0.00035,
  makerRate: 0.00005,
  venueUsd,
  builderBps: 0,
  builderUsd: 0,
})
const funding = { ratePercent: 0.0012, payer: 'long', intervalSeconds: 3600 }

/** A market long of 0.48 SOL with TP/SL: Phoenix's view of the account after it, the funding, the TP/SL account's rent. */
export const SAMPLE_OPEN_MARKET = {
  ...base,
  kind: 'open',
  side: 'long',
  type: 'market',
  sizeLots: '48',
  sizeUnits: '0.48',
  priceUsd: 104.45,
  markUsd: 103.94,
  slippageBps: 50,
  notionalUsd: 50.1336,
  before: { collateralUsd: 250, accountValueUsd: 250, liquidationUsd: null, positionUnits: '0', initialMarginUsd: 0 },
  after: {
    positionUnits: '0.48',
    entryUsd: 103.96,
    positionValueUsd: 49.89,
    liquidationUsd: 61.2,
    liquidationStatus: 'found',
    leverage: 0.2,
    collateralUsd: 249.98,
    accountValueUsd: 249.97,
    collateralChangeUsd: -0.02,
    freeCollateralUsd: 247.98,
    initialMarginUsd: 2,
    riskTier: 'safe',
  },
  fees: fees(0.017547),
  funding,
  tpUsd: 115,
  slUsd: 98,
  rentLamports: '2039280',
}

/** A limit short of 0.23 SOL resting at $105: its fees depend on how it fills. */
export const SAMPLE_OPEN_LIMIT = {
  ...base,
  kind: 'open',
  side: 'short',
  type: 'limit',
  sizeLots: '23',
  sizeUnits: '0.23',
  priceUsd: 105,
  markUsd: 103.94,
  slippageBps: null,
  notionalUsd: 24.15,
  before: { collateralUsd: 250, accountValueUsd: 250, liquidationUsd: null, positionUnits: '0', initialMarginUsd: 0 },
  after: {
    positionUnits: '0',
    entryUsd: null,
    positionValueUsd: 0,
    liquidationUsd: null,
    liquidationStatus: 'no_position',
    leverage: 0,
    collateralUsd: 250,
    accountValueUsd: 250,
    collateralChangeUsd: 0,
    freeCollateralUsd: 249.03,
    initialMarginUsd: 0.97,
    riskTier: 'safe',
  },
  fees: fees(0.008453),
  funding,
}

/** The whole long closed, reduce-only, its TP/SL lifted in the same transaction. */
export const SAMPLE_CLOSE = {
  ...base,
  kind: 'reduce',
  side: 'long',
  type: 'market',
  sizeLots: '48',
  sizeUnits: '0.48',
  priceUsd: 103.42,
  markUsd: 103.94,
  slippageBps: 50,
  notionalUsd: 49.89,
  before: {
    collateralUsd: 249.98,
    accountValueUsd: 249.97,
    liquidationUsd: 61.2,
    positionUnits: '0.48',
    initialMarginUsd: 2,
  },
  after: {
    positionUnits: '0',
    entryUsd: null,
    positionValueUsd: 0,
    liquidationUsd: null,
    liquidationStatus: 'no_position',
    leverage: 0,
    collateralUsd: 249.95,
    accountValueUsd: 249.95,
    collateralChangeUsd: -0.03,
    freeCollateralUsd: 249.95,
    initialMarginUsd: 0,
    riskTier: 'safe',
  },
  fees: fees(0.017462),
  funding,
  clearsLegs: true,
}

/** TP/SL set on the whole long. */
export const SAMPLE_PROTECT = {
  ...base,
  kind: 'protect',
  side: 'long',
  type: 'market',
  sizeLots: '0',
  sizeUnits: '0',
  priceUsd: null,
  markUsd: 103.94,
  slippageBps: null,
  notionalUsd: null,
  before: SAMPLE_CLOSE.before,
  after: { ...SAMPLE_OPEN_MARKET.after, collateralChangeUsd: 0 },
  fees: fees(0),
  funding,
  tpUsd: 120,
  slUsd: 95,
  clearsLegs: true,
}

/** A resting limit taken out of the book. */
export const SAMPLE_CANCEL = {
  ...base,
  kind: 'cancel',
  side: 'short',
  type: 'market',
  sizeLots: '0',
  sizeUnits: '0',
  priceUsd: null,
  markUsd: 103.94,
  slippageBps: null,
  notionalUsd: null,
  before: null,
  after: null,
  fees: fees(0),
  funding: null,
  order: { id: '18446744073638547647', side: 'sell', priceUsd: 105, sizeUnits: '0.23' },
}

/** The relay's answers: landed with Phoenix's fills, landed with nothing filled, not seen yet, failed on the chain. */
export const SAMPLE_RELAY_FILLED = {
  results: [
    {
      signature: SAMPLE_SIGNATURE,
      state: 'LANDED',
      reason: null,
      fills: [
        { sizeUnits: 0.3, priceUsd: 103.95, feeUsd: 0.010915, realizedPnlUsd: 0, liquidity: 'taker' },
        { sizeUnits: 0.18, priceUsd: 103.97, feeUsd: 0.00655, realizedPnlUsd: 0, liquidity: 'taker' },
      ],
    },
  ],
  settled: true,
}
export const SAMPLE_RELAY_RESTING = {
  results: [{ signature: SAMPLE_SIGNATURE, state: 'LANDED', reason: null, fills: [] }],
  settled: true,
}
export const SAMPLE_RELAY_PENDING = {
  results: [{ signature: SAMPLE_SIGNATURE, state: 'UNKNOWN', reason: null }],
  settled: false,
}
export const SAMPLE_RELAY_FAILED = {
  results: [{ signature: SAMPLE_SIGNATURE, state: 'FAILED', reason: 'InstructionError', fills: null }],
  settled: false,
}

export const SAMPLE_OWNER = SAMPLE_WALLET
