'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { HolderGroup, HolderLinksAnswer, LinkKind } from '@/lib/spot/holder-links';
import { Chip, Info, Quiet } from '@/terminal/ui';
import { walletHref } from '@/terminal/watch/watch-view';
import { useCreatorPart } from '../creator/useCreatorPart';
import { shortAddress } from '../tape-view';
import { groupedShare, layoutMap, linksOf, shareText, toneOf } from './map-view';
import { HOLDER_MAP } from './words';
import m from './map.module.css';

/** Members a group's row names; the rest are counted. */
const MEMBERS_LISTED = 6;
/** A bubble this large carries its share inside. */
const LABEL_RADIUS = 18;

/**
 * The links between the coin's largest holders. On a desk: the map — a bubble for each holder checked, its
 * size its share, each group in its own colour around the wallet its members share, a line for each link — and beside
 * it the groups with each one's share and what ties it; a group's row lights it on the map, a bubble opens its wallet.
 * On a phone (`phone`): the groups alone, as a list.
 *
 * Only what the engine read on the chain is drawn (`/api/spot/creator?part=links`): the coin or SOL from one wallet in
 * the holders' own trades of the coin, transfers between them. A group is wallets the chain ties, never «one owner».
 */
export function HoldersMap({ mint, phone = false }: { mint: string; phone?: boolean }) {
  const w = useWords(HOLDER_MAP);
  const lang = useLang();
  const read = useCreatorPart(mint, 'links', true, linksOf);
  const [focus, setFocus] = useState<number | null>(null);
  if (!read.value) {
    const said =
      read.status === 'reading' ? (
        <Bones label={w.reading} phone={phone} />
      ) : (
        <Line>
          {w.quiet}
          {read.status === 'failed' ? (
            <Quiet size="s" onClick={read.again}>
              {w.again}
            </Quiet>
          ) : null}
        </Line>
      );
    // On a phone the part keeps its name over what it says.
    return phone ? (
      <div className={m.tab} data-phone="">
        <span className={m.kick}>{w.tab}</span>
        {said}
      </div>
    ) : (
      said
    );
  }
  const answer = read.value;
  const shown = focus !== null && answer.groups.some((group) => group.id === focus) ? focus : null;
  const head = (
    <div className={m.head}>
      {phone ? <span className={m.kick}>{w.tab}</span> : null}
      <span className={m.total}>{answer.groups.length ? w.groups(answer.groups.length, digits(shareText(groupedShare(answer)), lang)) : w.noGroups}</span>
      <span className={m.checked}>{w.checked(digits(String(answer.checked), lang), digits(String(answer.of), lang))}</span>
      <span className={m.end}>
        <Info label={w.how}>
          {w.why}
          {answer.whole ? null : ` ${w.partial}`}
        </Info>
      </span>
    </div>
  );
  if (phone) {
    return (
      <div className={m.tab} data-phone="">
        {head}
        {answer.groups.length ? <Groups groups={answer.groups} answer={answer} /> : null}
      </div>
    );
  }
  return (
    <div className={m.tab}>
      {head}
      <div className={m.body} data-alone={answer.groups.length ? undefined : ''}>
        <MapPicture answer={answer} focus={shown} />
        {answer.groups.length ? <Groups groups={answer.groups} answer={answer} focus={shown} onFocus={setFocus} /> : null}
      </div>
    </div>
  );
}

function Line({ children }: { children: ReactNode }) {
  return (
    <p className={m.line} role="status">
      {children}
    </p>
  );
}

/** The tab's frame while it reads: the map's and the list's own room, still. */
function Bones({ label, phone }: { label: string; phone: boolean }) {
  return (
    <div className={m.bones} role="status" aria-busy="true" aria-label={label} data-phone={phone || undefined}>
      <span className={m.boneHead} />
      <span className={m.boneBody} />
    </div>
  );
}

/** What ties a group, in the screen's words. */
function useTies(): (ties: readonly LinkKind[]) => string {
  const w = useWords(HOLDER_MAP);
  return (ties) => ties.map((kind) => (kind === 'coin' ? w.tieCoin : kind === 'sol' ? w.tieSol : w.tieBetween)).join(' · ');
}

/** The groups, the largest share first: the colour, the name, how many wallets, the share, what ties them, who. */
function Groups({ groups, answer, focus = null, onFocus }: { groups: readonly HolderGroup[]; answer: HolderLinksAnswer; focus?: number | null; onFocus?: (group: number | null) => void }) {
  const w = useWords(HOLDER_MAP);
  const lang = useLang();
  const ties = useTies();
  const shares = useMemo(() => new Map(answer.nodes.map((node) => [node.owner, node.sharePct])), [answer.nodes]);
  return (
    <div className={m.groups} role="list" aria-label={w.list}>
      {groups.map((group) => {
        const n = digits(String(group.id), lang);
        const main = (
          <>
            <svg className={m.dot} data-tone={toneOf(group.id)} viewBox="0 0 10 10" aria-hidden="true">
              <circle cx={5} cy={5} r={5} />
            </svg>
            <span className={m.groupName}>{w.group(n)}</span>
            <span className={m.groupCount}>{w.wallets(group.wallets.length)}</span>
            {group.creator ? (
              <span className={m.chip}>
                <Chip>{w.creator}</Chip>
              </span>
            ) : null}
            <span className={m.groupShare}>{digits(shareText(group.sharePct), lang)}</span>
            <span className={m.ties}>{ties(group.ties)}</span>
          </>
        );
        return (
          <div key={group.id} role="listitem" className={m.group} data-on={focus === group.id || undefined}>
            {onFocus ? (
              <button type="button" className={m.groupMain} aria-pressed={focus === group.id} aria-label={w.showGroup(n)} onClick={() => onFocus(focus === group.id ? null : group.id)} onMouseEnter={() => onFocus(group.id)} onMouseLeave={() => onFocus(null)}>
                {main}
              </button>
            ) : (
              <div className={m.groupMain}>{main}</div>
            )}
            <span className={m.members}>
              {group.wallets.slice(0, MEMBERS_LISTED).map((owner) => (
                <WalletLink key={owner} owner={owner} label={w.openWallet(shortAddress(owner), digits(shareText(shares.get(owner) ?? null), lang))} />
              ))}
              {group.wallets.length > MEMBERS_LISTED ? <span className={m.more}>{`+${digits(String(group.wallets.length - MEMBERS_LISTED), lang)}`}</span> : null}
              {group.sources.slice(0, 1).map((source) => (
                <span key={source} className={m.from}>
                  {w.source}
                  <WalletLink owner={source} label={w.openSource(shortAddress(source))} source />
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A wallet short, opening its page in the terminal; the whole address on hover. */
function WalletLink({ owner, label, source = false }: { owner: string; label: string; source?: boolean }) {
  return (
    <Link href={walletHref(owner)} prefetch={false} className={m.member} data-source={source || undefined} aria-label={label} title={owner}>
      {shortAddress(owner)}
    </Link>
  );
}

/** The map: links under the marks, shared wallets as small squares, holders as bubbles; a group in focus, the rest quiet. */
function MapPicture({ answer, focus }: { answer: HolderLinksAnswer; focus: number | null }) {
  const w = useWords(HOLDER_MAP);
  const lang = useLang();
  const router = useRouter();
  const layout = useMemo(() => layoutMap(answer), [answer]);
  const open = (owner: string) => (event: MouseEvent) => {
    event.preventDefault();
    router.push(walletHref(owner));
  };
  const quiet = (group: number | null) => (focus !== null && group !== focus) || undefined;
  const { box } = layout;
  return (
    <svg className={m.map} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label={w.map}>
      <g>
        {layout.lines.map((line, i) => (
          <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} className={m.link} data-kind={line.kind} data-tone={line.group !== null ? toneOf(line.group) : undefined} data-quiet={quiet(line.group)} />
        ))}
      </g>
      {layout.sources.map((source) => (
        <a key={source.wallet} href={walletHref(source.wallet)} onClick={open(source.wallet)} aria-label={w.openSource(shortAddress(source.wallet))}>
          <title>{shortAddress(source.wallet)}</title>
          <rect x={source.x - 6} y={source.y - 6} width={12} height={12} className={m.source} data-tone={source.group !== null ? toneOf(source.group) : undefined} data-quiet={quiet(source.group)} />
        </a>
      ))}
      {layout.nodes.map((node) => {
        const share = digits(shareText(node.sharePct), lang);
        return (
          <a key={node.owner} href={walletHref(node.owner)} onClick={open(node.owner)} aria-label={w.openWallet(shortAddress(node.owner), share)}>
            <title>{`${shortAddress(node.owner)} · ${share}`}</title>
            <circle cx={node.x} cy={node.y} r={node.r} className={m.bubble} data-tone={node.group !== null ? toneOf(node.group) : undefined} data-creator={node.creator || undefined} data-quiet={quiet(node.group)} />
            {node.r >= LABEL_RADIUS ? (
              <text x={node.x} y={node.y} className={m.share} fontSize={Math.round(node.r * 0.5)} data-quiet={quiet(node.group)}>
                {share}
              </text>
            ) : null}
          </a>
        );
      })}
    </svg>
  );
}
