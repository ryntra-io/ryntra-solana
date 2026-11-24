/**
 * The relay's strict rules, kept where its Helius key is a paid one (which network — `strictRelay` in
 * `relay.ts`: mainnet): there the relay is no open RPC with Ryntra's key, only the private balance's own calls pass.
 * Devnet keeps the open rules of `relay.ts` (`rpcAllowed`), as before.
 *
 * On mainnet, besides the page's session token (`relay-session.server.ts`, a proven wallet's only) and the shared limit:
 * - **the bytes that go are the bytes that were read**: an RPC body is one JSON-RPC 2.0 call —
 *   `jsonrpc`, `id`, `method`, `params` and no other key — and what reaches Helius is that call rebuilt from what was
 *   checked (`strictRpcCheck`), never the body as it came: a key twice, a `Method` beside `method`, an option twice — none
 *   of it goes on. An indexer query likewise (`strictIndexerBody`). One call per body: the SDK sends no batches.
 * - the prover and the indexer — the SDK's own routes only (`sprRouteRefusal`): the indexer's seven methods, the
 *   attestation, the proving keys, the health check and a circuit's proof, its indexed proof and its status — each with
 *   its own HTTP method and its own query, nothing else under `/v1/spr`. A body is at most
 *   `MAX_STRICT_BODY_BYTES`, a proof's encrypted inputs excepted (`strictBodyCap`).
 * - `sendTransaction` — only a transaction that calls the ring (the pool or the registry), with nothing beside it but the
 *   programs the SDK's own transactions call (system, token, token-2022, associated token: `SDK_HELPERS`, read from the
 *   bundle) and the compute budget a wallet may add when it signs (`WALLET_HELPERS`). Or the one plain transfer a link
 *   needs for its own network fees (`flows.ts`, `topUp`): a single SOL transfer of at most `LINK_FEE_LAMPORTS`, which a
 *   wallet may give a priority fee. The transaction is read from its bytes (`relay-tx.ts`); base64 only, never with
 *   preflight skipped, so the chain's own simulation refuses a broken one before it is sent. Only the instructions at the
 *   top are read: what the ring's program calls in turn is that program's own.
 * - `getAccountInfo` / `getMultipleAccounts` — base64 reads only, and the answer is handed back only when every account
 *   it holds belongs to the ring's programs; an account of any other program is refused, so the relay is no window on
 *   the chain (`answerAllowed`). An account that does not exist reads as none, as the SDK needs.
 * - `getProgramAccounts` — the one read the SDK makes, with the SDK's own filters (`SDK_PROGRAM_READ`): the pool's
 *   asset registry entries, by their size and their first byte. Never a whole program, never another filter.
 * - `getBalance`, `getSignatureStatuses`, `getLatestBlockhash`, `getSlot` — as small as RPC gets: a number, a status, a
 *   blockhash. A link's own address and an invoice's address are not the ring's, so a balance is read for any address;
 *   statuses are capped at a handful of signatures, and never searched for in the chain's history.
 * - every method's options are the ones the SDK sends (`CALL_OPTIONS`), with the values it sends; any other option, or an
 *   argument past them, is refused.
 */

import { LINK_FEE_LAMPORTS } from './network.ts';
import { MAX_BODY_BYTES, RING_PROGRAMS, RPC_METHODS } from './relay.ts';
import { topInstructions, type TopInstruction } from './relay-tx.ts';

export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** The ring's pool — the program the SDK's one `getProgramAccounts` reads (`PC` in the bundle). */
export const RING_POOL_PROGRAM = 'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW';

/**
 * The programs the SDK's own transactions call beside the ring — the four the bundle names, and nothing more. Never alone:
 * a transaction must call the ring.
 */
export const SDK_HELPERS: ReadonlySet<string> = new Set([SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ASSOCIATED_TOKEN_PROGRAM]);

/**
 * What a wallet may add to a transaction it is asked to sign: the compute budget — its priority fee and its limit. The SDK
 * itself sets both in a v1 transaction's config and never calls the program, but a wallet may, and the person's own
 * transaction is not refused for it.
 */
export const WALLET_HELPERS: ReadonlySet<string> = new Set([COMPUTE_BUDGET_PROGRAM]);

/** The programs a transaction the mainnet relay carries may call: the ring's, `SDK_HELPERS` and `WALLET_HELPERS`. */
export const SDK_PROGRAMS: ReadonlySet<string> = new Set([...RING_PROGRAMS, ...SDK_HELPERS, ...WALLET_HELPERS]);

/**
 * The SDK's one program read: `getProgramAccounts(PC, { filters: [{ dataSize: 48n }, { memcmp: { offset: 0n, encoding:
 * "base64", bytes: <ck.splAssetRegistry = 5> } }] })` — the pool's asset registry entries. Kit sends the bigints as
 * numbers; byte 5 in base64 is `BQ==`.
 */
export const SDK_PROGRAM_READ = Object.freeze({ program: RING_POOL_PROGRAM, dataSize: 48, offset: 0, bytes: 'BQ==' });

/** The indexer's methods the SDK calls: `POST <indexer>/<method>`, a JSON-RPC body (the bundle's `bR` … `ZR`). */
export const SDK_INDEXER_METHODS: ReadonlySet<string> = new Set([
  'getEncryptedUtxosByTags',
  'getShieldedTransactionsByTags',
  'getShieldedTransactionsByNullifiers',
  'getShieldedTransactionsBySignature',
  'getMerkleProofs',
  'getNonInclusionProofs',
  'getUserRecords',
]);

/**
 * The largest body the mainnet relay takes for an RPC call or an indexer query: the SDK's are a few kilobytes (a signed
 * transaction is at most 1,232 bytes). A proof's encrypted inputs keep `MAX_BODY_BYTES`.
 */
export const MAX_STRICT_BODY_BYTES = 64 * 1024;

/** The calls one mainnet RPC body may carry: one — the SDK's kit sends every call on its own, never a batch. */
export const STRICT_MAX_BATCH = 1;

/** A circuit's name, as the SDK's proving keys name them (`merge_8_1`, `transfer_ring_2_2`, `transfer_confidential_eddsa_4_8`…). */
const CIRCUIT = /^(?:merge|transfer)(?:_[a-z]{1,16}){0,4}_\d{1,3}_\d{1,3}$/;

type SprRoute = Readonly<{ method: 'GET' | 'POST'; query: readonly string[] }>;

/** The prover's routes the SDK takes (`/prove`, `/indexed`, `/status`, `/health`, `/proving-keys`, `/attestation`). */
function sprRoute(path: readonly string[]): SprRoute | null {
  if (path.length === 1) {
    if (SDK_INDEXER_METHODS.has(path[0])) return { method: 'POST', query: [] };
    if (path[0] === 'attestation') return { method: 'GET', query: ['nonce'] };
    if (path[0] === 'health' || path[0] === 'proving-keys') return { method: 'GET', query: [] };
    return null;
  }
  if (path[0] !== 'prove' || path.length > 3 || !CIRCUIT.test(path[1] ?? '')) return null;
  if (path.length === 2) return { method: 'POST', query: [] };
  if (path[2] === 'indexed') return { method: 'POST', query: [] };
  if (path[2] === 'status') return { method: 'GET', query: ['jobId'] };
  return null;
}

/**
 * Why a call under `/v1/spr` is refused on mainnet; null — it is one of the SDK's own routes, with its own HTTP method and
 * exactly its own query (each name once). Anything else Helius serves there stays out of reach of Ryntra's key.
 */
export function sprRouteRefusal(method: string, path: readonly string[], search: string): 'route' | 'method' | 'query' | null {
  const route = sprRoute(path);
  if (!route) return 'route';
  if (method !== route.method) return 'method';
  const query = new URLSearchParams(search);
  const names = [...query.keys()];
  if (names.length !== route.query.length || !route.query.every((name) => query.getAll(name).length === 1)) return 'query';
  return null;
}

/** Whether a call asks the prover's enclave for a proof — its own work, up to a minute each, with its own ceiling. */
export function isProofCall(method: string, target: string, path: readonly string[]): boolean {
  return method === 'POST' && target === 'spr' && path[0] === 'prove';
}

/** The largest body a strict call may carry: a proof's encrypted inputs up to `MAX_BODY_BYTES`, anything else less. */
export function strictBodyCap(target: string, path: readonly string[]): number {
  return target === 'spr' && path[0] === 'prove' ? MAX_BODY_BYTES : MAX_STRICT_BODY_BYTES;
}

/** The most accounts one `getMultipleAccounts` reads, and the most signatures one `getSignatureStatuses` asks of. */
export const MAX_ACCOUNTS = 16;
export const MAX_SIGNATURES = 8;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type TxVerdict = 'ring' | 'link-fee' | 'foreign' | 'unreadable';

/** The System Program's `Transfer`: its index 2 as a u32, then the lamports as a u64, little-endian. */
function transferLamports(instruction: TopInstruction): bigint | null {
  const { program, data } = instruction;
  if (program !== SYSTEM_PROGRAM || data.length !== 12) return null;
  if (data[0] !== 2 || data[1] !== 0 || data[2] !== 0 || data[3] !== 0) return null;
  let lamports = 0n;
  for (let i = 11; i >= 4; i -= 1) lamports = (lamports << 8n) | BigInt(data[i]);
  return lamports;
}

/** What a signed transaction is to the mainnet relay: the ring's, a link's fee top-up, or not one it carries. */
export function transactionVerdict(wire: Uint8Array): TxVerdict {
  const instructions = topInstructions(wire);
  if (!instructions || instructions.length === 0) return 'unreadable';
  const programs = instructions.map((instruction) => instruction.program);
  if (programs.some((program) => RING_PROGRAMS.has(program)) && programs.every((program) => SDK_PROGRAMS.has(program))) return 'ring';
  const rest = instructions.filter((instruction) => instruction.program !== COMPUTE_BUDGET_PROGRAM);
  const lamports = rest.length === 1 ? transferLamports(rest[0]) : null;
  if (lamports !== null && lamports > 0n && lamports <= LINK_FEE_LAMPORTS) return 'link-fee';
  return 'foreign';
}

function decodeBase64(text: string): Uint8Array | null {
  if (!text || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

type Options = Readonly<Record<string, unknown>>;

function optionsOf(value: unknown): Options {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Options) : {};
}

/** Whether an object holds these keys and no others. */
function onlyKeys(value: Options, allowed: readonly string[]): boolean {
  return Object.keys(value).every((name) => allowed.includes(name));
}

type OptionRule = (value: unknown) => boolean;
const commitment: OptionRule = (value) => value === 'processed' || value === 'confirmed' || value === 'finalized';
const slot: OptionRule = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const base64: OptionRule = (value) => value === 'base64';
/** Checked whole by `sdkProgramRead`. */
const programFilters: OptionRule = () => true;

/**
 * Each method's options as the SDK sends them — kit adds `commitment` (`preflightCommitment` for a send), `flows.ts` sends
 * `{ encoding: "base64", preflightCommitment }` — at the place they stand among its arguments, and nothing past them. A
 * name not here, or a value the SDK never sends, is refused: `searchTransactionHistory` among them, which turns a status
 * into a search of the chain's history.
 */
export const CALL_OPTIONS: Readonly<Record<string, Readonly<{ at: number; rules: Readonly<Record<string, OptionRule>> }>>> = Object.freeze({
  getLatestBlockhash: { at: 0, rules: { commitment, minContextSlot: slot } },
  getSlot: { at: 0, rules: { commitment, minContextSlot: slot } },
  getBalance: { at: 1, rules: { commitment, minContextSlot: slot } },
  getSignatureStatuses: { at: 1, rules: { searchTransactionHistory: (value: unknown) => value === false } },
  getAccountInfo: { at: 1, rules: { commitment, encoding: base64, minContextSlot: slot } },
  getMultipleAccounts: { at: 1, rules: { commitment, encoding: base64, minContextSlot: slot } },
  getProgramAccounts: { at: 1, rules: { commitment, encoding: base64, filters: programFilters, minContextSlot: slot } },
  sendTransaction: { at: 1, rules: { encoding: base64, preflightCommitment: commitment, skipPreflight: (value: unknown) => value === false, minContextSlot: slot } },
});

/** Why a call's arguments past its own are refused, or its options: a name or a value the SDK never sends; null — they pass. */
function optionsRefusal(method: string, list: readonly unknown[]): string | null {
  const shape = CALL_OPTIONS[method];
  if (list.length > shape.at + 1) return 'params';
  const options = list[shape.at];
  if (options === undefined) return null;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) return 'options';
  for (const [name, value] of Object.entries(options)) {
    const rule = Object.hasOwn(shape.rules, name) ? shape.rules[name] : undefined;
    if (!rule || !rule(value)) return 'options';
  }
  return null;
}

/** Whether a `getProgramAccounts` call is the SDK's own read (`SDK_PROGRAM_READ`): its program, its two filters, base64. */
function sdkProgramRead(list: readonly unknown[]): boolean {
  if (list.length > 2 || list[0] !== SDK_PROGRAM_READ.program) return false;
  const options = optionsOf(list[1]);
  if (options.encoding !== 'base64') return false;
  const filters = options.filters;
  if (!Array.isArray(filters) || filters.length !== 2) return false;
  const size = filters.find((filter) => 'dataSize' in optionsOf(filter));
  const match = filters.find((filter) => 'memcmp' in optionsOf(filter));
  if (!size || !match || size === match) return false;
  if (!onlyKeys(optionsOf(size), ['dataSize']) || optionsOf(size).dataSize !== SDK_PROGRAM_READ.dataSize) return false;
  if (!onlyKeys(optionsOf(match), ['memcmp'])) return false;
  const memcmp = optionsOf(optionsOf(match).memcmp);
  return onlyKeys(memcmp, ['offset', 'encoding', 'bytes']) && memcmp.offset === SDK_PROGRAM_READ.offset && memcmp.encoding === 'base64' && memcmp.bytes === SDK_PROGRAM_READ.bytes;
}

/** Why a call's method and arguments are refused on mainnet, method by method; null — they pass. */
function argumentsRefusal(method: string, list: readonly unknown[]): string | null {
  const options = optionsOf(list[1]);
  switch (method) {
    case 'getLatestBlockhash':
    case 'getSlot':
      return null;
    case 'getBalance':
      return typeof list[0] === 'string' && ADDRESS.test(list[0]) ? null : 'address';
    case 'getSignatureStatuses': {
      const signatures = list[0];
      const fine = Array.isArray(signatures) && signatures.length > 0 && signatures.length <= MAX_SIGNATURES && signatures.every((s) => typeof s === 'string' && SIGNATURE.test(s));
      return fine ? null : 'signatures';
    }
    case 'getAccountInfo':
      if (typeof list[0] !== 'string' || !ADDRESS.test(list[0])) return 'address';
      return options.encoding === 'base64' ? null : 'encoding';
    case 'getMultipleAccounts': {
      const addresses = list[0];
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.length > MAX_ACCOUNTS) return 'addresses';
      if (!addresses.every((a) => typeof a === 'string' && ADDRESS.test(a))) return 'addresses';
      return options.encoding === 'base64' ? null : 'encoding';
    }
    case 'getProgramAccounts':
      if (list[0] !== SDK_PROGRAM_READ.program) return 'program';
      return sdkProgramRead(list) ? null : 'filters';
    case 'sendTransaction': {
      if (typeof list[0] !== 'string' || options.encoding !== 'base64') return 'encoding';
      if (options.skipPreflight === true) return 'preflight';
      const wire = decodeBase64(list[0]);
      if (!wire) return 'encoding';
      const verdict = transactionVerdict(wire);
      return verdict === 'ring' || verdict === 'link-fee' ? null : verdict;
    }
    default:
      return 'method';
  }
}

/** Why a call is refused on mainnet — its method, its arguments, its options; null — it passes. */
export function strictCallRefusal(call: unknown): string | null {
  if (typeof call !== 'object' || call === null || Array.isArray(call)) return 'not a call';
  const { method, params } = call as { method?: unknown; params?: unknown };
  if (typeof method !== 'string' || !RPC_METHODS.has(method) || !Object.hasOwn(CALL_OPTIONS, method)) return 'method';
  if (params !== undefined && !Array.isArray(params)) return 'params';
  const list: readonly unknown[] = params ?? [];
  return argumentsRefusal(method, list) ?? optionsRefusal(method, list);
}

/** The keys of a JSON-RPC 2.0 call; on mainnet nothing else rides beside them — not even the same name in other letters. */
const ENVELOPE: readonly string[] = ['jsonrpc', 'id', 'method', 'params'];

/** A call's id as the SDK sends it: a short string or a whole number. */
function validId(id: unknown): boolean {
  return (typeof id === 'string' && id.length <= 64) || (typeof id === 'number' && Number.isSafeInteger(id));
}

/** Why a call's envelope is refused: another key beside the four, another version, no id; null — it passes. */
function envelopeRefusal(call: unknown): string | null {
  if (typeof call !== 'object' || call === null || Array.isArray(call)) return 'not a call';
  const fields = call as Record<string, unknown>;
  if (!Object.keys(fields).every((name) => ENVELOPE.includes(name))) return 'envelope';
  if (fields.jsonrpc !== '2.0') return 'envelope';
  return validId(fields.id) ? null : 'id';
}

/** A checked call, rebuilt from the values that were checked: nothing else, and every key once. */
function rebuilt(call: unknown): Readonly<Record<string, unknown>> {
  const { id, method, params } = call as { id: unknown; method: unknown; params?: unknown };
  return params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params };
}

export type StrictCheck =
  /** `calls` — the rebuilt calls; `body` — the bytes that go to Helius: those calls, in the shape they came (one or a list). */
  | Readonly<{ ok: true; calls: readonly Readonly<Record<string, unknown>>[]; body: string }>
  | Readonly<{ ok: false; why: string }>;

/**
 * Whether a JSON-RPC body passes the mainnet rules, and the body that goes on if it does: one call (or a list of one, as
 * it came), its envelope the four keys of JSON-RPC 2.0, its method, arguments and options the SDK's — rebuilt from what
 * was read, so a key twice or a key in other letters never reaches Helius.
 */
export function strictRpcCheck(body: unknown): StrictCheck {
  const list = Array.isArray(body);
  const calls: readonly unknown[] = list ? (body as unknown[]) : [body];
  if (calls.length === 0 || calls.length > STRICT_MAX_BATCH) return { ok: false, why: 'batch' };
  for (const call of calls) {
    const why = envelopeRefusal(call) ?? strictCallRefusal(call);
    if (why) return { ok: false, why };
  }
  const clean = calls.map(rebuilt);
  return { ok: true, calls: clean, body: JSON.stringify(list ? clean : clean[0]) };
}

/** The paging the SDK adds to a list query (`jR` in the bundle): a page's token, its size, a slot range, a slot floor. */
const INDEXER_PAGE = ['paginationToken', 'limit', 'filters', 'minContextSlot'] as const;

/**
 * Each indexer method's params as the SDK's own encoders build them (`a7`, `uR`, `KR`, `dR`, `vR`, `GR` in the bundle):
 * the names it always sends and the ones it may. Exactly these names, in exactly these letters.
 */
export const INDEXER_PARAMS: Readonly<Record<string, Readonly<{ required: readonly string[]; optional: readonly string[] }>>> = Object.freeze({
  getEncryptedUtxosByTags: { required: ['tags'], optional: ['ringProgramId', ...INDEXER_PAGE] },
  getShieldedTransactionsByTags: { required: ['tags'], optional: ['ringProgramId', ...INDEXER_PAGE] },
  getShieldedTransactionsByNullifiers: { required: ['nullifiers'], optional: [...INDEXER_PAGE] },
  getShieldedTransactionsBySignature: { required: ['txSignature'], optional: [] },
  getMerkleProofs: { required: ['treeAccount', 'leaves'], optional: [] },
  getNonInclusionProofs: { required: ['treeAccount', 'leaves'], optional: [] },
  getUserRecords: { required: ['owners'], optional: [] },
});

/** A slot range as the SDK sends it (`Gr`, `Ra`): `{ slot: { gt, gte, lt, lte } }`, any of the four. */
const SLOT_BOUNDS: readonly string[] = ['gt', 'gte', 'lt', 'lte'];

/** A page token as the SDK makes and checks it (`Ha` in the bundle): `1:<slot>:<signature>`, at most 112 characters. */
const PAGE_TOKEN = /^1:(?:0|[1-9][0-9]{0,19}):[1-9A-HJ-NP-Za-km-z]{64,88}$/;
/** The most page size the SDK asks (`JQA`: "an integer from 1 through 1000"), and the most owners (`GR`: 1 to 100). */
export const INDEXER_MAX_LIMIT = 1_000;
export const INDEXER_MAX_OWNERS = 100;

const isObject = (value: unknown): value is Options => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A base58 32-byte hash or address, as the SDK's `QC` and `co` check them. */
const base58Key = (value: unknown): boolean => typeof value === 'string' && ADDRESS.test(value);
/** A slot or slot bound: a whole number the SDK sends as a JSON integer (`Ki`, `i7`: 0 up, exactly representable). */
const slotNumber = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Each param's values as the SDK's validators allow them: hashes and addresses in base58, a signature in
 * base58, a page token of the SDK's own shape, a page size from 1 to 1000, 1 to 100 owners, slots as whole numbers, and a
 * slot range of up to its four bounds. Anything else — a number past the SDK's, a string of another shape — is refused.
 */
const INDEXER_VALUES: Readonly<Record<string, (value: unknown) => boolean>> = Object.freeze({
  tags: (value: unknown) => Array.isArray(value) && value.every(base58Key),
  nullifiers: (value: unknown) => Array.isArray(value) && value.every(base58Key),
  leaves: (value: unknown) => Array.isArray(value) && value.every(base58Key),
  owners: (value: unknown) => Array.isArray(value) && value.length >= 1 && value.length <= INDEXER_MAX_OWNERS && value.every(base58Key),
  ringProgramId: base58Key,
  treeAccount: base58Key,
  txSignature: (value: unknown) => typeof value === 'string' && SIGNATURE.test(value),
  paginationToken: (value: unknown) => typeof value === 'string' && value.length <= 112 && PAGE_TOKEN.test(value),
  limit: (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= INDEXER_MAX_LIMIT,
  minContextSlot: slotNumber,
  filters: (value: unknown) => {
    if (!isObject(value) || !onlyKeys(value, ['slot'])) return false;
    if (value.slot === undefined) return true;
    return isObject(value.slot) && onlyKeys(value.slot, SLOT_BOUNDS) && Object.values(value.slot).every(slotNumber);
  },
});

/**
 * Whether an indexer query's params are the SDK's: its method's names and no other, each its own letters,
 * each value as the SDK's validators allow it; a tags query without tags names its ring, as the SDK demands.
 */
function indexerParamsFit(method: string, params: Options): boolean {
  const shape = INDEXER_PARAMS[method];
  if (!onlyKeys(params, [...shape.required, ...shape.optional]) || !shape.required.every((name) => Object.hasOwn(params, name))) return false;
  if (!Object.entries(params).every(([name, value]) => Object.hasOwn(INDEXER_VALUES, name) && INDEXER_VALUES[name](value))) return false;
  return !Array.isArray(params.tags) || params.tags.length > 0 || params.ringProgramId !== undefined;
}

/**
 * An indexer query on mainnet, rebuilt from what was read: the SDK's own shape — `{ id, jsonrpc: "2.0", method, params }`,
 * the method the path names, its params one object with the names that method's encoder sends (`INDEXER_PARAMS`) — or
 * null. Nothing beside those keys reaches Helius, no key twice, and no name in other letters beside the SDK's own.
 */
export function strictIndexerBody(method: string, body: unknown): string | null {
  if (!SDK_INDEXER_METHODS.has(method) || !Object.hasOwn(INDEXER_PARAMS, method) || envelopeRefusal(body)) return null;
  const call = body as { id: unknown; method?: unknown; params?: unknown };
  if (call.method !== method) return null;
  const params = call.params;
  if (typeof params !== 'object' || params === null || Array.isArray(params) || !indexerParamsFit(method, params as Options)) return null;
  return JSON.stringify({ id: call.id, jsonrpc: '2.0', method, params });
}

const ACCOUNT_READS: ReadonlySet<string> = new Set(['getAccountInfo', 'getMultipleAccounts']);

function ringOwned(account: unknown): boolean {
  if (account === null) return true;
  return typeof account === 'object' && RING_PROGRAMS.has(String((account as { owner?: unknown }).owner));
}

/**
 * Whether the upstream's answer to `calls` may go back: every account a `getAccountInfo` or `getMultipleAccounts`
 * answer holds belongs to the ring's programs. Calls that read no account pass untouched; an answer the relay cannot
 * match to its calls (unreadable, an id missing or twice) is refused.
 */
export function answerAllowed(calls: readonly unknown[], answer: Uint8Array): boolean {
  const reads = calls.filter((call) => ACCOUNT_READS.has(String((call as { method?: unknown }).method)));
  if (reads.length === 0) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(answer));
  } catch {
    return false;
  }
  const batch = calls.length > 1 || Array.isArray(parsed);
  const replies = Array.isArray(parsed) ? parsed : [parsed];
  const methodOf = new Map<unknown, string>();
  if (batch) {
    for (const call of calls) {
      const { id, method } = call as { id?: unknown; method?: unknown };
      if (id === undefined || id === null || methodOf.has(id)) return false;
      methodOf.set(id, String(method));
    }
  }
  for (const reply of replies) {
    if (typeof reply !== 'object' || reply === null) return false;
    const { id, result, error } = reply as { id?: unknown; result?: unknown; error?: unknown };
    const method = batch ? methodOf.get(id) : String((calls[0] as { method?: unknown }).method);
    if (method === undefined) return false;
    if (!ACCOUNT_READS.has(method) || error !== undefined) continue;
    const value = (result as { value?: unknown } | null | undefined)?.value;
    if (method === 'getAccountInfo') {
      if (value === undefined || !ringOwned(value)) return false;
    } else if (!Array.isArray(value) || !value.every(ringOwned)) {
      return false;
    }
  }
  return true;
}
