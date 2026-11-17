'use client';

import { useRouter } from 'next/navigation';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { useEffect, useRef, useState } from 'react';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { poolDoorHere, useLaunch } from '@/city/lib/launch/district';
import { usePool } from '@/city/lib/launch/pool';
import type { Ask } from '@/terminal/shell/ask';
import { shelfHref, shelfOn } from '@/terminal/shell/shelves';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { Chip, Panel, Tabs, Title, cx } from '@/terminal/ui';
import { Act } from './Act';
import { launchDoors } from './doors';
import { Form } from './Form';
import { fillOf, launchCommandOf } from './launch-view';
import { Glyph } from './glyphs';
import { FreshSolana, RyntraLaunches } from './Lists';
import { FreshMini, FreshPanel, MinePanel, Preview } from './Side';
import { useLaunchModel, type LaunchModel } from './useLaunchModel';
import { LAUNCH_SCREEN } from './words';
import l from './launch.module.css';

type Tab = 'new' | 'mine' | 'fresh';

/**
 * The Launch screen: a new coin's picture, name and ticker; how it starts trading — on its curve, or straight into its
 * own pool where that door is open —; the three tiles; the card people will see; the coins new on the market; and one
 * action. Underneath is the city's launch as it is: its store, its engine's routes, its two flows and the creator's
 * wallet. «Launch me a token» said to the agent fills the form here; the wallet opens only from the screen's own button.
 */
export function LaunchScreen() {
  // One terminal: a desk shows the whole screen, a phone its own narrow one.
  const phone = useNarrow();
  const desk = !phone;
  const m = useLaunchModel();
  const w = useWords(LAUNCH_SCREEN);
  const shelves = useWords(SHELF_WORDS);
  useLang();
  const router = useRouter();
  const towers = useMarket().towers;
  const [tab, setTab] = useState<Tab>('new');
  const [byAgent, setByAgent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const status = useLaunch((st) => st.status);

  // A sentence for this screen, from the header's line or an agent's «Hire»: it waits until the engine named its
  // presets — whether the pool's door is open is read from them — and then fills the form, never a launch under way.
  const [waiting, setWaiting] = useState<Ask | null>(null);
  useAskHere((ask) => setWaiting(ask));
  const market = useRef(towers);
  market.current = towers;
  const model = useRef(m);
  model.current = m;
  // The draft as the agent's sentence left it: its mark stays until the person changes the form themselves.
  const filled = useRef<Readonly<{ name: string; symbol: string }> | null>(null);
  useEffect(() => {
    if (!waiting || status === 'reading') return;
    setWaiting(null);
    const poolOpen = poolDoorHere();
    const command = launchCommandOf(waiting.said, waiting.command, market.current, poolOpen);
    run(
      command,
      launchDoors((draft) => {
        setTab('new');
        const launch = useLaunch.getState();
        const step = launch.phase?.step ?? null;
        // As the city's own door: a launch on its way — from the press on — or a stopped one keeps its form exactly as
        // it is; a stopped launch says what happened and holds its one way on (a pool's «Continue» among them).
        if (model.current.pressing() || (step !== null && step !== 'done' && step !== 'pooled')) return;
        // A coin that landed makes room for the next one.
        if (step === 'done' || step === 'pooled') model.current.another();
        else model.current.forget();
        const fill = fillOf(draft, poolOpen, new Date());
        if (fill.pool) usePool.getState().setChoice(fill.pool);
        const said = { ...(fill.symbol ? { symbol: fill.symbol } : {}), ...(fill.name ? { name: fill.name } : {}) };
        if (Object.keys(said).length) launch.setDraft(said);
        const now = useLaunch.getState().draft;
        filled.current = { name: now.name, symbol: now.symbol };
        setByAgent(true);
        if (!fill.name) nameRef.current?.focus({ preventScroll: true });
      }),
    );
  }, [waiting, status]);

  const draft = useLaunch((st) => st.draft);
  useEffect(() => {
    const was = filled.current;
    if (byAgent && was && (draft.name !== was.name || draft.symbol !== was.symbol)) setByAgent(false);
  }, [draft, byAgent]);

  const topUp = shelfOn('swap') ? () => router.push(shelfHref('swap', 'live')) : null;
  const newPicture = () => fileRef.current?.click();
  const edit = () => nameRef.current?.focus();
  const act = <Act m={m} onTopUp={topUp} onNewPicture={newPicture} onEdit={edit} />;

  return (
    <div className={l.screen} data-launch-screen="" data-tab={tab}>
      <div className={l.head}>
        {desk ? (
          <Title>{shelves.launch}</Title>
        ) : (
          <div className={l.hero}>
            <Title>{w.heroTitle}</Title>
            <p className={l.lead}>{w.heroLead}</p>
          </div>
        )}
        <Tabs
          className={l.headTabs}
          label={w.views}
          value={tab}
          onChange={setTab}
          items={[
            { id: 'new', label: w.newCoin },
            { id: 'mine', label: w.mine },
            { id: 'fresh', label: w.fresh },
          ]}
        />
        <span className={l.grow} />
        <span className={l.headChips}>
          {byAgent ? <Chip tone="warn">{w.byAgent}</Chip> : null}
          {m.network === 'solana:devnet' ? <Chip>{w.testNet}</Chip> : null}
          {m.free && m.open ? <Chip tone="ok">{w.noFee}</Chip> : null}
        </span>
      </div>

      {tab === 'new' && !desk ? <Formats m={m} /> : null}

      <div className={l.grid} data-plain={desk ? undefined : ''} data-view={tab}>
        <div className={l.main}>
          <div className={l.view} data-off={tab !== 'new' ? '' : undefined}>
            <Panel tone="hi" pad="l" gap={16} edge label={w.newCoin} className={l.form}>
              <Form m={m} fileRef={fileRef} nameRef={nameRef} desk={desk} />
              <div className={l.deskAct}>{act}</div>
            </Panel>
          </div>
          <div className={l.view} data-off={tab !== 'mine' ? '' : undefined}>
            <MinePanel m={m} shown={tab === 'mine'} onResume={() => setTab('new')} />
          </div>
          <div className={l.view} data-off={tab !== 'fresh' ? '' : undefined}>
            <FreshPanel m={m} />
          </div>
        </div>
        <aside className={l.aside} data-off={tab !== 'new' ? '' : undefined}>
          {desk ? <Preview m={m} /> : <RyntraLaunches m={m} />}
          {tab === 'fresh' ? null : desk ? <FreshMini m={m} onAll={() => setTab('fresh')} /> : <FreshSolana m={m} fallback={<FreshMini m={m} onAll={() => setTab('fresh')} />} />}
        </aside>
      </div>

      {/* A phone's one action stands at the bottom, under the card people will see. */}
      <div className={l.phoneDock} data-off={tab !== 'new' ? '' : undefined}>
        {act}
      </div>
    </div>
  );
}

/**
 * The ready formats (the owner's design of 17.11): «Quick start» is the curve and trades at once; «Straight to a
 * pool» only where the pool's door is open (D-M4); «Sniper shield» only where both of the city's curve presets are served
 * and the shield is a choice. A tap sets the form below; nothing is built or signed.
 */
function Formats({ m }: { m: LaunchModel }) {
  const { w } = m;
  const still = m.working || m.settled || m.halfWay;
  const switchable = m.shield?.switchable === true;
  const shieldOn = m.shield?.on === true;
  const cards: { id: string; glyph: 'bolt' | 'pool' | 'shield'; name: string; line: string; on: boolean; pick: () => void }[] = [
    {
      id: 'quick',
      glyph: 'bolt',
      name: w.fmtQuick,
      line: w.fmtQuickLine,
      on: m.format === 'curve' && !(switchable && shieldOn),
      pick: () => {
        m.chooseFormat('curve');
        if (switchable && shieldOn) m.chooseShield(false);
      },
    },
  ];
  if (m.poolOpen) cards.push({ id: 'pool', glyph: 'pool', name: w.fmtPool, line: w.fmtPoolLine, on: m.format === 'pool', pick: () => m.chooseFormat('pool') });
  if (switchable)
    cards.push({
      id: 'shield',
      glyph: 'shield',
      name: w.fmtShield,
      line: w.fmtShieldLine,
      on: m.format === 'curve' && shieldOn,
      pick: () => {
        m.chooseFormat('curve');
        m.chooseShield(true);
      },
    });
  if (cards.length < 2) return null;
  return (
    <div className={l.formats} role="radiogroup" aria-label={w.formats}>
      {cards.map((card) => (
        <button key={card.id} type="button" role="radio" aria-checked={card.on} className={cx(l.format)} disabled={still} onClick={card.pick} data-launch-ready={card.id}>
          <span className={l.formatSign}>
            <Glyph name={card.glyph} />
          </span>
          <span className={l.formatWords}>
            <b>{card.name}</b>
            <span>{card.line}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
