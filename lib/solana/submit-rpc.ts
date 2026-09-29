/** Primary-only, one-shot Solana write transport. Never shipped in the read-only kit. */

import { parseJsonWithBigInts, stringifyJsonWithBigInts } from "@solana/rpc-spec-types";

import { readBoundedRpcResponse, type SolanaRpcHandle } from "./rpc.ts";

/** A JSON-RPC answer proves the provider received and rejected the write. */
export class SolanaSubmitRpcError extends Error {
  readonly rpcCode: string;
  readonly rpcData: unknown;

  constructor(args: { code: unknown; message: unknown; data?: unknown }) {
    super(typeof args.message === "string" ? args.message : "The Solana RPC rejected sendTransaction.");
    this.name = "SolanaSubmitRpcError";
    this.rpcCode = String(args.code ?? "UNKNOWN");
    this.rpcData = args.data;
  }
}

type SubmitRpcEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ code?: unknown; message?: unknown; data?: unknown }>;
}>;

/** Exactly one POST to the reviewed primary. No fallback and no retry. */
export async function sendTransactionOnce(args: {
  handle: SolanaRpcHandle;
  signedWireBase64: string;
  deadlineAt?: number;
}): Promise<string> {
  const endpoint = args.handle.endpoints[0];
  const remainingMs = args.deadlineAt === undefined
    ? args.handle.timeoutMs
    : args.deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw new Error("The settlement request deadline elapsed before sendTransaction started.");
  }
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "solana-client": "ryntra/@solana/kit",
    },
    body: stringifyJsonWithBigInts({
      jsonrpc: "2.0",
      id: "ryntra-submit-once",
      method: "sendTransaction",
      params: [
        args.signedWireBase64,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        },
      ],
    }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(args.handle.timeoutMs, remainingMs))),
  });
  if (!response.ok) {
    throw new Error(`${endpoint.host} answered HTTP ${response.status} to sendTransaction`);
  }
  const raw = await readBoundedRpcResponse(
    response,
    args.handle.maxResponseBytes,
    endpoint.host,
  );
  const envelope = parseJsonWithBigInts(raw) as SubmitRpcEnvelope;
  if (envelope.error) {
    throw new SolanaSubmitRpcError({
      code: envelope.error.code,
      message: envelope.error.message,
      data: envelope.error.data,
    });
  }
  if (typeof envelope.result !== "string" || envelope.result.length === 0) {
    throw new Error(`${endpoint.host} returned no transaction signature from sendTransaction`);
  }
  return envelope.result;
}
