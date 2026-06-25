import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
const FIREFOX_GECKO_ID = "youtube-downloader@avi12.com";
const GITHUB_USER = "avi12";
const GITHUB_REPO = "youtube-downloader";
const RELEASES_BASE = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download`;

const packageJson: PackageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
const { version } = packageJson;

const tag = `v${version}`;
const firefoxXpiUrl = `${RELEASES_BASE}/${tag}/youtube-downloader-${version}-firefox.xpi`;

mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(resolve(DOCS_DIR, "updates.json"), renderFirefoxUpdatesJson(version, firefoxXpiUrl));
console.log(`Wrote docs/updates.json (Firefox addon=${FIREFOX_GECKO_ID}, version=${version})`);

// Chrome auto-update is not self-hostable: a self-signed .crx fails with
// CRX_REQUIRED_PROOF_MISSING and off-store force-install only works on managed
// devices. Chrome users install the .zip via Load unpacked and are nudged by the
// in-extension update notifier. Only Firefox keeps a real self-hosted update feed.
const amoIssuer = process.env.AMO_JWT_ISSUER;
const amoSecret = process.env.AMO_JWT_SECRET;
if (amoIssuer && amoSecret) {
  signFirefoxXpi(amoIssuer, amoSecret);
} else {
  console.log("AMO_JWT_ISSUER / AMO_JWT_SECRET not set — skipping Firefox sign");
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
