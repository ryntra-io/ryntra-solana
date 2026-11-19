'use client';

import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { agentCoins, bookOf } from '@/city/lib/command/parse';
import { funnelSay } from '@/city/lib/crew/funnel-say';
import { useWords } from '@/city/lib/i18n/dict';
import type { Tower } from '@/city/lib/market/types';
import { clearClarify, useAskNote } from '@/terminal/shell/ask-note';
import { askRows } from '@/terminal/shell/ask-route';
import { engineGates } from '@/terminal/shell/engine';
import { useSay } from '@/terminal/shell/say';
import { shelfOn, type ShelfId } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Icon, Panel } from '@/terminal/ui';
import { DEPTH } from './depth-words';
import { HERO, heroCoin, readySentences, type Sentence } from './sentences';
import { MARKET } from './words';
import h from './home.module.css';

const onShelf = (id: ShelfId) => shelfOn(id);

/**
 * The agent's panel at the top of the Market (the navigator, macket 17.11): what Ryntra is in one
 * sentence — «Say what to do. Your agent does the rest.» — the agent's field with the screen's one amber «Say», three
 * ready sentences in one tap, and one line on the money: the budget is the person's, a stop at any moment,
 * the keys stay theirs. It is the screen's one panel of action, with the brand's cut corner.
 *
 * A sentence goes to the agent's line of the terminal (`useSay`): its shelf opens with the card; the wallet is asked for
 * there, once the person has decided. Each ready sentence stands only when a shelf that is on takes it.
 */
export function HomeHero({ towers }: { towers: readonly Tower[] }) {
  const w = useWords(DEPTH);
  const m = useWords(MARKET);
  const say = useSay();
  // The agent reading a sentence through the model, or its «Уточни: …» — in place of the line on the money.
  const note = useAskNote();
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
    // No sum in an example — the budget is the person's, chosen in the agent's card.
    const candidates: Sentence[] = [{ id: 'scout', text: m.sayScout }, ...(traded ? [{ id: 'tradeDaily' as const, text: m.sayTradeDaily(traded.symbol) }] : []), { id: 'launch', text: m.sayLaunch }, { id: 'earn', text: m.sayEarn('SOL') }];
    return readySentences(candidates, (said) => askRows(said, book, { subject: null }, onShelf, gates)[0]?.command.kind ?? null, HERO.length);
  }, [book, m]);
  const example = sentences.find((s) => s.id === 'tradeDaily')?.text ?? sentences[0]?.text ?? null;

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
    <Panel tone="hi" pad="none" className={h.hero} label={w.homeTitle1}>
      <div className={h.inner} data-terminal="hero">
        {/* The promise is not the page's heading: «Market» stays its one h1. */}
        <p id={titleId} className={h.title}>
          <span>{w.homeTitle1}</span> <span className={h.titleSoft}>{w.homeTitle2}</span>
        </p>
        <form className={h.ask} onSubmit={submit} data-missed={missed ? '' : undefined} aria-labelledby={titleId}>
          <span className={h.askBox}>
            <Icon name="agents" className={h.askMark} />
            <input
              className={h.askField}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setMissed(false);
                clearClarify();
              }}
              placeholder={example && !narrow ? w.homeAsk(example) : w.homeAskShort}
              aria-label={w.homeAskShort}
              enterKeyHint="go"
              autoComplete="off"
            />
          </span>
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
          {note ? (
            <p className={h.safe} role="status" aria-live="polite" data-say-note="">
              <Icon name="agents" size="s" />
              {note}
            </p>
          ) : (
            <p className={h.safe}>
              <Shield />
              {m.heroSafe}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

const Shield = () => (
  <svg className={h.shield} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6zM9 12l2 2 4-4" />
  </svg>
);
