/**
 * Mission Control's words — English only. The H1 and the main line are
 * decision 68's; the descriptor, the title and the description are decision 64's until the operator says otherwise
 * (MC-0, from F2). Titles within 60 characters and descriptions within 160, so a result never cuts them.
 */
export const MISSION_CONTROL_WORDS = {
  h1: "Launch is just the beginning.",
  second: "Launch once. Stay in orbit.",
  descriptor: "Solana-native financial operations platform for people, teams and autonomous agents.",
  lede: "Every Solana token launched on Ryntra flies a public mission: it climbs toward orbit — its own trading pool — and, if it gets there, faces checks on days 7, 30 and 90. All on chain, live.",
  /* The phone's hero has room for one line: what this is. */
  ledeShort: "Every token launched on Ryntra flies a public mission toward orbit — live on Solana.",
  skip: "Skip to how it works",
  title: "Ryntra — Solana-native financial operations platform",
  description: "Launch is just the beginning. Ryntra is a Solana-native financial operations platform for people, teams and autonomous agents.",
  eyebrowLive: "LIVE FROM SOLANA",
  eyebrowDemo: "DEMO · SIMULATED FLIGHTS",
  launch: "Launch a mission",
  watch: "Watch Launch Night",
  openApp: "Open Ryntra",
  noscript: "Mission Control draws the live sky of launches on Ryntra. Turn on JavaScript to watch it, or open the app.",
  controlRoomTitle: (ticker: string) => `${ticker} — Control Room · Ryntra`,
  controlRoomDescription: (ticker: string, name: string) => `${name} (${ticker}) on Ryntra: its flight to orbit, its checks of days 7, 30 and 90, live from the chain.`,
  launchNightTitle: "Launch Night — live from the chain · Ryntra",
  launchNightDescription: "Ryntra's broadcast mode: the missions in flight on Solana, live from the chain, for streams and big screens.",
  meteora: "Built with Meteora infrastructure",
} as const;
