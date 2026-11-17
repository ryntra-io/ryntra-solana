'use client';

import { useEffect, useMemo } from 'react';
import { PIER_GOALS, PIER_STYLES, STYLE_RISK, solShort } from '@/city/lib/earn/pier';
import { EARN_PRO_OPEN, PRO_MAX_LAMPORTS, PRO_MIN_LAMPORTS, PRO_STOPS, bandPct, proAmounts, proChoice, proDepth, proIncome, proName, proOther, proPrice, proReach, proReward, proSol, proSolText, type ProBoat, type ProPier, type ProSummary } from '@/city/lib/earn/pro';
import { PRO_BUSY, PRO_LOCKED, proGoal, proNetwork, useProPier, type ProNotice, type ProTarget } from '@/city/lib/earn/pro-store';
import type { Words } from '@/city/lib/earn/words';
import { digits } from '@/city/lib/i18n/dict';
import { amountText } from '@/city/lib/trade/size';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { Boat } from './Boat';
import { BackGlyph, Coin, Line, RiskDots, SolFigure, Wallets } from './bits';
import { GoalGlyph, StyleGlyph } from './PierCard';
import s from './earn.module.css';
import c from './care.module.css';

/** With a wallet here, the exact Review follows the card after this pause, once per choice. */
const AUTO_REVIEW_MS = 450;
/** The wallet's boats are read again this often while the Piers are on screen. */
const BOATS_MS = 60_000;

/** Whether a Pro pier or a Pro boat is open: then its card is the tab. */
export function useProDocked(): boolean {
  return useProPier((st) => st.pier !== null || st.boat !== null);
}

/**
 * The Pro piers inside the Piers tab: the wallet's Pro boats, and the pools of Meteora DLMM Pro — SOL
 * against a coin Earn knows — each with its depth and, where the pool pays one, its reward a day. Nothing of it is
 * drawn where the switch is closed, the server does not serve it, or the chain shows no pier.
 */
export function ProPiers({ words, owner }: { words: Words; owner: string | null }) {
  const w = words.pro;
  const list = useProPier((st) => st.list);
  const boatsFor = useProPier((st) => st.boats);

  useEffect(() => {
    void useProPier.getState().loadPiers();
  }, []);
  useEffect(() => {
    useProPier.getState().forget();
    if (!owner || list.status !== 'ready') return;
    void useProPier.getState().loadBoats(owner);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && useProPier.getState().phase === 'idle') void useProPier.getState().loadBoats(owner);
    }, BOATS_MS);
    return () => clearInterval(timer);
  }, [owner, list.status]);

  if (!EARN_PRO_OPEN || list.status !== 'ready' || list.value.piers.length === 0) return null;
  const piers = list.value.piers;
  const boats = owner && boatsFor?.owner === owner && boatsFor.value.status === 'ready' ? boatsFor.value.value : [];
  const pierOf = (boat: ProBoat) => piers.find((pier) => pier.address === boat.pool) ?? null;

  return (
    <>
      {boats.length ? (
        <div className={s.dock}>
          <span className={s.kicker}>{w.boats}</span>
          <ul className={s.boats}>
            {boats.map((boat) => {
              const pier = pierOf(boat);
              if (!pier) return null;
              const fees = BigInt(boat.fees.lamports);
              const state = boat.empty ? words.pier.outOfRange : boat.inRange ? words.pier.inRange : words.pier.outOfRange;
              return (
                <li key={boat.nftMint}>
                  <button type="button" className={`${s.boatTile} ${boat.inRange ? s.boatLit : ''}`} onClick={() => useProPier.getState().openBoat(boat)} aria-label={`${proName(pier)} · ${state}`}>
                    <Boat lit={boat.inRange} size={72} />
                    <b>{proName(pier)}</b>
                    {boat.cared ? <small className={s.nameMark}>{w.cared}</small> : null}
                    {fees > 0n ? <span className={s.gain}>+{digits(solShort(fees))} SOL</span> : <span>{state}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <span className={s.kicker}>{w.piers}</span>
      <ul className={s.rows}>
        {piers.map((pier) => {
          const other = proOther(pier);
          const reward = proReward(pier);
          const depth = proDepth(pier);
          return (
            <li key={pier.address}>
              <button type="button" className={`${s.pierRow} ${s.pierHit}`} onClick={() => useProPier.getState().openPier(pier)}>
                <span className={s.pierCoins} aria-hidden="true">
                  <Coin mint={other.mint} size={28} symbol={other.symbol} />
                  <Coin mint={proSol(pier).mint} size={28} symbol="SOL" />
                </span>
                <span className={s.names}>
                  <b>
                    {proName(pier)}
                    <span className={s.nameMark}>
                      {' · '}
                      {w.mark}
                    </span>
                  </b>
                  <span>
                    {words.pier.depth} {depth !== null ? `${digits(depth)} SOL` : '—'} · {words.pier.tradeFee} {digits(`${Number((pier.feeBps / 100).toFixed(3))}%`)}
                  </span>
                </span>
                {reward ? (
                  <span className={s.figures}>
                    <b className={s.gain}>{digits(reward.perDay)}</b>
                    <span>
                      {w.rewards24h} · {reward.symbol}
                    </span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The card of whatever is open — a Pro pier or a Pro boat; null when neither is. */
export function ProDock({ words }: { words: Words }) {
  const pier = useProPier((st) => st.pier);
  const boat = useProPier((st) => st.boat);
  const list = useProPier((st) => st.list);
  if (pier) return <ProPierCard words={words} pier={pier} />;
  if (boat) {
    const of = list.status === 'ready' ? list.value.piers.find((entry) => entry.address === boat.pool) ?? null : null;
    return of ? <ProBoatCard words={words} pier={of} boat={boat} care={list.status === 'ready' && list.value.care} /> : null;
  }
  return null;
}

/** The Review's summary of an opening, when the reviewed action is one. */
const openOf = (summary: ProSummary | null) => (summary?.action === 'open' ? summary : null);

/**
 * One Pro pier: the amount in SOL, the width, the goal, the one line before the signature and the one amber action —
 * «Put in». The pool itself swaps the part of the SOL the other coin needs and the position opens, in one approval of
 * the wallet. The line says the pool's fee on that swap, the band of the price outside which nothing lands, and what
 * leaving the range means; everything else is behind «Details».
 */
function ProPierCard({ words, pier }: { words: Words; pier: ProPier }) {
  const w = words.pro;
  const p = words.pier;
  const style = useProPier((st) => st.style);
  const picked = useProPier((st) => st.goal);
  const goal = proGoal(pier, picked);
  const typed = useProPier((st) => st.typed);
  const phase = useProPier((st) => st.phase);
  const reviewed = useProPier((st) => st.reviewed);
  const notice = useProPier((st) => st.notice);
  const outcome = useProPier((st) => st.outcome);
  const connection = useWallet((st) => st.connection);
  const holdingsFor = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const holdings = holdingsFor && holdingsFor.owner === owner ? holdingsFor : null;
  const choice = useMemo(() => proChoice(pier, style, goal, typed, holdings, owner), [pier, style, goal, typed, holdings, owner]);
  const shown = reviewed && choice.key && reviewed.key === choice.key ? reviewed : null;
  const summary = openOf(shown?.review.summary ?? null);
  const busy = PRO_BUSY.has(phase);
  const other = proOther(pier);

  // The exact Review of what is on the card, while the person reads it.
  useEffect(() => {
    if (!connection || !choice.key || phase !== 'idle' || notice || shown) return;
    const timer = setTimeout(() => void useProPier.getState().prepare(connection, { kind: 'open' }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, choice.key, phase, notice, shown]);

  if (outcome) return <ProOutcome words={words} pier={pier} />;

  const problem = typed && choice.problem ? (choice.problem === 'min' ? w.problem.min(digits(solShort(PRO_MIN_LAMPORTS))) : choice.problem === 'max' ? w.problem.max(digits(solShort(PRO_MAX_LAMPORTS))) : w.problem[choice.problem]('')) : null;
  const feePct = digits(`${Number((pier.feeBps / 100).toFixed(3))}%`);
  const band = summary ? digits(bandPct(summary.bandBps)) : '…';
  const stays = summary && BigInt(summary.staysLamports) * 50n > (choice.lamports ?? 0n) ? summary.staysLamports : null;

  return (
    <section className={s.saver} aria-label={proName(pier)}>
      <button type="button" className={s.back} onClick={() => useProPier.getState().back()} disabled={PRO_LOCKED.has(phase)}>
        <BackGlyph />
        {words.back}
      </button>
      <div className={s.cardHead}>
        <span className={s.pierTitle}>
          <span className={s.pierCoins} aria-hidden="true">
            <Coin mint={other.mint} size={30} symbol={other.symbol} />
            <Coin mint={proSol(pier).mint} size={30} symbol="SOL" />
          </span>
          <h3 className={`${s.display} ${s.productName}`}>
            {proName(pier)}
            <span className={s.nameMark}> · {w.mark}</span>
          </h3>
        </span>
        <RiskDots dots={STYLE_RISK[style]} words={words} />
      </div>

      <div className={s.styles} role="radiogroup" aria-label={p.style}>
        {PIER_STYLES.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={style === id} className={`${s.styleButton} ${style === id ? s.styleOn : ''}`} onClick={() => useProPier.getState().setStyle(id)} disabled={busy}>
            <StyleGlyph style={id} />
            <b>{p.styles[id]}</b>
            <span>±{digits(`${Number(proReach(pier, id).toFixed(proReach(pier, id) < 1 ? 2 : 1))}%`)}</span>
          </button>
        ))}
      </div>
      <div className={s.styles} role="radiogroup" aria-label={p.goal}>
        {PIER_GOALS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={goal === id} className={`${s.styleButton} ${goal === id ? s.styleOn : ''}`} onClick={() => useProPier.getState().setGoal(id)} disabled={busy}>
            <GoalGlyph goal={id} />
            <b>{p.goals[id]}</b>
          </button>
        ))}
      </div>

      <label className={s.kicker} htmlFor="earn-pro-amount">
        {p.amount}
      </label>
      <div className={s.field}>
        <input
          id="earn-pro-amount"
          className={`${s.input} ${s.amount}`}
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          onChange={(event) => useProPier.getState().setTyped(event.target.value)}
          disabled={busy}
          aria-invalid={Boolean(problem)}
        />
        <span className={s.unit}>SOL</span>
        {choice.max !== null && choice.max > 0n ? (
          <button type="button" className={s.inline} onClick={() => useProPier.getState().setTyped(amountText(choice.max!, 9))} disabled={busy}>
            {p.max}
          </button>
        ) : null}
      </div>
      {summary ? (
        <p className={s.goesIn}>
          {digits(w.goesIn(proAmounts(pier, summary.goesIn.xRaw, summary.goesIn.yRaw)))}
          {stays ? ` · ${digits(w.stays(proSolText(stays)))}` : ''}
        </p>
      ) : null}

      <Line
        label={words.details}
        line={
          <>
            {w.poolFee(feePct)} · {w.band(band)} · {p.risk}
          </>
        }
      >
        <p className={s.fine}>{w.bandLong}</p>
        <dl className={s.dl}>
          <dt>{p.range}</dt>
          <dd>{summary ? `${digits(proPrice(summary.lowerPrice))} – ${digits(proPrice(summary.upperPrice))} ${pier.y.symbol}` : '…'}</dd>
          <dt>{p.goal}</dt>
          <dd>{p.goals[goal]}</dd>
          <dt>{w.venueName}</dt>
          <dd>{summary ? w.onePosition(summary.ranges) : '…'}</dd>
          <dt>{w.swapFirst}</dt>
          <dd>{summary ? `${digits(proSolText(summary.swap.lamports))} SOL → ${other.symbol}` : '…'}</dd>
          <dt>{p.ryntraFee}</dt>
          <dd>0</dd>
          <dt>{w.deposit}</dt>
          <dd>{summary ? `${digits(proSolText(summary.depositLamports))} SOL, ${w.depositBack}` : '…'}</dd>
          <dt>{p.network}</dt>
          <dd>{summary ? `${digits(proSolText(summary.networkLamports))} SOL` : '…'}</dd>
        </dl>
        {shown ? <p className={s.fine}>{p.approval(shown.review.transactions.length)}</p> : null}
        <p className={s.fine}>{w.fineOpen}</p>
        {summary?.swap.referral ? <p className={s.fine}>{w.referral}</p> : null}
        <p className={s.fine}>{w.fine}</p>
      </Line>

      {problem ? <p className={`${s.note} ${s.noteWarn}`}>{problem}</p> : null}
      <ProNote notice={notice} />

      <div className={s.grow} />
      <ProAction
        words={words}
        verb={p.put}
        ready={Boolean(shown)}
        blocked={connection && (choice.problem || !pier.takesDeposits) ? p.put : null}
        onPrepare={() => connection && void useProPier.getState().prepare(connection, { kind: 'open' }, holdings)}
      />
    </section>
  );
}

type BoatKind = Exclude<ProTarget['kind'], 'open'>;

/**
 * A Pro boat's own card: what it holds, what it earned in two lines — the fees, and the pool's reward — and what to
 * do with it: take and put back, take, leave; an agent's care by one approval, with the stop as three chips. One thing
 * is chosen, its exact figures follow, and the one amber action signs it.
 */
function ProBoatCard({ words, pier, boat, care }: { words: Words; pier: ProPier; boat: ProBoat; care: boolean }) {
  const w = words.pro;
  const p = words.pier;
  const phase = useProPier((st) => st.phase);
  const target = useProPier((st) => st.target);
  const reviewed = useProPier((st) => st.reviewed);
  const notice = useProPier((st) => st.notice);
  const outcome = useProPier((st) => st.outcome);
  const stop = useProPier((st) => st.stop);
  const connection = useWallet((st) => st.connection);
  const holdings = useWallet((st) => st.holdings);
  const busy = PRO_BUSY.has(phase);
  const income = proIncome(pier, boat);
  const acting = target && target.kind !== 'open' && target.nftMint === boat.nftMint ? target : null;
  const shown = acting && reviewed && reviewed.review.action === acting.kind ? reviewed : null;
  const summary = shown?.review.summary ?? null;
  const choose = (kind: BoatKind) => {
    if (!connection || busy) return;
    void useProPier.getState().prepare(connection, { kind, nftMint: boat.nftMint }, holdings);
  };
  const hasFees = income.feesLamports > 0n;
  const hasLiquidity = BigInt(boat.worth.lamports) > 0n;

  if (outcome) return <ProOutcome words={words} pier={pier} />;

  // One row of what there is to do: an empty boat only gives its deposit back.
  const kinds: readonly BoatKind[] = boat.empty ? ['close'] : hasLiquidity ? ['compound', 'collect', 'leave'] : ['collect', 'close'];
  const verb: Readonly<Record<BoatKind, string>> = { compound: w.compound, collect: w.collect, leave: w.leave, close: w.close, care_on: w.careOn, care_off: w.careOff };
  const careRow = boat.care;
  const careNote = !boat.cared && careRow?.status === 'stopped' && careRow.stoppedBy ? w.stopped[careRow.stoppedBy] : null;

  return (
    <section className={s.saver} aria-label={proName(pier)}>
      <button type="button" className={s.back} onClick={() => useProPier.getState().back()} disabled={PRO_LOCKED.has(phase)}>
        <BackGlyph />
        {words.back}
      </button>
      <div className={`${s.boatHero} ${boat.inRange ? s.boatLit : ''}`}>
        <Boat lit={boat.inRange} size={120} />
        <div className={s.boatName}>
          <h3 className={`${s.display} ${s.productName}`}>
            {proName(pier)}
            <span className={s.nameMark}> · {w.mark}</span>
          </h3>
          <span className={boat.inRange ? s.gain : s.dim}>{boat.inRange ? p.inRange : p.outOfRange}</span>
        </div>
      </div>
      <div className={s.headline}>
        <span className={s.headFigure}>
          <span className={s.kicker}>{w.fees} · SOL</span>
          <SolFigure lamports={income.feesLamports} unit={false} />
        </span>
        {income.rewards.length ? (
          <span className={s.headFigure}>
            <span className={s.kicker}>
              {w.rewards}
              {income.rewards[0]!.running ? ` · ${w.running}` : ''}
            </span>
            <b className={`${s.figure} ${s.gain}`}>{digits(income.rewards[0]!.text)}</b>
          </span>
        ) : null}
      </div>
      <Line
        label={words.details}
        line={
          <>
            {w.holds} {digits(proSolText(boat.worth.lamports))} SOL{boat.inRange || boat.empty ? '' : ` · ${p.outOfRange}`}
          </>
        }
      >
        <dl className={s.dl}>
          <dt>{w.holds}</dt>
          <dd>{digits(proAmounts(pier, boat.worth.xRaw, boat.worth.yRaw)) || '—'}</dd>
          <dt>{p.range}</dt>
          <dd>
            {digits(proPrice(boat.lowerPrice))} – {digits(proPrice(boat.upperPrice))} {pier.y.symbol}
          </dd>
          <dt>{w.venueName}</dt>
          <dd>{w.onePosition(boat.ranges)}</dd>
          {income.rewards.length ? (
            <>
              <dt>{w.rewards}</dt>
              <dd>
                {w.atLeast} {digits(income.rewards.map((reward) => reward.text).join(' + '))}
              </dd>
            </>
          ) : null}
        </dl>
        {boat.inRange || boat.empty ? null : <p className={s.fine}>{w.outOfRange}</p>}
        <p className={s.fine}>{w.fine}</p>
      </Line>

      {boat.cared || (care && !boat.empty && hasLiquidity) ? (
        <div className={`${c.care} ${boat.cared ? c.careOn : ''}`}>
          <button type="button" role="switch" aria-checked={boat.cared} className={c.row} onClick={() => choose(boat.cared ? 'care_off' : 'care_on')} disabled={busy || !connection}>
            <span className={c.glyph} aria-hidden="true">
              <AgentGlyph />
            </span>
            <span className={c.names}>
              <b>{w.care}</b>
              <span>{boat.cared && !care ? w.carePaused : boat.cared && careRow && careRow.claimedInY > 0 ? digits(w.careToday(proPrice(careRow.claimedInY), pier.y.symbol)) : w.careLine}</span>
            </span>
            <span className={c.toggle} aria-hidden="true">
              <span />
            </span>
          </button>
          {!boat.cared && acting?.kind === 'care_on' ? (
            <div className={c.stops} role="radiogroup" aria-label={w.stop}>
              <span className={c.stopLabel}>{w.stop}</span>
              {PRO_STOPS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  role="radio"
                  aria-checked={stop === pct}
                  className={`${c.chip} ${stop === pct ? c.chipOn : ''}`}
                  onClick={() => {
                    useProPier.getState().setStop(pct);
                    choose('care_on');
                  }}
                  disabled={busy}
                >
                  {digits(w.stops[pct])}
                </button>
              ))}
            </div>
          ) : null}
          <details className={c.details}>
            <summary>{words.details}</summary>
            <p className={s.fine}>{w.careFine}</p>
            <p className={s.fine}>{w.wrapped}</p>
          </details>
        </div>
      ) : null}
      {careNote ? <p className={s.fine}>{careNote}</p> : null}

      <div className={s.pair2} role="radiogroup" aria-label={proName(pier)}>
        {kinds.map((kind) => (
          <button key={kind} type="button" role="radio" aria-checked={acting?.kind === kind} className={`${s.display} ${s.secondary} ${acting?.kind === kind ? s.chosen : ''}`} onClick={() => choose(kind)} disabled={busy || !connection || ((kind === 'compound' || (kind === 'collect' && income.rewards.length === 0)) && !hasFees)}>
            {verb[kind]}
          </button>
        ))}
      </div>

      {summary && acting ? (
        <ProFigures words={words} pier={pier} summary={summary} />
      ) : acting && phase === 'reviewing' ? (
        <div className={s.bones} aria-busy="true">
          <span />
        </div>
      ) : null}
      <ProNote notice={notice} />
      <div className={s.grow} />
      {!connection ? <Wallets words={words} /> : acting ? <ProAction words={words} verb={verb[acting.kind]} ready={Boolean(shown)} blocked={null} onPrepare={() => choose(acting.kind)} /> : null}
    </section>
  );
}

/** What the chosen action does, in the Review's own numbers: one bold figure and one quiet line under it. */
function ProFigures({ words, pier, summary }: { words: Words; pier: ProPier; summary: ProSummary }) {
  const w = words.pro;
  const p = words.pier;
  const network = `${p.network} ${digits(proSolText(summary.networkLamports))} SOL`;
  const rewards = 'rewards' in summary && summary.rewards.length ? summary.rewards.filter((reward) => reward.symbol !== null && BigInt(reward.leastRaw) > 0n) : [];
  const rewardText = rewards.map((reward) => `${proAmountOf(pier, reward.mint, reward.leastRaw)} ${reward.symbol}`).join(' + ');
  if (summary.action === 'compound') {
    return (
      <div className={s.get}>
        <span className={s.kicker}>{w.compound}</span>
        <b>{digits(proAmounts(pier, summary.collected.xRaw, summary.collected.yRaw))}</b>
        <span>
          {digits(w.band(bandPct(summary.bandBps)))} · {network} · {p.stays}
        </span>
      </div>
    );
  }
  if (summary.action === 'collect') {
    const fees = summary.fees ? proAmounts(pier, summary.fees.xRaw, summary.fees.yRaw) : '';
    return (
      <div className={s.get}>
        <span className={s.kicker}>{p.youTake}</span>
        <b>{digits([fees, rewardText].filter(Boolean).join(' + ')) || p.nothingToTake}</b>
        <span>
          {network} · {p.stays}
        </span>
      </div>
    );
  }
  if (summary.action === 'leave') {
    return (
      <div className={s.get}>
        <span className={s.kicker}>{p.youGetBack}</span>
        <b>{digits(proAmounts(pier, summary.expected.xRaw, summary.expected.yRaw)) || '—'}</b>
        <span>
          {w.least} {digits(proAmounts(pier, summary.minimum.xRaw, summary.minimum.yRaw)) || '0'} · {digits(w.band(bandPct(summary.bandBps)))} · {network}
        </span>
      </div>
    );
  }
  if (summary.action === 'care_on') {
    return (
      <div className={s.get}>
        <span className={s.kicker}>{w.care}</span>
        <b>{summary.stopBelow !== null ? digits(w.stopAt(summary.stopCoin, proPrice(summary.stopBelow), summary.stopUnit)) : w.stops[0]}</b>
        <span>
          {w.careLine} · {network}
        </span>
      </div>
    );
  }
  return (
    <div className={s.get}>
      <span className={s.kicker}>{summary.action === 'close' ? w.close : w.careOff}</span>
      <span>{network}</span>
    </div>
  );
}

/** A reward's raw amount in its own coin's short form, where the coin is one of the pier's. */
function proAmountOf(pier: ProPier, mint: string, raw: string): string {
  const decimals = mint === pier.x.mint ? pier.x.decimals : mint === pier.y.mint ? pier.y.decimals : 0;
  return solShort(Number(BigInt(raw)) / 10 ** decimals);
}

function ProNote({ notice }: { notice: ProNotice | null }) {
  if (!notice) return null;
  return (
    <p className={`${s.note} ${notice.tone === 'warn' ? s.noteWarn : s.noteError}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </p>
  );
}

/** The one amber action: connect, build the exact Review, sign it, or say plainly why not. */
function ProAction({ words, verb, ready, blocked, onPrepare }: { words: Words; verb: string; ready: boolean; blocked: string | null; onPrepare: () => void }) {
  const p = words.pier;
  const phase = useProPier((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  if (!connection) return <Wallets words={words} />;
  const waiting = phase === 'reviewing' || phase === 'wallet' || phase === 'sending';
  const label = phase === 'reviewing' ? p.building : phase === 'wallet' ? p.wallet : phase === 'sending' ? p.sending : blocked ?? verb;
  const press = () => {
    if (ready) void useProPier.getState().confirm(connection, useWallet.getState().holdings);
    else onPrepare();
  };
  return (
    <button type="button" className={`${s.display} ${s.action} ${s.cta} ${waiting ? s.waiting : ''}`} onClick={press} disabled={waiting || Boolean(blocked)}>
      {label}
    </button>
  );
}

/** What happened, in the window's words: done, partly, not at all, or not known yet — never sent twice. */
function ProOutcome({ words, pier }: { words: Words; pier: ProPier }) {
  const w = words.pro;
  const p = words.pier;
  const outcome = useProPier((st) => st.outcome);
  const phase = useProPier((st) => st.phase);
  const sent = useProPier((st) => st.sent);
  const connection = useWallet((st) => st.connection);
  if (!outcome) return null;
  const action = sent?.review.action ?? 'open';
  const good = outcome.kind === 'done';
  const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? outcome.signatures.at(-1) ?? null : null;
  const word = good ? w.done[action] : outcome.kind === 'partial' ? (action === 'open' ? w.partialOpen(proOther(pier).symbol) : w.partial) : outcome.kind === 'failed' ? p.failed : p.unknown;
  return (
    <section className={s.saver}>
      <div className={`${s.result} ${good ? s.resultGood : ''}`} role="status">
        {good ? (
          <>
            <span className={`${s.display} ${s.resultWord}`}>{word}</span>
            <p className={s.fine}>{w.doneLine[action]}</p>
          </>
        ) : (
          <p className={s.lead}>{word}</p>
        )}
        {signature ? (
          <a className={s.link} href={explorerTxUrl(proNetwork(), signature)} target="_blank" rel="noreferrer">
            {p.explorer}
          </a>
        ) : null}
      </div>
      <div className={s.grow} />
      {outcome.kind === 'unknown' && connection ? (
        <button type="button" className={`${s.display} ${s.action} ${phase === 'sending' ? s.waiting : ''}`} onClick={() => void useProPier.getState().recheck(connection.address)} disabled={phase === 'sending'}>
          {phase === 'sending' ? p.sending : p.checking}
        </button>
      ) : (
        <button type="button" className={`${s.display} ${good ? s.action : s.secondary}`} onClick={() => useProPier.getState().again()}>
          {good || outcome.kind === 'partial' ? p.toPiers : p.again}
        </button>
      )}
    </section>
  );
}

function AgentGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d="M12 5.5l1.6 4.2 4.4.4-3.4 2.8 1.1 4.3L12 14.8 8.3 17.2l1.1-4.3L6 10.1l4.4-.4z" fill="currentColor" />
    </svg>
  );
}
