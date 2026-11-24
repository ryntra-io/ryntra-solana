'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import type { Lang } from '@/city/lib/i18n/langs';
import { useWallet } from '@/city/lib/trade/wallet';
import { COPY_BOUND_DEFAULT, COPY_BOUNDS, COPY_DAY_DEFAULT, COPY_SHARE_DEFAULT, COPY_SHARES, COPY_TERM_DEFAULT, COPY_TERMS, copyMoneyOpen } from '@/lib/wallet-watch/copy-agent';
import { openPanel } from '@/terminal/shell/frame';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, AmountField, Cell, Chip, Figure, Kick, Panel, Quiet, QuietLink, Search, Shares, Table, TableHead, TableRow, Title, amountOf } from '@/terminal/ui';
import { RowBones, Trades } from '@/terminal/watch/parts';
import { rereadWallet, useWalletRead } from '@/terminal/watch/wallet-reads';
import { addressIn, resultShown, shareText, shortAddress, walletHref, type WalletRead } from '@/terminal/watch/watch-view';
import { BotChart } from './BotChart';
import { useCopies, type StopNote } from './copy-store';
import { chartMint, feesOf, formIssue, moneyWorking, readSpan, stuckWordOf, tradeOf, worstOf, type CopyForm, type CopyRow, type MoneyRow } from './copy-view';
import { COPY } from './copy-words';
import { BotHead, HowInfo, MinePanel, Note, SOL_COIN } from './parts';
import type { BotParts } from './Paper';
import { BOTS } from './words';
import b from './bots.module.css';
import x from './copy.module.css';


/**
 * «Start with money» opens only with the deployment's switch and the signer's rule for copying (`copyMoneyOpen`).
 * The start is wired — her review, one signature, the copy into the book.
 */
const MONEY_OPEN = copyMoneyOpen(process.env.NEXT_PUBLIC_RYNTRA_AGENT_COPY);

/** The wallet's door, where this width keeps it: a phone's sections sheet, a desk's header. */
function connect(): void {
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/** SOL with its sign, as a result reads: +1.204, −0.35. */
function solSigned(value: number, lang: Lang): string {
  const abs = Math.abs(value);
  const sign = value > 0.0005 ? '+' : value < -0.0005 ? '−' : '';
  return `${sign}${amountOf(abs, abs < 10 ? 3 : 2, lang)}`;
}

const toneOf = (value: number | null): 'up' | 'down' | undefined => (value === null ? undefined : value > 0.0005 ? 'up' : value < -0.0005 ? 'down' : undefined);

/** SOL as a line reads it, already in the language's own digits: small sums with their thousandths, larger with their hundredths. */
const solText = (value: number, lang: Lang): string => amountOf(value, value < 1 ? 3 : 2, lang);

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
const COLUMNS = 'minmax(140px, 1.3fr) minmax(108px, 0.8fr) minmax(84px, 0.7fr) minmax(104px, 0.9fr) minmax(96px, 0.9fr) minmax(96px, auto)';

/**
 * «Copy a wallet» — a bot of the section: she pastes a wallet's address,
 * sees what it does (its latest trades and its result, with the share priced beside it), picks her numbers — a day's
 * budget, a trade its share, a term, how far from the wallet's price a buy may go — and starts it on paper. The month's
 * fees stand in one line over the action; how the copy works stands behind the «i». «Start with money» — live
 * only with the switch (`NEXT_PUBLIC_RYNTRA_AGENT_COPY=on`): one signature of her budget, her worst day in one line, and in
 * «My bots» her copy with money, its «Freeze» and «Stop» (the coins that cannot come home named, with their reason).
 * Her copies with money, their «Stop» and «Take the rest» stand whatever the switch; a start that landed only in
 * part is listed as unfinished — «Finish» or «Take back».
 */
export function CopyBot({ lay }: { lay: (parts: BotParts) => ReactNode }) {
  const w = useWords(BOTS);
  const c = useWords(COPY);
  const lang = useLang();
  // The engine's own rates by kind of coin (fee policy v2), as every card writes them.
  const fee = agentFeeFigures(lang);
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const status = useCopies((st) => st.status);
  const rows = useCopies((st) => st.rows);
  const note = useCopies((st) => st.note);
  const busy = useCopies((st) => st.busy);
  const money = useCopies((st) => st.money);
  const moneyRead = useCopies((st) => st.moneyRead);
  const moneyBusy = useCopies((st) => st.moneyBusy);
  const stopNote = useCopies((st) => st.stopNote);
  useEffect(() => void useCopies.getState().follow(owner), [owner]);

  const [typed, setTyped] = useState('');
  const address = addressIn(typed);
  const entry = useWalletRead(address);
  const answer = entry?.answer ?? null;
  const read: WalletRead | null = answer?.kind === 'wallet' ? answer.read : null;
  const [form, setForm] = useState<CopyForm>({ day: String(COPY_DAY_DEFAULT), share: COPY_SHARE_DEFAULT, days: COPY_TERM_DEFAULT, bound: COPY_BOUND_DEFAULT });
  const change = (next: Partial<CopyForm>) => {
    setForm((was) => ({ ...was, ...next }));
    useCopies.getState().clearNote();
  };
  useEffect(() => useCopies.getState().clearNote(), [address]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const self = address !== null && address === owner;
  const issue = formIssue(form);
  const trade = tradeOf(form);
  const fees = feesOf(form, read, now);
  const ready = read !== null && !self && issue === null;

  // What the field says of the address: a line kept in place, so its coming never moves the action.
  const addressNote: Readonly<{ text: string | null; warn: boolean }> = !typed.trim()
    ? { text: null, warn: false }
    : !address
      ? { text: c.badAddress, warn: true }
      : self
        ? { text: c.isSelf, warn: true }
        : answer?.kind === 'coin'
          ? { text: c.isCoin, warn: true }
          : answer?.kind === 'bad'
            ? { text: c.badAddress, warn: true }
            : !read && entry?.status === 'failed'
              ? { text: c.walletUnread, warn: true }
              : !read
                ? { text: c.readingWallet, warn: false }
                : { text: null, warn: false };

  const issueWord = issue === null ? null : { zero: c.zero, tradeMin: c.tradeMin, tooLarge: c.tooLarge }[issue];
  const noteWord = note === null ? (status === 'proving' ? c.proving : null) : { started: c.started, declined: c.declined, failed: c.failed, full: c.full, money: c.money, noCoins: c.noCoins, already: c.already, partial: c.partial }[note];

  const go = () => {
    if (!connection) {
      connect();
      return;
    }
    if (!ready || !address) return;
    void useCopies.getState().start(connection, address, form);
  };

  /* The copy with money — one signature of her budget and the wallet's coins. */
  const goMoney = () => {
    if (!connection) {
      connect();
      return;
    }
    if (!ready || !address) return;
    void useCopies.getState().startMoney(connection, address, form);
  };

  const numbers = trade ? c.tradeLine(solText(trade.tradeSol, lang), digits(String(trade.perDay), lang)) : null;
  const feeLine = fees ? c.feesLine(solText(fees.sol, lang)) : c.feesLater;
  const worst = worstOf(form);

  const formPanel = (
    <Panel tone="hi" pad="l" gap={16} label={w.copy}>
      <BotHead id="copy" kick={MONEY_OPEN ? w.copyMoneyKick : w.paperKick} info={<HowInfo lines={[c.howCopy, c.howExit, c.howBound, c.howSlip, c.howCoins, c.howFees(fee.major, fee.stock, fee.trending, fee.meme), c.howPaper, MONEY_OPEN ? c.howMoneyOpen : c.howMoney, c.howWorst]} />} />
      <div className={`${b.group} ${x.address}`} data-copy-address="">
        <Kick>{c.addressLabel}</Kick>
        <Search value={typed} onChange={setTyped} placeholder={c.pasteAddress} />
        <Note warn={addressNote.warn}>{addressNote.text}</Note>
      </div>
      <AmountField label={c.dayLabel} value={form.day} onChange={(day) => change({ day })} unit="SOL" />
      <div className={b.group}>
        <Kick>{c.shareLabel}</Kick>
        <div className={b.fill}>
          <Shares label={c.shareLabel} value={String(form.share)} onPick={(id) => change({ share: Number(id) })} options={COPY_SHARES.map((one) => ({ id: String(one), label: one === 100 ? c.shareAll : `${digits(String(one), lang)}%` }))} />
        </div>
      </div>
      <div className={b.group}>
        <Kick>{c.termLabel}</Kick>
        <div className={b.fill}>
          <Shares label={c.termLabel} value={String(form.days)} onPick={(id) => change({ days: Number(id) })} options={COPY_TERMS.map((one) => ({ id: String(one), label: c.days(digits(String(one), lang)) }))} />
        </div>
      </div>
      <div className={b.group}>
        <Kick>{c.boundLabel}</Kick>
        <div className={b.fill}>
          <Shares label={c.boundLabel} value={String(form.bound)} onPick={(id) => change({ bound: Number(id) })} options={COPY_BOUNDS.map((one) => ({ id: String(one), label: `${digits(String(one), lang)}%` }))} />
        </div>
        <span className={b.line} data-copy-slip="">
          {c.slipLine}
        </span>
      </div>
      <span className={`${b.line} ${x.costs}`} data-copy-fees="">
        {numbers ? <span className={b.part}>{numbers}</span> : null}
        {numbers ? ' · ' : null}
        <span className={b.part}>{feeLine}</span>
      </span>
      <Note warn={Boolean(issueWord) || note === 'failed' || note === 'full' || note === 'declined' || note === 'noCoins' || note === 'already' || note === 'partial'}>{issueWord ?? noteWord}</Note>
      <Action disabled={Boolean(connection) && (!ready || busy || moneyBusy === 'start')} busy={busy} onClick={go} data-copy-start="">
        {connection ? c.startPaper : c.connect}
      </Action>
      <div className={x.money} data-copy-money={MONEY_OPEN ? 'open' : 'closed'}>
        {MONEY_OPEN ? (
          <Quiet size="s" disabled={Boolean(connection) && (!ready || busy || moneyBusy !== null)} aria-busy={moneyBusy === 'start'} onClick={goMoney} data-copy-start-money="">
            {c.startMoney}
          </Quiet>
        ) : (
          <>
            <Quiet size="s" disabled>
              {c.startMoney}
            </Quiet>
            <Chip>{c.coming}</Chip>
          </>
        )}
      </div>
      <span className={`${b.line} ${x.worst}`} data-copy-worst="">
        {worst !== null ? c.worstLine(solText(worst, lang)) : null}
      </span>
    </Panel>
  );

  const shown = chartMint(read);
  const chart = <BotChart coin={shown ? { mint: shown.mint, symbol: shown.symbol ?? shortAddress(shown.mint), icon: shown.icon } : SOL_COIN} label={w.copy} />;

  const side = <LeaderPanel address={address} read={read} failed={!read && entry?.status === 'failed'} now={now} />;

  /* Her copies with money stand first. Whatever the switch — her way out never waits for it. */
  const moneyRows = money;
  const working = rows.filter((row) => !row.terms?.ended).length + moneyRows.filter(moneyWorking).length;
  const any = rows.length > 0 || moneyRows.length > 0;
  const stopShown = stopNote ? <StopNoteLines note={stopNote} busy={moneyBusy !== null} onRest={connection ? () => void useCopies.getState().stopMoney(connection, stopNote.policy, stopNote.review) : undefined} /> : null;
  const mine = (
    <MinePanel
      working={working}
      empty={!owner ? c.mineConnect : status === 'proof' || status === 'proving' ? null : status === 'failed' ? c.mineUnread : status === 'ready' && !any ? (!moneyRead ? c.mineUnread : c.mineEmpty) : null}
      note={
        owner && (status === 'proof' || status === 'proving') ? (
          <div className={x.proof}>
            <span className={b.cap}>{c.mineProof}</span>
            <Quiet size="s" disabled={status === 'proving'} onClick={() => connection && void useCopies.getState().prove(connection)} data-copy-prove="">
              {c.mineShow}
            </Quiet>
          </div>
        ) : (
          stopShown
        )
      }
    >
      {status === 'reading' && !any ? <RowBones n={2} label={c.readingWallet} /> : null}
      {any ? (
        <>
          <div className={b.deskOnly}>
            <Table columns={COLUMNS} minWidth={680} label={w.mine}>
              <TableHead>
                <Cell head>{c.wallet}</Cell>
                <Cell head>{c.state}</Cell>
                <Cell head end>
                  {c.copied}
                </Cell>
                <Cell head end>
                  {c.today}
                </Cell>
                <Cell head end>
                  {c.result}
                </Cell>
                <Cell head />
              </TableHead>
              {moneyRows.map((row) => (
                <MoneyTableRow key={row.policy} row={row} />
              ))}
              {rows.map((row) => (
                <CopyTableRow key={row.leader} row={row} />
              ))}
            </Table>
          </div>
          <div className={b.cards}>
            {moneyRows.map((row) => (
              <MoneyCard key={row.policy} row={row} />
            ))}
            {rows.map((row) => (
              <CopyCard key={row.leader} row={row} />
            ))}
          </div>
        </>
      ) : null}
    </MinePanel>
  );

  return lay({ chart, form: formPanel, side, mine });
}

/** «What the wallet does»: its result with the share priced beside it, how much of it was read, and its latest trades. */
function LeaderPanel({ address, read, failed, now }: { address: string | null; read: WalletRead | null; failed: boolean; now: number }) {
  const c = useWords(COPY);
  const lang = useLang();
  const result = read ? resultShown(read.result) : null;
  const span = read ? readSpan(read, now) : null;
  const trades = useMemo(() => (read ? read.trades.slice(0, 6) : []), [read]);
  return (
    <Panel pad="l" gap={16} label={c.leaderTitle}>
      <div className={x.leaderHead}>
        <Title as="h2" className={b.mineTitle}>
          {c.leaderTitle}
        </Title>
        {address && read ? (
          <QuietLink size="s" href={walletHref(address)}>
            {shortAddress(address)}
          </QuietLink>
        ) : null}
      </div>
      {!address ? (
        <p className={x.lone}>{c.emptyLeader}</p>
      ) : read && result ? (
        <>
          <div className={b.figureCol} data-copy-leader="">
            <Kick>{c.leaderResult}</Kick>
            <Figure value={result.value === null ? '—' : solSigned(result.value, lang)} unit={result.value === null ? undefined : 'SOL'} tone={toneOf(result.value)} />
            <span className={b.cap}>
              {[result.priced !== null ? c.priced(digits(shareText(result.priced), lang)) : null, span ? c.leaderSince(digits(String(read.trades.length), lang), span.unit === 'h' ? c.hours(digits(String(span.n), lang)) : c.days(digits(String(span.n), lang))) : null].filter(Boolean).join(' · ')}
            </span>
          </div>
          {trades.length ? <Trades rows={trades} now={now} lang={lang} phone who={false} buy={false} label={c.leaderTitle} /> : <p className={x.lone}>{c.noTrades}</p>}
        </>
      ) : failed ? (
        <div className={x.proof}>
          <span className={b.cap}>{c.walletUnread}</span>
          <Quiet size="s" onClick={() => rereadWallet(address)}>
            {c.tryAgain}
          </Quiet>
        </div>
      ) : (
        <RowBones n={4} label={c.readingWallet} />
      )}
    </Panel>
  );
}

function useRowWords(row: CopyRow) {
  const c = useWords(COPY);
  const lang = useLang();
  const ended = row.terms?.ended ?? false;
  return {
    c,
    who: row.name ?? shortAddress(row.leader),
    sub: c.since(dateText(Date.parse(row.since), WHEN, lang)),
    state: ended ? c.ended : c.working,
    ended,
    copied: digits(String(row.filled), lang),
    skipped: row.missed ? c.skipped(digits(String(row.missed), lang)) : null,
    today: row.terms ? c.todayOf(solText(row.terms.todaySol, lang), solText(row.terms.perDaySol, lang)) : '—',
    result: row.resultSol === null || (row.filled === 0 && row.resultSol === 0) ? null : { text: `${solSigned(row.resultSol, lang)} SOL`, tone: toneOf(row.resultSol) },
  };
}

function CopyTableRow({ row }: { row: CopyRow }) {
  const { c, who, sub, state, ended, copied, skipped, today, result } = useRowWords(row);
  return (
    <TableRow>
      <Cell className={b.who}>
        <span className={b.whoWords}>
          <Link href={walletHref(row.leader)} className={`${b.name} ${x.whoLink}`}>
            {who}
          </Link>
          <span className={b.sub}>{sub}</span>
        </span>
      </Cell>
      <Cell>
        <Chip tone={ended ? 'plain' : 'ok'} dot={!ended}>
          {state}
        </Chip>
      </Cell>
      <Cell end className={b.resultCell}>
        <span>{copied}</span>
        {skipped ? <span className={b.cap}>{skipped}</span> : null}
      </Cell>
      <Cell end>{today}</Cell>
      <Cell end tone={result?.tone} className={b.resultCell}>
        <span>{result?.text ?? '—'}</span>
        {result ? <span className={b.cap}>{c.onPaper}</span> : null}
      </Cell>
      <Cell className={b.rowEnd}>
        <Quiet size="s" onClick={() => void useCopies.getState().stop(row.leader)} data-copy-stop="">
          {c.stop}
        </Quiet>
      </Cell>
    </TableRow>
  );
}

function CopyCard({ row }: { row: CopyRow }) {
  const { c, who, sub, state, ended, copied, skipped, result } = useRowWords(row);
  return (
    <article className={b.card} aria-label={who}>
      <div className={b.cardHead}>
        <span className={b.coinWords}>
          <Title as="h3" className={b.name}>
            {who}
          </Title>
          <span className={b.sub}>{sub}</span>
        </span>
        <Chip tone={ended ? 'plain' : 'ok'} dot={!ended}>
          {state}
        </Chip>
      </div>
      <div className={b.twoUp}>
        <span className={b.figureCol}>
          <Kick>{c.copied}</Kick>
          <Figure size="s" value={copied} />
          {skipped ? <span className={b.cap}>{skipped}</span> : null}
        </span>
        <span className={b.figureCol}>
          <Kick>{c.result}</Kick>
          <Figure size="s" value={result?.text ?? '—'} tone={result?.tone} />
        </span>
      </div>
      <div className={b.cardEnd}>
        <Quiet size="s" full onClick={() => void useCopies.getState().stop(row.leader)}>
          {c.stop}
        </Quiet>
      </div>
    </article>
  );
}


/* ---------------------------------------------------------------- her copies with money */

/**
 * What a copy with money offers, by its state: at work — «Freeze» (with the switch open) and «Stop», always;
 * stopped — «Take the rest» while anything of hers stands in her vault, after a reload too; an unfinished start — «Finish»
 * (with the switch open) and «Take back», or «Take the rest» once taking it back has begun.
 */
function useMoneyWords(row: MoneyRow) {
  const c = useWords(COPY);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const moneyBusy = useCopies((st) => st.moneyBusy);
  const stopped = row.status === 'stopped';
  const pending = row.status === 'pending';
  const copied = row.bought + row.sold;
  const stop = () => connection && void useCopies.getState().stopMoney(connection, row.policy, row.review);
  const freeze = () => connection && void useCopies.getState().freezeMoney(connection, row.policy, !row.frozen);
  const finish = () => connection && row.review && void useCopies.getState().finishMoney(connection, row.policy, row.review);
  type Act = Readonly<{ id: string; label: string; run: () => unknown }>;
  const acts: Act[] = pending
    ? row.rest
      ? [{ id: 'rest', label: c.takeRest, run: stop }]
      : [...(MONEY_OPEN ? [{ id: 'finish', label: c.finish, run: finish }] : []), { id: 'back', label: c.takeBack, run: stop }]
    : stopped
      ? row.rest
        ? [{ id: 'rest', label: c.takeRest, run: stop }]
        : []
      : [...(MONEY_OPEN ? [{ id: 'freeze', label: row.frozen ? c.resume : c.freeze, run: freeze }] : []), { id: 'stop', label: c.stop, run: stop }];
  return {
    c,
    who: shortAddress(row.leader),
    sub: `${c.withMoney} · ${c.since(dateText(Date.parse(row.since), WHEN, lang))}`,
    state: pending ? c.unfinished : stopped ? c.stopped : row.frozen ? c.frozen : row.ended ? c.ended : c.working,
    live: !stopped && !pending && !row.frozen && !row.ended,
    copied: digits(String(copied), lang),
    skipped: row.missed ? c.skipped(digits(String(row.missed), lang)) : null,
    today: c.todayOf(solText(row.todaySol, lang), solText(row.perDaySol, lang)),
    busy: moneyBusy !== null,
    acts,
    ready: Boolean(connection),
  };
}

function MoneyTableRow({ row }: { row: MoneyRow }) {
  const m = useMoneyWords(row);
  return (
    <TableRow>
      <Cell className={b.who}>
        <span className={b.whoWords}>
          <Link href={walletHref(row.leader)} className={`${b.name} ${x.whoLink}`}>
            {m.who}
          </Link>
          <span className={b.sub}>{m.sub}</span>
        </span>
      </Cell>
      <Cell>
        <Chip tone={m.live ? 'ok' : 'plain'} dot={m.live}>
          {m.state}
        </Chip>
      </Cell>
      <Cell end className={b.resultCell}>
        <span>{m.copied}</span>
        {m.skipped ? <span className={b.cap}>{m.skipped}</span> : null}
      </Cell>
      <Cell end>{m.today}</Cell>
      <Cell end>—</Cell>
      <Cell className={b.rowEnd}>
        {m.acts.map((act) => (
          <Quiet key={act.id} size="s" disabled={!m.ready || m.busy} onClick={act.run} data-copy-money-act={act.id}>
            {act.label}
          </Quiet>
        ))}
      </Cell>
    </TableRow>
  );
}

function MoneyCard({ row }: { row: MoneyRow }) {
  const m = useMoneyWords(row);
  return (
    <article className={b.card} aria-label={m.who}>
      <div className={b.cardHead}>
        <span className={b.coinWords}>
          <Title as="h3" className={b.name}>
            {m.who}
          </Title>
          <span className={b.sub}>{m.sub}</span>
        </span>
        <Chip tone={m.live ? 'ok' : 'plain'} dot={m.live}>
          {m.state}
        </Chip>
      </div>
      <div className={b.twoUp}>
        <span className={b.figureCol}>
          <Kick>{m.c.copied}</Kick>
          <Figure size="s" value={m.copied} />
          {m.skipped ? <span className={b.cap}>{m.skipped}</span> : null}
        </span>
        <span className={b.figureCol}>
          <Kick>{m.c.today}</Kick>
          <Figure size="s" value={m.today} />
        </span>
      </div>
      {m.acts.length ? (
        <div className={b.cardEnd}>
          {m.acts.map((act) => (
            <Quiet key={act.id} size="s" full disabled={!m.ready || m.busy} onClick={act.run} data-copy-money-act={act.id}>
              {act.label}
            </Quiet>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/** Her last stop, in a line: done, or why not; the coins it left in her vault, each named with its reason; the rest to take. */
function StopNoteLines({ note, busy, onRest }: { note: StopNote; busy: boolean; onRest?: () => void }) {
  const c = useWords(COPY);
  const lang = useLang();
  /* «your coins are back» only when no coin is named as staying, none waits for her next stop and none failed. */
  /* Something still in her vault to take (`rest`) is no «everything is back» either (the lead's review of #1989). */
  const some = note.stuck.length > 0 || note.left > 0 || note.failed > 0 || note.rest === true;
  const head = { stopped: some ? c.stopDoneSome : c.stopDone, nothing: note.stuck.length ? c.stopNothingStuck : c.stopNothing, declined: c.stopDeclined, failed: c.stopFailed }[note.kind];
  return (
    <div className={x.stuck} data-copy-stop-note={note.kind}>
      <Note warn={note.kind === 'declined' || note.kind === 'failed'}>{head}</Note>
      {note.stuck.length ? (
        <>
          <Kick>{c.stuckTitle}</Kick>
          <ul className={x.stuckList}>
            {note.stuck.map((coin) => (
              <li key={coin.mint} className={b.cap} data-copy-stuck={coin.mint}>
                {c.stuckLine(shortAddress(coin.mint), c[stuckWordOf(coin.reason)])}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {note.left > 0 || note.failed > 0 || (note.kind === 'stopped' && note.rest) ? (
        <div className={x.proof}>
          <span className={b.cap}>{note.left > 0 ? c.leftLine(digits(String(note.left), lang)) : note.failed > 0 ? c.partLine : c.restLine}</span>
          {onRest ? (
            <Quiet size="s" disabled={busy} onClick={onRest} data-copy-take-rest="">
              {c.takeRest}
            </Quiet>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
