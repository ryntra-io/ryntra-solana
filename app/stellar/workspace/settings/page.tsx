import { STELLAR_MAINNET, STELLAR_TESTNET } from "@/lib/stellar/network";
import { PageHead } from "../hub/parts.tsx";
import { StellarSettingsConsole } from "./settings-console.tsx";

export const metadata = { title: "Settings" };

/**
 * Settings.
 *
 * Thin on purpose: the tabs read live wallet and workspace state, both of which
 * are client-side, so the console is the client component and this is the route
 * around it. The network list is passed in rather than imported there, because
 * it is a build-time constant and there is no reason to ship the module twice.
 *
 * What this page used to be — a network table and a list of boundaries — is
 * still here in full. It moved into the tabs where a person would look for it.
 */
export default function StellarSettingsPage() {
  return (
    <>
      <PageHead
        title="Settings"
        module="settings"
        lead="Your depth, appearance and density; the wallet you connected and what it is allowed to do; which networks answer; and what this workspace is structurally unable to do. Everything here is stored in this browser and scoped to this workspace."
      />
      <StellarSettingsConsole networks={[STELLAR_MAINNET, STELLAR_TESTNET]} />
    </>
  );
}
