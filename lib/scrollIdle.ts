// Background work yields to scrolling. Feeds call noteScrollActivity() from
// their onScroll; warm-ups (rail pre-resolve, daily pick) await
// whenScrollIdle() between steps so a JSON parse or source scrape never lands
// in the middle of a fling — on a mid-range phone that is exactly the
// "the app lags when I scroll" stutter.

let lastScrollAt = 0;

export function noteScrollActivity(): void {
  lastScrollAt = Date.now();
}

/** Resolves once nothing has scrolled for `quietMs` (immediately if idle). */
export async function whenScrollIdle(quietMs = 700): Promise<void> {
  for (;;) {
    const wait = lastScrollAt + quietMs - Date.now();
    if (wait <= 0) return;
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** Milliseconds since the last scroll event (large when never scrolled). */
export function msSinceScroll(): number {
  return Date.now() - lastScrollAt;
}
