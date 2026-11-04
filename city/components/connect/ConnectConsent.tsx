'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useState } from 'react';

import { Mark } from '@/city/components/hud/Mark';
import { useWords } from '@/city/lib/i18n/dict';
import { hydrateLang } from '@/city/lib/i18n/lang';
import { appSigner, citySigner } from '@/city/lib/app-bridge/route';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { connectWallet, detectWallets, subscribeWallets, type DetectedWallet, type WalletConnection } from '@/lib/solana/wallet.client';
import { bytesToBase64, type SignInInput } from '@/lib/solana/wallet-signin.client';

import { CONNECT } from './words';
import s from './connect.module.css';

/**
 * The connect window (CITY-154): an AI chat asks to read the Solana market for a person, and the person approves with
 * their wallet — one signed message, no transaction. One action on the window, the honest line visible before it, the
 * rest behind «Details». The server checked the request before this rendered; it checks it again when the wallet signs.
 */

export type ConsentRequest = Readonly<{
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
}>;

export type ConnectView =
  | Readonly<{ kind: 'consent'; clientName: string; host: string; statement: string; request: ConsentRequest; denyUrl: string }>
  | Readonly<{ kind: 'refused'; message: string }>
  | Readonly<{ kind: 'guide'; mcpUrl: string }>;

type Phase = 'idle' | 'pick' | 'connecting' | 'signing' | 'done';

function ReadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M3 18 L9 11 L13 14.5 L21 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 6 H21 V11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 10.5 V7.5 a3.5 3.5 0 0 1 7 0 V10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  // The person's language before the first paint after hydration (CITY-79), as the city's document pages read it.
  useLayoutEffect(() => void hydrateLang(), []);
  return (
    <div className={s.stage}>
      <picture className={s.backdrop}>
        <source media="(min-width: 900px)" srcSet="/city/art/district-agents-1600.webp" />
        <img src="/city/art/district-agents-800.webp" alt="" />
      </picture>
      <div className={s.veil} aria-hidden="true" />
      <section className={s.card} aria-live="polite">
        {children}
      </section>
    </div>
  );
}

function Brand() {
  return (
    <div className={s.brand}>
      <Mark size={44} />
      <span className={s.word}>RYNTRA</span>
    </div>
  );
}

function Consent({ view }: { view: Extract<ConnectView, { kind: 'consent' }> }) {
  const w = useWords(CONNECT);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<readonly DetectedWallet[]>([]);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    setPhone(isPhoneUserAgent(navigator.userAgent));
    const read = () => setWallets(detectWallets());
    read();
    return subscribeWallets(read);
  }, []);

  async function sign(connection: WalletConnection) {
    setPhase('signing');
    const issued = await fetch('/api/connect/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: connection.address, request: view.request }),
    }).catch(() => null);
    const body = issued ? ((await issued.json().catch(() => ({}))) as { nonce?: string; input?: SignInInput; message?: string; error_description?: string }) : {};
    if (!issued?.ok || !body.nonce || !body.input || !body.message) {
      setPhase('idle');
      setError(body.error_description ?? w.failed);
      return;
    }
    const signed = await citySigner.signIn(connection.wallet, body.input, body.message);
    if (!signed.ok) {
      setPhase('idle');
      setError(signed.state === 'REFUSED' || signed.state === 'CANCELLED' ? w.declined : signed.reason || w.failed);
      return;
    }
    if (signed.address !== connection.address) {
      setPhase('idle');
      setError(w.walletChanged);
      return;
    }
    const approved = await fetch('/api/connect/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: body.nonce, address: signed.address, signedMessage: bytesToBase64(signed.signedMessage), signature: bytesToBase64(signed.signature) }),
    }).catch(() => null);
    const answer = approved ? ((await approved.json().catch(() => ({}))) as { redirect?: string; error_description?: string }) : {};
    if (!approved?.ok || !answer.redirect) {
      setPhase('idle');
      setError(answer.error_description ?? w.failed);
      return;
    }
    setPhase('done');
    window.location.assign(answer.redirect);
  }

  async function connectWith(name: string | null) {
    setError(null);
    setPhase('connecting');
    const app = appSigner();
    const result = app ? await app.connect() : name ? await connectWallet(name) : null;
    if (!result || !result.ok) {
      setPhase(wallets.length > 1 ? 'pick' : 'idle');
      if (result && result.state !== 'CANCELLED') setError(result.state === 'REFUSED' ? w.declined : result.reason || w.failed);
      return;
    }
    await sign(result.connection);
  }

  function approve() {
    if (appSigner()) return void connectWith(null);
    if (wallets.length === 1) return void connectWith(wallets[0].name);
    setError(null);
    setPhase('pick');
  }

  const busy = phase === 'connecting' || phase === 'signing' || phase === 'done';
  const here = typeof window === 'undefined' ? '' : window.location.href;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <>
      <Brand />
      <h1 className={s.title}>{w.connectTitle(view.clientName)}</h1>
      <div className={s.host}>{view.host}</div>
      <p className={s.lede}>{w.lede}</p>
      <ul className={s.terms}>
        <li>
          <span className={s.icon}>
            <ReadIcon />
          </span>
          {w.canRead}
        </li>
        <li>
          <span className={s.icon}>
            <LockIcon />
          </span>
          {w.cannotMove}
        </li>
      </ul>

      {phase === 'pick' ? (
        wallets.length ? (
          <div className={s.wallets} role="group" aria-label={w.pickWallet}>
            {wallets.map((wallet) => (
              <button key={wallet.name} className={s.wallet} onClick={() => void connectWith(wallet.name)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {wallet.icon ? <img src={wallet.icon} alt="" width={28} height={28} /> : null}
                <span>{wallet.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className={s.wallets}>
            <p className={s.quietLine}>{w.noWallet}</p>
            <a className={s.action} href={phone ? phantomBrowseUrl(here, origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer">
              {phone ? w.openInPhantom : w.getPhantom}
            </a>
          </div>
        )
      ) : (
        <button className={s.action} onClick={approve} disabled={busy}>
          {phase === 'connecting' ? w.connecting : phase === 'signing' ? w.signing : phase === 'done' ? w.done(view.clientName) : w.approve}
        </button>
      )}

      {error ? <p className={s.error}>{error}</p> : null}

      <div className={s.foot}>
        <a className={s.quiet} href={view.denyUrl} aria-disabled={busy}>
          {w.notNow}
        </a>
        <button className={s.quiet} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {w.details}
        </button>
      </div>

      {open ? (
        <dl className={s.details}>
          <dt>{w.detailsWalletShows}</dt>
          <dd className={s.quote}>{view.statement}</dd>
          <dt>{w.detailsAccess}</dt>
          <dd>{w.detailsAccessText}</dd>
          <dd>{w.detailsNothing}</dd>
        </dl>
      ) : null}
    </>
  );
}

function Guide({ mcpUrl }: { mcpUrl: string }) {
  const w = useWords(CONNECT);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Brand />
      <h1 className={s.title}>{w.guideTitle}</h1>
      <p className={s.lede}>{w.guideLede}</p>
      <button
        className={s.address}
        onClick={() => {
          void navigator.clipboard?.writeText(mcpUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_600);
          });
        }}
      >
        <span className={s.url}>{mcpUrl}</span>
        <span className={s.copy}>{copied ? w.copied : w.copy}</span>
      </button>
      <ul className={s.terms}>
        <li>
          <span className={s.icon}>
            <ReadIcon />
          </span>
          {w.canRead}
        </li>
        <li>
          <span className={s.icon}>
            <LockIcon />
          </span>
          {w.cannotMove}
        </li>
      </ul>
      <div className={s.foot}>
        <Link className={s.quiet} href="/">
          {w.openCity}
        </Link>
        <button className={s.quiet} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {w.details}
        </button>
      </div>
      {open ? (
        <dl className={s.details}>
          <dd>{w.guideClaude}</dd>
          <dd>{w.guideChatGpt}</dd>
          <dd>{w.guideOther}</dd>
          <dd>{w.guideSign}</dd>
        </dl>
      ) : null}
    </>
  );
}

function Refused({ message }: { message: string }) {
  const w = useWords(CONNECT);
  return (
    <>
      <Brand />
      <h1 className={s.title}>{w.refusedTitle}</h1>
      <p className={s.lede}>{message}</p>
      <Link className={s.action} href="/">
        {w.openCity}
      </Link>
    </>
  );
}

export function ConnectConsent({ view }: { view: ConnectView }) {
  return (
    <Frame>
      {view.kind === 'consent' ? <Consent view={view} /> : view.kind === 'guide' ? <Guide mcpUrl={view.mcpUrl} /> : <Refused message={view.message} />}
    </Frame>
  );
}
