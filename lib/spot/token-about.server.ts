/**
 * «Що це за монета» — the read: the metadata URI the mint names, and the
 * description in the JSON there (`token-about.ts` shapes both).
 *
 * The Metaplex Token Metadata account and the mint itself are asked at once —
 * a Token-2022 mint may carry its metadata in its own extension instead — and
 * the URI of the first that names one is fetched: https to a public host only,
 * redirects followed by hand and checked again, a few seconds, a few dozen
 * kilobytes, JSON only. A described token is kept for hours (its creator rarely
 * rewrites it), a silent one for an hour, a failed read for minutes, so the
 * header asks this at most once per token per instance in the common case.
 */

import { lookup } from "node:dns/promises";

import { address as toAddress, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

import { decodeRawMintAccount } from "../solana/mint.ts";
import { createSolanaRpcHandle, withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";
import { descriptionOf, gatewayCandidates, isPrivateAddress, METAPLEX_METADATA_PROGRAM, metadataAddress, metaplexUri, publicHttpsUrl, token2022Uri, withoutNames, type TokenAbout } from "./token-about.ts";

const DESCRIBED_TTL_MS = 6 * 60 * 60_000;
const SILENT_TTL_MS = 60 * 60_000;
const UNREAD_TTL_MS = 5 * 60_000;
const CACHE_ENTRIES = 2_000;
const FETCH_TIMEOUT_MS = 4_000;
/* The whole read of the metadata's JSON — every gateway and redirect together — inside the route's own time. */
const JSON_BUDGET_MS = 8_000;
const CEILING_BYTES = 64 * 1024;
const MAX_REDIRECTS = 2;

type Kept = Readonly<{ about: TokenAbout; at: number }>;
const kept = new Map<string, Kept>();

function remember(mint: string, about: TokenAbout): void {
  if (kept.size >= CACHE_ENTRIES) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  kept.set(mint, { about, at: Date.now() });
}

function ttlOf(about: TokenAbout): number {
  return about.state === "described" ? DESCRIBED_TTL_MS : about.state === "unread" ? UNREAD_TTL_MS : SILENT_TTL_MS;
}

/** The Metaplex metadata account of a mint: the PDA of `["metadata", program, mint]`. */
export async function metaplexMetadataAddress(mint: string): Promise<string> {
  const encoder = getAddressEncoder();
  const program = toAddress(METAPLEX_METADATA_PROGRAM);
  const [pda] = await getProgramDerivedAddress({ programAddress: program, seeds: ["metadata", encoder.encode(program), encoder.encode(toAddress(mint))] });
  return pda;
}

type AccountRead = Readonly<{ owner: string; dataBase64: string }> | null;

async function readAccount(handle: SolanaRpcHandle, account: string): Promise<AccountRead> {
  const response = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getAccountInfo(account as never, { encoding: "base64" }).send({ abortSignal }));
  if (!response.value) return null;
  return { owner: String(response.value.owner), dataBase64: response.value.data[0] };
}

/** The URI the mint names: Metaplex first, then the Token-2022 extension; `undefined` when the chain did not answer. */
async function readUri(mint: string, handle: SolanaRpcHandle): Promise<string | null | undefined> {
  let metadata: AccountRead;
  let mintAccount: AccountRead;
  try {
    [metadata, mintAccount] = await Promise.all([metaplexMetadataAddress(mint).then((pda) => readAccount(handle, pda)), readAccount(handle, mint)]);
  } catch {
    return undefined;
  }
  if (metadata && metadata.owner === METAPLEX_METADATA_PROGRAM) {
    const uri = metaplexUri(Uint8Array.from(Buffer.from(metadata.dataBase64, "base64")));
    if (uri && uri.trim().length > 0) return uri;
  }
  if (mintAccount) {
    const decoded = decodeRawMintAccount({ mint, network: "mainnet", owner: mintAccount.owner, dataBase64: mintAccount.dataBase64, observedAt: new Date().toISOString(), slot: null, endpointHost: handle.host() });
    if (decoded.ok) {
      const uri = token2022Uri(decoded.decoded.extensions);
      if (uri && uri.trim().length > 0) return uri;
    }
  }
  return null;
}

/** Whether a host name resolves to the open internet only: a name that points at a private, loopback or link-local address is refused. */
async function resolvesPublic(url: string): Promise<boolean> {
  try {
    const answers = await lookup(new URL(url).hostname, { all: true, verbatim: true });
    return answers.length > 0 && answers.every((answer) => !isPrivateAddress(answer.address));
  } catch {
    return false;
  }
}

/** The JSON at an address: `undefined` when it did not answer now, null when it answered with no JSON. */
async function fetchJson(start: string): Promise<unknown | null | undefined> {
  const deadline = Date.now() + JSON_BUDGET_MS;
  for (const candidate of gatewayCandidates(start)) {
    let url = candidate;
    let busy = false;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const left = deadline - Date.now();
      if (left < 250) return undefined;
      if (!(await resolvesPublic(url))) return null;
      let response: Response;
      try {
        response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, left)), headers: { accept: "application/json, text/plain;q=0.5" } });
      } catch {
        busy = true;
        break;
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const next = response.headers.get("location");
        const resolved = next ? new URL(next, url).toString() : null;
        if (!resolved || !publicHttpsUrl(resolved)) return null;
        url = resolved;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status >= 500) {
          busy = true;
          break;
        }
        return null;
      }
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > CEILING_BYTES) {
        await response.body?.cancel();
        return null;
      }
      const text = await readBounded(response);
      if (text === null) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    }
    if (!busy) return null;
  }
  return undefined;
}

async function readBounded(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CEILING_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * What the token says it is. Never throws: a chain or an address that did not
 * answer is `unread`, which the page says as such — never as «no description».
 */
export async function readTokenAbout(mint: string, names: readonly string[] = [], deps: Readonly<{ handle?: SolanaRpcHandle }> = {}): Promise<TokenAbout> {
  /* The mint's own answer is kept as the metadata says it; the page's names only filter what this caller is shown, so no caller's names can change what the next one reads. */
  const hit = kept.get(mint);
  if (hit && Date.now() - hit.at < ttlOf(hit.about)) return withoutNames(hit.about, names);
  const handle = deps.handle ?? createSolanaRpcHandle({ network: "mainnet", timeoutMs: 5_000, retries: 0 });
  const uri = await readUri(mint, handle);
  let about: TokenAbout;
  if (uri === undefined) about = { state: "unread", description: null };
  else if (uri === null) about = { state: "no-metadata", description: null };
  else {
    const address = metadataAddress(uri);
    if (!address) about = { state: "silent", description: null };
    else {
      const json = await fetchJson(address);
      if (json === undefined) about = { state: "unread", description: null };
      else {
        const description = descriptionOf(json);
        about = description ? { state: "described", description } : { state: "silent", description: null };
      }
    }
  }
  remember(mint, about);
  return withoutNames(about, names);
}

/** Tests only. */
export function resetTokenAboutCache(): void {
  kept.clear();
}
