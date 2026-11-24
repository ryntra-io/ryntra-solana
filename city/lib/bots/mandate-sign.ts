import { citySigner } from '../app-bridge/route.ts';
import { agentNetworkOf, budgetFund, type AgentBudget } from '../../../lib/mandate/budget.ts';
import { exitText } from '../../../lib/mandate/exit.ts';
import { exitRulesOf } from '../../../lib/bots/money/gates.ts';
import { planFrom } from '../../../lib/mandate/plans.ts';
import type { StrategyId } from '../../../lib/mandate/strategy.ts';
import { forgetAgents } from './agents.ts';
import { checkUnsigned, sameMessage } from './mandate-check.ts';
import { MANDATE_CHAIN, MANDATE_EXIT, MANDATE_NET, useMandate, type MandateRecord, type MandateStatus } from './mandate.ts';

/**
 * Turning the agent on and stopping it from the browser — loaded on the tap, never in the city's first frame.
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

/** The wallet proven to Ryntra (one signed message, no transaction) — `../trade/proof.ts` `proveWallet`'s answer. */
export type ProveWho = (who: Who) => Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; state: 'declined' | 'failed'; message: string }>>;
const proveWho: ProveWho = async (who) => (await import('../trade/proof.ts')).proveWallet({ wallet: who.wallet, address: who.owner });

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

/** The budget as the review route takes it: lamports as text, the term in days. */
export const budgetBody = (budget: AgentBudget) => ({ perDay: budget.perDay.toString(), perTrade: budget.perTrade.toString(), days: budget.days });

/** «Sign»: the agent on, with the person's own budget — one wallet prompt. */
export async function enableAgent(
  who: Who,
  budget: AgentBudget,
  smartAccount: string | null,
  deps: Readonly<{ fetch?: Fetcher; sign?: SignMany; coin?: string | null; exit?: boolean; exitOpen?: boolean; plan?: string | null; prove?: ProveWho }> = {},
): Promise<Readonly<{ result: MandateResult; record: MandateRecord | null }>> {
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  // The agent sells on its own only when the ticket showed its rules and she signs that ticket — never by default.
  // `exitOpen` — the deployment's switch (`MANDATE_EXIT`), handed in only by the tests.
  const exit = deps.exit === true && (deps.exitOpen ?? MANDATE_EXIT);
  // A budget with the agent's own sale joins the agent's book only from her proven wallet — proven before her
  // signature (no prompt when it already is), so a budget she signs never waits outside the book for a proof.
  if (exit) {
    const proven = await (deps.prove ?? proveWho)(who).catch(() => ({ ok: false as const, state: 'failed' as const, message: 'Unreachable.' }));
    if (!proven.ok) return { result: proven.state === 'declined' ? { kind: 'walletNo', reason: proven.message } : { kind: 'refused', reason: proven.message }, record: null };
  }
  // Mainnet: the coin the person named; devnet's agent buys its pool's coin and is sent none.
  // The plan travels to the review — a bot's budget is refused before her signature where its money is closed.
  const body = { owner: who.owner, ...budgetBody(budget), smartAccount, ...(deps.coin ? { coin: deps.coin } : {}), ...(exit ? { exit: true } : {}), ...(deps.plan ? { plan: deps.plan } : {}) };
  const built = await post<{ record: MandateRecord; transactions: string[]; fundLamports?: string; networkLamports?: string }>(fetcher, '/api/bots/mandate/review', body);
  if (!built.ok) return { result: built.status === 0 || built.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', reason: built.reason }, record: null };
  if (built.value.record.owner !== who.owner) return { result: { kind: 'refused', reason: 'Another wallet.' }, record: null };
  // The wallet is asked for exactly what the card said: the vault's part and the agent's fees, the card's own numbers.
  if (built.value.record.perDay !== budget.perDay.toString() || built.value.record.perTrade !== budget.perTrade.toString() || built.value.fundLamports !== budgetFund(budget).toString() || built.value.networkLamports !== agentNetworkOf(budget).toString()) {
    return { result: { kind: 'refused', reason: 'The budget is not the one shown.' }, record: null };
  }
  // A sale she was not shown is not signed; one she was shown sells the coin she named. The server's switch
  // off, the budget comes back without a sale — not the ticket she saw, so it is refused rather than signed as a budget
  // that only holds.
  const record = built.value.record;
  const selling = Boolean(record.salePolicy || record.held || record.heldDaily);
  if (exit !== selling || (exit && (!record.salePolicy || !record.held || !record.heldDaily)) || (selling && deps.coin && record.held !== deps.coin)) return { result: { kind: 'refused', reason: 'The budget is not the one shown.' }, record: null };
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
 * The signed mandate joins the agent's book: from then on the agent trades by itself, on the strategy the
 * person chose. The server checks the mandate on chain before it takes it; a miss here leaves the mandate standing and
 * the next open of the window asks again.
 */
export async function joinAgent(record: MandateRecord, ask: AgentAskOf & Readonly<{ coin?: string | null }>, fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<boolean> {
  /* The strategy's plan travels as its text; the steady one without numbers is sent as before. */
  const plan = ask.plan && ask.plan !== 'steady' ? { plan: ask.plan } : {};
  /* A budget signed with the sale's policy joins with the rules the ticket showed. */
  /* The rules her ticket showed — a grid's stop alone, or the Trader's. */
  const exit = record.salePolicy ? { exit: exitText(exitRulesOf(ask.plan ? planFrom(ask.plan) : null)) } : {};
  const joined = await post<{ status: string }>(fetcher, '/api/bots/mandate/agent', ask.coin ? { record, strategy: ask.strategy, said: ask.said, coin: ask.coin, ...plan, ...exit } : { record, strategy: ask.strategy, said: ask.said, ...plan, ...exit });
  return joined.ok;
}

/** The window's taps: busy while the wallet is out, one line after. `said` — the person's words, when asked in words. */
/**
 * The strategy the person chose: its id and its plan's text (`lib/mandate/plans.ts` `planText`).
 * `exit` — the ticket showed the agent's own exit and she signs it; absent — the agent buys and holds, as before.
 */
type AgentAskOf = Readonly<{ strategy: StrategyId; plan?: string; said: string | null; exit?: boolean }>;

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
    if (!st.budget) {
      st.say({ kind: 'refused', at: Date.now() });
      return null;
    }
    const { result, record } = await enableAgent(who, st.budget, previous?.settings ?? null, { coin, exit: ask.exit === true, plan: ask.plan ?? null });
    if (record) {
      await joinAgent(record, { ...ask, coin });
      forgetAgents(who.owner);
      useMandate.getState().keep(record);
      useMandate.getState().setStatus(record.policy, { active: true, budgetLamports: null });
      const status = await readStatus(record);
      if (status) useMandate.getState().setStatus(record.policy, status);
    }
    useMandate.getState().say({ kind: result.kind, at: Date.now(), ...(result.kind === 'refused' ? { reason: result.reason } : {}) });
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
