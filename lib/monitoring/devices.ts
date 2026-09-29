import { DeviceRegistrationRequestSchema, type DeviceRegistrationRequest, type DeviceRegistrationResponse } from "../api/v1/contract.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import {
  deviceKey,
  devicesOf,
  listDevices,
  newDeviceId,
  type DeviceRecord,
} from "./store.ts";

/**
 * One owner per token (the mobile line's request 24b; 2026-09-22): a token
 * registered under this wallet is revoked under every other wallet that still
 * holds it — a shared phone whose sign-out never reached the server must not
 * keep receiving the previous wallet's notes. Bounded by the device table,
 * which is small; a write that fails is retried by the next registration.
 */
async function revokeTokenElsewhere(store: GuardStore, owner: string, token: string, at: string): Promise<number> {
  const all = await devicesOf(store).valuesWithPrefix("solana:mainnet:");
  let revoked = 0;
  for (const row of all) {
    if (row.owner === owner || row.token !== token || row.revokedAt) continue;
    const written = await devicesOf(store).compareAndSet(deviceKey(row.owner, row.deviceId), row.version, {
      ...row,
      version: row.version + 1,
      token: "revoked",
      revokedAt: at,
      updatedAt: at,
    });
    if (written) revoked += 1;
  }
  return revoked;
}

export async function registerDevice(
  store: GuardStore,
  owner: string,
  input: DeviceRegistrationRequest,
  nowMs: number,
): Promise<DeviceRegistrationResponse> {
  const body = DeviceRegistrationRequestSchema.parse(input);
  const at = new Date(nowMs).toISOString();
  await revokeTokenElsewhere(store, owner, body.token, at);
  const existing = await listDevices(store, owner);
  const same = existing.find((row) => row.token === body.token);
  const deviceId = same?.deviceId ?? newDeviceId();
  const next: DeviceRecord = {
    version: (same?.version ?? -1) + 1,
    deviceId,
    owner,
    platform: "android",
    token: body.token,
    appVersion: body.appVersion,
    locale: body.locale ?? "en",
    categories: body.categories ?? ["plan", "operation", "market", "system"],
    quietHours: body.quietHours ?? null,
    registeredAt: same?.registeredAt ?? at,
    updatedAt: at,
    revokedAt: null,
  };
  await withBoundedCasRetry(async () => {
    const current = await devicesOf(store).get(deviceKey(owner, deviceId));
    const written = await devicesOf(store).compareAndSet(deviceKey(owner, deviceId), current?.version ?? null, {
      ...next,
      version: (current?.version ?? -1) + 1,
    });
    return written ? true : false;
  });
  return {
    deviceId,
    address: owner,
    platform: "android",
    categories: [...next.categories] as DeviceRegistrationResponse["categories"],
    quietHours: next.quietHours,
    registeredAt: next.registeredAt,
  };
}

export async function revokeDevice(store: GuardStore, owner: string, deviceId: string, nowMs: number): Promise<boolean> {
  const key = deviceKey(owner, deviceId);
  const current = await devicesOf(store).get(key);
  if (!current || current.owner !== owner) return false;
  if (current.revokedAt) return true;
  const at = new Date(nowMs).toISOString();
  return devicesOf(store).compareAndSet(key, current.version, {
    ...current,
    version: current.version + 1,
    token: "revoked",
    revokedAt: at,
    updatedAt: at,
  });
}

export async function ownerDevices(store: GuardStore, owner: string): Promise<readonly Omit<DeviceRecord, "token">[]> {
  const rows = await listDevices(store, owner);
  return rows.map(({ token: _token, ...rest }) => rest);
}
