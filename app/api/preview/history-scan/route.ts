import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';

import { attributionEndpoints, attributionScan, readReferralTokenAccounts, readSignatureHistory } from '@/lib/attribution/chain.server';
import { addressHistoryOf, scanEndpointOf, scanStats } from '@/lib/core/history/address-history';
import { getGuardRuntime } from '@/lib/guard/runtime';
import { privateNoStoreHeaders } from '@/lib/http-control';
import { readBook } from '@/lib/mandate/book.server';
import { chainTradeSignatures } from '@/lib/mandate/report-chain.server';
import { unbookedTrades } from '@/lib/mandate/report';
import { resolveEndpoints } from '@/lib/solana/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * CITY-245 — the check of the history scan against the node, on a deployment's own address only: the same account's
 * signatures through Helius's Parsed Events Scan and through the node's pages, side by side, and whether Helius knows
 * the Meteora programs by name. It answers only on the deployment's own generated address (`VERCEL_URL`), which
 * Vercel's deployment protection keeps to the team — never on ryntra.io, nor on the project's public `*.vercel.app`
 * domains. Reads only: public signatures and counts, never a URL (a node
 * URL carries its key), never an owner's address. Signs and sends nothing.
 */

const DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const DAMM_V2 = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
const REFERRAL = 'F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv';
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

const deploymentOnly = (host: string) => (Boolean(process.env.VERCEL_URL) && host === process.env.VERCEL_URL) || (!process.env.VERCEL && (host === 'localhost' || host.startsWith('localhost:')));
const numberOf = (text: string | null, fallback: number, low: number, high: number) => {
  const value = Number(text ?? NaN);
  return Number.isFinite(value) ? Math.min(high, Math.max(low, Math.floor(value))) : fallback;
};
const DBC_AND_DAMM = { programs: [{ programId: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN', scope: 'transaction' as const }, { programId: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG', scope: 'transaction' as const }] };

async function nodeList(connection: Connection, address: string, limit: number): Promise<{ signatures: string[]; failed: number; whole: boolean; ms: number }> {
  const started = Date.now();
  const signatures: string[] = [];
  let failed = 0;
  let before: string | undefined;
  for (let pages = 0; pages < 20; pages += 1) {
    const page = await connection.getSignaturesForAddress(new PublicKey(address), { before, limit: 1_000 }, 'confirmed');
    for (const entry of page) {
      if (entry.err === null) signatures.push(entry.signature);
      else failed += 1;
    }
    if (page.length < 1_000) return { signatures, failed, whole: true, ms: Date.now() - started };
    if (signatures.length + failed >= limit) return { signatures, failed, whole: false, ms: Date.now() - started };
    before = page.at(-1)!.signature;
  }
  return { signatures, failed, whole: false, ms: Date.now() - started };
}

/** One unmatched transaction, by what it did: did it move the mint, and which of the Meteora programs ran in it. */
async function whatItDid(connection: Connection, signature: string, mint: string) {
  const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!tx) return { signature, read: false };
  const balances = [...(tx.meta?.preTokenBalances ?? []), ...(tx.meta?.postTokenBalances ?? [])].filter((entry) => entry.mint === mint);
  const moved = (tx.meta?.postTokenBalances ?? []).some((post) => post.mint === mint && (tx.meta?.preTokenBalances ?? []).find((pre) => pre.accountIndex === post.accountIndex)?.uiTokenAmount.amount !== post.uiTokenAmount.amount);
  const logs = tx.meta?.logMessages ?? [];
  return { signature, read: true, blockTime: tx.blockTime ?? null, mintListed: balances.length > 0, mintMoved: moved, dbc: logs.some((line) => line.includes(DBC)), damm: logs.some((line) => line.includes(DAMM_V2)) };
}

async function idl(scanUrl: string, programId: string) {
  const url = new URL(scanUrl);
  url.pathname = `/v1/parsed-events/idl/${programId}`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response) return { programId, status: 0 };
  const body = (await response.json().catch(() => null)) as { instructions?: unknown; idl?: { instructions?: unknown; name?: unknown; metadata?: { name?: unknown } } } | null;
  const shape = body && typeof body === 'object' ? Object.fromEntries(Object.entries(body).map(([key, value]) => [key, Array.isArray(value) ? `array(${value.length})` : value && typeof value === 'object' ? Object.keys(value).slice(0, 12) : typeof value])) : null;
  const list = (Array.isArray(body?.instructions) ? body.instructions : Array.isArray(body?.idl?.instructions) ? body.idl.instructions : []) as Array<{ name?: unknown } | string>;
  const names = list.map((entry) => (typeof entry === 'string' ? entry : String(entry?.name ?? ''))).filter(Boolean);
  const text = JSON.stringify(body ?? '');
  return { programId, status: response.status, shape, name: body?.idl?.metadata?.name ?? body?.idl?.name ?? null, instructions: names.length, swap: names.filter((name) => /swap/iu.test(name)), mentions: { swap: /"swap"/u.test(text), swap2: /"swap2"/u.test(text), claim_trading_fee: /claim_trading_fee|claimTradingFee/u.test(text) } };
}

export async function GET(req: NextRequest) {
  if (!deploymentOnly(req.headers.get('host') ?? '')) return NextResponse.json({ error: 'not found' }, { status: 404, headers: privateNoStoreHeaders() });
  const node = resolveEndpoints('mainnet')[0]!;
  const scanUrl = scanEndpointOf(node.url);
  const history = addressHistoryOf(node.url);
  const base = { node: node.host, scan: history ? history.host : null };
  if (!history || !scanUrl) return NextResponse.json({ ...base, error: 'the node is not Helius with its key' }, { headers: privateNoStoreHeaders() });
  const mode = req.nextUrl.searchParams.get('mode') ?? 'launch';
  const connection = new Connection(node.url, { commitment: 'confirmed' });

  if (mode === 'idl') {
    return NextResponse.json({ ...base, idl: await Promise.all([idl(scanUrl, DBC), idl(scanUrl, DAMM_V2)]) }, { headers: privateNoStoreHeaders() });
  }

  if (mode === 'attribution') {
    const endpoints = attributionEndpoints();
    const used = new Set<string>();
    const accounts = await readReferralTokenAccounts(REFERRAL, endpoints, used);
    const addresses = accounts.map((account) => account.address);
    const scan = attributionScan(endpoints, accounts);
    const t0 = Date.now();
    const scanned = scan ? await readSignatureHistory(addresses, endpoints, new Set(), scan) : null;
    const t1 = Date.now();
    const paged = await readSignatureHistory(addresses, endpoints, new Set(), null);
    const t2 = Date.now();
    const a = new Set(scanned?.keys() ?? []);
    const b = new Set(paged.keys());
    return NextResponse.json(
      {
        ...base,
        accounts: accounts.length,
        scan: { signatures: a.size, ms: t1 - t0 },
        paged: { signatures: b.size, failed: [...paged.values()].filter((entry) => entry.err !== null).length, ms: t2 - t1 },
        onlyScan: [...a].filter((signature) => !b.has(signature)).slice(0, 20),
        onlyPaged: [...b].filter((signature) => !a.has(signature)).slice(0, 20),
        stats: scanStats(),
      },
      { headers: privateNoStoreHeaders() },
    );
  }

  if (mode === 'paging') {
    /* One listing against the same listing in pages of `page` by the signature before: the cursor and «before» agree. */
    const address = req.nextUrl.searchParams.get('address') ?? '';
    const program = req.nextUrl.searchParams.get('program') ?? '';
    if (!ADDRESS.test(address) || !ADDRESS.test(program)) return NextResponse.json({ ...base, error: 'address and program' }, { status: 400, headers: privateNoStoreHeaders() });
    const total = numberOf(req.nextUrl.searchParams.get('limit'), 1_500, 2, 5_000);
    const size = numberOf(req.nextUrl.searchParams.get('page'), 500, 1, 1_000);
    const match = { programs: [{ programId: program, scope: 'address' as const }] };
    const until = Date.now() + 40_000;
    /* Both start below the same signature: a live account's newest ones would otherwise move between the two. */
    const anchor = (await history.signatures({ address, match, limit: 1, until })).entries[0]?.signature;
    const whole = await history.signatures({ address, match, limit: total, before: anchor, until });
    const paged: string[] = [];
    let before: string | undefined = anchor;
    while (paged.length < total) {
      const page = await history.signatures({ address, match, limit: Math.min(size, total - paged.length), before, until });
      paged.push(...page.entries.map((entry) => entry.signature));
      if (page.whole || page.entries.length === 0) break;
      before = page.entries.at(-1)!.signature;
    }
    const one = whole.entries.map((entry) => entry.signature);
    return NextResponse.json({ ...base, total, page: size, one: { count: one.length, calls: whole.calls, credits: whole.credits, whole: whole.whole }, paged: { count: paged.length }, same: one.length === paged.length && one.every((signature, index) => signature === paged[index]), firstDiff: one.findIndex((signature, index) => signature !== paged[index]), stats: scanStats() }, { headers: privateNoStoreHeaders() });
  }

  if (mode === 'agents') {
    const book = await readBook(getGuardRuntime().store, 'mainnet');
    const now = Date.now();
    const days = numberOf(req.nextUrl.searchParams.get('days'), 7, 1, 30);
    const rows = [];
    for (const entry of book.slice(0, 20)) {
      const since = now - days * 86_400_000;
      const chain = await chainTradeSignatures({ budget: entry.record.budget, coin: entry.receiveMint, since, until: now });
      const booked = entry.trades.filter((trade) => trade.status === 'ok' && trade.signature !== null && trade.at >= since).length;
      rows.push({ status: entry.status, chain: chain === null ? null : chain.length, booked, unbooked: unbookedTrades(chain, entry.trades) });
    }
    return NextResponse.json({ ...base, days, mandates: book.length, rows, stats: scanStats() }, { headers: privateNoStoreHeaders() });
  }

  /* A launch: each account against the token's mint, the scan's whole list beside the node's. */
  const mint = req.nextUrl.searchParams.get('mint') ?? '';
  const addresses = req.nextUrl.searchParams.getAll('address').filter((address) => ADDRESS.test(address)).slice(0, 3);
  if (!ADDRESS.test(mint) || addresses.length === 0) return NextResponse.json({ ...base, error: 'mint and address' }, { status: 400, headers: privateNoStoreHeaders() });
  const limit = numberOf(req.nextUrl.searchParams.get('limit'), 5_000, 1, 20_000);
  const byMint = req.nextUrl.searchParams.get('match') === 'mint';
  const results = [];
  for (const address of addresses) {
    const t0 = Date.now();
    const scanned = await history.signatures({ address, match: byMint ? { mints: [{ mint, scope: 'transaction' }] } : DBC_AND_DAMM, limit, until: Date.now() + 15_000 }).then(
      (listing) => ({ ok: true as const, listing }),
      (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : 'failed' }),
    );
    const scanMs = Date.now() - t0;
    const paged = await nodeList(connection, address, limit);
    if (!scanned.ok) {
      results.push({ address, scan: scanned.error, paged: { signatures: paged.signatures.length, failed: paged.failed, whole: paged.whole, ms: paged.ms } });
      continue;
    }
    const a = new Set(scanned.listing.entries.map((entry) => entry.signature));
    const b = new Set(paged.signatures);
    const onlyPaged = [...b].filter((signature) => !a.has(signature));
    results.push({
      address,
      scan: { signatures: a.size, whole: scanned.listing.whole, calls: scanned.listing.calls, scanned: scanned.listing.scanned, credits: scanned.listing.credits, ms: scanMs, oldest: scanned.listing.entries.at(-1) ?? null },
      paged: { signatures: b.size, failed: paged.failed, whole: paged.whole, ms: paged.ms },
      onlyScan: [...a].filter((signature) => !b.has(signature)).slice(0, 10),
      onlyPaged: onlyPaged.length,
      onlyPagedSample: await Promise.all(onlyPaged.slice(0, 8).map((signature) => whatItDid(connection, signature, mint))),
    });
  }
  return NextResponse.json({ ...base, mint, match: byMint ? 'mint' : 'programs', results, stats: scanStats() }, { headers: privateNoStoreHeaders() });
}
