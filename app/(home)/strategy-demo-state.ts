/**
 * The demonstration's state, as a pure reducer.
 *
 * Eight stages: 0 Idea, 1 Research, 2 Critic, 3 Risk, 4 Strategy,
 * 5 Your decision, 6 Monitor, 7 Results.
 *
 * The rule the whole example exists to show is the one enforced here: a
 * changed condition raises the version, drops the approval, and no stage past
 * the decision can proceed on a version the reader has not reviewed. It is
 * local state only — nothing here reaches a wallet, an account or the network.
 */
export const DEMO_STAGES = 8;
export const DECISION_STAGE = 5;
export const MONITOR_STAGE = 6;
export const RESULTS_STAGE = 7;

export type DemoState = Readonly<{
  stage: number;
  version: number;
  approvedVersion: number | null;
  reviewRequired: boolean;
  choice: "watch" | "reject" | null;
  budget: 15 | 25;
  editing: boolean;
  priceChanged: boolean;
}>;

export type DemoEvent =
  | { type: "select"; stage: number }
  | { type: "next" | "back" | "reset" | "change_condition" | "review" | "edit" }
  | { type: "set_budget"; budget: 15 | 25 }
  | { type: "choose"; choice: "watch" | "reject" };

export const INITIAL_DEMO: DemoState = {
  stage: 0, version: 1, approvedVersion: null, reviewRequired: false,
  choice: null, budget: 25, editing: false, priceChanged: false,
};

/** Watching is only true for the version that was actually approved. */
export function isDemoWatching(state: DemoState): boolean {
  return state.choice === "watch" && !state.reviewRequired && state.approvedVersion === state.version;
}

/** A pending review, except once the idea has been rejected outright. */
export function needsReview(state: DemoState): boolean {
  return state.reviewRequired && state.choice !== "reject";
}

/** Forward is blocked while a decision is missing or a review is outstanding. */
export function canAdvance(state: DemoState): boolean {
  if (state.stage >= RESULTS_STAGE) return false;
  if (needsReview(state)) return false;
  if (state.stage === DECISION_STAGE && state.choice === null) return false;
  return true;
}

export function demoTransition(state: DemoState, event: DemoEvent): DemoState {
  switch (event.type) {
    case "reset":
      return INITIAL_DEMO;
    case "select":
      return Number.isInteger(event.stage) && event.stage >= 0 && event.stage < DEMO_STAGES
        ? { ...state, stage: event.stage }
        : state;
    case "back":
      return { ...state, stage: Math.max(0, state.stage - 1) };
    case "next":
      return canAdvance(state) ? { ...state, stage: Math.min(RESULTS_STAGE, state.stage + 1) } : state;
    /* The market moved. The plan is a new version, the approval is gone, and
       the reader is put where the change is visible. */
    case "change_condition":
      return {
        ...state, stage: MONITOR_STAGE, version: state.version + 1, approvedVersion: null,
        reviewRequired: true, choice: null, priceChanged: true,
      };
    case "review":
      return { ...state, stage: DECISION_STAGE, approvedVersion: null, reviewRequired: false, choice: null, editing: false };
    case "edit":
      return { ...state, stage: 4, approvedVersion: null, choice: null, editing: true };
    case "set_budget":
      if (state.stage !== 4 || (event.budget !== 15 && event.budget !== 25) || state.budget === event.budget) return state;
      return { ...state, budget: event.budget, version: state.version + 1, approvedVersion: null, choice: null };
    case "choose":
      if (state.stage !== DECISION_STAGE) return state;
      /* Rejecting is always available — refusing an idea needs no review. */
      if (event.choice === "reject") return { ...state, stage: RESULTS_STAGE, choice: "reject", approvedVersion: null, reviewRequired: false };
      if (state.reviewRequired) return state;
      return { ...state, stage: MONITOR_STAGE, choice: "watch", approvedVersion: state.version };
  }
}
