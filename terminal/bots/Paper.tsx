'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { draftIssues, type BotDraft } from '@/city/lib/bots/draft';
import { useBots } from '@/city/lib/bots/store';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { SOL } from '@/city/lib/trade/tiles';
import { Action, Cell, Chip, CoinLogo, Figure, Kick, Panel, Quiet, Shares, Table, TableHead, TableRow, Title, priceText } from '@/terminal/ui';
import type { PaperBotId } from './kinds';
import { BotHead, CoinAmount, CoinCard, HowInfo, MinePanel, Note, coinOf, useTowers, type PickedCoin } from './parts';
import { PACES, paceOf, paperRows, paperStart, typedNumber, weekOnPaper, type Pace, type PaperRow } from './rows';
import { BOTS } from './words';
import b from './bots.module.css';

type W = (typeof BOTS)['en'];

export type BotParts = Readonly<{ form: ReactNode; side: ReactNode; mine: ReactNode }>;

/** Dollars with their cents, in the language's own way. */
const dollars = (value: number, lang: Lang): string => digits(`$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, lang);

/** A dollar result, signed, with its tone: a gain cut down to the cent, a loss counted up, nothing for none. */
function signedUsd(value: number, lang: Lang): Readonly<{ text: string; tone: 'up' | 'down' | undefined }> {
  const cents = value >= 0 ? Math.floor(value * 100 + 1e-9) : -Math.ceil(-value * 100 - 1e-9);
  if (cents === 0) return { text: dollars(0, lang), tone: undefined };
  return { text: `${cents > 0 ? '+' : '−'}${dollars(Math.abs(cents) / 100, lang)}`, tone: cents > 0 ? 'up' : 'down' };
}

const PACE_IDS: readonly Pace[] = ['fast', 'steady', 'slow'];

function stateWord(w: W, row: PaperRow): string {
  return { running: w.stateRunning, paused: w.statePaused, stopped: w.stateStopped, incomplete: w.stateUnfinished, orphaned: w.stateGone }[row.status];
}

/** The line under a paper bot's name: its rule in short, then when it started. */
function ruleLine(w: W, draft: BotDraft, lang: Lang): string {
  if (draft.kind === 'grid') return w.rangeLine(priceText(draft.lower, lang), priceText(draft.upper, lang), digits(String(draft.levels), lang));
  if (draft.kind === 'signal') {
    const pace = paceOf(draft);
    return pace ? w.paceLine({ fast: w.paceFast, steady: w.paceSteady, slow: w.paceSlow }[pace]) : '';
  }
  return '';
}

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
const COLUMNS = 'minmax(200px, 1.6fr) minmax(110px, 0.9fr) minmax(80px, 0.6fr) minmax(110px, 0.9fr) minmax(190px, auto)';

/**
 * A bot on paper — the Grid or Signals: the coin and the amount,
 * the rule's few fields, and one action — «Start on paper», no wallet, no signature. Beside the form, what the rule
 * would have done on the coin's last week; under it, the person's paper bots of this kind, each paused, resumed or
 * stopped on its own. The bots, their week and their runs are the city's own (`city/lib/bots/store.ts`, `sim.ts`).
 */
export function PaperBot({ id, lay }: { id: PaperBotId; lay: (parts: BotParts) => ReactNode }) {
  const w = useWords(BOTS);
  const lang = useLang();
  const towers = useTowers();
  const bots = useBots((st) => st.bots);
  const paths = useBots((st) => st.paths);
  useEffect(() => useBots.getState().hydrate(), []);

  // The coin: SOL until the person picks another (decision 108: an example names no other coin).
  const [coin, setCoin] = useState<PickedCoin | null>(null);
  const sol = towers.get(SOL.mint);
  const shown = coin ?? (sol ? coinOf(sol) : null);
  const tower = shown ? towers.get(shown.mint) : undefined;
  const price = tower && tower.price > 0 ? tower.price : null;
  useEffect(() => {
    if (shown && price) void useBots.getState().loadPath({ mint: shown.mint, symbol: shown.symbol, price });
    // The week is read again only for another coin, not on every tick of its price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.mint, price !== null]);
  const path = shown ? paths[shown.mint] : undefined;
  const weather = path?.status === 'ready' ? path.weather : null;

  const [amount, setAmount] = useState('100');
  const [pace, setPace] = useState<Pace>('steady');
  const [started, setStarted] = useState(false);

  // The rule's first draft on the coin, sized for its week.
  const start = useMemo(() => (shown && price ? paperStart(id, { mint: shown.mint, symbol: shown.symbol }, price, weather, 100) : null), [id, shown?.mint, shown?.symbol, price !== null, weather]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountUsd = typedNumber(amount);
  const draft: BotDraft | null = useMemo(() => {
    if (!start) return null;
    const sum = amountUsd ?? Number.NaN;
    if (start.kind === 'signal') return { ...start, amountUsd: sum, ...PACES[pace] };
    return { ...start, amountUsd: sum };
  }, [start, amountUsd, pace]);
  const issues = draft ? draftIssues(draft) : [];
  const issue = !draft ? null : issues.includes('amount') ? w.amountIssue : issues.includes('range') ? w.rangeIssue : null;
  const week = weekOnPaper(draft, path?.status === 'ready' ? path.bars : []);

  useEffect(() => setStarted(false), [draft]);

  const go = () => {
    if (!draft || issues.length) return;
    useBots.getState().setDraft(draft);
    if (useBots.getState().startPaper()) setStarted(true);
  };

  const mints = useMemo(() => new Set(towers.keys()), [towers]);
  const rows = useMemo(() => paperRows(bots, id, (mint) => (paths[mint]?.status === 'ready' ? paths[mint]!.bars : null), mints.size ? mints : null), [bots, id, paths, mints]);
  // Each bot's hours: its coin's week, read once a coin.
  const botMints = useMemo(() => [...new Set(rows.map((row) => row.bot.draft.pair.mint))].join(','), [rows]);
  useEffect(() => {
    for (const mint of botMints ? botMints.split(',') : []) {
      const at = towers.get(mint);
      if (at && at.price > 0) void useBots.getState().loadPath({ mint, symbol: at.symbol, price: at.price });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botMints]);

  const weekResult = week ? signedUsd(week.pnlUsd, lang) : null;
  const holdResult = week ? signedUsd(week.holdUsd, lang) : null;

  const form = (
    <Panel tone="hi" pad="l" gap={16} label={w[id]}>
      <BotHead id={id} kick={w.paperKick} info={<HowInfo lines={[w.signalsHow, w.paperHow]} />} />
      <CoinAmount coin={shown} amount={amount} onAmount={setAmount} onCoin={setCoin} />
      <div className={b.group}>
        <Kick>{w.paceLabel}</Kick>
        <Shares label={w.paceLabel} value={pace} onPick={setPace} options={PACE_IDS.map((one) => ({ id: one, label: { fast: w.paceFast, steady: w.paceSteady, slow: w.paceSlow }[one] }))} />
      </div>
      <span className={b.line}>{w.paperLine}</span>
      <Note warn={Boolean(issue)}>{issue ?? (started ? w.startedPaper : null)}</Note>
      <Action disabled={!draft || issues.length > 0} onClick={go} data-bot-start="">
        {w.startPaper}
      </Action>
    </Panel>
  );

  const side = (
    <div className={b.side}>
      <CoinCard coin={shown} />
      <Panel gap={10} label={w.weekTitle}>
        <Kick>{w.weekTitle}</Kick>
        {week && weekResult ? (
          <div className={b.figureCol} data-bot-week="">
            <Figure value={weekResult.text} tone={weekResult.tone} />
            <span className={b.cap}>
              {w.weekTrades(String(week.trades))}
              {holdResult ? ` · ${w.weekHold(holdResult.text)}` : ''}
            </span>
            <span className={b.cap}>{w.picture}</span>
          </div>
        ) : (
          <span className={b.cap}>{path?.status === 'ready' && !path.bars.length ? w.weekNone : issue ? '—' : w.reading}</span>
        )}
      </Panel>
    </div>
  );

  const working = rows.filter((row) => row.status === 'running').length;
  const mine = (
    <MinePanel working={working} empty={rows.length ? null : w.mineEmpty}>
      <div className={b.deskOnly}>
        <Table columns={COLUMNS} minWidth={760} label={w.mine}>
          <TableHead>
            <Cell head>{w.bot}</Cell>
            <Cell head>{w.state}</Cell>
            <Cell head end>
              {w.trades}
            </Cell>
            <Cell head end>
              {w.result}
            </Cell>
            <Cell head />
          </TableHead>
          {rows.map((row) => (
            <PaperTableRow key={row.key} row={row} />
          ))}
        </Table>
      </div>
      <div className={b.cards}>
        {rows.map((row) => (
          <PaperCard key={row.key} row={row} />
        ))}
      </div>
    </MinePanel>
  );

  return lay({ form, side, mine });
}

/** A paper bot's own steps: pause or resume, and stop — in this browser, nothing signed. */
function Controls({ row, full = false }: { row: PaperRow; full?: boolean }) {
  const w = useWords(BOTS);
  const id = row.bot.id;
  if (row.status === 'stopped') return null;
  return (
    <>
      {row.status === 'running' ? (
        <Quiet size="s" full={full} onClick={() => useBots.getState().pauseBot(id)} data-bot-pause="">
          {w.pause}
        </Quiet>
      ) : row.status === 'paused' ? (
        <Quiet size="s" full={full} onClick={() => useBots.getState().resumeBot(id)} data-bot-resume="">
          {w.resume}
        </Quiet>
      ) : null}
      <Quiet size="s" full={full} onClick={() => useBots.getState().stopBot(id)} data-bot-stop="">
        {w.stop}
      </Quiet>
    </>
  );
}

function useRowWords(row: PaperRow) {
  const w = useWords(BOTS);
  const lang = useLang();
  const started = row.bot.spans[0]?.[0] ?? row.bot.createdAt;
  const rule = ruleLine(w, row.bot.draft, lang);
  return {
    w,
    sub: [rule, w.since(dateText(started, WHEN, lang))].filter(Boolean).join(' · '),
    result: row.pnlUsd === null ? null : signedUsd(row.pnlUsd, lang),
    state: stateWord(w, row),
  };
}

function PaperTableRow({ row }: { row: PaperRow }) {
  const { w, sub, result, state } = useRowWords(row);
  const coin = row.bot.draft.pair;
  return (
    <TableRow>
      <Cell className={b.who}>
        <CoinLogo src={`/api/icon/${coin.mint}`} symbol={coin.symbol} />
        <span className={b.whoWords}>
          <span className={b.name}>{coin.symbol}</span>
          <span className={b.sub}>{sub}</span>
        </span>
      </Cell>
      <Cell>
        <Chip tone={row.status === 'running' ? 'ok' : 'plain'} dot={row.status === 'running'}>
          {state}
        </Chip>
      </Cell>
      <Cell end>{row.trades ?? '—'}</Cell>
      <Cell end tone={result?.tone} className={b.resultCell}>
        <span>{result?.text ?? '—'}</span>
        {result ? <span className={b.cap}>{w.onPaper}</span> : null}
      </Cell>
      <Cell className={b.rowEnd}>
        <Controls row={row} />
      </Cell>
    </TableRow>
  );
}

function PaperCard({ row }: { row: PaperRow }) {
  const { w, sub, result, state } = useRowWords(row);
  const coin = row.bot.draft.pair;
  return (
    <article className={b.card} aria-label={coin.symbol}>
      <div className={b.cardHead}>
        <CoinLogo src={`/api/icon/${coin.mint}`} symbol={coin.symbol} size="l" />
        <span className={b.coinWords}>
          <Title as="h3" className={b.name}>
            {coin.symbol}
          </Title>
          <span className={b.sub}>{sub}</span>
        </span>
        <Chip tone={row.status === 'running' ? 'ok' : 'plain'} dot={row.status === 'running'}>
          {state}
        </Chip>
      </div>
      <div className={b.twoUp}>
        <span className={b.figureCol}>
          <Kick>{w.trades}</Kick>
          <Figure size="s" value={row.trades ?? '—'} />
        </span>
        <span className={b.figureCol}>
          <Kick>{w.result}</Kick>
          <Figure size="s" value={result?.text ?? '—'} tone={result?.tone} />
        </span>
      </div>
      {row.status !== 'stopped' ? (
        <div className={b.cardEnd}>
          <Controls row={row} full />
        </div>
      ) : null}
    </article>
  );
}
