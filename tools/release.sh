#!/bin/bash
# Release build for macOS (Apple silicon): Developer ID signature, hardened runtime, notarization, DMG + ZIP.
# Usage: npm run release        (version comes from package.json)
# Output: dist/release/<version>/. Never uploads anything.
# Notarization needs a stored notarytool profile; its name comes from NOTARY_PROFILE (required):
#   xcrun notarytool store-credentials "<profile name>" --apple-id "<Apple ID>" --team-id "<team id>"
#   NOTARY_PROFILE="<profile name>" npm run release
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION=$(node -p "require('./package.json').version")
OUT="dist/release/$VERSION"
APP="$OUT/mac-arm64/Cliparla.app"
if [[ -z "${NOTARY_PROFILE:-}" ]]; then
  echo "release: set NOTARY_PROFILE to the name of your notarytool keychain profile, for example:" >&2
  echo "  NOTARY_PROFILE=<profile name> npm run release" >&2
  echo "Create one once with: xcrun notarytool store-credentials \"<profile name>\" --apple-id \"<Apple ID>\" --team-id \"<team id>\"" >&2
  exit 2
fi
PROFILE="$NOTARY_PROFILE"

# The team comes from the certificate; set CLIPARLA_TEAM_ID when the keychain holds several teams.
IDENTITIES=$(security find-identity -v -p codesigning | grep 'Developer ID Application:' | grep -F "${CLIPARLA_TEAM_ID:-(}" || true)
if [[ -z "$IDENTITIES" ]]; then
  echo "release: no \"Developer ID Application\" certificate in the keychain (unlock it or install the certificate)." >&2
  exit 1
fi
if [[ $(echo "$IDENTITIES" | wc -l) -gt 1 ]]; then
  echo "release: several Developer ID certificates found; set CLIPARLA_TEAM_ID to the team you want." >&2
  exit 1
fi
FULL_IDENTITY=$(echo "$IDENTITIES" | sed -n 's/.*"\(.*\)".*/\1/p')
TEAM=$(echo "$FULL_IDENTITY" | sed -n 's/.*(\([A-Z0-9]*\))$/\1/p')
BUILDER_IDENTITY="${FULL_IDENTITY#Developer ID Application: }"

if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "release: notarytool profile \"$PROFILE\" is missing or rejected by Apple. Store it once, then rerun:" >&2
  echo "  xcrun notarytool store-credentials \"$PROFILE\" --apple-id \"<Apple ID>\" --team-id \"$TEAM\"" >&2
  exit 2
fi

echo "== build"
npm run --silent notices
npm run --silent build:native
npm run --silent build

echo "== app signed with Developer ID (hardened runtime, helpers included)"
rm -rf "$OUT"
npx electron-builder --publish never --mac dir --arm64 \
  -c.directories.output="$OUT" -c.mac.identity="$BUILDER_IDENTITY"
bash tools/verify-release-app.sh "$APP" "$TEAM"

notarize() { # <file>
  local log id
  log=$(xcrun notarytool submit "$1" --keychain-profile "$PROFILE" --wait --output-format json) || true
  echo "$log"
  if [[ "$(echo "$log" | plutil -extract status raw - 2>/dev/null)" != "Accepted" ]]; then
    id=$(echo "$log" | plutil -extract id raw - 2>/dev/null || true)
    [[ -z "$id" ]] || xcrun notarytool log "$id" --keychain-profile "$PROFILE" >&2 || true
    echo "release: notarization of $1 was not accepted." >&2
    exit 1
  fi
}

echo "== notarize and staple the app"
ditto -c -k --keepParent "$APP" "$OUT/notarize-app.zip"
notarize "$OUT/notarize-app.zip"
rm -f "$OUT/notarize-app.zip"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl -a -vv -t exec "$APP"

echo "== DMG and ZIP from the stapled app"
npx electron-builder --publish never --prepackaged "$APP" --mac dmg zip --arm64 \
  -c.directories.output="$OUT" -c.mac.identity="$BUILDER_IDENTITY" \
  -c.mac.artifactName='${productName}-${version}-${arch}.${ext}'
rm -f "$OUT"/*.blockmap # no auto-update in Cliparla
DMG="$OUT/Cliparla-$VERSION-arm64.dmg"
ZIP="$OUT/Cliparla-$VERSION-arm64.zip"
[[ -f "$DMG" && -f "$ZIP" ]] || { echo "release: expected $DMG and $ZIP" >&2; ls "$OUT" >&2; exit 1; }

echo "== sign, notarize and staple the DMG"
codesign --force --sign "$FULL_IDENTITY" --timestamp "$DMG"
notarize "$DMG"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl -a -t open --context context:primary-signature -vv "$DMG"

( cd "$OUT" && shasum -a 256 "Cliparla-$VERSION-arm64.dmg" "Cliparla-$VERSION-arm64.zip" > SHA256SUMS.txt )
echo
echo "release: done."
ls -1 "$OUT" | grep -E '\.(dmg|zip|txt)$' | sed "s|^|  $OUT/|"
