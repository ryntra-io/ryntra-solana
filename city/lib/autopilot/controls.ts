import { create } from 'zustand';
import { citySigner } from '../app-bridge/route.ts';
import { post, signAndRelay, type Fetcher, type SignMany, type Who } from '../bots/mandate-sign.ts';
import type { MandateRecord } from '../bots/mandate.ts';
import { proveWallet, type ProofOutcome } from '../trade/proof.ts';
import { readAgentView, useAutopilot, type AgentView } from './store.ts';

/**
 * CITY-70 — the agent's three controls, each one tap and each its own:
 * - **Freeze** — the agent starts nothing new, at once; no transaction: the wallet proves itself with one signed message
 *   (once per session), the engine keeps the switch. **Resume** — the same switch off.
 * - **Cancel orders** — a sale still waiting in her vault is called off: the coin home, the sale's mandate removed — one
 *   signature of hers (the sale's «take it back», `/api/bots/mandate/sell/back`).
 * - **Withdraw** — the agent's right removed and the budget back in her wallet — one signature (`../bots/mandate-sign.ts`
 *   `tapStop`).
 * Nothing here holds a key or builds a transaction: the engine builds, her wallet signs only what needs a signature.
 */

export type ControlNote = 'frozen' | 'resumed' | 'cancelled' | 'nothing' | 'walletNo' | 'refused' | 'unreachable';

type ControlsState = {
  busy: 'freeze' | 'cancel' | null;
  note: ControlNote | null;
  set: (patch: Partial<Pick<ControlsState, 'busy' | 'note'>>) => void;
};

export const useControls = create<ControlsState>((set) => ({ busy: null, note: null, set: (patch) => set(patch) }));

type Deps = Readonly<{ fetch?: Fetcher; sign?: SignMany; prove?: (who: Readonly<{ wallet: string; address: string }>) => Promise<ProofOutcome> }>;

const fetchOf = (deps: Deps): Fetcher => deps.fetch ?? ((url, init) => fetch(url, { ...init, credentials: 'same-origin' }));

/** The sale an order still waits on: signed and not sold, or not sold with the coin still in her vault. */
export function openOrderOf(view: Pick<AgentView, 'lastSale'> | null): string | null {
  const sale = view?.lastSale;
  return sale && (sale.status === 'signed' || sale.status === 'failed') ? sale.policy : null;
}

async function refresh(record: MandateRecord, fetcher: Fetcher): Promise<AgentView | null> {
  const view = await readAgentView(record, fetcher);
  if (view) useAutopilot.getState().setView(record.policy, view);
  return view;
}

/** «Freeze» or «Resume»: her switch over the agent's new actions. A missing proof is asked for once — a message, never a transaction. */
export async function tapFreeze(who: Who, record: MandateRecord, frozen: boolean, deps: Deps = {}): Promise<boolean> {
  const st = useControls.getState();
  if (st.busy) return false;
  st.set({ busy: 'freeze', note: null });
  const fetcher = fetchOf(deps);
  const body = { owner: who.owner, policy: record.policy, frozen };
  try {
    let turned = await post<{ frozen: boolean }>(fetcher, '/api/bots/mandate/freeze', body);
    if (!turned.ok && turned.status === 401) {
      const proof = await (deps.prove ?? proveWallet)({ wallet: who.wallet, address: who.owner });
      if (!proof.ok) {
        useControls.getState().set({ note: proof.state === 'declined' ? 'walletNo' : 'refused' });
        return false;
      }
      turned = await post<{ frozen: boolean }>(fetcher, '/api/bots/mandate/freeze', body);
    }
    if (!turned.ok) {
      useControls.getState().set({ note: turned.status === 0 || turned.status >= 500 ? 'unreachable' : 'refused' });
      return false;
    }
    /* The card says it at once; the engine's own view follows. */
    const view = useAutopilot.getState().views[record.policy];
    if (view) useAutopilot.getState().setView(record.policy, { ...view, frozen: turned.value.frozen });
    useControls.getState().set({ note: turned.value.frozen ? 'frozen' : 'resumed' });
    await refresh(record, fetcher);
    return true;
  } finally {
    useControls.getState().set({ busy: null });
  }
}

/** «Cancel orders»: the sale still waiting called off — the coin home, one signature. */
export async function tapCancelOrders(who: Who, record: MandateRecord, sale: string, deps: Deps = {}): Promise<boolean> {
  const st = useControls.getState();
  if (st.busy) return false;
  st.set({ busy: 'cancel', note: null });
  const fetcher = fetchOf(deps);
  try {
    const built = await post<{ transactions: string[] }>(fetcher, '/api/bots/mandate/sell/back', { owner: who.owner, policy: sale });
    if (!built.ok) {
      useControls.getState().set({ note: built.status === 422 && /nothing/iu.test(built.reason) ? 'nothing' : built.status === 0 || built.status >= 500 ? 'unreachable' : 'refused' });
      await refresh(record, fetcher);
      return false;
    }
    const failed = await signAndRelay(who, built.value.transactions, { fetch: fetcher, sign: deps.sign ?? citySigner.signTransactions });
    if (failed) {
      useControls.getState().set({ note: failed.kind === 'walletNo' ? 'walletNo' : failed.kind === 'refused' ? 'refused' : 'unreachable' });
      return false;
    }
    useControls.getState().set({ note: 'cancelled' });
    await refresh(record, fetcher);
    return true;
  } finally {
    useControls.getState().set({ busy: null });
  }
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __agentControls: useControls });
