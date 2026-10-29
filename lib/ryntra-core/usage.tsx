/**
 * The shared core's declarations, as an app sees them: `npm run typecheck` and `next build` compile this file, and
 * no screen imports it. `skipLibCheck` would quietly turn a declaration the compiler cannot find into `any`, so for
 * every entry the file writes what its types must refuse — an unused `@ts-expect-error` fails the check.
 */

import { type Capability } from "@ryntra/core/adapters";
import { type ProductId } from "@ryntra/core/products";
import { Button, type ButtonProps, type ButtonVariant } from "@ryntra/core/ui";

const props: ButtonProps = { variant: "primary", children: "Купити" };
export const coreButton = <Button {...props} />;

// @ts-expect-error — a variant the core does not have.
export const unknownVariant: ButtonVariant = "orange";

// @ts-expect-error — the core's Button takes no `href`: a link is not a button.
export const linkButton = <Button href="/app">Купити</Button>;

export const swap: Capability = "swap";

// @ts-expect-error — not a capability of the adapter contracts.
export const unknownCapability: Capability = "teleport";

export const solana: ProductId = "solana";

// @ts-expect-error — not one of the four products.
export const unknownProduct: ProductId = "ethereum";
