import type { AgentControlMcpClient } from "../src/server.ts";
import { serveAgentControlMcpStdio } from "../src/serve.ts";

const now = "2026-08-14T12:00:00.000Z";

const fixtureClient: AgentControlMcpClient = {
  async agentPassport(address) {
    return {
      schemaVersion: "1.0.0",
      kind: "AGENT_PASSPORT",
      id: "agent-passport-fixture",
      createdAt: now,
      maturity: "SOURCE_PREVIEW",
      request: { schemaVersion: "1.0.0", provider: "AGENTVERSE", address },
      sources: [],
      providerClaims: [],
      ryntraObservations: [],
      conflicts: [],
      unknowns: [],
      limitations: ["fixture", "fixture", "fixture", "fixture"],
      passportHash: `0x${"1".repeat(64)}`,
      integrity: { algorithm: "SHA-256", hash: `0x${"1".repeat(64)}` },
    };
  },
  async preflight(input) {
    return {
      mode: "SAMPLE_NOT_ONCHAIN",
      externalState: {
        agentverseRegistration: "NOT_VERIFIED",
        agentLaunchTokenRead: "NOT_INCLUDED",
        bnbApexJob: "NOT_OBSERVED",
      },
      sources: [],
      preflight: {
        intent: input.intent,
        evidence: [],
        evidenceRoot: `0x${"2".repeat(64)}`,
        policy: {
          schemaVersion: "1.0.0",
          id: "fixture-policy",
          version: 1,
          publishedAt: now,
          immutable: true,
          allowedChains: ["eip155:97"],
          allowedActions: ["CREATE_JOB_DRAFT"],
          maxBudget: null,
          evidenceMaxAgeSeconds: 600,
          requireHumanAuthorization: true,
          executionEnabled: false,
        },
        policyResult: {
          schemaVersion: "1.0.0",
          id: "fixture-policy-result",
          intentId: input.intent.id,
          intentRevision: input.intent.revision,
          policyRef: input.intent.policyRef,
          policyVersion: 1,
          policyDigest: `0x${"3".repeat(64)}`,
          evidenceRoot: `0x${"2".repeat(64)}`,
          evidenceRefs: [],
          decision: "INSUFFICIENT_EVIDENCE",
          status: "WARN",
          blockers: [],
          warnings: ["fixture"],
          evaluatedAt: now,
        },
      },
      passport: {
        schemaVersion: "1.0.0",
        kind: "ACTION_PASSPORT_PREVIEW",
        id: "action-passport-preview-fixture",
        createdAt: now,
        maturity: "SOURCE_PREVIEW",
        intent: input.intent,
        intentHash: `0x${"4".repeat(64)}`,
        evidence: { items: [], root: `0x${"2".repeat(64)}` },
        policy: {
          definition: {
            schemaVersion: "1.0.0",
            id: "fixture-policy",
            version: 1,
            publishedAt: now,
            immutable: true,
            allowedChains: ["eip155:97"],
            allowedActions: ["CREATE_JOB_DRAFT"],
            maxBudget: null,
            evidenceMaxAgeSeconds: 600,
            requireHumanAuthorization: true,
            executionEnabled: false,
          },
          result: {
            schemaVersion: "1.0.0",
            id: "fixture-policy-result",
            intentId: input.intent.id,
            intentRevision: input.intent.revision,
            policyRef: input.intent.policyRef,
            policyVersion: 1,
            policyDigest: `0x${"3".repeat(64)}`,
            evidenceRoot: `0x${"2".repeat(64)}`,
            evidenceRefs: [],
            decision: "INSUFFICIENT_EVIDENCE",
            status: "WARN",
            blockers: [],
            warnings: ["fixture"],
            evaluatedAt: now,
          },
        },
        authorization: {
          status: "NOT_RECORDED",
          demoOnly: true,
          subjectRef: null,
          method: null,
          intentHash: null,
          evidenceRoot: null,
          policyDigest: null,
          recordedAt: null,
        },
        execution: {
          status: "UNAVAILABLE",
          reasonCode: "SOURCE_PREVIEW_ONLY",
          jobId: null,
          transactionHash: null,
        },
        outcome: {
          status: "OUTCOME_NOT_OBSERVED",
          observedEffects: [],
          sourceRefs: [],
        },
        limitations: ["fixture", "fixture", "fixture", "fixture"],
        passportHash: `0x${"5".repeat(64)}`,
        integrity: { algorithm: "SHA-256", hash: `0x${"5".repeat(64)}` },
      },
    };
  },
  async verifyArtifact() {
    return {
      recognised: true,
      generation: "legacy-1.0.0" as const,
      kind: "ACTION_PASSPORT_PREVIEW",
      schemaVersion: "1.0.0",
      integrity: { valid: true, issues: [] },
      issuer: {
        verdict: "UNSIGNED" as const,
        keyId: null,
        detail: "this artifact generation predates issuer signatures",
      },
      authorization: {
        verdict: "NOT_AUTHORIZED" as const,
        detail: "no authorization of any kind is recorded",
      },
      observation: { verdict: "NOT_OBSERVED" as const, detail: "a preview carries no observed outcome" },
    };
  },
  async agentLaunchTokens() {
    return {
      provider: "AGENT_LAUNCH",
      access: "PUBLIC_READ_ONLY_GET",
      endpoint: "TOKENS",
      chainId: 97,
      providerUrl: "https://agent-launch.ai/api/agents/tokens?chainId=97",
      observedAt: now,
      controllerVariant: "SUCCESS_DATA_ARRAY",
      state: "ZERO_STATE",
      tokens: [],
      schemaDrift: [],
      raw: { success: true, data: [] },
    };
  },
  async agentLaunchToken(address, options) {
    if (address === `0x${"f".repeat(40)}`) {
      throw Object.assign(new Error("authorization=secret-value"), { code: "NETWORK_ERROR" });
    }
    if (address === `0x${"e".repeat(40)}`) {
      throw Object.assign(new Error("timeout with api_key=secret-value"), { code: "REQUEST_TIMEOUT" });
    }
    if (address === `0x${"d".repeat(40)}`) {
      await new Promise((_resolve, reject) => {
        const abort = () => reject(
          Object.assign(new Error("caller token=secret-value"), { code: "CALLER_ABORTED" }),
        );
        options?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return {
      provider: "AGENT_LAUNCH",
      access: "PUBLIC_READ_ONLY_GET",
      endpoint: "TOKEN_DETAIL",
      chainId: 97,
      providerUrl: `https://agent-launch.ai/api/agents/token/${address}?chainId=97`,
      observedAt: now,
      controllerVariant: "SUCCESS_DATA_RECORD",
      state: "NOT_FOUND",
      token: null,
      schemaDrift: [],
      raw: { success: true, data: null },
    };
  },
  async observeBnbApex(reference) {
    return {
      provider: "BNB_APEX",
      access: "KNOWN_TX_AND_JOB_READ_ONLY",
      chainId: 97,
      rpcUrl: "https://bsc-testnet-dataseed.bnbchain.org",
      observedAt: now,
      jobId: reference.jobId,
      txHash: reference.txHash,
      state: "NOT_FOUND",
      transaction: null,
      job: null,
      rpcEvidence: [],
    };
  },
};

serveAgentControlMcpStdio(fixtureClient);
