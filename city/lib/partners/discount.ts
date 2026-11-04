/**
 * The friend's discount on Ryntra's fee (CITY-182): whether it is taken off trades on this deployment, and where.
 *
 * One switch for the engine and the pages: `NEXT_PUBLIC_RYNTRA_REFEREE_DISCOUNT=on` takes the discount off the fee of
 * every trade the engine builds for a person a partner brought, and lets `/partners` and the city's «Partners» window say
 * it works. Anything else, absent included, is off: the engine charges the table's rate and the pages say «soon».
 * Releasing it and rolling it back are this one variable and a redeploy. The figure itself is `PARTNER_TERMS`'
 * `refereeDiscountBps`, never a copy.
 */

export const DISCOUNT_ENV = 'NEXT_PUBLIC_RYNTRA_REFEREE_DISCOUNT';

export function discountOn(value: string | undefined): boolean {
  return value?.trim() === 'on';
}

/* Written out in full so the browser bundle carries the deployment's value. */
export const DISCOUNT_ON = discountOn(process.env.NEXT_PUBLIC_RYNTRA_REFEREE_DISCOUNT);

/**
 * Where the discount reaches, as the engine applies it. A swap or a buy from a tower pays the discounted rate in the
 * same transaction, and so does a limit order on Jupiter. The discount never takes a rate under the venue's smallest
 * fee, so where that would happen the rate is the full one and nothing is marked: Ondo and PreStocks stocks trade on
 * Jupiter's `/order` alone, whose smallest referral is their whole rate; a limit order on a major coin rests on the
 * program's floor, which is its whole rate. A coin still on its launch curve pays the fee written into its pool on
 * chain, the same for everyone.
 */
export const DISCOUNT_REACH = Object.freeze({
  applies: ['swap', 'limit'] as const,
  not: ['curve', 'orderOnlyStocks', 'limitMajor'] as const,
});
