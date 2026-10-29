/**
 * The connection contract.
 *
 * One question, asked the same way by every workspace: **can this connection
 * perform this exact action in this exact environment?**
 *
 * Before this file each workspace answered it privately and answered it
 * differently. One hub derived five trigger states from its own wallet hook.
 * Stellar rendered a connect button. Solana's shell claimed no account at all
 * while its Send page owned discovery, connection and signing. Agent Control's
 * top bar printed `NO WALLET` while `/authorize` connected an EVM wallet and
 * signed EIP-712 a route away. That last one is not a styling inconsistency —
 * it is the chrome asserting something false about what the product can do.
 *
 * So the states live here, as data the control renders from and the tests
 * execute, and an adapter's job is to report a snapshot rather than to decide
 * what the snapshot means. The derivation is one pure function. A workspace
 * that wants a sixth state has to add it here, which changes what every test
 * demands of every workspace at once — which is the point.
 *
 * This file describes *connection*. It does not sign, does not build a
 * transaction and does not know what an action costs. Signing stays inside the
 * action lifecycle where the exact bytes are; connection is shell-level. Those
 * are different responsibilities and the whole reason Solana's Send page could
 * disagree with its own shell is that they were the same object.
 */

/* ------------------------------------------------------------------ states */

/**
 * What a connection can be.
 *
 * Seven, and the count lives in this array rather than in a sentence, because
 * every time a count like this lived only in prose the prose drifted — an earlier
 * note that called its five-state machine a seven-state one survived two
 * corrections and one guard.
 *
 * Listed roughly as a connection acquires them — no connector on this page at
 * all, a request open and waiting on the person, a connector present but not
 * connected, connected and usable, connected to the wrong network, connected
 * with an action awaiting authorization, and the connector's own refusal.
 *
 * The array order is documentation; `connectionState` below owns precedence and
 * does not read this list. Two of its rules deliberately depart from this
 * reading order, and both are stated there rather than implied here.
 */
export const CONNECTION_STATES = [
  "UNAVAILABLE",
  "CONNECTING",
  "DISCONNECTED",
  "CONNECTED",
  "WRONG_NETWORK",
  "ACTION_PENDING",
  "ERROR",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * What a connection has been *proven* able to do.
 *
 * Non-implying by construction. A capability that is absent from the set is
 * absent — never inferred from the workspace's name, its environment chip or
 * the fact that some other route in the same product can sign. `NO WALLET` in
 * a top bar over a workspace that signs was exactly this mistake made in the
 * other direction, and a set that could be guessed at would reproduce it.
 *
 * `READ` is deliberately separate from `OWNERSHIP_PROVEN`: a watch-only
 * address can be read and cannot prove it belongs to the person reading it.
 */
export const CONNECTION_CAPABILITIES = [
  "READ",
  "OWNERSHIP_PROVEN",
  "SIGN_MESSAGE",
  "SIGN_TX",
  "SWITCH_NETWORK",
] as const;

export type ConnectionCapability = (typeof CONNECTION_CAPABILITIES)[number];

/**
 * Why a connection attempt did not end in a connection.
 *
 * Three, because the panel used to render one. Every failure was titled
 * "The wallet refused" and offered `Try again`, which was true of exactly one
 * of them: a MetaMask holding an unanswered popup was reported as a refusal
 * the person never gave, beside a retry that could not succeed until they
 * opened the extension — the one instruction the surface never gave.
 *
 * `FAILED` is the honest floor, not a catch-all to avoid. An adapter that
 * cannot tell a refusal from a fault says `FAILED` and the panel says so;
 * guessing `REFUSED` is what put words in a person's mouth.
 */
export const CONNECTION_ERROR_KINDS = ["REFUSED", "PENDING", "FAILED"] as const;

export type ConnectionErrorKind = (typeof CONNECTION_ERROR_KINDS)[number];

/**
 * A connector this page can attach to, when there is a choice to make.
 *
 * `id` is what `connect` is called with, and it is the connector's own name
 * rather than an index: a list re-ranked between render and click would
 * otherwise connect a different wallet than the one under the finger.
 */
export type ConnectionChoice = Readonly<{
  id: string;
  label: string;
  /** The connector's own icon, usually a data URI. `null` when it offers none. */
  icon?: string | null;
}>;

/* ---------------------------------------------------------------- snapshot */

/**
 * What an adapter reports.
 *
 * Facts only. Every field an adapter cannot honestly answer is `null`, and
 * `null` means *unknown*, never zero and never "no". The balance a wrong
 * network cannot read is `null`; a balance of nothing is `"0"`. Conflating
 * those two is how a screen tells someone they hold nothing when it simply
 * could not look.
 */
export type ConnectionSnapshot = Readonly<{
  /** A connector exists on this page at all — an injected wallet, a session. */
  available: boolean;
  /** A connection request is open and waiting on the person. */
  connecting: boolean;
  /** The connected account, in the network's own address form. `null` when none. */
  address: string | null;
  /** The connector is on the network this workspace needs. */
  onExpectedNetwork: boolean;
  /** What the connector has proven it can do. Absent means absent. */
  capabilities: readonly ConnectionCapability[];
  /** An authorization the person has not yet answered — signature or approval. */
  actionPending?: boolean;
  /** The connector's own failure text. `null` when nothing has failed. */
  error: string | null;
  /**
   * What that failure was. Omitted means the adapter did not classify it, and
   * the control treats it as `FAILED` rather than as a refusal.
   */
  errorKind?: ConnectionErrorKind;
}>;

/**
 * The network a connection is on, as the shell needs to render it.
 *
 * `explorerAddressUrl` is a function rather than a base string because the
 * three networks in this product spell an address route three different ways,
 * and a base string forced every caller to remember which. A caller that gets
 * it wrong produces a link to nothing, which looks exactly like a link to
 * something until it is clicked.
 */
export type ConnectionNetwork = Readonly<{
  label: string;
  shortLabel?: string;
  explorerAddressUrl?: (address: string) => string;
}>;

/* -------------------------------------------------------------- derivation */

/**
 * The one derivation.
 *
 * Order is the contract, and three orderings in it are load-bearing. All three
 * come from one hub's wallet state machine, which is the only one in this product
 * that has been exercised against a real chain with real signatures — the
 * standard calls it the behavioural seed, and a "generic" contract that
 * quietly disagreed with it would be a rewrite wearing a contract's name.
 *
 * **`UNAVAILABLE` outranks `CONNECTING`.** A page with no connector cannot have
 * a request open, so a snapshot claiming both is reporting a stale flag, and
 * the answer a person needs is the one about the missing wallet.
 *
 * **`ERROR` only wins when there is nothing else to show.** A wallet that
 * refused a network switch is still connected, still has an address, and the
 * trigger must keep saying so; the refusal belongs in the panel, beside the
 * retry. Making `ERROR` a top-level state would have replaced a working
 * address with a warning triangle every time someone dismissed a prompt —
 * the inverse of the failure this replaces, where the error was captured and
 * never rendered at all, and a person who rejected a request saw a button that
 * simply did nothing.
 *
 * **`WRONG_NETWORK` outranks `ACTION_PENDING`.** An action waiting for
 * authorization on the wrong network cannot be authorized, and showing
 * `Waiting…` over it would be the chrome promising a signature that the next
 * step is going to refuse.
 */
export function connectionState(snapshot: ConnectionSnapshot): ConnectionState {
  if (!snapshot.available) return "UNAVAILABLE";
  if (snapshot.connecting) return "CONNECTING";
  if (!snapshot.address) return snapshot.error ? "ERROR" : "DISCONNECTED";
  if (!snapshot.onExpectedNetwork) return "WRONG_NETWORK";
  if (snapshot.actionPending) return "ACTION_PENDING";
  return "CONNECTED";
}

/**
 * Whether the panel shows the connector's refusal.
 *
 * Separate from the state on purpose: an error is additive, not exclusive. It
 * is the one thing about a connection that can be true at the same time as
 * everything else being true.
 */
export function showsError(snapshot: ConnectionSnapshot): boolean {
  return snapshot.error !== null;
}

/** Whether the connection is attached to an account at all, whatever its state. */
export function isAttached(snapshot: ConnectionSnapshot): boolean {
  return snapshot.address !== null;
}

/**
 * Whether this connection can perform this capability *right now*.
 *
 * Two conditions, both required, and the second is the one a workspace would
 * forget: the capability has to be proven **and** the connection has to be in a
 * state that can exercise it. A wallet that can sign but sits on the wrong
 * network cannot sign here, and a workspace asking only the first half would
 * offer the control and fail at the wallet.
 */
export function can(
  snapshot: ConnectionSnapshot,
  capability: ConnectionCapability,
): boolean {
  if (!snapshot.capabilities.includes(capability)) return false;
  const state = connectionState(snapshot);
  if (capability === "SWITCH_NETWORK") {
    /* The one capability whose whole purpose is to be used from the wrong
       network. Excluding it here is what would strand a person there. */
    return state === "CONNECTED" || state === "WRONG_NETWORK" || state === "ACTION_PENDING";
  }
  return state === "CONNECTED" || state === "ACTION_PENDING";
}

/* ------------------------------------------------------------------ adapter */

/**
 * What a workspace supplies to the shell.
 *
 * The snapshot plus the actions the connector genuinely offers. An action that
 * an adapter cannot perform is `undefined` rather than a function that throws
 * or does nothing, so the control renders the missing capability rather than
 * offering a dead button — the same rule as `capabilities`, applied to verbs.
 *
 * `truncate` exists because address shortening is not universal: an EVM hex,
 * a Stellar `G…` and a Solana base58 do not shorten the same way, and a shared
 * `0x`-shaped helper produced unreadable stubs the first time it met base58.
 */
export type ConnectionAdapter = Readonly<{
  /** Which chain family this is, for the control's own labels and tests. */
  id: string;
  snapshot: ConnectionSnapshot;
  network: ConnectionNetwork | null;
  /**
   * A balance the adapter can honestly read, already formatted, or `null`.
   * `label` names what is being counted; there is no default unit.
   */
  balance?: Readonly<{ label: string; value: string | null; loading?: boolean }>;
  /**
   * The connectors on offer, when the page found more than one.
   *
   * Omitted — or a single entry — means there is nothing to choose and the
   * control renders one button. **More than one and the person picks**, which
   * is the defect this field exists to close: Solana's adapter ranked four
   * registered wallets and connected `wallets[0]`, and when no wallet had yet
   * exposed a Solana account the ranking fell through to alphabetical order.
   * `Connect` then reached for MetaMask over the Phantom in the same toolbar,
   * silently, with no list anywhere on the surface to say so or to correct it.
   */
  choices?: readonly ConnectionChoice[];
  /** Attach. With `choices`, the id of the one chosen; without, the adapter's own default. */
  connect?: (id?: string) => void | Promise<void>;
  disconnect?: () => void;
  switchNetwork?: () => void | Promise<void>;
  truncate: (address: string) => string;
  /**
   * The name the connected wallet goes by — Solana's `.skr` (SKR-4) — or `null`/absent. It stands where the shortened
   * address stood on the trigger; inside the panel the address stays beside it, because the address is what signs.
   */
  name?: string | null;
}>;
