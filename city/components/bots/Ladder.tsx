'use client';

import { useEffect, useMemo, useState } from 'react';
import { WRAPPED_SOL } from '@/lib/bots/ladder/network';
import type { LadderCosts } from '@/lib/bots/ladder/costs';
import { ladderOf, type BotDraft } from '@/city/lib/bots/draft';
import { composeLadder, LADDER_NET, useLadder, viewOf, type LadderPoolInfo, type LiveLadder } from '@/city/lib/bots/ladder';
import { saysNo } from '@/city/lib/bots/note-hold';
import { finish, finishPlan, placeDraft, readLive, takeBack, viewElsewhere, type Who } from '@/city/lib/bots/ladder-actions';
import { useBots } from '@/city/lib/bots/store';
import { amount, lamportsSol, pct, price, usd, type Lang } from '@/city/lib/bots/format';
import { ladderWords, type LadderWords } from '@/city/lib/bots/ladder-words';
import type { Words } from '@/city/lib/bots/words';
import { useWallet } from '@/city/lib/trade/wallet';
import { KindGlyph } from './glyphs';
import { NoteLine } from './NoteLine';
import { useCoinByMint, useWords } from './hooks';
import s from './bots.module.css';
import l from './ladder.module.css';

/**
 * The ladder in the bots window (B5, CITY-135; mainnet CITY-219): under a ladder's settings the sum, what every step
 * gives and each step's price, the one line of costs and «Place»; the placed ladders at the top of «My bots». Shown
 * only on the network the deployment names (`LADDER_NET`) while the engine has a pool of the coin there; otherwise
 * the window stays practice, as before.
 */

/** The ladder's words on the window's network. */
function useLadderWords(): Readonly<{ w: Words; lw: LadderWords; lang: Lang }> {
  const { w, lang } = useWords();
  return { w, lang, lw: ladderWords(lang, LADDER_NET ?? 'devnet', w) };
}

/** The network's chip on the ladder's sheet: «Devnet» on devnet; «Real SOL» on mainnet, where the money is real (CITY-233). */
export function LadderNetChip() {
  const { lw } = useLadderWords();
  const network = LADDER_NET ?? 'devnet';
  return (
    <i className={network === 'mainnet' ? l.realChip : s.devnet} data-net={network}>
      {lw.chip ?? lw.net}
    </i>
  );
}

/** The order accounts this browser's ladders hold: «My bots» shows them once, as ladders, not again as chain orders. */
export function useLadderOrderKeys(): ReadonlySet<string> {
  const ladders = useLadder((st) => st.ladders);
  return useMemo(() => new Set(ladders.flatMap((ladder) => ladder.legs.map((leg) => leg.limitOrder))), [ladders]);
}

/** The coin's pool on the window's network, read once a minute while a ladder is open; null — none, or closed. */
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

/**
 * The one line before the signature: the network first — real SOL or test SOL (CITY-233) — then the fee, the network's
 * fees, rent back, the SOL kept in the wallet; the pool's kept rent only when there is one.
 */
export function LiveCostLine({ costs, lw, lang }: Readonly<{ costs: LadderCosts; lw: LadderWords; lang: Lang }>) {
  return (
    <p className={s.cost} data-live="">
      <span>
        <b className={l.net} data-net={LADDER_NET ?? 'devnet'}>
          {lw.net}
        </b>
        {' · '}
        {lw.cost(lamportsSol(costs.networkLamports, lang), lamportsSol(costs.rentBackLamports, lang), costs.rentKeptLamports > 0 ? lamportsSol(costs.rentKeptLamports, lang) : null, lamportsSol(costs.reserveLamports, lang))}
      </span>
    </p>
  );
}

/** Before the signature: the sum, what every step gives if all fill, and each step's own price. */
export function LadderSummary({ composed, symbol, side, lw, lang }: Readonly<{ composed: NonNullable<ReturnType<typeof composeLadder>>; symbol: string; side: 'buy' | 'exit'; lw: LadderWords; lang: Lang }>) {
  if (!composed.prices.length) return null;
  const gets = side === 'buy' ? `≈ ${amount(composed.receives, lang)} ${symbol}` : `≈ ${usd(composed.receives, lang)}`;
  return (
    <section className={l.summary} aria-label={lw.stepsLabel(composed.prices.length)} data-ladder-summary="">
      <div className={l.figures}>
        <div className={l.figure}>
          <span>{lw.putIn}</span>
          <b>{usd(composed.amountUsd, lang)}</b>
        </div>
        <i className={l.arrow} aria-hidden="true" />
        <div className={l.figure}>
          <span>{lw.getsAll}</span>
          <b translate="no">{gets}</b>
        </div>
      </div>
      <ol className={l.steps} aria-label={lw.stepsLabel(composed.prices.length)}>
        {composed.prices.map((value, index) => (
          <li key={`${index}-${value}`}>{price(value, lang)}</li>
        ))}
      </ol>
    </section>
  );
}

/** The ladder's start: the sum and the steps, the cost line, what is wrong if anything, «Place», practice beside it. */
export function LadderStart({ draft, pool, paperIssue, canPractice, onSave, saveLabel }: Readonly<{ draft: BotDraft; pool: LadderPoolInfo; paperIssue: string | null; canPractice: boolean; onSave: () => void; saveLabel: string }>) {
  const { w, lw, lang } = useLadderWords();
  const who = useWho();
  const solUsd = useSolUsd();
  const busy = useLadder((st) => st.busy);
  const note = useLadder((st) => st.note);
  const shown = useLadder((st) => st.shownCosts);
  /* A ladder of this wallet's from another device stands in this pool: «View» in place of a second one (CITY-233). */
  const elsewhere = useLadder((st) => (st.elsewhere?.pool === pool.facts.pool ? st.elsewhere : null));
  const [picking, setPicking] = useState(false);
  const composed = useMemo(() => composeLadder(draft, pool, solUsd), [draft, pool, solUsd]);
  // A changed draft is a new line: the server's earlier reading no longer stands for it — nor does a «no» said to the
  // ladder as it was (it stays half a minute now, CITY-237, and must not sit under different settings).
  useEffect(() => {
    const st = useLadder.getState();
    st.setShownCosts(null);
    if (st.note && !st.note.bot && saysNo(st.note.kind)) st.say(null);
  }, [draft]);
  useEffect(() => {
    if (who) setPicking(false);
  }, [who]);
  if (!composed) return null;
  const costs = shown ?? composed.costs;
  const cap = typeof pool.maxUsd === 'number' ? pool.maxUsd : null;
  const issue = paperIssue ?? (composed.issues.length ? w.ladderIssue[composed.issues[0]!] : composed.overCap && cap !== null ? lw.overCap(usd(cap, lang)) : null);
  const side = ladderOf(draft)?.side ?? 'buy';
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
      <LadderSummary composed={composed} symbol={draft.pair.symbol} side={side} lw={lw} lang={lang} />
      {costs ? <LiveCostLine costs={costs} lw={lw} lang={lang} /> : null}
      {composed.verdict && !composed.verdict.advised && Number.isFinite(composed.verdict.sharePct) ? <p className={s.risk}>{w.notAdvised(pct(composed.verdict.sharePct, lang))}</p> : null}
      {elsewhere ? (
        <p className={s.liveNote} data-kind="elsewhere" role="status">
          {lw.note.elsewhere}
        </p>
      ) : issue ? (
        <p className={s.issue}>{issue}</p>
      ) : null}
      {picking && !who ? <WalletList /> : null}
      {elsewhere ? (
        <button type="button" className={s.primary} disabled={busy !== null} onClick={viewElsewhere} data-ladder-view="">
          {lw.view}
        </button>
      ) : (
        <button type="button" className={s.primary} disabled={Boolean(issue) || busy !== null} onClick={tap} data-ladder-place="">
          {busy?.kind === 'place' ? w.placing : who ? lw.place : w.connect}
        </button>
      )}
      {/* The action's answer stands right under it and comes into view when said (CITY-237): under the two quiet
          buttons it landed below the edge of a phone's half-screen window. «A ladder here already» stands above its
          «View» while it holds; not said twice here. */}
      {note && !note.bot && note.kind !== 'elsewhere' ? (
        <NoteLine kind={note.kind} at={note.at}>
          {lw.note[note.kind]}
        </NoteLine>
      ) : null}
      <div className={s.twoUp}>
        <button type="button" className={s.quiet} disabled={!canPractice || busy !== null} onClick={() => useBots.getState().startPaper()}>
          {w.practiceFirst}
        </button>
        <button type="button" className={s.quiet} disabled={Boolean(paperIssue)} onClick={onSave}>
          {saveLabel}
        </button>
      </div>
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

/** The connected wallet's ladders on the window's network, read back every half minute while «My bots» is open. */
export function LiveLadders() {
  const { lw } = useLadderWords();
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
    <section className={s.section} aria-label={lw.liveTitle} data-ladders="">
      <h3 className={s.kicker}>{lw.liveTitle}</h3>
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
  const { lw } = useLadderWords();
  const note = useLadder((st) => st.note);
  const page = useBots((st) => st.page);
  /* A chain bot's answer is said under that bot (`Hangar.tsx`). */
  if (!note || note.bot || page.kind === 'detail') return null;
  return (
    <NoteLine kind={note.kind} at={note.at}>
      {lw.note[note.kind]}
    </NoteLine>
  );
}

/** A live state in the hangar's colours. */
const TONE = { placing: 'paused', failed: 'orphaned', incomplete: 'incomplete', working: 'running', filled: 'stopped', due: 'incomplete', closed: 'stopped' } as const;

function LiveRow({ ladder, who }: Readonly<{ ladder: LiveLadder; who: Who }>) {
  const { w, lw, lang } = useLadderWords();
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
          {lw.chip ? <i className={s.devnet}>{lw.chip}</i> : null}
        </span>
      </div>
      {view.state !== 'closed' && view.state !== 'failed' && view.state !== 'placing' ? (
        <div className={s.controls}>
          {finishing ? <LiveCostLine costs={finishing.costs} lw={lw} lang={lang} /> : null}
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
