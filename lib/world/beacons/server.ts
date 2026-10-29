import { deliverToTelegramChannel, readTelegramChannel } from "../../account/notifications";
import { getGuardRuntime } from "../../guard/runtime";
import { readSession } from "../../session";
import { rpcResult } from "../../supabase-rpc";
import { sendPlainMessage } from "../../telegram/api";
import { coinLink } from "../../../city/lib/share/coin-link";
import { readCity } from "../../../city/lib/market/jupiter";
import type { AccountRead } from "../api";
import { createBeaconApi, type BeaconApi } from "./api";
import { READ_FRESH_MS, type TowerRead } from "./rules";
import { runBeacons, type MarketRead, type RunReport } from "./run";
import { SupabaseBeaconStore, type BeaconStore } from "./store";

/**
 * The beacons as the deployed server runs them: the world's database through
 * its secret-gated functions, the account session the rest of Ryntra uses
 * (read, never changed), the city's own market read, and the one path every
 * sender takes to an account's Telegram chat (`deliverToTelegramChannel`).
 */

let store: BeaconStore | null = null;
let api: BeaconApi | null = null;

function beaconStore(): BeaconStore {
  store ??= new SupabaseBeaconStore((fn, args) => rpcResult("world", fn, args));
  return store;
}

async function account(): Promise<AccountRead> {
  const read = await readSession();
  if (read.status === "unavailable") return { status: "unavailable" };
  if (read.status === "ok" && read.session.accountId) return { status: "ok", accountId: read.session.accountId };
  return { status: "absent" };
}

export function beaconApi(): BeaconApi {
  api ??= createBeaconApi({
    store: beaconStore(),
    account: () => account(),
    telegram: async (accountId) => ((await readTelegramChannel(getGuardRuntime().store, accountId)) ? "linked" : "unlinked"),
  });
  return api;
}

/** The city's market as the beacons read it: the same read `/api/city` serves, only when it is live and fresh. */
async function market(): Promise<MarketRead | null> {
  const { snapshot } = await readCity();
  if (!snapshot || snapshot.source !== "live") return null;
  const at = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(at) || Date.now() - at > READ_FRESH_MS) return null;
  const towers = new Map<string, TowerRead>(snapshot.towers.map((t) => [t.id, { price: t.price, liquidity: t.liquidity, change5m: t.change5m, change1h: t.change1h, change24h: t.change24h }]));
  return { towers, at };
}

export async function runServerBeacons(): Promise<RunReport> {
  const guard = getGuardRuntime().store;
  return runBeacons({
    store: beaconStore(),
    market,
    link: coinLink,
    telegram: (accountId, text, link) =>
      deliverToTelegramChannel(guard, accountId, text, async (chatId, said) => {
        const sent = await sendPlainMessage(chatId, said, [[{ text: "Open tower", url: link }]]);
        if (!sent) throw new Error("not delivered");
        return sent;
      }),
  });
}
