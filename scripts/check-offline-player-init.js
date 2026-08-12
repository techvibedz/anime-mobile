const assert = require("node:assert");
const fs = require("node:fs");

const source = fs.readFileSync("app/watch/[episode].tsx", "utf8");

assert(
  source.includes("useState<ServerState[]>(() => localUri ? [localServer(localUri)] : [])"),
  "offline playback must give useVideoPlayer the local file on its first render",
);
assert(
  source.includes("useState(!localUri)"),
  "offline playback must not wait for the async server-loading effect",
);

console.log("Offline player initialization contract passed.");
