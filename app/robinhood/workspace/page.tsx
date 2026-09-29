import Link from "next/link";

import { getSpotOverview, getSpotTokens } from "@/lib/arcus/public";
import {
  ABSENT_ANALYTICS,
  buildRadar,
  isTradable,
  summarise,
  type Observed,
  type RadarRow,
} from "@/lib/markets/radar";
import { EXECUTABLE_SPOT_SYMBOLS } from "@/lib/markets/executable";
import { classMix, coverage, listings, movement, volumeRanks } from "@/lib/markets/radar-stats";
import { Bars, DotMatrix, Gauge, Ring, Sparkline, SplitMeter } from "@/app/components/tiles/microcharts";
import { Chip, Note, Panel, Tile, TileGrid } from "@/app/components/tiles/tile";
import "@/app/components/tiles/tiles.css";
import "./markets.css";

export const dynamic = "force-dynamic";

/**
 * Radar — the discovery surface for Tokenized Markets.
 *
 * It is not at `/app/radar`: that route is the Ryntra Home canon's frozen
 * *Global* Radar across every ecosystem, and the same canon says specialist
 * radars keep their own chain-specific depth. This is the specialist one.
 *
 * **The headline is a ratio, and it is deliberately the first thing here.**
 * The venue lists 231 instruments on Robinhood Chain; three of them are
 * executable through this product. Every one of the 231 arrives with a price, a
 * name and a logo, so a Radar that merely listed them would read as 231
 * tradable assets without a single false sentence being written.
 *
 * **Rebuilt on the tile system by `RYN-CHART-001`.** The first version stated
 * all of this correctly and rendered it as three paragraphs above a definition
 * list above a table — every figure typed at the size of the sentence
 * explaining it. Nothing was wrong and nothing was showable. What changed is
 * only the form: each count is now a tile with the chart that makes it
 * readable, and every explanation moved behind an icon, which is this
 * project's own working rule 6.
 *
 * Nothing here is computed by us. Price, 24-hour change, volume, category and
 * the verification flag are the venue's own fields; the executable set is this
 * repository's pre-sign allowlist. Where the venue returns nothing, the cell
 * says so — `lib/markets/radar.ts` has no path for a missing number to arrive
 * as a zero.
 */

function Cell({ value, format }: { value: Observed<number>; format: (n: number) => string }) {
  if (!value.known) {
    return <span className="rm-unknown">Unknown</span>;
  }
  return <span className="rm-num">{format(value.value)}</span>;
}

const money = (n: number) =>
  n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toPrecision(3)}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const compact = (n: number) => n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

const CLASS_LABEL = {
  STOCK_TOKEN: "Stock token",
  GENERIC_ERC20: "Crypto",
  COMMUNITY_TOKEN: "Community",
} as const;

const CLASS_PLURAL = {
  STOCK_TOKEN: "stock tokens",
  GENERIC_ERC20: "crypto",
  COMMUNITY_TOKEN: "community",
} as const;

function Row({ row }: { row: RadarRow }) {
  const tradable = isTradable(row.tradability);
  const change = row.changePercent24h;
  return (
    <tr>
      <td>
        {/* The row is the way into the Passport. Canon: a trade opens from
            Radar or from a Passport, never from a page of its own. */}
        <Link className="rm-link" href={`/robinhood/workspace/${encodeURIComponent(row.symbol)}`}>
          <span className="rm-symbol">{row.symbol}</span>
          <span className="rm-name">{row.name}</span>
        </Link>
      </td>
      <td>
        <span className="rm-class">{CLASS_LABEL[row.instrumentClass]}</span>
        {!row.origin.agreed && (
          <span className="rm-flag">
            venue disagrees: {row.origin.tokenCategory} / {row.origin.overviewCategory}
          </span>
        )}
      </td>
      <td className="rm-right">
        <Cell value={row.price} format={money} />
      </td>
      {/* Direction is the one place colour is spent in this table, because it is
          the one cell whose sign is the fact. */}
      <td className={change.known ? (change.value >= 0 ? "rm-right rm-up" : "rm-right rm-down") : "rm-right"}>
        <Cell value={change} format={pct} />
      </td>
      <td className="rm-right">
        <Cell value={row.volume24h} format={compact} />
      </td>
      <td>
        {row.venueVerified ? (
          <span className="rm-ok">Venue verified</span>
        ) : (
          <span className="rm-warn">Not venue verified</span>
        )}
      </td>
      <td>
        {tradable ? <Chip tone="evidence">Executable here</Chip> : <span className="rm-muted">Listed only</span>}
      </td>
    </tr>
  );
}

/**
 * Take the list out of whichever shape the source hands back.
 *
 * `/api/arcus` wraps these — `{ tokens: await getSpotTokens() }` — so reading
 * `.tokens` off the *library* result looks right and silently yields nothing,
 * which is how the first build of this page rendered five zeroes and an empty
 * table without a word of warning. Both shapes are accepted, and an
 * unrecognised one returns nothing so the caller can say so rather than show
 * an empty universe.
 */
function listOf(raw: unknown, key: string): readonly unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const inner = (raw as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

export default async function MarketsRadarPage() {
  let rows: readonly RadarRow[] = [];
  let outage: string | null = null;

  try {
    const [tokensRaw, overviewRaw] = await Promise.all([getSpotTokens(), getSpotOverview()]);
    const tokens = listOf(tokensRaw, "tokens");
    const overview = listOf(overviewRaw, "overview");
    if (!tokens || !overview) {
      outage =
        "The venue answered in a shape this product does not recognise, so nothing is listed rather than listed wrongly.";
    } else {
      rows = buildRadar(tokens as never[], overview as never[], EXECUTABLE_SPOT_SYMBOLS);
      /* An empty universe from a source that answered is still not a fact
         about the market — it is a fact about the read. */
      if (rows.length === 0) {
        outage =
          "The venue answered with no instruments. That is a read failure rather than an empty market, so nothing is shown.";
      }
    }
  } catch {
    outage = "The venue's token and overview endpoints did not answer. Nothing below is current.";
  }

  const summary = summarise(rows);
  const now = Date.now();
  const mix = classMix(rows);
  const cover = coverage(rows);
  const move = movement(rows);
  const listed = listings(rows, now, 30);
  const ranks = volumeRanks(rows);
  const executablePercent = ((summary.executable / (summary.listed || 1)) * 100).toFixed(1);
  const busiest = move.buckets.indexOf(Math.max(...move.buckets));

  return (
    <main className="rm">
      <header className="rm-head">
        <div className="rm-title">
          <h1 className="rm-h1">Radar</h1>
          <Note label="What Radar is, and what it is not">
            Every instrument the venue lists on Robinhood Chain, and the much smaller set this product can
            actually execute. Both numbers are here because only one of them is usually shown. Nothing on this
            surface is computed by Ryntra: price, 24-hour change, volume, category and the verification flag
            are the venue&rsquo;s own fields, and the executable set is this repository&rsquo;s pre-signed
            allowlist. Where the venue returns nothing, the cell says so — there is no path here for a missing
            number to arrive as a zero.
          </Note>
        </div>
        <p className="rm-sub">Robinhood Chain, as the venue lists it and as this product can act on it.</p>
      </header>

      {outage ? (
        <p className="rm-outage">{outage}</p>
      ) : (
        <>
          <TileGrid>
            <Tile
              lead
              label="Executable here"
              value={summary.executable}
              unit={`of ${summary.listed} listed`}
              tone="evidence"
              state={<Chip tone="evidence">{summary.listed - summary.executable} listed only</Chip>}
              chart={
                <Ring
                  part={summary.executable}
                  whole={summary.listed}
                  label={`${summary.executable} executable of ${summary.listed} listed`}
                  size={72}
                  caption={`${executablePercent}%`}
                />
              }
              facts={[
                "A pre-signed route and a live price — both, or it is not executable.",
                `${summary.listed - summary.executable} are readable and cannot be traded here.`,
              ]}
              note={
                <>
                  <b>Listed is not supported.</b> An instrument is marked executable only when this product
                  holds a pre-signed route for it <i>and</i> the venue returns a live price. Everything else is
                  listed and readable, and cannot be traded through Ryntra. The ratio leads this page because a
                  table of 231 priced rows reads as 231 tradable assets without one false sentence being
                  written.
                </>
              }
            />

            <Tile
              label="What the venue lists"
              value={summary.listed}
              unit="instruments"
              chart={
                <SplitMeter
                  label={mix.map((m) => `${CLASS_LABEL[m.instrumentClass]}: ${m.count}`).join(", ")}
                  parts={mix.map((m, index) => ({
                    value: m.count,
                    step: (index + 1) as 1 | 2 | 3,
                    name: m.instrumentClass,
                  }))}
                />
              }
              facts={[mix.map((m) => `${m.count} ${CLASS_PLURAL[m.instrumentClass]}`).join(" · ")]}
              note="Three classes, derived from the venue's own category on both of its endpoints. Indices and commodities join equities because they share what decides the outcome — a real-world underlying, market hours, and a reference price that can diverge from the token."
            />

            <Tile
              label="Venue verified"
              value={cover.verified}
              unit={`of ${cover.total}`}
              tone={summary.unverified > 0 ? "warn" : "good"}
              state={
                summary.unverified > 0 ? (
                  <Chip tone="warn">{summary.unverified} not verified</Chip>
                ) : (
                  <Chip tone="good">all verified</Chip>
                )
              }
              chart={
                <Gauge
                  fraction={cover.verified / (cover.total || 1)}
                  label={`${cover.verified} of ${cover.total} verified by the venue`}
                  width={92}
                />
              }
              facts={["The venue's own registry flag — the strongest safety signal available here."]}
              note="The `verified` field on the venue's token registry. It is the venue vouching for the token, not Ryntra, and it says nothing about the issuer, the underlying or the route."
            />

            <Tile
              label="24-hour movement"
              value={move.up}
              unit={`up · ${move.down} down`}
              tone={move.up >= move.down ? "good" : "bad"}
              chart={
                <Bars
                  values={move.buckets}
                  label={`Distribution of 24-hour change across ${move.judged} instruments`}
                  accent={busiest}
                />
              }
              facts={[
                `${move.flat} moved less than half a percent.`,
                `${move.judged} of ${move.total} reported a change at all.`,
              ]}
              note="A distribution rather than an average. An average across equities, stablecoins and community tokens is a number with no referent; the shape says what kind of day it is. Instruments the venue did not price are excluded rather than counted as flat."
            />

            <Tile
              label="Listed on chain"
              value={listed.withinWindow}
              unit="in 30 days"
              chart={
                <Sparkline values={listed.perDay} label={`New listings per day over ${listed.days} days`} height={44} />
              }
              facts={[
                `${listed.stamped} of ${listed.total} carry a listing date.`,
                `${listed.total - listed.stamped} carry none and are excluded.`,
              ]}
              note="Read straight off `addedTimestamp` on the venue's token registry. No snapshot is kept anywhere — the venue stamps the date, so the shape of the last month is already in the response this page fetched. A token with no stamp is excluded, never dated to the epoch."
            />

            <Tile
              label="Where the volume is"
              value={cover.priced}
              unit={`priced of ${cover.total}`}
              tone={summary.withoutPrice > 0 ? "warn" : "neutral"}
              state={summary.conflicted > 0 ? <Chip tone="warn">{summary.conflicted} category conflict</Chip> : null}
              chart={
                <DotMatrix cells={ranks} columns={24} label="24-hour volume by rank across the traded universe" />
              }
              facts={[`${summary.withoutPrice} returned no price.`, "Cell brightness is rank, not size."]}
              note="Volume across this universe spans six orders of magnitude, so a linear scale would paint one bright cell and two hundred and thirty dark ones. Each cell is one instrument ordered by 24-hour volume and shaded by its rank, which answers the question a reader actually has: how concentrated is the activity."
            />
          </TileGrid>

          <Panel
            title="Every instrument the venue lists"
            note={
              <>
                <b>Listed is not supported.</b> The right-hand column is the only one that says whether Ryntra
                can act. Everything else is the venue describing its own market.
              </>
            }
            actions={<Chip>{summary.listed} rows</Chip>}
          >
            <div className="rm-scroll">
              <table className="rm-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Class</th>
                    <th className="rm-right">Price</th>
                    <th className="rm-right">24h</th>
                    <th className="rm-right">Volume 24h</th>
                    <th>Venue status</th>
                    <th>Through Ryntra</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Row key={row.address} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      <Panel
        title="What this Radar does not measure"
        note="These are the fields a community-token scanner is usually judged on. No venue or provider here supplies them, so they are named rather than estimated — a surface that dropped them would read as complete."
        actions={<Chip>{ABSENT_ANALYTICS.length} named gaps</Chip>}
      >
        <ul className="rm-gaplist">
          {ABSENT_ANALYTICS.map((item) => (
            <li key={item.name}>
              <span className="rm-gapname">{item.name}</span>
              <Note label={`Why ${item.name} is not here`}>{item.gate}</Note>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
