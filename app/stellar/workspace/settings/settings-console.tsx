"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { applyThemePref, getThemePref, type ThemePref } from "@/app/app/theme";
import { InfoControl } from "@/app/shell/info-control";
import { EmptyState, KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import { useShell } from "@/app/shell/shell-state";
import { ACTIVITY_LIMIT } from "@/lib/stellar/activity/store";
import type { StellarNetwork } from "@/lib/stellar/network";
import { useStellarWallet } from "../../components/stellar-wallet-provider.tsx";

/**
 * Settings, in five tabs.
 *
 * It used to be two panels: a network table and a list of boundaries. Both were
 * true and neither was a setting — a person who opened this page looking for
 * their own workspace found a specification of ours. The controls existed; they
 * were scattered across a top-bar menu, a mode switch and a theme toggle, which
 * is three places to look for one idea.
 *
 * The tabs are the founder's contract, in its order. What is genuinely absent —
 * notification delivery — says so and names its gate, rather than rendering a
 * row of switches that store a preference nothing reads. **A control that does
 * nothing is worse than an honest gap**, because a person sets it and believes
 * they are covered.
 *
 * Nothing was deleted to make room. The network table and every boundary
 * sentence moved into the tab where somebody would go looking for them.
 */

const TABS = [
  { id: "workspace", label: "Workspace" },
  { id: "wallet", label: "Wallet" },
  { id: "notifications", label: "Notifications" },
  { id: "privacy", label: "Privacy & Security" },
  { id: "advanced", label: "Advanced" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const BOUNDS: readonly (readonly [string, string])[] = [
  ["No keys", "Ryntra never holds a secret key or a seed phrase, on any network."],
  [
    "No signing by Ryntra",
    "Ryntra never signs. The Send surface can ask your wallet to sign an exact testnet transaction, and that signature happens inside Freighter with a key Ryntra never sees. This line used to say nothing here could sign at all; it stopped being true the moment that surface shipped, so it was corrected rather than left standing.",
  ],
  [
    "One submission path, and it is not a Ryntra server",
    "The read client every page uses still refuses sendTransaction by name. Submission lives in one separate module that takes a cleared verdict rather than an XDR, runs in your browser, and posts the transaction you signed straight to the public Stellar endpoint, so no signed transaction reaches Ryntra.",
  ],
  ["No custody", "Nothing is ever deposited to Ryntra."],
  [
    "No invented values",
    "A read that fails resolves to UNAVAILABLE with its reason. It never falls back to a default, a zero or a blank.",
  ],
  [
    "No mainnet execution",
    "Signing is fixed to Stellar Testnet by the surface that mounts the wallet, and the site's own content policy names no mainnet Stellar origin for the browser to reach. Mainnet execution is a separate release gate, not a setting on this page.",
  ],
];

/** One segmented control. Two or three options, one of them pressed. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="st-set-row">
      <span className="st-set-label">{label}</span>
      <div className="st-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.id} type="button" aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StellarSettingsConsole({ networks }: { networks: readonly StellarNetwork[] }) {
  const [tab, setTab] = useState<TabId>("workspace");
  const tabsId = useId();

  const { prefs, setMode, setDensity, reset } = useShell();
  const wallet = useStellarWallet();

  /* The stored preference is read on the client only: the server has no
     localStorage, and rendering a guessed value would flip on hydration. */
  const [theme, setTheme] = useState<ThemePref>("dark");
  useEffect(() => setTheme(getThemePref()), []);

  const depth: "guided" | "pro" = prefs.mode === "pro" ? "pro" : "guided";
  const connected = wallet.state === "CONNECTED" || wallet.state === "SIGNING" || wallet.state === "SIGNED";

  return (
    <>
      <div className="st-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className="st-tab"
            type="button"
            role="tab"
            id={`${tabsId}-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`${tabsId}-${entry.id}-panel`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="st-tabpanel" role="tabpanel" id={`${tabsId}-${tab}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === "workspace" ? (
          <PanelGrid label="Workspace settings">
            <Panel
              id="stellar-set-depth"
              title="This workspace"
              w={12}
              h={4}
              essential
              scroll
              badge="Saved in this browser"
              tone="muted"
              headerExtra={
                <InfoControl label="About workspace preferences">
                  <p>
                    Guided and Pro are the same truth at two depths, never different facts. Depth hides detail — a
                    hash, a ledger sequence, a raw envelope. It never hides a blocked state, a fee, an unknown or a
                    recovery path.
                  </p>
                  <p>
                    Every preference here is stored in this browser and scoped to this workspace, so changing it does
                    not touch the cabinet or the other hubs. Nothing is sent to Ryntra.
                  </p>
                </InfoControl>
              }
            >
              <Segmented
                label="Depth"
                value={depth}
                options={[
                  { id: "guided", label: "Guided" },
                  { id: "pro", label: "Pro" },
                ]}
                onChange={setMode}
              />
              <Segmented
                label="Appearance"
                value={theme}
                options={[
                  { id: "dark", label: "Dark" },
                  { id: "light", label: "Light" },
                ]}
                onChange={(next) => {
                  applyThemePref(next);
                  setTheme(next);
                }}
              />
              <Segmented
                label="Density"
                value={prefs.density}
                options={[
                  { id: "comfortable", label: "Comfortable" },
                  { id: "compact", label: "Compact" },
                ]}
                onChange={setDensity}
              />
              <div className="rw-hair" />
              <KeyValue label="Language">
                English only. A language control with one working language is a control that lies about what it does,
                so there is not one here — a hub renders one when it has a translation catalog, and this
                workspace does not yet.
              </KeyValue>
              <KeyValue label="Layout">
                Panel order, hidden widgets and density can be returned to their defaults at any time.
              </KeyValue>
              <button className="rw-btn" type="button" onClick={reset}>
                Reset this workspace&rsquo;s layout
              </button>
            </Panel>
          </PanelGrid>
        ) : null}

        {tab === "wallet" ? (
          <PanelGrid label="Wallet settings">
            <Panel
              id="stellar-set-wallet"
              title="Connected wallet"
              w={12}
              h={4}
              essential
              scroll
              badge={connected ? "Connected" : "Not connected"}
              tone={connected ? "evidence" : "muted"}
              headerExtra={
                <InfoControl label="About the wallet boundary">
                  <p>
                    Ryntra drives Freighter through an adapter and never receives a key. Connecting grants this site
                    permission to read your address; it grants nothing else. Every signature request happens inside the
                    extension, on a transaction you can read there before approving it.
                  </p>
                </InfoControl>
              }
              footer={
                <span>
                  {wallet.walletName} &middot; expected on {wallet.expectedNetwork}
                </span>
              }
            >
              <KeyValue label="State">{wallet.copy.title}</KeyValue>
              <KeyValue label="What that means">{wallet.copy.body}</KeyValue>
              <KeyValue label="Expected network">
                {wallet.expectedNetwork} — fixed by the surface that signs, not by a preference.
              </KeyValue>
              <KeyValue label="Address">
                {wallet.address ? <span translate="no">{wallet.address}</span> : "None. Connect to read one."}
              </KeyValue>
              <KeyValue label="Balances and trustlines">
                Not read yet. Account reads for a connected wallet are registered and not built.
              </KeyValue>
              <div className="rw-hair" />
              {connected ? (
                <button className="rw-btn" type="button" onClick={() => void wallet.disconnect()}>
                  Disconnect
                </button>
              ) : (
                <button className="rw-btn" type="button" onClick={() => void wallet.connect()}>
                  {wallet.copy.action ?? "Connect Stellar wallet"}
                </button>
              )}
            </Panel>
          </PanelGrid>
        ) : null}

        {tab === "notifications" ? (
          <PanelGrid label="Notification settings">
            <Panel
              id="stellar-set-notifications"
              title="Notifications"
              w={12}
              h={4}
              essential
              scroll
              badge="Not built"
              tone="muted"
              footer={<span>Registered on the Hub Map with its gate.</span>}
            >
              <EmptyState
                title="There is nowhere to deliver to yet"
                action={
                  <Link className="rw-btn" href="/stellar/workspace/attention">
                    Attention &amp; Recovery
                  </Link>
                }
              >
                Authorization required, transaction submitted, settlement, reconciliation and recovery are the five
                moments worth telling somebody about, and each one already exists in the lifecycle. What is missing is
                a channel and an opt-in contract. A row of switches that store a preference nothing reads would be
                worse than this gap, because you would set it and believe you were covered. Until then, every one of
                those moments is on the Attention surface the moment it happens.
              </EmptyState>
            </Panel>
          </PanelGrid>
        ) : null}

        {tab === "privacy" ? (
          <PanelGrid label="Privacy and security">
            <Panel
              id="stellar-set-bounds"
              title="What this workspace cannot do"
              w={12}
              h={4}
              essential
              scroll
              badge="Construction"
              tone="verified"
              headerExtra={
                <InfoControl label="Absent, not disabled">
                  <p>
                    Not policy — construction. Each of these is absent from the code rather than switched off in the
                    interface, and a test fails if one appears. A boundary you can reach by changing a setting is a
                    setting, not a boundary.
                  </p>
                </InfoControl>
              }
            >
              {BOUNDS.map(([title, detail]) => (
                <KeyValue key={title} label={title}>
                  {detail}
                </KeyValue>
              ))}
            </Panel>

            <Panel
              id="stellar-set-data"
              title="What is stored, and where"
              w={12}
              h={4}
              scroll
              badge="This browser"
              tone="muted"
              footer={<span>No account, no session, no server-side record of your use of this workspace.</span>}
            >
              <KeyValue label="Preferences">
                Depth, appearance, density and panel layout, in this browser&rsquo;s local storage, scoped to this
                workspace.
              </KeyValue>
              <KeyValue label="Wallet permission">
                Held by the Freighter extension, not by Ryntra. Revoke it in the extension.
              </KeyValue>
              <KeyValue label="Prepared actions">
                Every payment this workspace prepares — including one the preflight refuses — is kept in this
                browser&rsquo;s local storage under one key, newest {ACTIVITY_LIMIT}. Not a Ryntra server, not an
                account, not a synced profile. A payment history is the most sensitive thing this workspace could
                hold, and the honest place for it is the machine you are sitting at.
              </KeyValue>
              <KeyValue label="What is never stored">
                A key, a seed phrase, or a signed transaction envelope. Ryntra has never held the first two, and
                deliberately does not keep the third — an envelope that can still reach the network, sitting in a
                browser long after you stopped thinking about it, buys nothing that the transaction hash does not.
              </KeyValue>
              <KeyValue label="Receipts">
                Downloaded by you, verified by anyone. A receipt is not kept by Ryntra and does not need to be — every
                hash on it is recomputable from the document&rsquo;s own contents.
              </KeyValue>
            </Panel>
          </PanelGrid>
        ) : null}

        {tab === "advanced" ? (
          <PanelGrid label="Advanced settings">
            <Panel
              id="stellar-set-network"
              title="Networks and endpoints"
              w={12}
              h={4}
              essential
              scroll
              badge="Fixed"
              tone="evidence"
              headerExtra={
                <InfoControl label="Why both, and why neither is a choice">
                  <p>
                    Reads go to mainnet, because a passport is only worth reading about an asset that exists. Signing
                    goes to testnet, where the assets have no worth. Every read carries its network in its source
                    reference, so two networks can never be confused for one another.
                  </p>
                  <p>
                    Neither endpoint is editable here. A custom endpoint is a supply-chain decision — it decides which
                    server answers a question about your money — and it is not one to make behind a settings field.
                  </p>
                </InfoControl>
              }
            >
              <div className="rw-tablewrap">
                <table className="rw-table">
                  <thead>
                    <tr>
                      <th scope="col">Network</th>
                      <th scope="col">Used for</th>
                      <th scope="col">RPC</th>
                      <th scope="col">Horizon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {networks.map((network) => (
                      <tr key={network.id}>
                        <th scope="row">
                          <span className="st-code" translate="no">
                            {network.label}
                          </span>
                          {network.ephemeral ? (
                            <span className="st-note">
                              Reset periodically, so nothing may depend on its state persisting.
                            </span>
                          ) : null}
                        </th>
                        <td>
                          <span className="st-tag" data-on={network.ephemeral ? "false" : "true"}>
                            {network.ephemeral ? "Signed actions" : "Reads"}
                          </span>
                        </td>
                        <td>
                          <span className="st-domain" translate="no">
                            {network.rpcUrl}
                          </span>
                        </td>
                        <td>
                          <span className="st-domain" translate="no">
                            {network.horizonUrl}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              id="stellar-set-diagnostics"
              title="Diagnostics"
              w={12}
              h={4}
              scroll
              badge="Read the adapter"
              tone="muted"
              footer={
                <Link className="rw-btn" href="/stellar/workspace/developers">
                  Every read and its source
                </Link>
              }
            >
              <KeyValue label="Retention">
                The newest {ACTIVITY_LIMIT} prepared actions, in this browser. Source health is the last read rather
                than a record, and there is no server-side log to export. Every stored record can be deleted from the
                Activity surface.
              </KeyValue>
              <KeyValue label="Feature flags">
                None. What is built is what is in the rail; everything else is on the Hub Map with the condition it
                waits on, and no flag turns any of it on.
              </KeyValue>
              <KeyValue label="Refusals in code">
                The read client rejects sendTransaction by name, and submission is a separate module that accepts a
                cleared verdict rather than transaction bytes.
              </KeyValue>
            </Panel>
          </PanelGrid>
        ) : null}
      </div>
    </>
  );
}
