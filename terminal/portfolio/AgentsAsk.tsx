'use client';

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useAgents } from '@/city/lib/bots/agents';
import { MANDATE_NET } from '@/city/lib/bots/mandate';
import { CARE_MODE } from '@/city/lib/earn/care';
import { useWords } from '@/city/lib/i18n/dict';
import { ensureWalletFact, proofStatusFor, subscribeWalletFact, unknownWalletFact, walletFact } from '@/lib/account/wallet-proof-store.client';
import { RoleBadge } from '@/terminal/agents/glyphs';
import { signAndRead } from '@/terminal/agents/SignOnce';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Icon, Panel, Quiet } from '@/terminal/ui';
import { agentsAsk } from './portfolio-view';
import { PORTFOLIO } from './words';
import a from './all.module.css';

/** Agents are served on this deployment: a mandate network, or the keeper. */
const SERVED = Boolean(MANDATE_NET) || CARE_MODE !== 'closed';
const HIDDEN_KEY = 'ryntra.portfolio.agentsAsk.hidden';

/** The wallets this browser put the action away for — a per-viewer convenience; storage may be absent or refuse. */
function hiddenFor(owner: string): boolean {
  try {
    return (window.localStorage.getItem(HIDDEN_KEY) ?? '').split(',').includes(owner);
  } catch {
    return false;
  }
}

function hide(owner: string): void {
  try {
    const kept = (window.localStorage.getItem(HIDDEN_KEY) ?? '').split(',').filter(Boolean);
    window.localStorage.setItem(HIDDEN_KEY, [...new Set([...kept, owner])].slice(-20).join(','));
  } catch {
    /* No storage: put away for this visit only. */
  }
}

type Said = 'idle' | 'asking' | 'declined' | 'failed';

/**
 * Whether «Show my agents» stands on the person's own wallet (`agentsAsk`, `./portfolio-view.ts`), and the tap behind
 * it: the wallet signs one message (`proveWallet`, no transaction), then the engine is asked again — the Agents' own
 * «Sign once» (`terminal/agents/SignOnce.tsx`). Nothing here asks the wallet by itself — never at a visit,
 * only on the tap.
 */
export function useAgentsAsk(owner: string | null, rows: number): Readonly<{ shown: boolean; said: Said; show: () => void; hide: () => void }> {
  const fact = useSyncExternalStore(subscribeWalletFact, walletFact, unknownWalletFact);
  const answered = useAgents((st) => (owner ? Boolean(st.byOwner[owner]) : false));
  const locked = useAgents((st) => (owner ? Boolean(st.locked[owner]) : false));
  const [hiddenNow, setHidden] = useState<string | null>(null);
  const [said, setSaid] = useState<Readonly<{ owner: string; said: Said }> | null>(null);
  useEffect(() => {
    if (owner) ensureWalletFact();
  }, [owner]);
  useEffect(() => {
    setHidden(owner && hiddenFor(owner) ? owner : null);
  }, [owner]);

  const show = useCallback(() => {
    if (!owner) return;
    setSaid({ owner, said: 'asking' });
    // Proven, the engine is asked again at once; the screen's own reads keep asking it after, as they always do.
    void signAndRead(owner).then((said) => setSaid({ owner, said }));
  }, [owner]);

  const now = said && said.owner === owner ? said.said : 'idle';
  const asked = owner !== null && agentsAsk({ own: true, served: SERVED, answered, proof: proofStatusFor(fact, owner), rows, hidden: hiddenNow === owner, locked });
  return {
    // While the wallet signs, the row stays where it is, whatever the store says in between.
    shown: asked || now === 'asking',
    said: now,
    show,
    hide: () => {
      if (!owner) return;
      hide(owner);
      setHidden(owner);
    },
  };
}

/**
 * Where the agents would stand, on a device that has not proven the wallet: one quiet row — the name, «Show my
 * agents», why behind «i», and a way to put it away for this wallet. Never amber, never a sheet that asks at a visit.
 */
export function AgentsAsk({ said, onShow, onHide }: { said: Said; onShow: () => void; onHide: () => void }) {
  const w = useWords(PORTFOLIO);
  const [how, setHow] = useState(false);
  const howId = useId();
  const asking = said === 'asking';
  return (
    <Panel pad="none" edge label={w.agentsAskTitle} className={a.group}>
      {/* The name and its «i» hold together and wrap as one; the actions keep the row's end — on a phone, the line under it. */}
      <div className={a.askRow}>
        <span className={a.askHead}>
          <RoleBadge role="trader" />
          <h2 className={`${a.groupName} ${a.askTitle}`}>{w.agentsAskTitle}</h2>
          <ExplainButton label={w.agentsAskInfo} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
        </span>
        <span className={a.askActs}>
          <Quiet size="s" disabled={asking} aria-busy={asking || undefined} onClick={onShow}>
            {w.agentsAsk}
          </Quiet>
          <Quiet size="s" disabled={asking} aria-label={w.agentsAskHide} onClick={onHide}>
            <Icon name="close" size="s" />
          </Quiet>
        </span>
      </div>
      {how ? (
        <div className={a.groupNote}>
          <ExplainBox id={howId}>{w.agentsAskText}</ExplainBox>
        </div>
      ) : null}
      {said === 'declined' || said === 'failed' ? (
        <p className={a.askLine} role="status">
          {said === 'declined' ? w.agentsAskNo : w.agentsAskFailed}
        </p>
      ) : null}
    </Panel>
  );
}
