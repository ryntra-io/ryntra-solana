"use client";

import { ArrowSquareOut, ImageSquare } from "@phosphor-icons/react";
import { Block, EmptyState, Page, Table, type TableColumn } from "@ryntra/core/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import type { LaunchCreatorProfileResponse, LaunchProfileLaunch, LaunchStatsResponse } from "@/lib/api/v1/contract";
import { launchPreset } from "@/lib/core/venues/meteora-dbc/presets";

import { coreLang, LinkButton, Reading, Unread } from "../../launch-blocks";
import { explorerUrl, formatBps, formatDate, formatMoneyShort, shortAddress } from "../../launch-format";
import styles from "../../launch.module.css";
import { countText, windowText } from "../../mine/cabinet-figures";
import { cabinetWords } from "../../mine/cabinet-words";
import own from "../../mine/cabinet.module.css";

/**
 * A creator's public profile (SOL-L2): the launches the wallet made through Ryntra, the newest first, each with its
 * results — how far it went, its holders, its week's volume, its market cap — the creator's lock and what they sold.
 * Every figure from the chain, each launch read one at a time; one not read says so. No ranking, no promotion.
 */

type Answer<T> = { ok: true; data: T } | { ok: false };
const API_HEADERS = { "X-Ryntra-API": "1" } as const;

async function api<T>(path: string): Promise<Answer<T>> {
  try {
    const response = await fetch(path, { headers: API_HEADERS, cache: "no-store" });
    if (!response.ok) return { ok: false };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false };
  }
}

type Read = LaunchStatsResponse | "unread" | undefined;
type Row = Readonly<{ launch: LaunchProfileLaunch; read: Read }>;

export function CreatorProfile({ address, locale, network }: { address: string; locale: WorkspaceLocale; network: "solana:devnet" | "solana:mainnet" }) {
  const word = cabinetWords(locale);
  const lang = coreLang(locale);
  const { connection } = useSolanaConnection();
  const router = useRouter();
  const [profile, setProfile] = useState<LaunchCreatorProfileResponse | "unread" | null>(null);
  const [stats, setStats] = useState<Record<string, Read>>({});

  const load = useCallback(async () => {
    setProfile(null);
    const answer = await api<LaunchCreatorProfileResponse>(`/api/v1/launch/creators/${address}/profile`);
    setProfile(answer.ok ? answer.data : "unread");
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  /* One launch at a time, so a public node is not asked in a burst. */
  useEffect(() => {
    if (!profile || profile === "unread") return;
    let live = true;
    void (async () => {
      for (const launch of profile.launches) {
        if (!live) return;
        const answer = await api<LaunchStatsResponse>(`/api/v1/launch/${launch.token}/stats`);
        if (!live) return;
        setStats((current) => ({ ...current, [launch.token]: answer.ok ? answer.data : "unread" }));
      }
    })();
    return () => {
      live = false;
    };
  }, [profile]);

  const mine = connection?.address === address;
  const launches = profile && profile !== "unread" ? profile.launches : [];
  const rows: Row[] = launches.map((launch) => ({ launch, read: stats[launch.token] }));
  const read = (row: Row) => (row.read && row.read !== "unread" ? row.read : null);
  const allRead = rows.every((row) => row.read !== undefined);
  const onDex = rows.filter((row) => read(row)?.migrated).length;
  const locked = rows.filter((row) => read(row)?.lock?.state === "LOCKED").length;
  const unreadAny = rows.some((row) => row.read === "unread");

  /* A count over launches some of which are not read: a floor where it found some, else «reading…» or «not read» — never «0+». */
  const partCount = (count: number) => {
    if (allRead && !unreadAny) return count;
    if (count > 0) return `≥ ${count}`;
    return <span className={styles.statUnread}>{word(allRead ? "periodUnread" : "periodReading")}</span>;
  };
  const figure = (row: Row, text: string | null) =>
    text !== null ? text : <span className={styles.statUnread}>{row.read === undefined ? word("periodReading") : word("periodUnread")}</span>;

  const columns: TableColumn<Row>[] = [
    {
      key: "token",
      label: word("colToken"),
      sortable: true,
      sortValue: (row) => Date.parse(row.launch.launchedAt),
      render: (row) => (
        <span className={own.tokenCell}>
          <span className={own.picture}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the token's own picture, served by its immutable address */}
            {row.launch.image ? <img src={row.launch.image} alt="" /> : <ImageSquare size={16} aria-hidden />}
          </span>
          <span className={own.tokenName}>
            <b>${row.launch.symbol}</b>
            <span className={styles.hint}>
              {formatDate(row.launch.launchedAt, locale)} · {launchPreset(row.launch.preset)?.name[locale] ?? row.launch.preset}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "way",
      label: word("colWay"),
      numeric: true,
      sortable: true,
      sortValue: (row) => read(row)?.progressBps ?? -1,
      render: (row) => {
        const stats = read(row);
        return figure(row, stats ? (stats.migrated ? word("onDex") : formatBps(stats.progressBps, locale)) : null);
      },
    },
    { key: "holders", label: word("colHolders"), numeric: true, sortable: true, sortValue: (row) => read(row)?.holders.count ?? -1, render: (row) => figure(row, read(row) ? countText(read(row)!.holders, locale) : null) },
    {
      key: "volume",
      label: word("colVolumeWeek"),
      numeric: true,
      sortable: true,
      sortValue: (row) => Number(read(row)?.volume.week.raw ?? -1),
      render: (row) => figure(row, read(row) ? windowText(read(row)!.volume.week, row.launch.pair, locale) : null),
    },
    {
      key: "cap",
      label: word("statMarketCap"),
      numeric: true,
      sortable: true,
      sortValue: (row) => read(row)?.marketCap.pair ?? -1,
      render: (row) => figure(row, read(row) ? formatMoneyShort(read(row)!.marketCap.pair, locale, row.launch.pair.dollar, row.launch.pair.symbol) : null),
    },
    {
      key: "lock",
      label: word("creatorLockCol"),
      render: (row) => {
        const stats = read(row);
        if (!stats) return figure(row, null);
        return stats.lock?.state === "LOCKED" ? word("creatorLockYes", { date: formatDate(stats.lock.endAt, locale) }) : word("creatorLockNo");
      },
    },
    {
      key: "sold",
      label: word("creatorSold"),
      numeric: true,
      sortable: true,
      sortValue: (row) => read(row)?.creatorTrades.soldBps ?? -1,
      render: (row) => {
        const trades = read(row)?.creatorTrades;
        if (!trades || trades.soldBps === null) return figure(row, null);
        if (trades.soldBps === 0) return word("creatorSoldNone");
        return word(trades.soldOf === "supply" ? "soldShareSupply" : "soldShare", { pct: formatBps(trades.soldBps, locale) });
      },
    },
  ];

  return (
    <Page
      kind="overview"
      className={styles.corePage}
      lang={lang}
      title={word("creatorTitle", { address: shortAddress(address) })}
      help={word("creatorHelp")}
      action={mine ? <LinkButton href="/app/launch/mine">{word("creatorToCabinet")}</LinkButton> : undefined}
    >
      {profile === null ? (
        <Reading label={word("creatorReading")} hero lines={4} />
      ) : profile === "unread" ? (
        <Unread text={word("creatorUnread")} again={launchAgain(locale)} onAgain={() => void load()} lang={lang} />
      ) : (
        <>
          <Block title={word("creatorWallet")} titleAs="h2" lang={lang}>
            <div className={styles.blockStack}>
              <a className={styles.markLink} href={explorerUrl(network, "account", address)} target="_blank" rel="noreferrer noopener">
                <span className={styles.addr}>{address}</span> <ArrowSquareOut size={12} aria-hidden />
              </a>
              {mine ? <p className={styles.hint}>{word("creatorOwn")}</p> : null}
              <dl className={own.profileFacts}>
                <div>
                  <dt>{word("creatorLaunches")}</dt>
                  <dd>{launches.length}</dd>
                </div>
                <div>
                  <dt>{word("creatorOnDex")}</dt>
                  <dd>{partCount(onDex)}</dd>
                </div>
                <div>
                  <dt>{word("creatorLocked")}</dt>
                  <dd>{partCount(locked)}</dd>
                </div>
              </dl>
            </div>
          </Block>
          {launches.length === 0 ? (
            <EmptyState icon="inbox" text={word("creatorEmpty")} />
          ) : (
            <Block title={word("creatorCaption")} icon="chart-column" titleAs="h2" lang={lang}>
              <Table
                caption={word("creatorCaption")}
                columns={columns}
                rows={rows}
                rowKey={(row) => row.launch.token}
                defaultSort={{ key: "token", direction: "desc" }}
                onRowClick={(row) => router.push(`/app/launch/${row.launch.token}`)}
                rowLabel={(row) => `${row.launch.name} $${row.launch.symbol}`}
                lang={lang}
              />
            </Block>
          )}
        </>
      )}
    </Page>
  );
}

const launchAgain = (locale: WorkspaceLocale) => (locale === "uk" ? "Прочитати ще раз" : "Read again");
