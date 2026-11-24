'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { LaunchPresetView } from '@/lib/api/v1/contract';
import { LAUNCH_PRESETS } from '@/lib/core/venues/meteora-dbc/presets';
import { checkLaunchForm, type FormCheck } from '@/lib/launch/form';
import { shrinkPicture } from '@/lib/launch/picture.client';
import { useWords } from '@/city/lib/i18n/dict';
import { launchEngine, launchPoolEngine, launchPrep, launchWallet, poolLanded, readLaunchPresets, useLaunch, type Draft } from '@/city/lib/launch/district';
import type { Network } from '@/city/lib/launch/engine';
import { pictureRefused, runLaunch, type Phase } from '@/city/lib/launch/flow';
import { cityLaunchOpen, cityPresets } from '@/city/lib/launch/gate';
import { POOL_DEFAULT, poolDoorOpen, usePool, type PoolChoice, type PoolListed } from '@/city/lib/launch/pool';
import { POOL_HALF_WAY, runPoolLaunch } from '@/city/lib/launch/pool-flow';
import { FIELDS_REFUSED, NO_ABOUT, fieldsKey, type About, type PrepFields } from '@/city/lib/launch/prepare';
import { cityShieldOpen, shieldServed } from '@/city/lib/launch/shield';
import { tickerAfterName } from '@/city/lib/launch/ticker';
import { useWallet } from '@/city/lib/trade/wallet';
import { costOf, formatOf, problemOf, refusalOf, type Format, type Shown } from './launch-view';
import { LAUNCH_SCREEN } from './words';

/** The fields stay still this long before they go to the engine's store in the background (the city's own wait). */
const STORE_AFTER_MS = 900;
/**
 * The city builds a launch for its cost once the creator reaches its review; the terminal has no review step, so it
 * builds once the stored fields stand still this long, and for a few different launches a page at most — every build
 * counts against the creator's hourly allowance.
 */
const SIMULATE_AFTER_MS = 2_500;
const SIMULATIONS_MAX = 3;

export type Connection = Readonly<{ wallet: string; address: string }>;

/**
 * The words about the new coin — its line and its links — beside the district's draft of its name, ticker and
 * picture: `typed` as the person types them, `left` as of the last field they left, `touched` the fields they left.
 */
const useAbout = create<{ typed: About; left: About; touched: ReadonlySet<string> }>(() => ({ typed: NO_ABOUT, left: NO_ABOUT, touched: new Set() }));

/** The words about the coin as the engine reads them: the line trimmed, each link whole or none. */
function cleanAboutOf(check: FormCheck): About {
  const { description, links } = check.clean;
  return { description, website: links.website ?? '', x: links.x ?? '', telegram: links.telegram ?? '' };
}

/**
 * The Launch screen's state, on the city's launch logic as it is: the district's store for the draft, the phase and the
 * engine's presets; the pool's store for the creator's choice; the city's wallet; the engine's store and simulation
 * made ready while the creator types (`prepare.ts`); and the city's two flows — the curve's and the pool's — for the
 * press. The screen adds no rule of its own to what is stored, built, checked or signed.
 */
export function useLaunchModel() {
  const w = useWords(LAUNCH_SCREEN);
  const status = useLaunch((st) => st.status);
  const network = useLaunch((st) => st.network);
  const preset = useLaunch((st) => st.preset);
  const presets = useLaunch((st) => st.presets);
  const draft = useLaunch((st) => st.draft);
  const phase = useLaunch((st) => st.phase);
  const stored = useLaunch((st) => st.stored);
  const simulated = useLaunch((st) => st.costLamports);
  const poolSwitch = usePool((st) => st.switchOpen);
  const choice = usePool((st) => st.choice);
  const wallet = useWallet((st) => st.connection);
  const connection = useMemo<Connection | null>(() => (wallet ? { wallet: wallet.wallet, address: wallet.address } : null), [wallet]);

  const [attempted, setAttempted] = useState(false);
  const [pictureBad, setPictureBad] = useState(false);
  // What the creator says about the coin: its line and links — kept while the person walks the terminal.
  const about = useAbout((st) => st.typed);
  const left = useAbout((st) => st.left);
  const touched = useAbout((st) => st.touched);
  const [poolCost, setPoolCost] = useState<string | null>(null);
  const [curveSigned, setCurveSigned] = useState<string | null>(null);
  const busy = useRef(false);
  // Which taking-up of a half-way launch is the latest: an answer for an earlier one is let go.
  const resumed = useRef(0);
  const simulations = useRef<Readonly<{ count: number; last: string | null }>>({ count: 0, last: null });

  // The engine's presets, once for the page: the district's own read, without the city's feed, towers and moments.
  // An early-access launch the city set up is the city's own card: the terminal starts from its form.
  useEffect(() => {
    void readLaunchPresets();
    if (useLaunch.getState().phase?.step === 'opened') useLaunch.getState().setPhase(null);
  }, []);

  const poolOpen = poolDoorOpen(network, poolSwitch);
  const format: Format = formatOf(choice, poolOpen);
  const open = status === 'ready' && preset !== null && cityLaunchOpen(network as Network | null);
  const working = phase !== null && phase.step !== 'failed' && phase.step !== 'done' && phase.step !== 'pooled';
  const settled = phase?.step === 'done' || phase?.step === 'pooled';

  const check: FormCheck = useMemo(() => checkLaunchForm({ name: draft.name, symbol: draft.symbol, ...about }), [draft.name, draft.symbol, about]);
  const symbol = check.clean.symbol;
  const fieldsValid = Object.keys(check.problems).length === 0;
  // The words about the coin go to the store as the engine reads them: the line trimmed, each link whole or none.
  const cleanAbout = useMemo<About>(() => cleanAboutOf(check), [check]);
  /** What a press stores and launches: the fields as they stand now. */
  const pressFields = useMemo<PrepFields | null>(() => (fieldsValid && draft.picture ? { name: check.clean.name, symbol, picture: draft.picture, about: cleanAbout } : null), [fieldsValid, check.clean.name, symbol, draft.picture, cleanAbout]);
  // What is made ready in the background: the words about the coin as of the last field the person left — a line being
  // typed spends none of the engine's hourly stores and builds; leaving the field (or pressing) hands it over.
  const leftAbout = useMemo<About | null>(() => {
    const read = checkLaunchForm({ name: draft.name, symbol: draft.symbol, ...left });
    return Object.keys(read.problems).length === 0 ? cleanAboutOf(read) : null;
  }, [draft.name, draft.symbol, left]);
  const fields = useMemo<PrepFields | null>(() => (pressFields && leftAbout ? { ...pressFields, about: leftAbout } : null), [pressFields, leftAbout]);
  const key = useMemo(() => (fields ? fieldsKey(fields) : null), [fields]);
  const answer = key !== null && stored?.key === key ? stored.answer : null;
  const storedOk = answer?.ok === true;
  const refusedFailure = answer && !answer.ok && FIELDS_REFUSED.has(answer.code) ? { code: answer.code, stage: 'before' as const, message: answer.message, token: null } : null;
  const refused: Shown | null = refusedFailure ? { field: pictureRefused(refusedFailure) ? 'picture' : 'name', words: refusalOf(w, refusedFailure, null, null).what } : null;
  const problem = problemOf(w, check, { has: draft.picture !== null, bad: pictureBad }, attempted, refused, touched);
  const valid = fieldsValid && draft.picture !== null && refused === null;
  const newPicture = refusedFailure !== null && pictureRefused(refusedFailure);

  // The fields go to the engine's store once they stand still; its refusal of the picture or the name shows at once.
  // Nothing is stored where launching is not open here.
  useEffect(() => {
    if (!open || !fields || working || settled) return;
    const timer = setTimeout(() => void launchPrep().store(fields, { background: true }), STORE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open, fields, working, settled]);

  // On the curve, with a wallet there and the fields stored, the engine builds the launch once for its cost — the city's
  // review does exactly this; the bytes are handed to the press only while a wallet may still open on them.
  const metadataUri = storedOk && answer?.ok ? answer.data.metadataUri : null;
  useEffect(() => {
    if (format !== 'curve' || !open || !fields || !connection || !metadataUri || working || settled || !preset || !network) return;
    const launchKey = `${network}|${connection.address}|${preset.id}|${metadataUri}`;
    const done = simulations.current;
    if (done.last === launchKey || done.count >= SIMULATIONS_MAX) return;
    const timer = setTimeout(() => {
      simulations.current = { count: done.count + 1, last: launchKey };
      void launchPrep().simulate({ fields, creator: connection.address, preset, network });
    }, SIMULATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [format, open, fields, connection, metadataUri, working, settled, preset, network]);

  // A build the wallet was asked on is that launch's own: another name, picture or preset lets its figure go.
  useEffect(() => setCurveSigned(null), [metadataUri, preset?.id]);

  /** The curve's network cost: the figure of the build the wallet was asked on, else the simulation's — never a pool step's. */
  const curveCost = useMemo(() => curveSigned ?? (simulated === null ? null : launchPrep().state().costLamports), [curveSigned, simulated]);

  const served = useMemo(() => cityPresets({ presets }), [presets]);
  /** The bot shield: fixed where the city's shield is on and served; a switch where both of the city's presets are served. */
  const shield = useMemo(() => {
    if (!preset) return null;
    const fixed = cityShieldOpen(network as Network | null) && shieldServed(preset);
    return { on: preset.id === 'protected', switchable: !fixed && served.classic !== null && served.protected !== null };
  }, [preset, network, served]);

  const setDraft = useLaunch.getState().setDraft;
  const setName = (name: string) => setDraft({ name, symbol: tickerAfterName(draft.name, name, draft.symbol) });
  const setSymbol = (value: string) => setDraft({ symbol: value.replace(/^\$+/, '').toUpperCase() });
  const choosePicture = async (file: File | undefined) => {
    if (!file) return;
    const picture = await shrinkPicture(file);
    setPictureBad(!picture);
    if (picture) setDraft({ picture });
  };
  const setAbout = (next: Partial<About>) => useAbout.setState((st) => ({ typed: { ...st.typed, ...next } }));
  /** A field about the coin left: its link may now be said wrong, and the words go to the background's store. */
  const leave = (field: keyof About) => useAbout.setState((st) => ({ left: st.typed, touched: st.touched.has(field) ? st.touched : new Set([...st.touched, field]) }));
  const chooseFormat = (next: Format) => usePool.getState().setChoice(next === 'pool' ? (choice ?? POOL_DEFAULT) : null);
  const setChoice = (next: PoolChoice) => usePool.getState().setChoice(next);
  const chooseShield = (on: boolean) => useLaunch.getState().choosePreset(on ? 'protected' : 'classic');

  const onPhase = useCallback((next: Phase) => {
    // A pool step's cost is that step's own figure: kept apart from the curve's simulated one.
    if (next.step === 'sign' && next.costLamports !== null) (next.pool ? setPoolCost : setCurveSigned)(next.costLamports);
    useLaunch.getState().setPhase(next);
  }, []);

  /**
   * A launch into a pool stopped between its steps: its coin. The press then takes it up in its pool — whatever the
   * form shows, never a new coin — and the form stays as it is until it is finished or let go.
   */
  const half = phase?.step === 'failed' && phase.failure.code === POOL_HALF_WAY ? phase.failure.token : null;

  /** The press: the city's flows as they are — the curve's one signature, or the pool's three steps. */
  const launch = async () => {
    setAttempted(true);
    if (busy.current || working || !open || !connection || !preset || !network) return;
    if (!half && (!valid || !pressFields)) return;
    busy.current = true;
    try {
      const signer = (await launchWallet()).signer(connection);
      const prep = launchPrep();
      const coin = { name: check.clean.name, symbol: check.clean.symbol, picture: draft.picture ?? { base64: '', url: '' }, about: cleanAbout };
      if (half || (format === 'pool' && choice)) {
        const result = await runPoolLaunch({ engine: launchEngine(), pool: await launchPoolEngine(), signer, fields: coin, network, choice: choice ?? POOL_DEFAULT, resume: half, onPhase, poolSwitch, stored: half || !pressFields ? null : prep.store(pressFields) });
        if (result.step === 'pooled') poolLanded(result.pooled, connection.address);
        return;
      }
      if (!pressFields) return;
      const result = await runLaunch({ engine: launchEngine(), signer, fields: coin, preset, network, onPhase, stored: prep.store(pressFields), takePrebuilt: prep.take });
      if (result.step === 'done') prep.reset();
    } finally {
      busy.current = false;
    }
  };

  /**
   * A launch into a pool this wallet began and did not finish (its coin is on chain, a step waits): the form takes it
   * up where the chain shows it — the press continues it, never mints again.
   */
  const resume = (listed: PoolListed) => {
    if (busy.current || working) return;
    const asked = (resumed.current += 1);
    // The launch's own opening, never the form's «in 15 minutes»: the card counts down to the time its pool was made for.
    usePool.getState().setChoice({ ...POOL_DEFAULT, pair: listed.pair, at: listed.opensAt });
    // Whether its ladder is there is the launch's own record (the list does not say it): read once, the form follows it.
    void launchPoolEngine()
      .then((engine) => engine.view(listed.mint))
      .then((view) => {
        const now = usePool.getState().choice;
        // Only for the launch still taken up, and only while nobody touched the form since.
        if (asked !== resumed.current || !view.ok || !now || now.at !== listed.opensAt) return;
        if (useLaunch.getState().phase?.step !== 'failed') return;
        // The reward for the pool's liquidity likewise: the form and the card say what the launch was begun with.
        const reward = view.data.reward ?? null;
        usePool.getState().setChoice({ ...now, ladder: view.data.ladder !== null, reward: reward ? { shareBps: reward.shareBps, days: reward.days } : null });
      })
      .catch(() => {});
    setDraft({ name: listed.name, symbol: listed.symbol });
    setPoolCost(null);
    useLaunch.getState().setPhase({ step: 'failed', failure: { code: POOL_HALF_WAY, stage: 'send', message: '', token: listed.mint } });
  };

  /** After a launch, or out of a refusal: the form as it was, or empty for the next coin. */
  const clearPhase = () => useLaunch.getState().setPhase(null);
  /** What the person did on the form before — a press, a refused picture, a step's cost — let go for a new coin. */
  const forget = () => {
    setAttempted(false);
    setPictureBad(false);
    useAbout.setState({ touched: new Set() });
    setPoolCost(null);
    setCurveSigned(null);
  };
  const another = () => {
    resumed.current += 1;
    simulations.current = { count: 0, last: null };
    launchPrep().reset();
    usePool.getState().setChoice(null);
    setDraft({ name: '', symbol: '', picture: null } satisfies Draft);
    useAbout.setState({ typed: NO_ABOUT, left: NO_ABOUT });
    forget();
    clearPhase();
  };
  const dropPicture = () => {
    setDraft({ picture: null });
    clearPhase();
  };

  const free = format === 'pool' || (preset !== null && LAUNCH_PRESETS[preset.id as keyof typeof LAUNCH_PRESETS]?.poolCreationFeeLamports === 0);

  return {
    w,
    status,
    network: network as Network | null,
    preset: preset as LaunchPresetView | null,
    draft,
    phase,
    connection,
    check,
    symbol,
    problem,
    valid,
    newPicture,
    open,
    working,
    settled,
    poolOpen,
    format,
    choice,
    shield,
    free,
    cost: costOf(format, curveCost, poolCost),
    costSimulated: format === 'curve' ? curveCost !== null : poolCost !== null,
    setName,
    setSymbol,
    about,
    setAbout,
    leave,
    choosePicture,
    chooseFormat,
    setChoice,
    chooseShield,
    launch,
    resume,
    halfWay: half !== null,
    /** Whether a press is on its way — between the press and the flow's first step too. */
    pressing: () => busy.current,
    clearPhase,
    forget,
    another,
    dropPicture,
  };
}

export type LaunchModel = ReturnType<typeof useLaunchModel>;
