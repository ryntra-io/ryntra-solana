'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { changeText, type ChangeAction } from '@/lib/contacts/model';
import { bytesToBase64, signMessageWithWallet } from '@/lib/solana/wallet-signin.client';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { CONTACTS_ENDPOINT, changeOf, idFrom, listOf, nonceFrom, outcomeOf, type ChangeOutcome, type ContactsRead } from './contacts-view';

/**
 * The person's contacts on the engine (`lib/contacts/**` behind `/api/v1/contacts`): the wallet's own book, read when the
 * wallet comes — never asking the wallet by itself —, and one change at a time. A change is the wallet's own word: the
 * wallet proves itself to the route (once, a signed message), then signs the change's own text (`changeText`), and the
 * engine checks that signature before it writes. Nothing here moves money.
 */
export function useContacts(owner: string | null) {
  const connection = useWallet((st) => st.connection);
  const [book, setBook] = useState<ContactsRead>({ state: 'reading' });
  const asked = useRef(0);

  const read = useCallback(async () => {
    if (!owner) return;
    const mine = (asked.current += 1);
    setBook((was) => (was.state === 'ready' ? was : { state: 'reading' }));
    let next: ContactsRead;
    try {
      const answer = await fetch(CONTACTS_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
      next = listOf(answer.status, await answer.json().catch(() => null), owner);
    } catch {
      next = { state: 'failed' };
    }
    if (mine === asked.current) setBook(next);
  }, [owner]);

  useEffect(() => {
    asked.current += 1;
    setBook({ state: 'reading' });
    void read();
  }, [read]);

  /** «Show my contacts»: the wallet's one signed message, then the book again. */
  const unlock = useCallback(async (): Promise<'ok' | 'declined' | 'failed'> => {
    if (!connection || connection.address !== owner) return 'failed';
    const proof = await proveWallet(connection);
    if (proof.ok) await read();
    return proof.ok ? 'ok' : proof.state === 'declined' ? 'declined' : 'failed';
  }, [connection, owner, read]);

  /** One change: add, edit or remove — the wallet signs it, the engine writes it, the book is read again. */
  const change = useCallback(
    async (action: ChangeAction, fields: Readonly<{ name: string; to: string; note: string | null }> | null, id: string | null = null): Promise<ChangeOutcome> => {
      if (!connection || connection.address !== owner) return 'failed';
      const proof = await proveWallet(connection);
      if (!proof.ok) return proof.state === 'declined' ? 'declined' : 'failed';
      const contactId = id ?? idFrom(crypto.randomUUID());
      if (!contactId) return 'failed';
      const draft = changeOf({ action, wallet: connection.address, id: contactId, fields, nonce: nonceFrom(crypto.getRandomValues(new Uint8Array(24))), nowMs: Date.now() });
      const signed = await signMessageWithWallet(connection.wallet, connection.address, changeText(draft));
      if (!signed.ok) return signed.state === 'UNSUPPORTED' ? 'unsupported' : signed.state === 'REFUSED' || signed.state === 'CANCELLED' ? 'declined' : 'failed';
      try {
        const answer = await fetch(CONTACTS_ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ change: draft, signature: bytesToBase64(signed.signature) }),
        });
        const outcome = outcomeOf(answer.status, await answer.json().catch(() => null));
        if (outcome === 'done' || outcome === 'missing') void read();
        return outcome;
      } catch {
        return 'failed';
      }
    },
    [connection, owner, read],
  );

  return { book, read, unlock, change };
}
