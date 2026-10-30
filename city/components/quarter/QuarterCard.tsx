'use client';

import { useEffect, type ReactNode } from 'react';
import { hydrateFeed, useFeed } from '@/city/lib/feed/store';
import { useWords } from '@/city/lib/i18n/dict';
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
import { QUARTER } from './words';

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
  const w = useWords(QUARTER);
  return (
    <>
      <DistrictArt id="home" />
      <div className={q.head}>
        <div className={s.kicker}>
          <span className={q.spark} aria-hidden="true" />
          {kicker}
        </div>
        <button className={q.close} aria-label={w.closeArrivals} onClick={closeCard}>
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
  const w = useWords(QUARTER);
  if (step === 'connecting') return { label: w.opening(to ?? w.aWallet), busy: true, line: null, error: null, picking: false };
  if (step === 'signing') return { label: w.checkYourWallet, busy: true, line: w.signToKeep, error: null, picking: false };
  if (step === 'opening') return { label: w.openingQuarter, busy: true, line: null, error: null, picking: false };
  if (claiming) return { label: w.claiming, busy: true, line: null, error: null, picking: false };
  return { label: idle, busy: false, line: null, error: accountError ?? worldError, picking: step === 'pick' };
}

function ClaimCard() {
  const w = useWords(QUARTER);
  const step = useStepLabel(w.claim);
  const claim = () => {
    wakeSound();
    void cityAccount.getState().begin('claim', 'card');
  };
  return (
    <div className={`${s.panel} ${s.slot}`}>
      <Head kicker={w.arrivals} />
      <div className={q.row}>
        <span className={q.badge}>
          <LotGlyph />
        </span>
        <div className={q.words}>
          <div className={q.title}>{w.ownQuarter}</div>
          <div className={`${q.line} ${step.error ? q.lineError : ''}`}>{step.error ?? step.line ?? w.free}</div>
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
  const t = useWords(QUARTER);
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
          {t.noWallet}{' '}
          <a href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            {t.getPhantom}
          </a>
          {t.comeBack}
        </div>
      )}
      <div className={q.pair}>
        <button className={q.quiet} onClick={() => cityAccount.getState().cancel()}>
          {t.back}
        </button>
      </div>
    </>
  );
}

function ResidentCard() {
  const me = useQuarter((st) => st.me);
  const w = useWords(QUARTER);
  if (!me) return null;
  const built = me.buildings.length;
  const home = me.buildings.find((b) => b.kind === 'home');
  const line = home ? w.homeLine(moduleForKind('home')?.name ?? w.home, home.level, built) : w.emptyLot;
  const title = w.address(streetName(me.quarter.street), lotNumber(me.quarter.cell));
  return <ResidentBody title={title} line={line} idle={home ? w.build : w.buildHome} />;
}

function ResidentBody({ title, line, idle }: { title: string; line: string; idle: string }) {
  const w = useWords(QUARTER);
  const step = useStepLabel(idle);
  // Building asks for the signed-in wallet too: one that came back locked or changed signs in first.
  const open = () => {
    wakeSound();
    void cityAccount.getState().begin('build', 'card');
  };
  return (
    <div className={`${s.panel} ${s.slot}`}>
      <Head kicker={w.yourQuarter} />
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
