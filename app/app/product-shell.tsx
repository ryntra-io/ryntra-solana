"use client";

/* The core's tokens, base and components first; the product's own stylesheets
   after them, then the old names as aliases of the core's tokens. */
import "@ryntra/core/tokens.css";
import "@ryntra/core/base.css";
import "@ryntra/core/ui.css";
/* The core's charts (CH-17): the big chart and the compact ones, after the tokens, base and components they read. */
import "@ryntra/core/chart.css";
import "@ryntra/core/chart/compact.css";
import "@/app/shell/shell.css";
import "@/app/shell/panel.css";
import "@/app/design/tokens.css";
import "@/app/shell/rt-bridge.css";
import "./product.css";
import "./account/account.css";
import "@ryntra/core/legacy.css";
import "./frame.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PRODUCTS } from "@ryntra/core/products";
import {
  AppShell,
  LOOK_COOKIE as CORE_LOOK_COOKIE,
  MENU_COOKIE as CORE_MENU_COOKIE,
  decodeLook,
  decodeMenuLayout,
  type Look,
  type MenuLayout,
  type NetworkOption,
  type WalletState,
} from "@ryntra/core/ui";

import { RyntraMark } from "@/app/brand/ryntra-brand";
import { usePagePath } from "@/lib/site/use-page-path";
import { Wordmark } from "@/app/site/wordmark";
import { ASSISTANT, MENU_FOOT, MENU_LIVE, MENU_PATHS, MENU_TAGS, NETWORK_PLATE, PERPS_LABEL, rowForPath, type MenuSectionId } from "@/app/shell/domains";
import { SHELL_CHROME_COPY } from "@/app/shell/chrome-copy";
import { ShellCopyProvider } from "@/app/shell/shell-copy";
import { ShellStateProvider } from "@/app/shell/shell-state";
import { WidgetRegistryProvider } from "@/app/shell/widget";
import { SOLANA_WALLET_TRIGGER_ID } from "@/app/solana/workspace/connection-trigger.client";
import { SolanaConnectionControl, useSolanaConnection } from "@/app/solana/workspace/connection";
import { InviteBanner } from "@/app/solana/workspace/rewards/invite-banner";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { WalletAccountIdentity } from "./account/account-control";
import { FeedbackLauncher } from "./feedback/feedback-launcher";
import { screenContext, useUsdcBalance } from "./header-tools";
import { LOOK_COOKIE, MENU_COOKIE, followLookForOldPages } from "./look";
import { NotificationsRow } from "./notifications/bell";
import { PhoneBar } from "./phone-bar";
import { useSkrName } from "@/app/solana/workspace/skr-name";
import { ProductSearch, type ProductSearchHandle } from "./search/product-search";
import { useTypingOnPhone } from "./typing";
import { toggleAssistant, useAssistantPanel } from "./ryn/assistant-open";
import { AssistantPanel } from "./ryn/assistant-panel";

/* The layout reads the core's cookies by these names; a renamed cookie in the core fails here, at build. */
const SAME_COOKIES: readonly [typeof CORE_LOOK_COOKIE, typeof CORE_MENU_COOKIE] = [LOOK_COOKIE, MENU_COOKIE];
void SAME_COOKIES;

/** The Solana app's root: every row is this plus its path. */
const APP = "/app";

/**
 * Where the rows the core reads by a product's id open from here. The menu names Solana only: «Мережа» and «Інші продукти» are off its foot for now — brings them back, their wiring
 * (decision 55) is in the history of this file, not drawn.
 *
 * - Perps of Торгівля are Phoenix's, inside Solana at `/app/perps` (decision 56, B7; PERP-1), the core's `futures` row;
 *   Ryntra Futures, the Hyperliquid terminal, is paused (decision 58) and is linked from nowhere here.
 * - Прогнози on AGG are a section of Solana: the row of Торгівля opens
 *   `/app/predictions` in this cabinet, and predict.ryntra.io leads there too (`lib/predictions/predict-host.ts`).
 */
const LINKS: Readonly<Record<string, string>> = {
  solana: APP,
  futures: "/app/perps",
  predictions: "/app/predictions",
};
const LIVE = MENU_LIVE;
/** The catalogue's networks only: no separate product, so the core draws no «Інші продукти». */
const MENU_PRODUCTS = PRODUCTS.filter((product) => !product.separate);
/** No «Мережа»: an empty list, where the core would otherwise list the catalogue's networks. */
const NO_NETWORKS: readonly NetworkOption[] = [];

/**
 * The tags beside a row's word in the menu ({@link MENU_TAGS}) and the word «Perps» in place of the core's for its
 * `futures` row ({@link PERPS_LABEL}, PERP-1): handed to `frame.css` as custom properties on the frame, so the words
 * stay in one place with the search's and the core's row is not forked.
 */
function menuTagStyle(locale: "en" | "uk"): CSSProperties {
  return {
    ...Object.fromEntries(Object.entries(MENU_TAGS).map(([id, tag]) => [`--sol-menu-tag-${id}`, JSON.stringify(tag[locale])])),
    "--sol-menu-word-futures": JSON.stringify(PERPS_LABEL[locale]),
  } as CSSProperties;
}

/** An address outside this app: the second network, Futures and the rest open there, not through the app's router. */
const ELSEWHERE = /^https?:\/\//;

/** The row a path stands in; a page outside every row (Settings, Нагляд, the bell's page) lights none. */
export function sectionForPath(pathname: string): MenuSectionId | null {
  return rowForPath(pathname);
}

/* One id, shared with the pages' own «Під'єднати гаманець» (`connection-trigger.client.ts`). */
const WALLET_TRIGGER = SOLANA_WALLET_TRIGGER_ID;

/**
 * Ryntra on Solana's frame — the core's frame, unforked, on Menu 3 (NAV-1, decision 55).
 *
 * The core's `AppShell` draws the header — the logo with the network's plate «Solana Mainnet Beta» (SOL-C11, decision
 * 63; on a phone a line under the header), the search, the USDC balance, the wallet and the assistant Ryntra, nothing
 * else — and the menu in the place the person chose: Головна, then the groups Торгівля · Автоматика ·
 * Заробіток · Гроші, each opened by its arrow, with only the rows that live on Solana. At the bottom of the menu,
 * apart from the groups: «Налаштування» and «Допомога» («Мережа» and «Інші продукти» are off for now, SOL-C2). Every place is a row,
 * so nothing stands above the page: no tabs, no row of tools. «Запустити токен» is the Launch page's own action,
 * «Винагороди» a row of Заробіток, and the notifications and «Відгук» stand in the wallet's panel beside Settings.
 *
 * The product's own pieces stay the product's: the search dialog opens from the header's search and Ctrl K, and the
 * wallet's panel — the address, what it holds, the account, Settings, the notifications, «Відгук» and the way out —
 * from the header's wallet button. Language, theme, density and the menu's place are «Налаштувати». The phone's bar
 * is the product's too, handed to the core as its `bottomBar`: the core pins it and keeps a page's pinned action, a
 * ticket's and a Review's above it (UX-900).
 */
export function ProductShell({
  menuCookie,
  lookCookie,
  children,
}: {
  signedIn: boolean;
  /** The menu's place and the look as the request's cookies tell them, so the first frame is already right. */
  menuCookie?: string | undefined;
  lookCookie?: string | undefined;
  children: ReactNode;
}) {
  const { locale } = useSolanaI18n();
  return (
    <ShellStateProvider workspaceId="ryntra" oneVersion>
      <WidgetRegistryProvider>
        <ShellCopyProvider copy={SHELL_CHROME_COPY[locale]}>
          <div className="ry-product" data-solana-app="true" style={menuTagStyle(locale)}>
            <ProductFrame menuLayout={decodeMenuLayout(menuCookie) ?? undefined} look={decodeLook(lookCookie) ?? undefined}>
              {children}
            </ProductFrame>
          </div>
        </ShellCopyProvider>
      </WidgetRegistryProvider>
    </ShellStateProvider>
  );
}

function ProductFrame({ menuLayout, look, children }: { menuLayout?: MenuLayout | undefined; look?: Look | undefined; children: ReactNode }) {
  const { locale, setLocale } = useSolanaI18n();
  const router = useRouter();
  /* The page's own path: `/uk/app/markets` is `/app/markets` in Ukrainian, the same row. */
  const pathname = usePagePath();
  const row = sectionForPath(pathname);
  const searchRef = useRef<ProductSearchHandle>(null);

  /* The wallet in the header's terms; its panel is the product's. */
  const { connection, connecting } = useSolanaConnection();
  /* The wallet's `.skr` name in place of its shortened address (SKR-4). The core's header prints `address` as it is
     and shortens anything past twelve characters, so a name goes there only while it fits whole; a longer one waits
     for the core's own name field, and the wallet's panel names it either way. */
  const skrName = useSkrName(connection?.address ?? null, { self: true });
  const shown = connection ? (skrName && skrName.length <= 12 ? skrName : connection.address) : null;
  const wallet: WalletState = connecting ? { state: "connecting" } : shown ? { state: "connected", address: shown } : { state: "disconnected" };
  const usdc = useUsdcBalance(locale);

  /* A press on the header's wallet button opens the wallet's panel — connected or not: the panel is where a wallet is
     chosen, where a phone is told how to open one, and where the account and the way out live. The panel closes on a
     press outside it, so a press on the header's button that closed it leaves it closed rather than opening it again. */
  const closedByPress = useRef(false);
  useEffect(() => {
    const before = (event: PointerEvent) => {
      const open = document.getElementById(WALLET_TRIGGER)?.getAttribute("aria-expanded") === "true";
      const onButton = (event.target as Element | null)?.closest?.(".ryntra-header__wallet, .ryntra-header__connect");
      closedByPress.current = Boolean(open && onButton);
    };
    const key = () => (closedByPress.current = false);
    document.addEventListener("pointerdown", before, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", before, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  /* Whether the wallet's panel was open — kept across the effect below, which starts again when the wallet changes, so
     a panel closed by a new connection still gives the focus back. */
  const panelWasOpen = useRef(false);
  /* The panel from the keyboard: opening it moves the focus into it, closing it brings the focus back to the header's
     wallet button, which says whether the panel is open. The panel's own trigger is out of sight and out of the Tab
     order. */
  useEffect(() => {
    const trigger = document.getElementById(WALLET_TRIGGER);
    if (!trigger) return;
    trigger.tabIndex = -1;
    /* The header's button is the one a screen reader meets; this trigger only opens the panel for it. */
    trigger.setAttribute("aria-hidden", "true");
    const button = () => document.querySelector<HTMLElement>(".ryntra-header__wallet, .ryntra-header__connect");
    let leaving = false;
    const onPress = (event: MouseEvent) => {
      leaving = Boolean((event.target as Element | null)?.closest?.(".sol-wallet-anchor .rs-menu-panel a[href]"));
    };
    document.addEventListener("click", onPress, true);
    /* Only a panel that was open gives the focus back: a page that has just loaded keeps it where the browser put it,
       not on the header's wallet button with its focus ring lit. */
    const sync = () => {
      const open = trigger.getAttribute("aria-expanded") === "true";
      const moved = leaving;
      leaving = false;
      const header = button();
      header?.setAttribute("aria-expanded", String(open));
      header?.setAttribute("aria-haspopup", "menu");
      if (open) {
        requestAnimationFrame(() => document.querySelector<HTMLElement>(".sol-wallet-anchor .rs-menu-panel :is(a[href], button:not([disabled]))")?.focus());
      } else if (panelWasOpen.current && !moved && (document.activeElement === trigger || document.activeElement === document.body || !document.activeElement)) {
        header?.focus();
      }
      panelWasOpen.current = open;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onPress, true);
    };
  }, [connection?.address]);
  const onWallet = useCallback(() => {
    if (closedByPress.current) {
      closedByPress.current = false;
      return;
    }
    document.getElementById(WALLET_TRIGGER)?.click();
  }, []);

  /* The look the person picks in «Налаштувати» is the core's; the pages that still read the old theme names follow it. */
  useEffect(() => followLookForOldPages(), []);

  /* A phone's keyboard never covers the field being typed in: the bar steps aside while the focus is in one, and the
     field is kept inside the band the person sees. One place, for every page of the cabinet. */
  useTypingOnPhone();

  /* A row of the menu opens through the app's router; the other network and products open at their own address. */
  const navigate = useCallback(
    (href: string) => {
      if (ELSEWHERE.test(href)) window.location.assign(href);
      else router.push(href);
    },
    [router],
  );

  /* The assistant Ryntra at the end of the header, with the screen as its context: its side panel beside the page
     (AI-06a, the Assistant line's `app/app/ryn/assistant-panel.tsx`), a second press closes it. */
  const assistant = useAssistantPanel();
  const onAssistant = useCallback(() => {
    toggleAssistant(screenContext(pathname, new URLSearchParams(window.location.search)));
  }, [pathname]);

  /* «Відгук» from the wallet's panel: the dialog lives here, so it stays when the panel closes. */
  const [feedback, setFeedback] = useState(false);
  /* Stable, so the dialog's focus and keys are not set up again on every render of the frame. */
  const closeFeedback = useCallback(() => setFeedback(false), []);

  return (
    <AppShell
      products={MENU_PRODUCTS}
      current="solana"
      links={LINKS}
      networks={NO_NETWORKS}
      network={NETWORK_PLATE}
      section={row}
      sectionPaths={MENU_PATHS}
      live={LIVE}
      helpHref="/docs"
      onNavigate={navigate}
      menuLayout={menuLayout}
      look={look}
      lang={locale}
      onLangChange={setLocale}
      logo={<Wordmark size={26} />}
      logoCompact={<RyntraMark size={24} />}
      onSearch={() => searchRef.current?.show()}
      balance={usdc.value}
      loading={usdc.loading}
      balanceHref="/app/portfolio"
      wallet={wallet}
      onWallet={onWallet}
      onAssistant={pathname === ASSISTANT.href ? undefined : onAssistant}
      assistantOpen={pathname === ASSISTANT.href || assistant.open}
      bottomBar={(menu) => <PhoneBar locale={locale} row={row} onNavigate={navigate} menu={menu} />}
    >
      <div className="rs-canvas sol-canvas" id="workspace" lang={locale} translate="no">
        {/* A friend's invitation, on every page but «Винагороди», until it binds (then once, that it did). */}
        <InviteBanner />
        {children}
      </div>

      {/* The wallet's panel: the address and what it holds, the account, Settings, the notifications, «Відгук», the way out. */}
      <div className="sol-wallet-anchor">
        <SolanaConnectionControl
          identity={<WalletAccountIdentity />}
          compact
          triggerId={WALLET_TRIGGER}
          preferences={(close) => (
            <>
              <Link className="rs-menu-item" href="/app/settings" onClick={close} role="menuitem" prefetch={false}>
                <span className="rs-menu-item-label">{MENU_FOOT.settings.label[locale]}</span>
              </Link>
              <NotificationsRow locale={locale} label={MENU_FOOT.notifications.label[locale]} onOpen={close} />
              <button
                type="button"
                className="rs-menu-item"
                role="menuitem"
                aria-haspopup="dialog"
                onClick={() => {
                  close();
                  setFeedback(true);
                }}
              >
                <span className="rs-menu-item-label">{MENU_FOOT.feedback[locale]}</span>
              </button>
            </>
          )}
        />
      </div>
      <FeedbackLauncher open={feedback} onClose={closeFeedback} />
      <AssistantPanel locale={locale} />

      <ProductSearch locale={locale} handle={searchRef} />
    </AppShell>
  );
}
