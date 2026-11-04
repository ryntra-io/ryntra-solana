/**
 * The Guard window's stand (CITY-152): four transactions — real wire bytes compiled by `@solana/kit` — and the chain
 * they meet: the accounts before, and what the simulation of each exact transaction reports after. `stand-rpc.mjs`
 * serves this chain as JSON-RPC so the engine's own route (`POST /api/v1/ward/check`) runs end to end on the stand;
 * `shots.mjs` pastes the transactions into the window.
 *
 * Every figure here is a fixture. The live pass is the stand or production with a real RPC.
 */

import * as f from "../../../lib/ward/fixtures.mjs";

export const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
export const FRIEND = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export const DRAINER = "3EpVCPUgyjq2MfGeCttyey6bs5zya5wjYZ2BE6yDg6bm";
export const NONCE = "82ZJ7nbGpixjeDCmEhUcmwXYfvurzAgGdtSMuHnUgyny";
export const LOBSTAR = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
export const OWNER_ATA = "7mKq3x9ZpQv2Lr5tBvXc8nW4yJdHfG6sAeRtUixpLk1z";
export const FRIEND_ATA = "5Hn8tVq2Wx4ZrK7pLm3Yc9Bd6Ef1Gh2Jk3Mn4Pq5Rs6T";

const SOL = 1_000_000_000n;
const SUPPLY_SHARE = 52_439_000n * 1_000_000n;

/** The chain before every scenario: the accounts each one reads. */
export const BEFORE = {
  [OWNER]: f.walletState(42n * SOL),
  [FRIEND]: f.walletState(3n * SOL),
  [NONCE]: { lamports: 1_447_680n, owner: f.SYSTEM, data: new Uint8Array(80) },
  [OWNER_ATA]: f.tokenState({ mint: LOBSTAR, owner: OWNER, amount: SUPPLY_SHARE }),
  [FRIEND_ATA]: f.tokenState({ mint: LOBSTAR, owner: FRIEND, amount: 0n }),
  [LOBSTAR]: f.mintState({ decimals: 6, supply: 1_000_000_000n * 1_000_000n }),
};

export const SCENARIOS = {
  /** The owner swap of December 2025: the balance does not move, the owner does. */
  drain: {
    transaction: f.wire(OWNER, [f.assign(OWNER, DRAINER)]),
    intent: "",
    after: { [OWNER]: { lamports: 42n * SOL - 5_000n, owner: DRAINER, data: new Uint8Array(0) } },
  },
  /** A plain payment to a friend with history, doing what the agent said. */
  clear: {
    transaction: f.wire(OWNER, [f.systemTransfer(OWNER, FRIEND, SOL / 4n)]),
    intent: `send 0.25 SOL to ${FRIEND}`,
    after: { [OWNER]: f.walletState(42n * SOL - SOL / 4n - 5_000n), [FRIEND]: f.walletState(3n * SOL + SOL / 4n) },
  },
  /** Lobstar Wilde: asked for 4 SOL, gives away 52.4 million tokens. */
  intent: {
    transaction: f.wire(OWNER, [f.transferChecked(OWNER_ATA, LOBSTAR, FRIEND_ATA, OWNER, SUPPLY_SHARE, 6)]),
    intent: `send 4 SOL to ${FRIEND}`,
    after: {
      [OWNER]: f.walletState(42n * SOL - 5_000n),
      [OWNER_ATA]: f.tokenState({ mint: LOBSTAR, owner: OWNER, amount: 0n }),
      [FRIEND_ATA]: f.tokenState({ mint: LOBSTAR, owner: FRIEND, amount: SUPPLY_SHARE }),
    },
  },
  /** A durable nonce: the signature is kept, and can be sent whenever its holder likes. */
  nonce: {
    transaction: f.wire(OWNER, [f.advanceNonce(NONCE, OWNER), f.systemTransfer(OWNER, FRIEND, SOL / 10n)]),
    intent: "",
    after: { [OWNER]: f.walletState(42n * SOL - SOL / 10n - 5_000n), [FRIEND]: f.walletState(3n * SOL + SOL / 10n) },
  },
};

/** Addresses with no transaction behind them. */
export const NEW_ADDRESSES = new Set([DRAINER]);
