import Link from "next/link";

import { getMarkets, getSpotOverview, getSpotTokens } from "@/lib/arcus/public";
import { buildRadar, type RadarRow } from "@/lib/markets/radar";
import {
  DEFAULT_SCAN_POLICY,
  SCANNER_KINDS,
  kindSpec,
  runScan,
  type ScannerEvent,
  type VenuePerpMarket,
} from "@/lib/markets/scan";
import { EXECUTABLE_SPOT_SYMBOLS } from "@/lib/markets/executable";
import "../markets.css";

export const dynamic = "force-dynamic";

/**
 * The Scanner — standing conditions, and what they raised.
 *
 * The third of the canon's three discovery objects and the one that stops this
 * being a market list. Radar pushes; the Screener answers a question asked
 * once; this keeps asking and reports **what changed and how it knows**.
 *
 * Three things this page refuses to do, each because the alternative is the
 * ordinary failure:
 *
 *   1. **No event without its source.** Every row states the feed and the
 *      exact field that decided it. `lib/markets/scan.ts` makes the source a
 *      required part of the type, so there is no path to a row that says
 *      *liquidity deteriorated* and cannot say which read produced it.
 *   2. **Zero is an answer.** When nothing fires the page says what was
 *      checked and when, rather than showing an empty box — or filling it.
 *   3. **Coverage is stated per condition.** Market hours join only the
 *      instruments that have a perps market, and three of the canon's own
 *      listed conditions have no source in any endpoint this product reads.
 *      Those are listed with the exact thing that would end each, because
 *      dropping them would make the Scanner read complete.
 */

const WEIGHT_LABEL = { attention: "Attention", information: "Noted" } as const;

function listOf(raw: unknown, key: string): readonly unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const inner = (raw as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

function EventRow({ event }: { event: ScannerEvent }) {
  return (
    <tr>
      <td>
        <Link className="rm-link" href={`/robinhood/workspace/${encodeURIComponent(event.symbol)}`}>
          <span className="rm-symbol">{event.symbol}</span>
          <span className="rm-name">{event.name}</span>
        </Link>
      </td>
      <td>
        <span className={event.weight === "attention" ? "rm-warn" : "rm-muted"}>
          {WEIGHT_LABEL[event.weight]}
        </span>
      </td>
      <td>{kindSpec(event.kind)?.label ?? event.kind}</td>
      <td>{event.headline}</td>
      {/* The source is not decoration. It is why this row exists, and it is
          part of the event's type rather than added here. */}
      <td className="rs-src mono">
        {event.source.feed} · {event.source.field}
      </td>
    </tr>
  );
}

export default async function ScannerPage() {
  let rows: readonly RadarRow[] = [];
  let perps: readonly VenuePerpMarket[] = [];
  let outage: string | null = null;

  try {
    const [tokensRaw, overviewRaw, marketsRaw] = await Promise.all([
      getSpotTokens(),
      getSpotOverview(),
      /* The market-hours fact lives on the perps market list, not on the spot
         universe. A failure here narrows coverage rather than failing the
         page: the other conditions still read. */
      getMarkets().catch(() => [] as never[]),
    ]);
    const tokens = listOf(tokensRaw, "tokens");
    const overview = listOf(overviewRaw, "overview");
    if (!tokens || !overview) {
      outage = "The venue answered in a shape this product does not recognise, so nothing is scanned rather than scanned wrongly.";
    } else {
      rows = buildRadar(tokens as never[], overview as never[], EXECUTABLE_SPOT_SYMBOLS);
      perps = (marketsRaw as VenuePerpMarket[]).map((market) =>
        Object.freeze({
          baseAsset: market.baseAsset,
          status: market.status,
          isOutsideRth: market.isOutsideRth ?? null,
        }),
      );
      if (rows.length === 0) {
        outage = "The venue answered with no instruments. That is a read failure rather than a quiet market.";
      }
    }
  } catch {
    outage = "The venue's endpoints did not answer. Nothing below is current.";
  }

  const now = Date.now();
  const result = runScan(rows, perps, now, DEFAULT_SCAN_POLICY);
  const coverage = new Map(result.coverage.map((entry) => [entry.kind, entry]));
  const sourced = SCANNER_KINDS.filter((spec) => spec.source !== null);
  const unsourced = SCANNER_KINDS.filter((spec) => spec.source === null);

  /* Attention before information, and otherwise the order the conditions were
     evaluated in. Nothing is ranked by a score, because there is no score. */
  const events = [...result.events].sort((a, b) =>
    a.weight === b.weight ? 0 : a.weight === "attention" ? -1 : 1,
  );

  return (
    <main className="rm">
      <header className="rm-head">
        <h1 className="rm-h1">Scanner</h1>
        <p className="rm-lead">
          Standing conditions that keep watching. Every event names the feed and the field that raised
          it, and every condition states how much of the universe it can actually see.
        </p>
      </header>

      {outage ? (
        <p className="rm-outage">{outage}</p>
      ) : (
        <>
          <dl className="rm-counts">
            <div>
              <dt>Events now</dt>
              <dd>{events.length}</dd>
            </div>
            <div>
              <dt>Needing attention</dt>
              <dd>{events.filter((event) => event.weight === "attention").length}</dd>
            </div>
            <div>
              <dt>Instruments checked</dt>
              <dd>{result.checked}</dd>
            </div>
            <div>
              <dt>Conditions with a source</dt>
              <dd>
                {sourced.length} of {SCANNER_KINDS.length}
              </dd>
            </div>
          </dl>

          <section className="rs-block">
            <h2 className="rs-h2">What is firing</h2>
            {events.length === 0 ? (
              /* The state that has to read as an answer. At the probe that
                 shaped this surface, `isOutsideRth` was true on none of the 47
                 markets — nothing firing is a finding, not an empty page. */
              <p className="rm-note">
                Nothing is firing. {result.checked} instruments were checked against{" "}
                {sourced.length} conditions that have a source, at{" "}
                {new Date(result.ranAt).toISOString().replace("T", " ").slice(0, 19)} UTC.
              </p>
            ) : (
              <div className="rm-scroll">
                <table className="rm-table">
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Weight</th>
                      <th>Condition</th>
                      <th>What happened</th>
                      <th>Raised by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <EventRow event={event} key={`${event.kind}-${event.symbol}`} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rs-block">
            <h2 className="rs-h2">The standing conditions, and what each can see</h2>
            <div className="rm-scroll">
              <table className="rm-table">
                <thead>
                  <tr>
                    <th>Condition</th>
                    <th>The question it keeps asking</th>
                    <th className="rm-right">Can judge</th>
                    <th className="rm-right">Firing</th>
                    <th>Reads</th>
                  </tr>
                </thead>
                <tbody>
                  {sourced.map((spec) => {
                    const seen = coverage.get(spec.kind);
                    return (
                      <tr key={spec.kind}>
                        <td>{spec.label}</td>
                        <td className="rm-muted">{spec.question}</td>
                        <td className="rm-right">
                          <span className="rm-num">
                            {seen?.covered ?? 0} / {seen?.total ?? 0}
                          </span>
                        </td>
                        <td className="rm-right">
                          <span className="rm-num">{seen?.fired ?? 0}</span>
                        </td>
                        <td className="rs-src mono">
                          {spec.source?.feed} · {spec.source?.field}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rs-block">
            <h2 className="rs-h2">Conditions with no source</h2>
            <p className="rm-note">
              The product package lists these. No endpoint this product reads carries the figure, so
              they watch nothing — stated rather than dropped, because a Scanner missing them
              silently would read as complete.
            </p>
            <ul className="rm-gaps">
              {unsourced.map((spec) => (
                <li key={spec.kind}>
                  <b>{spec.label}</b>
                  <span className="rm-absent">{spec.gate}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
