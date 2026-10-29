/**
 * A Solana RPC on tape, for the venues' tests: `recordingConnection` passes
 * every call to a real endpoint and writes the call and its answer down;
 * `replayConnection` answers the same calls from the tape with no network.
 * The SDKs read through `Connection`, so the tests run the real DLMM and DAMM
 * v2 code — decoding, quotes and instruction building — on mainnet state
 * frozen at one moment (`scripts/liquidity/record-studio-fixtures.mjs`).
 *
 * A call is matched by its method and its exact parameters and always gets
 * the first answer the tape holds for it: the chain moves while a recording
 * runs, and one frozen answer per call keeps a test's reads agreeing with each
 * other whatever order the test makes them in. A call the tape does not hold
 * fails loudly with its key, so a test never passes on an answer it did not
 * have. One exception: `simulateTransaction` — the DLMM SDK simulates its own
 * instructions only to size the compute budget, and the instructions it builds
 * from the frozen state need not be byte for byte the ones it built while
 * recording — is answered by method alone.
 */

import { Connection, type Commitment } from "@solana/web3.js";

export type TapeCall = Readonly<{ method: string; params: unknown; response: unknown }>;
export type Tape = Readonly<{ endpoint: string; recordedAt: string; calls: readonly TapeCall[] }>;

type RpcRequest = (method: string, args: unknown[]) => Promise<unknown>;
type RpcBatchRequest = (requests: ReadonlyArray<{ methodName: string; args: unknown[] }>) => Promise<unknown[]>;
type RpcInternals = { _rpcRequest: RpcRequest; _rpcBatchRequest: RpcBatchRequest };

const BY_METHOD_ALONE: ReadonlySet<string> = new Set(["simulateTransaction"]);

const keyOf = (method: string, params: unknown): string => `${method} ${JSON.stringify(params)}`;

export function recordingConnection(endpoint: string, calls: TapeCall[], commitment: Commitment = "confirmed"): Connection {
  const connection = new Connection(endpoint, commitment);
  const internals = connection as unknown as RpcInternals;
  const single = internals._rpcRequest;
  const batch = internals._rpcBatchRequest;
  internals._rpcRequest = async (method, args) => {
    const response = await single(method, args);
    calls.push({ method, params: args, response });
    return response;
  };
  internals._rpcBatchRequest = async (requests) => {
    const responses = await batch(requests);
    requests.forEach((request, index) => calls.push({ method: request.methodName, params: request.args, response: responses[index] }));
    return responses;
  };
  return connection;
}

export class TapeMiss extends Error {
  constructor(key: string) {
    super(`The tape holds no answer for ${key.slice(0, 400)}`);
    this.name = "TapeMiss";
  }
}

export function replayConnection(tape: Tape, commitment: Commitment = "confirmed"): Connection {
  const answers = new Map<string, unknown>();
  const byMethod = new Map<string, unknown>();
  for (const call of tape.calls) {
    const key = keyOf(call.method, call.params);
    if (!answers.has(key)) answers.set(key, call.response);
    if (!byMethod.has(call.method)) byMethod.set(call.method, call.response);
  }
  const answer = (method: string, args: unknown): unknown => {
    const key = keyOf(method, args);
    if (answers.has(key)) return answers.get(key);
    if (BY_METHOD_ALONE.has(method) && byMethod.has(method)) return byMethod.get(method);
    throw new TapeMiss(key);
  };
  /* The endpoint is never dialled: every request is answered from the tape before it leaves. */
  const connection = new Connection("http://127.0.0.1:9", commitment);
  const internals = connection as unknown as RpcInternals;
  internals._rpcRequest = async (method, args) => answer(method, args);
  internals._rpcBatchRequest = async (requests) => requests.map((request) => answer(request.methodName, request.args));
  return connection;
}
