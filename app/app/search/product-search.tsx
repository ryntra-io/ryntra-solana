"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  ArrowLineDown,
  ArrowLineRight,
  ArrowsLeftRight,
  BellRinging,
  ChartLine,
  ChartPieSlice,
  ClockCounterClockwise,
  Compass,
  Drop,
  Funnel,
  GearSix,
  GitBranch,
  Gift,
  House,
  MagnifyingGlass,
  Path,
  PlusCircle,
  Repeat,
  Robot,
  RocketLaunch,
  Wallet,
  SlidersHorizontal,
  Sparkle,
  Target,
  TrendUp,
  UserCircle,
  X,
} from "@phosphor-icons/react";

import { numberLocale } from "@/app/app/invest/invest-words";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { PRODUCT_ROUTES } from "@/app/shell/product-routes";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatPercent, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { CUSTOMIZE_HREF, searchActions, searchProduct, type SearchIndex } from "@/lib/search/product-search";

import { openCustomize } from "../customize-open";
import styles from "./product-search.module.css";
import { readSearchIndex } from "./search-index";

/**
 * The product's search, in the top bar of every page: a company, a coin or
 * an action — one field on a desk, the glass on a phone, ⌘K / Ctrl+K
 * anywhere.
 *
 * It navigates and only navigates. A company opens its page, a coin opens
 * Spot, a pasted contract address opens its token's page, an action opens
 * the place of the menu it is; nothing here buys, signs or moves anything. The index is the one Markets draws, read once a visit
 * from `/api/search` the first time the search opens, so a first keystroke
 * already finds the actions while the lists arrive.
 */

const WORDS = {
  open: { en: "Search: name, ticker, address or action", uk: "Пошук: назва, тікер, адреса чи дія" },
  short: { en: "Search", uk: "Пошук" },
  placeholder: { en: "Name, ticker, contract address or action", uk: "Назва, тікер, адреса контракту чи дія" },
  token: { en: "Token", uk: "Токен" },
  byAddress: { en: "Open the token at this address", uk: "Відкрити токен за цією адресою" },
  close: { en: "Close", uk: "Закрити" },
  actions: { en: "Actions", uk: "Дії" },
  companies: { en: "Companies", uk: "Компанії" },
  privateCompanies: { en: "Private companies", uk: "Приватні компанії" },
  coins: { en: "Crypto and dollars", uk: "Крипта й долари" },
  suggested: { en: "Where to go", uk: "Куди перейти" },
  reading: { en: "Reading the markets…", uk: "Читаємо ринки…" },
  nothing: { en: "Nothing found.", uk: "Нічого не знайдено." },
  notAShare: { en: "Not a share", uk: "Це не акція" },
  meme: { en: "Meme", uk: "Мем" },
} as const;

type Word = keyof typeof WORDS;

const ACTION_ICONS: Readonly<Record<string, ReactNode>> = {
  home: <House size={18} weight="bold" />,
  explore: <Compass size={18} weight="bold" />,
  pools: <Drop size={18} weight="bold" />,
  trade: <ArrowsLeftRight size={18} weight="bold" />,
  launch: <RocketLaunch size={18} weight="bold" />,
  "launch-plus": <PlusCircle size={18} weight="bold" />,
  bots: <Robot size={18} weight="bold" />,
  money: <Wallet size={18} weight="bold" />,
  autoinvest: <Repeat size={18} weight="bold" />,
  swap: <ArrowsLeftRight size={18} weight="bold" />,
  spot: <ChartLine size={18} weight="bold" />,
  screener: <Funnel size={18} weight="bold" />,
  trends: <TrendUp size={18} weight="bold" />,
  "top-up": <PlusCircle size={18} weight="bold" />,
  send: <ArrowLineRight size={18} weight="bold" />,
  receive: <ArrowLineDown size={18} weight="bold" />,
  bridge: <Path size={18} weight="bold" />,
  portfolio: <ChartPieSlice size={18} weight="bold" />,
  strategies: <GitBranch size={18} weight="bold" />,
  results: <Target size={18} weight="bold" />,
  history: <ClockCounterClockwise size={18} weight="bold" />,
  ryntra: <Sparkle size={18} weight="bold" />,
  rewards: <Gift size={18} weight="bold" />,
  settings: <GearSix size={18} weight="bold" />,
  customize: <SlidersHorizontal size={18} weight="bold" />,
  account: <UserCircle size={18} weight="bold" />,
  alerts: <BellRinging size={18} weight="bold" />,
};

type Result = Readonly<{ key: string; href: string; node: ReactNode }>;

/** Opens the search from outside: the core's header has its own search button and Ctrl K. */
export type ProductSearchHandle = Readonly<{ show: () => void }>;

/**
 * Given a `handle`, the search is the dialog alone: the frame that holds the handle draws the button and owns the
 * shortcut (the core's header since B1), so this component neither draws its own field nor listens for ⌘K.
 */
export function ProductSearch({ locale, handle }: { locale: WorkspaceLocale; handle?: Ref<ProductSearchHandle> }) {
  const router = useRouter();
  const lang = locale === "uk" ? "uk" : "en";
  const word = useCallback((key: Word) => WORDS[key][lang], [lang]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [reading, setReading] = useState(false);
  /* The shortcut as this keyboard writes it — read after mount, the server does not know the machine. */
  const [shortcut, setShortcut] = useState("Ctrl K");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(window.navigator.platform || window.navigator.userAgent)) setShortcut("⌘K");
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const listId = useId();

  const actions = useMemo(() => searchActions(PRODUCT_ROUTES, lang), [lang]);
  const results = useMemo(() => searchProduct(index, actions, query), [actions, index, query]);

  const show = useCallback(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore && document.contains(restore)) restore.focus();
  }, []);

  useImperativeHandle(handle, () => ({ show }), [show]);
  const headless = handle !== undefined;

  /* ⌘K / Ctrl+K, the standard way to a search on both platforms — unless the frame holding the handle owns it. */
  useEffect(() => {
    if (headless) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) hide();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [headless, hide, open, show]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    if (!index) {
      setReading(true);
      void readSearchIndex().then((read) => {
        setIndex(read);
        setReading(false);
      });
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
    };
  }, [index, open]);

  const numbers = numberLocale(locale);
  const rank = (group: string) => (group === "address" ? -1 : results.order.indexOf(group === "private" ? "privateCompanies" : (group as (typeof results.order)[number])));
  const searching = query.trim().length > 0;

  /* The rows in the order they are drawn, so the arrows walk what the eye sees: a pasted address first, then the groups in
     the order of their best match (`results.order`), so Enter opens the best answer — «SOL» opens Solana (UX-002). */
  const groups: readonly Readonly<{ id: string; title: string; rows: readonly Result[] }>[] = [
    {
      /* A pasted contract address is a token: its page finds whether it is a company's, a launch's or a coin's. */
      id: "address",
      title: word("token"),
      rows: results.address
        ? [
            {
              key: `t:${results.address}`,
              href: `/app/token/${results.address}`,
              node: (
                <>
                  <span className={styles.glyph} aria-hidden="true"><MagnifyingGlass size={18} weight="bold" /></span>
                  <span className={styles.name}>
                    <span className={styles.title}>{word("byAddress")}</span>
                    <span className={styles.hint} translate="no">{`${results.address.slice(0, 6)}…${results.address.slice(-6)}`}</span>
                  </span>
                </>
              ),
            },
          ]
        : [],
    },
    {
      id: "actions",
      title: searching ? word("actions") : word("suggested"),
      rows: results.actions.map((action) => ({
        key: `a:${action.id}`,
        href: action.href,
        node: (
          <>
            <span className={styles.glyph} aria-hidden="true">{ACTION_ICONS[action.icon] ?? <MagnifyingGlass size={18} weight="bold" />}</span>
            <span className={styles.name}>
              <span className={styles.title}>{action.label}</span>
              {action.hint ? <span className={styles.hint}>{action.hint}</span> : null}
            </span>
          </>
        ),
      })),
    },
    {
      id: "companies",
      title: word("companies"),
      rows: results.companies.map((card) => ({
        key: `c:${card.mint}`,
        href: `/app/stocks/${encodeURIComponent(card.ticker)}`,
        node: (
          <>
            <MarketIcon mint={card.mint} icon={card.icon} symbol={card.name} size={32} className={styles.logo} />
            <span className={styles.name}>
              <span className={styles.title}>{card.name}</span>
            </span>
            <Figures price={card.price} change={card.change24h} locale={numbers} />
          </>
        ),
      })),
    },
    {
      id: "private",
      title: word("privateCompanies"),
      rows: results.privateCompanies.map((card) => ({
        key: `p:${card.mint}`,
        href: `/app/stocks/${encodeURIComponent(card.ticker)}`,
        node: (
          <>
            <MarketIcon mint={card.mint} icon={card.icon} symbol={card.name} size={32} className={styles.logo} />
            <span className={styles.name}>
              <span className={styles.title}>{card.name}</span>
              <span className={styles.note}>{word("notAShare")}</span>
            </span>
            <Figures price={card.price} change={card.change24h} locale={numbers} />
          </>
        ),
      })),
    },
    {
      id: "coins",
      title: word("coins"),
      rows: results.coins.map((coin) => ({
        key: `k:${coin.mint}`,
        href: `/app/spot?mint=${encodeURIComponent(coin.mint)}`,
        node: (
          <>
            <MarketIcon mint={coin.mint} icon={coin.icon} symbol={coin.name} size={32} className={styles.logo} plain />
            <span className={styles.name}>
              <span className={styles.title}>{coin.name}</span>
              <span className={styles.hint} translate="no">
                {coin.symbol}
                {coin.kind === "meme" ? <span className={styles.tag}>{word("meme")}</span> : null}
              </span>
            </span>
            <Figures price={coin.price} change={coin.change24h} locale={numbers} />
          </>
        ),
      })),
    },
  ]
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => rank(a.id) - rank(b.id));

  const flat = groups.flatMap((group) => group.rows);
  const nothing = searching && flat.length === 0 && !reading;

  /* The first row again when the query changes — and when the index arrives, since the groups may reorder under it. */
  useEffect(() => {
    setActive(0);
  }, [query, index]);

  const go = (row: Result | undefined) => {
    if (!row) return;
    setOpen(false);
    setQuery("");
    setActive(0);
    restoreRef.current = null;
    /* «Налаштування» is the menu's own panel, not a page: opened where it lives (UX-013). */
    if (row.href === CUSTOMIZE_HREF) {
      openCustomize();
      return;
    }
    /* An address outside this app opens there, not through this app's router; so does Прогнози,
       whose pages need their own content policy (the venues' images and live feed), which only a full load brings. */
    if (/^https?:\/\//.test(row.href) || /^\/app\/predictions(\/|$)/.test(row.href)) window.location.assign(row.href);
    else router.push(row.href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (flat.length === 0 ? 0 : (value + 1) % flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (flat.length === 0 ? 0 : (value - 1 + flat.length) % flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(flat[active]);
    }
  };

  let position = -1;
  const dialog = open ? (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) hide(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-product-search>
        <h2 id={titleId} className={styles.srOnly}>{word("short")}</h2>
        <div className={styles.field}>
          <MagnifyingGlass className={styles.fieldIcon} size={20} weight="bold" aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={word("placeholder")}
            aria-label={word("placeholder")}
            aria-controls={listId}
            aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button type="button" className={styles.close} onClick={hide} aria-label={word("close")}>
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className={styles.results} id={listId} role="listbox" aria-label={word("short")}>
          {groups.map((group) => (
            <section key={group.id} className={styles.group} aria-label={group.title}>
              <p className={styles.groupTitle}>{group.title}</p>
              {group.rows.map((row) => {
                position += 1;
                const at = position;
                return (
                  <Link
                    key={row.key}
                    id={`${listId}-${at}`}
                    role="option"
                    aria-selected={at === active}
                    className={styles.row}
                    data-active={at === active ? "true" : undefined}
                    href={row.href}
                    prefetch={false}
                    onClick={(event) => {
                      event.preventDefault();
                      go(row);
                    }}
                    onMouseMove={() => setActive(at)}
                  >
                    {row.node}
                  </Link>
                );
              })}
            </section>
          ))}
          {searching && reading ? <p className={styles.status} aria-busy="true">{word("reading")}</p> : null}
          {nothing ? <p className={styles.status} role="status">{word("nothing")}</p> : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {headless ? null : (
        <button type="button" className="rs-searchbtn" onClick={show} aria-haspopup="dialog" aria-expanded={open} aria-label={word("open")}>
          <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
          <span className="rs-searchbtn-text">{word("open")}</span>
          <kbd className="rs-searchbtn-key" aria-hidden="true">{shortcut}</kbd>
        </button>
      )}
      {typeof document !== "undefined" && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}

function Figures({ price, change, locale }: { price: number; change: number | null; locale: string }) {
  return (
    <span className={styles.figures}>
      <span className={styles.price}>{formatUsdPrice(price, locale)}</span>
      <span className={styles.change} data-tone={change === null ? "flat" : toneOf(change)}>
        {change === null ? "—" : formatPercent(change, locale)}
      </span>
    </span>
  );
}
