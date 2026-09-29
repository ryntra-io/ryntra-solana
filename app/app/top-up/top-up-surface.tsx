"use client";

import { Bank, CaretDown, CheckCircle, Copy, CreditCard, QrCode } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { fundingNeed, fundsOf, fundsReady, solAmount, SUGGESTED_SOL_LAMPORTS, suggestedSolUsd, UNKNOWN_FUNDS, type Funds } from "@/app/app/invest/funding-model";
import { investWords, numberLocale, solEnoughLine } from "@/app/app/invest/invest-words";
import invest from "@/app/app/invest/invest.module.css";
import { useWalletReach } from "@/app/app/invest/use-wallet-reach";
import { useWalletData } from "@/app/app/wallet-data";
import { decodeWalletCollection, type WalletHolding } from "@/app/app/wallet-view-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import { useSpotMarket } from "@/app/solana/workspace/spot/use-spot-data";
import { readWalletHoldings } from "@/lib/solana/holdings.client";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";

import styles from "./top-up.module.css";

/**
 * «Поповнити» — the money a first purchase needs, and three ways to bring it
 * (canon v5.1 §4 «Почати з картки», В5, В12; `RYN-INVEST-SIMPLE-001`,
 * session 5). Drawn for 390 px first.
 *
 * **What is needed** is said once, in two lines the wallet itself answers:
 * USDC for purchases, from $1, and a little SOL for the network — each
 * with a check when it is there. **Three ways**, a row each: «Отримати USDC»
 * (the QR, the address, the network, «Копіювати адресу»), «Купити карткою у
 * своєму гаманці» (Phantom takes the card; the page never does) and
 * «Переказати з біржі» (the steps, the address, the network). When dollars
 * are there and only the network's SOL is missing, the same three rows are
 * worded for SOL.
 *
 * **Waiting is part of the page.** While something is missing the wallet is
 * read again every fifteen seconds, so money sent from an exchange shows up
 * here without a reload — and once both lines are checked, the one orange
 * action is to buy, or to go back to the purchase the person came from.
 *
 * Nothing here moves money: the page shows an address and says where to go.
 */

type Need = "usdc" | "sol";
type Way = "receive" | "card" | "exchange";

/** How often the page reads the wallet again while something is missing, and for how long at most. */
const POLL_MS = 15_000;
const POLL_LIMIT = 40;

export function TopUpSurface({ locale, need, from }: { locale: WorkspaceLocale; need: Need | null; from: string | null }) {
  const word = investWords(locale);
  const { connection } = useSolanaConnection();
  return (
    <div className={`${invest.page} ${styles.page}`}>
      <header className={styles.head}>
        <h1 className={invest.heroTitle}>{word("topUp")}</h1>
        <p className={invest.heroLine}>{word("topUpLede")}</p>
      </header>
      {connection ? <WalletTopUp key={connection.address} address={connection.address} locale={locale} need={need} from={from} /> : <GuestTopUp locale={locale} />}
    </div>
  );
}

/** A guest: the one empty state of «Простий» without a wallet, and the way to one. */
function GuestTopUp({ locale }: { locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const { openInWallet, reach } = useWalletReach();
  return (
    <section className={`${invest.hero} ${styles.guest}`} data-empty="guest">
      <p className={styles.emptyTitle}>{word("connectToBuy")}</p>
      <div className={invest.actions}>
        <button type="button" className="rw-btn rw-btn--primary" onClick={reach}>
          {openInWallet ? word("openInPhantom") : word("connectWallet")}
        </button>
      </div>
    </section>
  );
}

function WalletTopUp({ address, locale, need, from }: { address: string; locale: WorkspaceLocale; need: Need | null; from: string | null }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const { holdings, refresh } = useWalletData();
  const [polled, setPolled] = useState<Funds | null>(null);
  const shared = useMemo(() => (holdings.status === "ready" ? fundsOf(holdings.data, holdings.complete) : null), [holdings]);
  /* The page's own later read wins over the shared one it started from: it is the newer of the two. */
  const funds = polled ?? shared ?? UNKNOWN_FUNDS;
  const state = fundingNeed(funds);
  const ready = fundsReady(funds);
  const mode: Need = state === "unknown" ? (need ?? "usdc") : state === "sol" ? "sol" : "usdc";

  /* SOL's price for «≈ $2»: the wallet's read carries it; the venue's own read, the one Spot shows, when it does not. */
  const solMarket = useSpotMarket(funds.solUsd === null ? WRAPPED_SOL_MINT : null);
  const solUsd = funds.solUsd ?? solMarket.value?.price ?? null;

  const lastSeen = useRef<Funds | null>(null);
  useEffect(() => {
    /* Waiting for money: the wallet is read again while something is missing, only while the page is in view, and never forever. */
    if (state === "ready") return undefined;
    let live = true;
    let count = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || count >= POLL_LIMIT) return;
      count += 1;
      void readWalletHoldings<unknown>(address).then((read) => {
        if (!live || !read.ok || read.tokenRead !== "COMPLETE") return;
        let next: Funds;
        try {
          const parsed = decodeWalletCollection(true, { data: { holdings: read.rows, tokenRead: read.tokenRead } }, "holdings");
          next = fundsOf(parsed.data as readonly WalletHolding[], parsed.complete);
        } catch {
          return;
        }
        const before = lastSeen.current;
        lastSeen.current = next;
        setPolled(next);
        /* Money arrived: the rest of the cabinet reads the wallet again too, so Home and the purchase see it. */
        if (before && ((next.usdc ?? 0) > (before.usdc ?? 0) || (next.solLamports ?? 0n) > (before.solLamports ?? 0n))) refresh();
      });
    }, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [address, state, refresh]);

  useEffect(() => {
    if (lastSeen.current === null && state !== "unknown") lastSeen.current = funds;
  }, [funds, state]);

  const [open, setOpen] = useState<Way | null>(null);
  const toggle = useCallback((way: Way) => setOpen((current) => (current === way ? null : way)), []);
  const suggested = solAmount(SUGGESTED_SOL_LAMPORTS, numbers);

  /* Money arrived while the person was down in a way's steps: the page brings them back to what changed — the next need, or «Готово». */
  const status = useRef<HTMLElement>(null);
  const shown = useRef(state);
  useEffect(() => {
    const before = shown.current;
    shown.current = state;
    if (before === "unknown" || before === state || state === "unknown") return;
    setOpen(null);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    status.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [state]);

  return (
    <>
      <section ref={status} className={`${invest.hero} ${styles.status}`} aria-labelledby="top-up-wallet" data-need={state}>
        <h2 id="top-up-wallet" className={styles.statusTitle}>{word("inYourWallet")}</h2>
        <FundLine
          icon="/site/universe/USDC.png"
          name="USDC"
          role={word("forPurchases")}
          value={funds.usdc === null ? null : formatUsdMoney(funds.usdc, numbers)}
          ok={ready.usdc}
          missing={word("neededFrom")}
        />
        <FundLine
          icon="/site/universe/SOL.png"
          name="SOL"
          role={word("forNetwork")}
          value={funds.solLamports === null ? null : `${solAmount(funds.solLamports, numbers)} SOL`}
          ok={ready.sol}
          missing={`${word("neededAbout")}${suggested}`}
        />
        {state === "ready" ? (
          <div className={styles.ready}>
            <p className={styles.readyLine}>
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              {word("readyToBuy")}
            </p>
            <Link className="rw-btn rw-btn--primary" href={from ?? "/app/markets"}>
              {from ? word("continueBuying") : word("buy")}
            </Link>
          </div>
        ) : state === "sol" ? (
          <p className={styles.needLine}>
            <b>{word("needSol")}</b> {solEnoughLine(locale, suggested, suggestedSolUsd(solUsd))}
          </p>
        ) : state === "usdc" ? (
          <p className={styles.waiting} aria-live="polite">{word("waitingMoney")}</p>
        ) : (
          <span className={styles.lineBone} aria-hidden="true" />
        )}
      </section>

      <section className={styles.ways} aria-labelledby="top-up-ways">
        <h2 id="top-up-ways" className={invest.sectionTitle}>{word("waysTitle")}</h2>
        <WayRow way="receive" open={open === "receive"} onToggle={toggle} icon={<QrCode size={22} weight="bold" aria-hidden="true" />} title={word(mode === "sol" ? "receiveSol" : "receiveUsdc")} sub={word("receiveSub")}>
          <AddressBlock address={address} locale={locale} withQr primary={state !== "ready"} note={word(mode === "sol" ? "solanaOnly" : "solanaOnlyUsdc")} />
        </WayRow>
        <WayRow way="card" open={open === "card"} onToggle={toggle} icon={<CreditCard size={22} weight="bold" aria-hidden="true" />} title={word(mode === "sol" ? "cardSol" : "cardUsdc")} sub={word(mode === "sol" ? "cardSolSub" : "cardUsdcSub")}>
          <ol className={styles.steps}>
            <li>{word("openPhantom")}</li>
            {mode === "sol" ? (
              <>
                <li>{word("solSwap")}</li>
                <li>{word("solCard")}</li>
              </>
            ) : (
              <>
                <li>{word("cardPay")}</li>
                <li>{word("cardBuy")}</li>
              </>
            )}
          </ol>
          <p className={styles.fine}>{word("cardFine")}</p>
        </WayRow>
        <WayRow way="exchange" open={open === "exchange"} onToggle={toggle} icon={<Bank size={22} weight="bold" aria-hidden="true" />} title={word(mode === "sol" ? "exchangeSol" : "exchangeUsdc")} sub={word(mode === "sol" ? "exchangeSolSub" : "exchangeUsdcSub")}>
          <p className={styles.stepLine}>{word(mode === "sol" ? "exchangeStepsSol" : "exchangeStepsUsdc")}</p>
          <AddressBlock address={address} locale={locale} primary={state !== "ready"} note={mode === "usdc" && ready.sol === false ? word("exchangeAddSol") : null} />
        </WayRow>
      </section>
    </>
  );
}

/** One of the two things a purchase needs: what it is for, what the wallet holds, and whether that is enough. */
function FundLine({ icon, name, role, value, ok, missing }: { icon: string; name: string; role: string; value: string | null; ok: boolean | null; missing: string }) {
  return (
    <div className={styles.line} data-ok={ok === null ? undefined : ok ? "true" : "false"}>
      {/* The two coins' own marks, served from this site — never a picture waiting on a third host. */}
      <Image className={styles.lineIcon} src={icon} alt="" width={32} height={32} />
      <span className={styles.lineText}>
        <span className={styles.lineName}>{name}</span>
        <span className={styles.lineRole}>{role}</span>
      </span>
      <span className={styles.lineFigures}>
        {value === null ? <span className={styles.valueBone} aria-hidden="true" /> : <span className={styles.lineValue} translate="no">{value}</span>}
        {ok === true ? <CheckCircle className={styles.lineCheck} size={20} weight="fill" aria-label="✓" /> : ok === false ? <span className={styles.lineMissing}>{missing}</span> : null}
      </span>
    </div>
  );
}

/** A way to top up: one row — its picture, what it is, where it happens — and, pressed, what to do. */
function WayRow({ way, open, onToggle, icon, title, sub, children }: { way: Way; open: boolean; onToggle: (way: Way) => void; icon: ReactNode; title: string; sub: string; children: ReactNode }) {
  const bodyId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    /* Rows start closed, so an open one was just pressed: its steps come into view — on a phone the row sits under the wallet's two lines. */
    if (!open) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [open]);
  return (
    <div ref={box} className={styles.way} data-way={way} data-open={open ? "true" : undefined}>
      <button type="button" className={styles.wayHead} aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => onToggle(way)}>
        <span className={styles.wayIcon}>{icon}</span>
        <span className={styles.wayText}>
          <span className={styles.wayTitle}>{title}</span>
          <span className={styles.waySub}>{sub}</span>
        </span>
        <CaretDown className={styles.caret} size={16} weight="bold" aria-hidden="true" />
      </button>
      {open ? (
        <div id={bodyId} className={styles.wayBody}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The wallet's address as a sender needs it: the network named, the address
 * whole, one button to copy it, and — for another wallet — a QR code of the
 * bare address, which every wallet and exchange scanner reads (a `solana:`
 * link is refused by some, among them Phantom's).
 */
function AddressBlock({ address, locale, withQr = false, primary, note }: { address: string; locale: WorkspaceLocale; withQr?: boolean; primary: boolean; note: string | null }) {
  const word = investWords(locale);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!withQr) return undefined;
    let live = true;
    void QRCode.toDataURL(address, { errorCorrectionLevel: "M", margin: 1, width: 440 })
      .then((data) => {
        if (live) setQr(data);
      })
      .catch(() => {
        if (live) setQr(null);
      });
    return () => {
      live = false;
    };
  }, [address, withQr]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* The clipboard can be refused; the address is on screen in full either way. */
    }
  };

  return (
    <div className={styles.address} data-qr={withQr ? "true" : undefined}>
      {withQr ? (
        <div className={styles.qrWrap}>
          {qr ? (
            /* A data URI this component just drew; there is no remote file for next/image. */
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.qr} src={qr} alt={word("scanToSend")} width={220} height={220} />
          ) : (
            <span className={styles.qrBone} aria-hidden="true" />
          )}
        </div>
      ) : null}
      <div className={styles.addressFacts}>
        <span className={styles.addressLabel}>{word("yourAddress")}</span>
        <p className={styles.addressValue} translate="no">
          {address}
        </p>
        <span className={styles.chip}>
          {word("networkWord")} · <b translate="no">Solana</b>
        </span>
      </div>
      <button type="button" className={primary ? "rw-btn rw-btn--primary" : "rw-btn"} onClick={() => void copy()}>
        <Copy size={16} weight="bold" aria-hidden="true" />
        {copied ? word("copied") : word("copyAddress")}
      </button>
      {note ? <p className={styles.fine}>{note}</p> : null}
    </div>
  );
}
