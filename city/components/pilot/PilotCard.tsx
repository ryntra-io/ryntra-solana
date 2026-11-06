'use client';

import { useEffect, useId, useState } from 'react';
import { MANDATE_PRESETS, presetLimits, useMandate } from '@/city/lib/bots/mandate';
import { sol } from '@/city/lib/bots/format';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { solText } from '@/city/lib/autopilot/plan';
import { PILOT } from '@/city/lib/pilot/words';
import { walletShort } from '@/city/lib/pilot/wallet-check';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { goLive, PILOT_NET, readPilot, startPaper, stopPilot, usePilot } from '@/city/lib/pilot/store';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { legsOf, legsUsd, PILOT_PARTS, type PilotPart, type PilotPlanData } from '@/lib/pilot/plan';
import { WalletLine, WalletPicker } from '../trade/WalletParts';
import { AgentGlyph, ChevronGlyph } from '../instruct/glyphs';
import i from '../instruct/instruct.module.css';
import a from '../autopilot/autopilot.module.css';
import s from './pilot.module.css';

type W = ReturnType<typeof useWords<(typeof PILOT)['en']>>;
type Lang = 'en' | 'uk';

const PART_NAME = (w: W, part: PilotPart) => ({ trade: w.part_trade, save: w.part_save, pool: w.part_pool, reserve: w.part_reserve })[part];

/** Dollars as the card writes them: «$1,250», «$4.20», with a sign when asked. */
export function usdText(value: number, lang: Lang, signed = false): string {
  const abs = Math.abs(value);
  const body = abs >= 1000 ? Math.round(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : abs.toFixed(2);
  const sign = signed ? (value > 0.004 ? '+' : value < -0.004 ? '−' : '') : value < 0 ? '−' : '';
  return digits(`${sign}$${body}`, lang);
}

const pctText = (bps: number, lang: Lang) => digits(`${Math.round(bps / 100)}%`, lang);
const toneOf = (value: number | null) => (value === null ? undefined : value > 0.004 ? 'up' : value < -0.004 ? 'down' : undefined);

/** The parts as one bar and four rows: a name, a share and what it holds. */
function Split({ shares, plan, solUsd }: { shares: Readonly<Record<PilotPart, number>>; plan: PilotPlanData; solUsd: number | null }) {
  const w = useWords(PILOT);
  const lang = useLang();
  const values = solUsd !== null ? legsUsd(legsOf(plan), solUsd) : null;
  const shown = PILOT_PARTS.filter((part) => shares[part] > 0);
  return (
    <div className={s.split} data-pilot-split="">
      <div className={s.bar} role="img" aria-label={shown.map((part) => `${PART_NAME(w, part)} ${pctText(shares[part], lang)}`).join(', ')}>
        {shown.map((part) => (
          <span key={part} className={s.seg} data-part={part} style={{ flexGrow: shares[part] }} />
        ))}
      </div>
      <ul className={s.legend}>
        {shown.map((part) => (
          <li key={part} data-pilot-part={part}>
            <span className={s.dot} data-part={part} />
            <span className={s.name}>{PART_NAME(w, part)}</span>
            <span className={s.pct}>{pctText(shares[part], lang)}</span>
            {values ? <span className={s.sum} style={{ gridColumn: '2 / 4' }}>{usdText(values[part], lang)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Details({ lines, said, children }: { lines: readonly string[]; said: string | null; children?: React.ReactNode }) {
  const w = useWords(PILOT);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={i.detailsBox}>
      <button type="button" className={i.more} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} data-pilot-details="">
        {open ? w.hideDetails : w.details}
        <span className={open ? i.chevronUp : ''}>
          <ChevronGlyph />
        </span>
      </button>
      {open && (
        <div className={i.details} id={id}>
          {said ? (
            <div>
              <dt>{w.yourWords}</dt>
              <dd>«{said}»</dd>
            </div>
          ) : null}
          {children}
          <ul className={a.facts}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <span className={a.net}>{PILOT_NET === 'mainnet' ? w.mainnet : w.devnet}</span>
        </div>
      )}
    </div>
  );
}

/** Connect, then the one button. */
function Press({ label, busy, busyLabel, disabled, onPress, quiet }: { label: string; busy: boolean; busyLabel: string; disabled?: boolean; onPress: (who: { wallet: string; owner: string }) => void; quiet?: boolean }) {
  const w = useWords(PILOT);
  const connection = useWallet((st) => st.connection);
  const [picking, setPicking] = useState(false);
  if (!connection && picking) return <WalletPicker onBack={() => setPicking(false)} />;
  if (!connection) {
    return (
      <button type="button" className={i.action} onClick={() => setPicking(true)}>
        {w.connect}
      </button>
    );
  }
  return (
    <>
      <button type="button" className={quiet ? a.quiet : `${i.action} ${busy ? i.waiting : ''}`} disabled={disabled || busy} aria-busy={busy} onClick={() => onPress({ wallet: connection.wallet, owner: connection.address })} data-pilot-press="">
        {busy ? busyLabel : label}
      </button>
      {quiet ? null : <WalletLine />}
    </>
  );
}

function facts(w: W, lang: Lang, plan: PilotPlanData, coin: string | null, extra: readonly string[]): string[] {
  const legs = legsOf(plan);
  const lines: string[] = [];
  if (legs.trade.solRaw > 0n && coin) lines.push(w.on_trade(coin));
  if (legs.save.usdcRaw > 0n || legs.save.solRaw > 0n) lines.push(`${w.part_save} · ${w.on_save}`);
  if (legs.pool.solRaw > 0n) lines.push(`${w.part_pool} · ${w.on_pool}`);
  lines.push(...extra);
  const fee = agentFeeFigures(lang);
  lines.push(digits(w.rules(String(plan.rules.bandBps / 100), String(plan.rules.crashBps / 100)), lang), w.compounds, w.feeRates(fee.major, fee.stock, fee.trending, fee.meme), w.noCredits, w.fees, w.limits, w.report);
  return lines;
}

function noteText(w: W, kind: NonNullable<ReturnType<typeof usePilot.getState>['note']>['kind']): string {
  return { on: w.noteOn, partial: w.notePartial, stopped: w.noteStopped, walletNo: w.noteWalletNo, refused: w.noteRefused, unreachable: w.noteUnreachable }[kind];
}

/* ---------------------------------------------------------------- the proposal and the practice */

function Propose() {
  const w = useWords(PILOT);
  const lang = useLang();
  const ask = usePilot((st) => st.ask);
  const split = usePilot((st) => st.split);
  const plan = usePilot((st) => st.plan);
  const solUsd = usePilot((st) => st.solUsd);
  const coin = usePilot((st) => st.coin);
  const phase = usePilot((st) => st.phase);
  const paper = usePilot((st) => st.paper);
  const note = usePilot((st) => st.note);
  const holdings = useWallet((st) => st.holdings);
  if (!ask) return null;
  if (!split || !plan) return <p className={i.notice}>{w.notePrice}</p>;
  const total = solUsd !== null ? PILOT_PARTS.reduce((sum, part) => sum + legsUsd(split.legs, solUsd)[part], 0) : null;
  const extra: string[] = [];
  if (split.capped) extra.push(digits(w.capped(sol(presetLimits(MANDATE_PRESETS[0]!).perDay, lang)), lang));
  if (ask.coins.length > 1 && coin) extra.push(w.oneCoin(coin.symbol, ask.coins.slice(1).map((c) => c.symbol).join(', ')));
  if (split.dropped.length) extra.push(w.dropped(split.dropped.map((part) => PART_NAME(w, part)).join(', ')));
  const onPaper = phase === 'paper' || phase === 'signing';
  const short = walletShort(split.legs, PILOT_NET, holdings);
  const fee = agentFeeFigures(lang);
  return (
    <>
      <div className={i.hero}>
        <span className={`${i.coin} ${i.coinLetter}`}>
          <AgentGlyph />
        </span>
        <div className={i.heroText}>
          <span className={i.kicker}>{w.kicker}</span>
          <h2 className={i.headline}>{w.headline}</h2>
          {total !== null ? <p className={i.sub}>{w.total(usdText(total, lang))}</p> : null}
          {split.preset && coin ? <p className={a.plan}>{w.on_trade(coin.symbol)}</p> : null}
        </div>
      </div>
      <Split shares={split.shares} plan={plan} solUsd={solUsd} />
      {onPaper ? (
        <div className={a.figure} data-pilot-paper="">
          <span className={a.figureLabel}>{w.paperOn}</span>
          {paper ? (
            <>
              <span className={a.figureValue} data-tone={toneOf(paper.totalUsd)}>
                {paper.totalUsd === null ? '—' : usdText(paper.totalUsd, lang, true)}
              </span>
              <span className={a.figureLine}>{w.paperLine(paper.days)}</span>
            </>
          ) : (
            <span className={a.figureLine} aria-busy="true">
              …
            </span>
          )}
        </div>
      ) : null}
      {split.preset && PILOT_NET === 'mainnet' && !coin ? <p className={i.notice}>{w.pickCoin}</p> : null}
      {short ? <p className={i.problem} data-pilot-short={short}>{w.short(short)}</p> : null}
      {note ? <p className={note.kind === 'walletNo' ? i.notice : i.problem}>{noteText(w, note.kind)}</p> : null}
      <div className={i.dock}>
        {split.preset ? (
          <p className={s.pay} data-pilot-pay="">
            {w.pay(fee.low, fee.high)}
          </p>
        ) : null}
        <p className={s.risk} data-pilot-risk="">
          {w.risk}
        </p>
        {onPaper ? (
          <Press label={w.live} busy={phase === 'signing'} busyLabel={w.signing} disabled={Boolean((split.preset && PILOT_NET === 'mainnet' && !coin) || short)} onPress={(who) => void goLive(who)} />
        ) : (
          <button type="button" className={i.action} onClick={() => void startPaper()} data-pilot-paper-start="">
            {w.paper}
          </button>
        )}
      </div>
      <Details said={ask.said} lines={facts(w, lang, plan, coin?.symbol ?? null, extra)} />
    </>
  );
}

/* ---------------------------------------------------------------- at work */

function Live() {
  const w = useWords(PILOT);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const view = usePilot((st) => st.view);
  const phase = usePilot((st) => st.phase);
  const note = usePilot((st) => st.note);
  const busy = useMandate((st) => st.busy === 'stop') || phase === 'stopping';
  useEffect(() => {
    if (!owner) return;
    void readPilot(owner);
    const timer = setInterval(() => document.visibilityState === 'visible' && void readPilot(owner), 30_000);
    return () => clearInterval(timer);
  }, [owner]);
  if (!view) return <p className={i.notice}>{w.weekUnread}</p>;
  const care = view.care;
  const weekUsd = care?.weekUsd ?? null;
  const solUsd = care?.solUsd ?? null;
  const weekSol = weekUsd !== null && solUsd ? weekUsd / solUsd : null;
  const shares = care?.shares ?? view.plan.shares;
  const status = view.status === 'stopped' ? w.stopped : view.held ? (view.held.why === 'market' ? w.held_market : w.held_balance) : w.working;
  const events = [...view.events].reverse().slice(0, 3);
  const evName = (what: string) => ({ start: w.ev_start, hold: w.ev_hold, go: w.ev_go, drift: w.ev_drift, stopped: w.ev_stopped })[what] ?? what;
  return (
    <>
      <div className={i.hero}>
        <span className={`${i.coin} ${i.coinLetter}`}>
          <AgentGlyph />
        </span>
        <div className={i.heroText}>
          {view.status === 'working' && !view.held ? <span className={a.live}>{status}</span> : <span className={s.status}>{status}</span>}
          <h2 className={i.headline}>{w.headline}</h2>
        </div>
      </div>
      <div className={a.figure} data-pilot-week="">
        <span className={a.figureLabel}>{w.week}</span>
        {weekSol !== null && weekUsd !== null ? (
          <>
            <span className={a.figureValue} data-tone={toneOf(weekUsd)}>
              {`${weekSol > 0.0000005 ? '+' : weekSol < -0.0000005 ? '−' : ''}${solText(Math.abs(weekSol), lang)} SOL`}
            </span>
            <span className={a.figureLine}>{usdText(weekUsd, lang, true)}</span>
          </>
        ) : (
          <span className={a.figureLine}>{w.weekUnread}</span>
        )}
      </div>
      <Split shares={shares} plan={view.plan} solUsd={null} />
      {note ? <p className={note.kind === 'walletNo' || note.kind === 'stopped' || note.kind === 'on' ? i.notice : i.problem}>{noteText(w, note.kind)}</p> : null}
      <div className={i.dock}>{view.status === 'working' && view.policy ? <Press label={w.stop} busy={busy} busyLabel={w.stopping} onPress={(who) => void stopPilot(who)} quiet /> : null}</div>
      <Details said={view.said} lines={facts(w, lang, view.plan, null, [])}>
        <ul className={s.table}>
          <li className={s.head}>
            <span />
            <span>{w.now}</span>
            <span>{w.target}</span>
          </li>
          {PILOT_PARTS.filter((part) => view.plan.shares[part] > 0 || shares[part] > 0).map((part) => (
            <li key={part}>
              <span>{PART_NAME(w, part)}</span>
              <span>{pctText(shares[part], lang)}</span>
              <span>{pctText(view.plan.shares[part], lang)}</span>
            </li>
          ))}
        </ul>
        {events.length ? (
          <ul className={a.facts}>
            {events.map((event) => (
              <li key={`${event.at}:${event.what}`}>
                {evName(event.what)} · {new Date(event.at).toLocaleString(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </li>
            ))}
          </ul>
        ) : null}
      </Details>
    </>
  );
}

export default function PilotCard() {
  const phase = usePilot((st) => st.phase);
  useEffect(() => startWallets(), []);
  return (
    <div className={i.body} data-pilot={phase}>
      {phase === 'live' || phase === 'stopping' ? <Live /> : <Propose />}
    </div>
  );
}
