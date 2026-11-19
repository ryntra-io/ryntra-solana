/* The corners a screen shows, as one line of the form's shots report: «кути на екрані: 0, 4, коло». The measure
   (terminal/shell/form-shots.mjs) names the shape of every visible framed or filled box — `square`, `r<N>`, `pill` (a
   circle, or the switch's track) or `cut` — and counts them by shape; this turns that count into the line a person
   reads. A square, the control's 4 px and a circle are the terminal's form; the cut stands beside them with how many
   boxes carry it. Any other corner is written in px and named as wrong. */

const FORM = [
  ["square", "0"],
  ["r4", "4"],
  ["pill", "коло"],
];

/** The corners of a screen (or of all of them) from the measure's count by shape: the line, and the corners it should not have. */
export function corners(tally, where = "на екрані") {
  const own = FORM.filter(([shape]) => tally[shape] > 0).map(([, word]) => word);
  const other = Object.keys(tally)
    .filter((shape) => /^r\d+$/.test(shape) && shape !== "r4" && tally[shape] > 0)
    .map((shape) => Number(shape.slice(1)))
    .sort((a, b) => a - b)
    .map((px) => `${px} px`);
  const cuts = tally.cut ?? 0;
  const line = `кути ${where}: ${[...own, ...other].join(", ") || "—"}${cuts ? ` · зрізів: ${cuts}` : ""}`;
  return { line, wrong: other };
}

/** Two counts by shape as one, to say the corners of every screen at once. */
export function addTally(into, tally) {
  for (const [shape, n] of Object.entries(tally)) into[shape] = (into[shape] ?? 0) + n;
  return into;
}
