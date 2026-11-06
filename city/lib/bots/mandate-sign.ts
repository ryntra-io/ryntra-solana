import { citySigner } from '../app-bridge/route.ts';
import type { BudgetPresetId } from '../../../lib/mandate/presets.ts';
import type { StrategyId } from '../../../lib/mandate/strategy.ts';
import { forgetAgents } from './agents.ts';
import { checkUnsigned, sameMessage } from './mandate-check.ts';
import { MANDATE_CHAIN, MANDATE_NET, useMandate, type MandateRecord, type MandateStatus } from './mandate.ts';

/**
 * Turning the agent on and stopping it from the browser (CITY-174) — loaded on the tap, never in the city's first frame.
 *
 * The person's wallet signs every transaction, in one prompt, on the deployment's network, through the city's one door
 * to a signature (`app-bridge/route.ts`; the Ryntra app's wallet signs on mainnet only, so on devnet it refuses). The server builds and relays;
 * it holds no key. Before the wallet sees anything, the transactions are read here from their own bytes
 * (`checkUnsigned`); what the wallet hands back must be the same messages.
 */

export type SignMany = typeof citySigner.signTransactions;
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type Who = Readonly<{ wallet: string; owner: string }>;
export type MandateResult = Readonly<{ kind: 'on' | 'stopped' }> | Readonly<{ kind: 'walletNo' | 'refused'; reason: string }> | Readonly<{ kind: 'unreachable' }>;

const HEADERS = { 'Content-Type': 'application/json' };

export async function post<T>(fetcher: Fetcher, url: string, body: unknown): Promise<Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; status: number; reason: string }>> {
  try {
    const response = await fetcher(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body), cache: 'no-store' });
    const value = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!response.ok || !value) return { ok: false, status: response.status, reason: value?.error?.message ?? 'Refused.' };
    return { ok: true, value };
  } catch {
    return { ok: false, status: 0, reason: 'Unreachable.' };
  }
}

/** The server's transactions → the check → the wallet's one prompt → the same messages back → the relay. */
export async function signAndRelay(who: Who, transactions: readonly string[], deps: Readonly<{ fetch: Fetcher; sign: SignMany }>): Promise<MandateResult | null> {
  const checked = checkUnsigned(transactions, who.owner);
  if (!checked.ok) return { kind: 'refused', reason: checked.reason };
  const signed = await deps.sign({ wallet: who.wallet, address: who.owner, unsignedWireBase64: [...transactions], chain: MANDATE_CHAIN });
  if (!signed.ok) return { kind: 'walletNo', reason: signed.reason };
  if (signed.signedWireBase64.length !== transactions.length || transactions.some((wire, index) => !sameMessage(wire, signed.signedWireBase64[index]!))) return { kind: 'refused', reason: 'The wallet changed the transaction.' };
  const sent = await post<{ signatures: string[] }>(deps.fetch, '/api/bots/mandate/submit', { owner: who.owner, items: signed.signedWireBase64 });
  if (!sent.ok) return sent.status === 0 || sent.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', reason: sent.reason };
  return null;
}

/** «Sign»: the agent on, with the picked budget — one wallet prompt. */
export async function enableAgent(who: Who, preset: BudgetPresetId, smartAccount: string | null, deps: Readonly<{ fetch?: Fetcher; sign?: SignMany; coin?: string | null }> = {}): Promise<Readonly<{ result: MandateResult; record: MandateRecord | null }>> {
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  // Mainnet: the coin the person named; devnet's agent buys its pool's coin and is sent none.
  const built = await post<{ record: MandateRecord; transactions: string[] }>(fetcher, '/api/bots/mandate/review', deps.coin ? { owner: who.owner, preset, smartAccount, coin: deps.coin } : { owner: who.owner, preset, smartAccount });
  if (!built.ok) return { result: built.status === 0 || built.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', reason: built.reason }, record: null };
  if (built.value.record.owner !== who.owner) return { result: { kind: 'refused', reason: 'Another wallet.' }, record: null };
  const failed = await signAndRelay(who, built.value.transactions, { fetch: fetcher, sign });
  return failed ? { result: failed, record: null } : { result: { kind: 'on' }, record: built.value.record };
}

/** «Stop»: the policy removed and the rest back to her wallet — one wallet prompt. */
export async function stopAgent(who: Who, record: MandateRecord, deps: Readonly<{ fetch?: Fetcher; sign?: SignMany }> = {}): Promise<MandateResult> {
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  const built = await post<{ transactions: string[] }>(fetcher, '/api/bots/mandate/stop', { owner: who.owner, settings: record.settings, policy: record.policy });
  if (!built.ok) return built.status === 0 || built.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', reason: built.reason };
  return (await signAndRelay(who, built.value.transactions, { fetch: fetcher, sign })) ?? { kind: 'stopped' };
}

/** What stands on chain now; null — not read this time. */
export async function readStatus(record: MandateRecord, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<MandateStatus | null> {
  try {
    const response = await fetcher(`/api/bots/mandate/status?policy=${record.policy}&vault=${record.vault}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const value = (await response.json()) as Partial<MandateStatus>;
    return typeof value.active === 'boolean' ? { active: value.active, budgetLamports: typeof value.budgetLamports === 'string' ? value.budgetLamports : null } : null;
  } catch {
    return null;
  }
}

/**
 * The signed mandate joins the agent's book (CITY-175): from then on the agent trades by itself, on the strategy the
 * person chose. The server checks the mandate on chain before it takes it; a miss here leaves the mandate standing and
 * the next open of the window asks again.
 */
export async function joinAgent(record: MandateRecord, ask: AgentAskOf & Readonly<{ coin?: string | null }>, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<boolean> {
  /* CITY-193: the strategy's plan travels as its text; the steady one without numbers is sent as before. */
  const plan = ask.plan && ask.plan !== 'steady' ? { plan: ask.plan } : {};
  const joined = await post<{ status: string }>(fetcher, '/api/bots/mandate/agent', ask.coin ? { record, strategy: ask.strategy, said: ask.said, coin: ask.coin, ...plan } : { record, strategy: ask.strategy, said: ask.said, ...plan });
  return joined.ok;
}

/** The window's taps: busy while the wallet is out, one line after. `said` — the person's words, when asked in words. */
/** The strategy the person chose (CITY-193): its id and its plan's text (`lib/mandate/plans.ts` `planText`). */
type AgentAskOf = Readonly<{ strategy: StrategyId; plan?: string; said: string | null }>;

export async function tapEnable(who: Who, ask: AgentAskOf = { strategy: 'steady', said: null }): Promise<MandateRecord | null> {
  const st = useMandate.getState();
  if (st.busy) return null;
  st.setBusy('enable');
  st.say(null);
  try {
    const previous = st.records[who.owner];
    const coin = MANDATE_NET === 'mainnet' ? (st.coin?.mint ?? null) : null;
    if (MANDATE_NET === 'mainnet' && !coin) {
      st.say({ kind: 'refused', at: Date.now() });
      return null;
    }
    const { result, record } = await enableAgent(who, st.preset, previous?.settings ?? null, { coin });
    if (record) {
      await joinAgent(record, { ...ask, coin });
      forgetAgents(who.owner);
      useMandate.getState().keep(record);
      useMandate.getState().setStatus(record.policy, { active: true, budgetLamports: null });
      const status = await readStatus(record);
      if (status) useMandate.getState().setStatus(record.policy, status);
    }
    useMandate.getState().say({ kind: result.kind, at: Date.now() });
    return record;
  } finally {
    useMandate.getState().setBusy(null);
  }
}

export async function tapStop(who: Who, record: MandateRecord): Promise<void> {
  const st = useMandate.getState();
  if (st.busy) return;
  st.setBusy('stop');
  st.say(null);
  try {
    const result = await stopAgent(who, record);
    forgetAgents(who.owner);
    if (result.kind === 'stopped') useMandate.getState().setStatus(record.policy, { active: false, budgetLamports: null });
    useMandate.getState().say({ kind: result.kind, at: Date.now() });
  } finally {
    useMandate.getState().setBusy(null);
  }
}
