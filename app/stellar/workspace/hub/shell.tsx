"use client";

import { useCallback, type ReactNode } from "react";
import { ArrowRight, MapTrifold } from "@phosphor-icons/react";
import Link from "next/link";

import { RyntraAppShell } from "@/app/shell/app-shell";
import { StellarConnectionControl } from "../../components/stellar-connection.tsx";
import { navigationFromManifest, settingsEntry } from "@/app/shell/modules";
import { STELLAR_MANIFEST } from "./manifest.ts";
import { STELLAR_TESTNET } from "@/lib/stellar/network";
import { StellarWalletProvider } from "../../components/stellar-wallet-provider.tsx";
import { resolveDepth, type WorkspaceMode } from "@/app/shell/layout-store";
import type { NavGroup } from "@/app/shell/workspaces";

import "./hub.css";





/**
 * The navigation footer, on the shared chrome rather than beside it.
 *
 * It was a bare text link while another hub's was a 44px button with a border,
 * a radius and an arrow — two implementations of one piece of chrome, and the
 * second one quietly worse. The rules now live in `app/shell/shell.css` and
 * both workspaces use them.
 *
 * No language control, because this workspace is English-only by decision and a
 * toggle with one option is a control that lies about what it does. A hub
 * renders one when it has a catalog.
 */
function HubFooter() {
  return (
    <div className="hub-nav-footer">
      <Link className="hub-nav-map" href="/stellar/workspace/map" aria-label="Stellar Hub Map">
        <MapTrifold size={17} weight="bold" aria-hidden />
        <span>Stellar Hub Map</span>
        <ArrowRight size={15} weight="bold" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Guided | Pro, as a visible control.
 *
 * It has to be a control and not a note: the navigation resolves two different
 * rails from the layout mode, and without a switch the Pro rail is unreachable
 * — every module outside the guided four would exist and be routable and
 * appear nowhere. A mode the product has but the person cannot select is worse
 * than not having it.
 *
 * The stored preference carries three values because the cabinet uses a middle
 * one. Stellar sends the global `standard` default to Guided and opens Pro only
 * on an explicit choice.
 */
export function StellarHubShell({ children }: { children: ReactNode }) {
  const navGroupsFor = useCallback(
    (mode: WorkspaceMode): readonly NavGroup[] =>
      navigationFromManifest(STELLAR_MANIFEST, resolveDepth(mode) === "pro" ? "pro" : "simple"),
    [],
  );

  /* The provider wraps the shell rather than the canvas: the account control is
     rendered by the shell's top bar, so wrapping only `children` would leave it
     outside its own context. */
  /* Testnet, because signing is the only thing a wallet does in this workspace
     and the only surface that signs is `/authorize`. Every mainnet surface here
     reads and never touches a wallet. Naming mainnet — which this did until
     2026-08-13 — inverted the guard: it admitted a wallet on the wrong network
     and blocked one on the right network from signing at all. */
  return (
    <StellarWalletProvider expected={STELLAR_TESTNET}>
    <RyntraAppShell
      workspaceId="stellar"
      navSettings={settingsEntry(STELLAR_MANIFEST)}
      navGroupsFor={navGroupsFor}
      /* The depth control is not in the top bar: the product opens at full
         depth and `Simple | Pro` lives with the rest of "how this workspace
         is laid out" — the layout menu, bottom-left, beside density and
         reset. A switch in the primary bar made the first thing a person saw
         a question about the chrome. `modeInContext` is therefore gone with
         it, so the layout menu is the one control again rather than the
         second. */
      navFooter={<HubFooter />}
      /* The wallet is the account control, and it is the only place a wallet
         package can be reached from. Everything else on this workspace reads
         without one. */
      account={<StellarConnectionControl />}
    >
      {children}
    </RyntraAppShell>
    </StellarWalletProvider>
  );
}
