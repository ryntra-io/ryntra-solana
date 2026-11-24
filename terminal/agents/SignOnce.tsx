'use client';

import { useCallback, useState } from 'react';
import { forgetAgents, syncAgents, useAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET } from '@/city/lib/bots/mandate';
import { CARE_MODE, useCare } from '@/city/lib/earn/care';
import { useWords } from '@/city/lib/i18n/dict';
import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';
import { revalidateWalletFact } from '@/lib/account/wallet-proof-store.client';
import { Info, Panel, Quiet } from '@/terminal/ui';
import { RoleBadge } from './glyphs';
import { signOnce, signOnceShown, type SignSaid } from './sign-once';
import { AGENTS } from './words';
import a from './agents.module.css';

/** Agents are served on this deployment: a mandate network, or the keeper. */
const SERVED = Boolean(MANDATE_NET) || CARE_MODE !== 'closed';

/**
 * The wallet's one signed message and the read it opens (`./sign-once.ts`): the proof read afresh, the message signed
 * (no transaction), the wallet's agents and its pools read again. Nothing asks the wallet by itself — only the tap.
 */
export function signAndRead(owner: string): Promise<Exclude<SignSaid, 'asking'>> {
  const connection = useWallet.getState().connection;
  if (!connection || connection.address !== owner) return Promise.resolve('failed');
  return signOnce({
    refresh: () => revalidateWalletFact({ fresh: true }),
    prove: () => proveWallet(connection),
    forget: () => forgetAgents(owner),
    read: async () => {
      const agents = await syncAgents(owner);
      if (CARE_MODE !== 'closed') void useCare.getState().load(owner);
      return agents;
    },
  });
}

/** Whether «Sign once to see your agents» stands for the connected wallet, what its tap answered, and the tap. */
export function useSignOnce(owner: string | null): Readonly<{ shown: boolean; said: SignSaid; sign: () => void }> {
  const locked = useAgents((st) => (owner ? Boolean(st.locked[owner]) : false));
  const answered = useAgents((st) => (owner ? Boolean(st.byOwner[owner]) : false));
  const [said, setSaid] = useState<Readonly<{ owner: string; said: SignSaid }> | null>(null);
  const sign = useCallback(() => {
    if (!owner) return;
    setSaid({ owner, said: 'asking' });
    void signAndRead(owner).then((result) => setSaid({ owner, said: result }));
  }, [owner]);
  const now = said && said.owner === owner ? said.said : 'idle';
  // While the wallet signs, the card stays where it is, whatever the store says in between.
  return { shown: signOnceShown({ owner, served: SERVED, locked, answered }) || now === 'asking', said: now, sign };
}

/**
 * «Sign once to see your agents» — where the wallet's agents would stand on a device that has not proven it: one quiet
 * line, «i» with how, and «Show my agents». `row` — inside a panel that already stands (a desk's table); `card` — a
 * card of its own (a phone). Never amber, never asked at a visit.
 */
export function SignOnce({ owner, variant }: { owner: string | null; variant: 'row' | 'card' }) {
  const w = useWords(AGENTS);
  const { shown, said, sign } = useSignOnce(owner);
  if (!shown) return null;
  const asking = said === 'asking';
  const line = (
    <div className={a.sign} data-agents-sign="">
      <RoleBadge role="trader" />
      <span className={a.signLine}>{w.signOnce}</span>
      <Info label={w.signOnceHow}>{w.signOnceText}</Info>
      {variant === 'row' ? (
        <Quiet size="s" disabled={asking} aria-busy={asking || undefined} onClick={sign} data-agents-sign-go="">
          {w.signOnceAction}
        </Quiet>
      ) : null}
    </div>
  );
  const answer = said === 'declined' || said === 'failed' ? <p className={a.signSaid}>{said === 'declined' ? w.signOnceNo : w.signOnceFailed}</p> : null;
  if (variant === 'row') {
    return (
      <div className={a.signPad} role="group" aria-label={w.signOnce}>
        {line}
        {answer}
      </div>
    );
  }
  return (
    <Panel gap={12} label={w.signOnce}>
      {line}
      <Quiet full disabled={asking} aria-busy={asking || undefined} onClick={sign} data-agents-sign-go="">
        {w.signOnceAction}
      </Quiet>
      {answer}
    </Panel>
  );
}
