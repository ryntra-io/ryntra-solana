'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { bare } from '@/city/lib/partners/district';
import { usePartners } from '@/city/lib/partners/store';
import { startWallets, useWallet } from '@/city/lib/trade/wallet';
import { isPhoneUserAgent, phantomBrowseUrl, PHANTOM_DOWNLOAD_URL } from '@/lib/solana/open-in-wallet';
import { CopyGlyph } from './glyphs';
import s from './partners.module.css';
import { PARTNERS } from './words';

/** How long «Copied» stays on the button. */
const COPIED_MS = 1_800;

/**
 * «Copy my link» (CITY-177): the partner's own link in one tap, on the partner page `/partners` and at the head of the
 * city's «Partners» window. No wallet — «Connect wallet» (a wallet this site was granted before comes back silently).
 * A wallet — the same proven read «My district» makes (`/api/rewards`, one signature, no transaction), which carries
 * the person's own link; then the tap copies it. Nothing here pays, binds or writes beyond that read.
 */
export function CopyLink({ className }: { className?: string }) {
  const w = useWords(PARTNERS);
  const demo = usePartners((st) => st.demo);
  const connection = useWallet((st) => st.connection);
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const owner = connection?.address ?? null;
  const status = usePartners((st) => (st.demo || st.owner === owner ? st.status : 'none'));
  const link = usePartners((st) => (st.demo || st.owner === owner ? (st.view?.link ?? null) : null));
  const message = usePartners((st) => st.message);
  const [picking, setPicking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    startWallets();
    setPhone(isPhoneUserAgent(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (owner && !demo) void usePartners.getState().read(owner);
  }, [owner, demo]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // The link stands whole under the button.
    }
  };

  const prove = async () => {
    if (!connection) return;
    await usePartners.getState().prove(connection);
    const ready = usePartners.getState().view?.link;
    if (ready) void copy(ready);
  };

  let main: React.ReactNode;
  let line: React.ReactNode = null;

  if (link) {
    main = (
      <button type="button" className={`${s.display} ${s.action} ${s.actionIcon}`} onClick={() => void copy(link)} data-copy-link="">
        <CopyGlyph />
        {copied ? w.copied : w.copyMine}
      </button>
    );
    line = (
      <span className={s.copyLine} translate="no">
        {bare(link)}
      </span>
    );
  } else if (!owner) {
    if (!wallets.length) {
      main = (
        <a
          className={`${s.display} ${s.action}`}
          href={phone ? phantomBrowseUrl(window.location.href, window.location.origin) : PHANTOM_DOWNLOAD_URL}
          target={phone ? undefined : '_blank'}
          rel="noreferrer"
          data-copy-link=""
        >
          {w.connectWallet}
        </a>
      );
    } else {
      const only = wallets.length === 1 ? wallets[0] : null;
      main = (
        <button
          type="button"
          className={`${s.display} ${s.action}`}
          disabled={Boolean(connecting)}
          onClick={() => (only ? void useWallet.getState().connect(only.name) : setPicking((v) => !v))}
          aria-expanded={only ? undefined : picking}
          data-copy-link=""
        >
          {connecting ? w.proving : w.connectWallet}
        </button>
      );
      if (picking && !only) {
        line = (
          <div className={s.copyWallets}>
            {wallets.map((wallet) => (
              <button key={wallet.name} type="button" className={s.copyWallet} disabled={Boolean(connecting)} onClick={() => void useWallet.getState().connect(wallet.name)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
                {wallet.name}
              </button>
            ))}
          </div>
        );
      }
    }
  } else if (status === 'proof' || status === 'proving') {
    main = (
      <button type="button" className={`${s.display} ${s.action} ${s.actionIcon}`} disabled={status === 'proving'} onClick={() => void prove()} data-copy-link="">
        <CopyGlyph />
        {status === 'proving' ? w.proving : w.copyMine}
      </button>
    );
    line = <span className={s.copyNote}>{message ?? w.oneSign}</span>;
  } else if (status === 'failed') {
    main = (
      <button type="button" className={`${s.display} ${s.secondary} ${s.copyRetry}`} onClick={() => void usePartners.getState().read(owner, true)} data-copy-link="">
        {w.retry}
      </button>
    );
  } else {
    main = (
      <button type="button" className={`${s.display} ${s.action} ${s.actionIcon}`} disabled aria-busy="true" data-copy-link="">
        <CopyGlyph />
        {w.copyMine}
      </button>
    );
  }

  return (
    <div className={`${s.copy} ${className ?? ''}`}>
      {main}
      {line}
    </div>
  );
}
