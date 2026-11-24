import type { HolderLinksAnswer, LinkKind } from '../../../lib/spot/holder-links.ts';

/**
 * How the holders' links are read and laid out: the engine's answer checked for its shape, and the map's
 * layout — a bubble for each holder checked, its size its share, groups standing together around the wallet they share,
 * the holders not linked apart at the end. Pure and stable: the same answer is the same picture, nothing moves by itself.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const wallet = (value: unknown): value is string => typeof value === 'string' && BASE58.test(value);
const KINDS: readonly LinkKind[] = ['coin', 'sol', 'between'];
const kindsOf = (value: unknown): LinkKind[] => (Array.isArray(value) ? value.filter((kind): kind is LinkKind => KINDS.includes(kind as LinkKind)) : []);
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : []);

/** The engine's answer, or null when it is not the links' shape. */
export function linksOf(body: unknown): HolderLinksAnswer | null {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!row || !Array.isArray(row.nodes) || !Array.isArray(row.groups)) return null;
  return {
    nodes: rows(row.nodes)
      .filter((node) => wallet(node.owner))
      .map((node) => ({ owner: node.owner as string, sharePct: num(node.sharePct), group: num(node.group), creator: node.creator === true })),
    sources: rows(row.sources)
      .filter((source) => wallet(source.wallet))
      .map((source) => ({ wallet: source.wallet as string, kinds: kindsOf(source.kinds).filter((kind): kind is 'coin' | 'sol' => kind !== 'between'), holders: Array.isArray(source.holders) ? source.holders.filter(wallet) : [], creator: source.creator === true })),
    edges: rows(row.edges)
      .filter((edge) => wallet(edge.from) && wallet(edge.to) && KINDS.includes(edge.kind as LinkKind))
      .map((edge) => ({ from: edge.from as string, to: edge.to as string, kind: edge.kind as LinkKind })),
    groups: rows(row.groups)
      .filter((group) => num(group.id) !== null && Array.isArray(group.wallets))
      .map((group) => ({ id: num(group.id)!, wallets: (group.wallets as unknown[]).filter(wallet), sharePct: num(group.sharePct), ties: kindsOf(group.ties), sources: Array.isArray(group.sources) ? group.sources.filter(wallet) : [], creator: group.creator === true })),
    checked: num(row.checked) ?? 0,
    of: num(row.of) ?? 0,
    whole: row.whole === true,
    observedAt: typeof row.observedAt === 'string' ? row.observedAt : '',
    stale: row.stale === true,
  };
}

/** The groups' shares added up, %; null — no share known. */
export function groupedShare(answer: HolderLinksAnswer): number | null {
  let sum = 0;
  let known = false;
  for (const group of answer.groups) {
    if (group.sharePct === null) continue;
    sum += group.sharePct;
    known = true;
  }
  return known ? sum : null;
}

/** A share as the map writes it: «24%», «4.5%», «0.31%». */
export function shareText(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—';
  if (pct > 0 && pct < 0.01) return '<0.01%';
  const places = pct >= 10 ? 0 : pct >= 1 ? 1 : 2;
  return `${Number(pct.toFixed(places))}%`;
}

/** How many colours the groups take before they repeat: the tokens the map may light. */
export const GROUP_TONES = 5;
/** A group's tone: 1 … `GROUP_TONES`, then over again. */
export const toneOf = (group: number): number => ((Math.max(1, Math.floor(group)) - 1) % GROUP_TONES) + 1;

export type PlacedNode = Readonly<{ owner: string; x: number; y: number; r: number; group: number | null; sharePct: number | null; creator: boolean }>;
export type PlacedSource = Readonly<{ wallet: string; x: number; y: number; group: number | null; creator: boolean }>;
export type PlacedLine = Readonly<{ x1: number; y1: number; x2: number; y2: number; kind: LinkKind; group: number | null }>;
export type MapLayout = Readonly<{ box: Readonly<{ x: number; y: number; width: number; height: number }>; nodes: readonly PlacedNode[]; sources: readonly PlacedSource[]; lines: readonly PlacedLine[] }>;

/** A holder's bubble: its area grows with its share; the smallest still a target, the largest within the map. */
export const radiusOf = (share: number | null): number => Math.min(40, 8 + Math.sqrt(Math.max(0, share ?? 0)) * 6);
/** A shared wallet's mark. */
export const SOURCE_SIZE = 6;
const GAP = 4;
const CLUSTER_GAP = 28;
const PAD = 12;
const TURN = 0.35;

type Item = { key: string; r: number; x: number; y: number };

/** Items packed tight around a centre, the largest first, along a spiral: the first free place for each. */
function pack(items: Item[], centre: Item | null): Item[] {
  const placed: Item[] = centre ? [{ ...centre, x: 0, y: 0 }] : [];
  for (const item of [...items].sort((a, b) => b.r - a.r || (a.key < b.key ? -1 : 1))) {
    if (!placed.length) {
      placed.push({ ...item, x: 0, y: 0 });
      continue;
    }
    let spot: Readonly<{ x: number; y: number }> | null = null;
    for (let t = 0; t < 4_000 && !spot; t += TURN) {
      const d = 3 * t;
      const x = Math.cos(t) * d;
      const y = Math.sin(t) * d;
      if (placed.every((other) => Math.hypot(other.x - x, other.y - y) >= other.r + item.r + GAP)) spot = { x, y };
    }
    /* The spiral always finds room among a few dozen marks; past it, the far right. */
    placed.push({ ...item, ...(spot ?? { x: Math.max(...placed.map((other) => other.x + other.r)) + item.r + GAP, y: 0 }) });
  }
  return placed;
}

/**
 * The map's layout: each group a cluster around the first wallet its members share (if any), the clusters left to right
 * by share, the holders not linked last; lines for every link drawn between placed marks. The box fits them all.
 */
export function layoutMap(answer: Pick<HolderLinksAnswer, 'nodes' | 'sources' | 'edges' | 'groups'>): MapLayout {
  const groupOfSource = new Map<string, number | null>();
  for (const group of answer.groups) for (const source of group.sources) if (!groupOfSource.has(source)) groupOfSource.set(source, group.id);
  const clusters: { group: number | null; centre: Item | null; items: Item[] }[] = answer.groups.map((group) => ({ group: group.id, centre: null, items: [] }));
  const loose: { group: number | null; centre: Item | null; items: Item[] } = { group: null, centre: null, items: [] };
  const clusterOf = (group: number | null) => (group === null ? loose : (clusters.find((cluster) => cluster.group === group) ?? loose));
  for (const node of answer.nodes) clusterOf(node.group).items.push({ key: `n:${node.owner}`, r: radiusOf(node.sharePct), x: 0, y: 0 });
  for (const source of answer.sources) {
    const cluster = clusterOf(groupOfSource.get(source.wallet) ?? null);
    const item = { key: `s:${source.wallet}`, r: SOURCE_SIZE, x: 0, y: 0 };
    if (cluster !== loose && cluster.centre === null) cluster.centre = item;
    else cluster.items.push(item);
  }
  const all = [...clusters, loose].filter((cluster) => cluster.items.length || cluster.centre);
  const at = new Map<string, Item>();
  let left = 0;
  for (const cluster of all) {
    const packed = pack(cluster.items, cluster.centre);
    const minX = Math.min(...packed.map((item) => item.x - item.r));
    const maxX = Math.max(...packed.map((item) => item.x + item.r));
    const shift = left - minX;
    for (const item of packed) at.set(item.key, { ...item, x: item.x + shift, y: item.y });
    left += maxX - minX + CLUSTER_GAP;
  }
  const placed = [...at.values()];
  const minX = placed.length ? Math.min(...placed.map((item) => item.x - item.r)) - PAD : 0;
  const maxX = placed.length ? Math.max(...placed.map((item) => item.x + item.r)) + PAD : 1;
  const minY = placed.length ? Math.min(...placed.map((item) => item.y - item.r)) - PAD : 0;
  const maxY = placed.length ? Math.max(...placed.map((item) => item.y + item.r)) + PAD : 1;
  const nodes = answer.nodes.map((node): PlacedNode => {
    const item = at.get(`n:${node.owner}`)!;
    return { owner: node.owner, x: item.x, y: item.y, r: item.r, group: node.group, sharePct: node.sharePct, creator: node.creator };
  });
  const sources = answer.sources.map((source): PlacedSource => {
    const item = at.get(`s:${source.wallet}`)!;
    return { wallet: source.wallet, x: item.x, y: item.y, group: groupOfSource.get(source.wallet) ?? null, creator: source.creator };
  });
  const groupOfNode = new Map(answer.nodes.map((node) => [node.owner, node.group]));
  const lines: PlacedLine[] = [];
  for (const edge of answer.edges) {
    const from = at.get(`n:${edge.from}`) ?? at.get(`s:${edge.from}`);
    const to = at.get(`n:${edge.to}`) ?? at.get(`s:${edge.to}`);
    if (!from || !to) continue;
    lines.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, kind: edge.kind, group: groupOfNode.get(edge.to) ?? groupOfNode.get(edge.from) ?? null });
  }
  return { box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, nodes, sources, lines };
}
