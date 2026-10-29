import type { District, Tower } from '../../market/types.ts';
import { momentFromStudio, readStudioEvent, type StudioEvent } from '../../x/event.ts';
import { momentFromAgentFind, momentFromBigX, momentFromWorldEvent, type Moment, type MoveWindow } from '../moment.ts';

/**
 * What may become a post on X: four happenings of the city, each sent by the part of Ryntra that saw it — the engine's
 * Launch (a launch, its move into the skyline at $75K), a trade read back from the chain (a big x), an agent of the
 * city (a find). The event carries everything its words need, so the server needs no market read to make the draft:
 * the coin, whether the city may name it, and the fact with its source time. A draft is never made from anything else.
 * A fifth kind, `studio`, is the studio's posts for X (CITY-38, `../../x/`): a template and its facts, filmed by the
 * studio's batch script, which also sends the clip.
 */

export type PostKind = 'launch' | 'graduate' | 'bigx' | 'agent' | 'studio';
export const POST_KINDS: readonly PostKind[] = ['launch', 'graduate', 'bigx', 'agent', 'studio'];

type Base = {
  /** The producer's own id for the happening; the same id is one draft, however often it is sent. */
  id: string;
  /** The coin's mint: the tower the clip flies to. */
  mint: string;
  /** The coin's ticker, shown only when `named` is true. */
  symbol: string;
  /** True when the city may name the coin: verified, or a Ryntra launch that passed its review. */
  named: boolean;
  district: District;
  /** When it happened at the source (ISO). */
  sourceAt: string;
};

export type PostEvent =
  | (Base & { kind: 'launch' })
  | (Base & { kind: 'graduate' })
  | (Base & { kind: 'bigx'; multiple: number; tx: string })
  | (Base & { kind: 'agent'; agent: string; rule: string; change: number; window: MoveWindow })
  | StudioEvent;

const DISTRICTS: readonly District[] = ['core', 'heights', 'strip', 'avenue', 'docks'];
const WINDOWS: readonly MoveWindow[] = ['5M', '1H', '24H', '7D'];
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const ID = /^[A-Za-z0-9:._-]{1,120}$/;
const SYMBOL = /^\$?[A-Za-z0-9]{1,12}$/;
/** An agent's name and rule are short plain words: no links, no handles, no tags. */
const WORDS = /^[A-Za-z0-9 %$+.,·/-]{1,40}$/;

export type ReadEvent = { ok: true; event: PostEvent } | { ok: false; error: string };

const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A post event from an untrusted body: every field checked, anything unknown refused. */
export function readPostEvent(raw: unknown): ReadEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not_an_object' };
  const o = raw as Record<string, unknown>;
  const kind = str(o.kind) as PostKind | null;
  if (!kind || !POST_KINDS.includes(kind)) return { ok: false, error: 'kind' };
  if (kind === 'studio') return readStudioEvent(o);
  const id = str(o.id);
  if (!id || !ID.test(id)) return { ok: false, error: 'id' };
  const mint = str(o.mint);
  if (!mint || !MINT.test(mint)) return { ok: false, error: 'mint' };
  const symbol = str(o.symbol) ?? '';
  if (symbol && !SYMBOL.test(symbol)) return { ok: false, error: 'symbol' };
  const named = o.named === true && !!symbol;
  const district = (str(o.district) ?? 'docks') as District;
  if (!DISTRICTS.includes(district)) return { ok: false, error: 'district' };
  const sourceAt = str(o.sourceAt);
  if (!sourceAt || Number.isNaN(Date.parse(sourceAt))) return { ok: false, error: 'sourceAt' };
  const base: Base = { id, mint, symbol, named, district, sourceAt: new Date(sourceAt).toISOString() };
  if (kind === 'launch' || kind === 'graduate') return { ok: true, event: { ...base, kind } };
  if (kind === 'bigx') {
    const multiple = num(o.multiple);
    const tx = str(o.tx);
    if (multiple === null || multiple <= 0) return { ok: false, error: 'multiple' };
    if (!tx || !SIGNATURE.test(tx)) return { ok: false, error: 'tx' };
    return { ok: true, event: { ...base, kind, multiple, tx } };
  }
  const agent = str(o.agent);
  const rule = str(o.rule);
  const change = num(o.change);
  const window = str(o.window) as MoveWindow | null;
  if (!agent || !WORDS.test(agent)) return { ok: false, error: 'agent' };
  if (!rule || !WORDS.test(rule)) return { ok: false, error: 'rule' };
  if (change === null) return { ok: false, error: 'change' };
  if (!window || !WINDOWS.includes(window)) return { ok: false, error: 'window' };
  return { ok: true, event: { ...base, kind, agent, rule, change, window } };
}

/** The tower as the event describes it: enough for a moment's words and for the clip to find it in the city. */
function towerOf(e: Exclude<PostEvent, StudioEvent>): Tower {
  return {
    id: e.mint,
    symbol: e.symbol.replace(/^\$/, ''),
    name: e.symbol,
    icon: null,
    district: e.district,
    price: 0,
    mcap: 0,
    liquidity: 0,
    holders: 0,
    change5m: 0,
    change1h: 0,
    change24h: 0,
    volume24h: 0,
    traders1h: 0,
    organic: 0,
    verified: e.named,
    launchedAt: null,
  };
}

/**
 * The moment of a post event: the clip's recipe (what the director stages) and the facts its words say. Null when it
 * is not a post — a big x below the line, an unverified coin's win or find.
 */
export function momentForPost(e: PostEvent): Moment | null {
  if (e.kind === 'studio') return momentFromStudio(e);
  const tower = towerOf(e);
  switch (e.kind) {
    case 'launch':
    case 'graduate':
      // Only Ryntra's own launches: a new pool somewhere on Solana is weather, not news for @Ryntra.
      return momentFromWorldEvent({ id: e.id, at: e.sourceAt, source: 'engine', kind: e.kind, subject: e.mint, sourceAt: e.sourceAt, payload: {} }, [tower]);
    case 'bigx':
      return momentFromBigX({ tower, multiple: e.multiple, sourceAt: e.sourceAt, tx: e.tx });
    case 'agent':
      return momentFromAgentFind({ tower, agent: e.agent, rule: e.rule, change: e.change, window: e.window, sourceAt: e.sourceAt });
  }
}
