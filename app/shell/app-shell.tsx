"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";

import { usePagePath } from "@/lib/site/use-page-path";

import { navActiveHref, railCurrent } from "./nav-active";
import { openGroupOfActive, readCollapsedGroups, writeCollapsedGroups } from "./nav-collapse";
import {
  AddressBook,
  ArrowLineDown,
  ArrowLineLeft,
  ArrowLineRight,
  ArrowRight,
  ArrowSquareOut,
  ArrowsLeftRight,
  Bank,
  BellRinging,
  Broadcast,
  ChartBar,
  ChartDonut,
  ChartLine,
  ChartPieSlice,
  ClipboardText,
  Check,
  Coins,
  Compass,
  Crosshair,
  Cube,
  Database,
  CaretDown,
  DotsThree,
  Eye,
  Fingerprint,
  Flask,
  Funnel,
  Gauge,
  GearSix,
  GitBranch,
  HandPalm,
  House,
  Lightbulb,
  Lightning,
  List,
  ListChecks,
  MagnifyingGlass,
  MapTrifold,
  Newspaper,
  Notebook,
  Path,
  Plugs,
  Pulse,
  PlugsConnected,
  QrCode,
  Receipt,
  Robot,
  Scales,
  SealCheck,
  SidebarSimple,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  Stack,
  Target,
  Terminal,
  TrendUp,
  UsersThree,
  Wallet,
  Warning,
  Waveform,
  X,
  TreeStructure,
  Buildings,
  ClockCounterClockwise,
  Gift,
  PlusCircle,
  Repeat,
  RocketLaunch,
} from "@phosphor-icons/react";

import { Wordmark } from "@/app/site/wordmark";
import { RyntraMark } from "@/app/brand/ryntra-brand";
import {
  ActionConsoleDrawer,
  ActionConsoleProvider,
  type ActionDefinition,
} from "./action-console";
import { CustomizeMenu } from "./customize";
import { ShellMenu } from "./menu";
import type { WorkspaceMode } from "./layout-store";
import { ShellStateProvider, useShell } from "./shell-state";
import { ThemeToggle } from "./theme-toggle";
import { ShellCopyProvider, useShellCopy, type ShellChromeCopy } from "./shell-copy";
import {
  menuNavigation,
  mobileNavigation,
  pageActiveHref,
  productNavigation,
  type PageRoute,
  type ProductLocale,
} from "./domains";
import { ProductMobileNav } from "./product-mobile-nav";
import { WidgetRegistryProvider } from "./widget";
import {
  navigationFor,
  WORKSPACES,
  WORKSPACE_GROUPS,
  workspaceGroup,
  workspaceById,
  workspaceForPath,
  type NavEntry,
  type NavGroup,
  type Workspace,
} from "./workspaces";

import "./shell.css";
/* Hub chrome shared by the ecosystem workspaces — the Guided|Pro switch, the
   Hub Map card grammar and the evidence-state chip. Imported here so every
   workspace that renders through this shell gets it without owning a copy. */
import "./hub.css";
/* The DESIGN.md projection, then the bridge that re-resolves the legacy
   variable names onto it inside the shell — the "Workspace dark" rung of the
   migration ladder. Order matters: the bridge must win the cascade. */
import "../design/tokens.css";
import "./rt-bridge.css";

/**
 * RyntraAppShell.
 *
 * One shell for the whole application. A workspace changes the canvas and the
 * inspector; the brand, the navigation structure, the account and the way back
 * are constant, which is the entire difference between "Ryntra in another
 * context" and the second application this replaces.
 *
 * Three decisions worth stating.
 *
 * The switcher lists only workspaces a person can actually enter, and the
 * current one is decided by the route rather than by the layout that mounted
 * the shell. Accepted-but-unbuilt directions are not hidden — they live on the
 * Workspace Map at `/workspaces`, where each one can carry its real state and
 * the exact reason it stops there. A menu is for choices; a map is for memory.
 *
 * Workspaces that need the cabinet session are entered through their normal
 * route, which carries its own gate. This shell does not gate anything and does
 * not read a session — one hub's desk is deliberately reachable without an
 * account, and a shell that decided access would quietly break that.
 *
 * The inspector is closed until asked for. A panel that is open before it has
 * anything to say is just a narrower canvas.
 */

const ICONS: Record<string, ReactNode> = {
  overview: <House size={17} weight="bold" />,
  /* «Простий»'s first place. `overview` is the cabinet's old
     Home on other rails; the two never share one. */
  home: <House size={17} weight="bold" />,
  /* «Простий»'s third place is the assistant, drawn with the mark every
     «Спитати Ryntra» button already carries. */
  ryntra: <Sparkle size={17} weight="bold" />,
  activity: <List size={17} weight="bold" />,
  receipts: <Receipt size={17} weight="bold" />,
  send: <ArrowLineRight size={17} weight="bold" />,
  /* One concept, one icon (DESIGN.md §Do's). Swap and Bridge shared
     `ArrowsLeftRight` and Unified Balance shared `Cube` with the hub workspace
     itself — three entries, two glyphs, and no way to tell them apart in the
     rail. Swap keeps the exchange arrows; Bridge takes the crossing path;
     Unified Balance takes the stack, which is what a balance across networks
     actually is. */
  swap: <ArrowsLeftRight size={17} weight="bold" />,
  bridge: <Path size={17} weight="bold" />,
  unified: <Stack size={17} weight="bold" />,
  /*
   * The product's eleven pages, and the six of them that had no glyph.
   *
   * The rule the three comments below record — an icon must never be the same
   * mark for two different questions — is what picks each one. Spot is the
   * price line you place an order against. Perps is leverage, so it is the bolt
   * rather than another chart. Trends is looking outward for something worth
   * trading. An idea is the lightbulb; a result is whether the plan hit what it
   * aimed at. Receive is money arriving, drawn downward so it cannot be read as
   * the navigation control Send's arrow points the other way from. `more` is
   * the phone bar's fifth item, which opens the rail rather than a page.
   */
  /* Spot shares the price line with `markets` deliberately: they are one
     question in two rails, and the product retires the Markets name in favour of
     this page. The rule forbids one mark for two different questions, not for
     the same question asked twice. */
  spot: <ChartLine size={17} weight="bold" />,
  /* Stocks is the companies behind the tokens — the research page, not a
     second price line beside Spot's. */
  stocks: <Buildings size={17} weight="bold" />,
  perps: <Lightning size={17} weight="bold" />,
  /* A prediction market is a probability, and a share of a whole is the one
     mark that says so without a chart nothing else here uses. */
  predictions: <ChartDonut size={17} weight="bold" />,
  trends: <TrendUp size={17} weight="bold" />,
  ideas: <Lightbulb size={17} weight="bold" />,
  results: <Target size={17} weight="bold" />,
  receive: <ArrowLineDown size={17} weight="bold" />,
  more: <DotsThree size={17} weight="bold" />,
  policies: <ShieldCheck size={17} weight="bold" />,
  developers: <Terminal size={17} weight="bold" />,
  settings: <GearSix size={17} weight="bold" />,
  terminal: <Terminal size={17} weight="bold" />,
  journal: <Notebook size={17} weight="bold" />,
  connect: <Plugs size={17} weight="bold" />,
  beta: <SealCheck size={17} weight="bold" />,
  cabinet: <SquaresFour size={17} weight="bold" />,
  /* Hub destinations. Each concept takes a glyph nothing else uses, which
     `hub/navigation.test.mjs` asserts rather than trusts. */
  attention: <Warning size={17} weight="bold" />,
  network: <Broadcast size={17} weight="bold" />,
  pay: <Wallet size={17} weight="bold" />,
  payouts: <Bank size={17} weight="bold" />,
  agents: <Robot size={17} weight="bold" />,
  /* The v4 cabinet's remaining destinations. Each glyph says what the page
     does rather than what zone it sits in: a passport is coins, a provider is
     a connected plug, a request is the code someone scans, a batch is a
     checked list, recipients are an address book, the verifier is the
     fingerprint it checks, reports are the bars they summarise into. */
  assets: <Coins size={17} weight="bold" />,
  providers: <PlugsConnected size={17} weight="bold" />,
  request: <QrCode size={17} weight="bold" />,
  batch: <ListChecks size={17} weight="bold" />,
  recipients: <AddressBook size={17} weight="bold" />,
  verifier: <Fingerprint size={17} weight="bold" />,
  /* Gate 5's two new destinations. Agent Control is a boundary rather than a
     robot — `agents` already owns the robot, and drawing both the thing and
     the limit on it with one glyph is the exact confusion the rule above
     forbids. The capability register is the clipboard: a list somebody keeps
     and checks, which is what it is. */
  "agent-control": <HandPalm size={17} weight="bold" />,
  capabilities: <ClipboardText size={17} weight="bold" />,
  reports: <ChartBar size={17} weight="bold" />,
  map: <MapTrifold size={17} weight="bold" />,
  /* The architecture diagram is the graph, and the map is the territory —
     two different questions that had been sharing one answer, which is why
     the required architecture diagram could be missing while the map existed. */
  architecture: <TreeStructure size={17} weight="bold" />,
  /* The Solana Hub's destinations that no earlier workspace named. Markets is
     the price line, not the summary bars reports already own; Trade shares the
     exchange arrows with Swap because they are one concept in two rails; the
     Strategy Lab is the flask it is named after. */
  markets: <ChartLine size={17} weight="bold" />,
  trade: <ArrowsLeftRight size={17} weight="bold" />,
  strategy: <Flask size={17} weight="bold" />,
  /* Shell v2 modules. Strategy, Journal and Settings already had a glyph;
     Radar, Portfolio, Operations and Treasury complete the set. */
  radar: <Crosshair size={17} weight="bold" />,
  portfolio: <ChartPieSlice size={17} weight="bold" />,
  treasury: <Bank size={17} weight="bold" />,
  /* Radar's three modes, and each one gets a glyph nothing else uses. They
     shipped without any, so the rail fell back to one shared square for
     Screener, Scanner and Watchlist — three different questions drawn as the
     same mark, which is the one thing an icon must never do. The distinction
     the pack draws is what they say: a screener narrows a question a
     person states, a scanner watches standing conditions and raises events, a
     watchlist answers what happened to this one. */
  screener: <Funnel size={17} weight="bold" />,
  scanner: <Pulse size={17} weight="bold" />,
  watchlist: <Eye size={17} weight="bold" />,
  /* Switcher rows. Neutral glyphs on purpose — a workspace row is not a place
     to reproduce someone else's brand mark, and a wrong one reads as a claim
     about who built the page. */
  /* Ryntra Home's own destinations.
   *
   * They shipped without glyphs and the rail fell back to one shared square
   * for eleven entries — Today, Daily Brief, Adviser, Portfolio, Strategies,
   * Research, Decisions, Control, Alerts, Coverage and Operations drawn as the
   * same mark. Radar's three modes hit this exact defect and its comment above
   * states the rule: an icon must never be the same mark for different
   * questions. Each glyph here says what the page answers — a brief is the
   * paper, the adviser is where a question is asked, research is the search,
   * a strategy is its versions, a decision is the balance, control is the
   * sliders, an alert is the bell, coverage is what the store holds,
   * operations is the dial. */
  brief: <Newspaper size={17} weight="bold" />,
  adviser: <Compass size={17} weight="bold" />,
  research: <MagnifyingGlass size={17} weight="bold" />,
  strategies: <GitBranch size={17} weight="bold" />,
  decisions: <Scales size={17} weight="bold" />,
  control: <SlidersHorizontal size={17} weight="bold" />,
  /* Money is the domain, not a single action: a wallet rather than an
     arrow, because Send, Receive and Bridge all live under it. */
  money: <Wallet size={17} weight="bold" />,
  alerts: <BellRinging size={17} weight="bold" />,
  coverage: <Database size={17} weight="bold" />,
  operations: <Gauge size={17} weight="bold" />,
  /* Agent Control's Team: the people around the fleet. It shipped riding the
     House glyph, which drew Overview twice in one Pro group — the exact
     same-mark-different-questions defect the two comments above record. */
  team: <UsersThree size={17} weight="bold" />,
  "workspace-home": <House size={17} weight="bold" />,
  "workspace-markets": <ChartLine size={17} weight="bold" />,
  "workspace-cube": <Cube size={17} weight="bold" />,
  "workspace-stellar": <Sparkle size={17} weight="bold" />,
  "workspace-solana": <Waveform size={17} weight="bold" />,
  "workspace-agents": <Robot size={17} weight="bold" />,
  /* The menu you can see. Markets is where a person goes
     looking, so it is the compass, and no longer shares the price line with
     Spot one row below it; «Автоінвест» repeats; «Поповнити» adds; History is
     the clock, and Rewards the gift that shipped as the fallback square. */
  explore: <Compass size={17} weight="bold" />,
  autoinvest: <Repeat size={17} weight="bold" />,
  "top-up": <PlusCircle size={17} weight="bold" />,
  history: <ClockCounterClockwise size={17} weight="bold" />,
  rewards: <Gift size={17} weight="bold" />,
  /* Launch: a token leaving the ground. */
  launch: <RocketLaunch size={17} weight="bold" />,
};

/*
 * The theme control used to live here, as a Sun/Moon button in the tool
 * cluster. It is gone, and its absence is the contract rather than an
 * oversight.
 *
 * Appearance is one global preference — `dark | light` — with one
 * store, one boot script and one primary place to change it: Settings →
 * Appearance. A standalone icon in the top bar made it the sixth control that
 * could write that preference, next to the cabinet footer switch, two workspace
 * settings pages, a hub's tools panel and the demo terminal. Six controls over
 * one value is not a choice, it is a maintenance surface, and the frozen UX
 * System puts none of them in the primary top bar.
 *
 * `app/app/theme.ts` remains the only writer. Nothing about the stored value or
 * the no-flash boot script changed here; only who is allowed to offer it.
 */

/**
 * The product's readiness words, which take no tone at all.
 *
 * A page that is not finished is not a page that is dangerous. The status-chip
 * rules reserve amber for a verdict, and the inference below would have
 * painted `Building` amber while `Робимо` — the same word in the other locale —
 * stayed neutral, so one language read as a warning and the other did not.
 * Readiness is a maturity, and a maturity has no tone.
 */
const READINESS_TAGS = new Set(["building", "planned", "робимо", "у плані"]);

function tagTone(
  tag?: string,
): "verified" | "evidence" | "caution" | undefined {
  if (!tag) return undefined;
  const value = tag.toLowerCase();
  if (READINESS_TAGS.has(value)) return undefined;
  if (value.includes("verified")) return "verified";
  if (value.includes("testnet") || value.includes("limited")) return "evidence";
  if (value.includes("build")) return "caution";
  return undefined;
}

/* ------------------------------------------------------ workspace switcher */

/**
 * The workspace switcher.
 *
 * It answers one question — *which workspace am I in, and what else could I be
 * in* — and it is allowed to answer no others. Everything it used to also carry
 * has moved to where that fact belongs:
 *
 *   the eyebrow      deleted. A 12px uppercase `WORKSPACE` label above the name
 *                    told a person nothing they could not see, in the one size
 *                    the frozen ramp does not permit.
 *   the environment  to its own chip beside this control, and out of the rows
 *                    entirely. `PAPER · WALLET-SIGNED ROUTES` in a switcher row
 *                    is a sentence, and a person scanning six rows for a place
 *                    to go reads none of them.
 *   the account      to the top bar's far right, once, globally. A `Sign-in`
 *                    tag on every row implied three separate accounts.
 *   the roadmap      to the capability register at `/docs/current-capabilities`,
 *                    reached from the footer link. It lived on the Workspace
 *                    Map until the public-surface consolidation retired that
 *                    page into a permanent redirect; the footer names the
 *                    register it actually opens — for one release it kept the
 *                    old `All workspaces` label over the new destination, a
 *                    door that promised workspaces and delivered capabilities.
 *
 * What is left is an icon, a name, one muted line, and a tick on the current
 * one, under four headings a person can scan without reading.
 */
function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const sw = useShellCopy().switcher ?? { title: "Workspaces", all: "Current capabilities" };
  return (
    <ShellMenu
      align="start"
      boxClass="rs-switchbox"
      triggerClass="rs-switch"
      panelTitle={sw.title}
      ariaLabel={`Workspace: ${current.name}. Switch workspace`}
      label={
        <>
          <span className="rs-switch-name-full">{current.name}</span>
          <span className="rs-switch-name-mobile" aria-hidden>
            {current.short}
          </span>
        </>
      }
    >
      {(close) => (
        <>
          {WORKSPACE_GROUPS.map((group) => {
            const rows = WORKSPACES.filter(
              (workspace) => workspaceGroup(workspace) === group,
            );
            if (rows.length === 0) return null;
            return (
              <section className="rs-switch-group" key={group}>
                <p className="rs-menu-heading">{group}</p>
                {rows.map((workspace) => {
                  const isCurrent = workspace.id === current.id;
                  return (
                    <Link
                      key={workspace.id}
                      className="rs-switch-item"
                      href={workspace.href}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={close}
                    >
                      <span className="rs-switch-item-ic" aria-hidden>
                        {ICONS[workspace.icon] ?? (
                          <SquaresFour size={17} weight="bold" />
                        )}
                      </span>
                      <span className="rs-switch-item-name">
                        {workspace.name}
                      </span>
                      {isCurrent ? (
                        <Check
                          size={14}
                          weight="bold"
                          className="rs-switch-check"
                          aria-hidden
                        />
                      ) : null}
                      <small>{workspace.subtitle}</small>
                    </Link>
                  );
                })}
              </section>
            );
          })}
          <Link className="rs-switch-more" href="/docs/current-capabilities" onClick={close}>
            {sw.all}
            <ArrowRight size={12} weight="bold" aria-hidden />
          </Link>
        </>
      )}
    </ShellMenu>
  );
}

/**
 * The environment chip.
 *
 * Deliberately not a control. It states the network or mode the current
 * workspace runs in, and a person who wants a different one changes the
 * workspace — there is no environment today that two workspaces share, so a
 * picker here would offer exactly one option and imply others exist.
 */
function EnvironmentChip({
  workspace,
  scope,
}: {
  workspace: Workspace;
  /**
   * A route-level override. `undefined` means "no opinion, use the
   * workspace's"; `null` means "this route has no environment", which is a
   * real answer — Agent Control's verifier recomputes hashes over pasted JSON
   * and touches no network, so a chip there would be decoration reading as a
   * fact.
   */
  scope?: string | null;
}) {
  const label = scope === undefined ? workspace.environment : scope;
  if (!label) return null;
  return (
    <span className="rs-env" title={`${workspace.name} · ${label}`}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------- navigation */

function NavLink({
  entry,
  activeHref,
  activeIsExact,
  heads,
  domain,
  yieldsPage = false,
}: {
  entry: NavEntry;
  activeHref: string | null;
  /** This row is one of the product's six domains rather than a page inside one. */
  domain?: boolean;
  /**
   * A row inside this nav is the exact open page, so a domain row sharing its
   * href must not also claim to be it. See `pageIsInside` at the call site.
   */
  yieldsPage?: boolean;
  /**
   * Whether the winning href *is* the current route, rather than an ancestor
   * of it. See the comment on `active` below for what turns on this.
   */
  activeIsExact: boolean;
  /** This row names the group beneath it, so it is set as a section header. */
  heads?: boolean;
}) {
  const icon = ICONS[entry.icon ?? entry.id] ?? (
    <SquaresFour size={17} weight="bold" />
  );
  const tone = entry.tone ?? tagTone(entry.tag);

  if (!entry.href) {
    return (
      <span
        className="rs-link"
        data-disabled="true"
        data-heads={heads ? "true" : undefined}
        data-sub={entry.sub ? "true" : undefined}
        aria-disabled="true"
        title={entry.gate}
      >
        <span className="rs-link-ic" aria-hidden>
          {icon}
        </span>
        <span className="rs-link-label">{entry.label}</span>
        {entry.tag ? (
          <span className="rs-tag" data-tone={tone}>
            {entry.tag}
          </span>
        ) : null}
      </span>
    );
  }

  /*
   * Exactly one entry is current, and it is decided in `navActiveHref` for the
   * whole rail rather than by each link on its own. A link cannot see its
   * siblings, and that is precisely what deciding this needs.
   *
   * **Winning the match is not the same as being the page.** Half of one hub's
   * twenty-eight surfaces have no row of their own — Send, Swap, Pay, the
   * crosschain transfer and the payment request are rail *action cards*, and
   * Developers, Reports, Map and the rest sit under a module that does. On
   * every one of them the longest match was the hub's root, so the rail lit
   * `РАДАР` with a filled row and a blue edge and told the reader they were
   * somewhere they were not.
   *
   * An ancestor now gets `data-within` — a quiet left edge saying *the open
   * page is under here* — and `aria-current="page"` is reserved for the row
   * that is actually the page. Nothing is removed from the rail and no row
   * loses its link.
   */
  const state = railCurrent(entry.href, activeHref, activeIsExact, { domain, pageIsInside: yieldsPage });
  const active = state.current === "page";
  /* A domain is a place, not an ancestor page. Standing on Receipts, Activity
     IS where you are, so it reads as current — but it is not the open page, and
     `aria-current="page"` would say it was. ARIA has the exact word for this:
     `true` marks the current item of a set. The rule above is kept intact for
     ordinary rows, which is what it was written for. */
  const within = state.within;
  const currentDomain = state.current === "true";

  return (
    <Link
      className="rs-link"
      href={entry.href}
      title={entry.caption ? `${entry.label} — ${entry.caption}` : entry.label}
      data-heads={heads ? "true" : undefined}
      data-sub={entry.sub ? "true" : undefined}
      data-within={within ? "true" : undefined}
      data-domain={currentDomain ? "true" : undefined}
      aria-current={active ? "page" : currentDomain ? "true" : undefined}
    >
      <span className="rs-link-ic" aria-hidden>
        {icon}
      </span>
      {entry.caption ? (
        <span className="rs-link-label rs-link-named">
          <span className="rs-link-name">{entry.label}</span>
          <span className="rs-link-caption">{entry.caption}</span>
        </span>
      ) : (
        <span className="rs-link-label">{entry.label}</span>
      )}
      {entry.needsSession ? (
        <span className="rs-tag">Sign-in</span>
      ) : entry.tag ? (
        <span className="rs-tag" data-tone={tone}>
          {entry.tag}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The View menu.
 *
 * Density, panels, reset and focus — everything about how this workspace is
 * laid out, in one control, at the bottom of the rail it configures. It is not
 * in the top bar, which is the whole point: the frozen UX System names the
 * standalone theme icon, the standalone focus icon and the standalone layout
 * button as three things the primary bar does not carry, and they were all
 * three sitting next to the wallet.
 *
 * Appearance is deliberately absent from it. Theme is global and lives in
 * Settings; density and panel layout are per workspace and live here. Combining
 * them into one menu is what made "appearance" and "layout" read as the same
 * setting, and they are not — one follows the person across every workspace and
 * the other does not.
 */
function ViewMenu({
  modeInContext,
  extras,
}: {
  modeInContext?: boolean;
  extras?: ReactNode;
}) {
  return (
    <div className="rs-view">
      {/* Appearance is back in this slot since
          2026-08-24, beside the layout it does not change.

          It left on 2026-08-19 because the preference had four writers and a
          person could not tell which one was telling the truth. That rule
          still holds and this does not break it: `app/app/theme.ts` remains
          the only writer, this control is a view of it that watches
          `<html data-theme>`, and `Settings → Appearance` keeps the two-value
          Dark / Light radiogroup. Language sits here too, as a matching
          control, so the lonely chip at the foot of the rail is gone. */}
      <ThemeToggle />
      {extras}
      {/* A workspace that puts `Simple | Pro` in the top bar owns depth; this
          menu keeps density, panels and reset. Two controls writing one
          preference is worse than either alone — the Stellar Hub shipped a
          visible two-value switch beside this menu's three-value one, both
          calling `setMode`, and choosing the middle value left the visible
          switch reading something else. */}
      {/* Appearance is gone from this menu and from the slot beside it.
          The theme is one global preference with one home,
          `Settings → Appearance`. The objection that put it here was real and
          is answered a different way — a preference "two clicks deep in
          Settings" was unfindable because Settings itself was missing from
          three rails of six. It is pinned bottom-left on every rail now, so
          Appearance is one click from anywhere instead of one control in four
          places. Density, panels and reset stay: they are per workspace, and
          appearance is not. */}
      <CustomizeMenu showMode={!modeInContext} />
    </div>
  );
}

function PrimaryNavigation({
  groups,
  domainRoutes,
  actions,
  label,
  footer,
  settings,
  modeInContext,
  viewExtras,
  navRef,
  hidden,
}: {
  groups: readonly NavGroup[];
  /** The product's rows and what each owns, when this rail is the product's — the registry's pages, or «Простий»'s places. */
  domainRoutes?: readonly Pick<PageRoute, "href" | "match">[];
  /**
   * The verbs, above the places.
   *
   * Shell v2 took the actions out of the rail on the principle that an action
   * is something you do from a surface, not a place you navigate to. The
   * principle is right and the rail still holds no action *destinations* — what
   * this slot renders are triggers that open the action console beside the
   * surface you are on.
   *
   * It exists because a person opened the workspace and asked where sending
   * money was: the only entry was a `+ New action` button in a page header,
   * which names a category rather than a verb, and behind it a menu, and behind
   * that a row. Three steps, and not one of them says *Send* until the last.
   * A person who does not already know the product cannot find the product's
   * primary act.
   */
  actions?: ReactNode;
  label: string;
  footer?: ReactNode;
  viewExtras?: ReactNode;
  /**
   * The pinned Settings destination.
   *
   * Separate from `groups` so that "Settings is bottom-left" is structural. It
   * used to be the third entry of whichever group a workspace happened to put
   * it in — under `System` in one hub and in Home, absent in Agent Control — so the
   * one position the frozen UX System fixes by name was the one position each
   * workspace decided for itself.
   */
  settings?: NavEntry | null;
  /** The workspace shows depth in the top bar, so View must not offer it too. */
  modeInContext?: boolean;
  navRef: RefObject<HTMLElement | null>;
  hidden: boolean;
}) {
  /* The page's own path: a Ukrainian address (`/uk/app/markets`) marks the same row. */
  const pathname = usePagePath();
  /* In the product a path belongs to a DOMAIN, and the domain owns its routes:
     Money opens on Send and owns Receive and Bridge. Answering with the longest
     matching href instead left `/receipts` marking nothing at all and `/bridge`
     marking only in the phone bar, because the two surfaces were computing this
     differently. One answer now, from the ownership model both read. */
  const domainHref = domainRoutes ? pageActiveHref(pathname, domainRoutes) : null;
  const insideHref = navActiveHref(pathname, [
    ...groups.flatMap((group) => group.entries.map((entry) => entry.href)),
    settings?.href,
  ]);
  /* The same question asked of the rows that are pages rather than places. The
     domains group is excluded, or Home would yield the word `page` to itself:
     its domain row is also the only row that matches, and there is nothing for
     it to step back for. */
  const insidePageHref = navActiveHref(pathname, [
    ...groups
      .filter((group) => !group.id.startsWith("domains"))
      .flatMap((group) => group.entries.map((entry) => entry.href)),
    settings?.href,
  ]);
  const activeHref = domainHref ?? insideHref;
  /* Only the row that *is* the open page may claim to be it. An ancestor is
     marked as containing it instead — see `NavLink`. */
  const activeIsExact = activeHref !== null && activeHref === pathname;
  /*
   * A domain and a page inside it can share one href, and then both claimed to
   * be the page.
   *
   * Control opens on Agent Control's decision queue, so the domain row and the
   * `Needs a person` row beneath it point at the same URL. Both matched, both
   * were exact, and the rendered page carried two `aria-current="page"` links
   * in one nav — which is precisely the defect the ancestor rule was written to
   * remove, arriving from the other direction.
   *
   * The model already says which one yields: a domain is a place and the thing
   * inside it is the page. So when a non-domain row is the exact page, the
   * domain row steps back to `aria-current="true"` — the word ARIA has for the
   * current item of a set — and keeps its filled left edge. A domain that is
   * the only match, like Home, is unaffected and still reads as the page.
   */
  const pageIsInside = insidePageHref !== null && insidePageHref === pathname;

  /*
   * Which groups are shut. `null` until the browser has been read: the stored
   * set is unknowable on the server, and guessing it would render the rail one
   * way and then rearrange it under the reader's eyes.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  /* The rail is rebuilt every render, so it is read through a ref rather than
     depended on: an effect keyed on the array identity would re-run forever. */
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  /*
   * One effect, keyed on where the person is.
   *
   * It was two — one reading storage on mount, one opening the active group —
   * and the second could not see what the first had loaded: both ran on the
   * same commit, the open-active pass got the empty starting set, and its
   * dependencies never changed again. The visible defect was a reload landing
   * on Ideas with STRATEGIES still shut over it, which is exactly the state
   * this rule exists to prevent. Reading storage here instead makes the two
   * steps one, in order, on every arrival; a toggle writes storage as well as
   * state, so nothing is lost between navigations.
   */
  useEffect(() => {
    setCollapsed(openGroupOfActive(readCollapsedGroups(window.localStorage), groupsRef.current, activeHref));
  }, [activeHref]);
  const toggleGroup = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsedGroups(window.localStorage, next);
      return next;
    });
  };

  return (
    <nav
      id="workspace-navigation"
      ref={navRef}
      className="rs-nav"
      aria-label={label}
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      <div className="rs-nav-scroll">
        {actions ? <div className="rs-nav-actions">{actions}</div> : null}
        {groups.map((group) => {
          const shut = group.collapsible === true && collapsed.has(group.id);
          return (
          <div className="rs-group" key={group.id} data-group={group.id} data-collapsible={group.collapsible ? "true" : undefined}>
            {group.title && group.collapsible ? (
              /*
               * The heading is the control. A separate chevron button beside a
               * label is two targets for one intent, and on a phone the label
               * is the half a thumb lands on.
               */
              <button
                type="button"
                className="rs-group-title"
                data-shut={shut ? "true" : undefined}
                aria-expanded={!shut}
                aria-controls={`rs-group-${group.id}`}
                onClick={() => toggleGroup(group.id)}
              >
                <span>{group.title}</span>
                <CaretDown className="rs-group-caret" size={13} weight="bold" aria-hidden />
              </button>
            ) : group.title ? (
              <p className="rs-group-title">{group.title}</p>
            ) : null}
            <div className="rs-group-body" id={`rs-group-${group.id}`} hidden={shut}>
            {group.entries.map((entry) => (
              <NavLink
                key={entry.id}
                entry={entry}
                activeHref={activeHref}
                activeIsExact={activeIsExact}
                domain={group.id.startsWith("domains")}
                yieldsPage={pageIsInside}
                /* A row is a section header only when the group actually has
                   contents under it. Styling every non-`sub` row as a header
                   turned Ryntra Home's 13-entry flat rail and Agent Control's
                   17 into a wall of shouting labels — both hand-write their
                   groups and neither marks `sub`, so "not a child" was true of
                   every row in them. The group is the only thing that can tell
                   the difference, so it decides. */
                heads={!entry.sub && group.entries.some((sibling) => sibling.sub)}
              />
            ))}
            </div>
          </div>
          );
        })}
        {footer ? <div className="rs-nav-foot">{footer}</div> : null}
      </div>

      <div className="rs-nav-pinned">
        {/*
          * The product's own foot, in a container of its own.
          *
          * It had none: `viewExtras` was rendered bare, so the depth switch and
          * the language button were two loose elements at the rail's inline
          * edge with nothing deciding their width or the space between them.
          * That is what read as unfinished on 2026-09-08, and no
          * amount of styling `.sh-mode` could fix it, because `.rs-view` — the
          * class those rules hang off — only ever existed inside `ViewMenu`,
          * which the product does not render.
          */}
        {domainRoutes ? <div className="rs-view">{viewExtras}</div> : <ViewMenu modeInContext={modeInContext} extras={viewExtras} />}
        {settings ? (
          <NavLink entry={settings} activeHref={activeHref} activeIsExact={activeIsExact} />
        ) : null}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------- shell */

/**
 * Chrome copy the shell itself renders.
 *
 * A workspace that speaks a second language has to be able to name the skip
 * link and the navigation toggle in it. Defaults keep the cabinet, which is
 * English-only today, exactly as it was.
 */
export type ShellStrings = Readonly<{
  skip: string;
  /** The accessible name of the wordmark, which is a link home. */
  brandHome: string;
  navLabel: string;
  navOpen: string;
  navClose: string;
  navExpand: string;
  navCollapse: string;
}>;

/**
 * What the product hands the shell: its registry, the locale to name it in,
 * the one network and the release badge. Nothing about who is looking: the
 * product is one version, so its first paint is its only
 * paint.
 */
export type ProductChrome = Readonly<{
  routes: readonly PageRoute[];
  locale: ProductLocale;
  network: string;
  badge?: Readonly<{ label: string; title: string }>;
}>;

const DEFAULT_STRINGS: ShellStrings = {
  skip: "Skip to workspace",
  brandHome: "Ryntra — home",
  navLabel: "Workspace navigation",
  navOpen: "Open navigation",
  navClose: "Close navigation",
  navExpand: "Expand navigation",
  navCollapse: "Collapse navigation",
};

function ShellFrame({
  workspace,
  product,
  wallet,
  context,
  inspector,
  navFooter,
  viewExtras,
  navGroups,
  navGroupsFor,
  navSettings,
  navActions,
  actions,
  tools,
  search,
  modeInContext,
  account,
  scope,
  lang,
  dir,
  strings,
  children,
}: {
  workspace: Workspace;
  /** The six domains and the locale to name them in, when this is the product;
      `badge` is the release stage worn beside the brand (BETA). */
  product?: ProductChrome;
  /**
   * The connected wallet, shown beside the account and never merged with it.
   *
   * A Ryntra account and a Solana wallet are two
   * security principals. The account says who you are in the product; the
   * wallet says what you hold and what you can sign. Control asked a person to
   * `Connect wallet` while one was plainly connected, because one slot was
   * carrying both meanings — so there are two slots.
   */
  wallet?: ReactNode;
  context?: ReactNode;
  inspector?: ReactNode;
  navFooter?: ReactNode;
  viewExtras?: ReactNode;
  navGroups?: readonly NavGroup[];
  /** Action triggers pinned above the rail's destinations. */
  navActions?: ReactNode;
  /** Resolves navigation from the current layout mode, inside the state provider. */
  navGroupsFor?: (mode: WorkspaceMode) => readonly NavGroup[];
  /** The pinned bottom-left Settings destination. */
  navSettings?: NavEntry | null;
  actions?: Readonly<Record<string, ActionDefinition>>;
  tools?: ReactNode;
  search?: ReactNode;
  modeInContext?: boolean;
  account?: ReactNode;
  /**
   * A route-level environment label that overrides the workspace's.
   * `undefined` keeps the workspace default; `null` states that this route has
   * no environment at all, which Agent Control's verifier needs — it touches
   * no network, and a chip there would be decoration reading as a fact.
   */
  scope?: string | null;
  lang?: string;
  dir?: "ltr" | "rtl";
  strings?: ShellStrings;
  children: ReactNode;
}) {
  const { prefs, toggleNav, toggleInspector } = useShell();
  const [drawer, setDrawer] = useState(false);
  const [mobile, setMobile] = useState(false);
  /* The page's own path, so the phone's bar marks the same place at `/uk/app/markets` as at `/app/markets`. */
  const pathname = usePagePath();
  const navRef = useRef<HTMLElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setDrawer(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  /* A drawer that survives navigation hides the page the visitor just asked
     for. It closes on every route change, on Escape, and on the scrim. */
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawer) return;
    const navigation = navRef.current;
    const trigger = navToggleRef.current;
    const focusable = () =>
      navigation
        ? Array.from(
            navigation.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawer(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [drawer]);

  const inspectorOpen = Boolean(inspector) && prefs.inspectorOpen;
  const copy = strings ?? DEFAULT_STRINGS;
  /* The controls the shell renders out of its own body — the Context toggle
     here, the theme button and the Layout menu at the foot of the rail — read
     their words from `ShellCopyProvider` rather than from literals. See
     `shell-copy.tsx` for why that is a context and not four more props. */
  const chrome = useShellCopy();
  /* The product draws one menu for everyone — no depth, no stored preference
     and no cookie decides it — and it is the menu you can see: every
     section with its caption, nothing behind «Ще» on a desk, the same
     sections under «Ще» on a phone. The phone's bar is the five places,
     lit by `navigation`. */
  const navigation = product ? productNavigation(product.routes, product.locale) : null;
  const menu = product ? menuNavigation(product.routes, product.locale) : null;
  const workspaceGroups = navGroupsFor?.(prefs.mode) ?? navGroups ?? navigationFor(workspace.id);

  /*
   * The sections, then whatever this surface carries of its own.
   *
   * Each group keeps the `domains` id prefix so the rail's current-row rules
   * still recognise a product row as a *place* rather than a sub-surface — the
   * distinction that stops two rows carrying `aria-current="page"` at once.
   *
   * A caption is a label, not a control: every row is visible without
   * opening anything (everything is visible without «Ще»), so no
   * section collapses. No row carries a readiness tag: a `planned` page is not
   * projected at all, and the page states its own status.
   */
  const groups: readonly NavGroup[] = menu
    ? [
        ...menu.sections.map((section) => ({
          id: `domains-${section.id}`,
          title: section.title ?? undefined,
          entries: section.rows.map((row) => ({ id: row.id, label: row.label, caption: row.caption, href: row.href, icon: row.icon })),
        })),
        ...workspaceGroups,
      ]
    : workspaceGroups;
  const settingsEntry: NavEntry | null | undefined = menu
    ? { id: menu.settings.id, label: menu.settings.label, href: menu.settings.href, icon: menu.settings.icon }
    : navSettings;

  return (
    <ActionConsoleProvider actions={actions}>
      <div
        className="rs"
        data-product={product ? "true" : "false"}
        data-nav={prefs.navCollapsed ? "collapsed" : "expanded"}
        data-inspector={inspectorOpen ? "open" : "closed"}
        data-drawer={drawer ? "open" : "closed"}
        lang={lang}
        dir={dir}
        /* The shell holds identifiers, hashes and chain values, so machine
         translation is refused for the subtree; the language control below is
         the supported way to change words. */
        translate="no"
      >
        <a className="rs-skip" href="#workspace">
          {copy.skip}
        </a>

        <header className="rs-top">
          <button
            ref={navToggleRef}
            type="button"
            className="rs-navtoggle"
            onClick={() => {
              /* One control, two jobs, decided by what the viewport actually
               shows: below 900px there is no rail to collapse, only a drawer
               to open. */
              if (mobile) setDrawer((value) => !value);
              else toggleNav();
            }}
            aria-label={
              mobile
                ? drawer
                  ? copy.navClose
                  : copy.navOpen
                : prefs.navCollapsed
                  ? copy.navExpand
                  : copy.navCollapse
            }
            aria-expanded={mobile ? drawer : undefined}
            aria-controls={mobile ? "workspace-navigation" : undefined}
          >
            {/*
             * On a phone this is the only way to reach twenty-eight surfaces,
             * and it was an arrow pointing into the left wall — which reads as
             * *back*, not as *menu*. A hamburger and the word beside it say
             * what it opens. On a desktop the arrow is right: there the control
             * collapses a rail that is already visible, and its direction is
             * the whole message.
             */}
            {drawer ? (
              <X size={17} weight="bold" aria-hidden />
            ) : mobile ? (
              <List size={18} weight="bold" aria-hidden />
            ) : prefs.navCollapsed ? (
              <ArrowLineRight size={17} weight="bold" aria-hidden />
            ) : (
              <ArrowLineLeft size={17} weight="bold" aria-hidden />
            )}
            {mobile && !drawer ? (
              <span className="rs-navtoggle-label">{chrome.menu}</span>
            ) : null}
          </button>

          <Link href={product?.locale === "uk" ? "/uk" : "/"} className="rs-brand" aria-label={copy.brandHome}>
            <Wordmark size={26} />
            {/* The standalone R takes over on the phone, where the wordmark
                has no room beside the menu and the wallet (shell.css). */}
            <span className="rs-brand-mark"><RyntraMark size={24} /></span>
          </Link>

          {/* The release stage, worn beside the brand and nowhere else: a
              person reads BETA once, next to the name, on every page. */}
          {product?.badge ? (
            <span className="rs-beta" title={product.badge.title} aria-label={product.badge.title}>
              {product.badge.label}
            </span>
          ) : null}

          {/* The person is already inside Ryntra, so there is nothing to switch
              to. Every other surface keeps the control it has always had. */}
          {product ? null : <WorkspaceSwitcher current={workspace} />}

          {/* In the product the network never changes, because the product has
              one. What a *surface* is — a demo, a preview, a place that touches
              no chain — is a different fact and keeps its own chip beside it.
              Replacing one with the other would either hide an execution
              boundary or claim a network a surface does not reach; showing both
              does neither. The duplicate case is suppressed: the Solana
              workspace's own environment already reads `Solana Mainnet`. */}
          {product ? <span className="rs-env" data-network="true">{product.network}</span> : null}

          {product && (scope === undefined ? workspace.environment : scope) === product.network ? null : (
            <EnvironmentChip workspace={workspace} scope={scope} />
          )}

          {context ? <div className="rs-context">{context}</div> : null}

          {/* The product's search: a company, a coin or an
              action, from any page — a field on a desk, a glass on a phone. */}
          {search ? <div className="rs-search">{search}</div> : null}

          {/*
           * The right cluster, in the frozen order.
           *
           * A workspace contributes Search, Attention and Ask Ryntra through
           * `tools`; the shell contributes the context toggle; the connection
           * control is last, always, on every workspace. That last word is the
           * contract — `account` is rendered here rather than by the workspace
           * precisely so no workspace can move it.
           *
           * What used to also live here — the theme icon, the layout menu and the
           * focus toggle — is gone from the primary bar. Three controls that
           * configure how the application looks were sitting beside the control
           * that spends money, at the same size and weight, and the frozen UX
           * System names all three by name as things the top bar does not carry.
           * Appearance moved to Settings; density, panels and focus moved to the
           * View menu at the bottom of the rail, beside the layout they change.
           */}
          <div className="rs-tools">
            {tools}
            {inspector ? (
              <button
                type="button"
                className="rs-tool"
                data-on={inspectorOpen ? "true" : "false"}
                onClick={toggleInspector}
                aria-pressed={inspectorOpen}
              >
                {/* Not the ⓘ glyph. The same icon 200px away opens the page's
                    explanation, and two identical marks meaning two different
                    things on one screen is a defect a reader cannot resolve.
                    This one opens a panel, so it looks like a panel. */}
                <SidebarSimple size={16} weight="bold" aria-hidden />
                <span className="rs-tool-label">{chrome.contextToggle}</span>
              </button>
            ) : null}

            {wallet}
            {account}
          </div>
        </header>

        <PrimaryNavigation
          groups={groups}
          domainRoutes={menu?.routes}
          actions={navActions}
          label={copy.navLabel}
          footer={navFooter}
          viewExtras={viewExtras}
          settings={settingsEntry}
          modeInContext={modeInContext}
          navRef={navRef}
          hidden={mobile && !drawer}
        />

        {product && navigation ? (
          <ProductMobileNav
            entries={mobileNavigation(product.routes, product.locale)}
            activeHref={pageActiveHref(pathname, navigation.routes)}
            label={copy.navLabel}
            icons={ICONS}
            moreLabel={copy.navOpen}
            moreOpen={drawer}
            onMore={() => setDrawer((value) => !value)}
            onNavigate={() => setDrawer(false)}
          />
        ) : null}

        {drawer ? (
          <button
            type="button"
            className="rs-scrim"
            aria-label={copy.navClose}
            onClick={() => setDrawer(false)}
          />
        ) : null}

        <main className="rs-canvas" id="workspace" tabIndex={-1}>
          {children}
        </main>

        {inspectorOpen ? (
          <aside className="rs-inspector">{inspector}</aside>
        ) : null}

        {/* Inside `.rs`, because that is where `--rs-top` is declared. */}
        <ActionConsoleDrawer />
      </div>
    </ActionConsoleProvider>
  );
}

export function RyntraAppShell({
  workspaceId,
  product,
  wallet,
  context,
  inspector,
  navFooter,
  viewExtras,
  navGroups,
  navGroupsFor,
  navSettings,
  navActions,
  actions,
  tools,
  search,
  modeInContext,
  account,
  scope,
  lang,
  dir,
  strings,
  chrome,
  children,
}: {
  workspaceId: string;
  /**
   * Render as **the one Ryntra product** rather than as one workspace among
   * several.
   *
   * Passed as the six projected domains, which is deliberately not a boolean:
   * the shell cannot invent a rail, and a caller that has no domains cannot ask
   * for product chrome. `app/shell/domains.ts` is the only place their order,
   * their words and both locales are decided, and its projector refuses to emit
   * a domain with no destination.
   *
   * This is a **mode of the shared shell, not a fork of it.** Another hub, Stellar,
   * Robinhood and the cabinet mount this same component and keep the switcher
   * they have always had — deleting it outright would strip the cabinet of its
   * only way out, since its rail is `/app/*` and nothing else.
   */
  product?: ProductChrome;
  /**
   * The connected wallet, shown beside the account and never merged with it.
   *
   * A Ryntra account and a Solana wallet are two
   * security principals. The account says who you are in the product; the
   * wallet says what you hold and what you can sign. Control asked a person to
   * `Connect wallet` while one was plainly connected, because one slot was
   * carrying both meanings — so there are two slots.
   */
  wallet?: ReactNode;
  context?: ReactNode;
  inspector?: ReactNode;
  navFooter?: ReactNode;
  /** Extra chrome in the pinned rail row, beside theme and layout. Language lives here. */
  viewExtras?: ReactNode;
  /** Replaces the registry's navigation with already-resolved groups. */
  navGroups?: readonly NavGroup[];
  /** Resolves navigation from the current layout mode, inside the state provider. */
  navGroupsFor?: (mode: WorkspaceMode) => readonly NavGroup[];
  /**
   * The pinned bottom-left Settings destination, normally
   * `settingsEntry(manifest)`. A workspace with no settings of its own passes
   * nothing; it does not get to put Settings somewhere else.
   */
  navSettings?: NavEntry | null;
  /** Action triggers pinned above the rail's destinations. */
  navActions?: ReactNode;
  /**
   * The workspace's Action Console drawers, by id.
   *
   * An action is something you do from a surface, not a place in the rail. What
   * renders inside each one is the workspace's own console, unchanged — the
   * shell owns the container and never the lifecycle.
   */
  actions?: Readonly<Record<string, ActionDefinition>>;
  /** Replaces the default tool cluster. `account` still renders after it. */
  tools?: ReactNode;
  /** The product's search, drawn in the top bar before the tools. */
  search?: ReactNode;
  /**
   * The workspace renders its own depth control in `context`, so the View menu
   * drops its Mode group rather than offering a second, differently shaped
   * answer to the same preference. The cabinet passes nothing and keeps it.
   */
  modeInContext?: boolean;
  account?: ReactNode;
  /**
   * A route-level environment label that overrides the workspace's.
   * `undefined` keeps the workspace default; `null` states that this route has
   * no environment at all, which Agent Control's verifier needs — it touches
   * no network, and a chip there would be decoration reading as a fact.
   */
  scope?: string | null;
  lang?: string;
  dir?: "ltr" | "rtl";
  strings?: ShellStrings;
  /**
   * Copy for the chrome the shell renders out of its own body — the Context
   * toggle, the theme button and the Layout menu. Omitted, every one of them
   * keeps the English it has always had.
   */
  chrome?: ShellChromeCopy;
  children: ReactNode;
}) {
  const pathname = usePagePath();
  const declared = workspaceById(workspaceId);
  if (!declared) {
    throw new Error(
      `Unknown workspace: ${workspaceId}. List it in app/shell/workspaces.ts, or register it with registerWorkspace before the shell renders.`,
    );
  }

  /*
   * The route decides which workspace the chrome is in; the layout only says
   * which one to fall back to.
   *
   * The cabinet layout mounts this shell once for every `/app` route, so a
   * hardcoded id meant the top bar read the same workspace on the overview, the
   * terminal and the journal — the switcher's single job, answered wrong on two
   * pages out of three. Resolving from the path is what makes "Tokenized
   * Markets" appear on `/robinhood/workspace/terminal` and "Ryntra Home" on `/app/journal`
   * without either layout knowing about the other.
   */
  const workspace = workspaceForPath(pathname ?? "") ?? declared;

  /* One product, one preference scope. Without this the same person carries a
     Simple on Money and a Pro on Control, because the scope was keyed by the
     route's workspace and the product spans two of them. And one version:
     the product has no depth to choose. */
  return (
    <ShellStateProvider workspaceId={product ? "ryntra" : workspace.id} oneVersion={Boolean(product)}>
      <WidgetRegistryProvider>
        <ShellCopyProvider copy={chrome}>
          <ShellFrame
            workspace={workspace}
            product={product}
            wallet={wallet}
            context={context}
            inspector={inspector}
            navFooter={navFooter}
            viewExtras={viewExtras}
            navGroups={navGroups}
            navGroupsFor={navGroupsFor}
            navSettings={navSettings}
            navActions={navActions}
            actions={actions}
            tools={tools}
            search={search}
            modeInContext={modeInContext}
            account={account}
            scope={scope}
            lang={lang}
            dir={dir}
            strings={strings}
          >
            {children}
          </ShellFrame>
        </ShellCopyProvider>
      </WidgetRegistryProvider>
    </ShellStateProvider>
  );
}

/** A context chip for the top bar. Factual values only. */
export function ShellChip({
  label,
  value,
  mono = false,
  alert = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  alert?: boolean;
}) {
  return (
    <span className="rs-chip" data-alert={alert ? "true" : "false"}>
      <span className="rs-chip-k">{label}</span>
      <span className={mono ? "rs-chip-v mono" : "rs-chip-v"}>{value}</span>
    </span>
  );
}

/** The same chip as a control, for things the operator can act on. */
export function ShellChipButton({
  label,
  value,
  onClick,
  disabled = false,
  alert = false,
}: {
  label: string;
  value: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      className="rs-chip"
      data-alert={alert ? "true" : "false"}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="rs-chip-k">{label}</span>
      <span className="rs-chip-v">{value}</span>
    </button>
  );
}

/** An external link rendered in the shell's own language. */
export function ShellExternal({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="rs-tool" href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowSquareOut size={13} weight="bold" aria-hidden />
    </a>
  );
}
