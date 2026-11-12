import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { SCENARIO_MAX, type AgentView, type Archetype, type ModelOption, type ModelQuote, type Weight } from '../../../lib/ring/contract.ts';
import { randomId } from '../quarter/ids.ts';
import { httpRing, RingClientError, type Draft, type RingClient, type RingClientCode } from './client.ts';
import { charCount } from './format.ts';
import { wordsNow } from '../i18n/dict.ts';
import { langNow } from '../i18n/lang.ts';
import { RING_LINES } from './words.ts';

type RingLine = keyof (typeof RING_LINES)['en'];

/**
 * The Ring in the city (CITY-50): a garage's agent as the sheet shows it, and the screen that makes or changes one —
 * body, brain, script. The brain picker reads OpenRouter's catalog through `/api/ring/models` once, with every price
 * shown before a pick; a pick is quoted (`/api/ring/model`) so the class, price and formats are the pinned provider's
 * own before anything is saved. Every save carries its own key: a retry of the same draft is done once.
 */

export type GarageRead = { status: 'reading' } | { status: 'read'; agent: AgentView | null; mine: boolean } | { status: 'failed'; line: string };

export type QuoteRead = { status: 'reading' } | { status: 'read'; quote: ModelQuote } | { status: 'refused' | 'failed'; line: string };

export type Step = 'body' | 'brain' | 'script';
export const STEPS: readonly Step[] = ['body', 'brain', 'script'];

export type Editor = {
  quarterId: string;
  slot: number;
  /** The agent being changed, as last read; null while making a new one. */
  agent: AgentView | null;
  step: Step;
  archetype: Archetype;
  model: string | null;
  scenario: string;
  /** The brain picker's class tab and search. */
  weight: Weight;
  search: string;
  saving: boolean;
  /** The save's Idempotency-Key: the same while the draft does not change, so a retry is done once. */
  key: string;
  error: string | null;
};

export type RingState = {
  garages: Record<string, GarageRead>;
  models: { status: 'idle' | 'reading' | 'read' | 'failed'; list: ModelOption[]; stale: boolean; line: string | null };
  quotes: Record<string, QuoteRead>;
  editor: Editor | null;
  /** The agent whose switch-off waits for a second tap. */
  confirmOff: string | null;
  offing: boolean;
  offError: string | null;
  readGarage: (quarterId: string, slot: number) => Promise<void>;
  openEditor: (quarterId: string, slot: number, agent?: AgentView | null) => void;
  closeEditor: () => void;
  goTo: (step: Step) => void;
  setArchetype: (archetype: Archetype) => void;
  setWeight: (weight: Weight) => void;
  setSearch: (search: string) => void;
  pickModel: (id: string) => Promise<void>;
  setScenario: (text: string) => void;
  readModels: () => Promise<void>;
  save: () => Promise<boolean>;
  askOff: (agentId: string | null) => void;
  switchOff: (agent: AgentView) => Promise<void>;
};

export type RingStoreOptions = { client?: () => RingClient; newKey?: () => string };

export const garageKey = (quarterId: string, slot: number) => `${quarterId}:${slot}`;

/**
 * Short lines for the codes whose server message is written for developers; the others are said plainly by the server
 * in English, and in the city's own words in another language.
 */
const PLAIN: Partial<Record<RingClientCode, RingLine>> = {
  OFFLINE: 'offline',
  BAD_REQUEST: 'wrong',
  BAD_ANSWER: 'wrong',
  PAYLOAD_TOO_LARGE: 'tooLarge',
  IDEMPOTENCY_KEY_REQUIRED: 'wrong',
  IDEMPOTENCY_KEY_REUSED: 'wrong',
  MODEL_REFUSED: 'modelRefused',
  MODELS_UNAVAILABLE: 'modelsUnavailable',
  UNAVAILABLE: 'unavailable',
  CLOSED: 'closed',
  FORBIDDEN: 'wrong',
};
const SAID: Partial<Record<RingClientCode, RingLine>> = {
  SIGN_IN: 'signIn',
  NOT_FOUND: 'notFound',
  NOT_YOURS: 'notYours',
  NOT_GARAGE: 'notGarage',
  SLOT_TAKEN: 'slotTaken',
  VERSION: 'version',
  OFF: 'off',
  TOO_LONG: 'tooLong',
  KEY_FAILED: 'keyFailed',
  RATE_LIMITED: 'rateLimited',
};
function lineOf(error: unknown): string {
  const w = wordsNow(RING_LINES);
  if (!(error instanceof RingClientError)) return w.unreachable;
  const plain = PLAIN[error.code];
  if (plain) return w[plain];
  const said = SAID[error.code];
  return said && langNow() !== 'en' ? w[said] : error.message;
}

const searchWords = (search: string) => search.trim().toLowerCase().split(/\s+/).filter(Boolean);
const matches = (m: Readonly<{ id: string; name: string }>, words: readonly string[]) => words.every((w) => m.name.toLowerCase().includes(w) || m.id.toLowerCase().includes(w));

/**
 * The models a tab shows: one class, matching the search by name or id, cheapest first, at most `limit`. `without` — a
 * brain that already has a row of its own above the list (`ownBrainRow`), never listed twice.
 */
export function visibleModels(list: readonly ModelOption[], weight: Weight, search: string, limit = 40, without: string | null = null): { shown: ModelOption[]; more: number } {
  const words = searchWords(search);
  const all = list.filter((m) => m.weight === weight && m.id !== without && matches(m, words));
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/** What a row of the brain picker says of a brain. */
export type BrainRow = Pick<ModelOption, 'id' | 'name' | 'weight' | 'matchMicroUsd'>;

/**
 * The agent's own brain as the first row of the list while the agent is being changed (CITY-240). A person who opens
 * «Brain» to change it must see what the agent thinks with now: the list held that brain only while the catalog still
 * offered it, in the class the tab shows, among the first rows — and on a phone the line that names the pick is put
 * away on this step. So the brain stands first, whatever class the tab shows and whether or not the list still offers
 * it, with the class and the price the agent is pinned at (the agent's own record, as the summary says them). A search
 * that does not name it puts it away with the rest. Null while a new agent is made.
 */
export function ownBrainRow(editor: Pick<Editor, 'agent' | 'search'> | null): BrainRow | null {
  const brain = editor?.agent?.brain;
  if (!editor || !brain) return null;
  const row: BrainRow = { id: brain.id, name: brain.name, weight: brain.weight, matchMicroUsd: brain.matchMicroUsd };
  return matches(row, searchWords(editor.search)) ? row : null;
}

/** How many models each class has. */
export function classCounts(list: readonly ModelOption[]): Record<Weight, number> {
  const counts: Record<Weight, number> = { light: 0, middle: 0, heavy: 0 };
  for (const m of list) counts[m.weight] += 1;
  return counts;
}

/**
 * Whether the draft can be saved: a body, a brain the server has quoted (or the agent's own unchanged brain), a script
 * within its length, nothing on its way.
 */
export function canSave(editor: Editor | null, quotes: Record<string, QuoteRead>): boolean {
  if (!editor || editor.saving || !editor.model) return false;
  if (charCount(editor.scenario) > SCENARIO_MAX) return false;
  if (editor.agent && editor.agent.brain.id === editor.model) return true;
  return quotes[editor.model]?.status === 'read';
}

export function createRingStore(options: RingStoreOptions = {}) {
  const client = options.client ?? (() => httpRing);
  const newKey = options.newKey ?? randomId;

  return createStore<RingState>()((set, get) => {
    /** The draft changed: a new key, and the last refusal no longer stands. */
    const edit = (patch: Partial<Editor>) => {
      const editor = get().editor;
      if (editor) set({ editor: { ...editor, ...patch, key: newKey(), error: null } });
    };
    const putGarage = (agent: AgentView, mine: boolean) => set({ garages: { ...get().garages, [garageKey(agent.quarterId, agent.slot)]: { status: 'read', agent: agent.status === 'active' ? agent : null, mine } } });

    return {
      garages: {},
      models: { status: 'idle', list: [], stale: false, line: null },
      quotes: {},
      editor: null,
      confirmOff: null,
      offing: false,
      offError: null,

      async readGarage(quarterId, slot) {
        const key = garageKey(quarterId, slot);
        if (!get().garages[key]) set({ garages: { ...get().garages, [key]: { status: 'reading' } } });
        try {
          const read = await client().garage(quarterId, slot);
          set({ garages: { ...get().garages, [key]: { status: 'read', agent: read.agent, mine: read.mine } } });
        } catch (error) {
          set({ garages: { ...get().garages, [key]: { status: 'failed', line: lineOf(error) } } });
        }
      },

      openEditor(quarterId, slot, agent = null) {
        set({
          editor: {
            quarterId,
            slot,
            agent,
            step: 'body',
            archetype: agent?.archetype ?? 'guardian',
            model: agent?.brain.id ?? null,
            scenario: agent?.scenario ?? '',
            weight: agent?.brain.weight ?? 'light',
            search: '',
            saving: false,
            key: newKey(),
            error: null,
          },
          confirmOff: null,
        });
        if (get().models.status !== 'read' && get().models.status !== 'reading') void get().readModels();
      },

      closeEditor() {
        set({ editor: null });
      },

      goTo(step) {
        const editor = get().editor;
        if (editor) set({ editor: { ...editor, step } });
      },

      setArchetype: (archetype) => edit({ archetype }),
      setWeight: (weight) => {
        const editor = get().editor;
        if (editor) set({ editor: { ...editor, weight } });
      },
      setSearch: (search) => {
        const editor = get().editor;
        if (editor) set({ editor: { ...editor, search: search.slice(0, 80) } });
      },
      setScenario: (scenario) => edit({ scenario }),

      async pickModel(id) {
        edit({ model: id });
        const known = get().quotes[id];
        if (known?.status === 'read' || known?.status === 'reading') return;
        set({ quotes: { ...get().quotes, [id]: { status: 'reading' } } });
        try {
          const { quote } = await client().quote(id);
          set({ quotes: { ...get().quotes, [id]: { status: 'read', quote } } });
        } catch (error) {
          const refused = error instanceof RingClientError && error.code === 'MODEL_REFUSED';
          set({ quotes: { ...get().quotes, [id]: { status: refused ? 'refused' : 'failed', line: lineOf(error) } } });
        }
      },

      async readModels() {
        set({ models: { ...get().models, status: 'reading', line: null } });
        try {
          const read = await client().models();
          set({ models: { status: 'read', list: read.models, stale: read.stale, line: null } });
        } catch (error) {
          set({ models: { ...get().models, status: 'failed', line: lineOf(error) } });
        }
      },

      async save() {
        const editor = get().editor;
        if (!editor || !canSave(editor, get().quotes)) return false;
        set({ editor: { ...editor, saving: true, error: null } });
        const draft: Draft = { archetype: editor.archetype, model: editor.model!, scenario: editor.scenario };
        try {
          const { agent } = editor.agent
            ? await client().change(editor.agent.id, editor.agent.version, draft, editor.key)
            : await client().create(editor.quarterId, editor.slot, draft, editor.key);
          putGarage(agent, true);
          set({ editor: null });
          return true;
        } catch (error) {
          const now = get().editor;
          if (!now) return false;
          if (error instanceof RingClientError && error.current) {
            // The agent moved on: show it as it is, keep the person's draft, and the next save goes at the new version.
            putGarage(error.current, true);
            const off = error.current.status !== 'active';
            set({ editor: off ? null : { ...now, agent: error.current, saving: false, key: newKey(), error: wordsNow(RING_LINES).changed } });
            return false;
          }
          if (error instanceof RingClientError && error.code === 'SLOT_TAKEN') void get().readGarage(now.quarterId, now.slot);
          // Offline keeps the key: the same draft retried is done once.
          set({ editor: { ...now, saving: false, error: lineOf(error) } });
          return false;
        }
      },

      askOff(agentId) {
        set({ confirmOff: agentId, offError: null });
      },

      async switchOff(agent) {
        if (get().offing) return;
        set({ offing: true, offError: null });
        try {
          const { agent: off } = await client().off(agent.id, agent.version);
          putGarage(off, true);
          set({ offing: false, confirmOff: null });
        } catch (error) {
          if (error instanceof RingClientError && error.current) putGarage(error.current, true);
          set({ offing: false, offError: lineOf(error) });
        }
      },
    };
  });
}

export type RingStore = ReturnType<typeof createRingStore>;

export const ringStore = createRingStore();

export function useRing<T>(pick: (state: RingState) => T): T {
  return useStore(ringStore, pick);
}
