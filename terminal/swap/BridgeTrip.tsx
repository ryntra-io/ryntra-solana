'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { formatUnits } from '@/city/lib/trade/format';
import { relayRequestUrl } from '@/lib/relay/chains';
import { Action, Icon, Quiet } from '@/terminal/ui';
import { settled, txLink, type Transfer, type TransferState } from './bridge-form';
import { chainOf, newTransfer, useBridge } from './bridge-store';
import { RELAY_BRIDGE } from './bridge-words';
import { CoinMark } from './BridgePick';
import b from './bridge.module.css';

const STEPS = ['sign', 'sent', 'bridging', 'done'] as const;
const COPIED_MS = 2_000;

function reached(state: TransferState): number {
  if (state === 'done') return 4;
  if (state === 'bridging' || state === 'slow' || state === 'refunded' || state === 'failed') return 2;
  if (state === 'expired' || state === 'reverted') return 1;
  if (state === 'unconfirmed') return 2;
  if (state === 'sent' || state === 'waiting') return 1;
  return 0;
}

/**
 * One transfer on its way, in the form's place: «Підпиши в гаманці → Відправлено → Іде мостом → Отримано»,
 * each step with its transaction once there is one, and the order at Relay. A deposit address stands here with its exact
 * amount, its code and its address until the money arrives. Nothing waits forever: the SDK hands a slow order over to
 * the page, which keeps asking Relay — after a reload too.
 */
export function BridgeTrip() {
  const w = useWords(RELAY_BRIDGE);
  const run = useBridge((st) => st.run);
  const kept = useBridge((st) => (st.run ? (st.transfers.find((entry) => entry.requestId === st.run?.requestId) ?? null) : null));
  // Before its deposit is sent the transfer is only drafted: shown here, kept nowhere.
  const transfer = kept ?? run?.draft ?? null;
  const chains = useBridge((st) => st.chains);
  if (!run) return null;
  const state = transfer?.state ?? run.state;
  if (transfer?.depositAddress && state === 'waiting') return <Deposit transfer={transfer} />;
  const at = reached(state);
  const origin = transfer ? chainOf(chains, transfer.from.chainId) : null;
  const destination = transfer ? chainOf(chains, transfer.to.chainId) : null;
  const word: Readonly<Record<(typeof STEPS)[number], string>> = { sign: w.sign, sent: w.sent, bridging: w.bridging, done: w.done };
  const verdict =
    state === 'refunded'
      ? { tone: 'warn', text: w.refunded }
      : state === 'failed'
        ? { tone: 'down', text: w.failed }
        : state === 'expired'
          ? { tone: 'warn', text: w.expired }
          : state === 'reverted'
            ? { tone: 'down', text: w.reverted }
            : state === 'unconfirmed'
              ? { tone: 'warn', text: transfer?.depositAddress && !transfer.originTx ? w.unpaid : w.unconfirmed }
          : state === 'cancelled'
            ? { tone: 'warn', text: w.cancelled }
            : state === 'slow'
              ? { tone: 'warn', text: w.slow }
              : null;
  const links: Partial<Record<(typeof STEPS)[number], string | null>> = {
    sent: transfer?.originTx ? txLink(origin?.explorer ?? null, transfer.originTx[1]) : null,
    done: transfer?.destinationTx && state === 'done' ? txLink(destination?.explorer ?? null, transfer.destinationTx[1]) : null,
  };
  return (
    <>
      {transfer ? <Trip transfer={transfer} /> : null}
      <ol className={b.steps} aria-live="polite">
        {STEPS.map((step, index) => {
          const where = index < at ? 'done' : index === at && !settled(state) ? 'now' : 'next';
          const link = links[step];
          return (
            <li key={step} className={b.step} data-at={where}>
              <span className={b.dot}>{where === 'done' ? <Icon name="check" size="s" /> : null}</span>
              <span>{word[step]}</span>
              {link ? (
                <a className={b.stepLink} href={link} target="_blank" rel="noreferrer">
                  {w.tx}
                </a>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ol>
      {verdict ? (
        <p className={b.verdict} data-tone={verdict.tone} role="status">
          {verdict.text}
        </p>
      ) : null}
      {kept && ((!settled(state) && state !== 'sign') || state === 'unconfirmed') ? (
        <a className={b.link} href={relayRequestUrl(kept.requestId)} target="_blank" rel="noreferrer">
          {w.track}
        </a>
      ) : null}
      {settled(state) ? (
        <Action onClick={newTransfer}>{w.newTransfer}</Action>
      ) : (
        // A wallet that never answers does not hold the form: the person can always step away.
        <Quiet full onClick={newTransfer}>
          {state === 'sign' ? w.close : w.newTransfer}
        </Quiet>
      )}
    </>
  );
}

function Trip({ transfer }: { transfer: Transfer }) {
  return (
    <div className={b.trip}>
      <span className={b.tripSide}>
        <CoinMark coin={{ chainId: transfer.from.chainId, address: transfer.from.address ?? '', symbol: transfer.from.symbol, logo: transfer.from.logo === true }} size="s" />
        <b>{digits(formatUnits(transfer.from.amountRaw, transfer.from.decimals))}</b>
        <span>{transfer.from.symbol}</span>
      </span>
      <Icon name="arrow" size="s" className={b.tripArrow} />
      <span className={b.tripSide}>
        <CoinMark coin={{ chainId: transfer.to.chainId, address: transfer.to.address ?? '', symbol: transfer.to.symbol, logo: transfer.to.logo === true }} size="s" />
        <b>{digits(formatUnits(transfer.to.amountRaw, transfer.to.decimals, 'down'))}</b>
        <span>{transfer.to.symbol}</span>
      </span>
    </div>
  );
}

/** What a wallet scans: Bitcoin's own payment link with the amount; the bare address elsewhere. */
function payLink(vm: string | undefined, address: string, amount: string): string {
  return vm === 'bvm' ? `bitcoin:${address}?amount=${amount}` : address;
}

function Deposit({ transfer }: { transfer: Transfer }) {
  const w = useWords(RELAY_BRIDGE);
  const chains = useBridge((st) => st.chains);
  const origin = chainOf(chains, transfer.from.chainId);
  const address = transfer.depositAddress ?? '';
  const exact = formatUnits(transfer.from.amountRaw, transfer.from.decimals);
  const plain = (() => {
    const raw = transfer.from.amountRaw.padStart(transfer.from.decimals + 1, '0');
    const whole = raw.slice(0, raw.length - transfer.from.decimals);
    const fraction = raw.slice(raw.length - transfer.from.decimals).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  })();
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(payLink(origin?.vm, address, plain), { margin: 0, width: 320, errorCorrectionLevel: 'M' }).then(
      (url) => live && setCode(url),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [origin?.vm, address, plain]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // A refused clipboard leaves the address on screen to be copied by hand.
    }
  };
  return (
    <>
      <Trip transfer={transfer} />
      <div className={b.deposit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {code ? <img className={b.qr} src={code} alt="" /> : <span className={b.qr} />}
        <div className={b.depositText}>
          <p className={b.depositAmount}>{w.sendExactly(digits(plain === exact ? exact : plain), transfer.from.symbol, origin?.label ?? '')}</p>
          <p className={b.depositAddress} translate="no">
            {address}
          </p>
          <p className={b.warn}>{w.once}</p>
        </div>
      </div>
      <p className={b.verdict} data-tone="warn" role="status">
        {w.waiting}
      </p>
      <Action onClick={() => void copy()}>{copied ? w.copied : w.copy}</Action>
      <Quiet full onClick={newTransfer}>
        {w.newTransfer}
      </Quiet>
    </>
  );
}
