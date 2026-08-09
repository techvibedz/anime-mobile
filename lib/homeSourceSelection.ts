export type HomeSource<T> = {
  source: "witanime" | "anime4up" | "anime3rb";
  load: () => Promise<T | null>;
};

export async function selectHomeSource<T>(
  sources: HomeSource<T>[],
  primaryWaitMs = 1500,
  deadlineMs = 20_000,
): Promise<{ source: HomeSource<T>["source"]; home: T } | null> {
  const started = Date.now();
  let resolveFirst!: (value: { source: HomeSource<T>["source"]; home: T } | null) => void;
  const firstValid = new Promise<{ source: HomeSource<T>["source"]; home: T } | null>((resolve) => {
    resolveFirst = resolve;
  });
  let remaining = sources.length;
  const pending = sources.map(({ source, load }) => load()
    .then((home) => {
      if (home) resolveFirst({ source, home });
      return home ? { source, home } : null;
    })
    .catch(() => null)
    .finally(() => {
      remaining -= 1;
      if (remaining === 0) resolveFirst(null);
    }));

  const primary = await Promise.race([
    pending[0] ?? Promise.resolve(null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), primaryWaitMs)),
  ]);
  if (primary) return primary;

  const timeLeft = Math.max(0, deadlineMs - (Date.now() - started));
  return Promise.race([
    firstValid,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeLeft)),
  ]);
}
