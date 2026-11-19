'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { PAY_ENDPOINT, invoiceOf, listOf, type CreateBody, type Invoice, type ListRead } from './money-view';

/** The list as the screen holds it: not asked yet, being read, or the engine's answer. */
export type Links = Readonly<{ state: 'reading' }> | ListRead;

export type Created = Readonly<{ ok: true; link: Invoice }> | Readonly<{ ok: false; declined: boolean }>;

/** The wallet proves itself once, with one signed message — never a transaction; a proof already here asks nothing. */
async function proven(connection: Readonly<{ wallet: string; address: string }>): Promise<'ok' | 'declined' | 'failed'> {
  const proof = await proveWallet(connection);
  if (proof.ok) return 'ok';
  return proof.state === 'declined' ? 'declined' : 'failed';
}

/**
 * The person's payment links on the engine (`lib/pay/**` behind `/api/v1/pay/requests`): the list of this wallet's own,
 * read when the wallet comes — never asking the wallet by itself —, and a new link. A link always pays the proven
 * wallet, never another: before a link is made the wallet proves it is the one connected. Nothing here moves money.
 */
export function useInvoices(owner: string | null) {
  const connection = useWallet((st) => st.connection);
  const [links, setLinks] = useState<Links>({ state: 'reading' });
  const asked = useRef(0);

  const read = useCallback(async () => {
    if (!owner) return;
    const mine = (asked.current += 1);
    setLinks((was) => (was.state === 'ready' ? was : { state: 'reading' }));
    let next: ListRead;
    try {
      const answer = await fetch(PAY_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
      next = listOf(answer.status, await answer.json().catch(() => null), owner);
    } catch {
      next = { state: 'failed' };
    }
    if (mine === asked.current) setLinks(next);
  }, [owner]);

  useEffect(() => {
    asked.current += 1;
    setLinks({ state: 'reading' });
    void read();
  }, [read]);

  /** «Show my links»: the wallet's one signed message, then the list again. */
  const unlock = useCallback(async (): Promise<'ok' | 'declined' | 'failed'> => {
    if (!connection || connection.address !== owner) return 'failed';
    const outcome = await proven(connection);
    if (outcome === 'ok') await read();
    return outcome;
  }, [connection, owner, read]);

  const create = useCallback(
    async (body: CreateBody): Promise<Created> => {
      if (!connection || connection.address !== owner) return { ok: false, declined: false };
      const outcome = await proven(connection);
      if (outcome !== 'ok') return { ok: false, declined: outcome === 'declined' };
      try {
        const answer = await fetch(PAY_ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const made = answer.ok ? invoiceOf(((await answer.json().catch(() => null)) as { link?: unknown } | null)?.link) : null;
        if (!made) return { ok: false, declined: false };
        void read();
        return { ok: true, link: made };
      } catch {
        return { ok: false, declined: false };
      }
    },
    [connection, owner, read],
  );

  return { links, read, unlock, create };
}
