import { generateKeyPairSync, createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const KEY_PATH = resolve(import.meta.dirname, "..", "keys", "chrome.pem");

if (existsSync(KEY_PATH)) {
  console.error(`Refusing to overwrite ${KEY_PATH}`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

const spkiBuffer = publicKey.export({ format: "der", type: "spki" });
const publicKeyBase64 = spkiBuffer.toString("base64");
const hexHash = createHash("sha256").update(spkiBuffer).digest("hex").slice(0, 32);
const extensionId = Array.from(hexHash, hexChar => String.fromCharCode("a".charCodeAt(0) + parseInt(hexChar, 16))).join("");

mkdirSync(dirname(KEY_PATH), { recursive: true });
writeFileSync(KEY_PATH, privatePem, { mode: 0o600 });

console.log(`Wrote private key: ${KEY_PATH}`);
console.log(`Extension ID:      ${extensionId}`);
console.log("");
console.log("Set these env vars before pnpm build / pnpm release:");
console.log(`  $env:CHROME_EXTENSION_KEY = "${publicKeyBase64}"`);
console.log(`  $env:CHROME_CRX_PRIVATE_KEY_PATH = "${KEY_PATH}"`);
