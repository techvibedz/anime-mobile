const assert = require("node:assert");
const fs = require("node:fs");

const source = fs.readFileSync("app/anime/[id].tsx", "utf8");

assert(
  source.includes('{ key: "related", label: t.tabRelated'),
  "the Related tab must be visible before relations finish loading",
);
assert(
  source.includes('<RelatedTab items={relations} loading={relationsLoading} />'),
  "the Related tab must receive relation loading state",
);
assert(
  source.includes("function RelatedTab({ items, loading }"),
  "RelatedTab must render loading separately from an empty result",
);

console.log("Related tab loading contract passed.");
