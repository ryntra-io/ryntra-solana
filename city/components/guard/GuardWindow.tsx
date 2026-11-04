'use client';

import { useState } from 'react';
import { headline, readInput, type WardCheckResponse, type WardReason } from '@/city/lib/guard/check';
import { useGuard } from '@/city/lib/guard/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useWallet } from '@/city/lib/trade/wallet';
import { ChevronGlyph, Emblem, PasteGlyph, VerdictGlyph } from './glyphs';
import { GUARD } from './words';
import s from './guard.module.css';

type Words = (typeof GUARD)['en'];

const short = (address: string) => (address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address);

/** The engine's sentence with every address shortened to the four-and-four a person checks by eye. */
const readable = (text: string) => text.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, short);

/** A signed amount in its asset's units, without rounding it into something it is not. */
function amount(raw: string, decimals: number | null): string {
  const negative = raw.startsWith('-');
  const value = BigInt(negative ? raw.slice(1) : raw);
  if (decimals === null) return `${negative ? '−' : '+'}${value}`;
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toLocaleString('en-US');
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6);
  return `${negative ? '−' : '+'}${whole}${fraction ? `.${fraction}` : ''}`;
}

function title(reason: WardReason, w: Words, english: boolean): string {
  return english ? reason.line : ((w as Record<string, unknown>)[reason.code] as string | undefined) ?? reason.line;
}

/** The one line under the verdict: the heaviest reason, or — with none against it — that, and how much was not read. */
function lineOf(result: WardCheckResponse, w: Words, english: boolean): string {
  if (result.verdict === 'allow') return result.notRead > 0 ? `${w.allowPartial} · ${w.notRead(result.notRead)}` : w.allowLine;
  const top = headline(result)[0];
  return top ? title(top, w, english) : w.allowLine;
}

function Verdict({ result }: { result: WardCheckResponse }) {
  const w = useWords(GUARD);
  const english = useLang() === 'en';
  const [open, setOpen] = useState(false);
  const verdict = result.verdict;
  const changes = result.effects.changes;
  return (
    <div className={s.result} data-guard-verdict={verdict}>
      <div className={`${s.verdict} ${s[verdict]}`} role="status" aria-live="polite">
        <span className={s.verdictMark}>
          <VerdictGlyph verdict={verdict} />
        </span>
        <span className={s.verdictWord}>{w[verdict]}</span>
      </div>
      <p className={s.line}>{lineOf(result, w, english)}</p>

      <button type="button" className={s.disclose} aria-expanded={open} onClick={() => setOpen((value) => !value)} data-guard-details="">
        <span>{open ? w.hideDetails : w.details}</span>
        <ChevronGlyph open={open} />
      </button>

      {open ? (
        <div className={s.details}>
          <ul className={s.reasons} aria-label={w.reasons}>
            {result.reasons.map((reason, at) => (
              <li key={`${reason.code}-${at}`} className={`${s.reason} ${s[`level_${reason.level}`]}`}>
                <span className={s.dot} aria-hidden="true" />
                <div>
                  <b>{title(reason, w, english)}</b>
                  {/* The engine writes its reasons in English; another language reads the title and the addresses. */}
                  {english && reason.detail ? <p>{readable(reason.detail)}</p> : null}
                  {reason.accounts.length > 0 ? (
                    <p className={s.accounts} translate="no">
                      {reason.accounts.slice(0, 3).map(short).join(' · ')}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <div className={s.moves}>
            <h3>{w.moves}</h3>
            {result.effects.simulated || changes.length > 0 ? (
              <dl>
                {changes.map((change, at) => (
                  <div key={`${change.holder}-${change.mint ?? 'sol'}-${at}`} className={s.move}>
                    <dt>{change.kind === 'you' ? w.you : `${change.kind === 'program' ? w.program : w.wallet} ${short(change.holder)}`}</dt>
                    <dd className={change.raw.startsWith('-') ? s.out : s.in} translate="no">
                      {amount(change.raw, change.decimals)} {change.symbol ?? short(change.mint ?? '')}
                    </dd>
                  </div>
                ))}
                {result.effects.feeLamports ? (
                  <div className={s.move}>
                    <dt>{w.fee}</dt>
                    <dd translate="no">{amount(result.effects.feeLamports, 9).replace('+', '')} SOL</dd>
                  </div>
                ) : null}
                {result.effects.rentLamports && result.effects.rentLamports !== '0' ? (
                  <div className={s.move}>
                    <dt>{w.rent}</dt>
                    <dd translate="no">{amount(result.effects.rentLamports, 9).replace('+', '')} SOL</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className={s.muted}>{w.notSimulated}</p>
            )}
          </div>
          <p className={s.muted}>{w.readOnly}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Guard window's contents (CITY-152): paste a transaction or a link — one field, one action — and read the
 * verdict in one word and one line; the reasons, the changes and the sources wait behind «Details». The engine's
 * pre-sign check only reads: nothing here asks the wallet for anything.
 */
export default function GuardWindow() {
  const w = useWords(GUARD);
  const text = useGuard((st) => st.text);
  const intent = useGuard((st) => st.intent);
  const intentOpen = useGuard((st) => st.intentOpen);
  const phase = useGuard((st) => st.phase);
  const result = useGuard((st) => st.result);
  const failure = useGuard((st) => st.failure);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const checking = phase === 'checking';
  const ready = readInput(text) !== null;

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (value) useGuard.getState().setText(value);
    } catch {
      /* The browser refused the clipboard: the field still takes a paste by hand. */
    }
  };

  if (phase === 'done' && result) {
    return (
      <div className={s.framed} aria-label={w.title}>
        <Verdict result={result} />
        <div className={s.dock}>
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => useGuard.getState().reset()} data-guard-another="">
            {w.another}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={s.framed}
      aria-label={w.title}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !checking) void useGuard.getState().check(owner);
      }}
    >
      <div className={`${s.hero} ${text ? s.heroSmall : ''}`}>
        <span className={s.emblem}>
          <Emblem />
        </span>
        <h2 className={`${s.display} ${s.lead}`}>{w.lead}</h2>
      </div>

      <div className={s.field}>
        <textarea
          className={s.paste}
          value={text}
          placeholder={w.paste}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={4}
          onChange={(event) => useGuard.getState().setText(event.target.value)}
          aria-label={w.paste}
          data-guard-input=""
        />
        <div className={s.fieldTools}>
          {text ? (
            <button type="button" className={s.tool} onClick={() => useGuard.getState().reset()}>
              {w.clear}
            </button>
          ) : (
            <button type="button" className={s.tool} onClick={() => void paste()}>
              <PasteGlyph />
              <span>{w.pasteButton}</span>
            </button>
          )}
        </div>
      </div>

      <button type="button" className={s.intentToggle} aria-expanded={intentOpen} onClick={() => useGuard.getState().toggleIntent()} data-guard-intent-toggle="">
        <span>{w.intent}</span>
        <ChevronGlyph open={intentOpen} />
      </button>
      {intentOpen ? (
        <input
          className={s.intent}
          value={intent}
          placeholder={w.intentHint}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => useGuard.getState().setIntent(event.target.value)}
          aria-label={w.intent}
          data-guard-intent=""
        />
      ) : null}

      {phase === 'failed' && failure ? (
        <p className={s.failure} role="alert">
          {w[failure]}
        </p>
      ) : null}

      <div className={s.dock}>
        <button type="submit" className={`${s.display} ${s.action} ${checking ? s.waiting : ''}`} disabled={!ready || checking} data-guard-check="">
          {checking ? w.checking : phase === 'failed' ? w.tryAgain : w.check}
        </button>
      </div>
    </form>
  );
}
