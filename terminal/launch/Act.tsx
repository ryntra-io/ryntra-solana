'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/city/lib/i18n/lang';
import type { Phase } from '@/city/lib/launch/flow';
import { connectOrPick } from '@/terminal/coin/parts';
import { WalletPick } from '@/terminal/coin/WalletPick';
import { useWhen } from './Form';
import { Glyph } from './glyphs';
import { coinHref } from '@/terminal/shell/shelves';
import { Action, Quiet } from '@/terminal/ui';
import { clockLeft, refusalOf } from './launch-view';
import type { LaunchModel } from './useLaunchModel';
import { useSeconds } from './useSeconds';
import l from './launch.module.css';

/**
 * The bottom of the form: the one line before the signature with its «i», and the screen's one action — «Connect
 * wallet», «Launch $KITE», a new picture where the engine refused this one. While a launch is under way it is where the
 * launch is; when it stopped, what happened, whether money moved and one way on; when it landed, the coin.
 */
export function Act({ m, onTopUp, onNewPicture, onEdit }: { m: LaunchModel; onTopUp: (() => void) | null; onNewPicture: () => void; onEdit: () => void }) {
  const [picking, setPicking] = useState(false);
  const phase = m.phase;
  if (phase?.step === 'failed') return <Refused m={m} failure={phase.failure} onTopUp={onTopUp} onNewPicture={onNewPicture} onEdit={onEdit} />;
  if (phase?.step === 'done') return <Landed m={m} title={phase.liftoff.state === 'PENDING' ? m.w.onItsWay(phase.liftoff.symbol) : m.w.liveTitle(phase.liftoff.symbol)} mint={phase.liftoff.token} line={null} />;
  if (phase?.step === 'pooled') return <Pooled m={m} pooled={phase.pooled} />;
  if (phase) return <Progress m={m} phase={phase} />;

  const { w } = m;
  const label = m.newPicture ? w.newPicture : !m.connection ? w.connect : m.symbol && !m.check.problems.symbol ? w.launch(m.symbol) : w.launchPlain;
  const press = () => {
    if (m.newPicture) return onNewPicture();
    if (!m.connection) return connectOrPick(() => setPicking(true));
    void m.launch();
  };
  return (
    <div className={l.act}>
      {m.open ? null : (
        <p className={l.line} data-launch-line="closed">
          {m.status === 'reading' ? ' ' : w.closed}
        </p>
      )}
      {/* On a phone the action stays in the thumb's reach above the tab bar while the form scrolls under it. */}
      <div className={l.actBar}>
        {picking && !m.connection ? (
          <WalletPick onBack={() => setPicking(false)} />
        ) : (
          <Action onClick={press} disabled={!m.open} busy={m.status === 'reading'} data-launch-act={m.newPicture ? 'picture' : !m.connection ? 'connect' : 'launch'}>
            {label}
          </Action>
        )}
      </div>
      {/* Under the hood, in one line: the person signs in their own wallet — and the risk, said plainly. */}
      {m.open ? (
        <p className={l.hood} data-launch-line={m.format}>
          <Glyph name="lock" small />
          <span>
            {w.underHood} · {w.risk}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Where the launch is, in one line: the step and what the person does now. */
function Progress({ m, phase }: { m: LaunchModel; phase: Exclude<Phase, { step: 'failed' } | { step: 'done' } | { step: 'pooled' }> }) {
  const { w } = m;
  useLang();
  const when = useWhen(m);
  const stage = phase.step === 'sign' || phase.step === 'send' ? (phase.pool?.stage ?? null) : null;
  const stageName = stage === 'COIN' ? w.stepCoin : stage === 'POOL' ? w.stepPool : w.stepSupply;
  const [title, line] = stage
    ? [
        w.stepOf(stage === 'COIN' ? 1 : stage === 'POOL' ? 2 : 3, 3),
        phase.step === 'sign' ? `${w.signStep(stageName)}${stage === 'POOL' && phase.pool?.opensAt ? ` · ${w.pooledLine(when(phase.pool.opensAt, true))}` : ''}` : w.sendingStep(stageName),
      ]
    : phase.step === 'upload'
      ? [w.saving, null]
      : phase.step === 'build'
        ? [w.building, null]
        : phase.step === 'sign'
          ? [w.confirmIn(phase.wallet), phase.again ? w.signAgain : null]
          : [w.sending, null];
  return (
    <div className={l.progress} role="status" aria-live="polite" data-launch-phase={phase.step}>
      <span className={l.spinner} aria-hidden="true" />
      <span className={l.progressWords}>
        <b>{title}</b>
        {line ? <span>{line}</span> : null}
      </span>
    </div>
  );
}

/** A stopped launch: what happened, whether money moved — said every time — and one way on; the codes behind «Details». */
function Refused({ m, failure, onTopUp, onNewPicture, onEdit }: { m: LaunchModel; failure: Extract<Phase, { step: 'failed' }>['failure']; onTopUp: (() => void) | null; onNewPicture: () => void; onEdit: () => void }) {
  const { w } = m;
  useLang();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [at] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  const refusal = refusalOf(w, failure, m.connection?.wallet ?? null, at);
  // Topping up has its place in the terminal only where it stands; elsewhere the way on is to try again.
  const action = refusal.action === 'topUp' && !onTopUp ? 'retry' : refusal.action;
  // Trying again needs the wallet: one that let go is connected first, never a press that does nothing.
  const connect = action === 'retry' && !m.connection;
  const label = connect ? w.connect : refusal.kind === 'poolHalf' ? w.resume : action === refusal.action ? refusal.act : w.tryAgain;
  const act = () => {
    if (connect) return connectOrPick(() => setPicking(true));
    if (action === 'retry') return void m.launch();
    if (action === 'topUp') return onTopUp?.();
    if (action === 'picture') {
      m.dropPicture();
      return onNewPicture();
    }
    m.clearPhase();
    if (action === 'edit') onEdit();
  };
  return (
    <div className={l.refused} role="alert" data-launch-refusal={refusal.kind}>
      <p className={l.refusedWords}>
        <b>{refusal.what}</b>
        <span>{refusal.money}</span>
      </p>
      {picking && connect ? (
        <WalletPick onBack={() => setPicking(false)} />
      ) : (
        <Action onClick={act} data-launch-refusal-act={connect ? 'connect' : action}>
          {label}
        </Action>
      )}
      {refusal.details.length ? (
        <Quiet size="s" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((was) => !was)}>
          {open ? w.hideDetails : w.details}
        </Quiet>
      ) : null}
      {open ? (
        <dl id={id} className={l.refusedDetails}>
          {refusal.details.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** The coin is out: its name, one way on — the coin's own screen — and a quiet «Launch another». */
function Landed({ m, title, mint, line }: { m: LaunchModel; title: string; mint: string; line: string | null }) {
  const router = useRouter();
  return (
    <div className={l.landed} role="status" data-launch-landed="">
      <b className={l.landedTitle}>{title}</b>
      {line ? <span className={l.landedLine}>{line}</span> : null}
      <Action onClick={() => router.push(coinHref(mint, 'live'))}>{m.w.openCoin}</Action>
      <Quiet full onClick={m.another}>
        {m.w.another}
      </Quiet>
    </div>
  );
}

/** The coin is in its pool: when trading opens, counted down. */
function Pooled({ m, pooled }: { m: LaunchModel; pooled: Extract<Phase, { step: 'pooled' }>['pooled'] }) {
  const now = useSeconds();
  const when = useWhen(m);
  const left = now !== null ? pooled.opensAt - now : null;
  const line = left === null ? null : left > 0 ? `${m.w.pooledLine(when(pooled.opensAt, true))} · ${clockLeft(left)}` : m.w.pooledOpen;
  return <Landed m={m} title={m.w.pooledTitle(pooled.symbol)} mint={pooled.mint} line={line} />;
}
