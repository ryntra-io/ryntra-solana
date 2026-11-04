/**
 * The deployment's switch for the agent on its word (CITY-175): `NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=devnet` lets the
 * command line and «Ask Ryntra» read «trade 1 SOL a day» or «launch me a token» into the agent's card. Anything else
 * keeps it shut: the line reads every sentence as before. Its trading rides on the mandate's own switches
 * (`NEXT_PUBLIC_RYNTRA_CITY_MANDATE=devnet` here, `RYNTRA_AGENT_MANDATE=devnet` on the server) and its launches on the
 * launch district's. `mainnet` opened of 4.11.2026 (CITY-186), on the mandate's mainnet.
 */
export type AutopilotNetwork = 'devnet' | 'mainnet';

export function autopilotNetwork(value: string | undefined): AutopilotNetwork | null {
  const said = value?.trim();
  return said === 'devnet' || said === 'mainnet' ? said : null;
}

export const AUTOPILOT_NET: AutopilotNetwork | null = autopilotNetwork(process.env.NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT);
