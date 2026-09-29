"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "@/app/shell/panel";
import { connectEvmWallet, readEvmWalletAddress, readEvmWalletHint, watchEvmWalletAddress, writeEvmWalletHint } from "@/lib/base/wallet.client";
import { scaleRawAmount } from "@/lib/solana/amounts";
import { readWalletHoldingsUntilComplete } from "@/lib/solana/holdings.client";
import { catalogAssets, crossSwapOfferableRaw, crossSwapReserveRaw, defaultSwapAssetFor, POPULAR_BRIDGE_NETWORKS, displayRawAmount, parseHumanAmount, resolveSwapAsset, SOLANA_NATIVE_SOL_MINT, SOLANA_USDC_MINT, SWAP_NETWORKS, type SwapNetwork, type SwapSideRef } from "@/lib/swap/catalog";
import { usdValueOfRaw } from "@/lib/swap/price";
import { classifySwapRoute } from "@/lib/swap/classify";
import { bridgeTokenKey } from "@/lib/swap/bridge-client-state";
import { buildSwapAssetRows, type SwapHolding } from "../trade/swap-assets.ts";
import { usdValue } from "../../../app/wallet-view-model.ts";
import { FEATURED_MINTS } from "../assets/featured.ts";
import { useSolanaConnection } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { CrossSwapEngine, type EvmConnectOutcome } from "./cross-swap-engine.tsx";
import styles from "./bridge-surface.module.css";

/**
 * One Swap — Unified Swap V1.
 *
 * The person chooses FROM (network, asset, amount) and TO (network, asset).
 * Nobody chooses between Swap, Bridge and Cross-chain: this surface classifies
 * the pair with the same pure table the routes use and hands the action to the
 * engine that owns it — the accepted Jupiter path for a same-network swap, the
 * accepted Circle CCTP path for USDC between networks, and for a cross-asset
 * pair the provider its approved tuple names — Mayan for the four pairs it
 * carries, Relay for the six Robinhood Chain pairs it cannot reach. A pair
 * outside those reads "Not available for this pair", and no provider or asset
 * is substituted quietly.
 *
 * The class is a result label under the tickets, not a choice above them.
 */

type Holding = SwapHolding;
type TokenRow = Readonly<{
  mint: string;
  /** The unified route names it `address`; the Solana one has always said `mint`. */
  address?: string;
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  /**
   * Whether anyone has vouched that this token is what its symbol claims.
   * Searching `USDC` returns the real one and several impostors, so this is
   * shown rather than used to filter: hiding a token somebody holds is its own
   * defect, and a list where everything looks safe teaches the wrong lesson.
   */
  verified?: boolean;
  suspicious?: boolean;
}>;

export type BridgeSurfaceSeed = Readonly<{
  fromNetwork?: string;
  fromAsset?: string;
  toNetwork?: string;
  toAsset?: string;
  amount?: string;
}>;

type Side = "from" | "to";

const NETWORK_LIST: readonly SwapNetwork[] = SWAP_NETWORKS;

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function seedSide(network: string | undefined, asset: string | undefined, fallback: SwapSideRef): SwapSideRef {
  const net = network && (NETWORK_LIST as readonly string[]).includes(network) ? (network as SwapNetwork) : fallback.network;
  const candidate: SwapSideRef = { network: net, asset: asset && asset.length > 0 ? asset : fallback.asset };
  /* The old fallback was `net === "solana" ? SOL : "USDC"`, so a link naming
     Robinhood Chain seeded the form with an asset that chain does not have. */
  return resolveSwapAsset(candidate) ? candidate : { network: net, asset: defaultSwapAssetFor(net, null) };
}

export function BridgeSurface({ seed }: { seed?: BridgeSurfaceSeed }) {
  const { text } = useSolanaI18n();
  /* One version (canon v5.3 В28): every fact of the quote — the route, its
     age, the approvals — and the source transaction are shown to everyone;
     a provider's failure code is not a customer's word and is shown to no one. */
  const pro = true;
  const { wallets, connection, connect, disconnect } = useSolanaConnection();

  const [from, setFrom] = useState<SwapSideRef>(() => seedSide(seed?.fromNetwork, seed?.fromAsset, { network: "solana", asset: SOLANA_NATIVE_SOL_MINT }));
  const [to, setTo] = useState<SwapSideRef>(() => seedSide(seed?.toNetwork, seed?.toAsset, { network: "solana", asset: SOLANA_USDC_MINT }));
  const [amount, setAmount] = useState(seed?.amount ?? "");
  /** Which network menu is open — at most one, closed by a click anywhere else or Escape. */
  const [menu, setMenu] = useState<Side | null>(null);
  const [picker, setPicker] = useState<Side | null>(null);
  const [search, setSearch] = useState("");
  const [searchRows, setSearchRows] = useState<readonly TokenRow[] | null>(null);
  const [known, setKnown] = useState<Readonly<Record<string, TokenRow>>>({});
  const [holdings, setHoldings] = useState<Readonly<{ owner: string; rows: readonly Holding[]; complete: boolean }> | null>(null);
  const [balanceEpoch, setBalanceEpoch] = useState(0);
  const [balanceFailed, setBalanceFailed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [tokenEpoch, setTokenEpoch] = useState(0);
  const [tokenFailed, setTokenFailed] = useState(false);
  const refreshBalances = useCallback(() => setBalanceEpoch(value => value + 1), []);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTrigger = useRef<HTMLButtonElement | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [evmBalance, setEvmBalance] = useState<Readonly<{
    network: SwapNetwork;
    owner: string;
    asset: string;
    raw: string | null;
    decimals: number | null;
    nativeRaw: string | null;
  }> | null>(null);
  /** Dollars per whole unit, by `network:asset`. Absent means "not known", which is a state this card renders. */
  const [unitUsd, setUnitUsd] = useState<Readonly<Record<string, number>>>({});
  /**
   * Which networks Relay is carrying this minute, from `GET /api/swap/networks`.
   *
   * Null while unknown, and null means **offer everything**: the integrated set
   * is what this product supports, and the live read only ever removes from it.
   * A failed metadata call must not empty the selector — a person who cannot
   * reach Relay's chain index can still be shown the form, and the quote tells
   * them the truth a moment later.
   */
  const [networkStatus, setNetworkStatus] = useState<Readonly<Record<string, { offerable: boolean; reason: string | null }>> | null>(null);
  type QuoteFacts = Readonly<{ expectedRaw: string; decimals: number; rentRaw: string | null; expired: boolean }>;
  const [crossSnapshot, setCrossSnapshot] = useState<{ key: string; facts: QuoteFacts } | null>(null);
  const selectionKey = JSON.stringify([from, to, amount, connection?.address, evmAddress]);
  const crossFacts = crossSnapshot?.key === selectionKey ? crossSnapshot.facts : null;
  const setCrossFacts = useCallback((facts: QuoteFacts | null) => setCrossSnapshot(facts ? { key: selectionKey, facts } : null), [selectionKey]);
  const searchTicket = useRef(0);

  const classification = useMemo(() => {
    const route = classifySwapRoute(from, to);
    if (!route.ok) return route;
    const enrich = (asset: typeof route.from) => {
      const metadata = known[bridgeTokenKey(asset.network, asset.asset)];
      const holding = asset.network === "solana" && holdings?.owner === connection?.address
        ? holdings?.rows.find(row => row.kind === "TOKEN" && row.mint === asset.solanaMint) : null;
      return { ...asset, decimals: asset.decimals ?? metadata?.decimals ?? holding?.decimals ?? null,
        symbol: asset.symbol ?? metadata?.symbol ?? holding?.catalog?.symbol ?? holding?.symbol ?? null };
    };
    return { ...route, from: enrich(route.from), to: enrich(route.to) };
  }, [from, to, known, holdings, connection?.address]);
  const fromAsset = classification.from;
  const toAsset = classification.to;

  // Deep links and featured tokens need the same exact decimal scale as search selections.
  useEffect(() => {
    const controller = new AbortController();
    const missing = [from, to].filter(side => resolveSwapAsset(side)?.decimals == null && known[bridgeTokenKey(side.network, side.asset)]?.decimals == null);
    if (!missing.length) { setTokenFailed(false); return; }
    setTokenFailed(false);
    void Promise.all(missing.map(async side => {
      const response = await postJson<{ tokens?: readonly TokenRow[] }>("/api/swap/tokens", { network: side.network, query: side.asset, limit: 24 }, controller.signal);
      if (controller.signal.aborted) return;
      const found = response?.tokens?.find(row => bridgeTokenKey(side.network, row.address ?? row.mint) === bridgeTokenKey(side.network, side.asset));
      if (!found || found.decimals == null) { setTokenFailed(true); return; }
      setKnown(current => ({ ...current, [bridgeTokenKey(side.network, side.asset)]: { ...found, mint: found.address ?? found.mint } }));
    }));
    return () => controller.abort();
  }, [from, to, known, tokenEpoch]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refreshBalances(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshBalances]);

  useEffect(() => {
    if (!picker) return;
    const dialog = pickerRef.current;
    const trigger = pickerTrigger.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPicker(null); return; }
      if (event.key !== "Tab") return;
      const controls = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [href]') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); requestAnimationFrame(() => trigger?.focus()); };
  }, [picker]);

  /* Asked once per mount. The route caches Relay's index for five minutes, so
     opening the menu costs nothing and a chain going down is still noticed. */
  useEffect(() => {
    let live = true;
    void fetch("/api/swap/networks", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { networks?: readonly { id: string; offerable: boolean; reason: string | null }[] } | null) => {
        if (!live || !payload?.networks) return;
        setNetworkStatus(Object.fromEntries(payload.networks.map((row) => [row.id, { offerable: row.offerable, reason: row.reason }])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  /* ── One open menu; a click elsewhere or Escape closes it ─────────────── */
  useEffect(() => {
    if (menu === null) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-menu-anchor]")) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /* ── The address bar is the artifact ─────────────────────────────────── */
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("from", from.network);
    url.searchParams.set("fa", from.asset);
    url.searchParams.set("to", to.network);
    url.searchParams.set("ta", to.asset);
    if (from.network === "solana" && to.network === "solana" && fromAsset?.solanaMint && toAsset?.solanaMint) {
      url.searchParams.set("in", fromAsset.solanaMint);
      url.searchParams.set("out", toAsset.solanaMint);
    } else {
      url.searchParams.delete("in");
      url.searchParams.delete("out");
    }
    if (amount) url.searchParams.set("amount", amount);
    else url.searchParams.delete("amount");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, [from, to, amount, fromAsset?.solanaMint, toAsset?.solanaMint]);

  /* ── Balances ───────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!connection) {
      setHoldings(null);
      return;
    }
    const controller = new AbortController();
    void readWalletHoldingsUntilComplete<Holding>({ owner: connection.address, network: "mainnet", signal: controller.signal,
      onRead: read => {
        if (controller.signal.aborted) return;
        if (!read.ok) { setHoldings(null); if (from.network === "solana") setBalanceFailed(true); return; }
        setHoldings({ owner: connection.address, rows: read.rows, complete: read.tokenRead === "COMPLETE" });
        if (from.network === "solana") setBalanceFailed(read.tokenRead !== "COMPLETE");
      },
    });
    return () => controller.abort();
  }, [connection, from.network, balanceEpoch]);

  /* The EVM balance is read for the network and the asset actually chosen.
     It used to be read from the bridge's CCTP route, which asks a *direction*
     rather than a network and knows only USDC and the native coin. A
     `robinhood` source therefore asked **Ethereum** — a chain the person does
     not hold this money on — and USDG, the asset the entire Robinhood Chain
     lane exists for, could not be read at all. No balance is no `Available`
     line and no 25/50/75/MAX, which is exactly what the founder saw. */
  useEffect(() => {
    if (!evmAddress || from.network === "solana") {
      setEvmBalance(null);
      return;
    }
    let live = true;
    const network = from.network;
    const asset = from.asset;
    (async () => {
      const response = await postJson<{ data?: { raw?: string | null; decimals?: number | null; nativeRaw?: string | null } }>("/api/swap/balance", {
        network,
        owner: evmAddress,
        asset,
      });
      if (!live) return;
      setBalanceFailed(response?.data?.raw == null);
      setEvmBalance({
        network,
        owner: evmAddress,
        asset,
        raw: response?.data?.raw ?? null,
        decimals: response?.data?.decimals ?? null,
        nativeRaw: response?.data?.nativeRaw ?? null,
      });
    })();
    return () => {
      live = false;
    };
  }, [evmAddress, from.network, from.asset, balanceEpoch]);

  /* What the two assets are worth, so an amount is a sum of money rather than a
     number. Both legs are asked together because both change together, and the
     answer is deliberately allowed to be empty: a price decides nothing here —
     what gets signed is the quote's own minimum — so an unreachable price
     source costs the card a line and nothing else. Refreshed on the same
     rhythm as a quote, because a figure that never moves stops being a price. */
  useEffect(() => {
    let live = true;
    const sides = [
      { network: from.network, asset: from.asset },
      { network: to.network, asset: to.asset },
    ];
    const read = async () => {
      const response = await postJson<{ data?: { prices?: readonly Readonly<{ network: string; asset: string; usd: number }>[] } }>("/api/swap/price", { sides });
      if (!live) return;
      setUnitUsd((current) => {
        const next = { ...current };
        for (const side of sides) delete next[`${side.network}:${side.asset}`];
        for (const row of response?.data?.prices ?? []) next[`${row.network}:${row.asset}`] = row.usd;
        return next;
      });
    };
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [from.network, from.asset, to.network, to.asset]);

  /**
   * An EVM wallet that has already granted this origin is read back without a
   * prompt — but only when this pair has an EVM side, and only when one was
   * connected here before.
   *
   * The first version ran on mount, always. `eth_accounts` is documented as the
   * silent half of `eth_requestAccounts`, and for a wallet that speaks only
   * Ethereum it is. **Phantom is not that wallet.** It injects `window.ethereum`
   * beside its Solana provider, and when the person's active Phantom account is
   * a Solana one it answers the call with a modal of its own:
   *
   * > Unsupported account — This website is trying to use Ethereum, which this
   * > Solana account doesn't support.
   *
   * The founder met that on `ryntra.io` while doing a Solana-to-Solana swap, on
   * a card where no Ethereum anything was on screen. A silent read is only
   * silent in the wallets that were tested; the way to not interrupt somebody is
   * not to ask.
   *
   * So two gates, and the pair is the important one: a Solana pair never touches
   * `window.ethereum` at all. The hint is the second — a person who has never
   * connected an EVM wallet here is never asked about one, exactly as the Solana
   * side already works (`WALLET_HINT_KEY` in `connection.tsx`).
   */
  const pairTouchesEvm = from.network !== "solana" || to.network !== "solana";
  const hasEvmAddress = evmAddress !== null;
  useEffect(() => {
    if (!pairTouchesEvm) return;
    let live = true;
    void (async () => {
      if (!readEvmWalletHint()) return;
      const address = await readEvmWalletAddress();
      if (live && address) setEvmAddress(address);
    })();
    const stop = watchEvmWalletAddress((address) => { if (readEvmWalletHint()) setEvmAddress(address); });
    return () => {
      live = false;
      stop();
    };
  }, [pairTouchesEvm, hasEvmAddress]);

  /* The outcome goes back to the caller: a connect button that silently does
     nothing when no wallet is installed is indistinguishable from a broken one. */
  const connectEvm = useCallback(async (): Promise<EvmConnectOutcome> => {
    const wallet = await connectEvmWallet();
    if (wallet.ok) {
      setEvmAddress(wallet.address);
      return "CONNECTED";
    }
    return wallet.code === "NO_WALLET" ? "NO_WALLET" : wallet.code === "REFUSED" ? "REFUSED" : "FAILED";
  }, []);

  const fromBalance: Readonly<{ raw: string; decimals: number }> | null = (() => {
    if (!fromAsset) return null;
    if (from.network === "solana") {
      if (!holdings || holdings.owner !== connection?.address) return null;
      const row =
        fromAsset.economicAsset === "SOL"
          ? holdings.rows.find((entry) => entry.kind === "NATIVE_SOL") ?? null
          : holdings.rows.find((entry) => entry.mint === fromAsset.solanaMint) ?? null;
      return row ? { raw: row.spendableRaw, decimals: row.decimals } : holdings.complete && fromAsset.decimals !== null ? { raw: "0", decimals: fromAsset.decimals } : null;
    }
    /* The reading has to be about this network, this wallet and this asset, or
       it is about somebody else's money. The old test was the network alone,
       which is how a figure read for one asset could survive a change to
       another. */
    if (!evmBalance || evmBalance.network !== from.network || evmBalance.asset !== from.asset || evmBalance.owner !== evmAddress) return null;
    /* Decimals come from the catalogue when it knows the asset and from the
       token itself when it does not; neither is ever guessed, so an unreadable
       scale shows no balance rather than a wrong one. */
    const decimals = fromAsset.decimals ?? evmBalance.decimals;
    if (evmBalance.raw === null || decimals === null) return null;
    return { raw: evmBalance.raw, decimals };
  })();

  /* ── Asset search, on every network ──
     Solana had this from the start and the three EVM networks offered two
     assets each, which was the whole shape of the old lane. One route now
     answers for all four, so the form can name any token the rails can carry. */
  useEffect(() => {
    const my = ++searchTicket.current;
    const controller = new AbortController();
    setSearchRows(null);
    setSearchFailed(false);
    if (picker === null) return;
    const network = picker === "from" ? from.network : to.network;
    const query = search.trim();
    if (query.length < 2) {
      setSearchRows(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      const response = await postJson<{ tokens?: readonly TokenRow[] }>("/api/swap/tokens", { network, query, limit: 24 }, controller.signal);
      if (searchTicket.current !== my || controller.signal.aborted) return;
      setSearchFailed(response === null);
      const rows = (response?.tokens ?? []).map((row) => ({ ...row, mint: row.mint ?? row.address ?? "" }));
      setSearchRows(rows);
      setKnown((current) => {
        const next = { ...current };
        for (const row of rows) next[bridgeTokenKey(network, row.mint)] = row;
        return next;
      });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, picker, from.network, to.network]);

  const codeFor = (side: SwapSideRef): string => {
    const resolved = resolveSwapAsset(side);
    if (resolved?.symbol) return resolved.symbol;
    const featured = FEATURED_MINTS.find((entry) => entry.mint === side.asset);
    if (featured) return featured.code;
    const row = known[bridgeTokenKey(side.network, side.asset)];
    if (row?.symbol) return row.symbol;
    return `${side.asset.slice(0, 4)}…`;
  };

  const optionsFor = (network: SwapNetwork): readonly Readonly<{ asset: string; code: string; note: string | null; unverified?: boolean }>[] => {
    if (network !== "solana") return catalogAssets(network).map((asset) => ({ asset: asset.code, code: asset.symbol, note: asset.kind === "NATIVE" ? text("Native coin") : null }));
    return buildSwapAssetRows(holdings?.owner === connection?.address ? holdings?.rows ?? [] : [], {}, FEATURED_MINTS)
      .map(row => ({ asset: row.mint, code: row.symbol ?? `${row.mint.slice(0, 4)}…`, note: [row.name, row.usdValue === null ? null : usdValue(row.usdValue)].filter(Boolean).join(" · "), unverified: row.isSuspicious || (row.isVerified !== true && !FEATURED_MINTS.some(seed => seed.mint === row.mint)) }));
  };

  const chooseNetwork = (side: Side, network: SwapNetwork) => {
    if (side === "from") setFrom({ network, asset: defaultSwapAssetFor(network, to) });
    else setTo({ network, asset: defaultSwapAssetFor(network, from) });
    setMenu(null);
  };

  const chooseAsset = (side: Side, asset: string) => {
    if (side === "from") setFrom((current) => ({ ...current, asset }));
    else setTo((current) => ({ ...current, asset }));
    setPicker(null);
    setSearch("");
    setSearchRows(null);
  };

  const flip = () => {
    setFrom(to);
    setTo(from);
  };

  /**
   * The largest amount this surface offers must be the largest amount it can
   * sign. `fromBalance` is already the wallet's spendable figure — the ordinary
   * fee reserve is withheld inside it — but a cross-chain swap also pays the
   * provider's Solana order rent, or its Ethereum gas, out of that same coin.
   * MAX that ignores them is a button that always fails.
   */
  const offerable: Readonly<{ raw: string; decimals: number }> | null = (() => {
    if (!fromBalance || !fromAsset) return null;
    if (!classification.ok || classification.kind !== "CROSS_SWAP") return fromBalance;
    return {
      raw: crossSwapOfferableRaw(from.network, fromAsset.economicAsset, fromBalance.raw, crossFacts?.rentRaw ?? null),
      decimals: fromBalance.decimals,
    };
  })();

  /* An asset whose decimals are unknown is not measured against a balance; a wrong scale would name a shortfall that is not there. */
  /**
   * What MAX keeps back, said out loud.
   *
   * A button that silently returns less than the balance is a button a person
   * cannot trust: they see a number they did not choose and have no way to tell
   * a fee reserve from a bug. One line names the amount and the reason, and it
   * appears only when there is something to explain — a token origin reserves
   * nothing and says nothing.
   */
  const heldBack: string | null = (() => {
    if (!fromBalance || !fromAsset || !classification.ok || classification.kind !== "CROSS_SWAP") return null;
    const reserve = crossSwapReserveRaw(from.network, fromAsset.economicAsset, crossFacts?.rentRaw ?? null);
    if (reserve <= 0n) return null;
    return displayRawAmount(reserve.toString(), fromBalance.decimals);
  })();

  const amountDecimals = fromAsset?.decimals ?? offerable?.decimals ?? null;
  const amountRaw = amount.trim() === "" || amountDecimals === null ? null : parseHumanAmount(amount, amountDecimals);
  const overBalance = amountRaw !== null && offerable !== null && BigInt(amountRaw) > BigInt(offerable.raw);

  const fillShare = (numerator: bigint, denominator: bigint) => {
    if (!offerable || locked) return;
    const raw = denominator === 1n ? BigInt(offerable.raw) : (BigInt(offerable.raw) * numerator) / denominator;
    setAmount(scaleRawAmount(raw.toString(), offerable.decimals));
  };

  /* ── What kind of action this is ──────────────────────────────────────── */
  /* Keyed, for the reason the engine gives: a chain of ternaries ending in
     Ethereum is how Robinhood Chain appeared twice in the network menu, both
     times as Ethereum. */
  const networkLabel: Record<SwapNetwork, string> = {
    solana: text("Solana"),
    base: text("Base"),
    ethereum: text("Ethereum"),
    arbitrum: text("Arbitrum"),
    optimism: text("Optimism"),
    polygon: text("Polygon"),
    bnb: text("BNB Chain"),
    robinhood: text("Robinhood Chain"),
  };
  const networkName = (network: SwapNetwork) => networkLabel[network];
  /* Keyed for the same reason as the labels above, and read out to assistive
     technology while the chip itself shows the shorter word. */
  const connectWalletLabel: Record<SwapNetwork, string> = {
    solana: text("Connect a Solana wallet"),
    base: text("Connect a Base wallet"),
    ethereum: text("Connect an Ethereum wallet"),
    arbitrum: text("Connect an Arbitrum wallet"),
    optimism: text("Connect an Optimism wallet"),
    polygon: text("Connect a Polygon wallet"),
    bnb: text("Connect a BNB Chain wallet"),
    robinhood: text("Connect a Robinhood Chain wallet"),
  };
  const kindLabel = (() => {
    if (!classification.ok) {
      switch (classification.reason) {
        case "SAME_ASSET_SAME_NETWORK":
          return text("Choose two different assets");
        case "EVM_SAME_NETWORK":
          /* Named for the shape rather than for two of the three networks it
             covers: Robinhood Chain landed in this branch and was told about
             Base and Ethereum. */
          return text("Swaps inside one Ethereum-style network are not offered yet");
        case "ASSET_NOT_ROUTABLE_ON_NETWORK":
          return text("That network will not carry that asset");
        case "UNKNOWN_ASSET":
          return text("Pick an asset on both sides");
        default:
          return text("Not available for this pair");
      }
    }
    return `${networkName(from.network)} → ${networkName(to.network)}`;
  })();

  const badge = classification.ok ? `${networkName(from.network)} → ${networkName(to.network)}` : text("Not available");
  const solanaSigner = connection ? { wallet: connection.wallet, address: connection.address } : null;

  /* What the receive leg will actually be, in raw units — kept as figures so
     the dollar line can be computed from them rather than parsed back out of a
     formatted string. One source now that one engine fills every pair here. */
  const receiveAmount: Readonly<{ raw: string; decimals: number }> | null =
    classification.ok && crossFacts ? { raw: crossFacts.expectedRaw, decimals: crossFacts.decimals } : null;

  const receiveDisplay = receiveAmount ? displayRawAmount(receiveAmount.raw, receiveAmount.decimals) : null;
  /* Every fill here is a cross-chain estimate and says so. The mark is rendered
     beside the figure rather than inside it — see `.approx`. */
  const receiveEstimated = receiveDisplay !== null;
  /* Read from the engine's own clock rather than recomputed here, so the button
     that refuses to act and the figure that stops offering can never disagree. */
  const quoteExpired = crossFacts?.expired === true;

  /**
   * What an amount is worth, under the amount.
   *
   * Always `≈`, and never a decision: the figure is an indication from a price
   * source, while what actually gets signed is the quote's own minimum from the
   * rail that will fill it. An asset with no price renders no line at all —
   * `$0.00` under a real amount would be a lie, and an empty line holding space
   * reads as a figure that failed to arrive.
   */
  const usdText = (side: SwapSideRef, raw: string | null, decimals: number | null): string | null => {
    const unit = unitUsd[`${side.network}:${side.asset}`];
    if (raw === null || decimals === null || unit === undefined) return null;
    const value = usdValueOfRaw(raw, decimals, unit);
    if (value === null || value <= 0) return null;
    /* A sum below a cent is a real sum, and rounding it to nothing would say
       the opposite of what is true. */
    if (value < 0.005) return "≈ < $0.01";
    const [whole, cents] = value.toFixed(2).split(".");
    return `≈ $${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
  };

  /**
   * Which way the money is going, and why this is one control rather than two.
   *
   * Owner instruction 2026-09-10: *«Bridge позиціонуємо як Solana bridge, а не як
   * multichain exchange»*. Ryntra is a Solana platform, so the journey almost
   * everybody makes is **bringing money in** — and a newcomer meeting two open
   * network menus has to make two choices before the page tells them anything.
   *
   * So one side is always Solana and the direction decides which. The other side
   * keeps its full network menu, because that is the choice a person actually
   * has. The reverse journey is a small link, not a second mode with its own
   * layout: it is the same form pointed the other way.
   */
  const outbound = from.network === "solana";

  const flipDirection = () => {
    /* The pair is mirrored rather than reset. Somebody who chose Base USDC and
       then realises they meant the other direction should find Base USDC on the
       other side, not a cleared form — and the amount is theirs, so it stays. */
    setFrom(to);
    setTo(from);
    setMenu(null);
  };

  const sendUsd = usdText(from, amountRaw, amountDecimals);
  const receiveUsd = usdText(to, receiveAmount?.raw ?? null, receiveAmount?.decimals ?? null);

  /**
   * The networks offered, carrying ones first and in a curated order.
   *
   * Not a ranking computed from anything: a menu that reorders itself between
   * visits is one people stop being able to use from memory. Anything the
   * catalogue gains but the curated list has not been told about still appears,
   * after the known ones, so a new network is never silently unreachable.
   */
  const networkChoices = useMemo(() => {
    const offered: readonly SwapNetwork[] = NETWORK_LIST.filter((candidate) => candidate !== "solana");
    const known = POPULAR_BRIDGE_NETWORKS.filter((candidate) => offered.includes(candidate));
    const rest = offered.filter((candidate) => !known.includes(candidate));
    const ordered = [...known, ...rest];
    const carrying = (candidate: SwapNetwork) => networkStatus?.[candidate]?.offerable !== false;
    /* Carrying first, and the rest kept visible underneath rather than dropped. */
    return [...ordered.filter(carrying), ...ordered.filter((candidate) => !carrying(candidate))];
  }, [networkStatus]);

  const selector = (side: Side, ref: SwapSideRef) => {
    /* The Solana side is fixed by the direction, so it is stated rather than
       offered. A menu whose only entry is the one already chosen is a control
       that teaches a person to expect a choice they do not have. */
    const fixed = ref.network === "solana";
    return (
    <div className={styles.selector}>
      <div className={styles.menuAnchor} data-menu-anchor>
        {fixed ? (
          <span className={styles.segmentFixed}>
            <span className={`${styles.glyph} ${styles.glyphNetwork}`} aria-hidden>{networkName(ref.network).slice(0, 1)}</span>
            <span translate="no">{networkName(ref.network)}</span>
          </span>
        ) : (
        <button
          className={styles.segment}
          type="button"
          disabled={locked}
          aria-haspopup="listbox"
          aria-expanded={menu === side}
          aria-label={`${side === "from" ? text("You send") : text("You receive")}: ${networkName(ref.network)}`}
          onClick={() => setMenu((current) => (current === side ? null : side))}
        >
          <span className={`${styles.glyph} ${styles.glyphNetwork}`} aria-hidden>{networkName(ref.network).slice(0, 1)}</span>
          <span translate="no">{networkName(ref.network)}</span>
          <span className={styles.caret} aria-hidden>▾</span>
        </button>
        )}
        {menu === side && !fixed ? (
          <ul className={styles.menu} role="listbox" aria-label={text("Network")}>
            {networkChoices.map((candidate) => {
              const status = networkStatus?.[candidate] ?? null;
              const carrying = status === null || status.offerable;
              return (
                <li key={candidate}>
                  <button
                    className={styles.menuItem}
                    type="button"
                    role="option"
                    aria-selected={candidate === ref.network}
                    disabled={!carrying}
                    /* Shown and refused rather than hidden: a network that
                       vanishes teaches somebody it was never supported, while one
                       that is visibly unavailable teaches them to come back. */
                    onClick={() => carrying && chooseNetwork(side, candidate)}
                  >
                    <span className={`${styles.glyph} ${styles.glyphNetwork}`} aria-hidden>{networkName(candidate).slice(0, 1)}</span>
                    <span translate="no">{networkName(candidate)}</span>
                    {carrying ? null : <span className={styles.menuNote}>{text("Not carrying right now")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <button
        className={styles.segment}
        type="button"
        disabled={locked}
        onClick={(event) => {
          pickerTrigger.current = event.currentTarget;
          setSearch("");
          setSearchRows(null);
          setMenu(null);
          setPicker(side);
        }}
        aria-label={`${side === "from" ? text("You send") : text("You receive")}: ${codeFor(ref)}. ${text("Choose an asset")}`}
      >
        <span className={`${styles.glyph} ${styles.glyphAsset}`} aria-hidden>{codeFor(ref).slice(0, 1)}</span>
        <span translate="no">{codeFor(ref)}</span>
        <span className={styles.caret} aria-hidden>▾</span>
      </button>
    </div>
    );
  };

  /**
   * Which wallet this leg is attached to, on the leg itself.
   *
   * A Solana wallet has always shown as a chip in the shell header. An
   * Ethereum-style one showed **nowhere** — on pairs whose sending side is the
   * EVM one, which is every Robinhood Chain pair. A person could not tell a
   * connected wallet from an unconnected one, and with the balance missing too
   * there was nothing on the surface that even implied a wallet existed.
   *
   * It sits on the leg rather than in one corner because a cross-chain swap has
   * two of them, doing two different jobs: one signs, the other is paid. The
   * network beside it names which chain it is on, so the chip carries only the
   * address and the one action.
   */
  const walletChip = (side: Side) => {
    const network = side === "from" ? from.network : to.network;
    const evm = network !== "solana";
    const address = evm ? evmAddress : connection?.address ?? null;
    const label = connectWalletLabel[network];
    if (!address) {
      return (
        <button
          className={styles.walletConnect}
          type="button"
          aria-label={label}
          onClick={() => (evm ? void connectEvm() : void connect(wallets.length === 1 ? wallets[0]?.name : undefined))}
        >
          {text("Connect")}
        </button>
      );
    }
    return (
      <span className={styles.wallet}>
        <span className={styles.walletDot} aria-hidden />
        <span className={styles.walletAddress} translate="no" title={address}>
          {address.length > 12 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address}
        </span>
        <button
          className={styles.walletAction}
          type="button"
          aria-label={`${text("Disconnect")} · ${networkName(network)}`}
          /* An EVM wallet cannot be disconnected from a page — the permission
             lives in the extension — so this forgets the address here, which is
             what every dapp means by the word and what a person expects it to
             do: this surface stops acting for that account. */
          onClick={() => {
            if (!evm) {
              disconnect();
              return;
            }
            /* Forgetting the hint as well: otherwise the next page load asks the
               wallet about a connection this person has just let go. */
            writeEvmWalletHint(false);
            setEvmAddress(null);
          }}
        >
          {text("Disconnect")}
        </button>
      </span>
    );
  };

  return (
    <>
      <Panel id="bridge-surface" title={text("Bridge")} w={4} h={16} essential badge={badge} tone="evidence">
        <div className={styles.card}>
          {tokenFailed ? <p className={styles.note}>{text("Token details could not be loaded.")} <button type="button" className={styles.inlineAction} onClick={() => setTokenEpoch(value => value + 1)}>{text("Try again")}</button></p> : null}
          {balanceFailed ? <p className={styles.note}>{text("Balance unavailable")} <button type="button" className={styles.inlineAction} onClick={refreshBalances}>{text("Try again")}</button></p> : null}
          <div className={styles.legs}>
            {/* You send */}
            <section className={styles.leg} data-side="from" aria-label={text("You send")}>
              <div className={styles.legHead}>
                <span className={styles.legHeadMain}>
                  <span className={styles.legLabel}>{text("You send")}</span>
                  {walletChip("from")}
                </span>
                {fromBalance ? (
                  <div className={styles.balanceRow}>
                    <span className={styles.balanceText}>
                      {/* `Available`, not `Balance`: the figure is the spendable
                          one, with the fee reserve withheld, and on a cross-chain
                          pair the provider's own cost as well. */}
                      {text("Available")} <b translate="no">{displayRawAmount(fromBalance.raw, fromBalance.decimals)} {codeFor(from)}</b>
                    </span>
                    <div className={styles.shares} role="group" aria-label={text("Use part of the balance")}>
                      <button className={styles.share} type="button" disabled={locked} onClick={() => fillShare(1n, 4n)}>25%</button>
                      <button className={styles.share} type="button" disabled={locked} onClick={() => fillShare(1n, 2n)}>50%</button>
                      <button className={styles.share} type="button" disabled={locked} onClick={() => fillShare(3n, 4n)}>75%</button>
                      <button className={styles.share} type="button" disabled={locked} onClick={() => fillShare(1n, 1n)} title={text("Use the full spendable balance")}>
                        {text("MAX")}
                      </button>
                    </div>
                  </div>
                ) : null}
                {heldBack ? (
                  <div className={styles.heldBack}>
                    <span translate="no">{heldBack} {codeFor(from)}</span> {text("stays for the network fee")}
                  </div>
                ) : null}
              </div>
              <div className={styles.legRow}>
                <div className={styles.amountCell}>
                  <input
                    className={styles.amountInput}
                    value={amount}
                    disabled={locked}
                    inputMode="decimal"
                    aria-label={text("Amount to send")}
                    placeholder="0.0"
                    /* The number itself carries the state; a person reads the figure, not the button. */
                    data-state={overBalance ? "over" : undefined}
                    aria-invalid={overBalance ? true : undefined}
                    onChange={(event) => setAmount(event.target.value.replace(",", "."))}
                  />
                  {sendUsd ? (
                    <span className={styles.usdLine} translate="no">
                      {sendUsd}
                    </span>
                  ) : null}
                </div>
                {selector("from", from)}
              </div>
            </section>

            <div className={styles.seam}>
              <button className={styles.flip} type="button" disabled={locked} onClick={flip} aria-label={text("Flip the pair")}>
                ⇅
              </button>
            </div>

            {/* You receive */}
            <section className={styles.leg} data-side="to" aria-label={text("You receive")}>
              <div className={styles.legHead}>
                <span className={styles.legHeadMain}>
                  <span className={styles.legLabel}>{text("You receive")}</span>
                  {/* Only when the two legs are different wallets. On a
                      Solana-to-Solana swap both chips would be the same
                      address, and a second copy of it says nothing. */}
                  {from.network !== to.network ? walletChip("to") : null}
                </span>
              </div>
              <div className={styles.legRow}>
                <div className={styles.amountCell}>
                  {/* Owner rule, 2026-09-10: past its 60 s validity the figure stays
                      for context and stops reading as an offer. Dimmed by
                      `data-state`, and named — a dimmed number with no word beside
                      it is a rendering bug to anyone who has not been told. */}
                  <span className={styles.amountOut} data-state={quoteExpired ? "expired" : receiveDisplay ? "ready" : "waiting"} translate="no">
                    {receiveEstimated ? <span className={styles.approx}>≈</span> : null}
                    {receiveDisplay ?? "0.0"}
                  </span>
                  {quoteExpired ? <span className={styles.expiredMark}>{text("Expired")}</span> : null}
                  {receiveUsd ? (
                    <span className={styles.usdLine} data-state={quoteExpired ? "expired" : undefined} translate="no">
                      {receiveUsd}
                    </span>
                  ) : null}
                </div>
                {selector("to", to)}
              </div>
            </section>
          </div>

          <div className={styles.kind} data-tone={classification.ok ? "on" : "off"}>
            <span className={styles.kindDot} aria-hidden />
            <span className={styles.kindWord}>{kindLabel}</span>
          </div>

          {classification.ok && classification.kind === "CROSS_SWAP" ? (
            <CrossSwapEngine
              route={classification}
              amount={amount}
              pro={pro}
              solana={solanaSigner}
              evmAddress={evmAddress}
              onConnectEvm={connectEvm}
              onConnectSolana={() => void connect(wallets.length === 1 ? wallets[0]?.name : undefined)}
              onQuote={setCrossFacts}
              onLocked={setLocked}
              onSettled={refreshBalances}
              onReset={() => setAmount("")}
              /* One correction, applied for the person rather than asked of
                 them. The engine knows the arithmetic, this side knows the
                 decimals, so the raw figure crosses and is scaled here. */
              onAmountCorrected={(raw) => setAmount(scaleRawAmount(raw, offerable?.decimals ?? fromAsset?.decimals ?? 0))}
              offerableRaw={offerable?.raw ?? null}
              gasBalanceRaw={from.network === "solana" ? null : (evmBalance?.network === from.network && evmBalance.owner === evmAddress && evmBalance.asset === from.asset ? evmBalance.nativeRaw : null)}
            />
          ) : null}

          {/* The reverse journey, small and always available. Owner sketch of
              2026-09-10: bringing funds in is the page, and moving them out is a
              line under it rather than a second mode a newcomer has to rule out
              before they can start. */}
          <p className={styles.direction}>
            <button className={styles.directionLink} type="button" disabled={locked} onClick={flipDirection}>
              {outbound ? text("Bring funds to Solana instead") : text("Need to move funds out of Solana?")}
            </button>
          </p>

          {!classification.ok ? (
            classification.reason === "SAME_NETWORK_IS_SWAP" ? (
              /* Not a dead end: this is a real pair, and it has a page. Bridge
                 refuses it rather than carrying it, because Relay's own Solana
                 route is Jupiter with a toll in front — the person would pay
                 more for the same liquidity and be told nothing. */
              <p className={styles.note}>
                {text("Both sides are on Solana, so this is a swap rather than a bridge.")}{" "}
                <Link className={styles.noteLink} href="/app/swap">
                  {text("Swap it on Solana")}
                </Link>
              </p>
            ) : (
              <p className={styles.note}>
                {classification.reason === "ASSET_NOT_ROUTABLE_ON_NETWORK"
                  ? /* Robinhood Chain's index knows the Stock Tokens by name and
                       its router refuses every one of them, so "not carried" is
                       the truth and "no route today" would not be. */
                    text("This network's router refuses that asset outright, so no amount of it can be moved here.")
                  : classification.reason === "EVM_SAME_NETWORK"
                    ? text("Choose a different network on one side. Bridge moves value between networks.")
                    : classification.reason === "UNKNOWN_ASSET"
                      ? text("Pick an asset on both sides.")
                      : /* No written list of pairs: what can be done is whatever
                           Relay can fill, and only a live quote knows that. */
                        text("No route for this pair right now. Nothing was sent.")}
              </p>
            )
          ) : null}
        </div>
      </Panel>

      {picker ? (
        <div
          className={styles.pickerBackdrop}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPicker(null);
          }}
        >
          <div ref={pickerRef} className={styles.picker} role="dialog" aria-modal="true" aria-label={text("Choose an asset")}>
            <div className={styles.pickerHead}>
              <span>{picker === "from" ? text("You send") : text("You receive")} · {networkName(picker === "from" ? from.network : to.network)}</span>
              <button className={styles.secondary} type="button" onClick={() => setPicker(null)}>
                {text("Close")}
              </button>
            </div>
            <input
              className={styles.address}
              value={search}
              autoFocus
              spellCheck={false}
              aria-label={text("Search by name, ticker or address")}
              placeholder={text("Search by name, ticker or address")}
              onChange={(event) => setSearch(event.target.value)}
            />
            {/* Said before the list, not after it. Several tokens can carry the
                same ticker and only one of them is the one a person means;
                without this line a search result reads as a shortlist somebody
                vetted, which is exactly what it is not. */}
            {searchRows !== null ? <p className={styles.pickerCaution}>{text("These are search results, not checked or recommended assets. Several tokens can share a ticker — match the address.")}</p> : null}
            {searchFailed ? <p className={styles.note}>{text("Search is unavailable right now. Try again.")}</p> : searchRows?.length === 0 ? <p className={styles.note}>{text("No tokens found")}</p> : null}
            <ul className={styles.pickerList}>
              {(searchRows !== null
                ? searchRows.map((row) => ({
                    asset: row.mint,
                    code: row.symbol ?? `${row.mint.slice(0, 4)}…`,
                    note: row.name ?? null,
                    address: row.mint,
                    /* Unvouched is the default for anything the index has not
                       checked, so the absence of a flag is never read as a
                       blessing. */
                    unverified: row.verified !== true,
                  }))
                : optionsFor(picker === "from" ? from.network : to.network).map((entry) => ({ ...entry, address: entry.asset, unverified: entry.unverified === true }))
              ).map((entry) => {
                const selected = (picker === "from" ? from.asset : to.asset) === entry.asset;
                return (
                  <li key={entry.asset}>
                    <button className={styles.pickerItem} type="button" data-selected={selected ? "true" : "false"} onClick={() => chooseAsset(picker, entry.asset)}>
                      <span className={`${styles.glyph} ${styles.glyphAsset}`} aria-hidden>{entry.code.slice(0, 1)}</span>
                      <span className={styles.pickerMeta}>
                        <span translate="no">{entry.code}</span>
                        {/* The address, always, and not only for the unvouched:
                            it is the only thing that tells two tokens with one
                            ticker apart, and showing it just for the flagged
                            ones would make the flag the thing people read
                            instead of the identity. */}
                        <span className={styles.pickerNote} translate="no">
                          {entry.address.length > 14 ? `${entry.address.slice(0, 6)}…${entry.address.slice(-4)}` : entry.address}
                          {entry.note ? ` · ${entry.note}` : ""}
                        </span>
                      </span>
                      {/* Only the unvouched carry a chip. A bare "Verified"
                          beside an asset would read as a Ryntra verdict on it
                          and this product does not make those — the same rule
                          the Swap panels already hold. What stops the rest
                          reading as vetted-by-omission is the caution above
                          the list, which says outright that these are search
                          results rather than checked assets. */}
                      {entry.unverified ? <span className={styles.pickerFlag}>{text("Unverified")}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
