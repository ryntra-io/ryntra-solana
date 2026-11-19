'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BridgeChainView, BridgeTokenView } from '@/lib/relay/bridge-chains';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { CoinLogo, Icon, Kick, cx } from '@/terminal/ui';
import { chainLogo, coinLogo, sameCoin, type BridgeCoin } from './bridge-form';
import { connectEvm, useEvm } from './bridge-evm';
import { tokensOf } from './bridge-store';
import { RELAY_BRIDGE } from './bridge-words';
import s from './swap.module.css';
import b from './bridge.module.css';

/** A coin's logo with its network's mark on it: which coin, and where. */
export function CoinMark({ coin, size = 'm' }: { coin: Pick<BridgeCoin, 'chainId' | 'address' | 'symbol' | 'logo'>; size?: 'm' | 's' }) {
  return (
    <span className={cx(b.mark, size === 's' && b.markS)}>
      <CoinLogo src={coinLogo(coin)} symbol={coin.symbol} size={size === 's' ? 'm' : 'l'} />
      <CoinLogo src={chainLogo(coin.chainId)} symbol="" size="s" className={b.badge} />
    </span>
  );
}

const SEARCH_MS = 300;

/**
 * The networks and their coins, in the form's place: every network Relay carries on the left with its own
 * search, the chosen network's coins on the right — Relay's list first, a search by ticker, name or pasted address.
 * A coin Relay does not vouch for wears one quiet mark. On a phone the networks run in one row above the coins.
 */
export function BridgePick({ side, chains, current, other, onPick, onBack }: { side: 'from' | 'to'; chains: readonly BridgeChainView[]; current: BridgeCoin; other: BridgeCoin; onPick: (token: BridgeTokenView) => void; onBack: () => void }) {
  const w = useWords(RELAY_BRIDGE);
  // Money leaves only a network where a wallet signs or Relay opens an address; it may land on any.
  const offered = useMemo(() => (side === 'from' ? chains.filter((chain) => chain.send) : chains), [chains, side]);
  const [chainId, setChainId] = useState(current.chainId);
  const [netTerm, setNetTerm] = useState('');
  const [term, setTerm] = useState('');
  const [settled, setSettled] = useState('');
  const [tokens, setTokens] = useState<BridgeTokenView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(term.trim()), SEARCH_MS);
    return () => clearTimeout(timer);
  }, [term]);
  useEffect(() => {
    let live = true;
    setTokens(null);
    setFailed(false);
    tokensOf(chainId, settled).then(
      (found) => live && setTokens(found),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [chainId, settled]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onBack();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onBack]);

  const needle = netTerm.trim().toLowerCase();
  const nets = needle ? offered.filter((chain) => chain.label.toLowerCase().includes(needle) || chain.name.includes(needle)) : offered;
  const chain = chains.find((entry) => entry.id === chainId) ?? null;
  const label = side === 'from' ? w.pickSend : w.pickGet;

  return (
    <div className={b.pick} role="dialog" aria-label={label}>
      <div className={b.pickHead}>
        <button type="button" className={s.back} onClick={onBack} aria-label={w.back}>
          <Icon name="back" size="s" />
        </button>
        <span className={s.findWrap}>
          <Icon name="search" size="s" className={s.findSign} />
          <input className={s.find} data-bridge-find type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder={w.findCoin} aria-label={w.findCoin} autoComplete="off" spellCheck={false} autoFocus />
        </span>
      </div>
      <div className={b.pickBody}>
        <div className={b.nets}>
          <div className={b.listKick}>
            <Kick>{w.networks}</Kick>
            <span className={b.count}>{digits(String(offered.length))}</span>
          </div>
          <input className={cx(s.find, b.netFind)} type="search" value={netTerm} onChange={(event) => setNetTerm(event.target.value)} placeholder={w.findNetwork} aria-label={w.findNetwork} autoComplete="off" spellCheck={false} />
          <div className={b.netList} role="group" aria-label={w.networks}>
            {nets.map((entry) => (
              <button key={entry.id} type="button" className={b.net} aria-pressed={entry.id === chainId} onClick={() => setChainId(entry.id)} data-bridge-net={entry.name}>
                <CoinLogo src={chainLogo(entry.id)} symbol={entry.label} size="s" />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={b.coins}>
          <div className={b.listKick}>
            <Kick>{chain ? chain.label : w.allCoins}</Kick>
          </div>
          <div className={b.coinList} role="menu" aria-label={label}>
            {tokens === null && !failed ? (
              <span className={cx(s.bones)} aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
            ) : tokens && tokens.length > 0 ? (
              tokens.map((token) => {
                const chosen = sameCoin(token, current);
                const theirs = sameCoin(token, other);
                return (
                  <button key={`${token.chainId}:${token.address}`} type="button" role="menuitemradio" aria-checked={chosen} className={s.pickRow} onClick={() => onPick(token)} data-bridge-token={token.symbol}>
                    <CoinMark coin={token} size="s" />
                    <span className={s.pickNames}>
                      <b>
                        {token.symbol}
                        {!token.verified ? (
                          <span className={s.unchecked} role="img" aria-label={w.unchecked} title={w.unchecked}>
                            <Icon name="help" size="s" />
                          </span>
                        ) : null}
                      </b>
                      {token.name && token.name !== token.symbol ? <span>{token.name}</span> : null}
                    </span>
                    {theirs ? <Icon name="swap" size="s" /> : <span />}
                  </button>
                );
              })
            ) : (
              <p className={s.pickEmpty}>{w.noMatch}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The EVM wallets this browser carries, in the form's place: a press connects one. With none, one line says where the
 * page works — inside a wallet's own browser.
 */
export function BridgeWallets({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const w = useWords(RELAY_BRIDGE);
  const wallets = useEvm((st) => st.wallets);
  const connecting = useEvm((st) => st.connecting);
  return (
    <div className={b.pick} role="dialog" aria-label={w.evmWallets}>
      <div className={b.pickHead}>
        <button type="button" className={s.back} onClick={onBack} aria-label={w.back}>
          <Icon name="back" size="s" />
        </button>
        <Kick>{w.evmWallets}</Kick>
      </div>
      {wallets.length ? (
        <div className={b.wallets}>
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              className={cx(s.coin, b.wallet)}
              data-bridge-wallet={wallet.name}
              disabled={connecting !== null}
              aria-busy={connecting === wallet.id || undefined}
              onClick={() => void connectEvm(wallet.id).then((ok) => ok && onDone())}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {wallet.icon ? <img src={wallet.icon} alt="" /> : <Icon name="wallet" size="m" />}
              {wallet.generic ? w.browserWallet : wallet.name}
            </button>
          ))}
        </div>
      ) : (
        <p className={b.blank}>{w.noEvm}</p>
      )}
    </div>
  );
}
