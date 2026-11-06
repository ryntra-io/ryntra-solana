/**
 * A tap on a tower opens its window under the finger (CITY-200). The tower is picked on `pointerup`; the browser then
 * sends that very tap's `click` to whatever stands under the finger by then — on a phone the new window's head, so one
 * tap on a tower also pressed «Ask Ryntra» in it. A touch tap that picked a tower cancels its own `touchend`, and with
 * it the click the browser would make of the tap. A mouse, a pen and a tap on nothing are left alone.
 */
export type GhostGuard = Readonly<{ arm: (pointerType: string) => void; reset: () => void; onTouchEnd: (event: Pick<Event, 'preventDefault' | 'cancelable'>) => void }>;

export function ghostGuard(): GhostGuard {
  let armed = false;
  return {
    arm: (pointerType) => {
      armed = pointerType === 'touch';
    },
    reset: () => {
      armed = false;
    },
    onTouchEnd: (event) => {
      if (!armed) return;
      armed = false;
      if (event.cancelable) event.preventDefault();
    },
  };
}
