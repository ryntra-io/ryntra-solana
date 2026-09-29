import Link from "next/link";

import { requireWorkspace } from "@/app/shell/workspaces";
import type { PaperTrade } from "@/lib/paper/rpc";
import type { CbCopy } from "../copy";
import {
  LOOP_STATE_LABEL,
  LOOP_STATE_TONE,
  loopStages,
  type LoopStageId,
} from "./loop-state";

import "./overview.css";

/**
 * The Ryntra Home panels.
 *
 * Home is the neutral surface: it aggregates, explains, warns and hands off to
 * the workspace that owns the work. It executes nothing, and it deliberately
 * does not repeat Send, Swap or Bridge — a second place to move money is a
 * second place to get it wrong.
 *
 * The rule every panel follows: show what the account really has, and where it
 * has nothing, say so in the same voice rather than filling the space. Three
 * shapes that rule takes here, because Home is exactly where a portfolio
 * product starts inventing numbers:
 *
 *   An unavailable balance is not zero. `null` from a venue means "we could not
 *   ask", and it renders as a different sentence from "you hold none".
 *
 *   Sources are not summed. A simulated balance, a read-only position count and
 *   a browser-held testnet wallet do not share a unit, a custody model or a
 *   valuation basis. One total appears when each part can be valued from
 *   evidence, and not before.
 *
 *   Market state is not price. What the venue actually publishes is which
 *   markets are online and which tokenized ones are trading outside their
 *   underlying's hours — a risk fact — so that is what the pulse shows rather
 *   than a green percentage.
 */

export function Panel({
  title,
  sub,
  children,
  flush = false,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  /** Content that draws its own grid lines to the panel edge. */
  flush?: boolean;
}) {
  return (
    <section className="ov-panel">
      <header className="ov-head">
        <h2 className="ov-title">{title}</h2>
        {sub ? <p className="ov-sub">{sub}</p> : null}
      </header>
      {flush ? children : <div className="ov-body">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------- connected sources */

/**
 * The paper account, when there is one and it could be read.
 *
 * `null` covers two different facts and the panel tells them apart with
 * `visitor`: nobody is signed in, so there is no account to read; or somebody
 * is and the read failed. Neither is a balance of ten thousand dollars, which
 * is what this page used to print in both cases because the default sat in a
 * `??` beside the number.
 */
export type PaperSummary = Readonly<{
  balance: number;
  pnl: number;
  openCount: number;
  closedCount: number;
}>;

export function Sources({
  c,
  paper,
  visitor,
  wallet,
  livePositions,
}: {
  c: CbCopy;
  paper: PaperSummary | null;
  /** Nobody is signed in. Distinguishes "no account" from "read failed". */
  visitor: boolean;
  wallet: string | null | undefined;
  /** `null` means the venue could not be read — which is not the same as none. */
  livePositions: number | null;
}) {
  /* Two decimals always. `maximumFractionDigits` alone rendered a balance as
     `$10,412.5`, and a money column whose digit count changes with the value is
     a column that cannot be scanned — which is the whole point of setting it in
     tabular mono. */
  const money = (value: number) =>
    `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Panel title={c.home.sourcesTitle} sub={c.home.sourcesSub}>
      <div className="ov-accounts">
        <div className="ov-account">
          <span className="ov-account-k">{c.home.srcPaper}</span>
          {paper ? (
            <>
              <b className="ov-account-v">{money(paper.balance)}</b>
              <span className="ov-account-n">
                {`${paper.pnl >= 0 ? "+" : "−"}$${Math.abs(paper.pnl).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}{" "}
                · {paper.openCount} {c.home.paperOpen} · {paper.closedCount} {c.home.paperClosed}
              </span>
            </>
          ) : (
            <>
              {/* Never the $10,000 starting balance as a placeholder. A visitor
                  has no paper account and a failed read is not a balance; both
                  used to print the default because it sat in a `??` beside the
                  number, which made a fabricated figure indistinguishable from
                  a real one. */}
              <b className="ov-account-v sm">—</b>
              <span className="ov-account-n">
                {visitor ? c.home.srcPaperNone : c.home.srcPaperUnread}
              </span>
            </>
          )}
        </div>

        <div className="ov-account">
          <span className="ov-account-k">{c.home.srcLive}</span>
          {wallet ? (
            <>
              {/* A venue that could not be read shows an em dash, never a zero. */}
              <b className="ov-account-v">{livePositions ?? "—"}</b>
              <span className="ov-account-n">
                {livePositions === null ? c.home.srcLiveUnread : c.home.srcLiveNote}
              </span>
              <span className="ov-account-n mono">
                {wallet.slice(0, 8)}…{wallet.slice(-6)}
              </span>
            </>
          ) : (
            <>
              <b className="ov-account-v sm">—</b>
              <span className="ov-account-n">{c.home.srcLiveNone}</span>
            </>
          )}
        </div>
      </div>

      <p className="ov-note">{c.home.sourcesNote}</p>
    </Panel>
  );
}

/* -------------------------------------------------------------- workspaces */

/**
 * The specialist workspace, summarised.
 *
 * Not the workspace list — that is the switcher's job and the Workspace Map's.
 * This is a card with a real number on it, because a summary that carries no
 * state is a link with extra padding.
 */
export function Workspaces({
  c,
  paper,
  livePositions,
}: {
  c: CbCopy;
  /** `null` when there is no readable paper account; the card then carries no
      count rather than a zero that would read as "you have no positions". */
  paper: PaperSummary | null;
  livePositions: number | null;
}) {
  const marketsMeta = !paper
    ? null
    : livePositions === null
      ? `${paper.openCount} ${c.home.paperOpen}`
      : `${paper.openCount} ${c.home.paperOpen} · ${livePositions} ${c.home.srcLiveNote}`;

  /* Name and destination come from the workspace registry, because that file
     is the one answer to "what is this workspace called and where does it
     go". Three locales each kept their own copy of both, and a copy of a name
     goes stale the way copies do: this panel was still saying `Tokenized
     Markets` after the desk became Robinhood Chain. The note under each card
     stays localized — it is editorial, and it is the only part that is. */
  const markets = requireWorkspace("robinhood-chain");

  const spaces = [
    {
      href: markets.href,
      title: markets.name,
      body: c.home.spaceMarketsNote,
      meta: marketsMeta,
    },
  ];

  return (
    <Panel title={c.home.spacesTitle} sub={c.home.spacesSub} flush>
      <div className="ov-library">
        {spaces.map((space) => (
          <Link className="ov-space" key={space.href} href={space.href} data-enterable="true">
            <b>{space.title}</b>
            <span>{space.body}</span>
            {space.meta ? <span className="ov-space-meta mono">{space.meta}</span> : null}
            <span className="ov-start-go">{c.home.open} →</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ market pulse */

/**
 * What the venue publishes about its own markets.
 *
 * Deliberately counts and regimes rather than prices. The market list carries
 * no 24-hour change and no volume, so this panel names neither: a number a
 * source does not provide is not a number that gets estimated here.
 *
 * `isOutsideRth` is the venue's own market-hours fact, and it is the one that
 * matters most for a tokenized market — a stock token that keeps trading while
 * its underlying is closed is in a different risk regime, and that is a thing
 * Home should say out loud before anyone opens a terminal.
 */
export type MarketPulse = Readonly<{
  online: number;
  crypto: number;
  rwa: number;
  offHours: number;
}>;

export function Pulse({ c, pulse }: { c: CbCopy; pulse: MarketPulse | null }) {
  if (!pulse) {
    return (
      <Panel title={c.home.pulseTitle} sub={c.home.pulseSub}>
        <p className="ov-note">{c.home.pulseUnread}</p>
      </Panel>
    );
  }

  const cells = [
    { k: c.home.pulseOnline, v: pulse.online },
    { k: c.home.pulseCrypto, v: pulse.crypto },
    { k: c.home.pulseRwa, v: pulse.rwa },
    { k: c.home.pulseOffHours, v: pulse.offHours, alert: pulse.offHours > 0 },
  ];

  return (
    <Panel title={c.home.pulseTitle} sub={c.home.pulseSub}>
      <div className="ov-accounts">
        {cells.map((cell) => (
          <div className="ov-account" key={cell.k}>
            <span className="ov-account-k">{cell.k}</span>
            <b className="ov-account-v" data-alert={cell.alert ? "true" : undefined}>
              {cell.v}
            </b>
          </div>
        ))}
      </div>
      <p className="ov-note">{c.home.pulseOffHoursNote}</p>
    </Panel>
  );
}

/* ---------------------------------------------------------- recent activity */

export function RecentActivity({ c, trades }: { c: CbCopy; trades: readonly PaperTrade[] }) {
  if (!trades.length) {
    return (
      <Panel title={c.home.activityTitle} sub={c.home.activitySub}>
        <p className="ov-note">{c.home.activityEmpty}</p>
      </Panel>
    );
  }

  return (
    <Panel title={c.home.activityTitle} sub={c.home.activitySub} flush>
      <div className="ov-acts">
        {trades.map((trade) => {
          const pnl = trade.pnl ?? 0;
          return (
            <div className="ov-act" key={trade.id}>
              <span className="ov-act-market mono">{trade.market}</span>
              <span className="ov-act-side" data-side={trade.side}>
                {trade.side}
              </span>
              <span className="ov-act-pnl mono" data-tone={pnl >= 0 ? "up" : "down"}>
                {pnl >= 0 ? "+" : "−"}
                {Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
              <span className="ov-act-when mono">
                {trade.closed_at ? trade.closed_at.slice(0, 10) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------- decision loop */

/**
 * The decision loop, with each stage's real maturity.
 *
 * Three of these are live on a supported route, two are paper, and the receipt
 * ledger is not built. Drawing six identical lit stages would be prettier and
 * would be the single most misleading thing on a signed-in page.
 */
export function DecisionLoop({ c }: { c: CbCopy }) {
  const labels: Record<LoopStageId, string> = {
    plan: c.home.loopPlan,
    readiness: c.home.loopReadiness,
    authorize: c.home.loopAuthorize,
    execute: c.home.loopExecute,
    receipt: c.home.loopReceipt,
    review: c.home.loopReview,
  };

  return (
    <Panel title={c.home.loopTitle} sub={c.home.loopSub} flush>
      <div className="ov-loop">
        {loopStages().map((stage, index) => (
          <div className="ov-stage" key={stage.id}>
            <span className="ov-stage-n">{String(index + 1).padStart(2, "0")}</span>
            <span className="ov-stage-name">{labels[stage.id]}</span>
            <span className="ov-state" data-tone={LOOP_STATE_TONE[stage.state]}>
              {LOOP_STATE_LABEL[stage.state]}
            </span>
            <span className="ov-stage-scope">{stage.scope}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * Receipts.
 *
 * Home has no receipt ledger. Rather than an empty panel implying one is
 * waiting for data, this says what is true.
 */
export function Records({ c }: { c: CbCopy }) {
  return (
    <Panel title={c.home.recordsTitle}>
      <div className="ov-records">
        <p>{c.home.recordsBody}</p>
      </div>
    </Panel>
  );
}
