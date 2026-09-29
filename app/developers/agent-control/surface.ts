export type HttpOperation = {
  method: "GET" | "POST";
  path: string;
  sdkMethod: string;
  purpose: string;
  boundary: string;
  operationMode: "PREVIEW" | "READ ONLY";
};

export type McpTool = {
  name: string;
  purpose: string;
  boundary: string;
};

export const HTTP_OPERATIONS: readonly HttpOperation[] = [
  {
    method: "GET",
    path: "/api/agents/demo",
    sdkMethod: "demo()",
    purpose: "Create a fresh source-only Action Passport Preview from the bounded sample.",
    boundary: "Sample data; no provider or chain request.",
    operationMode: "PREVIEW",
  },
  {
    method: "GET",
    path: "/api/agents/passport?address=...",
    sdkMethod: "agentPassport(address)",
    purpose: "Inspect one exact Agentverse address through fixed public read origins.",
    boundary: "No ownership, endpoint probe, chat, registration or score.",
    operationMode: "READ ONLY",
  },
  {
    method: "POST",
    path: "/api/agents/preflight",
    sdkMethod: "preflight(input)",
    purpose: "Validate AgentActionIntent 1.0.0 and run the deterministic source-preview policy path.",
    boundary: "No authorization, signing, provider submission or execution.",
    operationMode: "PREVIEW",
  },
  {
    method: "POST",
    path: "/api/agents/verify",
    sdkMethod: "verifyActionPassportPreview(passport)",
    purpose: "Recompute the integrity of a Action Passport Preview.",
    boundary: "Integrity does not prove execution, settlement or outcome.",
    operationMode: "PREVIEW",
  },
  {
    method: "GET",
    path: "/api/agents/agent-launch/tokens",
    sdkMethod: "agentLaunchTokens()",
    purpose: "List Agent Launch public token records for the server-fixed BSC Testnet scope.",
    boundary: "No query parameters; server-fixed chainId 97; an honest empty response remains ZERO_STATE.",
    operationMode: "READ ONLY",
  },
  {
    method: "GET",
    path: "/api/agents/agent-launch/tokens/{address}",
    sdkMethod: "agentLaunchToken(address)",
    purpose: "Inspect one exact 20-byte token address in the BSC Testnet public record set.",
    boundary: "One 20-byte EVM path address, no query; no launch, tokenization, holder or graduation claim.",
    operationMode: "READ ONLY",
  },
  {
    method: "POST",
    path: "/api/agents/bnb-apex/observe",
    sdkMethod: "observeBnbApex({ jobId, txHash })",
    purpose: "Observe one explicitly supplied BNB APEX job and transaction reference.",
    boundary: "Exactly jobId + txHash; no extra keys, caller RPC/chain/origin, open log scan or write.",
    operationMode: "READ ONLY",
  },
] as const;

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "draft_agent_action_intent",
    purpose: "Draft a strict AgentActionIntent 1.0.0 from bounded caller input.",
    boundary: "Local construction only; it does not create a provider job.",
  },
  {
    name: "inspect_agentverse_agent",
    purpose: "Inspect one exact Agentverse address and preserve claims, observations and unknowns.",
    boundary: "No endpoint call, ownership claim, chat or registration.",
  },
  {
    name: "list_agent_launch_testnet_tokens",
    purpose: "List normalized public token records for Agent Launch BSC Testnet.",
    boundary: "Fixed chainId 97; ZERO_STATE remains a valid result.",
  },
  {
    name: "inspect_agent_launch_testnet_token",
    purpose: "Inspect one exact Agent Launch BSC Testnet token address.",
    boundary: "Read-only provider record; no launch or adoption inference.",
  },
  {
    name: "run_agent_action_preflight",
    purpose: "Run the deterministic Agent Control source-preview policy path.",
    boundary: "No model verdict, authorization, signer or execution path.",
  },
  {
    name: "verify_action_passport_preview",
    purpose: "Recompute Action Passport Preview integrity from caller-supplied JSON.",
    boundary: "A valid digest is not a finalized Outcome Receipt.",
  },
  {
    name: "observe_bnb_apex_testnet_job",
    purpose: "Read one known BNB APEX BSC Testnet job and transaction reference.",
    boundary: "Exact jobId + txHash and allowlisted contracts only; never scans broadly.",
  },
  /* The five write tools RYN-AGENT-CONTROL-013 added. Each writes one record in
     the local server process and produces the same kind of thing every time: a
     proposal at PROPOSE. None of them is in the published kit, which is why the
     surface separates the counts rather than adding five to seven. */
  {
    name: "propose_action",
    purpose: "Record a proposed action against one allowlisted registry reference.",
    boundary: "Writes a proposal at PROPOSE. Never an authorization, a mandate or a signature.",
  },
  {
    name: "attach_proposal_evidence",
    purpose: "Add source-labelled evidence to a proposal this process already holds.",
    boundary: "Evidence keeps its source and never becomes a verdict.",
  },
  {
    name: "request_human_review",
    purpose: "Mark a proposal as waiting on a person.",
    boundary: "Asking is the whole effect; the record does not leave PROPOSE.",
  },
  {
    name: "retract_proposal",
    purpose: "Retract a proposal, keeping the record and the stated reason.",
    boundary: "Retraction is recorded, not erased.",
  },
  {
    name: "ingest_a2a_task",
    purpose: "Turn one inbound A2A 1.0 task and its Agent Card into a proposal.",
    boundary: "A2A 1.0 §7.6.4: auth-required is not authorization, and completed promotes nothing.",
  },
] as const;

/** The seven that only read. Split out because the published kit is exactly these. */
export const MCP_READ_TOOL_COUNT = 7;

/** The five that write one local proposal and can produce nothing else. */
export const MCP_WRITE_TOOL_COUNT = 5;

export const REFERENCE_STEPS = [
  {
    label: "Inspect",
    method: "agentPassport(address)",
    detail: "Separate provider declarations from Ryntra observations, conflicts and unknowns.",
  },
  {
    label: "Draft",
    method: "draft_agent_action_intent",
    detail: "Create a strict versioned proposal without creating a provider job.",
  },
  {
    label: "Preflight",
    method: "preflight(input)",
    detail: "Run deterministic policy and keep the human decision outside the verdict.",
  },
  {
    label: "Verify",
    method: "verifyActionPassportPreview(passport)",
    detail: "Recompute preview integrity while outcome and finalization remain unavailable.",
  },
] as const;

export const CAPABILITY_MATRIX = [
  {
    registryId: "agentverse-public-passport",
    input: "Exact Agentverse address",
    output: "Claims · observations · conflicts · unknowns · digest",
  },
  {
    registryId: "agent-control-intent",
    input: "Bounded action proposal",
    output: "AgentActionIntent 1.0.0",
  },
  {
    registryId: "agent-control-preflight",
    input: "Strict intent",
    output: "Evidence and versioned policy result",
  },
  {
    registryId: "agent-decision-passport-preview",
    input: "Action Passport Preview",
    output: "Recomputed validity and exact issues",
  },
  {
    registryId: "agent-launch-public-read",
    input: "List or exact token address",
    output: "Normalized chainId 97 provider records",
  },
  {
    registryId: "bnb-apex-read-observer",
    input: "Decimal jobId + 32-byte txHash",
    output: "Transaction binding and observed job state",
  },
] as const;

export const LOCAL_SOURCE_COMMAND = [
  "AGENTVERSE_ADDRESS=<EXACT_AGENTVERSE_ADDRESS> \\",
  "RYNTRA_BASE_URL=http://localhost:3000 \\",
  "node examples/agent-control-builder/example.ts",
].join("\n");

export const BNB_OBSERVER_COMMAND = [
  "curl -sS -X POST http://localhost:3000/api/agents/bnb-apex/observe \\",
  '  -H "content-type: application/json" \\',
  `  --data '{"jobId":"<KNOWN_JOB_ID>","txHash":"<KNOWN_TX_HASH>"}'`,
].join("\n");
