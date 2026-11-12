'use client';

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { checkLaunchForm, type FieldProblem } from '@/lib/launch/form';
import { shrinkPicture } from '@/lib/launch/picture.client';
import type { LaunchPresetView } from '@/lib/api/v1/contract';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { openBerth } from '@/city/lib/launch/berth-store';
import { landed, launchEngine, launchPrep, launchWallet, useLaunch } from '@/city/lib/launch/district';
import { failureWords, pictureRefused, readRefusal, runLaunch, type LaunchFailure, type Phase } from '@/city/lib/launch/flow';
import { runEarlyAccess } from '@/city/lib/launch/early-flow';
import { earlyDoorOpen, earlyRules } from '@/city/lib/launch/early';
import { othersOf, shareOpen, shareProblem, sharesOf, type ShareRow } from '@/city/lib/launch/share';
import { openMoney } from '@/city/lib/money/open';
import { REFUSAL_WORDS } from '@/city/lib/launch/words';
import { shortAddress } from '@/city/lib/launch/format';
import { cityPresets } from '@/city/lib/launch/gate';
import { cityShieldOpen, shieldServed } from '@/city/lib/launch/shield';
import { FIELDS_REFUSED, fieldsKey, type PrepFields } from '@/city/lib/launch/prepare';
import { costLine, launchFacts, reviewRows, shieldLine } from '@/city/lib/launch/terms';
import type { WalletOption } from '@/city/lib/launch/wallet';
import { useLang } from '@/city/lib/i18n/lang';
import { useWords, type Same } from '@/city/lib/i18n/dict';
import { BerthGlyph } from '../berth/glyphs';
import { tickerAfterName } from '@/city/lib/launch/ticker';
import { LaunchPreview } from './LaunchPreview';
import { EarlyDoor, EarlyFacts, OpenedCard, ShareDoor } from './LaunchDoors';
import s from './launch.module.css';
import { LAUNCH } from './words';

type W = Same<(typeof LAUNCH)['en']>;

const BACK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

/** The fields stay still this long before they go to the engine's store in the background. */
const STORE_AFTER_MS = 900;
/** No split: the same empty list every render. */
const NO_SHARES: readonly ShareRow[] = [];
/** The kinds of picture every wallet shows (`shrinkPicture` reads the file itself). */
const PICTURES = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * «Raise your tower» (CITY-143, `docs/research/ryntra-launch-2026-10-29/SPEC.md` «Створення»): the cost line first; a
 * picture, a name and a ticker over a live preview of the tower; then the rules — the bot shield, two facts and one line
 * of who gets what, the rest behind «i»; then one signature in the creator's wallet. The rules of the fields are the
 * engine's own (`checkLaunchForm`), so the sheet says at once what the engine would refuse; the picture goes to the
 * engine's store while the creator types, and the engine simulates the launch before the press (`prepare.ts`). The
 * sheet decides nothing for the creator and holds no key.
 *
 * Since CITY-242 the sheet is the contents of a window of the city's one frame (`LaunchLayer`), as every other place of
 * the Deck: the frame brings the title, «Close», the moving and the phone's sheet, and the Deck stays where it is.
 */
export function LaunchSheet() {
  const step = useLaunch((st) => st.step);
  const preset = useLaunch((st) => st.preset);
  const network = useLaunch((st) => st.network);
  const stub = useLaunch((st) => st.stub);
  const close = useLaunch((st) => st.closeSheet);
  const w = useWords(LAUNCH);
  if (!preset || !network) return null;
  return (
    <div className={s.framed} aria-label={step === 'form' ? w.raise : w.review} data-launch-sheet="">
      {step === 'form' ? <FormStep /> : <ReviewStep onClose={close} />}
      {(network === 'solana:devnet' || stub) && (
        <div className={s.netLine}>
          {stub ? w.stubLine : w.devnetLine}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the three fields */

function FormStep() {
  const draft = useLaunch((st) => st.draft);
  const setDraft = useLaunch((st) => st.setDraft);
  const setStep = useLaunch((st) => st.setStep);
  const preset = useLaunch((st) => st.preset)!;
  const w = useWords(LAUNCH);
  const [attempted, setAttempted] = useState(false);
  const [pictureBad, setPictureBad] = useState(false);
  const check = useMemo(() => checkLaunchForm({ name: draft.name, symbol: draft.symbol, description: '', website: '', x: '', telegram: '' }), [draft.name, draft.symbol]);
  const ids = { name: useId(), symbol: useId(), picture: useId() };
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* A finger gets two doors to the picture, the camera first (CITY-168); a mouse keeps the one file picker. */
  const [touch] = useState(() => window.matchMedia?.('(pointer: coarse)').matches === true);
  useEffect(() => {
    /* A desk types at once; a phone opens its keyboard only on a tap. */
    if (window.matchMedia?.('(pointer: fine)').matches) nameRef.current?.focus({ preventScroll: true });
  }, []);

  const choosePicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const picture = await shrinkPicture(file);
    setPictureBad(!picture);
    if (picture) setDraft({ picture });
  };
  const symbol = check.clean.symbol;
  const fieldsValid = Object.keys(check.problems).length === 0;
  const { fields, refused } = usePrepared(fieldsValid ? check.clean.name : null, fieldsValid ? symbol : null);
  /* The fields go to the engine's store once they stand still; its refusal of the picture or the name shows at once. */
  useEffect(() => {
    if (!fields) return;
    const timer = setTimeout(() => void launchPrep().store(fields, { background: true }), STORE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [fields]);
  const problem = firstProblem(w, check, draft.picture !== null, pictureBad, attempted, refused);
  const valid = fieldsValid && draft.picture !== null && !refused;
  const review = () => {
    setAttempted(true);
    if (valid) setStep('review');
  };
  const rise = ((draft.picture ? 1 : 0) + (!check.problems.name ? 1 : 0) + (!check.problems.symbol ? 1 : 0)) / 3;
  /* The engine refused the picture itself: the one action is another picture. */
  const newPicture = refused !== null && pictureRefused(refused);

  return (
    <>
      {/* The window's head carries the title and «Close»: the cost line comes first, the creator's berth beside it
          (CITY-141: what their launches earned and «Забрати», one quiet tap from the sheet). */}
      <div className={s.costHead}>
        <CostLine preset={preset} />
        <button className={`${s.close} ${s.berth}`} aria-label={w.myBerth} data-hint={w.myBerth} data-launch-berth="" onClick={() => openBerth()}>
          <BerthGlyph />
        </button>
      </div>
      <LaunchPreview
        inputId={ids.picture}
        picture={draft.picture?.url ?? null}
        symbol={check.problems.symbol === 'SYMBOL_CHARS' ? '' : symbol}
        name={check.clean.name}
        rise={rise}
        bad={problem?.field === 'picture'}
        words={w}
        doors={
          touch
            ? {
                camera: <input className={s.file} type="file" accept="image/*" capture="environment" onChange={choosePicture} aria-label={w.takePhoto} data-launch-camera="" />,
                gallery: <input ref={fileRef} className={s.file} type="file" accept={PICTURES} onChange={choosePicture} aria-label={w.gallery} data-launch-gallery="" />,
              }
            : null
        }
      >
        {!touch && <input ref={fileRef} id={ids.picture} className={s.file} type="file" accept={PICTURES} onChange={choosePicture} aria-label={draft.picture ? w.changePicture : w.addPicture} />}
      </LaunchPreview>
      <div className={s.fields}>
        <label className={`${s.field} ${problem?.field === 'name' ? s.fieldBad : ''}`} htmlFor={ids.name}>
          <span>{w.name}</span>
          <input ref={nameRef} id={ids.name} value={draft.name} maxLength={64} placeholder={w.namePlaceholder} autoComplete="off" spellCheck={false} onChange={(event) => setDraft({ name: event.target.value, symbol: tickerAfterName(draft.name, event.target.value, draft.symbol) })} />
        </label>
        <label className={`${s.field} ${problem?.field === 'symbol' ? s.fieldBad : ''}`} htmlFor={ids.symbol}>
          <span>{w.ticker}</span>
          <i aria-hidden="true">$</i>
          <input
            id={ids.symbol}
            value={draft.symbol}
            maxLength={16}
            placeholder={w.tickerPlaceholder}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            style={{ ['--chars' as string]: `${Math.max(draft.symbol.length, 4) + 1}ch` }}
            onChange={(event) => setDraft({ symbol: event.target.value.replace(/^\$+/, '').toUpperCase() })}
          />
        </label>
      </div>
      {problem && (
        <div className={s.problem} role="status">
          {problem.words}
        </div>
      )}
      <button className={`${s.display} ${s.action} ${s.actionBig}`} onClick={newPicture ? () => fileRef.current?.click() : review}>
        {newPicture ? w.newPicture : symbol && !check.problems.symbol ? w.reviewSymbol(symbol) : w.reviewPlain}
      </button>
    </>
  );
}

/**
 * The three fields as the engine's store takes them, once they pass the rules, and the store's refusal of exactly these
 * fields when it said one that would repeat (the picture, a borrowed name).
 */
function usePrepared(name: string | null, symbol: string | null): Readonly<{ fields: PrepFields | null; key: string | null; refused: LaunchFailure | null }> {
  const picture = useLaunch((st) => st.draft.picture);
  const stored = useLaunch((st) => st.stored);
  const fields = useMemo<PrepFields | null>(() => (name !== null && symbol !== null && picture ? { name, symbol, picture } : null), [name, symbol, picture]);
  const key = useMemo(() => (fields ? fieldsKey(fields) : null), [fields]);
  const answer = key !== null && stored?.key === key ? stored.answer : null;
  const refused = answer && !answer.ok && FIELDS_REFUSED.has(answer.code) ? { code: answer.code, stage: 'before' as const, message: answer.message, token: null } : null;
  return { fields, key, refused };
}

/** The cost line, first on both steps: no launch fee, and the network's cost once the engine simulated it. */
function CostLine({ preset, simulated = true }: { preset: LaunchPresetView; simulated?: boolean }) {
  const cost = useLaunch((st) => st.costLamports);
  useLang();
  const [free, network] = costLine(preset, simulated ? cost : null);
  return (
    <div className={s.cost} data-launch-cost="">
      <b>{free}</b>
      <span>{network}</span>
    </div>
  );
}

type Shown = Readonly<{ field: 'name' | 'symbol' | 'picture'; words: string }>;

/**
 * The first thing to fix, in one line: a borrowed or bad name at once, an empty field only after the first press, and
 * the engine's own refusal of the stored picture or name as soon as it said it.
 */
function firstProblem(w: W, check: ReturnType<typeof checkLaunchForm>, hasPicture: boolean, pictureBad: boolean, attempted: boolean, refused: LaunchFailure | null): Shown | null {
  const words = (field: 'name' | 'symbol', problem: FieldProblem): string => {
    if (problem === 'BORROWED') return w.readsAs(check.hits.find((hit) => hit.field === field)?.label ?? w.aKnownName);
    if (problem === 'OFFENSIVE') return field === 'name' ? w.anotherName : w.anotherTicker;
    if (problem === 'TOO_LONG') return field === 'name' ? w.nameLong : w.tickerLong;
    if (problem === 'SYMBOL_CHARS') return w.tickerChars;
    return field === 'name' ? w.nameIt : w.tickerIt;
  };
  for (const field of ['name', 'symbol'] as const) {
    const problem = check.problems[field];
    if (problem && (problem !== 'REQUIRED' || attempted)) return { field, words: words(field, problem) };
  }
  if (pictureBad) return { field: 'picture', words: w.pictureKind };
  if (attempted && !hasPicture) return { field: 'picture', words: w.pictureNeeded };
  if (refused) return { field: pictureRefused(refused) ? 'picture' : 'name', words: failureWords(refused) };
  return null;
}

/* ---------------------------------------------------------------- the review and the signature */

function ReviewStep({ onClose }: { onClose: () => void }) {
  const draft = useLaunch((st) => st.draft);
  const preset = useLaunch((st) => st.preset)!;
  const network = useLaunch((st) => st.network)!;
  const stub = useLaunch((st) => st.stub);
  const phase = useLaunch((st) => st.phase);
  const setPhase = useLaunch((st) => st.setPhase);
  const setStep = useLaunch((st) => st.setStep);
  const setDraft = useLaunch((st) => st.setDraft);
  const connection = useLaunch((st) => st.connection);
  const cost = useLaunch((st) => st.costLamports);
  const shareRows = useLaunch((st) => st.shares);
  const setShares = useLaunch((st) => st.setShares);
  const early = useLaunch((st) => st.early);
  const setEarly = useLaunch((st) => st.setEarly);
  const earlyBounds = useLaunch((st) => st.earlyBounds);
  const earlySwitch = useLaunch((st) => st.earlySwitch);
  const shareSwitch = useLaunch((st) => st.shareSwitch);
  const w = useWords(LAUNCH);
  const lang = useLang();
  const setConnection = useLaunch((st) => st.setConnection);
  const [options, setOptions] = useState<readonly WalletOption[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [walletProblem, setWalletProblem] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const busy = useRef(false);
  const check = useMemo(() => checkLaunchForm({ name: draft.name, symbol: draft.symbol, description: '', website: '', x: '', telegram: '' }), [draft.name, draft.symbol]);
  const symbol = check.clean.symbol;
  const working = phase !== null && phase.step !== 'failed' && phase.step !== 'done';
  const { fields, key } = usePrepared(check.clean.name, symbol);
  const storedOk = useLaunch((st) => key !== null && st.stored?.key === key && st.stored.answer?.ok === true);
  /* The shield (CITY-169): the launch goes on it only where it is open and the engine serves it number for number. */
  const halo = cityShieldOpen(network) && shieldServed(preset);
  /* CITY-212: the two doors. Early access is its own launch — a pool, not a curve —, so with it on the curve's rows give way. */
  const earlyDoor = earlyDoorOpen(network, earlyBounds, earlySwitch);
  const earlyOn = earlyDoor && early !== null && earlyBounds !== null;
  const earlyPreview = useMemo(() => (earlyOn ? earlyRules(early, earlyBounds, Math.floor(Date.now() / 1000)) : null), [earlyOn, early, earlyBounds]);
  const shareDoor = shareOpen(network, undefined, shareSwitch) && !earlyOn;
  const shared = shareDoor ? shareRows : NO_SHARES;
  const splitProblem = shareProblem(shared, connection?.address ?? null);
  const splitReady = shared.length > 0 && splitProblem === null;
  const rows = reviewRows(preset, network, cost, halo);
  const line = rows.find((row) => row.id === 'line')!;
  const lineParts = earlyOn ? [w.earlyLineOne, w.earlyLineLocked, w.earlyLineFree, line.lines[line.lines.length - 1]!] : line.lines;
  const detailRows = earlyOn
    ? [{ id: 'early', label: w.earlyDetails, lines: [w.earlyHow, w.earlyPublic, w.earlyKeeps] }]
    : [...rows.filter((row) => row.id !== 'line' && row.id !== 'network'), ...(splitReady ? [{ id: 'share', label: w.shareDetails, lines: [w.shareFixed, w.shareClaims] }] : [])];

  /* The fields go to the store now if they have not yet; with a wallet there, the engine simulates the launch once. */
  useEffect(() => {
    if (fields) void launchPrep().store(fields);
  }, [fields]);
  const simShares = useMemo(() => (connection && splitReady ? sharesOf(connection.address, shared) : null), [connection, splitReady, shared]);
  useEffect(() => {
    if (!fields || !connection || !storedOk || working || earlyOn) return;
    /* While the split is being typed the engine is not asked: a half-typed split would cost the creator's hourly builds. */
    if (shared.length > 0 && !simShares) return;
    void launchPrep().simulate({ fields, creator: connection.address, preset, network, switchOpen: stub || undefined, shares: simShares });
  }, [fields, connection, storedOk, working, preset, network, stub, earlyOn, shared.length, simShares]);

  /* A wallet this browser connected before is restored without a prompt. */
  useEffect(() => {
    if (connection) return;
    let live = true;
    void launchWallet()
      .then((wallet) => wallet.restore())
      .then((restored) => {
        if (live && restored) setConnection(restored);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connection, setConnection]);

  /* While the list of wallets is open, a wallet that registers late joins it. */
  useEffect(() => {
    if (options === null) return;
    let off = () => {};
    void launchWallet().then((wallet) => {
      off = wallet.subscribe(() => setOptions(wallet.options()));
    });
    return () => off();
  }, [options]);

  const pick = async (name: string) => {
    setConnecting(name);
    setWalletProblem(null);
    const wallet = await launchWallet();
    const answer = await wallet.connect(name);
    setConnecting(null);
    if (answer.ok) {
      setConnection(answer.connection);
      setOptions(null);
    } else if (!answer.quiet) setWalletProblem(answer.reason);
  };
  const connect = async () => {
    const wallet = await launchWallet();
    const list = wallet.options();
    if (list.length === 1) return pick(list[0]!.name);
    setOptions(list);
  };
  const launch = async () => {
    if (busy.current || !connection || !draft.picture || !fields) return;
    if (shared.length > 0 && splitProblem !== null) return;
    busy.current = true;
    try {
      const wallet = await launchWallet();
      const prep = launchPrep();
      if (earlyOn && earlyBounds) {
        const choice = early;
        await runEarlyAccess({
          engine: launchEngine(),
          signer: wallet.signer(connection),
          fields: { name: check.clean.name, symbol: check.clean.symbol, picture: draft.picture },
          network,
          bounds: earlyBounds,
          rulesAt: (now) => earlyRules(choice, earlyBounds, now),
          onPhase: setPhase,
          switchOpen: stub || undefined,
          earlySwitch,
          stored: prep.store(fields),
        });
        return;
      }
      const result = await runLaunch({
        engine: launchEngine(),
        signer: wallet.signer(connection),
        fields: { name: check.clean.name, symbol: check.clean.symbol, picture: draft.picture },
        preset,
        network,
        onPhase: setPhase,
        // The development stand-in launches nothing real, so it does not wait for the deployment's switch.
        switchOpen: stub || undefined,
        stored: prep.store(fields),
        takePrebuilt: prep.take,
        others: shared.length ? othersOf(shared) : undefined,
        shareSwitch,
      });
      if (result.step === 'done') {
        landed(result.liftoff, preset);
        openBerth(result.liftoff.token);
        setDraft({ name: '', symbol: '', picture: null });
        setStep('form');
        setPhase(null);
      }
    } finally {
      busy.current = false;
    }
  };

  return (
    <>
      <div className={s.head}>
        <button className={s.back} aria-label={w.backToFields} onClick={() => setStep('form')} disabled={working}>
          {BACK}
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {draft.picture && <img className={s.headPic} src={draft.picture.url} alt="" />}
        <div className={s.headTitle}>
          <h2 className={`${s.display} ${s.title}`}>${symbol}</h2>
          <div className={s.headName}>
            {earlyOn ? check.clean.name : `${check.clean.name} · ${preset.name[lang] ?? preset.name.en}`}
          </div>
        </div>
      </div>
      {/* Early access is its own creation: the curve's simulated cost is not its cost, so the line says the network's fee alone. */}
      <CostLine preset={preset} simulated={!earlyOn} />
      {!earlyOn && (halo ? <HaloRow preset={preset} /> : <ShieldSwitch disabled={working} />)}
      {earlyDoor && <EarlyDoor disabled={working} />}
      {earlyOn && earlyPreview ? (
        <EarlyFacts rules={earlyPreview} />
      ) : (
        <div className={s.facts}>
          {launchFacts(preset).map((fact) => (
            <div key={fact.id} className={s.fact}>
              <span>{fact.label}</span>
              <b className={s.display}>{fact.value}</b>
            </div>
          ))}
        </div>
      )}
      {shareDoor && <ShareDoor disabled={working} creator={connection?.address ?? null} />}
      <div className={s.signLine} data-launch-line="">
        <p>
          {lineParts.map((part, i) => (
            <span key={part} className={i === lineParts.length - 1 ? s.signRisk : undefined}>
              {part}
            </span>
          ))}
        </p>
        <button type="button" className={`${s.info} ${details ? s.infoOn : ''}`} aria-label={details ? w.hideDetails : w.details} aria-expanded={details} onClick={() => setDetails((open) => !open)}>
          i
        </button>
      </div>
      {details && (
        <dl className={s.review}>
          {detailRows.map((row) => (
              <div key={row.id} className={s.row}>
                <dt>{row.label}</dt>
                {row.lines.map((text) => (
                  <dd key={text}>{text}</dd>
                ))}
              </div>
            ))}
        </dl>
      )}
      {connection && (
        <div className={s.wallet}>
          <span className={s.walletDot} aria-hidden="true" />
          <span>
            {connection.wallet} · {shortAddress(connection.address)}
          </span>
          {!working && (
            <button className={s.link} onClick={() => setConnection(null)}>
              {w.change}
            </button>
          )}
        </div>
      )}
      {phase?.step === 'opened' ? (
        <OpenedCard
          opened={phase.opened}
          onClose={() => {
            launchPrep().reset();
            setDraft({ name: '', symbol: '', picture: null });
            setShares([]);
            setEarly(null);
            setPhase(null);
            setStep('form');
            onClose();
          }}
        />
      ) : phase && phase.step !== 'done' ? (
        <Progress
          phase={phase}
          wallet={connection?.wallet ?? null}
          onRetry={launch}
          onEdit={() => {
            setPhase(null);
            setStep('form');
          }}
          onPicture={() => {
            setDraft({ picture: null });
            setPhase(null);
            setStep('form');
          }}
          onTopUp={() => {
            /* The review stays as it was: back from the Money window, the launch is one press again. */
            setPhase(null);
            openMoney('topup');
          }}
          onClose={onClose}
        />
      ) : connection ? (
        <button className={`${s.display} ${s.action} ${s.actionBig}`} onClick={launch} disabled={shared.length > 0 && splitProblem !== null}>
          {w.launchSymbol(symbol)}
        </button>
      ) : options ? (
        <WalletList options={options} connecting={connecting} onPick={pick} back={`${window.location.origin}/?open=launch`} />
      ) : (
        <button className={`${s.display} ${s.action} ${s.actionBig}`} onClick={connect}>
          {w.connect}
        </button>
      )}
      {walletProblem && !connection && <div className={s.problem}>{walletProblem}</div>}
      {!phase && <div className={s.fine}>{connection ? w.promise : w.wallets}</div>}
    </>
  );
}

/**
 * «Bot shield»: what bots pay at the start, and — where the engine serves both — the switch between Protected, where
 * bots pay the most in the first minutes, and Classic. The review's line and rows follow the preset it picks.
 */
function ShieldSwitch({ disabled }: { disabled: boolean }) {
  const presets = useLaunch((st) => st.presets);
  const preset = useLaunch((st) => st.preset);
  const choose = useLaunch((st) => st.choosePreset);
  const w = useWords(LAUNCH);
  useLang();
  const served = useMemo(() => cityPresets({ presets }), [presets]);
  if (!preset) return null;
  const on = preset.id === 'protected';
  const label = (
    <>
      <span className={s.shieldLabel}>{w.botShield}</span>
      <span className={s.shieldValue}>{shieldLine(preset)}</span>
    </>
  );
  if (!served.classic || !served.protected) return <div className={`${s.shield} ${s.shieldStill}`}>{label}</div>;
  return (
    <button type="button" role="switch" aria-checked={on} className={`${s.shield} ${on ? s.shieldOn : ''}`} disabled={disabled} onClick={() => choose(on ? 'classic' : 'protected')}>
      {label}
      <span className={s.shieldTrack} aria-hidden="true">
        <span className={s.shieldKnob} />
      </span>
    </button>
  );
}

/**
 * The shielded launch (CITY-169): no switch to think about — the halo is on, with what bots pay at the start beside it.
 * What keeps the halo is behind «i» (`reviewRows`).
 */
function HaloRow({ preset }: { preset: LaunchPresetView }) {
  const w = useWords(LAUNCH);
  useLang();
  return (
    <div className={`${s.shield} ${s.shieldStill} ${s.halo}`} data-launch-halo="">
      <span className={s.haloMark} aria-hidden="true" />
      <span className={s.shieldLabel}>{w.halo}</span>
      <span className={s.shieldValue}>{shieldLine(preset)}</span>
    </div>
  );
}

export function WalletList({ options, connecting, onPick, back }: { options: readonly WalletOption[]; connecting: string | null; onPick: (name: string) => void; back?: string }) {
  const w = useWords(LAUNCH);
  // A browser with no wallet gets one way on, never a sentence and a dead end (CITY-236, as the top bar's wallet since
  // CITY-221): a phone opens this very place inside Phantom's browser — `back`, the launch sheet or the early window —
  // and a computer gets the wallet.
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!options.length) {
    return (
      <>
        <div className={s.noWallet}>{w.noWallet}</div>
        <a
          className={`${s.display} ${s.action} ${s.actionBig}`}
          href={phone ? phantomBrowseUrl(back ?? window.location.href, window.location.origin) : PHANTOM_DOWNLOAD_URL}
          target={phone ? undefined : '_blank'}
          rel="noreferrer"
          data-wallet-get={phone ? 'open' : 'install'}
        >
          {phone ? w.openInPhantom : w.getPhantom}
        </a>
      </>
    );
  }
  return (
    <div className={s.walletList} role="list">
      {options.map((option) => (
        <button key={option.name} role="listitem" className={s.walletPick} onClick={() => onPick(option.name)} disabled={connecting !== null}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {option.icon ? <img src={option.icon} alt="" /> : <span className={s.walletBlank} />}
          <span>{connecting === option.name ? w.opening(option.name) : option.name}</span>
        </button>
      ))}
    </div>
  );
}

type Ways = Readonly<{ onRetry: () => void; onEdit: () => void; onPicture: () => void; onTopUp: () => void; onClose: () => void }>;

/** Where the launch is: one line while it runs; when it stopped, what happened, whether money moved, and one way on. */
function Progress({ phase, wallet, ...ways }: { phase: Exclude<Phase, { step: 'done' } | { step: 'opened' }>; wallet: string | null } & Ways) {
  const w = useWords(LAUNCH);
  if (phase.step === 'failed') return <Refused failure={phase.failure} wallet={wallet} ways={ways} />;
  const words =
    phase.step === 'upload'
      ? [w.saving, w.savingLine]
      : phase.step === 'build'
        ? [w.building, w.buildingLine]
        : phase.step === 'sign'
          ? [w.confirmIn(phase.wallet), phase.again ? w.signAged : phase.early ? w.signLineEarly : phase.shared ? w.signLineSplit : w.signLineTx]
          : [w.sending, w.sendingLine];
  return (
    <div className={s.progress} role="status" aria-live="polite">
      <span className={s.spinner} aria-hidden="true" />
      <div>
        <div className={`${s.display} ${s.progressTitle}`}>{words[0]}</div>
        <div className={s.progressLine}>{words[1]}</div>
      </div>
    </div>
  );
}

/**
 * A stopped launch (CITY-181): one sentence of what happened, one of whether money moved — said every time — and one
 * action. The contract's code and the engine's words are for support, behind a quiet «Details».
 */
function Refused({ failure, wallet, ways }: { failure: LaunchFailure; wallet: string | null; ways: Ways }) {
  const rw = useWords(REFUSAL_WORDS);
  const [open, setOpen] = useState(false);
  const [at] = useState(() => new Date());
  const refusal = readRefusal(failure, wallet, at);
  const act = { retry: ways.onRetry, topUp: ways.onTopUp, picture: ways.onPicture, edit: ways.onEdit, close: ways.onClose }[refusal.action];
  const label = refusal.details.length ? (open ? rw.hideDetails : rw.details) : null;
  return (
    <div className={s.failed} role="alert" data-launch-refusal={refusal.kind}>
      <div className={s.failedWords}>
        <b className={s.failedWhat}>{refusal.what}</b>
        <span className={`${s.failedMoney} ${refusal.moneyKind === 'maybeLanded' || refusal.moneyKind === 'landing' ? s.failedMoneyOpen : ''}`}>{refusal.money}</span>
      </div>
      <div className={s.failedWays}>
        <button className={`${s.display} ${s.action}`} onClick={act} data-launch-refusal-act={refusal.action}>
          {refusal.act}
        </button>
        {label && (
          <button type="button" className={s.failedMore} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            {label}
          </button>
        )}
      </div>
      {open && (
        <dl className={s.failedDetails}>
          {refusal.details.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
