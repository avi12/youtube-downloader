#!/usr/bin/env node
/**
 * Installs the native messaging host manifest for Chrome/Chromium browsers.
 *
 * On Windows: writes a registry key pointing to the manifest JSON.
 * On macOS/Linux: copies the manifest to the appropriate directory.
 *
 * Usage: node scripts/install-native-host.mjs [--extension-id=ID]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";

const HOST_NAME = "com.avi12.youtube_downloader";
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const HOST_SCRIPT = resolve(SCRIPT_DIR, "native-host.mjs");
const NODE_PATH = process.execPath;

// Parse --extension-id argument
const extensionIdArg = process.argv.find(arg => arg.startsWith("--extension-id="));
const extensionId = extensionIdArg?.split("=")[1] || "";

if (!extensionId) {
  console.error("Usage: node scripts/install-native-host.mjs --extension-id=YOUR_EXTENSION_ID");
  console.error("\nFind your extension ID at chrome://extensions (enable Developer mode)");
  process.exit(1);
}

// Build the manifest with the correct path and allowed_origins
const manifest = {
  name: HOST_NAME,
  description: "YouTube Downloader native messaging host - makes HTTP requests with proper headers",
  path: HOST_SCRIPT,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`]
};

// On Windows, the path needs to be a .bat or .exe wrapper since Chrome
// can't directly execute .mjs files. Create a batch wrapper.
if (platform() === "win32") {
  const batPath = resolve(SCRIPT_DIR, "native-host.bat");
  writeFileSync(batPath, `@echo off\r\n"${NODE_PATH}" "${HOST_SCRIPT}"\r\n`);
  manifest.path = batPath;
}

const manifestJson = JSON.stringify(manifest, null, 2);

function installWindows() {
  const manifestDir = resolve(SCRIPT_DIR);
  const manifestPath = join(manifestDir, `${HOST_NAME}.json`);
  writeFileSync(manifestPath, manifestJson);

  // Register in Chrome's native messaging host registry
  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: "pipe" });
    console.log(`Registered native messaging host at ${manifestPath}`);
    console.log(`Registry key: ${regKey}`);
  } catch (error) {
    console.error("Failed to write registry key:", error.message);
    console.error(`\nManually run:\n  reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
    process.exit(1);
  }
}

function installMacLinux() {
  const home = homedir();
  const manifestDirs = {
    darwin: join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
    linux: join(home, ".config", "google-chrome", "NativeMessagingHosts")
  };

  const targetDir = manifestDirs[platform()];
  if (!targetDir) {
    console.error(`Unsupported platform: ${platform()}`);
    process.exit(1);
  }

  mkdirSync(targetDir, { recursive: true });
  const manifestPath = join(targetDir, `${HOST_NAME}.json`);
  writeFileSync(manifestPath, manifestJson);
  console.log(`Installed native messaging host at ${manifestPath}`);
}

if (platform() === "win32") {
  installWindows();
} else {
  installMacLinux();
}

console.log("\nNative messaging host installed successfully");
console.log(`Host name: ${HOST_NAME}`);
console.log(`Extension ID: ${extensionId}`);
