'use client';

import { useRouter } from 'next/navigation';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { useEffect, useRef, useState } from 'react';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { poolDoorHere, useLaunch } from '@/city/lib/launch/district';
import { usePool } from '@/city/lib/launch/pool';
import { beginSentence, type Ask } from '@/terminal/shell/ask';
import { shelfHref, shelfOn } from '@/terminal/shell/shelves';
import { useTabInAddress } from '@/terminal/shell/address';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { SHELF_WORDS } from '@/terminal/shell/words';
import { ActionBody, Chip, Icon, Page, PageHead, Panel, Tabs, cx } from '@/terminal/ui';
import { Act } from './Act';
import { launchDoors } from './doors';
import { Form } from './Form';
import { fillOf, launchCommandOf } from './launch-view';
import { Glyph } from './glyphs';
import { FreshSolana, FreshTab, RyntraLaunches, useFreshCoins } from './Lists';
import { FreshMini, FreshPanel, MinePanel, Preview } from './Side';
import { useLaunchModel, type LaunchModel } from './useLaunchModel';
import { LAUNCH_SCREEN } from './words';
import l from './launch.module.css';

type Tab = 'new' | 'mine' | 'fresh';
const TABS: readonly Tab[] = ['new', 'mine', 'fresh'];

/**
 * The Launch screen, a launchpad: the agent's line first — «Say it. Your agent does the rest.» —, the two
 * ready formats, then the new coin: its picture large, its name and ticker, a line about it and its links, for a pool
 * when trading opens, the launch's price and the creator's share in one row and one action. Beside it, the coin as people
 * will see it and the coins new on the market. Underneath is the city's launch as it is: its store, its engine's routes,
 * its two flows and the creator's wallet. «Launch me a token» said to the agent fills the form here; the wallet opens
 * only from the screen's own button.
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
  // The menu leads to a tab: `/launch?tab=mine`; every turn of the tabs is written back.
  useTabInAddress(tab, setTab, TABS, 'new');
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
        // The mark says what is true: the agent filled the form only where its sentence named something.
        setByAgent(Boolean(fill.name || fill.symbol || fill.pool));
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

  const tabs = (
    <Tabs
      bare
      label={w.views}
      value={tab}
      onChange={setTab}
      items={[
        { id: 'new', label: w.newCoin },
        { id: 'mine', label: w.mine },
        { id: 'fresh', label: w.freshTab },
      ]}
    />
  );
  // The launch fee is said once, in the form's own row: the head marks only what changes the screen.
  const marks = [byAgent ? <Chip key="agent" tone="warn">{w.byAgent}</Chip> : null, m.network === 'solana:devnet' ? <Chip key="net">{w.testNet}</Chip> : null].filter(Boolean);
  // The side column: on a desk the coin as people will see it and the coins new on the market; on a phone the launches
  // on Ryntra and the new coins, under the form.
  // The market's new coins, read once for the side list and the tab alike.
  const coins = useFreshCoins();
  const fresh = <FreshSolana m={m} coins={coins} fallback={<FreshMini m={m} onAll={() => setTab('fresh')} />} />;
  const side = desk ? (
    <>
      <Preview m={m} />
      {fresh}
    </>
  ) : (
    <>
      <RyntraLaunches m={m} />
      {fresh}
    </>
  );

  // One page for every section: the three tabs live in the same container — the new coin's form and its side
  // column, then the two lists across the page's whole width.
  return (
    <Page data-launch-screen="" data-tab={tab}>
      <PageHead title={shelves.launch} tabs={tabs} mark={marks.length ? marks : null} />
      <div className={l.view} data-off={tab !== 'new' ? '' : undefined}>
        <ActionBody side={side}>
          <SayRow m={m} />
          <Formats m={m} />
          <Panel tone="hi" pad="l" gap={20} edge label={w.newCoin} className={l.coinPanel}>
            <Form m={m} fileRef={fileRef} nameRef={nameRef} />
            {act}
          </Panel>
        </ActionBody>
      </div>
      <div className={l.view} data-off={tab !== 'mine' ? '' : undefined}>
        <ActionBody>
          <MinePanel m={m} shown={tab === 'mine'} onResume={() => setTab('new')} />
        </ActionBody>
      </div>
      <div className={l.view} data-off={tab !== 'fresh' ? '' : undefined}>
        <ActionBody>
          <FreshTab m={m} coins={coins} fallback={<FreshPanel m={m} />} />
        </ActionBody>
      </div>
    </Page>
  );
}

/**
 * The first rule, said first: «Say it. Your agent does the rest.» A tap puts «launch me a token …» into the agent's own
 * line in the header, the keyboard with it; the person finishes the sentence there and the agent fills this form.
 */
function SayRow({ m }: { m: LaunchModel }) {
  const { w } = m;
  return (
    <button
      type="button"
      className={l.say}
      aria-label={w.sayLabel}
      onClick={() => {
        // The keyboard opens only on a focus inside the tap itself (a phone's rule); the line then takes the words.
        document.querySelector<HTMLInputElement>('[data-city-command] input')?.focus();
        beginSentence(w.sayStart);
      }}
      data-launch-say=""
    >
      <span className={l.saySign}>
        <Glyph name="spark" />
      </span>
      <span className={l.sayWords}>
        <b>{w.sayHead}</b>
        <span>{w.sayExample}</span>
      </span>
      <Icon name="arrow" size="s" className={l.sayArrow} />
    </button>
  );
}

/**
 * The ready formats as cards, the same on a desk and a phone: «Quick start» is the curve and trades at once;
 * «Straight to a pool» — a Meteora DLMM Pro pool of its own — only where the pool's door is open (D-M4). A tap sets the
 * form below; nothing is built or signed.
 */
function Formats({ m }: { m: LaunchModel }) {
  const { w } = m;
  const still = m.working || m.settled || m.halfWay;
  if (!m.poolOpen) return null;
  const cards: { id: 'curve' | 'pool'; glyph: 'bolt' | 'pool'; name: string; why: string; tag: string | null }[] = [
    { id: 'curve', glyph: 'bolt', name: w.fmtQuick, why: w.fmtQuickWhy, tag: null },
    { id: 'pool', glyph: 'pool', name: w.fmtPool, why: w.fmtPoolWhy, tag: w.fmtPoolTag },
  ];
  return (
    <div className={l.formats} role="group" aria-label={w.formats} data-launch-format={m.format}>
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          aria-pressed={m.format === card.id}
          className={cx(l.format)}
          disabled={still}
          onClick={() => !still && m.chooseFormat(card.id)}
          data-launch-ready={card.id === 'curve' ? 'quick' : 'pool'}
        >
          <span className={l.formatSign}>
            <Glyph name={card.glyph} />
          </span>
          <span className={l.formatWords}>
            <span className={l.formatName}>
              <b>{card.name}</b>
              {card.tag ? <span className={l.formatTag}>{card.tag}</span> : null}
            </span>
            <span>{card.why}</span>
          </span>
          <span className={l.formatCheck} aria-hidden="true">
            <Icon name="check" size="s" />
          </span>
        </button>
      ))}
    </div>
  );
}
