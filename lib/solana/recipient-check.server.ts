/**
 * The recipient check before a transfer (contract 1.22.0,
 * `GET /api/v1/money/recipient`).
 *
 * The web's «Надіслати» card checks a recipient in three places: the field
 * (`parseSolanaAddress`, the sender's own address), the security source
 * (`research/address-evidence`), and — only once a Review is built — the
 * transfer builder's own classifier, which refuses a program, a mint, a token
 * account of another mint, an owner no key exists for or a frozen account. A
 * phone asked to do that would re-implement the first and wait for the third.
 * This answers the first and the third at once, before any bytes are built,
 * with the same classifier the builder calls (`lib/solana/send-recipient.ts`),
 * and reads a pasted or scanned Solana Pay request or Ryntra link too, so a
 * request whose reference belongs to a Ryntra link is paid through that link
 * — a plain transfer would leave the link unpaid. The security source stays
 * its own read; a client asks both, as the web does.
 *
 * Every read is injected: the route passes the chain and the store, the tests
 * pass stubs. Server only.
 */

import type { PayLink } from "../pay/link.ts";
import { parseHumanAmount } from "./amounts.ts";
import type { SendRecipientResolution } from "./send-recipient.ts";
import { readSendTarget, type SolanaPayAsk } from "./send-target.ts";

export type RecipientProblem =
  | "EMPTY"
  | "NOT_AN_ADDRESS"
  | "MISREAD_CHARACTER"
  | "WRONG_LENGTH"
  | "REQUEST_INVALID"
  | "REQUEST_UNSUPPORTED"
  | "REFERENCE_UNSUPPORTED"
  | "LINK_INVALID"
  | "LINK_NOT_FOUND"
  | "LINK_PAID"
  | "LINK_EXPIRED"
  | "LINK_MISMATCH"
  | "LINK_UNCONFIRMED"
  | "SELF"
  | "MINT_UNREADABLE"
  | Extract<SendRecipientResolution, { ok: false }>["code"];

export type RecipientCheck = Readonly<{
  input: "address" | "solana-pay" | "pay-link";
  next: "transfer" | "pay-link" | "none";
  problem: RecipientProblem | null;
  address: string | null;
  asset: Readonly<{ mint: string | null }>;
  destination: Readonly<{ kind: "wallet" | "token-account"; owner: string; account: string; opensAccount: boolean }> | null;
  asked: Readonly<{ amount: string | null; mint: string | null; label: string | null; message: string | null }> | null;
  link: PayLink | null;
  checkedAt: string;
}>;

export type RecipientCheckDeps = Readonly<{
  /** Hosts whose `/pay/<id>` is a Ryntra link. */
  linkHosts: readonly string[];
  /** One link as its page reads it (observed), or null when no link has that id. */
  readLink: (id: string) => Promise<PayLink | null>;
  /** The Ryntra link a Solana Pay reference belongs to, or null. */
  linkIdByReference: (reference: string) => Promise<string | null>;
  resolveNative: (address: string) => Promise<SendRecipientResolution>;
  resolveToken: (args: Readonly<{ address: string; mint: string; tokenProgram: string }>) => Promise<SendRecipientResolution>;
  /** The mint's token program from the chain; `unavailable` when the chain did not answer (not a verdict on the mint). */
  tokenProgramOf: (mint: string) => Promise<Readonly<{ ok: true; tokenProgram: string }> | Readonly<{ ok: false; unavailable?: boolean }>>;
  now?: () => Date;
}>;

export type RecipientCheckQuery = Readonly<{ to: string; mint?: string; from?: string }>;

export async function checkRecipient(deps: RecipientCheckDeps, query: RecipientCheckQuery): Promise<RecipientCheck> {
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  const from = query.from ?? null;
  /* `input` first: what was entered is the first thing an answer says. */
  const base = (input: RecipientCheck["input"]) => ({
    input,
    next: "none" as const,
    problem: null,
    address: null,
    asset: { mint: query.mint ?? null },
    destination: null,
    asked: null,
    link: null,
    checkedAt,
  });

  const target = readSendTarget(query.to, deps.linkHosts);
  switch (target.kind) {
    case "invalid":
      return { ...base(target.input), problem: target.problem };
    case "pay-link":
      /* The link's own address: its id is the capability, the same the page `/pay/<id>` answers to. */
      return fromLink(base("pay-link"), await deps.readLink(target.id), null, from);
    case "solana-pay": {
      const asked = askedOf(target.ask);
      /* A reference is how the other side finds its payment. A Ryntra link's
         reference is paid through the link; any other cannot be carried by a
         plain transfer, and sending without it would pay nobody's invoice. */
      for (const reference of target.ask.references) {
        const id = await deps.linkIdByReference(reference);
        if (id !== null) return fromScannedLink(base("solana-pay"), await deps.readLink(id), target.address, target.ask, asked, from);
      }
      const requested = { ...base("solana-pay"), address: target.address, asset: { mint: target.ask.mint }, asked };
      if (target.ask.references.length > 0) return { ...requested, problem: "REFERENCE_UNSUPPORTED" };
      if (target.ask.memo !== null) return { ...requested, problem: "REQUEST_UNSUPPORTED" };
      return classify(deps, requested, from);
    }
    case "address":
      return classify(deps, { ...base("address"), address: target.address }, from);
  }
}

function askedOf(ask: SolanaPayAsk): RecipientCheck["asked"] {
  return { amount: ask.amount, mint: ask.mint, label: ask.label, message: ask.message };
}

function fromLink(
  base: RecipientCheck,
  link: PayLink | null,
  asked: RecipientCheck["asked"],
  from: string | null,
): RecipientCheck {
  if (!link) return { ...base, asked, problem: "LINK_NOT_FOUND" };
  const linked = { ...base, asked, link, address: link.recipient.address, asset: { mint: link.token.mint } };
  if (link.status === "PAID") return { ...linked, problem: "LINK_PAID" };
  if (link.status === "EXPIRED") return { ...linked, problem: "LINK_EXPIRED" };
  /* The chain could not be read about it: it may already be paid. An unknown is never a pass. */
  if (link.status === "CHECKING" || link.status === "UNKNOWN") return { ...linked, problem: "LINK_UNCONFIRMED" };
  if (from !== null && from === link.recipient.address) return { ...linked, problem: "SELF" };
  return { ...linked, next: "pay-link" };
}

/**
 * A link found by a scanned request's reference. A reference is public — it is
 * an account key of every payment that carried it — so knowing one proves
 * nothing about holding the link. The link is answered only when the scanned
 * request is the link's own: the same recipient, token, amount and note its
 * `payUrl` states, and only while it can still be paid; otherwise nothing of
 * the link is said.
 *
 * The state is judged before the terms: a link that can no longer be paid
 * answers the same whatever the scan states, so a request cannot be varied
 * against it to confirm a guessed note of a link the chain shows paid.
 */
function fromScannedLink(
  base: RecipientCheck,
  link: PayLink | null,
  recipient: string,
  ask: SolanaPayAsk,
  asked: RecipientCheck["asked"],
  from: string | null,
): RecipientCheck {
  const scanned = { ...base, asked, address: recipient, asset: { mint: ask.mint } };
  if (!link) return { ...scanned, problem: "LINK_NOT_FOUND" };
  if (link.status === "PAID") return { ...scanned, problem: "LINK_PAID" };
  if (link.status === "EXPIRED") return { ...scanned, problem: "LINK_EXPIRED" };
  if (link.status === "CHECKING" || link.status === "UNKNOWN") return { ...scanned, problem: "LINK_UNCONFIRMED" };
  if (!sameTerms(link, recipient, ask)) return { ...scanned, problem: "LINK_MISMATCH" };
  return fromLink(base, link, asked, from);
}

/**
 * The scanned request states exactly what the link's own Solana Pay request
 * states — no more: a memo the link does not carry would be dropped by paying
 * through the link, so it is not the link's request.
 */
function sameTerms(link: PayLink, recipient: string, ask: SolanaPayAsk): boolean {
  if (recipient !== link.recipient.address) return false;
  if (ask.mint !== link.token.mint) return false;
  if (ask.memo !== null) return false;
  if ((ask.message ?? null) !== (link.description ?? null)) return false;
  if (link.amount === null) return ask.amount === null;
  if (ask.amount === null) return false;
  const parsed = parseHumanAmount(ask.amount, link.token.decimals);
  return parsed.ok && parsed.raw === link.amount.raw;
}

async function classify(
  deps: RecipientCheckDeps,
  check: Omit<RecipientCheck, "address"> & Readonly<{ address: string }>,
  from: string | null,
): Promise<RecipientCheck> {
  if (from !== null && check.address === from) return { ...check, problem: "SELF" };
  const mint = check.asset.mint;
  let resolved: SendRecipientResolution;
  if (mint === null) {
    resolved = await deps.resolveNative(check.address);
  } else {
    const program = await deps.tokenProgramOf(mint);
    if (!program.ok) return { ...check, problem: program.unavailable ? "RECIPIENT_UNREADABLE" : "MINT_UNREADABLE" };
    resolved = await deps.resolveToken({ address: check.address, mint, tokenProgram: program.tokenProgram });
  }
  if (!resolved.ok) return { ...check, problem: resolved.code };
  const destination = {
    kind: resolved.kind === "EXISTING_TOKEN_ACCOUNT" ? ("token-account" as const) : ("wallet" as const),
    owner: resolved.owner,
    account: resolved.destinationTokenAccount ?? check.address,
    opensAccount: resolved.createsAccount,
  };
  /* A token account the sender owns is the sender's own money too. */
  if (from !== null && destination.owner === from) return { ...check, destination, problem: "SELF" };
  return { ...check, destination, next: "transfer" };
}
