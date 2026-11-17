'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAssistant } from '@/city/lib/assistant/store';
import { testNow, useAutopilot } from '@/city/lib/autopilot/store';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { NOTE_YES_MS, noteLeftMs } from '@/city/lib/bots/note-hold';
import { useCity } from '@/city/lib/city/store';
import { agentCoins, bookOf } from '@/city/lib/command/parse';
import type { Role } from '@/city/lib/crew/read';
import { sayCoin } from '@/city/lib/crew/say';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { usePilot } from '@/city/lib/pilot/store';
import { SOL } from '@/city/lib/trade/tiles';
import { useAsk, type Ask } from '@/terminal/shell/ask';
import { askRows, gatesFor } from '@/terminal/shell/ask-route';
import { engineGates } from '@/terminal/shell/engine';
import { PHONE_HEAD } from '@/terminal/shell/frame';
import { useSay } from '@/terminal/shell/say';
import { shelfHref, shelfOn } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { NARROW, useNarrow } from '@/terminal/shell/useNarrow';
import { SHELF_WORDS, SHELL } from '@/terminal/shell/words';
import { Action, Figure, Icon, Kick, Panel, Quiet, Tabs, Title, usdText } from '@/terminal/ui';
import { Crew } from './Crew';
import { resultShown } from './figures';
import { History, MineCards, MineTable } from './Mine';
import { How, NewAgent, Note, noteWords } from './NewAgent';
import { crewOpen, hireWay, readySentences } from './read';
import { cardState, todayOf, workingRoles, type MineRow } from './rows';
import { Answer, ReadySays, SayField } from './Say';
import { stopAgent, useAgentsData, type StopResult } from './useAgentsData';
import { AGENTS } from './words';
import a from './agents.module.css';

type Tab = 'hire' | 'mine' | 'history';

/** The address of a phone's second step — the agents to hire and the new agent's card — so «Back» steps out of it. */
const NEW = '#new';

const onShelf = (id: Parameters<typeof shelfOn>[0]) => shelfOn(id);

/** The screen's name and its «i» in a phone's header, where the frame keeps a place for the screen in front. */
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

/**
 * The Agents screen: «Say what to do» with the sentences ready to say, the agents a person hires, the agents at work
 * for the wallet, and the new agent's card with its one action — «Give the budget», one signature. Everything under it
 * is the city's own logic: the readers of a sentence, the mandate and its signing, the agent's book, the autopilot's
 * plan. The screen opens and fills; the wallet opens only from its own buttons.
 */
export function AgentsScreen() {
  // One terminal: a desk shows the whole screen, a phone its own narrow one.
  const phone = useNarrow();
  const desk = !phone;
  const w = useWords(AGENTS);
  const shell = useWords(SHELL);
  const shelves = useWords(SHELF_WORDS);
  const lang = useLang();
  const router = useRouter();
  const say = useSay();
  const towers = useMarket().towers;
  const subject = useAsk((st) => st.subject);
  const book = useMemo(() => bookOf(towers), [towers]);
  const solUsd = useMemo(() => {
    const sol = towers.find((tower) => tower.id === SOL.mint);
    return sol && Number.isFinite(sol.price) && sol.price > 0 ? sol.price : null;
  }, [towers]);
  const crew = useMemo(() => crewOpen(gatesFor(onShelf, engineGates()), shelfOn('earn')), []);
  const says = useMemo(() => readySentences(lang, book, crew), [lang, book, crew]);
  // One live fact a card: the Trader's first coin and its day's volume, read from the market; the Launcher's one signature.
  const facts = useMemo(() => {
    const coin = sayCoin(book);
    const tower = coin ? towers.find((one) => one.id === coin.mint) : undefined;
    const volume = tower && !tower.unread?.includes('volume24h') && tower.volume24h > 0 ? usdText(tower.volume24h, lang) : null;
    return { ...(coin && volume ? { trader: w.traderFact(coin.symbol, volume) } : {}), launcher: w.launcherFact };
  }, [book, towers, lang, w]);
  const data = useAgentsData();
  const { rows, owner, views } = data;
  const working = useMemo(() => workingRoles(rows), [rows]);

  const [tab, setTab] = useState<Tab>('hire');
  // A phone draws no tabs: a window narrowed to one comes back to its one view.
  useEffect(() => {
    if (!desk) setTab('hire');
  }, [desk]);
  const [picked, setPicked] = useState<Role | null>(null);
  const [hiring, setHiring] = useState(false);
  const [noteAt, setNoteAt] = useState<'aside' | 'mine'>('aside');
  const [stopping, setStopping] = useState<string | null>(null);
  const [stopped, setStopped] = useState<Readonly<{ role: MineRow['role']; result: StopResult; at: number }> | null>(null);
  // The agent the panel is about: the one picked, else the first a person can hire here.
  const chosen: Role | null = picked && (crew[picked] || working[picked]) ? picked : crew.trader || working.trader ? 'trader' : crew.pilot || working.pilot ? 'pilot' : null;
  const states = useMemo(() => {
    const of = (role: Role) => cardState(role, crew, working, chosen);
    return { trader: of('trader'), pilot: of('pilot'), keeper: of('keeper'), launcher: of('launcher') };
  }, [crew, working, chosen]);

  // A phone's second step lives in the address, so «Back» closes it and the first screen stays.
  useEffect(() => {
    const sync = () => setHiring(window.location.hash === NEW);
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  const openHiring = () => {
    if (!window.matchMedia(NARROW).matches) return;
    if (window.location.hash !== NEW) window.history.pushState(window.history.state, '', NEW);
    setHiring(true);
  };
  const closeHiring = () => {
    if (window.location.hash === NEW) window.history.back();
    else setHiring(false);
  };

  const show = (role: Role) => {
    setPicked(role);
    setTab('hire');
    setNoteAt('aside');
    openHiring();
  };

  /** «Hire»: the agent's own card — here, or on the shelf its work lives on. */
  const hire = (role: Role | null) => {
    if (!role) return openHiring();
    if (working[role]) return show(role);
    if (!crew[role]) return;
    const way = hireWay(role);
    if (way === 'earn') return router.push(shelfHref('earn', 'live'));
    if (way === 'launch') {
      const sentence = says.find((one) => one.key === 'launch')?.text;
      if (!sentence || !say(sentence)) router.push(shelfHref('launch', 'live'));
      return;
    }
    show(role);
  };

  // A sentence for this screen — from the header's line or its own: the city's reading fills the agent's card.
  const market = useRef(towers);
  market.current = towers;
  const price = useRef(solUsd);
  price.current = solUsd;
  const take = (command: Ask['command']) => {
    if (command.kind === 'autopilot' && command.ask.kind === 'trade') {
      useAutopilot.getState().show(command.ask);
      // On mainnet the agent buys a named coin: a sentence that named none keeps the first sentence's coin, at once.
      if (MANDATE_NET === 'mainnet' && !useMandate.getState().coin) {
        const first = sayCoin(bookOf(market.current));
        if (first) {
          useMandate.getState().setCoin({ mint: first.mint, symbol: first.symbol, icon: first.icon });
          void testNow();
        }
      }
      return show('trader');
    }
    if (command.kind === 'pilot') {
      const first = agentCoins(bookOf(market.current))[0] ?? null;
      usePilot.getState().show(command.ask, price.current, first ? { mint: first.mint, symbol: first.symbol, icon: first.icon } : null);
      return show('pilot');
    }
    if (command.kind === 'hire') return hire(command.ask.role);
    if (command.kind === 'ask') {
      setTab('hire');
      useAssistant.getState().show(null);
      void useAssistant.getState().ask(command.question, () => useCity.getState().snapshot.towers);
    }
  };
  useAskHere((ask) => take(ask.command));

  /** The screen's own line: a sentence for this screen is taken here, in place; any other goes to its shelf. */
  const sayHere = (sentence: string): boolean => {
    const row = askRows(sentence, book, { subject }, onShelf, engineGates())[0];
    if (!row) return false;
    if (row.target.shelf !== 'agents') return say(sentence, row);
    take(row.command);
    return true;
  };

  /** «Stop»: one at a time; its answer stands under «My agents». */
  const stop = (row: MineRow) => {
    if (stopping) return;
    setStopping(row.key);
    setNoteAt('mine');
    setStopped(null);
    void stopAgent(row, () => owner && data.setPilot(owner, null))
      .then((result) => result && setStopped({ role: row.role, result, at: Date.now() }))
      .finally(() => setStopping(null));
  };

  // What a step answered stays long enough to be read, counted from when it was said.
  const mandateNote = useMandate((st) => st.note);
  useEffect(() => {
    if (!mandateNote) return;
    const timer = setTimeout(() => {
      if (useMandate.getState().note === mandateNote) useMandate.getState().say(null);
    }, noteLeftMs(mandateNote, Date.now()) ?? NOTE_YES_MS);
    return () => clearTimeout(timer);
  }, [mandateNote]);
  useEffect(() => {
    if (!stopped) return;
    const timer = setTimeout(() => setStopped(null), noteLeftMs({ kind: stopped.result, at: stopped.at }, Date.now()) ?? NOTE_YES_MS);
    return () => clearTimeout(timer);
  }, [stopped]);
  const asideNote = noteAt === 'aside' && mandateNote ? <Note warn={mandateNote.kind !== 'on' && mandateNote.kind !== 'stopped'}>{noteWords(w, mandateNote.kind)}</Note> : null;
  const mineNote = noteAt === 'mine' && stopped ? <Note warn={stopped.result !== 'stopped'}>{stopped.result === 'stopped' && stopped.role === 'pilot' ? w.pilotStopped : stopped.result === 'stopped' && stopped.role === 'keeper' ? w.keeperStopped : noteWords(w, stopped.result)}</Note> : null;

  const today = todayOf(rows);
  const todayResult = resultShown(today.raw, solUsd, lang);
  const mine = { rows, owner, views, solUsd, note: mineNote, stopping, onStop: stop };

  return (
    <div className={a.screen} data-hiring={hiring ? '' : undefined} data-agents="">
      <PhoneHead title={shell.agent}>
        <How />
      </PhoneHead>

      <div className={a.head} data-plain={desk ? undefined : ''}>
        {desk ? (
          <Title>{shelves.agents}</Title>
        ) : (
          <div className={a.hero}>
            <Title>{w.hireTitle}</Title>
            <p className={a.lead}>{w.hireLead}</p>
          </div>
        )}
        <Tabs
          className={a.headTabs}
          label={w.views}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'hire', label: w.hire },
            { id: 'mine', label: w.mine, ...(rows.length ? { count: String(rows.length) } : {}) },
            { id: 'history', label: w.history },
          ]}
        />
        <div className={a.grow} />
        {today.trades !== null || todayResult ? (
          <div className={a.today} data-agents-today="">
            <Kick>{w.today}</Kick>
            <span className={a.todayFigure}>
              {today.trades !== null ? <Figure size="m" value={w.tradesCount(String(today.trades))} /> : null}
              {today.trades !== null && todayResult ? <Figure size="m" value="·" /> : null}
              {todayResult ? <Figure size="m" value={todayResult.text} tone={todayResult.tone} /> : null}
            </span>
          </div>
        ) : null}
      </div>

      {/* A phone's second step: the new agent's card first, the agents to hire under it, «×» back to the first screen. */}
      <div className={a.back}>
        <Kick className={a.grow}>{w.hire}</Kick>
        <Quiet size="s" aria-label={shell.close} onClick={closeHiring}>
          <Icon name="close" size="s" />
        </Quiet>
      </div>

      <div className={a.grid}>
        <div className={a.main}>
          <div className={a.view} data-off={tab !== 'hire' ? '' : undefined}>
            {desk ? (
              <Panel pad="l" gap={12} label={w.sayPanel} className={a.deskOnly}>
                <SayField onSay={sayHere} />
                <ReadySays says={says} onSay={sayHere} />
                <Answer />
              </Panel>
            ) : null}
            <div className={`${a.phoneOnly} ${a.home} ${a.phoneSay}`}>
              <SayField onSay={sayHere} />
              <ReadySays says={says} onSay={sayHere} tall />
              <Answer />
            </div>
            <Crew states={states} onHire={hire} facts={facts} open={!desk} />
            <div className={a.deskOnly}>
              <MineTable {...mine} />
            </div>
            <div className={a.home}>
              <MineCards {...mine} />
            </div>
            <div className={`${a.phoneDock} ${a.home}`}>
              <Action onClick={() => hire(null)} data-agent-hire="">
                {w.hireAgent}
              </Action>
            </div>
          </div>
          <div className={a.view} data-desk="" data-off={tab !== 'mine' ? '' : undefined}>
            <MineTable {...mine} />
          </div>
          <div className={a.view} data-desk="" data-off={tab !== 'history' ? '' : undefined}>
            <History views={views} past={data.past} />
          </div>
        </div>
        <aside className={a.aside}>
          <NewAgent role={chosen} rows={rows} views={views} pilot={data.pilot} solUsd={solUsd} note={asideNote} onAct={() => setNoteAt('aside')} stopping={stopping} onStop={stop} />
        </aside>
      </div>
    </div>
  );
}
