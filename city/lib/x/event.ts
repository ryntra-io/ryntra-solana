import type { District } from '../market/types.ts';
import type { Moment } from '../moments/moment.ts';
import { TEMPLATES, type BillboardRow, type Facts, type Template } from './facts.ts';
import { storyboard } from './timeline.ts';

/**
 * A studio post as the drafts queue takes it (`POST /api/moments/events`, `kind: 'studio'`): the template and its facts,
 * read field by field from an untrusted body, so the server writes the words itself (`./post.ts`) and nothing else —
 * no link, no handle, no word of the sender's — reaches a draft. The same facts are always one draft.
 */

export type StudioEvent = { kind: 'studio'; id: string; facts: Facts };
export type ReadStudio = { ok: true; event: StudioEvent } | { ok: false; error: string };

const DISTRICTS: readonly District[] = ['core', 'heights', 'strip', 'avenue', 'docks'];
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const ID = /^[A-Za-z0-9:._-]{1,120}$/;
/** A ticker as the studio says it: `$` and up to twelve letters or digits. */
const SYMBOL = /^\$[A-Z0-9]{1,12}$/;

const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const time = (v: unknown): string | null => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s).toISOString() : null;
};
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

type Fields = Record<string, unknown>;
type Read<T> = T | string;

function readFacts(t: Template, o: Fields): Read<Facts> {
  const readAt = time(o.readAt);
  const live = bool(o.live);
  if (t !== 'launch' && (!readAt || live === null)) return !readAt ? 'readAt' : 'live';
  switch (t) {
    case 'hour': {
      const mint = str(o.mint);
      const symbol = str(o.symbol);
      const district = str(o.district) as District | null;
      const change = num(o.change);
      const mcap = num(o.mcap);
      if (!mint || !MINT.test(mint)) return 'mint';
      if (!symbol || !SYMBOL.test(symbol)) return 'symbol';
      if (!district || !DISTRICTS.includes(district) || district === 'docks') return 'district';
      if (change === null || change <= 0 || change > 100_000) return 'change';
      if (mcap === null || mcap <= 0) return 'mcap';
      return { template: t, mint, symbol, district, change, mcap, readAt: readAt!, live: live! };
    }
    case 'justin': {
      if (o.metric === 'volume') {
        const value = num(o.value);
        const towers = num(o.towers);
        if (value === null || value <= 0) return 'value';
        if (towers === null || !Number.isInteger(towers) || towers < 1 || towers > 1000) return 'towers';
        return { template: t, metric: 'volume', value, towers, readAt: readAt!, live: live! };
      }
      if (o.metric === 'core') {
        const mint = str(o.mint);
        const symbol = str(o.symbol);
        const mcap = num(o.mcap);
        if (!mint || !MINT.test(mint)) return 'mint';
        if (!symbol || !SYMBOL.test(symbol)) return 'symbol';
        if (mcap === null || mcap <= 0) return 'mcap';
        return { template: t, metric: 'core', mint, symbol, mcap, readAt: readAt!, live: live! };
      }
      return 'metric';
    }
    case 'launch': {
      const mint = str(o.mint);
      const network = str(o.network);
      const launchedAt = time(o.launchedAt);
      const graduatedAt = time(o.graduatedAt);
      const launchTx = str(o.launchTx);
      const graduateTx = str(o.graduateTx);
      const at = time(o.readAt);
      if (!mint || !MINT.test(mint)) return 'mint';
      if (network !== 'solana:devnet' && network !== 'solana:mainnet') return 'network';
      if (!launchedAt || !graduatedAt || Date.parse(graduatedAt) < Date.parse(launchedAt)) return 'times';
      if (!launchTx || !SIGNATURE.test(launchTx) || !graduateTx || !SIGNATURE.test(graduateTx)) return 'tx';
      if (!at) return 'readAt';
      // The seconds are the two block times, never a number of the sender's.
      const seconds = Math.round((Date.parse(graduatedAt) - Date.parse(launchedAt)) / 1000);
      return { template: t, mint, network, launchedAt, launchTx, graduatedAt, graduateTx, seconds, readAt: at };
    }
    case 'billboard': {
      const ranking = o.ranking;
      const from = o.from === null ? null : time(o.from);
      if (ranking !== 'week' && ranking !== 'volume') return 'ranking';
      if (ranking === 'week' ? !from || Date.parse(from) >= Date.parse(readAt!) : o.from !== null) return 'from';
      if (!Array.isArray(o.rows) || o.rows.length !== 5) return 'rows';
      const rows: BillboardRow[] = [];
      for (const r of o.rows as Fields[]) {
        const mint = str(r?.mint);
        const symbol = str(r?.symbol);
        const value = num(r?.value);
        if (!mint || !MINT.test(mint) || !symbol || !SYMBOL.test(symbol) || value === null || (ranking === 'volume' && value <= 0)) return 'rows';
        rows.push({ mint, symbol, value });
      }
      return { template: t, ranking, from, readAt: readAt!, rows, live: live! };
    }
    case 'banner': {
      const towers = num(o.towers);
      if (towers === null || !Number.isInteger(towers) || towers < 1 || towers > 1000) return 'towers';
      return { template: t, towers, readAt: readAt!, live: live! };
    }
  }
}

/** A studio event from an untrusted body: `{ kind: 'studio', id, facts: { template, … } }`. */
export function readStudioEvent(raw: Fields): ReadStudio {
  const id = str(raw.id);
  if (!id || !ID.test(id)) return { ok: false, error: 'id' };
  const facts = raw.facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return { ok: false, error: 'facts' };
  const template = str((facts as Fields).template) as Template | null;
  if (!template || !TEMPLATES.includes(template)) return { ok: false, error: 'template' };
  const read = readFacts(template, facts as Fields);
  if (typeof read === 'string') return { ok: false, error: `facts.${read}` };
  return { ok: true, event: { kind: 'studio', id, facts: read } };
}

/** The draft's moment: the studio's hook as the desk shows it, and the facts themselves for the words. */
export function momentFromStudio(e: StudioEvent): Moment {
  const f = e.facts;
  const board = storyboard(f);
  const hook = board?.hook ?? { kicker: 'RYNTRA', title: 'THE LIVE SOLANA SKYLINE', figure: `${f.template === 'banner' ? f.towers : ''} TOWERS`.trim(), accent: 'amber' as const };
  const coin = f.template === 'hour' || (f.template === 'justin' && f.metric === 'core') ? f : null;
  return {
    id: `studio:${f.template}:${e.id}`,
    kind: 'studio',
    towerId: coin?.mint ?? (f.template === 'launch' ? f.mint : null),
    district: f.template === 'hour' ? f.district : null,
    symbol: coin?.symbol ?? null,
    kicker: hook.kicker,
    title: hook.title,
    figure: hook.figure,
    source: f.template === 'launch' ? 'Ryntra Launch' : 'Jupiter',
    sourceAt: f.template === 'launch' ? f.graduatedAt : f.readAt,
    fx: 'pump',
    accent: hook.accent,
    run: null,
    studio: f,
  };
}
