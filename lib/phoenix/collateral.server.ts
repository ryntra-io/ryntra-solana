/**
 * The collateral actions wired for the routes (B6): Phoenix's SDK (`@ellipsis-labs/rise`, the exact version in
 * package.json — B7a §10) builds the instructions from Phoenix's public API alone, no RPC and no key; the configured
 * Solana endpoints read the wallet, simulate and send. The logic is `collateral-actions.ts`.
 */

import "server-only";

import { createPhoenixClient } from "@ellipsis-labs/rise";
import { Connection, PublicKey } from "@solana/web3.js";

import { signatureStates } from "../liquidity/studio/actions.ts";
import { resolveEndpoints } from "../solana/rpc.ts";
import { readUsdcMoved, reviewCollateral as review, submitCollateral as submit, type CollateralDeps, type TraderRead } from "./collateral-actions.ts";
import { admitCollateral, ownAta, ticketKeyConfigured, USDC_MINT, type CollateralAction, type KitInstruction } from "./collateral.ts";
import { PHOENIX_API_URL } from "./market-data.ts";
import { readTraderMargin } from "./read.server.ts";

const SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const connections = new Map<string, Connection>();

/** The mainnet endpoints in order: the configured ones, then Solana's own. */
export function collateralConnections(): readonly Connection[] {
  const urls = [...new Set([...resolveEndpoints("mainnet").map((endpoint) => endpoint.url), SOLANA_PUBLIC_RPC])];
  return urls.map((url) => {
    const known = connections.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
    connections.set(url, known);
    return known;
  });
}

/*
 * One SDK client per process, made again every ten minutes: its exchange addresses (the trader index and buffer arenas)
 * come from one API snapshot and Phoenix may add an arena. No WebSocket: a route asks and answers.
 */
const CLIENT_MS = 10 * 60_000;
let client: { at: number; value: ReturnType<typeof createPhoenixClient> } | null = null;
function phoenix() {
  if (!client || Date.now() - client.at > CLIENT_MS) {
    client?.value.dispose?.();
    client = { at: Date.now(), value: createPhoenixClient({ apiUrl: PHOENIX_API_URL, ws: false }) };
  }
  return client.value;
}

function deps(): CollateralDeps {
  return {
    env: process.env,
    connections: collateralConnections(),
    async readTrader(owner): Promise<TraderRead | null> {
      const read = await readTraderMargin(owner);
      if (!read.ok) return read.code === "NOT_FOUND" ? { found: false } : null;
      return { found: true, margin: read.value };
    },
    async build(request) {
      const params = { authority: request.owner as never, amount: request.amountMicro, traderPdaIndex: 0, traderSubaccountIndex: 0 };
      const built = request.action === "deposit" ? await phoenix().ixs.buildDepositIxs(params) : await phoenix().ixs.buildWithdrawIxs(params);
      return built.instructions as unknown as readonly KitInstruction[];
    },
  };
}

export function reviewCollateral(body: unknown) {
  return review(body, deps());
}

export function submitCollateral(body: unknown) {
  return submit(body, deps());
}

/** The landed transaction's record waits this long: with the status read it stays inside the route's 15 s. */
const STATUS_RECORD_MS = 4_000;

/** The chain's word on a relay's signature — for a receipt whose answer was lost on the way back — and, once landed, the USDC it moved. */
export async function readCollateralSignatures(signatures: readonly string[]) {
  const [connection] = collateralConnections();
  if (!connection) return null;
  try {
    const states = await signatureStates(connection, signatures);
    return await Promise.all(states.map(async (state, index) => (state.state === "LANDED" ? { ...state, usdcMoved: await readUsdcMoved(connection, signatures[index]!, STATUS_RECORD_MS) } : state)));
  } catch {
    return null;
  }
}

/** One endpoint's answer to the panel's read waits this long before the next endpoint is asked. */
const STATES_CALL_MS = 4_000;

function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export type CollateralStates = Readonly<{
  deposit: boolean;
  withdraw: boolean;
  /** The most one canary move takes, a deposit or a withdrawal, micro-dollars; null without a ceiling. */
  maxMicro: string | null;
  /** The same ceiling under its first name, for a tab still open on the release before: drop it a release later. */
  maxDeposit: string | null;
  /** The wallet's USDC, micro-dollars; null when the chain did not answer. */
  walletUsdc: string | null;
}>;

/** What this wallet may do now, and the USDC it holds for a deposit. A wallet the gate does not admit reads as closed. */
export async function readCollateralStates(owner: string | null): Promise<CollateralStates> {
  const env = ticketKeyConfigured(process.env) ? process.env : {};
  const admitted = admitCollateral(owner, env);
  let walletUsdc: string | null = null;
  if (owner) {
    for (const connection of collateralConnections()) {
      try {
        const info = await bounded(connection.getAccountInfo(new PublicKey(ownAta(owner, USDC_MINT)), "confirmed"), STATES_CALL_MS);
        walletUsdc = (info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n).toString();
        break;
      } catch {
        /* The next endpoint. */
      }
    }
  }
  const open = admitted.ok;
  const maxMicro = admitted.ok && admitted.maxMicro !== null ? admitted.maxMicro.toString() : null;
  return { deposit: open, withdraw: open, maxMicro, maxDeposit: maxMicro, walletUsdc };
}

export type { CollateralAction };
export type { CollateralRelay, CollateralReview } from "./collateral-actions.ts";
