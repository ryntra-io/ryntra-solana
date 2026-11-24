import type { ReactNode } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

export type PageKind = 'action' | 'desk';

/**
 * One page for every section. Two
 * kinds and nothing else:
 *
 * - `action` — Swap, Bridge, Launch, Agents, Portfolio and every section to come: one container as wide as the page's
 *   `--page`, on the working area's left line — the agent's line and the desk's head (one axis from the menu,
 *   a turn between sections moves nothing sideways) —, its content at the top. Every tab of a section lives in the
 *   same container — switching tabs moves nothing.
 * - `desk` — the Market, the Spot, the Bots, Earn and the pools: the whole working width, with the same head.
 *
 * A screen is built from `Page`, `PageHead` and `ActionBody`, and writes no width, place or top of its own page. A
 * screen's own `data-*` marks (for its shots and tests) stand on the page.
 *
 * `head="desk"` — an action page of a section whose other tabs are desks (Bots: the Grid is a desk, the
 * other bots forms): its head and tabs run the desk's whole width, so a turn of the tabs never moves them; the content
 * below keeps the action page's container on the same left line.
 */
export function Page({ kind = 'action', head, className, children, ...marks }: { kind?: PageKind; head?: 'desk'; className?: string; children: ReactNode } & { [mark: `data-${string}`]: string | undefined }) {
  return (
    <div {...marks} className={cx(s.page, className)} data-page={kind} data-head={kind === 'action' ? head : undefined}>
      {children}
    </div>
  );
}

/**
 * The page's head, one line: the section's name, its tabs straight after it, and on the right a quiet mark of the
 * state, where there is one («No launch fee»). On a phone the tabs take their own row and scroll sideways; the mark
 * stays on a desk.
 *
 * `mode` — the page's mode, the toggle «Public ⇄ Private» (`PrivacyToggle`): last on the right, and on a
 * phone too, beside the section's name.
 */
export function PageHead({ title, tabs, mark, mode, className }: { title: ReactNode; tabs?: ReactNode; mark?: ReactNode; mode?: ReactNode; className?: string }) {
  return (
    <div className={cx(s.pageHead, className)} data-page-head="">
      <h1 className={s.pageTitle}>{title}</h1>
      {tabs ? <div className={s.pageTabs}>{tabs}</div> : null}
      <span className={s.pageGrow} />
      {mark ? <div className={s.pageMark}>{mark}</div> : null}
      {mode ? <div className={s.pageMode}>{mode}</div> : null}
    </div>
  );
}

/**
 * The body of an action page: the main column (`--page-main`) and the side column (`--page-side`) beside it, the same
 * two columns on every action page — the form, the list or the catalogue on the left; on the right what helps it or the
 * ticket it opens. A narrow desk stands them one under the other; a phone too, the side column under the main one.
 * Without `side` the main column takes the page's whole width — a section's lists and tables.
 */
export function ActionBody({ side, sideLabel, className, children }: { side?: ReactNode; sideLabel?: string; className?: string; children: ReactNode }) {
  // One shape with the side column and without it: the main column stays the same element when a ticket comes or goes —
  // a list under the cursor is never mounted again.
  return (
    <div className={cx(s.actionBody, className)} data-page-body="" data-side={side ? '' : undefined}>
      <div className={s.actionMain} data-page-main="">
        {children}
      </div>
      {side ? (
        <aside className={s.actionSide} data-page-side="" aria-label={sideLabel}>
          {side}
        </aside>
      ) : null}
    </div>
  );
}
