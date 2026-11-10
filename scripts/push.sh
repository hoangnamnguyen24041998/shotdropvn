#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

BUMP_TYPE="${1:-patch}"

echo "=================================================="
echo "  ShotDropVN Automated Release & Version Bumper"
echo "=================================================="

# 1. Bump version across all configs
node scripts/bump-version.js "${BUMP_TYPE}"

VERSION=$(node -e "console.log(require('./version.json').version)")
BUILD=$(node -e "console.log(require('./version.json').buildNumber)")

# 2. Stage updated version files
git add version.json mobile/package.json mobile/app.json mobile/App.tsx web/package.json

if ! git diff --cached --quiet; then
  git commit -m "chore(release): bump version to v${VERSION} (build ${BUILD})"
  echo "✅ Committed version bump to v${VERSION} (build ${BUILD})"
fi

# 3. Build Android Release APK locally
echo "🔨 Building Android Release APK for v${VERSION} (build ${BUILD})..."
cd mobile/android
./gradlew assembleRelease --no-daemon
cd "${ROOT_DIR}"

# 4. Package and archive APK
APK_SRC="mobile/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "${APK_SRC}" ]; then
  cp "${APK_SRC}" "ShotDropVN-v${VERSION}.apk"
  cp "${APK_SRC}" "ShotDropVN-release.apk"
  echo "📦 Release APK ready:"
  ls -lh "ShotDropVN-v${VERSION}.apk"
fi

# 5. Auto-install to connected phone via ADB if connected
if command -v adb >/dev/null 2>&1; then
  DEVICE=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
  if [ -n "${DEVICE}" ]; then
    echo "📱 Installing v${VERSION} onto connected Android device (${DEVICE})..."
    adb -s "${DEVICE}" install -r "ShotDropVN-release.apk" || true
    echo "🚀 Launching ShotDropVN on ${DEVICE}..."
    adb -s "${DEVICE}" shell am start -n vn.shotdrop.mobile/.MainActivity || true
  fi
fi

# 6. Push to remote origin
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "🚀 Pushing ${CURRENT_BRANCH} to remote origin..."
git push origin "${CURRENT_BRANCH}"

# If on mobile-main, also sync to main
if [ "${CURRENT_BRANCH}" = "mobile-main" ]; then
  echo "🔄 Syncing release to main branch..."
  git checkout main
  git merge mobile-main
  git push origin main
  git checkout mobile-main
fi

echo "=================================================="
echo "🎉 Release v${VERSION} (Build ${BUILD}) completed & pushed!"
echo "=================================================="
