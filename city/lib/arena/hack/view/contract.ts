import type { AgentResult, TurnRecord } from '../runner/brain.ts';
import type { HackRole } from '../store/contract.ts';
import type { FindingView, OrderView, TakeView } from '../store/service.ts';

/**
 * What Hack's windows read (CITY-227): the routes' own views (CITY-226, `../store/service.ts`) and one more — the live
 * run of an agent on an order, as the harness journals it (CITY-225, `../runner/brain.ts`). Types only: the windows
 * import nothing of the server.
 *
 *   GET /api/arena/hack/orders                 → { orders: OrderView[] }
 *   GET /api/arena/hack/order?id=              → { order: OrderView, takes: TakeView[], findings: FindingView[] }
 *   GET /api/arena/hack/finding?id=            → { finding: FindingView }
 *   GET /api/arena/hack/run?order=&hunter=     → { run: RunFeed | null }      (the run's own route, CITY-238)
 *   POST /api/arena/hack/take · confirm · move
 *
 * Where no run is served — a deployment with no machine to play on, a defender's take — the window follows the agent
 * through the order's own record — its take and its findings — and never waits on a run that is not there
 * (`view/model.ts`, `eventsOf`).
 */

export type { FindingView, OrderView, TakeView, HackRole, TurnRecord, AgentResult };

export type OrderDetail = { readonly order: OrderView; readonly takes: readonly TakeView[]; readonly findings: readonly FindingView[] };

/**
 * One agent's run on an order, live: the harness's journal so far (`TurnRecord[]`, written by the harness, never by the
 * agent), the turn cap, and — once it ends — how, and the finding it filed.
 */
export type RunFeed = {
  readonly order: string;
  readonly hunter: string;
  readonly role: HackRole;
  readonly status: 'running' | 'done';
  /** The most brain turns the run may take (`runAgent`'s `maxTurns`). */
  readonly maxTurns: number;
  readonly history: readonly TurnRecord[];
  /** How the run ended; `null` while it runs. */
  readonly result: AgentResult | null;
  /** The finding the run filed, when it submitted one the store kept. */
  readonly finding: string | null;
  readonly startedAt: number;
};

/** The person's agent that goes on an order: the Ring's agent (CITY-50), by its id, name and body. */
export type MyAgent = { readonly id: string; readonly name: string; readonly archetype: string };
