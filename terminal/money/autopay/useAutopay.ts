'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AutopayCoin, AutopayEvery } from '@/lib/autopay/schedule';
import { citySigner } from '@/city/lib/app-bridge/route';
import { sameMessage } from '@/city/lib/bots/mandate-check';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { AUTOPAY_ENDPOINT, chainOf, checkAutopayUnsigned, listOf, reviewMatches, reviewOf, type AutopayNetwork, type AutopaysRead, type FormPlan, type Outcome } from './autopay-view';

const HEADERS = { 'content-type': 'application/json' };

async function post(url: string, body: unknown): Promise<Readonly<{ status: number; value: unknown }>> {
  try {
    const answer = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: HEADERS, body: JSON.stringify(body), cache: 'no-store' });
    return { status: answer.status, value: await answer.json().catch(() => null) };
  } catch {
    return { status: 0, value: null };
  }
}

const failed = (status: number): Outcome => (status === 401 ? 'locked' : status === 0 || status >= 500 ? 'unreachable' : 'refused');

/**
 * The person's autopays on the engine (`lib/autopay/**` behind `/api/v1/autopay`): the wallet's own list, read when the
 * wallet comes — never asking the wallet by itself —, a new autopay and «Stop». Each money step is the money logic's
 * own path (the same as the agent's budget, `city/lib/bots/mandate-sign.ts`): the server builds, the transactions are
 * read here from their own bytes before the wallet sees them, the wallet signs them in one prompt, what it hands back
 * must be the same messages, and the server relays them once. The wallet is asked only for the numbers the form showed.
 */
export function useAutopay(owner: string | null, network: AutopayNetwork | null) {
  const connection = useWallet((st) => st.connection);
  const [list, setList] = useState<AutopaysRead>({ state: 'reading' });
  const asked = useRef(0);

  const read = useCallback(async () => {
    if (!owner || !network) return;
    const mine = (asked.current += 1);
    setList((was) => (was.state === 'ready' ? was : { state: 'reading' }));
    let next: AutopaysRead;
    try {
      const answer = await fetch(AUTOPAY_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
      next = listOf(answer.status, await answer.json().catch(() => null), owner);
    } catch {
      next = { state: 'failed' };
    }
    if (mine === asked.current) setList(next);
  }, [owner, network]);

  useEffect(() => {
    asked.current += 1;
    setList({ state: 'reading' });
    void read();
  }, [read]);

  const unlock = useCallback(async (): Promise<'ok' | 'declined' | 'failed'> => {
    if (!connection || connection.address !== owner) return 'failed';
    const proof = await proveWallet(connection);
    if (proof.ok) await read();
    return proof.ok ? 'ok' : proof.state === 'declined' ? 'declined' : 'failed';
  }, [connection, owner, read]);

  /** Sign what the server built, after reading it: the signed transactions, or why there are none. */
  const signed = useCallback(
    async (transactions: readonly string[]): Promise<readonly string[] | Outcome> => {
      if (!connection || !network) return 'refused';
      if (!checkAutopayUnsigned(transactions, connection.address)) return 'changed';
      const result = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [...transactions], chain: chainOf(network) });
      if (!result.ok) return 'declined';
      if (result.signedWireBase64.length !== transactions.length || transactions.some((wire, index) => !sameMessage(wire, result.signedWireBase64[index]!))) return 'changed';
      return result.signedWireBase64;
    },
    [connection, network],
  );

  /** «Start autopay»: review → the numbers checked against the form → one wallet prompt → submit. */
  const start = useCallback(
    async (input: Readonly<{ to: string; label: string | null; address: string | null; coin: AutopayCoin; amount: string; every: AutopayEvery; plan: FormPlan }>): Promise<Outcome> => {
      if (!connection || connection.address !== owner || !network) return 'refused';
      const proof = await proveWallet(connection);
      if (!proof.ok) return proof.state === 'declined' ? 'declined' : 'refused';
      const built = await post(`${AUTOPAY_ENDPOINT}/review`, { to: input.to, label: input.label, coin: input.coin, amount: input.amount, every: input.every, count: input.plan.count });
      if (built.status !== 200) return failed(built.status);
      const review = reviewOf(built.value);
      if (!review || !reviewMatches(review, { owner: connection.address, coin: input.coin, every: input.every, plan: input.plan, address: input.address })) return 'changed';
      const wire = await signed(review.transactions);
      if (typeof wire === 'string') return wire;
      const sent = await post(`${AUTOPAY_ENDPOINT}/submit`, { draft: review.draft, transactions: wire });
      void read();
      return sent.status === 200 ? 'done' : failed(sent.status);
    },
    [connection, owner, network, signed, read],
  );

  /** «Stop»: the policy removed and the rest back — one wallet prompt. */
  const stop = useCallback(
    async (id: string): Promise<Outcome> => {
      if (!connection || connection.address !== owner) return 'refused';
      const proof = await proveWallet(connection);
      if (!proof.ok) return proof.state === 'declined' ? 'declined' : 'refused';
      const built = await post(`${AUTOPAY_ENDPOINT}/stop`, { id });
      const transaction = built.value && typeof built.value === 'object' ? (built.value as { transaction?: unknown }).transaction : null;
      if (built.status !== 200 || typeof transaction !== 'string') return failed(built.status);
      const wire = await signed([transaction]);
      if (typeof wire === 'string') return wire;
      const sent = await post(`${AUTOPAY_ENDPOINT}/stop`, { id, transaction: wire[0] });
      void read();
      return sent.status === 200 ? 'done' : failed(sent.status);
    },
    [connection, owner, signed, read],
  );

  return { list, read, unlock, start, stop };
}
