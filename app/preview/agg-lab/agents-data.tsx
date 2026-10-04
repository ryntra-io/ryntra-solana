"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AggClient, ExecuteManagedResponse, ExecutionStatusResponse, SmartRouteResponse, UnifiedBalanceResponse } from "@agg-build/sdk";
import { useAggAuthContext, useLiveMarket, useLiveTrades, useMarketArb } from "@agg-build/hooks";

import { CONSOLE_ACTIONS, type ConsoleAction, type ConsoleResult, type ConsoleTable } from "./console-actions";
import { useLab, type LabSelection } from "./lab-context";
import styles from "./console.module.css";
import shell from "./lab.module.css";

/*
 * Tab 2 — what "Trading agents & data" is in AGG's product today.
 *
 * In the AGG admin it is a Get-started checklist: create an API key, connect
 * a market data feed, subscribe to WebSocket updates, go live. There is no
 * ready agent, bot template, playground, terminal or strategy anywhere in
 * the admin or the packages — the offer is the REST API, the WebSocket and
 * the SDK/hooks over them. So this tab is a console over exactly those
 * capabilities, with the real responses, and nothing invented on top.
 */

type Special = "live" | "paper" | "account" | "ledger";

const SPECIALS: readonly { id: Special; group: string; title: string; what: string; sdk: string; needsAuth?: boolean }[] = [
  {
    id: "live",
    group: "Live",
    title: "WebSocket updates",
    what: "Живий агрегований orderbook (snapshot + дельти з seq/checksum), стрічка угод і арбітражна віддача для ринку.",
    sdk: "useLiveMarket(outcomeId) · useLiveTrades(outcomeId) · useMarketArb(marketId)",
  },
  {
    id: "account",
    group: "Account (paper)",
    title: "Balances · positions · orders",
    what: "Paper-рахунок AGG-користувача: PAPER_USD, позиції, ордери — ті самі виклики, що й для live.",
    sdk: 'client.getManagedBalances({ mode: "paper" }) · getExecutionPositions · getExecutionOrders',
    needsAuth: true,
  },
  {
    id: "paper",
    group: "Account (paper)",
    title: "Paper trade — end to end",
    what: "Кроки з документації AGG: баланс → відкритий ринок → smart route (paper) → fill (paper) → ордер → позиція → баланс.",
    sdk: 'getSmartRoute({ mode: "paper" }) → executeManaged({ mode: "paper" })',
    needsAuth: true,
  },
  {
    id: "ledger",
    group: "Account (paper)",
    title: "Paper ledger — server key",
    what: "Ті самі paper-рахунки з боку AGG, прочитані сервером Ryntra їхнім server key (x-app-api-key, scope read): підтвердження угоди з їхнього реєстру, а не з браузера.",
    sdk: "createAggClient({ apiKey }) · listPaperTradingAccounts · getPaperTradingPortfolio · listPaperTradingOrders · listPaperTradingPositions",
  },
];

export function AgentsDataTab({ client }: { client: AggClient }) {
  const auth = useAggAuthContext();
  const [activeId, setActiveId] = useState<string>("search");
  const action = CONSOLE_ACTIONS.find((a) => a.id === activeId) ?? null;
  const special = SPECIALS.find((s) => s.id === activeId) ?? null;

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; title: string; needsAuth?: boolean }[]>();
    for (const a of CONSOLE_ACTIONS) map.set(a.group, [...(map.get(a.group) ?? []), { id: a.id, title: a.title, needsAuth: a.needsAuth }]);
    for (const s of SPECIALS) map.set(s.group, [...(map.get(s.group) ?? []), { id: s.id, title: s.title, needsAuth: s.needsAuth }]);
    return [...map.entries()];
  }, []);

  return (
    <>
      <p className={shell.note}>
        <span>
          <strong>Що це в AGG насправді:</strong> чекліст «API key → market data feed → WebSocket → go live». Готового агента,
          бота, плейграунду чи термінала в адмінці й пакетах немає — є API, WebSocket і SDK/hooks. Нижче — саме вони, з
          реальними відповідями.
        </span>
      </p>
      <div className={styles.layout}>
        <aside className={styles.list} aria-label="Можливості AGG">
          {groups.map(([group, items]) => (
            <section key={group} className={styles.group}>
              <h2 className={styles.groupTitle}>{group}</h2>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.item} ${activeId === item.id ? styles.itemOn : ""}`}
                  aria-pressed={activeId === item.id}
                  onClick={() => setActiveId(item.id)}
                >
                  <span>{item.title}</span>
                  {item.needsAuth ? <span className={styles.lock}>{auth.isAuthenticated ? "user" : "вхід"}</span> : null}
                </button>
              ))}
            </section>
          ))}
        </aside>
        <div className={styles.panel}>
          {action ? <ActionCard key={action.id} client={client} action={action} /> : null}
          {special?.id === "live" ? <LiveCard /> : null}
          {special?.id === "account" ? <AccountCard client={client} /> : null}
          {special?.id === "paper" ? <PaperTradeCard client={client} /> : null}
          {special?.id === "ledger" ? <LedgerCard /> : null}
        </div>
      </div>
    </>
  );
}

/* ---- one documented call ------------------------------------------------ */

function ActionCard({ client, action }: { client: AggClient; action: ConsoleAction }) {
  const { selection, setSelection } = useLab();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConsoleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  const resolved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of action.fields) {
      const typed = values[field.key];
      if (typed != null && typed !== "") out[field.key] = typed;
      else if (field.fromSelection && selection[field.fromSelection]) out[field.key] = String(selection[field.fromSelection]);
      else if (field.kind === "select" && field.options?.[0]) out[field.key] = field.options[0].value;
      else out[field.key] = "";
    }
    return out;
  }, [action.fields, selection, values]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const started = performance.now();
    try {
      const next = await action.run(client, resolved);
      setResult(next);
      setMs(Math.round(performance.now() - started));
    } catch (caught) {
      setResult(null);
      setError(describeError(caught));
      setMs(Math.round(performance.now() - started));
    } finally {
      setBusy(false);
    }
  }, [action, client, resolved]);

  return (
    <section className={styles.card} aria-labelledby={`action-${action.id}`}>
      <div className={styles.cardHead}>
        <h2 id={`action-${action.id}`} className={styles.cardTitle}>
          {action.title}
        </h2>
        {ms != null ? <span className={styles.lock}>{ms} мс</span> : null}
      </div>
      <p className={styles.what}>{action.what}</p>
      <p className={styles.sdk}>{action.sdk}</p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        {action.fields.map((field) => (
          <div key={field.key} className={styles.field}>
            <label htmlFor={`${action.id}-${field.key}`}>{field.label}</label>
            {field.kind === "select" ? (
              <select
                id={`${action.id}-${field.key}`}
                value={resolved[field.key]}
                onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`${action.id}-${field.key}`}
                className={field.fromSelection ? styles.mono : undefined}
                type={field.kind === "number" ? "number" : "text"}
                inputMode={field.kind === "number" ? "decimal" : undefined}
                placeholder={field.placeholder}
                value={resolved[field.key]}
                onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
              />
            )}
          </div>
        ))}
        <button type="submit" className={styles.run} disabled={busy}>
          {busy ? "Запит…" : "Виконати"}
        </button>
      </form>
      {error ? <p className={styles.error}>{error}</p> : null}
      {result ? <ResultView result={result} onSelect={(next) => setSelection((current) => ({ ...current, ...next }))} /> : null}
    </section>
  );
}

function ResultView({ result, onSelect }: { result: ConsoleResult; onSelect: (next: Partial<LabSelection>) => void }) {
  return (
    <>
      <p className={styles.summary}>{result.summary}</p>
      {result.rows?.length ? (
        <dl className={styles.rows}>
          {result.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {result.tables?.map((entry) => (
        <div key={entry.title}>
          <p className={styles.tableTitle}>{entry.title}</p>
          <TableView table={entry.table} onSelect={onSelect} />
        </div>
      ))}
      <details className={styles.raw}>
        <summary>Сира відповідь AGG (JSON)</summary>
        <pre>{JSON.stringify(result.raw, null, 2)}</pre>
      </details>
    </>
  );
}

function TableView({ table, onSelect }: { table: ConsoleTable; onSelect: (next: Partial<LabSelection>) => void }) {
  if (!table.rows.length) return <p className={styles.what}>Порожньо.</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={`${index}-${column}`}>{column}</th>
            ))}
            {table.select ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={typeof cell === "number" ? styles.num : undefined}>
                  {cell == null ? "—" : String(cell)}
                </td>
              ))}
              {table.select ? (
                <td>
                  {table.select[index] ? (
                    <button type="button" className={styles.pick} onClick={() => onSelect(table.select![index]!)}>
                      Обрати
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- WebSocket, through their hooks ------------------------------------- */

function LiveCard() {
  const { selection } = useLab();
  /* Their live hooks are keyed by the outcome id (the SDK seeds them from
     GET /orderbook/outcome/:id and subscribes the WebSocket by outcome); the
     arbitrage return is per market. */
  const outcomeId = selection.outcomeId;
  const marketId = selection.marketId;
  const live = useLiveMarket(outcomeId);
  const trades = useLiveTrades(outcomeId);
  const arb = useMarketArb(marketId);
  const [deltas, setDeltas] = useState(0);
  const lastSeq = useRef<number | null>(null);

  useEffect(() => {
    const seq = live.orderbook?.seq ?? null;
    if (seq != null && seq !== lastSeq.current) {
      lastSeq.current = seq;
      setDeltas((n) => n + 1);
    }
  }, [live.orderbook?.seq]);

  const book = live.orderbook;
  const venues = book ? Object.entries(book.venues ?? {}) : [];

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>WebSocket updates</h2>
        <span className={`${styles.lock} ${live.isConnected ? styles.pulse : ""}`}>
          {live.isConnected ? "connected" : "не підключено"} · integrity {live.integrity}
        </span>
      </div>
      <p className={styles.what}>{SPECIALS[0].what}</p>
      <p className={styles.sdk}>{SPECIALS[0].sdk}</p>
      {!outcomeId ? (
        <p className={styles.error}>Обери ринок і наслідок (Get event / markets → «Обрати»), і підписка відкриється сама.</p>
      ) : (
        <>
          <div className={styles.live}>
            <div className={styles.stat}>
              <span>Midpoint</span>
              <strong>{book?.midpoint != null ? `${(book.midpoint * 100).toFixed(1)}¢` : "—"}</strong>
            </div>
            <div className={styles.stat}>
              <span>Spread</span>
              <strong>{book?.spread != null ? `${(book.spread * 100).toFixed(2)}¢` : "—"}</strong>
            </div>
            <div className={styles.stat}>
              <span>Best bid / ask</span>
              <strong>
                {book?.bids?.[0] ? `${(book.bids[0].price * 100).toFixed(1)}¢` : "—"} / {book?.asks?.[0] ? `${(book.asks[0].price * 100).toFixed(1)}¢` : "—"}
              </strong>
            </div>
            <div className={styles.stat}>
              <span>Оновлень (seq)</span>
              <strong>
                {deltas} · #{book?.seq ?? "—"}
              </strong>
            </div>
            <div className={styles.stat}>
              <span>Арбітражна віддача</span>
              <strong>{arb.arbReturn != null ? `${(arb.arbReturn * 100).toFixed(2)}%` : "—"}</strong>
            </div>
            <div className={styles.stat}>
              <span>Останнє оновлення</span>
              <strong>{book?.timestamp ? new Date(book.timestamp).toLocaleTimeString("en-GB") : "—"}</strong>
            </div>
          </div>
          <p className={styles.tableTitle}>Найкращі ціни по майданчиках</p>
          <TableView
            table={{
              columns: ["Майданчик", "Best bid", "Best ask"],
              rows: venues.map(([venue, info]) => [venue, info.bestBid != null ? `${(info.bestBid * 100).toFixed(1)}¢` : "—", info.bestAsk != null ? `${(info.bestAsk * 100).toFixed(1)}¢` : "—"]),
            }}
            onSelect={() => undefined}
          />
          <p className={styles.tableTitle}>Агрегована книга (топ 6)</p>
          <TableView
            table={{
              columns: ["Bid", "Обсяг", "Майданчики", "Ask", "Обсяг", "Майданчики"],
              rows: Array.from({ length: 6 }, (_, i) => {
                const bid = book?.bids?.[i];
                const ask = book?.asks?.[i];
                return [
                  bid ? `${(bid.price * 100).toFixed(1)}¢` : "",
                  bid ? bid.size.toFixed(2) : "",
                  bid ? Object.keys(bid.venues ?? {}).join(", ") : "",
                  ask ? `${(ask.price * 100).toFixed(1)}¢` : "",
                  ask ? ask.size.toFixed(2) : "",
                  ask ? Object.keys(ask.venues ?? {}).join(", ") : "",
                ];
              }).filter((row) => row.some(Boolean)),
            }}
            onSelect={() => undefined}
          />
          <p className={styles.tableTitle}>Угоди (стрічка)</p>
          <TableView
            table={{
              columns: ["Час", "Майданчик", "Сторона", "Ціна", "Обсяг"],
              rows: trades.slice(-12).reverse().map((t) => [new Date(t.timestamp).toLocaleTimeString("en-GB"), t.venue, t.side, `${(t.price * 100).toFixed(1)}¢`, t.size.toFixed(2)]),
            }}
            onSelect={() => undefined}
          />
          <details className={styles.raw}>
            <summary>Сирий стан книги (JSON)</summary>
            <pre>{JSON.stringify(book, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}

/* ---- the paper account ---------------------------------------------------- */

function AccountCard({ client }: { client: AggClient }) {
  const auth = useAggAuthContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ balances: UnifiedBalanceResponse; positions: unknown; orders: unknown } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [balances, positions, orders] = await Promise.all([
        client.getManagedBalances({ mode: "paper" }),
        client.getExecutionPositions({ mode: "paper", status: "active", limit: 25 }),
        client.getExecutionOrders({ mode: "paper", limit: 25 }),
      ]);
      setData({ balances, positions, orders });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }, [client]);

  const paper = data?.balances.paper;
  const positions = ((data?.positions as { data?: unknown[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const orders = ((data?.orders as { data?: unknown[] } | undefined)?.data ?? []) as Record<string, unknown>[];

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Balances · positions · orders</h2>
        <button type="button" className={styles.secondary} onClick={() => void load()} disabled={busy || !auth.isAuthenticated}>
          {busy ? "Читаю…" : "Прочитати"}
        </button>
      </div>
      <p className={styles.what}>{SPECIALS[1].what}</p>
      <p className={styles.sdk}>{SPECIALS[1].sdk}</p>
      {!auth.isAuthenticated ? <p className={styles.error}>Потрібен вхід AGG-користувача (кнопка праворуч угорі).</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {data ? (
        <>
          <dl className={styles.rows}>
            <div>
              <dt>PAPER_USD (готівка)</dt>
              <dd>{paper ? `$${paper.cashBalance.toFixed(2)}` : "немає paper-поля у відповіді"}</dd>
            </div>
            <div>
              <dt>Стартовий баланс</dt>
              <dd>{paper ? `$${paper.startingBalance.toFixed(2)}` : "—"}</dd>
            </div>
            <div>
              <dt>Вартість позицій</dt>
              <dd>{paper ? `$${paper.positionsValue.toFixed(2)}` : "—"}</dd>
            </div>
            <div>
              <dt>P&amp;L (реалізований / нереалізований)</dt>
              <dd>{paper ? `$${paper.realizedPnl.toFixed(2)} / $${paper.unrealizedPnl.toFixed(2)}` : "—"}</dd>
            </div>
            <div>
              <dt>Live-готівка у відповіді</dt>
              <dd>{(data.balances.cash ?? []).length ? (data.balances.cash ?? []).map((c) => `${c.tokenSymbol} ${c.totalRaw}`).join(", ") : "порожньо — live-коштів немає"}</dd>
            </div>
          </dl>
          <p className={styles.tableTitle}>Позиції (paper)</p>
          <TableView
            table={{
              columns: ["Ринок", "Наслідок", "Акцій", "Середня", "Зараз", "Вартість", "P&L"],
              rows: positions.flatMap((group) => {
                const market = (group.venueMarket ?? {}) as Record<string, unknown>;
                const outcomes = (market.venueMarketOutcomes ?? []) as Record<string, unknown>[];
                return outcomes
                  .filter((o) => Number(o.totalSize ?? 0) > 0)
                  .map((o) => [
                    String(market.question ?? "—"),
                    String(o.label ?? "—"),
                    Number(o.totalSize ?? 0).toFixed(2),
                    `${(Number(o.avgEntryPrice ?? 0) * 100).toFixed(1)}¢`,
                    `${(Number(o.currentPrice ?? 0) * 100).toFixed(1)}¢`,
                    `$${Number(o.totalValue ?? 0).toFixed(2)}`,
                    `$${Number(o.unrealizedPnl ?? 0).toFixed(2)}`,
                  ]);
              }),
            }}
            onSelect={() => undefined}
          />
          <p className={styles.tableTitle}>Ордери (paper)</p>
          <TableView
            table={{
              columns: ["Час", "Майданчик", "Сторона", "Ринок", "Наслідок", "Статус", "Ціна виконання"],
              rows: orders.map((o) => {
                const market = (o.venueMarket ?? {}) as Record<string, unknown>;
                const outcome = (o.venueMarketOutcome ?? {}) as Record<string, unknown>;
                return [
                  String(o.createdAt ?? "").slice(0, 19).replace("T", " "),
                  String(o.venue ?? "—"),
                  String(o.side ?? "—"),
                  String(market.question ?? "—"),
                  String(outcome.label ?? "—"),
                  String(o.status ?? "—"),
                  o.executionPrice != null ? `${(Number(o.executionPrice) * 100).toFixed(1)}¢` : "—",
                ];
              }),
            }}
            onSelect={() => undefined}
          />
          <details className={styles.raw}>
            <summary>Сира відповідь AGG (JSON)</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </section>
  );
}

/* ---- the documented paper-trade walk, one step at a time ----------------- */

type WalkState = {
  before?: UnifiedBalanceResponse;
  route?: SmartRouteResponse;
  fill?: ExecuteManagedResponse;
  execution?: ExecutionStatusResponse;
  orders?: unknown;
  positions?: unknown;
  after?: UnifiedBalanceResponse;
};

function PaperTradeCard({ client }: { client: AggClient }) {
  const auth = useAggAuthContext();
  const { selection } = useLab();
  const [walk, setWalk] = useState<WalkState>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spend, setSpend] = useState("2");

  const step = useCallback(
    async (name: string, work: () => Promise<Partial<WalkState>>) => {
      setBusy(name);
      setError(null);
      try {
        const next = await work();
        setWalk((current) => ({ ...current, ...next }));
      } catch (caught) {
        setError(`${name}: ${describeError(caught)}`);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const outcomeId = selection.outcomeId;
  const paperBefore = walk.before?.paper;
  const paperAfter = walk.after?.paper;
  const fills = walk.route?.fills ?? [];
  const positions = ((walk.positions as { data?: unknown[] } | undefined)?.data ?? []) as Record<string, unknown>[];
  const orders = ((walk.orders as { data?: unknown[] } | undefined)?.data ?? []) as Record<string, unknown>[];

  const steps: { id: string; title: string; done: boolean; out: React.ReactNode; action: () => Promise<Partial<WalkState>>; disabled?: boolean }[] = [
    {
      id: "balance",
      title: "1 · Баланс до угоди (PAPER_USD)",
      done: Boolean(walk.before),
      out: paperBefore ? (
        <>
          готівка <strong>${paperBefore.cashBalance.toFixed(2)}</strong>, позиції ${paperBefore.positionsValue.toFixed(2)}, стартовий ${paperBefore.startingBalance.toFixed(0)}
        </>
      ) : walk.before ? (
        "відповідь без поля paper — рахунок ще не створено; перший paper-виклик створює його"
      ) : (
        "getManagedBalances({ mode: \"paper\" })"
      ),
      action: async () => ({ before: await client.getManagedBalances({ mode: "paper" }) }),
    },
    {
      id: "market",
      title: "2 · Відкритий ринок і наслідок",
      done: Boolean(outcomeId),
      out: outcomeId ? (
        <>
          outcome <strong className={styles.mono}>{outcomeId}</strong> (ринок {selection.marketId ?? "—"})
        </>
      ) : (
        "обери ринок у Get event / markets → «Обрати»; цей крок нічого не викликає"
      ),
      action: async () => ({}),
      disabled: true,
    },
    {
      id: "route",
      title: `3 · Smart route на купівлю за $${spend} у paper-режимі`,
      done: Boolean(walk.route),
      out: walk.route ? (
        <>
          {walk.route.status} · <strong>{walk.route.totalFilled.toFixed(2)} акцій</strong> за ${walk.route.rawExecCost.toFixed(2)} · {fills.map((f) => `${f.venue} @ ${(f.avgPrice * 100).toFixed(1)}¢`).join(", ")} · quote {walk.route.quoteId.slice(0, 8)}… до {walk.route.expiresAt.slice(11, 19)}
        </>
      ) : (
        "getSmartRoute({ venueMarketOutcomeId, tradeSide: \"buy\", maxSpend, mode: \"paper\" })"
      ),
      action: async () => {
        if (!outcomeId) throw new Error("немає outcome id");
        return { route: await client.getSmartRoute({ venueMarketOutcomeId: outcomeId, tradeSide: "buy", maxSpend: Number(spend) || 2, mode: "paper" }) };
      },
      disabled: !outcomeId,
    },
    {
      id: "fill",
      title: "4 · Виконати quote у paper-режимі",
      done: Boolean(walk.fill),
      out: walk.fill ? (
        <>
          {walk.fill.status} · ордерів <strong>{walk.fill.orderIds.length}</strong> ({walk.fill.orderIds.map((id) => id.slice(0, 8)).join(", ")}) {walk.fill.message ? `· ${walk.fill.message}` : ""}
        </>
      ) : (
        "executeManaged({ quoteId, mode: \"paper\", fallbackToLatest }) — симульовані кошти, жоден майданчик не отримує ордера"
      ),
      action: async () => {
        if (!walk.route || !outcomeId) throw new Error("спершу smart route");
        const fill = await client.executeManaged({
          quoteId: walk.route.quoteId,
          mode: "paper",
          fallbackToLatest: { outcomeId, side: "buy", maxSpend: Number(spend) || 2 },
        });
        /* The fill is accepted asynchronously; the execution status is the
           truth of what happened to it. Polled until terminal, at most ~24 s. */
        let execution: ExecutionStatusResponse | undefined;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          execution = await client.getExecutionStatus({ quoteId: fill.quoteId, mode: "paper" });
          if (execution.terminal) break;
        }
        return { fill, execution };
      },
      disabled: !walk.route,
    },
    {
      id: "status",
      title: "4a · Статус виконання (DAG)",
      done: Boolean(walk.execution),
      out: walk.execution ? (
        <>
          <strong>{walk.execution.overallState}</strong> · terminal {String(walk.execution.terminal)}
          {walk.execution.errorReason ? ` · причина: ${walk.execution.errorReason}` : ""}
          {" · кроки: "}
          {(walk.execution.steps ?? []).map((s) => `${s.label || s.stepType} = ${s.status}${s.errorReason ? ` (${s.errorReason})` : ""}`).join(", ") || "—"}
          {" · ордери: "}
          {(walk.execution.orders ?? []).map((o) => `${o.venue} ${o.status}${o.event ? ` (${o.event})` : ""}${o.errorReason ? ` — ${o.errorReason}` : ""}`).join("; ") || "—"}
        </>
      ) : (
        "getExecutionStatus({ quoteId, mode: \"paper\" }) — заповнюється кроком 4; можна перечитати кнопкою"
      ),
      action: async () => {
        if (!walk.fill) throw new Error("спершу виконання");
        return { execution: await client.getExecutionStatus({ quoteId: walk.fill.quoteId, mode: "paper" }) };
      },
      disabled: !walk.fill,
    },
    {
      id: "orders",
      title: "5 · Paper-ордери",
      done: Boolean(walk.orders),
      out: walk.orders ? (
        <>
          {orders.length} ордер(ів); останній: <strong>{String(orders[0]?.status ?? "—")}</strong> {orders[0]?.executionPrice != null ? `@ ${(Number(orders[0].executionPrice) * 100).toFixed(1)}¢` : ""}
        </>
      ) : (
        "getExecutionOrders({ mode: \"paper\" })"
      ),
      action: async () => ({ orders: await client.getExecutionOrders({ mode: "paper", limit: 10 }) }),
    },
    {
      id: "positions",
      title: "6 · Paper-позиції",
      done: Boolean(walk.positions),
      out: walk.positions ? (
        <>
          {positions.length} група(и); {positions
            .slice(0, 3)
            .map((g) => {
              const m = (g.venueMarket ?? {}) as Record<string, unknown>;
              const o = ((m.venueMarketOutcomes ?? []) as Record<string, unknown>[]).find((x) => Number(x.totalSize ?? 0) > 0);
              return o ? `${String(m.question ?? "").slice(0, 40)} — ${String(o.label)} ${Number(o.totalSize).toFixed(2)} акцій` : "";
            })
            .filter(Boolean)
            .join("; ")}
        </>
      ) : (
        "getExecutionPositions({ mode: \"paper\", status: \"active\" })"
      ),
      action: async () => ({ positions: await client.getExecutionPositions({ mode: "paper", status: "active", limit: 10 }) }),
    },
    {
      id: "after",
      title: "7 · Баланс після угоди",
      done: Boolean(walk.after),
      out: paperAfter ? (
        <>
          готівка <strong>${paperAfter.cashBalance.toFixed(2)}</strong>
          {paperBefore ? ` (зміна ${(paperAfter.cashBalance - paperBefore.cashBalance).toFixed(2)})` : ""}, позиції ${paperAfter.positionsValue.toFixed(2)}; live-готівки у відповіді: {(walk.after?.cash ?? []).length ? "є" : "немає"}
        </>
      ) : (
        "getManagedBalances({ mode: \"paper\" }) ще раз — готівка має зменшитись на вартість заповнення"
      ),
      action: async () => ({ after: await client.getManagedBalances({ mode: "paper" }) }),
    },
  ];

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Paper trade — end to end</h2>
        <span className={styles.lock}>{auth.isAuthenticated ? `user ${auth.user?.username ?? auth.user?.id?.slice(0, 8) ?? ""}` : "потрібен вхід"}</span>
      </div>
      <p className={styles.what}>{SPECIALS[2].what}</p>
      <p className={styles.sdk}>{SPECIALS[2].sdk}</p>
      {!auth.isAuthenticated ? <p className={styles.error}>Потрібен вхід AGG-користувача (кнопка праворуч угорі) — paper-рахунок прив&apos;язаний до користувача.</p> : null}
      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="paper-spend">Бюджет угоди, $ (paper)</label>
          <input id="paper-spend" type="number" inputMode="decimal" min="1" step="1" value={spend} onChange={(event) => setSpend(event.target.value)} />
        </div>
        <button type="button" className={styles.secondary} onClick={() => setWalk({})} disabled={busy != null}>
          Скинути кроки
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <ol className={styles.steps}>
        {steps.map((item) => (
          <li key={item.id} className={`${styles.step} ${item.done ? styles.stepDone : ""}`}>
            <span className={styles.stepIndex}>{item.done ? "✓" : item.id === "market" ? "·" : ""}</span>
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>{item.title}</p>
              <p className={styles.stepOut}>{item.out}</p>
            </div>
            {item.disabled ? null : (
              <button
                type="button"
                className={item.id === "fill" ? styles.run : styles.secondary}
                disabled={busy != null || !auth.isAuthenticated}
                onClick={() => void step(item.title, item.action)}
              >
                {busy === item.title ? "…" : item.id === "fill" ? "Виконати (paper)" : "Викликати"}
              </button>
            )}
          </li>
        ))}
      </ol>
      {Object.keys(walk).length ? (
        <details className={styles.raw}>
          <summary>Сирі відповіді кроків (JSON)</summary>
          <pre>{JSON.stringify(walk, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}

/* ---- the aggregator's own paper ledger, read by the server with the key --- */

type LedgerAccount = {
  id: string;
  externalId: string | null;
  status: string;
  currency: string;
  createdAt: string;
  startingBalance: number;
  cashBalance: number;
  marketValue: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  orders: { id: string; createdAt: string; venue: string; side: string; status: string; marketQuestion: string; outcomeLabel: string; requestedSpend: number | null; filledShares: number; avgPrice: number | null; notional: number; cashDelta: number; rejectionReason: string | null }[];
  positions: { id: string; venue: string; marketQuestion: string; outcomeLabel: string; size: number; avgEntryPrice: number; markPrice: number; markSource: string; marketValue: number; unrealizedPnl: number; liquidityStatus: string }[];
};

function LedgerCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ readAt: string; count: number; accounts: LedgerAccount[] } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/preview/agg-lab/paper", { cache: "no-store" });
      const body = (await response.json()) as { error?: string; reason?: string; message?: string } & { readAt: string; count: number; accounts: LedgerAccount[] };
      if (!response.ok) throw new Error(body.reason ?? body.message ?? `HTTP ${response.status} · ${body.error ?? "помилка"}`);
      setData(body);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const money = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(2)}`);
  const cents = (value: number | null | undefined) => (value == null ? "—" : `${(value * 100).toFixed(1)}¢`);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Paper ledger — server key</h2>
        <button type="button" className={styles.secondary} onClick={() => void load()} disabled={busy}>
          {busy ? "Читаю…" : "Прочитати з сервера"}
        </button>
      </div>
      <p className={styles.what}>{SPECIALS[3].what}</p>
      <p className={styles.sdk}>{SPECIALS[3].sdk}</p>
      {error ? <p className={styles.error}>{error}</p> : null}
      {data ? (
        <>
          <p className={styles.summary}>
            {data.count} paper-рахунок(ів) у застосунку · прочитано {new Date(data.readAt).toLocaleTimeString("en-GB")}
          </p>
          {data.accounts.map((account) => (
            <div key={account.id} className={styles.panel}>
              <dl className={styles.rows}>
                <div>
                  <dt>Рахунок</dt>
                  <dd className={styles.mono}>{account.externalId ?? account.id}</dd>
                </div>
                <div>
                  <dt>Стартовий / готівка</dt>
                  <dd>{money(account.startingBalance)} / {money(account.cashBalance)}</dd>
                </div>
                <div>
                  <dt>Вартість позицій / equity</dt>
                  <dd>{money(account.marketValue)} / {money(account.equity)}</dd>
                </div>
                <div>
                  <dt>P&amp;L реалізований / нереалізований</dt>
                  <dd>{money(account.realizedPnl)} / {money(account.unrealizedPnl)}</dd>
                </div>
                <div>
                  <dt>Створено</dt>
                  <dd>{account.createdAt.slice(0, 19).replace("T", " ")} UTC · {account.status} · {account.currency}</dd>
                </div>
              </dl>
              <p className={styles.tableTitle}>Ордери</p>
              <TableView
                table={{
                  columns: ["Час (UTC)", "Майданчик", "Сторона", "Ринок", "Наслідок", "Статус", "Витрачено", "Акцій", "Середня", "Зміна готівки", "Відмова"],
                  rows: account.orders.map((o) => [o.createdAt.slice(0, 19).replace("T", " "), o.venue, o.side, o.marketQuestion, o.outcomeLabel, o.status, money(o.requestedSpend), o.filledShares.toFixed(2), cents(o.avgPrice), money(o.cashDelta), o.rejectionReason ?? ""]),
                }}
                onSelect={() => undefined}
              />
              <p className={styles.tableTitle}>Позиції</p>
              <TableView
                table={{
                  columns: ["Майданчик", "Ринок", "Наслідок", "Акцій", "Середня", "Mark", "Джерело mark", "Вартість", "P&L", "Ліквідність"],
                  rows: account.positions.map((p) => [p.venue, p.marketQuestion, p.outcomeLabel, p.size.toFixed(2), cents(p.avgEntryPrice), cents(p.markPrice), p.markSource, money(p.marketValue), money(p.unrealizedPnl), p.liquidityStatus]),
                }}
                onSelect={() => undefined}
              />
            </div>
          ))}
          <details className={styles.raw}>
            <summary>Сира відповідь (JSON, з сервера Ryntra)</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </section>
  );
}

function describeError(caught: unknown): string {
  if (caught && typeof caught === "object") {
    const record = caught as Record<string, unknown>;
    const status = typeof record.status === "number" ? `HTTP ${record.status} · ` : typeof record.statusCode === "number" ? `HTTP ${record.statusCode} · ` : "";
    const body = record.body && typeof record.body === "object" ? (record.body as Record<string, unknown>).message : undefined;
    const message = typeof body === "string" ? body : typeof record.message === "string" ? record.message : String(caught);
    return `${status}${message}`;
  }
  return String(caught);
}
