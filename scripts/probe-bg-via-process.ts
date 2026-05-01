// Try alternate methods on WebExtensionDescriptor.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const addonsResp = await rdp.request("root", "listAddons");
    const addons = Array.isArray(addonsResp.addons) ? addonsResp.addons : [];
    const ytdl = addons.find(addon => isRecord(addon) && typeof addon.name === "string" && addon.name.includes("YouTube"));
    if (!isRecord(ytdl) || typeof ytdl.actor !== "string") {
      return;
    }

    const actor = ytdl.actor;

    // Try 'connect' / 'getWatcher' / etc.
    for (const method of ["connect", "getWatcher", "getAddon", "form"]) {
      try {
        const result = await rdp.request(actor, method);
        console.log(`${method}:`, JSON.stringify(result).slice(0, 400));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`${method}: err ${message.slice(0, 100)}`);
      }
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
