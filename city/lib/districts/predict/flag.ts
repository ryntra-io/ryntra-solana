/**
 * Two switches of the deployment. The district — the Predictions window in Practice — opens where the Oracle's switch
 * says `open` (`NEXT_PUBLIC_RYNTRA_CITY_ORACLE`, open to people since 28.10): the dock has «Predict» and the district's
 * billboard stands over the water. Real money opens only where its own switch says `open` too
 * (`NEXT_PUBLIC_RYNTRA_CITY_PREDICT_REAL`) after a canary with a small sum (§18.3 of the spec);
 * until then the window has no Real at all and reads nothing of an account. The engine keeps its own gates either way:
 * live money for this wallet, the venues, the cap of one order, the provider's trading mode.
 */
export function predictOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

/** Real money needs both switches: the district open, and its own. */
export function realOpen(district: string | undefined, real: string | undefined): boolean {
  return predictOpen(district) && predictOpen(real);
}

export const PREDICT_OPEN = predictOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_ORACLE);
export const PREDICT_REAL = realOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_ORACLE, process.env.NEXT_PUBLIC_RYNTRA_CITY_PREDICT_REAL);
