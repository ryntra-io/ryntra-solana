'use client';

import { useId, useState } from 'react';
import { num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { pct } from '@/city/lib/launch/format';
import { POOL_SPLIT, type PoolChoice } from '@/city/lib/launch/pool';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Kick, Switch } from '@/terminal/ui';
import l from '../launch.module.css';
import r from './pro-rewards.module.css';
import { PRO_REWARDS_SWITCH, REWARD_DAYS, REWARD_DEFAULT, REWARD_SHARES, rewardCoins, rewardDayOf, rewardOf, withReward } from './view';
import { PRO_REWARDS } from './words';

/**
 * «Reward liquidity providers» — the reward for a pool's liquidity in the Launch form, one row like the
 * ladder: its switch, its name and its «i». Switched on, two rows of choices — the share of the coins, the days — and
 * one line before the signature: how much, for how long, how much of each day Ryntra's locked part earns until others
 * add liquidity (the program cannot leave it out), and that it does not come back. The creator's choice
 * lives in the city's own store (`PoolChoice.reward`); the engine builds it and says it again at the signature.
 *
 * Shows only with the pool format and behind its switch (`PRO_REWARDS_SWITCH`), closed by default.
 */
export function ProRewards({ choice, onChoice, symbol, disabled, open = PRO_REWARDS_SWITCH }: { choice: PoolChoice; onChoice: (next: PoolChoice) => void; symbol: string; disabled: boolean; open?: boolean }) {
  const lang = useLang();
  const w = PRO_REWARDS[lang];
  const ids = { name: useId(), how: useId() };
  const [explain, setExplain] = useState(false);
  if (!open) return null;
  const reward = rewardOf(choice);
  const compact = (coins: number) => num(coins, { notation: 'compact', maximumFractionDigits: 1 }, lang);
  const amount = reward ? `${compact(rewardCoins(reward.shareBps))} $${symbol}` : null;
  // What of each day Ryntra's locked part earns until others add liquidity — the program cannot leave it out.
  const day = rewardDayOf(reward ? choice : { reward: REWARD_DEFAULT });
  const pick = (next: Partial<NonNullable<PoolChoice['reward']>>) => !disabled && reward && onChoice({ ...choice, reward: { ...reward, ...next } });
  return (
    <div className={l.block} data-launch-reward={reward ? 'on' : 'off'}>
      <div className={l.ladder}>
        <Switch on={reward !== null} labelledBy={ids.name} disabled={disabled} onChange={(on) => onChoice(withReward(choice, on))} />
        <span id={ids.name} className={l.ladderName}>
          {w.name}
        </span>
        <span className={l.grow} />
        <ExplainButton label={w.info} open={explain} controls={ids.how} onToggle={() => setExplain((was) => !was)} />
      </div>
      {explain ? <ExplainBox id={ids.how}>{w.how(pct(reward?.shareBps ?? REWARD_DEFAULT.shareBps), pct(day?.creatorBps ?? POOL_SPLIT.creatorBps), pct(day?.ryntraBps ?? POOL_SPLIT.ryntraBps), compact(day?.creator ?? 0), compact(day?.ryntra ?? 0))}</ExplainBox> : null}
      {reward ? (
        <div className={r.choices}>
          <div className={r.group}>
            <Kick>{w.share}</Kick>
            <div className={r.shares} role="radiogroup" aria-label={w.shareChoice}>
              {REWARD_SHARES.map((share) => (
                <button key={share} type="button" role="radio" aria-checked={reward.shareBps === share} className={l.openChip} disabled={disabled} data-reward-share={share} onClick={() => pick({ shareBps: share })}>
                  {pct(share)}
                </button>
              ))}
            </div>
          </div>
          <div className={r.group}>
            <Kick>{w.term}</Kick>
            <div className={r.days} role="radiogroup" aria-label={w.termChoice}>
              {REWARD_DAYS.map((days) => (
                <button key={days} type="button" role="radio" aria-checked={reward.days === days} className={l.openChip} disabled={disabled} data-reward-days={days} onClick={() => pick({ days })}>
                  {w.days(days)}
                </button>
              ))}
            </div>
          </div>
          <p className={r.line} data-reward-line="">
            {w.line(amount ?? '', w.days(reward.days), day && day.ryntra > 0 ? `${compact(day.ryntra)} $${symbol}` : null)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
