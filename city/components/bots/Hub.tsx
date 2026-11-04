'use client';

import { useState } from 'react';
import { useAgent } from '@/city/lib/agent/store';
import { closeBots, useBotsWindow } from '@/city/lib/bots/open';
import { isDraftKind } from '@/city/lib/bots/draft';
import { CATALOGUE, GOALS, KIND_FACTS, NEXT_KINDS, type BotKind } from '@/city/lib/bots/kinds';
import { useBots, type Coin, type PathEntry } from '@/city/lib/bots/store';
import { fitOf, type Weather } from '@/city/lib/bots/weather';
import { pct, price } from '@/city/lib/bots/format';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { AgentBudget } from './AgentBudget';
import { BotDetail } from './BotDetail';
import { Newcomer } from './Newcomer';
import { RyntraCard } from './Ryntra';
import { ChainGlyph, ChevronGlyph, GoalGlyph, KindGlyph, ScoutGlyph, SkyGlyph } from './glyphs';
import { useCoins, coinOf, useWords } from './hooks';
import s from './bots.module.css';

/** A coin read, with no week of its own prices: nothing is tried on it. */
export const noHistory = (path: PathEntry | undefined): boolean => path?.status === 'ready' && path.bars.length === 0;

/**
 * The scout (the city's own agent, read-only): the bots window steps aside for its card, where the rule is set and it
 * flies. One panel at a time: the Harbor gives way first, unless it is waiting on the wallet or sending.
 */
function openScout(): void {
  useHarbor.getState().hide();
  if (useHarbor.getState().open) return;
  closeBots();
  if (useAgent.getState().panel === 'none') useAgent.getState().toggle();
}

/** «Запустити»: the week's weather for the coin, Ryntra's pick, four goals, every bot — or a bot's page, or the newcomer's three taps. */
export function Hub({ coin }: Readonly<{ coin: Coin | null }>) {
  const page = useBots((st) => st.page);
  if (page.kind === 'detail') return <BotDetail />;
  if (page.kind === 'flow') return <Newcomer coin={coin} goal={page.goal} step={page.step} />;
  return <Home coin={coin} />;
}

function Home({ coin }: Readonly<{ coin: Coin | null }>) {
  const { w } = useWords();
  const path = useBots((st) => (coin ? st.paths[coin.mint] : undefined));
  const weather = path?.weather ?? null;
  const notified = useBots((st) => st.notified);
  // A coin without a week of prices offers no bot on it: the person picks another coin above.
  const tryable = coin !== null && !noHistory(path);
  return (
    <div className={s.home}>
      <AgentBudget />
      <WeatherHero coin={coin} path={path} />
      {tryable ? <RyntraCard coin={coin} /> : null}
      <section className={s.section} aria-label={w.goalsTitle}>
        <h3 className={s.kicker}>{w.goalsTitle}</h3>
        <div className={s.goals}>
          {GOALS.map((goal) => (
            <button key={goal} type="button" className={s.goal} onClick={() => useBots.getState().startFlow(goal)} disabled={!tryable}>
              <span className={s.goalGlyph}>
                <GoalGlyph goal={goal} size={26} />
              </span>
              <b>{w.goal[goal]}</b>
              <span className={s.goalBot}>{w.goalBots[goal]}</span>
            </button>
          ))}
        </div>
      </section>
      <section className={s.section} aria-label={w.allBots}>
        <h3 className={s.kicker}>{w.allBots}</h3>
        <div className={s.catalogue}>
          {CATALOGUE.map((kind) => (
            <KindCard key={kind} kind={kind} coin={tryable ? coin : null} weather={weather} />
          ))}
          <button type="button" className={s.card} onClick={openScout} data-bots-scout="">
            <span className={s.cardGlyph}>
              <ScoutGlyph />
            </span>
            <span className={s.cardText}>
              <b>{w.scout}</b>
              <span>{w.scoutTag}</span>
            </span>
          </button>
        </div>
      </section>
      <section className={s.section} aria-label={w.nextTitle}>
        <h3 className={s.kicker}>{w.nextTitle}</h3>
        <div className={s.catalogue}>
          {NEXT_KINDS.map((id) => (
            <div key={id} className={`${s.card} ${s.cardNext}`}>
              <span className={s.cardGlyph}>
                <KindGlyph kind={id} />
              </span>
              <span className={s.cardText}>
                <b>{w.next[id]}</b>
                <span>{w.nextTag[id]}</span>
              </span>
              <button type="button" className={s.quiet} onClick={() => useBots.getState().notify(id)} disabled={notified.includes(id)} aria-pressed={notified.includes(id)}>
                {notified.includes(id) ? w.notified : w.notify}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function KindCard({ kind, coin, weather }: Readonly<{ kind: BotKind; coin: Coin | null; weather: Weather | null }>) {
  const { w } = useWords();
  const fit = fitOf(kind, weather);
  const open = () => {
    if (kind === 'copy') return useBotsWindow.getState().setTab('strategies');
    if (coin && isDraftKind(kind)) useBots.getState().openKind(kind, coin);
  };
  return (
    <button type="button" className={s.card} onClick={open} disabled={!coin && kind !== 'copy'} data-fit={fit}>
      <span className={s.cardGlyph}>
        <KindGlyph kind={kind} />
      </span>
      <span className={s.cardText}>
        <b>{w.kind[kind]}</b>
        <span>{w.tag[kind]}</span>
      </span>
      <span className={s.cardChips}>
        {fit !== 'fair' ? <i className={s.fit} data-fit={fit}>{w.fit[fit]}</i> : null}
        {KIND_FACTS[kind].standalone && kind !== 'copy' ? (
          <i className={s.standalone}>
            <ChainGlyph />
            {w.standalone}
          </i>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The coin and its week in one line over a frame of the live city (the Agents district, from the city's own scene); the
 * coin changes from a short list. A coin without a week of prices says so, and the list stands open.
 */
export function WeatherHero({ coin, path, small = false }: Readonly<{ coin: Coin | null; path: PathEntry | undefined; small?: boolean }>) {
  const { w, lang } = useWords();
  const [picking, setPicking] = useState(false);
  const coins = useCoins();
  const weather: Weather | null = path?.weather ?? null;
  const empty = noHistory(path);
  return (
    <div className={`${s.hero} ${small ? s.heroSmall : ''}`}>
      {small ? null : <div className={s.heroArt} aria-hidden="true" />}
      <div className={s.heroRow}>
        <button type="button" className={s.coin} onClick={() => setPicking((v) => !v)} aria-expanded={picking} aria-label={w.pickCoin}>
          <b translate="no">{coin?.symbol ?? '—'}</b>
          <span>{coin ? price(coin.price, lang) : ''}</span>
          <ChevronGlyph />
        </button>
        {weather ? (
          <div className={s.weather} data-sky={weather.sky}>
            <span className={s.sky}>
              <SkyGlyph sky={weather.sky} size={18} />
              {w.sky[weather.sky]}
            </span>
            <span>{w.dayMove(pct(weather.dayMovePct, lang))}</span>
            {small ? null : <span className={s.dim}>{w.weekRange(price(weather.low, lang), price(weather.high, lang))}</span>}
          </div>
        ) : empty && coin ? (
          <div className={s.weather}>
            <span className={s.dim}>{w.noHistory(coin.symbol)}</span>
          </div>
        ) : path?.status === 'ready' ? null : (
          <div className={s.weatherPending} aria-busy="true" />
        )}
      </div>
      {picking || (empty && !small) ? (
        <div className={s.coinList} role="listbox" aria-label={w.pickCoin}>
          {coins.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={coin?.mint === t.id}
              className={coin?.mint === t.id ? s.coinOn : undefined}
              onClick={() => {
                useBots.getState().pickCoin(t.id);
                void useBots.getState().loadPath(coinOf(t));
                setPicking(false);
              }}
            >
              <b translate="no">{t.symbol}</b>
              <span>{price(t.price, lang)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
