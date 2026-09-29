/**
 * The public vocabulary of the site, and nothing else.
 *
 * This module is client-safe on purpose. The capability registry is ~900 lines
 * of scopes, evidence references and fail-closed policy; pulling it into a
 * browser bundle to read one field is what pushed the previous landing past its
 * size budget. So the server resolves state in `truth.ts` and hands down the
 * small shapes declared here.
 *
 * The states are canon vocabulary (MASTER-PLAN §12), not marketing adjectives.
 * `production` is deliberately absent: nothing has reached it, and a label the
 * product cannot earn has no business existing in the type.
 */

export type PublicState =
  | "live"
  | "testnet_verified"
  | "preview"
  | "paper"
  /**
   * Registered and not started.
   *
   * Added 2026-08-14. Every `planned` capability rendered as `In build`, which
   * beside a named third party reads as "integration under way" — on `/stellar`
   * it sat next to Soroswap, where nothing is called and no quote is fetched.
   * `In build` and `planned` are different claims about who is doing what right
   * now, and the registry could make the distinction while the public
   * vocabulary could not.
   */
  | "planned"
  | "in_build"
  | "after_gate"
  | "research"
  | "re_verifying";

/**
 * The label a visitor reads. Short, upper-cased at the CSS layer, and always
 * accompanied by a scope line — `LIVE` on its own is a claim about a product,
 * `LIVE · Arcus spot RFQ, three registered routes` is a claim about a route.
 */
export const STATE_LABEL: Readonly<Record<PublicState, string>> = {
  live: "Live",
  testnet_verified: "Testnet verified",
  preview: "Preview",
  paper: "Paper",
  planned: "Planned",
  in_build: "In build",
  after_gate: "Behind a gate",
  research: "Research",
  re_verifying: "Re-verifying",
};

/**
 * Colour carries meaning here, never decoration.
 *
 * verified — mint: proven by evidence that exists today.
 * evidence — cyan: real and inspectable, but bounded (paper, preview, testnet).
 * caution  — amber: the claim is aging out of its review window.
 * neutral  — hairline grey: designed, not built. Never green.
 */
export type StateTone = "verified" | "evidence" | "caution" | "neutral";

export const STATE_TONE: Readonly<Record<PublicState, StateTone>> = {
  live: "verified",
  testnet_verified: "verified",
  preview: "evidence",
  paper: "evidence",
  planned: "neutral",
  in_build: "neutral",
  after_gate: "neutral",
  research: "neutral",
  re_verifying: "caution",
};

/** A capability as the public site is allowed to state it. */
export type PublicCapabilityRow = Readonly<{
  id: string;
  label: string;
  state: PublicState;
  stateLabel: string;
  tone: StateTone;
  /** Exactly what the state covers. Never empty. */
  scope: string;
  /** The stated boundary of the claim, verbatim from the registry. */
  limitation: string;
  lastVerifiedAt: string;
}>;

/** A marketing surface (Workspace, Scanner, …) bound to registry capabilities. */
export type PublicSurfaceRow = Readonly<{
  id: string;
  name: string;
  promise: string;
  problem: string;
  state: PublicState;
  stateLabel: string;
  tone: StateTone;
  scope: string;
  capabilityIds: readonly string[];
}>;

/** One environment or adapter. Never labelled a partner. */
export type EnvironmentRow = Readonly<{
  id: string;
  name: string;
  kind: "Chain pack" | "Venue adapter";
  role: string;
  state: PublicState;
  stateLabel: string;
  tone: StateTone;
  scope: string;
}>;

/**
 * One stage of the Decision Circuit.
 *
 * `never` is not a disclaimer bolted on at the end — it is the field that makes
 * the stage honest, so it is required rather than optional.
 */
export type CircuitStage = Readonly<{
  id: string;
  index: string;
  name: string;
  /** What arrives at this stage. */
  takes: string;
  /** What it produces, in the object vocabulary the API actually uses. */
  makes: string;
  /** Who is accountable — software, the user, or an external provider. */
  actor: string;
  /** The boundary. What Ryntra does not do here, whatever the demand. */
  never: string;
  state: PublicState;
  stateLabel: string;
  tone: StateTone;
  scope: string;
}>;

/**
 * A fact row inside one walkthrough step.
 *
 * `kind` is the epistemic role of the line, and it is rendered as a word rather
 * than as a colour — `KNOWN` and `UNKNOWN` must survive a greyscale screenshot
 * and a screen reader, which a green dot does not.
 */
export type WalkFact = Readonly<{
  kind: "KNOWN" | "UNKNOWN" | "YOU SET" | "CHECKED" | "SHOWN" | "EXACT" | "YOURS" | "SCOPE" | "COMPARED" | "RECORDED" | "CARRIED" | "SEPARATE" | "LIMIT" | "NEVER";
  text: string;
}>;

/**
 * One step of the consumer walkthrough.
 *
 * Each step binds exactly one registry capability, so its badge is that
 * capability's own state. A step is never allowed to average five capabilities
 * into one confident label — which is the specific way a marketing card turns
 * two paper features and three live ones into a single green `LIVE`.
 */
export type WalkStep = Readonly<{
  id: string;
  n: string;
  name: string;
  /** What the person is doing at this step, in their words. */
  lead: string;
  facts: readonly WalkFact[];
  state: PublicState;
  stateLabel: string;
  tone: StateTone;
  scope: string;
  limitation: string;
}>;

/**
 * One concrete thing a person can do — or will be able to do.
 *
 * Same rule as `WalkStep`: one card, one capability, one badge. The title is
 * editorial; everything under it is the registry's answer.
 */
export type ActionRow = Readonly<{
  id: string;
  title: string;
  body: string;
  state: PublicState;
  stateLabel: string;
  tone: StateTone;
  scope: string;
  limitation: string;
}>;

export type SiteTruth = Readonly<{
  capabilities: readonly PublicCapabilityRow[];
  surfaces: readonly PublicSurfaceRow[];
  environments: readonly EnvironmentRow[];
  circuit: readonly CircuitStage[];
  /** Understand → Plan → Check risk → Authorize → Review. */
  walkthrough: readonly WalkStep[];
  /** Registry rows a person can use now, in consumer language. */
  today: readonly ActionRow[];
  /** Registry rows that are preview, planned or behind a gate. */
  next: readonly ActionRow[];
  /** True when any public claim has aged out of its review window. */
  anyReVerifying: boolean;
  /** The oldest review date behind the live claims, shown on /status. */
  registryVerifiedAt: string;
}>;
