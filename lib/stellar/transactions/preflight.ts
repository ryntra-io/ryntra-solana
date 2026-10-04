import { isAccountAddress, type AssetIdentity } from "../asset.ts";
import { horizonGet, type ClientLimits } from "../client.ts";
import type { StellarNetwork } from "../network.ts";
import { toStroops } from "./effects.ts";

/**
 * What is knowable before a signature is spent.
 *
 * This exists because of two real runs. On 2026-08-13 a person built,
 * authorized, signed and submitted the same payment twice, and both times the
 * network refused it with `paymentNoDestination` — the destination account had
 * never been created. Every part of the lifecycle worked and reported the
 * failure honestly, *afterwards*. A signature had already been given, twice,
 * for a transaction that could not have succeeded either time.
 *
 * Reporting a doomed transaction after the fact is diagnosis. Refusing to build
 * it is the product. The whole argument of this workspace is that a decision is
 * checked before a person authorizes it, and the surface that makes that
 * argument was the one not doing it.
 *
 * **The rule this file holds to: block only what is certain to fail.** Anything
 * uncertain — a source we could not read, a reserve we would have to estimate,
 * an endpoint that timed out — is reported and left to the network. A preflight
 * that blocks a payment which would have worked teaches people to ignore it,
 * and then it protects nobody. Under-strict on purpose.
 *
 * This is **not** the policy engine. There is no rule set, no version, no
 * decision record — those belong to the policy engine and this must never be
 * described as them. It is four deterministic reads of what the network already
 * knows.
 */

export type PreflightOutcome = "PASS" | "BLOCK" | "UNKNOWN";

export type PreflightCheck = Readonly<{
  id: string;
  label: string;
  outcome: PreflightOutcome;
  /** What was found, and when it blocks, what to do about it. */
  detail: string;
}>;

export type Preflight = Readonly<{
  /** `READY` only when every check passed. Never on the strength of most. */
  state: "READY" | "BLOCKED" | "UNCONFIRMED";
  checks: readonly PreflightCheck[];
}>;

export type PreflightInput = Readonly<{
  network: StellarNetwork;
  source: string;
  destination: string;
  asset: AssetIdentity;
  amount: string;
  /** The fee ceiling the transaction will carry, in stroops. */
  feeStroops: string;
}>;

export type PreflightOptions = Readonly<{
  limits?: ClientLimits;
  fetchImpl?: typeof globalThis.fetch;
}>;

type HorizonBalance = {
  balance?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  is_authorized?: boolean;
};

type HorizonAccount = { balances?: HorizonBalance[] };

const isNative = (asset: AssetIdentity) => asset.issuer === null || asset.code === "XLM";

const held = (account: HorizonAccount, asset: AssetIdentity): HorizonBalance | undefined =>
  (account.balances ?? []).find((balance) =>
    isNative(asset)
      ? balance.asset_type === "native"
      : balance.asset_code === asset.code && balance.asset_issuer === asset.issuer,
  );

export async function preflightPayment(input: PreflightInput, options: PreflightOptions = {}): Promise<Preflight> {
  const checks: PreflightCheck[] = [];
  const add = (check: PreflightCheck) => checks.push(check);

  /* ------------------------------------------------------------- amount -- */

  const stroops = toStroops(input.amount);
  add({
    id: "amount",
    label: "The amount is a Stellar amount above zero",
    outcome: stroops === null ? "BLOCK" : stroops === "0" ? "BLOCK" : "PASS",
    detail:
      stroops === null
        ? `"${input.amount}" is not a Stellar amount. It must be a decimal with at most seven places.`
        : stroops === "0"
          ? "A payment of zero moves nothing and still costs a fee."
          : `${input.amount} ${isNative(input.asset) ? "XLM" : input.asset.code}`,
  });

  /* -------------------------------------------------------- destination -- */

  if (!isAccountAddress(input.destination)) {
    add({
      id: "destination.format",
      label: "The destination is a Stellar account address",
      outcome: "BLOCK",
      detail: "A destination must be a G-address. A contract address or a federated name is not one.",
    });
    return { state: "BLOCKED", checks };
  }
  add({
    id: "destination.format",
    label: "The destination is a Stellar account address",
    outcome: "PASS",
    detail: input.destination,
  });

  const destination = await horizonGet(input.network.horizonUrl, `accounts/${input.destination}`, {}, options);
  if (destination.ok) {
    add({
      id: "destination.exists",
      label: "The destination account exists",
      outcome: "PASS",
      detail: `Found on ${input.network.label}.`,
    });

    /* A credit asset needs somewhere to land. The native asset never does. */
    if (!isNative(input.asset)) {
      const line = held(destination.value as HorizonAccount, input.asset);
      add({
        id: "destination.trustline",
        label: `The destination can hold ${input.asset.code}`,
        outcome: line ? (line.is_authorized === false ? "BLOCK" : "PASS") : "BLOCK",
        detail: !line
          ? `The destination has no trustline for ${input.asset.code}. It has to add one before it can receive this asset.`
          : line.is_authorized === false
            ? `The issuer has not authorized the destination to hold ${input.asset.code}.`
            : "Trustline present and authorized.",
      });
    }
  } else if (/HTTP 404/.test(destination.reason)) {
    add({
      id: "destination.exists",
      label: "The destination account exists",
      outcome: "BLOCK",
      detail:
        `No account ${input.destination.slice(0, 8)}… exists on ${input.network.label}. ` +
        "Stellar will not create an account by paying it — fund it first, or use a create-account operation." +
        (input.network.ephemeral ? " On an ephemeral network, Friendbot creates and funds an account from its address alone." : ""),
    });
  } else {
    /* Could not tell. Not a block — the network is the authority, and refusing
       a payment because our read timed out would be this file failing the rule
       it was written to hold. */
    add({
      id: "destination.exists",
      label: "The destination account exists",
      outcome: "UNKNOWN",
      detail: `The destination could not be read: ${destination.reason}`,
    });
  }

  /* ------------------------------------------------------------- source -- */

  const source = await horizonGet(input.network.horizonUrl, `accounts/${input.source}`, {}, options);
  if (!source.ok) {
    add({
      id: "source.balance",
      label: "The source holds enough to send it",
      outcome: /HTTP 404/.test(source.reason) ? "BLOCK" : "UNKNOWN",
      detail: /HTTP 404/.test(source.reason)
        ? `No account ${input.source.slice(0, 8)}… exists on ${input.network.label}. It has to be created and funded before it can send anything.`
        : `The source could not be read: ${source.reason}`,
    });
  } else {
    const balance = held(source.value as HorizonAccount, input.asset);
    const holding = balance?.balance ? toStroops(balance.balance) : null;
    const needed =
      stroops === null
        ? null
        : (BigInt(stroops) + (isNative(input.asset) ? BigInt(/^\d+$/.test(input.feeStroops) ? input.feeStroops : "0") : 0n)).toString();

    if (holding === null || needed === null) {
      add({
        id: "source.balance",
        label: "The source holds enough to send it",
        outcome: "UNKNOWN",
        detail: balance
          ? "The balance could not be read as a number."
          : `The source holds no ${isNative(input.asset) ? "XLM" : input.asset.code} balance at all.`,
      });
    } else {
      /*
       * Deliberately not reserve-aware.
       *
       * A native balance is not all spendable: the base reserve locks some of
       * it, and the amount depends on subentries and a ledger parameter. Doing
       * that arithmetic here would let a rounding error block a payment that
       * would have gone through, so this blocks only on the certainty — the
       * balance does not even cover the amount plus the fee — and leaves the
       * reserve to the network, which will say `underfunded` if it matters.
       */
      const enough = BigInt(holding) >= BigInt(needed);
      add({
        id: "source.balance",
        label: "The source holds enough to send it",
        outcome: enough ? "PASS" : "BLOCK",
        detail: enough
          ? `Holds ${balance?.balance}${isNative(input.asset) ? " XLM" : ` ${input.asset.code}`}.` +
            (isNative(input.asset) ? " The base reserve is not deducted here; the network decides that." : "")
          : `Holds ${balance?.balance}, which does not cover ${input.amount}${isNative(input.asset) ? " plus the fee" : ""}.`,
      });
    }
  }

  const blocked = checks.some((check) => check.outcome === "BLOCK");
  const unknown = checks.some((check) => check.outcome === "UNKNOWN");
  return { state: blocked ? "BLOCKED" : unknown ? "UNCONFIRMED" : "READY", checks };
}
