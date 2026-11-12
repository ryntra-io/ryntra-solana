'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { startersFor } from '@/city/lib/assistant/answer';
import { playTick } from '@/city/lib/audio/engine';
import { useBackPanel } from '@/city/lib/back/panels';
import { useCity } from '@/city/lib/city/store';
import { cityDoors, contextNow, gatesNow, subjectTower } from '@/city/lib/command/doors';
import { installCommandKeys } from '@/city/lib/command/keys';
import { bookOf, COMMAND_MAX, fit, keyOf, ROWS_MAX, SOL_COIN, suggest, type Coin, type Command } from '@/city/lib/command/parse';
import { run } from '@/city/lib/command/run';
import { closeCommand, shutCommandWhile, useCommand } from '@/city/lib/command/store';
import { digits, useWords, wordsNow } from '@/city/lib/i18n/dict';
import { headline } from '@/city/lib/instruct/face';
import { presetFor, rhythmOf } from '@/city/lib/autopilot/plan';
import { readAsk } from '@/city/lib/autopilot/read';
import { readDollarAsk } from '@/city/lib/earn/dollar-read';
import { readPilotAsk } from '@/city/lib/pilot/read';
import { PILOT } from '@/city/lib/pilot/words';
import { rateText } from '@/city/lib/earn/dollar';
import { useDollar } from '@/city/lib/earn/dollar-store';
import { earnWords } from '@/city/lib/earn/words';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { readInstruction } from '@/city/lib/instruct/read';
import { hireFit, readHire, type Role } from '@/city/lib/crew/read';
import { crewGatesNow } from '@/city/lib/crew/hire';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { CrewGlyph, RoleGlyph } from '../crew/glyphs';
import { Says } from '../crew/Says';
import { INSTRUCT } from '@/city/lib/instruct/words';
import { useKeyboardInset } from '@/city/lib/keyboard';
import { launchOpenHere, useLaunch } from '@/city/lib/launch/district';
import { quarterStore, useQuarter } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { SparkGlyph } from '../assistant/AssistantLayer';
import { EarnGlyph, MoneyGlyph } from '../deck/glyphs';
import { CloseGlyph, LaunchGlyph } from '../hud/glyphs';
import { LearnGlyph } from '../learn/glyphs';
import { LEARN_WORDS } from '../learn/words';
import s from './command.module.css';
import { COMMAND } from './words';

// Heard before any panel's own keys: ⌘K opens the line, Escape closes what stands on top (city/lib/command/keys.ts).
installCommandKeys();

type Words = (typeof COMMAND)['en'];

/**
 * The city's command line (CITY-85; helm SPEC §1, §8–9): one field — «buy SOL for 50», «стоп на JUP», «my portfolio» —
 * and under it what will open, filled in. A pick opens that window with its fields written; the person reads them and
 * confirms in the window, then signs in their own wallet. Nothing here signs, sends or builds an order, and anything
 * that is not a window to open is a question for Ryntra, who only advises. ⌘K or Ctrl+K on a computer; on a phone the
 * spark in the top bar is its way in, and the line stands at the bottom, above the keyboard.
 */
export function CommandLayer() {
  const open = useCommand((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const building = useQuarter((st) => st.mode !== 'city');
  // ⌘K does nothing while a quarter is being built: the line never stands open unseen, holding Escape and «Back».
  useEffect(() => shutCommandWhile(() => quarterStore.getState().mode !== 'city'), []);
  useEffect(() => {
    if (running || building) closeCommand();
  }, [running, building]);
  // «Back» on a phone closes it, as it closes a window.
  useBackPanel('command', open, closeCommand);
  if (!open || running || building) return null;
  return <Palette />;
}

/** A pick hands the keyboard to the window it opened; closing without one gives it back where it was. */
let picked = false;

function tick(): void {
  if (useCity.getState().sound) playTick();
}

function Palette() {
  const w = useWords(COMMAND);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const keyboard = useKeyboardInset();
  const towers = useCity((st) => st.snapshot.towers);
  const book = useMemo(() => bookOf(towers), [towers]);
  const launchReady = useLaunch(launchOpenHere);
  // What is on screen as the line opens: «buy 50» means that coin, whatever the camera does meanwhile.
  const [context] = useState(contextNow);
  const gates = useMemo(() => ({ ...gatesNow(), launch: launchReady }), [launchReady]);
  // The agent's instruction first (CITY-176): «buy $20 of SOL every week» is the agent's card; the window the line would
  // open for the same words, if any, stays under it.
  // The agent on its word (CITY-175) stands before both: «trade 1 SOL a day», «launch me a token».
  const rows = useMemo(() => {
    const listed = suggest(text, book, context, gates);
    // The Dollar Saver on its word (CITY-192): «put my USDC to work» is its card, before anything else the words could open.
    // The money autopilot on its word (CITY-204): money given and spread over places — one plan — before either.
    const pilot = gates.pilot ? readPilotAsk(text, book) : null;
    const saver = !pilot && gates.dollar ? readDollarAsk(text) : null;
    const ask = !pilot && !saver && (gates.agentTrade || gates.agentLaunch) ? readAsk(text, book) : null;
    const agent = pilot ? fit({ kind: 'pilot', ask: pilot }, gates) : saver ? fit({ kind: 'dollar', ask: saver }, gates) : ask ? fit({ kind: 'autopilot', ask }, gates) : null;
    const instruction = !agent && gates.instruct ? readInstruction(text, book, context) : null;
    // A job for an agent (CITY-205): «trade for me», «доглядай мій пул» — the agent's card, never a question for Ryntra.
    const job = !agent && !instruction ? readHire(text) : null;
    const command = agent ?? (instruction ? fit({ kind: 'instruct', instruction }, gates) : null) ?? (job ? ({ kind: 'hire', ask: hireFit(job, crewGatesNow()) } as const) : null);
    return command ? [{ key: keyOf(command), command }, ...listed.filter((row) => row.key !== keyOf(command))].slice(0, ROWS_MAX) : listed;
  }, [text, book, context, gates]);
  useEffect(() => setActive(0), [text]);

  useEffect(() => {
    picked = false;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A desk types at once; a phone's keyboard waits for a tap on the field, so the ready picks stay in view.
    if (window.matchMedia?.('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
    return () => {
      if (!picked && before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  const choose = (command: Command) => {
    tick();
    picked = true;
    closeCommand();
    run(command, cityDoors);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // A word still being composed (a phone's or an input method's) is not a pick.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' && rows.length) {
      event.preventDefault();
      setActive((n) => (n + 1) % rows.length);
    } else if (event.key === 'ArrowUp' && rows.length) {
      event.preventDefault();
      setActive((n) => (n - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter' && rows.length) {
      event.preventDefault();
      choose(rows[Math.min(active, rows.length - 1)]!.command);
    }
  };

  // The ready picks while nothing is typed: the coin on screen or SOL, the portfolio, a launch, and Ryntra's questions.
  const picks = useMemo(() => {
    const subject = context.subject;
    const sol = book.coins.find((c) => c.symbol === 'SOL') ?? SOL_COIN;
    const list: { key: string; label: string; command: Command; ask?: boolean }[] = [];
    const add = (key: string, label: string, command: Command) => {
      const shown = fit(command, gates);
      if (shown) list.push({ key, label, command: shown });
    };
    const coin = subject ?? sol;
    add('buy', w.buy(coin.symbol), { kind: 'buy', coin, view: 'spot', amount: null, pay: null, share: null });
    add('portfolio', w.examplePortfolio, { kind: 'money', place: 'portfolio', send: null });
    add('launch', w.exampleLaunch, { kind: 'launch', symbol: null, name: null });
    add('instructions', w.exampleInstructions, { kind: 'instructions' });
    add('hire', wordsNow(CREW_WORDS).kicker, { kind: 'hire', ask: { said: '', role: null } });
    for (const starter of startersFor(subjectTower())) list.push({ key: starter.id, label: starter.label, command: { kind: 'ask', question: starter.question }, ask: true });
    return list;
  }, [book, context, gates, w]);

  const optionId = (n: number) => `${listId}-${n}`;
  const shownActive = Math.min(active, Math.max(0, rows.length - 1));
  return (
    <div className={s.layer} style={{ ['--kb' as string]: `${keyboard}px` }}>
      <div className={s.scrim} aria-hidden="true" onPointerDown={() => closeCommand()} />
      <section className={s.panel} role="dialog" aria-modal="true" aria-label={w.ryntra} data-city-command="" onKeyDown={keepFocus}>
        <div className={s.field}>
          <span className={s.spark}>
            <SparkGlyph />
          </span>
          <input
            ref={input}
            className={s.input}
            value={text}
            maxLength={COMMAND_MAX}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKey}
            placeholder={w.placeholder}
            aria-label={w.field}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={rows.length ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={rows.length ? optionId(shownActive) : undefined}
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="button" className={s.close} aria-label={w.close} onClick={() => closeCommand()}>
            <CloseGlyph />
          </button>
        </div>

        {rows.length > 0 ? (
          <ul className={s.list} id={listId} role="listbox" aria-label={w.rows}>
            {rows.map((row, n) => (
              <li
                key={row.key}
                id={optionId(n)}
                role="option"
                aria-selected={n === shownActive}
                className={`${s.row} ${n === shownActive ? s.active : ''} ${row.command.kind === 'ask' ? s.rowAsk : ''}`}
                onPointerEnter={() => setActive(n)}
                onClick={() => choose(row.command)}
              >
                <RowFace command={row.command} w={w} />
                <span className={s.enter} aria-hidden="true">
                  <EnterGlyph />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          !text.trim() && (
            <>
            {/* The first sentences to the agent (CITY-222): one tap says it, the agent's card opens. */}
            <Says onSay={(say) => {
              const command = fit({ kind: 'autopilot', ask: say.ask }, gates);
              if (command) choose(command);
            }} />
            <div className={s.picks}>
              {picks.map((pick) => (
                <button key={pick.key} type="button" className={`${s.pick} ${pick.ask ? s.pickAsk : ''}`} onClick={() => choose(pick.command)}>
                  {pick.ask && <SparkGlyph />}
                  {pick.label}
                </button>
              ))}
            </div>
            </>
          )
        )}
      </section>
    </div>
  );
}

/** One row: what opens and what is written in it, the window's name on the right. */
function RowFace({ command, w }: { command: Command; w: Words }) {
  const agent = useWords(INSTRUCT);
  const face = faceOf(command, w, agent);
  return (
    <>
      <span className={s.icon}>{face.icon}</span>
      <span className={s.label}>{face.label}</span>
      {face.fill && <span className={command.kind === 'ask' ? s.quote : s.fill}>{face.fill}</span>}
      {/* «Consultant» and «Agent» stay on a phone too: which of the two helps is the one thing a row must say (CITY-205). */}
      {face.where && <span className={s.where} data-role-mark={command.kind === 'ask' || command.kind === 'hire' ? '' : undefined}>{face.where}</span>}
    </>
  );
}

const shortAddress = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

function shareText(share: number, w: Words): string {
  return share === 100 ? w.all : share === 50 ? w.half : w.share(digits(String(share)));
}

function faceOf(command: Command, w: Words, agent: (typeof INSTRUCT)['en']): { icon: ReactNode; label: string; fill: string | null; where: string | null } {
  switch (command.kind) {
    case 'buy':
      return {
        icon: <CoinIcon coin={command.coin} />,
        label: w.buy(command.coin.symbol),
        fill: command.amount ? digits(`${command.amount} ${command.pay ?? ''}`.trim()) : command.share !== null ? shareText(command.share, w) : null,
        where: command.view === 'swap' ? w.swap : w.spot,
      };
    case 'sell':
      return {
        icon: <CoinIcon coin={command.coin} />,
        label: w.sell(command.coin.symbol),
        fill: command.amount ? digits(`${command.amount} ${command.coin.symbol}`) : command.share !== null ? shareText(command.share, w) : null,
        where: command.view === 'swap' ? w.swap : w.spot,
      };
    case 'order':
      return {
        icon: <CoinIcon coin={command.coin} />,
        label: w.order(command.mode, command.side, command.coin.symbol),
        fill: command.price ? digits(w.at(command.price)) : null,
        where: w.spot,
      };
    case 'chart':
      return { icon: <CoinIcon coin={command.coin} />, label: w.chart(command.coin.symbol), fill: null, where: null };
    case 'coin':
      return { icon: <CoinIcon coin={command.coin} />, label: `$${command.coin.symbol}`, fill: null, where: command.coin.name };
    case 'mint':
      return { icon: <span className={s.disc} />, label: w.address, fill: shortAddress(command.mint), where: null };
    case 'money': {
      const send = command.send;
      const fill = send ? [send.amount && send.asset ? digits(`${send.amount} ${send.asset.symbol}`) : null, send.to ? `→ ${shortAddress(send.to)}` : null].filter(Boolean).join(' ') : '';
      return { icon: <MoneyGlyph />, label: w[command.place], fill: fill || null, where: null };
    }
    case 'earn':
      return { icon: <EarnGlyph />, label: w.earn, fill: null, where: null };
    case 'launch':
      return { icon: <LaunchGlyph />, label: command.symbol ? w.launchAs(command.symbol) : w.launch, fill: command.name, where: null };
    case 'learn': {
      const lw = wordsNow(LEARN_WORDS);
      return { icon: <LearnGlyph />, label: lw.title, fill: null, where: lw.kicker };
    }
    case 'ask':
      // The consultant: it reads the market and advises — one word says so (CITY-205).
      return { icon: <SparkGlyph />, label: w.askRyntra, fill: `«${command.question}»`, where: wordsNow(CREW_WORDS).consultant };
    case 'hire': {
      const c = wordsNow(CREW_WORDS);
      const role: Role | null = command.ask.role;
      return { icon: role ? <RoleGlyph role={role} /> : <CrewGlyph />, label: role ? `${c.hire} · ${c[role]}` : c.kicker, fill: null, where: c.agentRow };
    }
    case 'instruct':
      return {
        icon: command.instruction.coin ? <CoinIcon coin={command.instruction.coin} /> : <SparkGlyph />,
        label: headline(command.instruction, null, agent),
        fill: null,
        where: agent.agent,
      };
    case 'instructions':
      return { icon: <SparkGlyph />, label: agent.listTitle, fill: null, where: agent.agent };
    case 'dollar': {
      const d = earnWords();
      const rate = useDollar.getState().surface;
      const r = rate.status === 'ready' ? rate.value.markets[command.ask.asset]?.rate ?? null : null;
      return {
        icon: <EarnGlyph />,
        label: `${command.ask.side === 'deposit' ? d.dollar.put : d.dollar.take} · ${d.products.dollar.name}`,
        fill: command.ask.amount ? digits(`${command.ask.amount} ${command.ask.asset}`) : command.ask.asset,
        where: r !== null ? digits(`${rateText(r)} · ${d.dollar.provider}`) : d.dollar.provider,
      };
    }
    case 'pilot': {
      const p = wordsNow(PILOT);
      const money = [command.ask.solRaw ? `${Number(command.ask.solRaw) / 1e9} SOL` : null, command.ask.usdcRaw ? `${Number(command.ask.usdcRaw) / 1e6} USDC` : null].filter(Boolean).join(' + ');
      return { icon: <SparkGlyph />, label: p.headline, fill: digits(money), where: p.kicker };
    }
    case 'autopilot': {
      const a = wordsNow(AUTOPILOT);
      if (command.ask.kind === 'launch') return { icon: <LaunchGlyph />, label: a.launchTitle, fill: command.ask.symbol ? `$${command.ask.symbol}` : command.ask.name, where: a.kicker };
      const preset = presetFor(command.ask.perDaySol).preset;
      return { icon: <SparkGlyph />, label: preset ? digits(a.trades(String(rhythmOf(preset).perDay))) : a.tradesAsk, fill: null, where: a.kicker };
    }
  }
}

/** Tab stays inside the line while it is open: it stands over the city as a dialog. */
function keepFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled])')];
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The coin's picture from the engine's icon route; the plain disc with its first letter when there is none. */
function CoinIcon({ coin }: { coin: Coin }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!coin.icon || failed === coin.icon) return <span className={s.disc}>{coin.symbol.slice(0, 1)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.coin} src={coin.icon} alt="" decoding="async" onError={() => setFailed(coin.icon)} />;
}

const EnterGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M19 5v7H6M10 8l-4 4 4 4" />
  </svg>
);
