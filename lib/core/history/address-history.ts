/**
 * CITY-245 — an address's history from the chain through Helius's Parsed Events Scan: one request that Helius filters
 * on its side, instead of «a page of signatures → every transaction → our own filter».
 *
 * It only finds signatures (`returnShape: "signatures"`): which transactions of the address match. Reading them,
 * decoding them and every figure of money stay with our own decoders — nothing here prices, counts or attributes.
 *
 * - Mainnet only, and only where the node is Helius with its key: the scan is asked of the same host and the same key as
 *   the node itself (`scanEndpointOf`). A devnet node, another provider or a node without a key has no scan; its caller
 *   pages `getSignaturesForAddress` as before.
 * - A listing is given only whole: either `limit` signatures, newest first, or every match back to the start of the
 *   address's history. A scan stopped by its budget answers an empty page with a cursor — that is «read on», never «no
 *   more» — and is followed. A scan that runs out of its calls or its time before either end throws, so the caller falls
 *   back rather than taking a short list for a whole one.
 * - Failed transactions are left out by default (`status: "succeeded"`): the pages that read them skip them anyway.
 *
 * Reads only: it holds no key of its own, signs nothing and sends nothing. The key travels inside the node's URL and is
 * never printed: errors and the host name say the host alone.
 */

export const SCAN_HOST = "mainnet.helius-rpc.com";
export const SCAN_PATH = "/v1/parsed-events/scan";

/** How long one request may take: a scan answers in a fraction of a second, a stuck one is a failed one. */
const REQUEST_TIMEOUT_MS = 10_000;
/** Pages of history one listing may follow: a page scans up to ten thousand transactions, so this is a long history. */
const MAX_CALLS = 12;
/** The most history pages one call scans (Helius's own ceiling and default): 10 credits a call plus 1 a page. */
const MAX_SCANNED = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/**
 * After a scan fails — a refusal, a timeout, a history longer than a listing follows — the scan of that node rests this
 * long, and its callers page the node at once rather than spend their time on it again.
 */
export const SCAN_PAUSE_MS = 60_000;

export type ScanScope = "address" | "transaction";
export type ScanMatch = Readonly<{
  programs?: readonly Readonly<{ programId: string; instructions?: readonly string[]; scope?: ScanScope }>[];
  mints?: readonly Readonly<{ mint: string; scope?: ScanScope }>[];
}>;

/** A signature as a page of `getSignaturesForAddress` gives it — the shape the readers already page through. */
export type ListedSignature = Readonly<{ signature: string; slot: number; blockTime: number | null; err: null; memo: null }>;

export type ScanQuery = Readonly<{
  address: string;
  match: ScanMatch;
  /** Newest first, older than this signature. */
  before?: string;
  /** The most signatures given; fewer means the history's start was reached. */
  limit: number;
  /** Unix seconds. */
  time?: Readonly<{ gte?: number; lt?: number; lte?: number; gt?: number }>;
  status?: "succeeded" | "failed" | "any";
  tokenAccounts?: "none" | "balanceChanged" | "all";
  /** Absolute time (ms, `Date.now()` clock) by which the listing is whole or given up: no call starts or waits past it. */
  until?: number;
}>;

export type ScanListing = Readonly<{
  entries: readonly ListedSignature[];
  /** The listing reached the start of the address's history (or of its window): nothing older matches. */
  whole: boolean;
  calls: number;
  scanned: number;
  credits: number;
}>;

export type AddressHistory = Readonly<{
  /** The scan's host — never its URL, which carries the key. */
  host: string;
  signatures(query: ScanQuery): Promise<ScanListing>;
}>;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Thrown when the scan cannot give a whole listing: the caller pages the node instead. */
export class ScanUnavailable extends Error {
  readonly status: number | null;
  /** Whether the scan itself failed (and rests), rather than the caller's time running out before a call. */
  readonly rests: boolean;
  constructor(message: string, status: number | null = null, rests = true) {
    super(message);
    this.name = "ScanUnavailable";
    this.status = status;
    this.rests = rests;
  }
}

/**
 * The scan's URL for a node's URL, or null when the node is not Helius on mainnet with its key. The key is the node's
 * own `api-key`: nothing new is configured and nothing is kept apart from the node's URL.
 */
export function scanEndpointOf(rpcUrl: string | null | undefined): string | null {
  if (!rpcUrl) return null;
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== SCAN_HOST) return null;
  const key = url.searchParams.get("api-key")?.trim();
  if (!key || !/^[A-Za-z0-9-]{8,128}$/u.test(key)) return null;
  return `https://${SCAN_HOST}${SCAN_PATH}?api-key=${encodeURIComponent(key)}`;
}

/** One request's body: strict on Helius's side, so only the fields it knows. */
export function scanBody(query: ScanQuery, paginationToken: string | null): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  if (query.match.programs?.length) match.programs = query.match.programs.map((program) => ({ ...program, ...(program.instructions ? { instructions: [...program.instructions] } : {}) }));
  if (query.match.mints?.length) match.mints = query.match.mints.map((mint) => ({ ...mint }));
  return {
    address: query.address,
    match,
    returnShape: "signatures",
    commitment: "confirmed",
    sortOrder: "desc",
    status: query.status ?? "succeeded",
    budget: { maxScannedTransactions: MAX_SCANNED },
    ...(query.tokenAccounts ? { tokenAccounts: query.tokenAccounts } : {}),
    ...(query.time ? { time: { ...query.time } } : {}),
    /* A cursor resumes where the scan stopped, below the first call's bound: it is sent alone. */
    ...(paginationToken ? { paginationToken } : query.before ? { beforeSignature: query.before } : {}),
  };
}

type ScanAnswer = Readonly<{
  data?: readonly Readonly<{ signature?: unknown; slot?: unknown; blockTime?: unknown }>[];
  paginationToken?: unknown;
  scan?: Readonly<{ stoppedOn?: unknown; scannedTransactions?: unknown; creditsCharged?: unknown }>;
}>;

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/u;

/** A page's matches in the readers' shape; a malformed one makes the page unreadable rather than shorter. */
export function entriesOf(answer: ScanAnswer): ListedSignature[] {
  if (answer.data !== undefined && !Array.isArray(answer.data)) throw new ScanUnavailable("The scan answered a page without a list.");
  return (answer.data ?? []).map((item) => {
    if (typeof item?.signature !== "string" || !SIGNATURE.test(item.signature) || typeof item.slot !== "number" || !Number.isInteger(item.slot)) throw new ScanUnavailable("The scan answered a match without a signature or a slot.");
    const blockTime = typeof item.blockTime === "number" && Number.isFinite(item.blockTime) ? item.blockTime : null;
    return { signature: item.signature, slot: item.slot, blockTime, err: null, memo: null };
  });
}

async function readBounded(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new ScanUnavailable(`${SCAN_HOST} answered more than a page may hold.`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new ScanUnavailable(`${SCAN_HOST} answered more than a page may hold.`);
  return text;
}

/** Per process: what the scan cost and how often it stood in for the node — for the pages that check it. */
const STATS = { calls: 0, credits: 0, scanned: 0, listings: 0, failures: 0 };
export function scanStats(): Readonly<typeof STATS> {
  return { ...STATS };
}

/**
 * The scan of one node's URL, or null where there is none (`scanEndpointOf`). `fetch` and `now` are for the tests.
 */
export function createAddressHistory(rpcUrl: string | null | undefined, deps: Readonly<{ fetch?: Fetch; now?: () => number }> = {}): AddressHistory | null {
  const endpoint = scanEndpointOf(rpcUrl);
  if (!endpoint) return null;
  const send = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const now = deps.now ?? Date.now;

  let pausedUntil = 0;

  async function call(body: Record<string, unknown>, until: number | undefined): Promise<ScanAnswer> {
    const wait = Math.min(REQUEST_TIMEOUT_MS, until === undefined ? REQUEST_TIMEOUT_MS : until - now());
    if (wait <= 0) throw new ScanUnavailable("The scan's time ran out before the listing was whole.", null, false);
    let response: Response;
    try {
      response = await send(endpoint!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(wait),
        cache: "no-store",
      });
    } catch {
      /* The fetch's own message can carry the URL, and so the key: the host alone. A wait the caller's time cut short is
         the caller's, not the scan's: it does not rest the scan for everyone else. */
      throw new ScanUnavailable(`${SCAN_HOST} did not answer the scan.`, null, wait >= REQUEST_TIMEOUT_MS);
    }
    const text = await readBounded(response);
    if (!response.ok) throw new ScanUnavailable(`${SCAN_HOST} answered HTTP ${response.status} to the scan.`, response.status);
    try {
      return JSON.parse(text) as ScanAnswer;
    } catch {
      throw new ScanUnavailable(`${SCAN_HOST} answered the scan with something other than JSON.`);
    }
  }

  async function signatures(query: ScanQuery): Promise<ScanListing> {
    if (!(Number.isInteger(query.limit) && query.limit > 0)) throw new RangeError("A listing's limit is a positive whole number.");
    const entries: ListedSignature[] = [];
    const seen = new Set<string>();
    let token: string | null = null;
    let scanned = 0;
    let credits = 0;
    for (let calls = 1; calls <= MAX_CALLS; calls += 1) {
      if (query.until !== undefined && now() >= query.until) throw new ScanUnavailable("The scan's time ran out before the listing was whole.", null, false);
      const answer = await call(scanBody(query, token), query.until);
      const page = entriesOf(answer);
      const pageScanned = typeof answer.scan?.scannedTransactions === "number" ? answer.scan.scannedTransactions : 0;
      const pageCredits = typeof answer.scan?.creditsCharged === "number" ? answer.scan.creditsCharged : 0;
      scanned += pageScanned;
      credits += pageCredits;
      STATS.calls += 1;
      STATS.scanned += pageScanned;
      STATS.credits += pageCredits;
      for (const entry of page) {
        if (seen.has(entry.signature)) continue;
        seen.add(entry.signature);
        entries.push(entry);
      }
      const next = typeof answer.paginationToken === "string" && answer.paginationToken.length > 0 ? answer.paginationToken : null;
      if (entries.length >= query.limit) {
        STATS.listings += 1;
        return { entries: entries.slice(0, query.limit), whole: false, calls, scanned, credits };
      }
      /* No cursor: the scan reached the end of the history or of its window. An empty page with one is «read on». */
      if (next === null) {
        STATS.listings += 1;
        return { entries, whole: true, calls, scanned, credits };
      }
      if (next === token) throw new ScanUnavailable("The scan answered the same cursor twice.");
      token = next;
    }
    /* One busy address says nothing of the others: the scan does not rest for it. */
    throw new ScanUnavailable("The scan's history was longer than one listing follows.", null, false);
  }

  return {
    host: SCAN_HOST,
    signatures: (query) => {
      if (now() < pausedUntil) return Promise.reject(new ScanUnavailable("The scan rests after a failure."));
      return signatures(query).catch((failure: unknown) => {
        STATS.failures += 1;
        /* A refusal of this one query (400) says nothing of the next; anything else rests the scan a while. */
        if (!(failure instanceof ScanUnavailable && (failure.status === 400 || !failure.rests)) && !(failure instanceof RangeError)) pausedUntil = now() + SCAN_PAUSE_MS;
        throw failure;
      });
    },
  };
}

/* One per node URL and process: the scan itself keeps nothing but its counters. */
const HISTORIES = new Map<string, AddressHistory | null>();
export function addressHistoryOf(rpcUrl: string | null | undefined): AddressHistory | null {
  if (!rpcUrl) return null;
  if (!HISTORIES.has(rpcUrl)) HISTORIES.set(rpcUrl, createAddressHistory(rpcUrl));
  return HISTORIES.get(rpcUrl) ?? null;
}
