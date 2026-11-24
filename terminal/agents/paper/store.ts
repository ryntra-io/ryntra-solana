'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { planShown, signTrade, useAutopilot } from '@/city/lib/autopilot/store';
import { useMandate, type MandateRecord } from '@/city/lib/bots/mandate';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { proofCanAct, revalidateWalletFact, walletFact } from '@/lib/account/wallet-proof-store.client';
import { planFrom } from '@/lib/mandate/plans';
import type { AgentBudget } from '@/lib/mandate/budget';
import { planText } from '@/lib/mandate/plans';
import type { PaperView } from '@/lib/mandate/paper/model';
import { issueOf, liveOpen, paperOpen, shownOf, type PaperIssue } from './model';
import { provenStart, type StartAnswerLike } from './start';

/**
 * The agent's week on paper in the browser: the key of this person's paper week (her proven wallet's own, which
 * the start answers back; kept in this browser, it reads and ends that week and signs nothing), the paper agent as the
 * route reads it, and the three taps — start, end, and «Start with money», which is the mandate's own flow (`signTrade`),
 * one signature of the very plan, coin and budget the paper traded. The paper only learns afterwards that she did;
 * nothing of it travels into the agent's book.
 *
 * The start is the proven wallet's (`lib/mandate/paper/door.server.ts`): a wallet not proven yet signs one message first
 * — Ryntra's own sign-in text, no transaction (`proveWallet`) — and only then is paper asked (`./start.ts`).
 */

/** The screen opens the paper week where the deployment says `NEXT_PUBLIC_RYNTRA_AGENT_PAPER=open`. */
export const PAPER_OPEN = paperOpen(process.env.NEXT_PUBLIC_RYNTRA_AGENT_PAPER);

const ROUTE = '/api/bots/mandate/paper';
/** Each wallet's own key, under its address: a browser that switches wallets never shows or ends another wallet's week. */
const KEY_STORE = 'ryntra.paper-week.key:';

type Fetcher = typeof fetch;

type PaperState = {
  view: PaperView | null;
  /** `prove` — the wallet is asked for the one signature before a start. */
  busy: 'start' | 'prove' | 'end' | 'live' | null;
  issue: PaperIssue | null;
  read: boolean;
};

export const usePaperWeek = create<PaperState>(() => ({ view: null, busy: null, issue: null, read: false }));

const KEY = /^[A-Za-z0-9_-]{43}$/u;

/** The connected wallet's address; null — no wallet. */
const walletNow = (): string | null => useWallet.getState().connection?.address ?? null;

/** The key of this wallet's paper week kept in this browser; null where it keeps none. */
function keyOf(wallet: string | null): string | null {
  if (!wallet) return null;
  try {
    const kept = window.localStorage.getItem(KEY_STORE + wallet);
    return kept && KEY.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

/** The proven wallet's key, as the start answered it: kept for the reads and the end. */
function keepKey(wallet: string, key: unknown): void {
  if (typeof key !== 'string' || !KEY.test(key)) return;
  try {
    window.localStorage.setItem(KEY_STORE + wallet, key);
  } catch {
    /* A browser that keeps nothing still shows the week it just started; its next start answers the same week. */
  }
}

type Answer = Readonly<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

/** A response read once: its status and its body, which the proof's check and the card may both ask. */
function buffered(response: Response): Answer {
  const body = response.json().catch(() => null);
  return { status: response.status, ok: response.ok, json: () => body };
}

async function answerOf(response: Answer): Promise<{ view: PaperView | null; key?: unknown } | { issue: PaperIssue }> {
  const body = (await response.json().catch(() => null)) as { paper?: PaperView | null; key?: unknown; error?: { code?: string } } | null;
  if (response.ok && body && 'paper' in body) return { view: body.paper ?? null, key: body.key };
  return { issue: issueOf(response.status, body?.error?.code ?? null) };
}

/** The newest read asked: an answer to an older one (another wallet's, say) is never written over it. */
let readTicket = 0;

/** The connected wallet's paper week, read again; nothing when it has none. */
export async function readPaperWeek(fetcher: Fetcher = fetch): Promise<void> {
  const ticket = ++readTicket;
  const key = keyOf(walletNow());
  if (!key) return usePaperWeek.setState({ view: null, read: true });
  try {
    const answer = await answerOf(buffered(await fetcher(ROUTE, { headers: { 'x-ryntra-paper': key }, cache: 'no-store' })));
    if (ticket !== readTicket) return;
    if ('view' in answer) usePaperWeek.setState({ view: answer.view, read: true });
    else usePaperWeek.setState({ read: true });
  } catch {
    if (ticket === readTicket) usePaperWeek.setState({ read: true });
  }
}

/**
 * «Practice first»: a paper week on the plan, the coin and the budget the card shows now, for the connected wallet once it
 * is proven — one signed message when it is not yet, no transaction. No wallet: `connect` opens the wallet's door and the
 * card says, in one line, why.
 */
export async function startPaperWeek(options: Readonly<{ connect?: () => void }> = {}, fetcher: Fetcher = fetch): Promise<void> {
  const coin = useMandate.getState().coin;
  const st = useAutopilot.getState();
  const budget = st.budget;
  if (!coin || !budget || usePaperWeek.getState().busy) return;
  const connection = useWallet.getState().connection;
  if (!connection) {
    usePaperWeek.setState({ issue: 'wallet' });
    options.connect?.();
    return;
  }
  const launch = st.launch;
  const body = JSON.stringify({
    owner: connection.address,
    coin: coin.mint,
    symbol: coin.symbol,
    plan: planText(planShown()),
    perDay: budget.perDay.toString(),
    perTrade: budget.perTrade.toString(),
    days: budget.days,
    ...(launch && launch.state === 'picked' ? { bornAt: launch.bornAt } : {}),
  });
  usePaperWeek.setState({ busy: 'start', issue: null });
  try {
    const started = await provenStart({
      proven: () => proofCanAct(walletFact(), connection.address),
      proving: () => usePaperWeek.setState({ busy: 'prove' }),
      prove: async (fresh) => {
        if (fresh) await revalidateWalletFact({ fresh: true }).catch(() => null);
        return proveWallet(connection);
      },
      post: async (): Promise<StartAnswerLike> => {
        usePaperWeek.setState({ busy: 'start' });
        return buffered(await fetcher(ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
      },
    });
    if (started.kind !== 'answer') return usePaperWeek.setState({ busy: null, issue: started.kind });
    const answer = await answerOf(started.answer as Answer);
    if ('view' in answer) keepKey(connection.address, answer.key);
    usePaperWeek.setState('view' in answer ? { view: answer.view, busy: null, issue: null, read: true } : { busy: null, issue: answer.issue });
  } catch {
    usePaperWeek.setState({ busy: null, issue: 'network' });
  }
}

/** The proven wallet's own week closed (the door asks the same proof as the start): one signed message when it lapsed. */
async function close(action: 'end' | 'live', fetcher: Fetcher): Promise<boolean> {
  const connection = useWallet.getState().connection;
  if (!connection) return false;
  const body = JSON.stringify({ owner: connection.address, action });
  try {
    const closed = await provenStart({
      proven: () => proofCanAct(walletFact(), connection.address),
      proving: () => usePaperWeek.setState({ busy: 'prove' }),
      prove: async (fresh) => {
        if (fresh) await revalidateWalletFact({ fresh: true }).catch(() => null);
        return proveWallet(connection);
      },
      post: async (): Promise<StartAnswerLike> => {
        usePaperWeek.setState({ busy: action });
        return buffered(await fetcher(ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
      },
    });
    if (closed.kind !== 'answer') {
      usePaperWeek.setState({ issue: closed.kind });
      return false;
    }
    const answer = await answerOf(closed.answer as Answer);
    if ('view' in answer) {
      usePaperWeek.setState({ view: answer.view, issue: null });
      return true;
    }
    usePaperWeek.setState({ issue: answer.issue });
  } catch {
    usePaperWeek.setState({ issue: 'network' });
  }
  return false;
}

/** «End paper»: the paper week stops; the card goes back to the bot's form. */
export async function endPaperWeek(fetcher: Fetcher = fetch): Promise<void> {
  if (usePaperWeek.getState().busy) return;
  usePaperWeek.setState({ busy: 'end' });
  await close('end', fetcher);
  usePaperWeek.setState({ busy: null });
}

/** The paper week's budget, as the mandate's signature takes it. */
export const budgetOfView = (view: PaperView): AgentBudget => ({ perDay: BigInt(view.perDayRaw), perTrade: BigInt(view.perTradeRaw), days: view.days });

/**
 * «Start with money»: the same plan, coin and budget, one signature of the budget by the mandate's own flow. The paper is
 * told only once the mandate is signed — a wallet that said no leaves the paper week exactly as it was.
 *
 * `exit` — the card showed the agent's own exit before this signature (`../Exit.tsx` `ExitLine`, where
 * `sellsOnItsOwn` says so); only then is the sale signed with the budget. Without it the agent buys and holds: she never
 * signs a sale she did not see.
 */
export async function goLiveFromPaper(who: Readonly<{ wallet: string; owner: string }>, options: Readonly<{ exit?: boolean }> = {}, fetcher: Fetcher = fetch): Promise<MandateRecord | null> {
  const view = usePaperWeek.getState().view;
  if (!view || !liveOpen(view) || usePaperWeek.getState().busy) return null;
  const plan = planFrom(view.plan);
  if (!plan) return null;
  usePaperWeek.setState({ busy: 'live' });
  try {
    /* The paper's close asks the wallet's proof; asked first, the one message comes before the money's signature rather
       than after it. A «no» here does not stand between her and the money — the close then asks once more. */
    const connection = useWallet.getState().connection;
    if (connection && !proofCanAct(walletFact(), connection.address)) {
      usePaperWeek.setState({ busy: 'prove' });
      await proveWallet(connection).catch(() => null);
      usePaperWeek.setState({ busy: 'live' });
    }
    useAutopilot.getState().setBudget(budgetOfView(view));
    useAutopilot.setState({ plan });
    useMandate.getState().setCoin({ mint: view.coin, symbol: view.symbol ?? view.coin.slice(0, 4), icon: null });
    const record = await signTrade(who, { exit: options.exit === true });
    if (record) await close('live', fetcher);
    return record;
  } finally {
    usePaperWeek.setState({ busy: null });
  }
}

/** Whether the card shows the paper week now — read once on the first paint, and every minute while it is shown. */
export function usePaperWeekShown(): boolean {
  const shown = usePaperWeek((st) => PAPER_OPEN && shownOf(st.view));
  /* The week is the connected wallet's: read again whenever it changes — the wallet reconnects after the first paint, and a
     browser that switches wallets shows the other wallet's week (or none), never the one before. */
  const wallet = useWallet((st) => st.connection?.address ?? null);
  useEffect(() => {
    if (!PAPER_OPEN) return;
    void readPaperWeek();
  }, [wallet]);
  useEffect(() => {
    if (!shown) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void readPaperWeek();
    }, 60_000);
    return () => clearInterval(timer);
  }, [shown]);
  return shown;
}
