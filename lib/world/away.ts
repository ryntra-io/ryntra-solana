import { AWAY_ABOUT, AWAY_CHANNELS, type AwayAbout, type AwayBeat, type AwayChannel, type AwayConsent, type AwayReport, type BuildingKind, type PublicBuilding, type WorldEvent } from "./contract";

/**
 * «While you were away», folded for twenty seconds of screen. Pure: the
 * route gives it the events the store found and what the person owns, and it
 * says which lines are worth showing, most personal first.
 *
 * What a line is about, in this order: my quarters (visits, anything that
 * happened to them), the engine objects my buildings show (a coin, a pool
 * position, a team), my district (newcomers, the neighbours' buildings), the
 * city (the market's and the engine's moments). Events of one kind about one
 * thing fold into one line with a count; every line keeps its source and the
 * times of its newest and oldest event. An event without a source time is
 * never shown.
 *
 * The world never counts money: `detail` carries only plain figures an event
 * itself gave, as it gave them.
 */

/** The most lines a report holds, and the most of each kind: twenty seconds is four to six of them. */
export const AWAY_BEATS = 8;
export const AWAY_PER_ABOUT: Readonly<Record<AwayAbout, number>> = { quarter: 3, object: 3, district: 2, city: 2 };
const DETAIL_KEYS = 8;

/** An engine object a building of mine shows, by the subject its events carry. */
export type AwayObject = { quarterId: string; slot: number; kind: BuildingKind; linkKind: string };

export type AwayMine = {
  quarterIds: ReadonlySet<string>;
  objects: ReadonlyMap<string, AwayObject>;
};

/** The subject an engine object's events carry: the mint, the position, the strategy, the team or the agent. */
export function linkSubject(link: PublicBuilding["link"]): string | null {
  if (!link || link.kind === "prediction_book") return null;
  switch (link.kind) {
    case "mint":
      return link.mint;
    case "lp_position":
      return link.position;
    case "strategy":
      return link.strategyId;
    case "team":
      return link.teamId;
    case "agent":
      return link.agentId;
  }
}

/** What I own, from my quarters and their buildings. */
export function mineOf(quarters: readonly { quarter: { id: string }; buildings: readonly PublicBuilding[] }[]): AwayMine {
  const quarterIds = new Set<string>();
  const objects = new Map<string, AwayObject>();
  for (const { quarter, buildings } of quarters) {
    quarterIds.add(quarter.id);
    for (const b of buildings) {
      const subject = linkSubject(b.link);
      if (subject && b.link) objects.set(subject, { quarterId: quarter.id, slot: b.slot, kind: b.kind, linkKind: b.link.kind });
    }
  }
  return { quarterIds, objects };
}

export function aboutOf(event: Pick<WorldEvent, "subject" | "source">, mine: AwayMine): AwayAbout {
  if (mine.quarterIds.has(event.subject)) return "quarter";
  if (mine.objects.has(event.subject)) return "object";
  // The store gives world events only of my quarters and my district.
  return event.source === "world" ? "district" : "city";
}

const plain = (value: unknown): value is string | number | boolean | null =>
  value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

/**
 * Nobody else is ever named in a line: a key that could carry a person (their wallet, account, name or handle) and any
 * value that reads as a Solana address stay out. What a line is about is its `subject`; the detail only adds figures.
 */
const PERSON_KEY = /wallet|owner|creator|address|account|actor|visitor|resident|user|display|name|email|handle|telegram|signer|payer|holder|trader/i;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The plain figures of an event, as it gave them: no nested objects, a few keys, short strings, no one's identity. */
function plainPayload(payload: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(payload).sort()) {
    if (Object.keys(out).length >= DETAIL_KEYS) break;
    if (PERSON_KEY.test(key)) continue;
    const value = payload[key];
    if (!plain(value)) continue;
    if (typeof value === "string" && (value.length > 64 || ADDRESS.test(value))) continue;
    out[key] = value;
  }
  return out;
}

const streetOf = (event: WorldEvent): string | null => (typeof event.payload?.street === "string" ? event.payload.street : null);

/** Events of one kind about one thing are one line; in my district, one line per kind and street. */
function groupKey(about: AwayAbout, event: WorldEvent): string {
  if (about === "district") return `${about}:${event.kind}:${streetOf(event) ?? ""}`;
  return `${about}:${event.kind}:${event.subject}`;
}

export function awayReport(events: readonly WorldEvent[], mine: AwayMine): AwayReport {
  const counts = Object.fromEntries(AWAY_ABOUT.map((a) => [a, 0])) as Record<AwayAbout, number>;
  const groups = new Map<string, { about: AwayAbout; events: WorldEvent[] }>();
  const shown = events
    .filter((e) => typeof e.sourceAt === "string" && Number.isFinite(Date.parse(e.sourceAt)))
    .sort((a, b) => Date.parse(b.sourceAt) - Date.parse(a.sourceAt) || (a.id < b.id ? -1 : 1));
  for (const e of shown) {
    const about = aboutOf(e, mine);
    counts[about] += 1;
    const key = groupKey(about, e);
    const group = groups.get(key);
    if (group) group.events.push(e);
    else groups.set(key, { about, events: [e] });
  }

  const beats: AwayBeat[] = [];
  for (const about of AWAY_ABOUT) {
    const lines = [...groups.values()].filter((g) => g.about === about).slice(0, AWAY_PER_ABOUT[about]);
    for (const g of lines) beats.push(beatOf(about, g.events, mine));
  }
  return { beats: beats.slice(0, AWAY_BEATS), counts };
}

function beatOf(about: AwayAbout, events: readonly WorldEvent[], mine: AwayMine): AwayBeat {
  const newest = events[0]!;
  const oldest = events[events.length - 1]!;
  const detail = plainPayload(newest.payload ?? {});
  if (newest.kind === "visit") {
    // How many came, and how many of them signed in with a wallet: the world's checked people.
    detail.verified = events.filter((e) => e.payload?.verifiedHuman === true).length;
    delete detail.verifiedHuman;
  }
  const object = about === "object" ? mine.objects.get(newest.subject) : undefined;
  if (object) {
    detail.slot = object.slot;
    detail.building = object.kind;
    detail.linkKind = object.linkKind;
  }
  return {
    id: newest.id,
    about,
    kind: newest.kind,
    source: newest.source,
    subject: about === "district" ? (streetOf(newest) ?? newest.subject) : newest.subject,
    count: events.length,
    at: newest.sourceAt,
    from: oldest.sourceAt,
    street: streetOf(newest),
    detail,
    eventIds: events.map((e) => e.id),
  };
}

/* ---------------------------------------------------------------- notice -- */

export const NO_CONSENT: AwayConsent = Object.freeze({ telegram: false, push: false, updatedAt: null });

/**
 * The report as a notice for one channel, made only when the person turned that channel on and there is something
 * to say. Nothing in the world sends it: a notice is what a sender — the assistant's Telegram, a push — would take,
 * and its `key` makes the same report go out at most once per channel.
 */
export type AwayNotice = {
  key: string;
  channel: AwayChannel;
  residentId: string;
  since: string;
  until: string;
  beats: AwayBeat[];
};

/** The most lines a notice carries: a message says less than the screen. */
export const NOTICE_BEATS = 3;

export function awayNotices(input: Readonly<{ residentId: string; since: string; until: string; report: AwayReport; consent: AwayConsent | null }>): AwayNotice[] {
  if (!input.consent || input.report.beats.length === 0) return [];
  return AWAY_CHANNELS.filter((channel) => input.consent![channel] === true).map((channel) => ({
    key: `away:${input.residentId}:${channel}:${input.until}`,
    channel,
    residentId: input.residentId,
    since: input.since,
    until: input.until,
    beats: input.report.beats.slice(0, NOTICE_BEATS),
  }));
}
