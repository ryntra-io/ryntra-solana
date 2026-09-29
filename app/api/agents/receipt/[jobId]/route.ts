import { keccak_256 } from "@noble/hashes/sha3.js";

import { createOutcomeReceipt } from "@/lib/agent-control/artifacts";
import { attestArtifact, loadIssuerKey } from "@/lib/agent-control/issuer";
import { reconcileObservedOutcome } from "@/lib/agent-control/reconcile";
import { AGENT_CONTROL_REGISTRY, registryPin } from "@/lib/agent-control/registry";
import { withAgentControlRoute } from "@/lib/agent-control/route-gate";
import { privateNoStoreHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC = "https://bsc-testnet.bnbchain.org";
const COMMERCE = "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE";
const CHAIN_REF = "eip155:97";
const EXPLORER = "https://testnet.bscscan.com/tx/";

const digest = (value: string) => `0x${Buffer.from(keccak_256(new TextEncoder().encode(value))).toString("hex")}`;
const selector = (signature: string) => digest(signature).slice(0, 10);
const word = (value: string | number | bigint) => BigInt(value).toString(16).padStart(64, "0");

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? method);
  return body.result;
}

/**
 * Read the job from the chain, not from anything this deployment already
 * believed. That is the whole difference between an observation and a claim,
 * so the read is a fresh `eth_call` on every request and nothing is cached.
 */
async function readJob(jobId: string) {
  const raw = (await rpc("eth_call", [
    { to: COMMERCE, data: selector("getJob(uint256)") + word(jobId) },
    "latest",
  ])) as string | null;
  if (!raw || raw === "0x") return null;
  const words = raw.slice(2).match(/.{64}/g) ?? [];
  const at = (index: number) => words[1 + index] ?? "";
  const address = (index: number) => `0x${at(index).slice(24)}`;
  const number = (index: number) => BigInt(`0x${at(index)}`).toString();
  const descriptionOffset = Number(BigInt(`0x${at(4)}`)) / 32;
  const length = Number(BigInt(`0x${at(descriptionOffset)}`));
  const description = Buffer.from(
    words.slice(1 + descriptionOffset + 1).join("").slice(0, length * 2),
    "hex",
  ).toString("utf8");
  return {
    id: number(0),
    client: address(1).toLowerCase(),
    provider: address(2).toLowerCase(),
    budget: number(5),
    description,
  };
}

/* The gate writes the advertised RateLimit headers from the durable decision;
   a response built here carries only the cache policy. */
function headers() {
  return privateNoStoreHeaders();
}

export const GET = withAgentControlRoute<{ params: Promise<{ jobId: string }> }>(
  { route: "/api/agents/receipt/[jobId]" },
  async (request: Request, context: { params: Promise<{ jobId: string }> }) => {

  const { jobId } = await context.params;
  if (!/^[0-9]{1,12}$/.test(jobId)) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "A job id is a number." } }, { status: 400, headers: headers() });
  }

  const txHash = new URL(request.url).searchParams.get("tx") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "A transaction hash is required." } }, { status: 400, headers: headers() });
  }

  let job: Awaited<ReturnType<typeof readJob>>;
  let observedAt: string;
  try {
    const receipt = (await rpc("eth_getTransactionReceipt", [txHash])) as { status?: string; blockNumber?: string } | null;
    if (!receipt || receipt.status !== "0x1") {
      return Response.json({ error: { code: "NOT_OBSERVED", message: "That transaction did not succeed on this chain." } }, { status: 422, headers: headers() });
    }
    const block = (await rpc("eth_getBlockByNumber", [receipt.blockNumber, false])) as { timestamp: string };
    observedAt = new Date(Number(BigInt(block.timestamp)) * 1_000).toISOString();
    job = await readJob(jobId);
  } catch {
    return Response.json({ error: { code: "UPSTREAM_FAILURE", message: "The chain could not be read." } }, { status: 502, headers: headers() });
  }
  if (!job) {
    return Response.json({ error: { code: "NOT_OBSERVED", message: "No such job on this chain." } }, { status: 404, headers: headers() });
  }

  const source = `${EXPLORER}${txHash}`;
  const observedEffects = [
    { description: `Job ${job.id} created with description "${job.description}"`, sourceRef: source, observedAt },
    { description: `Client ${job.client} recorded on chain`, sourceRef: `${source}#eventlog`, observedAt },
    { description: `Provider ${job.provider} recorded on chain`, sourceRef: `${source}#eventlog`, observedAt },
    {
      description: job.budget === "0" ? "Budget 0 — no value moved" : `Budget ${job.budget} committed`,
      sourceRef: source,
      observedAt,
    },
  ];
  const expectedEffects = [`job ${job.id} created`, `client ${job.client}`, `provider ${job.provider}`];
  const reconciliation = reconcileObservedOutcome({
    expectedEffects,
    observed: { status: "MATCHED", chainRef: CHAIN_REF, transactionHash: txHash, observedEffects, reconciledAt: new Date().toISOString() },
  });

  const outcome = {
    status: reconciliation.status,
    chainRef: CHAIN_REF,
    transactionHash: txHash,
    observedEffects,
    reconciledAt: new Date().toISOString(),
  } as const;
  const registry = registryPin(AGENT_CONTROL_REGISTRY, ["adapter:bnb-apex@1", "action:bnb-apex/create-job-draft@1"]);
  const actionPassportHash = digest(`ryntra.agent-control.job.${CHAIN_REF}.${job.id}`);

  /*
   * Minted unsigned first so the content hash the signature covers exists
   * before the signature does — the axes are independent precisely because the
   * hash does not move when one is attached.
   */
  /* One `now` for both mints. The first version let each call stamp its own
     createdAt, so the second receipt carried a different content hash than the
     one the signature had just been made over - and the live verifier said so:
     SIGNATURE_INVALID, the signature does not cover this artifact. A signature
     is a claim about exact bytes, and any field that moves between minting and
     signing breaks it. */
  const mintedAt = new Date();
  const draft = { id: `outcome_job-${job.id}`, actionPassportHash, outcome, registry, now: mintedAt };
  const unsigned = createOutcomeReceipt(draft);
  const issuer = attestArtifact({
    kind: "OUTCOME_RECEIPT",
    contentHash: unsigned.contentHash,
    key: loadIssuerKey(),
    now: mintedAt,
  });
  const receipt = createOutcomeReceipt({ ...draft, issuer });

  return Response.json(
    {
      data: {
        receipt,
        reconciliation: {
          status: reconciliation.status,
          matched: reconciliation.matched,
          expected: reconciliation.expected,
          unexpected: reconciliation.unexpected,
        },
        limitations: [
          "Ryntra observed and reconciled this outcome. It did not create, fund, submit or execute the job.",
          "Every write to this chain was made by a wallet Ryntra does not hold.",
        ],
      },
    },
    { headers: headers() },
  );
  },
);
