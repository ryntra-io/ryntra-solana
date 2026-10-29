'use client';

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { checkLaunchForm, type FieldProblem } from '@/lib/launch/form';
import { shrinkPicture } from '@/lib/launch/picture.client';
import { landed, launchEngine, launchWallet, useLaunch } from '@/city/lib/launch/district';
import { failureWords, runLaunch, type Phase } from '@/city/lib/launch/flow';
import { shortAddress } from '@/city/lib/launch/format';
import { reviewRows, ruleLines } from '@/city/lib/launch/terms';
import type { WalletOption } from '@/city/lib/launch/wallet';
import { useKeyboardInset } from '@/city/lib/keyboard';
import { CloseGlyph } from '../hud/glyphs';
import s from './launch.module.css';

const BACK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

/**
 * «Raise your tower»: a picture, a name and a ticker; then the review of what the launch signs up to, every figure the
 * engine's; then one signature in the creator's wallet. The rules of the fields are the engine's own (`checkLaunchForm`),
 * so the sheet says at once what the engine would refuse. The sheet decides nothing for the creator and holds no key.
 */
export function LaunchSheet() {
  const step = useLaunch((st) => st.step);
  const preset = useLaunch((st) => st.preset);
  const network = useLaunch((st) => st.network);
  const stub = useLaunch((st) => st.stub);
  const close = useLaunch((st) => st.closeSheet);
  const inset = useKeyboardInset();
  if (!preset || !network) return null;
  return (
    <div className={`${s.sheet} ${s.panel}`} style={{ ['--kb' as string]: `${inset}px` }} role="dialog" aria-label={step === 'form' ? 'Raise your tower' : 'Review the launch'}>
      {step === 'form' ? <FormStep onClose={close} /> : <ReviewStep onClose={close} />}
      {(network === 'solana:devnet' || stub) && (
        <div className={s.netLine}>
          {stub ? 'Stub data: nothing leaves this browser.' : 'Devnet: test coins, no real money.'}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the three fields */

function FormStep({ onClose }: { onClose: () => void }) {
  const draft = useLaunch((st) => st.draft);
  const setDraft = useLaunch((st) => st.setDraft);
  const setStep = useLaunch((st) => st.setStep);
  const preset = useLaunch((st) => st.preset)!;
  const [attempted, setAttempted] = useState(false);
  const [pictureBad, setPictureBad] = useState(false);
  const check = useMemo(() => checkLaunchForm({ name: draft.name, symbol: draft.symbol, description: '', website: '', x: '', telegram: '' }), [draft.name, draft.symbol]);
  const ids = { name: useId(), symbol: useId(), picture: useId() };
  const nameRef = useRef<HTMLInputElement>(null);
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
  const problem = firstProblem(check, draft.picture !== null, pictureBad, attempted);
  const valid = Object.keys(check.problems).length === 0 && draft.picture !== null;
  const review = () => {
    setAttempted(true);
    if (valid) setStep('review');
  };

  return (
    <>
      <div className={s.head}>
        <h2 className={`${s.display} ${s.title}`}>Raise your tower</h2>
        <button className={s.close} aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
      </div>
      <div className={s.launchRow}>
        <label className={`${s.pic} ${draft.picture ? s.picSet : ''}`} htmlFor={ids.picture} style={draft.picture ? { backgroundImage: `url(${draft.picture.url})` } : undefined}>
          {!draft.picture && (
            <>
              <b aria-hidden="true">+</b>
              <span>Picture</span>
            </>
          )}
          <input id={ids.picture} className={s.file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={choosePicture} aria-label={draft.picture ? 'Change the picture' : 'Add a picture'} />
        </label>
        <div className={s.fields}>
          <label className={`${s.field} ${problem?.field === 'name' ? s.fieldBad : ''}`} htmlFor={ids.name}>
            <span>Name</span>
            <input ref={nameRef} id={ids.name} value={draft.name} maxLength={64} placeholder="Kite" autoComplete="off" spellCheck={false} onChange={(event) => setDraft({ name: event.target.value })} />
          </label>
          <label className={`${s.field} ${problem?.field === 'symbol' ? s.fieldBad : ''}`} htmlFor={ids.symbol}>
            <span>Ticker</span>
            <i aria-hidden="true">$</i>
            <input
              id={ids.symbol}
              value={draft.symbol}
              maxLength={16}
              placeholder="KITE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              style={{ ['--chars' as string]: `${Math.max(draft.symbol.length, 4) + 1}ch` }}
              onChange={(event) => setDraft({ symbol: event.target.value.replace(/^\$+/, '').toUpperCase() })}
            />
          </label>
        </div>
      </div>
      {problem ? (
        <div className={s.problem} role="status">
          {problem.words}
        </div>
      ) : (
        <div className={s.rules}>
          {ruleLines(preset).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
      <button className={`${s.display} ${s.action} ${s.actionBig}`} onClick={review}>
        {symbol && !check.problems.symbol ? `Review $${symbol}` : 'Review'}
      </button>
      <div className={s.fine}>One signature in your wallet</div>
    </>
  );
}

type Shown = Readonly<{ field: 'name' | 'symbol' | 'picture'; words: string }>;

/** The first thing to fix, in one line: a borrowed or bad name at once, an empty field only after the first press. */
function firstProblem(check: ReturnType<typeof checkLaunchForm>, hasPicture: boolean, pictureBad: boolean, attempted: boolean): Shown | null {
  const words = (field: 'name' | 'symbol', problem: FieldProblem): string => {
    if (problem === 'BORROWED') return `Reads as ${check.hits.find((hit) => hit.field === field)?.label ?? 'a known name'}. Choose your own.`;
    if (problem === 'OFFENSIVE') return `Choose another ${field === 'name' ? 'name' : 'ticker'}.`;
    if (problem === 'TOO_LONG') return field === 'name' ? 'The name is too long: up to 32 letters.' : 'The ticker is too long: up to 10 characters.';
    if (problem === 'SYMBOL_CHARS') return 'The ticker takes letters and digits only.';
    return field === 'name' ? 'Name your coin.' : 'Give it a ticker.';
  };
  for (const field of ['name', 'symbol'] as const) {
    const problem = check.problems[field];
    if (problem && (problem !== 'REQUIRED' || attempted)) return { field, words: words(field, problem) };
  }
  if (pictureBad) return { field: 'picture', words: 'Use a PNG, JPEG, WebP or GIF picture.' };
  if (attempted && !hasPicture) return { field: 'picture', words: 'Add a picture: it becomes the face of your tower.' };
  return null;
}

/* ---------------------------------------------------------------- the review and the signature */

function ReviewStep({ onClose }: { onClose: () => void }) {
  const draft = useLaunch((st) => st.draft);
  const preset = useLaunch((st) => st.preset)!;
  const network = useLaunch((st) => st.network)!;
  const phase = useLaunch((st) => st.phase);
  const setPhase = useLaunch((st) => st.setPhase);
  const setStep = useLaunch((st) => st.setStep);
  const setDraft = useLaunch((st) => st.setDraft);
  const connection = useLaunch((st) => st.connection);
  const setConnection = useLaunch((st) => st.setConnection);
  const [options, setOptions] = useState<readonly WalletOption[] | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [walletProblem, setWalletProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const check = useMemo(() => checkLaunchForm({ name: draft.name, symbol: draft.symbol, description: '', website: '', x: '', telegram: '' }), [draft.name, draft.symbol]);
  const symbol = check.clean.symbol;
  const working = phase !== null && phase.step !== 'failed' && phase.step !== 'done';
  /* The engine's simulated cost, once a build said it, stays on the review until the launch ends. */
  const [cost, setCost] = useState<string | null>(null);
  useEffect(() => {
    if (phase?.step === 'sign') setCost(phase.costLamports);
    else if (!working) setCost(null);
  }, [phase, working]);
  const rows = reviewRows(preset, network, cost);

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
    if (busy.current || !connection || !draft.picture) return;
    busy.current = true;
    try {
      const wallet = await launchWallet();
      const result = await runLaunch({
        engine: launchEngine(),
        signer: wallet.signer(connection),
        fields: { name: check.clean.name, symbol: check.clean.symbol, picture: draft.picture },
        preset,
        network,
        onPhase: setPhase,
        // The development stand-in launches nothing real, so it does not wait for the deployment's switch.
        switchOpen: useLaunch.getState().stub || undefined,
      });
      if (result.step === 'done') {
        landed(result.liftoff, preset);
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
        <button className={s.back} aria-label="Back to the fields" onClick={() => setStep('form')} disabled={working}>
          {BACK}
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {draft.picture && <img className={s.headPic} src={draft.picture.url} alt="" />}
        <div className={s.headTitle}>
          <h2 className={`${s.display} ${s.title}`}>${symbol}</h2>
          <div className={s.headName}>
            {check.clean.name} · {preset.name.en}
          </div>
        </div>
        <button className={s.close} aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
      </div>
      <dl className={s.review}>
        {rows
          .filter((row) => row.id !== 'network')
          .map((row) => (
            <div key={row.id} className={s.row}>
              <dt>{row.label}</dt>
              {row.lines.map((text) => (
                <dd key={text}>{text}</dd>
              ))}
            </div>
          ))}
      </dl>
      {connection && (
        <div className={s.wallet}>
          <span className={s.walletDot} aria-hidden="true" />
          <span>
            {connection.wallet} · {shortAddress(connection.address)}
          </span>
          {!working && (
            <button className={s.link} onClick={() => setConnection(null)}>
              Change
            </button>
          )}
        </div>
      )}
      {phase && phase.step !== 'done' ? (
        <Progress phase={phase} wallet={connection?.wallet ?? null} onRetry={launch} onEdit={() => {
            setPhase(null);
            setStep('form');
          }} />
      ) : connection ? (
        <button className={`${s.display} ${s.action} ${s.actionBig}`} onClick={launch}>
          Launch ${symbol}
        </button>
      ) : options ? (
        <WalletList options={options} connecting={connecting} onPick={pick} />
      ) : (
        <button className={`${s.display} ${s.action} ${s.actionBig}`} onClick={connect}>
          Connect wallet
        </button>
      )}
      {walletProblem && !connection && <div className={s.problem}>{walletProblem}</div>}
      {!phase && <div className={s.fine}>{connection ? 'One signature. Your wallet shows it before you sign.' : 'Phantom, Solflare, Backpack or Seeker'}</div>}
    </>
  );
}

function WalletList({ options, connecting, onPick }: { options: readonly WalletOption[]; connecting: string | null; onPick: (name: string) => void }) {
  if (!options.length) {
    return (
      <div className={s.noWallet}>
        No Solana wallet in this browser. Open this page in Phantom, Solflare or Backpack.
      </div>
    );
  }
  return (
    <div className={s.walletList} role="list">
      {options.map((option) => (
        <button key={option.name} role="listitem" className={s.walletPick} onClick={() => onPick(option.name)} disabled={connecting !== null}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {option.icon ? <img src={option.icon} alt="" /> : <span className={s.walletBlank} />}
          <span>{connecting === option.name ? `Opening ${option.name}…` : option.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Where the launch is: one line while it runs, the reason and the way back when it stopped. */
function Progress({ phase, wallet, onRetry, onEdit }: { phase: Exclude<Phase, { step: 'done' }>; wallet: string | null; onRetry: () => void; onEdit: () => void }) {
  if (phase.step === 'failed') {
    return (
      <div className={s.failed} role="alert">
        <div className={s.failedWords}>{failureWords(phase.failure, wallet)}</div>
        {phase.failure.stage === 'before' && (
          <div className={s.pair}>
            <button className={`${s.display} ${s.action}`} onClick={onRetry}>
              Try again
            </button>
            <button className={s.quiet} onClick={onEdit}>
              Edit
            </button>
          </div>
        )}
      </div>
    );
  }
  const words =
    phase.step === 'upload'
      ? ['Saving the picture and the name', 'Ryntra keeps them for the coin’s page.']
      : phase.step === 'build'
        ? ['Building your launch', 'Solana simulates it before you sign.']
        : phase.step === 'sign'
          ? [`Confirm in ${phase.wallet}`, phase.again ? 'The first signature aged. One more, please.' : 'One transaction: your coin and its curve.']
          : ['Sending to Solana', 'Your tower rises as soon as it lands.'];
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
