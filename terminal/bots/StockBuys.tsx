'use client';

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { testNow, useAutopilot } from '@/city/lib/autopilot/store';
import { useMandate } from '@/city/lib/bots/mandate';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { Budget } from '@/terminal/agents/NewAgent';
import { budgetText, lamportsTyped } from '@/terminal/agents/figures';
import { OneLine } from '@/terminal/earn/bits';
import { stockLineOf } from '@/terminal/stocks/position-line';
import { useStockPoolFacts } from '@/terminal/stocks/useStockPoolFacts';
import { STOCK_FACTS, STOCK_POSITION } from '@/terminal/stocks/words';
import { AmountField, CoinLogo, Icon, Kick, Segment, SwitchRow, usdText } from '@/terminal/ui';
import { BUDGET_UNITS, STOCKS_READ, WEEKS_DEFAULT, stockCoinsOf, stocksShown, weekBudget, weekOf, type BudgetUnit, type StockCoin } from './stock-buys';
import { RECURRING_STOCKS } from './words';
import a from '@/terminal/agents/agents.module.css';
import b from './bots.module.css';

const SOL_ASSET = { symbol: 'SOL', icon: '/api/icon/So11111111111111111111111111111111111111112' } as const;

/* The shelf is read once a visit: the companies and their order change by the day, not by the minute. */
let shelf: Promise<StockCoin[]> | null = null;
function readShelf(): Promise<StockCoin[]> {
  shelf ??= fetch(STOCKS_READ, { headers: { accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then(stockCoinsOf)
    .catch(() => {
      shelf = null;
      return [];
    });
  return shelf;
}

/** The stocks the bot offers, from the stocks engine's shelf; an empty list until read, and when it is not. */
export function useBotStocks(on = true): readonly StockCoin[] {
  const [stocks, setStocks] = useState<readonly StockCoin[]>([]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void readShelf().then((read) => live && setStocks(read));
    return () => {
      live = false;
    };
  }, [on]);
  return stocks;
}

/** The stocks' own group under the coins: a pill a company — the coins' own pill — its logo and its token's ticker; a tap picks it. */
export function StockPicks({ stocks }: { stocks: readonly StockCoin[] }) {
  const w = useWords(RECURRING_STOCKS);
  const coin = useMandate((st) => st.coin);
  if (!stocks.length) return null;
  const shown = stocksShown(stocks, coin?.mint ?? null);
  const pick = (one: StockCoin) => {
    useMandate.getState().setCoin({ mint: one.mint, symbol: one.symbol, icon: one.icon });
    void testNow();
  };
  return (
    <div className={b.stockGroup} data-bot-stocks="">
      <Kick>{w.stocks}</Kick>
      <div className={a.pills} role="radiogroup" aria-label={w.stocksGroup}>
        {shown.map((one) => (
          <button key={one.mint} type="button" role="radio" aria-checked={one.mint === coin?.mint} className={a.pill} title={one.name} onClick={() => pick(one)} data-bot-stock={one.symbol}>
            <CoinLogo src={one.icon} symbol={one.symbol} size="s" />
            {one.symbol}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * How the budget is counted on Recurring buys, a day or a week — the person's tap, or a sentence's rhythm. `fill` changes when a sentence writes the week, so the week's fields
 * read the card's budget again; `said` — the coin a sentence chose the unit for: a coin's own «A day» does not undo it.
 */
type UnitState = {
  unit: BudgetUnit;
  fill: number;
  said: string | null;
  choose: (unit: BudgetUnit) => void;
  fromSentence: (unit: BudgetUnit, mint: string | null) => void;
  /** The coin's own unit: «A day» (QA 20.11 — «A week» stayed on after going back from a stock to JUP). */
  reset: () => void;
};

export const useBudgetUnit = create<UnitState>((set) => ({
  unit: 'day',
  fill: 0,
  said: null,
  choose: (unit) => set({ unit, said: null }),
  fromSentence: (unit, mint) => set((st) => ({ unit, said: mint, fill: st.fill + 1 })),
  reset: () => set({ unit: 'day', said: null }),
}));

/**
 * The budget, a day or a week: «A day» — the bot's own fields as they are; «A week» — her sum a week and the
 * weeks, which the engine spends as a seventh a day, one buy a day. Switching to «A week» clears a day's budget that is
 * not a week's: what she signs is always what the fields show.
 */
export function RecurringBudget({ solUsd = null }: { solUsd?: number | null }) {
  const w = useWords(RECURRING_STOCKS);
  const unit = useBudgetUnit((st) => st.unit);
  const fill = useBudgetUnit((st) => st.fill);
  const choose = (next: BudgetUnit) => {
    if (next === unit) return;
    if (next === 'week' && !weekOf(useAutopilot.getState().budget)) useAutopilot.getState().setBudget(null);
    useBudgetUnit.getState().choose(next);
  };
  return (
    <div className={b.budgetUnit} data-bot-budget-unit={unit}>
      <Segment label={w.unitLabel} value={unit} onChange={choose} items={BUDGET_UNITS.map((id) => ({ id, label: id === 'day' ? w.unitDay : w.unitWeek }))} />
      {unit === 'day' ? <Budget /> : <WeekBudget key={fill} solUsd={solUsd} />}
    </div>
  );
}

/** What a week's SOL is worth at SOL's price now — «≈ $50» beside the field, so a sum said in dollars reads as said. */
function worth(lamports: bigint | null, solUsd: number | null, lang: Lang): string | null {
  if (lamports === null || solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  const usd = (Number(lamports) / 1e9) * solUsd;
  return usd >= 0.01 ? `≈ ${usdText(usd, lang)}` : null;
}

function WeekBudget({ solUsd }: { solUsd: number | null }) {
  const w = useWords(RECURRING_STOCKS);
  const lang = useLang();
  const kept = weekOf(useAutopilot.getState().budget);
  const [week, setWeek] = useState(kept ? budgetText(kept.perWeek, lang) : '');
  const [weeks, setWeeks] = useState(String(kept?.weeks ?? WEEKS_DEFAULT));
  const test = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (test.current && clearTimeout(test.current)), []);

  const write = (nextWeek: string, nextWeeks: string) => {
    setWeek(nextWeek);
    setWeeks(nextWeeks);
    const perWeek = lamportsTyped(nextWeek);
    const count = /^\d{1,4}$/u.test(nextWeeks) ? Number(nextWeeks) : null;
    const made = perWeek !== null && count !== null ? weekBudget(perWeek, count) : null;
    useAutopilot.getState().setBudget(made);
    if (test.current) clearTimeout(test.current);
    if (made) test.current = setTimeout(() => void testNow(), 700);
  };

  const perWeek = lamportsTyped(week);
  const count = /^\d{1,4}$/u.test(weeks) ? Number(weeks) : null;
  const made = perWeek !== null && count !== null ? weekBudget(perWeek, count) : null;
  return (
    <div className={b.weekFields}>
      <div className={b.weekTiles}>
        <AmountField label={w.budgetWeek} aside={worth(perWeek, solUsd, lang) ?? undefined} value={week} onChange={(text) => write(text, weeks)} asset={SOL_ASSET} />
        <AmountField size="s" label={w.weeksLabel} unit={w.weeksUnit(weeks || '0')} whole placeholder="—" value={weeks} onChange={(text) => write(week, text)} />
      </div>
      {/* What the week makes a day is the terms' own line under the fields; here only what is wrong. */}
      {!made && perWeek !== null ? <span className={b.warnCap}>{w.weekTooSmall}</span> : null}
    </div>
  );
}

/**
 * Before the signature, for a stock: «only while the exchange is open» (on unless she turns it off), the
 * exchange's state in one line while it is not open, and the issuer's rights in one line — whose token it is, what the
 * exchange's hours do to the bot, where the issuer does not offer it, and its terms behind «i». Ryntra blocks no country:
 * the issuer's terms are shown, never enforced.
 */
export function StockTerms({ mint, hours, onHours }: { mint: string; hours: boolean; onHours: (on: boolean) => void }) {
  const w = useWords(RECURRING_STOCKS);
  const p = useWords(STOCK_POSITION);
  const d = useWords(STOCK_FACTS);
  const lang = useLang();
  const facts = useStockPoolFacts(mint);
  const view = stockLineOf(facts, lang);
  const closed = facts?.isStock === true && facts.session !== 'open';
  return (
    <div className={b.stockTerms} data-bot-stock-terms="" data-hours={hours ? '' : undefined}>
      <SwitchRow label={w.hoursOnly} on={hours} onChange={onHours} />
      {closed ? (
        <span className={b.warnCap} data-bot-stock-closed="">
          {w.closedLine}
        </span>
      ) : null}
      <OneLine line={w.issuerLine} label={w.issuerLabel} tone="warn">
        {facts?.issuer ? <p>{w.issuerWhy(facts.issuer.label)}</p> : null}
        <p>{p.hoursWhy}</p>
        <p>{w.hoursWait}</p>
        {view.excluded ? <p>{p.notOffered(view.excluded)}</p> : null}
        {view.limited ? <p>{p.limited(view.limited)}</p> : null}
        {view.termsUrl ? (
          <a className={b.termsLink} href={view.termsUrl} target="_blank" rel="noopener noreferrer">
            {d.read}
            <Icon name="arrow" size="s" />
          </a>
        ) : null}
      </OneLine>
    </div>
  );
}
