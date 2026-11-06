'use client';

import { useEffect, useId, useState } from 'react';
import { MANDATE_CHAIN, MANDATE_NET, MANDATE_PRESETS, useMandate, presetLimits } from '@/city/lib/bots/mandate';
import { agentCoins, bookNow } from '@/city/lib/command/doors';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { sol } from '@/city/lib/bots/format';
import { BRAND } from '@/city/lib/brand';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { agentCard, cardTag } from '@/city/lib/launch/cards';
import { useLaunch } from '@/city/lib/launch/district';
import { rhythmOf, solText } from '@/city/lib/autopilot/plan';
import { calmPlan, STEADY } from '@/lib/mandate/plans';
import { steadyRhythm } from '@/lib/mandate/strategy';
import { pctText, planLine, planOfText, planRules, signedPct, testedLine } from '@/city/lib/autopilot/plan-line';
import { launchProposal, readAgentView, readPaper, signTrade, startPaper, stopTrade, useAutopilot, type AgentView } from '@/city/lib/autopilot/store';
import { AGENT_REPORT, AGENT_REPORT_OPEN, holdFigure, hourText, resultRaw, solFigure, toneOf, worthTelling } from '@/city/lib/autopilot/report';
import { useAgentReport } from '@/city/lib/autopilot/report-client';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { useShareCard } from '../launch/useShareCard';
import { WalletLine, WalletPicker } from '../trade/WalletParts';
import { AgentGlyph, ChevronGlyph } from '../instruct/glyphs';
import i from '../instruct/instruct.module.css';
import s from './autopilot.module.css';

type W = ReturnType<typeof useWords<(typeof AUTOPILOT)['en']>>;

/** SOL from lamports as the agent's figures write it (`solText`). */
const solOf = (raw: string | null | undefined, lang: 'en' | 'uk') => (raw === null || raw === undefined ? null : solText(Number(BigInt(raw)) / 1e9, lang));

/** The agent's state for the wallet's mandate, read from the book now and every half minute while it shows. */
export function useAgentView(): Readonly<{ record: ReturnType<typeof useMandate.getState>['records'][string] | null; view: AgentView | null; live: boolean; active: boolean }> {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const status = useMandate((st) => (record ? st.status[record.policy] : undefined));
  const view = useAutopilot((st) => (record ? (st.views[record.policy] ?? null) : null));
  useEffect(() => useMandate.getState().hydrate(), []);
  useEffect(() => {
    if (!record) return;
    let live = true;
    const read = async () => {
      const [answer, { readStatus }] = await Promise.all([readAgentView(record), import('@/city/lib/bots/mandate-sign')]);
      if (live && answer) useAutopilot.getState().setView(record.policy, answer);
      const standing = await readStatus(record);
      if (live && standing) useMandate.getState().setStatus(record.policy, standing);
    };
    void read();
    const timer = setInterval(() => document.visibilityState === 'visible' && void read(), 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [record]);
  // `live` — the policy stands on chain (stop still means something); `active` — and the agent is still trading.
  const live = Boolean(record && (status?.active ?? true) && view?.status !== 'stopped');
  const active = live && (view === null || view.status === 'working');
  return { record, view, live, active };
}

/** Where the engine sells what the agent bought: devnet, by the person's one tap (CITY-187); mainnet's is CITY-195. */
const SELLS = MANDATE_NET === 'devnet';

function Details({ lines, said, tested }: { lines: readonly string[]; said: string | null; tested?: string | null }) {
  const w = useWords(AUTOPILOT);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={i.detailsBox}>
      <button type="button" className={i.more} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
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
          <ul className={s.facts}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {tested ? (
            <p className={s.tested} data-autopilot-tested="">
              {tested}
              <span>{w.testedNote}</span>
            </p>
          ) : null}
          <span className={s.net}>{MANDATE_NET === 'mainnet' ? w.mainnet : w.devnet}</span>
        </div>
      )}
    </div>
  );
}

/** Connect, then the one button. */
function SignButton({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: (who: { wallet: string; owner: string }) => void }) {
  const w = useWords(AUTOPILOT);
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
      <button type="button" className={`${i.action} ${busy ? i.waiting : ''}`} disabled={disabled || busy} aria-busy={busy} onClick={() => onPress({ wallet: connection.wallet, owner: connection.address })} data-autopilot-sign="">
        {busy ? w.signing : label}
      </button>
      <WalletLine />
    </>
  );
}

/** CITY-197: what the agent really trades a day at its pace — the buys it makes, never more than the day's cap. */
const dayAtPace = (rhythm: Readonly<{ buys: number; perTrade: number; perDay: number }>) => Math.min(rhythm.perDay, Math.round(rhythm.buys * rhythm.perTrade * 1e9) / 1e9);

function noteText(w: W, kind: 'on' | 'stopped' | 'walletNo' | 'refused' | 'unreachable'): string {
  return { on: w.noteOn, stopped: w.noteStopped, walletNo: w.noteWalletNo, refused: w.noteRefused, unreachable: w.noteUnreachable }[kind];
}

/* ---------------------------------------------------------------- trade: the proposal */

function TradeStart({ said }: { said: string }) {
  const w = useWords(AUTOPILOT);
  const lang = useLang();
  const preset = useAutopilot((st) => st.preset);
  const capped = useAutopilot((st) => st.capped);
  const busy = useMandate((st) => st.busy === 'enable');
  const note = useMandate((st) => st.note);
  // CITY-197: the rhythm at the plan's calm pace — the buys it will really make.
  const asked = useAutopilot((st) => st.plan);
  const pace = calmPlan(asked ?? STEADY).pace ?? null;
  const rhythm = preset ? rhythmOf(preset, pace) : null;
  const largest = presetLimits(MANDATE_PRESETS.at(-1)!).perDay;
  const fee = agentFeeFigures(lang);
  // Mainnet: the agent buys a coin the person named — in her words, the tower on screen, or one tap here.
  const coin = useMandate((st) => st.coin);
  const needsCoin = MANDATE_NET === 'mainnet';
  // CITY-193: the strategy said, in one line; an early plan's launch is the agent's own pick.
  const plan = useAutopilot((st) => st.plan);
  const launch = useAutopilot((st) => st.launch);
  const tested = useAutopilot((st) => st.tested);
  const early = plan?.id === 'early';
  const offered = needsCoin && !coin && !early ? agentCoins(bookNow()) : [];
  const line = planLine(plan, w, lang);
  const rules = planRules(plan, w, lang, rhythm ? { buys: rhythm.buys, perTrade: sol(rhythm.perTrade, lang) } : null, SELLS);
  const testedText = testedLine(tested?.run ?? null, w, lang);
  return (
    <>
      <div className={i.hero}>
        <span className={`${i.coin} ${i.coinLetter}`}>
          <AgentGlyph />
        </span>
        <div className={i.heroText}>
          <span className={i.kicker}>{w.kicker}</span>
          <h2 className={i.headline}>{rhythm ? w.trades(sol(dayAtPace(rhythm), lang)) : w.tradesAsk}</h2>
          {needsCoin && coin ? <p className={i.sub} data-autopilot-coin={coin.mint}>{w.buys(coin.symbol)}</p> : null}
          {early && launch?.state === 'picking' ? <p className={i.sub}>{w.pickingLaunch}</p> : null}
          {line ? (
            <p className={s.plan} data-autopilot-plan={plan?.id}>
              {line}
            </p>
          ) : rhythm ? (
            <p className={i.sub}>{digits(w.rhythm(rhythm.buys, String(rhythm.everyHours), sol(rhythm.perTrade, lang)), lang)}</p>
          ) : null}
        </div>
      </div>
      {early && launch?.state === 'none' ? <p className={i.notice}>{w.noLaunch}</p> : null}
      {offered.length ? (
        <div className={i.ask} role="radiogroup" aria-label={w.pickCoin}>
          <p className={i.question}>{w.pickCoin}</p>
          <div className={i.chips}>
            {offered.map((c) => (
              <button key={c.mint} type="button" role="radio" aria-checked={false} className={i.chip} onClick={() => useMandate.getState().setCoin({ mint: c.mint, symbol: c.symbol, icon: c.icon })}>
                {c.symbol}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {MANDATE_PRESETS.length > 1 || capped || !preset ? (
      <div className={i.ask} role="radiogroup" aria-label={w.budget}>
        <p className={i.question}>{preset ? w.budget : w.pickBudget}</p>
        <div className={i.chips}>
          {MANDATE_PRESETS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={id === preset} className={`${i.chip} ${id === preset ? s.chipOn : ''}`} onClick={() => useAutopilot.getState().pick(id)}>
              {w.amount(sol(presetLimits(id).perDay, lang))}
            </button>
          ))}
        </div>
        {capped ? <p className={i.notice}>{w.startsSmall(sol(largest, lang))}</p> : null}
      </div>
      ) : null}
      {note && note.kind !== 'on' ? <p className={note.kind === 'walletNo' || note.kind === 'stopped' ? i.notice : i.problem}>{noteText(w, note.kind)}</p> : null}
      <div className={i.dock}>
        {rhythm ? <p className={i.fee}>{w.limits(sol(rhythm.perTrade, lang), sol(rhythm.perDay, lang), rhythm.days)}</p> : null}
        <p className={i.fee} data-autopilot-fee="">{w.fee(fee.low, fee.high)}</p>
        <SignButton label={w.sign} busy={busy} disabled={!preset || (needsCoin && !coin)} onPress={(who) => void signTrade(who)} />
        {tested && coin && preset ? (
          <button type="button" className={s.quiet} onClick={() => startPaper()} data-autopilot-practice="">
            {w.practice}
          </button>
        ) : null}
      </div>
      <Details said={said} tested={testedText} lines={[...rules, w.fact1, w.fact2, w.fact3, w.feeRates(fee.major, fee.stock, fee.trending, fee.meme), w.feeInside]} />
    </>
  );
}

/* ---------------------------------------------------------------- trade: the practice without money */

function PaperFace({ said }: { said: string }) {
  const w = useWords(AUTOPILOT);
  const lang = useLang();
  const paper = useAutopilot((st) => st.paper);
  const run = useAutopilot((st) => st.paperRun);
  const preset = useAutopilot((st) => st.preset);
  const busy = useMandate((st) => st.busy === 'enable');
  useEffect(() => {
    if (!paper) return;
    void readPaper();
    const timer = setInterval(() => document.visibilityState === 'visible' && void readPaper(), 60_000);
    return () => clearInterval(timer);
  }, [paper]);
  if (!paper) return null;
  const plan = planOfText(paper.plan);
  const line = planLine(plan, w, lang);
  const rhythm = preset ? rhythmOf(preset, plan?.pace ?? null) : null;
  const pct = run?.resultPct ?? null;
  const tone = pct === null ? undefined : pct > 0 ? 'up' : pct < 0 ? 'down' : undefined;
  const earned = run && pct !== null ? (run.heldSol + run.gotSol - run.spentSol) : null;
  const goLive = (who: { wallet: string; owner: string }) => {
    // Live, the agent takes the very plan and coin it practised.
    useAutopilot.setState({ plan });
    useMandate.getState().setCoin({ mint: paper.coin, symbol: paper.symbol ?? paper.coin.slice(0, 4), icon: null });
    void signTrade(who);
  };
  return (
    <>
      <div className={i.hero}>
        <span className={`${i.coin} ${i.coinLetter}`}>
          <AgentGlyph />
        </span>
        <div className={i.heroText}>
          <span className={s.paperKicker}>{w.paperKicker}</span>
          <h2 className={i.headline}>{rhythm ? w.trades(sol(dayAtPace(rhythm), lang)) : w.tradesAsk}</h2>
          {paper.symbol ? <p className={i.sub}>{w.buys(paper.symbol)}</p> : null}
          {line ? <p className={s.plan}>{line}</p> : null}
        </div>
      </div>
      <div className={s.figure} data-paper="">
        <span className={s.figureLabel}>{w.paperFigure}</span>
        {run && run.buys > 0 && pct !== null && earned !== null ? (
          <>
            <span className={s.figureValue} data-tone={tone}>
              {signedPct(pct, lang)}
            </span>
            <span className={s.figureLine}>
              {digits(w.paperTrades(run.buys), lang)} · {`${earned >= 0 ? '+' : '−'}${solText(Math.abs(earned), lang)} SOL`}
              {run.holdPct !== null ? ` · ${w.paperVsHold(signedPct(run.holdPct, lang))}` : ''}
            </span>
          </>
        ) : (
          <span className={s.figureLine}>{w.paperNone}</span>
        )}
      </div>
      <div className={i.dock}>
        <SignButton label={w.goLive} busy={busy} disabled={!preset} onPress={goLive} />
        <button type="button" className={s.quiet} onClick={() => useAutopilot.getState().setPaper(null)} data-autopilot-end-practice="">
          {w.endPractice}
        </button>
      </div>
      <Details said={said || null} lines={[...planRules(plan, w, lang, rhythm ? { buys: rhythm.buys, perTrade: sol(rhythm.perTrade, lang) } : null, SELLS), w.fact1, w.fact2, w.fact3]} tested={null} />
    </>
  );
}

/* ---------------------------------------------------------------- trade: the agent at work */

export function TradeWorking({ said }: { said: string | null }) {
  const w = useWords(AUTOPILOT);
  const lang = useLang();
  const { record, view, live, active } = useAgentView();
  const busy = useMandate((st) => st.busy === 'stop');
  const status = useMandate((st) => (record ? st.status[record.policy] : undefined));
  const connection = useWallet((st) => st.connection);
  const { share, making, saved, label } = useShareCard();
  if (!record) return null;
  const result = view?.result ?? null;
  /* CITY-197: the result after every fee, when the book counted them; plain holding beside it. */
  const net = view?.net ?? null;
  const earned = net ? net.netRaw : (result?.earnedRaw ?? null);
  const hold = net?.holdRaw ?? null;
  const tone = earned === null ? undefined : BigInt(earned) > 0n ? 'up' : BigInt(earned) < 0n ? 'down' : undefined;
  const earnedText = earned !== null ? solFigure(earned, lang) : null;
  const left = status?.budgetLamports ? sol(Number(status.budgetLamports) / 1e9, lang) : null;
  const lastAt = view?.last.find((trade) => trade.ok)?.at ?? null;
  const nextHours = view && lastAt !== null ? Math.max(0, (lastAt + view.everyMs - Date.now()) / 3_600_000) : null;
  const card = view && result ? agentCard({ coin: { token: view.receiveMint, symbol: symbolOf(view), logo: false }, trades: result.trades, spentRaw: result.spentRaw, worthRaw: net ? (net.netRaw === null ? null : (BigInt(result.spentRaw) + BigInt(net.netRaw)).toString()) : result.worthRaw, tag: cardTag(MANDATE_CHAIN, false) }) : null;
  const plan = planOfText(view?.plan);
  const line = planLine(plan, w, lang);
  const paused = pausedText(w, view?.pausedBy ?? null, plan, lang);
  const ended = view && view.status !== 'working' ? (view.status === 'stopped' ? w.noteStopped : view.status === 'paused' ? paused : w.ended) : status && !status.active ? w.noteStopped : null;
  return (
    <>
      <div className={i.hero}>
        <span className={`${i.coin} ${i.coinLetter}`}>
          <AgentGlyph />
        </span>
        <div className={i.heroText}>
          {active ? <span className={s.live}>{w.working}</span> : <span className={i.kicker}>{w.kicker}</span>}
          <h2 className={i.headline}>{w.trades(sol(dayAtPace({ buys: steadyRhythm(BigInt(record.perTrade), BigInt(record.perDay), plan?.pace ?? null).buys, perTrade: Number(record.perTrade) / 1e9, perDay: Number(record.perDay) / 1e9 }), lang))}</h2>
          {line ? <p className={s.plan}>{line}</p> : null}
          {result && result.trades > 0 ? (
            <p className={i.sub}>
              {w.tradesDone(result.trades)}
              {active && nextHours !== null ? ` · ${digits(w.next((Math.round(nextHours * 10) / 10).toString()), lang)}` : ''}
            </p>
          ) : left ? (
            <p className={i.sub}>{digits(left, lang)} SOL</p>
          ) : null}
        </div>
      </div>
      <div className={s.figure} data-agent-earned="">
        <span className={s.figureLabel}>{net ? w.earnedNet : w.earned}</span>
        {earnedText && result && result.trades > 0 ? (
          <>
            <span className={s.figureValue} data-tone={tone}>
              {earnedText}
            </span>
            {net ? (
              <span className={s.figureLine} data-agent-hold="">
                {w.netLine(solOf(result.spentRaw, lang)!, hold === null ? null : solFigure(hold, lang))}
              </span>
            ) : result.worthRaw ? (
              <span className={s.figureLine}>{w.spentBought(solOf(result.spentRaw, lang)!, solOf(result.worthRaw, lang)!)}</span>
            ) : null}
          </>
        ) : (
          <span className={s.figureLine}>{active ? w.earnedNone : (ended ?? w.earnedNone)}</span>
        )}
      </div>
      {AGENT_REPORT_OPEN ? <AgentToday view={view} /> : null}
      {ended && result && result.trades > 0 ? <p className={i.notice}>{ended}</p> : null}
      {saved ? <p className={i.notice}>{w.saved}</p> : null}
      <div className={i.dock}>
        <div className={s.pair}>
          <button type="button" className={s.second} disabled={!card || making !== null} onClick={() => card && void share('agent', card, `https://${BRAND.domain}`)} data-autopilot-share="">
            {label}
          </button>
          <button type="button" className={s.second} disabled={!live || busy || !connection} aria-busy={busy} onClick={() => connection && void stopTrade({ wallet: connection.wallet, owner: connection.address }, record)} data-autopilot-stop="">
            {busy ? w.stopping : w.stop}
          </button>
        </div>
      </div>
      <Details said={said} lines={[...planRules(plan, w, lang, null, SELLS), w.factNet, w.factHold, w.fact1, w.fact2, w.fact3]} />
    </>
  );
}

/** Why the agent paused, in its words: the person's own exit, a launch past its first hours, or the autostop. */
function pausedText(w: W, why: string | null, plan: ReturnType<typeof planOfText>, lang: 'en' | 'uk'): string {
  if (why === 'take' && plan?.exit?.takeBps) return w.pausedTake(pctText(plan.exit.takeBps, lang));
  if (why === 'stop' && plan?.exit?.stopBps) return w.pausedStop(pctText(plan.exit.stopBps, lang));
  if (why === 'late') return w.pausedLate;
  return w.paused;
}

/**
 * The agent's day in its card (CITY-194): «Today: 3 trades, +0.012 SOL» from its book, and the daily report's one
 * switch — Telegram and the phone hear it at the person's hour; one tap turns it off.
 */
function AgentToday({ view }: { view: AgentView | null }) {
  const r = useWords(AGENT_REPORT);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const report = useAgentReport((st) => st.report);
  const busy = useAgentReport((st) => st.busy);
  useEffect(() => {
    if (owner) void useAgentReport.getState().readReport(owner, lang);
  }, [owner, lang]);
  const day = view?.day;
  const earned = day ? resultRaw(day) : null;
  const hold = day ? holdFigure(day.holdRaw, lang) : null;
  return (
    <>
      {worthTelling(day) ? (
        <p className={s.today} data-agent-today="">
          {r.today}: {r.trades(day.trades)}
          {earned !== null ? (
            <>
              {', '}
              <b data-tone={toneOf(earned)}>{solFigure(earned, lang)}</b>
            </>
          ) : null}
          {hold ? ` · ${hold}` : null}
        </p>
      ) : null}
      {report && owner ? (
        <button type="button" role="switch" aria-checked={report.on} className={s.daily} disabled={busy} onClick={() => void useAgentReport.getState().toggle(owner)} data-agent-daily="">
          <span>{report.on ? r.dailyAt(hourText(report.hour)) : r.daily}</span>
          <span className={s.dailyKnob} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}

/** The coin the agent buys, as the card writes it: its ticker when the book named it, else its short address. */
function symbolOf(view: AgentView): string {
  const named = view.symbol;
  return typeof named === 'string' && /^[A-Za-z0-9]{1,10}$/u.test(named) ? named : view.receiveMint.slice(0, 4);
}

/* ---------------------------------------------------------------- launch: the proposal */

function LaunchFace({ said }: { said: string }) {
  const w = useWords(AUTOPILOT);
  const proposal = useAutopilot((st) => st.proposal);
  const picture = useAutopilot((st) => st.picture);
  const drawing = useAutopilot((st) => st.drawing);
  const shield = useLaunch((st) => st.preset?.id === 'protected');
  if (!proposal) return null;
  return (
    <>
      <div className={i.hero}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.coinArt} src={picture.url} alt={w.picture} decoding="async" />
        ) : (
          <span className={`${s.coinArt} ${i.coinLetter}`} data-drawing={drawing ? '' : undefined} aria-hidden="true" />
        )}
        <div className={i.heroText}>
          <span className={i.kicker}>{w.launchTitle}</span>
          <h2 className={i.headline} translate="no">
            ${proposal.symbol}
          </h2>
          <p className={i.sub} translate="no">
            {proposal.name}
          </p>
        </div>
      </div>
      <div className={i.chips}>
        <button type="button" className={i.chip} disabled={drawing} onClick={() => void useAutopilot.getState().another()} data-autopilot-another="">
          {w.another}
        </button>
      </div>
      <div className={i.dock}>
        <p className={i.fee}>{w.launchRules(shield)}</p>
        <button type="button" className={`${i.action} ${drawing ? i.waiting : ''}`} disabled={!picture} onClick={() => launchProposal()} data-autopilot-launch="">
          {w.launchGo(proposal.symbol)}
        </button>
      </div>
      <Details said={said} lines={[w.launchFact1, w.launchFact2]} />
    </>
  );
}

/**
 * The agent's card on its word (CITY-175): «trade 1 SOL a day» — the budget, the rhythm and the limits in one line, one
 * signature, then the agent at work with what it earned, «Share» and «Stop»; «launch me a token» — the coin it prepared
 * and one press into the launch sheet's review.
 */
export default function AutopilotCard() {
  const ask = useAutopilot((st) => st.ask);
  const face = useAutopilot((st) => st.face);
  const paper = useAutopilot((st) => st.paper);
  // A mandate at work shows the agent at work — or what it did, opened from «Mine»; one stopped leaves a new start.
  const { record, view, active } = useAgentView();
  useEffect(() => startWallets(), []);
  if (!ask) return null;
  const agentFace = record && (active || (face === 'agent' && view !== null));
  return (
    <div className={i.body} data-autopilot={ask.kind}>
      {ask.kind === 'launch' ? <LaunchFace said={ask.said} /> : agentFace ? <TradeWorking said={ask.said || null} /> : paper ? <PaperFace said={ask.said} /> : <TradeStart said={ask.said} />}
    </div>
  );
}
