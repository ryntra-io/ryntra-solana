import { createStore } from 'zustand/vanilla';
import { randomId } from '../../../quarter/ids.ts';
import type { FindingView, HackRole, MyAgent, OrderDetail, OrderView, RunFeed } from './contract.ts';
import { HackClientError, httpHack, type HackClient, type OwnerMove, type Verdict } from './client.ts';

/**
 * Hack's window (CITY-227): one window of the Arena's third door, a few screens deep — the orders, an order's card, an
 * agent's run live, a finding's card, the board. Each screen has one main action: take an order, send an agent, stop
 * the order (its owner), confirm a finding (its owner). Nothing here moves money: the reward is a description until the
 * money of CITY-229 opens; the target is always a copy.
 *
 * The person's agent is the Ring's (CITY-50) — read through the Arena's own store, made in the Arena's garage when
 * there is none. The run's journal is read where a server serves it; until then the run screen follows the order's own
 * record (`model.ts`, `eventsOf`).
 */

export type Screen = 'orders' | 'order' | 'run' | 'finding' | 'board';
export type Tab = 'orders' | 'board';

export type ReadStatus = 'idle' | 'reading' | 'read' | 'failed' | 'closed';
export type Read<T> = { readonly status: ReadStatus; readonly value: T };

/** What went wrong, as the window says it: each with a way on, never a dead end. */
export type Problem =
  | 'signIn'
  | 'noAgent'
  | 'ownOrder'
  | 'oneSide'
  | 'shut'
  | 'agentOff'
  | 'tooMany'
  | 'unreachable'
  | 'gone'
  | 'decided'
  | 'noRun'
  | 'unresolved'
  /** The take stands, but the agent did not start: Hack's models are done for the day, the agent has no key, or the run could not be started now. */
  | 'resting'
  | 'quiet'
  | 'idle';

export type Busy = 'take' | 'confirm' | 'reject' | 'pause' | 'resume' | 'signIn' | null;

export type HackState = {
  open: boolean;
  screen: Screen;
  /** The screens behind this one, for «Back» inside the window. */
  trail: Screen[];
  /** The wallet on screen — whose order is whose. */
  me: string | null;
  orders: Read<OrderView[]>;
  orderId: string | null;
  order: Read<OrderDetail | null>;
  findingId: string | null;
  finding: Read<FindingView | null>;
  /** The agent being watched and its run; `value: null` once read — no journal served, the order's record stands in. */
  hunter: string | null;
  run: Read<RunFeed | null>;
  /** The orders the board was counted from. */
  board: Read<OrderDetail[]>;
  side: HackRole;
  role: HackRole;
  busy: Busy;
  problem: Problem | null;
  /** «i» open on this screen. */
  details: boolean;

  show: () => void;
  close: () => void;
  setTab: (tab: Tab) => void;
  back: () => void;
  openOrder: (id: string) => void;
  openFinding: (id: string) => void;
  watch: (hunter: string) => void;
  readOrders: () => Promise<void>;
  readOrder: () => Promise<void>;
  readFinding: () => Promise<void>;
  readRun: () => Promise<void>;
  readBoard: () => Promise<void>;
  setSide: (side: HackRole) => void;
  setRole: (role: HackRole) => void;
  setMe: (wallet: string | null) => void;
  toggleDetails: () => void;
  dismiss: () => void;
  /** Sign in with the wallet; true once signed in. */
  signIn: () => Promise<boolean>;
  /** The Arena's garage, to make the agent that goes on orders. */
  makeAgent: () => void;
  /** «Send an agent»: the person's agent onto the open order, on the side chosen; then its run on screen. */
  sendAgent: () => Promise<void>;
  resolve: (verdict: Verdict) => Promise<void>;
  /** The protocol owner's stop and start of its order. */
  moveOrder: (move: OwnerMove) => Promise<void>;
};

export type HackDeps = {
  client?: () => HackClient;
  newKey?: () => string;
  /** The person's agent that goes on orders: the Ring's first active one. */
  agent?: () => MyAgent | null;
  /** Whether a wallet is signed in, as the Ring's own read says. */
  signedIn?: () => boolean;
  readAgent?: () => Promise<void>;
  signIn?: () => Promise<boolean>;
  makeAgent?: () => void;
  /** How many orders the board reads at most. */
  boardOrders?: number;
};

const idle = <T>(value: T): Read<T> => ({ status: 'idle', value });

/** How many screens «Back» remembers. */
const TRAIL_MAX = 8;

/** A refusal of the routes, as the window says it. */
export function problemOf(error: unknown): Problem {
  if (!(error instanceof HackClientError)) return 'unreachable';
  switch (error.code) {
    case 'SIGN_IN':
      return 'signIn';
    case 'SELF_AUDIT':
      return 'ownOrder';
    case 'BOTH_SIDES':
    case 'HUNTER_TAKEN':
      return 'oneSide';
    case 'CLOSED':
    case 'WINDOW':
    case 'BAD_MOVE':
      return 'shut';
    case 'AGENT_OFF':
    case 'NOT_YOUR_AGENT':
      return 'agentOff';
    case 'RATE_LIMITED':
      return 'tooMany';
    case 'NOT_FOUND':
      return 'gone';
    case 'NOT_PENDING':
    case 'SETTLED':
      return 'decided';
    case 'NO_RUN':
      return 'noRun';
    case 'UNRESOLVED':
      return 'unresolved';
    default:
      return 'unreachable';
  }
}

/** The door itself is shut (the switch is closed): a 404 that names it. */
const shutDoor = (error: unknown) => error instanceof HackClientError && error.status === 404 && error.code === 'CLOSED';

/** A refusal that will not change on a retry: the key of that write is done with. */
const final = (error: unknown) => error instanceof HackClientError && error.status >= 400 && error.status < 500 && error.status !== 429;

export function createHackStore(deps: HackDeps = {}) {
  const client = deps.client ?? (() => httpHack);
  const newKey = deps.newKey ?? randomId;
  const agentOf = deps.agent ?? (() => null);
  const signedIn = deps.signedIn ?? (() => false);
  const limit = deps.boardOrders ?? 12;
  // A retried write sends the key of the first try, until it is answered for good.
  const keys = new Map<string, string>();
  const keyFor = (what: string) => {
    let key = keys.get(what);
    if (!key) keys.set(what, (key = newKey()));
    return key;
  };

  return createStore<HackState>()((set, get) => {
    const go = (screen: Screen, patch: Partial<HackState> = {}) => {
      const { screen: from, trail } = get();
      // Going to where «Back» already leads is a step back, not a longer way: run ↔ finding never piles up.
      const next = from === screen ? trail : trail[trail.length - 1] === screen ? trail.slice(0, -1) : [...trail, from].slice(-TRAIL_MAX);
      set({ ...patch, screen, trail: next, details: false, problem: null });
    };

    // 5 · a slow answer never lands on top of a newer one: each read knows whether it is still the latest.
    let orderRead = 0;
    let runRead = 0;

    /** The owner's own writes: a wallet that is connected but not signed in is asked to sign in once, then the write goes. */
    async function signedWrite<T>(write: () => Promise<T>): Promise<T> {
      try {
        return await write();
      } catch (error) {
        if (!(error instanceof HackClientError) || error.code !== 'SIGN_IN' || !deps.signIn) throw error;
        const ok = await deps.signIn().catch(() => false);
        await deps.readAgent?.();
        if (!ok) throw error;
        return write();
      }
    }

    /** The run's own journal where it is served, and the order's record either way (the steps' fallback). */
    async function readRunOf(order: string, hunter: string) {
      const before = get().run;
      const mine = ++runRead;
      if (before.status !== 'read') set({ run: { ...before, status: 'reading' } });
      try {
        const { run } = await client().run(order, hunter);
        if (mine !== runRead) return;
        if (get().hunter === hunter && get().orderId === order) set({ run: { status: 'read', value: run } });
      } catch {
        if (mine !== runRead) return;
        if (get().hunter === hunter) set({ run: { status: before.status === 'read' ? 'read' : 'failed', value: before.value } });
      }
    }

    return {
      open: false,
      screen: 'orders',
      trail: [],
      me: null,
      orders: idle([]),
      orderId: null,
      order: idle(null),
      findingId: null,
      finding: idle(null),
      hunter: null,
      run: idle(null),
      board: idle([]),
      side: 'attacker',
      role: 'attacker',
      busy: null,
      problem: null,
      details: false,

      show() {
        set({ open: true, problem: null });
        void get().readOrders();
        void deps.readAgent?.();
        const { screen } = get();
        if (screen === 'order') void get().readOrder();
        if (screen === 'board') void get().readBoard();
      },

      close() {
        set({ open: false, details: false, problem: null });
      },

      setTab(tab) {
        set({ screen: tab, trail: [], details: false, problem: null });
        if (tab === 'orders') void get().readOrders();
        else void get().readBoard();
      },

      back() {
        const trail = [...get().trail];
        const to = trail.pop() ?? 'orders';
        set({ screen: to, trail, details: false, problem: null });
        if (to === 'order') void get().readOrder();
        if (to === 'orders') void get().readOrders();
      },

      openOrder(id) {
        const same = get().orderId === id;
        go('order', { orderId: id, order: same ? get().order : idle(null) });
        void get().readOrder();
      },

      openFinding(id) {
        const same = get().findingId === id;
        go('finding', { findingId: id, finding: same ? get().finding : idle(null) });
        void get().readFinding();
      },

      watch(hunter) {
        const same = get().hunter === hunter;
        go('run', { hunter, run: same ? get().run : idle(null) });
        void get().readRun();
      },

      async readOrders() {
        const before = get().orders;
        if (before.status !== 'read') set({ orders: { ...before, status: 'reading' } });
        try {
          const { orders } = await client().orders();
          set({ orders: { status: 'read', value: orders } });
        } catch (error) {
          set({ orders: { status: shutDoor(error) ? 'closed' : before.status === 'read' ? 'read' : 'failed', value: before.value } });
        }
      },

      async readOrder() {
        const id = get().orderId;
        if (!id) return;
        const before = get().order;
        const mine = ++orderRead;
        if (before.status !== 'read') set({ order: { ...before, status: 'reading' } });
        try {
          const detail = await client().order(id);
          if (mine !== orderRead) return;
          if (get().orderId === id) set({ order: { status: 'read', value: detail } });
        } catch (error) {
          if (mine !== orderRead || get().orderId !== id) return;
          if (error instanceof HackClientError && error.code === 'NOT_FOUND') return set({ order: { status: 'read', value: null } });
          set({ order: { status: shutDoor(error) ? 'closed' : before.status === 'read' ? 'read' : 'failed', value: before.value } });
        }
      },

      async readFinding() {
        const id = get().findingId;
        if (!id) return;
        const before = get().finding;
        if (before.status !== 'read') set({ finding: { ...before, status: 'reading' } });
        try {
          const { finding } = await client().finding(id);
          if (get().findingId === id) set({ finding: { status: 'read', value: finding } });
        } catch (error) {
          if (get().findingId !== id) return;
          if (error instanceof HackClientError && error.code === 'NOT_FOUND') return set({ finding: { status: 'read', value: null } });
          set({ finding: { status: before.status === 'read' ? 'read' : 'failed', value: before.value } });
        }
      },

      async readRun() {
        const { orderId, hunter } = get();
        if (!orderId || !hunter) return;
        // The run first: a run that just ended has filed its finding, which the order's read then carries.
        await readRunOf(orderId, hunter);
        await get().readOrder();
      },

      async readBoard() {
        const before = get().board;
        if (before.status !== 'read') set({ board: { ...before, status: 'reading' } });
        try {
          const { orders } = await client().orders();
          const recent = [...orders].filter((o) => o.status !== 'draft').sort((a, b) => b.opensAt - a.opensAt).slice(0, limit);
          // One order that cannot be read leaves the board without it, not without a board.
          const details = await Promise.all(recent.map((o) => client().order(o.id).catch(() => null)));
          set({ board: { status: 'read', value: details.filter((d): d is OrderDetail => d !== null) } });
        } catch (error) {
          set({ board: { status: shutDoor(error) ? 'closed' : before.status === 'read' ? 'read' : 'failed', value: before.value } });
        }
      },

      setSide(side) {
        if (get().side !== side) set({ side });
      },

      setRole(role) {
        if (get().role !== role) set({ role, problem: null });
      },

      setMe(wallet) {
        if (get().me !== wallet) set({ me: wallet });
      },

      toggleDetails() {
        set({ details: !get().details });
      },

      dismiss() {
        set({ problem: null });
      },

      async signIn() {
        if (get().busy) return false;
        set({ busy: 'signIn', problem: null });
        try {
          const ok = (await deps.signIn?.().catch(() => false)) ?? false;
          await deps.readAgent?.();
          return ok && signedIn();
        } finally {
          set({ busy: null });
        }
      },

      makeAgent() {
        set({ problem: null });
        deps.makeAgent?.();
      },

      async sendAgent() {
        const { orderId, role, busy } = get();
        if (!orderId || busy) return;
        if (!signedIn() && !(await get().signIn())) return set({ problem: 'signIn' });
        const agent = agentOf();
        if (!agent) return set({ problem: 'noAgent' });
        const what = `take:${orderId}:${agent.id}:${role}`;
        set({ busy: 'take', problem: null });
        try {
          const taken = await client().take(orderId, agent.id, role, keyFor(what));
          keys.delete(what);
          set({ busy: null });
          get().watch(agent.id);
          // The take stands either way; a run that did not start is said, never left to look like one that goes on.
          const why = taken.run && taken.run.started === false ? taken.run.reason : null;
          if (why === 'DAILY_CAP') set({ problem: 'resting' });
          else if (why === 'NO_BRAIN') set({ problem: 'quiet' });
          else if (why && why !== 'EXISTS' && why !== 'NO_RUN_FOR_ROLE') set({ problem: 'idle' });
        } catch (error) {
          if (final(error)) keys.delete(what);
          set({ busy: null, problem: problemOf(error) });
          if (error instanceof HackClientError && (error.code === 'CLOSED' || error.code === 'WINDOW')) void get().readOrder();
        }
      },

      async resolve(verdict) {
        const { findingId, busy } = get();
        if (!findingId || busy) return;
        const what = `confirm:${findingId}:${verdict}`;
        set({ busy: verdict, problem: null });
        try {
          const { finding } = await signedWrite(() => client().confirm(findingId, verdict, keyFor(what)));
          keys.delete(what);
          set({ busy: null, finding: { status: 'read', value: finding } });
          void get().readOrder();
        } catch (error) {
          if (final(error)) keys.delete(what);
          set({ busy: null, problem: problemOf(error) });
          if (error instanceof HackClientError && (error.code === 'NOT_PENDING' || error.code === 'SETTLED')) void get().readFinding();
        }
      },

      async moveOrder(move) {
        const { orderId, busy } = get();
        if (!orderId || busy) return;
        const what = `move:${orderId}:${move}`;
        set({ busy: move, problem: null });
        try {
          const { order } = await signedWrite(() => client().move(orderId, move, keyFor(what)));
          keys.delete(what);
          const detail = get().order.value;
          // The write's own answer is newer than any read still on its way.
          orderRead += 1;
          set({ busy: null, order: { status: 'read', value: detail ? { ...detail, order } : detail } });
          void get().readOrder();
        } catch (error) {
          if (final(error)) keys.delete(what);
          set({ busy: null, problem: problemOf(error) });
          void get().readOrder();
        }
      },
    };
  });
}

export type HackStore = ReturnType<typeof createHackStore>;
