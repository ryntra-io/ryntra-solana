'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { PlacedTower } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import { useFlashing } from '@/city/lib/feed/motion';
import { lensLevels } from '@/city/lib/lens/lens';
import { useLens } from '@/city/lib/lens/store';
import { easeLens, LENS_MS, LENS_UNIFORMS } from '@/city/lib/lens/uniforms';
import { useRun } from '@/city/lib/run/store';
import { useLensContext } from './useLensSet';

/** What the lens hands the towers each frame it moves: every tower's level now, and whether towers may move at all. */
export type LensApply = (levels: Float32Array, move: number) => void;

/**
 * The Lens on the towers (CITY-86): each tower eases from where it stood to its new level in about 700 ms — the towers
 * looked at rise a little in violet light, the rest sink into the ink haze. With «Flashing effects» off or the device
 * asking for reduced motion, nothing moves: only the light changes. A picked tower always stands out of the haze; a run
 * has the whole skyline. The levels live in a ref: the towers' own frame loop reads them for what moves on its own (a
 * moment's crown).
 */
export function useTowerLens(towers: readonly PlacedTower[], apply: LensApply): { current: Float32Array; move: number } {
  const lens = useLens((st) => st.lens);
  const ready = useLens((st) => st.ready);
  const selectedId = useCity((st) => st.selectedId);
  // A run races through the whole skyline: the lens stands down while it runs.
  const running = useRun((st) => st.phase !== 'off');
  const ctx = useLensContext();
  const still = !useFlashing();
  const move = still ? 0 : 1;
  const target = useMemo(() => {
    const levels = ready && !running ? lensLevels(lens, towers, ctx) : new Float32Array(towers.length);
    const picked = towers.findIndex((t) => t.tower.id === selectedId);
    if (picked >= 0) levels[picked] = Math.max(0, levels[picked]!);
    return levels;
  }, [lens, ready, running, towers, ctx, selectedId]);

  const now = useRef({ current: new Float32Array(towers.length), move });
  const from = useRef(new Float32Array(towers.length));
  const started = useRef(0);
  const mixFrom = useRef(0);
  const dirty = useRef(true);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // A new layout starts where its towers' ids stood before; a new target eases from wherever each tower is now.
  const lastTowers = useRef(towers);
  useEffect(() => {
    if (lastTowers.current !== towers) {
      const before = new Map(lastTowers.current.map((t, i) => [t.tower.id, now.current.current[i] ?? 0]));
      now.current.current = Float32Array.from(towers, (t) => before.get(t.tower.id) ?? 0);
      lastTowers.current = towers;
    }
    from.current = now.current.current.slice();
    mixFrom.current = LENS_UNIFORMS.uLensMix.value;
    started.current = performance.now();
    dirty.current = true;
  }, [towers, target]);

  useEffect(() => {
    LENS_UNIFORMS.uLensMove.value = move;
    now.current.move = move;
    dirty.current = true;
  }, [move]);

  useFrame(() => {
    if (!dirty.current) return;
    const k = easeLens((performance.now() - started.current) / LENS_MS);
    const cur = now.current.current;
    for (let i = 0; i < cur.length; i += 1) cur[i] = from.current[i]! + ((target[i] ?? 0) - from.current[i]!) * k;
    const mixGoal = target.some((v) => v !== 0) ? 1 : 0;
    LENS_UNIFORMS.uLensMix.value = mixFrom.current + (mixGoal - mixFrom.current) * k;
    applyRef.current(cur, now.current.move);
    if (k >= 1) dirty.current = false;
  });

  return now.current;
}
