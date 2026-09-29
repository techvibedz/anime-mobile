// Overlay the tested app source onto a detached worktree of the native build.
// Keep that build's dependency lock, Babel config and native app config intact.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const target = path.resolve(process.argv[2] || "");
const approvedParent = "C:\\Users\\asus\\AppData\\Local\\Temp\\opencode";
if (!process.argv[2] || path.dirname(target).toLowerCase() !== approvedParent.toLowerCase() || !fs.existsSync(path.join(target, ".git"))) {
  throw Error("Expected an existing detached release worktree in the approved temp directory");
}
const native = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
if (!/^\^?54\./.test(native.dependencies.expo)) throw Error("Release dependency baseline must match the installed SDK 54 APK");
const current = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\0");
const sourceDirs = new Set(["app", "components", "lib", "assets", "modules", "plugins", "scripts"]);
const sourceFiles = new Set(["global.css", "metro.config.js", "tailwind.config.js", "tailwind.config.ts", "tsconfig.json", "nativewind-env.d.ts", "app.config.js"]);
for (const relative of new Set(tracked)) {
  if (!relative || (!sourceDirs.has(relative.split("/")[0]) && !sourceFiles.has(relative))) continue;
  const source = path.join(root, relative);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
  const destination = path.join(target, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
// Test commands changed since the APK build; use the current checks against the
// native-compatible dependencies without changing any locked dependency.
native.scripts = current.scripts;
fs.writeFileSync(path.join(target, "package.json"), JSON.stringify(native, null, 2) + "\n");
fs.copyFileSync(path.join(root, ".env"), path.join(target, ".env"));
console.log(`Prepared SDK 54 production source at ${target}; the SDK 57 workspace is untouched.`);
