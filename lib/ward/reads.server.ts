/**
 * The pre-sign check's reads on a real chain: accounts, the simulation of the exact bytes, an address's history, the
 * epoch — and the two sources the engine already reads beside the chain (the address security source, the market
 * gateway). Every one of them only reads. Server only: the RPC address and the providers' keys never leave it.
 */

import { getBase58Encoder } from "@solana/kit";

import { readAddressEvidence } from "../evidence/service.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { readPayLink } from "../pay/links.server.ts";
import { readRequestIdByReference } from "../pay/store.ts";
import { readMintAccount } from "../solana/mint.ts";
import { checkRecipient } from "../solana/recipient-check.server.ts";
import { readTokenRiskFacts } from "../solana/risk-facts.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";
import { resolveNativeRecipient, resolveTokenRecipient } from "../solana/send-recipient.ts";
import { accountFromRpc, type AccountState } from "./accounts.ts";
import type { WardReads, WardSecurity, WardSimulation } from "./check.ts";

const PAGE = 100;
const base58 = getBase58Encoder();

type RpcValue<T> = Readonly<{ value: T }>;

function index(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry)).slice(0, 400);
}

export function chainReads(handle: SolanaRpcHandle): Pick<WardReads, "accounts" | "simulate" | "history" | "epoch"> {
  const rpc = handle.rpc as unknown as Record<string, (...args: unknown[]) => { send: (options: { abortSignal: AbortSignal }) => Promise<unknown> }>;
  return {
    accounts: async (addresses) => {
      const out = new Map<string, AccountState | null>();
      try {
        for (let at = 0; at < addresses.length; at += PAGE) {
          const page = addresses.slice(at, at + PAGE);
          const answer = (await withRpcDiscipline(handle, (abortSignal) =>
            rpc.getMultipleAccounts(page, { encoding: "base64", commitment: "confirmed" }).send({ abortSignal }),
          )) as RpcValue<readonly unknown[]>;
          if (!Array.isArray(answer.value) || answer.value.length !== page.length) return null;
          page.forEach((address, position) => out.set(address, accountFromRpc(answer.value[position])));
        }
        return out;
      } catch {
        return null;
      }
    },
    simulate: async ({ wireBase64, addresses }): Promise<WardSimulation> => {
      try {
        const answer = (await withRpcDiscipline(handle, (abortSignal) =>
          rpc
            .simulateTransaction(wireBase64, {
              encoding: "base64",
              sigVerify: false,
              replaceRecentBlockhash: true,
              innerInstructions: true,
              commitment: "confirmed",
              accounts: { encoding: "base64", addresses },
            })
            .send({ abortSignal }),
        )) as RpcValue<{ err: unknown; logs?: readonly string[] | null; accounts?: readonly unknown[] | null; innerInstructions?: readonly unknown[] | null }>;
        const value = answer.value;
        const after = new Map<string, AccountState | null>();
        const accounts = Array.isArray(value.accounts) ? value.accounts : [];
        if (accounts.length === addresses.length) addresses.forEach((address, position) => after.set(address, accountFromRpc(accounts[position])));
        const inner = (Array.isArray(value.innerInstructions) ? value.innerInstructions : []).flatMap((group) => {
          const row = group as { index?: unknown; instructions?: readonly unknown[] };
          const at = index(row.index);
          if (at === null || !Array.isArray(row.instructions)) return [];
          const instructions = row.instructions.flatMap((entry) => {
            const ix = entry as { programIdIndex?: unknown; accounts?: readonly unknown[]; data?: unknown };
            const programIndex = index(ix.programIdIndex);
            if (programIndex === null || !Array.isArray(ix.accounts) || typeof ix.data !== "string") return [];
            const accountsOf = ix.accounts.map(index).filter((value): value is number => value !== null);
            try {
              return [{ programIndex, accounts: accountsOf, data: new Uint8Array(base58.encode(ix.data)) }];
            } catch {
              return [];
            }
          });
          return [{ index: at, instructions }];
        });
        return {
          state: "ran",
          err: value.err === null || value.err === undefined ? null : stringify(value.err),
          logs: Array.isArray(value.logs) ? value.logs.slice(-40) : [],
          after,
          inner,
        };
      } catch (failure) {
        return { state: "unavailable", why: failure instanceof Error ? failure.message.slice(0, 200) : "no answer" };
      }
    },
    history: async (address) => {
      try {
        const answer = (await withRpcDiscipline(handle, (abortSignal) => rpc.getSignaturesForAddress(address, { limit: 1, commitment: "confirmed" }).send({ abortSignal }))) as readonly unknown[];
        return Array.isArray(answer) ? (answer.length === 0 ? "none" : "some") : null;
      } catch {
        return null;
      }
    },
    epoch: async () => {
      try {
        const answer = (await withRpcDiscipline(handle, (abortSignal) => rpc.getEpochInfo({ commitment: "confirmed" }).send({ abortSignal }))) as { epoch?: unknown };
        return typeof answer.epoch === "bigint" ? answer.epoch : typeof answer.epoch === "number" ? BigInt(answer.epoch) : null;
      } catch {
        return null;
      }
    },
  };
}

/** The address security source the Send page already asks, in the three answers the check weighs. */
export async function securityRead(address: string): Promise<WardSecurity | null> {
  const read = await readAddressEvidence({ address }).catch(() => null);
  const evidence = read?.evidence ?? null;
  if (!evidence) return { state: "unavailable", sanctioned: null, band: null };
  const sanctions = evidence.sanctions.state;
  const findings = evidence.findings.state;
  if (findings === "unavailable" && (sanctions === "unavailable" || sanctions === "unknown")) return { state: "unavailable", sanctioned: null, band: null };
  return {
    state: findings === "unsupported" ? "unsupported" : "answered",
    sanctioned: sanctions === "sanctioned" ? true : sanctions === "clean" ? false : null,
    band: evidence.findings.band,
  };
}

export function tokenFactsRead(mint: string) {
  return readTokenRiskFacts({ mint });
}

/** The hosts whose `/pay/<id>` is a Ryntra link, beside the one a request reached. */
export const WARD_LINK_HOSTS = ["ryntra.io", "www.ryntra.io"] as const;

/**
 * The link classifier the transfer builder uses (`/api/v1/money/recipient`), on a real chain and the payment links'
 * store — one wiring for `POST /api/v1/ward/check` and the Telegram bot (CITY-166). It reads links; it writes nothing.
 */
export function recipientRead(handle: SolanaRpcHandle, args: Readonly<{ origin: string; store: GuardStore }>): NonNullable<WardReads["recipient"]> {
  const { origin, store } = args;
  return (to, mint, from) =>
    checkRecipient(
      {
        linkHosts: [...new Set([...WARD_LINK_HOSTS, new URL(origin).host])],
        readLink: (id) => readPayLink(store, { id, origin }),
        linkIdByReference: (reference) => readRequestIdByReference(store, reference),
        resolveNative: (address) => resolveNativeRecipient(handle, address),
        resolveToken: ({ address, mint: asset, tokenProgram }) => resolveTokenRecipient({ handle, address, mint: asset, tokenProgram }),
        tokenProgramOf: async (asset) => {
          const read = await readMintAccount(handle, asset);
          return read.ok ? { ok: true, tokenProgram: read.raw.owner } : { ok: false, unavailable: read.code === "RPC_FAILED" };
        },
      },
      { to, ...(mint ? { mint } : {}), ...(from ? { from } : {}) },
    );
}
