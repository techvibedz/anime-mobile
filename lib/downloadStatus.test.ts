import assert from "node:assert";
import { mapNativeDownload } from "./downloadStatus";

assert.deepEqual(
  mapNativeDownload({ status: 1, bytes: 0, totalBytes: -1, localUri: null, validMp4: false }),
  { status: "downloading", progress: 0 },
);
assert.deepEqual(
  mapNativeDownload({ status: 2, bytes: 50, totalBytes: 100, localUri: null, validMp4: false }),
  { status: "downloading", progress: 0.5 },
);
assert.deepEqual(
  mapNativeDownload({ status: 8, bytes: 100, totalBytes: 100, localUri: "file:///x.mp4", validMp4: true }),
  { status: "completed", progress: 1 },
);
assert.deepEqual(
  mapNativeDownload({ status: 16, bytes: 10, totalBytes: 100, localUri: null, validMp4: false }),
  { status: "failed", progress: 0.1 },
);
assert.deepEqual(
  mapNativeDownload({ status: 8, bytes: 100, totalBytes: 100, localUri: "file:///error.html", validMp4: false }),
  { status: "failed", progress: 1 },
);

console.log("download status tests passed");
