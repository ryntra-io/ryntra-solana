import { NextResponse } from "next/server";

import { readAgentUsage, resolveAgentBudgetConfig } from "@/lib/agent/budget";
import { OPENAI_AGENT_MODEL_DEFAULT, OPENAI_AGENT_MODEL_ENV } from "@/lib/agent/model";
import { toolNames } from "@/lib/agent/tools/registry";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agent's usage for the Owner (`RYN-AGENT-TEXT-001`): the ceilings in
 * force, today's and the month's model calls from the durable meter, the
 * receipts of the last fortnight by day and by model (calls, tokens, distinct
 * wallets counted — never listed — and outcomes), whether the model is
 * switched on and which one, and the tools the agent has. Admin session
 * only; never a key, never a word of a conversation.
 */
export async function GET(request: Request) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days") ?? 14) || 14));
    const config = resolveAgentBudgetConfig(process.env);
    const usage = await readAgentUsage(getGuardRuntime().store, config, Date.now(), days);
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        model: { enabled: config.modelEnabled, name: process.env[OPENAI_AGENT_MODEL_ENV]?.trim() || OPENAI_AGENT_MODEL_DEFAULT, switch: "RYNTRA_AGENT_MODEL_ENABLED" },
        tools: { research: toolNames("research"), prepare: toolNames("prepare"), execute: false },
        usage,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: "unavailable", message: error instanceof Error ? error.message : String(error) }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
