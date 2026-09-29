/**
 * The xStocks (Backed Finance) public API — an issuer source, read on the
 * server, cached, and never treated as a second independent confirmation of a
 * price (canon v4.0 §7.4).
 *
 * Read on 2026-09-14 from `https://docs.xstocks.fi/developers` and by probing
 * the endpoints: no authentication for the public routes, `x-ratelimit-limit`
 * 1000 per window, `cache-control: s-maxage=30` on the catalogue. Endpoints:
 *
 * - `GET /api/v2/public/assets?limit=&page=` — every asset (a hundred a page,
 *   whatever `limit` asks) with its
 *   deployments (the Solana mint), underlying symbol/ISIN, exchange, the
 *   issuer's trading period (`market · extended · overnight · closed`),
 *   `openNow` and `nextChangeAt`;
 * - `GET /api/v2/public/assets/{symbol}/price-data` — `{ quote }`, the
 *   issuer's reference quote in USD; the response carries no timestamp, so
 *   Ryntra records the fetch time and nothing more;
 * - `GET /api/v2/public/assets/{symbol}/multiplier?network=Solana` —
 *   `currentMultiplier`, `newMultiplier`, `activationDateTime`, `reason`;
 * - `GET /api/v2/public/proof-of-reserves/{symbol}` — shares held against
 *   circulating supply for one asset, timestamped, with the custodians.
 *
 * Everything is cached in process with short TTLs, concurrency is bounded,
 * and a failure is a stated failure — never an old figure called fresh.
 */

import type { XStocksAsset } from "./representations.ts";

export const XSTOCKS_BASE_URL = "https://api.xstocks.fi/api/v2/public";
export const XSTOCKS_SOURCE = { id: "issuer-xstocks" as const, label: "xStocks · Backed Finance" };

const ASSETS_TTL_MS = 10 * 60 * 1000;
const QUOTE_TTL_MS = 30 * 1000;
const MULTIPLIER_TTL_MS = 10 * 60 * 1000;
const RESERVES_TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 100;
/** The pages asked for together: the catalogue ran to eleven on 2026-09-23. */
const PAGE_BATCH = 12;
/**
 * The ceiling of a read. It was ten and was a silent cut: on 2026-09-23 the
 * catalogue grew to 1,026 assets on eleven pages, the eleventh — TSLAx, NVDAx,
 * AAPLx among others — was never read, and those stocks left the universe
 * (`/app/stocks/NVDAx` answered 404, a plan could not name NVDAx). Past this
 * ceiling the read is refused, never cut (`RYN-API-CONTRACT-002`).
 */
export const XSTOCKS_MAX_PAGES = 50;
const MAX_CONCURRENT = 16;

export type XStocksFailure = Readonly<{
  ok: false;
  code: "HTTP" | "SHAPE" | "NETWORK" | "RATE_LIMITED";
  reason: string;
  /** The status behind an `HTTP` failure, so a reader can tell the issuer's own 5xx from a 404 for one symbol. */
  status?: number;
}>;

export type XStocksQuote = Readonly<{ ok: true; symbol: string; quote: number; currency: "USD"; fetchedAt: string }>;
export type XStocksMultiplier = Readonly<{ ok: true; symbol: string; current: number; pending: number | null; effectiveAt: string | null; reason: string | null; fetchedAt: string }>;
export type XStocksReserve = Readonly<{ symbol: string; sharesHeld: string; circulatingSupply: string; observedAt: string; custodians: readonly string[] }>;

type Cached<T> = { value: T; at: number };
const cache = new Map<string, Cached<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function cached<T>(key: string, ttlMs: number, read: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && now - hit.at < ttlMs) return Promise.resolve(hit.value);
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = read()
    .then((value) => {
      cache.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** For tests: forget everything, the quote circuit included. */
export function resetXStocksCaches(): void {
  cache.clear();
  inflight.clear();
  breaker.failures = 0;
  breaker.openedAt = null;
  breaker.probing = false;
}

/**
 * The quote endpoint's circuit (`RYN-STOCKS-RESILIENCE-001`, 2026-09-20).
 *
 * On 2026-09-19/20 `GET /assets/{symbol}/price-data` stopped answering —
 * every call ran to its timeout — while `/assets`, `/multiplier` and
 * `/proof-of-reserves` kept answering in about 150 ms. The universe asked for
 * the quote on every xStocks row, eight at a time, eight seconds each: a cold
 * build took 106 s, the platform's functions gave up at 30 and 60 s, and the
 * stock pages, `/api/stocks/universe` and `/stats` answered 504 for as long
 * as the endpoint stayed silent. Now an endpoint that has not answered
 * `QUOTE_BREAKER_THRESHOLD` times in a row is not asked again for
 * `QUOTE_BREAKER_OPEN_MS`; then one probe goes through and its answer
 * decides. Only a silence or a refusal that means the endpoint itself is
 * down counts — a timeout given the full window, a 5xx, a 429; a 404 or a
 * malformed body for one symbol is that symbol's answer, and a silence inside
 * a caller's shorter budget says nothing about the endpoint. A fresh cached
 * quote is served whatever the circuit says, and the circuit's own refusal is
 * never cached, so the first call after the window asks the issuer again.
 */
export const QUOTE_BREAKER_THRESHOLD = 3;
export const QUOTE_BREAKER_OPEN_MS = 60_000;
/**
 * The window one quote read is given; a shorter window is the caller's
 * budget. Five seconds: the issuer's other routes answer in about 150 ms on
 * an ordinary day, and a first batch of eight silent reads is what a cold
 * build pays before the circuit opens.
 */
export const QUOTE_TIMEOUT_MS = 5_000;
const breaker: { failures: number; openedAt: number | null; probing: boolean } = { failures: 0, openedAt: null, probing: false };
const CIRCUIT_OPEN: XStocksFailure = { ok: false, code: "NETWORK", reason: "The issuer's price service has not answered several times in a row; Ryntra asks again in a minute." };

export type QuoteCircuit = "closed" | "open" | "half-open";

/** Where the quote circuit stands now — for the asset page's own reading and for tests. */
export function xstocksQuoteCircuit(nowMs: number = Date.now()): QuoteCircuit {
  if (breaker.openedAt === null) return "closed";
  return nowMs - breaker.openedAt < QUOTE_BREAKER_OPEN_MS ? "open" : "half-open";
}

function circuitAllows(nowMs: number): boolean {
  if (breaker.openedAt === null) return true;
  if (nowMs - breaker.openedAt < QUOTE_BREAKER_OPEN_MS) return false;
  if (breaker.probing) return false;
  breaker.probing = true;
  return true;
}

function endpointDown(failure: XStocksFailure): boolean {
  return failure.code === "NETWORK" || failure.code === "RATE_LIMITED" || (failure.code === "HTTP" && (failure.status ?? 0) >= 500);
}

function noteQuoteOutcome(failure: XStocksFailure | null, counts: boolean, nowMs: number): void {
  breaker.probing = false;
  if (failure === null || !endpointDown(failure)) {
    breaker.failures = 0;
    breaker.openedAt = null;
    return;
  }
  if (!counts) return;
  breaker.failures += 1;
  if (breaker.failures >= QUOTE_BREAKER_THRESHOLD) breaker.openedAt = nowMs;
}

/** The cached answer for one symbol while it is fresh — a quote or the issuer's last failure — else null; nothing is asked. */
export function peekXStocksQuote(symbol: string, nowMs: number = Date.now()): XStocksQuote | XStocksFailure | null {
  const hit = cache.get(`quote:${symbol}`) as Cached<XStocksQuote | XStocksFailure> | undefined;
  return hit && nowMs - hit.at < QUOTE_TTL_MS ? hit.value : null;
}

let active = 0;
const queue: Array<() => void> = [];
async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    queue.shift()?.();
  }
}

async function getJson(path: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<{ ok: true; body: unknown } | XStocksFailure> {
  try {
    const response = await limited(() => fetchImpl(`${XSTOCKS_BASE_URL}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) }));
    if (response.status === 429) return { ok: false, code: "RATE_LIMITED", reason: "The issuer's API rate limit was reached." };
    if (!response.ok) return { ok: false, code: "HTTP", reason: `The issuer's API answered ${response.status}.`, status: response.status };
    return { ok: true, body: (await response.json()) as unknown };
  } catch (error) {
    return { ok: false, code: "NETWORK", reason: error instanceof Error ? error.message : String(error) };
  }
}

type Deps = Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date }>;

const str = (value: unknown, max = 200): string | null => (typeof value === "string" && value.length > 0 && value.length <= max ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** One catalogue node into the shape Ryntra keeps, or null when it has no Solana deployment. */
export function normalizeXStocksAsset(raw: unknown): XStocksAsset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const node = raw as Record<string, unknown>;
  const symbol = str(node.symbol, 24);
  const name = str(node.name);
  if (!symbol || !name) return null;
  const deployments = Array.isArray(node.deployments) ? node.deployments : [];
  const solana = deployments.find((entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).network === "Solana") as Record<string, unknown> | undefined;
  const solanaMint = solana ? str(solana.address, 44) : null;
  if (!solanaMint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaMint)) return null;
  const underlying = typeof node.underlying === "object" && node.underlying !== null ? (node.underlying as Record<string, unknown>) : {};
  const trading = typeof node.trading === "object" && node.trading !== null ? (node.trading as Record<string, unknown>) : null;
  const exchangeRaw = trading && typeof trading.exchange === "object" && trading.exchange !== null ? (trading.exchange as Record<string, unknown>) : null;
  const exchange = exchangeRaw && str(exchangeRaw.mic, 8) && str(exchangeRaw.name) && str(exchangeRaw.timezone, 64)
    ? { mic: str(exchangeRaw.mic, 8) as string, name: str(exchangeRaw.name) as string, timezone: str(exchangeRaw.timezone, 64) as string }
    : null;
  return {
    symbol,
    name,
    isin: str(node.isin, 16),
    underlying: {
      symbol: str(underlying.symbol, 16) ?? str(node.underlyingSymbol, 16) ?? symbol,
      isin: str(underlying.isin, 16) ?? str(node.underlyingIsin, 16),
      listingCountry: str(underlying.listingCountry, 4),
    },
    solanaMint,
    tradingHalted: bool(node.isTradingHalted) ?? false,
    trading: trading
      ? {
          currency: str(trading.currency, 8) ?? "USD",
          currentPeriod: str(trading.currentPeriod, 16),
          openNow: bool(trading.openNow),
          nextChangeAt: str(trading.nextChangeAt, 40),
          exchange,
        }
      : null,
    logo: str(node.logo, 400),
  };
}

/**
 * The whole catalogue, every page, cached — the pages asked for together.
 *
 * The API caps a page at a hundred nodes whatever `limit` says, and reading
 * the pages one after another cost seven seconds of every cold build, so a
 * batch of pages is asked for at once; the first page that says
 * `hasNextPage: false` ends the read, a page past the end carries no nodes,
 * and a catalogue longer than the batch is read on — never cut.
 */
export function readXStocksAssets(deps: Deps = {}): Promise<{ ok: true; assets: readonly XStocksAsset[]; fetchedAt: string } | XStocksFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return cached("assets", ASSETS_TTL_MS, async () => {
    const assets: XStocksAsset[] = [];
    const readPage = async (page: number) => {
      /* Twenty seconds: the pages are asked for together behind the page's
         own skeleton, and a slow issuer must not turn into a universe
         without its listing (2026-09-15: a 12-second timeout did). */
      const read = await getJson(`/assets?limit=${PAGE_SIZE}&page=${page}`, fetchImpl, deps.timeoutMs ?? 20_000);
      if (!read.ok) return read;
      const body = read.body as { nodes?: unknown; page?: { hasNextPage?: unknown } };
      if (!Array.isArray(body.nodes)) return { ok: false as const, code: "SHAPE" as const, reason: "The catalogue answered without a nodes list." };
      return { ok: true as const, nodes: body.nodes as unknown[], hasNext: body.page?.hasNextPage === true };
    };
    const pages = await Promise.all(Array.from({ length: Math.min(PAGE_BATCH, XSTOCKS_MAX_PAGES) }, (_, page) => readPage(page)));
    /* A catalogue longer than one batch is read on, a batch at a time, until a page says it is the last. */
    while (pages.length < XSTOCKS_MAX_PAGES) {
      const last = pages[pages.length - 1];
      if (!last.ok || !last.hasNext) break;
      const start = pages.length;
      pages.push(...(await Promise.all(Array.from({ length: Math.min(PAGE_BATCH, XSTOCKS_MAX_PAGES - start) }, (_, index) => readPage(start + index)))));
    }
    let ended = false;
    for (const page of pages) {
      if (!page.ok) return page;
      for (const node of page.nodes) {
        const asset = normalizeXStocksAsset(node);
        if (asset) assets.push(asset);
      }
      if (!page.hasNext) {
        ended = true;
        break;
      }
    }
    if (!ended) return { ok: false, code: "SHAPE", reason: `The catalogue runs past ${XSTOCKS_MAX_PAGES} pages; a cut listing is not the listing.` };
    return { ok: true, assets, fetchedAt: (deps.now ?? (() => new Date()))().toISOString() };
  });
}

/**
 * The issuer's reference quote for one symbol, cached for thirty seconds. A
 * fresh cached answer is served first; then the circuit above decides whether
 * the issuer is asked at all; `timeoutMs` below the full window is the
 * caller's own budget, and its silence is not counted against the issuer.
 */
export function readXStocksQuote(symbol: string, deps: Deps = {}): Promise<XStocksQuote | XStocksFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const clock = deps.now ?? (() => new Date());
  const fresh = peekXStocksQuote(symbol);
  if (fresh) return Promise.resolve(fresh);
  if (!circuitAllows(clock().getTime())) return Promise.resolve(CIRCUIT_OPEN);
  const timeoutMs = deps.timeoutMs ?? QUOTE_TIMEOUT_MS;
  return cached(`quote:${symbol}`, QUOTE_TTL_MS, async () => {
    const read = await getJson(`/assets/${encodeURIComponent(symbol)}/price-data`, fetchImpl, timeoutMs);
    noteQuoteOutcome(read.ok ? null : read, timeoutMs >= QUOTE_TIMEOUT_MS, clock().getTime());
    if (!read.ok) return read;
    const quote = (read.body as { quote?: unknown }).quote;
    if (typeof quote !== "number" || !Number.isFinite(quote) || quote <= 0) return { ok: false, code: "SHAPE", reason: "The issuer answered without a positive quote." };
    return { ok: true, symbol, quote, currency: "USD", fetchedAt: (deps.now ?? (() => new Date()))().toISOString() };
  });
}

/** The current and pending multiplier the issuer publishes for the Solana deployment. */
export function readXStocksMultiplier(symbol: string, deps: Deps = {}): Promise<XStocksMultiplier | XStocksFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return cached(`multiplier:${symbol}`, MULTIPLIER_TTL_MS, async () => {
    const read = await getJson(`/assets/${encodeURIComponent(symbol)}/multiplier?network=Solana`, fetchImpl, deps.timeoutMs ?? 8_000);
    if (!read.ok) return read;
    const body = read.body as Record<string, unknown>;
    const current = body.currentMultiplier;
    if (typeof current !== "number" || !Number.isFinite(current) || current <= 0) return { ok: false, code: "SHAPE", reason: "The issuer answered without a current multiplier." };
    const pendingRaw = body.newMultiplier;
    const activation = body.activationDateTime;
    const pending = typeof pendingRaw === "number" && Number.isFinite(pendingRaw) && pendingRaw > 0 ? pendingRaw : null;
    let effectiveAt: string | null = null;
    if (pending !== null) {
      if (typeof activation === "number" && activation > 0) effectiveAt = new Date(activation > 1e12 ? activation : activation * 1000).toISOString();
      else if (typeof activation === "string" && Number.isFinite(Date.parse(activation))) effectiveAt = new Date(activation).toISOString();
    }
    return { ok: true, symbol, current, pending, effectiveAt, reason: str(body.reason, 120), fetchedAt: (deps.now ?? (() => new Date()))().toISOString() };
  });
}

/** Proof of reserves for one asset — `GET /proof-of-reserves/{symbol}` — cached. */
export function readXStocksReserve(symbol: string, deps: Deps = {}): Promise<{ ok: true; reserve: XStocksReserve; fetchedAt: string } | XStocksFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return cached(`reserve:${symbol}`, RESERVES_TTL_MS, async () => {
    const read = await getJson(`/proof-of-reserves/${encodeURIComponent(symbol)}`, fetchImpl, deps.timeoutMs ?? 8_000);
    if (!read.ok) return read;
    const reserve = normalizeXStocksReserve(read.body);
    if (!reserve) return { ok: false, code: "SHAPE", reason: "The issuer answered without a reserves record." };
    return { ok: true, reserve, fetchedAt: (deps.now ?? (() => new Date()))().toISOString() };
  });
}

export function normalizeXStocksReserve(raw: unknown): XStocksReserve | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const symbol = str(row.symbol, 24);
  const sharesHeld = str(row.sharesHeld, 64);
  const circulating = str(row.circulatingSupply, 64);
  const observedAt = str(row.timestamp, 40);
  if (!symbol || !sharesHeld || !circulating || !observedAt) return null;
  const custodians = Array.isArray(row.holdings)
    ? row.holdings.map((holding) => (typeof holding === "object" && holding !== null ? str((holding as Record<string, unknown>).provider, 64) : null)).filter((name): name is string => name !== null)
    : [];
  return { symbol, sharesHeld, circulatingSupply: circulating, observedAt, custodians: [...new Set(custodians)] };
}
