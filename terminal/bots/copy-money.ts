import { checkUnsigned, sameMessage } from '../../city/lib/bots/mandate-check.ts';
import { budgetFund } from '../../lib/mandate/budget.ts';
import { COPY_WORST_DAYS, copyBudgetOf } from '../../lib/wallet-watch/copy-agent.ts';
import { typedSol, type CopyForm } from './copy-view.ts';

/**
 * «Copy a wallet» with money — her start, her stop and her freeze from the screen, loaded on the tap. The server
 * builds and relays (`/api/wallet-watch/copy/money/**`) and holds no key of hers; her wallet signs every transaction in one
 * prompt, on mainnet, through the city's one door to a signature. Before the wallet sees anything the transactions are read
 * from their own bytes — hers alone, nothing but her smart account, the token and system programs (`checkUnsigned`) — and
 * the numbers held against the card: her day, her trade, what moves into her vault, her worst day. What the wallet hands back
 * must be the same messages.
 *
 * A start that landed only in part comes back `partial` — «My bots» lists it as unfinished, to finish (one more
 * signature for what is missing, `finishWithMoney`) or to take home (`stopWithMoney` with its review). Her stop answers
 * `rest` while anything of hers still stands in her vault: «Take the rest».
 */

export const COPY_MONEY_PATH = '/api/wallet-watch/copy/money';
export const COPY_MONEY_CHAIN = 'solana:mainnet';
/** Her start: her account and budget, the buy's policy, a sale's policy for each group of five coins. */
export const MONEY_START_MAX = 4;
/** Her stop: the stop itself, up to ten of coins, up to ten of emptied accounts. */
export const MONEY_STOP_MAX = 21;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type MoneyFetch = (url: string, init?: RequestInit) => Promise<Answer>;
export type MoneySign = (args: Readonly<{ wallet: string; address: string; unsignedWireBase64: readonly string[]; chain?: string }>) => Promise<Readonly<{ ok: true; signedWireBase64: readonly string[] }> | Readonly<{ ok: false; reason: string }>>;
export type MoneyDeps = Readonly<{ fetch: MoneyFetch; sign: MoneySign }>;
export type Who = Readonly<{ wallet: string; address: string }>;

/** A coin her stop leaves in her vault, and the engine's reason. */
export type Stuck = Readonly<{ mint: string; reason: string }>;

export type MoneyFailure = Readonly<{ kind: 'proof' }> | Readonly<{ kind: 'declined' }> | Readonly<{ kind: 'refused'; code: string }> | Readonly<{ kind: 'unreachable' }>;
export type MoneyStart = Readonly<{ kind: 'started'; coins: number; skipped: number }> | Readonly<{ kind: 'partial' }> | MoneyFailure;
export type MoneyStop = Readonly<{ kind: 'stopped'; stuck: readonly Stuck[]; left: number; failed: number; rest: boolean }> | Readonly<{ kind: 'nothing'; stuck: readonly Stuck[] }> | MoneyFailure;

type Called = Readonly<{ ok: true; value: Record<string, unknown> }> | Readonly<{ ok: false; status: number; code: string; value: Record<string, unknown> | null }>;

const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

async function call(fetcher: MoneyFetch, verb: string, body: unknown): Promise<Called> {
  try {
    const answer = await fetcher(`${COPY_MONEY_PATH}/${verb}`, { method: 'POST', body: JSON.stringify(body) });
    const value = obj(await answer.json().catch(() => null));
    if (answer.ok && value) return { ok: true, value };
    const code = obj(value?.error)?.code;
    return { ok: false, status: answer.status, code: typeof code === 'string' ? code : 'REFUSED', value };
  } catch {
    return { ok: false, status: 0, code: 'UNREACHABLE', value: null };
  }
}

const failureOf = (called: Extract<Called, { ok: false }>): MoneyFailure =>
  called.status === 401 ? { kind: 'proof' } : called.status === 0 || called.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', code: called.code };

const strings = (value: unknown): string[] | null => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null);

export function stuckOf(value: unknown): Stuck[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const row = obj(item);
        return row && typeof row.mint === 'string' && typeof row.reason === 'string' ? [{ mint: row.mint, reason: row.reason.slice(0, 160) }] : [];
      })
    : [];
}

/** Her transactions read, signed in one prompt, and handed back the same. */
async function signChecked(who: Who, wires: readonly string[], max: number, sign: MoneySign): Promise<Readonly<{ kind: 'ok'; items: readonly string[] }> | MoneyFailure> {
  const checked = checkUnsigned(wires, who.address, max);
  if (!checked.ok) return { kind: 'refused', code: 'CHECK' };
  const signed = await sign({ wallet: who.wallet, address: who.address, unsignedWireBase64: wires, chain: COPY_MONEY_CHAIN }).catch(() => ({ ok: false as const, reason: 'failed' }));
  if (!signed.ok) return { kind: 'declined' };
  if (signed.signedWireBase64.length !== wires.length || wires.some((wire, index) => !sameMessage(wire, signed.signedWireBase64[index]!))) return { kind: 'refused', code: 'CHANGED' };
  return { kind: 'ok', items: signed.signedWireBase64 };
}

/**
 * «Start with money»: her review, the numbers held against the card, one signature, then her copy into the book — only the
 * record the server kept for the review. A start whose answer was lost is asked once more without her transactions: they
 * are never signed twice.
 */
export async function startWithMoney(who: Who, leader: string, form: CopyForm, deps: MoneyDeps): Promise<MoneyStart> {
  const perDaySol = typedSol(form.day);
  if (perDaySol === null) return { kind: 'refused', code: 'BUDGET' };
  const budget = copyBudgetOf({ perDaySol, sharePct: form.share, days: form.days });
  const built = await call(deps.fetch, 'review', { owner: who.address, leader, perDaySol, sharePct: form.share, days: form.days, boundPct: form.bound });
  /* The review refuses the copy whole only when none of the wallet's coins is one the agent trades. */
  if (!built.ok) return built.status === 422 && built.code === 'REFUSED' ? { kind: 'refused', code: 'NO_COINS' } : failureOf(built);
  const v = built.value;
  const transactions = strings(v.transactions);
  const coins = strings(v.coins);
  if (!transactions || !coins || typeof v.policy !== 'string' || typeof v.review !== 'string') return { kind: 'refused', code: 'SHAPE' };
  /* The wallet is asked for exactly what the card says: her day, her trade, what moves into her vault, her worst day. */
  if (v.perDay !== budget.perDay.toString() || v.perTrade !== budget.perTrade.toString() || v.fundLamports !== budgetFund(budget).toString() || v.worstLamports !== (BigInt(COPY_WORST_DAYS) * budget.perDay).toString()) {
    return { kind: 'refused', code: 'SHOWN' };
  }
  const signed = await signChecked(who, transactions, MONEY_START_MAX, deps.sign);
  if (signed.kind !== 'ok') return signed;
  const started = await relayStart(deps.fetch, { owner: who.address, policy: v.policy, review: v.review }, signed.items);
  if (started.kind !== 'started') return started;
  return { kind: 'started', coins: coins.length, skipped: stuckOf(v.skipped).length };
}

/**
 * Her signed start relayed, then the book; an answer lost is asked once more without her transactions — never signed twice.
 * A start the server says landed in part (`partial`) is listed as unfinished: said so, not as a failure.
 */
async function relayStart(fetcher: MoneyFetch, ask: Readonly<{ owner: string; policy: string; review: string }>, items: readonly string[] | null): Promise<Readonly<{ kind: 'started' }> | Readonly<{ kind: 'partial' }> | MoneyFailure> {
  let started = await call(fetcher, 'start', items ? { ...ask, items } : ask);
  if (!started.ok && (started.status === 0 || started.status >= 500)) started = await call(fetcher, 'start', ask);
  if (started.ok) return { kind: 'started' };
  /* Her bounds said as they are (one copy of a wallet, five at most) — her unfinished start is listed to take home. */
  if (started.value?.partial === true && started.status !== 401 && started.code !== 'ALREADY' && started.code !== 'LIMIT') return { kind: 'partial' };
  return failureOf(started);
}

/**
 * «Finish»: her unfinished start's missing transactions, built from the server's record of her review — read
 * from their own bytes as every start's, one signature — then her start writes the book. Nothing missing: only the book.
 */
export async function finishWithMoney(who: Who, policy: string, review: string, deps: MoneyDeps): Promise<MoneyStart> {
  const built = await call(deps.fetch, 'finish', { owner: who.address, policy, review });
  if (!built.ok) return failureOf(built);
  const transactions = strings(built.value.transactions);
  if (!transactions) return { kind: 'refused', code: 'SHAPE' };
  let items: readonly string[] | null = null;
  if (transactions.length) {
    const signed = await signChecked(who, transactions, MONEY_START_MAX, deps.sign);
    if (signed.kind !== 'ok') return signed;
    items = signed.items;
  }
  const started = await relayStart(deps.fetch, { owner: who.address, policy, review }, items);
  return started.kind === 'started' ? { kind: 'started', coins: 0, skipped: 0 } : started;
}

/**
 * «Stop»: her copy frozen and her stop built — the first transaction takes every policy off and the budget home, the rest
 * take the coins home and close what they emptied — one signature, then relayed. A coin that cannot move stays in her vault
 * and comes back named with its reason; she declines — the copy stays frozen until she turns it back on.
 * `review` — her unfinished start, stopped from the server's record of it; `rest` — something still stands in her vault.
 */
export async function stopWithMoney(who: Who, policy: string, deps: MoneyDeps, review: string | null = null): Promise<MoneyStop> {
  const named = { owner: who.address, policy, ...(review ? { review } : {}) };
  const built = await call(deps.fetch, 'stop', named);
  if (!built.ok) return built.code === 'NOTHING' ? { kind: 'nothing', stuck: stuckOf(built.value?.skipped) } : failureOf(built);
  const transactions = strings(built.value.transactions);
  if (!transactions) return { kind: 'refused', code: 'SHAPE' };
  const stuck = stuckOf(built.value.skipped);
  const left = typeof built.value.left === 'number' ? built.value.left : 0;
  const signed = await signChecked(who, transactions, MONEY_STOP_MAX, deps.sign);
  if (signed.kind !== 'ok') return signed;
  const sent = await call(deps.fetch, 'stop/send', { ...named, items: signed.items });
  if (!sent.ok) return failureOf(sent);
  const failed = typeof sent.value.failed === 'number' ? sent.value.failed : 0;
  /* Not said — taken as something left: «Take the rest» rather than a vault said empty that is not. */
  const rest = sent.value.rest !== false || stuck.length > 0 || left > 0 || failed > 0;
  return { kind: 'stopped', stuck, left, failed, rest };
}

/** «Freeze» / «Resume»: her switch over the copy's new orders. */
export async function freezeWithMoney(who: Who, policy: string, frozen: boolean, deps: Pick<MoneyDeps, 'fetch'>): Promise<Readonly<{ kind: 'done' }> | MoneyFailure> {
  const turned = await call(deps.fetch, 'freeze', { owner: who.address, policy, frozen });
  return turned.ok ? { kind: 'done' } : failureOf(turned);
}
