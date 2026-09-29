/* Binance MCP tool registry (RYN-BIN-AOS-002, read-only verification).

   `RYN-BIN-AOS-001` could not reach the tool list: `tools/list` returned 401 and authorizing an
   account is a founder action. The founder authorized it, so the inventory is now captured — and
   the two things it settles are worth more than the list itself.

   First, the withdrawal claim stops being a sentence in Binance's documentation and becomes a
   checkable property: five tools match /withdraw/ and every one of them reads. There is no
   withdrawal-execution tool to grant, block or misconfigure.

   Second, a guardrail trap. The server's own `instructions` string documents the tool naming
   pattern as `{verb}_{product}_{operation}` and offers `create_spot_newOrder` as an example. No
   exposed tool is named that way. A blocklist written from that documentation — blocking
   `create_*`, `cancel_*`, `delete_*` — matches nothing and fails OPEN on every order and transfer
   tool. That is not hypothetical: it is what this packet's own first probe did, and only the
   prompt instruction stopped the nested client from being able to trade. Classification here is
   by operation, never by prefix. */

export const TOOL_NAMESPACES = [
  "spot",
  "margin",
  "futures_usds",
  "futures_coin",
  "convert",
  "wallet",
  "analysis",
  "sub_account",
] as const;

export type BinanceToolNamespace = (typeof TOOL_NAMESPACES)[number];

/** Registry names are `<namespace>.<operation>`; the MCP tool name joins them with `_`. */
export function namespaceOf(toolName: string): string {
  const dot = toolName.indexOf(".");
  return dot === -1 ? toolName : toolName.slice(0, dot);
}

export function operationOf(toolName: string): string {
  const dot = toolName.indexOf(".");
  return dot === -1 ? toolName : toolName.slice(dot + 1);
}

export type ToolAccess = "read" | "write";

/**
 * Operations that change state. Matched against the OPERATION, case-insensitively, and never
 * against a leading verb — see the module comment for why a prefix rule is unsafe here.
 *
 * `History`, `Info`, `List`, `Status` and `Query*` forms are reads even when they name a write
 * concept: `withdrawHistory` reads withdrawals, `queryUserUniversalTransferHistory` reads
 * transfers. Those are exactly the names a careless rule gets wrong in the dangerous direction —
 * or, worse, in the direction that hides a real write behind a familiar-looking word.
 */
const WRITE_OPERATIONS = [
  "newOrder",
  "placeLimitOrder",
  "cancelOrder",
  "cancelLimitOrder",
  "cancelAllOpenOrders",
  "deleteOrder",
  "deleteOpenOrders",
  "acceptQuote",
  "sendQuoteRequest",
  "borrowRepay",
  "changeInitialLeverage",
  "changeMarginType",
  "changePositionMode",
  "changeMultiAssetsMode",
  "userUniversalTransfer",
  "startUserDataStream",
  "keepaliveUserDataStream",
  "closeUserDataStream",
  "withdraw",
  "transfer",
] as const;

/**
 * Operation shapes that are unambiguously reads on this surface. Derived from the captured
 * registry: `get*` and `query*` alone cover 98 of 316 operations, and the noun-suffix forms cover
 * the rest of the readable vocabulary.
 *
 * `withdrawHistory` and `queryUserUniversalTransferHistory` are the cases that matter — they carry
 * a write word and read. They are caught here rather than left to a default.
 */
const READ_OPERATIONS = [
  /^(get|query|fetch|check|list)/i,
  /(history|historyv\d+|info|information|informationv\d+|list|status|quota|snapshot|detail|details|balance|balancev\d+|record|ratio|ratios|fee|fees|rate|rates|price|prices|depth|klines|uiklines|trades|tradelist|book|ticker|ticker24hr|tickerprice|config|configuration|configurations|assets|asset|symbol|symbols|pairs|precision|leverage|brackets|mode|report|log|dustlog|orders|order|position|positions|account|accounts)$/i,
  // Market-data noun forms. Without these the same read is classified differently depending on
  // which family names it: `spot.klines` versus `futures_coin.klineCandlestickData`.
  /(data|statistics|interest|basis|connectivity|lookup|volume|estimation|index|bracket|brackets|quantile|indicators|risk|time|status)$/i,
  /(address|ping|commission|rules|schedule|allocations|filters|amendments|calculation)$/i,
];

function isKnownWrite(operation: string): boolean {
  for (const write of WRITE_OPERATIONS) {
    // Whole-operation or suffix match on a capitalised boundary, so `cancelOrder` matches
    // `marginAccountCancelOrder` while `withdrawHistory` does not match `withdraw`.
    if (operation === write) return true;
    const capitalised = write.charAt(0).toUpperCase() + write.slice(1);
    if (operation.endsWith(capitalised)) return true;
  }
  return false;
}

/**
 * Classifies an operation, **failing closed**.
 *
 * The first version of this function defaulted unrecognised operations to `read`, which is the
 * dangerous direction: a tool this repository has never seen — a new endpoint, a renamed one —
 * would have been waved through as harmless. It was caught by breaking the read list and watching
 * `withdrawHistory` stay classified as a read anyway, which proved the read list was not the thing
 * doing the work. An unrecognised operation is now treated as a write.
 *
 * A false "write" costs a needless confirmation. A false "read" costs an unreviewed order.
 *
 * The two layers overlap on purpose, and the overlap was measured rather than assumed. Deleting
 * `deleteOrder` or `cancelOrder` from the explicit list DOES misclassify them, because both end in
 * `Order` and the read patterns would then capture them — proved by removing each and watching the
 * tests fail. Deleting `borrowRepay` or `userUniversalTransfer` changes nothing, because no read
 * pattern matches them and the fail-closed default catches them anyway. The explicit list is
 * load-bearing exactly where a read pattern would otherwise win, and belt-and-braces elsewhere.
 */
export function classifyToolAccess(toolName: string): ToolAccess {
  const operation = operationOf(toolName);
  if (isKnownWrite(operation)) return "write";
  for (const read of READ_OPERATIONS) {
    if (read.test(operation)) return "read";
  }
  return "write";
}

/**
 * Tools that could actually move funds off the account. The expected result on this server is an
 * empty array, and a test asserts it: Binance exposes withdrawal reads and no withdrawal write.
 */
export function withdrawalExecutionTools(toolNames: readonly string[]): string[] {
  return toolNames.filter(
    (name) => /withdraw/i.test(name) && classifyToolAccess(name) === "write",
  );
}
