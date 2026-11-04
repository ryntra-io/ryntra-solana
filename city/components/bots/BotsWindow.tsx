'use client';

import { useEffect } from 'react';
import { BOT_TABS, useBotsWindow } from '@/city/lib/bots/open';
import { useBots } from '@/city/lib/bots/store';
import { LADDER_NET, useLadder } from '@/city/lib/bots/ladder';
import { MANDATE_NET } from '@/city/lib/bots/mandate';
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

  // Escape steps back from a bot's page or the newcomer's taps before it closes the window.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (useBotsWindow.getState().tab !== 'launch' || useBots.getState().page.kind === 'home') return;
      event.preventDefault();
      useBots.getState().back();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  // The ladder's line under its action goes after a while; «costs changed» stays until the next tap answers it.
  const ladderNote = useLadder((st) => st.note);
  useEffect(() => {
    if (!ladderNote || ladderNote.kind === 'costsChanged') return;
    const timer = setTimeout(() => {
      if (useLadder.getState().note === ladderNote) useLadder.getState().say(null);
    }, 8_000);
    return () => clearTimeout(timer);
  }, [ladderNote]);

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
        <span className={s.practice}>{MANDATE_NET === 'mainnet' ? w.mainnet : LADDER_NET || MANDATE_NET ? w.devnet : w.practice}</span>
      </header>
      <div className={s.body} data-tab={tab}>
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
