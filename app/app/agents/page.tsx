import { redirect } from "next/navigation";

import { treasuryNetwork } from "@/lib/solana/treasury/service.server";

export const dynamic = "force-dynamic";

/**
 * `/app/agents` — an old address, by its content (B18, the B13 review's table: «не в Автоінвест»).
 *
 * The agents of Ryntra on Solana are made where their money and their limits are: the treasury — an agent's multisig,
 * its proposals and its limits (`/app/treasury`). Where this deployment does not serve the treasury, «Боти» — the
 * rules that run on the person's signature — is the nearest thing that works. The agent-passport tools keep their
 * own addresses (`/app/agents/inspect`, `/app/agents/verify`).
 */
export default function AgentsPage() {
  redirect(treasuryNetwork() ? "/app/treasury" : "/app/bots");
}
