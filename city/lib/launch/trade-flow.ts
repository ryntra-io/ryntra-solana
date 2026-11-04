import type { LaunchTradeBuildResponse, LaunchTradeReceiptResponse } from '../../../lib/api/v1/contract.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import type { Answer, Network } from './engine.ts';
import type { Signer } from './flow.ts';
import type { LaunchTradeEngine, Side } from './trade.ts';

/**
 * One buy or sale of a launched coin from its tower: the engine builds the swap with a fresh quote, the wallet signs
 * it, the engine sends it once and reads what it filled, and the receipt follows. The city signs nothing and counts
 * nothing; it checks only that the bytes put before the wallet are the trade the person chose. Bytes live about thirty
 * seconds: a signature after that is not sent — the engine builds again and the wallet is asked once more.
 */

export type TradeOrder = Readonly<{ token: string; side: Side; amountRaw: string; slippageBps: number }>;

export type TradeDone = Readonly<{
  side: Side;
  signature: string;
  /** CONFIRMED — the chain confirmed it; PENDING — sent, not confirmed in time: read the signature, never send again. */
  state: 'CONFIRMED' | 'PENDING';
  filled: Readonly<{ tokensRaw: string; pairRaw: string }> | null;
  /** The quote the wallet signed on: its fee is the fee paid. */
  feeRaw: string;
  receiptHash: string | null;
  network: Network;
  /** Where it traded: the curve, or the pool after the move to the DEX — the quote's own venue. */
  venue: 'curve' | 'pool';
  /** The coin's page through the person's own referral code, for sharing; null when the engine could not make it. */
  shareLink: string | null;
}>;

export type TradeFailure = Readonly<{ code: string; stage: 'before' | 'send'; message: string }>;

export type TradePhase =
  | Readonly<{ step: 'build' }>
  | Readonly<{ step: 'sign'; wallet: string; again: boolean; minimumOutRaw: string }>
  | Readonly<{ step: 'send' }>
  | Readonly<{ step: 'done'; done: TradeDone }>
  | Readonly<{ step: 'failed'; failure: TradeFailure }>;

export const TRADE_CLOSED = 'CITY_TRADE_CLOSED';
export const BUILD_UNEXPECTED = 'CITY_BUILD_UNEXPECTED';
export const WALLET_REFUSED = 'WALLET_REFUSED';
export const BUILD_AGED = 'LAUNCH_BUILD_EXPIRED';

/**
 * Whether a build is the trade the person chose: this network, this side, no more than this amount in — a curve near
 * its exit may take less and leave the rest — and a least-received the chain will hold it to.
 */
export function buildMatches(built: LaunchTradeBuildResponse, order: TradeOrder, network: Network): boolean {
  if (built.network !== network) return false;
  const { quote } = built;
  if (quote.side !== order.side || quote.slippageBps !== order.slippageBps) return false;
  const spent = BigInt(quote.amountInRaw);
  if (spent <= 0n || spent > BigInt(order.amountRaw)) return false;
  return BigInt(quote.minimumOutRaw) > 0n && BigInt(quote.minimumOutRaw) <= BigInt(quote.amountOutRaw);
}

export async function runLaunchTrade(args: Readonly<{
  engine: LaunchTradeEngine;
  signer: Signer;
  order: TradeOrder;
  network: Network;
  /** Whether trading is open here: the city's Launch gate, or the development stand-in. */
  open: boolean;
  onPhase: (phase: TradePhase) => void;
  now?: () => number;
}>): Promise<TradePhase> {
  const { engine, signer, order, network, onPhase } = args;
  const fail = (code: string, message = '', stage: 'before' | 'send' = 'before'): TradePhase => {
    const phase: TradePhase = { step: 'failed', failure: { code, stage, message } };
    onPhase(phase);
    return phase;
  };
  if (!args.open) return fail(TRADE_CLOSED);

  let again = false;
  const fresh = await signFreshBytes<LaunchTradeBuildResponse, readonly string[], Extract<Answer<LaunchTradeBuildResponse>, { ok: false }>>({
    build: async () => {
      onPhase({ step: 'build' });
      const built = await engine.build(order.token, { wallet: signer.address, side: order.side, amountRaw: order.amountRaw, slippageBps: order.slippageBps });
      if (!built.ok) return built;
      /* Bytes for another network, side or amount are not this trade, and are never put before the wallet. */
      if (!buildMatches(built.data, order, network)) return { ok: false, code: BUILD_UNEXPECTED, message: 'The engine built another trade.' };
      return built;
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      onPhase({ step: 'sign', wallet: signer.wallet, again, minimumOutRaw: built.quote.minimumOutRaw });
      const answer = await signer.sign([built.unsignedWireBase64], built.network);
      return answer.ok ? { ok: true, value: answer.signed } : answer;
    },
    onRebuild: (why) => {
      again = why === 'late';
    },
    now: args.now,
  });
  if (!fresh.ok) {
    if (fresh.stage === 'build') return fail(fresh.failure.code, fresh.failure.message);
    if (fresh.stage === 'sign') return fail(WALLET_REFUSED, fresh.reason);
    return fail(BUILD_AGED);
  }
  const signed = fresh.signed[0];
  if (fresh.signed.length !== 1 || !signed) return fail(WALLET_REFUSED, 'The wallet returned another number of signed transactions.');

  onPhase({ step: 'send' });
  const sent = await engine.submit(order.token, { buildId: fresh.built.buildId, wallet: signer.address, signedWireBase64: signed });
  if (!sent.ok) return fail(sent.code, sent.message, 'send');
  const done: TradePhase = {
    step: 'done',
    done: {
      side: order.side,
      signature: sent.data.signature,
      state: sent.data.state,
      filled: sent.data.filled,
      feeRaw: fresh.built.quote.fee.totalRaw,
      receiptHash: sent.data.receiptHash ?? null,
      network,
      venue: fresh.built.quote.venue,
      shareLink: sent.data.shareLink ?? null,
    },
  };
  onPhase(done);
  return done;
}

/**
 * The trade's receipt, asked a few times while the chain settles it: `DONE` with the issuer-signed receipt, `FAILED`
 * when nothing moved, `SENT` while the chain has not answered — never read as a failure.
 */
export async function awaitReceipt(args: Readonly<{
  engine: LaunchTradeEngine;
  token: string;
  wallet: string;
  signature: string;
  tries?: number;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}>): Promise<LaunchTradeReceiptResponse | null> {
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: LaunchTradeReceiptResponse | null = null;
  for (let attempt = 0; attempt < (args.tries ?? 6); attempt += 1) {
    const answer = await args.engine.receipt(args.token, { wallet: args.wallet, signature: args.signature });
    if (answer.ok) {
      last = answer.data;
      if (answer.data.state !== 'SENT') return answer.data;
    }
    await sleep(args.waitMs ?? 2_500);
  }
  return last;
}
