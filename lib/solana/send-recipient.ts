import { isOffCurveAddress, type Address } from "@solana/kit";

import { parseSolanaAddress } from "./address.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";
import { SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./send-kinds.ts";
import { associatedTokenAccount } from "./token-account.ts";

/**
 * Who may receive, decided before a single byte is built.
 *
 * Two mistakes here are not typos and cannot be undone. Native SOL sent to a
 * program-owned or off-curve address lands where no key can ever sign for it,
 * and a token sent to an account of the wrong mint is a transaction the chain
 * refuses only after a person has already approved it in their wallet. One
 * account read separates both from the ordinary case, so the read happens
 * before the wallet is ever opened rather than after.
 *
 * Everything here fails closed. An address that cannot be classified is
 * refused with the reason it could not be, never accepted on the theory that
 * it is probably fine.
 */

export const SEND_RECIPIENT_REFUSALS = [
  "UNSAFE_SOL_RECIPIENT",
  "RECIPIENT_MINT_MISMATCH",
  "RECIPIENT_PROGRAM_MISMATCH",
  "RECIPIENT_ACCOUNT_MALFORMED",
  "OFF_CURVE_OWNER_UNSUPPORTED",
  /* Contract 1.22.0: two causes the malformed code used to carry, told apart
     for the recipient check — a destination the chain says is frozen, and an
     endpoint that did not answer (nothing is known about the address then). */
  "RECIPIENT_FROZEN",
  "RECIPIENT_UNREADABLE",
] as const;
export type SendRecipientRefusal = (typeof SEND_RECIPIENT_REFUSALS)[number];

export type SendRecipientResolution =
  | Readonly<{
      ok: true;
      kind: "WALLET_OWNER";
      owner: string;
      destinationTokenAccount: string | null;
      createsAccount: boolean;
    }>
  | Readonly<{
      ok: true;
      kind: "EXISTING_TOKEN_ACCOUNT";
      owner: string;
      destinationTokenAccount: string;
      createsAccount: false;
    }>
  | Readonly<{ ok: false; code: SendRecipientRefusal; reason: string }>;

type ParsedAccountInfo = Readonly<{
  owner: string;
  executable: boolean;
  data: unknown;
}> | null;

function refuse(code: SendRecipientRefusal, reason: string): SendRecipientResolution {
  return { ok: false, code, reason };
}

/**
 * Off the ed25519 curve means no private key can exist for it. That is exactly
 * what makes a program-derived address useful and exactly what makes it a
 * terminal destination for lamports.
 */
function offCurve(address: string): boolean {
  try {
    return isOffCurveAddress(address as Address);
  } catch {
    /* An address that will not even be examined is not proven on-curve, and
       this function is only ever consulted to decide whether to refuse. */
    return true;
  }
}

async function readAccount(
  handle: SolanaRpcHandle,
  address: string,
): Promise<Readonly<{ ok: true; account: ParsedAccountInfo }> | Readonly<{ ok: false; reason: string }>> {
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getAccountInfo(address as never, { encoding: "jsonParsed" }).send({ abortSignal }),
    );
    const value = response.value as unknown as ParsedAccountInfo;
    return { ok: true, account: value ?? null };
  } catch (failure) {
    return {
      ok: false,
      reason: `The endpoint did not answer for ${address}: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}

type TokenAccountFacts = Readonly<{
  type: string;
  mint: string | null;
  owner: string | null;
  state: string | null;
}>;

/** Read the `jsonParsed` shape without trusting any part of it to be present. */
function tokenFacts(data: unknown): TokenAccountFacts | null {
  if (typeof data !== "object" || data === null) return null;
  const parsed = (data as { parsed?: unknown }).parsed;
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  const info = (parsed as { info?: unknown }).info;
  if (typeof type !== "string") return null;
  const record = typeof info === "object" && info !== null ? (info as Record<string, unknown>) : {};
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : null);
  return { type, mint: text("mint"), owner: text("owner"), state: text("state") };
}

/**
 * Native SOL may only reach an address a key can sign for.
 *
 * A mint, a token account, an executable program and a program-derived address
 * are all refused — the first three because they are owned by a program that
 * will never return the lamports, the fourth because no signer for it exists.
 * An address with no account at all is fine: the System Program creates it,
 * which is the ordinary way a new wallet is funded.
 */
export async function resolveNativeRecipient(
  handle: SolanaRpcHandle,
  address: string,
): Promise<SendRecipientResolution> {
  const parsed = parseSolanaAddress(address, "recipient");
  if (!parsed.ok) return refuse("RECIPIENT_ACCOUNT_MALFORMED", parsed.reason);
  const recipient = parsed.address;

  if (offCurve(recipient)) {
    return refuse(
      "UNSAFE_SOL_RECIPIENT",
      "That address is off the ed25519 curve, so no key can sign for it. SOL sent there could never be moved again.",
    );
  }

  const read = await readAccount(handle, recipient);
  if (!read.ok) return refuse("RECIPIENT_UNREADABLE", read.reason);

  if (read.account === null) {
    return { ok: true, kind: "WALLET_OWNER", owner: recipient, destinationTokenAccount: null, createsAccount: true };
  }
  if (read.account.executable) {
    return refuse("UNSAFE_SOL_RECIPIENT", "That address is an executable program, not a wallet.");
  }
  if (String(read.account.owner) !== SYSTEM_PROGRAM_ID) {
    return refuse(
      "UNSAFE_SOL_RECIPIENT",
      `That account is owned by program ${String(read.account.owner)}, not the System Program, so SOL sent there is under that program's control rather than a person's.`,
    );
  }
  return { ok: true, kind: "WALLET_OWNER", owner: recipient, destinationTokenAccount: null, createsAccount: false };
}

/**
 * A token recipient is either a person's wallet — in which case the exact
 * associated account for this mint under this token program is derived — or an
 * existing token account the sender entered on purpose, which is preserved
 * only when its program, mint and layout all match the asset being sent.
 */
export async function resolveTokenRecipient(args: {
  handle: SolanaRpcHandle;
  address: string;
  mint: string;
  tokenProgram: string;
}): Promise<SendRecipientResolution> {
  const parsed = parseSolanaAddress(args.address, "recipient");
  if (!parsed.ok) return refuse("RECIPIENT_ACCOUNT_MALFORMED", parsed.reason);
  const entered = parsed.address;

  const read = await readAccount(args.handle, entered);
  if (!read.ok) return refuse("RECIPIENT_UNREADABLE", read.reason);

  if (read.account !== null && read.account.executable) {
    return refuse("RECIPIENT_PROGRAM_MISMATCH", "That address is an executable program, not a token destination.");
  }

  const ownerProgram = read.account === null ? null : String(read.account.owner);
  const isTokenOwned = ownerProgram === TOKEN_PROGRAM_ID || ownerProgram === TOKEN_2022_PROGRAM_ID;

  if (isTokenOwned) {
    const facts = tokenFacts(read.account?.data);
    if (!facts || facts.type !== "account" || facts.mint === null || facts.owner === null) {
      return refuse(
        "RECIPIENT_ACCOUNT_MALFORMED",
        "That address is owned by a token program but is not a token account this transfer can pay into.",
      );
    }
    if (ownerProgram !== args.tokenProgram) {
      return refuse(
        "RECIPIENT_PROGRAM_MISMATCH",
        `That token account belongs to ${ownerProgram}, and this asset is issued under ${args.tokenProgram}.`,
      );
    }
    if (facts.mint !== args.mint) {
      return refuse(
        "RECIPIENT_MINT_MISMATCH",
        `That token account holds ${facts.mint}, not the asset being sent.`,
      );
    }
    if (facts.state === "frozen") {
      return refuse(
        "RECIPIENT_FROZEN",
        "That destination token account is frozen, so the transfer would fail on chain.",
      );
    }
    return {
      ok: true,
      kind: "EXISTING_TOKEN_ACCOUNT",
      owner: facts.owner,
      destinationTokenAccount: entered,
      createsAccount: false,
    };
  }

  if (ownerProgram !== null && ownerProgram !== SYSTEM_PROGRAM_ID) {
    return refuse(
      "RECIPIENT_PROGRAM_MISMATCH",
      `That account is owned by program ${ownerProgram}. Enter the owner's wallet address, or a token account for this exact mint.`,
    );
  }

  /* A wallet, or an address with no account yet. Either way the destination is
     the associated account this mint derives for it — but only a key holder can
     ever be that owner. */
  if (offCurve(entered)) {
    return refuse(
      "OFF_CURVE_OWNER_UNSUPPORTED",
      "That address is off the ed25519 curve, so it cannot be the owner of an associated token account.",
    );
  }

  let destination: string;
  try {
    destination = await associatedTokenAccount({
      owner: entered,
      mint: args.mint,
      tokenProgram: args.tokenProgram,
    });
  } catch (failure) {
    return refuse(
      "RECIPIENT_ACCOUNT_MALFORMED",
      `The associated token account for that owner could not be derived: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }

  const destinationRead = await readAccount(args.handle, destination);
  if (!destinationRead.ok) return refuse("RECIPIENT_UNREADABLE", destinationRead.reason);

  if (destinationRead.account === null) {
    return {
      ok: true,
      kind: "WALLET_OWNER",
      owner: entered,
      destinationTokenAccount: destination,
      createsAccount: true,
    };
  }

  const destinationFacts = tokenFacts(destinationRead.account.data);
  if (destinationFacts?.state === "frozen") {
    return refuse(
      "RECIPIENT_FROZEN",
      "The recipient's associated token account for this mint is frozen, so the transfer would fail on chain.",
    );
  }
  return {
    ok: true,
    kind: "WALLET_OWNER",
    owner: entered,
    destinationTokenAccount: destination,
    createsAccount: false,
  };
}
