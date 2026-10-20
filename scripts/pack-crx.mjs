import { readFileSync } from "node:fs";
import crx3 from "crx3";

const KEY_PATH = "keys/chrome.pem";
const MANIFEST_VERSIONS = [2, 3];
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

await Promise.all(MANIFEST_VERSIONS.map(manifestVersion => crx3(
  [`.output/chrome-mv${manifestVersion}`],
  { keyPath: KEY_PATH, crxPath: `.output/youtube-ffmpeg-lite-${version}-chrome-mv${manifestVersion}.crx` }
)));
