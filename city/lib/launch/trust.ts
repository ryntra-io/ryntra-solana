import type { LaunchFlowResponse } from '../../../lib/api/v1/contract.ts';
import { num } from '../i18n/dict.ts';
import { langNow, type Lang } from '../i18n/lang.ts';
import { TRUST_WORDS } from './words.ts';

/**
 * How a launch's tower says its flow (L3): a few pills and one strip of the creator, each a fact of the chain in a few
 * words, never a verdict — no «safe», no «scam». A fact the engine did not read is not said; a count that is a floor
 * says so with «≥». Every share is rounded down, so a figure never reads as more than it is. The method is behind the
 * tower's «i» (`flowMethod`). The words are the city's language (CITY-79, `TRUST_WORDS`).
 */

/** `watch` — worth a look before a trade; `fact` — context. */
export type PillTone = 'fact' | 'watch';
export type TrustPill = Readonly<{ id: string; text: string; tone: PillTone }>;

/** A share in basis points as a percent, rounded down: 120 → «1.2 %» («1,2 %» in Ukrainian), 7 → «<0.1 %». */
export function pct(bps: number, lang: Lang = langNow()): string {
  const point = (text: string) => (lang === 'uk' ? text.replace('.', ',') : text);
  if (bps <= 0) return '0 %';
  if (bps < 10) return point('<0.1 %');
  const tenths = Math.floor(bps / 10);
  return `${point(tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1))} %`;
}

const count = (n: number, lang: Lang) => num(n, undefined, lang);

/** The pills, the facts worth a look first; at most four. */
export function trustPills(flow: LaunchFlowResponse, lang: Lang = langNow()): readonly TrustPill[] {
  const w = TRUST_WORDS[lang];
  const pills: TrustPill[] = [];
  const slot = flow.launchSlot;
  if (slot) {
    pills.push(slot.buys > 0 ? { id: 'slot', text: w.slotBuys(slot.buys, count(slot.buys, lang), pct(slot.supplyBps, lang)), tone: 'watch' } : { id: 'slot', text: w.slotNone, tone: 'fact' });
  }
  /* Bundles beyond the launch slot's own, which the pill above already says. */
  const later = flow.bundles.groups.filter((group) => !group.why.includes('launch_slot')).length + Math.max(0, flow.bundles.count - flow.bundles.groups.length);
  if (later > 0) pills.push({ id: 'bundles', text: w.bundlesLater(later, count(later, lang)), tone: 'watch' });
  if (flow.graduation.graduated && flow.graduation.singleTrade) pills.push({ id: 'graduation', text: w.graduatedAlone, tone: 'watch' });
  else if (flow.graduation.buyers) pills.push({ id: 'graduation', text: w.graduatedBy(flow.graduation.buyers.independent, count(flow.graduation.buyers.independent, lang)), tone: 'fact' });
  else {
    const n = flow.buyers.independent;
    pills.push({ id: 'buyers', text: w.independent(n, `${flow.buyers.atLeast ? '≥' : ''}${count(n, lang)}`), tone: n < 3 ? 'watch' : 'fact' });
  }
  const record = flow.creatorRecord;
  if (record.count > 0) {
    const text = record.judged ? w.pastSurvived(count(record.count, lang), count(record.survived, lang)) : w.pastCoins(count(record.count, lang));
    pills.push({ id: 'record', text, tone: record.judged > 0 && record.survived === 0 ? 'watch' : 'fact' });
  } else if (record.complete) {
    pills.push({ id: 'record', text: w.firstCoin, tone: 'fact' });
  }
  return [...pills.filter((pill) => pill.tone === 'watch'), ...pills.filter((pill) => pill.tone === 'fact')].slice(0, 4);
}

export type DevStrip = Readonly<{ bought: string; sold: string; soldTone: PillTone; holds: string; linked: string | null }>;

/** The creator's strip: what their wallet bought, whether it sold, what it holds, and the wallets of their party. */
export function devStrip(flow: LaunchFlowResponse, lang: Lang = langNow()): DevStrip | null {
  const w = TRUST_WORDS[lang];
  const dev = flow.dev;
  if (!dev.complete && dev.boughtBps === 0 && dev.sales === 0) return null;
  const sold = dev.sales === 0 ? (dev.complete ? w.neverSold : w.noSaleRead) : dev.soldOfBoughtBps !== null ? w.soldOfIt(pct(dev.soldOfBoughtBps, lang)) : w.sold(pct(dev.soldBps, lang));
  return {
    bought: w.devBought(pct(dev.boughtBps, lang)),
    sold,
    soldTone: dev.sales > 0 ? 'watch' : 'fact',
    holds: w.holds(pct(dev.holdsBps, lang)),
    linked: dev.linked.wallets > 0 ? w.linked(dev.linked.wallets, count(dev.linked.wallets, lang), pct(dev.linked.holdsBps, lang)) : null,
  };
}

/** How the facts are counted, a line each — behind the tower's «i». */
export function flowMethod(flow: Pick<LaunchFlowResponse, 'rules'>, lang: Lang = langNow()): readonly string[] {
  const w = TRUST_WORDS[lang];
  return [w.methodSlot, w.methodBundle, w.methodIndependent(flow.rules.floorUsd === null ? w.anyBuy : w.buyOf(String(flow.rules.floorUsd))), w.methodSurvived, w.methodFacts];
}
