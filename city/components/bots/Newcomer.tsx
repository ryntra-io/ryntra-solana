'use client';

import { useMemo } from 'react';
import { AMOUNTS, defaultDraft } from '@/city/lib/bots/draft';
import type { Goal } from '@/city/lib/bots/kinds';
import { recommend, type Reason } from '@/city/lib/bots/recommend';
import { simulate } from '@/city/lib/bots/sim';
import { useBots, type Coin } from '@/city/lib/bots/store';
import { usd } from '@/city/lib/bots/format';
import type { Bar } from '@/city/lib/bots/path';
import type { Words } from '@/city/lib/bots/words';
import { BotChart } from './BotChart';
import { CanDoCard, CostLine, RiskLine } from './BotDetail';
import { BackGlyph, CheckGlyph, KindGlyph } from './glyphs';
import { useWords } from './hooks';
import { WeatherHero } from './Hub';
import s from './bots.module.css';

const NO_BARS: readonly Bar[] = [];

/**
 * The newcomer's three taps, all on paper: the goal (on the hub), the bot it recommends with its reasons — «Use this
 * bot» — and the check with «Start». «Adjust» opens the bot's full page instead.
 */
export function Newcomer({ coin, goal, step }: Readonly<{ coin: Coin | null; goal: Goal; step: 'pick' | 'confirm' }>) {
  const { w, lang } = useWords();
  const path = useBots((st) => (coin ? st.paths[coin.mint] : undefined));
  const amount = useBots((st) => st.flowAmount);
  const draft = useBots((st) => st.draft);
  const weather = path?.weather ?? null;
  const pick = useMemo(() => recommend(goal, weather), [goal, weather]);
  const preview = useMemo(() => (coin ? defaultDraft(pick.kind, { mint: coin.mint, symbol: coin.symbol }, coin.price, weather, amount) : null), [pick.kind, coin, weather, amount]);
  const bars = path?.bars ?? NO_BARS;
  const shown = step === 'confirm' && draft ? draft : preview;
  const run = useMemo(() => (shown && bars.length ? simulate(shown, bars) : null), [shown, bars]);
  if (!coin || !shown) return null;
  const current = bars.length ? bars[bars.length - 1]!.c : coin.price;

  return (
    <div className={s.flow}>
      <header className={s.flowHead}>
        <button type="button" className={s.iconButton} onClick={() => useBots.getState().back()} aria-label={w.back}>
          <BackGlyph />
        </button>
        <span className={s.flowGoal}>{w.goal[goal]}</span>
        <ol className={s.steps} aria-label="1 · 2 · 3">
          {[0, 1, 2].map((i) => (
            <li key={i} data-on={i <= (step === 'pick' ? 1 : 2) ? '' : undefined} />
          ))}
        </ol>
      </header>
      <WeatherHero coin={coin} path={path} small />
      {step === 'pick' ? (
        <div className={s.flowCard}>
          <span className={s.kicker}>{w.recommended}</span>
          <div className={s.flowBot}>
            <span className={s.flowGlyph}>
              <KindGlyph kind={pick.kind} size={30} />
            </span>
            <div>
              <b className={s.flowName}>{w.kind[pick.kind]}</b>
              <span className={s.flowTag}>{w.tag[pick.kind]}</span>
            </div>
          </div>
          <ul className={s.reasons}>
            {pick.reasons.map((r) => (
              <li key={r.id}>
                <CheckGlyph />
                {reasonText(r, w, coin.symbol)}
              </li>
            ))}
          </ul>
          {bars.length ? <BotChart bars={bars} draft={shown} run={run} lang={lang} height={150} compact label={w.kind[pick.kind]} /> : null}
          <div className={s.chips} role="radiogroup" aria-label={w.field.amount}>
            {AMOUNTS.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={v === amount} className={v === amount ? s.chipOn : undefined} onClick={() => useBots.getState().setFlowAmount(v)}>
                {usd(v, lang).replace(/[.,]00$/, '')}
              </button>
            ))}
          </div>
          <button type="button" className={s.primary} onClick={() => useBots.getState().useRecommended(coin)}>
            {w.useBot}
          </button>
          <button type="button" className={s.quiet} onClick={() => useBots.getState().openKind(pick.kind, coin)}>
            {w.adjust}
          </button>
        </div>
      ) : (
        <div className={s.flowCard}>
          <span className={s.kicker}>{w.checkStart}</span>
          <div className={s.flowBot}>
            <span className={s.flowGlyph}>
              <KindGlyph kind={shown.kind} size={30} />
            </span>
            <div>
              <b className={s.flowName}>{w.kind[shown.kind]}</b>
              <span className={s.flowTag}>{w.tag[shown.kind]}</span>
            </div>
          </div>
          <CanDoCard draft={shown} w={w} lang={lang} compact />
          <CostLine draft={shown} w={w} lang={lang} />
          <RiskLine draft={shown} current={current} w={w} lang={lang} />
          <button type="button" className={s.primary} onClick={() => useBots.getState().startPaper()}>
            {w.start}
          </button>
        </div>
      )}
    </div>
  );
}

function reasonText(r: Reason, w: Words, symbol: string): string {
  switch (r.id) {
    case 'goal':
      return w.reasonGoal[r.goal];
    case 'weather':
      return w.reasonWeather(symbol, w.sky[r.sky], r.fit);
    case 'custody':
      return w.reasonCustody[r.custody];
    case 'tap':
      return w.reasonTap;
    case 'standalone':
      return w.reasonStandalone;
  }
}
