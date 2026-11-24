'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { citySigner } from '@/city/lib/app-bridge/route';
import { useLaunch } from '@/city/lib/launch/district';
import { engineCall } from '@/city/lib/launch/engine';
import { cityPreset, cityPresets } from '@/city/lib/launch/gate';
import { cityStartPreset } from '@/city/lib/launch/shield';
import { ryntraSets, setNameProblem, setSaveText, type CurveSet, type SetNetwork, type SetsResponse } from '@/lib/launch/presets-market/set';
import { bytesToBase64, type SignInInput } from '@/lib/solana/wallet-signin.client';
import type { LaunchModel } from '../useLaunchModel';
import { appliedHere, presetOfSet, reachableOf, setsHere, termsOfView } from './sets-view';

/** The sets the form starts from: Ryntra's own at once, the market's most used once read. */
const SETS_PATH = '/api/v1/launch/presets/sets?limit=24';

/** The set the person started from — kept while they walk the terminal, shown while the form still stands on it. */
const useApplied = create<{ applied: CurveSet | null }>(() => ({ applied: null }));

type Read = Readonly<{ sets: readonly CurveSet[]; stored: boolean }> | null;

let read: Promise<Read> | null = null;

/** The market's sets, read once for the page; a failed read is asked again next time. */
function readSets(): Promise<Read> {
  read ??= engineCall(fetch)<SetsResponse>(SETS_PATH).then((answer) => {
    if (!answer.ok) {
      read = null;
      return null;
    }
    return { sets: answer.data.sets, stored: answer.data.stored };
  });
  return read;
}

export type SaveState =
  | Readonly<{ step: 'idle' }>
  | Readonly<{ step: 'signing' }>
  | Readonly<{ step: 'saved' }>
  | Readonly<{ step: 'refused'; reason: 'nameShort' | 'nameLong' | 'nameChars' | 'nameOther' | 'nameTaken' | 'sameTerms' | 'full' | 'closed' | 'declined' | 'failed' }>;

/** The store's refusal as the person reads it. */
function refusalOf(code: string, message: string): Extract<SaveState, { step: 'refused' }>['reason'] {
  if (code === 'UNAVAILABLE') return 'closed';
  if (code === 'VALIDATION_ERROR') {
    if (/name is already/i.test(message)) return 'nameTaken';
    if (/same numbers|these numbers/i.test(message)) return 'sameTerms';
    if (/as many sets/i.test(message)) return 'full';
    if (/name/i.test(message)) return 'nameOther';
  }
  return 'failed';
}

/**
 * «Start from a set» on the Launch form's own state: the sets this form can launch (the form's presets are the
 * limit), the one it stands on, what it changes from the launch the form opens with, a tap that fills the form, a save
 * of the form's settings under the person's name with one signed message, and the landed launch counted for its set.
 * Nothing here builds, signs a transaction or changes what is launched.
 */
export function useSets(m: LaunchModel) {
  const presets = useLaunch((st) => st.presets);
  const applied = useApplied((st) => st.applied);
  const [market, setMarket] = useState<Read>(null);
  const [save, setSave] = useState<SaveState>({ step: 'idle' });
  const counted = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    void readSets().then((answer) => live && setMarket(answer));
    return () => {
      live = false;
    };
  }, []);

  const served = useMemo(() => cityPresets({ presets }), [presets]);
  const reachable = useMemo(() => reachableOf(served, m.preset, m.shield?.switchable ?? false), [served, m.preset, m.shield?.switchable]);
  // Until the market answers, Ryntra's own sets stand in its place, so the row is there from the first frame.
  const all = useMemo(() => market?.sets ?? ryntraSets(presets.map((preset) => preset.id)), [market, presets]);
  const offered = useMemo(() => setsHere(all, reachable), [all, reachable]);
  const base = useMemo(() => termsOfView(cityPreset({ presets }, cityStartPreset(m.network))), [presets, m.network]);
  const here = appliedHere(applied, m.preset);
  const still = m.working || m.settled || m.halfWay;

  /** One tap: the form takes the set's preset on the curve; nothing else of the coin changes. */
  const apply = (set: CurveSet) => {
    const preset = presetOfSet(set, reachable);
    if (still || !preset) return;
    if (m.format !== 'curve') m.chooseFormat('curve');
    useLaunch.getState().choosePreset(preset);
    useApplied.setState({ applied: set });
  };

  // A launch that landed from a set is counted for it — once per coin, and only while the form still stood on the set.
  const phase = m.phase;
  useEffect(() => {
    if (phase?.step !== 'done' || !here) return;
    const mint = phase.liftoff.token;
    if (counted.current.has(mint)) return;
    counted.current.add(mint);
    void engineCall(fetch)(`/api/v1/launch/presets/sets/${encodeURIComponent(here.id)}/uses`, { method: 'POST', body: JSON.stringify({ mint }) });
  }, [phase, here]);

  /** The form's settings kept under the person's name: their wallet signs the set's text — a message, no money. */
  const saveAs = async (raw: string): Promise<SaveState> => {
    const connection = m.connection;
    const terms = termsOfView(m.preset);
    const network = m.network as SetNetwork | null;
    if (!connection || !terms || !network || save.step === 'signing') return save;
    const said = (next: SaveState) => {
      setSave(next);
      return next;
    };
    const problem = setNameProblem(raw);
    if (problem) return said({ step: 'refused', reason: problem === 'TOO_SHORT' || problem === 'REQUIRED' ? 'nameShort' : problem === 'TOO_LONG' ? 'nameLong' : problem === 'CHARS' ? 'nameChars' : 'nameOther' });
    setSave({ step: 'signing' });
    const issuedAt = new Date().toISOString();
    const body = { name: raw, author: connection.address, terms, issuedAt };
    const text = setSaveText({ ...body, network });
    const signed = await citySigner.signIn(connection.wallet, { address: connection.address } as SignInInput, text).catch(() => null);
    if (!signed || !signed.ok) return said({ step: 'refused', reason: signed && (signed.state === 'CANCELLED' || signed.state === 'REFUSED') ? 'declined' : 'failed' });
    // Only the exact text, signed by the connected wallet itself, is a set's signature.
    const same = signed.via === 'signMessage' && signed.address === connection.address && new TextDecoder().decode(signed.signedMessage) === text;
    if (!same) return said({ step: 'refused', reason: 'failed' });
    const answer = await engineCall(fetch)<{ set: CurveSet }>('/api/v1/launch/presets/sets', { method: 'POST', body: JSON.stringify({ ...body, signature: bytesToBase64(signed.signature) }) });
    if (!answer.ok) return said({ step: 'refused', reason: refusalOf(answer.code, answer.message) });
    const set = answer.data.set;
    setMarket((was) => ({ sets: [set, ...(was?.sets ?? all).filter((entry) => entry.id !== set.id)], stored: true }));
    read = null;
    useApplied.setState({ applied: set });
    return said({ step: 'saved' });
  };

  return {
    offered,
    applied: here,
    base,
    still,
    /** Saving needs the market's store; without it the form starts from Ryntra's own sets only. */
    canSave: market?.stored === true && termsOfView(m.preset) !== null,
    save,
    saveAs,
    resetSave: () => setSave({ step: 'idle' }),
    apply,
  };
}

export type SetsModel = ReturnType<typeof useSets>;
