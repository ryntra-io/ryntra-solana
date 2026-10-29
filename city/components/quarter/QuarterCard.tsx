'use client';

import { useEffect, type ReactNode } from 'react';
import { hydrateFeed, useFeed } from '@/city/lib/feed/store';
import { cityAccount, useCityAccount } from '@/city/lib/quarter/account-live';
import { moduleForKind } from '@/city/lib/quarter/modules';
import { lotNumber, streetName } from '@/city/lib/quarter/plot';
import { quarterStore, useQuarter } from '@/city/lib/quarter/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { PHANTOM_DOWNLOAD_URL } from '@/lib/solana/open-in-wallet';
import { DistrictArt } from '../art/DistrictArt';
import { CloseGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { LotGlyph } from './glyphs';
import { wakeSound } from './sound';
import q from './quarter.module.css';

/**
 * The one card above the dock, for the living world: a newcomer gets one amber action, «Claim your quarter»; a
 * resident gets their quarter and the way back to it. A quarter is kept under the wallet signed in to Ryntra, so
 * both actions connect the wallet and sign in first when needed (one message, no transaction), then go on.
 *
 * The card follows the «Arrivals card» switch of the settings: off on a phone, on a desk until it is closed — its close turns the switch off on this device, so it stays
 * closed after a reload. «Home» in the dock brings it back for the visit. With the card off, and in a world that cannot
 * be reached, the hot tower stands in its place, so the card never offers what would fail.
 */
export function QuarterCard({ hot }: { hot: ReactNode }) {
  const status = useQuarter((st) => st.status);
  const later = useQuarter((st) => st.later);
  const asked = useQuarter((st) => st.asked);
  // Nothing shows before the kept choice is read: a card that would go a moment later never flashes up.
  const ready = useFeed((st) => st.ready);
  const on = useFeed((st) => st.settings.arrivals);
  useEffect(() => hydrateFeed(), []);
  if (status === 'unknown' || !ready) return null;
  if (status === 'offline' || !(asked || (on && !later))) return <>{hot}</>;
  return status === 'none' ? <ClaimCard /> : <ResidentCard />;
}

/** Closed: gone for this visit, and the switch off on this device (the settings bring it back). */
function closeCard() {
  quarterStore.getState().dismiss();
  useFeed.getState().set('arrivals', false);
}

function Head({ kicker }: { kicker: string }) {
  return (
    <>
      <DistrictArt id="home" />
      <div className={q.head}>
        <div className={s.kicker}>
          <span className={q.spark} aria-hidden="true" />
          {kicker}
        </div>
        <button className={q.close} aria-label="Close the Arrivals card" onClick={closeCard}>
          <CloseGlyph />
        </button>
      </div>
    </>
  );
}

/** What the card's one action says while the wallet, the sign-in or the world is on its way. */
function useStepLabel(idle: string): { label: string; busy: boolean; line: string | null; error: string | null; picking: boolean } {
  const step = useCityAccount((st) => (st.from === 'card' ? st.step : null));
  const to = useCityAccount((st) => st.connectingTo);
  const accountError = useCityAccount((st) => (st.from === 'card' ? st.error : null));
  const claiming = useQuarter((st) => st.busy);
  const worldError = useQuarter((st) => st.error);
  if (step === 'connecting') return { label: `Opening ${to ?? 'wallet'}…`, busy: true, line: null, error: null, picking: false };
  if (step === 'signing') return { label: 'Check your wallet', busy: true, line: 'Sign one message to keep it yours. No transaction.', error: null, picking: false };
  if (step === 'opening') return { label: 'Opening your quarter…', busy: true, line: null, error: null, picking: false };
  if (claiming) return { label: 'Claiming…', busy: true, line: null, error: null, picking: false };
  return { label: idle, busy: false, line: null, error: accountError ?? worldError, picking: step === 'pick' };
}

function ClaimCard() {
  const step = useStepLabel('Claim your quarter');
  const claim = () => {
    wakeSound();
    void cityAccount.getState().begin('claim', 'card');
  };
  return (
    <div className={`${s.panel} ${s.slot}`}>
      <Head kicker="Arrivals" />
      <div className={q.row}>
        <span className={q.badge}>
          <LotGlyph />
        </span>
        <div className={q.words}>
          <div className={q.title}>Your own quarter of the city</div>
          <div className={`${q.line} ${step.error ? q.lineError : ''}`}>{step.error ?? step.line ?? 'Free, kept under your wallet.'}</div>
        </div>
      </div>
      {step.picking ? (
        <Wallets />
      ) : (
        <button className={`${s.display} ${s.action}`} onClick={claim} disabled={step.busy} aria-busy={step.busy}>
          {step.label}
        </button>
      )}
    </div>
  );
}

/** The wallets in this browser, one tap each; none found says where to get one. «Back» changes nothing. */
function Wallets() {
  const wallets = useWallet((st) => st.wallets);
  return (
    <>
      {wallets.length ? (
        <div className={q.wallets}>
          {wallets.map((w) => (
            <button key={w.name} className={q.choice} onClick={() => void cityAccount.getState().pick(w.name)}>
              <b>{w.name}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className={q.hint}>
          No Solana wallet in this browser.{' '}
          <a href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Get Phantom
          </a>
          , then come back.
        </div>
      )}
      <div className={q.pair}>
        <button className={q.quiet} onClick={() => cityAccount.getState().cancel()}>
          Back
        </button>
      </div>
    </>
  );
}

function ResidentCard() {
  const me = useQuarter((st) => st.me);
  if (!me) return null;
  const built = me.buildings.length;
  const home = me.buildings.find((b) => b.kind === 'home');
  const line = home ? `${moduleForKind('home')?.name ?? 'Home'} · level ${home.level}${built > 1 ? ` · ${built} buildings` : ''}` : 'An empty lot, ready for your home.';
  const title = `${streetName(me.quarter.street)} · Lot ${lotNumber(me.quarter.cell)}`;
  return <ResidentBody title={title} line={line} idle={home ? 'Build' : 'Build your home'} />;
}

function ResidentBody({ title, line, idle }: { title: string; line: string; idle: string }) {
  const step = useStepLabel(idle);
  // Building asks for the signed-in wallet too: one that came back locked or changed signs in first.
  const open = () => {
    wakeSound();
    void cityAccount.getState().begin('build', 'card');
  };
  return (
    <div className={`${s.panel} ${s.slot}`}>
      <Head kicker="Your quarter" />
      <div className={q.row}>
        <span className={q.badge}>
          <LotGlyph />
        </span>
        <div className={q.words}>
          <div className={q.title}>{title}</div>
          <div className={`${q.line} ${step.error ? q.lineError : ''}`}>{step.error ?? step.line ?? line}</div>
        </div>
      </div>
      {step.picking ? (
        <Wallets />
      ) : (
        <button className={`${s.display} ${s.action}`} onClick={open} disabled={step.busy} aria-busy={step.busy}>
          {step.label}
        </button>
      )}
    </div>
  );
}
