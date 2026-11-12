import { createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import { after } from "next/server";

import { clientIp, privateNoStoreHeaders } from "@/lib/http-control";
import { modelGateway } from "@/lib/models/gateway.server";
import { createStamper, signerOf } from "@/lib/ring/judge/stamp";
import { SEAL_SECRET_ENV, keyMode } from "@/lib/ring/ready";
import { createSealer } from "@/lib/ring/seal";
import { ringStore } from "@/lib/ring/server";
import { MATCH, WEIGHT_BOUNDS } from "@/lib/ring/weight";
import { decideBearerAuth } from "@/lib/security";
import { readSession, readWalletProof } from "@/lib/session";
import { rpcResult } from "@/lib/supabase-rpc";
import { networkOf } from "@/lib/vault/identity";

import { createMachineBackend, type MachineStamp } from "../machine/backend.ts";
import { createProcessDriver, netnsWrap, toWslPath, wslWrap } from "../machine/drivers/process.ts";
import { createVercelDriver, vercelTransport } from "../machine/drivers/vercel.ts";
import type { MachineDriver } from "../machine/protocol.ts";
import { runSelftest } from "../machine/selftest.ts";
import { catalogue } from "../ranges/catalogue.ts";
import { practiceMoves } from "../ranges/practice.ts";
import { RANGE_ENGINE } from "../ranges/range.ts";
import { modelBrain } from "../runner/brain.ts";
import { LIMIT_CAPS } from "../sandbox/index.ts";
import { stubBrain } from "../runner/stub-brain.ts";
import { createMemoryRunStore } from "../runs/memory.ts";
import { createRunService, dailyCapMicroUsd, RUN_LIMITS, RUN_MOVE_MS, type BrainAsk, type RunBrain, type RunService } from "../runs/service.ts";
import { createSupabaseRunStore } from "../runs/supabase.ts";
import type { RunStore } from "../runs/contract.ts";
import { createHackApi, type CallerRead, type HackApi } from "./api.ts";
import type { HackDb } from "./contract.ts";
import { createMemoryHackDb } from "./memory.ts";
import { HACK_ENV, HACK_STAND_COOKIE, hackReady, hackStoreKind, machineSetup, standMode, standWallet } from "./ready.ts";
import { createHackService, type AgentRead, type HackService } from "./service.ts";
import { createSupabaseHackDb } from "./supabase.ts";
import { walletVerifier } from "./verify.ts";

/**
 * Hack as the deployed server runs it (CITY-226, CITY-238): the database every instance shares through the secret-gated
 * `public.hack_*` functions (`supabase/migrations/20261108180000_hack_v1.sql`, `20261110120000_hack_v2_runs.sql`), the
 * wallet the person signed in with (a write reads only a wallet that signed in itself; a read may also see a linked
 * one), the Ring's agents (CITY-50) for whose agent a hunter is, and the owner's permission checked against their
 * wallet's signature (`verify.ts`).
 *
 * Since CITY-238 a take starts the agent's run (`../runs/service.ts`): its brain is the model gateway (CITY-45) with
 * the agent's own key, read back sealed and opened for the run, as the Ring's duels do; its sandbox is a machine with
 * no network — Vercel Sandbox, started from the image's snapshot with every way out denied (`../machine/`); the
 * harness's stamp key comes from the server's environment (`RYNTRA_HACK_STAMP_KEY`, never the repository) and never
 * goes to the machine; the day's ceiling on Hack's models is `RYNTRA_HACK_DAILY_USD`. A finding's proof is the judge's
 * verdict on that run, and only that.
 *
 * Closed (404) until `NEXT_PUBLIC_RYNTRA_CITY_HACK` says `open`; production stays closed on one instance's memory and
 * without the machine and its stamp key (`ready.ts`). On a developer's stand (`RYNTRA_HACK_STAND=1`, never
 * production) agents are names, the brain is the one without a model, and the machine is a process in a network
 * namespace with no interface.
 */

/**
 * The stores, kept on the process rather than on this module: a developer's server evaluates the module again whenever
 * a file changes, and a stand's memory stores — its orders, takes, findings and runs — must outlive that. On a
 * deployment the module is evaluated once and this is the same thing.
 */
type Stores = { db: HackDb | null; runs: RunStore | null };
const STORES = Symbol.for("ryntra.hack.stores");
const held = globalThis as { [STORES]?: Stores };
const stores: Stores = (held[STORES] ??= { db: null, runs: null });

let service: HackService | null = null;
let runService: RunService | null = null;
let api: HackApi | null = null;
let stampKeys: MachineStamp | null | undefined;

const stand = () => standMode(process.env);

/** The key a network is counted under: the deployment's own secret, or one per process on a developer's machine. */
const NETWORK_KEY = process.env.BETA_TOKEN_SECRET?.trim() || randomBytes(32).toString("hex");

function network(req: Request): string {
  const hashed = createHmac("sha256", NETWORK_KEY).update(`hack-ip:${networkOf(clientIp(req.headers))}`).digest("hex").slice(0, 32);
  return `ip:${hashed}`;
}

async function caller(_req: Request, mode: "read" | "write"): Promise<CallerRead> {
  // A developer's stand plays as the wallet its cookie names (`standWallet`); never in production.
  if (stand()) {
    const { cookies } = await import("next/headers");
    const wallet = standWallet(process.env, (await cookies()).get(HACK_STAND_COOKIE)?.value);
    return wallet ? { status: "ok", caller: { wallet, account: null } } : { status: "absent" };
  }
  const proof = await readWalletProof({ allowLink: mode === "read" });
  if (proof.status === "unavailable") return { status: "unavailable" };
  if (proof.status !== "ok" || proof.proof.chain !== "solana") return { status: "absent" };
  if (mode === "read") return { status: "ok", caller: { wallet: proof.proof.address, account: null } };
  // The account whose agents this person sends (the Ring's agents live under `a:<account id>`).
  const session = await readSession();
  if (session.status === "unavailable") return { status: "unavailable" };
  const account = session.status === "ok" && session.session.accountId ? `a:${session.session.accountId}` : null;
  return { status: "ok", caller: { wallet: proof.proof.address, account } };
}

/** Whose agent a hunter is, from the Ring's own store. Not asked on a developer's stand, where agents are names. */
async function agentOf(hunter: string): Promise<AgentRead> {
  const record = await ringStore().agent(hunter);
  return record ? { account: record.owner, active: record.status === "active" } : null;
}

/**
 * The harness's stamp: the key from the server's environment, and its public signer. On a developer's machine without
 * one, a fresh key per process; production has none without the setting — and then stays closed.
 */
function harnessStamp(): MachineStamp | null {
  if (stampKeys !== undefined) return stampKeys;
  const pem = process.env[HACK_ENV.stamp]?.trim();
  try {
    const key: KeyObject | null = pem ? createPrivateKey(pem.replace(/\\n/g, "\n")) : process.env.NODE_ENV === "production" ? null : generateKeyPairSync("ed25519").privateKey;
    stampKeys = key ? { stamp: createStamper(key), signer: signerOf(createPublicKey(key)) } : null;
  } catch {
    console.error("[hack] the harness's stamp key does not read as Ed25519");
    stampKeys = null;
  }
  return stampKeys;
}

/** The deployment's own token for Vercel's API: one the owner set for the machines, or the function's OIDC token. */
function vercelToken(): string | null {
  const own = process.env[HACK_ENV.token]?.trim();
  if (own) return own;
  const context = (globalThis as Record<symbol, { get?: () => { headers?: Record<string, string | undefined> } | undefined } | undefined>)[Symbol.for("@vercel/request-context")];
  return context?.get?.()?.headers?.["x-vercel-oidc-token"] ?? process.env.VERCEL_OIDC_TOKEN?.trim() ?? null;
}

/**
 * Where a run plays. Production: Vercel Sandbox, from the image's snapshot — the token is read now, while the request
 * that starts the run is still here. A developer's stand: a process in a network namespace with no interface (on
 * Windows inside WSL), from the image folder the stand names. `null` — no machine: no run is played.
 */
function machineDriver(): MachineDriver | null {
  if (stand()) {
    const kind = process.env.RYNTRA_HACK_STAND_MACHINE?.trim();
    const image = process.env.RYNTRA_HACK_STAND_IMAGE?.trim();
    if (!image || (kind !== "wsl" && kind !== "netns")) return null;
    const node = process.env.RYNTRA_HACK_STAND_NODE?.trim() || "node";
    const entry = `${image.replace(/\/+$/, "")}/app/city/lib/arena/hack/machine/entry.mjs`;
    return createProcessDriver({ node, entry, wrap: kind === "wsl" ? wslWrap() : netnsWrap(), isolated: true, ...(kind === "wsl" ? { toMachinePath: toWslPath } : {}) });
  }
  const setup = machineSetup(process.env);
  if (!setup.ready || !setup.snapshotId || !setup.projectId) return null;
  const token = vercelToken();
  return createVercelDriver({ transport: vercelTransport({ token: () => token }), snapshotId: setup.snapshotId, projectId: setup.projectId, ...(setup.teamId ? { teamId: setup.teamId } : {}) });
}

/** Whether this deployment can play a run at all: a machine, and the stamp to seal it with. */
const machineReady = (): boolean => harnessStamp() !== null && (stand() ? machineDriver() !== null : machineSetup(process.env).ready);

/** The stand's brain without a model: the range's known moves, through the same loop and the same four tools. */
const STAND_MOVE_MICRO_USD = 500;

async function brainOf(ask: BrainAsk): Promise<RunBrain | null> {
  if (stand()) {
    const range = catalogue().list().find((r) => r.id === ask.range);
    const moves = range ? practiceMoves(range, ask.payers[0]!) : null;
    if (!moves) return null;
    return { brain: stubBrain({ plan: moves, moveMicroUsd: STAND_MOVE_MICRO_USD }), moveMicroUsd: STAND_MOVE_MICRO_USD, ceilingMicroUsd: WEIGHT_BOUNDS.light };
  }
  const store = ringStore();
  const record = await store.agent(ask.hunter);
  if (!record || record.status !== "active") return null;
  if (keyMode(process.env) !== "live" || record.key.state !== "live" || !record.key.hash) return null;
  const sealer = createSealer(process.env[SEAL_SECRET_ENV]);
  const sealed = sealer ? await store.sealedKey(record.id, record.key.hash) : null;
  const apiKey = sealer && sealed ? sealer.open(record.id, sealed) : null;
  if (!apiKey) return null;
  // A run is worked through tools, with no thinking budget: a brain that cannot do that stays quiet.
  const model = { id: record.brain.id, providers: [record.brain.provider] };
  const fit = await modelGateway().preflight(model, { tools: true, reasoningTokens: 0 });
  if (!fit.ok) return null;
  const moveMicroUsd = Math.ceil(record.brain.matchMicroUsd / MATCH.moves);
  return {
    brain: modelBrain({
      gateway: modelGateway(),
      agent: { id: record.id, model: model.id, providers: model.providers, scenario: record.scenario },
      apiKey,
      moveMicroUsd,
      moveMs: RUN_MOVE_MS,
    }),
    moveMicroUsd,
    // The class's ceiling for one piece of work, as a duel holds a seat to it.
    ceilingMicroUsd: WEIGHT_BOUNDS[record.brain.weight],
  };
}

/**
 * A stand's own wall of time for one attempt (`RYNTRA_HACK_STAND_WALL_MS`, never production): a developer's computer
 * that is drawing the city and building the site at once may take longer to start the machine's process than a
 * deployment ever does. The whole run's wall, and how long a run may go unwritten, grow with it.
 */
function standWalls(): { limits: typeof RUN_LIMITS; runMs: number; stalledMs: number } | null {
  if (!stand()) return null;
  const ms = Number(process.env.RYNTRA_HACK_STAND_WALL_MS?.trim());
  if (!Number.isSafeInteger(ms) || ms < RUN_LIMITS.ms || ms > LIMIT_CAPS.ms) return null;
  return { limits: { ...RUN_LIMITS, ms }, runMs: ms * 12, stalledMs: ms * 3 + 30_000 };
}

function runs(kept: HackDb): RunService {
  stores.runs ??= hackStoreKind(process.env) === "database" ? createSupabaseRunStore((fn, args) => rpcResult("hack", fn, args)) : createMemoryRunStore({ takes: (order) => kept.takes(order) });
  const store = stores.runs;
  runService ??= createRunService({
    runs: store,
    order: async (id) => (await kept.getOrder(id))?.order ?? null,
    ranges: catalogue(),
    backend: () => {
      const driver = machineDriver();
      const stamp = harnessStamp();
      if (!driver || !stamp) throw new Error("no machine to play on");
      return createMachineBackend({ driver, stamp, engine: RANGE_ENGINE, onFault: (line) => console.error(line) });
    },
    brain: brainOf,
    // A finding the judge sealed goes through the same service the routes use: the same rules, the same lock.
    file: async ({ finding, owner }) => {
      const filed = await hackService(kept).submit(
        { wallet: owner, account: null },
        { id: finding.id, order: finding.order, hunter: finding.hunter, target: finding.target, vulnClass: finding.vulnClass, severity: finding.severity, title: finding.title, logHash: finding.logHash },
      );
      return filed.ok ? filed.value.finding.id : null;
    },
    capMicroUsd: () => dailyCapMicroUsd(process.env[HACK_ENV.ceiling]),
    now: Date.now,
    background: (task) => after(() => task),
    log: (line) => console.error(line),
    ...(standWalls() ?? {}),
  });
  return runService;
}

function hackService(kept: HackDb): HackService {
  service ??= createHackService({
    db: kept,
    verify: walletVerifier,
    // The judge's verdict on the run that is filing this finding (`../runs/service.ts`); nothing else is a proof.
    prove: async ({ finding }) => runs(kept).proofFor(finding),
    agentOf: stand() ? undefined : agentOf,
    // With a machine to play on, an order opens only on a copy the machine holds.
    ...(machineReady() ? { playable: (target: Parameters<ReturnType<typeof catalogue>["forTarget"]>[0]) => catalogue().forTarget(target) !== null } : {}),
    now: Date.now,
    newId: () => `f-${randomUUID()}`,
  });
  return service;
}

export function hackApi(): HackApi {
  stores.db ??= hackStoreKind(process.env) === "database" ? createSupabaseHackDb((fn, args) => rpcResult("hack", fn, args)) : createMemoryHackDb();
  const kept = stores.db;
  api ??= createHackApi({
    service: () => hackService(kept),
    // The switch (`HACK_FLAG`) is read as the city reads it, inlined at build; production opens on the database only,
    // and only with the machine that plays the runs.
    open: () => hackReady(kept, process.env.NEXT_PUBLIC_RYNTRA_CITY_HACK, process.env.NODE_ENV, machineReady()),
    caller,
    network,
    store: kept,
    // Without a machine nothing is launched: the window follows the agent through the order's own record.
    ...(machineReady() ? { runs: () => runs(kept) } : {}),
  });
  return api;
}

/**
 * The operator's check of the machine on this very deployment, before the door opens (`GET /api/arena/hack/machine`
 * with `Authorization: Bearer <CRON_SECRET>`): one run of each training range on a real machine, with the deployment's
 * own token, snapshot and stamp key — and whether the store of runs answers (its migration is applied). It answers
 * whatever the door's switch says, and files nothing.
 */
export async function hackMachineCheck(req: Request): Promise<Response> {
  const headers = { "content-type": "application/json; charset=utf-8", ...privateNoStoreHeaders() };
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  const authorized = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") }, process.env.CRON_SECRET);
  if (authorized !== "authorized") return answer(401, { ok: false });
  const driver = machineDriver();
  const stamp = harnessStamp();
  if (!driver || !stamp) return answer(503, { ok: false, missing: stand() ? ["RYNTRA_HACK_STAND_MACHINE", "RYNTRA_HACK_STAND_IMAGE"] : machineSetup(process.env).missing });
  stores.db ??= hackStoreKind(process.env) === "database" ? createSupabaseHackDb((fn, args) => rpcResult("hack", fn, args)) : createMemoryHackDb();
  const [result, store] = await Promise.all([runSelftest({ driver, ranges: catalogue(), stamp }), runs(stores.db).reachable()]);
  // Both must hold before the door opens: the machine plays, and the runs can be kept.
  const ok = result.ok && store;
  return answer(ok ? 200 : 502, { ...result, ok, runStore: store ? "ok" : "unavailable" });
}
