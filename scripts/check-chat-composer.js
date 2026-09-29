const assert = require("node:assert");
const fs = require("node:fs");

for (const file of ["app/chat.tsx", "app/admin/chat/[id].tsx"]) {
  const source = fs.readFileSync(file, "utf8");
  assert(!source.includes("Keyboard.addListener"), `${file} must avoid delayed keyboard state`);
  assert(source.includes('behavior="padding"'), `${file} must move the composer above the keyboard`);
  assert(source.includes("paddingBottom: insets.bottom + 8"), `${file} must keep stable safe-area padding`);
  assert(source.includes('flexDirection: "row", direction: "ltr"'), `${file} must use deterministic physical ordering`);
  assert((source.match(/marginLeft: 8/g) || []).length === 2, `${file} must keep an 8dp gap around each action`);
  assert(source.includes("width: 48, height: 52"), `${file} actions must retain accessible touch targets`);
}

console.log("Chat composer layout contract passed.");
