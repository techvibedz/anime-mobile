import assert from "node:assert";
import {
  filterWatchable,
  localDayKey,
  orderDailyPool,
  pickIndexOfTheDay,
  pickOfTheDay,
} from "./dailyPick";

async function main() {
  assert.match(localDayKey(), /^\d{4}-\d{1,2}-\d{1,2}$/, "default key must match YYYY-M-D");
  assert.equal(localDayKey(new Date(2026, 0, 5)), "2026-1-5", "local date parts, no padding");

  const items = Array.from({ length: 100 }, (_, i) => i);
  const key = "2026-1-1";
  const first = pickOfTheDay(items, key);
  assert.ok(first !== null, "non-empty list must produce a pick");
  for (let i = 0; i < 5; i++) {
    assert.equal(pickOfTheDay(items, key), first, "same key must produce the same pick");
  }
  assert.ok(items.includes(first!), "pick must come from the list");

  const picks = new Set<number>();
  for (let i = 0; i < 14; i++) {
    const p = pickOfTheDay(items, localDayKey(new Date(2026, 0, 1 + i)));
    assert.ok(p !== null, "consecutive days must produce picks");
    picks.add(p!);
  }
  assert.ok(picks.size >= 2, `14 consecutive days must not collapse to one pick (got ${picks.size})`);

  assert.equal(pickOfTheDay([], key), null, "empty list must return null");

  const single = { id: 7 };
  assert.equal(pickOfTheDay([single], key), single, "single item is always returned");
  assert.equal(pickOfTheDay([single], "1999-12-31"), single, "single item is always returned");

  assert.equal(pickIndexOfTheDay(0, key), 0, "zero length must return 0");
  assert.equal(pickIndexOfTheDay(-2, key), 0, "negative length must return 0");
  assert.equal(
    pickIndexOfTheDay(items.length, key),
    pickIndexOfTheDay(items.length, key),
    "same key must be deterministic",
  );

  for (const k of ["2026-1-1", "2026-7-4", "2025-12-31", "1999-1-1", "abc"]) {
    for (let n = 1; n <= 100; n++) {
      const idx = pickIndexOfTheDay(n, k);
      assert.ok(Number.isInteger(idx) && idx >= 0 && idx < n, `index in range for ${k} length ${n}`);
    }
  }
  for (const k of ["2026-1-1", "2026-7-4", "2025-12-31"]) {
    assert.equal(
      pickOfTheDay(items, k),
      items[pickIndexOfTheDay(items.length, k)],
      `pickOfTheDay must delegate for ${k}`,
    );
  }

  assert.deepEqual(
    filterWatchable([
      { id: 1, status: "FINISHED" },
      { id: 2, status: "NOT_YET_RELEASED" },
      { id: 3, status: "RELEASING" },
      { id: 4 },
    ]).map((x) => x.id),
    [1, 3, 4],
    "unreleased entries must be dropped; missing status fails open",
  );
  assert.deepEqual(filterWatchable([]), [], "empty list stays empty");

  const ordered = orderDailyPool([
    { id: 1, status: "FINISHED", popularity: 50 },
    { id: 2, status: "NOT_YET_RELEASED", popularity: 999 },
    { id: 3, status: "RELEASING", popularity: 500 },
    { id: 4, status: "RELEASING", popularity: 500 },
    { id: 5, status: "FINISHED", popularity: 10 },
  ]);
  assert.deepEqual(
    ordered.map((x) => x.id),
    [3, 4, 1, 5],
    "popularity desc, id tie-break, unreleased dropped",
  );
  assert.equal(
    orderDailyPool([{ id: 1, popularity: 1 }, { id: 2, popularity: 2 }], 1).length,
    1,
    "cap must apply",
  );

  console.log("daily pick tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
