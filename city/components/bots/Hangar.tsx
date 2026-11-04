'use client';

import type { HangarBot } from '@/lib/bots/hangar/hangar';
import { sortChain } from '@/city/lib/bots/chain';
import { controlsOf, lastFill, sortBots, type BotStatus, type Control } from '@/city/lib/bots/hangar';
import { KIND_FACTS, type BotKind } from '@/city/lib/bots/kinds';
import { useBotsWindow } from '@/city/lib/bots/open';
import { useBots } from '@/city/lib/bots/store';
import { ago, amount, price, signedUsd } from '@/city/lib/bots/format';
import { Spark } from './BotChart';
import { LiveLadders } from './Ladder';
import { LADDER_NET, useLadder } from '@/city/lib/bots/ladder';
import { useWallet } from '@/city/lib/trade/wallet';
import { ChainGlyph, KindGlyph } from './glyphs';
import { RyntraReport, RyntraWhy } from './Ryntra';
import { useBotRows, useNow, useWords, type BotRow } from './hooks';
import s from './bots.module.css';

/**
 * «My bots»: the bots the connected wallet really runs, read from the engine's Hangar (read-only: closing one is the
 * person's own signature where it was placed), then the practice bots, the ones that need you first; a tap on a
 * practice bot opens its controls.
 */
export function Hangar() {
  const rows = sortBots(useBotRows());
  const chain = useBots((st) => st.chain);
  const { w } = useWords();
  const live = chain.status === 'ready' ? sortChain(chain.answer.bots) : [];
  const owner = useWallet((st) => st.connection?.address ?? null);
  const devnet = useLadder((st) => (LADDER_NET && owner ? st.ladders.filter((ladder) => ladder.owner === owner).length : 0));
  if (!rows.length && !live.length && !devnet && chain.status !== 'loading' && chain.status !== 'error') {
    return <Empty title={w.noBots} action={w.startOne} onAction={() => useBotsWindow.getState().setTab('launch')} />;
  }
  return (
    <div className={s.groups}>
      <LiveLadders />
      <ChainBots />
      {rows.length ? (
        <section className={s.section} aria-label={w.practice}>
          {chain.status !== 'idle' ? <h3 className={s.kicker}>{w.practice}</h3> : null}
          <ul className={s.list}>
            {rows.map((row) => (
              <BotItem key={row.bot.id} row={row} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The engine's bot as the hub's glyph draws it. */
const CHAIN_GLYPH: Readonly<Record<HangarBot['kind'], BotKind>> = { grid: 'grid', range_lp: 'lpRange', limit: 'buyLadder', ladder: 'buyLadder', dca: 'recurring' };

/** The engine's status in the hangar's colours: working beats, what needs the person is amber, done is quiet. */
const CHAIN_TONE: Readonly<Record<HangarBot['status'], BotStatus>> = {
  working: 'running',
  waiting: 'paused',
  partial: 'paused',
  out_of_range: 'incomplete',
  needs_you: 'incomplete',
  paused: 'paused',
  filled: 'stopped',
  closed: 'stopped',
};

/** The wallet's own bots on the chain; nothing at all while no wallet is connected or it runs none. */
function ChainBots() {
  const chain = useBots((st) => st.chain);
  const { w } = useWords();
  if (chain.status === 'idle') return null;
  if (chain.status === 'loading') {
    return (
      <section className={s.section} aria-label={w.onChain} aria-busy="true">
        <h3 className={s.kicker}>{w.onChain}</h3>
        <div className={s.weatherPending} />
      </section>
    );
  }
  if (chain.status === 'error') {
    return (
      <section className={s.section} aria-label={w.onChain}>
        <h3 className={s.kicker}>{w.onChain}</h3>
        <p className={s.hint}>{w.chainError}</p>
      </section>
    );
  }
  const bots = sortChain(chain.answer.bots);
  const loose = chain.answer.issues.length;
  if (!bots.length && !loose) return null;
  return (
    <section className={s.section} aria-label={w.onChain}>
      <h3 className={s.kicker}>{w.onChain}</h3>
      {bots.length ? <RyntraReport wallet={chain.wallet} /> : null}
      {loose ? <p className={s.issue}>{w.looseEnds(loose)}</p> : null}
      <ul className={s.list}>
        {bots.map((bot) => (
          <ChainItem key={bot.id} bot={bot} wallet={chain.wallet} />
        ))}
      </ul>
    </section>
  );
}

/** The days a comparison with holding covers, at least one. */
const daysOf = (span: Readonly<{ from: string; to: string }>): number => Math.max(1, Math.round((Date.parse(span.to) - Date.parse(span.from)) / 86_400_000) || 1);

function ChainItem({ bot, wallet }: Readonly<{ bot: HangarBot; wallet: string }>) {
  const { w, lang } = useWords();
  const now = useNow();
  const fillAt = bot.lastFill ? Date.parse(bot.lastFill.at) : NaN;
  return (
    <li className={s.bot} data-status={CHAIN_TONE[bot.status]} data-chain="">
      <div className={s.botRow}>
        <span className={s.cardGlyph}>
          <KindGlyph kind={CHAIN_GLYPH[bot.kind]} />
        </span>
        <span className={s.botText}>
          <span className={s.botName}>
            <b>{w.chainKind[bot.kind]}</b>
            <span translate="no">{bot.name}</span>
          </span>
          <span className={s.botLine}>
            {bot.vsHold ? (
              <>
                <b data-tone={bot.vsHold.usd >= 0 ? 'up' : 'down'}>{signedUsd(bot.vsHold.usd, lang)}</b>
                <span>{w.againstHold(daysOf(bot.vsHold))}</span>
              </>
            ) : bot.legs ? (
              <span>{w.legs(bot.legs.filled, bot.legs.total)}</span>
            ) : (
              <span>{w.filler[bot.filler]}</span>
            )}
          </span>
          {bot.lastFill && Number.isFinite(fillAt) ? (
            <span className={s.botFill}>
              {ago(now - fillAt, lang)} ·{' '}
              <a href={bot.lastFill.receipt} target="_blank" rel="noopener noreferrer" className={s.receiptLink}>
                {w.receipt}
              </a>
            </span>
          ) : null}
        </span>
        <span className={s.botRight}>
          <i className={s.status} data-status={CHAIN_TONE[bot.status]}>
            {w.chainStatus[bot.status]}
          </i>
          {bot.noRyntraSignature && bot.filler !== 'you' ? (
            <i className={s.standalone}>
              <ChainGlyph />
              {w.standalone}
            </i>
          ) : null}
        </span>
      </div>
      <RyntraWhy wallet={wallet} bot={bot} />
    </li>
  );
}

function BotItem({ row }: Readonly<{ row: BotRow }>) {
  const { bot, status, run } = row;
  const { w, lang } = useWords();
  const now = useNow();
  const focus = useBots((st) => st.focus);
  const open = focus === bot.id;
  const fill = lastFill(run);
  const strategyGone = bot.strategyId !== null && !useBots.getState().strategies.some((x) => x.id === bot.strategyId);
  const act = (id: Control) => {
    const st = useBots.getState();
    if (id === 'pause') st.pauseBot(bot.id);
    else if (id === 'resume') st.resumeBot(bot.id);
    else if (id === 'stop') st.stopBot(bot.id);
    else if (id === 'finish') st.finishBot(bot.id);
  };
  const controls = controlsOf(bot, status);
  return (
    <li className={s.bot} data-status={status} data-open={open ? '' : undefined}>
      <button type="button" className={s.botRow} onClick={() => useBots.getState().focusBot(open ? null : bot.id)} aria-expanded={open}>
        <span className={s.cardGlyph}>
          <KindGlyph kind={bot.draft.kind} />
        </span>
        <span className={s.botText}>
          <span className={s.botName}>
            <b>{w.kind[bot.draft.kind]}</b>
            <span translate="no">{bot.draft.pair.symbol}/USDC</span>
          </span>
          <span className={s.botLine}>
            {run ? (
              <>
                <b data-tone={run.pnlUsd >= 0 ? 'up' : 'down'}>{signedUsd(run.pnlUsd, lang)}</b>
                <span>{w.vsHold(signedUsd(run.holdPnlUsd, lang))}</span>
              </>
            ) : status === 'running' ? (
              <span>{w.waitingHour}</span>
            ) : null}
          </span>
          <span className={s.botFill}>
            {status === 'orphaned'
              ? strategyGone
                ? w.orphanStrategy
                : w.orphanCoin
              : fill
                ? w.lastFill(fill.side, amount(fill.qty, lang), bot.draft.pair.symbol, price(fill.price, lang), ago(now - fill.t, lang))
                : status === 'incomplete'
                  ? ''
                  : w.noFills}
          </span>
        </span>
        <span className={s.botRight}>
          <i className={s.status} data-status={status}>
            {w.status[status]}
          </i>
          <Spark run={run} />
          {KIND_FACTS[bot.draft.kind].standalone && status !== 'incomplete' ? (
            <i className={s.standalone}>
              <ChainGlyph />
              {w.standalone}
            </i>
          ) : null}
        </span>
      </button>
      {open && controls.length ? (
        <div className={s.controls}>
          <div className={s.controlRow}>
            {controls.map((c) => (
              <button key={c.id} type="button" className={c.id === 'finish' ? s.strong : s.control} disabled={!c.enabled} onClick={() => act(c.id)}>
                {w.control[c.id]}
              </button>
            ))}
          </div>
          {controls.some((c) => !c.enabled) ? <p className={s.hint}>{w.paperLine}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function Empty({ title, action, onAction }: Readonly<{ title: string; action?: string; onAction?: () => void }>) {
  return (
    <div className={s.empty}>
      <div className={s.emptyArt} aria-hidden="true" />
      <b>{title}</b>
      {action && onAction ? (
        <button type="button" className={s.primary} onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
