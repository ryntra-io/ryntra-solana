'use client';

import { useEffect, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { decodeLinkSecret } from '@/lib/privacy/codes';
import { canReceive, readLink, solText, takeLink, type LinkState } from '@/lib/privacy/flows';
import { explorerUrl } from '@/lib/privacy/network';
import { loadPrivate } from '@/lib/privacy/sdk.client';
import { isPhoneUserAgent, withoutFragment } from '@/lib/solana/open-in-wallet';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, ActionBody, Chip, Figure, Kick, Page, PageHead, Panel, Quiet } from '@/terminal/ui';
import { Glyph } from '../glyphs';
import { SeenLine } from './PrivateBalance';
import { PRIVATE } from './words';
import s from './private.module.css';

type Read = 'reading' | 'broken' | 'failed' | 'ready';

type VaEvent = { url: string } & Record<string, unknown>;
type Va = ((...args: unknown[]) => void) & { q?: unknown[] };

/*
 * The link's key rides in the `#fragment`. Before any analytics event of this page can be sent, every event's address
 * loses its fragment: the queue `window.va` is Vercel Analytics' own documented way to set `beforeSend` ahead of its
 * script. This runs when the module loads — before the page's components mount and the script is injected.
 */
if (typeof window !== 'undefined') {
  const holder = window as unknown as { va?: Va; vaq?: unknown[] };
  holder.va ??= ((...args: unknown[]) => void (holder.vaq ??= []).push(args)) as Va;
  holder.va('beforeSend', (event: VaEvent) => ({ ...event, url: withoutFragment(event.url) }));
}

/**
 * The page a private link opens (`/private/claim#k=…`). The seed lives in the `#fragment`, which the browser never sends
 * to a server; it opens a one-time ring wallet that holds the money and its own network fees. Taking it is one tap: the
 * link's own key signs and pays, the person signs nothing and needs no SOL. Into their wallet in the open, or — when
 * they have a private balance — into it privately.
 */
async function copyHere(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch {
    return false;
  }
}

export function ClaimScreen() {
  const w = useWords(PRIVATE);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const [read, setRead] = useState<Read>('reading');
  const [state, setState] = useState<LinkState | null>(null);
  const [privateTo, setPrivateTo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const wallets = useWallet((st) => st.wallets.length);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  const walletless = phone && wallets === 0;

  useEffect(() => {
    let live = true;
    void (async () => {
      const seed = await decodeLinkSecret(window.location.hash);
      if (!seed) return live && setRead('broken');
      try {
        const ctx = await loadPrivate();
        const link = await readLink(ctx, seed);
        seed.fill(0);
        if (!live) return;
        setState(link);
        setRead('ready');
      } catch {
        if (live) setRead('failed');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!owner) return setPrivateTo(false);
    let live = true;
    void loadPrivate()
      .then((ctx) => canReceive(ctx, owner))
      .then((yes) => live && setPrivateTo(yes))
      .catch(() => live && setPrivateTo(false));
    return () => {
      live = false;
    };
  }, [owner]);

  async function take(into: 'wallet' | 'private') {
    if (!state || !owner || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const ctx = await loadPrivate();
      const landed = await takeLink(ctx, state, owner, into);
      setTaken(landed.signature);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const empty = read === 'ready' && state !== null && state.held <= 0n && !taken;

  return (
    <Page data-screen="private-claim">
      <PageHead title={w.claimTitle} mark={<Chip>{w.net}</Chip>} />
      <ActionBody
        sideLabel={w.claimHolds}
        side={
          <Panel gap={10} edge label={w.claimHolds}>
            <p className={s.line}>{w.claimNoFee}</p>
          </Panel>
        }
      >
        <Panel tone="hi" gap={16} edge label={w.claimTitle}>
          <div className={s.head}>
            <span className={s.badge}>
              <Glyph name="lock" />
            </span>
            <span className={s.words}>
              <Kick>{w.claimHolds}</Kick>
              {read === 'ready' && state ? <Figure value={digits(solText(taken ? 0n : state.held), lang)} unit="SOL" size="l" /> : null}
              {read === 'reading' ? <p className={s.line}>{w.reading}</p> : null}
              {read === 'broken' ? <p className={s.fail}>{w.claimBroken}</p> : null}
              {read === 'failed' ? <p className={s.fail}>{w.notRead}</p> : null}
              {empty ? <p className={s.line}>{w.claimTaken}</p> : null}
            </span>
          </div>
          {read === 'ready' && state && state.held > 0n && !taken ? (
            owner ? (
              privateTo ? (
                <>
                  <Action busy={busy} disabled={busy} onClick={() => void take('private')}>
                    {busy ? w.working : w.claimTakePrivate}
                  </Action>
                  <SeenLine action="claimPrivate" who={w.seenSender} w={w} />
                  <Quiet full disabled={busy} onClick={() => void take('wallet')}>
                    {w.claimTake}
                  </Quiet>
                  <SeenLine action="claimWallet" who={w.seenSender} w={w} />
                </>
              ) : (
                <>
                  <Action busy={busy} disabled={busy} onClick={() => void take('wallet')}>
                    {busy ? w.working : w.claimTake}
                  </Action>
                  <SeenLine action="claimWallet" who={w.seenSender} w={w} />
                </>
              )
            ) : walletless ? (
              // A phone's browser with no wallet: opening the page in a wallet's browser by a link would carry the key to
              // another site, so the person copies the link and opens it there.
              <>
                <p className={s.line}>{w.claimNoWallet}</p>
                <Action onClick={async () => setCopied(await copyHere())}>{copied ? w.copied : w.copyLink}</Action>
              </>
            ) : (
              <Action onClick={connectWallet}>{w.claimConnect}</Action>
            )
          ) : null}
          {failed ? <p className={s.fail}>{w.failed}</p> : null}
          {taken ? (
            <p className={s.tx}>
              {w.claimDone} ·{' '}
              <a href={explorerUrl('tx', taken)} target="_blank" rel="noreferrer">
                {w.tx}
              </a>
            </p>
          ) : null}
        </Panel>
      </ActionBody>
    </Page>
  );
}
