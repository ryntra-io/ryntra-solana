/**
 * `.skr` names in the browser (SKR-4) — over `GET /api/v1/research/skr-name`, never over an RPC of the browser's own.
 *
 * The two directions keep the server's rules. A name's address is asked for every time, with `no-store`, and nothing
 * here keeps it: «Надіслати» calls `resolveSkrName` once to show it and again right before the wallet opens. An
 * address's name is a label, so this tab keeps it for the page's life (the server keeps it an hour), and the wallet,
 * the Portfolio and the receipts that show the same address share one read.
 */

import { shownSkrName, skrNameOf } from "./skr-name.ts";

export type SkrResolve =
  | Readonly<{ state: "FOUND"; name: string; address: string }>
  | Readonly<{ state: "NOT_FOUND"; name: string }>
  | Readonly<{ state: "UNAVAILABLE"; name: string }>;

type Fetch = typeof fetch;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ROUTE = "/api/v1/research/skr-name";
const HEADERS = { accept: "application/json", "X-Ryntra-API": "1" } as const;

/** A `.skr` name to the address that owns it now — asked of the server every call, never kept. */
export async function resolveSkrName(input: string, options: Readonly<{ fetchImpl?: Fetch; signal?: AbortSignal }> = {}): Promise<SkrResolve> {
  const name = skrNameOf(input);
  if (!name) throw new Error("not a .skr name");
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${ROUTE}?name=${encodeURIComponent(name)}`, { headers: HEADERS, cache: "no-store", signal: options.signal });
    if (!response.ok) return { state: "UNAVAILABLE", name };
    const body = (await response.json()) as Record<string, unknown>;
    /* The answer must be about the name that was asked, or it answers nothing. */
    if (body.direction !== "name" || shownSkrName(body.name) !== name) return { state: "UNAVAILABLE", name };
    if (body.state === "FOUND" && typeof body.address === "string" && BASE58.test(body.address)) return { state: "FOUND", name, address: body.address };
    if (body.state === "NOT_FOUND") return { state: "NOT_FOUND", name };
    return { state: "UNAVAILABLE", name };
  } catch (failure) {
    if (failure instanceof DOMException && failure.name === "AbortError") throw failure;
    return { state: "UNAVAILABLE", name };
  }
}

/* An address's name for ten minutes of this tab: a label, never a destination. A failed read is not kept. */
const NAME_TTL_MS = 10 * 60_000;
const names = new Map<string, Readonly<{ at: number; read: Promise<string | null> }>>();
const UNREAD = Symbol("unread");

/** The name to show for an address — the primary one, and for `self` the first one held — or `null`. */
export function skrNameFor(address: string, options: Readonly<{ self?: boolean; fetchImpl?: Fetch }> = {}): Promise<string | null> {
  if (!BASE58.test(address)) return Promise.resolve(null);
  const self = options.self === true;
  const key = `${self ? "self" : "any"}:${address}`;
  const known = names.get(key);
  if (known && Date.now() - known.at < NAME_TTL_MS) return known.read;
  const fetchImpl = options.fetchImpl ?? fetch;
  const read = (async (): Promise<string | null | typeof UNREAD> => {
    try {
      const response = await fetchImpl(`${ROUTE}?address=${encodeURIComponent(address)}${self ? "&self=1" : ""}`, { headers: HEADERS });
      if (!response.ok) return UNREAD;
      const body = (await response.json()) as Record<string, unknown>;
      if (body.direction !== "address" || body.address !== address || body.state === "UNAVAILABLE") return UNREAD;
      return body.state === "FOUND" ? shownSkrName(body.name) : null;
    } catch {
      return UNREAD;
    }
  })().then((value) => {
    /* Not kept: the next page that shows this address asks again. */
    if (value === UNREAD) {
      names.delete(key);
      return null;
    }
    return value;
  });
  names.set(key, { at: Date.now(), read });
  return read;
}

/** For tests: forget every name this tab kept. */
export function forgetSkrNamesForTests(): void {
  names.clear();
}
