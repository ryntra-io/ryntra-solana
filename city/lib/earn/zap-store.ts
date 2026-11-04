import { create } from 'zustand';
import { citySigner } from '../app-bridge/route.ts';
import { createEngine, type Engine, type OrderBody } from '../trade/engine.ts';
import { confirmTrade, prepareOrder, recoverTrade, type AttemptStore, type FlowDeps, type FlowPhase, type Intent, type SignResult, type TradeOutcome } from '../trade/flow.ts';
import { browserAttempts, type Connection, type Phase } from '../trade/store.ts';
import { useWallet } from '../trade/wallet.ts';
import { SOL_MINT } from './lst.ts';
import { useEarn } from './open.ts';
import { earnWords } from './words.ts';

/**
 * The first half of a copy's Zap (CITY-99): a person who holds only SOL copies a strategy whose pier is SOL against
 * another coin — the missing half is bought first, then the pier's add follows. The purchase is the city trade card's
 * own engine and flow, unchanged (`city/lib/trade/flow.ts`): the same exact order with the engine's checks and its fee
 * policy, the same signature record shared with every trade surface, the same read-back by signature. The add after
 * it is the Harbor's own Review (`pier-store.ts`). Two signatures in the person's own wallet; nothing is signed for them.
 *
 * A one-signature Zap — Meteora's Zap program swapping and adding in one transaction — needs the engine's Review to
 * admit that program: an engine change under spec §18.3, not this store.
 */

export type ZapLeg = Readonly<{ mint: string; symbol: string; decimals: number; lamports: bigint }>;
export type ZapReview = Readonly<{ key: string; order: OrderBody; receivedAt: number }>;

export type ZapEnv = Readonly<{
  engine: Engine;
  attempts: AttemptStore;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sign: (connection: Connection, unsignedWireBase64: string) => Promise<SignResult>;
  refreshHoldings: (delaysMs?: readonly number[]) => void;
}>;

let env: ZapEnv = {
  engine: createEngine(),
  attempts: browserAttempts,
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  refreshHoldings: (delays) => useWallet.getState().refreshHoldings(delays),
};

/** For the tests. */
export function setZapEnv(next: Partial<ZapEnv>): void {
  env = { ...env, ...next };
}

/** A little more than what is missing, so the add's own split still fits when the price moves between the two. */
export const ZAP_MARGIN_PCT = 3n;
const AFTER_READS_MS = [1_200, 4_000, 9_000];
/** How long after a landed purchase the card waits on the wallet's reads before it offers anything again. */
export const SETTLE_MS = 10_000;

export const ZAP_BUSY: ReadonlySet<Phase> = new Set(['wallet', 'sending', 'checking']);

/** The SOL to swap for a missing amount worth `missingLamports`: the margin on top, whole lamports. */
export function zapLamports(missingLamports: bigint): bigint {
  return missingLamports <= 0n ? 0n : (missingLamports * (100n + ZAP_MARGIN_PCT) + 99n) / 100n;
}

export function zapKey(owner: string, leg: ZapLeg): string {
  return `${owner}:${leg.mint}:${leg.lamports}`;
}

type ZapState = {
  key: string | null;
  phase: Phase;
  review: ZapReview | null;
  notice: Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }> | null;
  /** The purchase landed: its signature and what it brought, base units of the coin. */
  done: Readonly<{ key: string; signature: string; outRaw: string | null }> | null;
  failed: string | null;
  unknown: Readonly<{ signature: string; message: string }> | null;
  /** Just landed: the wallet is read again before the add's Review, and nothing is bought again meanwhile. */
  settling: boolean;
  /** The exact order for this leg, built while the card is read; nothing is signed. */
  prepare: (connection: Connection, leg: ZapLeg) => Promise<void>;
  /** The one action: sign the order on screen, or build it first when there is none. */
  press: (connection: Connection, leg: ZapLeg) => Promise<void>;
  recover: (connection: Connection) => Promise<void>;
  reset: () => void;
};

let ticket = 0;

export const useZap = create<ZapState>((set, get) => {
  const intentOf = (connection: Connection, leg: ZapLeg): Intent => ({ side: 'buy', inputMint: SOL_MINT, outputMint: leg.mint, amountRaw: leg.lamports.toString(), taker: connection.address });
  const deps = (connection: Connection): FlowDeps => ({
    engine: env.engine,
    sign: (wire) => env.sign(connection, wire),
    attempts: env.attempts,
    now: env.now,
    sleep: env.sleep,
    onPhase: (phase: FlowPhase) => {
      set({ phase });
      useEarn.getState().setBusy(ZAP_BUSY.has(phase));
    },
  });
  const idle = (patch: Partial<ZapState>) => {
    useEarn.getState().setBusy(false);
    set({ phase: 'idle', ...patch });
  };
  const settle = (outcome: TradeOutcome, mine: number, key: string | null, connection: Connection) => {
    if (mine !== ticket) return;
    switch (outcome.kind) {
      case 'ready':
        return idle({ review: key ? { key, order: outcome.order, receivedAt: outcome.receivedAt } : null });
      case 'review':
        return idle({ notice: { tone: 'warn', text: outcome.note }, review: key ? { key, order: outcome.order, receivedAt: outcome.receivedAt } : null });
      case 'refused':
        return idle({ review: null, notice: { tone: 'error', text: outcome.refusal.message } });
      case 'cancelled':
        return idle({ notice: { tone: 'info', text: earnWords().saver.cancelled } });
      case 'nothing':
        return idle({ review: null, notice: { tone: 'info', text: outcome.message } });
      case 'locked':
        // A signature of this wallet is still out (here or on another surface): read back, never signed again.
        void get().recover(connection);
        return;
      case 'unknown':
        useEarn.getState().setBusy(false);
        return set({ phase: 'unknown', unknown: { signature: outcome.signature, message: outcome.message } });
      case 'failed':
        env.refreshHoldings(AFTER_READS_MS);
        useEarn.getState().setBusy(false);
        return set({ phase: 'failed', review: null, failed: outcome.signature });
      case 'settled':
        env.refreshHoldings(AFTER_READS_MS);
        useEarn.getState().setBusy(false);
        set({ phase: 'idle', review: null, notice: null, settling: true, done: { key: key ?? '', signature: outcome.trade.signature, outRaw: outcome.trade.outputRaw } });
        // The wallet's last read comes after this: until then the card waits rather than offer a second purchase.
        void env.sleep(SETTLE_MS).then(() => {
          if (mine === ticket) set({ settling: false });
        });
        return;
    }
  };

  return {
    key: null,
    phase: 'idle',
    review: null,
    notice: null,
    done: null,
    failed: null,
    unknown: null,
    settling: false,

    prepare: async (connection, leg) => {
      if (leg.lamports <= 0n) return;
      const key = zapKey(connection.address, leg);
      const st = get();
      if (st.phase !== 'idle' || st.settling || (st.key === key && (st.review || st.notice?.tone === 'error'))) return;
      const mine = ++ticket;
      set({ key, phase: 'preparing', review: null, notice: null, failed: null, unknown: null });
      useEarn.getState().setBusy(false);
      settle(await prepareOrder(intentOf(connection, leg), deps(connection)), mine, key, connection);
    },

    press: async (connection, leg) => {
      const st = get();
      if (st.phase === 'unknown') return get().recover(connection);
      if ((st.phase !== 'idle' && st.phase !== 'failed') || st.settling) return;
      const key = zapKey(connection.address, leg);
      const review = st.review?.key === key ? st.review : null;
      if (!review) {
        set({ phase: 'idle', notice: null, failed: null });
        return get().prepare(connection, leg);
      }
      const mine = ++ticket;
      set({ notice: null });
      settle(await confirmTrade({ intent: intentOf(connection, leg), order: review.order, receivedAt: review.receivedAt }, deps(connection)), mine, key, connection);
    },

    recover: async (connection) => {
      const attempt = env.attempts.read();
      if (!attempt || attempt.state === 'SETTLED' || attempt.taker !== connection.address) return;
      const mine = ++ticket;
      set({ phase: 'checking', notice: null });
      useEarn.getState().setBusy(true);
      settle(await recoverTrade(attempt, deps(connection), null), mine, get().key, connection);
    },

    reset: () => {
      if (ZAP_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ key: null, phase: 'idle', review: null, notice: null, done: null, failed: null, unknown: null, settling: false });
    },
  };
});

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __zap: useZap });
