'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import {
  declaredVersions,
  deviceOf,
  keysFromAnswer,
  keysLine,
  keysRequest,
  publicOf,
  recordVerdict,
  reportText,
  sameBytes,
  signsV1,
  v1Line,
  type CheckReport,
  type RecordKeys,
  type Verdict,
} from '@/lib/privacy/check';
import type { Ctx } from '@/lib/privacy/flows';
import { PRIVATE_TEST, explorerUrl } from '@/lib/privacy/network';
import { loadPrivate } from '@/lib/privacy/sdk.client';
import { signMessageBytes, walletFeatures, walletSigner } from '@/lib/privacy/wallet.client';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, ActionBody, Chip, Kick, Page, PageHead, Panel, Quiet } from '@/terminal/ui';
import { PRIVATE } from './words';
import s from './private.module.css';

type Words = (typeof PRIVATE)['en'];
type Busy = 'keys' | 'v1' | 'send' | 'registry';

const EMPTY_KEYS: CheckReport['keys'] = { sameBytes: 'unknown', valid: 'unknown', repeatable: 'unknown', refused: null };
const EMPTY_V1: CheckReport['v1'] = { signed: 'unknown', messageKept: 'unknown', valid: 'unknown', landed: null, refused: null };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const said = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure)) || '—';

function Fact({ name, value, w }: { name: string; value: Verdict | string; w: Words }) {
  const text = value === 'yes' ? w.yes : value === 'no' ? w.no : value === 'unknown' ? w.unknown : value;
  return (
    <div className={s.fact}>
      <dt>{name}</dt>
      <dd className={value === 'yes' ? s.factYes : value === 'no' ? s.factNo : undefined}>{text}</dd>
    </div>
  );
}

/** One check: its name, one line of result, and the quiet button that runs it. */
function Check({ name, result, tone, children }: { name: string; result: string; tone: 'yes' | 'no' | null; children: ReactNode }) {
  return (
    <div className={s.check}>
      <Kick>{name}</Kick>
      <p className={tone === 'yes' ? s.resultYes : tone === 'no' ? s.resultNo : s.result} role="status">
        {result}
      </p>
      <div className={s.row}>{children}</div>
    </div>
  );
}

/** What the three checks found, in the page's words, each with its tone. */
function lines(report: CheckReport, w: Words) {
  const keys = keysLine(report);
  const keysText =
    keys.line === 'yes'
      ? w.check1Yes
      : keys.line === 'no'
        ? { 'no-sign': w.check1NoSign, changed: w.check1Changed, differs: w.check1Differs }[keys.why ?? 'no-sign']
        : keys.line === 'refused'
          ? w.refusedWith(report.keys.refused ?? '')
          : w.notChecked;
  const v1 = v1Line(report);
  const v1Text =
    v1.line === 'yes' ? w.check2Yes : v1.line === 'no' ? w.check2No : v1.line === 'refused' ? w.refusedWith(report.v1.refused ?? '') : v1.why === 'not-declared' ? w.check2NotDeclared : w.notChecked;
  const registryText = { unread: w.notChecked, failed: w.check3Failed, none: w.check3None, mine: w.check3Mine, other: w.check3Other, locked: w.check3Locked }[report.registry];
  const tone = (line: string): 'yes' | 'no' | null => (line === 'yes' ? 'yes' : line === 'no' || line === 'refused' ? 'no' : null);
  return {
    keys: { text: keysText, tone: tone(keys.line) },
    v1: { text: v1Text, tone: v1.line === 'unasked' && v1.why === 'not-declared' ? ('no' as const) : tone(v1.line) },
    registry: { text: registryText, tone: report.registry === 'mine' ? ('yes' as const) : report.registry === 'other' || report.registry === 'failed' ? ('no' as const) : null },
  };
}

/**
 * The wallet check (`/private/check`, test network only, not in any menu): three checks for the owner's wallet matrix —
 * does the wallet give the private balance's keys (the key request signed twice, the same bytes both times), does it
 * sign a version 1 transaction, and how Ryntra meets an address already turned on elsewhere (Solflare Private Mode).
 * One line a check and «Copy summary» for the lead; the facts behind «Details». No signature leaves the page: the key
 * request's signatures are compared and zeroed, only the public keys stay for the third check.
 */
export function WalletCheckScreen() {
  const w = useWords(PRIVATE);
  const connection = useWallet((st) => st.connection);
  const [keys, setKeys] = useState<CheckReport['keys']>(EMPTY_KEYS);
  const [v1, setV1] = useState<CheckReport['v1']>(EMPTY_V1);
  const [registry, setRegistry] = useState<CheckReport['registry']>('unread');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  /** The public keys the wallet's answer gave (check 1) — public, compared with the registry in check 3. */
  const mine = useRef<RecordKeys | null>(null);
  const signedV1 = useRef<Uint8Array | null>(null);

  useEffect(() => {
    setKeys(EMPTY_KEYS);
    setV1(EMPTY_V1);
    setRegistry('unread');
    setCopied(false);
    mine.current = null;
    signedV1.current = null;
  }, [connection?.wallet, connection?.address]);

  const features = connection ? walletFeatures(connection.wallet) : null;
  const versions = features ? declaredVersions(features.signTransaction) : null;
  const report: CheckReport | null = connection
    ? { wallet: connection.wallet, address: connection.address, device: 'desktop', versions, signMessage: features?.signMessage ?? false, keys, v1, registry }
    : null;

  async function run(kind: Busy, act: (ctx: Ctx) => Promise<void>) {
    setBusy(kind);
    setError(null);
    setCopied(false);
    try {
      await act(await loadPrivate());
    } catch (failure) {
      setError(said(failure));
    } finally {
      setBusy(null);
    }
  }

  /** One answer to the key request: its facts and, when it fits, the public keys it gives. Null — refused or none. */
  async function askOnce({ sdk, client }: Ctx, owner: string, wallet: string, request: Uint8Array) {
    let answer;
    try {
      answer = await signMessageBytes(wallet, owner, request);
    } catch (failure) {
      setKeys((was) => ({ ...was, refused: said(failure) }));
      return null;
    }
    if (!answer) return null;
    const kept = sameBytes(answer.signedMessage, request);
    const valid: Verdict = (await sdk.verifySignature(await sdk.getPublicKeyFromAddress(owner), answer.signature, request)) ? 'yes' : 'no';
    const got = keysFromAnswer(sdk, client.proofService, owner, request, answer);
    const found = got.ok ? publicOf(got.keys) : null;
    if (got.ok) got.keys.destroy?.();
    return { signature: answer.signature, kept, valid, found };
  }

  const checkKeys = () =>
    run('keys', async (ctx) => {
      if (!connection) return;
      const { address, wallet } = connection;
      setKeys(EMPTY_KEYS);
      mine.current = null;
      const request = keysRequest(ctx.sdk, address);
      const first = await askOnce(ctx, address, wallet, request);
      if (!first) return;
      setKeys({ sameBytes: first.kept, valid: first.valid, repeatable: 'unknown', refused: null });
      const second = await askOnce(ctx, address, wallet, request);
      const repeatable = second ? sameBytes(first.signature, second.signature) : 'unknown';
      first.signature.fill(0);
      second?.signature.fill(0);
      if (!second) return;
      const all = (v: Verdict, u: Verdict): Verdict => (v === 'no' || u === 'no' ? 'no' : v === 'yes' && u === 'yes' ? 'yes' : 'unknown');
      setKeys({ sameBytes: all(first.kept, second.kept), valid: all(first.valid, second.valid), repeatable, refused: null });
      if (repeatable === 'yes') mine.current = first.found;
    });

  const signV1 = () =>
    run('v1', async ({ sdk, client }) => {
      if (!connection) return;
      setV1(EMPTY_V1);
      const { value: latest } = await client.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      const me = connection.address;
      const message = sdk.pipe(
        sdk.createTransactionMessage({ version: 1 }),
        (m: unknown) => sdk.setTransactionMessageFeePayer(me, m),
        (m: unknown) => sdk.setTransactionMessageLifetimeUsingBlockhash(latest, m),
        (m: unknown) => sdk.appendTransactionMessageInstruction(sdk.getTransferSolInstruction({ source: { address: me }, destination: me, amount: 0n }), m),
      );
      const tx = sdk.compileTransaction(message);
      let wire: Uint8Array;
      try {
        wire = await walletSigner(connection.wallet, me).signWire(new Uint8Array(sdk.getTransactionEncoder().encode(tx)));
      } catch (failure) {
        return setV1({ ...EMPTY_V1, refused: said(failure) });
      }
      const signed = sdk.getTransactionDecoder().decode(wire);
      const kept = sameBytes(new Uint8Array(signed.messageBytes), new Uint8Array(tx.messageBytes));
      const signature: Uint8Array | null = signed.signatures[me] ?? null;
      const valid: Verdict = signature ? ((await sdk.verifySignature(await sdk.getPublicKeyFromAddress(me), signature, signed.messageBytes)) ? 'yes' : 'no') : 'no';
      signedV1.current = wire;
      setV1({ signed: signature ? 'yes' : 'no', messageKept: kept, valid, landed: null, refused: null });
    });

  const sendV1 = () =>
    run('send', async ({ sdk, client }) => {
      const wire = signedV1.current;
      // Sending is the test network's step only: off it the check signs and sends nothing, so it costs nothing.
      if (!wire || !PRIVATE_TEST) return;
      await client.solanaRpc.sendTransaction(toBase64(wire), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
      const signature = sdk.getSignatureFromTransaction(sdk.getTransactionDecoder().decode(wire)) as string;
      await client.confirmTransaction(signature);
      setV1((was) => ({ ...was, landed: signature }));
    });

  /** The registry's record for this address against the wallet's keys — read only, nothing is written. */
  const checkRegistry = () =>
    run('registry', async (ctx) => {
      if (!connection) return;
      const { address, wallet } = connection;
      let record: RecordKeys | null;
      try {
        const { records } = await ctx.client.getUserRecords([address]);
        record = (records[0] as RecordKeys | null | undefined) ?? null;
      } catch (failure) {
        setRegistry('failed');
        throw failure;
      }
      if (!record) return setRegistry('none');
      let found = mine.current;
      if (!found) {
        const answer = await askOnce(ctx, address, wallet, keysRequest(ctx.sdk, address));
        answer?.signature.fill(0);
        found = answer?.found ?? null;
      }
      setRegistry(found ? recordVerdict(record, found) : 'locked');
    });

  const said3 = report ? lines(report, w) : null;
  const label = (kind: Busy, idle: string) => (busy === kind ? (kind === 'registry' ? w.stageRead : kind === 'send' ? w.sendingV1 : w.working) : idle);

  return (
    <Page data-screen="private-check">
      <PageHead title={w.checkTitle} mark={PRIVATE_TEST ? <Chip>{w.net}</Chip> : undefined} />
      <ActionBody
        sideLabel={w.howTitle}
        side={
          <Panel gap={10} edge label={w.howTitle}>
            <ul className={s.howList}>
              <li>{w.checkHow1}</li>
              <li>{PRIVATE_TEST ? w.checkHow2 : w.checkHow2Real}</li>
              <li>{w.checkHow3}</li>
            </ul>
          </Panel>
        }
      >
        <Panel tone="hi" gap={16} edge label={w.checkTitle}>
          <p className={s.line}>{PRIVATE_TEST ? w.checkLine : w.checkLineReal}</p>
          {!connection || !report || !said3 ? (
            <Action onClick={connectWallet}>{w.connect}</Action>
          ) : (
            <>
              <Check name={w.check1} result={said3.keys.text} tone={said3.keys.tone}>
                <Quiet disabled={busy !== null || !report.signMessage} aria-busy={busy === 'keys' || undefined} onClick={() => void checkKeys()}>
                  {label('keys', w.check1Do)}
                </Quiet>
              </Check>
              <Check name={w.check2} result={said3.v1.text} tone={said3.v1.tone}>
                <Quiet disabled={busy !== null} aria-busy={busy === 'v1' || undefined} onClick={() => void signV1()}>
                  {label('v1', w.check2Do)}
                </Quiet>
                {PRIVATE_TEST ? (
                  <Quiet disabled={busy !== null || v1.signed !== 'yes' || v1.landed !== null} aria-busy={busy === 'send' || undefined} onClick={() => void sendV1()}>
                    {label('send', w.sendV1)}
                  </Quiet>
                ) : null}
                {v1.landed ? (
                  <a className={s.tx} href={explorerUrl('tx', v1.landed)} target="_blank" rel="noreferrer">
                    {w.landed}
                  </a>
                ) : null}
              </Check>
              <Check name={w.check3} result={said3.registry.text} tone={said3.registry.tone}>
                <Quiet disabled={busy !== null} aria-busy={busy === 'registry' || undefined} onClick={() => void checkRegistry()}>
                  {label('registry', w.check3Do)}
                </Quiet>
              </Check>
              {error ? <p className={s.fail}>{error}</p> : null}
              <div className={s.row}>
                <Quiet size="s" aria-expanded={details} aria-controls={details ? detailsId : undefined} onClick={() => setDetails((was) => !was)}>
                  {w.details}
                </Quiet>
              </div>
              {details ? (
                <dl className={s.facts} id={detailsId} aria-label={w.details}>
                  <Fact name={w.versions} value={versions ? versions.join(' · ') : w.notDeclared} w={w} />
                  <Fact name={w.declaresV1} value={signsV1(versions)} w={w} />
                  <Fact name={w.signsMessage} value={report.signMessage ? 'yes' : 'no'} w={w} />
                  <Fact name={w.sameBytes} value={keys.sameBytes} w={w} />
                  <Fact name={w.validSig} value={keys.valid} w={w} />
                  <Fact name={w.repeatable} value={keys.repeatable} w={w} />
                  <Fact name={w.v1Signed} value={v1.signed} w={w} />
                  <Fact name={w.v1Kept} value={v1.messageKept} w={w} />
                  <Fact name={w.validSig} value={v1.valid} w={w} />
                </dl>
              ) : null}
              <Action
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(reportText({ ...report, device: deviceOf(navigator.userAgent) }, new Date()));
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
