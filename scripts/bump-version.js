#!/usr/bin/env node

/**
 * ShotDropVN Version Bumper
 * Usage:
 *   node scripts/bump-version.js [patch|minor|major]
 *
 * Automatically increments version x.y.z and buildNumber across all mobile & web configs:
 * - version.json
 * - mobile/package.json
 * - mobile/app.json (version & android.versionCode)
 * - mobile/android/app/build.gradle (versionName & versionCode)
 * - mobile/App.tsx (APP_VERSION & APP_BUILD)
 * - web/package.json
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT_DIR, 'version.json');
const MOBILE_PKG = path.join(ROOT_DIR, 'mobile', 'package.json');
const MOBILE_APP_JSON = path.join(ROOT_DIR, 'mobile', 'app.json');
const MOBILE_GRADLE = path.join(
  ROOT_DIR,
  'mobile',
  'android',
  'app',
  'build.gradle'
);
const MOBILE_APP_TSX = path.join(ROOT_DIR, 'mobile', 'App.tsx');
const WEB_PKG = path.join(ROOT_DIR, 'web', 'package.json');

const bumpType = process.argv[2] || 'patch';

// 1. Read current version
let currentVersion = '1.2.0';
let currentBuild = 3;

if (fs.existsSync(VERSION_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    if (data.version) currentVersion = data.version;
    if (data.buildNumber) currentBuild = Number(data.buildNumber);
  } catch (err) {
    console.warn('Could not read version.json, falling back to defaults:', err);
  }
}

// 2. Parse Semver x.y.z
const parts = currentVersion.split('.').map((p) => parseInt(p, 10));
while (parts.length < 3) parts.push(0);

let [major, minor, patch] = parts;

if (bumpType === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bumpType === 'minor') {
  minor += 1;
  patch = 0;
} else {
  // default: patch
  patch += 1;
}

const nextVersion = `${major}.${minor}.${patch}`;
const nextBuild = currentBuild + 1;

console.log(
  `🚀 Bumping version: ${currentVersion} (build ${currentBuild}) -> ${nextVersion} (build ${nextBuild})`
);

// 3. Update version.json
fs.writeFileSync(
  VERSION_FILE,
  JSON.stringify({ version: nextVersion, buildNumber: nextBuild }, null, 2) + '\n',
  'utf8'
);

// 4. Update mobile/package.json
if (fs.existsSync(MOBILE_PKG)) {
  const pkg = JSON.parse(fs.readFileSync(MOBILE_PKG, 'utf8'));
  pkg.version = nextVersion;
  fs.writeFileSync(MOBILE_PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

// 5. Update mobile/app.json
if (fs.existsSync(MOBILE_APP_JSON)) {
  const appJson = JSON.parse(fs.readFileSync(MOBILE_APP_JSON, 'utf8'));
  if (appJson.expo) {
    appJson.expo.version = nextVersion;
    if (!appJson.expo.android) appJson.expo.android = {};
    appJson.expo.android.versionCode = nextBuild;
  }
  fs.writeFileSync(MOBILE_APP_JSON, JSON.stringify(appJson, null, 2) + '\n', 'utf8');
}

// 6. Update mobile/android/app/build.gradle
if (fs.existsSync(MOBILE_GRADLE)) {
  let gradleContent = fs.readFileSync(MOBILE_GRADLE, 'utf8');
  gradleContent = gradleContent.replace(
    /versionCode\s+\d+/,
    `versionCode ${nextBuild}`
  );
  gradleContent = gradleContent.replace(
    /versionName\s+["'][^"']+["']/,
    `versionName "${nextVersion}"`
  );
  fs.writeFileSync(MOBILE_GRADLE, gradleContent, 'utf8');
}

// 7. Update mobile/App.tsx
if (fs.existsSync(MOBILE_APP_TSX)) {
  let tsxContent = fs.readFileSync(MOBILE_APP_TSX, 'utf8');
  tsxContent = tsxContent.replace(
    /export const APP_VERSION\s*=\s*['"][^'"]+['"];/,
    `export const APP_VERSION = '${nextVersion}';`
  );
  if (/export const APP_BUILD\s*=/.test(tsxContent)) {
    tsxContent = tsxContent.replace(
      /export const APP_BUILD\s*=\s*\d+;/,
      `export const APP_BUILD = ${nextBuild};`
    );
  } else {
    tsxContent = tsxContent.replace(
      `export const APP_VERSION = '${nextVersion}';`,
      `export const APP_VERSION = '${nextVersion}';\nexport const APP_BUILD = ${nextBuild};`
    );
  }
  tsxContent = tsxContent.replace(
    /ShotDropVN Studio • Version \{APP_VERSION\} \(Build \d+\)/,
    `ShotDropVN Studio • Version {APP_VERSION} (Build {APP_BUILD})`
  );
  fs.writeFileSync(MOBILE_APP_TSX, tsxContent, 'utf8');
}

// 8. Update web/package.json
if (fs.existsSync(WEB_PKG)) {
  const webPkg = JSON.parse(fs.readFileSync(WEB_PKG, 'utf8'));
  webPkg.version = nextVersion;
  fs.writeFileSync(WEB_PKG, JSON.stringify(webPkg, null, 2) + '\n', 'utf8');
}

console.log(
  `✅ All version configurations updated successfully to v${nextVersion} (Build ${nextBuild})!`
);
