'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAssistant } from '@/city/lib/assistant/store';
import { useCity } from '@/city/lib/city/store';
import { COMMAND_MAX, bookOf } from '@/city/lib/command/parse';
import { sayCoins } from '@/city/lib/crew/say';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { SOL } from '@/city/lib/trade/tiles';
import { useAsk } from '@/terminal/shell/ask';
import { askRows } from '@/terminal/shell/ask-route';
import { engineGates } from '@/terminal/shell/engine';
import { PHONE_HEAD } from '@/terminal/shell/frame';
import { MenuIcon } from '@/terminal/shell/menu-icons';
import { useSay } from '@/terminal/shell/say';
import { shelfOn } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { Action, ActionBody, CoinLogo, Icon, Info, Kick, Page, PageHead, Panel, SayLine, Title, changeText, changeTone, coinIcon, priceText } from '@/terminal/ui';
import { Answer } from './Say';
import { AGENTS } from './words';
import a from './agents.module.css';

const onShelf = (id: Parameters<typeof shelfOn>[0]) => shelfOn(id);

/** The screen's name and its «i» in a phone's header, where the frame keeps a place for a screen with its own line. */
function PhoneHead({ title, children }: { title: string; children: ReactNode }) {
  const [box, setBox] = useState<HTMLElement | null>(null);
  useEffect(() => setBox(document.getElementById(PHONE_HEAD)), []);
  if (!box) return null;
  return createPortal(
    <>
      <Title className={a.phoneTitle}>{title}</Title>
      {children}
    </>,
    box,
  );
}

/** The analyst's «i»: what it reads, and that it only advises. */
function AnalystInfo() {
  const w = useWords(AGENTS);
  return (
    <Info label={w.analystHow}>
      <span className={a.facts}>
        <span>{w.analystReads}</span>
        <span>{w.analystSafe}</span>
      </span>
    </Info>
  );
}

/** A question asked here: Ryntra reads the market and answers in place — advice only. */
function askAnalyst(question: string): void {
  useAssistant.getState().show(null);
  void useAssistant.getState().ask(question, () => useCity.getState().snapshot.towers);
}

/**
 * «Agents»: only those that decide by themselves — the AI. A rule a person
 * sets is a bot's, on «Bots». Open now: the Analyst — a question about any coin or the market, and Ryntra's
 * answer from the market's own read; advice only, it never signs or trades. Its field, the questions ready in one tap,
 * the answer under them, and beside them the coins an example may name (decision 108) — a tap asks about one. An agent
 * of its own stands here, and in the menu, once its screen is ready (the AI trader, the Scout, your own AI): never a
 * «soon». A sentence that is a bot's job or a trade goes to its own screen; it never signs here.
 */
export function AgentsScreen() {
  const w = useWords(AGENTS);
  const shelves = useWords(SHELF_WORDS);
  const say = useSay();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  const book = useMemo(() => bookOf(towers), [towers]);
  const asking = useAssistant((st) => st.phase === 'asking');
  const [text, setText] = useState('');

  // The coins an example may name: SOL, JUP and MET (decision 108), as the market reads them.
  const coins = useMemo(() => {
    const sol = towers.find((tower) => tower.id === SOL.mint);
    const named = sayCoins(book).flatMap((coin) => towers.filter((tower) => tower.id === coin.mint));
    return [...(sol ? [sol] : []), ...named].slice(0, 3);
  }, [towers, book]);
  const questions = useMemo(() => {
    const [first, second, third] = coins;
    return [first ? w.askToday(first.symbol) : w.askMarket, second ? w.askWhy(second.symbol) : null, third ? w.askRisk(third.symbol) : null].filter((one): one is string => Boolean(one));
  }, [coins, w]);

  // A question from the header's line, left for this screen: asked here.
  useAskHere((ask) => {
    if (ask.command.kind === 'ask') askAnalyst(ask.command.question);
  });

  /**
   * The screen's own line: a bot's job, a trade or a launch goes to its own screen, as the header's line would take it;
   * anything else is a question for the analyst, asked here.
   */
  const send = (sentence: string) => {
    const said = sentence.trim();
    if (!said) return;
    const row = askRows(said, book, { subject }, onShelf, engineGates())[0];
    const elsewhere = row && !['ask', 'coin', 'chart', 'learn'].includes(row.command.kind) && (row.target.shelf !== 'agents' || Boolean(row.target.path));
    if (elsewhere && say(said, row)) return setText('');
    askAnalyst(said);
    setText('');
  };

  return (
    <Page className={a.screen} data-agents="">
      <PhoneHead title={shelves.agents}>
        <AnalystInfo />
      </PhoneHead>

      {/* No count of the day's questions on the screen: past the day's model
          answers the analyst still answers, from the reads alone. */}
      <PageHead title={shelves.agents} />

      <ActionBody sideLabel={w.askAbout} side={<CoinsToAsk coins={coins} onAsk={(tower) => send(w.askWhy(tower.symbol))} />}>
        <Panel tone="hi" pad="l" gap={16} label={w.analyst}>
          <div className={a.asideHead}>
            <span className={a.badge} data-on="">
              <MenuIcon name="analyst" />
            </span>
            <div className={a.asideWords}>
              <Kick>{w.analystKick}</Kick>
              <Title as="h2" className={a.asideTitle}>
                {w.analyst}
              </Title>
              <span className={a.job}>{w.analystJob}</span>
            </div>
            <span className={a.deskOnly}>
              <AnalystInfo />
            </span>
          </div>
          <div className={a.askRow}>
            <label className={a.sayBox}>
              <Icon name="agents" size="l" />
              <input
                className={a.sayInput}
                type="text"
                value={text}
                maxLength={COMMAND_MAX}
                placeholder={w.askHere}
                aria-label={w.askHere}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  send(text);
                }}
                data-agent-ask-field=""
              />
            </label>
            <Action full={false} busy={asking} disabled={!text.trim() || asking} onClick={() => send(text)} data-agent-ask="">
              {w.ask}
            </Action>
          </div>
          <div className={a.says} data-agent-questions="">
            {questions.map((question) => (
              <SayLine key={question} onSay={() => send(question)}>
                {question}
              </SayLine>
            ))}
          </div>
          <Answer />
        </Panel>
      </ActionBody>
    </Page>
  );
}

/** The coins an example names, each with its price and its day: a tap asks the analyst why it moves. */
function CoinsToAsk({ coins, onAsk }: { coins: readonly Tower[]; onAsk: (tower: Tower) => void }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  if (!coins.length) return null;
  return (
    <Panel gap={10} label={w.askAbout}>
      <Kick>{w.askAbout}</Kick>
      <div className={a.coinRows}>
        {coins.map((tower) => {
          const moved = !tower.unread?.includes('change24h') && Number.isFinite(tower.change24h);
          return (
            <button key={tower.id} type="button" className={a.coinRow} onClick={() => onAsk(tower)} aria-label={w.askWhy(tower.symbol)} data-agent-coin={tower.symbol}>
              <CoinLogo src={coinIcon(tower)} symbol={tower.symbol} />
              <span className={a.coinRowName}>{tower.symbol}</span>
              <span className={a.coinRowFigures}>
                <span className={a.coinRowPrice}>{tower.price > 0 ? priceText(tower.price, lang) : '—'}</span>
                <span className={a.coinRowChange} data-tone={moved ? changeTone(tower.change24h) : undefined}>
                  {moved ? changeText(tower.change24h, lang) : '—'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
