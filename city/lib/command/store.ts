import { create } from 'zustand';
import { useAssistant } from '../assistant/store.ts';
import { useRun } from '../run/store.ts';

/**
 * Whether the city's command line is open (CITY-85): ⌘K or Ctrl+K on a computer, Ryntra's spark in the top bar
 * anywhere — on a phone, its own way in. One thing in front at a time: Ryntra's panel steps aside while it is open, and
 * neither a run nor the building of a quarter has it.
 */
type CommandState = { open: boolean };

export const useCommand = create<CommandState>(() => ({ open: false }));

/** What else keeps the line shut — the building of a quarter, told by `CommandLayer`, whose stores a test cannot load. */
let elsewhere: () => boolean = () => false;

export function shutCommandWhile(busy: () => boolean): void {
  elsewhere = busy;
}

/** The command line can open: not during a run, not while a quarter is being built. */
export function commandAllowed(): boolean {
  return useRun.getState().phase === 'off' && !elsewhere();
}

export function openCommand(): void {
  if (!commandAllowed()) return;
  if (useAssistant.getState().open) useAssistant.getState().hide();
  useCommand.setState({ open: true });
}

export function closeCommand(): void {
  if (useCommand.getState().open) useCommand.setState({ open: false });
}

export function toggleCommand(): void {
  if (useCommand.getState().open) closeCommand();
  else openCommand();
}

// Development hook: lets the screenshot scripts and the console drive the command line.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __command: useCommand, __openCommand: openCommand });
