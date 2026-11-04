'use client';

import { useAssistant } from '@/city/lib/assistant/store';
import { towerForWindow } from '@/city/lib/command/doors';
import { closeCommand } from '@/city/lib/command/store';
import { useWords } from '@/city/lib/i18n/dict';
import { SparkGlyph } from '../assistant/AssistantLayer';
import s from './command.module.css';
import { COMMAND } from './words';

/**
 * Ryntra in every window (CITY-85; helm SPEC §1, §8): one quiet spark in the window's head, beside its own buttons.
 * A tap opens Ryntra's panel about what the window shows — the trade window's coin, the chart's tower — or about the
 * market. Ryntra only advises: it answers with towers and words, and does nothing in the window or the wallet.
 */
export function AskInWindow({ id, className }: { id: string; className: string }) {
  const w = useWords(COMMAND);
  const ask = () => {
    const assistant = useAssistant.getState();
    const tower = towerForWindow(id);
    // A second tap from the same window closes the panel; another window's spark asks about that window instead.
    if (assistant.open && (assistant.subject?.id ?? null) === (tower?.id ?? null)) return assistant.hide();
    if (assistant.open) assistant.hide();
    closeCommand();
    useAssistant.getState().show(tower);
  };
  return (
    <button type="button" className={`${className} ${s.askTool}`} aria-label={w.askRyntra} title={w.askRyntra} aria-haspopup="dialog" onClick={ask}>
      <SparkGlyph />
    </button>
  );
}
