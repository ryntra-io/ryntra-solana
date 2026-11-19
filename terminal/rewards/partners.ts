import { OFFER, PAYOUTS, type Offer } from '../../city/lib/partners/facts.ts';
import { PARTNER_TERMS } from '../../city/lib/partners/terms.ts';

/**
 * «For partners» (the partner programme: the operator's terms, `city/lib/partners/terms.ts`): a tab of «Rewards» and an item
 * of the menu only while the programme is open — its terms set and its payouts running. Until then the city's
 * «Partners» and the site's `/partners` page say it is counting; the terminal shows nothing of it, no «soon». The day
 * payouts run, `PAYOUTS` turns `open` in its own change, and the tab and the item stand with it.
 */
export const PARTNERS_OFFER: Offer | null = OFFER;
export const PARTNERS_OPEN: boolean = OFFER !== null && PAYOUTS === 'open';

/** The partner page of the site, where a partner reads the whole programme and its calculator. */
export const PARTNERS_PAGE = '/partners';

/** How often a partner is paid, by the same terms. */
export const PARTNERS_CADENCE: 'weekly' | 'monthly' | null = PARTNER_TERMS.cadence;
