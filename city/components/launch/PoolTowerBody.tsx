'use client';

import { useEffect, useRef, useState } from 'react';
import { launchEngine, launchPoolEngine, launchWallet, useLaunch } from '@/city/lib/launch/district';
import type { Phase } from '@/city/lib/launch/flow';
import { POOL_DEFAULT, POOL_LADDER, countdown, phaseAt, shieldLeft, usePool, type PoolStage, feeText } from '@/city/lib/launch/pool';
import { runPoolLaunch } from '@/city/lib/launch/pool-flow';
import { num, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { clock } from './LaunchDoors';
import { useSeconds } from './PoolDoor';
import s from './launch.module.css';
import p from './pool.module.css';
import { POOL_WORDS } from './pool-words';

/** How often an open tower window reads its launch again. */
const READ_EVERY_MS = 15_000;

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);

const short = (signature: string) => `${signature.slice(0, 4)}…${signature.slice(-4)}`;
/** Whole coins of a launch — six decimals, as every launch mints — in the language's own way. */
const coins = (raw: string) => num(Number(BigInt(raw) / 1_000_000n), { maximumFractionDigits: 0 });

/**
 * The window of a tower launched straight into a pool: one big figure — the countdown to its opening, then
 * how far the price stands from its first — two facts, and one quiet line: the launch was checked on chain. What the
 * check read, where the fee settles, who earns the locked liquidity's fees and the launch's own transactions are behind
 * «Details». Every figure is the engine's read of the chain; one it did not read is said as not read, never a zero.
 *
 * A launch its creator left half-way shows them one button: the step that is next.
 */
export function PoolTowerBody({ mint }: { mint: string }) {
  const listed = usePool((st) => st.launches.find((launch) => launch.mint === mint) ?? null);
  const view = usePool((st) => st.views[mint] ?? null);
  const setView = usePool((st) => st.setView);
  const network = useLaunch((st) => st.network);
  const stub = useLaunch((st) => st.stub);
  const connection = useLaunch((st) => st.connection);
  const poolSwitch = usePool((st) => st.switchOpen);
  const w = useWords(POOL_WORDS);
  useLang();
  const now = useSeconds();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    const read = async () => {
      const answer = await (await launchPoolEngine()).view(mint).catch(() => null);
      if (live && answer?.ok) setView(answer.data);
    };
    void read();
    const timer = setInterval(() => void read(), READ_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [mint, setView]);

  if (!listed) return null;
  const opensAt = view?.opensAt ?? listed.opensAt;
  const stage = view ? (view.next === null ? phaseAt({ phase: 'COUNTDOWN', opensAt }, now) : 'BUILDING') : phaseAt(listed, now);
  const left = opensAt - now;
  const times = view && view.price.start && view.price.now ? view.price.now / view.price.start : null;
  const shield = view ? shieldLeft(view.fee) : null;
  const mine = connection?.address === listed.creator;
  const next = view?.next ?? null;
  const stepName = (step: PoolStage) => (step === 'COIN' ? w.stepCoin : step === 'POOL' ? w.stepPool : w.stepSupply);
  const explorer = (signature: string) => `https://solscan.io/tx/${signature}${network === 'solana:devnet' ? '?cluster=devnet' : ''}`;
  const working = phase !== null && phase.step !== 'failed' && phase.step !== 'pooled';

  const resume = async () => {
    if (busy.current || !connection || !network) return;
    busy.current = true;
    try {
      const wallet = await launchWallet();
      const result = await runPoolLaunch({
        engine: launchEngine(),
        pool: await launchPoolEngine(),
        signer: wallet.signer(connection),
        fields: { name: listed.name, symbol: listed.symbol, picture: { base64: '', url: '' } },
        network,
        choice: POOL_DEFAULT,
        resume: mint,
        onPhase: setPhase,
        switchOpen: stub || undefined,
        poolSwitch,
        poolWord: stub || undefined,
      });
      if (result.step === 'pooled') {
        setPhase(null);
        const answer = await (await launchPoolEngine()).view(mint).catch(() => null);
        if (answer?.ok) setView(answer.data);
      }
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className={s.body} data-pool-tower={stage}>
      <div className={`${p.hero} ${stage === 'OPEN' ? p.heroOpen : ''}`}>
        <div className={p.heroLabel}>
          <span className={p.dot} aria-hidden="true" />
          {stage === 'COUNTDOWN' ? w.opensIn : stage === 'OPEN' ? w.openNow : w.building}
        </div>
        {stage === 'COUNTDOWN' ? (
          <>
            <b className={`${s.display} ${p.heroFigure}`} data-pool-countdown="">
              {countdown(left)}
            </b>
            <span className={p.heroTime}>{w.setLine(clock(opensAt))}</span>
          </>
        ) : stage === 'OPEN' ? (
          <b className={`${s.display} ${p.heroFigure}`}>{times !== null ? w.priceTimes(num(times, { maximumFractionDigits: 2 })) : '—'}</b>
        ) : (
          <span className={p.heroTime}>{w.setLine(clock(opensAt))}</span>
        )}
        {shield !== null && stage !== 'BUILDING' && (
          <div className={p.shield} role="img" aria-label={`${w.feeNow}: ${view && view.fee.nowBps !== null ? feeText(view.fee.nowBps) : ''}`}>
            <i style={{ width: `${Math.round(shield * 100)}%` }} />
          </div>
        )}
      </div>

      {stage !== 'BUILDING' && (
        <div className={s.facts}>
          <div className={s.fact}>
            <span>{w.feeNow}</span>
            <b className={s.display}>{view && view.fee.nowBps !== null ? feeText(view.fee.nowBps) : '—'}</b>
          </div>
          <div className={s.fact}>
            <span>{w.price}</span>
            <b className={s.display}>{times !== null ? w.priceTimes(num(times, { maximumFractionDigits: 2 })) : '—'}</b>
          </div>
        </div>
      )}

      {view && view.honest !== null && (
        <div className={p.honest} data-pool-honest={view.honest ? 'yes' : 'no'}>
          <span>{view.honest ? w.honest : w.notHonest}</span>
          <span className={`${p.mark} ${view.honest ? '' : p.markOff}`}>{view.honest ? CHECK : CROSS}</span>
          <button type="button" className={p.more} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            {open ? w.hideDetails : w.towerDetails}
          </button>
        </div>
      )}
      {open && view && (
        <dl className={p.details}>
          {view.fee.endBps !== null && (
            <div>
              <dt>{w.factFee}</dt>
              <dd>{w.feeSettles(feeText(view.fee.endBps, true))}</dd>
            </div>
          )}
          {view.split && (
            <div>
              <dt>{view.ladder ? w.lineLockedPart(feeText(10_000 - POOL_LADDER.shareBps)) : w.lineLocked}</dt>
              <dd>{w.split(feeText(view.split.creatorBps), feeText(view.split.ryntraBps))}</dd>
            </div>
          )}
          {view.ladder && (
            <div data-pool-ladder={view.ladder.state ?? 'unread'}>
              <dt>{w.ladder}</dt>
              <dd>
                {view.ladder.state === 'CLOSED'
                  ? w.ladderClosed
                  : view.ladder.state === 'WAITING'
                    ? w.ladderWaiting
                    : view.ladder.leftRaw !== null
                    ? w.ladderLeft(`${coins(view.ladder.leftRaw)} $${view.symbol}`, `×${num(view.ladder.nearMultiple)}`, `×${num(view.ladder.farMultiple)}`)
                    : w.noRead}
              </dd>
            </div>
          )}
          {!view.honest && view.problems.length > 0 && (
            <div>
              <dt>{w.notHonest}</dt>
              {view.problems.map((problem) => (
                <dd key={problem}>{problem}</dd>
              ))}
            </div>
          )}
          <div>
            <dt>{w.receipt}</dt>
            <dd className={p.receipt}>
              {(
                [
                  [w.receiptCoin, view.receipt.COIN],
                  [w.receiptPool, view.receipt.POOL],
                  [w.receiptSupply, view.receipt.SUPPLY],
                ] as const
              ).flatMap(([label, signatures]) =>
                signatures.map((signature, index) => (
                  <a key={signature} href={explorer(signature)} target="_blank" rel="noreferrer">
                    {label}
                    {signatures.length > 1 ? ` ${index + 1}` : ''} · {short(signature)}
                  </a>
                )),
              )}
            </dd>
          </div>
        </dl>
      )}

      {mine && next !== null && (
        <div className={p.resume} data-pool-resume="">
          {working && phase ? (
            <div className={s.progress} role="status" aria-live="polite">
              <span className={s.spinner} aria-hidden="true" />
              <div>
                <div className={`${s.display} ${s.progressTitle}`}>{w.stepOf(next === 'COIN' ? 1 : next === 'POOL' ? 2 : 3, 3)}</div>
                <div className={s.progressLine}>
                  {phase.step === 'sign' ? w.signStep(stepName(next)) : w.sendingStep(stepName(next))}
                  {phase.step === 'sign' && next === 'POOL' && phase.pool?.opensAt ? ` · ${w.setLine(clock(phase.pool.opensAt))}` : ''}
                </div>
              </div>
            </div>
          ) : (
            <>
              <span className={p.resumeLine}>{phase?.step === 'failed' ? w.halfWay : w.resumeLine}</span>
              <button type="button" className={`${s.display} ${s.action} ${s.actionBig}`} onClick={() => void resume()}>
                {w.resume(stepName(next))}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
