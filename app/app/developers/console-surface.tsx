"use client";

import { Block, Button, EmptyState, Page, Table } from "@ryntra/core/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ConnectWalletButton } from "@/app/solana/workspace/wallet-gate";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { DevEndpointActionResponse, DevKeyIssuedResponse, DevPlanResponse, DevProjectResponse, DevProjectsResponse } from "@/lib/api/v1/contract";
import type { DevAction, DevCredentialKind, DevEnvironment, DevScope, DevWebhookEvent } from "@/lib/core/developer/console";

import styles from "./console.module.css";
import { ACTION_WORDS, ENVIRONMENT_WORDS, EVENT_WORDS, KEY_STATE_WORDS, KIND_WORDS, SCOPE_WORDS, WINDOW_WORDS, consoleWords } from "./console-words";

const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;
const TEAM_ID = /^[0-9a-f]{24}$/;

type Project = DevProjectResponse["project"];
type Summary = DevProjectsResponse["projects"][number];
type Delivery = DevEndpointActionResponse["delivery"];
type Answer<T> = Readonly<{ ok: true; body: T }> | Readonly<{ ok: false; status: number; why: string }>;

const lang = (locale: WorkspaceLocale) => (locale === "uk" ? "uk" : "en");

async function call<T>(path: string, init: RequestInit = {}): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { ...init, headers: HEADERS, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!response.ok || !body) return { ok: false, status: response.status, why: body?.error?.message ?? String(response.status) };
    return { ok: true, body };
  } catch {
    return { ok: false, status: 0, why: "network" };
  }
}

/**
 * «Консоль розробника» (DEV-2): a team's projects, their credentials, their webhook endpoints and what each has
 * spent.
 *
 * Two things this component is written around. A secret lives in React state for as long as the person is looking at
 * it and nowhere else — never in storage, never in a URL, and gone on the next read of the project, because there is
 * no second chance to show it. And every button is drawn from `project.you.may`, which is the server's own answer for
 * this wallet asked before the page rendered: a hidden button is a courtesy, and the refusal behind it is the server's.
 */
export function ConsoleSurface({ locale, plan }: { locale: WorkspaceLocale; plan: DevPlanResponse }) {
  const word = consoleWords(locale);
  const { connection } = useSolanaConnection();
  const wallet = connection?.address ?? null;
  const proof = useWalletProof();

  const [team, setTeam] = useState("");
  const [list, setList] = useState<readonly Summary[] | "unproven" | "unread" | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [mode, setMode] = useState<"home" | "create">("home");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Shown once, then let go: the server cannot say it again. */
  const [secret, setSecret] = useState<Readonly<{ label: string; value: string }> | null>(null);

  const loadList = useCallback(
    async (id: string) => {
      if (!TEAM_ID.test(id)) {
        setList(null);
        return;
      }
      const read = await call<DevProjectsResponse>(`/api/v1/developer/projects?team=${id}`);
      if (read.ok) setList(read.body.projects);
      else setList(read.status === 401 ? "unproven" : "unread");
    },
    [],
  );

  useEffect(() => {
    setProject(null);
    setSecret(null);
    setList(null);
    if (wallet && TEAM_ID.test(team)) void loadList(team);
  }, [wallet, team, loadList]);

  const openProject = useCallback(
    async (id: string) => {
      setFailure(null);
      setSecret(null);
      const read = await call<DevProjectResponse>(`/api/v1/developer/projects/${id}`);
      if (read.ok) setProject(read.body.project);
      else setFailure(word("failed", { why: read.why }));
    },
    [word],
  );

  /** A change: the wallet's own signature first, then the request the server checks again. */
  const act = async <T,>(path: string, body: unknown, done: (value: T) => void) => {
    setBusy(true);
    setFailure(null);
    const proven = await proof.act().catch(() => false);
    if (!proven) {
      setBusy(false);
      setFailure(word("proveLine"));
      return;
    }
    const answer = await call<T>(path, { method: "POST", body: JSON.stringify(body) });
    if (answer.ok) done(answer.body);
    else setFailure(word("failed", { why: answer.why }));
    setBusy(false);
  };

  if (!wallet) {
    return (
      <Page kind="action" className={styles.page} title={word("title")} help={word("help")} lang={lang(locale)}>
        <EmptyState icon="wallet" text={word("connectLine")} action={<ConnectWalletButton />} />
      </Page>
    );
  }

  return (
    <Page kind="action" className={styles.page} title={word("title")} help={word("help")} lang={lang(locale)}>
      {failure ? (
        <p className={styles.hint} role="alert">
          {failure}
        </p>
      ) : null}

      {secret ? <SecretOnce locale={locale} label={secret.label} value={secret.value} onDismiss={() => setSecret(null)} /> : null}

      {project ? (
        <ProjectView
          locale={locale}
          plan={plan}
          project={project}
          busy={busy}
          onBack={() => {
            setProject(null);
            setSecret(null);
          }}
          onIssued={(answer, label) => {
            setProject(answer.project);
            if (answer.issued.secret) setSecret({ label, value: answer.issued.secret });
            void loadList(team);
          }}
          onProject={(value) => {
            setProject(value);
            void loadList(team);
          }}
          onEndpoint={(answer, label) => {
            setProject(answer.project);
            if (answer.secret) setSecret({ label, value: answer.secret });
          }}
          act={act}
        />
      ) : (
        <>
          <Block title={word("team")} icon="landmark" lang={lang(locale)}>
            <label className={styles.field}>
              <span className={styles.label}>{word("team")}</span>
              <input className={`${styles.input} ${styles.mono}`} value={team} onChange={(event) => setTeam(event.target.value.trim())} autoComplete="off" spellCheck={false} />
            </label>
            <p className={styles.hint}>{word("teamHint")}</p>
            <p className={styles.hint}>
              <Link href="/app/treasury/team">{word("teamOpen")}</Link>
            </p>
          </Block>

          {list === "unproven" ? (
            <EmptyState
              icon="wallet"
              text={word("proveLine")}
              action={
                <Button
                  variant="primary"
                  onClick={() =>
                    void proof.act().then((ok) => {
                      if (ok) void loadList(team);
                    })
                  }
                  lang={lang(locale)}
                >
                  {word("prove")}
                </Button>
              }
            />
          ) : list === "unread" ? (
            <p className={styles.hint}>{word("unavailable")}</p>
          ) : mode === "create" ? (
            <Block title={word("createTitle")} icon="plus" lang={lang(locale)}>
              <CreateForm
                locale={locale}
                busy={busy}
                onCancel={() => setMode("home")}
                onSubmit={(name) =>
                  void act<DevProjectResponse>("/api/v1/developer/projects", { team, name }, (value) => {
                    setMode("home");
                    setProject(value.project);
                    void loadList(team);
                  })
                }
              />
            </Block>
          ) : TEAM_ID.test(team) ? (
            <>
              <div className={styles.startRow}>
                <Button variant="primary" icon="plus" onClick={() => setMode("create")} lang={lang(locale)}>
                  {word("create")}
                </Button>
              </div>
              <Block title={word("projects")} icon="layout-grid" lang={lang(locale)}>
                <Table<Summary>
                  columns={[
                    { key: "name", label: word("name"), render: (row) => row.name },
                    { key: "keys", label: word("keys"), render: (row) => String(row.keys) },
                    { key: "endpoints", label: word("endpoints"), render: (row) => String(row.endpoints) },
                    {
                      key: "open",
                      label: word("open"),
                      render: (row) => (
                        <Button variant="ghost" onClick={() => void openProject(row.id)} lang={lang(locale)}>
                          {word("open")}
                        </Button>
                      ),
                    },
                  ]}
                  rows={Array.isArray(list) ? [...list] : []}
                  rowKey={(row) => row.id}
                  caption={word("projects")}
                  empty={list === null ? "…" : word("projectsEmpty")}
                />
              </Block>
            </>
          ) : null}

          <Pricing locale={locale} plan={plan} />
        </>
      )}
    </Page>
  );
}

/** The one place a secret is on a screen, and it says so. */
function SecretOnce({ locale, label, value, onDismiss }: { locale: WorkspaceLocale; label: string; value: string; onDismiss: () => void }) {
  const word = consoleWords(locale);
  return (
    <div className={styles.secret} role="alert">
      <strong>
        {label} — {word("shown")}
      </strong>
      <code className={styles.secretValue}>{value}</code>
      <p className={styles.hint}>{word("shownHint")}</p>
      <div className={styles.formActions}>
        <Button variant="primary" onClick={onDismiss} lang={lang(locale)}>
          {word("dismiss")}
        </Button>
      </div>
    </div>
  );
}

function CreateForm({ locale, busy, onSubmit, onCancel }: { locale: WorkspaceLocale; busy: boolean; onSubmit: (name: string) => void; onCancel: () => void }) {
  const word = consoleWords(locale);
  const [name, setName] = useState("");
  const ok = name.trim().length > 0 && name.trim().length <= 64;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) onSubmit(name.trim());
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>{word("name")}</span>
        <input className={styles.input} value={name} maxLength={64} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </label>
      <div className={styles.formActions}>
        <Button variant="ghost" type="button" onClick={onCancel} lang={lang(locale)}>
          {word("cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={!ok || busy} lang={lang(locale)}>
          {word("create")}
        </Button>
      </div>
    </form>
  );
}

function Pricing({ locale, plan }: { locale: WorkspaceLocale; plan: DevPlanResponse }) {
  const word = consoleWords(locale);
  return (
    <Block title={word("pricing")} icon="info" lang={lang(locale)}>
      <p className={styles.hint}>{word("pricingBody")}</p>
      <p className={`${styles.hint} ${styles.mono}`}>{plan.pricing.fields.join(" · ")}</p>
    </Block>
  );
}

function ProjectView({
  locale,
  plan,
  project,
  busy,
  onBack,
  onIssued,
  onProject,
  onEndpoint,
  act,
}: {
  locale: WorkspaceLocale;
  plan: DevPlanResponse;
  project: Project;
  busy: boolean;
  onBack: () => void;
  onIssued: (answer: DevKeyIssuedResponse, label: string) => void;
  onProject: (project: Project) => void;
  onEndpoint: (answer: DevEndpointActionResponse | { project: Project; secret: string | null }, label: string) => void;
  act: <T>(path: string, body: unknown, done: (value: T) => void) => Promise<void>;
}) {
  const word = consoleWords(locale);
  const say = (pair: Readonly<{ en: string; uk: string }>) => pair[locale];
  const may = (action: DevAction) => project.you.may[action] === true;
  const base = `/api/v1/developer/projects/${project.id}`;
  const [issuing, setIssuing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [lastDelivery, setLastDelivery] = useState<Delivery>(null);

  return (
    <>
      <div className={styles.backRow}>
        <Button variant="ghost" icon="chevron-right" onClick={onBack} lang={lang(locale)}>
          {word("back")}
        </Button>
        <span className={styles.mono}>{project.name}</span>
      </div>

      <Block title={word("keys")} icon="sliders-horizontal" lang={lang(locale)}>
        <Table<Project["keys"][number]>
          columns={[
            { key: "id", label: word("name"), render: (row) => <span className={styles.mono}>{row.name}</span> },
            { key: "token", label: "id", render: (row) => <span className={styles.mono}>{row.id}</span> },
            { key: "kind", label: word("kind"), render: (row) => say(KIND_WORDS[row.kind as DevCredentialKind]) },
            { key: "environment", label: word("environment"), render: (row) => say(ENVIRONMENT_WORDS[row.environment as DevEnvironment]) },
            { key: "scopes", label: word("scopes"), render: (row) => <span className={styles.mono}>{row.scopes.join(" · ")}</span> },
            { key: "origins", label: word("origins"), render: (row) => <span className={styles.mono}>{row.origins.length > 0 ? row.origins.join(" · ") : "—"}</span> },
            { key: "state", label: word("state"), render: (row) => say(KEY_STATE_WORDS[row.state]) },
            { key: "lastUsed", label: word("lastUsed"), render: (row) => (row.lastUsedAt ? row.lastUsedAt.slice(0, 16).replace("T", " ") : word("never")) },
            {
              key: "actions",
              label: word("rights"),
              render: (row) =>
                row.state === "REVOKED" ? null : (
                  <span className={styles.rowActions}>
                    {may("rotateKey") ? (
                      <Button variant="ghost" disabled={busy} onClick={() => void act<DevKeyIssuedResponse>(`${base}/keys/${row.id}`, { action: "rotate", graceHours: 1 }, (value) => onIssued(value, row.name))} lang={lang(locale)}>
                        {word("rotate")}
                      </Button>
                    ) : null}
                    {may("revokeKey") ? (
                      <Button variant="ghost" disabled={busy} onClick={() => void act<DevProjectResponse>(`${base}/keys/${row.id}`, { action: "revoke" }, (value) => onProject(value.project))} lang={lang(locale)}>
                        {word("revoke")}
                      </Button>
                    ) : null}
                  </span>
                ),
            },
          ]}
          rows={[...project.keys]}
          rowKey={(row) => row.id}
          caption={word("keys")}
          empty={word("keysEmpty")}
        />
        <p className={styles.hint}>{word("rotateHint")}</p>
        <p className={styles.hint}>{word("revokeHint")}</p>
        <p className={styles.hint}>{word("publicNoSecret")}</p>
        {may("issueKey") ? (
          issuing ? (
            <IssueForm
              locale={locale}
              plan={plan}
              busy={busy}
              onCancel={() => setIssuing(false)}
              onSubmit={(body) =>
                void act<DevKeyIssuedResponse>(`${base}/keys`, body, (value) => {
                  setIssuing(false);
                  onIssued(value, body.name);
                })
              }
            />
          ) : (
            <div className={styles.startRow}>
              <Button variant="primary" icon="plus" onClick={() => setIssuing(true)} lang={lang(locale)}>
                {word("keyIssue")}
              </Button>
            </div>
          )
        ) : null}
      </Block>

      <Block title={word("endpoints")} icon="globe" lang={lang(locale)}>
        <Table<Project["endpoints"][number]>
          columns={[
            { key: "url", label: word("url"), render: (row) => <span className={styles.mono}>{row.url}</span> },
            { key: "environment", label: word("environment"), render: (row) => say(ENVIRONMENT_WORDS[row.environment as DevEnvironment]) },
            { key: "events", label: word("events"), render: (row) => <span className={styles.mono}>{row.events.join(" · ")}</span> },
            { key: "state", label: word("state"), render: (row) => (row.enabled ? word("enabled") : word("disabled")) },
            {
              key: "actions",
              label: word("rights"),
              render: (row) => (
                <span className={styles.rowActions}>
                  {may("changeEndpoint") ? (
                    <Button variant="ghost" disabled={busy} onClick={() => void act<DevEndpointActionResponse>(`${base}/endpoints/${row.id}`, { action: row.enabled ? "disable" : "enable" }, (value) => onProject(value.project))} lang={lang(locale)}>
                      {row.enabled ? word("disable") : word("enable")}
                    </Button>
                  ) : null}
                  {may("sendTest") && row.enabled ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void act<DevEndpointActionResponse>(`${base}/endpoints/${row.id}`, { action: "test" }, (value) => {
                          onProject(value.project);
                          setLastDelivery(value.delivery);
                        })
                      }
                      lang={lang(locale)}
                    >
                      {word("sendTest")}
                    </Button>
                  ) : null}
                  {may("changeEndpoint") ? (
                    <Button variant="ghost" disabled={busy} onClick={() => void act<DevEndpointActionResponse>(`${base}/endpoints/${row.id}`, { action: "rotateSecret" }, (value) => onEndpoint(value, row.url))} lang={lang(locale)}>
                      {word("rotateSecret")}
                    </Button>
                  ) : null}
                  {may("changeEndpoint") ? (
                    <Button variant="ghost" disabled={busy} onClick={() => void act<DevEndpointActionResponse>(`${base}/endpoints/${row.id}`, { action: "remove" }, (value) => onProject(value.project))} lang={lang(locale)}>
                      {word("remove")}
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
          rows={[...project.endpoints]}
          rowKey={(row) => row.id}
          caption={word("endpoints")}
          empty={word("endpointsEmpty")}
        />
        <p className={styles.hint}>{word("madeOff")}</p>
        <p className={styles.hint}>{word("rotateSecretHint")}</p>
        <p className={styles.hint}>{word("eventsOnlyPing")}</p>
        {lastDelivery ? (
          <p className={styles.hint}>
            {lastDelivery.state === "DELIVERED" ? word("delivered") : word("failedState")} · {word("attempts")} {lastDelivery.attempts} · {word("answer")} {lastDelivery.status ?? "—"}
            {lastDelivery.error ? ` · ${lastDelivery.error}` : ""}
          </p>
        ) : null}
        {may("draftEndpoint") ? (
          adding ? (
            <EndpointForm
              locale={locale}
              plan={plan}
              busy={busy}
              onCancel={() => setAdding(false)}
              onSubmit={(body) =>
                void act<{ project: Project; secret: string }>(`${base}/endpoints`, body, (value) => {
                  setAdding(false);
                  onEndpoint(value, body.url);
                })
              }
            />
          ) : (
            <div className={styles.startRow}>
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)} lang={lang(locale)}>
                {word("endpointAdd")}
              </Button>
            </div>
          )
        ) : null}
      </Block>

      <Block title={word("signing")} icon="circle-check" lang={lang(locale)}>
        <p className={styles.hint}>{word("signingBody")}</p>
        <p className={`${styles.hint} ${styles.mono}`}>
          {plan.webhooks.idHeader} · {plan.webhooks.timestampHeader} · {plan.webhooks.signatureHeader}
        </p>
        <p className={`${styles.hint} ${styles.mono}`}>
          {plan.webhooks.algorithm}({plan.webhooks.signedPayload}) · ±{plan.webhooks.windowSeconds}s · {plan.webhooks.refusals.join(" · ")}
        </p>
      </Block>

      <Block title={word("usage")} icon="chart-column" lang={lang(locale)}>
        {project.usage.map((row) => (
          <div key={row.environment}>
            <p className={styles.label}>{say(ENVIRONMENT_WORDS[row.environment as DevEnvironment])}</p>
            <Table<(typeof row.windows)[number]>
              columns={[
                { key: "window", label: word("window"), render: (entry) => say(WINDOW_WORDS[entry.window]) },
                { key: "used", label: word("used"), render: (entry) => String(entry.used) },
                { key: "left", label: word("left"), render: (entry) => (entry.left === null ? word("noLimit") : String(entry.left)) },
                { key: "resets", label: word("resets"), render: (entry) => entry.resetsAt.slice(0, 16).replace("T", " ") },
              ]}
              rows={[...row.windows]}
              rowKey={(entry) => entry.window}
              caption={`${word("usage")} — ${say(ENVIRONMENT_WORDS[row.environment as DevEnvironment])}`}
              empty="—"
            />
          </div>
        ))}
        <p className={styles.hint}>{word("quotaHint")}</p>
      </Block>

      <Block title={word("rights")} icon="landmark" lang={lang(locale)}>
        <Table<DevAction>
          columns={[
            { key: "action", label: word("rights"), render: (action) => say(ACTION_WORDS[action]) },
            { key: "may", label: word("state"), render: (action) => (may(action) ? word("yes") : word("no")) },
          ]}
          rows={Object.keys(project.you.may) as DevAction[]}
          rowKey={(action) => action}
          caption={word("rights")}
          empty="—"
        />
        <p className={styles.hint}>{word("rightsHint")}</p>
      </Block>

      <Pricing locale={locale} plan={plan} />
    </>
  );
}

function IssueForm({
  locale,
  plan,
  busy,
  onSubmit,
  onCancel,
}: {
  locale: WorkspaceLocale;
  plan: DevPlanResponse;
  busy: boolean;
  onSubmit: (body: { environment: DevEnvironment; kind: DevCredentialKind; name: string; scopes: DevScope[]; origins?: string[] }) => void;
  onCancel: () => void;
}) {
  const word = consoleWords(locale);
  const say = (pair: Readonly<{ en: string; uk: string }>) => pair[locale];
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DevCredentialKind>("SECRET");
  const [environment, setEnvironment] = useState<DevEnvironment>("test");
  const [scopes, setScopes] = useState<DevScope[]>(["read:key"]);
  const [origins, setOrigins] = useState("");

  const originList = origins
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const ok = name.trim().length > 0 && scopes.length > 0 && (kind === "SECRET" ? originList.length === 0 : originList.length > 0);

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) onSubmit({ environment, kind, name: name.trim(), scopes, ...(kind === "PUBLIC" ? { origins: originList } : {}) });
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>{word("name")}</span>
        <input className={styles.input} value={name} maxLength={64} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{word("kind")}</span>
        <select className={styles.input} value={kind} onChange={(event) => setKind(event.target.value as DevCredentialKind)}>
          {plan.kinds.map((row) => (
            <option key={row.kind} value={row.kind}>
              {say(KIND_WORDS[row.kind as DevCredentialKind])}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{word("environment")}</span>
        <select className={styles.input} value={environment} onChange={(event) => setEnvironment(event.target.value as DevEnvironment)}>
          {plan.environments.map((entry) => (
            <option key={entry} value={entry}>
              {say(ENVIRONMENT_WORDS[entry as DevEnvironment])}
            </option>
          ))}
        </select>
      </label>
      <fieldset className={styles.field}>
        <span className={styles.label}>{word("scopes")}</span>
        <div className={styles.checks}>
          {plan.scopes.map((scope) => (
            <label key={scope} className={styles.check}>
              <input
                type="checkbox"
                checked={scopes.includes(scope as DevScope)}
                onChange={(event) => setScopes((held) => (event.target.checked ? [...held, scope as DevScope] : held.filter((entry) => entry !== scope)))}
              />
              <span>
                <span className={styles.mono}>{scope}</span> — {say(SCOPE_WORDS[scope as DevScope])}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {kind === "PUBLIC" ? (
        <label className={styles.field}>
          <span className={styles.label}>{word("origins")}</span>
          <textarea className={`${styles.input} ${styles.textarea} ${styles.mono}`} value={origins} onChange={(event) => setOrigins(event.target.value)} spellCheck={false} />
          <span className={styles.hint}>{word("originsHint")}</span>
        </label>
      ) : (
        <p className={styles.hint}>{word("originsNone")}</p>
      )}
      <div className={styles.formActions}>
        <Button variant="ghost" type="button" onClick={onCancel} lang={lang(locale)}>
          {word("cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={!ok || busy} lang={lang(locale)}>
          {word("keyIssue")}
        </Button>
      </div>
    </form>
  );
}

function EndpointForm({
  locale,
  plan,
  busy,
  onSubmit,
  onCancel,
}: {
  locale: WorkspaceLocale;
  plan: DevPlanResponse;
  busy: boolean;
  onSubmit: (body: { environment: DevEnvironment; url: string; events: DevWebhookEvent[] }) => void;
  onCancel: () => void;
}) {
  const word = consoleWords(locale);
  const say = (pair: Readonly<{ en: string; uk: string }>) => pair[locale];
  const [url, setUrl] = useState("");
  const [environment, setEnvironment] = useState<DevEnvironment>("test");
  const [events, setEvents] = useState<DevWebhookEvent[]>([...plan.events] as DevWebhookEvent[]);
  const ok = url.trim().startsWith("https://") && events.length > 0;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) onSubmit({ environment, url: url.trim(), events });
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>{word("url")}</span>
        <input className={`${styles.input} ${styles.mono}`} value={url} maxLength={300} onChange={(event) => setUrl(event.target.value)} autoComplete="off" spellCheck={false} />
        <span className={styles.hint}>{word("urlHint")}</span>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{word("environment")}</span>
        <select className={styles.input} value={environment} onChange={(event) => setEnvironment(event.target.value as DevEnvironment)}>
          {plan.environments.map((entry) => (
            <option key={entry} value={entry}>
              {say(ENVIRONMENT_WORDS[entry as DevEnvironment])}
            </option>
          ))}
        </select>
      </label>
      <fieldset className={styles.field}>
        <span className={styles.label}>{word("events")}</span>
        <div className={styles.checks}>
          {plan.events.map((entry) => (
            <label key={entry} className={styles.check}>
              <input
                type="checkbox"
                checked={events.includes(entry as DevWebhookEvent)}
                onChange={(change) => setEvents((held) => (change.target.checked ? [...held, entry as DevWebhookEvent] : held.filter((row) => row !== entry)))}
              />
              <span>{say(EVENT_WORDS[entry as DevWebhookEvent])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.formActions}>
        <Button variant="ghost" type="button" onClick={onCancel} lang={lang(locale)}>
          {word("cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={!ok || busy} lang={lang(locale)}>
          {word("endpointAdd")}
        </Button>
      </div>
    </form>
  );
}
