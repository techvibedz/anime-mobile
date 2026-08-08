import assert from "node:assert";
import { createMetadataWriteGate } from "./metadataWriteGate";

const allow = createMetadataWriteGate(2, 1_000, 5_000);
assert.equal(allow("anime-a", 0), true);
assert.equal(allow("anime-a", 1), false);
assert.equal(allow("anime-b", 2), true);
assert.equal(allow("anime-c", 3), false);
assert.equal(allow("anime-c", 1_001), true);
assert.equal(allow("anime-a", 1_002), false);

console.log("metadata cache tests passed");
