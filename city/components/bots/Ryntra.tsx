'use client';

import { useEffect, useId, useState } from 'react';
import type { HangarBot } from '@/lib/bots/hangar/hangar';
import type { WindowRun } from '@/lib/assistant/bots/advice';
import type { Pick } from '@/lib/assistant/bots/tools';
import { AMOUNTS } from '@/city/lib/bots/draft';
import { pct, signedUsd, usd } from '@/city/lib/bots/format';
import { explainKey, HORIZONS, simulateKey, suggestKey, useRyntraBots } from '@/city/lib/bots/ryntra';
import { useBots, type Coin } from '@/city/lib/bots/store';
import type { Words } from '@/city/lib/bots/words';
import { CheckGlyph, ChevronGlyph, KindGlyph, SparkGlyph } from './glyphs';
import { useWords } from './hooks';
import s from './bots.module.css';

/**
 * Ryntra in the bots window (CITY-133): the assistant line's bot tools, asked with taps — the coin, the horizon, the
 * amount — never with words, so the window keeps no second ask box. On «Start» Ryntra names the week's bot with one
 * line and does the setting up: «Set it up for me» opens its draft in the window's own review, where «Start» is the
 * person's tap, on paper. The reasons, the alternative and the replay over 7, 30 and 180 days wait behind «Details».
 */
export function RyntraCard({ coin }: Readonly<{ coin: Coin | null }>) {
  const { w, lang } = useWords();
  const r = w.ryntra;
  const amount = useBots((st) => st.flowAmount);
  const horizon = useRyntraBots((st) => st.horizon);
  const drafting = useRyntraBots((st) => st.drafting);
  const key = coin ? suggestKey(coin.mint, horizon, amount, lang) : '';
  const entry = useRyntraBots((st) => (key ? st.suggestions[key] : undefined));
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  useEffect(() => {
    if (coin) void useRyntraBots.getState().suggest(coin, amount, lang);
  }, [coin, amount, horizon, lang]);

  if (!coin) return null;
  const answer = entry?.status === 'ready' ? entry.answer : null;
  const pick = answer && answer.ask === null ? answer.pick : null;
  const alternative = answer && answer.ask === null ? answer.alternative : null;
  const loading = !entry || entry.status === 'loading';
  const setUp = () => {
    if (pick) void useRyntraBots.getState().draft(coin, pick.kind, amount, horizon, lang);
  };

  return (
    <section className={s.ryntra} aria-label={r.name} aria-busy={loading} data-bots-ryntra="">
      <header className={s.ryntraHead}>
        <span className={s.ryntraName}>
          <SparkGlyph size={18} />
          {r.name}
        </span>
        <div className={s.ryntraSeg} role="radiogroup" aria-label={r.horizonLabel}>
          {HORIZONS.map((h) => (
            <button key={h} type="button" role="radio" aria-checked={h === horizon} className={h === horizon ? s.ryntraSegOn : undefined} onClick={() => useRyntraBots.getState().setHorizon(h)}>
              {r.horizon[h]}
            </button>
          ))}
        </div>
      </header>

      <div aria-live="polite">
        {loading ? (
          <div className={s.ryntraPending} role="status" aria-label={r.reading}>
            <span />
            <span />
          </div>
        ) : answer ? (
          <>
            <p className={s.ryntraLine}>
              {pick ? (
                <span className={s.ryntraGlyph}>
                  <KindGlyph kind={pick.kind} size={20} />
                </span>
              ) : null}
              {answer.line}
            </p>
            {answer.ask === null && answer.detail ? <p className={s.ryntraDetail}>{answer.detail}</p> : null}
          </>
        ) : (
          <p className={s.ryntraDetail}>{entry.status === 'none' && entry.line ? entry.line : r.away}</p>
        )}
      </div>

      <div className={s.ryntraActions}>
        <div className={s.chips} role="radiogroup" aria-label={w.field.amount}>
          {AMOUNTS.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={v === amount} className={v === amount ? s.chipOn : undefined} onClick={() => useBots.getState().setFlowAmount(v)}>
              {usd(v, lang)}
            </button>
          ))}
        </div>
        <button type="button" className={`${s.primary} ${s.ryntraGo}`} onClick={setUp} disabled={!pick || drafting} aria-busy={drafting}>
          <SparkGlyph size={18} />
          {drafting ? r.drafting : r.setUp}
        </button>
      </div>

      {pick ? (
        <>
          <button type="button" className={s.more} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)} data-open={open ? '' : undefined}>
            {r.details}
            <ChevronGlyph />
          </button>
          {open ? <RyntraDetails id={detailsId} coin={coin} pick={pick} alternative={alternative} amount={amount} /> : null}
        </>
      ) : null}
    </section>
  );
}

/** Behind «Details»: why this bot, the alternative, and the replay over 7, 30 and 180 days with the stress test. */
function RyntraDetails({ id, coin, pick, alternative, amount }: Readonly<{ id: string; coin: Coin; pick: Pick; alternative: Pick | null; amount: number }>) {
  const { w, lang } = useWords();
  const r = w.ryntra;
  const horizon = useRyntraBots((st) => st.horizon);
  const entry = useRyntraBots((st) => st.simulations[simulateKey(coin.mint, pick.kind, amount, horizon, lang)]);
  useEffect(() => {
    void useRyntraBots.getState().simulate(coin, pick.kind, amount, horizon, lang);
  }, [coin, pick.kind, amount, horizon, lang]);
  const sim = entry?.status === 'ready' ? entry.answer : null;
  return (
    <div id={id} className={s.ryntraMore}>
      <div className={s.ryntraPart}>
        <h4 className={s.kicker}>{r.why}</h4>
        <ul className={s.reasons}>
          {pick.reasons.map((reason) => (
            <li key={reason}>
              <CheckGlyph />
              {reason}
            </li>
          ))}
        </ul>
      </div>
      {alternative ? (
        <div className={s.ryntraPart}>
          <h4 className={s.kicker}>{r.instead}</h4>
          <p className={s.ryntraAlt}>
            <span className={s.ryntraGlyph}>
              <KindGlyph kind={alternative.kind} size={18} />
            </span>
            <b>{w.kind[alternative.kind]}</b>
            {alternative.run.ok ? <Gain run={alternative.run} w={w} /> : null}
          </p>
        </div>
      ) : null}
      <div className={s.ryntraPart}>
        <h4 className={s.kicker}>{r.replay}</h4>
        {sim ? (
          <>
            <ul className={s.ryntraRuns}>
              {sim.windows.map((run) => (
                <li key={run.days}>
                  <span className={s.ryntraSpan}>{r.span[run.days as 7 | 30 | 180]}</span>
                  {run.ok ? (
                    <>
                      <Gain run={run} w={w} />
                      <span className={s.dim}>
                        {r.costs} {usd(run.costs.totalUsd, lang)} · {r.drop} {pct(run.worstDrawdownPct, lang)}
                        {run.approximate ? ` · ${r.approx}` : ''}
                      </span>
                    </>
                  ) : (
                    <span className={s.dim}>{r.short}</span>
                  )}
                </li>
              ))}
            </ul>
            {sim.stress ? <p className={s.ryntraDetail}>{sim.stress}</p> : null}
            <p className={s.ryntraDetail}>{sim.lines[sim.lines.length - 1]}</p>
          </>
        ) : (
          <div className={s.ryntraPending} aria-busy="true">
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

function Gain({ run, w }: Readonly<{ run: Extract<WindowRun, { ok: true }>; w: Words }>) {
  const { lang } = useWords();
  return (
    <span className={s.ryntraGain}>
      <b data-tone={run.vsHoldUsd >= 0 ? 'up' : 'down'}>{signedUsd(run.vsHoldUsd, lang)}</b> {w.ryntra.vsHold}
    </span>
  );
}

/** «My bots»: Ryntra's report on the wallet's bots on the chain, in one or two lines over the list. */
export function RyntraReport({ wallet }: Readonly<{ wallet: string }>) {
  const { lang, w } = useWords();
  const entry = useRyntraBots((st) => st.explains[explainKey(wallet, null, lang)]);
  useEffect(() => {
    void useRyntraBots.getState().explain(wallet, null, lang);
  }, [wallet, lang]);
  if (!entry || entry.status !== 'ready') return null;
  return (
    <p className={s.ryntraReport} aria-label={w.ryntra.name} data-bots-ryntra-report="">
      <SparkGlyph size={16} />
      <span>{entry.answer.lines.join(' ')}</span>
    </p>
  );
}

/** «Why?» on one of the wallet's bots: Ryntra's two lines from the engine's Hangar — where it stands, against holding. */
export function RyntraWhy({ wallet, bot }: Readonly<{ wallet: string; bot: HangarBot }>) {
  const { lang, w } = useWords();
  const [open, setOpen] = useState(false);
  const entry = useRyntraBots((st) => st.explains[explainKey(wallet, bot.id, lang)]);
  const id = useId();
  useEffect(() => {
    if (open) void useRyntraBots.getState().explain(wallet, bot.id, lang);
  }, [open, wallet, bot.id, lang]);
  return (
    <>
      <button type="button" className={s.ryntraWhy} aria-expanded={open} aria-controls={id} aria-label={w.ryntra.whyLabel(bot.name)} onClick={() => setOpen((v) => !v)} data-bots-why={bot.id}>
        <SparkGlyph size={16} />
        <span>{w.ryntra.why2}</span>
      </button>
      {open ? (
        <div id={id} className={s.ryntraWhyLines} aria-live="polite">
          {entry?.status === 'ready' ? (
            entry.answer.lines.map((line) => <p key={line}>{line}</p>)
          ) : entry?.status === 'none' ? (
            <p>{entry.line ?? w.ryntra.away}</p>
          ) : (
            <div className={s.ryntraPending} aria-busy="true">
              <span />
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
