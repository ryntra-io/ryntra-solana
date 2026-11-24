'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { agentCoins, bookOf } from '@/city/lib/command/parse';
import { funnelSay } from '@/city/lib/crew/funnel-say';
import { useWords } from '@/city/lib/i18n/dict';
import type { Tower } from '@/city/lib/market/types';
import { clearClarify, useAskNote } from '@/terminal/shell/ask-note';
import { NEW_COINS, SCOUT_AGENT, askRows, newCoinsRow, scoutRow } from '@/terminal/shell/ask-route';
import { scoutReady } from '@/terminal/agents/scout/AgentTabs';
import { engineGates } from '@/terminal/shell/engine';
import { takeLinkLeft, useLinkLeft } from '@/terminal/shell/LinkSay';
import { useSay } from '@/terminal/shell/say';
import { shelfOn, type ShelfId } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Icon, Panel } from '@/terminal/ui';
import { DEPTH } from './depth-words';
import { HERO, heroCoin, readySentences, type Sentence } from './sentences';
import { MARKET } from './words';
import h from './home.module.css';

const onShelf = (id: ShelfId) => shelfOn(id);

/** Where «Find new coins» opens: the Scout once its screen stands, the market's new coins before it. */
const scoutTarget = () => (scoutReady() ? SCOUT_AGENT : NEW_COINS);

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
  // The phone's dock over the tab bar: the page keeps that much room after its last block (`--sheet-h`, as a screen's
  // sheet does — shell.module.css), so nothing of the market stays under it. A desk draws no dock: no room is kept.
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = dock.current;
    const body = box?.closest('main');
    if (!box || !body) return;
    const look = () => {
      const tall = Math.ceil(box.getBoundingClientRect().height);
      if (tall > 0) body.style.setProperty('--sheet-h', `${tall}px`);
      else body.style.removeProperty('--sheet-h');
    };
    look();
    const watch = new ResizeObserver(look);
    watch.observe(box);
    return () => {
      watch.disconnect();
      body.style.removeProperty('--sheet-h');
    };
  }, []);
  // A link's sentence that does not open a screen by itself (a transfer, a question): it stands here for the person to read
  // and say — the header's line is hidden on this page.
  const left = useLinkLeft((st) => st.left);
  useEffect(() => {
    const said = left ? takeLinkLeft() : null;
    if (said) setText(said);
  }, [left]);
  const book = useMemo(() => bookOf(towers), [towers]);
  const named = useRef<string | null>(null);
  const sentences = useMemo(() => {
    const gates = engineGates();
    const offered = agentCoins(book, 8);
    const traded = offered.find((coin) => coin.symbol === named.current) ?? heroCoin(offered);
    if (traded) named.current = traded.symbol;
    // No sum in an example — the budget is the person's, chosen in the agent's card.
    // «Find new coins» opens the Scout once its screen stands; before it, the market's new coins.
    const candidates: Sentence[] = [...(onShelf(scoutTarget().shelf) ? [{ id: 'scout' as const, text: m.sayScout }] : []), ...(traded ? [{ id: 'tradeDaily' as const, text: m.sayTradeDaily(traded.symbol) }] : []), { id: 'launch', text: m.sayLaunch }, { id: 'earn', text: m.sayEarn('SOL') }];
    return readySentences(candidates, (said) => askRows(said, book, { subject: null }, onShelf, gates)[0]?.command.kind ?? null, HERO.length);
  }, [book, m]);
  const example = sentences.find((s) => s.id === 'tradeDaily')?.text ?? sentences[0]?.text ?? null;

  // A ready sentence goes to the agent's line; «Find new coins» opens the agent that finds them, the Scout, at once — or,
  // before its screen stands, the market's new coins: never a card filled with what the terminal cannot run.
  const tap = (sentence: Sentence) => {
    funnelSay('agent_hint');
    if (say(sentence.text, sentence.id === 'scout' ? (scoutReady() ? scoutRow(sentence.text) : newCoinsRow(sentence.text)) : undefined)) funnelSay('agent_said');
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

  /* The agent's field and its amber «Say». On a phone it stands in the thumb's reach — a dock over the
     tab bar, outside the panel, whose cut corner would clip it — and the panel keeps the promise, the sentences and the
     edge; a desk keeps it in the panel. Both are drawn and the width picks one, so the first paint never jumps. */
  const ask = (docked: boolean) => (
    <form className={docked ? `${h.ask} ${h.askDock}` : h.ask} onSubmit={submit} data-missed={missed ? '' : undefined} aria-labelledby={titleId}>
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
          placeholder={example && !narrow && !docked ? w.homeAsk(example) : w.homeAskShort}
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
  );

  return (
    <>
      <Panel tone="hi" pad="none" className={h.hero} label={w.homeTitle1}>
        <div className={h.inner} data-terminal="hero">
          {/* The promise is not the page's heading: «Market» stays its one h1. */}
          <p id={titleId} className={h.title}>
            <span>{w.homeTitle1}</span> <span className={h.titleSoft}>{w.homeTitle2}</span>
          </p>
          {ask(false)}
          <div className={h.under}>
            {sentences.length ? (
              <div className={h.says}>
                {sentences.map((sentence) => (
                  <button key={sentence.id} type="button" className={h.say} data-say={sentence.id} onClick={() => tap(sentence)}>
                    <Icon name="agents" size="s" />
                    <span>{sentence.text}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {/* The agent's answer (reading, «Clarify: …») in its own line of plain size: on a desk in the edge's place, on a
                phone over the dock, by the field it answers (`.dockNote`) — the edge stays in the panel there. */}
            {note ? <AskNote note={note} className={h.note} /> : null}
            <p className={h.safe} data-hero-limit="" data-under-note={note ? '' : undefined}>
              <Shield />
              <span>
                {m.heroLimit.split(' · ').map((part, at) => (
                  <Fragment key={part}>
                    {at ? ' ' : null}
                    {/* A line breaks only before a «·», never after one; the short parts never break inside. */}
                    <span className={at ? h.part : undefined}>
                      {at ? <span className={h.dot}>·{'\u00a0'}</span> : null}
                      {part}
                    </span>
                  </Fragment>
                ))}
              </span>
            </p>
          </div>
        </div>
      </Panel>
      <div ref={dock} className={h.dock} data-terminal="ask-dock">
        {note ? <AskNote note={note} className={h.dockNote} /> : null}
        {ask(true)}
      </div>
    </>
  );
}

/** The agent's answer to what was said — reading it, or «Clarify: …» — in one calm line. */
function AskNote({ note, className }: { note: string; className: string }) {
  return (
    <p className={className} role="status" aria-live="polite" data-say-note="">
      <Icon name="agents" size="s" />
      {note}
    </p>
  );
}

const Shield = () => (
  <svg className={h.shield} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6zM9 12l2 2 4-4" />
  </svg>
);
