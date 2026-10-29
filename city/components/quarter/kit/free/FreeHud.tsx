'use client';

import { useEffect, useState } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { PIECES, PIECE_KINDS, pieceCap, signText, type PieceKind } from '@/lib/world/layout';
import { focused, freeStore, useFree, type Note, type Tool } from '@/city/lib/quarter/kit/free/store';
import { useQuarter } from '@/city/lib/quarter/store';
import { FREE_BUILD } from '@/city/lib/quarter/kit/free/switch';
import { LockGlyph } from '../../../hud/glyphs';
import s from '../../../hud/hud.module.css';
import { EraseGlyph, FreeGlyph, PIECE_GLYPH, TurnGlyph, UndoGlyph } from './glyphs';
import f from './free.module.css';

/** The order pieces come in the dock: houses, the street, the light, then the game buildings. */
const ORDER: readonly PieceKind[] = ['block', 'glass', 'arch', 'turret', 'path', 'hedge', 'tree', 'lamp', 'fountain', 'sign', 'arcade', 'vault_house', 'mini_ring'];

export const PIECE_NAMES: Record<PieceKind, string> = {
  block: 'Block',
  glass: 'Glass',
  arch: 'Arch',
  turret: 'Turret',
  path: 'Path',
  hedge: 'Hedge',
  tree: 'Tree',
  lamp: 'Lamp',
  fountain: 'Fountain',
  sign: 'Sign',
  arcade: 'Arcade',
  vault_house: 'Vault',
  mini_ring: 'Ring',
};

/** How long a note stays over the dock. */
const NOTE_MS = 2200;

function noteLine(note: Note, tool: Tool): string {
  if (note.kind !== 'refused') {
    if (note.kind === 'full') return 'Your quarter is full';
    return note.kind === 'offline' ? 'No connection — kept on screen' : 'Updated from your other device';
  }
  switch (note.reason) {
    case 'support':
      return 'Needs a block under it';
    case 'built':
      return 'A building stands here';
    case 'closed':
      return 'This plot opens later';
    case 'kind':
      return tool === 'erase' ? 'Opens later' : `Opens at quarter level ${PIECES[tool].from}`;
    case 'limit':
      return 'One per quarter';
    case 'cap':
      return 'Your quarter is full';
    case 'sign':
      return 'Letters and digits only';
    default:
      return 'No room here';
  }
}

/** Over my quarter while it builds and nothing else is open: the way into free building. */
export function FreeEntry() {
  return FREE_BUILD ? <FreeEntryOpen /> : null;
}

function FreeEntryOpen() {
  const mode = useQuarter((st) => st.mode);
  const slot = useQuarter((st) => st.slot);
  const landing = useQuarter((st) => st.landing);
  if (mode !== 'build' || slot !== null || landing) return null;
  return (
    <button
      className={`${s.panel} ${f.entry}`}
      onClick={() => {
        if (useCity.getState().sound) playTick();
        void freeStore.getState().open();
      }}
    >
      <FreeGlyph />
      Free build
    </button>
  );
}

/**
 * Free building's one screen: how full the quarter is, a line for a moment when a piece did not go down, the pieces in
 * a strip under the thumb with the eraser first, the turn and the step back, and one amber action that ends it. The
 * piece goes down with a tap on the lot; nothing to confirm. A sign in focus opens its words.
 */
export function FreeHud() {
  const me = useQuarter((st) => st.me);
  const tool = useFree((st) => st.tool);
  const count = useFree((st) => st.pieces.length);
  const history = useFree((st) => st.history.length);
  const note = useFree((st) => st.note);
  const status = useFree((st) => st.status);
  const sign = useFree((st) => {
    const p = focused(st);
    return p?.kind === 'sign' ? p : null;
  });
  const level = me?.quarter.level ?? 1;
  const cap = pieceCap(level);

  // A note fades on its own.
  const [shown, setShown] = useState<Note | null>(null);
  useEffect(() => {
    if (!note) return setShown(null);
    setShown(note);
    const timer = setTimeout(() => setShown(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const tick = () => {
    if (useCity.getState().sound) playTick();
  };
  const pick = (t: Tool) => {
    tick();
    if (t !== 'erase' && level < PIECES[t].from) {
      freeStore.setState({ note: { kind: 'refused', reason: 'kind', at: performance.now() }, tool: t });
      return;
    }
    freeStore.getState().choose(t);
  };

  return (
    <div className={f.layer}>
      <div className={f.top}>
        <span className={`${s.panel} ${f.count}`} aria-label={`${count} of ${cap} pieces`}>
          <b>{count}</b>
          <span>/ {cap}</span>
          <i className={f.meter} style={{ ['--fill' as string]: `${Math.min(1, count / cap)}` }} aria-hidden="true" />
        </span>
      </div>

      {shown && (
        <div className={`${f.note} ${shown.kind === 'synced' ? f.noteCalm : ''}`} role="status" key={shown.at}>
          {noteLine(shown, tool)}
        </div>
      )}

      <div className={`${s.panel} ${f.dock}`} role="toolbar" aria-label="Free build">
        {sign && <SignWords key={`${sign.gx}:${sign.gz}:${sign.y}`} text={sign.text ?? ''} />}
        <div className={f.strip}>
          <button className={`${f.piece} ${tool === 'erase' ? f.pieceOn : ''}`} aria-pressed={tool === 'erase'} aria-label="Erase" onClick={() => pick('erase')}>
            <span className={f.glyph}>
              <EraseGlyph />
            </span>
          </button>
          {ORDER.filter((k) => (PIECE_KINDS as readonly string[]).includes(k)).map((k) => {
            const Glyph = PIECE_GLYPH[k];
            const locked = level < PIECES[k].from;
            const on = tool === k;
            return (
              <button key={k} className={`${f.piece} ${on ? f.pieceOn : ''} ${locked ? f.pieceLocked : ''}`} aria-pressed={on} aria-label={PIECE_NAMES[k]} onClick={() => pick(k)}>
                <span className={f.glyph}>
                  <Glyph />
                </span>
                <span className={f.name}>{PIECE_NAMES[k]}</span>
                {locked && (
                  <span className={f.lock} aria-hidden="true">
                    <LockGlyph />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className={f.row}>
          <button
            className={f.round}
            aria-label="Turn"
            disabled={tool === 'erase'}
            onClick={() => {
              tick();
              freeStore.getState().turn();
            }}
          >
            <TurnGlyph />
          </button>
          <button
            className={f.round}
            aria-label="Undo"
            disabled={history === 0}
            onClick={() => {
              tick();
              freeStore.getState().undo();
            }}
          >
            <UndoGlyph />
          </button>
          <button className={`${s.display} ${s.action} ${f.done}`} disabled={status === 'loading'} onClick={() => freeStore.getState().close()}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** A sign's own words, up to twelve plain letters; only its owner sees them until the city cleans foreign text. */
function SignWords({ text }: { text: string }) {
  const [value, setValue] = useState(text);
  return (
    <label className={f.words}>
      <input
        value={value}
        maxLength={12}
        placeholder="Your words"
        aria-label="Sign"
        enterKeyHint="done"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          const next = e.target.value;
          // Only what a sign takes goes in: the field never holds what would be refused.
          if (next.trim() !== '' && !signText(next).ok) return;
          setValue(next);
          freeStore.getState().setText(next);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}
