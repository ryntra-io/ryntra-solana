'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBackPanel } from '@/city/lib/back/panels';
import { useFeedPanel } from '@/city/lib/feed/panel';
import { topPanelTakesEscape } from '@/city/lib/hud/top-panels';
import { ARCHETYPES, SCENARIO_MAX, WEIGHTS } from '@/lib/ring/contract';
import { BODIES } from '@/city/lib/ring/body';
import { FORMAT_NAMES, WEIGHT_NAMES, agentLabel, brainLabel, catalogName, brainNamed, charCount, classSpan, perMatch, twinMarks } from '@/city/lib/ring/format';
import { STEPS, canSave, classCounts, ownBrainRow, ringStore, useRing, visibleModels, type BrainRow, type QuoteRead, type Step } from '@/city/lib/ring/store';
import { CloseGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { AgentBody } from './AgentBody';
import r from './ring.module.css';
import { RING_UI } from './words';
import { num, useWords, type TextKey } from '@/city/lib/i18n/dict';

const STEP_NAMES: Record<Step, TextKey<typeof RING_UI>> = { body: 'body', brain: 'brain', script: 'script' };

/**
 * The marks that tell two brains of one shortened name apart (CITY-240), for the list and for the line that names the
 * pick: the catalog's brains, and the agent's own when the list no longer offers it.
 */
function useTwinMarks(): ReadonlyMap<string, string> {
  const list = useRing((st) => st.models.list);
  const own = useRing((st) => st.editor?.agent?.brain ?? null);
  return useMemo(() => twinMarks(own && !list.some((m) => m.id === own.id) ? [...list, own] : list), [list, own]);
}

/**
 * The screen that makes or changes an agent (CITY-50): body, brain, script — three steps, one amber action. The brain
 * is any model of OpenRouter's live catalog, sorted into weight classes, each with its price for a match before it is
 * picked; a pick is pinned to one provider by the server and its own price, class and formats shown before saving.
 * Over the city from a garage's sheet; `inline` inside the Arena's window, on its «Agent» tab (CITY-217).
 */
export function RingEditor({ inline = false }: { inline?: boolean } = {}) {
  const editor = useRing((st) => st.editor);
  const quotes = useRing((st) => st.quotes);
  const ready = useRing((st) => canSave(st.editor, st.quotes));
  const w = useWords(RING_UI);
  // The brain's name as its catalog writes it, and the provider it is pinned to: behind one quiet «i» (CITY-236).
  const [about, setAbout] = useState(false);
  const marks = useTwinMarks();

  // Escape closes this screen and nothing under it: the quarter's own Escape (back to the city) waits for the next press.
  // A panel of the top bar open over the screen — the events', the wallet's — closes first, alone, and the draft stays
  // (CITY-240: this listener hears the key before the panel's own).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (topPanelTakesEscape(useFeedPanel.getState().open, document)) return;
      event.preventDefault();
      event.stopPropagation();
      ringStore.getState().closeEditor();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // «Back» of a phone and of a browser is a step of this screen (CITY-236): script → brain → body, then the screen
  // itself — the Arena's window, or the garage's sheet, stays. While the agent is being saved «Back» waits.
  useBackPanel('ring-editor', editor !== null, () => {
    const ring = ringStore.getState();
    const now = ring.editor;
    if (!now || now.saving) return;
    const at = STEPS.indexOf(now.step);
    if (at > 0) ring.goTo(STEPS[at - 1]!);
    else ring.closeEditor();
  });

  if (!editor) return null;
  const st = ringStore.getState();
  const last = editor.step === 'script';
  const next = STEPS[STEPS.indexOf(editor.step) + 1];
  const quote = editor.model ? quotes[editor.model] : undefined;
  const sameBrain = editor.agent?.brain.id === editor.model;
  // The brain picked, as the summary names it: the agent's own while it is unchanged, else the server's quote.
  const brain =
    sameBrain && editor.agent
      ? { name: editor.agent.brain.name, provider: editor.agent.brain.providerName, weight: editor.agent.brain.weight, cost: editor.agent.brain.matchMicroUsd }
      : quote?.status === 'read'
        ? { name: quote.quote.name, provider: quote.quote.providerName, weight: quote.quote.weight, cost: quote.quote.matchMicroUsd }
        : null;

  return (
    <div className={[r.editor, inline && r.editorInline].filter(Boolean).join(' ')} role={inline ? 'group' : 'dialog'} aria-label={w.agent}>
      <div className={r.head}>
        <div className={`${s.kicker} ${r.kicker}`}>
          <span className={r.dot} aria-hidden="true" />
          {editor.agent ? agentLabel(editor.agent.archetype) : w.newAgent}
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
          <span>{brain ? `${brainNamed(brain.name, marks.get(editor.model ?? '') ?? '')} · ${WEIGHT_NAMES[brain.weight]} · ${perMatch(brain.cost)}` : quote?.status === 'reading' ? '…' : quote && quote.status !== 'read' ? quote.line : w.noBrain}</span>
          {brain && about && (
            <span id="ring-brain-about" className={r.summaryAbout}>
              {[catalogName(brain.name), brain.provider].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        {brain && (
          <button type="button" className={[r.about, about && r.aboutOn].filter(Boolean).join(' ')} aria-label={w.brainAbout} aria-expanded={about} aria-controls="ring-brain-about" onClick={() => setAbout((open) => !open)}>
            i
          </button>
        )}
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
  // Two brains of one name keep the catalog's mark beside it — a date, a size; never its raw «free» or «batch» (CITY-239).
  const marks = useTwinMarks();
  if (!editor) return null;
  const st = ringStore.getState();
  const counts = classCounts(models.list);
  // The agent's own brain stands first, whatever the tab and whether the list still offers it (CITY-240).
  const own = ownBrainRow(editor);
  const { shown, more } = visibleModels(models.list, editor.weight, editor.search, 40, own?.id ?? null);

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
      {/* The list's room, and the list cut to whole rows inside it (CITY-240, ring.module.css). */}
      <div className={r.models}>
        <div className={r.modelList} ref={list}>
          {own && <ModelRow model={own} picked={editor.model === own.id} quote={quotes[own.id]} mark={marks.get(own.id) ?? ''} away={own.weight === editor.weight ? '' : WEIGHT_NAMES[own.weight]} />}
          {models.status === 'read' ? (
            shown.length ? (
              shown.map((m) => <ModelRow key={m.id} model={m} picked={editor.model === m.id} quote={quotes[m.id]} mark={marks.get(m.id) ?? ''} />)
            ) : own ? null : (
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
      </div>
    </>
  );
}

/** A brain's row. `mark` tells it from its twin; `away` names its class when the tab shows another (the agent's own brain). */
function ModelRow({ model, picked, quote, mark, away = '' }: { model: BrainRow; picked: boolean; quote: QuoteRead | undefined; mark: string; away?: string }) {
  return (
    <button className={[r.model, picked && r.modelOn].filter(Boolean).join(' ')} aria-pressed={picked} onClick={() => void ringStore.getState().pickModel(model.id)}>
      <span className={r.modelHead}>
        <b>
          {brainLabel(model.name)}
          {mark ? <i className={r.modelMark}> · {mark}</i> : null}
          {away ? <i className={r.modelMark}> · {away}</i> : null}
        </b>
        <span className={r.modelPrice}>{perMatch(model.matchMicroUsd)}</span>
      </span>
      {picked && quote && (
        <span className={r.pinned}>
          {quote.status === 'read' ? (
            <>
              {/* The provider it is pinned to is the catalog's own word: behind «i» in the summary below (CITY-236). */}
              {quote.quote.weight !== model.weight && <span className={r.moved}>{WEIGHT_NAMES[quote.quote.weight]}</span>}
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
