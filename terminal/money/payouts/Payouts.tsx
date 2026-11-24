'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { checkList, stopping, toRead, totals, unitsText, type CheckedRow, type Issue } from '@/lib/privacy/payouts/check';
import { payoutFee, type FeeRule, type PayoutFeeSetting } from '@/lib/privacy/payouts/fee';
import { parseList, PAY_COINS } from '@/lib/privacy/payouts/list';
import { planPayout } from '@/lib/privacy/payouts/plan';
import { usePayouts } from '@/lib/privacy/payouts/usePayouts';
import { contactsOf, paidCount, paidTo, reportCsv, templateOf, unpaidOf, type LedgerLine, type PayoutRecord } from '@/lib/privacy/ledger/ledger';
import { PRIVATE_TEST } from '@/lib/privacy/network';
import { usePrivate } from '@/lib/privacy/usePrivate';
import { walletSignsV1 } from '@/lib/solana/wallet.client';
import { SeenLine } from '@/terminal/portfolio/private/PrivateBalance';
import { PRIVATE } from '@/terminal/portfolio/private/words';
import ps from '@/terminal/portfolio/private/private.module.css';
import { MenuIcon } from '@/terminal/shell/menu-icons';
import { Action, Chip, Figure, Icon, Info, Kick, Panel, Quiet, QuietLink, SayLine, Segment } from '@/terminal/ui';
import { LIST_FILE_ACCEPT, LIST_FILE_MAX_BYTES, feeText, issueTone, reportName, reportWords, shownIssue, whoText } from './payouts-view';
import { MONEY_WORDS } from '../words';
import { ReportAccess } from '../report/Report';
import { PAYOUTS } from './words';
import p from './payouts.module.css';

type Words = (typeof PAYOUTS)['en'];

const SOL = PAY_COINS[0];
/** Recipients are read once the list has stood still this long. */
const READ_AFTER_MS = 450;

function save(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const ISSUE_KEY: Readonly<Record<Issue, keyof Words>> = {
  who: 'who',
  address: 'address',
  amount: 'amount',
  coin: 'coin',
  self: 'self',
  small: 'small',
  duplicate: 'duplicate',
  new: 'new',
  noPrivate: 'noPrivate',
};

/** The tab's sign, its name and one line, in the middle of the panel — every state without a list starts so. */
function Blank({ w, line }: { w: Words; line?: string }) {
  return (
    <div className={p.blank}>
      <span className={p.blankSign} aria-hidden="true">
        <MenuIcon name="payouts" />
      </span>
      <h2 className={p.blankTitle}>{w.blankTitle}</h2>
      <p className={p.line}>{line ?? w.blankLine}</p>
    </div>
  );
}

/**
 * «Money → Payouts»: a list of people paid from the private balance. On screen: the list, the sum and how
 * many people, «Others see», one line of the fee and the signatures, one amber «Pay out». After it: «Paid N of N» and
 * the quiet «Report», «Repeat». What for, the links, how it works — behind «i». Only with the private balance open.
 */
export function Payouts({ onConnect, feeSetting }: { onConnect: () => void; feeSetting?: PayoutFeeSetting }) {
  const w = useWords(PAYOUTS);
  const wp = useWords(PRIVATE);
  const wm = useWords(MONEY_WORDS);
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const phase = usePrivate((st) => st.phase);
  const busy = usePrivate((st) => st.busy);
  const held = usePrivate((st) => st.held);
  const st = usePayouts();

  useEffect(() => {
    usePrivate.getState().follow(connection?.wallet ?? null, owner);
    usePayouts.getState().follow(connection?.wallet ?? null, owner);
  }, [connection?.wallet, owner]);

  if (!owner) {
    return (
      <>
        <Blank w={w} />
        <Action onClick={onConnect}>{wm.connect}</Action>
      </>
    );
  }
  const signsV1 = connection ? walletSignsV1(connection.wallet) : false;
  // A payout under way keeps its panel whatever the private balance is doing (a link reads it again mid-way).
  if (st.run) return <List w={w} owner={owner} signsV1={signsV1} held={held} feeSetting={feeSetting} />;
  if (phase === 'loading' || phase === 'none') return <Bones />;
  if (phase === 'failed') {
    return (
      <>
        <Blank w={w} line={w.notRead} />
        <Quiet full onClick={() => void usePrivate.getState().refresh()}>
          {w.again}
        </Quiet>
      </>
    );
  }
  if (phase === 'elsewhere') {
    return (
      <>
        <Blank w={w} line={w.elsewhere} />
        <QuietLink href="/portfolio">{w.toPortfolio}</QuietLink>
      </>
    );
  }
  if (phase === 'off') {
    return (
      <>
        <Blank w={w} line={w.privateOff} />
        <SeenLine action="enable" w={wp} />
        <Action busy={busy === 'on'} disabled={busy !== null} onClick={() => void usePrivate.getState().turnOn()}>
          {busy === 'on' ? w.turningOn : w.turnOn}
        </Action>
      </>
    );
  }
  if (phase !== 'ready') return null;
  if (st.result) return <Result w={w} />;
  return <List w={w} owner={owner} signsV1={signsV1} held={held} feeSetting={feeSetting} />;
}

function Bones() {
  return (
    <div className={p.bones} aria-busy="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function List({ w, owner, signsV1, held, feeSetting }: { w: Words; owner: string; signsV1: boolean; held: unknown; feeSetting?: PayoutFeeSetting }) {
  const lang = useLang();
  const wp = useWords(PRIVATE);
  const st = usePayouts();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => parseList(st.text), [st.text]);
  const contacts = useMemo(() => contactsOf(st.ledger), [st.ledger]);
  const paid = useMemo(() => paidTo(st.ledger), [st.ledger]);
  const template = useMemo(() => templateOf(st.ledger), [st.ledger]);
  const checked = useMemo(
    () =>
      checkList({
        rows,
        owner,
        contacts,
        paid,
        registered: st.registered,
        way: st.way,
      }),
    [rows, owner, contacts, paid, st.registered, st.way],
  );
  const stops = useMemo(() => stopping(checked), [checked]);
  // Ryntra's fee as the server's settings set it (`RYNTRA_PRIVATE_PAYOUT_FEE_BPS`); none without them.
  const fee = useMemo(() => payoutFee(feeSetting), [feeSetting]);
  const paying = useMemo(() => checked.filter((r) => !stops.includes(r)), [checked, stops]);
  const plan = useMemo(
    () =>
      st.parts && st.can
        ? planPayout({
            rows: paying,
            coin: SOL.symbol,
            parts: st.parts,
            mergeOn: st.mergeOn,
            perTransfer: st.can.perTransfer,
            canMerge: st.can.canMerge && (st.mergeOn || st.can.canTurnMergeOn),
            fee,
          })
        : null,
    [paying, st.parts, st.can, st.mergeOn, fee],
  );

  // Recipients are read once the list stands still; the balance's parts again whenever the balance moved.
  const unread = useMemo(() => toRead(checked, st.registered).join(','), [checked, st.registered]);
  useEffect(() => {
    const timer = setTimeout(() => void usePayouts.getState().prepare(unread ? unread.split(',') : []), READ_AFTER_MS);
    return () => clearTimeout(timer);
  }, [unread]);
  useEffect(() => {
    void usePayouts.getState().prepare([], true);
  }, [held]);

  const total = plan?.total ?? totals(checked).get(SOL.symbol) ?? 0n;
  const people = paying.length;
  const noPrivate = checked.filter((r) => r.issues.includes('noPrivate')).length;
  const known = paying.every((r) => r.route !== null);
  const run = st.run;
  const ready = !run && rows.length > 0 && stops.length === 0 && known && plan !== null && plan.signatures > 0 && plan.short === 0n && !plan.stuck && !st.reading && signsV1;
  const fig = (units: bigint) => digits(unitsText(units, SOL.decimals), lang);

  const addDraft = () => {
    if (!draft.trim()) return;
    usePayouts.getState().add(draft);
    setDraft('');
    setAdding(false);
  };

  const box = (
    <div className={p.box}>
      <textarea
        className={p.input}
        aria-label={w.listLabel}
        placeholder={w.listHint}
        value={draft}
        rows={rows.length ? 3 : 5}
        spellCheck={false}
        autoComplete="off"
        translate="no"
        onChange={(event) => setDraft(event.target.value)}
      />
      <input
        ref={file}
        className={p.file}
        type="file"
        accept={LIST_FILE_ACCEPT}
        aria-label={w.fileLabel}
        onChange={async (event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked && picked.size <= LIST_FILE_MAX_BYTES) usePayouts.getState().add(await picked.text());
        }}
      />
    </div>
  );

  if (!rows.length) {
    return (
      <>
        <Blank w={w} />
        {template ? (
          <SayLine tall onSay={() => usePayouts.getState().setText(template)}>
            {w.sayLast}
          </SayLine>
        ) : null}
        {box}
        <div className={p.row}>
          <Quiet size="s" onClick={() => file.current?.click()}>
            {w.file}
          </Quiet>
        </div>
        <Action size="m" disabled={!draft.trim()} onClick={addDraft}>
          {w.addLines}
        </Action>
      </>
    );
  }

  return (
    <>
      <div className={p.head}>
        <Kick>{w.listLabel}</Kick>
        <span className={p.grow} />
        {PRIVATE_TEST ? <Chip>{w.net}</Chip> : null}
        <Info label={w.howTitle}>
          <span className={p.how}>
            <span>{w.how1}</span>
            <span>{w.how2}</span>
            <span>{w.how3}</span>
            <span>{w.how4}</span>
            <span>{w.how5}</span>
            {plan && plan.walletSol > 0n ? <span>{w.linkFees(fig(plan.walletSol))}</span> : null}
            <span>{w.netFee}</span>
            {PRIVATE_TEST ? <span>{w.how6}</span> : null}
          </span>
        </Info>
      </div>

      <ul className={p.list} aria-label={w.listLabel}>
        {checked.map((row) => (
          <Line key={row.id} row={row} w={w} lang={lang} locked={run !== null} />
        ))}
      </ul>

      {!run ? (
        adding ? (
          <>
            {box}
            <div className={p.row}>
              <Quiet size="s" disabled={!draft.trim()} onClick={addDraft}>
                {w.addLines}
              </Quiet>
              <Quiet size="s" onClick={() => file.current?.click()}>
                {w.file}
              </Quiet>
            </div>
          </>
        ) : (
          <div className={p.row}>
            <Quiet size="s" onClick={() => setAdding(true)}>
              {w.add}
            </Quiet>
          </div>
        )
      ) : null}

      <span className={p.grow} />

      <div className={p.sum}>
        <Kick>{w.toPay}</Kick>
        <div className={p.sumLine}>
          <Figure value={fig(total)} unit={SOL.symbol} size="m" />
          <span className={p.people}>· {w.people(people)}</span>
        </div>
      </div>

      {noPrivate > 0 && !run ? (
        <div className={p.way}>
          <p className={p.line}>{w.noPrivateLine(noPrivate)}</p>
          <Segment
            label={w.way}
            value={st.way}
            onChange={(way) => usePayouts.getState().setWay(way)}
            items={[
              { id: 'link', label: w.wayLink },
              { id: 'open', label: w.wayOpen },
            ]}
          />
          <p className={p.line} data-tone={st.way === 'open' ? 'warn' : undefined}>
            {st.way === 'open' ? w.wayOpenLine : w.wayLinkLine}
          </p>
        </div>
      ) : null}

      <PayoutSeen w={w} wp={wp} />

      <Status w={w} plan={plan} fee={fee} stops={stops.length} fig={fig} signsV1={signsV1} onAgain={() => void usePayouts.getState().prepare(unread ? unread.split(',') : [], true)} />

      <Action busy={run !== null} disabled={!ready} onClick={() => plan && void usePayouts.getState().pay({ rows: paying, plan, coin: SOL, fee })}>
        {run ? w[run.stage] : w.pay}
      </Action>
    </>
  );
}

/**
 * «Others see» for a payout, in the private balance's own look: who pays — seen; who receives — seen; how much — hidden.
 * The ring's default transfer writes each recipient's address as its output's open owner tag (checked on the SDK's own
 * build, `scripts/privacy/payouts-offline.mjs`, P2), so «to whom» is never said to be hidden here.
 */
function PayoutSeen({ w, wp }: { w: Words; wp: (typeof PRIVATE)['en'] }) {
  const parts: readonly (readonly [string, boolean])[] = [
    [wp.seenWho, true],
    [w.seenTo, true],
    [wp.seenAmount, false],
  ];
  return (
    <p className={ps.seen} aria-label={wp.seen}>
      <span>{wp.seen}:</span>
      {parts.map(([name, seen]) => (
        <span key={name} className={ps.seenPart}>
          {name} — <b className={seen ? ps.seenYes : ps.seenNo}>{seen ? wp.seenYes : wp.seenNo}</b>
        </span>
      ))}
    </p>
  );
}

/** The one line before the signature: what stops the payout, else the fee and the signatures. Its height is kept. */
function Status({ w, plan, fee, stops, fig, signsV1, onAgain }: { w: Words; plan: ReturnType<typeof planPayout> | null; fee: FeeRule; stops: number; fig: (u: bigint) => string; signsV1: boolean; onAgain: () => void }) {
  const wp = useWords(PRIVATE);
  const lang = useLang();
  const reading = usePayouts((st) => st.reading);
  const failed = usePayouts((st) => st.readFailed);
  const run = usePayouts((st) => st.run);
  let said: ReactNode;
  if (run) said = <span>{w.progress(Math.min(run.signed + 1, run.signatures), run.signatures)}</span>;
  else if (!signsV1) {
    said = (
      <>
        <span className={p.warn}>{w.noV1}</span>
        <QuietLink href="/private/check" size="s">
          {wp.checkWallet}
        </QuietLink>
      </>
    );
  } else if (stops > 0) said = <span className={p.stop}>{w.fix(stops)}</span>;
  else if (failed) {
    said = (
      <>
        <span className={p.stop}>{w.readFailed}</span>
        <Quiet size="s" onClick={onAgain}>
          {w.again}
        </Quiet>
      </>
    );
  } else if (!plan || reading) said = <span>{w.reading}</span>;
  else if (plan.stuck) said = <span className={p.stop}>{w.stuck}</span>;
  else if (plan.short > 0n) {
    said = (
      <>
        <span className={p.stop}>{w.short(fig(plan.short))}</span>
        <QuietLink href="/portfolio" size="s">
          {w.hideMore}
        </QuietLink>
      </>
    );
  } else said = <span>{feeText(w, fee, plan.fee, plan.signatures, fig, lang)}</span>;
  return (
    <div className={p.status} role="status">
      {said}
    </div>
  );
}

function Line({ row, w, lang, locked }: { row: CheckedRow; w: Words; lang: 'en' | 'uk'; locked: boolean }) {
  const issue = shownIssue(row);
  const tone = issue ? issueTone(issue) : null;
  const who = whoText(row);
  return (
    <li className={p.item} data-tone={tone ?? undefined}>
      <span className={p.who}>
        <span className={p.name} translate="no">
          {who}
        </span>
        {row.note ? <span className={p.note}>{row.note}</span> : null}
      </span>
      <span className={p.amount}>{row.units !== null ? `${digits(unitsText(row.units, SOL.decimals), lang)} ${row.coin}` : '—'}</span>
      <span className={p.flag}>{issue ? <Chip tone={tone === 'note' ? 'plain' : 'warn'}>{w[ISSUE_KEY[issue]] as string}</Chip> : null}</span>
      <button type="button" className={p.drop} aria-label={w.remove(who)} disabled={locked} onClick={() => usePayouts.getState().drop(row.line)}>
        <Icon name="close" size="s" />
      </button>
    </li>
  );
}

const STATE_KEY: Readonly<Record<LedgerLine['state'], keyof Words>> = {
  paid: 'statePaid',
  failed: 'stateFailed',
  waiting: 'stateWaiting',
};

function Result({ w }: { w: Words }) {
  const lang = useLang();
  const result = usePayouts((st) => st.result);
  const [copied, setCopied] = useState<string | null>(null);
  if (!result) return null;
  const { record, end, why, links } = result;
  const n = paidCount(record);
  const rest = unpaidOf({
    ...record,
    lines: record.lines.filter((l) => l.state === 'failed'),
  });
  return (
    <>
      <div className={p.done}>
        <Kick>{w.tab}</Kick>
        <h2 className={p.doneTitle}>{w.paidOf(n, record.lines.length)}</h2>
        {end !== 'done' ? <p className={end === 'unknown' ? p.warn : p.stop}>{end === 'unknown' ? w.unknown : why === 'refused' ? w.refused : w.failed}</p> : null}
      </div>
      <ul className={p.list}>
        {record.lines.map((line, i) => (
          <li key={i} className={p.item} data-tone={line.state === 'paid' ? undefined : line.state === 'failed' ? 'stop' : 'ask'}>
            <span className={p.who}>
              <span className={p.name} translate="no">
                {line.name ?? whoText({ name: null, to: line.to, address: line.to })}
              </span>
              {line.note ? <span className={p.note}>{line.note}</span> : null}
            </span>
            <span className={p.amount}>{`${digits(line.amount, lang)} ${line.coin}`}</span>
            <span className={p.flag}>
              <Chip tone={line.state === 'paid' ? 'ok' : 'warn'}>{line.how === 'link' && line.state === 'paid' ? w.howLink : (w[STATE_KEY[line.state]] as string)}</Chip>
            </span>
          </li>
        ))}
      </ul>
      {links.length ? (
        <div className={p.links}>
          <Kick>{w.linksTitle}</Kick>
          {links.map((link) => (
            <div key={link.url} className={p.linkRow}>
              <span className={p.grow} translate="no">
                {record.lines[link.line]?.name ??
                  whoText({
                    name: null,
                    to: record.lines[link.line]?.to ?? null,
                    address: null,
                  })}
              </span>
              <Quiet
                size="s"
                onClick={async () => {
                  if (await copyText(link.url)) setCopied(link.url);
                }}
              >
                {copied === link.url ? w.copied : w.copy}
              </Quiet>
            </div>
          ))}
        </div>
      ) : null}
      <span className={p.grow} />
      <div className={p.row}>
        <Quiet size="s" onClick={() => save(reportName(record.at), reportCsv([record], reportWords(w)), 'text/csv')}>
          {w.report}
        </Quiet>
        {end === 'done' ? (
          <Quiet
            size="s"
            onClick={() =>
              usePayouts.getState().again(
                unpaidOf({
                  ...record,
                  lines: record.lines.map((l) => ({
                    ...l,
                    state: 'failed' as const,
                  })),
                }),
              )
            }
          >
            {w.repeat}
          </Quiet>
        ) : rest ? (
          // Only lines that surely did not go: a line whose answer was lost is never offered again here.
          <Quiet size="s" onClick={() => usePayouts.getState().again(rest)}>
            {w.payRest}
          </Quiet>
        ) : null}
        <span className={p.grow} />
        <Quiet size="s" onClick={() => usePayouts.getState().again()}>
          {w.newPayout}
        </Quiet>
      </div>
    </>
  );
}

/** «Past payouts» beside the tab: each payout's day and people, its report, and «use as list». */
export function PayoutHistory() {
  const w = useWords(PAYOUTS);
  const wp = useWords(PRIVATE);
  const lang = useLang();
  const ledger = usePayouts((st) => st.ledger);
  const run = usePayouts((st) => st.run);
  const phase = usePrivate((st) => st.phase);
  const file = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState<string | null>(null);
  return (
    <Panel pad="none" label={w.history} className={p.historyPanel}>
      <div className={p.historyHead}>
        <Kick className={p.historyKick}>{w.history}</Kick>
      </div>
      <div className={p.history}>
        {ledger.length ? (
          <ul className={p.historyList}>
            {ledger.slice(0, 12).map((record: PayoutRecord) => (
              <li key={record.id} className={p.historyItem}>
                <span className={p.grow}>{w.historyRow(dateText(record.at, { day: 'numeric', month: 'short', year: 'numeric' }, lang), record.lines.length)}</span>
                <Quiet size="s" onClick={() => save(reportName(record.at), reportCsv([record], reportWords(w)), 'text/csv')}>
                  {w.report}
                </Quiet>
                <Quiet
                  size="s"
                  disabled={run !== null}
                  onClick={() =>
                    usePayouts.getState().again(
                      unpaidOf({
                        ...record,
                        lines: record.lines.map((l) => ({
                          ...l,
                          state: 'failed' as const,
                        })),
                      }),
                    )
                  }
                >
                  {w.asList}
                </Quiet>
              </li>
            ))}
          </ul>
        ) : (
          <p className={p.line}>{w.historyNone}</p>
        )}
        {phase === 'ready' ? (
          <div className={p.row}>
            <Quiet
              size="s"
              onClick={async () => {
                const owner = usePayouts.getState().owner;
                const text = await usePayouts.getState().keyCopyFile(wp.copyTitle);
                if (!text || !owner) return;
                save(`ryntra-private-${owner.slice(0, 6)}.txt`, text, 'text/plain');
                await usePrivate.getState().copySaved();
              }}
            >
              {w.keyCopy}
            </Quiet>
            <Quiet size="s" onClick={() => file.current?.click()}>
              {w.restore}
            </Quiet>
            <input
              ref={file}
              className={p.file}
              type="file"
              accept=".txt,text/plain"
              aria-label={w.restore}
              onChange={async (event) => {
                const picked = event.target.files?.[0];
                event.target.value = '';
                if (!picked) return;
                const added = await usePayouts.getState().restore(await picked.text());
                setSaid(added === null ? w.notRestored : w.restored(added));
              }}
            />
          </div>
        ) : null}
        {said ? (
          <p className={p.line} role="status">
            {said}
          </p>
        ) : null}
        <ReportAccess focus="out" />
      </div>
    </Panel>
  );
}
