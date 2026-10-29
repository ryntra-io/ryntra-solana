/**
 * A launch the chain shows and the store does not — adopted from the chain.
 *
 * A launch is Ryntra's when Ryntra's pool payer paid for and signed the
 * curve's creation on one of the presets' configs; only the creation can say
 * so, and it is on chain for ever. A send whose answer was lost, or a record
 * removed on a wrong «it never landed», leaves exactly that: a token on the
 * curve and no record. Its record is written again from the chain — the
 * creation, the curve and the mint's own metadata — so the token's page, the
 * creator's cabinet, trades and claims serve it.
 *
 * What only the build knew is not invented: the lock the creator chose was
 * never sent, so the record has none (the chain has none either); the sharing
 * of the creator's fees is what the curve's creator role says now.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { createMeteoraDbcLaunchVenue, type MeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { ensureRewardAccount } from "../rewards/ledger.ts";
import { launchPair, type LaunchNetwork } from "./config.server.ts";
import { writeLaunch, type LaunchRecord } from "./flow.server.ts";

export type AdoptDeps = Readonly<{
  network: LaunchNetwork;
  connection: Connection;
  store: GuardStore;
  /** Ryntra's pool payer's address: a creation it did not pay for and sign is not a Ryntra launch. */
  poolPayer: string;
  /** The endpoint whose signature lists reach back to a token's creation. */
  history: Connection;
  /** Asked for a transaction the main endpoint no longer keeps. */
  archive?: Connection | null;
  now: () => Date;
  /** The venue's chain reads; the Meteora curve's own by default. */
  venue?: Pick<MeteoraDbcLaunchVenue, "presetCurveOf" | "observe" | "observeCreation">;
}>;

/*
 * What was found not to be a Ryntra launch is not asked again for a while: a token page is opened for any mint, and a
 * curve anyone made on a preset's config would otherwise cost a walk of its history on every view. A read that failed
 * is asked again sooner.
 */
const NOT_A_LAUNCH_MS = 10 * 60 * 1000;
const UNREAD_MS = 60 * 1000;
const NOT_ADOPTED = new Map<string, number>();
const NOT_ADOPTED_MAX = 5_000;

function remember(key: string, until: number): null {
  if (NOT_ADOPTED.size >= NOT_ADOPTED_MAX) NOT_ADOPTED.delete(NOT_ADOPTED.keys().next().value as string);
  NOT_ADOPTED.set(key, until);
  return null;
}

/** Signature pages read back to a mint's first transaction; a token busier than this is not adopted from its history. */
const HISTORY_PAGES = 3;
const PAGE = 1000;

/** The mint's first transaction — the one that opened it — or null when its history is longer than a few pages or was not read. */
async function firstSignatureOf(history: Connection, mint: string): Promise<string | null> {
  let before: string | undefined;
  for (let page = 0; page < HISTORY_PAGES; page += 1) {
    const list = await history.getSignaturesForAddress(new PublicKey(mint), { limit: PAGE, before }, "confirmed");
    if (list.length === 0) {
      /* A curve exists, so its mint has a history: an empty first page is a node behind, not an answer. */
      if (!before) throw new Error("The history endpoint has no transaction of this mint yet.");
      return before;
    }
    before = list[list.length - 1]!.signature;
    /* A short page is the list's end: its last row is the first transaction the mint ever had. */
    if (list.length < PAGE) return before;
  }
  return null;
}

/**
 * The launch of `token` as the chain recorded it, written to the store; null when the chain shows no Ryntra launch of
 * it (no curve on a preset's config, a creation another payer made, a failed one) or could not be read now.
 */
export async function adoptLaunch(deps: AdoptDeps, token: string): Promise<LaunchRecord | null> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  if ((NOT_ADOPTED.get(key) ?? 0) > now) return null;
  const venue = deps.venue ?? createMeteoraDbcLaunchVenue({ connection: deps.connection, configs: deps.network.configs, poolPayer: deps.poolPayer, archive: deps.archive ?? null, history: deps.history, curveRules: deps.network.curveRules ?? null });
  const notALaunch = () => remember(key, now + NOT_A_LAUNCH_MS);
  const unread = () => remember(key, now + UNREAD_MS);
  /* One read for a token that is not a launch: no curve on a preset's config, nothing further is asked. */
  let curve: string | null;
  try {
    curve = await venue.presetCurveOf(token);
  } catch {
    return unread();
  }
  if (!curve) return notALaunch();
  let signature: string | null;
  try {
    signature = await firstSignatureOf(deps.history, token);
  } catch {
    return unread();
  }
  /* A history longer than a few pages is not walked on a page view: such a token is not adopted here. */
  if (!signature) return notALaunch();
  const [creation, observation] = await Promise.all([venue.observeCreation(signature, token), venue.observe(token)]).catch(() => [null, null] as const);
  if (!creation || !observation) return unread();
  const init = creation.initialized;
  /* Ryntra's launch: the creation of this curve, landed, paid for and signed by Ryntra's pool payer, on a preset's config. */
  if (creation.failed || !init || init.baseMint !== token || init.pool !== curve || init.payer !== deps.poolPayer) return notALaunch();
  if (creation.feePayer !== deps.poolPayer || !creation.signers.includes(deps.poolPayer)) return notALaunch();
  if (!observation.preset || observation.config !== init.config) return notALaunch();
  /* The mint's metadata not read is a read that failed, not another token. */
  if (!observation.mint.uri) return unread();
  const preset = observation.preset;
  const sharing = observation.feeSharing;
  const referral = await ensureRewardAccount(deps.store, init.creator, deps.now().toISOString()).catch(() => null);
  const record: LaunchRecord = {
    cluster: deps.network.cluster,
    state: "LAUNCHED",
    token,
    pool: curve,
    config: init.config,
    /* «Спільнота»: the community whose config the curve sits on. */
    pairMint: (preset === "community" ? deps.network.communities.find((pair) => pair.config === init.config) : undefined)?.mint ?? launchPair(deps.network, preset).mint,
    preset,
    creator: init.creator,
    name: observation.mint.name ?? "",
    symbol: observation.mint.symbol ?? "",
    metadataUri: observation.mint.uri,
    signature,
    validUntil: "0",
    firstBuyInRaw: creation.creatorQuoteInRaw,
    firstBuyOutRaw: creation.creatorTokensOutRaw,
    lock: null,
    feeSharing: sharing
      ? { vault: sharing.vault, shares: sharing.users.map((user) => ({ address: user.address, bps: user.share })), signature: null, state: "SHARED", reason: null }
      : null,
    buildId: "",
    referralCode: referral?.code ?? null,
    launchedAt: new Date((creation.blockTime ?? Math.floor(deps.now().getTime() / 1000)) * 1000).toISOString(),
  };
  /* A record written meanwhile — the send's own — is the one kept. */
  const existing = await deps.store.collection<LaunchRecord>("launches").get(`solana:${record.cluster}:${token}`);
  if (existing) return existing;
  await writeLaunch(deps.store, record);
  NOT_ADOPTED.delete(key);
  return record;
}
