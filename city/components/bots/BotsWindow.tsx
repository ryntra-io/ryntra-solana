'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useBackPanel } from '@/city/lib/back/panels';
import { BOT_TABS, useBotsWindow } from '@/city/lib/bots/open';
import { useBots } from '@/city/lib/bots/store';
import { LADDER_NET, useLadder } from '@/city/lib/bots/ladder';
import { MANDATE_NET } from '@/city/lib/bots/mandate';
import { noteLeftMs } from '@/city/lib/bots/note-hold';
import { useFeedPanel } from '@/city/lib/feed/panel';
import { topPanelTakesEscape } from '@/city/lib/hud/top-panels';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { Hangar } from './Hangar';
import { History } from './History';
import { Hub } from './Hub';
import { Strategies } from './Strategies';
import { TabGlyph } from './glyphs';
import { useCoin, useWords } from './hooks';
import s from './bots.module.css';

/**
 * The bots window's contents: four tabs under the frame's head. The frame brings the head, the moving and the whole
 * screen on a computer and the bottom sheet on a phone. One assistant in the city: the bots ask it from its own button
 * in the top bar, never from a second one here.
 */
export default function BotsWindow() {
  const tab = useBotsWindow((st) => st.tab);
  const notice = useBots((st) => st.notice);
  const wallet = useWallet((st) => st.connection?.address ?? null);
  const coin = useCoin();
  const { w } = useWords();

  useEffect(() => {
    useBots.getState().hydrate();
    useLadder.getState().hydrate();
    // A wallet this site was already granted comes back without a question: its bots show on «My bots».
    startWallets();
  }, []);

  // The hub's coin is read when it changes, and again now and then while the window is open.
  useEffect(() => {
    if (!coin) return;
    void useBots.getState().loadPath(coin);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useBots.getState().loadPath(coin);
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [coin]);

  // The connected wallet's own bots, read from the engine's Hangar while the window is open.
  useEffect(() => {
    void useBots.getState().loadChain(wallet);
    if (!wallet) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useBots.getState().loadChain(wallet);
    }, 60_000);
    return () => clearInterval(timer);
  }, [wallet]);

  // Escape steps back from a bot's page or the newcomer's taps before it closes the window. A panel of the top bar
  // open over the window — the events', the wallet's — closes first, alone: the page stays (CITY-240).
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (useBotsWindow.getState().tab !== 'launch' || useBots.getState().page.kind === 'home') return;
      if (topPanelTakesEscape(useFeedPanel.getState().open, document)) return;
      event.preventDefault();
      useBots.getState().back();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  // «Back» of a phone and of a browser steps back the same way (CITY-236): from a bot's page — the ladder's — to the
  // list, from the newcomer's second tap to the first; the window itself closes only from the list.
  const paged = useBots((st) => st.page.kind !== 'home');
  useBackPanel('bots-page', tab === 'launch' && paged, () => useBots.getState().back());

  // The ladder's line under its action goes after a while — a «no» stays long enough to be read (CITY-237,
  // `note-hold.ts`); «costs changed» stays until the next tap answers it. The time runs from when the line was said: a
  // window opened again later does not bring an old line back.
  const ladderNote = useLadder((st) => st.note);
  useEffect(() => {
    const left = ladderNote ? noteLeftMs(ladderNote, Date.now()) : null;
    if (!ladderNote || left === null) return;
    const timer = setTimeout(() => {
      if (useLadder.getState().note === ladderNote) useLadder.getState().say(null);
    }, left);
    return () => clearTimeout(timer);
  }, [ladderNote]);

  // A bot's page, a step of the newcomer's taps or another tab opens at its top, wherever the list was scrolled to
  // (CITY-242: «GRID SOL/USDC» opened out of sight under the tabs); back on the list, the list is where it was left.
  const body = useRef<HTMLDivElement>(null);
  const listAt = useRef(0);
  const view = useBots((st) => (st.page.kind === 'flow' ? `flow:${st.page.goal}:${st.page.step}` : st.page.kind));
  const shownView = useRef(`${tab}:${view}`);
  useLayoutEffect(() => {
    const box = body.current;
    const now = `${tab}:${view}`;
    if (!box || now === shownView.current) return;
    const was = shownView.current;
    shownView.current = now;
    const back = now === 'launch:home' && was.startsWith('launch:');
    const want = back ? listAt.current : 0;
    box.scrollTop = want;
    if (!back) return;
    // The list draws some of its parts a moment later (a phone's sheet), and until then the place is cut short: it is
    // set again once they stand — from the place kept, not the shortened one the browser just reported.
    const again = () => {
      if (shownView.current === 'launch:home') box.scrollTop = want;
    };
    const frame = requestAnimationFrame(again);
    const timer = setTimeout(again, 160);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [tab, view]);
  // Where the list stands, kept as it scrolls: by the time the page has changed, the list's own place is gone.
  const keepListAt = () => {
    if (shownView.current === 'launch:home' && body.current) listAt.current = body.current.scrollTop;
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useBots.getState().say(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className={s.framed} aria-label={w.title}>
      <header className={s.head}>
        <nav className={s.tabs} role="tablist" aria-label={w.title}>
          {BOT_TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${s.tab} ${tab === id ? s.tabOn : ''}`} onClick={() => useBotsWindow.getState().setTab(id)}>
              <TabGlyph tab={id} size={18} />
              <span>{w.tabs[id]}</span>
            </button>
          ))}
        </nav>
        {/* Mainnet is the city everywhere: no network word on the first screen (CITY-221); test money still says so. */}
        {MANDATE_NET !== 'mainnet' && LADDER_NET !== 'mainnet' && <span className={s.practice}>{LADDER_NET || MANDATE_NET ? w.devnet : w.practice}</span>}
      </header>
      <div ref={body} className={s.body} data-tab={tab} onScroll={keepListAt}>
        {tab === 'launch' ? <Hub coin={coin} /> : tab === 'hangar' ? <Hangar /> : tab === 'strategies' ? <Strategies /> : <History />}
      </div>
      {notice ? (
        <div className={s.notice} role="status" key={notice.at}>
          {notice.text === 'started' ? w.started : w.saved}
        </div>
      ) : null}
    </div>
  );
}
