#!/bin/bash
# Checks a release .app: valid signature, Developer ID authority, hardened runtime and secure timestamp on every
# Mach-O file, one team everywhere. Usage: verify-release-app.sh <Cliparla.app> <team id>
set -uo pipefail
APP="${1:?usage: verify-release-app.sh <app> <team id>}"
TEAM="${2:?usage: verify-release-app.sh <app> <team id>}"
fail=0
bad() { echo "verify-release-app: $*" >&2; fail=1; }

echo "== codesign --verify --deep --strict"
codesign --verify --deep --strict --verbose=2 "$APP" || bad "signature does not verify"

INFO=$(codesign -dv --verbose=4 "$APP" 2>&1)
echo "$INFO" | grep -E '^(Identifier|Authority|TeamIdentifier|Timestamp|Runtime Version)'
echo "$INFO" | grep -q '^Authority=Developer ID Application:' || bad "app is not signed by a Developer ID Application certificate"
echo "$INFO" | grep -q "^TeamIdentifier=$TEAM\$" || bad "app team is not $TEAM"
echo "$INFO" | grep -E '^CodeDirectory' | grep -q 'runtime' || bad "app lacks the hardened runtime flag"
echo "$INFO" | grep -q '^Timestamp=' || bad "app has no secure timestamp"

echo "== every Mach-O file"
count=0
while IFS= read -r f; do
  file -b "$f" | grep -q 'Mach-O' || continue
  count=$((count + 1))
  I=$(codesign -dv --verbose=4 "$f" 2>&1)
  [[ "$I" == *"TeamIdentifier=$TEAM"* ]] || bad "$f: not signed by team $TEAM"
  [[ "$I" == *"Authority=Developer ID Application:"* ]] || bad "$f: not Developer ID"
  echo "$I" | grep -E '^CodeDirectory' | grep -q 'runtime' || bad "$f: no hardened runtime"
  [[ "$I" == *"Timestamp="* ]] || bad "$f: no secure timestamp"
done < <(find "$APP" -type f)
echo "$count Mach-O files checked"
[[ $count -gt 10 ]] || bad "suspiciously few Mach-O files ($count)"

echo "== entitlements: nothing that lets other programs inject code"
for f in "$APP" "$APP/Contents/Resources/bin/cliparla-paste" "$APP/Contents/Resources/bin/cliparla-keys"; do
  ENT=$(codesign -d --entitlements - --xml "$f" 2>/dev/null | plutil -p - 2>/dev/null || true)
  echo "$ENT" | grep -q 'allow-dyld-environment-variables' && bad "$f: allow-dyld-environment-variables"
  echo "$ENT" | grep -q 'disable-library-validation' && bad "$f: disable-library-validation"
done

for h in cliparla-paste cliparla-keys; do
  [[ -x "$APP/Contents/Resources/bin/$h" ]] || bad "helper $h missing"
done

[[ $fail -eq 0 ]] && echo "verify-release-app: ok" || exit 1
