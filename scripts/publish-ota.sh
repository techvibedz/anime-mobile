#!/usr/bin/env bash
# Publish an OTA update so it reaches EVERY install — including users still on an
# old APK whose runtimeVersion no longer matches new builds.
#
# Why this exists: EAS Update only delivers an OTA to installs whose
# runtimeVersion matches the published update exactly. New builds use the
# "fingerprint" policy (app.json), but already-installed old APKs are pinned to
# their old app-version string runtime ("2.1.0", "2.2.0", ...). A plain
# `eas update` skips them forever. This republishes the SAME JS to each legacy
# runtime below so stranded users still get the latest bundle.
#
# ponytail: hard-coded legacy list, not auto-discovered. Add a version here each
# time you ship a native build; drop versions once they have ~no installs.
#
# Usage:  scripts/publish-ota.sh "your update message"
#         BRANCH=preview scripts/publish-ota.sh "fix X"   # override channel
#
# SAFETY: only republish JS that is compatible with the OLD native binaries.
# If this update needs a native API the old APK doesn't have, it will CRASH that
# old install — push those users to the APK download prompt instead (version.json).
set -euo pipefail

MSG="${1:-OTA update}"
BRANCH="${BRANCH:-preview}"

# Old app-version-string runtimes that still have active installs.
LEGACY_RUNTIMES=(
  "2.2.0"
  "2.1.0"
  "2.0.0"
  "1.5.1"
  "1.5.0"
  "1.4.0"
)

echo ">> Publishing to current (fingerprint) runtime on branch '$BRANCH'"
eas update --branch "$BRANCH" --message "$MSG"

for RT in "${LEGACY_RUNTIMES[@]}"; do
  echo ">> Republishing to legacy runtime $RT on branch '$BRANCH'"
  eas update --branch "$BRANCH" --runtime-version "$RT" --message "$MSG (legacy $RT)"
done

echo ">> Done. New installs + all listed legacy runtimes now have this update."
echo ">> Remember: very old APKs that predate the in-app update check can only be"
echo ">>           reached by bumping version.json so they get the APK prompt."
