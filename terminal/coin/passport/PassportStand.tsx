'use client';

import { useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { CoinLogo, Kick, Page, PageHead, Panel, usdText } from '@/terminal/ui';
import { PassportFigures, PassportRisk } from './Passport';
import { passportOf, passportSentence, peopleText, type CoinPassport } from './passport-data';
import { STAND_KEYS, standCoins, type StandKey } from './stand-coins';
import { useCoinPassport, type PassportStatus } from './usePassport';
import { PASSPORT, PASSPORT_STAND } from './words';
import st from './stand.module.css';

/** The coin the live panel reads through the public reads: Jupiter's own coin, listed long ago. */
const LIVE_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const LIVE_SYMBOL = 'JUP';

/**
 * The stand's page for the eyes (`/terminal/kit/passport`, a stand only): the passport of four coins — an
 * old one, a fresh one on its launch curve, one whose creator no source names, one with a risk — each in the places it
 * will be mounted: the head's row beside the head's own figures, the line by the buy button in a ticket's width, and
 * the agent's sentence; then one live read of a real coin.
 */
export function PassportStand() {
  const w = useWords(PASSPORT_STAND);
  const coins = useMemo(() => standCoins(Date.now()), []);
  return (
    <Page kind="desk">
      <PageHead title={w.title} />
      <div className={st.stand}>
        {STAND_KEYS.map((key: StandKey) => {
          const coin = coins[key];
          return <Coin key={key} title={w[key]} symbol={coin.symbol} passport={passportOf(coin)} status="ready" />;
        })}
        <Live />
      </div>
    </Page>
  );
}

function Live() {
  const w = useWords(PASSPORT_STAND);
  const { passport, status } = useCoinPassport(LIVE_MINT);
  return <Coin title={w.live} symbol={LIVE_SYMBOL} passport={passport} status={status} />;
}

/** One coin: a head as the coin's page draws it with the passport's row in its free room, the line, the sentence. */
function Coin({ title, symbol, passport, status }: { title: string; symbol: string; passport: CoinPassport | null; status: PassportStatus }) {
  const w = useWords(PASSPORT_STAND);
  const say = useWords(PASSPORT);
  const lang = useLang();
  const sentence = passportSentence(passport, lang);
  const head: [string, string][] = [
    [w.mcap, passport?.marketCapUsd != null ? usdText(passport.marketCapUsd, lang) : say.unknown],
    [w.liquidity, passport?.liquidityUsd != null ? usdText(passport.liquidityUsd, lang) : say.unknown],
    [w.holders, passport?.holders != null ? peopleText(passport.holders, lang) : say.unknown],
  ];
  return (
    <Panel gap={16} label={title}>
      <Kick>{`${title} · ${symbol}`}</Kick>
      <div className={st.head}>
        <span className={st.coin}>
          <CoinLogo src={null} symbol={symbol} size="m" />
          <b>{symbol}</b>
        </span>
        <dl className={st.headFigures}>
          {head.map(([label, value]) => (
            <div key={label} className={st.headFigure}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <PassportFigures passport={passport} status={status} />
      </div>
      <div className={st.under}>
        <div className={st.ticket}>
          <Kick>{w.line}</Kick>
          <PassportRisk passport={passport} status={status} />
        </div>
        <div className={st.say}>
          <Kick>{w.say}</Kick>
          <p className={st.sentence}>{sentence ?? say.unknown}</p>
        </div>
      </div>
    </Panel>
  );
}
