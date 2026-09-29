#!/usr/bin/env bash
# Publish an OTA update to the most recent APK runtimes.
#
# Why this exists: EAS Update only delivers an OTA to installs whose
# runtimeVersion matches the published update exactly. New builds use the
# "fingerprint" policy (app.json), so every build that had any native-layer
# change (dependency bump, app.json edit, plugin change) gets a different
# fingerprint. A plain `eas update` only reaches installs whose fingerprint
# matches the *current working tree* — everyone on an older build is stranded
# unless we republish to their exact runtime too.
#
# How this works: pages through `eas build:list` (the CLI caps a page at 50
# builds) for finished Android builds, sorts them newest-first, keeps up to
# RECENT_RUNTIMES (default 3, or "all") unique runtimeVersions, and republishes
# the same JS bundle to each.
#
# Usage:  scripts/publish-ota.sh "your update message"
#         BRANCHES="production preview" scripts/publish-ota.sh "fix X"
#         RECENT_RUNTIMES=all scripts/publish-ota.sh "fix X"      # every runtime
#         RECENT_RUNTIMES=10 scripts/publish-ota.sh "fix X"
#
# SAFETY: only republish JS that is compatible with the OLD native binaries.
# If this update needs a native API the old APK doesn't have, it will CRASH that
# old install — push those users to the APK download prompt instead (version.json).
set -euo pipefail

MSG="${1:-OTA update}"
# Default: publish to every branch that has a channel. Override with BRANCHES env.
BRANCHES="${BRANCHES:-production preview staging}"
# How many of the newest runtimes to reach: a number, or "all".
RECENT_RUNTIMES="${RECENT_RUNTIMES:-3}"
export RECENT_RUNTIMES

# ── 1. Discover the newest runtime versions that have a finished build ───────
# `eas build:list --json` returns an array of build objects; each has a
# `runtimeVersion` field (the value baked into that APK) plus a completion
# timestamp. The CLI caps --limit at 50, so page with --offset until the last
# page. Then keep unique runtimes in NEWEST-FIRST order and take the top N.
echo ">> Discovering runtime version(s) (cap: $RECENT_RUNTIMES)…"
PAGES=$(mktemp -d)
OFFSET=0
while :; do
  eas build:list --platform android --json --non-interactive --limit 50 --offset "$OFFSET" > "$PAGES/$OFFSET.json"
  COUNT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$PAGES/$OFFSET.json")
  [ "$COUNT" -lt 50 ] && break
  OFFSET=$((OFFSET + 50))
done

RUNTIMES=$(node -e '
      const fs = require("fs");
      const dir = process.argv[1];
      const raw = process.env.RECENT_RUNTIMES || "3";
      const limit = raw === "all" ? Infinity : Number(raw);
      try {
        const arr = fs
          .readdirSync(dir)
          .flatMap((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")));
        const finished = arr
          .filter((b) => b.status === "FINISHED" && b.runtimeVersion)
          .sort((a, b) => String(b.completedAt || b.createdAt || "").localeCompare(String(a.completedAt || a.createdAt || "")));
        const seen = new Set();
        for (const b of finished) {
          if (seen.size >= limit) break;
          if (seen.has(b.runtimeVersion)) continue;
          seen.add(b.runtimeVersion);
          console.log(b.runtimeVersion);
        }
      } catch (e) {
        console.error("Failed to parse build list:", e.message);
        process.exit(1);
      }
    ' "$PAGES")
rm -rf "$PAGES"

RUNTIME_COUNT=$(echo "$RUNTIMES" | grep -c . || true)
echo ">> Found $RUNTIME_COUNT runtime version(s):"
echo "$RUNTIMES" | sed 's/^/     /'

# app.json's runtimeVersion policy is "appVersion", so this is the runtime the
# unset-OTA_RUNTIME publish targets. Skip it in the loop when it's already in
# the recent list (it is, being the newest) — one publish per runtime per branch.
CURRENT_RUNTIME=$(node -e "try{console.log(require('./app.json').expo.version)}catch(e){console.log('')}" 2>/dev/null || true)

# ── 2. Publish to each branch × each recent runtime ──────────────────────────
# The first publish per branch uses the current working-tree runtime
# (OTA_RUNTIME unset) — that reaches installs built from the current tree.
# Then we republish to the discovered runtimes so older APKs get the same JS.
for BRANCH in $BRANCHES; do
  echo ""
  echo ">> Publishing to current runtime on branch '$BRANCH'"
  eas update --branch "$BRANCH" --message "$MSG"

  for RT in $RUNTIMES; do
    if [ -n "$CURRENT_RUNTIME" ] && [ "$RT" = "$CURRENT_RUNTIME" ]; then
      echo ">> Runtime $RT is the current tree's runtime — already published above, skipping"
      continue
    fi
    echo ">> Republishing to runtime $RT on branch '$BRANCH'"
    OTA_RUNTIME="$RT" eas update --branch "$BRANCH" --message "$MSG (runtime $RT)"
  done
done

echo ""
echo ">> Done. Reached: current runtime + $RUNTIME_COUNT recent build runtimes across branches: $BRANCHES"
echo ">> Remember: very old APKs that predate the in-app update check can only be"
echo ">>           reached by bumping version.json so they get the APK prompt."
