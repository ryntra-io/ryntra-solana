'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { MANDATE_PRESETS } from '@/city/lib/bots/mandate';
import { agentCoins, bookOf } from '@/city/lib/command/parse';
import { funnelSay } from '@/city/lib/crew/funnel-say';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { SOL } from '@/city/lib/trade/tiles';
import { BUDGET_PRESETS } from '@/lib/mandate/presets';
import { budgetText } from '@/terminal/agents/figures';
import { askRows } from '@/terminal/shell/ask-route';
import { engineGates } from '@/terminal/shell/engine';
import { useSay } from '@/terminal/shell/say';
import { coinHref, shelfHref, shelfOn, type ShelfId } from '@/terminal/shell/shelves';
import { useMarket } from '@/terminal/shell/useMarket';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Icon, Info, changeText, changeTone, priceText } from '@/terminal/ui';
import { DEPTH } from './depth-words';
import { HERO, heroCoin, readySentences, type Sentence } from './sentences';
import { MARKET } from './words';
import h from './home.module.css';

const onShelf = (id: ShelfId) => shelfOn(id);

/** The day's budget a new agent starts with on this deployment's network: the example sentence says it. */
const FIRST_BUDGET = MANDATE_PRESETS[0] ? BUDGET_PRESETS[MANDATE_PRESETS[0]].perDay : null;


/**
 * The home page's first line (one terminal): what Ryntra is in one sentence — «Say what to do. Your
 * agent does the rest.» — the agent's field with the amber «Say», the ready sentences in one tap with the
 * agent's terms beside them, and three slim doors with live figures: trading (SOL's price and its day), earning (the
 * staking rate the engine reads), launching. «How it works» waits behind its own quiet control. The line is short on
 * purpose: the market stands right under it, five rows and more above the fold of a desk.
 *
 * A sentence goes to the agent's line of the terminal (`useSay`): its shelf opens with the card; the wallet is asked for
 * there, once the person has decided. Each ready sentence stands only when a shelf that is on takes it.
 */
export function HomeHero({ towers }: { towers: readonly Tower[] }) {
  const w = useWords(DEPTH);
  const m = useWords(MARKET);
  const lang = useLang();
  const say = useSay();
  // A phone's field is too narrow for the whole example: it asks the short question, the sentences stand under it.
  const narrow = useNarrow();
  const titleId = useId();
  const [text, setText] = useState('');
  const [missed, setMissed] = useState(false);
  const book = useMemo(() => bookOf(towers), [towers]);
  const named = useRef<string | null>(null);
  const sentences = useMemo(() => {
    const gates = engineGates();
    const offered = agentCoins(book, 8);
    const traded = offered.find((coin) => coin.symbol === named.current) ?? heroCoin(offered);
    if (traded) named.current = traded.symbol;
    const perDay = FIRST_BUDGET === null ? null : budgetText(FIRST_BUDGET, lang);
    const candidates: Sentence[] = [...(traded && perDay ? [{ id: 'tradeDaily' as const, text: m.sayTradeDaily(traded.symbol, perDay) }] : []), { id: 'earn', text: m.sayEarn('SOL') }, { id: 'launch', text: m.sayLaunch }];
    return readySentences(candidates, (said) => askRows(said, book, { subject: null }, onShelf, gates)[0]?.command.kind ?? null, HERO.length);
  }, [book, m, lang]);
  const example = sentences.find((s) => s.id === 'tradeDaily')?.text ?? sentences[0]?.text ?? null;
  // What the agent does with the money, in one line before anything is connected: the day's budget, the fee,
  // the stop, the keys — the agent's own line, standing only with its sentence.
  const fee = agentFeeFigures(lang);
  const trades = FIRST_BUDGET !== null && sentences.some((sentence) => sentence.id === 'tradeDaily');
  const terms = trades ? m.heroTerms(budgetText(FIRST_BUDGET, lang), fee.low, fee.high) : m.heroKeys;

  const tap = (sentence: string) => {
    funnelSay('agent_hint');
    if (say(sentence)) funnelSay('agent_said');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const said = text.trim();
    if (!said) return;
    funnelSay('agent_hint');
    if (say(said)) {
      funnelSay('agent_said');
      setMissed(false);
    } else setMissed(true);
  };

  return (
    <section className={h.hero} aria-labelledby={titleId} data-terminal="hero">
      <div className={h.head}>
        {/* The promise is not the page's heading: «Market» stays its one h1. */}
        <p id={titleId} className={h.title}>
          <span>{w.homeTitle1}</span> <span className={h.titleAmber}>{w.homeTitle2}</span>
        </p>
        <span className={h.howBtn}>
          <Info label={w.how} word={w.how}>
            <span className={h.how}>
              <span className={h.howSub}>{w.homeSub}</span>
              <span className={h.steps} role="list">
                <span className={h.step} role="listitem">
                  <span className={h.n}>{digits('1', lang)}</span>
                  <span>
                    <b>{w.step1}</b>
                    {example ? <span>{w.step1Hint(example)}</span> : null}
                  </span>
                </span>
                <span className={h.step} role="listitem">
                  <span className={h.n}>{digits('2', lang)}</span>
                  <span>
                    <b>{w.step2}</b>
                    <span>{w.step2Hint}</span>
                  </span>
                </span>
                <span className={h.step} role="listitem">
                  <span className={h.n}>{digits('3', lang)}</span>
                  <span>
                    <b>{w.step3}</b>
                    <span>{w.step3Hint}</span>
                  </span>
                </span>
              </span>
            </span>
          </Info>
        </span>
      </div>
      <form className={h.ask} onSubmit={submit} data-missed={missed ? '' : undefined}>
        <Icon name="agents" className={h.askMark} />
        <input
          className={h.askField}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setMissed(false);
          }}
          placeholder={example && !narrow ? w.homeAsk(example) : w.homeAskShort}
          aria-label={w.homeAskShort}
          enterKeyHint="go"
          autoComplete="off"
        />
        <button type="submit" className={h.askGo}>
          {w.homeSay}
          <Icon name="arrow" size="s" />
        </button>
      </form>
      <div className={h.under}>
        {sentences.length ? (
          <div className={h.says}>
            {sentences.map((sentence) => (
              <button key={sentence.id} type="button" className={h.say} data-say={sentence.id} onClick={() => tap(sentence.text)}>
                <Icon name="agents" size="s" />
                <span>{sentence.text}</span>
              </button>
            ))}
          </div>
        ) : null}
        <p className={h.safe}>
          <Shield />
          {terms}
        </p>
      </div>

      <Doors towers={towers} />
    </section>
  );
}

const Shield = () => (
  <svg className={h.shield} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6zM9 12l2 2 4-4" />
  </svg>
);

type Feed = Readonly<{ lsts?: readonly Readonly<{ id: string; apyPct: number | null }>[] }>;

/** The staking rate the engine reads (`/api/city/earn`): JupSOL's, else the best one read. */
function useStakeRate(on: boolean): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetch('/api/city/earn', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? (res.json() as Promise<Feed>) : null))
      .then((feed) => {
        if (!live || !feed?.lsts) return;
        const rates = feed.lsts.filter((l) => typeof l.apyPct === 'number' && l.apyPct > 0 && l.apyPct < 50);
        // A named staking rate, never the best of several passed off as staking SOL.
        const pick = rates.find((l) => l.id === 'jupsol') ?? rates.find((l) => l.id === 'jitosol');
        setRate(pick?.apyPct ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [on]);
  return rate;
}

/** Three doors with live figures: trade, earn, launch. Each stands only when its shelf is on. */
function Doors({ towers }: { towers: readonly Tower[] }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const earnOn = shelfOn('earn');
  const launchOn = shelfOn('launch');
  const rate = useStakeRate(earnOn);
  // The bundled market paints the first frame; a price is shown only once the live read stands.
  const live = useMarket().source === 'live';
  const sol = live ? (towers.find((t) => t.id === SOL.mint) ?? null) : null;
  const listed = towers.filter((t) => t.verified).length;
  return (
    <div className={h.doors}>
      <Link className={h.door} href={sol ? coinHref(sol.id, 'live') : shelfHref('market', 'live')}>
        <span className={h.doorIcon}>
          <Icon name="market" />
        </span>
        <span className={h.doorGo}>
          <Icon name="arrow" size="s" />
        </span>
        <b className={h.doorTitle}>{w.trade}</b>
        {listed ? <span className={h.doorHint}>{w.tradeHint(digits(String(listed), lang))}</span> : null}
        {sol ? (
          <span className={h.doorFig}>
            <span className={h.figWords}>
              <b className={h.big}>{priceText(sol.price, lang)}</b>
              <span data-tone={changeTone(sol.change24h)}>
                {changeText(sol.change24h, lang)} {w.perDay}
              </span>
            </span>
          </span>
        ) : null}
      </Link>

      {earnOn ? (
        <Link className={h.door} href={shelfHref('earn', 'live')}>
          <span className={h.doorIcon}>
            <Icon name="earn" />
          </span>
          <span className={h.doorGo}>
            <Icon name="arrow" size="s" />
          </span>
          <b className={h.doorTitle}>{w.earn}</b>
          <span className={h.doorHint}>{w.earnHint}</span>
          {rate !== null ? (
            <span className={h.doorFig}>
              <span className={h.figWords}>
                <b className={h.big} data-tone="up">
                  {digits(`${rate.toFixed(2)}%`, lang)}
                </b>
                <span>{w.yearly}</span>
              </span>
            </span>
          ) : null}
        </Link>
      ) : null}

      {launchOn ? (
        <Link className={h.door} href={shelfHref('launch', 'live')}>
          <span className={h.doorIcon}>
            <Icon name="launch" />
          </span>
          <span className={h.doorGo}>
            <Icon name="arrow" size="s" />
          </span>
          <b className={h.doorTitle}>{w.launch}</b>
          <span className={h.doorHint}>{w.launchHint}</span>
        </Link>
      ) : null}
    </div>
  );
}
