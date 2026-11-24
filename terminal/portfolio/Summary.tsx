'use client';

import { useId, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { resultTone, sumText } from '@/terminal/earn/rows';
import { Action, Figure, Kick, Panel, Quiet } from '@/terminal/ui';
import { collectable, type ActionId, type PartId } from './all-view';
import { ALL } from './all-words';
import { solFigure } from './clean-view';
import { Glyph, type GlyphName } from './glyphs';
import type { AllData } from './useAll';
import a from './all.module.css';

/**
 * «Total»: everything the wallet holds in one figure, in dollars and in SOL, the day's move of its coins, the fees
 * still to collect, and one bar of where the money is with its parts under it. The total says what it is: the whole,
 * or what has answered so far — never a short sum dressed as the whole. How it is counted waits behind «i».
 */
export function TotalPanel({ data }: { data: AllData }) {
  const w = useWords(ALL);
  const lang = useLang();
  const [how, setHow] = useState(false);
  const howId = useId();
  const sum = data.sum;
  if (!sum) return null;
  const names: Readonly<Record<PartId, string>> = { pools: w.pools, staking: w.staking, lending: w.lendingGroup, coins: w.coins, dust: w.dust, agents: w.agents };
  // The pools' fees and rewards — what «Collect fees» collects; a deposit's interest is not collected, it is the deposit.
  const toCollect = collectable(data.groups).usd;

  return (
    <Panel pad="l" gap={16} edge label={w.total} className={a.total}>
      <div className={a.totalRow}>
        <div className={a.totalMain}>
          <span className={a.kickRow}>
            <Kick>{sum.complete ? w.total : w.totalSoFar}</Kick>
            <ExplainButton label={w.totalInfo} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
          </span>
          <span className={a.totalFigs}>
            <Figure value={sumText(sum.usd, lang)} size="xl" className={a.big} />
            {sum.sol !== null ? <span className={a.totalSol}>{`≈ ${digits(solFigure(sum.sol), lang)} SOL`}</span> : null}
          </span>
          {data.day ? <Figure value={w.today(sumText(data.day.usd, lang, true))} size="s" tone={resultTone(data.day.usd)} /> : null}
        </div>
        {toCollect >= 0.01 ? (
          <div className={a.totalSide}>
            <Kick>{w.toCollect}</Kick>
            <Figure value={sumText(toCollect, lang)} size="m" tone="up" />
          </div>
        ) : null}
      </div>
      {how ? <ExplainBox id={howId}>{w.totalText}</ExplainBox> : null}
      {sum.bar.length ? (
        <div className={a.bar} role="img" aria-label={w.where(sum.bar.map((seg) => `${names[seg.id]} ${Math.round(seg.share * 100)}%`).join(', '))}>
          {sum.bar.map((seg) => (
            <i key={seg.id} data-part={seg.id} style={{ flexGrow: Math.max(seg.share, 0.012) }} />
          ))}
        </div>
      ) : (
        <div className={a.bar} aria-hidden="true">
          <i data-part="none" style={{ flexGrow: 1 }} />
        </div>
      )}
      {sum.parts.length ? (
        <ul className={a.parts}>
          {sum.parts.map((part) => (
            <li key={part.id} className={a.part}>
              <i className={a.dot} data-part={part.id} aria-hidden="true" />
              {names[part.id]}
              <b>{sumText(part.usd, lang)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {sum.unread ? (
        <p className={a.notAll}>
          <span>{w.notAll}</span>
          <Quiet size="s" disabled={data.rereading} onClick={data.reread}>
            {w.again}
          </Quiet>
        </p>
      ) : null}
    </Panel>
  );
}

/** One of the three actions as the bar shows it: what it gives now, and whether it can be pressed here. */
export type Offer = Readonly<{
  id: ActionId;
  glyph: GlyphName;
  title: string;
  /** One line of what it gives this wallet now. */
  fact: string;
  /** The button's own short word. */
  word: string;
  /** The engine's door for it is open on this deployment. */
  open: boolean;
  onPress: () => void;
}>;

/**
 * The three actions — «Collect fees», «Exit everything», «Clean wallet» — each with what it gives this wallet now. One
 * of them is the screen's amber action (`primary`); the rest are quiet. An action whose door the engine keeps shut on
 * this deployment is not in the bar — never a «soon» (decision 108, p. 5), as on the phone's bar. A wallet that is only
 * looked at has no bar at all (its offers are none): its one way in, «Connect wallet», stands at the page's head. An
 * action with nothing to do is not in the bar.
 */
export function ActionBar({ offers, primary, own, busy }: { offers: readonly Offer[]; primary: ActionId | null; own: boolean; busy: boolean }) {
  const w = useWords(ALL);
  const live = offers.filter((offer) => offer.open);
  if (!live.length) return null;
  return (
    <Panel pad="none" edge label={w.actions} className={a.actions}>
      {live.map((offer) => (
        <div key={offer.id} className={a.action}>
          <span className={a.actionBadge}>
            <Glyph name={offer.glyph} />
          </span>
          <span className={a.actionWords}>
            <b>{offer.title}</b>
            <span>{offer.fact}</span>
          </span>
          {own ? (
            <span className={a.actionEnd} data-thumb="">
              {offer.id === primary ? (
                <Action size="m" full={false} disabled={busy} aria-label={offer.title} onClick={offer.onPress}>
                  {offer.word}
                </Action>
              ) : (
                <Quiet disabled={busy} aria-label={offer.title} onClick={offer.onPress}>
                  {offer.word}
                </Quiet>
              )}
            </span>
          ) : null}
        </div>
      ))}
    </Panel>
  );
}

/**
 * The phone's bar of the same actions, in the thumb's reach: the amber one first. On a wallet that is only looked at
 * (`connect`) it carries the one way in instead — in its place under the address, never a band that sticks over the
 * tabs on every scroll: there it took a quarter of the screen with the frame's head and tabs (eyes 20.11, 84).
 */
export function ThumbBar({ offers, primary, busy, connect }: { offers: readonly Offer[]; primary: ActionId | null; busy: boolean; connect?: () => void }) {
  const w = useWords(ALL);
  if (connect) {
    return (
      <div className={a.thumbIn} role="group" aria-label={w.actions}>
        <Action size="m" onClick={connect}>
          {w.connect}
        </Action>
      </div>
    );
  }
  const live = offers.filter((offer) => offer.open);
  if (!live.length) return null;
  const ordered = [...live].sort((x, y) => Number(y.id === primary) - Number(x.id === primary));
  return (
    <div className={a.thumb} role="group" aria-label={w.actions}>
      {ordered.map((offer) =>
        offer.id === primary ? (
          <Action key={offer.id} size="m" full={false} disabled={busy} aria-label={offer.title} onClick={offer.onPress}>
            {offer.word}
          </Action>
        ) : (
          <Quiet key={offer.id} disabled={busy} aria-label={offer.title} onClick={offer.onPress}>
            {offer.word}
          </Quiet>
        ),
      )}
    </div>
  );
}
