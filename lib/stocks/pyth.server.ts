/**
 * Pyth — the exchange calendar for free, the price only with an API key.
 *
 * Read on 2026-09-14: Hermes' price feed catalogue answers without a key and
 * carries, for every equity feed, the exchange schedule with holidays and
 * half-days plus `market_hours` (`is_open`, `next_open`, `next_close`); the
 * latest-price route answers `401 unauthorized` without a key, and since the
 * 2026-08-26 upgrade every Hermes price caller needs a Pyth API key. Ryntra
 * therefore reads the calendar here today, and reads prices only when
 * `PYTH_HERMES_API_KEY` is present in the server environment — a dependency
 * of the reference function, not a reason to invent a figure. The header the
 * key travels in is taken from `PYTH_HERMES_API_KEY_HEADER` (default
 * `Authorization`, sent as a bearer token) so the deployment can set
 * whichever form the key page states without a code change.
 *
 * Re-read on 2026-09-16 against
 * `docs.pyth.network/price-feeds/core/upgrade/preparing`,
 * `…/pro/acquire-api-key` and `…/pro/api/rest`: the key comes from a Pyth
 * Terminal account (a free trial is included; paid plans cover ongoing use)
 * and authenticates as `Authorization: Bearer <key>` — the default here.
 * Pyth Pro (formerly Lazer) is a different product with its own REST base
 * (`pyth-lazer.dourolabs.app`, `POST /v1/latest_price`), its own feed ids
 * (integers), its own payload (`feedUpdateTimestamp`, `marketSession`) and
 * a websocket stream; Hermes (Core) covers the US equities Ryntra needs and
 * is the one path this module speaks. The catalogue answered without a key
 * on that day (1,250 equity feeds); the latest-price route answered
 * `401 unauthorized` without one. A publish time in the future is refused as
 * a shape failure, never carried as a fresh price.
 *
 * Re-read on 2026-09-20 against the Hermes
 * catalogue and Pyth's own words (`pyth.network/blog/anthropic-openai-pre-ipo-feeds-on-pyth`,
 * 2026-09-17; `…/24-7-finance-needs-24-7-price-infrastructure-introducing-pyth-indices`,
 * 2026-06-09): beside the exchange feeds (`Equity.US.<SYM>/USD`, the US
 * listing's hours) the catalogue lists **Pyth Indices** — thirty 24/7 feeds
 * named `Equity.Index.<SYM>/USD` with `asset_type: Equity`, a schedule that is
 * always open and, for a listed company, the *same display symbol* as its
 * exchange feed (`NVDA` names both). Two are pre-IPO companies: `OPENAI`
 * (`96d4bb23…`) and `ANTHROPIC`, which Pyth defines as *informational,
 * indicative indicators derived from limited secondary-market and other
 * third-party data … company-level indicators* — not a public stock price,
 * not a financing-round valuation, not fair value, not a price at which a
 * security can be bought or sold, not a prediction of an IPO price. Ryntra
 * therefore keeps the two families apart: the exchange feed is the only
 * reference a US-listed underlying takes, and an index is context for the
 * company behind a pre-IPO token — shown with its own state, never as the
 * row's reference and never compared with a token whose unit is not a share.
 * The latest price of an index needs the same key as any other feed.
 */

export const PYTH_HERMES_BASE_URL = "https://hermes.pyth.network";
/** A publish time this far ahead of the clock is not a price update; it is a clock or a payload gone wrong. */
export const PYTH_FUTURE_TOLERANCE_MS = 60_000;
export const PYTH_ENV = { apiKey: "PYTH_HERMES_API_KEY", header: "PYTH_HERMES_API_KEY_HEADER" } as const;

const CATALOGUE_TTL_MS = 15 * 60 * 1000;

/** The reference source a Pyth-priced row names. */
export const PYTH_SOURCE = { id: "pyth" as const, label: "Pyth" };

export type PythEquityFeed = Readonly<{
  id: string;
  /** e.g. `NVDA`, as the exchange lists it. */
  displaySymbol: string;
  /** The feed's full name, e.g. `Equity.US.NVDA/USD` — the listing is in it. */
  symbol: string;
  description: string;
  quoteCurrency: string;
  /** The exchange schedule string, e.g. `America/New_York;0930-1600,…;1126/C,…`. */
  schedule: string | null;
  marketHours: Readonly<{ isOpen: boolean | null; nextOpen: string | null; nextClose: string | null }>;
}>;

export type PythCatalogueRead =
  | Readonly<{
      ok: true;
      /** The exchange feeds by display symbol — `Equity.US.` first where a symbol names more than one; never an index. */
      bySymbol: ReadonlyMap<string, PythEquityFeed>;
      /** Pyth's 24/7 indices (`Equity.Index.<SYM>/USD`) by display symbol — context for a company, never a listing's reference. */
      indexBySymbol: ReadonlyMap<string, PythEquityFeed>;
      fetchedAt: string;
    }>
  | Readonly<{ ok: false; code: "HTTP" | "SHAPE" | "NETWORK"; reason: string }>;

/** The symbol family of Pyth's 24/7 indices; every other equity feed is an exchange listing. */
export const PYTH_INDEX_PREFIX = "Equity.Index.";

/**
 * The companies behind pre-IPO tokens that Pyth publishes a 24/7 index for,
 * by Ryntra's company key (`companyKeyOf`) — read from the Hermes catalogue
 * on 2026-09-20: OpenAI and Anthropic are Pyth's first pre-IPO indices;
 * SpaceX is listed since its IPO and its index sits beside the exchange
 * feed. A company that is not here has no index, and the row says so —
 * Kalshi on that day.
 */
export const PYTH_INDEX_BY_COMPANY_KEY: Readonly<Record<string, string>> = {
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
  spacex: "SPCX",
};

/** Whether a catalogue row is one of Pyth's 24/7 indices rather than an exchange feed. */
export function isPythIndexFeed(feed: Pick<PythEquityFeed, "symbol">): boolean {
  return feed.symbol.startsWith(PYTH_INDEX_PREFIX);
}

/**
 * The 24/7 index for the company behind a pre-IPO token, and nothing else:
 * the company must be on the verified map and the feed must be that
 * company's `Equity.Index.<SYM>/USD`. A token symbol that happens to spell
 * an index name is not that company; a company Pyth does not index answers
 * null, which the row states as *no index*.
 */
export function pythIndexFeedForCompany(indexBySymbol: ReadonlyMap<string, PythEquityFeed>, companyKey: string | null): PythEquityFeed | null {
  if (!companyKey) return null;
  const symbol = PYTH_INDEX_BY_COMPANY_KEY[companyKey];
  if (!symbol) return null;
  const feed = indexBySymbol.get(symbol);
  if (!feed) return null;
  return feed.symbol === `${PYTH_INDEX_PREFIX}${symbol}/USD` ? feed : null;
}

let catalogue: { value: PythCatalogueRead; at: number } | null = null;
let catalogueInflight: Promise<PythCatalogueRead> | null = null;

/** For tests. */
export function resetPythCaches(): void {
  catalogue = null;
  catalogueInflight = null;
  latest.clear();
  latestInflight.clear();
}

/**
 * The one feed a US-listed underlying may take its reference from: the same
 * ticker on the US listing, and nothing else. A ticker that only exists on
 * another exchange, a look-alike, or a pre-listing name has no feed here —
 * that is UNAVAILABLE, never a neighbour's price.
 */
export function pythFeedForUsListing(bySymbol: ReadonlyMap<string, PythEquityFeed>, underlyingSymbol: string | null): PythEquityFeed | null {
  if (!underlyingSymbol) return null;
  const feed = bySymbol.get(underlyingSymbol);
  if (!feed) return null;
  return feed.symbol === `Equity.US.${underlyingSymbol}/USD` ? feed : null;
}

const epochToIso = (value: unknown): string | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null);

export function normalizePythFeed(raw: unknown): PythEquityFeed | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" && /^[0-9a-f]{64}$/.test(row.id) ? row.id : null;
  const attributes = typeof row.attributes === "object" && row.attributes !== null ? (row.attributes as Record<string, unknown>) : null;
  if (!id || !attributes) return null;
  if (attributes.asset_type !== "Equity") return null;
  const displaySymbol = typeof attributes.display_symbol === "string" ? attributes.display_symbol : null;
  if (!displaySymbol) return null;
  const symbol = typeof attributes.symbol === "string" ? attributes.symbol : "";
  const hours = typeof row.market_hours === "object" && row.market_hours !== null ? (row.market_hours as Record<string, unknown>) : {};
  return {
    id,
    displaySymbol,
    symbol,
    description: typeof attributes.description === "string" ? attributes.description : "",
    quoteCurrency: typeof attributes.quote_currency === "string" ? attributes.quote_currency : "USD",
    schedule: typeof attributes.schedule === "string" ? attributes.schedule : null,
    marketHours: {
      isOpen: typeof hours.is_open === "boolean" ? hours.is_open : null,
      nextOpen: epochToIso(hours.next_open),
      nextClose: epochToIso(hours.next_close),
    },
  };
}

/** The equity feed catalogue, indexed by exchange symbol, cached for fifteen minutes. */
export function readPythEquityCatalogue(deps: Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date }> = {}): Promise<PythCatalogueRead> {
  const now = Date.now();
  if (catalogue && now - catalogue.at < CATALOGUE_TTL_MS && catalogue.value.ok) return Promise.resolve(catalogue.value);
  if (catalogueInflight) return catalogueInflight;
  const fetchImpl = deps.fetchImpl ?? fetch;
  catalogueInflight = (async (): Promise<PythCatalogueRead> => {
    try {
      const response = await fetchImpl(`${PYTH_HERMES_BASE_URL}/v2/price_feeds?asset_type=equity`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 12_000) });
      if (!response.ok) return { ok: false, code: "HTTP", reason: `Hermes answered ${response.status} for the catalogue.` };
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) return { ok: false, code: "SHAPE", reason: "The catalogue is not a list." };
      /* Two families from one list: the exchange feeds, where the US listing
         wins a display symbol that more than one exchange feed spells, and
         the 24/7 indices, which share display symbols with the exchange feeds
         (`NVDA` names both) and must never take a listing's place. */
      const bySymbol = new Map<string, PythEquityFeed>();
      const indexBySymbol = new Map<string, PythEquityFeed>();
      for (const row of body) {
        const feed = normalizePythFeed(row);
        if (!feed) continue;
        if (isPythIndexFeed(feed)) {
          if (!indexBySymbol.has(feed.displaySymbol)) indexBySymbol.set(feed.displaySymbol, feed);
          continue;
        }
        const held = bySymbol.get(feed.displaySymbol);
        const usListing = feed.symbol === `Equity.US.${feed.displaySymbol}/USD`;
        if (!held || (usListing && held.symbol !== `Equity.US.${held.displaySymbol}/USD`)) bySymbol.set(feed.displaySymbol, feed);
      }
      return { ok: true, bySymbol, indexBySymbol, fetchedAt: (deps.now ?? (() => new Date()))().toISOString() };
    } catch (error) {
      return { ok: false, code: "NETWORK", reason: error instanceof Error ? error.message : String(error) };
    }
  })();
  return catalogueInflight
    .then((value) => {
      catalogue = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      catalogueInflight = null;
    });
}

/** Whether a price read is possible at all: the API key is in the environment. */
export function pythPriceAccess(env: NodeJS.ProcessEnv = process.env): Readonly<{ enabled: boolean; header: string }> {
  const key = env[PYTH_ENV.apiKey]?.trim();
  return { enabled: Boolean(key), header: env[PYTH_ENV.header]?.trim() || "Authorization" };
}

export type PythPrice = Readonly<{ ok: true; id: string; price: number; confidence: number; publishTime: string; fetchedAt: string }>;
export type PythPriceFailure = Readonly<{ ok: false; code: "NO_KEY" | "HTTP" | "SHAPE" | "NETWORK"; reason: string }>;

/** A price is fresh enough to reuse for this long; the feed's own publish time still decides the reference state. */
const LATEST_TTL_MS = 20_000;
/** Hermes takes many ids in one request; fifty keeps the URL short and the answer small. */
const LATEST_BATCH = 50;
const latest = new Map<string, { value: PythPrice; at: number }>();
const latestInflight = new Map<string, Promise<ReadonlyMap<string, PythPrice | PythPriceFailure>>>();

export function parseLatestBody(body: unknown, fetchedAt: string): Map<string, PythPrice> {
  const out = new Map<string, PythPrice>();
  const parsed = body && typeof body === "object" && Array.isArray((body as { parsed?: unknown }).parsed) ? ((body as { parsed: unknown[] }).parsed) : [];
  const fetchedMs = Date.parse(fetchedAt);
  for (const entry of parsed) {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const id = row && typeof row.id === "string" ? row.id.toLowerCase() : null;
    const price = row && typeof row.price === "object" && row.price !== null ? (row.price as Record<string, unknown>) : null;
    if (!id || !price || typeof price.price !== "string" || typeof price.expo !== "number" || typeof price.publish_time !== "number") continue;
    const value = Number(price.price) * 10 ** price.expo;
    if (!Number.isFinite(value) || value <= 0) continue;
    /* A publish time ahead of the fetch is not a price: it is refused here, and the feed answers SHAPE. */
    const publishedMs = price.publish_time * 1000;
    if (Number.isFinite(fetchedMs) && publishedMs - fetchedMs > PYTH_FUTURE_TOLERANCE_MS) continue;
    const confidence = typeof price.conf === "string" ? Number(price.conf) * 10 ** price.expo : 0;
    out.set(id, { ok: true, id, price: value, confidence, publishTime: new Date(publishedMs).toISOString(), fetchedAt });
  }
  return out;
}

/**
 * The latest prices of many feeds, in batches, with the API key — the
 * universe build asks once for every US-listed row it can name a feed for.
 * Without the key every id answers `NO_KEY`; a feed Hermes did not return
 * answers `SHAPE`; a refused or unreachable batch answers for all its ids.
 * Nothing here is retried: the reference is context, and a missing one is
 * stated, never guessed.
 */
export async function readPythLatestMany(
  ids: readonly string[],
  deps: Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; env?: NodeJS.ProcessEnv; now?: () => Date }> = {},
): Promise<ReadonlyMap<string, PythPrice | PythPriceFailure>> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  const out = new Map<string, PythPrice | PythPriceFailure>();
  const access = pythPriceAccess(env);
  if (!access.enabled) {
    for (const id of unique) out.set(id, { ok: false, code: "NO_KEY", reason: "Hermes needs a Pyth API key for price updates; none is configured." });
    return out;
  }
  const nowMs = now().getTime();
  const wanted: string[] = [];
  for (const id of unique) {
    const hit = latest.get(id);
    if (hit && nowMs - hit.at < LATEST_TTL_MS) out.set(id, hit.value);
    else wanted.push(id);
  }
  const key = env[PYTH_ENV.apiKey]?.trim() ?? "";
  const headers: Record<string, string> = { accept: "application/json" };
  headers[access.header] = access.header.toLowerCase() === "authorization" ? `Bearer ${key}` : key;
  const batches: string[][] = [];
  for (let start = 0; start < wanted.length; start += LATEST_BATCH) batches.push(wanted.slice(start, start + LATEST_BATCH));
  await Promise.all(
    batches.map(async (batch) => {
      const batchKey = batch.join(",");
      let pending = latestInflight.get(batchKey);
      if (!pending) {
        pending = (async (): Promise<ReadonlyMap<string, PythPrice | PythPriceFailure>> => {
          const result = new Map<string, PythPrice | PythPriceFailure>();
          const query = batch.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");
          try {
            const response = await (deps.fetchImpl ?? fetch)(`${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?${query}&parsed=true`, { headers, signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000) });
            if (!response.ok) {
              await response.body?.cancel();
              const reason = response.status === 401 || response.status === 403 ? `Hermes refused the key (${response.status}).` : `Hermes answered ${response.status} for the latest prices.`;
              for (const id of batch) result.set(id, { ok: false, code: "HTTP", reason });
              return result;
            }
            const fetchedAt = now().toISOString();
            const prices = parseLatestBody(await response.json(), fetchedAt);
            for (const id of batch) {
              const price = prices.get(id);
              if (price) {
                latest.set(id, { value: price, at: nowMs });
                result.set(id, price);
              } else {
                result.set(id, { ok: false, code: "SHAPE", reason: "Hermes answered without a parsed price for this feed." });
              }
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            for (const id of batch) result.set(id, { ok: false, code: "NETWORK", reason });
          }
          return result;
        })().finally(() => {
          if (latestInflight.get(batchKey) === pending) latestInflight.delete(batchKey);
        });
        latestInflight.set(batchKey, pending);
      }
      for (const [id, value] of await pending) out.set(id, value);
    }),
  );
  return out;
}

/**
 * The latest price of one feed through Hermes, with the API key. Without
 * the key this returns `NO_KEY` and the reference stays UNAVAILABLE — the
 * honest state, never a guess.
 */
export async function readPythLatest(id: string, deps: Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; env?: NodeJS.ProcessEnv; now?: () => Date }> = {}): Promise<PythPrice | PythPriceFailure> {
  const env = deps.env ?? process.env;
  const access = pythPriceAccess(env);
  if (!access.enabled) return { ok: false, code: "NO_KEY", reason: "Hermes needs a Pyth API key for price updates; none is configured." };
  const key = env[PYTH_ENV.apiKey]?.trim() ?? "";
  const headers: Record<string, string> = { accept: "application/json" };
  headers[access.header] = access.header.toLowerCase() === "authorization" ? `Bearer ${key}` : key;
  try {
    const response = await (deps.fetchImpl ?? fetch)(`${PYTH_HERMES_BASE_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(id)}&parsed=true`, { headers, signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000) });
    if (!response.ok) return { ok: false, code: "HTTP", reason: `Hermes answered ${response.status} for the latest price.` };
    const body = (await response.json()) as { parsed?: unknown };
    const parsed = Array.isArray(body.parsed) ? (body.parsed[0] as Record<string, unknown> | undefined) : undefined;
    const price = parsed && typeof parsed.price === "object" && parsed.price !== null ? (parsed.price as Record<string, unknown>) : null;
    if (!price || typeof price.price !== "string" || typeof price.expo !== "number" || typeof price.publish_time !== "number") {
      return { ok: false, code: "SHAPE", reason: "Hermes answered without a parsed price." };
    }
    const value = Number(price.price) * 10 ** price.expo;
    const confidence = typeof price.conf === "string" ? Number(price.conf) * 10 ** price.expo : 0;
    if (!Number.isFinite(value) || value <= 0) return { ok: false, code: "SHAPE", reason: "Hermes answered a non-positive price." };
    const fetchedAt = (deps.now ?? (() => new Date()))();
    if (price.publish_time * 1000 - fetchedAt.getTime() > PYTH_FUTURE_TOLERANCE_MS) return { ok: false, code: "SHAPE", reason: "Hermes answered a publish time in the future." };
    return { ok: true, id, price: value, confidence, publishTime: new Date(price.publish_time * 1000).toISOString(), fetchedAt: fetchedAt.toISOString() };
  } catch (error) {
    return { ok: false, code: "NETWORK", reason: error instanceof Error ? error.message : String(error) };
  }
}
