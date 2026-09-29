import { accountByWallet, accountResolveSolana } from "@/lib/account/rpc";
import { TelegramConnectRequestSchema } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { connectWalletTelegramChannel, disconnectWalletTelegramChannel, readWalletTelegramChannel, type TelegramChannelDeps } from "@/lib/api/v1/telegram.server";
import { getGuardRuntime } from "@/lib/guard/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The proven wallet's Telegram channel (contract 1.11.0, the mobile line's
 * request 17): whether a chat is connected and which handle, never the id;
 * the bot link with a signed fifteen-minute code; the disconnect. The same
 * channel Settings connects on ryntra.io — the binding is written only by the
 * bot when the person presses Start.
 */
function deps(): TelegramChannelDeps {
  return { store: getGuardRuntime().store, accountByWallet, accountResolveSolana };
}

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const read = await readWalletTelegramChannel(proof.address, deps());
  return read.ok ? apiJson(read.body) : apiFailure(read.code, read.message);
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const body = await readApiBody(request, TelegramConnectRequestSchema, 1_024);
  if (!body.ok) return body.response;
  const connect = await connectWalletTelegramChannel(proof.address, body.body.locale, deps());
  return connect.ok ? apiJson(connect.body) : apiFailure(connect.code, connect.message);
}

export async function DELETE(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const removed = await disconnectWalletTelegramChannel(proof.address, deps());
  return removed.ok ? apiJson(removed.body) : apiFailure(removed.code, removed.message);
}
