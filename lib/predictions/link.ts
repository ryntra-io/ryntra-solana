/**
 * The identity mapping: one explicit wallet signature opens the provider's
 * session for the proven Ryntra wallet, the server binds that session to the
 * stable Ryntra id through the provider's Partner External ID Linking, and the
 * person never sees a second profile.
 *
 *   start   — the provider issues its own nonce; the server builds the SIWS
 *             message for the proven wallet and this site; the browser signs
 *             exactly that text (the Ryntra proof is never reused — the
 *             provider's contract issues its own challenge).
 *   verify  — the message must name the proven wallet; the provider verifies
 *             the signature and answers a session for a user it created or
 *             restored for that address; the server checks the provider's
 *             own record of the wallet, signs the assertion
 *             `{externalId}:{timestamp}` with the app secret and links it;
 *             the tokens are sealed and stored under the wallet.
 *   heal    — when the assertion could not be signed at verify time (no
 *             signing key on the deployment yet), the next account read
 *             links it as soon as the key exists.
 *
 * Nothing here logs a token, a signature or a secret. Server only.
 */

import { signExternalId } from "@agg-build/sdk/server";

import type { GuardStore } from "../guard/store.ts";
import { readPredictionsEnv, ryntraExternalId } from "./env.ts";
import { failure, type PredictionFailure } from "./failure.ts";
import type { PredictionProvider, ProviderUserProfile, Result } from "./provider.ts";
import { accessExpiry, linkAvailability, linkStatus, readLink, withProviderSession, writeLink, type LinkStatus, type PredictionLinkRecord } from "./session.ts";
import { seal } from "./vault.ts";

export type LinkChallenge = Readonly<{ message: string; nonce: string; statement: string | null; wallet: string }>;

const HEX = /^[0-9a-fA-F]{32,}$/;

/** What the wallet shows the person: Ryntra's own sentence, in the person's language — no transaction, simulated funds. */
export function linkStatement(locale: "en" | "uk"): string {
  return locale === "uk"
    ? "Ryntra Predictions: увімкнути paper-торгівлю. Симульовані кошти, без транзакції."
    : "Ryntra Predictions: enable paper trading. Simulated funds, no transaction.";
}

export async function startLink(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  site: Readonly<{ domain: string; uri: string; locale?: "en" | "uk" }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Result<LinkChallenge>> {
  const availability = linkAvailability(store, env);
  if (!availability.available) return failure("LINK_UNAVAILABLE", availability.reason === "no_session_secret" ? "This deployment cannot hold a paper account session." : "The paper account needs a durable store; this deployment has none.");
  const challenge = await provider.signInChallenge({ address: wallet, domain: site.domain, uri: site.uri, statement: linkStatement(site.locale ?? "en") });
  if (!challenge.ok) return challenge;
  return { ok: true, value: { message: challenge.value.message, nonce: challenge.value.nonce, statement: challenge.value.statement, wallet } };
}

/** The address a SIWS message is for: its second line. */
export function siwsAddress(message: string): string | null {
  const lines = message.split("\n");
  const address = lines[1]?.trim() ?? "";
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
}

function providerHolds(profile: ProviderUserProfile, wallet: string): boolean {
  return profile.wallets.some((w) => w.address === wallet);
}

type Assertion = Readonly<{ externalId: string; timestamp: number; hmac: string }>;

function assertionFor(wallet: string, env: NodeJS.ProcessEnv): Readonly<{ assertion: Assertion } | { error: "signing_key_missing" | "signing_key_invalid" }> {
  const { appSecret } = readPredictionsEnv(env);
  if (!appSecret) return { error: "signing_key_missing" };
  if (!HEX.test(appSecret)) return { error: "signing_key_invalid" };
  return { assertion: signExternalId(appSecret, ryntraExternalId(wallet)) };
}

export async function verifyLink(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  input: Readonly<{ message: string; signature: string }>,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): Promise<Result<LinkStatus>> {
  const availability = linkAvailability(store, env);
  if (!availability.available) return failure("LINK_UNAVAILABLE", "This deployment cannot hold a paper account session.");
  const signedFor = siwsAddress(input.message);
  if (!signedFor || signedFor !== wallet) return failure("WALLET_MISMATCH", "The signed message is not for the wallet this session proved.");

  const session = await provider.verifySignIn({ message: input.message, signature: input.signature });
  if (!session.ok) return session;
  const { user } = session.value;
  if (!providerHolds(user, wallet)) {
    await provider.signOut({ accessToken: session.value.accessToken }).catch(() => null);
    return failure("WALLET_MISMATCH", "The provider opened a session for a different wallet.");
  }

  const externalId = ryntraExternalId(wallet);
  let externalIdLinked = user.externalId === externalId;
  let linkError: string | null = null;
  if (!externalIdLinked) {
    const prepared = assertionFor(wallet, env);
    if ("error" in prepared) {
      linkError = prepared.error;
    } else {
      const linked = await provider.linkExternalId({ accessToken: session.value.accessToken }, prepared.assertion);
      if (linked.ok && linked.value.externalId === externalId) externalIdLinked = true;
      else linkError = linked.ok ? "provider_kept_other_id" : `provider_refused:${linked.code}`;
    }
  }

  const stamp = new Date(nowMs).toISOString();
  const existing = await readLink(store, wallet);
  const record: Omit<PredictionLinkRecord, "version"> = {
    wallet,
    externalId,
    providerUserId: user.id,
    providerWallet: user.wallets.find((w) => w.address === wallet)?.address ?? null,
    externalIdLinked,
    linkAttemptedAt: stamp,
    linkError,
    access: seal(session.value.accessToken, env),
    refresh: session.value.refreshToken ? seal(session.value.refreshToken, env) : null,
    accessExpiresAt: accessExpiry(session.value.accessToken, nowMs),
    state: "active",
    stateReason: null,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
    refreshedAt: null,
  };
  const written = await writeLink(store, record, existing?.version ?? null);
  if ("ok" in written && written.ok === false) return written as PredictionFailure;
  return { ok: true, value: await linkStatus(store, wallet, env) };
}

/**
 * Link the external id on a session that could not be linked at verify
 * time. Called by the account read; a no-op when linked, when the key is
 * still missing, or when the last attempt was under a minute ago.
 */
export async function healExternalIdLink(store: GuardStore, provider: PredictionProvider, wallet: string, env: NodeJS.ProcessEnv = process.env, nowMs: number = Date.now()): Promise<void> {
  const record = await readLink(store, wallet);
  if (!record || record.state !== "active" || record.externalIdLinked) return;
  if (record.linkAttemptedAt && nowMs - Date.parse(record.linkAttemptedAt) < 60_000 && record.linkError?.startsWith("provider_refused")) return;
  const prepared = assertionFor(wallet, env);
  if ("error" in prepared) return;
  const result = await withProviderSession(store, provider, wallet, async (session) => provider.linkExternalId(session, prepared.assertion), env, nowMs);
  const current = await readLink(store, wallet);
  if (!current) return;
  const stamp = new Date(nowMs).toISOString();
  const linked = result.ok && result.value.externalId === current.externalId;
  await writeLink(
    store,
    { ...current, externalIdLinked: linked, linkAttemptedAt: stamp, linkError: linked ? null : result.ok ? "provider_kept_other_id" : `provider_refused:${result.code}`, updatedAt: stamp },
    current.version,
  );
}
