/**
 * CITY-163 — proof that this deployment reaches its KMS keys, with no coin and no transaction: each role's public key read
 * through the same way in a signature takes (Vercel's OIDC token → Google's STS → the service account → `GetPublicKey`),
 * compared with the address the deployment names and the one the attribution registry publishes. It reads public data and
 * nothing else: no call here can ask KMS to sign, and the signer's bounds are not touched.
 */

import { kmsEndpoint, kmsPublicAddress, kmsTokenSource, KMS_KEY_VERSION, type Fetch } from "./gcp-kms.server.ts";
import { LAUNCH_SIGNER_ENV, launchSignerMode } from "./select.server.ts";
import type { LaunchSignerRole } from "./signer.server.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type SignerRoleCheck = Readonly<{
  role: LaunchSignerRole;
  /** The address the deployment names for the role, and the one the registry publishes (null off mainnet). */
  named: string | null;
  registry: string | null;
  /** The address read from KMS; null when it could not be read, and then `error` says why, a status and no body. */
  read: string | null;
  ready: boolean;
  error: string | null;
}>;

export type SignerCheck = Readonly<{ mode: "env" | "kms" | null; ready: boolean; roles: readonly SignerRoleCheck[] }>;

const ROLES: readonly LaunchSignerRole[] = ["pool-payer", "executor"];

export async function launchSignerCheck(env: Env, registry: (role: LaunchSignerRole) => string | null, options: Readonly<{ fetch?: Fetch; oidcToken?: () => Promise<string | null> }> = {}): Promise<SignerCheck> {
  const mode = launchSignerMode(env);
  /* `env` holds its keys in the environment: there is no way in to prove. */
  if (mode !== "kms") return { mode, ready: false, roles: [] };
  const endpoint = kmsEndpoint(env.RYNTRA_LAUNCH_KMS_ENDPOINT);
  const token = kmsTokenSource(env, options);
  const roles = await Promise.all(
    ROLES.map(async (role): Promise<SignerRoleCheck> => {
      const names = LAUNCH_SIGNER_ENV[role];
      const keyVersion = env[names.kmsKey]?.trim() ?? "";
      const named = env[names.address]?.trim() || null;
      const published = registry(role);
      const answer = (error: string | null, read: string | null = null): SignerRoleCheck => ({ role, named, registry: published, read, ready: error === null && read !== null && read === named && (published === null || read === published), error });
      if (!endpoint || !token || !KMS_KEY_VERSION.test(keyVersion)) return answer("not configured");
      try {
        return answer(null, await kmsPublicAddress({ keyVersion, endpoint, token, ...(options.fetch ? { fetch: options.fetch } : {}) }));
      } catch (error) {
        return answer(error instanceof Error ? error.message : "no answer");
      }
    }),
  );
  return { mode, ready: roles.every((role) => role.ready), roles };
}
