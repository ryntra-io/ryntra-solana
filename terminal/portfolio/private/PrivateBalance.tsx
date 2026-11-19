'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { exposureParts, type PrivateAction } from '@/lib/privacy/exposure';
import { lamportsOf, solText } from '@/lib/privacy/flows';
import { LINK_FEE_LAMPORTS, LINK_MIN_LAMPORTS, RING_SOL, explorerUrl } from '@/lib/privacy/network';
import { keyCopyFile } from '@/lib/privacy/codes';
import { usePrivate, type PrivateFailure } from '@/lib/privacy/usePrivate';
import { walletSignsV1 } from '@/lib/solana/wallet.client';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { AmountField, Chip, Figure, Kick, Panel, Quiet, QuietLink, Segment } from '@/terminal/ui';
import { Glyph } from '../glyphs';
import { PRIVATE } from './words';
import s from './private.module.css';

type Tab = 'hide' | 'return' | 'send';
type Words = (typeof PRIVATE)['en'];

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * «Others see»: who, to whom, how much — seen, hidden, or seen once taken to a wallet — before every signature, on one
 * line. `who` names the sender as the reader of this screen knows them: «you», or on a link's page «the sender».
 */
export function SeenLine({ action, w, who }: { action: PrivateAction; w: Words; who?: string }) {
  const name = { who: who ?? w.seenWho, to: w.seenTo, amount: w.seenAmount };
  const said = { seen: w.seenYes, hidden: w.seenNo, ifWallet: w.seenIfWallet } as const;
  return (
    <p className={s.seen} aria-label={w.seen}>
      <span>{w.seen}:</span>
      {exposureParts(action).map(([part, seen]) => (
        <span key={part} className={s.seenPart}>
          {name[part]} — <b className={seen === 'hidden' ? s.seenNo : s.seenYes}>{said[seen]}</b>
        </span>
      ))}
    </p>
  );
}

function failureText(failure: PrivateFailure, w: Words): string {
  if (failure.code === 'NOT_READ') return w.notReadAfter;
  if (failure.code === 'TOO_SMALL') return w.tooSmall;
  if (failure.code === 'WALLET_REFUSED') return w.refused;
  if (failure.code === 'KEYS_ELSEWHERE') return failure.detail === 'another wallet' || failure.detail === 'not these keys' || failure.detail === 'not a key copy' ? w.wrongCopy : w.elsewhere;
  return w.failed;
}

function TxLine({ signature, w }: { signature: string; w: Words }) {
  return (
    <p className={s.tx}>
      {w.done} ·{' '}
      <a href={explorerUrl('tx', signature)} target="_blank" rel="noreferrer">
        {w.tx}
      </a>
    </p>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * «Private balance» in Portfolio's side column, with the private balance open (`NEXT_PUBLIC_RYNTRA_PRIVATE`): the sum,
 * the coins, and Hide · Return · Send on one segment; before each signature the line «Others see». Everything else —
 * how it works, the key copy — waits behind «i» and quiet buttons. Only on the person's own wallet.
 */
export function PrivateBalance() {
  const w = useWords(PRIVATE);
  const connection = useWallet((st) => st.connection);
  const lang = useLang();
  const st = usePrivate();
  const [how, setHow] = useState(false);
  const howId = useId();

  useEffect(() => {
    usePrivate.getState().follow(connection?.wallet ?? null, connection?.address ?? null);
  }, [connection?.wallet, connection?.address]);

  const signsV1 = connection ? walletSignsV1(connection.wallet) : false;
  const sol = st.held?.find((h) => h.mint === RING_SOL)?.amount ?? 0n;
  const others = st.held?.filter((h) => h.mint !== RING_SOL) ?? [];

  return (
    <Panel gap={14} edge label={w.title} className={s.block}>
      <div className={s.head}>
        <span className={s.badge}>
          <Glyph name="lock" />
        </span>
        <span className={s.words}>
          <Kick>{w.title}</Kick>
          {st.phase === 'ready' ? <Figure value={digits(solText(sol), lang)} unit="SOL" size="m" /> : null}
          {st.phase === 'off' ? <p className={s.line}>{w.offLine}</p> : null}
          {st.phase === 'loading' ? <p className={s.line}>{w.reading}</p> : null}
        </span>
        <Chip>{w.net}</Chip>
        <ExplainButton label={w.howTitle} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
      </div>
      {how ? (
        <ExplainBox id={howId}>
          <ul className={s.howList}>
            <li>{w.how1}</li>
            <li>{w.how2}</li>
            <li>{w.how3}</li>
            <li>{w.how4}</li>
          </ul>
        </ExplainBox>
      ) : null}

      {connection && !signsV1 && (st.phase === 'off' || st.phase === 'ready') ? (
        <div className={s.row}>
          <p className={s.line}>{w.noV1}</p>
          <QuietLink href="/private/check" size="s">
            {w.checkWallet}
          </QuietLink>
        </div>
      ) : null}

      {st.phase === 'off' ? (
        <>
          <SeenLine action="enable" w={w} />
          <Quiet full disabled={st.busy !== null} aria-busy={st.busy === 'on' || undefined} onClick={() => void st.turnOn()}>
            {st.busy === 'on' ? w.turningOn : w.turnOn}
          </Quiet>
        </>
      ) : null}

      {st.phase === 'elsewhere' ? <Restore w={w} /> : null}

      {st.phase === 'failed' ? (
        <div className={s.row}>
          <p className={s.fail}>{w.notRead}</p>
          <Quiet size="s" onClick={() => void st.refresh()}>
            {w.again}
          </Quiet>
        </div>
      ) : null}

      {st.phase === 'ready' ? (
        <>
          {others.length ? (
            <ul className={s.coins} aria-label={w.coins}>
              {others.map((h) => (
                <li key={h.mint} className={s.coin}>
                  <span className={s.coinName} translate="no">
                    {h.mint.slice(0, 4)}…{h.mint.slice(-4)}
                  </span>
                  <span>{h.amount.toString()}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {st.copyDue ? <CopyDue w={w} /> : null}
          <Act w={w} held={sol} />
          <Links w={w} />
          <div className={s.row}>
            <span className={s.grow} />
            <SaveCopy w={w} label={w.keyCopy} size="s" />
          </div>
        </>
      ) : null}

      {st.failure && st.phase !== 'failed' ? (
        <div className={s.row}>
          <p className={s.fail} data-failure={st.failure.code}>
            {failureText(st.failure, w)}
          </p>
          {st.failure.code === 'NOT_READ' ? (
            <Quiet size="s" onClick={() => void st.refresh()}>
              {w.again}
            </Quiet>
          ) : null}
        </div>
      ) : null}
      {st.last && !st.busy && (!st.failure || st.failure.code === 'NOT_READ') ? <TxLine signature={st.last.signature} w={w} /> : null}
    </Panel>
  );
}

function SaveCopy({ w, label, size = 'm' }: { w: Words; label: string; size?: 'm' | 's' }) {
  const owner = usePrivate((st) => st.owner);
  return (
    <Quiet
      size={size}
      onClick={async () => {
        const copy = await usePrivate.getState().keyCopy();
        if (!copy || !owner) return;
        saveFile(`ryntra-private-${owner.slice(0, 6)}.txt`, keyCopyFile(copy.code, w.copyTitle, copy.links));
        await usePrivate.getState().copySaved();
      }}
    >
      {label}
    </Quiet>
  );
}

function CopyDue({ w }: { w: Words }) {
  return (
    <div className={s.note} role="status">
      <p className={s.line}>{w.copyDue}</p>
      <SaveCopy w={w} label={w.saveCopy} />
    </div>
  );
}

function Restore({ w }: { w: Words }) {
  const file = useRef<HTMLInputElement>(null);
  const busy = usePrivate((st) => st.busy === 'restore');
  return (
    <div className={s.form}>
      <p className={s.line}>{w.elsewhere}</p>
      <input
        ref={file}
        className={s.file}
        type="file"
        accept=".txt,text/plain"
        aria-label={w.restorePick}
        onChange={async (event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked) await usePrivate.getState().restore(await picked.text());
        }}
      />
      <Quiet full disabled={busy} aria-busy={busy || undefined} onClick={() => file.current?.click()}>
        {w.restore}
      </Quiet>
    </div>
  );
}

function Act({ w, held }: { w: Words; held: bigint }) {
  const lang = useLang();
  const [tab, setTab] = useState<Tab>('hide');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [needsLink, setNeedsLink] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = usePrivate((st) => st.busy);
  const lamports = lamportsOf(amount);
  const tooMuch = lamports !== null && tab !== 'hide' && lamports > held;
  const toOk = tab !== 'send' || ADDRESS.test(to.trim());
  const tooSmallLink = needsLink && lamports !== null && lamports < LINK_MIN_LAMPORTS;
  const ready = lamports !== null && !tooMuch && !tooSmallLink && toOk && busy === null;

  const reset = () => {
    setAmount('');
    setNeedsLink(false);
  };

  async function go() {
    if (lamports === null) return;
    const st = usePrivate.getState();
    if (tab === 'hide' && (await st.hide(lamports))) reset();
    if (tab === 'return' && (await st.giveBack(lamports))) reset();
    if (tab === 'send') {
      const sent = await st.send(to.trim(), lamports);
      if (sent === 'sent') reset();
      if (sent === 'link') setNeedsLink(true);
    }
  }

  async function asLink() {
    if (lamports === null) return;
    const url = await usePrivate.getState().makeLink(lamports);
    if (url) {
      setLink(url);
      reset();
    }
  }

  const action: PrivateAction = tab === 'send' ? (needsLink ? 'link' : 'send') : tab;
  const label = busy && busy !== 'take' ? w.working : tab === 'hide' ? w.hideDo : tab === 'return' ? w.returnDo : needsLink ? w.makeLink : w.sendDo;

  return (
    <div className={s.form}>
      <Segment
        label={w.actions}
        value={tab}
        onChange={(next) => {
          setTab(next);
          setNeedsLink(false);
          setLink(null);
        }}
        items={[
          { id: 'hide', label: w.hideTab },
          { id: 'return', label: w.returnTab },
          { id: 'send', label: w.sendTab },
        ]}
      />
      <AmountField label={w.amount} value={amount} onChange={setAmount} unit="SOL" size="s" aside={tab === 'hide' ? undefined : `${digits(solText(held), lang)} SOL`} />
      {tab === 'send' ? (
        <label className={s.field}>
          <span className={s.fieldLabel}>{w.to}</span>
          <input
            className={s.input}
            value={to}
            placeholder={w.toHint}
            spellCheck={false}
            autoComplete="off"
            translate="no"
            onChange={(event) => {
              setTo(event.target.value);
              setNeedsLink(false);
            }}
          />
        </label>
      ) : null}
      {needsLink ? <p className={s.line}>{w.noPrivate(digits(solText(LINK_FEE_LAMPORTS), lang))}</p> : null}
      {tooSmallLink ? <p className={s.fail}>{w.tooSmall}</p> : null}
      <SeenLine action={action} w={w} />
      <Quiet full disabled={!ready} aria-busy={(busy !== null && busy !== 'take') || undefined} onClick={() => void (needsLink ? asLink() : go())}>
        {label}
      </Quiet>
      {link ? (
        <div className={s.linkBox} role="status">
          <Kick>{w.linkReady}</Kick>
          <span className={s.linkText} translate="no">
            {link}
          </span>
          <div className={s.row}>
            <Quiet size="s" onClick={async () => setCopied(await copyText(link))}>
              {copied ? w.copied : w.copy}
            </Quiet>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Links({ w }: { w: Words }) {
  const lang = useLang();
  const links = usePrivate((st) => st.links);
  const busy = usePrivate((st) => st.busy);
  if (!links.length) return null;
  return (
    <div className={s.form}>
      <Kick>{w.myLinks}</Kick>
      <ul className={s.links}>
        {links.map((link) => (
          <li key={link.address} className={s.linkRow}>
            <span className={s.grow}>{`${digits(solText(link.lamports), lang)} SOL`}</span>
            <Quiet size="s" onClick={() => void copyText(link.url)}>
              {w.copy}
            </Quiet>
            <Quiet size="s" disabled={busy !== null} aria-busy={busy === 'take' || undefined} onClick={() => void usePrivate.getState().takeBack(link.address)}>
              {w.takeBack}
            </Quiet>
          </li>
        ))}
      </ul>
      <p className={s.line}>{w.linkHonest}</p>
    </div>
  );
}
