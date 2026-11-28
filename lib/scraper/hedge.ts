// Hedged direct-fetch → WebView fallback (Phase 3 of the speed pass).
//
// Most source reads try a plain HTML fetch first and only render the page in
// the hidden WebView when that fails. Run strictly in sequence, a slow or hung
// connection made the user wait for the whole direct retry ladder (up to
// 8s + 16s + 24s) before the WebView even started.
//
// hedge() starts the fast path immediately and, if it has not produced a valid
// result within `delayMs` (or fails sooner), starts the fallback alongside it.
// Whichever produces a valid result first wins. When the direct path wins after
// the fallback already started, the fallback is aborted so its WebView slot is
// freed for other work.
//
// Pure: no react-native import, so node tests can load it.

export type HedgeOptions<T> = {
  /** How long the fast path gets on its own before the fallback starts too. */
  delayMs: number;
  /** Result check; defaults to "not null/undefined". */
  valid?: (value: T) => boolean;
};

export async function hedge<T>(
  primary: () => Promise<T | null | undefined>,
  fallback: (signal: AbortSignal) => Promise<T | null | undefined>,
  { delayMs, valid = (v) => v != null }: HedgeOptions<T>,
): Promise<T | null> {
  const isValid = (v: T | null | undefined): v is T => v != null && valid(v);
  return new Promise<T | null>((resolve) => {
    let settled = false;
    let primaryDone = false;
    let fallbackDone = false;
    let fallbackStarted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const maybeGiveUp = () => {
      if (primaryDone && (fallbackDone || !fallbackStarted)) {
        if (!fallbackStarted) startFallback();
        else finish(null);
      }
    };
    const startFallback = () => {
      if (fallbackStarted || settled) return;
      fallbackStarted = true;
      if (timer) clearTimeout(timer);
      Promise.resolve()
        .then(() => fallback(controller.signal))
        .then(
          (v) => {
            fallbackDone = true;
            if (isValid(v)) finish(v);
            else if (primaryDone) finish(null);
          },
          () => {
            fallbackDone = true;
            if (primaryDone) finish(null);
          },
        );
    };

    timer = setTimeout(startFallback, Math.max(0, delayMs));
    Promise.resolve()
      .then(primary)
      .then(
        (v) => {
          primaryDone = true;
          if (isValid(v)) {
            // Free the WebView slot if the fallback is already running.
            if (fallbackStarted && !fallbackDone) controller.abort();
            finish(v);
          } else maybeGiveUp();
        },
        () => {
          primaryDone = true;
          maybeGiveUp();
        },
      );
  });
}
