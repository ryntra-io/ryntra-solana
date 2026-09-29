import Link from "next/link";

import { getSpotOverview, getSpotTokens } from "@/lib/arcus/public";
import { buildRadar, isTradable, type Observed, type RadarRow } from "@/lib/markets/radar";
import {
  MAX_CONDITIONS,
  SCREEN_FIELDS,
  SCREEN_PRESETS,
  decodeConditions,
  describeCondition,
  encodeConditions,
  fieldCoverage,
  runScreen,
  screenField,
  type Condition,
} from "@/lib/markets/screen";
import { EXECUTABLE_SPOT_SYMBOLS } from "@/lib/markets/executable";
import { SavedScreens } from "./saved";
import "../markets.css";

export const dynamic = "force-dynamic";

/**
 * The Screener — the discovery surface a person drives.
 *
 * Radar is pushed: the product decides what is worth showing. This is queried:
 * the person states conditions and gets the set that matches them. The canon
 * keeps the two apart because collapsing discovery into one "markets screen"
 * with three presets is what makes every competitor's surface interchangeable.
 *
 * **The conditions live in the URL.** That makes "saved as a named screen,
 * re-runnable" literal — a saved screen is a name and a link, it stores no
 * result and no market data, and running it tomorrow answers for tomorrow. It
 * also keeps the universe on the server: the alternative ships all 231 rows to
 * the browser so a filter can run there, which is a lot of bytes to move in
 * order to hide most of them again.
 *
 * **The page reports what it could not judge.** Fifty-one instruments have no
 * price/earnings ratio because crypto and community tokens do not have one. A
 * screen that counted them as misses would report a finding it never made, and
 * one that read the absence as zero would pass them all. They are excluded from
 * the result *and named*, with the venue's own reason.
 */

const money = (n: number) =>
  n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toPrecision(3)}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const compact = (n: number) => n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

const CLASS_LABEL: Record<string, string> = {
  STOCK_TOKEN: "Stock token",
  GENERIC_ERC20: "Crypto",
  COMMUNITY_TOKEN: "Community",
};

function Cell({ value, format }: { value: Observed<number>; format: (n: number) => string }) {
  return value.known ? (
    <span className="rm-num">{format(value.value)}</span>
  ) : (
    <span className="rm-unknown">Unknown</span>
  );
}

/** A link to this same screen with one condition added or removed. */
function href(conditions: readonly Condition[]): string {
  const encoded = encodeConditions(conditions);
  if (encoded.length === 0) return "/robinhood/workspace/screener";
  return `/robinhood/workspace/screener?${encoded.map((c) => `c=${encodeURIComponent(c)}`).join("&")}`;
}

function listOf(raw: unknown, key: string): readonly unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const inner = (raw as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const conditions = decodeConditions(params.c);

  let rows: readonly RadarRow[] = [];
  let outage: string | null = null;

  try {
    const [tokensRaw, overviewRaw] = await Promise.all([getSpotTokens(), getSpotOverview()]);
    const tokens = listOf(tokensRaw, "tokens");
    const overview = listOf(overviewRaw, "overview");
    if (!tokens || !overview) {
      outage = "The venue answered in a shape this product does not recognise, so nothing is screened rather than screened wrongly.";
    } else {
      rows = buildRadar(tokens as never[], overview as never[], EXECUTABLE_SPOT_SYMBOLS);
      if (rows.length === 0) {
        outage = "The venue answered with no instruments. That is a read failure rather than an empty market.";
      }
    }
  } catch {
    outage = "The venue's token and overview endpoints did not answer. Nothing below is current.";
  }

  const now = Date.now();
  const result = runScreen({ id: "url", name: "Screen", conditions }, rows, now);

  /* One entry per instrument the screen could not decide, and the field that
     could not decide it. Grouped so the page says "51 on price/earnings"
     rather than listing fifty-one identical reasons. */
  const unjudgedByField = new Map<string, { count: number; reason: string }>();
  for (const entry of result.unjudged) {
    const existing = unjudgedByField.get(entry.field);
    if (existing) existing.count += 1;
    else unjudgedByField.set(entry.field, { count: 1, reason: entry.reason });
  }

  return (
    <main className="rm">
      <header className="rm-head">
        <h1 className="rm-h1">Screener</h1>
        <p className="rm-lead">
          Radar pushes what is happening. This answers a question you state. The conditions are in the
          address bar, so a screen you save is a name and a link — it holds no result and re-runs
          against whatever the venue says next time.
        </p>
      </header>

      {outage ? (
        <p className="rm-outage">{outage}</p>
      ) : (
        <>
          <section className="rs-block">
            <h2 className="rs-h2">Start from</h2>
            <div className="rs-presets">
              {SCREEN_PRESETS.map((preset) => (
                <Link className="rs-preset" key={preset.name} href={href(preset.conditions)}>
                  {preset.name}
                </Link>
              ))}
            </div>
          </section>

          <section className="rs-block">
            <h2 className="rs-h2">Conditions</h2>
            {conditions.length === 0 ? (
              <p className="rm-note">
                No conditions. Every instrument the venue lists is below — {rows.length} of them.
              </p>
            ) : (
              <ul className="rs-conditions">
                {conditions.map((condition, index) => {
                  const field = screenField(condition.field);
                  const without = conditions.filter((_, i) => i !== index);
                  return (
                    <li key={`${condition.field}-${condition.op}-${String(condition.value)}`}>
                      <span className="rs-cond">{describeCondition(condition)}</span>
                      {/* The field a condition reads is shown beside it. A filter
                          a person cannot trace to a source has to be believed. */}
                      <span className="rs-src mono">{field?.source}</span>
                      <Link className="rs-drop" href={href(without)} aria-label={`Remove: ${describeCondition(condition)}`}>
                        Remove
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {conditions.length < MAX_CONDITIONS ? (
              /* An ordinary GET form. The existing conditions ride along as
                 hidden inputs, so submitting appends one rather than replacing
                 the screen — and none of this needs JavaScript to work. */
              <form className="rs-form" method="get" action="/robinhood/workspace/screener">
                {encodeConditions(conditions).map((encoded) => (
                  <input key={encoded} type="hidden" name="c" value={encoded} />
                ))}
                <label className="rs-field">
                  <span>Field</span>
                  <select name="field" defaultValue="peRatio">
                    {SCREEN_FIELDS.map((field) => {
                      const coverage = fieldCoverage(field, rows, now);
                      return (
                        <option key={field.id} value={field.id}>
                          {field.label} — judges {coverage.judgeable} of {coverage.total}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="rs-field">
                  <span>Comparator</span>
                  <select name="op" defaultValue="atMost">
                    <option value="atMost">at most</option>
                    <option value="atLeast">at least</option>
                    <option value="is">is</option>
                    <option value="isNot">is not</option>
                  </select>
                </label>
                <label className="rs-field">
                  <span>Value</span>
                  <input name="value" defaultValue="40" inputMode="text" />
                </label>
                <button className="rs-add" type="submit" formAction="/robinhood/workspace/screener/add">
                  Add condition
                </button>
              </form>
            ) : (
              <p className="rm-note">
                Twelve conditions is the limit. A screen is a question, not a query plan.
              </p>
            )}
          </section>

          <section className="rs-block">
            <div className="rs-result-head">
              <h2 className="rs-h2">
                {result.matched.length} matched
                <span className="rs-of"> of {result.checked} listed</span>
              </h2>
              {/* A saved screen is a name and a link: the encoded conditions,
                  and nothing about the result. */}
              <SavedScreens conditions={[...encodeConditions(conditions)]} />
            </div>

            {unjudgedByField.size > 0 ? (
              /* The honest half of the answer. These instruments were not
                 misses — nothing could decide them, and saying so is the
                 difference between a filter and a finding. */
              <ul className="rs-unjudged">
                {[...unjudgedByField.entries()].map(([field, entry]) => (
                  <li key={field}>
                    <b>{entry.count}</b> could not be judged on{" "}
                    <b>{screenField(field as never)?.label ?? field}</b> — {entry.reason}
                  </li>
                ))}
              </ul>
            ) : null}

            {result.matched.length === 0 ? (
              <p className="rm-note">
                Nothing matched. That is an answer about your conditions, not about the market.
              </p>
            ) : (
              <div className="rm-scroll">
                <table className="rm-table">
                  <thead>
                    <tr>
                      <th>Instrument</th>
                      <th>Class</th>
                      <th className="rm-right">Price</th>
                      <th className="rm-right">24h</th>
                      <th className="rm-right">Market cap</th>
                      <th className="rm-right">P/E</th>
                      <th>Through Ryntra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.matched.map((row) => (
                      <tr key={row.address}>
                        <td>
                          <Link className="rm-link" href={`/robinhood/workspace/${encodeURIComponent(row.symbol)}`}>
                            <span className="rm-symbol">{row.symbol}</span>
                            <span className="rm-name">{row.name}</span>
                          </Link>
                        </td>
                        <td>
                          <span className="rm-class">{CLASS_LABEL[row.instrumentClass]}</span>
                        </td>
                        <td className="rm-right">
                          <Cell value={row.price} format={money} />
                        </td>
                        <td className="rm-right">
                          <Cell value={row.changePercent24h} format={pct} />
                        </td>
                        <td className="rm-right">
                          <Cell value={row.fundamentals.marketCap} format={compact} />
                        </td>
                        <td className="rm-right">
                          <Cell value={row.fundamentals.peRatio} format={(n) => n.toFixed(1)} />
                        </td>
                        <td>
                          {isTradable(row.tradability) ? (
                            <span className="rm-ok">Executable here</span>
                          ) : (
                            <span className="rm-muted">Listed only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
