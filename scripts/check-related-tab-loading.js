const assert = require("node:assert");
const fs = require("node:fs");

const source = fs.readFileSync("app/anime/[id].tsx", "utf8");

assert(
  source.includes("{ key: \"related\", label: t.tabRelated"),
  "the Related tab must be visible before relations finish loading",
);
assert(
  source.includes("<RelatedTab items={relations} loading={relationsLoading} />"),
  "the Related tab must receive relation loading state",
);
assert(
  source.includes("function RelatedTab({ items, loading }"),
  "RelatedTab must render loading separately from an empty result",
);
assert(
  source.includes("{ key: \"maylike\", label: t.mayLikeTab"),
  "the You-may-like tab must be visible before its rail loads",
);
assert(
  source.includes("<MayLikeTab items={mayLike} loading={mayLikeLoading} />"),
  "the You-may-like tab must receive its own loading state",
);
assert(
  source.includes("function MayLikeTab({ items, loading }"),
  "MayLikeTab must render loading separately from an empty result",
);

console.log("Related tab loading contract passed.");
