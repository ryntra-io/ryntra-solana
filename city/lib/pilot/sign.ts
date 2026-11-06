import { citySigner } from '../app-bridge/route.ts';
import { checkUnsigned, sameMessage } from '../bots/mandate-check.ts';
import { joinAgent, post, type Fetcher, type SignMany, type Who } from '../bots/mandate-sign.ts';
import { MANDATE_CHAIN, useMandate, type MandateCoin, type MandateRecord } from '../bots/mandate.ts';
import { signatureOfWire } from '../districts/harbor/flow.ts';
import { pierOf, pierZapBody, type Pier } from '../earn/pier.ts';
import type { HarborPool } from '../districts/harbor/pools.ts';
import { planText, type StrategyPlan } from '../../../lib/mandate/plans.ts';
import type { PilotPlanData, PilotSplit } from '../../../lib/pilot/plan.ts';

/**
 * «Go live · sign once» (CITY-204) — loaded on the tap, never in the city's first frame. Every part the network moves money
 * into is built by its own engine and door, as when the person does it by hand:
 * - the trade — the mandate of CITY-174/186 (`/api/bots/mandate/review`), read here from its own bytes (`checkUnsigned`);
 * - the savings — Jupiter Lend through SOL-3 (`/api/solana/earn/review`), sealed;
 * - the pool — a SOL pier's Zap of CITY-198 (`/api/city/earn/piers/zap`), behind the Harbor's door, sealed.
 * Then one wallet prompt signs them all; each part goes to its own relay, the trade's mandate joins the agent's book with
 * her plan, and the plan joins the autopilot's book (`/api/bots/pilot`) with the signatures that landed. A part whose build
 * or relay did not go is left out — its money stays in her wallet — and the card says so in one line.
 */

export type GoResult =
  | Readonly<{ kind: 'on'; record: MandateRecord | null; partial: boolean }>
  | Readonly<{ kind: 'walletNo' | 'refused'; reason: string }>
  | Readonly<{ kind: 'unreachable' }>;

export type GoInput = Readonly<{
  split: PilotSplit;
  plan: PilotPlanData;
  coin: MandateCoin | null;
  tradePlan: StrategyPlan;
  said: string;
  network: 'devnet' | 'mainnet';
}>;

/** `check` — the mandate's own reading of its bytes (`../bots/mandate-check.ts`); the tests hand in a stand-in. */
type Check = Readonly<{ unsigned: typeof checkUnsigned; same: typeof sameMessage }>;
type Deps = Readonly<{ fetch?: Fetcher; sign?: SignMany; sleep?: (ms: number) => Promise<void>; check?: Check }>;

const CHECK: Check = { unsigned: checkUnsigned, same: sameMessage };

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

type Built = Readonly<{ part: 'trade' | 'saveUsdc' | 'saveSol' | 'pool'; wires: readonly string[]; ticket?: string; record?: MandateRecord; position?: string; pool?: string }>;

const get = async <T>(fetcher: Fetcher, url: string): Promise<T | null> => {
  try {
    const response = await fetcher(url, { cache: 'no-store', headers: { accept: 'application/json' } });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
};

/** The deepest SOL–USDC pier the Harbor lists: the autopilot's pool part goes there, wide and calm. */
export function pierFor(pools: readonly HarborPool[]): Pier | null {
  for (const pool of pools) {
    const pier = pierOf(pool);
    if (pier && pier.pair === 'usdc') return pier;
  }
  return null;
}

async function buildTrade(who: Who, input: GoInput, fetcher: Fetcher, check: Check): Promise<Built | 'refused' | 'unreachable'> {
  const preset = input.plan.preset;
  if (!preset) return 'refused';
  const previous = useMandate.getState().records[who.owner];
  const body = input.network === 'mainnet' ? { owner: who.owner, preset, smartAccount: previous?.settings ?? null, coin: input.coin?.mint } : { owner: who.owner, preset, smartAccount: previous?.settings ?? null };
  const built = await post<{ record: MandateRecord; transactions: string[] }>(fetcher, '/api/bots/mandate/review', body);
  if (!built.ok) return built.status === 0 || built.status >= 500 ? 'unreachable' : 'refused';
  if (built.value.record.owner !== who.owner) return 'refused';
  if (!check.unsigned(built.value.transactions, who.owner).ok) return 'refused';
  return { part: 'trade', wires: built.value.transactions, record: built.value.record };
}

async function buildSave(who: Who, part: 'saveUsdc' | 'saveSol', raw: bigint, fetcher: Fetcher): Promise<Built | null> {
  const built = await post<{ ticket?: unknown; transaction?: { wireBase64?: unknown } }>(fetcher, '/api/solana/earn/review', { provider: 'jupiter', action: 'deposit', owner: who.owner, market: part === 'saveUsdc' ? USDC_MINT : WSOL_MINT, amount: raw.toString() });
  if (!built.ok || typeof built.value.ticket !== 'string' || typeof built.value.transaction?.wireBase64 !== 'string') return null;
  return { part, wires: [built.value.transaction.wireBase64], ticket: built.value.ticket };
}

async function buildPool(who: Who, raw: bigint, fetcher: Fetcher): Promise<Built | null> {
  const listed = await get<{ pools?: HarborPool[] }>(fetcher, '/api/city/earn/piers');
  const pier = pierFor(listed?.pools ?? []);
  if (!pier) return null;
  const built = await post<{ ticket?: unknown; position?: unknown; transactions?: Array<{ wireBase64?: unknown }> }>(fetcher, '/api/city/earn/piers/zap', pierZapBody(pier, who.owner, raw, 'calm'));
  const txs = built.ok ? built.value.transactions : null;
  if (!built.ok || typeof built.value.ticket !== 'string' || typeof built.value.position !== 'string' || !Array.isArray(txs) || !txs.length || txs.some((tx) => typeof tx.wireBase64 !== 'string')) return null;
  return { part: 'pool', wires: txs.map((tx) => tx.wireBase64 as string), ticket: built.value.ticket, position: built.value.position, pool: pier.pool.address };
}

/** The plan's parts built, signed in one prompt, relayed each by its own door, and the plan joined. */
export async function goLive(who: Who, input: GoInput, deps: Deps = {}): Promise<GoResult> {
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const check = deps.check ?? CHECK;
  const legs = input.split.legs;
  const live = input.network === 'mainnet';

  /* 1. Every part built by its own engine at once; nothing is signed yet. */
  const [trade, saveUsdc, saveSol, pool] = await Promise.all([
    input.plan.preset ? buildTrade(who, input, fetcher, check) : Promise.resolve(null),
    live && legs.save.usdcRaw > 0n ? buildSave(who, 'saveUsdc', legs.save.usdcRaw, fetcher) : Promise.resolve(null),
    live && legs.save.solRaw > 0n ? buildSave(who, 'saveSol', legs.save.solRaw, fetcher) : Promise.resolve(null),
    live && legs.pool.solRaw > 0n ? buildPool(who, legs.pool.solRaw, fetcher) : Promise.resolve(null),
  ]);
  if (trade === 'unreachable') return { kind: 'unreachable' };
  if (trade === 'refused') return { kind: 'refused', reason: 'The trade could not be prepared.' };
  const parts = [trade, saveUsdc, saveSol, pool].filter((x): x is Built => x !== null);
  if (!parts.length) return { kind: 'refused', reason: 'Nothing to sign.' };
  const asked = Number(Boolean(input.plan.preset)) + Number(live && legs.save.usdcRaw > 0n) + Number(live && legs.save.solRaw > 0n) + Number(live && legs.pool.solRaw > 0n);
  let partial = parts.length < asked;

  /* 2. One wallet prompt for all of them. */
  const wires = parts.flatMap((part) => part.wires);
  const signed = await sign({ wallet: who.wallet, address: who.owner, unsignedWireBase64: wires, chain: MANDATE_CHAIN });
  if (!signed.ok) return { kind: 'walletNo', reason: signed.reason };
  if (signed.signedWireBase64.length !== wires.length || wires.some((wire, index) => !check.same(wire, signed.signedWireBase64[index]!))) return { kind: 'refused', reason: 'The wallet changed a transaction.' };
  let at = 0;
  const signedOf = new Map<Built, readonly string[]>();
  for (const part of parts) {
    signedOf.set(part, signed.signedWireBase64.slice(at, at + part.wires.length));
    at += part.wires.length;
  }

  /* 3. Each part to its own relay — the trade first: it is the agent's. */
  let record: MandateRecord | null = null;
  const joinLegs: Record<string, { signature: string; position?: string; pool?: string }> = {};
  if (trade) {
    const sent = await post<{ signatures: string[] }>(fetcher, '/api/bots/mandate/submit', { owner: who.owner, items: signedOf.get(trade) });
    if (!sent.ok) return sent.status === 0 || sent.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', reason: sent.reason };
    record = trade.record ?? null;
  }
  for (const part of [saveUsdc, saveSol]) {
    if (!part) continue;
    const sent = await post<{ signature?: unknown; state?: unknown }>(fetcher, '/api/solana/earn/submit', { ticket: part.ticket, signed: signedOf.get(part)![0] });
    if (sent.ok && typeof sent.value.signature === 'string' && sent.value.state !== 'FAILED') joinLegs[part.part] = { signature: sent.value.signature };
    else partial = true;
  }
  if (pool) {
    const sent = await post<{ results?: Array<{ signature?: unknown; state?: unknown }> }>(fetcher, '/api/liquidity/submit', { ticket: pool.ticket, signed: signedOf.get(pool) });
    const results = sent.ok && Array.isArray(sent.value.results) ? sent.value.results : null;
    const last = signedOf.get(pool)!.at(-1)!;
    if (results && results.every((r) => r.state !== 'FAILED')) joinLegs.pool = { signature: signatureOfWire(last), position: pool.position!, pool: pool.pool! };
    else partial = true;
  }

  /* 4. The agent's book takes the mandate with her plan; the autopilot's book takes the plan. */
  if (record) {
    await joinAgent(record, { strategy: input.tradePlan.id, plan: planText(input.tradePlan), said: input.said, coin: input.network === 'mainnet' ? (input.coin?.mint ?? null) : null }, fetcher);
    useMandate.getState().keep(record);
    useMandate.getState().setStatus(record.policy, { active: true, budgetLamports: null });
  }
  /* A leg just sent may still be on its way: the book checks the chain, so it is asked again a few times. */
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const joined = await post<{ status?: string }>(fetcher, '/api/bots/pilot', { owner: who.owner, said: input.said, plan: input.plan, policy: record?.policy ?? null, legs: joinLegs });
    if (joined.ok || (joined.status !== 422 && joined.status !== 503 && joined.status !== 0)) break;
    await sleep(5_000);
  }
  return { kind: 'on', record, partial };
}
