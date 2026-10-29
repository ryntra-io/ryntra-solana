/**
 * The markets «Лаунчі на Ryntra» shows anyone (B15): a person's launches, never the team's own technical validations —
 * the demo market and the test runs a creator wallet of Ryntra launched to check the cycle. Those are not demand, and
 * a public board of them read as a launchpad nobody uses; they stay readable by address and in the stats.
 */
export function publicLaunchMarkets<Row extends Readonly<{ technicalValidation: boolean }>>(rows: readonly Row[]): Row[] {
  return rows.filter((row) => !row.technicalValidation);
}
