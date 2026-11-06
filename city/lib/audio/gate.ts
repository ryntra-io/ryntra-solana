/**
 * When the city may assemble its score (CITY-200). Building the synths creates the page's AudioContext; created before
 * the person has touched the page, the browser keeps it suspended and warns once for every node — about a hundred
 * console warnings on every visit. So the score waits for the city's first frame and for the person's first gesture
 * (`navigator.userActivation`, sticky). A browser that cannot say whether it was touched assembles as before.
 */
export type Activation = Readonly<{ hasBeenActive: boolean }> | undefined;

export function mayAssemble(drawn: boolean, activation: Activation): boolean {
  if (!drawn) return false;
  return activation ? activation.hasBeenActive : true;
}
