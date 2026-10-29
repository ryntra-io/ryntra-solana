'use client';

import { useEffect, useState } from 'react';
import { ACCOUNT_WORDS, accountKind, collateralOf, healthOf, HEALTH_WORDS, type AccountKind } from '@/city/lib/exchange/account';
import { micro, percent, units, usd } from '@/city/lib/exchange/format';
import { onboardingOf, ONBOARDING_WORDS, PHOENIX_URL } from '@/city/lib/exchange/onboarding';
import { BUSY, collateralCheck, maxText, useExchange } from '@/city/lib/exchange/store';
import { colourOf } from '@/city/lib/trade/colour';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import type { GuardianView } from '@/lib/phoenix/risk-guardian';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { ArtState } from './Art';
import { ArrowGlyph } from './glyphs';
import s from './exchange.module.css';

/** A clock that moves every fifteen seconds, so a health read long ago says it is out of date without a new read. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function useAccountKind(): AccountKind {
  const connected = useWallet((st) => Boolean(st.connection));
  const account = useExchange((st) => st.account);
  return accountKind(connected, account);
}

const TONE: Readonly<Record<GuardianView['state'], string>> = {
  healthy: '#C9A2FF',
  raised: 'var(--amber)',
  critical: 'var(--flare)',
  stale: 'var(--text-dim)',
  liquidation: 'var(--flare)',
};

/**
 * The account panel: the wallet to connect, or Phoenix's word on the account — no account (accounts by invite),
 * waiting for access, reduce only — or the account itself: its health on the engine's scale, its collateral by
 * Phoenix's margin view, and the two moves of USDC collateral through the engine's Review.
 */
export function AccountPanel({ compact = false }: { compact?: boolean }) {
  const kind = useAccountKind();
  const words = ACCOUNT_WORDS[kind];
  if (kind === 'connect') return <ConnectCard compact={compact} />;
  if (kind === 'loading') {
    return (
      <div className={s.block} aria-label="Reading your Phoenix account">
        <div className={s.label}>Your account</div>
        <span className={s.shimmer} />
        <span className={`${s.shimmer} ${s.shimmerShort}`} />
      </div>
    );
  }
  if (kind === 'active' || kind === 'unknown' || kind === 'inactive' || kind === 'reduceOnly') return <Account kind={kind} />;
  if (kind === 'invite' || kind === 'frozen') return <OpenAccount kind={kind} />;
  // Phoenix not answering: one still and one title.
  return (
    <div className={s.block} role="status">
      <ArtState art="empty" title={words.title} line={words.line || undefined} />
    </div>
  );
}

/**
 * The one step before a first trade (`onboarding.ts`): a wallet without a Phoenix account opens it on Phoenix's own
 * site — the engine has no route that opens one yet — and the window reads the account again when the person comes
 * back to it, or on «Check again» behind «Details». A wallet Phoenix holds until access is granted only waits, and can
 * look again.
 */
function OpenAccount({ kind }: { kind: 'invite' | 'frozen' }) {
  const step = onboardingOf(kind);
  const loadAccount = useExchange((st) => st.loadAccount);
  const [checking, setChecking] = useState(false);
  const [details, setDetails] = useState(false);
  // Back from Phoenix's site: the account is read again at once, not on the next round.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible') void useExchange.getState().loadAccount();
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);
  if (!step || step.step === 'connect') return null;
  const words = ONBOARDING_WORDS[step.step];
  const check = () => {
    setChecking(true);
    void loadAccount().finally(() => setChecking(false));
  };
  return (
    <div className={s.block} role="status">
      <ArtState art={step.step === 'open' ? 'invite' : 'empty'} title={words.title} line={words.line || undefined}>
        {step.step === 'open' ? (
          <>
            <a className={`${s.display} ${s.artAction}`} href={PHOENIX_URL} target="_blank" rel="noopener noreferrer">
              {words.action} <ArrowGlyph />
            </a>
            <button className={s.quiet} aria-expanded={details} onClick={() => setDetails((on) => !on)}>
              Details
            </button>
            {details && (
              <div className={s.details}>
                {words.detail}
                <div>
                  <button className={s.quiet} onClick={check} disabled={checking}>
                    {checking ? 'Checking…' : 'Check again'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <button className={s.quiet} onClick={check} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        )}
      </ArtState>
    </div>
  );
}

/** No wallet yet: the still, «Connect a wallet» and the wallets this browser has; above a phone's ticket, without the still. */
export function ConnectCard({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className={s.block}>
        <div className={`${s.display} ${s.title}`}>{ACCOUNT_WORDS.connect.title}</div>
        <WalletPicker />
      </div>
    );
  }
  return (
    <div className={s.block}>
      <ArtState art="empty" title={ACCOUNT_WORDS.connect.title}>
        <WalletPicker />
      </ArtState>
    </div>
  );
}

function Account({ kind }: { kind: AccountKind }) {
  const read = useExchange((st) => st.account);
  const states = useExchange((st) => st.collateralStates);
  const form = useExchange((st) => st.collateralForm);
  const phase = useExchange((st) => st.phase);
  const openCollateral = useExchange((st) => st.openCollateral);
  const now = useNow();
  const collateral = collateralOf(read.value);
  const health = healthOf(read, now);
  const words = ACCOUNT_WORDS[kind];
  // Why a move is not offered is said on hover: the two buttons stay the one place to look.
  const closed = states === null ? 'Reading what this wallet may do' : !states.deposit && !states.withdraw ? 'Not open for this wallet yet' : undefined;
  const busy = BUSY.has(phase);
  return (
    <div className={s.block}>
      <div className={s.labelRow}>
        <div className={s.label} title={read.at ? `Phoenix, read ${new Date(read.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : undefined}>
          {kind === 'active' ? 'Account' : words.title}
        </div>
        {health && <Health health={health} />}
      </div>
      {kind !== 'active' && words.line && <div className={s.line}>{words.line}</div>}
      {collateral && (
        <div className={`${s.grid} ${s.gridWide}`}>
          <Cell label="Collateral" value={usd(collateral.collateralUsd)} />
          <Cell label="Value" value={usd(collateral.portfolioUsd)} />
          <Cell label="In use" value={usd(collateral.heldUsd)} />
          <Cell label="Free" value={micro(collateral.withdrawableMicro)} />
          {collateral.collateralSol !== null && collateral.collateralSol > 0 && <Cell label="SOL collateral" value={units(collateral.collateralSol, 'SOL')} />}
        </div>
      )}
      <div className={s.itemActions}>
        <button className={`${s.small} ${form?.action === 'deposit' ? s.chipOn : ''}`} title={closed} disabled={busy || !states?.deposit || !collateral?.canDeposit} onClick={() => openCollateral(form?.action === 'deposit' ? null : 'deposit')}>
          Deposit
        </button>
        <button className={`${s.small} ${form?.action === 'withdraw' ? s.chipOn : ''}`} title={closed} disabled={busy || !states?.withdraw || !collateral?.canWithdraw} onClick={() => openCollateral(form?.action === 'withdraw' ? null : 'withdraw')}>
          Withdraw
        </button>
      </div>
      {form && collateral && <CollateralForm withdrawableMicro={collateral.withdrawableMicro} />}
    </div>
  );
}

/** The account's health: one word and the margin left; a tap opens Phoenix's own detail under it, and closes it. */
function Health({ health }: { health: GuardianView }) {
  const words = HEALTH_WORDS[health.state];
  const [open, setOpen] = useState(false);
  const detail = [health.state === 'healthy' ? null : words.line, health.tier ? `Phoenix risk tier: ${health.tier}` : null, health.stale && health.state !== 'stale' ? 'Figures from the last read' : null, health.partial ? 'Not every subaccount read' : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <button className={s.health} style={{ ['--tone' as string]: TONE[health.state] }} aria-label={`Account health: ${words.word}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={!detail}>
        <span className={s.healthDot} aria-hidden="true" />
        <span className={s.healthWord}>{words.word}</span>
        {health.room !== null && <span className={s.healthRoom}>{percent(health.room, 0)} margin left</span>}
      </button>
      {open && detail && (
        <span className={s.details} role="status">
          {detail}
        </span>
      )}
    </>
  );
}

const ISSUE: Readonly<Record<'MIN' | 'WALLET' | 'WITHDRAWABLE' | 'CANARY', string>> = {
  MIN: 'From $1.',
  WALLET: 'More than the wallet holds.',
  WITHDRAWABLE: 'More than the account may withdraw now.',
  CANARY: 'Over the current limit.',
};

function CollateralForm({ withdrawableMicro }: { withdrawableMicro: bigint | null }) {
  const form = useExchange((st) => st.collateralForm)!;
  const states = useExchange((st) => st.collateralStates);
  const phase = useExchange((st) => st.phase);
  const asking = useExchange((st) => st.asking);
  const setText = useExchange((st) => st.setCollateralText);
  const review = useExchange((st) => st.reviewCollateral);
  const connection = useWallet((st) => st.connection);
  const check = collateralCheck(form, states, withdrawableMicro);
  const deposit = form.action === 'deposit';
  const wallet = states?.walletUsdc ?? null;
  const reviewing = phase === 'reviewing' && asking?.kind === form.action;
  return (
    <div className={s.block}>
      <div className={s.labelRow}>
        <div className={s.label}>{deposit ? 'Deposit USDC' : 'Withdraw USDC'}</div>
        <div className={s.labelSide}>{deposit ? `Wallet ${micro(wallet)}` : `Free ${micro(withdrawableMicro)}`}</div>
      </div>
      <div className={s.field}>
        <span className={s.fieldUnit}>$</span>
        <input
          className={s.input}
          inputMode="decimal"
          placeholder="0.00"
          aria-label={deposit ? 'Amount to add, USDC' : 'Amount to withdraw, USDC'}
          value={form.text}
          onChange={(event) => setText(event.target.value)}
          disabled={BUSY.has(phase)}
        />
        <button className={s.small} disabled={check.maxMicro === null || BUSY.has(phase)} onClick={() => setText(maxText(check.maxMicro))}>
          Max
        </button>
      </div>
      {check.issue && <div className={`${s.notice} ${s.noticeWarn}`}>{ISSUE[check.issue]}</div>}
      <button
        className={`${s.choice} ${s.choiceOn} ${s.formAction}`}
        disabled={!connection || check.amount === null || check.issue !== null || BUSY.has(phase)}
        onClick={() => connection && void review(connection)}
      >
        {reviewing ? 'Preparing…' : deposit ? 'Review deposit' : 'Review withdrawal'}
      </button>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.cell}>
      <div className={s.cellLabel}>{label}</div>
      <div className={s.cellValue}>{value}</div>
    </div>
  );
}

export function WalletPicker() {
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    const here = typeof window === 'undefined' ? '' : window.location.href;
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return (
      <>
        <div className={s.notice}>No wallet in this browser</div>
        <a className={`${s.display} ${s.artAction}`} href={phone ? phantomBrowseUrl(here, origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer">
          {phone ? 'Open in Phantom' : 'Get Phantom'} <ArrowGlyph />
        </a>
      </>
    );
  }
  return (
    <>
      <div className={s.wallets}>
        {wallets.map((wallet) => (
          <button key={wallet.name} className={s.walletButton} onClick={() => void connect(wallet.name)} disabled={Boolean(connecting)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
            {connecting === wallet.name ? `Opening ${wallet.name}…` : wallet.name}
          </button>
        ))}
      </div>
      {error && <div className={`${s.notice} ${s.noticeError}`}>{error}</div>}
    </>
  );
}

export function WalletLine() {
  const connection = useWallet((st) => st.connection);
  const disconnect = useWallet((st) => st.disconnect);
  const phase = useExchange((st) => st.phase);
  if (!connection) return null;
  return (
    <div className={s.walletLine} style={{ ['--player' as string]: colourOf(connection.address) }}>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.address}>{shortAddress(connection.address)}</span>
      <span>· {connection.wallet}</span>
      <button className={s.linkButton} onClick={disconnect} disabled={BUSY.has(phase)}>
        Disconnect
      </button>
    </div>
  );
}
