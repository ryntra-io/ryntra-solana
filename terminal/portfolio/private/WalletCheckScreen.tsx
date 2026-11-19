'use client';

import { useEffect, useRef, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { declaredVersions, reportText, sameBytes, signsV1, type CheckReport, type Verdict } from '@/lib/privacy/check';
import type { Ctx } from '@/lib/privacy/flows';
import { explorerUrl } from '@/lib/privacy/network';
import { loadPrivate } from '@/lib/privacy/sdk.client';
import { signMessageBytes, walletFeatures, walletSigner } from '@/lib/privacy/wallet.client';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, ActionBody, Chip, Kick, Page, PageHead, Panel, Quiet } from '@/terminal/ui';
import { PRIVATE } from './words';
import s from './private.module.css';

type Words = (typeof PRIVATE)['en'];

const EMPTY_ENVELOPE = { sameBytes: 'unknown', valid: 'unknown', repeatable: 'unknown' } as const;
const EMPTY_V1 = { signed: 'unknown', messageKept: 'unknown', valid: 'unknown', landed: null } as const;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function Fact({ name, value, w }: { name: string; value: Verdict | string; w: Words }) {
  const said = value === 'yes' ? w.yes : value === 'no' ? w.no : value === 'unknown' ? w.unknown : value;
  return (
    <div className={s.fact}>
      <dt>{name}</dt>
      <dd className={value === 'yes' ? s.factYes : value === 'no' ? s.factNo : undefined}>{said}</dd>
    </div>
  );
}

/**
 * The wallet check (`/private/check`, test network only, not in any menu): what the connected wallet does with the two
 * things the private balance needs — the key envelope `TSPP/derive/v1` signed as a message, and a version 1 transaction.
 * The owner runs it by hand with a test wallet; the copied report goes into the record. No signature leaves the page:
 * the envelope's signatures are compared and dropped.
 */
export function WalletCheckScreen() {
  const w = useWords(PRIVATE);
  const connection = useWallet((st) => st.connection);
  const [envelope, setEnvelope] = useState<CheckReport['envelope']>(EMPTY_ENVELOPE);
  const [v1, setV1] = useState<CheckReport['v1']>(EMPTY_V1);
  const [busy, setBusy] = useState<'envelope' | 'v1' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const first = useRef<Uint8Array | null>(null);
  const signedV1 = useRef<Uint8Array | null>(null);

  useEffect(() => {
    setEnvelope(EMPTY_ENVELOPE);
    setV1(EMPTY_V1);
    first.current?.fill(0);
    first.current = null;
    signedV1.current = null;
  }, [connection?.wallet, connection?.address]);

  const features = connection ? walletFeatures(connection.wallet) : null;
  const versions = features ? declaredVersions(features.signTransaction) : null;
  const report: CheckReport | null = connection
    ? { wallet: connection.wallet, address: connection.address, versions, signMessage: features?.signMessage ?? false, envelope, v1 }
    : null;

  async function run(kind: 'envelope' | 'v1' | 'send', act: (ctx: Ctx) => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await act(await loadPrivate());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(null);
    }
  }

  const signEnvelope = () =>
    run('envelope', async ({ sdk }) => {
      if (!connection) return;
      const message: Uint8Array = sdk.ed25519DerivationMessage(sdk.getAddressEncoder().encode(connection.address));
      const answer = await signMessageBytes(connection.wallet, connection.address, message);
      if (!answer) return setEnvelope({ sameBytes: 'no', valid: 'no', repeatable: 'unknown' });
      const key = await sdk.getPublicKeyFromAddress(connection.address);
      const valid: Verdict = (await sdk.verifySignature(key, answer.signature, message)) ? 'yes' : 'no';
      const kept = sameBytes(answer.signedMessage, message);
      let repeatable: Verdict = 'unknown';
      if (first.current) {
        repeatable = sameBytes(first.current, answer.signature);
        first.current.fill(0);
        first.current = null;
        answer.signature.fill(0);
      } else {
        first.current = answer.signature;
      }
      setEnvelope({ sameBytes: kept, valid, repeatable });
    });

  const signV1 = () =>
    run('v1', async ({ sdk, client }) => {
      if (!connection) return;
      const { value: latest } = await client.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      const me = connection.address;
      const message = sdk.pipe(
        sdk.createTransactionMessage({ version: 1 }),
        (m: unknown) => sdk.setTransactionMessageFeePayer(me, m),
        (m: unknown) => sdk.setTransactionMessageLifetimeUsingBlockhash(latest, m),
        (m: unknown) => sdk.appendTransactionMessageInstruction(sdk.getTransferSolInstruction({ source: { address: me }, destination: me, amount: 0n }), m),
      );
      const tx = sdk.compileTransaction(message);
      const wire = await walletSigner(connection.wallet, me).signWire(new Uint8Array(sdk.getTransactionEncoder().encode(tx)));
      const signed = sdk.getTransactionDecoder().decode(wire);
      const kept = sameBytes(new Uint8Array(signed.messageBytes), new Uint8Array(tx.messageBytes));
      const signature: Uint8Array | null = signed.signatures[me] ?? null;
      const valid: Verdict = signature ? ((await sdk.verifySignature(await sdk.getPublicKeyFromAddress(me), signature, signed.messageBytes)) ? 'yes' : 'no') : 'no';
      signedV1.current = wire;
      setV1({ signed: signature ? 'yes' : 'no', messageKept: kept, valid, landed: null });
    });

  const sendV1 = () =>
    run('send', async ({ sdk, client }) => {
      const wire = signedV1.current;
      if (!wire) return;
      await client.solanaRpc.sendTransaction(toBase64(wire), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
      const signature = sdk.getSignatureFromTransaction(sdk.getTransactionDecoder().decode(wire)) as string;
      await client.confirmTransaction(signature);
      setV1((was) => ({ ...was, landed: signature }));
    });

  return (
    <Page data-screen="private-check">
      <PageHead title={w.checkTitle} mark={<Chip>{w.net}</Chip>} />
      <ActionBody
        sideLabel={w.howTitle}
        side={
          <Panel gap={10} edge label={w.howTitle}>
            <ul className={s.howList}>
              <li>{w.checkHow1}</li>
              <li>{w.checkHow2}</li>
              <li>{w.checkHow3}</li>
            </ul>
          </Panel>
        }
      >
        <Panel tone="hi" gap={16} edge label={w.checkTitle}>
          <p className={s.line}>{w.checkLine}</p>
          {!connection || !report ? (
            <Action onClick={connectWallet}>{w.connect}</Action>
          ) : (
            <>
              <dl className={s.facts}>
                <Fact name={w.versions} value={versions ? versions.join(' · ') : w.notDeclared} w={w} />
                <Fact name={w.declaresV1} value={signsV1(versions)} w={w} />
                <Fact name={w.signsMessage} value={report.signMessage ? 'yes' : 'no'} w={w} />
              </dl>
              <Kick>{w.envelope}</Kick>
              <dl className={s.facts} aria-label={w.envelope}>
                <Fact name={w.sameBytes} value={envelope.sameBytes} w={w} />
                <Fact name={w.validSig} value={envelope.valid} w={w} />
                <Fact name={w.repeatable} value={envelope.repeatable} w={w} />
              </dl>
              <Quiet full disabled={busy !== null || !report.signMessage} aria-busy={busy === 'envelope' || undefined} onClick={() => void signEnvelope()}>
                {busy === 'envelope' ? w.working : envelope.valid === 'unknown' || envelope.repeatable !== 'unknown' ? w.signEnvelope : w.signAgain}
              </Quiet>
              <Kick>{w.v1}</Kick>
              <dl className={s.facts} aria-label={w.v1}>
                <Fact name={w.v1Signed} value={v1.signed} w={w} />
                <Fact name={w.v1Kept} value={v1.messageKept} w={w} />
                <Fact name={w.validSig} value={v1.valid} w={w} />
              </dl>
              <div className={s.row}>
                <Quiet disabled={busy !== null} aria-busy={busy === 'v1' || undefined} onClick={() => void signV1()}>
                  {busy === 'v1' ? w.working : w.signV1}
                </Quiet>
                <Quiet disabled={busy !== null || v1.signed !== 'yes' || v1.landed !== null} aria-busy={busy === 'send' || undefined} onClick={() => void sendV1()}>
                  {w.sendV1}
                </Quiet>
                {v1.landed ? (
                  <a className={s.tx} href={explorerUrl('tx', v1.landed)} target="_blank" rel="noreferrer">
                    {w.landed}
                  </a>
                ) : null}
              </div>
              {error ? <p className={s.fail}>{error}</p> : null}
              <Action
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(reportText(report, new Date()));
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? w.copied : w.copyReport}
              </Action>
            </>
          )}
        </Panel>
      </ActionBody>
    </Page>
  );
}
