import { Check } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { PublicLocale } from "@/lib/site/locale";
import { BUY, TRADE } from "./workflow-trade";
import styles from "./workflow.module.css";

/**
 * The six product cards inside the third block's frame — one illustrative
 * purchase of NVDAx for $1, from the company to the rule that repeats it
 * (the original design, the new road).
 *
 * They are drawn in HTML on the block's frame, not screenshots, so one
 * story's figures sit in one file (workflow-trade.ts) and render crisp at
 * every width and in both languages: the frame sets `--u` to one canvas pixel
 * on the desktop and to `1px` where the cards stand full-width. The words are
 * the app's own — the Review's four lines are «Спишеться · Отримаєш · Усі
 * витрати · Що це» because that is what the purchase sheet says — and the
 * frame is `aria-hidden`: the copy beside it carries the meaning and a note
 * says the figures are examples.
 *
 * Nothing here is a button that does anything, a quote that is live, or a
 * signal the product does not show. The one motion is the signature's
 * status, which lights *Signature → Sent → Confirmed* once when the step is
 * reached.
 */

type Tone = "ok" | "attention" | "neutral" | "brand" | "up";
type Words = Readonly<Record<string, string>>;

const WORDS: Readonly<Record<PublicLocale, Words>> = {
  en: {
    markets: "Markets", companies: "Companies", tracker: "Backed tracker", from: "From", stays: "stays in your wallet",
    buy: "Buy", share: "of a share", costs: "all costs", lossLimit: "Loss limit", none: "None",
    review: "Review", pay: "You pay", get: "You get", allCosts: "All costs", what: "What it is", whatValue: "Backed tracker · xStocks",
    fee: "incl. Ryntra fee", network: "network", sign: "Sign in your wallet",
    wallet: "Your wallet", request: "Signature request", site: "ryntra.io", approve: "Approve",
    signature: "Signature", sent: "Sent", confirmed: "Confirmed",
    receipt: "Receipt", own: "You own a piece of", paid: "Paid", got: "Got", chain: "Read from Solana", history: "In History",
    rule: "Autoinvest", daily: "Every day", at: "at", condition: "Price condition", budget: "Monthly budget",
    remind: "Time for your purchase", buyByRule: "Buy by the rule", signed: "you sign",
    closed: "Exchange closed", solana: "Solana", active: "Active", price: "price may drift",
  },
  uk: {
    markets: "Ринки", companies: "Компанії", tracker: "Трекер із забезпеченням", from: "Від", stays: "лишається в гаманці",
    buy: "Купити", share: "акції", costs: "усі витрати", lossLimit: "Межа збитку", none: "Немає",
    review: "Перевірка", pay: "Спишеться", get: "Отримаєш", allCosts: "Усі витрати", what: "Що це", whatValue: "Трекер із забезпеченням · xStocks",
    fee: "з комісією Ryntra", network: "мережа", sign: "Підписати в гаманці",
    wallet: "Твій гаманець", request: "Запит на підпис", site: "ryntra.io", approve: "Підтвердити",
    signature: "Підпис", sent: "Надіслано", confirmed: "Підтверджено",
    receipt: "Квитанція", own: "У тебе є частинка", paid: "Сплачено", got: "Отримано", chain: "Прочитано з Solana", history: "В Історії",
    rule: "Автоінвест", daily: "Щодня", at: "о", condition: "Умова ціни", budget: "Бюджет місяця",
    remind: "Час твоєї покупки", buyByRule: "Купити за правилом", signed: "підписуєш ти",
    closed: "Біржа зачинена", solana: "Solana", active: "Працює", price: "ціна може відхилятися",
  },
};

function Row({ label, value, tone = "neutral", check, note }: { label: string; value: string; tone?: Tone; check?: boolean; note?: string }) {
  return (
    <div className={styles.row} data-tone={tone}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>
        {value}
        {note ? <span className={styles.rowNote}>{note}</span> : null}
        {check ? <Check size={12} weight="bold" className={styles.rowCheck} /> : null}
      </span>
    </div>
  );
}

function Session({ open, label, state }: { open: boolean; label: string; state: string }) {
  return (
    <span className={styles.session} data-open={open || undefined}>
      <span className={styles.sessionDot} />
      {label} <b>{state}</b>
    </span>
  );
}

function Token({ small }: { small?: boolean }) {
  return (
    <span className={styles.listToken} data-small={small ? "" : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the token's own metadata image, served from this site */}
      <img src={`/site/universe/${TRADE.icon}`} alt="" width={32} height={32} loading="lazy" decoding="async" />
    </span>
  );
}

/* 01 — the company in Markets: its price, its label, the purchase from $1. */
function CompanyCard({ w }: { w: Words }) {
  return (
    <div className={styles.card} data-card="company">
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{w.markets} · {w.companies}</span>
        <span className={styles.cardMeta}>{w.solana} · 24/7</span>
      </div>
      <ul className={styles.list}>
        <li className={styles.listRow} data-selected="">
          <Token />
          <span className={styles.listBody}>
            <span className={styles.listSymbol}>NVIDIA</span>
            <span className={styles.listName}>NVDAx · {w.tracker}</span>
          </span>
          <span className={styles.listPrice}>
            <b>{BUY.price}</b>
            <span className={styles.listChange} data-up="">{BUY.change}</span>
          </span>
        </li>
        {BUY.others.map((row) => (
          <li key={row.symbol} className={styles.listRow}>
            <span className={styles.listToken} data-small="">
              {/* eslint-disable-next-line @next/next/no-img-element -- the token's own metadata image, served from this site */}
              <img src={`/site/universe/${row.icon}`} alt="" width={26} height={26} loading="lazy" decoding="async" />
            </span>
            <span className={styles.listSymbol}>{row.name}</span>
            <span className={styles.listName}>{row.symbol}</span>
            <span className={styles.listChange} data-up={row.change.startsWith("+") || undefined}>{row.change}</span>
          </li>
        ))}
      </ul>
      <div className={styles.stats}>
        <Session open={false} label={w.closed} state={w.price} />
        <Session open label={w.solana} state={w.active} />
      </div>
    </div>
  );
}

/* 02 — the purchase sheet on $1: the share of a share it buys and every cost. */
function SumCard({ w }: { w: Words }) {
  return (
    <div className={styles.card} data-card="sum">
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{w.buy} NVIDIA</span>
        <span className={styles.cardMeta}>{w.from} {BUY.sum} · {w.stays}</span>
      </div>
      <div className={styles.amountBig}>
        <span className={styles.amountSign}>$</span>{BUY.whole}
      </div>
      <p className={styles.amountNote}>≈ {BUY.units} {w.share} · {w.costs} {BUY.costs}</p>
      <div className={styles.row} data-tone="neutral">
        <span className={styles.rowLabel}>{w.lossLimit}</span>
        <span className={styles.chips}>
          <span data-on="">{w.none}</span>
          {BUY.lossLimits.map((limit) => <span key={limit}>{limit}</span>)}
        </span>
      </div>
      <span className={styles.primaryButton}>{w.review}</span>
    </div>
  );
}

/* 03 — the Review: the four lines, the fee inside «Усі витрати», then the signature. */
function ReviewCard({ w }: { w: Words }) {
  return (
    <div className={styles.card} data-card="review">
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{w.review}</span>
        <span className={styles.cardMeta}>NVIDIA · {BUY.sum}</span>
      </div>
      <div className={styles.rows}>
        <Row label={w.pay} value={BUY.pay} />
        <Row label={w.get} value={`≈ ${BUY.units} NVDAx`} tone="brand" />
        <Row label={w.allCosts} value={BUY.costs} note={`${w.fee} · ${w.network}`} tone="ok" check />
        <Row label={w.what} value={w.whatValue} />
      </div>
      <span className={styles.primaryButton}>{w.sign}</span>
    </div>
  );
}

/* 04 — the person's own wallet asks, the person approves; the status lights once. */
function SignCard({ w }: { w: Words }) {
  return (
    <div className={styles.card} data-card="sign">
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{w.wallet}</span>
        <span className={styles.cardMeta}>{w.request}</span>
      </div>
      <div className={styles.pair}>
        <span className={styles.pairCell}>
          <small>{w.site}</small>
          <b>{BUY.paid}</b>
        </span>
        <span className={styles.pairCell} data-tone="brand">
          <small>NVDAx</small>
          <b>≈ {BUY.units}</b>
        </span>
      </div>
      <span className={styles.ghostButton}>{w.approve}</span>
      <ol className={styles.status}>
        {[w.signature, w.sent, w.confirmed].map((state, index) => (
          <li key={state} className={styles.statusRow} style={{ "--k": index } as CSSProperties}>
            <span className={styles.statusDot} />
            {state}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* 05 — the receipt: what was paid and what arrived, read from the chain. */
function ReceiptCard({ w }: { w: Words }) {
  return (
    <div className={styles.card} data-card="receipt">
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{w.receipt}</span>
        <span className={styles.cardMeta}>{w.history}</span>
      </div>
      <p className={styles.receiptLine}>
        <Token small />
        {w.own} <b>NVIDIA</b>
      </p>
      <div className={styles.rows}>
        <Row label={w.paid} value={BUY.pay} />
        <Row label={w.got} value={`${BUY.units} NVDAx`} tone="up" />
        <Row label={w.allCosts} value={BUY.costs} />
      </div>
      <div className={styles.memory}>
        <Check size={14} weight="bold" />
        {w.chain}
        <span className={styles.memoryNote}>{BUY.time}</span>
      </div>
    </div>
  );
}

/* 06 — the rule that repeats it, and its reminder: the person still signs. */
function AutoinvestCard({ w }: { w: Words }) {
  return (
    <div className={styles.card} data-card="autoinvest">
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{w.rule} · NVIDIA</span>
        <span className={styles.cardMeta}>{w.daily} · {BUY.sum}</span>
      </div>
      <div className={styles.rows}>
        <Row label={w.daily} value={`${BUY.sum} ${w.at} ${BUY.ruleAt}`} />
        <Row label={w.condition} value={BUY.condition} tone="ok" check />
        <Row label={w.budget} value={BUY.budget} />
      </div>
      <div className={styles.memory}>
        <span className={styles.reminderDot} />
        {w.remind}: {BUY.sum} → NVIDIA
        <span className={styles.memoryNote}>{w.signed}</span>
      </div>
      <span className={styles.primaryButton}>{w.buyByRule} · {BUY.sum}</span>
    </div>
  );
}

const CARDS = {
  company: CompanyCard,
  sum: SumCard,
  review: ReviewCard,
  sign: SignCard,
  receipt: ReceiptCard,
  autoinvest: AutoinvestCard,
} as const;

export type WorkflowCardId = keyof typeof CARDS;

export function WorkflowCard({ id, locale }: { id: WorkflowCardId; locale: PublicLocale }) {
  const Card = CARDS[id];
  return <Card w={WORDS[locale]} />;
}
