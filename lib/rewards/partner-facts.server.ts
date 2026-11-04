import type { GuardStore } from "../guard/store.ts";
import { discountOn } from "../../city/lib/partners/discount.ts";
import { payoutsMultisig, payoutsOn } from "../partner-payouts/payouts.server.ts";
import { rewardsActivation } from "./activation.ts";
import { networkRulesAt } from "./network-rules.ts";
import { partnerFactsOf, type PartnerFacts } from "./partner-facts.ts";
import { readRewardRuleMoments, readRewardRulesInForce } from "./rank-store.ts";
import { REWARD_CLAIM_ASSET } from "./treasury.server.ts";

/**
 * The programme's facts as this deployment holds them now (Ryntra Partners, R2): the operator's terms (decision 93,
 * `city/lib/partners/terms.ts`) beside the rules in force and when they came into force, read only — nothing is
 * started by asking — the weekly partner payouts' switch, the friend's discount and the rewards activation instant.
 * Null when the store does not answer: no figure is offered that could not be checked.
 */
export async function readPartnerFacts(store: GuardStore, now: string, env: NodeJS.ProcessEnv = process.env): Promise<PartnerFacts | null> {
  try {
    const [rules, moments] = await Promise.all([readRewardRulesInForce(store, now), readRewardRuleMoments(store)]);
    const activation = rewardsActivation(env);
    return partnerFactsOf({
      now,
      rules,
      rulesSince: rules.version === "1.0.0" ? null : moments[rules.version],
      network: networkRulesAt(now),
      partnerPayoutsOn: payoutsOn(env) && payoutsMultisig(env) !== null,
      discountOn: discountOn(env.NEXT_PUBLIC_RYNTRA_REFEREE_DISCOUNT),
      activation: activation.state === "OPEN" ? activation.at : null,
      claimAsset: REWARD_CLAIM_ASSET,
    });
  } catch {
    return null;
  }
}
