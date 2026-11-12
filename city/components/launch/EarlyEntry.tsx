'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { launchEntryEngine, launchWallet, useLaunch } from '@/city/lib/launch/district';
import { earlyDoorOpen } from '@/city/lib/launch/early';
import { ENTRY_AMOUNTS_USD, amountProblem, entryStep, ryntraShare, stepAction, units, usdcRaw, wantsWallet, type EarlyView, type EntryStep } from '@/city/lib/launch/entry';
import { runEntry, type EntryPhase } from '@/city/lib/launch/entry-flow';
import { causeOf, BUILD_UNEXPECTED } from '@/city/lib/launch/refusal';
import { shortAddress } from '@/city/lib/launch/format';
import type { WalletOption } from '@/city/lib/launch/wallet';
import { digits, useWords, type Same } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useKeyboardInset } from '@/city/lib/keyboard';
import { CloseGlyph } from '../hud/glyphs';
import { clock } from './LaunchDoors';
import { WalletList } from './LaunchSheet';
import s from './launch.module.css';
import { ENTRY, LAUNCH } from './words';

type W = Same<(typeof ENTRY)['en']>;

/** How often the window reads the vault again while it is open. */
const READ_EVERY_MS = 20_000;

/** Dollars for the eye: $3,200 · $12.50. */
function dollars(raw: string | null | undefined): string {
  const value = units(raw);
  return digits(`$${value.toLocaleString('en-US', { maximumFractionDigits: value < 100 ? 2 : 0 })}`);
}

/** Tokens for the eye, short: 18.75M. */
function tokens(raw: string | null | undefined): string {
  const value = units(raw);
  if (value >= 1e9) return digits(`${Number((value / 1e9).toFixed(2))}B`);
  if (value >= 1e6) return digits(`${Number((value / 1e6).toFixed(2))}M`);
  if (value >= 1e3) return digits(`${Number((value / 1e3).toFixed(1))}K`);
  return digits(String(Number(value.toFixed(2))));
}

/**
 * «Your people first» for the people (CITY-220): the creator's link opens this window on the early launch. One number
 * and one action at each moment — come in with USDC while the window is open, start the one buy for everyone in the
 * hour before trading, take the tokens, take back what was not spent. The one line under it says what holds; the rest is
 * behind «i». The engine builds every byte for this wallet alone; the city reads it back before the wallet opens.
 */
export function EarlyEntry() {
  const mint = useLaunch((st) => st.entry);
  const network = useLaunch((st) => st.network);
  const status = useLaunch((st) => st.status);
  const connection = useLaunch((st) => st.connection);
  const setConnection = useLaunch((st) => st.setConnection);
  const closeEntry = useLaunch((st) => st.closeEntry);
  const bounds = useLaunch((st) => st.earlyBounds);
  const earlySwitch = useLaunch((st) => st.earlySwitch);
  const stub = useLaunch((st) => st.stub);
  const inset = useKeyboardInset();
  const w = useWords(ENTRY);
  const lw = useWords(LAUNCH);
  useLang();
  const [view, setView] = useState<EarlyView | null | undefined>(undefined);
  const [unread, setUnread] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [phase, setPhase] = useState<EntryPhase | null>(null);
  const [text, setText] = useState('100');
  const [details, setDetails] = useState(false);
  const [options, setOptions] = useState<readonly WalletOption[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const busy = useRef(false);
  const wallet = connection?.address ?? null;

  const read = useCallback(async () => {
    if (!mint) return;
    const engine = await launchEntryEngine();
    const answer = await engine.view(mint, wallet);
    if (answer.ok) {
      setView(answer.data);
      setUnread(false);
    } else if (answer.code === 'LAUNCH_NOT_FOUND' || answer.code === 'LAUNCH_UNAVAILABLE' || answer.code === 'VALIDATION_ERROR') setView(null);
    else setUnread(true);
  }, [mint, wallet]);

  useEffect(() => {
    void read();
    const timer = setInterval(() => void read(), READ_EVERY_MS);
    return () => clearInterval(timer);
  }, [read]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(tick);
  }, []);

  /* A wallet this browser connected before is restored without a prompt. */
  useEffect(() => {
    if (connection) return;
    let live = true;
    void launchWallet()
      .then((one) => one.restore())
      .then((restored) => {
        if (live && restored) setConnection(restored);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connection, setConnection]);

  /* A step in the wallet or on its way: «Back» and Escape wait for it (`useBackLayers.ts`, the HUD's Escape). */
  const stepOut = phase !== null && phase.step !== 'failed' && phase.step !== 'done';
  useEffect(() => {
    useLaunch.setState({ entryBusy: stepOut });
    return () => useLaunch.setState({ entryBusy: false });
  }, [stepOut]);

  if (!mint) return null;
  const net = view?.network ?? network;
  const door = net !== null && earlyDoorOpen(net, bounds, earlySwitch);
  const step: EntryStep = unread && !view ? { kind: 'unread' } : view === undefined || status === 'reading' ? { kind: 'setting' } : entryStep(view, now, door);
  const loading = view === undefined;
  const raw = usdcRaw(text);
  const problem = step.kind === 'join' && step.open ? amountProblem(raw, step) : null;
  const working = phase !== null && phase.step !== 'failed' && phase.step !== 'done';
  const action = stepAction(step);

  const pick = async (name: string) => {
    setConnecting(name);
    const one = await launchWallet();
    const answer = await one.connect(name);
    setConnecting(null);
    if (answer.ok) {
      setConnection(answer.connection);
      setOptions(null);
    }
  };
  const connect = async () => {
    const one = await launchWallet();
    const list = one.options();
    if (list.length === 1) return pick(list[0]!.name);
    setOptions(list);
  };
  const act = async (takeBack = false) => {
    if (busy.current || !connection || !view || !net) return;
    if (!takeBack && action === 'DEPOSIT' && problem) return;
    busy.current = true;
    try {
      const one = await launchWallet();
      const result = await runEntry({ engine: await launchEntryEngine(), signer: one.signer(connection), network: net, mint, vault: view.vault, step, amountRaw: raw, takeBack, onPhase: setPhase });
      if (result.step === 'done') void read();
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className={`${s.sheet} ${s.panel}`} style={{ ['--kb' as string]: `${inset}px` }} role="dialog" aria-label={w.kicker} data-launch-entry={step.kind}>
      <div className={s.head}>
        <div className={s.headTitle}>
          <h2 className={`${s.display} ${s.title}`}>{view ? `$${view.symbol}` : w.kicker}</h2>
          {view && <div className={s.headName}>{`${view.name} · ${w.kicker}`}</div>}
        </div>
        <button className={s.close} aria-label={w.close} onClick={closeEntry}>
          <CloseGlyph />
        </button>
      </div>
      {loading && !unread ? <div className={`${s.entryHero} ${s.entryLoading}`} aria-busy="true" /> : <Hero step={step} view={view ?? null} w={w} />}
      <Facts step={step} view={view ?? null} w={w} />
      {step.kind === 'join' && step.open && !phase && (
        <div className={s.entryAmount}>
          <div className={s.earlyCaps} role="radiogroup" aria-label={w.bring}>
            <span>{w.bring}</span>
            {ENTRY_AMOUNTS_USD.map((amount) => (
              <button key={amount} type="button" role="radio" aria-checked={text === String(amount)} className={`${s.earlyCap} ${text === String(amount) ? s.earlyCapOn : ''}`} onClick={() => setText(String(amount))}>
                {`$${amount}`}
              </button>
            ))}
          </div>
          <label className={`${s.field} ${problem === 'room' ? s.fieldBad : ''}`}>
            <span>{w.amount}</span>
            <i aria-hidden="true">$</i>
            <input value={text} inputMode="decimal" aria-label={w.amount} autoComplete="off" onChange={(event) => setText(event.target.value.replace(/[^0-9.,]/g, '').slice(0, 12))} />
          </label>
        </div>
      )}
      {step.kind === 'join' && !step.open && <div className={s.problem}>{step.depositedRaw !== '0' && units(step.depositedRaw) >= units(step.capRaw) && view?.rules.mode === 'FCFS' ? w.full : step.roomRaw === '0' ? w.room('$0') : w.shut}</div>}
      {problem === 'room' && step.kind === 'join' && <div className={s.problem}>{w.room(dollars(step.roomRaw))}</div>}
      {(step.kind === 'join' || step.kind === 'soon' || step.kind === 'fill') && (
        <div className={s.signLine} data-launch-line="">
          <p>
            {[w.lineOne, w.lineTwo, w.lineBack].map((part, i) => (
              <span key={part} className={i === 2 ? s.signRisk : undefined}>
                {part}
              </span>
            ))}
          </p>
          <button type="button" className={`${s.info} ${details ? s.infoOn : ''}`} aria-label={w.details} aria-expanded={details} onClick={() => setDetails((open) => !open)}>
            i
          </button>
        </div>
      )}
      {details && (
        <dl className={s.review}>
          <div className={s.row}>
            <dt>{w.details}</dt>
            <dd>{step.kind === 'fill' ? w.fillLine : w.how}</dd>
            <dd>{w.back}</dd>
            <dd>{w.fee(ryntraShare(view))}</dd>
          </div>
        </dl>
      )}
      {connection && (
        <div className={s.wallet}>
          <span className={s.walletDot} aria-hidden="true" />
          <span>
            {connection.wallet} · {shortAddress(connection.address)}
          </span>
          {!working && (
            <button className={s.link} onClick={() => setConnection(null)}>
              {w.change}
            </button>
          )}
        </div>
      )}
      <Way
        step={step}
        view={view ?? null}
        phase={phase}
        w={w}
        connected={connection !== null}
        options={options}
        connecting={connecting}
        onPick={pick}
        onConnect={connect}
        onAct={() => void act()}
        onRetry={() => (step.kind === 'unread' ? void read() : setPhase(null))}
        onDone={() => setPhase(null)}
        amountLabel={raw && step.kind === 'join' ? w.join(dollars(raw)) : w.joinPlain}
        blocked={step.kind === 'join' && problem !== null}
      />
      {step.kind === 'join' && step.takeBack && connection && !phase && (
        <button type="button" className={`${s.link} ${s.entryBack}`} onClick={() => void act(true)}>
          {w.takeBack}
        </button>
      )}
      {(net === 'solana:devnet' || stub) && <div className={s.netLine}>{stub ? lw.stubLine : lw.devnetLine}</div>}
    </div>
  );
}

/** The one number of the moment. */
function Hero({ step, view, w }: { step: EntryStep; view: EarlyView | null; w: W }) {
  const cell = (label: string, value: string, tone?: 'mint' | 'warm') => (
    <div className={s.entryHero} data-tone={tone}>
      <span>{label}</span>
      <b className={s.display}>{value}</b>
    </div>
  );
  switch (step.kind) {
    case 'soon':
      return cell(w.soonLabel, clock(step.opensAt));
    case 'join': {
      const share = Math.min(1, units(step.depositedRaw) / Math.max(units(step.capRaw), 1e-9));
      return (
        <div className={s.entryHero}>
          <span>{w.joinLabel}</span>
          <b className={s.display}>
            {dollars(step.depositedRaw)} <small>{w.of(dollars(step.capRaw))}</small>
          </b>
          <div className={s.entryBar} aria-hidden="true">
            <i style={{ transform: `scaleX(${share})` }} />
          </div>
        </div>
      );
    }
    case 'fill':
      return cell(w.fillLabel, clock(step.publicAt));
    case 'wait':
      return cell(step.filled ? w.bought : step.empty ? w.nothingToBuy : w.fillLabel, clock(step.publicAt), step.filled ? 'mint' : undefined);
    case 'claim':
      return cell(w.claimLabel, `${tokens(step.amountRaw)} $${view?.symbol ?? ''}`, 'mint');
    case 'refund':
      return cell(w.refundLabel, dollars(step.amountRaw), 'mint');
    case 'done':
      return cell(w.doneLabel, view ? `$${view.symbol}` : '', 'mint');
    case 'missing':
      return <div className={s.entryNote}>{w.missing}</div>;
    case 'broken':
      return <div className={s.entryNote}>{w.broken}</div>;
    case 'unread':
      return <div className={s.entryNote}>{w.unread}</div>;
    case 'setting':
      return <div className={s.entryNote}>{w.setting}</div>;
  }
}

/** Two small facts beside the number: when the window closes, when everyone trades, and this wallet's part. */
function Facts({ step, view, w }: { step: EntryStep; view: EarlyView | null; w: W }) {
  const facts: { id: string; label: string; value: string }[] = [];
  if (step.kind === 'soon') facts.push({ id: 'everyone', label: w.everyoneFact, value: clock(step.publicAt) });
  if (step.kind === 'join') {
    facts.push(units(step.mineRaw) > 0 ? { id: 'you', label: w.youFact, value: dollars(step.mineRaw) } : { id: 'closes', label: w.closesFact, value: clock(step.closesAt) });
    facts.push({ id: 'everyone', label: w.everyoneFact, value: clock(step.publicAt) });
  }
  if ((step.kind === 'fill' || step.kind === 'wait' || step.kind === 'done') && units(step.mineRaw) > 0) facts.push({ id: 'you', label: w.youFact, value: dollars(step.mineRaw) });
  if (step.kind === 'claim' && view?.mine && units(view.mine.depositedRaw) > 0) facts.push({ id: 'you', label: w.youFact, value: dollars(view.mine.depositedRaw) });
  if (!facts.length) return null;
  return (
    <div className={s.facts}>
      {facts.map((fact) => (
        <div key={fact.id} className={s.fact} style={facts.length === 1 ? { gridColumn: '1 / -1' } : undefined}>
          <span>{fact.label}</span>
          <b className={s.display}>{fact.value}</b>
        </div>
      ))}
    </div>
  );
}

type WayProps = {
  step: EntryStep;
  view: EarlyView | null;
  phase: EntryPhase | null;
  w: W;
  connected: boolean;
  options: readonly WalletOption[] | null;
  connecting: string | null;
  onPick: (name: string) => void;
  onConnect: () => void;
  onAct: () => void;
  onRetry: () => void;
  onDone: () => void;
  amountLabel: string;
  blocked: boolean;
};

/** The one way on: the action of the moment, its progress, what came of it, or a wallet to connect first. */
function Way({ step, view, phase, w, connected, options, connecting, onPick, onConnect, onAct, onRetry, onDone, amountLabel, blocked }: WayProps) {
  const big = `${s.display} ${s.action} ${s.actionBig}`;
  if (phase?.step === 'failed') {
    const declined = phase.code === 'WALLET_REFUSED' && causeOf(phase.message) === 'declined';
    const what =
      phase.code === BUILD_UNEXPECTED ? w.unexpected : phase.code === 'LAUNCH_NOTHING_TO_CLAIM' ? w.nothingYet : declined ? w.declined : phase.stage === 'send' ? w.failedSent : w.failedBefore;
    return (
      <div className={s.failed} role="alert" data-launch-entry-refusal={phase.code}>
        <div className={s.failedWords}>
          <b className={s.failedWhat}>{what}</b>
        </div>
        <div className={s.failedWays}>
          <button className={`${s.display} ${s.action}`} onClick={onRetry}>
            {w.retry}
          </button>
        </div>
      </div>
    );
  }
  if (phase?.step === 'done') {
    const symbol = view?.symbol ?? '';
    const said = { DEPOSIT: w.didDeposit(dollars(phase.amountRaw)), WITHDRAW: w.didWithdraw, FILL: w.didFill, CLAIM: w.didClaim(symbol), WITHDRAW_REMAINING: w.didRefund }[phase.kind];
    return (
      <div className={s.opened} role="status" data-launch-entry-done={phase.kind}>
        <b className={`${s.display} ${s.openedTitle}`}>{said}</b>
        {phase.state === 'PENDING' && <span className={s.openedLine}>{w.pending}</span>}
        <button className={big} onClick={onDone}>
          {w.ok}
        </button>
      </div>
    );
  }
  if (phase) {
    const words = phase.step === 'build' ? [w.building, w.buildingLine] : phase.step === 'sign' ? [w.confirmIn(phase.wallet), phase.again ? w.signAged : w.signLine] : [w.sending, w.sendingLine];
    return (
      <div className={s.progress} role="status" aria-live="polite">
        <span className={s.spinner} aria-hidden="true" />
        <div>
          <div className={`${s.display} ${s.progressTitle}`}>{words[0]}</div>
          <div className={s.progressLine}>{words[1]}</div>
        </div>
      </div>
    );
  }
  if (step.kind === 'unread') {
    return (
      <button className={big} onClick={onRetry}>
        {w.retry}
      </button>
    );
  }
  const action = stepAction(step);
  if (!wantsWallet(step, view)) return null;
  if (!connected) {
    return options ? (
      <WalletList options={options} connecting={connecting} onPick={onPick} />
    ) : (
      <button className={big} onClick={onConnect}>
        {w.connect}
      </button>
    );
  }
  if (!action) return null;
  const label = action === 'DEPOSIT' ? amountLabel : action === 'FILL' ? w.fillAct : action === 'CLAIM' ? w.claimAct(view?.symbol ?? '') : step.kind === 'refund' ? w.refundAct(dollars(step.amountRaw)) : w.ok;
  return (
    <button className={big} onClick={onAct} disabled={blocked} data-launch-entry-act={action}>
      {label}
    </button>
  );
}

export default EarlyEntry;
