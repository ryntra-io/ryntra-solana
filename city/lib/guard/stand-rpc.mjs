// The Guard window's stand chain (CITY-152): a JSON-RPC server that answers the four reads the pre-sign check makes —
// getMultipleAccounts, simulateTransaction, getSignaturesForAddress, getEpochInfo — from `stand.mjs`.
//   node city/lib/guard/stand-rpc.mjs [port]          (default 8899)
//   RYNTRA_SOLANA_RPC_MAINNET=http://127.0.0.1:8899 RYNTRA_SOLANA_RPC_MAINNET_FALLBACK=http://127.0.0.1:8899 \
//     NEXT_PUBLIC_RYNTRA_CITY_GUARD=open npm run dev
// Every answer is a fixture: this exists so the engine's own route runs end to end where no RPC is reachable.
import { createServer } from "node:http";

import { BEFORE, NEW_ADDRESSES, SCENARIOS } from "./stand.mjs";

const port = Number(process.argv[2] ?? 8899);
const byWire = new Map(Object.values(SCENARIOS).map((scenario) => [scenario.transaction, scenario]));

const encode = (state) =>
  state === null || state === undefined
    ? null
    : { lamports: Number(state.lamports), owner: state.owner, data: [Buffer.from(state.data).toString("base64"), "base64"], executable: false, rentEpoch: 0, space: state.data.length };

function answer(method, params) {
  const context = { slot: 380_000_000, apiVersion: "2.3.0" };
  switch (method) {
    case "getMultipleAccounts":
      return { context, value: params[0].map((address) => encode(BEFORE[address])) };
    case "simulateTransaction": {
      const scenario = byWire.get(params[0]);
      const addresses = params[1]?.accounts?.addresses ?? [];
      if (!scenario) return { context, value: { err: "AccountNotFound", logs: [], accounts: null, unitsConsumed: 0, innerInstructions: [] } };
      return {
        context,
        value: {
          err: null,
          logs: ["Program 11111111111111111111111111111111 invoke [1]", "Program 11111111111111111111111111111111 success"],
          accounts: addresses.map((address) => encode(address in scenario.after ? scenario.after[address] : BEFORE[address])),
          unitsConsumed: 450,
          innerInstructions: [],
          returnData: null,
        },
      };
    }
    case "getSignaturesForAddress":
      return NEW_ADDRESSES.has(params[0]) ? [] : [{ signature: "5".repeat(88), slot: 379_000_000, err: null, memo: null, blockTime: 1_761_800_000, confirmationStatus: "finalized" }];
    case "getEpochInfo":
      return { absoluteSlot: 380_000_000, blockHeight: 358_000_000, epoch: 900, slotIndex: 1, slotsInEpoch: 432_000, transactionCount: null };
    default:
      return null;
  }
}

createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const one = (call) => ({ jsonrpc: "2.0", id: call.id, result: answer(call.method, call.params ?? []) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(Array.isArray(payload) ? payload.map(one) : one(payload)));
  });
}).listen(port, "127.0.0.1", () => console.log(`stand chain on http://127.0.0.1:${port}`));
