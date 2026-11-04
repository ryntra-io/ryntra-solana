'use client';

import { useState } from 'react';
import { openExternal } from '@/city/lib/app-bridge/page';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import { DISCOUNT_ON } from '@/city/lib/partners/discount';
import { GUILD_ROLES, OFFER, percent, type GuildRole } from '@/city/lib/partners/facts';
import { usePartners, type PartnersTab } from '@/city/lib/partners/store';
import { PARTNER_TERMS, termsRows } from '@/city/lib/partners/terms';
import { CONTACTS } from '@/lib/site/contacts';
import { Demo, Info, Status, Still } from './bits';
import { Calculator } from './Calculator';
import { CopyLink } from './CopyLink';
import { CreatorTab } from './CreatorTab';
import { District } from './District';
import { ArrowGlyph, RoleGlyph } from './glyphs';
import s from './partners.module.css';
import { PARTNERS, type PartnersWords } from './words';

const TABS: readonly PartnersTab[] = ['referrer', 'creator', 'guild'];
const TAB_WORD = { referrer: 'tabReferrer', creator: 'tabCreator', guild: 'tabGuild' } as const satisfies Record<PartnersTab, keyof PartnersWords>;
const ROLE_WORD = {
  scout: ['roleScout', 'roleScoutLine'],
  builder: ['roleBuilder', 'roleBuilderLine'],
  host: ['roleHost', 'roleHostLine'],
  guide: ['roleGuide', 'roleGuideLine'],
} as const satisfies Record<GuildRole, readonly [keyof PartnersWords, keyof PartnersWords]>;

/** Each tab heads with a still of our own city: the lit towers, the launch docks, the towers seen from the guild's hall. */
const ART: Readonly<Record<PartnersTab, string>> = {
  referrer: 'district-home',
  creator: 'district-launch',
  guild: 'district-agents',
};

/** The partner page at its own address: the whole programme, in the language on screen (CITY-177). */
const DECK = '/partners';

/**
 * «Ryntra Partners» (CITY-126) inside the city's window frame: the two-sided offer first — the partner's share and the
 * friend's discount, decision 93 — then «Copy my link» at once (CITY-177), the three roles, and «Мій район» one tap
 * away. The terms behind «i» are `termsRows` of `city/lib/partners/terms.ts`: one source, the same words as `/partners`.
 */
export default function PartnersWindow() {
  const lang = useLang();
  const w = useWords(PARTNERS);
  const tab = usePartners((st) => st.tab);
  const district = usePartners((st) => st.district);
  const demo = usePartners((st) => st.demo);
  return (
    <div className={s.shell}>
      <div className={s.framed} aria-label={w.title} lang={lang}>
        {district ? (
          <District />
        ) : (
          <>
            <Hero tab={tab} w={w} lang={lang} />
            <CopyLink />
            <div className={s.tabs} role="tablist" aria-label={w.title}>
              {TABS.map((id) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${s.display} ${s.tab}`} onClick={() => usePartners.getState().setTab(id)}>
                  {w[TAB_WORD[id]]}
                </button>
              ))}
            </div>
            <div className={s.pane} role="tabpanel" key={tab}>
              {tab === 'referrer' ? <Calculator /> : tab === 'creator' ? <CreatorTab /> : <Guild w={w} />}
            </div>
          </>
        )}
      </div>
      {demo ? <Demo text={w.demo} /> : null}
    </div>
  );
}

function Hero({ tab, w, lang }: { tab: PartnersTab; w: PartnersWords; lang: Lang }) {
  const [terms, setTerms] = useState(false);
  return (
    <>
      <Still name={ART[tab]}>
        <span className={`${s.display} ${s.kicker}`}>{w.kicker}</span>
        {OFFER ? (
          <div className={s.offer}>
            <div className={`${s.side} ${s.sideYou}`}>
              <span className={s.sideLabel}>{w.you}</span>
              <b className={`${s.display} ${s.sideBig}`}>{percent(OFFER.firstPercent, lang)}</b>
              <span className={s.sideLine}>{w.youLine(OFFER.firstDays, percent(OFFER.afterPercent, lang))}</span>
            </div>
            <div className={s.side}>
              <span className={s.sideLabel}>{w.friend}</span>
              <b className={`${s.display} ${s.sideBig}`}>{percent(OFFER.discountPercent, lang)}</b>
              <span className={s.sideLine}>{DISCOUNT_ON ? w.friendLine : w.friendLineSoon}</span>
            </div>
          </div>
        ) : (
          <b className={`${s.display} ${s.big}`}>{w.soon}</b>
        )}
        <div className={s.heroFoot}>
          <Status />
        </div>
        <button type="button" className={`${s.display} ${s.chip}`} onClick={() => usePartners.getState().setDistrict(true)}>
          {w.district}
          <ArrowGlyph />
        </button>
        <Info open={terms} label={w.terms} onToggle={() => setTerms((v) => !v)} />
      </Still>
      {terms ? <Terms w={w} lang={lang} /> : null}
    </>
  );
}

/** The terms, behind the hero's «i»: the partner deck's own rows, and the deck itself one tap away. */
function Terms({ w, lang }: { w: PartnersWords; lang: Lang }) {
  const deck = termsRows(lang, PARTNER_TERMS);
  return (
    <div className={s.rules}>
      <dl className={s.terms}>
        {deck.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className={s.termsNote}>{deck.note}</p>
      <a className={s.deckLink} href={DECK} target="_blank" rel="noopener">
        {w.deck}
        <ArrowGlyph />
      </a>
    </div>
  );
}

/** The guild: its roles on the city's badges, by invitation. Its season and pay are the operator's to set. */
function Guild({ w }: { w: PartnersWords }) {
  return (
    <div className={s.guild}>
      <div className={s.season}>
        <span className={`${s.pill} ${s.pillWait}`}>{w.soon}</span>
        <span className={s.seasonSeats}>{w.guildLine}</span>
      </div>
      <div className={s.roles}>
        {GUILD_ROLES.map((role) => (
          <div key={role} className={s.role}>
            <span className={s.roleMark}>
              <RoleGlyph role={role} />
            </span>
            <b className={`${s.display} ${s.roleName}`}>{w[ROLE_WORD[role][0]]}</b>
            <span className={s.roleLine}>{w[ROLE_WORD[role][1]]}</span>
          </div>
        ))}
      </div>
      <button type="button" className={`${s.display} ${s.action}`} onClick={() => openExternal(CONTACTS.companyX)}>
        {w.guildAsk}
      </button>
    </div>
  );
}
