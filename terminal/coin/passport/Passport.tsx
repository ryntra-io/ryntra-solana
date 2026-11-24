'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Info } from '@/terminal/ui';
import { factRows, headFigures, riskLine, riskSentence, type CoinPassport } from './passport-data';
import type { PassportStatus } from './usePassport';
import { PASSPORT } from './words';
import p from './passport.module.css';

/**
 * The head's row of the coin's passport: the figures the head lacks, a word over a number with quiet rules
 * between, as the head writes its own — the full value, the moves over five minutes, an hour and six hours, the people
 * who traded in the day, the age. It takes the room its place gives it and lets the least read figures go first when
 * the room is short; on a phone it stands as two even rows of three. Nothing is cut and nothing wraps.
 */
export function PassportFigures({ passport, status = 'ready' }: { passport: CoinPassport | null; status?: PassportStatus }) {
  const w = useWords(PASSPORT);
  const lang = useLang();
  const reading = !passport && status === 'reading';
  // A phone's two rows of three keep every cell where it stood while the passport was read — an unknown figure says «—»
  // there — so the cells never trade places as the reads come in. A desk lets the unknown go.
  const keep = useNarrow();
  return (
    <div className={p.row}>
      <dl className={p.figures} aria-label={w.figures} aria-busy={reading || undefined}>
        {headFigures(passport, lang)
          .filter((figure) => reading || keep || figure.value !== w.unknown)
          .map((figure) => (
          <div key={figure.key} className={p.figure} data-rank={figure.rank} data-key={figure.key}>
            <dt title={figure.key === 'fdv' ? w.fdvWhy : undefined}>{figure.label}</dt>
            <dd data-tone={figure.tone}>{reading ? <span className={p.bone} aria-hidden="true" /> : figure.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The one sentence of risk (`riskSentence`) with its quiet sign; none worth a look — nothing at all. */
export function PassportRiskSentence({ passport }: { passport: CoinPassport | null }) {
  const w = useWords(PASSPORT);
  const lang = useLang();
  const text = riskSentence(passport, lang);
  if (!text) return null;
  return (
    <p className={p.sentence} role="note">
      <span className={p.sign} role="img" aria-label={w.attention} title={w.attention} />
      <span>{text}</span>
    </p>
  );
}

/**
 * The risk line for the place by the buy button: three or four short facts in plain words, what is worth a
 * look first, with one quiet sign when any is; every fact behind «i». It says what stands and never what to do.
 */
export function PassportRisk({ passport, status = 'ready' }: { passport: CoinPassport | null; status?: PassportStatus }) {
  const w = useWords(PASSPORT);
  const lang = useLang();
  if (!passport) {
    if (status === 'reading') {
      return (
        <div className={p.line} aria-busy="true" aria-label={w.risk}>
          <span className={p.boneLine} aria-hidden="true" />
          <span className={p.boneLine} aria-hidden="true" />
          <span className={p.boneLine} aria-hidden="true" />
        </div>
      );
    }
    return (
      <div className={p.line}>
        <p className={p.failed}>{w.riskFailed}</p>
      </div>
    );
  }
  const line = riskLine(passport, lang);
  const rows = factRows(passport, lang);
  if (!line.items.length) return null;
  return (
    <div className={p.line} role="group" aria-label={w.risk}>
      <ul className={p.items}>
        {line.items.map((item) => (
          <li key={item.key} className={p.item} data-tone={item.tone === 'warn' ? 'warn' : undefined}>
            {item.text}
          </li>
        ))}
      </ul>
      <span className={p.side}>
        {line.attention ? <span className={p.sign} role="img" aria-label={w.attention} title={w.attention} /> : null}
        <Info label={w.riskMore}>
          <span className={p.list}>
            {rows.map((row) => (
              <span key={row.key} className={p.listRow}>
                <span className={p.listWord}>{row.label}</span>
                <span className={p.listValue} data-tone={row.tone}>
                  {row.value}
                </span>
              </span>
            ))}
          </span>
        </Info>
      </span>
    </div>
  );
}
