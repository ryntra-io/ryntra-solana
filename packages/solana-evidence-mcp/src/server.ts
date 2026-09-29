import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  EXAMPLE_CAUTIOUS_POLICY,
  SOLANA_EVIDENCE_KIT_LIMITATIONS,
  SOLANA_NETWORKS,
  SolanaOwnerPolicySchema,
  SplTransferInputSchema,
  inspectSolanaMint,
  preflightSolanaAction,
  verifySolanaReceipt,
  type SolanaAssetPassport,
  type SolanaPolicyVerdict,
  type SolanaReceiptVerification,
  type SplTransferPreflight,
} from "../../solana-evidence-sdk/src/index.ts";

export const SOLANA_MCP_MAX_RESULT_BYTES = 96 * 1_024;
export const SOLANA_MCP_MAX_RECEIPT_INPUT_BYTES = 64 * 1_024;

/**
 * The RPC endpoint is read from the environment and never from a tool call.
 *
 * A tool argument that names a URL is a request forgery surface wearing a
 * convenience costume: the model would be choosing what this process connects
 * to. The operator picks the endpoint through `RYNTRA_SOLANA_RPC_MAINNET` /
 * `RYNTRA_SOLANA_RPC_DEVNET`, or gets the public default; the tool input
 * chooses only which of the two named networks to read.
 */
const NetworkSchema = z.enum(SOLANA_NETWORKS).default("mainnet");

const localReadOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const upstreamReadOnlyAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

type ToolData =
  | Readonly<{ passport: SolanaAssetPassport }>
  | Readonly<{ passport: SolanaAssetPassport; preflight: SplTransferPreflight; verdict: SolanaPolicyVerdict }>
  | SolanaReceiptVerification
  | Readonly<{ policy: typeof EXAMPLE_CAUTIOUS_POLICY; note: string }>;

type ToolErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "EVIDENCE_UNAVAILABLE"
  | "UNKNOWN_TOOL"
  | "VALIDATION_ERROR"
  | "TOOL_REQUEST_FAILED";

const textEncoder = new TextEncoder();

function serializedBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    return textEncoder.encode(serialized).byteLength;
  } catch {
    return null;
  }
}

function toolFailureCode(code: ToolErrorCode, detail?: string) {
  const messages: Record<ToolErrorCode, string> = {
    PAYLOAD_TOO_LARGE: "The bounded tool payload exceeds the application byte limit.",
    EVIDENCE_UNAVAILABLE: "The read-only evidence could not be established.",
    UNKNOWN_TOOL: "The requested tool is not available.",
    VALIDATION_ERROR: "The tool input was not accepted.",
    TOOL_REQUEST_FAILED: "The read-only tool request could not be completed.",
  };
  const output = {
    error: { code, message: detail ? `${messages[code]} ${detail}` : messages[code] },
  };
  const result = {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
  const bytes = serializedBytes(result);
  if (bytes !== null && bytes <= SOLANA_MCP_MAX_RESULT_BYTES) return result;

  const fallback = {
    error: {
      code: "TOOL_REQUEST_FAILED" as const,
      message: "The read-only tool request could not be completed.",
    },
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(fallback) }],
    structuredContent: fallback,
  };
}

function toolSuccess(data: ToolData) {
  const output = { data, limitations: SOLANA_EVIDENCE_KIT_LIMITATIONS };
  let textPayload: string;
  try {
    textPayload = JSON.stringify(output);
  } catch {
    return toolFailureCode("TOOL_REQUEST_FAILED");
  }
  const duplicated = {
    content: [{ type: "text" as const, text: textPayload }],
    structuredContent: output,
  };
  const duplicatedBytes = serializedBytes(duplicated);
  if (duplicatedBytes !== null && duplicatedBytes <= SOLANA_MCP_MAX_RESULT_BYTES) return duplicated;

  const structuredOnly = {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ dataLocation: "structuredContent", bounded: true }),
    }],
    structuredContent: output,
  };
  const structuredBytes = serializedBytes(structuredOnly);
  if (structuredBytes !== null && structuredBytes <= SOLANA_MCP_MAX_RESULT_BYTES) return structuredOnly;
  return toolFailureCode("PAYLOAD_TOO_LARGE");
}

const InspectInputSchema = z
  .object({
    mint: z.string().min(32).max(44),
    network: NetworkSchema,
  })
  .strict();

const PreflightInputSchema = z
  .object({
    /* The proposal's own schema, imported from the registry adapter rather
       than restated: the MCP surface and the product accept exactly the same
       proposal or one of them is wrong. */
    input: SplTransferInputSchema,
    /** Omitted means the exported cautious example, and the result says so. */
    policy: SolanaOwnerPolicySchema.optional(),
    /** Which transfer-fee epoch config applies, as a decimal string. */
    epoch: z.string().regex(/^(0|[1-9]\d*)$/).max(20).optional(),
  })
  .strict();

const VerifyInputSchema = z
  .object({
    receipt: z.unknown(),
    trustedPublicKeys: z.array(z.string().min(32).max(128)).max(8).optional(),
  })
  .strict();

/**
 * A receipt arrives as opaque JSON, so its size and depth are bounded before
 * the schema ever sees it — an unbounded structure is a denial of service
 * that a strict schema alone does not prevent.
 */
function isWithinReceiptBoundary(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 32) return false;
    if (typeof current.value === "string" && current.value.length > 80_000) return false;
    if (Array.isArray(current.value)) {
      for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === "object") {
      for (const [key, entry] of Object.entries(current.value)) {
        if (key.length > 128) return false;
        stack.push({ value: entry, depth: current.depth + 1 });
      }
    } else if (
      current.value !== null
      && typeof current.value !== "string"
      && typeof current.value !== "boolean"
      && !(typeof current.value === "number" && Number.isFinite(current.value))
    ) {
      return false;
    }
  }
  const bytes = serializedBytes(value);
  return bytes !== null && bytes <= SOLANA_MCP_MAX_RECEIPT_INPUT_BYTES;
}

async function dispatchUnchecked(name: string, rawInput: unknown) {
  switch (name) {
    case "inspect_solana_mint": {
      const parsed = InspectInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      const result = await inspectSolanaMint(parsed.data.mint, { network: parsed.data.network });
      if (!result.ok) return toolFailureCode("EVIDENCE_UNAVAILABLE", `${result.code}: ${result.reason}`);
      return toolSuccess({ passport: result.passport });
    }
    case "preflight_solana_action": {
      const parsed = PreflightInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      const result = await preflightSolanaAction({
        input: parsed.data.input,
        policy: parsed.data.policy ?? EXAMPLE_CAUTIOUS_POLICY,
        epoch: parsed.data.epoch === undefined ? null : BigInt(parsed.data.epoch),
      });
      if (!result.ok) return toolFailureCode("EVIDENCE_UNAVAILABLE", `${result.code}: ${result.reason}`);
      return toolSuccess({
        passport: result.passport,
        preflight: result.preflight,
        verdict: result.verdict,
      });
    }
    case "verify_solana_receipt": {
      const parsed = VerifyInputSchema.safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      if (!isWithinReceiptBoundary(parsed.data.receipt)) return toolFailureCode("PAYLOAD_TOO_LARGE");
      return toolSuccess(
        verifySolanaReceipt(parsed.data.receipt, { trustedPublicKeys: parsed.data.trustedPublicKeys }),
      );
    }
    case "read_example_owner_policy": {
      const parsed = z.object({}).strict().safeParse(rawInput);
      if (!parsed.success) return toolFailureCode("VALIDATION_ERROR");
      return toolSuccess({
        policy: EXAMPLE_CAUTIOUS_POLICY,
        note: "A starting point to edit, not a recommendation. A policy is the owner's declaration; this server never chooses one for them.",
      });
    }
    default:
      return toolFailureCode("UNKNOWN_TOOL");
  }
}

export async function dispatchSolanaEvidenceTool(name: string, rawInput: unknown) {
  try {
    return await dispatchUnchecked(name, rawInput);
  } catch {
    return toolFailureCode("TOOL_REQUEST_FAILED");
  }
}

export function createSolanaEvidenceMcpServer(): McpServer {
  const server = new McpServer(
    { name: "ryntra-solana-evidence", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "inspect_solana_mint",
    {
      title: "Read one Solana mint as an Asset Passport",
      description:
        "Read one mint through a public Solana RPC and return its identity, issuer authorities and every Token Extension with provenance and holder-language meaning. Read-only: no key, no transaction, no signature.",
      inputSchema: InspectInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input) => dispatchSolanaEvidenceTool("inspect_solana_mint", input),
  );

  server.registerTool(
    "preflight_solana_action",
    {
      title: "Preview an SPL transfer and judge it against a policy",
      description:
        "Compute the exact transfer preview — fee math from the mint's own configuration, what the recipient receives, structural blockers — and evaluate it against a declared owner policy. The best verdict is NO_KNOWN_BLOCKER, which is not a safety judgement. Nothing is signed or submitted.",
      inputSchema: PreflightInputSchema,
      annotations: upstreamReadOnlyAnnotations,
    },
    async (input) => dispatchSolanaEvidenceTool("preflight_solana_action", input),
  );

  server.registerTool(
    "verify_solana_receipt",
    {
      title: "Verify a Ryntra Outcome Receipt offline",
      description:
        "Recompute a receipt's content and integrity hashes, check its Ed25519 issuer signature against the key it carries, and report whether its registry pin names the Solana adapter. Entirely local: no network call and nothing is asked of Ryntra.",
      inputSchema: VerifyInputSchema,
      annotations: localReadOnlyAnnotations,
    },
    async (input) => dispatchSolanaEvidenceTool("verify_solana_receipt", input),
  );

  server.registerTool(
    "read_example_owner_policy",
    {
      title: "Read the example owner policy",
      description:
        "Return the cautious example policy as an editable starting shape. It is an example, never a recommendation: the owner declares the policy and this server never chooses one for them.",
      inputSchema: z.object({}).strict(),
      annotations: localReadOnlyAnnotations,
    },
    async (input) => dispatchSolanaEvidenceTool("read_example_owner_policy", input),
  );

  /* The high-level SDK validates tools before registered callbacks and puts raw
     tool and key names in its default error text. Replace only tools/call with
     the fixed redacted boundary; tools/list keeps the four registered
     definitions above, so the inventory and its JSON Schemas cannot drift. */
  server.server.setRequestHandler("tools/call", async (request) => (
    dispatchSolanaEvidenceTool(request.params.name, request.params.arguments ?? {})
  ));

  return server;
}
