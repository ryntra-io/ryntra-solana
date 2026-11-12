/**
 * The launch sheet's review as a step back to the fields (CITY-236). «Back» of a phone or a browser and Escape on a
 * desk answer the same way the sheet's own arrow does: from the review to the three fields — the name, the ticker and
 * the picture stay — and only from the fields out of the sheet.
 *
 * The step is there while nothing is under way: before the press, and after a refusal. Under a signature (the upload,
 * the build, the wallet, the send) and on the card of a launch made the arrow is off, so there is no step back either:
 * the sheet itself answers — it holds while the wallet signs, and closes once the launch is done.
 *
 * Pure: the sheet's state comes in (`review-step.test.mjs`).
 */
export type SheetNow = Readonly<{
  sheet: boolean;
  step: 'form' | 'review';
  phase: Readonly<{ step: string }> | null;
}>;

/**
 * Whether the launch sheet may close now: unless a launch is under way (between the upload and the send). An early
 * launch that is set (`opened`) is not under way (CITY-236). Here, not in the HUD, so the sheet's own window
 * (`LaunchLayer`, CITY-242) asks it without importing the HUD that imports it.
 */
export function sheetClosable(phase: SheetNow['phase']): boolean {
  return !phase || phase.step === 'done' || phase.step === 'failed' || phase.step === 'opened';
}

export function reviewStepOpen(now: SheetNow): boolean {
  return now.sheet && now.step === 'review' && (now.phase === null || now.phase.step === 'failed');
}
