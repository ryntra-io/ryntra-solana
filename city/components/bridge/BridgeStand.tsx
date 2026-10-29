'use client';

import { verifyAsync } from '@noble/ed25519';
import { getAddressEncoder, type Address } from '@solana/kit';
import { useEffect, useState } from 'react';
import { mockApp, openExternal, pageBridge, shareThroughApp } from '@/city/lib/app-bridge/page';
import { base64ToBytes, bytesToBase64, REQUEST_TYPES, type RequestType } from '@/city/lib/app-bridge/protocol';
import type { FakeApp, FakeLogEntry, FakeMode } from '@/city/lib/app-bridge/mock';
import { citySigner } from '@/city/lib/app-bridge/route';
import { cityAccount, startCityAccount, useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { shortAddress } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import b from './bridge.module.css';

/**
 * The bridge stand (development only, `/city/bridge?bridge=mock`): the city's own wallet store, sign-in and signer,
 * talking to a fake Ryntra app through the same bridge the WebView uses. Each button is one request of the contract;
 * the switches set how the fake app's wallet answers it. Nothing here touches mainnet: the fake wallet is a throwaway
 * key, and the transaction it signs is a blank one that is never sent.
 */

const MODES: readonly FakeMode[] = ['approve', 'decline', 'fail', 'busy', 'unsupported', 'silent'];

type Line = Readonly<{ at: string; text: string; tone: 'ok' | 'no' | 'info' }>;

/** A legacy transaction with this one signer and no instructions: real bytes to sign, nothing to send. */
function blankTransaction(address: string): Readonly<{ wire: string; message: Uint8Array; key: Uint8Array }> {
  const key = new Uint8Array(getAddressEncoder().encode(address as Address));
  const message = new Uint8Array([1, 0, 1, 2, ...key, ...new Uint8Array(32), ...new Uint8Array(32).fill(9), 0]);
  return { wire: bytesToBase64(new Uint8Array([1, ...new Uint8Array(64), ...message])), message, key };
}

async function pngBlob(): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#9945ff';
  ctx.fillRect(0, 0, 64, 64);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function BridgeStand() {
  const [fake, setFake] = useState<FakeApp | null>(null);
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [log, setLog] = useState<readonly FakeLogEntry[]>([]);
  const [modes, setModes] = useState<Partial<Record<RequestType, FakeMode>>>({});
  const [ready, setReady] = useState<string | null>(null);
  const connection = useWallet((st) => st.connection);
  const wallets = useWallet((st) => st.wallets);
  const readiness = useReadiness();
  const step = useCityAccount((st) => st.step);
  const accountError = useCityAccount((st) => st.error);

  const say = (text: string, tone: Line['tone'] = 'info') =>
    setLines((now) => [{ at: new Date().toLocaleTimeString(), text, tone }, ...now].slice(0, 40));

  useEffect(() => {
    const stop = startCityAccount();
    const bridge = pageBridge();
    void mockApp()?.then(setFake);
    const off = bridge?.subscribe((event) => {
      if (event.type === 'app.ready') setReady(`${event.version} · ${event.platform}`);
      say(`${event.type}: ${event.wallet ? `${event.wallet.name} ${shortAddress(event.wallet.address)}` : 'no wallet'}`);
    });
    if (bridge?.ready()) setReady(`${bridge.ready()!.version} · ${bridge.ready()!.platform}`);
    return () => {
      off?.();
      stop();
    };
  }, []);

  useEffect(() => {
    if (!fake) return;
    const timer = setInterval(() => setLog([...fake.log].reverse()), 300);
    return () => clearInterval(timer);
  }, [fake]);

  if (!pageBridge()) {
    return (
      <div className={b.page}>
        <h1 className={b.title}>Bridge stand</h1>
        <p className={b.note}>
          No app here. Open <a href="?bridge=mock">/city/bridge?bridge=mock</a> for the fake Ryntra app, or this page inside the app.
        </p>
      </div>
    );
  }

  const setMode = (type: RequestType, mode: FakeMode) => {
    fake?.setMode(type, mode);
    setModes((now) => ({ ...now, [type]: mode }));
  };

  const connect = async () => {
    const name = wallets[0]?.name;
    if (!name) return say('The app has not said app.ready yet.', 'no');
    const ok = await useWallet.getState().connect(name);
    say(ok ? `connected ${shortAddress(useWallet.getState().connection!.address)}` : `not connected${useWallet.getState().error ? `: ${useWallet.getState().error}` : ' (closed in the wallet)'}`, ok ? 'ok' : 'no');
  };

  const signIn = async () => {
    const ok = await cityAccount.getState().begin(null, 'top');
    say(ok ? 'signed in (SIWS through /api/auth/solana)' : `sign-in did not go: ${cityAccount.getState().error ?? 'no answer'}`, ok ? 'ok' : 'no');
  };

  const signTransaction = async () => {
    if (!connection) return say('Connect first.', 'no');
    const blank = blankTransaction(connection.address);
    const answer = await citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: blank.wire, chain: 'solana:mainnet' });
    if (!answer.ok) return say(`not signed: ${answer.reason}`, 'no');
    const signed = base64ToBytes(answer.signedWireBase64);
    const valid = await verifyAsync(signed.subarray(1, 65), blank.message, blank.key);
    say(`signed; the signature ${valid ? 'verifies' : 'does NOT verify'} over the same message`, valid ? 'ok' : 'no');
  };

  const twoAtOnce = async () => {
    if (!connection) return say('Connect first.', 'no');
    const blank = blankTransaction(connection.address);
    const args = { wallet: connection.wallet, address: connection.address, unsignedWireBase64: blank.wire, chain: 'solana:mainnet' };
    const [first, second] = await Promise.all([citySigner.signTransaction(args), citySigner.signTransaction(args)]);
    say(`first: ${first.ok ? 'signed' : first.reason} · second: ${second.ok ? 'signed' : second.reason}`, second.ok ? 'no' : 'ok');
  };

  const share = async () => {
    const blob = await pngBlob();
    if (!blob) return say('No canvas.', 'no');
    const answer = await shareThroughApp(blob, 'tower.png', 'Every Solana coin is a tower.');
    say(`share.file: ${answer ?? 'not through the app'}`, answer === 'shared' ? 'ok' : 'no');
  };

  return (
    <div className={b.page}>
      <h1 className={b.title}>Bridge stand</h1>
      <p className={b.note}>
        CITY-6b · <code>docs/city/APP-BRIDGE.md</code>. App: {ready ?? 'waiting for app.ready…'} · wallet:{' '}
        {connection ? `${connection.wallet} ${shortAddress(connection.address)}` : 'none'} · sign-in: {readiness}
        {step ? ` (${step})` : ''}
        {accountError ? ` · ${accountError}` : ''}
      </p>

      <section className={b.row}>
        <button className={b.act} onClick={() => void connect()}>wallet.connect</button>
        <button className={b.act} onClick={() => void signIn()}>Sign in (signMessage)</button>
        <button className={b.act} onClick={() => void signTransaction()}>wallet.signTransactions</button>
        <button className={b.act} onClick={() => void twoAtOnce()}>Two at once (busy)</button>
        <button className={b.act} onClick={() => void share()}>share.file</button>
        <button className={b.act} onClick={() => openExternal('https://ryntra.io/')}>open.external</button>
        <a className={b.act} href="https://x.com/" target="_blank" rel="noreferrer">
          A link that leaves
        </a>
        <button className={b.act} onClick={() => void cityAccount.getState().disconnect()}>wallet.disconnect</button>
      </section>

      {fake ? (
        <section className={b.panel}>
          <h2 className={b.head}>The fake app&apos;s wallet answers</h2>
          <div className={b.grid}>
            {REQUEST_TYPES.map((type) => (
              <label key={type} className={b.mode}>
                <span>{type}</span>
                <select value={modes[type] ?? 'approve'} onChange={(event) => setMode(type, event.target.value as FakeMode)}>
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className={b.row}>
            <button className={b.quiet} onClick={() => void fake.changeWallet(true)}>Connect in the app (wallet.changed)</button>
            <button className={b.quiet} onClick={() => void fake.changeWallet(false)}>Disconnect in the app</button>
          </div>
        </section>
      ) : null}

      <div className={b.columns}>
        <section className={b.panel}>
          <h2 className={b.head}>The page</h2>
          <ol className={b.log}>
            {lines.map((line, i) => (
              <li key={i} className={b[line.tone]}>
                <time>{line.at}</time> {line.text}
              </li>
            ))}
          </ol>
        </section>
        <section className={b.panel}>
          <h2 className={b.head}>The app heard</h2>
          <ol className={b.log}>
            {log.map((entry, i) => (
              <li key={i} className={entry.answer === 'ok' ? b.ok : b.no}>
                {entry.type} → {entry.answer}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
