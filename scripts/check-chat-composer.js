const assert = require("node:assert");
const fs = require("node:fs");

for (const file of ["app/chat.tsx", "app/admin/chat/[id].tsx"]) {
  const source = fs.readFileSync(file, "utf8");
  assert(!source.includes("Keyboard.addListener"), `${file} must avoid delayed keyboard state`);
  assert(source.includes('behavior="padding"'), `${file} must move the composer above the keyboard`);
  assert(source.includes("paddingBottom: insets.bottom + 8"), `${file} must keep stable safe-area padding`);
  assert(source.includes('flexDirection: "row", direction: "ltr"'), `${file} must use deterministic physical ordering`);
  assert(source.includes("marginLeft: 14"), `${file} must separate Send and Photo`);
  assert(source.includes("marginLeft: 18"), `${file} must separate actions from the input`);
}

console.log("Chat composer layout contract passed.");
