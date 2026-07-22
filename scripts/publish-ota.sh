#!/usr/bin/env bash
# Publish an OTA update so it reaches EVERY install — including users still on
# an old APK whose runtimeVersion no longer matches the current fingerprint.
#
# Why this exists: EAS Update only delivers an OTA to installs whose
# runtimeVersion matches the published update exactly. New builds use the
# "fingerprint" policy (app.json), so every build that had any native-layer
# change (dependency bump, app.json edit, plugin change) gets a different
# fingerprint. A plain `eas update` only reaches installs whose fingerprint
# matches the *current working tree* — everyone on an older build is stranded
# forever unless we republish to their exact runtime too.
#
# How this works: queries `eas build:list` for every finished Android build,
# extracts the unique runtimeVersion from each, and republishes the same JS
# bundle to every one of them. Fully automatic — no hardcoded list to maintain.
#
# Usage:  scripts/publish-ota.sh "your update message"
#         BRANCHES="production preview" scripts/publish-ota.sh "fix X"
#
# SAFETY: only republish JS that is compatible with the OLD native binaries.
# If this update needs a native API the old APK doesn't have, it will CRASH that
# old install — push those users to the APK download prompt instead (version.json).
set -euo pipefail

MSG="${1:-OTA update}"
# Default: publish to every branch that has a channel. Override with BRANCHES env.
BRANCHES="${BRANCHES:-production preview staging}"

# ── 1. Discover every runtime version that has a finished build ──────────────
# `eas build:list --json` returns an array of build objects; each has a
# `runtimeVersion` field (the value baked into that APK). We feed the JSON
# through a tiny node one-liner (node is guaranteed present — eas needs it) to
# pull out unique runtimeVersion values, one per line.
echo ">> Discovering runtime versions from finished builds…"
RUNTIMES=$(eas build:list --platform android --json --non-interactive --limit 50 \
  | node -e '
      let s = "";
      process.stdin.on("data", (c) => (s += c));
      process.stdin.on("end", () => {
        try {
          const arr = JSON.parse(s);
          const set = new Set();
          for (const b of arr) {
            if (b.status === "FINISHED" && b.runtimeVersion) set.add(b.runtimeVersion);
          }
          console.log([...set].join("\n"));
        } catch (e) {
          console.error("Failed to parse build list:", e.message);
          process.exit(1);
        }
      });
    ')

RUNTIME_COUNT=$(echo "$RUNTIMES" | grep -c . || true)
echo ">> Found $RUNTIME_COUNT unique runtime version(s) across finished builds."

# ── 2. Publish to each branch × each runtime ─────────────────────────────────
# The first publish per branch uses the current working-tree fingerprint
# (OTA_RUNTIME unset) — that reaches new installs built from the current tree.
# Then we republish to every discovered runtime so old APKs get the same JS.
for BRANCH in $BRANCHES; do
  echo ""
  echo ">> Publishing to current (fingerprint) runtime on branch '$BRANCH'"
  eas update --branch "$BRANCH" --message "$MSG"

  for RT in $RUNTIMES; do
    echo ">> Republishing to runtime $RT on branch '$BRANCH'"
    OTA_RUNTIME="$RT" eas update --branch "$BRANCH" --message "$MSG (runtime $RT)"
  done
done

echo ""
echo ">> Done. Reached: current fingerprint + $RUNTIME_COUNT build runtimes across branches: $BRANCHES"
echo ">> Remember: very old APKs that predate the in-app update check can only be"
echo ">>           reached by bumping version.json so they get the APK prompt."
