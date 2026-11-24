'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAssistant } from '@/city/lib/assistant/store';
import { useCity } from '@/city/lib/city/store';
import { count } from '@/city/lib/chart/facts';
import { COMMAND_MAX, bookOf } from '@/city/lib/command/parse';
import { sayCoins } from '@/city/lib/crew/say';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { SOL } from '@/city/lib/trade/tiles';
import { useAsk } from '@/terminal/shell/ask';
import { askRows } from '@/terminal/shell/ask-route';
import { engineGates } from '@/terminal/shell/engine';
import { MenuIcon } from '@/terminal/shell/menu-icons';
import { useSay } from '@/terminal/shell/say';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { coinName } from '@/terminal/market/market-view';
import { useMarket } from '@/terminal/shell/useMarket';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { Action, ActionBody, CoinLogo, Figure, Icon, Info, Page, PageHead, Panel, QuietLink, SayLine, Tile, Title, changeText, changeTone, coinIcon, priceText, usdText } from '@/terminal/ui';
import { BOTS_STOCKS_OPEN } from '@/terminal/bots/stock-buys';
import { Answer } from './Say';
import { AgentTabs } from './scout/AgentTabs';
import { AGENTS } from './words';
import a from './agents.module.css';

const onShelf = (id: Parameters<typeof shelfOn>[0]) => shelfOn(id);

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
 * the answer under them; under the analyst, the coin it is about — its figures as the market reads them; beside them the coins an example
 * may name (decision 108) — a tap asks about one. An agent of its own stands here, and in the menu, once its screen is
 * ready (the AI trader, the Scout, your own AI): never a «soon». A sentence that is a bot's job or a trade goes to its
 * own screen; it never signs here.
 */
export function AgentsScreen() {
  const w = useWords(AGENTS);
  const shelves = useWords(SHELF_WORDS);
  const say = useSay();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  const book = useMemo(() => bookOf(towers), [towers]);
  const asking = useAssistant((st) => st.phase === 'asking');
  const answered = useAssistant((st) => (st.phase === 'answered' ? st.shown : null));
  // An answer on screen (or on its way): the analyst's panel grows with it, the side column keeps its own height.
  const said = useAssistant((st) => st.phase !== 'idle' && Boolean(st.question));
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  // The coin under the analyst: the one tapped beside it, then the first the answer is about; SOL until either.
  const [picked, setPicked] = useState<string | null>(null);

  // The coins an example may name: SOL, JUP and MET (decision 108), as the market reads them.
  const coins = useMemo(() => {
    const sol = towers.find((tower) => tower.id === SOL.mint);
    const named = sayCoins(book).flatMap((coin) => towers.filter((tower) => tower.id === coin.mint));
    return [...(sol ? [sol] : []), ...named].slice(0, 3);
  }, [towers, book]);
  const questions = useMemo(() => {
    const [first, second, third] = coins;
    // The example of a stock bought on a rhythm, where the line takes it to Recurring buys of stocks.
    const stock = BOTS_STOCKS_OPEN && askRows(w.sayStockWeekly, book, { subject: null }, onShelf, engineGates())[0]?.target.path === '/bots/recurring' ? w.sayStockWeekly : null;
    return [first ? w.askToday(first.symbol) : w.askMarket, second ? w.askWhy(second.symbol) : null, third ? w.askRisk(third.symbol) : null, stock].filter((one): one is string => Boolean(one));
  }, [coins, w, book]);

  // An answer about coins puts its first one in focus; a tap beside it, the tapped one.
  useEffect(() => {
    if (answered?.length) setPicked(answered[0]!.id);
  }, [answered]);
  const focus = useMemo(() => (picked ? towers.find((tower) => tower.id === picked) : undefined) ?? coins[0] ?? null, [picked, towers, coins]);

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

  // The one action is always lit (QA 19.11, вада 21: a pale «Ask» read as switched off): with nothing typed, it puts the
  // cursor in the field.
  const press = () => {
    if (text.trim()) send(text);
    else field.current?.focus();
  };

  return (
    // The shelf's AI trader is a desk: this tab's head stands on the desk's line too, so no tab moves it.
    <Page head="desk" className={a.screen} data-agents="" data-agents-said={said ? '' : undefined}>
      {/* No count of the day's questions on the screen: past the day's model
          answers the analyst still answers, from the reads alone. */}
      <PageHead title={shelves.agents} tabs={<AgentTabs value="analyst" />} />

      <ActionBody sideLabel={w.askAbout} side={<CoinsToAsk coins={coins} focus={focus?.id ?? null} onAsk={(tower) => (setPicked(tower.id), send(w.askWhy(tower.symbol)))} />}>
        <Panel tone="hi" pad="l" gap={16} label={w.analyst}>
          {/* The analyst's name and what it does; «advice only» and what it reads stand behind its «i» (QA 19.11, вада 22:
              no small grey line over the name). */}
          <div className={a.asideHead}>
            <span className={a.badge} data-on="">
              <MenuIcon name="analyst" />
            </span>
            <div className={a.asideWords}>
              <Title as="h2" className={a.asideTitle}>
                {w.analyst}
              </Title>
              <span className={a.job}>{w.analystJob}</span>
            </div>
            <AnalystInfo />
          </div>
          <div className={a.askRow}>
            <label className={a.sayBox}>
              <Icon name="agents" size="l" />
              <input
                ref={field}
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
            <Action full={false} busy={asking} disabled={asking} onClick={press} data-agent-ask="">
              {w.ask}
            </Action>
          </div>
          <div className={a.says} data-count={questions.length} data-agent-questions="">
            {questions.map((question) => (
              <SayLine key={question} onSay={() => send(question)}>
                {question}
              </SayLine>
            ))}
          </div>
          <Answer />
        </Panel>
        {focus ? <CoinFocus tower={focus} /> : null}
      </ActionBody>
    </Page>
  );
}

/**
 * The coin the analyst is about, under it: the logo, the price and the day, then the figures a trader reads first — the
 * market cap, liquidity, the day's volume, holders — in the coin page's order (`terminal/coin/CoinHead.tsx`). Every
 * figure is the market's read; one it did not measure is «—». A tap opens the coin's own page where the Market is on.
 */
function CoinFocus({ tower }: { tower: Tower }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const read = (figure: 'mcap' | 'liquidity' | 'volume24h' | 'holders') => !tower.unread?.includes(figure) && Number.isFinite(tower[figure]) && tower[figure] > 0;
  const moved = !tower.unread?.includes('change24h') && Number.isFinite(tower.change24h);
  const tiles: [string, string][] = [
    [w.focusMcap, read('mcap') ? usdText(tower.mcap, lang) : '—'],
    [w.focusLiquidity, read('liquidity') ? usdText(tower.liquidity, lang) : '—'],
    [w.focusVolume, read('volume24h') ? usdText(tower.volume24h, lang) : '—'],
    [w.focusHolders, read('holders') ? digits(count(tower.holders), lang) : '—'],
  ];
  // How it moves right now — what «why is it moving?» is asked about: the last five minutes, the hour, who traded in it.
  const move = (figure: 'change5m' | 'change1h') => (!tower.unread?.includes(figure) && Number.isFinite(tower[figure]) ? tower[figure] : null);
  const moves: [string, string, 'up' | 'down' | undefined][] = [
    [w.focus5m, move('change5m') === null ? '—' : changeText(move('change5m')!, lang), move('change5m') === null ? undefined : changeTone(move('change5m')!)],
    [w.focus1h, move('change1h') === null ? '—' : changeText(move('change1h')!, lang), move('change1h') === null ? undefined : changeTone(move('change1h')!)],
    [w.focusActive, !tower.unread?.includes('traders1h') && tower.traders1h > 0 ? digits(count(tower.traders1h), lang) : '—', undefined],
  ];
  return (
    <Panel gap={16} label={w.focus}>
      <div className={a.focusHead} data-agent-focus={tower.symbol}>
        <CoinLogo src={coinIcon(tower)} symbol={tower.symbol} size="l" />
        <div className={a.focusNames}>
          <span className={a.focusSymbol}>{tower.symbol}</span>
          <span className={a.job}>{coinName(tower)}</span>
        </div>
        <div className={a.focusPrice}>
          <Figure value={tower.price > 0 ? priceText(tower.price, lang) : '—'} size="m" />
          <span className={a.coinRowChange} data-tone={moved ? changeTone(tower.change24h) : undefined}>
            {moved ? changeText(tower.change24h, lang) : '—'}
          </span>
        </div>
      </div>
      <div className={a.focusTiles}>
        {tiles.map(([label, value]) => (
          <Tile key={label} label={label} value={value} />
        ))}
      </div>
      <div className={a.focusMoves}>
        {moves.map(([label, value, tone]) => (
          <Tile key={label} label={label} value={value} tone={tone} />
        ))}
      </div>
      {shelfOn('market') ? (
        <QuietLink href={coinHref(tower.id, 'live')}>
          {w.focusOpen}
          <Icon name="arrow" size="s" />
        </QuietLink>
      ) : null}
    </Panel>
  );
}

/** The coins an example names, each with its price and its day: a tap asks the analyst why it moves. */
function CoinsToAsk({ coins, focus, onAsk }: { coins: readonly Tower[]; focus: string | null; onAsk: (tower: Tower) => void }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  if (!coins.length) return null;
  return (
    <Panel gap={10} label={w.askAbout}>
      {/* The panel's own name at a title's size, not a small grey line (QA 19.11, вада 22). */}
      <Title as="h2" className={a.sideTitle}>
        {w.askAbout}
      </Title>
      <div className={a.coinRows}>
        {coins.map((tower) => {
          const moved = !tower.unread?.includes('change24h') && Number.isFinite(tower.change24h);
          return (
            <button key={tower.id} type="button" className={a.coinRow} aria-pressed={tower.id === focus} onClick={() => onAsk(tower)} aria-label={w.askWhy(tower.symbol)} data-agent-coin={tower.symbol}>
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
