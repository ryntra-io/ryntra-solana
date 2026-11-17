import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { CoinLogo } from './CoinLogo';
import { cx } from './cx';
import s from './ui.module.css';

/**
 * A table: a head row and rows on one grid. `columns` is the grid's tracks (`minmax(184px, 1.7fr) repeat(5, 1fr)` …);
 * past `minWidth` the table scrolls sideways inside its panel rather than squeezing a column.
 */
export function Table({ columns, minWidth = 640, label, children }: { columns: string; minWidth?: number; label: string; children: ReactNode }) {
  return (
    <div className={s.scrollX}>
      <div role="table" aria-label={label} className={s.tbl} style={{ ['--cols' as string]: columns, minWidth } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

/** The head row: the columns' names. */
export function TableHead({ children }: { children: ReactNode }) {
  return (
    <div role="row" className={s.th}>
      {children}
    </div>
  );
}

/**
 * A row; `current` marks the row the screen is about. A row that opens something carries its link in its first cell
 * (`CoinCell` or `Cell` with `href`), and that link answers a tap anywhere on the row.
 */
export function TableRow({ current = false, children }: { current?: boolean; children: ReactNode }) {
  return (
    <div role="row" className={s.tr} aria-current={current || undefined}>
      {children}
    </div>
  );
}

/**
 * A cell: `end` for figures, `head` in the head row, `sorted` for the column the rows are sorted by. `tone` colours a
 * move (`up` mint, `down` flare) or quiets a figure that stands second (`dim`). With `href` — in a row's first cell
 * — its words are the row's link, and the whole row answers it.
 */
export function Cell({ end = false, head = false, sorted = false, tone, href, className, children }: { end?: boolean; head?: boolean; sorted?: boolean; tone?: 'up' | 'down' | 'dim'; href?: string; className?: string; children?: ReactNode }) {
  return (
    <span role={head ? 'columnheader' : 'cell'} className={cx(end && s.end, sorted && s.sorted, tone === 'up' && s.up, tone === 'down' && s.down, tone === 'dim' && s.dimText, className)}>
      {href ? (
        <Link href={href} className={s.rowLink}>
          {children}
        </Link>
      ) : (
        children
      )}
    </span>
  );
}

/** The first cell of a coin's row: its logo, its ticker, its name; with `href` the ticker is the row's link. */
export function CoinCell({ icon, symbol, name, href }: { icon: string | null; symbol: string; name: string; href?: string }) {
  return (
    <span role="cell" className={s.cellCoin}>
      <CoinLogo src={icon} symbol={symbol} />
      <span className={s.cellCoinWords}>
        {href ? (
          <Link href={href} className={cx(s.sym, s.rowLink)}>
            {symbol}
          </Link>
        ) : (
          <span className={s.sym}>{symbol}</span>
        )}
        <span className={s.subline}>{name}</span>
      </span>
    </span>
  );
}

/** A phone's row: the coin, its price and its move. With `href` the row opens it. */
export function ListRow({ icon, symbol, name, value, change, tone, href, label }: { icon: string | null; symbol: string; name: string; value: string; change?: string; tone?: 'up' | 'down'; href?: string; label?: string }) {
  return (
    <div className={s.listRow}>
      <CoinLogo src={icon} symbol={symbol} />
      <span className={s.listMain}>
        {href ? (
          <Link href={href} className={cx(s.sym, s.rowLink)} aria-label={label}>
            {symbol}
          </Link>
        ) : (
          <span className={s.sym}>{symbol}</span>
        )}
        <span className={s.subline}>{name}</span>
      </span>
      <span className={s.listSide}>
        <span>{value}</span>
        {change ? <span className={cx(s.listChange, tone === 'up' && s.up, tone === 'down' && s.down)}>{change}</span> : null}
      </span>
    </div>
  );
}
