import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

try {
  process.loadEnvFile();
} catch {
  // .env optional
}

interface PackageJson {
  version: string;
  repository: string;
}

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");
const DOCS_DIR = resolve(REPO_ROOT, "docs");
const FIREFOX_GECKO_ID = "youtube-downloader@avi12.com";
const GITHUB_USER = "avi12";
const GITHUB_REPO = "youtube-downloader";
const RELEASES_BASE = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download`;

const packageJson: PackageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
const { version } = packageJson;

const tag = `v${version}`;
const chromeCrxUrl = `${RELEASES_BASE}/${tag}/youtube-downloader-${version}-chrome.crx`;
const firefoxXpiUrl = `${RELEASES_BASE}/${tag}/youtube-downloader-${version}-firefox.xpi`;

const chromeKey = process.env.CHROME_EXTENSION_KEY;
if (!chromeKey) {
  console.error("CHROME_EXTENSION_KEY env var is required (base64 DER SubjectPublicKeyInfo)");
  process.exit(1);
}

const chromeExtensionId = computeChromeExtensionId(chromeKey);

mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(resolve(DOCS_DIR, "updates.xml"), renderChromeUpdatesXml(chromeExtensionId, version, chromeCrxUrl));
writeFileSync(resolve(DOCS_DIR, "updates.json"), renderFirefoxUpdatesJson(version, firefoxXpiUrl));

console.log(`Wrote docs/updates.xml (Chrome appid=${chromeExtensionId}, version=${version})`);
console.log(`Wrote docs/updates.json (Firefox addon=${FIREFOX_GECKO_ID}, version=${version})`);

const chromePemPath = process.env.CHROME_CRX_PRIVATE_KEY_PATH;
if (chromePemPath) {
  packChromeCrx(chromePemPath);
} else {
  console.log("CHROME_CRX_PRIVATE_KEY_PATH not set — skipping .crx pack");
}

const amoIssuer = process.env.AMO_JWT_ISSUER;
const amoSecret = process.env.AMO_JWT_SECRET;
if (amoIssuer && amoSecret) {
  signFirefoxXpi(amoIssuer, amoSecret);
} else {
  console.log("AMO_JWT_ISSUER / AMO_JWT_SECRET not set — skipping Firefox sign");
}

function computeChromeExtensionId(base64PublicKey: string): string {
  const derEncoded = Buffer.from(base64PublicKey, "base64");
  const hexHash = createHash("sha256").update(derEncoded).digest("hex").slice(0, 32);
  return Array.from(hexHash, hexChar => String.fromCharCode("a".charCodeAt(0) + parseInt(hexChar, 16))).join("");
}

function renderChromeUpdatesXml(appId: string, appVersion: string, crxUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${appId}">
    <updatecheck codebase="${crxUrl}" version="${appVersion}" />
  </app>
</gupdate>
`;
}

function renderFirefoxUpdatesJson(appVersion: string, xpiUrl: string): string {
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

function packChromeCrx(pemPath: string): void {
  if (!existsSync(pemPath)) {
    console.error(`CHROME_CRX_PRIVATE_KEY_PATH=${pemPath} not found`);
    process.exit(1);
  }
  const chromeBinary = findChromeBinary();
  if (!chromeBinary) {
    console.error("Could not locate a Chrome binary to pack the .crx; install Chrome for Testing or set CHROME_BIN");
    process.exit(1);
  }
  const sourceDir = resolve(REPO_ROOT, ".output", "chrome-mv3");
  if (!existsSync(sourceDir)) {
    console.error(`Build output not found at ${sourceDir} — run pnpm build first`);
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
  console.log(`Packed .crx alongside ${sourceDir}`);
}

function findChromeBinary(): string | null {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const candidates = chromeCandidatesFor(process.platform);
  return candidates.find(path => existsSync(path)) ?? null;
}

function chromeCandidatesFor(platform: NodeJS.Platform): string[] {
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

function signFirefoxXpi(issuer: string, secret: string): void {
  const sourceDir = resolve(REPO_ROOT, ".output", "firefox-mv3");
  if (!existsSync(sourceDir)) {
    console.error(`Firefox build not found at ${sourceDir} — run pnpm build:firefox first`);
    process.exit(1);
  }
  const artifactsDir = resolve(REPO_ROOT, ".output");
  const result = spawnSync("pnpm", [
    "dlx",
    "web-ext",
    "sign",
    `--source-dir=${sourceDir}`,
    `--artifacts-dir=${artifactsDir}`,
    `--api-key=${issuer}`,
    `--api-secret=${secret}`,
    "--channel=unlisted"
  ], { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error("web-ext sign failed");
    process.exit(result.status ?? 1);
  }
  console.log(`Signed .xpi written under ${artifactsDir}`);
}
