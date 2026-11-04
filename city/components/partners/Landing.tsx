'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { DISCOUNT_ON } from '@/city/lib/partners/discount';
import { OFFER, percent } from '@/city/lib/partners/facts';
import { usePartners } from '@/city/lib/partners/store';
import { startWallets } from '@/city/lib/trade/wallet';
import { Demo, Still } from './bits';
import s from './partners.module.css';
import { PARTNERS } from './words';

/**
 * The friend's landing (CITY-126): who invited them, the friend's offer — a discount on Ryntra's fee, decision 93 — and
 * one button into the city. The engine binds the invitation when the friend's wallet proves itself — no form, no extra
 * step.
 */
export default function Landing() {
  const lang = useLang();
  const w = useWords(PARTNERS);
  const invitation = usePartners((st) => st.invitation);
  const demo = usePartners((st) => st.demo);
  // The inviter's masked address keeps its own letters: a base58 address read in capitals is another address.
  const [before, after] = w.greetInvites('\u0000').split('\u0000');
  return (
    <div className={s.shell}>
      <div className={`${s.framed} ${s.gated}`} lang={lang}>
        <Still name="exchange-invite" tall>
          <span className={`${s.display} ${s.kicker}`}>{w.kicker}</span>
          {invitation ? (
            <b className={`${s.display} ${s.invites}`}>
              {before}
              <span className={s.handle} translate="no">
                {invitation.inviter}
              </span>
              {after}
            </b>
          ) : null}
        </Still>
        <div className={s.gate}>
          {OFFER ? (
            <div className={s.landingOffer}>
              <span className={s.sideLabel}>{w.greetYou}</span>
              <b className={`${s.display} ${s.sideBig}`}>{percent(OFFER.discountPercent, lang)}</b>
              <span className={s.sideLine}>{DISCOUNT_ON ? w.friendLine : w.friendLineSoon}</span>
            </div>
          ) : null}
          <button
            type="button"
            className={`${s.display} ${s.action}`}
            onClick={() => {
              usePartners.getState().enter();
              startWallets();
            }}
          >
            {w.greetEnter}
          </button>
          <p className={s.quiet}>{w.greetBind}</p>
        </div>
      </div>
      {demo ? <Demo text={w.demo} /> : null}
    </div>
  );
}
