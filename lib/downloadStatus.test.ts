import assert from "node:assert";
import { isMp4Header, mapNativeDownload } from "./downloadStatus";

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

// A real MP4 header (box size + "ftyp" brand) must be accepted — the old
// base64-substring check rejected every valid file.
assert.equal(isMp4Header(Buffer.from("000000206674797069736f6d00000000", "hex").toString("base64")), true);
// An HTML error page served with HTTP 200 has no ftyp box.
assert.equal(isMp4Header(Buffer.from("<!DOCTYPE html><html><body>403").toString("base64")), false);
assert.equal(isMp4Header(""), false);

console.log("download status tests passed");
