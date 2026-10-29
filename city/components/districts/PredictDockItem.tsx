'use client';

import { playTick } from '@/city/lib/audio/engine';
import { useAgent } from '@/city/lib/agent/store';
import { useCity } from '@/city/lib/city/store';
import { useHarbor } from '@/city/lib/districts/harbor/store';
import { PREDICT_OPEN } from '@/city/lib/districts/predict/flag';
import { usePredict } from '@/city/lib/districts/predict/store';
import { vaultStore } from '@/city/lib/vault/store';
import s from '../hud/hud.module.css';
import p from './predict.module.css';
import { PredictGlyph } from './predictGlyphs';

/** Open the Predictions window, one panel at a time: the tower card, the agent and the Vault give way; the Harbor too, unless it holds a signature. */
export function openPredictions(): void {
  useCity.getState().select(null);
  useAgent.getState().closePanel();
  if (vaultStore.getState().open) vaultStore.getState().leave();
  useHarbor.getState().hide();
  if (useHarbor.getState().open) return;
  usePredict.getState().show();
}

/** «Predict» in the city's dock, once the district is open: one more district beside the others, drawn as they are. */
export function PredictDockItem() {
  const open = usePredict((st) => st.open);
  if (!PREDICT_OPEN) return null;
  return (
    <button
      className={[s.dockItem, p.dockPredict, open && s.dockOn].filter(Boolean).join(' ')}
      aria-label="Predict"
      aria-pressed={open}
      data-hint="Live prediction markets"
      onClick={() => {
        if (useCity.getState().sound) playTick();
        if (usePredict.getState().open) return usePredict.getState().hide();
        openPredictions();
      }}
    >
      <span className={s.dockGlyph}>
        <PredictGlyph />
      </span>
      <span className={s.dockLabel}>Predict</span>
    </button>
  );
}
