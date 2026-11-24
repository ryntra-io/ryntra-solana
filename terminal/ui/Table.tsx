'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CoinLogo } from './CoinLogo';
import { cx } from './cx';
import s from './ui.module.css';

/**
 * A table: a head row and rows on one grid. `columns` is the grid's tracks (`minmax(184px, 1.7fr) repeat(5, 1fr)` …);
 * past `minWidth` the table scrolls sideways inside its panel rather than squeezing a column.
 *
 * `fold` — the tracks once the table no longer fits its panel, one step at a time: each step lets the cells
 * marked `fold={step}` and below go, the way a phone's row keeps only what matters. The table measures its own box and
 * takes the first step that fits; the row's action stands whole inside the card at every width. Without `fold`, or
 * when even the last step does not fit, the table scrolls sideways as before. What a gone column carried that the row
 * must keep (a warning, a state) stands elsewhere in the row marked `data-unfold={step}`: shown only from that step on.
 */
export function Table({ columns, fold, minWidth = 640, label, children }: { columns: string; fold?: readonly string[]; minWidth?: number; label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const steps = fold?.length ?? 0;
  // The steps by value: a caller's array may be new on every render.
  const foldKey = fold?.join('\n') ?? '';
  useLayoutEffect(() => {
    const wrap = box.current;
    const table = wrap?.firstElementChild as HTMLElement | null | undefined;
    const tracks = foldKey ? foldKey.split('\n') : [];
    if (!wrap || !table || !tracks.length) return;
    // Each step tried on the table itself, widest first; the first whose rows stay inside the box stands — its content
    // and its head's last column, empty or not, inside the box's right edge.
    const inside = () => {
      if (wrap.scrollWidth > wrap.clientWidth + 1) return false;
      const last = table.firstElementChild?.lastElementChild?.getBoundingClientRect();
      return !last || last.right <= wrap.getBoundingClientRect().right + 1;
    };
    const fit = () => {
      const was = { step: table.dataset.fold, cols: table.style.getPropertyValue('--cols'), min: table.style.minWidth };
      let take = 0;
      for (; take < tracks.length; take += 1) {
        table.dataset.fold = String(take);
        table.style.setProperty('--cols', take ? tracks[take - 1] : columns);
        table.style.minWidth = take ? '0px' : `${minWidth}px`;
        if (inside()) break;
      }
      table.dataset.fold = was.step ?? '0';
      table.style.setProperty('--cols', was.cols);
      table.style.minWidth = was.min;
      setStep(take);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(wrap);
    watch.observe(table);
    return () => watch.disconnect();
  }, [columns, foldKey, minWidth]);
  const folded = Math.min(step, steps);
  return (
    <div className={s.scrollX} ref={box}>
      <div role="table" aria-label={label} className={s.tbl} data-fold={folded} style={{ ['--cols' as string]: folded && fold ? fold[folded - 1] : columns, minWidth: folded ? 0 : minWidth } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

/** The step of a table's `fold` from which a column goes. */
export type FoldStep = 1 | 2 | 3;

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
 * — its words are the row's link, and the whole row answers it. `fold` — the table's step (`Table fold`) from which
 * the column goes; its head and every row's cell carry the same.
 */
export function Cell({ end = false, head = false, sorted = false, tone, href, fold, className, children }: { end?: boolean; head?: boolean; sorted?: boolean; tone?: 'up' | 'down' | 'dim'; href?: string; fold?: FoldStep; className?: string; children?: ReactNode }) {
  return (
    <span role={head ? 'columnheader' : 'cell'} data-fold={fold} className={cx(end && s.end, sorted && s.sorted, tone === 'up' && s.up, tone === 'down' && s.down, tone === 'dim' && s.dimText, className)}>
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

/**
 * The first cell of a coin's row: its logo, its ticker, its name; with `href` the ticker is the row's link. `also` — the
 * logo addresses tried after `icon` (`CoinLogo`'s queue).
 */
export function CoinCell({ icon, also, symbol, name, href }: { icon: string | null; also?: readonly string[]; symbol: string; name: string; href?: string }) {
  return (
    <span role="cell" className={s.cellCoin}>
      <CoinLogo src={icon} also={also} symbol={symbol} />
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
export function ListRow({ icon, also, symbol, name, value, change, tone, href, label }: { icon: string | null; also?: readonly string[]; symbol: string; name: string; value: string; change?: string; tone?: 'up' | 'down'; href?: string; label?: string }) {
  return (
    <div className={s.listRow}>
      <CoinLogo src={icon} also={also} symbol={symbol} />
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
