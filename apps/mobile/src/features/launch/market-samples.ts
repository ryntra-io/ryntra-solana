/**
 * The contract's own examples of 1.36.0 (`docs/api/examples/v1/launch-markets.response.json`,
 * `launch-market.response.json`, `launch-health.response.json`, `launch-health-curve.response.json`,
 * `launch-journal.response.json` in the web app), word for word but for the transactions and the wallets: every signature and
 * every wallet here is made up (`4SyntheticDemoSignatureFakeTx…`, `SyntheticDemo…FakeAddress…`), so none leads to a recorded act.
 * The tests read the market's words from them, and the development gallery draws the states
 * after the DEX that no market on mainnet has reached yet. Never shown in a release build.
 */

import type {
  LaunchJournalResponse,
  LaunchMarketCardResponse,
  LaunchMarketHealthResponse,
  LaunchMarketsResponse,
} from '../../lib/api/v1/types.ts'

/** `GET /api/v1/launch/markets` — a market with Ryntra's ladder at work, and a market on its curve. */
export const SAMPLE_MARKETS: LaunchMarketsResponse = {
  network: 'solana:mainnet',
  markets: [
    {
      token: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
      name: 'Example Owl',
      symbol: 'EXOWL',
      image: null,
      preset: 'classic',
      launchedAt: '2026-10-01T08:00:00.000Z',
      creator: 'SyntheticDemoCreatorFakeAddress111111111111',
      technicalValidation: false,
      pair: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        decimals: 6,
        dollar: true,
      },
      read: true,
      state: {
        code: 'LADDER_ACTIVE',
        since: '2026-10-06T08:55:00.000Z',
      },
      venue: 'pool',
      progress: {
        bps: 10000,
        migrated: true,
      },
      poolLiquidity: {
        pair: 29480,
        usd: 29480,
      },
      budget: {
        state: 'NOT_COUNTED',
        earnedRaw: null,
        reserveRaw: null,
        ladder: 'PLACED',
        deployed: {
          pairRaw: '90000000',
          tokensRaw: '0',
        },
      },
      depth5Raw: '373225136',
      daysSinceDex: 3,
      traded24h: true,
      holders: 5,
      holdersAtLeast: false,
      creatorLock: {
        escrow: 'E5wWTjkey73XSq3kpuHBYv4YwMV9hkeuFQod3fyUhoQ3',
        cliffAt: '2026-12-30T08:00:00.000Z',
        endsAt: '2027-03-30T08:00:00.000Z',
      },
      creatorSold: false,
      observedAt: '2026-10-09T12:00:00.000Z',
    },
    {
      token: '9yn4Fpv5scbzLkVUZtFBL6Lt665aYQp8FcHJyqxUDLgW',
      name: 'Example Cat',
      symbol: 'EXCAT',
      image: null,
      preset: 'classic',
      launchedAt: '2026-10-08T06:00:00.000Z',
      creator: 'SyntheticDemoCreatorTwoFakeAddress111111111',
      technicalValidation: true,
      pair: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        decimals: 6,
        dollar: true,
      },
      read: true,
      state: {
        code: 'PRICE_DISCOVERY',
        since: '2026-10-08T16:00:00.000Z',
      },
      venue: 'curve',
      progress: {
        bps: 3999,
        migrated: false,
      },
      poolLiquidity: null,
      budget: {
        state: 'NOT_COUNTED',
        earnedRaw: null,
        reserveRaw: null,
        ladder: 'NONE',
        deployed: null,
      },
      depth5Raw: '292730686',
      daysSinceDex: null,
      traded24h: true,
      holders: 2,
      holdersAtLeast: false,
      creatorLock: null,
      creatorSold: false,
      observedAt: '2026-10-09T12:00:00.000Z',
    },
  ],
  complete: true,
  observedAt: '2026-10-09T12:00:00.000Z',
}

/** `GET /api/v1/launch/markets/{mint}` — the first market's card and its addresses. */
export const SAMPLE_MARKET_CARD: LaunchMarketCardResponse = {
  network: 'solana:mainnet',
  market: {
    token: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
    name: 'Example Owl',
    symbol: 'EXOWL',
    image: null,
    preset: 'classic',
    launchedAt: '2026-10-01T08:00:00.000Z',
    creator: 'SyntheticDemoCreatorFakeAddress111111111111',
    technicalValidation: false,
    pair: {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      decimals: 6,
      dollar: true,
    },
    read: true,
    state: {
      code: 'LADDER_ACTIVE',
      since: '2026-10-06T08:55:00.000Z',
    },
    venue: 'pool',
    progress: {
      bps: 10000,
      migrated: true,
    },
    poolLiquidity: {
      pair: 29480,
      usd: 29480,
    },
    budget: {
      state: 'NOT_COUNTED',
      earnedRaw: null,
      reserveRaw: null,
      ladder: 'PLACED',
      deployed: {
        pairRaw: '90000000',
        tokensRaw: '0',
      },
    },
    depth5Raw: '373225136',
    daysSinceDex: 3,
    traded24h: true,
    holders: 5,
    holdersAtLeast: false,
    creatorLock: {
      escrow: 'E5wWTjkey73XSq3kpuHBYv4YwMV9hkeuFQod3fyUhoQ3',
      cliffAt: '2026-12-30T08:00:00.000Z',
      endsAt: '2027-03-30T08:00:00.000Z',
    },
    creatorSold: false,
    observedAt: '2026-10-09T12:00:00.000Z',
  },
  addresses: {
    config: 'B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G',
    curve: 'B5CfNHzQvJjVo3qeBQXL7GHSA89vkfvxwmnPVdCQyiSJ',
    pairMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    pool: 'H37Mo7XaknfHtqnt7zKfoVvXdztecGMMqJ5jyZx5ov2A',
    lockedPositions: [
      {
        position: '71kurnhJFWBcJ5FDoHHC5h1z67eBviQBSduAwte67iz1',
        owner: 'SyntheticDemoCreatorFakeAddress111111111111',
      },
      {
        position: '8EQtEEij2iV812LP4FV7Wb3bS2JMdrbFcVYsn9eKhxZm',
        owner: 'SyntheticDemoLockerFakeAddress1111111111111',
      },
    ],
    creatorLock: 'E5wWTjkey73XSq3kpuHBYv4YwMV9hkeuFQod3fyUhoQ3',
    feeVault: null,
    ladder: {
      pool: 'A3Hpc7UGZSEGUdwVGmvNS85uNzHwbhF9y1hCmEUX2JZT',
      position: 'A4GCz5NBgRkppCCkR8uswSnbLWBonHpLdMEDdzhmaFqf',
    },
    executor: 'SyntheticDemoExecutorFakeAddress11111111111',
  },
  observedAt: '2026-10-09T12:00:00.000Z',
}

/** `GET /api/v1/launch/{mint}/health` — on the DEX, Ryntra's ladder placed, the executor acting. */
export const SAMPLE_HEALTH_DEX: LaunchMarketHealthResponse = {
  network: 'solana:mainnet',
  token: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
  pair: {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    decimals: 6,
    dollar: true,
  },
  tokenDecimals: 6,
  price: {
    pair: 0.00008100000000000002,
    usd: 0.00008100000000000002,
  },
  state: {
    code: 'LADDER_ACTIVE',
    since: '2026-10-06T08:55:00.000Z',
  },
  technicalValidation: false,
  venue: 'pool',
  depth: [
    {
      dropBps: 200,
      pairRaw: '148144464',
      ladderRaw: '0',
    },
    {
      dropBps: 500,
      pairRaw: '373225136',
      ladderRaw: '0',
    },
    {
      dropBps: 1000,
      pairRaw: '816408187',
      ladderRaw: '60000000',
    },
  ],
  budget: {
    state: 'NOT_COUNTED',
    earnedRaw: null,
    reserveRaw: null,
    ladder: 'PLACED',
    deployed: {
      pairRaw: '90000000',
      tokensRaw: '0',
    },
  },
  ladder: {
    pool: 'A3Hpc7UGZSEGUdwVGmvNS85uNzHwbhF9y1hCmEUX2JZT',
    pairRaw: '90000000',
    tokensRaw: '0',
    pairFrom: 0.00007103643673994484,
    pairTo: 0.00007692228186777419,
  },
  survival: {
    graduatedAt: '2026-10-06T08:00:40.000Z',
    daysSinceDex: 3,
    priceVsDexBps: 800,
    traded24h: true,
    lastTradeAt: '2026-10-09T07:00:00.000Z',
  },
  holders: {
    count: 5,
    atLeast: false,
    minUsd: 1,
  },
  creator: {
    address: 'SyntheticDemoCreatorFakeAddress111111111111',
    lock: {
      escrow: 'E5wWTjkey73XSq3kpuHBYv4YwMV9hkeuFQod3fyUhoQ3',
      cliffAt: '2026-12-30T08:00:00.000Z',
      endsAt: '2027-03-30T08:00:00.000Z',
    },
    sold: false,
    soldBps: null,
    soldOf: null,
  },
  concentration: {
    top10Bps: 10000,
    atLeast: false,
    marked: true,
    markBps: 6000,
  },
  engine: {
    executor: 'SyntheticDemoExecutorFakeAddress11111111111',
    acts: true,
    lastAction: {
      kind: 'FLOOR_PLACED',
      at: '2026-10-06T08:55:00.000Z',
      signature: '4SyntheticDemoSignatureFakeTxA1111111111111111111111111111111111111111111111111111111111',
    },
    pause: null,
  },
  rules: [
    {
      code: 'MINT_REVOKED',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
      },
      values: {},
    },
    {
      code: 'NO_FREEZE',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
      },
      values: {},
    },
    {
      code: 'METADATA_FIXED',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
      },
      values: {},
    },
    {
      code: 'NO_TRANSFER_HOOK',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
      },
      values: {},
    },
    {
      code: 'CONFIG_FIXED',
      enforcement: 'rule',
      by: 'meteora-dbc',
      source: {
        kind: 'account',
        id: 'B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G',
      },
      values: {},
    },
    {
      code: 'LP_LOCKED_FOREVER',
      enforcement: 'rule',
      by: 'meteora-damm-v2',
      source: {
        kind: 'account',
        id: '71kurnhJFWBcJ5FDoHHC5h1z67eBviQBSduAwte67iz1',
      },
      values: {
        owner: 'creator',
      },
    },
    {
      code: 'LP_LOCKED_FOREVER',
      enforcement: 'rule',
      by: 'meteora-damm-v2',
      source: {
        kind: 'account',
        id: '8EQtEEij2iV812LP4FV7Wb3bS2JMdrbFcVYsn9eKhxZm',
      },
      values: {
        owner: 'partner',
      },
    },
    {
      code: 'CREATOR_LOCK',
      enforcement: 'rule',
      by: 'met-lock',
      source: {
        kind: 'account',
        id: 'E5wWTjkey73XSq3kpuHBYv4YwMV9hkeuFQod3fyUhoQ3',
      },
      values: {
        cliffAt: 1798617600,
        endsAt: 1806393600,
      },
    },
    {
      code: 'CREATOR_FIRST_BUY_CAP',
      enforcement: 'policy',
      by: 'ryntra',
      source: {
        kind: 'tx',
        id: '4SyntheticDemoSignatureFakeTxE1111111111111111111111111111111111111111111111111111111111',
      },
      values: {
        capBps: 500,
      },
    },
    {
      code: 'FEE_FUNDED_LADDER',
      enforcement: 'policy',
      by: 'ryntra',
      source: {
        kind: 'account',
        id: 'A3Hpc7UGZSEGUdwVGmvNS85uNzHwbhF9y1hCmEUX2JZT',
      },
      values: {},
    },
    {
      code: 'CREATOR_SALE_MARK',
      enforcement: 'policy',
      by: 'ryntra',
      source: null,
      values: {},
    },
    {
      code: 'CONCENTRATION_MARK',
      enforcement: 'policy',
      by: 'ryntra',
      source: null,
      values: {
        markBps: 6000,
      },
    },
  ],
  rulesComplete: true,
  observedAt: '2026-10-09T12:00:00.000Z',
}

/** `GET /api/v1/launch/{mint}/health` — on the curve, no executor yet. */
export const SAMPLE_HEALTH_CURVE: LaunchMarketHealthResponse = {
  network: 'solana:mainnet',
  token: '9yn4Fpv5scbzLkVUZtFBL6Lt665aYQp8FcHJyqxUDLgW',
  pair: {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    decimals: 6,
    dollar: true,
  },
  tokenDecimals: 6,
  price: {
    pair: 0.00002309516046358268,
    usd: 0.00002309516046358268,
  },
  state: {
    code: 'PRICE_DISCOVERY',
    since: '2026-10-08T16:00:00.000Z',
  },
  technicalValidation: true,
  venue: 'curve',
  depth: [
    {
      dropBps: 200,
      pairRaw: '116193757',
      ladderRaw: null,
    },
    {
      dropBps: 500,
      pairRaw: '292730686',
      ladderRaw: null,
    },
    {
      dropBps: 1000,
      pairRaw: '593271637',
      ladderRaw: null,
    },
  ],
  budget: {
    state: 'NOT_COUNTED',
    earnedRaw: null,
    reserveRaw: null,
    ladder: 'NONE',
    deployed: null,
  },
  ladder: null,
  survival: {
    graduatedAt: null,
    daysSinceDex: null,
    priceVsDexBps: null,
    traded24h: true,
    lastTradeAt: '2026-10-09T10:00:00.000Z',
  },
  holders: {
    count: 2,
    atLeast: false,
    minUsd: 1,
  },
  creator: {
    address: 'SyntheticDemoCreatorTwoFakeAddress111111111',
    lock: null,
    sold: false,
    soldBps: null,
    soldOf: null,
  },
  concentration: {
    top10Bps: 10000,
    atLeast: false,
    marked: true,
    markBps: 6000,
  },
  engine: {
    executor: null,
    acts: false,
    lastAction: null,
    pause: null,
  },
  rules: [
    {
      code: 'MINT_REVOKED',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '9yn4Fpv5scbzLkVUZtFBL6Lt665aYQp8FcHJyqxUDLgW',
      },
      values: {},
    },
    {
      code: 'NO_FREEZE',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '9yn4Fpv5scbzLkVUZtFBL6Lt665aYQp8FcHJyqxUDLgW',
      },
      values: {},
    },
    {
      code: 'METADATA_FIXED',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '9yn4Fpv5scbzLkVUZtFBL6Lt665aYQp8FcHJyqxUDLgW',
      },
      values: {},
    },
    {
      code: 'NO_TRANSFER_HOOK',
      enforcement: 'rule',
      by: 'token-2022',
      source: {
        kind: 'account',
        id: '9yn4Fpv5scbzLkVUZtFBL6Lt665aYQp8FcHJyqxUDLgW',
      },
      values: {},
    },
    {
      code: 'CONFIG_FIXED',
      enforcement: 'rule',
      by: 'meteora-dbc',
      source: {
        kind: 'account',
        id: 'B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G',
      },
      values: {},
    },
    {
      code: 'CURVE_HOLDS_FUNDS',
      enforcement: 'rule',
      by: 'meteora-dbc',
      source: {
        kind: 'account',
        id: '3ShwteFJ4mQspSNYRz8ek7o1Ti884AotA9yGaeSzAN89',
      },
      values: {},
    },
    {
      code: 'GRADUATION_AT_THRESHOLD',
      enforcement: 'rule',
      by: 'meteora-dbc',
      source: {
        kind: 'account',
        id: 'B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G',
      },
      values: {
        thresholdRaw: '15454411163',
      },
    },
    {
      code: 'CREATOR_FIRST_BUY_CAP',
      enforcement: 'policy',
      by: 'ryntra',
      source: {
        kind: 'tx',
        id: '4SyntheticDemoSignatureFakeTxF1111111111111111111111111111111111111111111111111111111111',
      },
      values: {
        capBps: 500,
      },
    },
    {
      code: 'CREATOR_SALE_MARK',
      enforcement: 'policy',
      by: 'ryntra',
      source: null,
      values: {},
    },
    {
      code: 'CONCENTRATION_MARK',
      enforcement: 'policy',
      by: 'ryntra',
      source: null,
      values: {
        markBps: 6000,
      },
    },
  ],
  rulesComplete: true,
  observedAt: '2026-10-09T12:00:00.000Z',
}

/** `GET /api/v1/launch/{mint}/journal` — the market of `SAMPLE_HEALTH_DEX`: launched, locked, graduated, Ryntra's ladder placed. The executor's marks of 1.37.0 are not read here. */
export const SAMPLE_JOURNAL: LaunchJournalResponse = {
  network: 'solana:mainnet',
  token: '82kB8qvCcyzEyiuYEaVA99GctiWh53sebq256NoF1gkT',
  pair: {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    decimals: 6,
    dollar: true,
  },
  tokenDecimals: 6,
  executor: 'SyntheticDemoExecutorFakeAddress11111111111',
  events: [
    {
      pairRaw: '90000000',
      tokensRaw: null,
      priceLow: 0.00007103643673994484,
      priceHigh: 0.00007692228186777419,
      soldBps: null,
      soldOf: null,
      kind: 'FLOOR_PLACED',
      at: '2026-10-06T08:55:00.000Z',
      signature: '4SyntheticDemoSignatureFakeTxA1111111111111111111111111111111111111111111111111111111111',
      actor: 'ryntra',
      enforcement: 'policy',
    },
    {
      pairRaw: '10000',
      tokensRaw: '1200000',
      priceLow: null,
      priceHigh: null,
      soldBps: null,
      soldOf: null,
      kind: 'FLOOR_POOL',
      at: '2026-10-06T08:50:00.000Z',
      signature: '4SyntheticDemoSignatureFakeTxB1111111111111111111111111111111111111111111111111111111111',
      actor: 'ryntra',
      enforcement: 'policy',
    },
    {
      pairRaw: '15454411163',
      tokensRaw: null,
      priceLow: null,
      priceHigh: null,
      soldBps: null,
      soldOf: null,
      kind: 'GRADUATED',
      at: '2026-10-06T08:00:40.000Z',
      signature: '4SyntheticDemoSignatureFakeTxC1111111111111111111111111111111111111111111111111111111111',
      actor: 'meteora',
      enforcement: 'rule',
    },
    {
      pairRaw: null,
      tokensRaw: '19600000000000',
      priceLow: null,
      priceHigh: null,
      soldBps: null,
      soldOf: null,
      kind: 'CREATOR_LOCKED',
      at: '2026-10-01T08:00:00.000Z',
      signature: '4SyntheticDemoSignatureFakeTxD1111111111111111111111111111111111111111111111111111111111',
      actor: 'creator',
      enforcement: 'rule',
    },
    {
      pairRaw: '200000000',
      tokensRaw: '19600000000000',
      priceLow: null,
      priceHigh: null,
      soldBps: null,
      soldOf: null,
      kind: 'LAUNCHED',
      at: '2026-10-01T08:00:00.000Z',
      signature: '4SyntheticDemoSignatureFakeTxE1111111111111111111111111111111111111111111111111111111111',
      actor: 'creator',
      enforcement: 'rule',
    },
  ],
  total: 5,
  complete: true,
  floor: {
    pool: 'A3Hpc7UGZSEGUdwVGmvNS85uNzHwbhF9y1hCmEUX2JZT',
    position: 'A4GCz5NBgRkppCCkR8uswSnbLWBonHpLdMEDdzhmaFqf',
    pairRaw: '90000000',
    tokensRaw: '0',
    priceLow: 0.00007103643673994484,
    priceHigh: 0.00007692228186777419,
    placedRaw: '90000000',
    observedAt: '2026-10-09T12:00:00.000Z',
  },
  floorUnread: false,
  observedAt: '2026-10-09T12:00:00.000Z',
}
