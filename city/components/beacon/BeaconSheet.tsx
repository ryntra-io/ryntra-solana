'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  COOLDOWN_CHOICES, HOLD_CHOICES, PERIODS, TOWER_LIMIT, beaconOf, draftOf, firstDraft, isLit,
  type BeaconCondition, type BeaconKind, type BeaconRule, type Draft, type MovePeriod, type TowerRead,
} from '@/lib/world/beacons/rules';
import { conditionOf, lineText, periodText, readFor, ruleShown, suggestLine } from '@/city/lib/beacon/form';
import { BEACON } from '@/city/lib/beacon/words';
import { useWords, type TextKey } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { beaconsOn, useBeacons } from '@/city/lib/beacon/store';
import { BEACONS } from '@/city/lib/beacon/switch';
import type { Tower } from '@/city/lib/market/types';
import { cityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { CloseGlyph } from '../hud/glyphs';
import { TokenIcon, formatPrice, money, signed, sym } from '../hud/bits';
import { BeaconGlyph, TelegramGlyph } from './glyphs';
import s from './beacon.module.css';

type Op = 'above' | 'below';
type Row = { kind: BeaconKind; op: Op; period: MovePeriod; text: string };

type BeaconText = TextKey<typeof BEACON>;

const KINDS: readonly { kind: BeaconKind; label: BeaconText }[] = [
  { kind: 'price', label: 'price' },
  { kind: 'move', label: 'move' },
  { kind: 'liquidity', label: 'liquidity' },
];

const HOLD_LABEL: Readonly<Record<number, BeaconText>> = { 0: 'holdOff', 60: 'm1', 300: 'm5', 900: 'm15' };
const PAUSE_LABEL: Readonly<Record<number, BeaconText>> = { 300: 'm5', 3600: 'h1', 86_400: 'd1' };

const readOf = (t: Tower): TowerRead => ({ price: t.price, liquidity: t.liquidity, change5m: t.change5m, change1h: t.change1h, change24h: t.change24h });

function rowOf(c: BeaconCondition): Row {
  return { kind: c.kind, op: c.op, period: c.kind === 'move' ? c.period : '1h', text: lineText(c.value) };
}

function nowText(row: Pick<Row, 'kind' | 'period'>, read: TowerRead): string {
  const value = readFor(row.kind, row.period, read);
  return row.kind === 'move' ? signed(value) : row.kind === 'price' ? formatPrice(value) : money(value);
}

/**
 * The beacon editor over a tower: the line, above or below, and one amber action. Hold, pause, repeat and a second
 * condition («and» / «or») wait behind Details. Telegram is one quiet chip beside the action.
 */
export function BeaconSheet({ tower }: { tower: Tower }) {
  const rules = useBeacons((st) => st.rules);
  const states = useBeacons((st) => st.states);
  const telegram = useBeacons((st) => st.telegram);
  const signedIn = useBeacons((st) => st.signedIn);
  const close = useBeacons((st) => st.close);
  const readiness = useReadiness();
  const w = useWords(BEACON);
  const read = useMemo(() => readOf(tower), [tower]);
  const mine = useMemo(() => beaconsOn(rules, tower.id), [rules, tower.id]);

  const [editing, setEditing] = useState<string | null>(() => mine[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(() => (mine[0] ? draftOf(mine[0]) : firstDraft(read)));
  const [rows, setRows] = useState<Row[]>(() => draft.conditions.map(rowOf));
  const [details, setDetails] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');

  const pick = (rule: BeaconRule | null) => {
    const next = rule ? draftOf(rule) : firstDraft(read);
    setEditing(rule?.id ?? null);
    setDraft(next);
    setRows(next.conditions.map(rowOf));
    setPhase('idle');
  };

  // Another tower, or its beacons changed elsewhere: the editor follows what exists.
  useEffect(() => {
    if (editing && !mine.some((r) => r.id === editing)) pick(mine[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, editing]);

  const conditions = rows.map((r) => conditionOf(r.kind, r.op, r.period, r.text));
  const ready = conditions.every((c) => c !== null);
  const before = mine.find((r) => r.id === editing) ?? null;
  const full = !before && mine.length >= TOWER_LIMIT;

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((all) =>
      all.map((row, j) => {
        if (j !== i) return row;
        const next = { ...row, ...patch };
        // A new kind, side or period gets a line that makes sense for it, unless the person typed their own.
        if (patch.kind || patch.op || patch.period) next.text = lineText(suggestLine(next.kind, next.op, next.period, read));
        return next;
      }),
    );

  const save = async () => {
    if (!ready || full) return;
    const made = beaconOf({ ...draft, conditions: conditions as BeaconCondition[] }, tower, before, Date.now());
    if (!made) return;
    setPhase('saving');
    const list = before ? rules.map((r) => (r.id === before.id ? made : r)) : [...rules, made];
    await useBeacons.getState().save(list);
    setEditing(made.id);
    setPhase('saved');
  };

  const remove = async () => {
    if (!before) return;
    await useBeacons.getState().save(rules.filter((r) => r.id !== before.id));
    pick(null);
  };

  const onTelegram = async () => {
    if (telegram === 'linked') return setDraft((d) => ({ ...d, notify: !d.notify }));
    setDraft((d) => ({ ...d, notify: true }));
    if (!signedIn || readiness !== 'ready') {
      const ok = await cityAccount.getState().begin(null, 'card');
      if (!ok) return;
      await useBeacons.getState().pull(true);
      if (useBeacons.getState().telegram === 'linked') return;
    }
    await useBeacons.getState().linkTelegram();
  };

  const tgOn = draft.notify && telegram === 'linked';

  return (
    <div className={s.sheet} data-beacon-sheet role="dialog" aria-label={w.beaconOn(sym(tower))}>
      <div className={s.head}>
        <TokenIcon t={tower} className={s.icon} />
        <div className={s.title}>
          <div className={`${s.display} ${s.symbol}`}>{sym(tower)}</div>
          <div className={s.now}>{nowText(rows[0] ?? { kind: 'price', period: '1h' }, read)}</div>
        </div>
        <button className={s.close} aria-label={w.close} onClick={close}>
          <CloseGlyph />
        </button>
      </div>

      {mine.length > 0 && (
        <div className={s.list} role="tablist">
          {mine.map((rule) => (
            <button key={rule.id} role="tab" aria-selected={rule.id === editing} className={`${s.chip} ${rule.id === editing ? s.chipOn : ''}`} onClick={() => pick(rule)}>
              <span className={`${s.dot} ${isLit(rule, states[rule.id], Date.now()) ? s.dotLit : ''}`} aria-hidden="true" />
              <span className={s.chipText}>{ruleShown(rule)}</span>
            </button>
          ))}
          {mine.length < TOWER_LIMIT && (
            <button role="tab" aria-selected={editing === null} className={`${s.chip} ${s.chipNew} ${editing === null ? s.chipOn : ''}`} onClick={() => pick(null)} aria-label={w.newBeacon}>
              +
            </button>
          )}
        </div>
      )}

      <Condition row={rows[0]!} onChange={(patch) => setRow(0, patch)} big />

      {details && (
        <div className={s.details}>
          {rows[1] ? (
            <>
              <div className={s.pair}>
                {(['and', 'or'] as const).map((join) => (
                  <button key={join} className={`${s.seg} ${draft.join === join ? s.segOn : ''}`} onClick={() => setDraft((d) => ({ ...d, join }))}>
                    {join === 'and' ? w.and : w.or}
                  </button>
                ))}
                <button className={s.seg} aria-label={w.removeCondition} onClick={() => setRows((all) => all.slice(0, 1))}>
                  <CloseGlyph />
                </button>
              </div>
              <Condition row={rows[1]} onChange={(patch) => setRow(1, patch)} />
            </>
          ) : (
            <button className={s.add} onClick={() => setRows((all) => [...all, { kind: 'move', op: 'above', period: '1h', text: '5' }])}>
              {w.addCondition}
            </button>
          )}
          <Choice label={w.hold} values={HOLD_CHOICES} names={HOLD_LABEL} value={draft.holdSeconds} onPick={(holdSeconds) => setDraft((d) => ({ ...d, holdSeconds }))} />
          <Choice label={w.pause} values={COOLDOWN_CHOICES} names={PAUSE_LABEL} value={draft.cooldownSeconds} onPick={(cooldownSeconds) => setDraft((d) => ({ ...d, cooldownSeconds }))} />
          <div className={s.choice}>
            <span className={s.choiceLabel}>{w.repeat}</span>
            <div className={s.pair}>
              <button className={`${s.seg} ${draft.repeat ? s.segOn : ''}`} onClick={() => setDraft((d) => ({ ...d, repeat: true }))}>
                {w.always}
              </button>
              <button className={`${s.seg} ${!draft.repeat ? s.segOn : ''}`} onClick={() => setDraft((d) => ({ ...d, repeat: false }))}>
                {w.once}
              </button>
            </div>
          </div>
          {before && (
            <button className={s.remove} onClick={remove}>
              {w.removeBeacon}
            </button>
          )}
        </div>
      )}

      <div className={s.actions}>
        {/* Telegram only where the account keeps beacons (`NEXT_PUBLIC_RYNTRA_CITY_BEACONS=open`). */}
        {BEACONS === 'open' && (
          <button className={`${s.tg} ${tgOn ? s.tgOn : ''}`} onClick={onTelegram} aria-pressed={tgOn} aria-label={telegram === 'linked' ? w.telegram : w.connectTelegram}>
            <TelegramGlyph />
          </button>
        )}
        <button className={`${s.display} ${s.primary}`} onClick={save} disabled={!ready || full || phase === 'saving'}>
          <BeaconGlyph />
          {phase === 'saved' ? w.beaconSet : before ? w.saveBeacon : w.setBeacon}
        </button>
      </div>
      <button className={s.more} onClick={() => setDetails((v) => !v)} aria-expanded={details}>
        {w.details} <span aria-hidden="true">{details ? '▴' : '▾'}</span>
      </button>
    </div>
  );
}

function Condition({ row, onChange, big = false }: { row: Row; onChange: (patch: Partial<Row>) => void; big?: boolean }) {
  const valid = conditionOf(row.kind, row.op, row.period, row.text) !== null;
  const w = useWords(BEACON);
  return (
    <div className={big ? s.condition : `${s.condition} ${s.conditionSmall}`}>
      <div className={s.kinds}>
        {KINDS.map(({ kind, label }) => (
          <button key={kind} className={`${s.seg} ${row.kind === kind ? s.segOn : ''}`} onClick={() => row.kind !== kind && onChange({ kind })}>
            {w[label]}
          </button>
        ))}
      </div>
      <div className={s.pair}>
        {(['above', 'below'] as const).map((op) => (
          <button key={op} className={`${s.seg} ${row.op === op ? s.segOn : ''}`} onClick={() => row.op !== op && onChange({ op })}>
            {op === 'above' ? w.above : w.below}
          </button>
        ))}
        {row.kind === 'move' &&
          PERIODS.map((period) => (
            <button key={period} className={`${s.seg} ${s.segSmall} ${row.period === period ? s.segOn : ''}`} onClick={() => row.period !== period && onChange({ period })}>
              {periodText(period)}
            </button>
          ))}
      </div>
      <label className={`${s.line} ${valid ? '' : s.lineWrong}`}>
        <span className={s.unit}>{row.kind === 'move' ? '%' : '$'}</span>
        <input
          className={`${s.display} ${s.lineInput}`}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={w.level}
          value={fieldText(row.text)}
          onChange={(e) => onChange({ text: fieldValue(e.target.value) })}
        />
      </label>
    </div>
  );
}

function Choice({ label, values, names, value, onPick }: { label: string; values: readonly number[]; names: Readonly<Record<number, BeaconText>>; value: number; onPick: (v: number) => void }) {
  const w = useWords(BEACON);
  return (
    <div className={s.choice}>
      <span className={s.choiceLabel}>{label}</span>
      <div className={s.pair}>
        {values.map((v) => (
          <button key={v} className={`${s.seg} ${s.segSmall} ${value === v ? s.segOn : ''}`} onClick={() => onPick(v)}>
            {names[v] ? w[names[v]] : v}
          </button>
        ))}
      </div>
    </div>
  );
}
