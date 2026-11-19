'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { lamportsSol } from '@/city/lib/bots/format';
import { composeLadder, LADDER_NET, useLadder, viewOf, type LadderNoteKind, type LadderPoolInfo, type LiveLadder } from '@/city/lib/bots/ladder';
import { finish, finishPlan, placeDraft, readLive, takeBack, viewElsewhere, type Who } from '@/city/lib/bots/ladder-actions';
import { saysNo } from '@/city/lib/bots/note-hold';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { SOL } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import type { LadderIssue } from '@/lib/bots/ladder/plan';
import type { LiveState } from '@/lib/bots/ladder/orders';
import { openPanel } from '@/terminal/shell/frame';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { WALLET } from '@/terminal/shell/words';
import { useOffHoursRisk } from '@/terminal/stocks/useStockPoolFacts';
import { Action, AmountField, Cell, Chip, CoinLogo, Figure, Kick, Panel, Quiet, Segment, Shares, Table, TableHead, TableRow, Tile, Title, amountOf, priceText, usdText } from '@/terminal/ui';
import { BotHead, CoinAmount, CoinCard, HowInfo, MinePanel, Note, coinOf, useTowers, type PickedCoin } from './parts';
import type { BotParts } from './Paper';
import { LADDER_STEP_CHOICES, ladderDraft, ladderRows, ladderStart, typedNumber, type LadderSide } from './rows';
import { BOTS } from './words';
import b from './bots.module.css';

type W = (typeof BOTS)['en'];

/** The wallet's door, where this width keeps it: a phone's sections sheet, a desk's header. */
function connect(): void {
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/** The person's wallet as the ladder needs it: its name and the address it signs with. */
function useWho(): Who | null {
  const connection = useWallet((st) => st.connection);
  return useMemo(() => (connection ? { wallet: connection.wallet, owner: connection.address } : null), [connection]);
}

const pctText = (value: number, lang: Lang) => digits(String(value), lang);

function issueWord(w: W, issue: LadderIssue): string {
  return { amount: w.issueAmount, steps: w.issueSteps, percent: w.issuePercent, too_many_bins: w.issueBins, step_too_small: w.issueStep, too_many_transactions: w.issueTx }[issue];
}

function noteWord(w: W, kind: LadderNoteKind): string {
  return {
    placed: w.notePlaced,
    cancelled: w.noteCancelled,
    partly: w.notePartly,
    costsChanged: w.noteCostsChanged,
    walletNo: w.noteWalletNo,
    refused: w.noteRefused,
    unreachable: w.noteUnreachable,
    overCap: w.noteOverCap,
    checking: w.noteChecking,
    rest: w.noteRest,
    elsewhere: w.elsewhere,
  }[kind];
}

function stateWord(w: W, state: LiveState): string {
  return { placing: w.statePlacing, failed: w.stateFailed, incomplete: w.stateIncomplete, working: w.stateWorking, filled: w.stateFilled, due: w.stateDue, closed: w.stateClosed }[state];
}

/** The coin's pool on the ladder's network, read once a minute while the screen is open; null — none, or not taking orders. */
function usePool(mint: string | null): Readonly<{ pool: LadderPoolInfo | null; read: 'loading' | 'none' | 'off' | 'ready' }> {
  const status = useLadder((st) => (mint ? st.status[mint] : undefined));
  useEffect(() => {
    if (!LADDER_NET || !mint) return;
    void useLadder.getState().loadStatus(mint);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useLadder.getState().loadStatus(mint);
    }, 60_000);
    return () => clearInterval(timer);
  }, [mint]);
  if (!status || status === 'loading') return { pool: null, read: 'loading' };
  if (status === 'none' || !status.pool) return { pool: null, read: 'none' };
  if (!status.pool.takesLimitOrders) return { pool: null, read: 'off' };
  return { pool: status.pool, read: 'ready' };
}

/** The line before the signature, broken only between its parts: real or test money first, then what it costs. */
function CostLine({ text }: { text: string }) {
  return (
    <span className={b.line} data-bot-cost="">
      {text.split(' · ').map((part, at) => (
        <Fragment key={part}>
          {at ? ' · ' : null}
          <span className={b.part}>{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

const COLUMNS = 'minmax(200px, 1.5fr) minmax(150px, 1.1fr) minmax(120px, 0.9fr) minmax(220px, auto)';

/**
 * «Order ladder» (decision 109, p. 3; the engine as it is — `lib/bots/ladder`, the city's
 * `city/lib/bots/ladder*`): buy lower or sell higher at several prices of a coin's Meteora pool, every order placed
 * with one signature in the person's own wallet. The form: the side, the amount and the coin, how many prices and how
 * far from the market; before the signature one line of what it costs, real money or test money first. Beside it, the
 * ladder itself — each price, the market's price above them. Under it, the wallet's ladders, each taken back on its
 * own. Shown where the deployment names the ladder's network; the engine answers there or says no.
 */
export function LadderBot({ lay }: { lay: (parts: BotParts) => ReactNode }) {
  const w = useWords(BOTS);
  const wallet = useWords(WALLET);
  const lang = useLang();
  const towers = useTowers();
  const who = useWho();

  const [coin, setCoin] = useState<PickedCoin | null>(null);
  const sol = towers.get(SOL.mint);
  const shown = coin ?? (sol ? coinOf(sol) : null);
  const [side, setSide] = useState<LadderSide>('buy');
  const [amount, setAmount] = useState('100');
  const [steps, setSteps] = useState(5);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  // A side's own distances from the market, the city's for a day's move: set again when the side changes.
  useEffect(() => {
    const start = ladderStart(side, null);
    setSteps(start.steps);
    setFirst(pctText(start.firstPct, lang));
    setLast(pctText(start.lastPct, lang));
    // The language does not set the fields again under what the person wrote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  const { pool, read } = usePool(shown?.mint ?? null);
  /* A stock's coin while its exchange is shut: one line before the signature. */
  const risk = useOffHoursRisk(shown?.mint ?? null);
  const solUsd = sol && sol.price > 0 ? sol.price : null;
  const busy = useLadder((st) => st.busy);
  const note = useLadder((st) => st.note);
  const shownCosts = useLadder((st) => st.shownCosts);
  const elsewhere = useLadder((st) => (pool && st.elsewhere?.pool === pool.facts.pool ? st.elsewhere : null));

  const amountUsd = typedNumber(amount);
  const firstPct = typedNumber(first);
  const lastPct = typedNumber(last);
  const draft = useMemo(
    () => (shown && pool ? ladderDraft({ mint: shown.mint, symbol: shown.symbol }, { side, amountUsd: amountUsd ?? 0, steps, firstPct: firstPct ?? 0, lastPct: lastPct ?? 0 }, pool.activePrice) : null),
    [shown, pool, side, amountUsd, steps, firstPct, lastPct],
  );
  const composed = useMemo(() => (draft && pool ? composeLadder(draft, pool, solUsd) : null), [draft, pool, solUsd]);

  // A changed ladder is a new line: the server's earlier reading no longer stands for it, nor does a «no» said to it.
  useEffect(() => {
    const st = useLadder.getState();
    st.setShownCosts(null);
    if (st.note && !st.note.bot && saysNo(st.note.kind)) st.say(null);
  }, [draft]);

  const costs = shownCosts ?? composed?.costs ?? null;
  const cap = typeof pool?.maxUsd === 'number' ? pool.maxUsd : null;
  const issue =
    read === 'none'
      ? w.ladderNoPool
      : read === 'off'
        ? w.ladderOff
        : !composed
          ? null
          : amountUsd === null || firstPct === null || lastPct === null
            ? w.issueAmount
            : composed.issues.length
              ? issueWord(w, composed.issues[0]!)
              : composed.overCap && cap !== null
                ? w.overCap(usdText(cap, lang))
                : null;
  const said = elsewhere ? w.elsewhere : note && !note.bot && note.kind !== 'elsewhere' ? noteWord(w, note.kind) : null;
  const saidWarn = Boolean(elsewhere) || Boolean(note && saysNo(note.kind));

  const place = () => {
    if (!who) return connect();
    if (!draft || !pool || issue || busy) return;
    void placeDraft(draft, pool, who, solUsd);
  };

  const netWord = LADDER_NET === 'mainnet' ? w.realSol : w.testSol;
  const symbol = shown?.symbol ?? '';
  const gets = composed && composed.prices.length ? (side === 'buy' ? w.approxCoin(amountOf(composed.receives, 4, lang), symbol) : w.approxUsd(usdText(composed.receives, lang))) : '—';

  const form = (
    <Panel tone="hi" pad="l" gap={16} label={w.ladder}>
      <BotHead id="ladder" kick={w.newBot} info={<HowInfo lines={[w.ladderHow, w.ladderSafe]} />} />
      <Segment
        label={w.sideLabel}
        value={side}
        onChange={setSide}
        items={[
          { id: 'buy', label: w.buyLower, tone: 'buy' },
          { id: 'exit', label: w.sellHigher, tone: 'sell' },
        ]}
      />
      <CoinAmount coin={shown} amount={amount} onAmount={setAmount} onCoin={setCoin} aside={cap !== null ? w.overCap(usdText(cap, lang)) : undefined} anyCoin />
      <div className={b.group}>
        <Kick>{w.stepsLabel}</Kick>
        <Shares label={w.stepsLabel} value={String(steps)} onPick={(next) => setSteps(Number(next))} options={LADDER_STEP_CHOICES.map((n) => ({ id: String(n), label: digits(String(n), lang) }))} />
      </div>
      <div className={b.twoUp}>
        <AmountField size="s" label={w.firstLabel} unit={side === 'buy' ? w.pctBelow : w.pctAbove} value={first} onChange={setFirst} />
        <AmountField size="s" label={w.lastLabel} unit={side === 'buy' ? w.pctBelow : w.pctAbove} value={last} onChange={setLast} />
      </div>
      <div className={b.twoUp}>
        <Tile label={w.putIn} value={amountUsd !== null ? usdText(amountUsd, lang) : '—'} />
        <Tile label={w.getsAll} value={gets} />
      </div>
      {costs ? <CostLine text={`${netWord} · ${w.costLine(lamportsSol(costs.networkLamports, lang), lamportsSol(costs.rentBackLamports, lang))}`} /> : <span className={b.line}>{netWord}</span>}
      {risk ? (
        <p className={b.risk} data-bot-risk="">
          {risk}
        </p>
      ) : null}
      <Note warn={Boolean(issue) || saidWarn}>{issue ?? said}</Note>
      {!who ? (
        <Action onClick={connect} data-bot-connect="">
          {wallet.connect}
        </Action>
      ) : elsewhere ? (
        <Action disabled={busy !== null} onClick={viewElsewhere} data-bot-view="">
          {w.view}
        </Action>
      ) : (
        <Action busy={busy?.kind === 'place'} disabled={!composed || Boolean(issue) || busy !== null} onClick={place} data-bot-place="">
          {busy?.kind === 'place' ? w.signing : w.place}
        </Action>
      )}
    </Panel>
  );

  const side_ = (
    <div className={b.side}>
      <CoinCard coin={shown} />
      <Panel gap={10} label={w.rungsTitle}>
        <Kick>{w.rungsTitle}</Kick>
        {composed && composed.prices.length && pool ? (
          <ol className={b.rungs} data-bot-rungs="">
            <li className={b.rung} data-now="">
              <span className={b.rungIndex} />
              <span className={b.rungPrice}>{priceText(pool.activePrice, lang)}</span>
              <span className={b.rungPct}>{w.priceNow}</span>
            </li>
            {composed.prices.map((price, at) => (
              <li key={`${at}-${price}`} className={b.rung} data-side={side}>
                <span className={b.rungIndex}>{digits(String(at + 1), lang)}</span>
                <span className={b.rungPrice}>{priceText(price, lang)}</span>
                <span className={b.rungPct}>{digits(`${price >= pool.activePrice ? '+' : '−'}${Math.abs((price / pool.activePrice - 1) * 100).toFixed(1)}%`, lang)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <span className={b.cap}>{read === 'loading' ? w.ladderReading : w.rungsEmpty}</span>
        )}
      </Panel>
    </div>
  );

  return lay({ form, side: side_, mine: <MyLadders who={who} /> });
}

/** The wallet's ladders on the network, read back from the chain every half minute while one still stands. */
function MyLadders({ who }: { who: Who | null }) {
  const w = useWords(BOTS);
  const ladders = useLadder((st) => st.ladders);
  useEffect(() => useLadder.getState().hydrate(), []);
  const rows = useMemo(() => ladderRows(ladders, who?.owner ?? null, LADDER_NET), [ladders, who]);
  const owner = who?.owner ?? null;
  const open = rows.some((ladder) => ladder.closedAt === null);
  useEffect(() => {
    if (!owner || !open) return;
    void readLive(owner);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void readLive(owner);
    }, 30_000);
    return () => clearInterval(timer);
  }, [owner, open]);
  const reads = useLadder((st) => st.reads);
  const prices = useLadder((st) => st.prices);
  const working = rows.filter((ladder) => viewOf(ladder, reads, prices).state === 'working').length;
  return (
    <MinePanel working={working} empty={!who ? w.connectToSee : rows.length ? null : w.mineEmpty}>
      <div className={b.deskOnly}>
        <Table columns={COLUMNS} minWidth={760} label={w.mine}>
          <TableHead>
            <Cell head>{w.bot}</Cell>
            <Cell head>{w.progress}</Cell>
            <Cell head>{w.state}</Cell>
            <Cell head />
          </TableHead>
          {who ? rows.map((ladder) => <LadderRow key={ladder.id} ladder={ladder} who={who} />) : null}
        </Table>
      </div>
      <div className={b.cards}>{who ? rows.map((ladder) => <LadderRow key={ladder.id} ladder={ladder} who={who} card />) : null}</div>
    </MinePanel>
  );
}

/** One placed ladder: its coin and side, how many prices filled, its state, and the steps that are the person's to take. */
function LadderRow({ ladder, who, card = false }: { ladder: LiveLadder; who: Who; card?: boolean }) {
  const w = useWords(BOTS);
  const lang = useLang();
  const reads = useLadder((st) => st.reads);
  const prices = useLadder((st) => st.prices);
  const busy = useLadder((st) => st.busy);
  const { pool } = usePool(ladder.draft.pair.mint);
  const view = viewOf(ladder, reads, prices);
  const mine = busy?.id === ladder.id;
  const finishing = view.state === 'incomplete' && pool ? finishPlan(ladder, pool) : null;
  const sideWord = ladder.draft.kind === 'exitLadder' ? w.sellHigher : w.buyLower;
  const progress = view.progress.rungs ? w.filledOf(digits(String(view.progress.filled), lang), digits(String(view.progress.rungs), lang)) : '—';
  const why = view.proposal ? (view.proposal.trigger === 'filled' ? w.allFilled : w.left) : null;
  const live = view.state !== 'closed' && view.state !== 'failed' && view.state !== 'placing';
  const coin = ladder.draft.pair;
  const steps = live ? (
    <>
      {view.proposal && view.proposal.action !== 'none' ? (
        <Quiet size="s" full={card} disabled={busy !== null} onClick={() => void takeBack(ladder, who, view.proposal?.action === 'takeBackAndRebuild' ? 'rebuild' : 'none')} data-bot-take-back="">
          {mine && busy?.kind === 'cancel' ? w.signing : view.proposal.action === 'takeBackAndRebuild' ? w.takeBackRebuild : w.takeBack}
        </Quiet>
      ) : null}
      {finishing ? (
        <Quiet size="s" full={card} disabled={busy !== null} onClick={() => pool && void finish(ladder, pool, who)} data-bot-finish="">
          {mine && busy?.kind === 'finish' ? w.signing : w.finish}
        </Quiet>
      ) : null}
      {view.holding.length && !view.proposal ? (
        <Quiet size="s" full={card} disabled={busy !== null} onClick={() => void takeBack(ladder, who)} data-bot-take-back="">
          {mine && busy?.kind === 'cancel' ? w.signing : w.takeBack}
        </Quiet>
      ) : null}
    </>
  ) : null;
  const chip = (
    <Chip tone={view.state === 'working' ? 'ok' : view.state === 'due' || view.state === 'incomplete' ? 'warn' : 'plain'} dot={view.state === 'working'}>
      {stateWord(w, view.state)}
    </Chip>
  );
  if (card) {
    return (
      <article className={b.card} aria-label={coin.symbol}>
        <div className={b.cardHead}>
          <CoinLogo src={`/api/icon/${coin.mint}`} symbol={coin.symbol} size="l" />
          <span className={b.coinWords}>
            <Title as="h3" className={b.name}>
              {coin.symbol}
            </Title>
            <span className={b.sub}>{[sideWord, why].filter(Boolean).join(' · ')}</span>
          </span>
          {chip}
        </div>
        <span className={b.figureCol}>
          <Kick>{w.progress}</Kick>
          <Figure size="s" value={progress} />
        </span>
        {steps ? <div className={b.cardEnd}>{steps}</div> : null}
      </article>
    );
  }
  return (
    <TableRow>
      <Cell className={b.who}>
        <CoinLogo src={`/api/icon/${coin.mint}`} symbol={coin.symbol} />
        <span className={b.whoWords}>
          <span className={b.name}>{coin.symbol}</span>
          <span className={b.sub}>{[sideWord, why].filter(Boolean).join(' · ')}</span>
        </span>
      </Cell>
      <Cell>{progress}</Cell>
      <Cell>{chip}</Cell>
      <Cell className={b.rowEnd}>{steps}</Cell>
    </TableRow>
  );
}
