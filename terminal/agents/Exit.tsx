'use client';

import { MANDATE_EXIT } from '@/city/lib/bots/mandate';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { TRADER_EXIT, type ExitRules } from '@/lib/mandate/exit';
import { KNOWN_STOCKS } from '@/lib/stocks/known-stocks';
import { Info } from '@/terminal/ui';
import { AGENTS } from './words';
import a from './agents.module.css';

/** Basis points as the person reads them: 1 500 → «15», 20 000 of the cost → «2». */
const pct = (bps: number) => String(bps / 100);
const times = (bps: number) => String(bps / 10_000);

const STOCKS: ReadonlySet<string> = new Set(KNOWN_STOCKS.map((one) => one.mint));

/**
 * Whether this ticket carries the agent's own exit: where the deployment lets the agent sell, never for a
 * stock's regular buys (a stock is bought to keep: no stop sells it unless she chooses so), and not where the card says
 * otherwise (`chosen` false). What it says here is what she signs (`signTrade`'s `exit`).
 */
export function sellsOnItsOwn(coin: string | null, chosen?: boolean): boolean {
  return MANDATE_EXIT && chosen !== false && !(coin && STOCKS.has(coin));
}

/**
 * Before the budget's signature, in one line: when the agent sells on its own; the rules in full behind the
 * «i» at the line's end, so its details open inside the panel. The very rules the engine runs (`lib/mandate/exit.ts`),
 * shown only where the deployment lets the agent sell.
 */
export function ExitLine({ rules = TRADER_EXIT }: { rules?: ExitRules }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  if (!MANDATE_EXIT) return null;
  const n = (text: string) => digits(text, lang);
  const parts = [
    w.exitStop(n(pct(rules.stopBps))),
    ...(rules.halfAtBps !== null ? [w.exitHalf(n(times(rules.halfAtBps)))] : []),
    ...(rules.fadeBps !== null ? [w.exitFade] : []),
    ...(rules.holdH !== null ? [w.exitTime(n(String(rules.holdH)))] : []),
  ];
  return (
    <div className={a.exit} data-agent-exit="">
      <span className={a.cap}>{w.exitLine(parts.join(' · '))}</span>
      <Info label={w.exitHow}>
        <span className={a.facts}>
          <span>{w.exitHowStop(n(pct(rules.stopBps)))}</span>
          {rules.halfAtBps !== null ? <span>{w.exitHowHalf(n(times(rules.halfAtBps)))}</span> : null}
          {rules.fadeBps !== null ? <span>{w.exitHowFade(n(pct(rules.fadeBps)))}</span> : null}
          {rules.holdH !== null ? <span>{w.exitHowTime(n(String(rules.holdH)))}</span> : null}
          <span>{w.exitHowBlind}</span>
          <span>{w.exitHowWallet}</span>
        </span>
      </Info>
    </div>
  );
}
