"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Buildings,
  CalendarCheck,
  CaretRight,
  CheckCircle,
  Clock,
  Copy,
  Gift,
  Hourglass,
  Lock,
  MagnifyingGlass,
  Medal,
  PlugsConnected,
  QrCode,
  Repeat,
  ShareNetwork,
  Stack,
  UserPlus,
  Users,
  Wallet,
  X,
} from "@phosphor-icons/react";

import { dollars, usdText } from "@/lib/rewards/format";
import type { RewardRank } from "@/lib/rewards/rules";

import { useSolanaI18n } from "../../i18n/provider.tsx";
import { FaceAvatar, RankBadge } from "../badge.tsx";
import { rankCopy } from "../rank-copy.ts";
import { pointsText, v2Copy, type V2Copy } from "./copy.ts";
import {
  claimFloor,
  firstTenRules,
  firstTenView,
  hoursLeft,
  INVESTOR_PATH,
  inviterWindow,
  ladder,
  moneyTotals,
  nextTask,
  rankView,
  sample,
  SAMPLE_NOW,
  windowDaysLeft,
  type FriendStage,
  type MoneyRow,
  type Persona,
  type Sample,
  type SampleFriend,
  type SampleTask,
  type TaskId,
} from "./fixture.ts";
import s from "./v2.module.css";

/**
 * Rewards v2 — the prototype the operator says «yes» or «no» to (Ріст 9).
 *
 * One page at its own address behind the cabinet's noindex, drawn from a
 * sample (`fixture.ts`) whose every rule is read from the rules in force. The
 * live Rewards page is untouched. Places are links, not state, so each screen
 * has an address a screenshot — or the operator — can open: `?tab=`, `?who=new`,
 * `?task=<id>`, `?celebrate=rank|friend`.
 *
 * Money, the next step, the rank, friends, then
 * history. One orange action per screen: «Claim» while there is money to claim,
 * otherwise the next step's; a sheet or a celebration is its own screen.
 */

export type V2Tab = "overview" | "friends" | "tasks" | "history" | "ranks";
export type V2Celebrate = "rank" | "friend";
export type V2Ledger = "money" | "points";

type Place = Readonly<{ tab: V2Tab; persona: Persona; ledger?: V2Ledger; task?: TaskId; celebrate?: V2Celebrate; row?: string }>;

const BASE = "/app/rewards/preview";

function href(place: Place): string {
  const query = new URLSearchParams();
  if (place.tab !== "overview") query.set("tab", place.tab);
  if (place.persona !== "active") query.set("who", place.persona);
  if (place.ledger && place.ledger !== "money") query.set("ledger", place.ledger);
  if (place.task) query.set("task", place.task);
  if (place.celebrate) query.set("celebrate", place.celebrate);
  if (place.row) query.set("row", place.row);
  const text = query.toString();
  return text ? `${BASE}?${text}` : BASE;
}

/* A whole-dollar rule reads «$10», not «$10.00»; a balance keeps its cents. */
const money = (micros: bigint) => dollars(usdText(micros < 0n ? -micros : micros));
const whole = (micros: bigint) => (micros % 1_000_000n === 0n ? `$${micros / 1_000_000n}` : money(micros));

function day(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
}

const TASK_ICON: Readonly<Record<TaskId, ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" | "duotone" }>>> = {
  firstStep: PlugsConnected,
  topUp: ArrowDown,
  firstCompany: Buildings,
  twoCompanies: Stack,
  autoinvest: Repeat,
  lesson: BookOpen,
  usefulWeek: CalendarCheck,
  friend: UserPlus,
};

export function RewardsV2Prototype({ tab, persona, ledger = "money", task, celebrate, row }: { tab: V2Tab; persona: Persona; ledger?: V2Ledger; task?: TaskId; celebrate?: V2Celebrate; row?: string }) {
  const { locale } = useSolanaI18n();
  const words = v2Copy(locale);
  const data = sample(persona);
  const place: Place = { tab, persona, ledger };
  const open = task ? data.tasks.find((one) => one.id === task) ?? null : null;
  const line = row ? data.money.find((one) => one.id === row) ?? null : null;
  return (
    <div className={s.root} data-persona={persona}>
      <div className={s.bar}>
        <nav className={s.tabs} aria-label={words.tabs.label}>
          {(["overview", "friends", "tasks", "history"] as const).map((id) => (
            <Link key={id} className={s.tab} href={href({ tab: id, persona })} aria-current={id === tab || (tab === "ranks" && id === "overview") ? "page" : undefined}>
              {words.tabs[id]}
            </Link>
          ))}
        </nav>
        <span className={s.sample}>{words.sample}</span>
      </div>

      {tab === "overview" ? <Overview data={data} place={place} words={words} locale={locale} /> : null}
      {tab === "friends" ? <Friends data={data} words={words} locale={locale} /> : null}
      {tab === "tasks" ? <Tasks data={data} place={place} words={words} locale={locale} /> : null}
      {tab === "history" ? <History data={data} place={place} words={words} locale={locale} /> : null}
      {tab === "ranks" ? <Ranks data={data} place={place} words={words} locale={locale} /> : null}

      <nav className={s.proto} aria-label={words.protoLabel}>
        <span>{words.protoLabel}</span>
        <Link href={href({ tab, persona: "active" })} aria-current={persona === "active" ? "true" : undefined}>{words.protoActive}</Link>
        <Link href={href({ tab, persona: "new" })} aria-current={persona === "new" ? "true" : undefined}>{words.protoNew}</Link>
        <Link href={href({ tab: "overview", persona: "active", celebrate: "rank" })}>{words.protoRank}</Link>
        <Link href={href({ tab: "friends", persona: "active", celebrate: "friend" })}>{words.protoFriend}</Link>
        <Link href={href({ tab: "tasks", persona: "active", task: "firstCompany" })}>{words.protoTask}</Link>
      </nav>

      {open ? <TaskSheet task={open} place={place} words={words} locale={locale} /> : null}
      {line ? <RowSheet row={line} place={place} words={words} locale={locale} /> : null}
      {celebrate ? <Celebration kind={celebrate} data={data} place={place} words={words} locale={locale} /> : null}
    </div>
  );
}

type ViewProps = Readonly<{ data: Sample; place: Place; words: V2Copy; locale: "en" | "uk" }>;

/* ------------------------------------------------------------- overview */

function Overview({ data, place, words, locale }: ViewProps) {
  const totals = moneyTotals(data.money);
  const floor = claimFloor(data.hasUsdcAccount);
  const canClaim = totals.available >= floor;
  const next = nextTask(data.tasks);
  return (
    <div className={s.overview}>
      <div className={s.main}>
        <MoneyCard data={data} words={words} canClaim={canClaim} />
        {next ? <NextStep task={next} place={place} words={words} primary={!canClaim} /> : null}
        <Latest data={data} place={place} words={words} locale={locale} />
      </div>
      <aside className={s.aside}>
        <RankCard data={data} place={place} words={words} locale={locale} />
        <FriendsCard data={data} place={place} words={words} />
        <More words={words} locale={locale} />
      </aside>
    </div>
  );
}

function MoneyCard({ data, words, canClaim }: { data: Sample; words: V2Copy; canClaim: boolean }) {
  const totals = moneyTotals(data.money);
  const floor = claimFloor(data.hasUsdcAccount);
  const empty = totals.earned === 0n;
  return (
    <section className={`${s.card} ${s.money}`} aria-label={words.claimable} style={{ gridArea: "money" }}>
      <div className={s.moneyTop}>
        <div className={s.moneyFigureBox}>
          <span className={s.label}>{empty ? words.yourRewards : words.claimable}</span>
          <span className={s.moneyFigure}>{money(totals.available)}</span>
          <span className={s.moneyMeta}>
            {totals.pending > 0n ? (
              <span className={s.pill} data-tone="wait">
                <Clock size={14} weight="bold" aria-hidden /> {words.pending(money(totals.pending))}
              </span>
            ) : null}
            {totals.paid > 0n ? <span className={s.quiet}>{words.paidSoFar(money(totals.paid))}</span> : null}
            {empty ? <span className={s.quiet}>{words.nothingYet}</span> : null}
          </span>
        </div>
        {canClaim ? (
          <div className={s.claimBox}>
            <button type="button" className={s.primary}>
              <Wallet size={18} weight="bold" aria-hidden /> {words.claim(money(totals.available))}
            </button>
            <span className={s.note}>{words.claimNote(money(floor))}</span>
          </div>
        ) : !empty ? (
          <span className={s.note}>{words.belowFloor(money(floor))}</span>
        ) : null}
      </div>
      <FirstTen data={data} words={words} />
    </section>
  );
}

function FirstTen({ data, words }: { data: Sample; words: V2Copy }) {
  const view = firstTenView(data);
  if (view.state === "done") return null;
  const percent = view.cap > 0n ? Number((view.returned * 100n) / view.cap) : 0;
  return (
    <div className={s.firstTen}>
      <span className={s.firstTenIcon} aria-hidden>
        <Gift size={18} weight="duotone" />
      </span>
      <div className={s.firstTenBody}>
        <div className={s.rowBetween}>
          <span className={s.firstTenName}>{words.firstTen}</span>
          <span className={s.figureSm}>{words.firstTenOf(money(view.returned), whole(view.cap))}</span>
        </div>
        <span className={s.track} aria-hidden>
          <span className={s.fill} data-tone="money" style={{ width: `${Math.max(view.state === "open" ? 0 : 3, percent)}%` }} />
        </span>
        <span className={s.quiet}>{view.daysLeft !== null ? words.firstTenLeft(view.daysLeft) : words.firstTenOpen(firstTenRules().wallets, firstTenRules().days)}</span>
      </div>
    </div>
  );
}

function NextStep({ task, place, words, primary }: { task: SampleTask; place: Place; words: V2Copy; primary: boolean }) {
  const Icon = TASK_ICON[task.id];
  const text = words.task[task.id];
  return (
    <section className={`${s.card} ${s.next}`} aria-label={words.nextStep} style={{ gridArea: "next" }}>
      <span className={s.label}>{words.nextStep}</span>
      <div className={s.nextBody}>
        <span className={s.taskIcon} data-kind={task.kind} aria-hidden>
          <Icon size={22} weight="duotone" />
        </span>
        <Link className={s.nextText} href={href({ ...place, tab: "tasks", task: task.id })}>
          <span className={s.taskName}>{text.name}</span>
          <span className={s.taskCond}>{text.condition}</span>
          <span className={s.rewardLine}>
            <span className={s.reward}>{words.plusPoints(task.points)}</span>
            {task.badge ? <span className={s.reward}>{words.plusBadge}</span> : null}
            {task.progress ? <Dots done={task.progress.done} of={task.progress.of} label={words.progress(task.progress.done, task.progress.of)} /> : null}
          </span>
        </Link>
        <Link className={primary ? s.primary : s.secondary} href={task.href}>
          {text.action} <ArrowRight size={16} weight="bold" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function RankCard({ data, place, words, locale }: ViewProps) {
  const rank = rankView(data.points);
  const ranks = rankCopy(locale);
  const percent = rank.next ? Math.round(((rank.points - rank.from) / (rank.next.at - rank.from)) * 100) : 100;
  return (
    <Link className={`${s.card} ${s.rank}`} href={href({ ...place, tab: "ranks" })} style={{ gridArea: "rank" }} data-rank={rank.rank.toLowerCase()}>
      <div className={s.rowBetween}>
        <span className={s.label}>{words.rank}</span>
        <span className={s.quiet}>{words.windowNote}</span>
      </div>
      <div className={s.rankBody}>
        <RankRing percent={percent} label={`${ranks.rank[rank.rank]} · ${percent}%`}>
          <RankBadge rank={rank.rank} size={50} className={s.rankBadge} />
        </RankRing>
        <div className={s.rankText}>
          <span className={s.rankName}>{ranks.rank[rank.rank]}</span>
          <span className={s.figureSm}>{pointsText(locale, rank.points)}</span>
        </div>
        <CaretRight size={18} weight="bold" className={s.chevron} aria-hidden />
      </div>
      <span className={s.quiet}>{rank.next ? ranks.toNext(String(rank.next.toGo), rank.next.rank) : ranks.top}</span>
      <div className={s.chips}>
        <span className={s.pill} data-tone="steel">
          <Users size={14} weight="bold" aria-hidden /> {words.shareNow(rank.share, inviterWindow().days)}
        </span>
        {rank.nextShare !== null ? <span className={s.pill}>{words.shareNext(rank.nextShare)}</span> : null}
      </div>
    </Link>
  );
}

/** The rank's ring — how far from this rank's start to the next, the badge inside it. */
function RankRing({ percent, label, children, large = false }: { percent: number; label: string; children: ReactNode; large?: boolean }) {
  const radius = 34;
  const length = 2 * Math.PI * radius;
  return (
    <span className={s.ring} data-size={large ? "large" : undefined} role="img" aria-label={label}>
      <svg className={s.ringSvg} viewBox="0 0 76 76" aria-hidden>
        <circle className={s.ringTrack} cx="38" cy="38" r={radius} />
        <circle className={s.ringFill} cx="38" cy="38" r={radius} strokeDasharray={`${(length * Math.max(2, percent)) / 100} ${length}`} />
      </svg>
      <span className={s.ringInner}>{children}</span>
    </span>
  );
}

function FriendsCard({ data, place, words }: { data: Sample; place: Place; words: V2Copy }) {
  const buying = data.friends.filter((friend) => friend.stage === "firstBuy" || friend.stage === "holding" || friend.stage === "active").length;
  const earned = data.money.filter((row) => row.kind === "friend" || row.kind === "friend2").reduce((sum, row) => sum + row.usdMicros, 0n);
  return (
    <section className={`${s.card} ${s.friendsCard}`} aria-label={words.friends} style={{ gridArea: "friends" }}>
      <div className={s.rowBetween}>
        <span className={s.label}>{words.friends}</span>
        <Link className={s.link} href={href({ ...place, tab: "friends" })}>
          {words.all} <CaretRight size={14} weight="bold" aria-hidden />
        </Link>
      </div>
      {data.friends.length > 0 ? (
        <div className={s.friendsSummary}>
          <span className={s.faces} aria-hidden>
            {data.friends.slice(0, 4).map((friend) => (
              <FaceAvatar key={friend.wallet} face={friend.face} rank={null} size={32} className={s.face} />
            ))}
          </span>
          <span className={s.friendsText}>
            <span className={s.strong}>{words.friendsBuying(buying)}</span>
            <span className={s.quiet}>{words.fromFriends(money(earned))}</span>
          </span>
        </div>
      ) : (
        <span className={s.quiet}>{words.noFriendsHint}</span>
      )}
      <Link className={s.secondary} href={href({ ...place, tab: "friends" })}>
        <ShareNetwork size={16} weight="bold" aria-hidden /> {words.shareLink}
      </Link>
    </section>
  );
}

/* «Latest» folds to the four newest, «Show N more» / «Show fewer». */
function Latest({ data, place, words, locale }: ViewProps) {
  const [all, setAll] = useState(false);
  const rows = all ? data.money : data.money.slice(0, 4);
  const hidden = data.money.length - 4;
  return (
    <section className={`${s.card} ${s.latest}`} aria-label={words.latest} style={{ gridArea: "latest" }}>
      <div className={s.rowBetween}>
        <span className={s.label}>{words.latest}</span>
        {data.money.length > 0 ? (
          <Link className={s.link} href={href({ ...place, tab: "history" })}>
            {words.all} <CaretRight size={14} weight="bold" aria-hidden />
          </Link>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul className={s.rows}>
          {rows.map((row) => (
            <MoneyLine key={row.id} row={row} place={place} words={words} locale={locale} />
          ))}
        </ul>
      ) : (
        <p className={s.empty}>{words.emptyHistory}</p>
      )}
      {hidden > 0 ? (
        <button type="button" className={s.fold} onClick={() => setAll((value) => !value)} aria-expanded={all}>
          {all ? words.showLess : words.showMore(hidden)}
        </button>
      ) : null}
    </section>
  );
}

function More({ words, locale }: { words: V2Copy; locale: "en" | "uk" }) {
  const rules = rankCopy(locale);
  const window = inviterWindow();
  const first = firstTenRules();
  return (
    <section className={`${s.card} ${s.more}`} aria-label={words.more} style={{ gridArea: "more" }}>
      <span className={s.label}>{words.more}</span>
      <div className={s.moreLinks}>
        <Link href="/app/rewards/leaderboard">{words.boards}</Link>
        <Link href="/app/rewards/season">{words.season}</Link>
        <Link href="/app/rewards/partners">{words.partners}</Link>
      </div>
      <details className={s.rules}>
        <summary>{words.howItWorks}</summary>
        <ul>
          <li>{rules.rewardsRules[0]}</li>
          <li>{rules.firstTenRule(money(first.capUsdMicros), first.days, first.wallets)}</li>
          <li>{rules.inviterRule(window.share, window.days)}</li>
          <li>{rules.claimFloorRule(money(claimFloor(true)), money(claimFloor(false)))}</li>
          <li>{words.pointsNote}</li>
        </ul>
      </details>
    </section>
  );
}

/* --------------------------------------------------------------- friends */

const STAGE_STEP: Readonly<Record<FriendStage, number>> = { joined: 1, firstBuy: 2, review: 2, holding: 3, active: 4 };

function Friends({ data, words, locale }: Omit<ViewProps, "place">) {
  const window = inviterWindow();
  const first = firstTenRules();
  const link = `ryntra.io/r/${data.code}`;
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    let live = true;
    void import("qrcode").then((lib) =>
      lib.toString(`https://${link}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#080D13", light: "#FFFFFF" } }).then((svg) => {
        if (live) setQr(svg);
      }),
    );
    return () => {
      live = false;
    };
  }, [link]);
  const level1 = data.money.filter((row) => row.kind === "friend").reduce((sum, row) => sum + row.usdMicros, 0n);
  const level2 = data.money.filter((row) => row.kind === "friend2").reduce((sum, row) => sum + row.usdMicros, 0n);
  return (
    <div className={s.friendsPage}>
      <section className={`${s.card} ${s.invite}`} aria-label={words.inviteTitle}>
        <div className={s.inviteMain}>
          <h2 className={s.h2}>{words.inviteTitle}</h2>
          <ul className={s.offers}>
            <li>
              <span className={s.offerIcon} data-tone="steel" aria-hidden><Users size={16} weight="bold" /></span>
              <span>{words.youGet(window.share, window.days)}</span>
            </li>
            <li>
              <span className={s.offerIcon} data-tone="money" aria-hidden><Gift size={16} weight="bold" /></span>
              <span>{words.theyGet(whole(first.capUsdMicros), first.wallets)}</span>
            </li>
          </ul>
          <details className={s.rules}>
            <summary>{words.terms}</summary>
            <ul>
              <li>{rankCopy(locale).inviterRule(window.share, window.days)}</li>
              <li>{rankCopy(locale).firstTenRule(whole(first.capUsdMicros), first.days, first.wallets)}</li>
            </ul>
          </details>
          <div className={s.linkBox}>
            <span className={s.linkText}>{link}</span>
            <button type="button" className={s.iconButton} onClick={() => { void navigator.clipboard?.writeText(`https://${link}`).catch(() => undefined); setCopied(true); }} aria-label={words.copy}>
              {copied ? <CheckCircle size={18} weight="bold" aria-hidden /> : <Copy size={18} weight="bold" aria-hidden />}
            </button>
          </div>
          <div className={s.inviteActions}>
            <button type="button" className={s.primary}>
              <ShareNetwork size={18} weight="bold" aria-hidden /> {words.share}
            </button>
            <button type="button" className={`${s.secondary} ${s.qrToggle}`} onClick={() => setShowQr((value) => !value)} aria-expanded={showQr}>
              <QrCode size={18} weight="bold" aria-hidden /> {words.qr}
            </button>
          </div>
        </div>
        <div className={s.qr} data-open={showQr ? "true" : undefined}>
          <span className={s.qrCode} role="img" aria-label={words.qr} dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
          <span className={s.quiet}>{words.qrHint}</span>
        </div>
      </section>

      {data.friends.length > 0 ? (
        <section className={`${s.card} ${s.friendList}`} aria-label={words.friends}>
          <div className={s.rowBetween}>
            <span className={s.label}>{words.friends} · {data.friends.length}</span>
            <span className={s.figureSm} data-tone="money">{words.toYou(money(level1 + level2))}</span>
          </div>
          <ul className={s.friendRows}>
            {data.friends.map((friend) => (
              <FriendRow key={friend.wallet} friend={friend} words={words} locale={locale} />
            ))}
          </ul>
          <div className={s.friendFoot}>
            {data.opened > 0 ? <span className={s.quiet}>{words.opened(data.opened)}</span> : <span />}
            {level2 > 0n ? <span className={s.quiet}>{words.secondLevel(money(level2), 5)}</span> : null}
          </div>
        </section>
      ) : (
        <section className={`${s.card} ${s.emptyCard}`}>
          <span className={s.emptyIcon} aria-hidden><Users size={28} weight="duotone" /></span>
          <span className={s.strong}>{words.noFriends}</span>
          <span className={s.quiet}>{words.noFriendsHint}</span>
        </section>
      )}
    </div>
  );
}

function FriendRow({ friend, words }: { friend: SampleFriend; words: V2Copy; locale: "en" | "uk" }) {
  const step = STAGE_STEP[friend.stage];
  const left = windowDaysLeft(friend.firstTradeAt);
  const window = inviterWindow();
  const stage = friend.stage === "holding" && friend.heldDays ? words.holdingDays(friend.heldDays) : words.stage[friend.stage];
  const line =
    friend.stage === "review" ? words.checking
      : friend.inFirstTen ? words.theirFirstTen
        : friend.stage === "joined" ? words.noPurchase
          : left !== null ? words.windowLeft(window.share, left) : null;
  return (
    <li className={s.friendRow} data-stage={friend.stage}>
      <FaceAvatar face={friend.face} rank={null} size={40} />
      <div className={s.friendMain}>
        <div className={s.rowBetween}>
          <span className={s.wallet}>{friend.wallet}</span>
          <span className={s.figureSm} data-tone={friend.earnedUsdMicros > 0n ? "money" : undefined}>{money(friend.earnedUsdMicros)}</span>
        </div>
        <ol className={s.path} aria-label={words.path.slice(0, step).join(" → ")}>
          {words.path.map((name, index) => (
            <li key={name} data-done={index < step ? "true" : undefined} data-review={friend.stage === "review" && index === step - 1 ? "true" : undefined}>
              <span className={s.pathDot} aria-hidden />
            </li>
          ))}
        </ol>
        <div className={s.friendMeta}>
          <span className={s.pill} data-tone={friend.stage === "active" ? "money" : friend.stage === "review" ? "steel" : friend.stage === "joined" ? undefined : "wait"}>
            {friend.stage === "review" ? <MagnifyingGlass size={12} weight="bold" aria-hidden /> : null}
            {stage}
          </span>
          {line ? <span className={s.quiet}>{line}</span> : null}
        </div>
      </div>
    </li>
  );
}

/* ----------------------------------------------------------------- tasks */

function Tasks({ data, place, words, locale }: ViewProps) {
  const now = data.tasks.filter((task) => task.state === "available" || task.state === "holding" || task.state === "review");
  const later = data.tasks.filter((task) => task.state === "locked");
  const done = data.tasks.filter((task) => task.state === "done");
  const byId = new Map(data.tasks.map((task) => [task.id, task]));
  return (
    <div className={s.tasksPage}>
      <section className={`${s.card} ${s.pathCard}`} aria-label={words.investorPath}>
        <div className={s.rowBetween}>
          <span className={s.label}>{words.investorPath}</span>
        </div>
        <ol className={s.chain}>
          {INVESTOR_PATH.map((id) => {
            const task = byId.get(id);
            const Icon = TASK_ICON[id];
            return (
              <li key={id} data-state={task?.state}>
                <Link href={href({ ...place, task: id })} className={s.chainNode}>
                  <span className={s.chainIcon} aria-hidden><Icon size={18} weight="duotone" /></span>
                  <span className={s.chainName}>{words.chain[id] ?? words.task[id].name}</span>
                </Link>
              </li>
            );
          })}
          <li data-state="badge">
            <span className={s.chainNode}>
              <span className={s.medal} aria-hidden><Medal size={18} weight="duotone" /></span>
              <span className={s.chainName}>{words.investorBadge}</span>
            </span>
          </li>
        </ol>
      </section>

      <TaskGroup title={words.now} tasks={now} byId={byId} place={place} words={words} locale={locale} />
      <TaskGroup title={words.next} tasks={later} byId={byId} place={place} words={words} locale={locale} />
      <TaskGroup title={`${words.done} · ${done.length}`} tasks={done} byId={byId} place={place} words={words} locale={locale} compact />
      <p className={s.fine}>{words.pointsNote}</p>
    </div>
  );
}

function TaskGroup({ title, tasks, byId, place, words, locale, compact = false }: { title: string; tasks: readonly SampleTask[]; byId: Map<TaskId, SampleTask>; place: Place; words: V2Copy; locale: "en" | "uk"; compact?: boolean }) {
  if (tasks.length === 0) return null;
  return (
    <section className={s.group} aria-label={title}>
      <h2 className={s.groupTitle}>{title}</h2>
      <ul className={compact ? s.taskGridCompact : s.taskGrid}>
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskCard task={task} byId={byId} place={place} words={words} locale={locale} compact={compact} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function stateText(task: SampleTask, byId: Map<TaskId, SampleTask>, words: V2Copy, locale: "en" | "uk"): string {
  if (task.state === "holding") return words.holdingHours(hoursLeft(task.holdEndsAt));
  if (task.state === "locked") return words.lockedAfter(words.task[task.after ?? task.id].name);
  if (task.state === "done") return task.doneAt ? words.doneOn(day(locale, task.doneAt)) : words.state.done;
  void byId;
  return words.state[task.state];
}

const STATE_ICON = { locked: Lock, available: ArrowRight, holding: Hourglass, review: MagnifyingGlass, done: CheckCircle } as const;

function TaskCard({ task, byId, place, words, locale, compact }: { task: SampleTask; byId: Map<TaskId, SampleTask>; place: Place; words: V2Copy; locale: "en" | "uk"; compact: boolean }) {
  const Icon = TASK_ICON[task.id];
  const StateIcon = STATE_ICON[task.state];
  const text = words.task[task.id];
  return (
    <Link className={s.task} data-state={task.state} data-compact={compact ? "true" : undefined} href={href({ ...place, task: task.id })}>
      <span className={s.taskIcon} data-kind={task.kind} aria-hidden>
        <Icon size={compact ? 18 : 22} weight="duotone" />
      </span>
      <span className={s.taskBody}>
        <span className={s.taskName}>{text.name}</span>
        {compact ? null : <span className={s.taskCond}>{text.condition}</span>}
        <span className={s.taskFoot}>
          <span className={s.stateChip} data-state={task.state}>
            <StateIcon size={12} weight="bold" aria-hidden /> {stateText(task, byId, words, locale)}
          </span>
          {task.progress && !compact ? <Dots done={task.progress.done} of={task.progress.of} label={words.progress(task.progress.done, task.progress.of)} /> : null}
        </span>
      </span>
      <span className={s.taskPoints} data-state={task.state}>
        {words.plusPoints(task.points)}
        {task.badge && !compact ? <span className={s.badgeNote}>{words.plusBadge}</span> : null}
      </span>
    </Link>
  );
}

function Dots({ done, of, label }: { done: number; of: number; label: string }) {
  return (
    <span className={s.dots} role="img" aria-label={label}>
      {Array.from({ length: of }, (_, index) => (
        <span key={index} data-done={index < done ? "true" : undefined} />
      ))}
      <span className={s.dotsText}>{label}</span>
    </span>
  );
}

function TaskSheet({ task, place, words, locale }: { task: SampleTask; place: Place; words: V2Copy; locale: "en" | "uk" }) {
  const Icon = TASK_ICON[task.id];
  const text = words.task[task.id];
  const close = href({ ...place, task: undefined });
  const note = task.state === "holding" ? words.holdNote : task.state === "review" ? words.reviewNote : null;
  const hours = hoursLeft(task.holdEndsAt);
  const holdPercent = task.state === "holding" ? Math.round(((72 - Math.min(72, hours)) / 72) * 100) : 0;
  return (
    <div className={s.scrim} role="presentation">
      <Link className={s.scrimClose} href={close} aria-label={words.close} tabIndex={-1} />
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={text.name} data-state={task.state}>
        <div className={s.sheetHead}>
          <span className={s.sheetIcon} data-kind={task.kind} data-state={task.state} aria-hidden>
            <Icon size={34} weight="duotone" />
          </span>
          <Link className={s.close} href={close} aria-label={words.close}>
            <X size={18} weight="bold" aria-hidden />
          </Link>
        </div>
        <h2 className={s.sheetTitle}>{text.name}</h2>
        <span className={s.stateChip} data-state={task.state}>{stateText(task, new Map(), words, locale)}</span>
        <dl className={s.sheetFacts}>
          <div>
            <dt>{words.condition}</dt>
            <dd>{text.condition}</dd>
          </div>
          <div>
            <dt>{words.reward}</dt>
            <dd className={s.reward}>
              {words.plusPoints(task.points)}
              {task.badge ? ` ${words.plusBadge} «${words.investorBadge}»` : ""}
            </dd>
          </div>
        </dl>
        {task.state === "holding" ? (
          <div className={s.hold}>
            <span className={s.track} aria-hidden>
              <span className={s.fill} data-tone="wait" style={{ width: `${holdPercent}%` }} />
            </span>
            <span className={s.rowBetween}>
              <span className={s.quiet}>{words.holdOf(hours)}</span>
              <span className={s.figureSm}>{words.hoursLeft(hours)}</span>
            </span>
          </div>
        ) : null}
        {task.progress ? <Dots done={task.progress.done} of={task.progress.of} label={words.progress(task.progress.done, task.progress.of)} /> : null}
        {note ? <p className={s.quiet}>{note}</p> : null}
        {task.state === "available" ? (
          <Link className={s.primary} href={task.href}>
            {text.action} <ArrowRight size={16} weight="bold" aria-hidden />
          </Link>
        ) : (
          <Link className={s.secondary} href={close}>{words.close}</Link>
        )}
        <p className={s.fine}>{words.pointsNote}</p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- history */

const KIND_ICON = { cashback: Wallet, firstTen: Gift, friend: Users, friend2: Users, claim: ArrowDown } as const;

function rowSource(row: MoneyRow, words: V2Copy): string {
  if (row.kind === "friend") return words.fromFriend(row.source ?? "");
  if (row.kind === "friend2") return words.via(row.source ?? "");
  return row.source ? words.trade(row.source) : "USDC";
}

function MoneyLine({ row, place, words }: { row: MoneyRow; place: Place; words: V2Copy; locale: "en" | "uk" }) {
  const Icon = KIND_ICON[row.kind];
  const source = rowSource(row, words);
  return (
    <li>
      <Link className={s.line} data-kind={row.kind} href={href({ ...place, row: row.id })}>
      <span className={s.lineIcon} data-kind={row.kind} aria-hidden>
        <Icon size={16} weight="bold" />
      </span>
      <span className={s.lineText}>
        <span className={s.lineTitle}>{words.kind[row.kind]}</span>
        <span className={s.quiet}>{source}</span>
      </span>
      <span className={s.lineSide}>
        <span className={s.lineAmount} data-tone={row.kind === "claim" ? undefined : "money"}>
          {row.kind === "claim" ? "−" : "+"}
          {money(row.usdMicros)}
        </span>
        <span className={s.lineState} data-state={row.state}>{words.moneyState[row.state]}</span>
      </span>
      </Link>
    </li>
  );
}

/* A money row one tap deep: what it came from, the fee Ryntra received, the share, the rules and the receipt. */
function RowSheet({ row, place, words, locale }: { row: MoneyRow; place: Place; words: V2Copy; locale: "en" | "uk" }) {
  const close = href({ ...place, row: undefined });
  const Icon = KIND_ICON[row.kind];
  const received = row.shareBps ? (row.usdMicros * 10_000n) / BigInt(row.shareBps) : null;
  return (
    <div className={s.scrim} role="presentation">
      <Link className={s.scrimClose} href={close} aria-label={words.close} tabIndex={-1} />
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={words.kind[row.kind]}>
        <div className={s.sheetHead}>
          <span className={s.sheetIcon} data-state={row.state === "pending" ? "holding" : row.kind === "claim" ? undefined : "done"} aria-hidden><Icon size={30} weight="duotone" /></span>
          <Link className={s.close} href={close} aria-label={words.close}><X size={18} weight="bold" aria-hidden /></Link>
        </div>
        <h2 className={s.sheetTitle}>
          {row.kind === "claim" ? "−" : "+"}
          {money(row.usdMicros)}
        </h2>
        <span className={s.stateChip} data-state={row.state === "pending" ? "holding" : row.state === "available" ? "done" : undefined}>{words.kind[row.kind]} · {words.moneyState[row.state]}</span>
        <dl className={s.sheetFacts}>
          <div>
            <dt>{day(locale, row.at)}</dt>
            <dd>{rowSource(row, words)}</dd>
          </div>
          {received !== null ? (
            <div>
              <dt>{words.rowFee}</dt>
              <dd>{money(received)}</dd>
            </div>
          ) : null}
          {row.shareBps ? (
            <div>
              <dt>{words.rowShare}</dt>
              <dd>{row.shareBps / 100}%</dd>
            </div>
          ) : null}
          <div>
            <dt>{words.rulesLabel}</dt>
            <dd>{row.rules}</dd>
          </div>
        </dl>
        {/* A friend's trade is the friend's receipt, not this person's: only their own trades and claims link one. */}
        {row.kind === "friend" || row.kind === "friend2" ? null : (
          <Link className={s.link} href="/app/receipts">{words.receipt} <ArrowRight size={12} weight="bold" aria-hidden /></Link>
        )}
        <Link className={s.secondary} href={close}>{words.close}</Link>
      </div>
    </div>
  );
}

function History({ data, place, words, locale }: ViewProps) {
  const ledger = place.ledger ?? "money";
  const since = Date.parse(SAMPLE_NOW) - 30 * 86_400_000;
  const groups = new Map<string, MoneyRow[]>();
  for (const row of data.money) {
    const key = day(locale, row.at);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <div className={s.historyPage}>
      <nav className={s.segment} aria-label={words.tabs.history}>
        <Link href={href({ ...place, ledger: "money" })} aria-current={ledger === "money" ? "page" : undefined}>{words.money}</Link>
        <Link href={href({ ...place, ledger: "points" })} aria-current={ledger === "points" ? "page" : undefined}>{words.points}</Link>
      </nav>
      {ledger === "money" ? (
        data.money.length > 0 ? (
          <section className={`${s.card} ${s.historyCard}`} aria-label={words.money}>
            {[...groups.entries()].map(([date, rows]) => (
              <div key={date} className={s.dayGroup}>
                <span className={s.dayLabel}>{date}</span>
                <ul className={s.rows}>
                  {rows.map((row) => (
                    <MoneyLine key={row.id} row={row} place={place} words={words} locale={locale} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : (
          <section className={`${s.card} ${s.emptyCard}`}>
            <span className={s.emptyIcon} aria-hidden><Wallet size={28} weight="duotone" /></span>
            <span className={s.quiet}>{words.emptyHistory}</span>
          </section>
        )
      ) : (
        <section className={`${s.card} ${s.historyCard}`} aria-label={words.points}>
          <ul className={s.rows}>
            {data.points.map((row) => {
              const outside = Date.parse(row.at) <= since;
              const title = row.kind === "task" ? words.pointsTask(words.task[row.task ?? "firstStep"].name) : row.kind === "trades" ? words.pointsTrades : words.pointsFriends;
              return (
                <li key={row.id} className={s.line} data-outside={outside ? "true" : undefined}>
                  <span className={s.lineIcon} data-kind="points" aria-hidden><Medal size={16} weight="bold" /></span>
                  <span className={s.lineText}>
                    <span className={s.lineTitle}>{title}</span>
                    <span className={s.quiet}>{outside ? words.outsideWindow : day(locale, row.at)}</span>
                  </span>
                  <span className={s.lineSide}>
                    <span className={s.lineAmount}>+{row.points}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className={s.fine}>{words.pointsNote}</p>
        </section>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- ranks */

function Ranks({ data, place, words, locale }: ViewProps) {
  const rank = rankView(data.points);
  const ranks = rankCopy(locale);
  const steps = ladder();
  const here = steps.findIndex((step) => step.rank === rank.rank);
  const percent = rank.next ? Math.round(((rank.points - rank.from) / (rank.next.at - rank.from)) * 100) : 100;
  return (
    <div className={s.ranksPage}>
      <Link className={s.back} href={href({ ...place, tab: "overview" })}>
        <CaretRight size={14} weight="bold" className={s.backIcon} aria-hidden /> {words.back}
      </Link>
      <section className={`${s.card} ${s.rankHero}`} data-rank={rank.rank.toLowerCase()} aria-label={words.rank}>
        <RankRing percent={percent} label={`${ranks.rank[rank.rank]} · ${percent}%`} large>
          <RankBadge rank={rank.rank} size={84} className={s.rankBadge} />
        </RankRing>
        <div className={s.rankHeroText}>
          <span className={s.label}>{words.rank} · {words.windowNote}</span>
          <span className={s.rankHeroName}>{ranks.rank[rank.rank]}</span>
          <span className={s.figureSm}>{pointsText(locale, rank.points)}</span>
          <span className={s.quiet}>{rank.next ? ranks.toNext(String(rank.next.toGo), rank.next.rank) : ranks.top}</span>
        </div>
      </section>
      <section className={`${s.card} ${s.ladderCard}`} aria-label={words.ranks}>
        <ol className={s.ladder}>
          {steps.map((step, index) => (
            <li key={step.rank} data-here={index === here ? "true" : undefined} data-ahead={index > here ? "true" : undefined}>
              <RankBadge rank={step.rank as RewardRank} size={44} locked={index > here} />
              <span className={s.ladderText}>
                <span className={s.ladderName}>
                  {ranks.rank[step.rank]}
                  {index === here ? <span className={s.you}>{words.youAreHere}</span> : null}
                </span>
                <span className={s.quiet}>{words.fromPoints(pointsText(locale, step.from))}</span>
              </span>
              <span className={s.ladderSide}>
                <span className={s.figureSm}>{words.fromFriendShare(step.share)}</span>
                <span className={s.opens} data-live={step.live ? "true" : undefined}>
                  {words.opens[step.opens]}
                  {step.live ? null : <em>{words.later}</em>}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section className={`${s.card} ${s.sources}`} aria-label={words.howPoints}>
        <span className={s.label}>{words.howPoints}</span>
        <ul>
          {words.pointsSources.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className={s.fine}>
          {ranks.ladderWindow(inviterWindow().share, inviterWindow().days)} {rank.bySource.trades === 0 && data.firstTen.state === "active" ? `${ranks.freshWindow} ` : ""}
          {words.pointsNote}
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ celebration */

function Celebration({ kind, data, place, words, locale }: { kind: V2Celebrate } & ViewProps) {
  const ranks = rankCopy(locale);
  const rank = rankView(data.points);
  const steps = ladder();
  const before = steps[Math.max(0, steps.findIndex((step) => step.rank === rank.rank) - 1)];
  const close = href({ ...place, celebrate: undefined });
  const friend = data.friends.find((one) => one.stage === "active");
  return (
    <div className={s.scrim} role="presentation">
      <div className={`${s.sheet} ${s.celebrate}`} role="dialog" aria-modal="true" aria-label={kind === "rank" ? words.celebrateRank(ranks.rank[rank.rank]) : words.celebrateFriend}>
        <span className={s.halo} aria-hidden />
        {kind === "rank" ? (
          <>
            <RankBadge rank={rank.rank} size={128} className={s.celebrateBadge} />
            <h2 className={s.celebrateTitle}>{words.celebrateRank(ranks.rank[rank.rank])}</h2>
            <p className={s.celebrateLine}>{words.celebrateRankLine(before.share, rank.share)}</p>
            {rank.next ? <span className={s.quiet}>{ranks.toNext(String(rank.next.toGo), rank.next.rank)}</span> : null}
            <span className={s.fine}>{words.rankCanDrop}</span>
          </>
        ) : (
          <>
            <span className={s.celebrateFace}>
              {friend ? <FaceAvatar face={friend.face} rank={null} size={112} /> : null}
              <span className={s.celebrateCheck} aria-hidden><CheckCircle size={30} weight="fill" /></span>
            </span>
            <h2 className={s.celebrateTitle}>{words.celebrateFriend}</h2>
            <ol className={`${s.path} ${s.celebratePath}`}>
              {words.path.map((name) => (
                <li key={name} data-done="true">
                  <span className={s.pathDot} aria-hidden />
                  <span className={s.pathName}>{name}</span>
                </li>
              ))}
            </ol>
            <p className={s.celebrateLine}>{friend ? `${friend.wallet} · ${words.celebrateFriendLine}` : words.celebrateFriendLine}</p>
          </>
        )}
        <Link className={s.primary} href={close}>{words.ok}</Link>
      </div>
    </div>
  );
}
