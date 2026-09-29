/** Grid span for an action Review panel whose exact refusals must stay visible. */

export function reviewPanelHeight(args: {
  hasPlan: boolean;
  settled: boolean;
  findingCount: number;
}): 2 | 4 | 7 | 10 | 12 | 16 {
  if (!args.hasPlan) return 2;
  if (args.settled) return 4;
  if (args.findingCount >= 7) return 16;
  if (args.findingCount >= 3) return 12;
  if (args.findingCount >= 1) return 10;
  return 7;
}
