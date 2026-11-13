import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, resolve } from "node:path";

try {
  process.loadEnvFile();
} catch {
  // .env optional
}

interface PackageJson {
  version: string;
}

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");
const DOCS_DIR = resolve(REPO_ROOT, "docs");
const ARTIFACTS_DIR = resolve(REPO_ROOT, ".output");
const FIREFOX_GECKO_ID = "youtube-downloader@avi12.com";
const GITHUB_USER = "avi12";
const GITHUB_REPO = "youtube-downloader";
const RELEASES_BASE = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download`;

const packageJson: PackageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
const { version } = packageJson;
const tag = `v${version}`;
const chromeZipPath = resolve(ARTIFACTS_DIR, `youtube-downloader-${version}-chrome.zip`);
const chromeCrxPath = resolve(ARTIFACTS_DIR, `youtube-downloader-${version}-chrome.crx`);
const firefoxXpiPath = resolve(ARTIFACTS_DIR, `youtube-downloader-${version}-firefox.xpi`);
const firefoxXpiUrl = `${RELEASES_BASE}/${tag}/${basename(firefoxXpiPath)}`;

const chromePemPath = requiredEnv("CHROME_CRX_PRIVATE_KEY_PATH");
const amoIssuer = requiredEnv("AMO_JWT_ISSUER");
const amoSecret = requiredEnv("AMO_JWT_SECRET");

buildAndPackageChrome();
packChromeCrx(chromePemPath);
buildFirefox();
signFirefoxXpi(amoIssuer, amoSecret);

mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(resolve(DOCS_DIR, "updates.json"), renderFirefoxUpdatesJson(version, firefoxXpiUrl));
console.log(`Wrote docs/updates.json (Firefox addon=${FIREFOX_GECKO_ID}, version=${version})`);
console.log("Release artifacts:");
console.log(`  ${chromeCrxPath}`);
console.log(`  ${chromeZipPath}`);
console.log(`  ${firefoxXpiPath}`);

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required to produce all release artifacts`);
    process.exit(1);
  }

  return value;
}

function buildAndPackageChrome() {
  runPnpm(["build"]);
  runPnpm(["run", "pack"]);
  assertArtifact(chromeZipPath, "Chrome zip");
}

function buildFirefox() {
  runPnpm(["build:firefox"]);
}

function runPnpm(args: string[]) {
  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
    shell: true
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function renderFirefoxUpdatesJson(appVersion: string, xpiUrl: string) {
  return `${JSON.stringify({
    addons: {
      [FIREFOX_GECKO_ID]: {
        updates: [{
          version: appVersion,
          update_link: xpiUrl,
          applications: {
            gecko: {
              strict_min_version: "147.0"
            }
          }
        }]
      }
    }
  }, null, 2)}\n`;
}

function packChromeCrx(pemPath: string) {
  if (!existsSync(pemPath)) {
    console.error(`CHROME_CRX_PRIVATE_KEY_PATH=${pemPath} not found`);
    process.exit(1);
  }

  const chromeBinary = findChromeBinary();
  if (!chromeBinary) {
    console.error("Could not locate a Chrome binary to pack the .crx; install Chrome for Testing or set CHROME_BIN");
    process.exit(1);
  }

  const sourceDir = resolve(ARTIFACTS_DIR, "chrome-mv3");
  if (!existsSync(sourceDir)) {
    console.error(`Chrome build not found at ${sourceDir}`);
    process.exit(1);
  }

  const result = spawnSync(chromeBinary, [
    `--pack-extension=${sourceDir}`,
    `--pack-extension-key=${pemPath}`,
    "--no-message-box"
  ], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("Chrome --pack-extension failed");
    process.exit(result.status ?? 1);
  }

  const packedCrxPath = `${sourceDir}.crx`;
  assertArtifact(packedCrxPath, "packed Chrome CRX");
  copyFileSync(packedCrxPath, chromeCrxPath);
  assertArtifact(chromeCrxPath, "Chrome CRX");
}

function findChromeBinary() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const candidates = chromeCandidatesFor(process.platform);
  return candidates.find(path => existsSync(path)) ?? null;
}

function chromeCandidatesFor(platform: NodeJS.Platform) {
  if (platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      resolve(REPO_ROOT, ".chrome-for-testing", "chrome-win64", "chrome.exe")
    ];
  }

  if (platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }

  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
}

function signFirefoxXpi(issuer: string, secret: string) {
  if (existsSync(firefoxXpiPath)) {
    console.log(`Signed Firefox XPI already exists at ${firefoxXpiPath}; reusing it`);
    return;
  }

  const sourceDir = resolve(ARTIFACTS_DIR, "firefox-mv3");
  if (!existsSync(sourceDir)) {
    console.error(`Firefox build not found at ${sourceDir}`);
    process.exit(1);
  }

  runPnpm([
    "dlx",
    "web-ext",
    "sign",
    `--source-dir=${sourceDir}`,
    `--artifacts-dir=${ARTIFACTS_DIR}`,
    `--api-key=${issuer}`,
    `--api-secret=${secret}`,
    "--channel=unlisted"
  ]);
  const signedXpiPath = findLatestSignedXpi();
  copyFileSync(signedXpiPath, firefoxXpiPath);
  assertArtifact(firefoxXpiPath, "Firefox XPI");
}

function findLatestSignedXpi() {
  const signedXpis = readdirSync(ARTIFACTS_DIR)
    .filter(name => name.endsWith(`-${version}.xpi`) && resolve(ARTIFACTS_DIR, name) !== firefoxXpiPath)
    .map(name => resolve(ARTIFACTS_DIR, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (signedXpis.length === 0) {
    console.error(`Could not find the signed Firefox XPI for version ${version}`);
    process.exit(1);
  }

  return signedXpis[0];
}

function assertArtifact(path: string, description: string) {
  if (!existsSync(path)) {
    console.error(`${description} was not created at ${path}`);
    process.exit(1);
  }
}
