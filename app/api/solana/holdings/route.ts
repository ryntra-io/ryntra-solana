import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { FEATURED_MINTS } from "@/app/solana/workspace/assets/featured.ts";
import { fetchTokenCatalog, nativeSolPriceMint, type TokenCatalogEntry } from "@/lib/solana/catalog";
import { readSpotMarketsByMint } from "@/lib/spot/markets.server";
import { buildPassport } from "@/lib/solana/passport";
import { rpcPairHealth } from "@/lib/solana/health";
import { decodeRawMintAccount, type MintReadSuccess } from "@/lib/solana/mint";
import { multiplierFromChain } from "@/lib/stocks/units";
import { SOLANA_NETWORKS, createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import {
  groupSendInventory,
  nativeSendInventoryAsset,
  sendInventoryKey,
  type SendAccountState,
  type SendSourceAccount,
} from "@/lib/solana/send-inventory";
import { associatedTokenAccount } from "@/lib/solana/token-account";
import { NATIVE_SOL_DECIMALS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/solana/send-kinds";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What one address actually holds — on Solana Mainnet unless a caller asks
 * otherwise — so a surface can show a person their own assets instead of
 * asking them to paste a mint address from memory.
 *
 * The read happens here rather than in the browser for one practical reason
 * this repository has already paid for once: a Content Security Policy is
 * invisible to every local gate, and a page that reaches an RPC host directly
 * works in development and fails on the deployed site with nothing but a
 * console entry to show for it. Keeping the endpoint server-side also keeps it
 * an operator's choice rather than a page's.
 *
 * `network` defaults to mainnet because that is what this product reads
 * (canon §3.1). It is a parameter and not a constant for exactly one caller:
 * the Send console is still wired to the internal regression fixture its
 * mainnet rewrite (`RYN-SOL-M0C`) removes, and pinning this route so hard that
 * the fixture broke would be this row quietly doing that row's work.
 */
const RequestSchema = z
  .object({ owner: z.string().min(32).max(44), network: z.enum(SOLANA_NETWORKS).default("mainnet") })
  .strict();

const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const;

const FEATURED_RANK = new Map(FEATURED_MINTS.map((entry, index) => [entry.mint, index]));

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

const ParsedHoldingSchema = z.object({
  pubkey: z.string().min(32).max(44),
  account: z.object({ data: z.object({ parsed: z.object({ info: z.object({
    mint: z.string().min(32).max(44),
    state: z.string().optional(),
    tokenAmount: z.object({
      amount: z.string().regex(/^(0|[1-9][0-9]*)$/).max(20),
      decimals: z.number().int().min(0).max(255),
    }),
  }) }) }) }),
});
const ParsedHoldingsSchema = z.array(ParsedHoldingSchema);

/**
 * The Scaled UI Amount multiplier in force for a mint, from its decoded
 * extensions — the unit the wallet shows and the catalogue prices (a
 * PreStocks SPACEX is ×5). Null for a mint without the extension; the
 * pending one counts from its effective moment on (`multiplierFromChain`).
 */
function scaledUiMultiplierOf(extensions: MintReadSuccess["decoded"]["extensions"], nowMs: number): number | null {
  if (extensions.__option !== "Some") return null;
  const scaled = extensions.value.find((extension) => extension.__kind === "ScaledUiAmountConfig");
  if (!scaled || scaled.__kind !== "ScaledUiAmountConfig") return null;
  const effective = Number(scaled.newMultiplierEffectiveTimestamp);
  const current = multiplierFromChain({ multiplier: scaled.multiplier, newMultiplier: scaled.newMultiplier, newMultiplierEffectiveAt: Number.isFinite(effective) && effective > 0 ? new Date(effective * 1000).toISOString() : null }, nowMs).current;
  return Number.isFinite(current) && current > 0 ? current : null;
}
const HOLDINGS_DEADLINE_MS = 4_500;
const ENDPOINT_TIMEOUT_MS = 800;
/**
 * The one bounded second attempt a silent token-program read gets (the mobile
 * line's request 19; the Owner's directive of 2026-09-22): a wallet with
 * dozens of token accounts can outrun the 800 ms first pass on both hosts and
 * flap COMPLETE → PARTIAL → UNAVAILABLE between refreshes. The retry asks the
 * pair once more with a longer budget, only for a program whose transport
 * failed (an answer, even a malformed one, is a fact and is not re-asked),
 * only when the native read answered, and adds at most two calls per program.
 */
const RETRY_TIMEOUT_MS = 2_500;
const transportFailure = (reason: unknown): boolean => reason instanceof Error && /No Solana RPC endpoint answered|Solana RPC failed after/.test(reason.message);

/**
 * `state` decides whether a balance can move, so an unreadable one is not a
 * maybe. Anything other than the two states this product understands is
 * `UNKNOWN`, which counts toward what is held and never toward what is
 * spendable.
 */
function accountState(raw: string | undefined): SendAccountState {
  if (raw === "initialized") return "INITIALIZED";
  if (raw === "frozen") return "FROZEN";
  return "UNKNOWN";
}

/**
 * The name a mint gives itself, when it gives itself one.
 *
 * This is read from the `TokenMetadata` extension, which only Token-2022 mints
 * can carry — and most do not. Of the six real mints this product decodes,
 * exactly one (PYUSD) has it; USDC, USDT, BONK and wSOL are classic SPL and
 * carry no name on chain at all. So the absence is the common case and has to
 * render as a fact rather than as a blank.
 *
 * It is a **claim, not a fact about the asset**: `updateAuthority` is a key
 * that can rewrite the name and symbol whenever it likes. That is precisely the
 * kind of issuer power this product exists to name, so the authority travels
 * with the name and the surface says whose claim it is. A symbol shown without
 * it would be the product doing the thing it warns everyone else about.
 */
function readSelfDeclaredName(
  extensions: readonly { kind: string; fields: Readonly<Record<string, string | number | boolean | null>> }[],
): { name: string | null; symbol: string | null; nameAuthority: string | null } {
  const metadata = extensions.find((extension) => extension.kind === "TokenMetadata");
  if (!metadata) return { name: null, symbol: null, nameAuthority: null };
  const text = (key: string) => {
    const value = metadata.fields[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  return { name: text("name"), symbol: text("symbol"), nameAuthority: text("updateAuthority") };
}

const NO_NAME = { name: null, symbol: null, nameAuthority: null } as const;

export async function POST(request: Request) {
  const startedAt = performance.now();
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests." } },
      { status: 429, headers: responseHeaders(rate) },
    );
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), HOLDINGS_DEADLINE_MS);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("READ_DEADLINE"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([readHoldings(request, rate, signal, startedAt), aborted]);
  } catch (failure) {
    if (!signal.aborted) throw failure;
    return Response.json(
      { error: { code: "READ_DEADLINE", message: "Balances could not be read in time. Please refresh." } },
      { status: 504, headers: responseHeaders(rate) },
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function readHoldings(request: Request, rate: RateLimitDecision, signal: AbortSignal, startedAt: number) {
  signal.throwIfAborted();
  const body = await readAgentControlJson(request, undefined, signal);
  if (!body.ok) {
    return Response.json(
      { error: { code: body.code, message: "The request body was not accepted." } },
      { status: body.status, headers: responseHeaders(rate) },
    );
  }
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "That is not an address this route will read." } },
      { status: 400, headers: responseHeaders(rate) },
    );
  }

  const network = parsed.data.network;
  const handle = createSolanaRpcHandle({ network, timeoutMs: ENDPOINT_TIMEOUT_MS, retries: 0 });
  const owner = parsed.data.owner;

  /*
   * Read at `confirmed`, not at the endpoint's default of `finalized`.
   *
   * Finalization is about thirteen seconds behind, and the moment a balance is
   * read most often is the moment right after the person's own transfer
   * settled. Observed on a real Token-2022 send: `Sent` with a receipt, and the
   * balance beside it still the one from before the money left. A balance that
   * is thirteen seconds stale is not caution, it is the card telling somebody
   * their own transfer did not happen.
   *
   * `confirmed` is what the rest of this lane already treats as settled — the
   * submit boundary resolves on it and receipts are minted from it — so this
   * aligns the number on screen with the evidence behind it rather than
   * loosening anything.
   */
  const balancesStartedAt = performance.now();
  const readRpc = <T,>(run: (abortSignal: AbortSignal) => Promise<T>) =>
    withRpcDiscipline(handle, (abortSignal) => run(AbortSignal.any([signal, abortSignal])));
  // Independent facts start together; one unreadable token program does not
  // erase another program's answer. A malformed program answer is also unread.
  const [nativeRead, ...programReads] = await Promise.allSettled([
    readRpc((abortSignal) =>
      handle.rpc.getBalance(owner as never, { commitment: "confirmed" }).send({ abortSignal }),
    ).then((response) => {
      const value = response.value;
      if ((typeof value !== "bigint" && !Number.isSafeInteger(value)) || BigInt(value) < 0n) {
        throw new Error("INVALID_NATIVE_BALANCE");
      }
      return String(value);
    }),
    ...TOKEN_PROGRAMS.map((programId) => readRpc((abortSignal) =>
      handle.rpc.getTokenAccountsByOwner(
        owner as never,
        { programId: programId as never },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ).send({ abortSignal }),
    ).then((response) => ParsedHoldingsSchema.parse(response.value))),
  ] as const);
  if (nativeRead.status !== "fulfilled") {
    return Response.json(
      { error: { code: "RPC_FAILED", message: "The native balance could not be read. Please refresh." } },
      { status: 502, headers: responseHeaders(rate) },
    );
  }
  /* The bounded second attempt for a program whose transport failed on both hosts. */
  const retryHandle = programReads.some((result) => result.status === "rejected" && transportFailure(result.reason))
    ? createSolanaRpcHandle({ network, timeoutMs: RETRY_TIMEOUT_MS, retries: 0 })
    : null;
  if (retryHandle) {
    for (const [index, result] of programReads.entries()) {
      if (result.status !== "rejected" || !transportFailure(result.reason)) continue;
      signal.throwIfAborted();
      const programId = TOKEN_PROGRAMS[index];
      try {
        const value = await withRpcDiscipline(retryHandle, (abortSignal) =>
          retryHandle.rpc.getTokenAccountsByOwner(
            owner as never,
            { programId: programId as never },
            { encoding: "jsonParsed", commitment: "confirmed" },
          ).send({ abortSignal: AbortSignal.any([signal, abortSignal]) }),
        ).then((response) => ParsedHoldingsSchema.parse(response.value));
        (programReads as PromiseSettledResult<typeof value>[])[index] = { status: "fulfilled", value };
      } catch {
        /* Still silent after the second attempt: the program stays unread and the answer says PARTIAL or UNAVAILABLE, never zero. */
      }
    }
  }
  const lamports = nativeRead.value;
  const balancesMs = performance.now() - balancesStartedAt;
  const observedAt = new Date().toISOString();
  const holdings = [];
  const unreadablePrograms: string[] = [];
  for (const [index, result] of programReads.entries()) {
    const programId = TOKEN_PROGRAMS[index];
    if (result.status !== "fulfilled") {
      unreadablePrograms.push(programId);
      continue;
    }
    for (const entry of result.value) {
      const info = entry.account.data.parsed.info;
      if (BigInt(info.tokenAmount.amount) === 0n) continue;
      holdings.push({
        address: entry.pubkey,
        mint: info.mint,
        amountRaw: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        tokenProgram: programId as string,
        state: accountState(info.state),
      });
    }
  }

  /* Which of these is the account the recipient's own wallet would derive.
     It is a local program-derived address, not another network read, and
     planning prefers it whenever it alone can cover the amount. */
  const canonicalByKey = new Map<string, string>();
  for (const key of new Set(
    holdings.map((holding) => sendInventoryKey(holding.mint, holding.tokenProgram)),
  )) {
    const [mint, tokenProgram] = key.split(":");
    try {
      canonicalByKey.set(key, await associatedTokenAccount({ owner, mint, tokenProgram }));
    } catch {
      /* An underivable address is not a canonical one. The asset still lists
         every account it has; only the preference is unavailable. */
    }
  }
  const sourceAccounts: SendSourceAccount[] = holdings.map((holding) => ({
    address: holding.address,
    mint: holding.mint,
    tokenProgram: holding.tokenProgram,
    amountRaw: holding.amountRaw,
    decimals: holding.decimals,
    state: holding.state,
    canonical: canonicalByKey.get(sendInventoryKey(holding.mint, holding.tokenProgram)) === holding.address,
  }));

  /* One row per asset, over however many accounts hold it. */
  const assets = groupSendInventory(sourceAccounts);

  /* Identity first, never amount. A raw unit count is not comparable across
     decimals, and ranking by it puts airdrop millions above forty dollars of
     USDC. Native SOL is prepended after enrichment. */

  /* Each mint is read as a real passport, so the chooser shows what the asset
     structurally is — not a symbol somebody could have written on it.

     Twelve, because each one costs a mint read. The cap is **reported**: a
     wallet with sixty-one balances was rendering as twelve plus "and 7 more",
     which is a truncation wearing a total's clothes. `held` below is the real
     count and the caller says "of 61" with it. */
  const DETAILED = 12;
  type MintDetail = {
    programKind: "TOKEN_2022" | "SPL_TOKEN" | "NOT_A_MINT" | null;
    extensions: string[];
    name: string | null;
    symbol: string | null;
    nameAuthority: string | null;
    /** The Scaled UI Amount multiplier in force (1.15.0): what the wallet shows is the raw amount times it, and the catalogue prices that unit. */
    uiMultiplier: number | null;
  };
  const NO_DETAIL: MintDetail = { programKind: null, extensions: [], ...NO_NAME, uiMultiplier: null };
  const toDetail = [
    ...assets.filter((asset) => FEATURED_RANK.has(asset.mint as string)),
    ...assets.filter((asset) => !FEATURED_RANK.has(asset.mint as string)),
  ].slice(0, DETAILED);
  const detailByMint = new Map<string, MintDetail>();
  const detailsStartedAt = performance.now();
  let detailsMs = 0;
  let catalogMs = 0;
  // The public primary accepted six accounts in 182ms and refused twelve
  // after 3165ms. Two bounded batches preserve the same twelve detailed rows.
  const DETAIL_BATCH_SIZE = 6;
  const readDetails = async (batch: typeof toDetail) => {
    try {
      if (batch.length === 0) return;
      const response = await readRpc((abortSignal) => handle.rpc.getMultipleAccounts(
        batch.map((asset) => asset.mint as never), { encoding: "base64" },
      ).send({ abortSignal }));
      if (response.value.length !== batch.length) return;
      // Each ordered batch is decoded against its own requested addresses.
      for (const [index, account] of response.value.entries()) {
        if (!account) continue;
        const mint = batch[index].mint as string;
        try {
          const read = decodeRawMintAccount({
            mint, network, owner: String(account.owner), dataBase64: account.data[0],
            observedAt: new Date().toISOString(),
            slot: response.context?.slot === undefined ? null : String(response.context.slot),
            endpointHost: handle.host(),
          });
          if (!read.ok) continue;
          const passport = buildPassport(read.raw);
          if (!passport.ok) continue;
          detailByMint.set(mint, {
            programKind: passport.passport.identity.programKind,
            extensions: passport.passport.extensions.filter((extension) => extension.affectsTransfers).map((extension) => extension.kind),
            ...readSelfDeclaredName(passport.passport.extensions),
            uiMultiplier: scaledUiMultiplierOf(read.decoded.extensions, Date.now()),
          });
        } catch { /* Unreadable detail never removes an account or an asset. */ }
      }
    } catch { /* Optional mint details are unavailable; balances stay intact. */ }
    finally { detailsMs = performance.now() - detailsStartedAt; }
  };
  const catalogMints = [nativeSolPriceMint(), ...toDetail.map((asset) => asset.mint as string)];
  /* Every other held mint is named and priced too — by the Spot catalogue,
     a hundred mints a call, which costs no mint read. Twelve was the cap on
     passports and had quietly become the cap on names: the Owner's fresh
     STONK fill sat in the Portfolio as `6GmA…UNgx · —` under *Without a
     price* while the Spot page priced it a click away (2026-09-12). Three
     hundred mints is three calls; a wallet with more keeps the rest unnamed,
     which the row already says honestly. */
  const WIDE_CATALOG_CAP = 300;
  const WIDE_CATALOG_BATCH = 100;
  /* Every held mint, the featured ones included: the wide read is also where
     the icon, the category and the day's change come from, which the price
     feed's own read does not carry. */
  const wideMints = [nativeSolPriceMint(), ...assets.map((asset) => asset.mint as string)].slice(0, WIDE_CATALOG_CAP);
  const readWideCatalog = async (batch: readonly string[]): Promise<Record<string, TokenCatalogEntry>> => {
    try {
      const read = await readSpotMarketsByMint(batch, 2_500);
      if (!read.ok) return {};
      const source = { ref: `jupiter:mainnet:tokens:search:${batch.length}`, label: "Jupiter Tokens API, search by mint" };
      const entries: Record<string, TokenCatalogEntry> = {};
      for (const [mint, market] of read.byMint) {
        entries[mint] = {
          mint,
          symbol: market.symbol || null,
          name: market.name || null,
          isVerified: market.verified,
          isSuspicious: market.audit.suspicious,
          usdPrice: market.price !== null && market.price > 0 ? String(market.price) : null,
          source,
          icon: market.icon,
          category: market.category,
          dayChangePct: market.change24hPct,
        };
      }
      return entries;
    } catch {
      /* The wide read is a convenience over the balances; a refusal leaves
         the rows it would have named exactly as they were. */
      return {};
    }
  };
  const [, catalog, wide] = await Promise.all([
    Promise.all(Array.from({ length: Math.ceil(toDetail.length / DETAIL_BATCH_SIZE) }, (_, index) =>
      readDetails(toDetail.slice(index * DETAIL_BATCH_SIZE, (index + 1) * DETAIL_BATCH_SIZE)),
    )),
    fetchTokenCatalog(catalogMints, 1_000, signal).finally(() => { catalogMs = performance.now() - detailsStartedAt; }),
    Promise.all(Array.from({ length: Math.ceil(wideMints.length / WIDE_CATALOG_BATCH) }, (_, index) =>
      readWideCatalog(wideMints.slice(index * WIDE_CATALOG_BATCH, (index + 1) * WIDE_CATALOG_BATCH)),
    )),
  ]);
  /* The featured read answers first for the mints it covers — it carries the
     price feed's own figure — and the wide read names everything else and
     adds what the price read does not carry: the icon, the category, the
     day's change. */
  const wideByMint: Record<string, TokenCatalogEntry> = Object.assign({}, ...wide);
  const overlay: Record<string, TokenCatalogEntry> = { ...wideByMint };
  if (catalog.ok) {
    for (const [mint, entry] of Object.entries(catalog.byMint)) {
      const wideEntry = wideByMint[mint];
      overlay[mint] = wideEntry
        ? { ...entry, icon: wideEntry.icon ?? null, category: wideEntry.category ?? null, dayChangePct: wideEntry.dayChangePct ?? null, usdPrice: entry.usdPrice ?? wideEntry.usdPrice }
        : entry;
    }
  }

  const nativeAsset = nativeSendInventoryAsset(lamports);
  const native = {
    kind: "NATIVE_SOL" as const,
    mint: null,
    amountRaw: nativeAsset.amountRaw,
    spendableRaw: nativeAsset.spendableRaw,
    decimals: NATIVE_SOL_DECIMALS,
    tokenProgram: null,
    canonicalAta: null,
    sourceAccounts: nativeAsset.sourceAccounts,
    programKind: null,
    extensions: [] as string[],
    name: "Solana",
    symbol: "SOL",
    nameAuthority: null,
    catalog: overlay[nativeSolPriceMint()] ?? null,
  };

  const tokens = assets.map((asset) => {
    const mint = asset.mint as string;
    const detail = detailByMint.get(mint) ?? NO_DETAIL;
    return {
      kind: "TOKEN" as const,
      mint,
      amountRaw: asset.amountRaw,
      spendableRaw: asset.spendableRaw,
      decimals: asset.decimals,
      tokenProgram: asset.tokenProgram,
      canonicalAta: asset.canonicalAta,
      sourceAccounts: asset.sourceAccounts,
      programKind: detail.programKind,
      extensions: detail.extensions,
      name: detail.name,
      symbol: detail.symbol,
      nameAuthority: detail.nameAuthority,
      catalog: overlay[mint] ?? null,
      uiMultiplier: detail.uiMultiplier,
    };
  });

  const rankOf = (row: (typeof tokens)[number]) => {
    if (FEATURED_RANK.has(row.mint)) return FEATURED_RANK.get(row.mint)!;
    if (row.catalog?.isVerified) return 100;
    if (row.symbol || row.name) return 200;
    return 300;
  };
  tokens.sort((left, right) => rankOf(left) - rankOf(right));

  /* Which endpoint served this, and whether the pair was whole while it did.
     A balance is a fact about a moment and a source; sending it without the
     source would make the caller invent one. */
  const health = rpcPairHealth(handle);
  return Response.json(
    {
      data: {
        owner,
        network,
        lamports,
        holdings: [native, ...tokens],
        /* Token accounts with a non-zero balance, not counting native SOL.
           Native SOL is always the first row when this route answers. */
        held: holdings.length,
        /* `COMPLETE` — both token programs answered, so an empty list means the
           address holds nothing. `PARTIAL` — one answered. `UNAVAILABLE` —
           neither did, and an empty list means nothing is known. A surface must
           never print "no balance" on anything but `COMPLETE`. */
        tokenRead:
          unreadablePrograms.length === 0
            ? "COMPLETE"
            : unreadablePrograms.length === TOKEN_PROGRAMS.length
              ? "UNAVAILABLE"
              : "PARTIAL",
        /* Asset rows in this answer, including native SOL. It equals the whole
           inventory: `held` can be larger only because one asset can sit in
           several accounts, never because a row was dropped. `detailed` is the
           mint-read cap, which bounds cost and nothing else. */
        returned: tokens.length + 1,
        detailed: toDetail.length,
        observedAt,
        source: {
          host: handle.host(),
          hosts: [...new Set([...health.endpoints.filter((endpoint) => endpoint.answered > 0).map((endpoint) => endpoint.host), ...(retryHandle ? rpcPairHealth(retryHandle).endpoints.filter((endpoint) => endpoint.answered > 0).map((endpoint) => endpoint.host) : [])])],
          health: health.state,
          detail: health.detail,
        },
        catalog: catalog.ok
          ? { status: "PRESENT" as const, missing: catalog.missing }
          : { status: "ABSENT" as const, reason: catalog.reason },
      },
    },
    { headers: {
      ...responseHeaders(rate),
      "server-timing": [
        `balances;dur=${balancesMs.toFixed(1)}`,
        `details;dur=${detailsMs.toFixed(1)}`,
        `catalog;dur=${catalogMs.toFixed(1)}`,
        `rpc;desc="${handle.attempts().length + (retryHandle?.attempts().length ?? 0)} attempts"`,
        `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
      ].join(", "),
    } },
  );
}
