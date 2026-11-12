/**
 * Rows that would read the same, told apart (CITY-243): three «SOL · USDC» among the Piers, three «STAIR-USDC» in Earn's
 * «Mine», two «$THUMB» tabs in «My tower». A row whose name is its own needs nothing more. Where names repeat, every one
 * of the namesakes takes the first of its marks — a fee, a range, a day — that tells them all apart; where no mark does,
 * its place among them («2»). Pure: the windows and the tests read it alike.
 */

export type Named = Readonly<{ name: string; marks: readonly (string | null | undefined)[] }>;

/** Each row's mark beside its name, or null where its name is already its own. */
export function apart(rows: readonly Named[]): (string | null)[] {
  const groups = new Map<string, number[]>();
  rows.forEach((row, at) => groups.set(row.name, [...(groups.get(row.name) ?? []), at]));
  const marks: (string | null)[] = rows.map(() => null);
  for (const at of groups.values()) {
    if (at.length < 2) continue;
    const width = Math.max(...at.map((i) => rows[i]!.marks.length));
    let pick = -1;
    for (let m = 0; m < width && pick < 0; m += 1) {
      const seen = at.map((i) => rows[i]!.marks[m] ?? null);
      if (seen.every((mark) => mark !== null && mark !== '') && new Set(seen).size === seen.length) pick = m;
    }
    at.forEach((i, n) => {
      marks[i] = pick >= 0 ? (rows[i]!.marks[pick] as string) : String(n + 1);
    });
  }
  return marks;
}
