/**
 * When a DLMM Pro pool is open, and to whom.
 *
 * A pool with the `ActivationAccess` extension keeps, in the tail of its account, three whitelisted wallets — one each
 * for swapping, adding and removing liquidity — and two activation slots. An action is allowed when **both** slots
 * allow it, or when the wallet is the one whitelisted for it:
 *
 * - `open` — always;
 * - `bondingCurve` — swaps always; liquidity in and out only after a swap has carried the square-root price to
 *   `first price × targetIncreaseBps / 10 000`, which is then remembered for good;
 * - `timeBased` — each of the three actions from its own point, in the pool's activation unit (slots or unix seconds).
 *
 * Above the rules stands the operator's pause (`pool_status`, Meteora's): bit 0 stops swaps, bit 1 stops adding
 * liquidity — opening a position or a limit order included — **even for the whitelisted wallet**. Taking liquidity out,
 * collecting and closing cannot be paused. A pool without the extension is open from its first block.
 *
 * Whose wallet is checked: the signer of a swap; the owner of the position's or the order's NFT for liquidity — never
 * a delegate's.
 *
 * Pure: no I/O, no clock, no SDK.
 */

export const DEFAULT_KEY = "11111111111111111111111111111111";

export const ACTIVATION_MODES = ["open", "bondingCurve", "timeBased"] as const;

export type ActivationSlot =
  | Readonly<{ mode: "open" }>
  | Readonly<{ mode: "bondingCurve"; reached: boolean; targetIncreaseBps: bigint }>
  | Readonly<{ mode: "timeBased"; swapPoint: number; addLiquidityPoint: number; removeLiquidityPoint: number }>;

export type ActivationRules = Readonly<{
  /** Null: no wallet is exempt. */
  whitelistedSwap: string | null;
  whitelistedAddLiquidity: string | null;
  whitelistedRemoveLiquidity: string | null;
  slots: readonly [ActivationSlot, ActivationSlot];
}>;

export const ACTIVATION_ACTIONS = ["swap", "addLiquidity", "removeLiquidity"] as const;
export type ActivationAction = (typeof ACTIVATION_ACTIONS)[number];

export type ActionGate = Readonly<{
  open: boolean;
  /**
   * Why: `open` to everyone · `whitelisted` — closed to others, open to this wallet · `paused` by the operator ·
   * `time` — waits for `opensAt` · `price` — waits for the price to reach the bonding curve's target.
   */
  reason: "open" | "whitelisted" | "paused" | "time" | "price";
  /** The point (the pool's unit) from which everyone may; null when no time gates the action. */
  opensAt: number | null;
}>;

const uintLe = (data: Uint8Array, offset: number, bytes: number): bigint => {
  let value = 0n;
  for (let index = bytes - 1; index >= 0; index -= 1) value = (value << 8n) | BigInt(data[offset + index]!);
  return value;
};

/** One activation slot — its mode byte and its 15 bytes. Throws on a mode the release does not have. */
export function decodeActivationSlot(modeByte: number, raw: ArrayLike<number>): ActivationSlot {
  const mode = ACTIVATION_MODES[modeByte];
  if (!mode) throw new Error(`Unknown activation mode ${modeByte}.`);
  if (raw.length !== 15) throw new Error(`An activation slot is 15 bytes, not ${raw.length}.`);
  const data = Uint8Array.from(raw);
  if (mode === "open") return { mode };
  if (mode === "bondingCurve") return { mode, reached: data[0] === 1, targetIncreaseBps: uintLe(data, 7, 8) };
  return { mode, swapPoint: Number(uintLe(data, 0, 5)), addLiquidityPoint: Number(uintLe(data, 5, 5)), removeLiquidityPoint: Number(uintLe(data, 10, 5)) };
}

const keyOrNull = (key: string): string | null => (key === DEFAULT_KEY ? null : key);

/** The pool's activation tail as rules. */
export function activationRulesOf(
  tail: Readonly<{
    whitelistedSwap: string;
    whitelistedAddLiquidity: string;
    whitelistedRemoveLiquidity: string;
    activations: readonly Readonly<{ activationMode: number; data: ArrayLike<number> }>[];
  }>,
): ActivationRules {
  if (tail.activations.length !== 2) throw new Error(`A pool has two activation slots, not ${tail.activations.length}.`);
  return {
    whitelistedSwap: keyOrNull(tail.whitelistedSwap),
    whitelistedAddLiquidity: keyOrNull(tail.whitelistedAddLiquidity),
    whitelistedRemoveLiquidity: keyOrNull(tail.whitelistedRemoveLiquidity),
    slots: [decodeActivationSlot(tail.activations[0]!.activationMode, tail.activations[0]!.data), decodeActivationSlot(tail.activations[1]!.activationMode, tail.activations[1]!.data)],
  };
}

const WHITELIST: Readonly<Record<ActivationAction, keyof Pick<ActivationRules, "whitelistedSwap" | "whitelistedAddLiquidity" | "whitelistedRemoveLiquidity">>> = {
  swap: "whitelistedSwap",
  addLiquidity: "whitelistedAddLiquidity",
  removeLiquidity: "whitelistedRemoveLiquidity",
};

function slotGate(slot: ActivationSlot, action: ActivationAction, point: number): Readonly<{ open: boolean; reason: "open" | "time" | "price"; opensAt: number | null }> {
  if (slot.mode === "open") return { open: true, reason: "open", opensAt: null };
  if (slot.mode === "bondingCurve") {
    if (action === "swap" || slot.reached) return { open: true, reason: "open", opensAt: null };
    return { open: false, reason: "price", opensAt: null };
  }
  const opensAt = action === "swap" ? slot.swapPoint : action === "addLiquidity" ? slot.addLiquidityPoint : slot.removeLiquidityPoint;
  return point >= opensAt ? { open: true, reason: "open", opensAt } : { open: false, reason: "time", opensAt };
}

/** The operator's pause of an action, from the pool's status bits. Taking liquidity out is never paused. */
export function pausedBy(poolStatus: number, action: ActivationAction): boolean {
  if (action === "swap") return (poolStatus & 1) !== 0;
  if (action === "addLiquidity") return (poolStatus & 2) !== 0;
  return false;
}

/**
 * Whether `wallet` may do `action` at `point` (the pool's unit). `rules` null — the pool has no activation rules.
 * `wallet` null asks for everyone.
 */
export function actionGateOf(
  args: Readonly<{ rules: ActivationRules | null; poolStatus: number; action: ActivationAction; point: number; wallet: string | null }>,
): ActionGate {
  const { rules, action, point, wallet } = args;
  const slots = rules ? [slotGate(rules.slots[0], action, point), slotGate(rules.slots[1], action, point)] : [];
  const times = slots.map((slot) => slot.opensAt).filter((value): value is number => value !== null);
  const opensAt = times.length ? Math.max(...times) : null;
  if (pausedBy(args.poolStatus, action)) return { open: false, reason: "paused", opensAt };
  const closed = slots.find((slot) => !slot.open);
  if (!closed) return { open: true, reason: "open", opensAt };
  if (wallet !== null && rules && rules[WHITELIST[action]] === wallet) return { open: true, reason: "whitelisted", opensAt };
  /* Both a time and a price may close it: the price is named, since no clock opens it. */
  const reason = slots.some((slot) => !slot.open && slot.reason === "price") ? "price" : "time";
  return { open: false, reason, opensAt };
}

/** The three gates of a pool for one wallet. */
export function activationStateOf(
  args: Readonly<{ rules: ActivationRules | null; poolStatus: number; point: number; wallet: string | null }>,
): Readonly<Record<ActivationAction, ActionGate>> {
  const gate = (action: ActivationAction) => actionGateOf({ ...args, action });
  return { swap: gate("swap"), addLiquidity: gate("addLiquidity"), removeLiquidity: gate("removeLiquidity") };
}

/**
 * The square-root price a bonding-curve slot waits for: `first × targetIncreaseBps / 10 000` — the basis points are of
 * the square-root price, so 20 000 means four times the first price.
 */
export function bondingCurveTargetSqrtPrice(initSqrtPrice: bigint, targetIncreaseBps: bigint): bigint {
  return (initSqrtPrice * targetIncreaseBps) / 10_000n;
}
