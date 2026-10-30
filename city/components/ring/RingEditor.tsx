'use client';

import { useEffect, useRef } from 'react';
import { ARCHETYPES, SCENARIO_MAX, WEIGHTS, type ModelOption } from '@/lib/ring/contract';
import { BODIES } from '@/city/lib/ring/body';
import { FORMAT_NAMES, WEIGHT_NAMES, charCount, classSpan, perMatch } from '@/city/lib/ring/format';
import { STEPS, canSave, classCounts, ringStore, useRing, visibleModels, type QuoteRead, type Step } from '@/city/lib/ring/store';
import { CloseGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { AgentBody } from './AgentBody';
import r from './ring.module.css';
import { RING_UI } from './words';
import { num, useWords, type TextKey } from '@/city/lib/i18n/dict';

const STEP_NAMES: Record<Step, TextKey<typeof RING_UI>> = { body: 'body', brain: 'brain', script: 'script' };

/**
 * The screen that makes or changes an agent (CITY-50): body, brain, script — three steps, one amber action. The brain
 * is any model of OpenRouter's live catalog, sorted into weight classes, each with its price for a match before it is
 * picked; a pick is pinned to one provider by the server and its own price, class and formats shown before saving.
 */
export function RingEditor() {
  const editor = useRing((st) => st.editor);
  const quotes = useRing((st) => st.quotes);
  const ready = useRing((st) => canSave(st.editor, st.quotes));
  const w = useWords(RING_UI);

  // Escape closes this screen and nothing under it: the quarter's own Escape (back to the city) waits for the next press.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      ringStore.getState().closeEditor();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!editor) return null;
  const st = ringStore.getState();
  const last = editor.step === 'script';
  const next = STEPS[STEPS.indexOf(editor.step) + 1];
  const quote = editor.model ? quotes[editor.model] : undefined;
  const sameBrain = editor.agent?.brain.id === editor.model;

  return (
    <div className={r.editor} role="dialog" aria-label={w.agent}>
      <div className={r.head}>
        <div className={`${s.kicker} ${r.kicker}`}>
          <span className={r.dot} aria-hidden="true" />
          {editor.agent ? editor.agent.name : w.newAgent}
        </div>
        <button className={r.close} aria-label={w.close} onClick={() => st.closeEditor()}>
          <CloseGlyph />
        </button>
      </div>

      <nav className={r.steps} aria-label={w.steps}>
        {STEPS.map((step, i) => (
          <button key={step} className={[r.step, editor.step === step && r.stepOn].filter(Boolean).join(' ')} aria-current={editor.step === step ? 'step' : undefined} onClick={() => st.goTo(step)}>
            <span className={r.stepNo}>{i + 1}</span>
            {w[STEP_NAMES[step]]}
          </button>
        ))}
      </nav>

      <div className={r.pane}>
        {editor.step === 'body' && <BodyStep />}
        {editor.step === 'brain' && <BrainStep />}
        {editor.step === 'script' && <ScriptStep />}
      </div>

      <div className={r.summary}>
        <AgentBody archetype={editor.archetype} size={44} state={editor.saving ? 'thinking' : 'ready'} />
        <div className={r.summaryWords}>
          <b>{BODIES[editor.archetype].name}</b>
          <span>
            {sameBrain && editor.agent
              ? `${editor.agent.brain.name} · ${WEIGHT_NAMES[editor.agent.brain.weight]} · ${perMatch(editor.agent.brain.matchMicroUsd)}`
              : quote?.status === 'read'
                ? `${quote.quote.name} · ${WEIGHT_NAMES[quote.quote.weight]} · ${perMatch(quote.quote.matchMicroUsd)}`
                : quote?.status === 'reading'
                  ? '…'
                  : quote
                    ? quote.line
                    : w.noBrain}
          </span>
        </div>
      </div>

      {editor.error && (
        <div className={r.error} role="alert">
          {editor.error}
        </div>
      )}
      {last || !next ? (
        <button className={`${s.display} ${s.action} ${r.go}`} disabled={!ready} aria-busy={editor.saving} onClick={() => void st.save()}>
          {editor.saving ? w.saving : editor.agent ? w.save : w.makeAgent}
        </button>
      ) : (
        <button className={`${s.display} ${s.action} ${r.go}`} disabled={editor.step === 'brain' && !editor.model} onClick={() => st.goTo(next)}>
          {w.next(w[STEP_NAMES[next]])}
        </button>
      )}
    </div>
  );
}

function BodyStep() {
  const archetype = useRing((st) => st.editor?.archetype ?? 'guardian');
  const w = useWords(RING_UI);
  return (
    <>
      <div className={r.stage}>
        <AgentBody archetype={archetype} size={176} />
        <div className={r.stageWords}>
          <div className={r.stageName}>{BODIES[archetype].name}</div>
          <div className={r.line}>{BODIES[archetype].line}</div>
        </div>
      </div>
      <div className={r.bodies} role="radiogroup" aria-label={w.body}>
        {ARCHETYPES.map((a) => (
          <button key={a} role="radio" aria-checked={a === archetype} aria-label={BODIES[a].name} className={[r.bodyTile, a === archetype && r.bodyTileOn].filter(Boolean).join(' ')} onClick={() => ringStore.getState().setArchetype(a)}>
            <AgentBody archetype={a} size={64} dim={a !== archetype} />
            <span>{BODIES[a].name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function BrainStep() {
  const editor = useRing((st) => st.editor);
  const models = useRing((st) => st.models);
  const quotes = useRing((st) => st.quotes);
  const list = useRef<HTMLDivElement>(null);
  const words = useWords(RING_UI);
  if (!editor) return null;
  const st = ringStore.getState();
  const counts = classCounts(models.list);
  const { shown, more } = visibleModels(models.list, editor.weight, editor.search);

  return (
    <>
      <div className={r.classes} role="tablist" aria-label={words.weightClass}>
        {WEIGHTS.map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={editor.weight === w}
            className={[r.classTab, editor.weight === w && r.classTabOn].filter(Boolean).join(' ')}
            onClick={() => {
              st.setWeight(w);
              list.current?.scrollTo({ top: 0 });
            }}
          >
            <b>{WEIGHT_NAMES[w]}</b>
            <span>{classSpan(w)}</span>
            {models.status === 'read' && <i>{counts[w]}</i>}
          </button>
        ))}
      </div>
      <input className={r.search} type="search" placeholder={words.searchModels} aria-label={words.searchModels} value={editor.search} onChange={(e) => st.setSearch(e.target.value)} />
      <div className={r.models} ref={list}>
        {models.status === 'read' ? (
          shown.length ? (
            shown.map((m) => <ModelRow key={m.id} model={m} picked={editor.model === m.id} quote={quotes[m.id]} />)
          ) : (
            <div className={r.note}>{words.noMatch}</div>
          )
        ) : models.status === 'failed' ? (
          <div className={r.note}>
            {models.line}
            <button className={r.retry} onClick={() => void st.readModels()}>
              {words.tryAgain}
            </button>
          </div>
        ) : (
          <div className={r.note}>{words.loadingBrains}</div>
        )}
        {more > 0 && <div className={r.note}>+{more}</div>}
      </div>
    </>
  );
}

function ModelRow({ model, picked, quote }: { model: ModelOption; picked: boolean; quote: QuoteRead | undefined }) {
  return (
    <button className={[r.model, picked && r.modelOn].filter(Boolean).join(' ')} aria-pressed={picked} onClick={() => void ringStore.getState().pickModel(model.id)}>
      <span className={r.modelHead}>
        <b>{model.name}</b>
        <span className={r.modelPrice}>{perMatch(model.matchMicroUsd)}</span>
      </span>
      {picked && quote && (
        <span className={r.pinned}>
          {quote.status === 'read' ? (
            <>
              <span>
                <b>{quote.quote.providerName}</b>
                {quote.quote.weight !== model.weight && <span className={r.moved}> · {WEIGHT_NAMES[quote.quote.weight]}</span>}
              </span>
              <span className={r.formats}>
                {quote.quote.formats.map((f) => (
                  <i key={f}>{FORMAT_NAMES[f]}</i>
                ))}
              </span>
            </>
          ) : quote.status === 'reading' ? (
            <span>…</span>
          ) : (
            <span className={r.refused}>{quote.line}</span>
          )}
        </span>
      )}
    </button>
  );
}

function ScriptStep() {
  const scenario = useRing((st) => st.editor?.scenario ?? '');
  const count = charCount(scenario);
  const w = useWords(RING_UI);
  return (
    <>
      <textarea
        className={r.script}
        aria-label={w.script}
        placeholder={w.scriptHint}
        value={scenario}
        onChange={(e) => ringStore.getState().setScenario(e.target.value)}
      />
      <div className={[r.count, count > SCENARIO_MAX && r.countOver].filter(Boolean).join(' ')}>
        {num(count)} / {num(SCENARIO_MAX)}
      </div>
    </>
  );
}
