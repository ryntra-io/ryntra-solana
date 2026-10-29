import { HEX32, hexToBytes, sha256Hex } from "./hash";

/**
 * The public randomness beacon (CITY-69). The engine mixes in one drand round; its signature stays in the log so
 * anyone can check the round against the drand network. Tests and simulations use the mock below. Money brackets take
 * their randomness from MagicBlock VRF (CITY-52), not from here.
 */

export type BeaconInfo = Readonly<{
  /** drand chain hash, 32 bytes hex. */
  chainHash: string;
  /** Unix time of round 1, ms. */
  genesisTime: number;
  /** Time between rounds, ms. */
  period: number;
}>;

export type BeaconRound = Readonly<{
  round: number;
  /** 32 bytes hex. drand defines it as sha256(signature). */
  randomness: string;
  /** BLS signature hex, verifiable against the chain's public key. */
  signature: string;
}>;

export type Beacon = Readonly<{
  info: BeaconInfo;
  /** Resolves with the round once it is published. */
  get(round: number): Promise<BeaconRound>;
}>;

/**
 * drand quicknet: unchained rounds every 3 s. Written from the network's published values without a live read; check
 * them against `GET /<chain-hash>/info` before the first match that anything depends on.
 */
export const DRAND_QUICKNET: BeaconInfo = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesisTime: 1_692_803_367_000,
  period: 3_000,
};

/** The latest round already published at time `at`; 0 before genesis. */
export function latestRound(info: BeaconInfo, at: number): number {
  return at < info.genesisTime ? 0 : Math.floor((at - info.genesisTime) / info.period) + 1;
}

/** The time `round` is published. */
export function roundTime(info: BeaconInfo, round: number): number {
  return info.genesisTime + (round - 1) * info.period;
}

/** What is wrong with a beacon value for `round`, or null when it is consistent. The BLS signature is the client's. */
export function checkBeaconRound(value: BeaconRound, round: number): string | null {
  if (value.round !== round) return `expected round ${round}, got ${value.round}`;
  if (!HEX32.test(value.randomness)) return "randomness must be 64 lowercase hex characters";
  if (!/^(?:[0-9a-f]{2})+$/.test(value.signature)) return "signature must be lowercase hex";
  if (sha256Hex(hexToBytes(value.signature)) !== value.randomness) return "randomness is not sha256(signature)";
  return null;
}

export const MOCK_BEACON_INFO: BeaconInfo = {
  chainHash: sha256Hex("mock beacon chain"),
  genesisTime: 0,
  period: 3_000,
};

/** A deterministic stand-in for a drand round. The signature is a hash, not a BLS signature. */
export function mockBeaconRound(round: number, salt = "mock", info: BeaconInfo = MOCK_BEACON_INFO): BeaconRound {
  const signature = sha256Hex(`mock beacon|${info.chainHash}|${salt}|${round}`);
  return { round, randomness: sha256Hex(hexToBytes(signature)), signature };
}

/** A beacon for tests and simulations: every round is available at once. */
export function createMockBeacon(salt = "mock", info: BeaconInfo = MOCK_BEACON_INFO): Beacon {
  return {
    info,
    get: async (round) => mockBeaconRound(round, salt, info),
  };
}
