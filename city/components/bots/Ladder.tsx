'use client';

import { useEffect, useMemo, useState } from 'react';
import { WRAPPED_SOL } from '@/lib/bots/ladder/network';
import type { LadderCosts } from '@/lib/bots/ladder/costs';
import { ladderOf, type BotDraft } from '@/city/lib/bots/draft';
import { composeLadder, LADDER_NET, useLadder, viewOf, type LadderPoolInfo, type LiveLadder } from '@/city/lib/bots/ladder';
import { finish, finishPlan, placeDraft, readLive, takeBack, type Who } from '@/city/lib/bots/ladder-actions';
import { useBots } from '@/city/lib/bots/store';
import { lamportsSol, pct, type Lang } from '@/city/lib/bots/format';
import type { Words } from '@/city/lib/bots/words';
import { useWallet } from '@/city/lib/trade/wallet';
import { KindGlyph } from './glyphs';
import { useCoinByMint, useWords } from './hooks';
import s from './bots.module.css';

/**
 * The ladder on devnet in the bots window (B5, CITY-135): the one line of costs and «Place on devnet» under a ladder's
 * settings, and the placed ladders at the top of «My bots». Shown only while the deployment's switch says `devnet`
 * (`LADDER_NET`) and the engine has a devnet pool of the coin; otherwise the window stays practice, as before.
 */

/** The coin's devnet pool, read once a minute while a ladder is open; null — none, or the switch is closed. */
export function useLadderPool(mint: string | null): LadderPoolInfo | null {
  const status = useLadder((st) => (mint ? st.status[mint] : undefined));
  useEffect(() => {
    if (LADDER_NET && mint) void useLadder.getState().loadStatus(mint);
  }, [mint]);
  return status && status !== 'none' && status !== 'loading' && status.pool && status.pool.takesLimitOrders ? status.pool : null;
}

/** The person's wallet as the ladder needs it: the wallet's name and the address it signs with. */
function useWho(): Who | null {
  const connection = useWallet((st) => st.connection);
  return connection ? { wallet: connection.wallet, owner: connection.address } : null;
}

/** SOL's price in the city, for what the costs are in dollars. */
function useSolUsd(): number | null {
  const coinBy = useCoinByMint();
  return coinBy(WRAPPED_SOL)?.price ?? null;
}

/** The one line before the signature: rent back, network, no minimum, the SOL kept in the wallet; the pool's kept rent only when there is one. */
export function LiveCostLine({ costs, w, lang }: Readonly<{ costs: LadderCosts; w: Words; lang: Lang }>) {
  return (
    <p className={s.cost} data-live="">
      <span>{w.liveCost(lamportsSol(costs.networkLamports, lang), lamportsSol(costs.rentBackLamports, lang), costs.rentKeptLamports > 0 ? lamportsSol(costs.rentKeptLamports, lang) : null, lamportsSol(costs.reserveLamports, lang))}</span>
    </p>
  );
}

/** The ladder's start on devnet: the cost line, what is wrong if anything, «Place on devnet», practice beside it. */
export function LadderStart({ draft, pool, paperIssue, canPractice, onSave, saveLabel }: Readonly<{ draft: BotDraft; pool: LadderPoolInfo; paperIssue: string | null; canPractice: boolean; onSave: () => void; saveLabel: string }>) {
  const { w, lang } = useWords();
  const who = useWho();
  const solUsd = useSolUsd();
  const busy = useLadder((st) => st.busy);
  const note = useLadder((st) => st.note);
  const shown = useLadder((st) => st.shownCosts);
  const [picking, setPicking] = useState(false);
  const composed = useMemo(() => composeLadder(draft, pool, solUsd), [draft, pool, solUsd]);
  // A changed draft is a new line: the server's earlier reading no longer stands for it.
  useEffect(() => {
    useLadder.getState().setShownCosts(null);
  }, [draft]);
  useEffect(() => {
    if (who) setPicking(false);
  }, [who]);
  if (!composed) return null;
  const costs = shown ?? composed.costs;
  const issue = paperIssue ?? (composed.issues.length ? w.ladderIssue[composed.issues[0]!] : null);
  const tap = () => {
    if (!who) {
      const { wallets, connect } = useWallet.getState();
      if (wallets.length === 1) void connect(wallets[0]!.name);
      else setPicking(true);
      return;
    }
    void placeDraft(draft, pool, who, solUsd);
  };
  return (
    <>
      {costs ? <LiveCostLine costs={costs} w={w} lang={lang} /> : null}
      {composed.verdict && !composed.verdict.advised && Number.isFinite(composed.verdict.sharePct) ? <p className={s.risk}>{w.notAdvised(pct(composed.verdict.sharePct, lang))}</p> : null}
      {issue ? <p className={s.issue}>{issue}</p> : null}
      {picking && !who ? <WalletList /> : null}
      <button type="button" className={s.primary} disabled={Boolean(issue) || busy !== null} onClick={tap} data-ladder-place="">
        {busy?.kind === 'place' ? w.placing : who ? w.place : w.connect}
      </button>
      <div className={s.twoUp}>
        <button type="button" className={s.quiet} disabled={!canPractice || busy !== null} onClick={() => useBots.getState().startPaper()}>
          {w.practiceFirst}
        </button>
        <button type="button" className={s.quiet} disabled={Boolean(paperIssue)} onClick={onSave}>
          {saveLabel}
        </button>
      </div>
      {note ? (
        <p className={s.liveNote} data-kind={note.kind} role="status">
          {w.ladderNote[note.kind]}
        </p>
      ) : null}
    </>
  );
}

/** The wallets this browser has, one tap each (the ladder's start and the agent's budget). */
export function WalletList() {
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  if (!wallets.length) return null;
  return (
    <div className={s.walletList}>
      {wallets.map((wallet) => (
        <button key={wallet.name} type="button" className={s.control} disabled={Boolean(connecting)} onClick={() => void useWallet.getState().connect(wallet.name)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {wallet.icon ? <img src={wallet.icon} alt="" width={18} height={18} /> : null}
          {wallet.name}
        </button>
      ))}
    </div>
  );
}

/** Whether a draft would be placed live: the switch is open and the draft is a ladder. */
export const placesLive = (draft: BotDraft): boolean => LADDER_NET !== null && ladderOf(draft) !== null;

/* ------------------------------------------------------------ «My bots» */

/** The connected wallet's ladders on devnet, read back every half minute while «My bots» is open. */
export function LiveLadders() {
  const { w } = useWords();
  const who = useWho();
  const ladders = useLadder((st) => st.ladders);
  useEffect(() => {
    useLadder.getState().hydrate();
  }, []);
  const mine = useMemo(() => (who ? ladders.filter((ladder) => ladder.owner === who.owner) : []), [ladders, who]);
  const owner = who?.owner ?? null;
  const open = mine.some((ladder) => ladder.closedAt === null);
  useEffect(() => {
    if (!owner || !open) return;
    void readLive(owner);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void readLive(owner);
    }, 30_000);
    return () => clearInterval(timer);
  }, [owner, open]);
  if (!LADDER_NET || !who || !mine.length) return null;
  return (
    <section className={s.section} aria-label={w.liveTitle} data-ladders="">
      <h3 className={s.kicker}>{w.liveTitle}</h3>
      <ul className={s.list}>
        {mine.map((ladder) => (
          <LiveRow key={ladder.id} ladder={ladder} who={who} />
        ))}
      </ul>
      <LiveNote />
    </section>
  );
}

function LiveNote() {
  const { w } = useWords();
  const note = useLadder((st) => st.note);
  const page = useBots((st) => st.page);
  if (!note || page.kind === 'detail') return null;
  return (
    <p className={s.liveNote} data-kind={note.kind} role="status">
      {w.ladderNote[note.kind]}
    </p>
  );
}

/** A live state in the hangar's colours. */
const TONE = { placing: 'paused', failed: 'orphaned', incomplete: 'incomplete', working: 'running', filled: 'stopped', due: 'incomplete', closed: 'stopped' } as const;

function LiveRow({ ladder, who }: Readonly<{ ladder: LiveLadder; who: Who }>) {
  const { w, lang } = useWords();
  const reads = useLadder((st) => st.reads);
  const prices = useLadder((st) => st.prices);
  const busy = useLadder((st) => st.busy);
  const pool = useLadderPool(ladder.draft.pair.mint);
  const view = viewOf(ladder, reads, prices);
  const mine = busy?.id === ladder.id;
  const finishing = view.state === 'incomplete' && pool ? finishPlan(ladder, pool) : null;
  const act = () => {
    if (view.proposal) {
      if (view.proposal.action === 'takeBackAndRebuild') return void takeBack(ladder, who, 'rebuild');
      return void takeBack(ladder, who);
    }
  };
  return (
    <li className={s.bot} data-status={TONE[view.state]} data-chain="" data-ladder={ladder.id}>
      <div className={s.botRow}>
        <span className={s.cardGlyph}>
          <KindGlyph kind={ladder.draft.kind} />
        </span>
        <span className={s.botText}>
          <span className={s.botName}>
            <b>{w.kind[ladder.draft.kind]}</b>
            <span translate="no">{ladder.draft.pair.symbol}/USDC</span>
          </span>
          <span className={s.botLine}>
            <span>{view.progress.rungs ? w.liveSteps(view.progress.filled, view.progress.rungs) : w.exit[ladder.draft.exit]}</span>
          </span>
          {view.proposal ? <span className={s.botFill}>{w.trigger[view.proposal.trigger]}</span> : null}
        </span>
        <span className={s.botRight}>
          <i className={s.status} data-status={TONE[view.state]}>
            {w.liveState[view.state]}
          </i>
          <i className={s.devnet}>{w.devnet}</i>
        </span>
      </div>
      {view.state !== 'closed' && view.state !== 'failed' && view.state !== 'placing' ? (
        <div className={s.controls}>
          {finishing ? <LiveCostLine costs={finishing.costs} w={w} lang={lang} /> : null}
          <div className={s.controlRow}>
            {view.proposal ? (
              <button type="button" className={s.strong} disabled={busy !== null} onClick={act}>
                {/* The sale after «Sell all» is B6's proposal: here the button does — and says — the taking back only. */}
                {w.proposal[view.proposal.action === 'takeBackAndSell' ? 'takeBack' : view.proposal.action]}
              </button>
            ) : null}
            {finishing ? (
              <button type="button" className={s.strong} disabled={busy !== null} onClick={() => pool && void finish(ladder, pool, who)}>
                {w.finish}
              </button>
            ) : null}
            {view.holding.length && !view.proposal ? (
              <button type="button" className={s.control} disabled={busy !== null} onClick={() => void takeBack(ladder, who)}>
                {mine && busy?.kind === 'cancel' ? w.placing : w.control.cancelOrders}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* The review shots seat a wallet's public address without any wallet (`city/lib/bots/ladder-shots.mjs`); development only. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __botsWallet: useWallet });
