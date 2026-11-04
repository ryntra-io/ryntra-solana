import type { PaperBot } from './hangar.ts';
import type { Run } from './sim.ts';

/**
 * «Історія» — a receipt for every fill of every bot, newest first, and the same as a CSV file. On paper a receipt
 * says it is paper; a live receipt will carry its transaction instead.
 */

export type Receipt = Readonly<{
  id: string;
  t: number;
  botId: string;
  kind: PaperBot['draft']['kind'];
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  usd: number;
  mode: 'paper';
}>;

export function receiptsOf(rows: readonly Readonly<{ bot: PaperBot; run: Run | null }>[]): Receipt[] {
  const out: Receipt[] = [];
  for (const { bot, run } of rows) {
    if (!run) continue;
    run.fills.forEach((f, i) => {
      out.push({ id: `${bot.id}:${i}`, t: f.t, botId: bot.id, kind: bot.draft.kind, pair: `${bot.draft.pair.symbol}/USDC`, side: f.side, price: f.price, qty: f.qty, usd: f.usd, mode: bot.mode });
    });
  }
  return out.sort((a, b) => b.t - a.t || a.id.localeCompare(b.id));
}

const cell = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Numbers in plain digits, a dot for the decimals: a spreadsheet anywhere reads them. */
const num = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits).replace(/\.?0+$/, '') || '0' : '');

/** Formulas never start a cell: a pair or a name that begins with = + - @ is written as text. */
const safe = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

export const CSV_HEAD = ['time_utc', 'bot', 'kind', 'pair', 'side', 'price_usd', 'amount', 'value_usd', 'mode'] as const;

export function receiptsCsv(receipts: readonly Receipt[]): string {
  const lines = [CSV_HEAD.join(',')];
  for (const r of receipts) {
    lines.push(
      [new Date(r.t).toISOString(), r.botId, r.kind, safe(r.pair), r.side, num(r.price, 10), num(r.qty, 9), num(r.usd, 2), r.mode].map((v) => cell(String(v))).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
