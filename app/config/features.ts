import type { LocaleCode } from "../i18n/locales";

export type Lang = LocaleCode;

/* Feature flags. Live features stay OFF until gates clear.
   TRUTH RULE: these flags must agree with lib/product/capabilities.ts and
   lib/domain/registry.ts; the consistency test fails the suite on any drift.
   Guarded automation remains after-gate, so no bots flag may be true. */
export const FLAGS = {
  billing: { enabled: false },
  betaGate: { enabled: true, demoRequiresTelegram: true },
  smarttrade: { paper: true, live: false },
  bots: { dcaPaper: false, gridPaper: false, signalPaper: false, live: false },
  terminal: { dom: false, clusters: false, volumeProfile: false, chartDrawings: true, chartIndicators: true },
  agent: { copilot: false },
  strategyLab: { preview: true, navigation: false, persistence: true, execution: false },
} as const;
