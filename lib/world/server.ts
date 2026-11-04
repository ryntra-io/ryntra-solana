import { rpcResult } from "../supabase-rpc";
import { intentWalletProof } from "../account/wallet-session";
import { readSession, readWalletProofFrom } from "../session";
import { createWorldApi, type AccountRead, type WalletRead, type WorldApi } from "./api";
import { createCrewApi, type CrewApi } from "./crew-api";
import { SupabaseCrewStore } from "./crew-store";
import { createLayoutApi, type LayoutApi } from "./layout-api";
import { SupabaseLayoutStore } from "./layout-store";
import { verifyLinkOwnership } from "./link-verify";
import { SupabaseWorldStore } from "./supabase-store";
import type { WorldStore } from "./store";

/**
 * The world as the deployed server runs it: the database through the
 * server's secret-gated functions, the account session and wallet proof the
 * rest of Ryntra already uses (read, never changed), and the engine's own
 * reads for links.
 */

let store: WorldStore | null = null;
let api: WorldApi | null = null;
let layouts: LayoutApi | null = null;
let crews: CrewApi | null = null;

export function worldStore(): WorldStore {
  store ??= new SupabaseWorldStore((fn, args) => rpcResult("world", fn, args));
  return store;
}

async function account(): Promise<AccountRead> {
  const read = await readSession();
  if (read.status === "unavailable") return { status: "unavailable" };
  if (read.status === "ok" && read.session.accountId) return { status: "ok", accountId: read.session.accountId };
  return { status: "absent" };
}

/** Linking binds, so only the wallet's own signature counts — never a wallet the account merely linked. */
async function wallet(req: Request): Promise<WalletRead> {
  const read = await intentWalletProof("mutation", (options) => readWalletProofFrom(req.headers, options));
  if (read.status === "unavailable") return { status: "unavailable" };
  if (read.status === "ok" && read.proof.chain === "solana") return { status: "ok", address: read.proof.address };
  return { status: "absent" };
}

export function worldApi(): WorldApi {
  api ??= createWorldApi({
    store: worldStore(),
    secret: () => process.env.BETA_TOKEN_SECRET ?? null,
    account: () => account(),
    wallet,
    verifyLink: verifyLinkOwnership,
  });
  return api;
}

/** The free layout of a quarter (CITY-55): its own table, the same store, session and guest key as the world. */
export function layoutApi(): LayoutApi {
  layouts ??= createLayoutApi({
    world: worldStore(),
    layouts: new SupabaseLayoutStore((fn, args) => rpcResult("world", fn, args)),
    secret: () => process.env.BETA_TOKEN_SECRET ?? null,
    account: () => account(),
  });
  return layouts;
}

/** Crews (CITY-20): their own tables, the same store, session and guest key as the world. */
export function crewApi(): CrewApi {
  crews ??= createCrewApi({
    world: worldStore(),
    crews: new SupabaseCrewStore((fn, args) => rpcResult("world", fn, args)),
    secret: () => process.env.BETA_TOKEN_SECRET ?? null,
    account: () => account(),
  });
  return crews;
}
