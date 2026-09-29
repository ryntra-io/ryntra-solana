/**
 * The deployment's emergency stop, per action family.
 *
 * Send has had one of these since it opened: `RYNTRA_SOLANA_SEND_STATE`, where
 * anything but the exact word `OPEN` means closed. Swap and Bridge did not need
 * one, because each was closed by something else — Swap behind a Ryntra admin
 * session, Bridge behind the owner-canary policy. Both of those are gone now:
 * they were never product controls, they were leftovers from the period when
 * the only person allowed to move money here was the founder.
 *
 * Removing them without putting this in its place would leave two value-moving
 * lanes with **no way to close them except a deploy**, which is the wrong thing
 * to discover during an incident.
 *
 * ## Fail-closed, and every lane answers only for itself
 *
 * Missing, blank, misspelled, lower-cased or padded all read as `PAUSED`. A
 * stop that opens when its own configuration is wrong is not a stop.
 *
 * There is no inheritance between lanes. An earlier version of this file let a
 * lane with no variable of its own fall back to `RYNTRA_SOLANA_SEND_STATE`, so
 * that shipping it would not silently close Swap and Bridge on a deployment
 * that already said `OPEN`. Convenient, and wrong: it meant one variable
 * written for one action family quietly opened two others, including the one
 * that burns USDC on a second chain. Opening a money lane has to be something
 * somebody did on purpose, for that lane, by name.
 *
 * The cost is that a deployment upgrading past this point closes Swap and
 * Bridge until its operator sets `RYNTRA_SOLANA_SWAP_STATE` and
 * `RYNTRA_SOLANA_BRIDGE_STATE`. That is the correct direction for a switch to
 * fail in, and it is visible rather than silent: both lanes say so.
 */

export const SOLANA_LANES = ["SEND", "SWAP", "BRIDGE", "CROSS_SWAP"] as const;
export type SolanaLane = (typeof SOLANA_LANES)[number];

export type SolanaLaneState = "OPEN" | "PAUSED";

/**
 * `CROSS_SWAP` is the fourth lane, added by `RYN-SOL-MONEY-FLOWS-001F` on
 * 2026-09-07: one asset in on one network, a different asset out on another,
 * through the provider the Owner decision named (Mayan). It has its own
 * variable for the same reason Ethereum has one beneath the bridge: a route
 * that moves money through a new provider opens because somebody set its
 * switch by name, never because Swap or Bridge happened to be open.
 */
export const SOLANA_LANE_STATE_ENV = {
  SEND: "RYNTRA_SOLANA_SEND_STATE",
  SWAP: "RYNTRA_SOLANA_SWAP_STATE",
  BRIDGE: "RYNTRA_SOLANA_BRIDGE_STATE",
  CROSS_SWAP: "RYNTRA_SOLANA_CROSS_SWAP_STATE",
} as const satisfies Record<SolanaLane, string>;

/**
 * Whether this lane may open a wallet right now.
 *
 * Pure and total: no clock, no network, no throw. The route and the surface
 * both read it, so the sentence a person is shown is the sentence the gate
 * acted on. One variable, one lane, no inheritance.
 */
export function resolveSolanaLaneState(
  lane: SolanaLane,
  env: Record<string, string | undefined> = process.env,
): SolanaLaneState {
  return env[SOLANA_LANE_STATE_ENV[lane]]?.trim().toUpperCase() === "OPEN" ? "OPEN" : "PAUSED";
}

/**
 * The bridge networks that carry a stop of their own, beneath the lane's.
 *
 * `RYN-SOL-MONEY-FLOWS-001E` (2026-09-05) built the Solana ↔ Ethereum USDC
 * route on the same CCTP rail as Base. Base has moved money four times under
 * founder signatures; Ethereum has moved none, and the card that built it says
 * plainly that a route is not confirmed by a provider listing it or by a test
 * passing. So the Ethereum network opens only when somebody sets its own
 * variable to `OPEN`, after the first founder-signed transfer has been read back
 * from both chains — and it inherits nothing from `RYNTRA_SOLANA_BRIDGE_STATE`,
 * for the same reason no lane inherits another's: opening a money route has to
 * be a thing somebody did on purpose, for that route, by name.
 *
 * Base has no variable here. It is governed by the bridge lane alone, exactly
 * as it was before Ethereum existed; adding a second switch to a route that is
 * already open would be a way to close it by accident.
 */
export const SOLANA_BRIDGE_NETWORK_STATE_ENV = {
  ethereum: "RYNTRA_SOLANA_BRIDGE_ETHEREUM_STATE",
} as const;

/**
 * The cross-swap networks that carry a stop of their own, beneath the lane's.
 *
 * `RYN-SOL-MONEY-FLOWS-001H` (2026-09-09) added Solana ↔ Robinhood Chain, and
 * it is the first route in this product carried by a provider that has never
 * moved a cent of anyone's money here. Mayan cannot reach chain 4663 at all,
 * so the six approved pairs go through Relay — a second provider, a second
 * set of contracts, a second failure mode nobody here has watched fail.
 *
 * Ethereum earned its own switch beneath the bridge for a weaker reason than
 * this: same rail, same contracts, no signed transfer yet. A new *provider* is
 * a larger claim than a new chain on a proven rail, so it opens the same way
 * and no sooner — after a founder-signed swap has been read back from both
 * chains, by somebody setting this variable on purpose, by name.
 *
 * Base, Ethereum and the pairs Mayan already carried have no variable here.
 * They are governed by `RYNTRA_SOLANA_CROSS_SWAP_STATE` alone, exactly as they
 * were before Robinhood Chain existed; adding a second switch to a route that
 * is already open would be a way to close it by accident.
 */
export const SOLANA_CROSS_SWAP_NETWORK_STATE_ENV = {
  robinhood: "RYNTRA_SOLANA_CROSS_SWAP_ROBINHOOD_STATE",
} as const;

export type SolanaGatedCrossSwapNetwork = keyof typeof SOLANA_CROSS_SWAP_NETWORK_STATE_ENV;

export function isGatedCrossSwapNetwork(network: string): network is SolanaGatedCrossSwapNetwork {
  return network in SOLANA_CROSS_SWAP_NETWORK_STATE_ENV;
}

export type SolanaGatedBridgeNetwork = keyof typeof SOLANA_BRIDGE_NETWORK_STATE_ENV;

/**
 * Whether a bridge network may open a wallet right now.
 *
 * Fail-closed like the lane: missing, blank, misspelled or padded reads as
 * `PAUSED`. A network with no variable of its own (Base) answers with the lane's
 * state, which is the one switch that has always governed it.
 */
export function resolveSolanaBridgeNetworkState(
  network: "base" | "ethereum",
  env: Record<string, string | undefined> = process.env,
): SolanaLaneState {
  const lane = resolveSolanaLaneState("BRIDGE", env);
  if (lane !== "OPEN") return "PAUSED";
  if (network === "base") return "OPEN";
  return env[SOLANA_BRIDGE_NETWORK_STATE_ENV[network]]?.trim().toUpperCase() === "OPEN" ? "OPEN" : "PAUSED";
}

/**
 * The three states a gated cross-swap route can be in.
 *
 * `PAUSED` and `OPEN` are the two this lane has always had. `CANARY` was added
 * on the owner's instruction of 2026-09-09, for one reason: proving a new rail
 * requires building and signing exactly one real transaction, and until then
 * the only way to do that was to set the route `OPEN` — which would open it
 * for everyone, to any amount, in order to move five dollars once.
 *
 * - `PAUSED` — no plan may be built and nothing may be submitted.
 * - `CANARY` — **only** the one controlled operation
 *   (`lib/swap/cross-swap-canary.ts`) may be planned, and only once may it be
 *   submitted. Everything else is refused exactly as under `PAUSED`.
 * - `OPEN` — ordinary production work, after a separate owner decision.
 *
 * `OPEN` is never reached from `CANARY` by anything this code does. A finished
 * canary makes the route behave as `PAUSED` again — see
 * `effectiveCrossSwapRouteState` — and only a person changing the variable can
 * make it `OPEN`.
 */
export type SolanaCrossSwapRouteState = "OPEN" | "CANARY" | "PAUSED";

/**
 * Whether a cross-swap route may open a wallet right now, and in what mode.
 *
 * Takes both sides, because a pair is gated by whichever of its networks
 * carries a switch — the money crosses the same boundary whichever direction
 * it is travelling, and a gate that only looked at the source would leave the
 * return leg wide open.
 *
 * Fail-closed like the lane: missing, blank, misspelled, padded or any word
 * that is not exactly `OPEN` or `CANARY` reads as `PAUSED`. A pair whose
 * networks carry no switch of their own answers with the lane's state, which
 * is the one switch that has always governed them.
 *
 * This is the *configured* state. It is not the whole answer under `CANARY`,
 * where a one-shot ledger decides whether the controlled operation is still
 * available; see `effectiveCrossSwapRouteState`.
 */
export function resolveSolanaCrossSwapRouteState(
  from: string,
  to: string,
  env: Record<string, string | undefined> = process.env,
): SolanaCrossSwapRouteState {
  const lane = resolveSolanaLaneState("CROSS_SWAP", env);
  if (lane !== "OPEN") return "PAUSED";
  let mode: SolanaCrossSwapRouteState = "OPEN";
  for (const network of [from, to]) {
    if (!isGatedCrossSwapNetwork(network)) continue;
    const value = env[SOLANA_CROSS_SWAP_NETWORK_STATE_ENV[network]]?.trim().toUpperCase();
    if (value === "OPEN") continue;
    if (value === "CANARY") {
      mode = "CANARY";
      continue;
    }
    return "PAUSED";
  }
  return mode;
}

/**
 * What a gated route may actually do, once the one-shot ledger is consulted.
 *
 * The configured state alone cannot answer this under `CANARY`, because the
 * whole point of a controlled operation is that it happens **once**. The
 * ledger carries whether it has been planned, attempted or resolved, and this
 * turns the pair of facts into the one word a route acts on:
 *
 * - `PLAN_AND_SUBMIT` — the controlled operation may be planned and submitted.
 *   A plan that went stale before signing may be rebuilt; that is not an
 *   attempt and does not consume anything.
 * - `PLAN_ONLY` — never reached under `CANARY` today; reserved so a future
 *   mode can offer a Review without a submit rather than by special-casing.
 * - `CLOSED` — behaves exactly as `PAUSED`. This is where a canary lands the
 *   moment a submit is attempted (safe state until recovery resolves it) and
 *   where it stays once resolved. **A resolved canary does not become `OPEN`.**
 */
export type CrossSwapRoutePermission = "PLAN_AND_SUBMIT" | "PLAN_ONLY" | "CLOSED";

export function effectiveCrossSwapRouteState(
  configured: SolanaCrossSwapRouteState,
  canary: Readonly<{ state: "NONE" | "PLANNED" | "SUBMIT_ATTEMPTED" | "RESOLVED" }> | null,
): CrossSwapRoutePermission {
  if (configured === "PAUSED") return "CLOSED";
  if (configured === "OPEN") return "PLAN_AND_SUBMIT";
  /* CANARY. Without a readable ledger nothing may be built: a one-shot control
     whose counter cannot be read is not a one-shot control. */
  if (!canary) return "CLOSED";
  if (canary.state === "NONE" || canary.state === "PLANNED") return "PLAN_AND_SUBMIT";
  return "CLOSED";
}
