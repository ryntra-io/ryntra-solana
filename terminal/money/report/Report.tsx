'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { usePrivateInvoices } from '@/lib/privacy/invoices/usePrivateInvoices';
import { explorerUrl } from '@/lib/privacy/network';
import { usePayouts } from '@/lib/privacy/payouts/usePayouts';
import { giveAccess, giveAgain, grantId, journalOrder, takeAccess, type Grant } from '@/lib/privacy/report/access';
import { backupFileName } from '@/lib/privacy/report/backup';
import { canReceipt, receiptFileName, receiptText } from '@/lib/privacy/report/receipt';
import { ALL_TIME, CSV_STYLE, UNITS, inPeriod, localOffset, periodOf, reportCsv, reportFileName, reportRows, stamp, totalsOf, type Period, type ReportRow, type Unit } from '@/lib/privacy/report/report';
import { backupText, readJournal, readSources, restoreBackup, writeJournal, type Sources } from '@/lib/privacy/report/store.client';
import { Chip, Figure, Icon, Info, Kick, Quiet, Shares } from '@/terminal/ui';
import { SHOWN_ROWS, csvWords, leadOf, periodName, receiptWords, rowName, unitNames, type Focus } from './report-view';
import { REPORT_WORDS } from './words';
import s from '@/terminal/swap/swap.module.css';
import r from './report.module.css';

type Words = (typeof REPORT_WORDS)['en'];
type Lang = ReturnType<typeof useLang>;

function save(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EMPTY: Sources = { payouts: [], invoices: [] };

/** «1 Oct 2026 – 31 Oct 2026», or «All». */
function periodText(period: Period, w: Words, lang: Lang): string {
  if (period.to === ALL_TIME.to) return w.pAll;
  const day = (at: number) => dateText(at, { day: 'numeric', month: 'short', year: 'numeric' }, lang);
  return `${day(period.from)} – ${day(period.to - 1)}`;
}

/**
 * «Report» and «Accountant access» (decision 110; probe 2 — `docs/research/private-payments-2026-11-19/PROBE-2.md`):
 * two quiet presses under the person's record, each opening in place.
 *
 * - «Report»: a period, the period's figure — one number — and its payments, each with its receipt; the table to
 *   download; the record's own copy to save and to open.
 * - «Accountant access»: one line before the person agrees — what the accountant will see, and that what is given
 *   cannot be taken back; then the period's table goes to the named person, and the journal of whom and when stays here.
 *
 * Everything is read from and written to this browser; nothing goes to a server, nothing signs. Only with the private
 * balance's flag: it stands inside «Payouts» and private «Invoices», which stand only then.
 */
export function ReportAccess({ focus }: { focus: Focus }) {
  const w = useWords(REPORT_WORDS);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const ledger = usePayouts((st) => st.ledger);
  const kept = usePrivateInvoices((st) => st.kept);
  const [open, setOpen] = useState<'report' | 'access' | null>(null);
  const [sources, setSources] = useState<Sources>(EMPTY);
  const [journal, setJournal] = useState<Grant[]>([]);
  const [unit, setUnit] = useState<Unit>('month');
  const [shift, setShift] = useState(0);

  const load = useCallback(async () => {
    if (!owner) return;
    const [read, list] = await Promise.all([readSources(owner), readJournal(owner)]);
    if (useWallet.getState().connection?.address !== owner) return;
    setSources(read);
    setJournal(list);
  }, [owner]);

  // Read again when opened, when the wallet changes, and whenever a payout or an invoice is written.
  useEffect(() => {
    setSources(EMPTY);
    setJournal([]);
  }, [owner]);
  useEffect(() => {
    if (open) void load();
  }, [open, load, ledger, kept]);

  const rows = useMemo(() => reportRows(sources.payouts, sources.invoices), [sources]);
  if (!owner) return null;

  const toggle = (which: 'report' | 'access') => setOpen((was) => (was === which ? null : which));
  const period = periodOf(unit, Date.now(), shift);
  const shown = inPeriod(rows, period);
  const table = () => reportCsv(shown, csvWords(w), CSV_STYLE[lang], localOffset);
  const pick: PickProps = {
    unit,
    shift,
    name: periodName(unit, period, w, (at) => dateText(at, { month: 'long', year: 'numeric' }, lang)),
    onUnit: (next) => {
      setUnit(next);
      setShift(0);
    },
    onShift: setShift,
  };

  return (
    <div className={r.wrap}>
      <div className={r.acts}>
        <Quiet size="s" aria-expanded={open === 'report'} onClick={() => toggle('report')}>
          {w.report}
        </Quiet>
        <Quiet size="s" aria-expanded={open === 'access'} onClick={() => toggle('access')}>
          {w.access}
        </Quiet>
      </div>
      {open === 'report' ? (
        <ReportPane w={w} lang={lang} focus={focus} owner={owner} rows={rows} shown={shown} pick={pick} table={table} period={period} onRestored={load} />
      ) : null}
      {open === 'access' ? (
        <AccessPane
          w={w}
          lang={lang}
          pick={pick}
          journal={journal}
          onGive={async (who) => {
            const at = Date.now();
            const next = giveAccess(journal, { id: grantId(at, crypto.getRandomValues(new Uint32Array(1))[0]!), who, period, at });
            if (!next) return false;
            save(reportFileName(period, at, localOffset), table(), 'text/csv;charset=utf-8');
            await writeJournal(owner, next);
            setJournal(next);
            return true;
          }}
          onAgain={async (grant) => {
            const at = Date.now();
            const next = giveAgain(journal, grant.id, at);
            if (!next) return;
            save(reportFileName(grant.period, at, localOffset), reportCsv(inPeriod(rows, grant.period), csvWords(w), CSV_STYLE[lang], localOffset), 'text/csv;charset=utf-8');
            await writeJournal(owner, next);
            setJournal(next);
          }}
          onTake={async (grant) => {
            const next = takeAccess(journal, grant.id, Date.now());
            await writeJournal(owner, next);
            setJournal(next);
          }}
        />
      ) : null}
    </div>
  );
}

type PickProps = Readonly<{ unit: Unit; shift: number; name: string; onUnit: (unit: Unit) => void; onShift: (shift: number) => void }>;
type PeriodsProps = Readonly<{ pick: PickProps }>;

/** The period: how long (month, quarter, year, all), and which one — back and forth by quiet arrows, never past now. */
function PeriodPick({ pick, w }: { pick: PickProps; w: Words }) {
  const names = unitNames(w);
  return (
    <div className={r.period}>
      <Shares label={w.period} options={UNITS.map((id) => ({ id, label: names[id] }))} value={pick.unit} onPick={pick.onUnit} />
      {pick.unit !== 'all' ? (
        <div className={r.step}>
          <Quiet size="s" aria-label={w.earlier} onClick={() => pick.onShift(pick.shift - 1)}>
            <Icon name="back" size="s" />
          </Quiet>
          <span className={r.stepName}>{pick.name}</span>
          <Quiet size="s" aria-label={w.later} disabled={pick.shift >= 0} onClick={() => pick.onShift(Math.min(0, pick.shift + 1))}>
            <Icon name="arrow" size="s" />
          </Quiet>
        </div>
      ) : null}
    </div>
  );
}

function ReportPane({
  w,
  lang,
  focus,
  owner,
  rows,
  shown,
  pick,
  table,
  period,
  onRestored,
}: PeriodsProps & { w: Words; lang: Lang; focus: Focus; owner: string; rows: readonly ReportRow[]; shown: readonly ReportRow[]; table: () => string; period: Period; onRestored: () => Promise<void> }) {
  const file = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState<string | null>(null);
  const lead = leadOf(totalsOf(shown), focus);
  const listed = shown.filter((row) => row.kind !== 'fee' && row.state === 'paid').slice(-SHOWN_ROWS).reverse();
  const fig = (sum: string) => digits(sum, lang);

  const restore = async (text: string) => {
    const added = await restoreBackup(owner, text);
    setSaid(added === null ? w.notRestored : w.restored(added));
    if (added) {
      // The screens beside read their record again.
      const payouts = usePayouts.getState();
      if (payouts.owner === owner) usePayouts.setState({ ledger: (await readSources(owner)).payouts });
      const invoices = usePrivateInvoices.getState();
      if (invoices.owner === owner) {
        invoices.follow(null);
        invoices.follow(owner);
      }
      await onRestored();
    }
  };

  return (
    <section className={r.pane} aria-label={w.report}>
      {rows.length ? (
        <>
          <PeriodPick pick={pick} w={w} />
          <div className={r.lead}>
            <Kick>{focus === 'out' ? w.paidOut : w.received}</Kick>
            <Figure value={fig(lead.sum)} unit={lead.coin} size="m" />
            <span className={r.line}>
              {w.payments(lead.count)}
              {lead.other ? ` · ${(focus === 'out' ? w.alsoIn : w.alsoOut)(`${fig(lead.other.sum)} ${lead.other.coin}`)}` : ''}
            </span>
          </div>
          {listed.length ? (
            <ul className={r.list}>
              {listed.map((row) => {
                const who = rowName(row, w.invoice);
                return (
                  <li key={row.ref} className={r.item}>
                    <span className={r.who} translate="no">
                      {who}
                    </span>
                    <span className={r.amount}>{`${row.kind === 'invoice' ? '+' : ''}${fig(row.amount)} ${row.coin}`}</span>
                    {canReceipt(row) ? (
                      <Quiet
                        size="s"
                        aria-label={w.receiptFor(who)}
                        onClick={() => {
                          const offset = localOffset(row.at);
                          const text = receiptText(row, owner, receiptWords(w), row.signature ? explorerUrl('tx', row.signature) : null, offset);
                          if (text) save(receiptFileName(row, offset), text, 'text/plain;charset=utf-8');
                        }}
                      >
                        {w.receipt}
                      </Quiet>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={r.line}>{w.emptyPeriod}</p>
          )}
        </>
      ) : null}
      <div className={r.acts}>
        {rows.length ? (
          <Quiet size="s" disabled={!shown.length} onClick={() => save(reportFileName(period, Date.now(), localOffset), table(), 'text/csv;charset=utf-8')}>
            {w.download}
          </Quiet>
        ) : null}
        {rows.length ? (
          <Quiet
            size="s"
            onClick={async () => {
              const now = Date.now();
              const text = await backupText(owner, now);
              if (!text) return setSaid(w.nothingToSave);
              save(backupFileName(owner, stamp(now, localOffset(now)).slice(0, 10)), text, 'application/json');
            }}
          >
            {w.saveCopy}
          </Quiet>
        ) : null}
        <Quiet size="s" onClick={() => file.current?.click()}>
          {w.openCopy}
        </Quiet>
        <input
          ref={file}
          className={r.file}
          type="file"
          accept=".json,application/json"
          aria-label={w.pickCopy}
          onChange={async (event) => {
            const picked = event.target.files?.[0];
            event.target.value = '';
            if (picked && picked.size <= 4 * 1024 * 1024) await restore(await picked.text());
          }}
        />
        <span className={r.grow} />
        <Info label={w.aboutReport}>
          <span className={r.how}>
            <span>{w.r1}</span>
            <span>{w.r2}</span>
            <span>{w.r3}</span>
            <span>{w.r4}</span>
          </span>
        </Info>
      </div>
      {said ? (
        <p className={r.line} role="status">
          {said}
        </p>
      ) : null}
    </section>
  );
}

function AccessPane({
  w,
  lang,
  pick,
  journal,
  onGive,
  onAgain,
  onTake,
}: PeriodsProps & { w: Words; lang: Lang; journal: readonly Grant[]; onGive: (who: string) => Promise<boolean>; onAgain: (grant: Grant) => Promise<void>; onTake: (grant: Grant) => Promise<void> }) {
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const day = (at: number) => dateText(at, { day: 'numeric', month: 'short' }, lang);
  const ordered = journalOrder(journal);
  return (
    <section className={r.pane} aria-label={w.access}>
      <p className={r.consent}>{w.consent}</p>
      <label className={s.big}>
        <span className={s.bigHead}>
          <Kick>{w.who}</Kick>
        </span>
        <input className={s.text} value={who} maxLength={60} onChange={(event) => setWho(event.target.value)} placeholder={w.whoHint} autoComplete="off" disabled={busy} />
      </label>
      <PeriodPick pick={pick} w={w} />
      <div className={r.acts}>
        <Quiet
          size="s"
          disabled={!who.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (await onGive(who)) setWho('');
            } finally {
              setBusy(false);
            }
          }}
        >
          {w.give}
        </Quiet>
        <span className={r.grow} />
        <Info label={w.aboutAccess}>
          <span className={r.how}>
            <span>{w.a1}</span>
            <span>{w.a2}</span>
            <span>{w.a3}</span>
          </span>
        </Info>
      </div>
      <Kick>{w.given}</Kick>
      {ordered.length ? (
        <ul className={r.list}>
          {ordered.map((grant) => (
            <li key={grant.id} className={r.grant}>
              <span className={r.grantWords}>
                <b translate="no">{grant.who}</b>
                <span>
                  {w.grantLine(periodText(grant.period, w, lang), day(grant.given[grant.given.length - 1]!))}
                  {grant.given.length > 1 ? ` · ${w.files(grant.given.length)}` : ''}
                </span>
              </span>
              <span className={r.grantActs}>
                <Chip tone={grant.taken === null ? 'ok' : 'plain'}>{grant.taken === null ? w.standing : w.taken}</Chip>
                {grant.taken === null ? (
                  <>
                    <Quiet size="s" onClick={() => void onAgain(grant)}>
                      {w.newFile}
                    </Quiet>
                    <Quiet size="s" onClick={() => void onTake(grant)}>
                      {w.take}
                    </Quiet>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={r.line}>{w.journalNone}</p>
      )}
    </section>
  );
}
